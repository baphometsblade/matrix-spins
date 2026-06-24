'use strict';

/**
 * Battle-pass unification (2026-06-25).
 *
 * Two battle-pass implementations existed: a season-based SERVICE
 * (battlepass.service.js) that receives spin XP, and a pass-based ROUTE
 * (battle-pass.routes.js) that the user-facing /api/battle-pass reads. They
 * used different tables, so spin XP never showed up in the UI (always xp=0).
 *
 * After unification the ROUTE delegates all progression to the SERVICE, so the
 * XP that spins award is reflected in /api/battle-pass. These tests prove that
 * seam end-to-end and lock the canonical contract.
 *
 * See docs/superpowers/specs/2026-06-25-battle-pass-unification-design.md.
 */

const { setupTestDb, teardownTestDb, resetTables } = require('../helpers/test-db');
const { buildApp } = require('../helpers/test-app');
const request = require('supertest');

let app;

beforeAll(async () => {
    await setupTestDb();
    app = buildApp({
        routes: [
            { prefix: '/api/auth', modulePath: '../../server/routes/auth.routes' },
            { prefix: '/api/spin', modulePath: '../../server/routes/spin.routes' },
            { prefix: '/api/battle-pass', modulePath: '../../server/routes/battle-pass.routes' },
        ],
    });
});

afterAll(async () => { await teardownTestDb(); });

let _ipCounter = 0;
function nextIp() { _ipCounter++; return `10.77.${Math.floor(_ipCounter / 256)}.${_ipCounter % 256}`; }

async function registerUser(username, balance = 100) {
    const reg = await request(app).post('/api/auth/register').set('X-Forwarded-For', nextIp()).send({
        username,
        email: `${username}@example.com`,
        password: 'StrongPass1!',
        dateOfBirth: '1990-01-01',
        acceptTerms: true,
    });
    const token = reg.body.token;
    const userId = reg.body.user.id;
    const db = require('../../server/database');
    await db.run('UPDATE users SET balance = ?, is_admin = 1 WHERE id = ?', [balance, userId]);
    return { token, userId };
}

const bpService = () => require('../../server/services/battlepass.service');

