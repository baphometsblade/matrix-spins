'use strict';

const { setupTestDb, teardownTestDb, resetTables } = require('../helpers/test-db');
const { buildApp } = require('../helpers/test-app');
const request = require('supertest');

let app;
let _ip = 0;
function nextIp() { _ip++; return `10.74.${Math.floor(_ip / 256)}.${_ip % 256}`; }

beforeAll(async () => {
    await setupTestDb();
    app = buildApp({
        routes: [
            { prefix: '/api/auth', modulePath: '../../server/routes/auth.routes' },
            { prefix: '/api/deposit-limits', modulePath: '../../server/routes/depositlimits.routes' },
        ],
    });
});

afterAll(async () => { await teardownTestDb(); });
beforeEach(async () => { await resetTables('users', 'deposit_limits', 'deposits', 'transactions'); });

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

describe('GET /api/deposit-limits — auth', () => {
    test('returns 401 when no Authorization header is sent', async () => {
        const res = await request(app).get('/api/deposit-limits/');
        expect(res.statusCode).toBe(401);
    });
});

describe('GET /api/deposit-limits — response shape for new user', () => {
    test('returns null limits + zero usage + empty pendingIncreases', async () => {
        const { token } = await registerUser('dl_new');
        const res = await request(app)
            .get('/api/deposit-limits/')
            .set('Authorization', `Bearer ${token}`);

        expect(res.statusCode).toBe(200);
        expect(res.body.dailyLimit).toBeNull();
        expect(res.body.weeklyLimit).toBeNull();
        expect(res.body.monthlyLimit).toBeNull();
        expect(res.body.dailyUsed).toBe(0);
        expect(res.body.weeklyUsed).toBe(0);
        expect(res.body.monthlyUsed).toBe(0);
        expect(res.body.pendingIncreases).toEqual([]);
    });
});

describe('POST /api/deposit-limits/set — cooling-off semantics', () => {
    test('first-time set is INSTANT (no pending entry)', async () => {
        const { token } = await registerUser('dl_first');

        const setRes = await request(app)
            .post('/api/deposit-limits/set')
            .set('Authorization', `Bearer ${token}`)
            .send({ dailyLimit: 100 });

        expect(setRes.statusCode).toBe(200);

        const after = await request(app)
            .get('/api/deposit-limits/')
            .set('Authorization', `Bearer ${token}`);
        expect(after.body.dailyLimit).toBe(100);
        expect(after.body.pendingIncreases).toEqual([]);
    });

    test('lowering daily limit is INSTANT (no pending entry)', async () => {
        const { token } = await registerUser('dl_lower');

        await request(app)
            .post('/api/deposit-limits/set')
            .set('Authorization', `Bearer ${token}`)
            .send({ dailyLimit: 200 });

        const res = await request(app)
            .post('/api/deposit-limits/set')
            .set('Authorization', `Bearer ${token}`)
            .send({ dailyLimit: 50 });

        expect(res.statusCode).toBe(200);

        const after = await request(app)
            .get('/api/deposit-limits/')
            .set('Authorization', `Bearer ${token}`);
        expect(after.body.dailyLimit).toBe(50);
        expect(after.body.pendingIncreases).toEqual([]);
    });

    test('raising daily limit goes into pendingIncreases with effectiveAt ~24h out', async () => {
        const { token } = await registerUser('dl_raise');

        await request(app)
            .post('/api/deposit-limits/set')
            .set('Authorization', `Bearer ${token}`)
            .send({ dailyLimit: 50 });

        const beforeRaise = Date.now();
        const res = await request(app)
            .post('/api/deposit-limits/set')
            .set('Authorization', `Bearer ${token}`)
            .send({ dailyLimit: 500 });

        expect(res.statusCode).toBe(200);

        const after = await request(app)
            .get('/api/deposit-limits/')
            .set('Authorization', `Bearer ${token}`);
        expect(after.body.dailyLimit).toBe(50);

        const dailyPending = after.body.pendingIncreases.find(p => p.type === 'daily');
        expect(dailyPending).toBeDefined();
        expect(dailyPending.newLimit).toBe(500);
        expect(typeof dailyPending.effectiveAt).toBe('string');

        const effectiveMs = new Date(dailyPending.effectiveAt.replace(' ', 'T') + 'Z').getTime();
        const expectedMs = beforeRaise + 24 * 3600 * 1000;
        expect(Math.abs(effectiveMs - expectedMs)).toBeLessThan(5 * 60 * 1000);
    });

    test('raising weekly + monthly creates two pending entries independently', async () => {
        const { token } = await registerUser('dl_multi');

        await request(app)
            .post('/api/deposit-limits/set')
            .set('Authorization', `Bearer ${token}`)
            .send({ weeklyLimit: 500, monthlyLimit: 2000 });

        await request(app)
            .post('/api/deposit-limits/set')
            .set('Authorization', `Bearer ${token}`)
            .send({ weeklyLimit: 1500, monthlyLimit: 6000 });

        const after = await request(app)
            .get('/api/deposit-limits/')
            .set('Authorization', `Bearer ${token}`);
        expect(after.body.weeklyLimit).toBe(500);
        expect(after.body.monthlyLimit).toBe(2000);

        const types = after.body.pendingIncreases.map(p => p.type).sort();
        expect(types).toEqual(['monthly', 'weekly']);
    });

    test('idempotency — setting same daily limit twice does not create a pending entry', async () => {
        const { token } = await registerUser('dl_idem');

        await request(app)
            .post('/api/deposit-limits/set')
            .set('Authorization', `Bearer ${token}`)
            .send({ dailyLimit: 100 });

        const second = await request(app)
            .post('/api/deposit-limits/set')
            .set('Authorization', `Bearer ${token}`)
            .send({ dailyLimit: 100 });

        expect(second.statusCode).toBe(200);

        const after = await request(app)
            .get('/api/deposit-limits/')
            .set('Authorization', `Bearer ${token}`);
        expect(after.body.dailyLimit).toBe(100);
        expect(after.body.pendingIncreases).toEqual([]);
    });
});
