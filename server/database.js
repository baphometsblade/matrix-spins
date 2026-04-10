/**
 * Unified Database Facade
 *
 * Selects backend at startup:
 *   DATABASE_URL set → PostgreSQL (pg Pool)
 *   DATABASE_URL absent → SQLite (sql.js, file-based)
 *
 * Exports the same async API regardless of backend:
 *   run(sql, params)   → { changes, lastInsertRowid }
 *   get(sql, params)   → row | null
 *   all(sql, params)   → [rows]
 *   saveToFile()       → no-op for PostgreSQL
 *   initDatabase()     → must be awaited before any queries
 */

'use strict';

const config = require('./config');

let backend = null;

async function initDatabase() {
    if (config.DATABASE_URL) {
        const PgBackend = require('./db/pg-backend');
        backend = new PgBackend(config.DATABASE_URL);
        console.warn('[DB] Using PostgreSQL backend');
    } else {
        const SqliteBackend = require('./db/sqlite-backend');
        backend = new SqliteBackend(config.DB_PATH);
        console.warn('[DB] Using SQLite backend');
    }
    // Retry init up to 3 times — Render free-tier PG may need time to wake up
    for (let attempt = 1; attempt <= 3; attempt++) {
        try {
            await backend.init();
            return backend;
        } catch (err) {
            if (attempt < 3) {
                console.warn(`[DB] Init attempt ${attempt}/3 failed: ${err.message} — retrying in ${attempt * 5}s…`);
                await new Promise(r => setTimeout(r, attempt * 5000));
            } else if (config.DATABASE_URL) {
                // PRODUCTION SAFETY: When DATABASE_URL is set, we MUST use PostgreSQL.
                // Silently falling back to an empty SQLite DB is catastrophic for a real-money
                // casino — users would see zero balance, deposits would vanish, and new signups
                // would get a fresh empty database. Crash loudly so Render restarts the service.
                console.error(`[DB] FATAL: PostgreSQL unreachable after 3 attempts: ${err.message}`);
                console.error('[DB] DATABASE_URL is set — refusing to fall back to SQLite.');
                console.error('[DB] Fix your PostgreSQL connection or remove DATABASE_URL to use SQLite intentionally.');
                throw new Error(`PostgreSQL unreachable: ${err.message}. Cannot fall back to SQLite when DATABASE_URL is set.`);
            } else {
                throw err;
            }
        }
    }
}

function getBackend() {
    if (!backend) throw new Error('Database not initialized. Call initDatabase() first.');
    return backend;
}

/**
 * Returns true only if the active backend is PostgreSQL.
 * Safe to call after initDatabase() — reflects the actual backend even if
 * PostgreSQL was unreachable and we fell back to SQLite.
 */
function isPg() {
    if (!backend) return !!process.env.DATABASE_URL; // pre-init best guess
    return backend.constructor.name === 'PgBackend';
}

async function run(sql, params) {
    return getBackend().run(sql, params);
}

async function get(sql, params) {
    return getBackend().get(sql, params);
}

async function all(sql, params) {
    return getBackend().all(sql, params);
}

function saveToFile() {
    if (backend) backend.saveToFile();
}

// ── Transaction support ──
// All financial operations (deposits, withdrawals, bonuses, prizes, etc.)
// depend on these being correctly delegated to the active backend.
// Without these exports, db.beginTransaction() throws TypeError and
// the catch blocks in routes silently swallow the failure.

async function beginTransaction() {
    return getBackend().beginTransaction();
}

async function commit() {
    return getBackend().commit();
}

async function rollback() {
    return getBackend().rollback();
}

module.exports = {
    initDatabase,
    getBackend,
    isPg,
    // Keep legacy alias for any code that calls getDb()
    getDb: getBackend,
    run,
    get,
    all,
    saveToFile,
    beginTransaction,
    commit,
    rollback,
};
