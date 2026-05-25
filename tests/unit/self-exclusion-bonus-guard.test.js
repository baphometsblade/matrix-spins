'use strict';

/**
 * Integration test for the self-exclusion → bonusGuard fail-closed chain.
 *
 * Verifies CLAUDE.md Rule #6: every bonus-claim route is wrapped in
 * bonusGuard, and bonusGuard refuses claims once self-exclusion is active.
 * Together those guarantee a self-excluded user cannot claim any bonus.
 *
 * Activates exclusion via the real /api/self-exclusion/activate endpoint,
 * then hits the real /api/freespins/use endpoint and asserts it 403s.
 * If this test fails, a bonus claim route is reachable while a user is
 * locked out — a compliance regression that should block the build.
 */

const { setupTestDb, teardownTestDb, resetTables } = require('../helpers/test-db');
const { buildApp } = require('../helpers/test-app');
const request = require('supertest');
const db = require('../../server/database');

let app;
let _ip = 0;
function nextIp() { _ip++; return `10.76.${Math.floor(_ip / 256)}.${_ip % 256}`; }

beforeAll(async () => {
    await setupTestDb();
    // Backfill columns that route handlers SELECT/INSERT but that
    // tests/helpers/test-db.js stub schemas don't include. ALTER ... ADD
    // COLUMN is a no-op when the column already exists (we swallow that).
    // - self_exclusions: route INSERTs exclusion_type/reason/starts_at
    // - user_limits: bonusGuard SELECTs self_excluded_until/cooling_off_until
    for (const sql of [
        'ALTER TABLE self_exclusions ADD COLUMN exclusion_type TEXT',
        'ALTER TABLE self_exclusions ADD COLUMN reason TEXT',
        'ALTER TABLE self_exclusions ADD COLUMN starts_at TEXT',
        'ALTER TABLE user_limits ADD COLUMN self_excluded_until TEXT',
        'ALTER TABLE user_limits ADD COLUMN cooling_off_until TEXT',
    ]) {
        try { await db.run(sql); } catch (_) { /* already exists */ }
    }

    app = buildApp({
        routes: [
            { prefix: '/api/auth', modulePath: '../../server/routes/auth.routes' },
            { prefix: '/api/self-exclusion', modulePath: '../../server/routes/selfexclusion.routes' },
            { prefix: '/api/freespins', modulePath: '../../server/routes/freespins.routes' },
        ],
    });
});

afterAll(async () => { await teardownTestDb(); });
beforeEach(async () => { await resetTables('users', 'self_exclusions', 'transactions'); });

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

describe('Self-exclusion fail-closed against bonusGuard-protected routes', () => {
    test('POST /api/freespins/use returns 403 once user is self-excluded', async () => {
        const { token, userId } = await registerUser('se_failclosed');

        // Pre-grant a free spin so the route would otherwise succeed.
        const expires = new Date(Date.now() + 24 * 3600 * 1000).toISOString();
        await db.run(
            'UPDATE users SET free_spins_count = 3, free_spins_expires = ? WHERE id = ?',
            [expires, userId]
        );

        // Sanity: before exclusion, the route accepts the claim.
        const before = await request(app)
            .post('/api/freespins/use')
            .set('Authorization', `Bearer ${token}`)
            .send({});
        expect(before.statusCode).toBe(200);
        expect(before.body.success).toBe(true);

        // Activate self-exclusion.
        const act = await request(app)
            .post('/api/self-exclusion/activate')
            .set('Authorization', `Bearer ${token}`)
            .send({ type: 'cooldown_24h' });
        expect(act.statusCode).toBe(200);

        // Now the same bonus-claim route must fail-closed with 403.
        const after = await request(app)
            .post('/api/freespins/use')
            .set('Authorization', `Bearer ${token}`)
            .send({});
        expect(after.statusCode).toBe(403);
        expect(String(after.body.error || '')).toMatch(/self-excluded/i);
    });
});
