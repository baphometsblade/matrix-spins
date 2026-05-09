'use strict';

const { setupTestDb, teardownTestDb, resetTables } = require('../helpers/test-db');
const { buildApp } = require('../helpers/test-app');
const request = require('supertest');

let app;

beforeAll(async () => {
    await setupTestDb();
    app = buildApp({
        routes: [
            { prefix: '/api/auth', modulePath: '../../server/routes/auth.routes' },
            { prefix: '/api/balance', modulePath: '../../server/routes/balance.routes' },
            { prefix: '/api/spin', modulePath: '../../server/routes/spin.routes' },
        ],
    });
});

afterAll(async () => { await teardownTestDb(); });

let _ipCounter = 0;
function nextIp() { _ipCounter++; return `10.88.${Math.floor(_ipCounter / 256)}.${_ipCounter % 256}`; }

async function registerAndDeposit(username) {
    const reg = await request(app).post('/api/auth/register').set('X-Forwarded-For', nextIp()).send({
        username,
        email: `${username}@example.com`,
        password: 'StrongPass1!',
        dateOfBirth: '1990-01-01',
        acceptTerms: true,
    });
    const token = reg.body.token;
    const userId = reg.body.user.id;

    // Manually credit balance for testing (admin route requires admin)
    const db = require('../../server/database');
    await db.run('UPDATE users SET balance = ?, is_admin = 1 WHERE id = ?', [100, userId]);

    return { token, userId };
}

describe('Spin Flow — End-to-end spin lifecycle', () => {
    beforeEach(async () => {
        await resetTables('users', 'spins', 'transactions', 'session_win_caps', 'game_stats');
    });

    test('Register → spin → balance reduced by bet (or increased by win)', async () => {
        const { token, userId } = await registerAndDeposit('spinflow1');
        const db = require('../../server/database');

        // Refresh balance for clean state
        await db.run('UPDATE users SET balance = ? WHERE id = ?', [100, userId]);

        const before = await request(app).get('/api/balance').set('Authorization', `Bearer ${token}`);
        expect(before.body.balance).toBe(100);

        const spin = await request(app)
            .post('/api/spin')
            .set('Authorization', `Bearer ${token}`)
            .send({ gameId: 'sugar_rush', betAmount: 1 });

        expect([200, 201]).toContain(spin.statusCode);
        expect(spin.body).toHaveProperty('balance');
        expect(spin.body).toHaveProperty('grid');
        // Net effect: balance = 100 - 1 + winAmount
        expect(spin.body.balance).toBeCloseTo(100 - 1 + (spin.body.winAmount || 0), 2);
    });

    test('Spin rejects unknown gameId', async () => {
        const { token } = await registerAndDeposit('spinflow2');
        const res = await request(app)
            .post('/api/spin')
            .set('Authorization', `Bearer ${token}`)
            .send({ gameId: 'no_such_game_id', betAmount: 1 });
        expect([400, 404]).toContain(res.statusCode);
    });

    test('Spin rejects negative or zero bet', async () => {
        const { token } = await registerAndDeposit('spinflow3');
        const r1 = await request(app).post('/api/spin').set('Authorization', `Bearer ${token}`).send({ gameId: 'sugar_rush', betAmount: 0 });
        const r2 = await request(app).post('/api/spin').set('Authorization', `Bearer ${token}`).send({ gameId: 'sugar_rush', betAmount: -1 });
        expect(r1.statusCode).toBe(400);
        expect(r2.statusCode).toBe(400);
    });

    test('Spin rejects bet exceeding balance', async () => {
        const { token, userId } = await registerAndDeposit('spinflow4');
        const db = require('../../server/database');
        await db.run('UPDATE users SET balance = 0.50 WHERE id = ?', [userId]);
        const res = await request(app)
            .post('/api/spin')
            .set('Authorization', `Bearer ${token}`)
            .send({ gameId: 'sugar_rush', betAmount: 5 });
        expect([400, 402, 403]).toContain(res.statusCode);
    });

    test('Spin rejects without authentication', async () => {
        const res = await request(app).post('/api/spin').send({ gameId: 'sugar_rush', betAmount: 1 });
        expect(res.statusCode).toBe(401);
    });
});

describe('Spin Flow — Self-exclusion blocks spinning', () => {
    beforeEach(async () => {
        await resetTables('users', 'self_exclusions', 'spins');
    });

    test('Self-excluded user cannot spin', async () => {
        const { token, userId } = await registerAndDeposit('excluded');
        const db = require('../../server/database');
        await db.run(`CREATE TABLE IF NOT EXISTS self_exclusions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER, is_active INTEGER DEFAULT 1,
            ends_at TEXT, created_at TEXT DEFAULT (datetime('now'))
        )`).catch(() => {});
        await db.run('INSERT INTO self_exclusions (user_id, is_active, ends_at) VALUES (?, 1, ?)', [userId, new Date(Date.now() + 86400000).toISOString()]);

        const res = await request(app)
            .post('/api/spin')
            .set('Authorization', `Bearer ${token}`)
            .send({ gameId: 'sugar_rush', betAmount: 1 });
        expect(res.statusCode).toBe(403);
    });
});
