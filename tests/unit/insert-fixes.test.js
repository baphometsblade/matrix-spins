'use strict';

/**
 * Integration proof for the INSERT-completeness / creator-drift fixes (2026-06-24).
 * Each previously-throwing statement is executed against a real (SQLite) DB built from the
 * production schema, proving the corrected column lists exist and satisfy NOT-NULL.
 */

const { setupTestDb, teardownTestDb, resetTables } = require('../helpers/test-db');

let db;
let userId;

beforeAll(async () => {
    await setupTestDb();
    db = require('../../server/database');
});
afterAll(async () => { await teardownTestDb(); });

beforeEach(async () => {
    await resetTables('users', 'transactions', 'loss_cashback_claims', 'campaigns',
        'battle_pass_progress', 'battle_pass_user_progress', 'battle_pass_seasons');
    const res = await db.run(
        "INSERT INTO users (username, email, password_hash, balance) VALUES (?, ?, ?, ?)",
        ['ins_user', 'ins@test.local', 'x', 100]
    );
    userId = res.lastInsertRowid;
});

test('loss_cashback_claims: /claim INSERT uses loss_amount (was nonexistent session_losses)', async () => {
    await db.run(
        'INSERT INTO loss_cashback_claims (user_id, tier, loss_amount, cashback_amount) VALUES (?, ?, ?, ?)',
        [userId, '25', 80.0, 20.0]
    );
    const row = await db.get('SELECT tier, loss_amount, cashback_amount FROM loss_cashback_claims WHERE user_id = ?', [userId]);
    expect(row).toBeTruthy();
    expect(Number(row.loss_amount)).toBeCloseTo(80, 2);
    expect(Number(row.cashback_amount)).toBeCloseTo(20, 2);
    // and the 24h re-claim guard query now finds the persisted row
    const guard = await db.get(
        "SELECT claimed_at FROM loss_cashback_claims WHERE user_id = ? AND tier = ? AND claimed_at >= datetime('now', '-24 hours')",
        [userId, '25']
    );
    expect(guard).toBeTruthy();
});

test('battle_pass_user_progress: route INSERT (pass_id, current_level) works on its own table', async () => {
    await db.run('INSERT INTO battle_pass_user_progress (user_id, pass_id, xp, current_level) VALUES (?, ?, 0, 1)', [userId, 7]);
    const row = await db.get('SELECT xp, current_level FROM battle_pass_user_progress WHERE user_id = ? AND pass_id = ?', [userId, 7]);
    expect(row).toBeTruthy();
    expect(Number(row.current_level)).toBe(1);
});

test('battle_pass_progress: service INSERT (user_id, season_id) still works (season-based table)', async () => {
    await db.run('INSERT INTO battle_pass_progress (user_id, season_id) VALUES (?, ?)', [userId, 3]);
    const row = await db.get('SELECT level, xp FROM battle_pass_progress WHERE user_id = ? AND season_id = ?', [userId, 3]);
    expect(row).toBeTruthy();
});

test('transactions: bundle/battlepass insert supplies NOT-NULL balance_before & balance_after', async () => {
    await db.run(
        "INSERT INTO transactions (user_id, type, amount, balance_before, balance_after, reference, created_at) " +
        "VALUES (?, 'bundle_purchase', ?, ?, ?, ?, datetime('now'))",
        [userId, 19.99, 100, 100, 'Bundle: Test']
    );
    const t = await db.get("SELECT amount, balance_before, balance_after FROM transactions WHERE user_id = ?", [userId]);
    expect(t).toBeTruthy();
    expect(Number(t.balance_before)).toBe(100);
    expect(Number(t.balance_after)).toBe(100);
});

test('campaigns: mystery promo insert supplies NOT-NULL start_at', async () => {
    await db.run(
        "INSERT INTO campaigns (name, type, bonus_pct, max_bonus, wagering_mult, min_deposit, start_at, end_at, promo_code) " +
        "VALUES (?, 'promo_code', 0, 0, 1, 0, datetime('now'), datetime('now', '+7 days'), ?)",
        ['Mystery Drop Promo', 'CODE123']
    );
    const c = await db.get("SELECT name, start_at, end_at, promo_code FROM campaigns WHERE promo_code = ?", ['CODE123']);
    expect(c).toBeTruthy();
    expect(c.start_at).toBeTruthy();
    expect(c.end_at).toBeTruthy();
});
