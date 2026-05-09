/**
 * Test database helper.
 *
 * Provides a fresh in-memory SQLite backend for each test suite, so unit
 * tests can exercise services that depend on the unified `db` facade
 * without polluting the main `casino.db` file or each other.
 */

'use strict';

const path = require('path');
const fs = require('fs');
const os = require('os');

// Prevent the production server's secure-rng patch from logging during tests
process.env.NODE_ENV = process.env.NODE_ENV || 'test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-do-not-use-in-prod-just-for-testing-12345';
process.env.ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'test-admin-password-only-for-tests-12345';

let _initialized = false;
let _testDbPath = null;

/**
 * Init a fresh SQLite test DB. Each call creates a new temp file.
 * The test DB lives in os.tmpdir() and is removed in cleanup().
 */
async function setupTestDb() {
    if (_initialized) return;

    _testDbPath = path.join(os.tmpdir(), `casino-test-${process.pid}-${Date.now()}.db`);
    if (fs.existsSync(_testDbPath)) fs.unlinkSync(_testDbPath);

    // Force the database module to use our test DB path BEFORE any service
    // that calls `require('../database')` runs.
    const config = require('../../server/config');
    config.DB_PATH = _testDbPath;
    config.DATABASE_URL = null; // ensure SQLite path

    const { initDatabase } = require('../../server/database');
    await initDatabase();

    // Ensure tables that are normally created lazily by routes also exist —
    // tests don't load every route, so we backfill the most-needed ones.
    const db = require('../../server/database');
    const lazyTables = [
        `CREATE TABLE IF NOT EXISTS self_exclusions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            is_active INTEGER DEFAULT 1,
            ends_at TEXT,
            created_at TEXT DEFAULT (datetime('now'))
        )`,
        `CREATE TABLE IF NOT EXISTS user_limits (
            user_id INTEGER PRIMARY KEY,
            daily_loss_limit REAL,
            weekly_loss_limit REAL,
            monthly_loss_limit REAL,
            max_bet_per_spin REAL,
            reality_check_minutes INTEGER
        )`,
        `CREATE TABLE IF NOT EXISTS deposit_limits (
            user_id INTEGER PRIMARY KEY,
            daily_limit REAL, weekly_limit REAL, monthly_limit REAL,
            pending_daily_limit REAL, pending_daily_effective_at TEXT,
            pending_weekly_limit REAL, pending_weekly_effective_at TEXT,
            pending_monthly_limit REAL, pending_monthly_effective_at TEXT,
            updated_at TEXT
        )`,
        `CREATE TABLE IF NOT EXISTS user_achievements (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER, achievement_id TEXT,
            unlocked_at TEXT DEFAULT (datetime('now')),
            UNIQUE(user_id, achievement_id)
        )`,
        `CREATE TABLE IF NOT EXISTS notifications (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            type TEXT NOT NULL,
            title TEXT NOT NULL,
            body TEXT NOT NULL,
            link_action TEXT,
            read INTEGER DEFAULT 0,
            created_at TEXT DEFAULT (datetime('now'))
        )`,
        `CREATE TABLE IF NOT EXISTS tournaments (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT, description TEXT, type TEXT,
            entry_fee REAL DEFAULT 0, prize_pool REAL DEFAULT 0,
            start_date TEXT, end_date TEXT, status TEXT
        )`,
        `CREATE TABLE IF NOT EXISTS tournament_entries (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            tournament_id INTEGER, user_id INTEGER,
            score REAL DEFAULT 0, spins_played INTEGER DEFAULT 0,
            biggest_win REAL DEFAULT 0,
            entry_time TEXT, last_spin_time TEXT
        )`,
        `CREATE TABLE IF NOT EXISTS jackpot_pool (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            tier TEXT UNIQUE, current_amount REAL DEFAULT 0,
            seed_amount REAL DEFAULT 0, contribution_rate REAL DEFAULT 0,
            total_contributed REAL DEFAULT 0, total_paid_out REAL DEFAULT 0,
            last_won_at TEXT, last_winner_id INTEGER
        )`,
        `CREATE TABLE IF NOT EXISTS referral_claims (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            referrer_id INTEGER NOT NULL,
            referred_id INTEGER NOT NULL,
            bonus_given REAL,
            created_at TEXT DEFAULT (datetime('now'))
        )`,
        `CREATE TABLE IF NOT EXISTS deposits (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER, amount REAL, status TEXT,
            completed_at TEXT,
            created_at TEXT DEFAULT (datetime('now'))
        )`,
        `CREATE TABLE IF NOT EXISTS withdrawals (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER, amount REAL, status TEXT,
            created_at TEXT DEFAULT (datetime('now'))
        )`,
        `CREATE TABLE IF NOT EXISTS admin_audit_log (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            admin_id INTEGER, action TEXT, target_user_id INTEGER,
            details TEXT, created_at TEXT
        )`,
        `CREATE TABLE IF NOT EXISTS email_verification_tokens (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER, token TEXT, expires_at TEXT,
            created_at TEXT DEFAULT (datetime('now'))
        )`,
    ];
    for (const ddl of lazyTables) {
        try { await db.run(ddl); } catch (_) {}
    }

    _initialized = true;
    return _testDbPath;
}

/**
 * Clean up the test DB. Call from afterAll().
 */
async function teardownTestDb() {
    try {
        const { getBackend } = require('../../server/database');
        const backend = getBackend();
        if (backend && typeof backend.close === 'function') await backend.close();
    } catch (_) {}

    if (_testDbPath && fs.existsSync(_testDbPath)) {
        try { fs.unlinkSync(_testDbPath); } catch (_) {}
    }
    _initialized = false;
    _testDbPath = null;
}

/**
 * Truncate the most-used tables between tests so each test starts clean.
 * Call from beforeEach() in test files that mutate state.
 */
async function resetTables(...tables) {
    const db = require('../../server/database');
    const all = tables.length > 0 ? tables : [
        'users', 'transactions', 'spins', 'game_stats', 'session_win_caps',
        'notifications', 'user_achievements',
        'tournaments', 'tournament_entries',
        'jackpot_pool',
        'referral_commissions', 'referral_claims',
        'self_exclusions', 'deposits', 'withdrawals',
        'user_limits', 'deposit_limits',
    ];
    for (const t of all) {
        try { await db.run(`DELETE FROM ${t}`); } catch (_) {}
    }
}

/**
 * Convenience: create a test user with a known username and balance.
 */
async function createTestUser({ username = 'tester', email = 'test@example.com', balance = 100, bonusBalance = 0, wageringRequirement = 0 } = {}) {
    const bcrypt = require('bcryptjs');
    const db = require('../../server/database');
    const hash = bcrypt.hashSync('TestPass1!', 4); // low cost — tests
    const result = await db.run(
        'INSERT INTO users (username, email, password_hash, balance, bonus_balance, wagering_requirement, referral_code, email_verified) VALUES (?, ?, ?, ?, ?, ?, ?, 1)',
        [username, email, hash, balance, bonusBalance, wageringRequirement, 'TEST' + Date.now().toString(36).toUpperCase().slice(-4)]
    );
    const id = result.lastInsertRowid;
    return { id, username, email, password: 'TestPass1!', balance };
}

module.exports = {
    setupTestDb,
    teardownTestDb,
    resetTables,
    createTestUser,
};
