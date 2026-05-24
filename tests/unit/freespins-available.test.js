'use strict';

const { setupTestDb, teardownTestDb, resetTables } = require('../helpers/test-db');
const { buildApp } = require('../helpers/test-app');
const request = require('supertest');

let app;
let _ip = 0;
function nextIp() { _ip++; return `10.71.${Math.floor(_ip / 256)}.${_ip % 256}`; }

beforeAll(async () => {
    await setupTestDb();
    app = buildApp({
        routes: [
            { prefix: '/api/auth', modulePath: '../../server/routes/auth.routes' },
            { prefix: '/api/freespins', modulePath: '../../server/routes/freespins.routes' },
        ],
    });
});

afterAll(async () => { await teardownTestDb(); });
beforeEach(async () => { await resetTables('users', 'spins', 'transactions'); });

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

describe('GET /api/freespins/available — auth', () => {
    test('returns 401 when no Authorization header is sent', async () => {
        const res = await request(app).get('/api/freespins/available');
        expect(res.statusCode).toBe(401);
    });

    test('returns 401 when a malformed token is sent', async () => {
        const res = await request(app)
            .get('/api/freespins/available')
            .set('Authorization', 'Bearer not-a-real-jwt');
        expect(res.statusCode).toBe(401);
    });
});

describe('GET /api/freespins/available — response shape', () => {
    test('returns { grants: [] } when user has zero free spins', async () => {
        const { token } = await registerUser('fs_empty');
        const res = await request(app)
            .get('/api/freespins/available')
            .set('Authorization', `Bearer ${token}`);
        expect(res.statusCode).toBe(200);
        expect(res.body).toEqual({ grants: [] });
    });

    test('returns a grant with remaining + expiresAt when free spins exist', async () => {
        const { token, userId } = await registerUser('fs_active');
        const db = require('../../server/database');
        const futureExpiry = new Date(Date.now() + 24 * 3600 * 1000)
            .toISOString();
        await db.run(
            'UPDATE users SET free_spins_count = ?, free_spins_expires = ? WHERE id = ?',
            [5, futureExpiry, userId]
        );

        const res = await request(app)
            .get('/api/freespins/available')
            .set('Authorization', `Bearer ${token}`);

        expect(res.statusCode).toBe(200);
        expect(Array.isArray(res.body.grants)).toBe(true);
        expect(res.body.grants).toHaveLength(1);
        expect(res.body.grants[0].remaining).toBe(5);
        expect(res.body.grants[0].expiresAt).toBe(futureExpiry);
    });
});

describe('GET /api/freespins/available — atomic expiry sweep', () => {
    test('clears stale free_spins_count when free_spins_expires is in the past', async () => {
        const { token, userId } = await registerUser('fs_expired');
        const db = require('../../server/database');

        // Seed: 7 free spins that expired 2 hours ago
        const pastExpiry = new Date(Date.now() - 2 * 3600 * 1000)
            .toISOString();
        await db.run(
            'UPDATE users SET free_spins_count = ?, free_spins_expires = ? WHERE id = ?',
            [7, pastExpiry, userId]
        );

        // First call should sweep the expired row
        const res = await request(app)
            .get('/api/freespins/available')
            .set('Authorization', `Bearer ${token}`);
        expect(res.statusCode).toBe(200);
        expect(res.body.grants).toEqual([]);

        // Verify the sweep persisted to DB (the atomic part of the sweep)
        const row = await db.get(
            'SELECT free_spins_count, free_spins_expires FROM users WHERE id = ?',
            [userId]
        );
        expect(row.free_spins_count).toBe(0);
        expect(row.free_spins_expires).toBeNull();
    });

    test('does NOT sweep when expiry is in the future', async () => {
        const { token, userId } = await registerUser('fs_future');
        const db = require('../../server/database');
        const futureExpiry = new Date(Date.now() + 6 * 3600 * 1000)
            .toISOString();
        await db.run(
            'UPDATE users SET free_spins_count = ?, free_spins_expires = ? WHERE id = ?',
            [3, futureExpiry, userId]
        );

        const res = await request(app)
            .get('/api/freespins/available')
            .set('Authorization', `Bearer ${token}`);
        expect(res.body.grants).toHaveLength(1);
        expect(res.body.grants[0].remaining).toBe(3);

        // DB row should be untouched
        const row = await db.get(
            'SELECT free_spins_count, free_spins_expires FROM users WHERE id = ?',
            [userId]
        );
        expect(row.free_spins_count).toBe(3);
        expect(row.free_spins_expires).toBe(futureExpiry);
    });
});
