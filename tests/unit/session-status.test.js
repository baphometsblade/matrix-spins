'use strict';

const { setupTestDb, teardownTestDb, resetTables } = require('../helpers/test-db');
const { buildApp } = require('../helpers/test-app');
const request = require('supertest');

let app;
let sessionTimer;
let _ip = 0;
function nextIp() { _ip++; return `10.72.${Math.floor(_ip / 256)}.${_ip % 256}`; }

beforeAll(async () => {
    await setupTestDb();
    app = buildApp({
        routes: [
            { prefix: '/api/auth', modulePath: '../../server/routes/auth.routes' },
            { prefix: '/api/session', modulePath: '../../server/routes/session.routes' },
        ],
    });
    sessionTimer = require('../../server/services/session-timer.service');
});

afterAll(async () => { await teardownTestDb(); });
beforeEach(async () => { await resetTables('users', 'user_limits'); });

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

describe('GET /api/session/status — auth', () => {
    test('returns 401 when no Authorization header is sent', async () => {
        const res = await request(app).get('/api/session/status');
        expect(res.statusCode).toBe(401);
    });
});

describe('GET /api/session/status — inactive session', () => {
    test('returns active=false with null limit/remaining when no session has been started', async () => {
        const { token, userId } = await registerUser('sess_inactive');
        sessionTimer.endSession(userId);

        const res = await request(app)
            .get('/api/session/status')
            .set('Authorization', `Bearer ${token}`);

        expect(res.statusCode).toBe(200);
        expect(res.body.active).toBe(false);
        expect(res.body.elapsed).toBe(0);
        expect(res.body.limit).toBeNull();
        expect(res.body.remaining).toBeNull();
    });
});

describe('GET /api/session/status — active session', () => {
    test('returns active=true with elapsed minutes when a session is running and no limit is set', async () => {
        const { token, userId } = await registerUser('sess_active');
        sessionTimer.startSession(userId);

        const res = await request(app)
            .get('/api/session/status')
            .set('Authorization', `Bearer ${token}`);

        expect(res.statusCode).toBe(200);
        expect(res.body.active).toBe(true);
        expect(typeof res.body.elapsed).toBe('number');
        expect(res.body.elapsed).toBeGreaterThanOrEqual(0);
        expect(res.body.limit).toBeNull();
        expect(res.body.remaining).toBeNull();
        expect(typeof res.body.startedAt).toBe('string');
    });

    test('returns limit + remaining when user_limits.session_time_limit is configured', async () => {
        const { token, userId } = await registerUser('sess_limit');
        const db = require('../../server/database');

        // Lazy-add the column in case it isn't on the test schema yet.
        try { await db.run('ALTER TABLE user_limits ADD COLUMN session_time_limit INTEGER'); } catch (_) { /* exists */ }
        try { await db.run('ALTER TABLE user_limits ADD COLUMN updated_at TEXT'); } catch (_) { /* exists */ }

        await db.run('INSERT OR IGNORE INTO user_limits (user_id) VALUES (?)', [userId]);
        await db.run('UPDATE user_limits SET session_time_limit = ? WHERE user_id = ?', [60, userId]);

        sessionTimer.startSession(userId);

        const res = await request(app)
            .get('/api/session/status')
            .set('Authorization', `Bearer ${token}`);

        expect(res.statusCode).toBe(200);
        expect(res.body.active).toBe(true);
        expect(res.body.limit).toBe(60);
        expect(res.body.remaining).toBeGreaterThanOrEqual(0);
        expect(res.body.remaining).toBeLessThanOrEqual(60);
    });
});

describe('GET /api/session/status — lifecycle', () => {
    test('flips from inactive to active to inactive across start/end', async () => {
        const { token, userId } = await registerUser('sess_lifecycle');
        sessionTimer.endSession(userId);

        const r1 = await request(app)
            .get('/api/session/status')
            .set('Authorization', `Bearer ${token}`);
        expect(r1.body.active).toBe(false);

        sessionTimer.startSession(userId);
        const r2 = await request(app)
            .get('/api/session/status')
            .set('Authorization', `Bearer ${token}`);
        expect(r2.body.active).toBe(true);

        sessionTimer.endSession(userId);
        const r3 = await request(app)
            .get('/api/session/status')
            .set('Authorization', `Bearer ${token}`);
        expect(r3.body.active).toBe(false);
    });
});
