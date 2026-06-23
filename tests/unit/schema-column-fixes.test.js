'use strict';

/**
 * Integration proof for the schema⇄DML column fixes (2026-06-23 audit).
 *
 * Each previously-broken statement is executed against a real (SQLite) DB built from the
 * production schema, proving the referenced columns now exist and the corrected DML runs.
 * Covers: user_limits.daily_wager_limit, users.{bonus_wheel_spins,cashback_boost_until,
 * vip_boost_until}, deposits payment_type insert, transactions referral insert,
 * birthday free_spins_count grant, and the rg_admin_audit creator alignment.
 */

const { setupTestDb, teardownTestDb, resetTables } = require('../helpers/test-db');

let db;
let userId;

beforeAll(async () => {
    await setupTestDb();
    db = require('../../server/database');
});

afterAll(async () => {
    await teardownTestDb();
});

beforeEach(async () => {
    await resetTables('users', 'transactions', 'deposits', 'user_limits');
    const res = await db.run(
        "INSERT INTO users (username, email, password_hash, balance) VALUES (?, ?, ?, ?)",
        ['colfix_user', 'colfix@test.local', 'x', 100]
    );
    userId = res.lastInsertRowid;
});

async function columns(table) {
    const rows = await db.all(`PRAGMA table_info(${table})`);
    return rows.map(r => r.name);
}

describe('declared columns exist on the (sqlite) schema', () => {
    test('user_limits has daily_wager_limit', async () => {
        expect(await columns('user_limits')).toContain('daily_wager_limit');
    });

    test('users has the gamification reward columns', async () => {
        const cols = await columns('users');
        expect(cols).toEqual(expect.arrayContaining(['bonus_wheel_spins', 'cashback_boost_until', 'vip_boost_until']));
    });

    test('rg_admin_audit creator declares admin_user_id + payload (not stale admin_id)', async () => {
        const cols = await columns('rg_admin_audit');
        expect(cols).toEqual(expect.arrayContaining(['admin_user_id', 'payload']));
        expect(cols).not.toContain('admin_id');
    });
});

