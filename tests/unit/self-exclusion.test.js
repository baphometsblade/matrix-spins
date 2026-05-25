'use strict';

const { setupTestDb, teardownTestDb, resetTables } = require('../helpers/test-db');
const { buildApp } = require('../helpers/test-app');
const request = require('supertest');

let app;
let _ip = 0;
function nextIp() { _ip++; return `10.75.${Math.floor(_ip / 256)}.${_ip % 256}`; }

beforeAll(async () => {
    await setupTestDb();
    // tests/helpers/test-db.js lazily creates a minimal self_exclusions
    // schema (id, user_id, is_active, ends_at, created_at). The route
    // expects exclusion_type, reason, starts_at as well. Add them here
    // so the route's INSERT succeeds. (ALTER TABLE ADD COLUMN is a
    // no-op when the column already exists — we swallow that error.)
    const db = require('../../server/database');
    for (const sql of [
        'ALTER TABLE self_exclusions ADD COLUMN exclusion_type TEXT',
        'ALTER TABLE self_exclusions ADD COLUMN reason TEXT',
        'ALTER TABLE self_exclusions ADD COLUMN starts_at TEXT',
    ]) {
        try { await db.run(sql); } catch (_) { /* already exists */ }
    }

    app = buildApp({
        routes: [
            { prefix: '/api/auth', modulePath: '../../server/routes/auth.routes' },
            { prefix: '/api/self-exclusion', modulePath: '../../server/routes/selfexclusion.routes' },
        ],
    });
});

afterAll(async () => { await teardownTestDb(); });
beforeEach(async () => { await resetTables('users', 'self_exclusions'); });

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

describe('GET /api/self-exclusion/status — auth', () => {
    test('returns 401 when no Authorization header is sent', async () => {
        const res = await request(app).get('/api/self-exclusion/status');
        expect(res.statusCode).toBe(401);
    });
});

describe('GET /api/self-exclusion/status — initial state', () => {
    test('returns excluded=false for a brand-new user', async () => {
        const { token } = await registerUser('se_new');
        const res = await request(app)
            .get('/api/self-exclusion/status')
            .set('Authorization', `Bearer ${token}`);

        expect(res.statusCode).toBe(200);
        expect(res.body.excluded).toBe(false);
        expect(res.body.endsAt).toBeNull();
        expect(res.body.type).toBeNull();
    });
});

describe('POST /api/self-exclusion/activate — state transition', () => {
    test('activate cooldown_24h flips status to excluded with ~24h endsAt', async () => {
        const { token } = await registerUser('se_24h');

        const beforeActivate = Date.now();
        const activate = await request(app)
            .post('/api/self-exclusion/activate')
            .set('Authorization', `Bearer ${token}`)
            .send({ type: 'cooldown_24h', reason: 'taking a break' });

        expect(activate.statusCode).toBe(200);
        expect(activate.body.activated).toBe(true);
        expect(activate.body.type).toBe('cooldown_24h');
        expect(activate.body.isPermanent).toBe(false);
        expect(typeof activate.body.endsAt).toBe('string');

        const endsMs = new Date(activate.body.endsAt.replace(' ', 'T') + 'Z').getTime();
        const expectedMs = beforeActivate + 24 * 3600 * 1000;
        expect(Math.abs(endsMs - expectedMs)).toBeLessThan(5 * 60 * 1000);

        const status = await request(app)
            .get('/api/self-exclusion/status')
            .set('Authorization', `Bearer ${token}`);
        expect(status.body.excluded).toBe(true);
        expect(status.body.type).toBe('cooldown_24h');
    });

    test('rejects unknown type with 400', async () => {
        const { token } = await registerUser('se_badtype');
        const res = await request(app)
            .post('/api/self-exclusion/activate')
            .set('Authorization', `Bearer ${token}`)
            .send({ type: 'forever_and_ever' });
        expect(res.statusCode).toBe(400);
    });
});

describe('POST /api/self-exclusion/activate — idempotency / irreversibility', () => {
    test('a second activate while one is active returns 400 (cannot re-enroll)', async () => {
        const { token } = await registerUser('se_double');

        const first = await request(app)
            .post('/api/self-exclusion/activate')
            .set('Authorization', `Bearer ${token}`)
            .send({ type: 'cooldown_7d' });
        expect(first.statusCode).toBe(200);

        const second = await request(app)
            .post('/api/self-exclusion/activate')
            .set('Authorization', `Bearer ${token}`)
            .send({ type: 'cooldown_30d' });
        expect(second.statusCode).toBe(400);
        expect(second.body.currentExclusion).toBeDefined();
        expect(second.body.currentExclusion.excluded).toBe(true);
        expect(second.body.currentExclusion.type).toBe('cooldown_7d');

        const status = await request(app)
            .get('/api/self-exclusion/status')
            .set('Authorization', `Bearer ${token}`);
        expect(status.body.type).toBe('cooldown_7d');
    });
});
