'use strict';

const { setupTestDb, teardownTestDb, resetTables } = require('../helpers/test-db');
const { buildApp } = require('../helpers/test-app');
const request = require('supertest');

let app;
let ipCounter = 0;

// Each test gets a fresh fake IP via X-Forwarded-For so the auth route's
// IP-based registration rate limiter (3/hr) doesn't poison consecutive tests.
function nextIp() {
    ipCounter++;
    return `10.99.${Math.floor(ipCounter / 256)}.${ipCounter % 256}`;
}

beforeAll(async () => {
    await setupTestDb();
    app = buildApp({
        routes: [
            { prefix: '/api/auth', modulePath: '../../server/routes/auth.routes' },
            { prefix: '/api/balance', modulePath: '../../server/routes/balance.routes' },
        ],
    });
});

afterAll(async () => { await teardownTestDb(); });
beforeEach(async () => { await resetTables(); });

describe('Auth Flow — Register/Login', () => {
    const testUser = {
        username: 'flowtest',
        email: 'flowtest@example.com',
        password: 'StrongPass1!',
        dateOfBirth: '1990-01-01',
        acceptTerms: true,
    };

    test('POST /api/auth/register creates a new user and returns a JWT', async () => {
        const res = await request(app).post('/api/auth/register').set('X-Forwarded-For', nextIp()).send(testUser);
        expect(res.statusCode).toBe(201);
        expect(res.body).toHaveProperty('token');
        expect(res.body.user.username).toBe(testUser.username);
    });

    test('POST /api/auth/register rejects duplicate username', async () => {
        await request(app).post('/api/auth/register').set('X-Forwarded-For', nextIp()).send(testUser);
        const res2 = await request(app).post('/api/auth/register').set('X-Forwarded-For', nextIp()).send(testUser);
        expect(res2.statusCode).toBe(409);
    });

    test('POST /api/auth/register rejects weak password', async () => {
        const res = await request(app).post('/api/auth/register').set('X-Forwarded-For', nextIp()).send({
            ...testUser,
            username: 'weakuser',
            email: 'weak@example.com',
            password: 'weak',
        });
        expect(res.statusCode).toBe(400);
    });

    test('POST /api/auth/register rejects under-18 user', async () => {
        const res = await request(app).post('/api/auth/register').set('X-Forwarded-For', nextIp()).send({
            ...testUser,
            username: 'minor',
            email: 'minor@example.com',
            dateOfBirth: '2020-01-01',
        });
        expect(res.statusCode).toBe(403);
    });

    test('POST /api/auth/register requires acceptTerms', async () => {
        const res = await request(app).post('/api/auth/register').set('X-Forwarded-For', nextIp()).send({
            ...testUser,
            username: 'noterms',
            email: 'noterms@example.com',
            acceptTerms: false,
        });
        expect(res.statusCode).toBe(400);
    });

    test('POST /api/auth/login authenticates with correct credentials', async () => {
        await request(app).post('/api/auth/register').set('X-Forwarded-For', nextIp()).send(testUser);
        const res = await request(app).post('/api/auth/login').send({
            username: testUser.username,
            password: testUser.password,
        });
        expect(res.statusCode).toBe(200);
        expect(res.body).toHaveProperty('token');
    });

    test('POST /api/auth/login rejects bad password', async () => {
        await request(app).post('/api/auth/register').set('X-Forwarded-For', nextIp()).send(testUser);
        const res = await request(app).post('/api/auth/login').send({
            username: testUser.username,
            password: 'WrongPass1!',
        });
        expect(res.statusCode).toBe(401);
    });
});

describe('Auth Flow — /me with token', () => {
    test('GET /api/auth/me returns user info with valid token', async () => {
        const reg = await request(app).post('/api/auth/register').set('X-Forwarded-For', nextIp()).send({
            username: 'meuser',
            email: 'meuser@example.com',
            password: 'StrongPass1!',
            dateOfBirth: '1990-01-01',
            acceptTerms: true,
        });
        const token = reg.body.token;
        const res = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${token}`);
        expect(res.statusCode).toBe(200);
        expect(res.body.user).toHaveProperty('username', 'meuser');
    });

    test('GET /api/auth/me rejects missing token', async () => {
        const res = await request(app).get('/api/auth/me');
        expect(res.statusCode).toBe(401);
    });
});

describe('Auth Flow — Balance protected route', () => {
    test('GET /api/balance with valid token returns balance', async () => {
        const reg = await request(app).post('/api/auth/register').set('X-Forwarded-For', nextIp()).send({
            username: 'baluser',
            email: 'baluser@example.com',
            password: 'StrongPass1!',
            dateOfBirth: '1990-01-01',
            acceptTerms: true,
        });
        const token = reg.body.token;
        const res = await request(app).get('/api/balance').set('Authorization', `Bearer ${token}`);
        expect(res.statusCode).toBe(200);
        expect(res.body).toHaveProperty('balance');
    });

    test('GET /api/balance rejects unauthenticated request', async () => {
        const res = await request(app).get('/api/balance');
        expect(res.statusCode).toBe(401);
    });
});
