'use strict';

const { setupTestDb, teardownTestDb, resetTables } = require('../helpers/test-db');
const { buildApp } = require('../helpers/test-app');
const request = require('supertest');

let app;
let _ip = 0;
function nextIp() { _ip++; return `10.73.${Math.floor(_ip / 256)}.${_ip % 256}`; }

beforeAll(async () => {
    await setupTestDb();
    app = buildApp({
        routes: [
            { prefix: '/api/auth', modulePath: '../../server/routes/auth.routes' },
            { prefix: '/api/loss-limits', modulePath: '../../server/routes/loss-limits.routes' },
        ],
    });
});

afterAll(async () => { await teardownTestDb(); });
beforeEach(async () => { await resetTables('users', 'user_limits', 'spins', 'transactions'); });

async function registerUser(username) {
    const res = await request(app)
        .post('/api/auth/register')
        .set('X-Forwarded-For', nextIp())
        .send({
            username,
            email: `${username}@test.com`,
            password: 'StrongPass1!',
            dateOfBirth: '1990-01-01',
            acceptTerms: true,
        });
    return { token: res.body.token, userId: res.body.user.id };
}

describe('GET /api/loss-limits — auth', () => {
    test('returns 401 when no Authorization header is sent', async () => {
        const res = await request(app).get('/api/loss-limits/');
        expect(res.statusCode).toBe(401);
    });
});

describe('GET /api/loss-limits — response shape for new user', () => {
    test('returns null limits + zero usage + empty pendingIncreases', async () => {
        const { token } = await registerUser('ll_new');
        const res = await request(app)
            .get('/api/loss-limits/')
            .set('Authorization', `Bearer ${token}`);

        expect(res.statusCode).toBe(200);
        expect(res.body.dailyLossLimit).toBeNull();
        expect(res.body.weeklyLossLimit).toBeNull();
        expect(res.body.monthlyLossLimit).toBeNull();
        expect(res.body.maxBetPerSpin).toBeNull();
        // Default reality-check interval is 60 minutes per CLAUDE.md
        expect(res.body.realityCheckInterval).toBe(60);
        expect(res.body.dailyLossUsed).toBe(0);
        expect(res.body.weeklyLossUsed).toBe(0);
        expect(res.body.monthlyLossUsed).toBe(0);
        expect(res.body.pendingIncreases).toEqual([]);
    });
});

describe('POST /api/loss-limits/set — cooling-off semantics', () => {
    test('lowering daily limit is INSTANT (no pending entry)', async () => {
        const { token } = await registerUser('ll_lower');

        // Seed initial $200/day (first-time set is instant)
        await request(app)
            .post('/api/loss-limits/set')
            .set('Authorization', `Bearer ${token}`)
            .send({ dailyLossLimit: 200 });

        // Lower it to $50 — must be immediate
        const res = await request(app)
            .post('/api/loss-limits/set')
            .set('Authorization', `Bearer ${token}`)
            .send({ dailyLossLimit: 50 });

        expect(res.statusCode).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.pendingIncreases || []).toEqual([]);

        const after = await request(app)
            .get('/api/loss-limits/')
            .set('Authorization', `Bearer ${token}`);
        expect(after.body.dailyLossLimit).toBe(50);
        expect(after.body.pendingIncreases).toEqual([]);
    });

    test('raising daily limit goes into pendingIncreases with effectiveAt ~24h out', async () => {
        const { token } = await registerUser('ll_raise');

        // Seed initial $50/day
        await request(app)
            .post('/api/loss-limits/set')
            .set('Authorization', `Bearer ${token}`)
            .send({ dailyLossLimit: 50 });

        // Try to raise to $500 — must be pending, NOT instant
        const beforeRaise = Date.now();
        const res = await request(app)
            .post('/api/loss-limits/set')
            .set('Authorization', `Bearer ${token}`)
            .send({ dailyLossLimit: 500 });

        expect(res.statusCode).toBe(200);
        expect(res.body.success).toBe(true);
        expect(Array.isArray(res.body.pendingIncreases)).toBe(true);
        expect(res.body.pendingIncreases.length).toBeGreaterThan(0);
        const dailyPending = res.body.pendingIncreases.find(p => p.type === 'daily');
        expect(dailyPending).toBeDefined();
        expect(dailyPending.newLimit).toBe(500);
        expect(typeof dailyPending.effectiveAt).toBe('string');

        // effectiveAt should land roughly 24h from now (allow ±5 minutes drift)
        const effectiveMs = new Date(dailyPending.effectiveAt.replace(' ', 'T') + 'Z').getTime();
        const expectedMs = beforeRaise + 24 * 3600 * 1000;
        expect(Math.abs(effectiveMs - expectedMs)).toBeLessThan(5 * 60 * 1000);

        // Effective limit must STILL be 50 — the raise is not active yet
        const after = await request(app)
            .get('/api/loss-limits/')
            .set('Authorization', `Bearer ${token}`);
        expect(after.body.dailyLossLimit).toBe(50);
        const afterPending = after.body.pendingIncreases.find(p => p.type === 'daily');
        expect(afterPending).toBeDefined();
        expect(afterPending.newLimit).toBe(500);
    });

    test('first-time setting of a limit (currentVal=null) is INSTANT, not pending', async () => {
        const { token } = await registerUser('ll_firsttime');

        const res = await request(app)
            .post('/api/loss-limits/set')
            .set('Authorization', `Bearer ${token}`)
            .send({ weeklyLossLimit: 300 });

        expect(res.statusCode).toBe(200);
        expect(res.body.pendingIncreases || []).toEqual([]);

        const after = await request(app)
            .get('/api/loss-limits/')
            .set('Authorization', `Bearer ${token}`);
        expect(after.body.weeklyLossLimit).toBe(300);
    });

    test('raising max-bet-per-spin also goes pending (not instant)', async () => {
        const { token } = await registerUser('ll_maxbet');

        // Seed initial $5/spin
        await request(app)
            .post('/api/loss-limits/set')
            .set('Authorization', `Bearer ${token}`)
            .send({ maxBetPerSpin: 5 });

        // Raise to $25 — must be pending
        const res = await request(app)
            .post('/api/loss-limits/set')
            .set('Authorization', `Bearer ${token}`)
            .send({ maxBetPerSpin: 25 });

        expect(res.statusCode).toBe(200);
        const maxBetPending = (res.body.pendingIncreases || []).find(p => p.type === 'max_bet');
        expect(maxBetPending).toBeDefined();
        expect(maxBetPending.newLimit).toBe(25);

        // Effective max bet remains 5
        const after = await request(app)
            .get('/api/loss-limits/')
            .set('Authorization', `Bearer ${token}`);
        expect(after.body.maxBetPerSpin).toBe(5);
    });
});