describe('the corrected DML executes without error and persists', () => {
    test('streak / mystery: bonus_wheel_spins grant', async () => {
        await db.run('UPDATE users SET bonus_wheel_spins = COALESCE(bonus_wheel_spins, 0) + ? WHERE id = ?', [3, userId]);
        const u = await db.get('SELECT bonus_wheel_spins FROM users WHERE id = ?', [userId]);
        expect(Number(u.bonus_wheel_spins)).toBe(3);
    });

    test('loyalty-store: cashback/vip boost expiries', async () => {
        await db.run("UPDATE users SET cashback_boost_until = datetime('now', '+24 hours'), cashback_multiplier = ? WHERE id = ?", [2, userId]);
        await db.run("UPDATE users SET vip_boost_until = datetime('now', '+24 hours') WHERE id = ?", [userId]);
        const u = await db.get('SELECT cashback_boost_until, vip_boost_until FROM users WHERE id = ?', [userId]);
        expect(u.cashback_boost_until).toBeTruthy();
        expect(u.vip_boost_until).toBeTruthy();
    });

    test('session: daily_wager_limit set + clear', async () => {
        await db.run('INSERT OR IGNORE INTO user_limits (user_id) VALUES (?)', [userId]);
        await db.run("UPDATE user_limits SET daily_wager_limit = ?, updated_at = datetime('now') WHERE user_id = ?", [50, userId]);
        let row = await db.get('SELECT daily_wager_limit FROM user_limits WHERE user_id = ?', [userId]);
        expect(Number(row.daily_wager_limit)).toBe(50);
        await db.run("UPDATE user_limits SET daily_wager_limit = NULL, updated_at = datetime('now') WHERE user_id = ?", [userId]);
        row = await db.get('SELECT daily_wager_limit FROM user_limits WHERE user_id = ?', [userId]);
        expect(row.daily_wager_limit == null).toBe(true);
    });

    test('birthday: free_spins_count grant (was the bogus free_spins column)', async () => {
        await db.run(
            "UPDATE users SET free_spins_count = COALESCE(free_spins_count, 0) + ?, free_spins_expires = datetime('now', '+30 days') WHERE id = ?",
            [10, userId]
        );
        const u = await db.get('SELECT free_spins_count, free_spins_expires FROM users WHERE id = ?', [userId]);
        expect(Number(u.free_spins_count)).toBe(10);
        expect(u.free_spins_expires).toBeTruthy();
    });

    test('bundle: deposits insert uses payment_type (NOT NULL) not method', async () => {
        await db.run(
            "INSERT INTO deposits (user_id, amount, payment_type, status, created_at) VALUES (?, ?, 'bundle', 'completed', datetime('now'))",
            [userId, 19.99]
        );
        const d = await db.get('SELECT amount, payment_type, status FROM deposits WHERE user_id = ?', [userId]);
        expect(d).toBeTruthy();
        expect(d.payment_type).toBe('bundle');
        expect(Number(d.amount)).toBeCloseTo(19.99, 2);
    });

    test('referral bonus: transactions insert with balance_before/after + reference', async () => {
        await db.run(
            "INSERT INTO transactions (user_id, type, amount, balance_before, balance_after, reference) " +
            "VALUES (?, 'bonus', ?, COALESCE((SELECT balance FROM users WHERE id = ?), 0), COALESCE((SELECT balance FROM users WHERE id = ?), 0), ?)",
            [userId, 5, userId, userId, 'Referral bonus -- test']
        );
        const t = await db.get("SELECT type, amount, balance_after, reference FROM transactions WHERE user_id = ? AND type = 'bonus'", [userId]);
        expect(t).toBeTruthy();
        expect(Number(t.amount)).toBe(5);
        expect(Number(t.balance_after)).toBe(100);
        expect(t.reference).toMatch(/Referral bonus/);
    });

    test('GDPR: account anonymization UPDATE scrubs PII and runs clean', async () => {
        // Mirrors anonymizeUser() in account-deletion-scheduler.js — must reference only
        // columns that exist on users (both backends): status (not is_active), self_excluded,
        // and NO address / self_exclusion_until.
        await db.run(
            `UPDATE users SET
                username = ?, email = ?, password_hash = 'ACCOUNT_DELETED',
                display_name = 'Deleted User', avatar_url = NULL, phone = NULL,
                date_of_birth = NULL, balance = 0, bonus_balance = 0,
                wagering_requirement = 0, status = 'deleted', self_excluded = 1
            WHERE id = ?`,
            [`deleted_user_${userId}`, `deleted_${userId}@anonymized.invalid`, userId]
        );
        const u = await db.get('SELECT email, password_hash, status, self_excluded, balance FROM users WHERE id = ?', [userId]);
        expect(u.email).toBe(`deleted_${userId}@anonymized.invalid`);
        expect(u.password_hash).toBe('ACCOUNT_DELETED');
        expect(u.status).toBe('deleted');
        expect(Number(u.self_excluded)).toBe(1);
        expect(Number(u.balance)).toBe(0);
    });

    test('admin-rg: rg_admin_audit insert with admin_user_id + payload', async () => {
        await db.run(
            'INSERT INTO rg_admin_audit (admin_user_id, target_user_id, action, payload, reason) VALUES (?, ?, ?, ?, ?)',
            [1, userId, 'set_limit', JSON.stringify({ daily: 50 }), 'test']
        );
        const a = await db.get('SELECT admin_user_id, payload FROM rg_admin_audit WHERE target_user_id = ?', [userId]);
        expect(a).toBeTruthy();
        expect(Number(a.admin_user_id)).toBe(1);
        expect(a.payload).toMatch(/daily/);
    });
});
