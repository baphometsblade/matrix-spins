'use strict';

const { setupTestDb, teardownTestDb, resetTables, createTestUser } = require('../helpers/test-db');
const tournament = require('../../server/services/tournament.service');
const db = require('../../server/database');

beforeAll(async () => {
    await setupTestDb();
    // Tournament tables (best-effort — schema may already declare them)
    await db.run(`CREATE TABLE IF NOT EXISTS tournaments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT, description TEXT, type TEXT,
        entry_fee REAL DEFAULT 0, prize_pool REAL DEFAULT 0,
        start_date TEXT, end_date TEXT, status TEXT
    )`).catch(() => {});
    await db.run(`CREATE TABLE IF NOT EXISTS tournament_entries (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        tournament_id INTEGER, user_id INTEGER,
        score REAL DEFAULT 0, spins_played INTEGER DEFAULT 0,
        biggest_win REAL DEFAULT 0,
        entry_time TEXT, last_spin_time TEXT
    )`).catch(() => {});
});
afterAll(async () => { await teardownTestDb(); });
beforeEach(async () => {
    await resetTables('users', 'tournaments', 'tournament_entries', 'transactions', 'notifications');
});

describe('Tournament Service — Definitions', () => {
    test('TOURNAMENT_TYPES has 4 types', () => {
        const keys = Object.keys(tournament.TOURNAMENT_TYPES);
        expect(keys).toEqual(expect.arrayContaining(['daily_free', 'daily_hi', 'weekly_free', 'weekly_hi']));
    });

    test('PRIZE_SPLIT sums to 1.0', () => {
        const sum = tournament.PRIZE_SPLIT.reduce((a, b) => a + b, 0);
        expect(Math.abs(sum - 1.0) < 0.001).toBe(true);
    });
});

describe('Tournament Service — ensureActive()', () => {
    test('creates one active tournament per type if none exist', async () => {
        await tournament.ensureActive();
        const rows = await db.all("SELECT type FROM tournaments WHERE status = 'active'");
        expect(rows.length).toBe(4);
    });

    test('idempotent: running twice does not duplicate', async () => {
        await tournament.ensureActive();
        await tournament.ensureActive();
        const rows = await db.all("SELECT type FROM tournaments WHERE status = 'active'");
        expect(rows.length).toBe(4);
    });
});

describe('Tournament Service — enter()', () => {
    test('user can enter a free tournament', async () => {
        await tournament.ensureActive();
        const user = await createTestUser({ username: 't1', email: 't1@test.com', balance: 100 });
        const t = await db.get("SELECT id FROM tournaments WHERE type = 'daily_free' AND status = 'active'");
        const result = await tournament.enter(t.id, user.id);
        expect(result.ok).toBe(true);
    });

    test('cannot enter the same tournament twice', async () => {
        await tournament.ensureActive();
        const user = await createTestUser({ username: 't2', email: 't2@test.com', balance: 100 });
        const t = await db.get("SELECT id FROM tournaments WHERE type = 'daily_free' AND status = 'active'");
        await tournament.enter(t.id, user.id);
        const result = await tournament.enter(t.id, user.id);
        expect(result.ok).toBe(false);
        expect(result.error).toMatch(/Already entered/i);
    });

    test('paid tournament rejects insufficient balance', async () => {
        await tournament.ensureActive();
        const user = await createTestUser({ username: 't3', email: 't3@test.com', balance: 1 });
        const t = await db.get("SELECT id FROM tournaments WHERE type = 'daily_hi' AND status = 'active'");
        const result = await tournament.enter(t.id, user.id);
        expect(result.ok).toBe(false);
        expect(result.error).toMatch(/Insufficient/i);
    });

    test('paid tournament deducts entry fee atomically', async () => {
        await tournament.ensureActive();
        const user = await createTestUser({ username: 't4', email: 't4@test.com', balance: 100 });
        const t = await db.get("SELECT id, entry_fee FROM tournaments WHERE type = 'daily_hi' AND status = 'active'");
        const result = await tournament.enter(t.id, user.id);
        expect(result.ok).toBe(true);
        const after = await db.get('SELECT balance FROM users WHERE id = ?', [user.id]);
        expect(after.balance).toBe(100 - t.entry_fee);
    });
});

describe('Tournament Service — submitSpin()', () => {
    test('total_wins scoring accumulates winnings', async () => {
        await tournament.ensureActive();
        const user = await createTestUser({ username: 't5', email: 't5@test.com', balance: 100 });
        const t = await db.get("SELECT id FROM tournaments WHERE type = 'daily_free' AND status = 'active'");
        await tournament.enter(t.id, user.id);
        await tournament.submitSpin(user.id, 5, 1);
        await tournament.submitSpin(user.id, 10, 1);
        const entry = await db.get('SELECT score, spins_played FROM tournament_entries WHERE tournament_id = ? AND user_id = ?', [t.id, user.id]);
        expect(entry.score).toBe(15);
        expect(entry.spins_played).toBe(2);
    });

    test('best_multiplier scoring keeps the highest multiplier', async () => {
        await tournament.ensureActive();
        const user = await createTestUser({ username: 't6', email: 't6@test.com', balance: 100 });
        const t = await db.get("SELECT id FROM tournaments WHERE type = 'daily_hi' AND status = 'active'");
        await tournament.enter(t.id, user.id);
        await tournament.submitSpin(user.id, 5, 1);   // 5x
        await tournament.submitSpin(user.id, 100, 1); // 100x — new best
        await tournament.submitSpin(user.id, 10, 1);  // 10x — should not overwrite
        const entry = await db.get('SELECT score FROM tournament_entries WHERE tournament_id = ? AND user_id = ?', [t.id, user.id]);
        expect(entry.score).toBe(100);
    });
});

describe('Tournament Service — Leaderboard', () => {
    test('leaderboard returns sorted by score desc with ranks', async () => {
        await tournament.ensureActive();
        const t = await db.get("SELECT id FROM tournaments WHERE type = 'daily_free' AND status = 'active'");
        const u1 = await createTestUser({ username: 'lb1', email: 'lb1@test.com' });
        const u2 = await createTestUser({ username: 'lb2', email: 'lb2@test.com' });
        const u3 = await createTestUser({ username: 'lb3', email: 'lb3@test.com' });
        await tournament.enter(t.id, u1.id);
        await tournament.enter(t.id, u2.id);
        await tournament.enter(t.id, u3.id);
        await tournament.submitSpin(u1.id, 10, 1);
        await tournament.submitSpin(u2.id, 50, 1);
        await tournament.submitSpin(u3.id, 25, 1);
        const board = await tournament.getLeaderboard(t.id, 10);
        expect(board.length).toBe(3);
        expect(board[0].rank).toBe(1);
        expect(board[0].score).toBe(50);
        expect(board[1].score).toBe(25);
        expect(board[2].score).toBe(10);
    });
});
