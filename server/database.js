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
let _degradedMode = false; // true when PG was requested but SQLite is active
let _pgReconnectTimer = null;
let _lastPgError = null;

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
            _degradedMode = false;
            return backend;
        } catch (err) {
            if (attempt < 3) {
                console.warn(`[DB] Init attempt ${attempt}/3 failed: ${err.message} — retrying in ${attempt * 5}s…`);
                await new Promise(r => setTimeout(r, attempt * 5000));
            } else if (config.DATABASE_URL) {
                // ═══════════════════════════════════════════════════════════════
                // DEGRADED MODE: PG unreachable → fall back to SQLite so the
                // deploy succeeds and health check passes, but ALL payment and
                // balance routes are blocked (see isDegraded() checks in routes).
                // This prevents the catastrophic scenario of operating a real-money
                // casino on an ephemeral SQLite database.
                // ═══════════════════════════════════════════════════════════════
                console.error('╔══════════════════════════════════════════════════════════════╗');
                console.error('║  ⚠ DEGRADED MODE — PostgreSQL unreachable after 3 attempts  ║');
                console.error('║  Falling back to SQLite. Money operations BLOCKED.           ║');
                console.error('║  Fix DATABASE_URL or provision PostgreSQL to go live.        ║');
                console.error('╚══════════════════════════════════════════════════════════════╝');
                console.error(`[DB] PG error: ${err.message}`);
                _lastPgError = err.message;
                // Fall back to SQLite so the server can start
                const SqliteBackend = require('./db/sqlite-backend');
                backend = new SqliteBackend(config.DB_PATH);
                await backend.init();
                _degradedMode = true;
                // Start background reconnection loop
                _startPgReconnectLoop();
                return backend;
            } else {
                throw err;
            }
        }
    }
}

/**
 * Returns true when DATABASE_URL was set but PG was unreachable,
 * so the server fell back to SQLite. All money routes should return 503.
 */
function isDegraded() {
    return _degradedMode;
}

/**
 * Returns the last PostgreSQL connection error message (for diagnostics).
 */
function lastPgError() {
    return _lastPgError;
}

/**
 * Periodically attempt to reconnect to PostgreSQL when in degraded mode.
 * On success, swaps the backend from SQLite → PG and clears degraded flag.
 * Checks every 5 minutes to avoid spamming a down database.
 */
function _startPgReconnectLoop() {
    if (_pgReconnectTimer) return; // already running
    var RECONNECT_INTERVAL = 5 * 60 * 1000; // 5 minutes

    _pgReconnectTimer = setInterval(async function () {
        if (!_degradedMode || !config.DATABASE_URL) {
            clearInterval(_pgReconnectTimer);
            _pgReconnectTimer = null;
            return;
        }
        console.warn('[DB] Attempting PostgreSQL reconnection…');
        try {
            var PgBackend = require('./db/pg-backend');
            var candidate = new PgBackend(config.DATABASE_URL);
            await candidate.init();
            // Success — swap backend
            var oldBackend = backend;
            backend = candidate;
            _degradedMode = false;
            _lastPgError = null;
            clearInterval(_pgReconnectTimer);
            _pgReconnectTimer = null;
            console.warn('╔══════════════════════════════════════════════════════════════╗');
            console.warn('║  ✓ PostgreSQL RECONNECTED — exiting degraded mode           ║');
            console.warn('║  Money operations are now ENABLED.                          ║');
            console.warn('╚══════════════════════════════════════════════════════════════╝');
            // Close old SQLite backend gracefully
            if (oldBackend && typeof oldBackend.close === 'function') {
                try { await oldBackend.close(); } catch (_) {}
            }
        } catch (err) {
            _lastPgError = err.message;
            console.warn('[DB] PG reconnect failed: ' + err.message);
        }
    }, RECONNECT_INTERVAL);

    // Don't keep the process alive just for reconnection attempts
    if (_pgReconnectTimer.unref) _pgReconnectTimer.unref();
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
    isDegraded,
    lastPgError,
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
