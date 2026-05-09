'use strict';

const { setupTestDb, teardownTestDb, resetTables } = require('../helpers/test-db');
const { buildApp } = require('../helpers/test-app');
const request = require('supertest');

let app;
let _ip = 0;
function nextIp() { _ip++; return `10.77.${Math.floor(_ip / 256)}.${_ip % 256}`; }

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
beforeEach(async () => { await resetTables(); });

async function registerUser(username) {
    const res = await request(app).post('/api/auth/register').set('X-Forwarded-For', nextIp()).send({
        username,
        email: `${username}@test.com`,
        password: 'StrongPass1!',
        dateOfBirth: '1990-01-01',
        acceptTerms: true,
    });
    return { token: res.body.token, userId: res.body.user.id };
}

describe('Deposit Limits — Set / Get', () => {
    test('GET returns null limits for new user', async () => {
        const { token } = await registerUser('dl1');
        const res = await request(app).get('/api/deposit-limits/').set('Authorization', `Bearer ${token}`);
        expect(res.statusCode).toBe(200);
        expect(res.body.dailyLimit).toBeNull();
    });

    test('POST /set creates a daily limit', async () => {
        const { token } = await registerUser('dl2');
        const res = await request(app).post('/api/deposit-limits/set').set('Authorization', `Bearer ${token}`).send({ dailyLimit: 100 });
        expect(res.statusCode).toBe(200);

        const get = await request(app).get('/api/deposit-limits/').set('Authorization', `Bearer ${token}`);
        expect(get.body.dailyLimit).toBe(100);
    });

    test('POST /set lower limit is applied immediately', async () => {
        const { token } = await registerUser('dl3');
        await request(app).post('/api/deposit-limits/set').set('Authorization', `Bearer ${token}`).send({ dailyLimit: 200 });
        const lower = await request(app).post('/api/deposit-limits/set').set('Authorization', `Bearer ${token}`).send({ dailyLimit: 50 });
        expect(lower.statusCode).toBe(200);
        const get = await request(app).get('/api/deposit-limits/').set('Authorization', `Bearer ${token}`);
        expect(get.body.dailyLimit).toBe(50);
    });

    test('POST /set increase requires 24h cool-off (limit stays at old value)', async () => {
        const { token } = await registerUser('dl4');
        await request(app).post('/api/deposit-limits/set').set('Authorization', `Bearer ${token}`).send({ dailyLimit: 50 });
        await request(app).post('/api/deposit-limits/set').set('Authorization', `Bearer ${token}`).send({ dailyLimit: 500 });
        const get = await request(app).get('/api/deposit-limits/').set('Authorization', `Bearer ${token}`);
        expect(get.body.dailyLimit).toBe(50); // not yet 500
        expect(get.body.pendingIncreases.length).toBeGreaterThan(0);
    });

    test('GET /check rejects deposit that would exceed daily limit', async () => {
        const { token, userId } = await registerUser('dl5');
        await request(app).post('/api/deposit-limits/set').set('Authorization', `Bearer ${token}`).send({ dailyLimit: 100 });

        // Pre-existing deposits today: 80
        const db = require('../../server/database');
        await db.run("INSERT INTO deposits (user_id, amount, payment_type, status, completed_at) VALUES (?, ?, 'visa', 'completed', datetime('now'))", [userId, 80]).catch(async () => {
            // Schema may have different columns — fall back to minimal insert
            await db.run("INSERT INTO deposits (user_id, amount, status, completed_at) VALUES (?, ?, 'completed', datetime('now'))", [userId, 80]);
        });

        const res = await request(app).get('/api/deposit-limits/check?amount=50').set('Authorization', `Bearer ${token}`);
        expect(res.body.allowed).toBe(false);
    });

    test('GET /check allows deposit within limit', async () => {
        const { token } = await registerUser('dl6');
        await request(app).post('/api/deposit-limits/set').set('Authorization', `Bearer ${token}`).send({ dailyLimit: 100 });
        const res = await request(app).get('/api/deposit-limits/check?amount=50').set('Authorization', `Bearer ${token}`);
        expect(res.body.allowed).toBe(true);
    });
});
