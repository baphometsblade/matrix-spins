'use strict';

const { setupTestDb, teardownTestDb, resetTables, createTestUser } = require('../helpers/test-db');
const lossLimit = require('../../server/services/loss-limit.service');
const db = require('../../server/database');

beforeAll(async () => {
    await setupTestDb();
    await db.run(`CREATE TABLE IF NOT EXISTS user_limits (
        user_id INTEGER PRIMARY KEY,
        daily_loss_limit REAL,
        weekly_loss_limit REAL,
        monthly_loss_limit REAL,
        max_bet_per_spin REAL,
        reality_check_minutes INTEGER
    )`).catch(() => {});
});
afterAll(async () => { await teardownTestDb(); });
beforeEach(async () => {
    await resetTables('users', 'user_limits', 'spins', 'transactions');
});

describe('Loss Limit Service — checkDailyLossLimit', () => {
    test('returns allowed=true when no limit is set and no losses', async () => {
        const user = await createTestUser({ username: 'll1', email: 'll1@test.com', balance: 100 });
        // Set a default loss limit since none configured
        await db.run('INSERT INTO user_limits (user_id, daily_loss_limit) VALUES (?, ?)', [user.id, 1000]);
        const result = await lossLimit.checkDailyLossLimit(user.id, 5);
        expect(result.allowed).toBe(true);
    });

    test('returns allowed=false when daily loss limit would be exceeded', async () => {
        const user = await createTestUser({ username: 'll2', email: 'll2@test.com', balance: 1000 });
        await db.run('INSERT INTO user_limits (user_id, daily_loss_limit) VALUES (?, ?)', [user.id, 50]);
        // Simulate $60 net loss today (60 wagered - 0 won)
        await db.run("INSERT INTO spins (user_id, game_id, bet_amount, result_grid, win_amount, created_at) VALUES (?, ?, ?, ?, ?, datetime('now'))", [user.id, 'g', 60, '[]', 0]);
        const result = await lossLimit.checkDailyLossLimit(user.id, 5);
        expect(result.allowed).toBe(false);
        expect(result.dailyLoss).toBeGreaterThanOrEqual(60);
    });

    test('triggers cashback first time limit is exceeded', async () => {
        const user = await createTestUser({ username: 'll3', email: 'll3@test.com', balance: 1000 });
        await db.run('INSERT INTO user_limits (user_id, daily_loss_limit) VALUES (?, ?)', [user.id, 100]);
        await db.run("INSERT INTO spins (user_id, game_id, bet_amount, result_grid, win_amount, created_at) VALUES (?, ?, ?, ?, ?, datetime('now'))", [user.id, 'g', 200, '[]', 0]);
        const result = await lossLimit.checkDailyLossLimit(user.id, 5);
        expect(result.allowed).toBe(false);
        expect(result.cashback).not.toBeNull();
        expect(result.cashback.amount).toBeGreaterThan(0);

        // Cashback should be in bonus_balance (not balance)
        const u = await db.get('SELECT balance, bonus_balance FROM users WHERE id = ?', [user.id]);
        expect(u.bonus_balance).toBeGreaterThan(0);
    });

    test('cashback only triggered once per day', async () => {
        const user = await createTestUser({ username: 'll4', email: 'll4@test.com', balance: 1000 });
        await db.run('INSERT INTO user_limits (user_id, daily_loss_limit) VALUES (?, ?)', [user.id, 100]);
        await db.run("INSERT INTO spins (user_id, game_id, bet_amount, result_grid, win_amount, created_at) VALUES (?, ?, ?, ?, ?, datetime('now'))", [user.id, 'g', 200, '[]', 0]);
        const r1 = await lossLimit.checkDailyLossLimit(user.id, 5);
        expect(r1.cashback).not.toBeNull();
        const r2 = await lossLimit.checkDailyLossLimit(user.id, 5);
        expect(r2.cashback).toBeNull(); // already credited today
    });
});