describe('Battle-pass unification — /api/battle-pass reflects service XP', () => {
    beforeEach(async () => {
        await resetTables('users', 'transactions', 'spins', 'session_win_caps', 'game_stats',
            'battle_pass_progress', 'battle_pass_seasons');
    });

    // CORE PROOF: the exact call spin.routes.js makes (battlepassService.addXp)
    // must be visible through the user-facing route.
    test('XP awarded via service.addXp shows up in GET /progress', async () => {
        const { token, userId } = await registerUser('bpcore');
        await bpService().addXp(userId, 1); // floor(5 + 1*0.5) = 5 XP

        const res = await request(app)
            .get('/api/battle-pass/progress')
            .set('Authorization', `Bearer ${token}`);

        expect(res.statusCode).toBe(200);
        expect(res.body.xp).toBe(5);
        expect(res.body.level).toBe(0);
        expect(res.body.max_level).toBe(50);
        expect(res.body.next_level_xp).toBe(100);
        // legacy aliases kept for forward-compat
        expect(res.body.current_level).toBe(0);
        expect(res.body.xp_for_next_level).toBe(100);
        expect(res.body).toHaveProperty('tiers');
    });

    // LIVE SEAM: a real spin (fire-and-forget addXp inside the route) reaches the UI.
    test('a real POST /api/spin is reflected in GET /progress', async () => {
        const { token } = await registerUser('bplive');

        const spin = await request(app)
            .post('/api/spin')
            .set('Authorization', `Bearer ${token}`)
            .send({ gameId: 'sugar_rush', bet: 1 });
        expect([200, 201]).toContain(spin.statusCode);

        // addXp is intentionally fire-and-forget for spin latency — poll until reflected.
        let body = null;
        for (let i = 0; i < 60; i++) {
            const r = await request(app)
                .get('/api/battle-pass/progress')
                .set('Authorization', `Bearer ${token}`);
            body = r.body;
            if (body && body.xp > 0) break;
            await new Promise((resolve) => setTimeout(resolve, 25));
        }
        expect(body.xp).toBeGreaterThan(0);
    });

    test('GET / returns an auto-created active season', async () => {
        const res = await request(app).get('/api/battle-pass');
        expect(res.statusCode).toBe(200);
        expect(res.body.active).toBe(true);
        expect(res.body.season).toHaveProperty('id');
        expect(res.body.max_level).toBe(50);
        expect(res.body.premium_price).toBe(9.99);
    });

    test('POST /purchase premium debits cash balance and marks progress premium', async () => {
        const { token, userId } = await registerUser('bpbuy', 50);
        const db = require('../../server/database');

        const buy = await request(app)
            .post('/api/battle-pass/purchase')
            .set('Authorization', `Bearer ${token}`)
            .send({ tier: 'premium' });
        expect(buy.statusCode).toBe(200);
        expect(buy.body.success).toBe(true);

        const u = await db.get('SELECT balance FROM users WHERE id = ?', [userId]);
        expect(u.balance).toBeCloseTo(50 - 9.99, 2);

        const prog = await request(app)
            .get('/api/battle-pass/progress')
            .set('Authorization', `Bearer ${token}`);
        expect(prog.body.is_premium).toBe(true);
        expect(prog.body.tier).toBe('premium');
    });

    test('POST /purchase rejects retired elite tier', async () => {
        const { token } = await registerUser('bpelite', 100);
        const res = await request(app)
            .post('/api/battle-pass/purchase')
            .set('Authorization', `Bearer ${token}`)
            .send({ tier: 'elite' });
        expect(res.statusCode).toBe(400);
    });

    test('POST /claim credits bonus_balance + wagering for a reached level', async () => {
        const { token, userId } = await registerUser('bpclaim');
        const db = require('../../server/database');
        const season = await bpService().getCurrentSeason();
        await bpService().getProgress(userId); // ensure a progress row exists
        await db.run('UPDATE battle_pass_progress SET level = ? WHERE user_id = ? AND season_id = ?',
            [10, userId, season.id]);

        const before = await db.get(
            'SELECT COALESCE(bonus_balance,0) bb, COALESCE(wagering_requirement,0) wr FROM users WHERE id = ?',
            [userId]);

        // Level 2 free track = credits 0.10 → bonus_balance +0.10, wagering +2.00 (20x)
        const claim = await request(app)
            .post('/api/battle-pass/claim')
            .set('Authorization', `Bearer ${token}`)
            .send({ level: 2, track: 'free' });
        expect(claim.statusCode).toBe(200);
        expect(claim.body.success).toBe(true);

        const after = await db.get(
            'SELECT COALESCE(bonus_balance,0) bb, COALESCE(wagering_requirement,0) wr FROM users WHERE id = ?',
            [userId]);
        expect(after.bb).toBeCloseTo(before.bb + 0.10, 2);
        expect(after.wr).toBeCloseTo(before.wr + 2.0, 2);

        const prog = await request(app)
            .get('/api/battle-pass/progress')
            .set('Authorization', `Bearer ${token}`);
        expect(prog.body.claimed_free).toContain(2);
    });

    test('GET /leaderboard includes a player who earned XP', async () => {
        const { userId } = await registerUser('bplead');
        await bpService().addXp(userId, 10);
        const res = await request(app).get('/api/battle-pass/leaderboard');
        expect(res.statusCode).toBe(200);
        expect(Array.isArray(res.body.leaderboard)).toBe(true);
        expect(res.body.leaderboard.some((e) => e.username === 'bplead')).toBe(true);
    });

    test('POST /add-xp is a deprecated no-op (cannot inflate XP)', async () => {
        const { token, userId } = await registerUser('bpnoop');
        await bpService().addXp(userId, 1); // xp = 5

        const res = await request(app)
            .post('/api/battle-pass/add-xp')
            .set('Authorization', `Bearer ${token}`)
            .send({ xp: 50 });
        expect(res.statusCode).toBe(200);

        const prog = await request(app)
            .get('/api/battle-pass/progress')
            .set('Authorization', `Bearer ${token}`);
        expect(prog.body.xp).toBe(5); // unchanged — endpoint no longer awards XP
    });
});
