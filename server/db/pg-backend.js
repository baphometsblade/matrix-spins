/**
 * PostgreSQL backend — uses node-postgres (pg) Pool.
 *
 * Activated when DATABASE_URL is present in the environment.
 * SQL coming from route files is written in SQLite dialect;
 * the query-adapter translates it to PostgreSQL before execution.
 */

'use strict';

const pg = require('pg');
const { Pool } = pg;
const { adaptSQL } = require('./query-adapter');
const { AsyncLocalStorage } = require('async_hooks');

// Per-request transaction scoping — prevents concurrent requests from
// sharing a single _txClient (was a critical concurrency bug)
const _txStore = new AsyncLocalStorage();

// ── pg type parsers ──────────────────────────────────────────────
// PostgreSQL NUMERIC columns (OID 1700) are returned as strings by
// default because JS floats can't represent all NUMERIC values exactly.
// Our money columns are NUMERIC(15,2) — parseFloat is safe and avoids
// "5000.00" + 100 → "5000.00100" string-concatenation bugs.
pg.types.setTypeParser(1700, parseFloat);                 // NUMERIC → number

// TIMESTAMPTZ (OID 1184) is returned as a JS Date object by default.
// Our code expects ISO-8601 strings (same as SQLite's text format).
pg.types.setTypeParser(1184, function (val) { return val; }); // TIMESTAMPTZ → string

// BIGINT (OID 20) — COUNT(*) returns bigint in PostgreSQL.
pg.types.setTypeParser(20, function (val) { return parseInt(val, 10); });

class PgBackend {
    constructor(connectionString) {
        // SSL: Render/Railway's managed Postgres uses self-signed internal
        // certs and requires `rejectUnauthorized: false`. For providers with
        // a proper CA chain (AWS RDS, Supabase, self-hosted with Let's
        // Encrypt), set PGSSL_CA to the CA certificate string and we will
        // enable strict validation with that anchor.
        var sslSetting = false;
        if (process.env.NODE_ENV === 'production' || process.env.DATABASE_URL) {
            if (process.env.PGSSL_CA) {
                sslSetting = { rejectUnauthorized: true, ca: process.env.PGSSL_CA };
            } else if (process.env.PGSSL_STRICT === 'true') {
                sslSetting = { rejectUnauthorized: true };
            } else {
                // Fallback compatible with Render / Railway.
                sslSetting = { rejectUnauthorized: false };
            }
        }

        // Pool sizing: env-tunable for vertical scaling. Defaults sized for
        // a 4 vCPU / 2GB Render Standard instance. Each pg connection costs
        // ~10MB on the PG server, so cap conservatively unless DB is dedicated.
        this.pool = new Pool({
            connectionString: connectionString,
            max: parseInt(process.env.PG_POOL_MAX, 10) || 20,
            min: parseInt(process.env.PG_POOL_MIN, 10) || 2,
            idleTimeoutMillis: parseInt(process.env.PG_IDLE_TIMEOUT_MS, 10) || 30000,
            connectionTimeoutMillis: parseInt(process.env.PG_CONNECT_TIMEOUT_MS, 10) || 15000,
            statement_timeout: parseInt(process.env.PG_STATEMENT_TIMEOUT_MS, 10) || 15000,
            query_timeout: parseInt(process.env.PG_QUERY_TIMEOUT_MS, 10) || 15000,
            keepAlive: true,
            ssl: sslSetting,
        });

        // Surface pool errors so they don't crash the process silently
        this.pool.on('error', function (err) {
            console.warn('[DB/PG] Idle client error:', err.message);
        });
    }

    async init() {
        // Verify connectivity
        const client = await this.pool.connect();
        client.release();
        console.warn('[DB/PG] Connected to PostgreSQL');

        // Schema
        const schema = require('./schema-pg');

        for (const ddl of schema.TABLES) {
            await this.pool.query(ddl);
        }

        // Column migrations (validate names/types to prevent SQL injection)
        const SAFE_COL_NAME = /^[a-z_][a-z0-9_]{0,63}$/;
        const SAFE_COL_DEF = /^[A-Z0-9_ (),']+$/i;
        const colResult = await this.pool.query(
            "SELECT column_name FROM information_schema.columns WHERE table_name = 'users'"
        );
        const colNames = colResult.rows.map(function (r) { return r.column_name; });
        for (const [name, def] of schema.USER_MIGRATIONS) {
            if (!SAFE_COL_NAME.test(name) || !SAFE_COL_DEF.test(def)) {
                console.error(`[DB/PG] Skipping unsafe migration: ${name} ${def}`);
                continue;
            }
            if (!colNames.includes(name)) {
                await this.pool.query(`ALTER TABLE users ADD COLUMN ${name} ${def}`);
            }
        }

        // Withdrawals table column migrations
        if (schema.WITHDRAWAL_MIGRATIONS) {
            const wdResult = await this.pool.query(
                "SELECT column_name FROM information_schema.columns WHERE table_name = 'withdrawals'"
            );
            const wdColNames = wdResult.rows.map(r => r.column_name);
            for (const [name, def] of schema.WITHDRAWAL_MIGRATIONS) {
                if (!SAFE_COL_NAME.test(name) || !SAFE_COL_DEF.test(def)) {
                    console.error(`[DB/PG] Skipping unsafe migration: ${name} ${def}`);
                    continue;
                }
                if (!wdColNames.includes(name)) {
                    await this.pool.query(`ALTER TABLE withdrawals ADD COLUMN ${name} ${def}`);
                }
            }
        }

        // Transactions table column migrations
        if (schema.TRANSACTION_MIGRATIONS) {
            const txResult = await this.pool.query(
                "SELECT column_name FROM information_schema.columns WHERE table_name = 'transactions'"
            );
            const txColNames = txResult.rows.map(r => r.column_name);
            for (const [name, def] of schema.TRANSACTION_MIGRATIONS) {
                if (!SAFE_COL_NAME.test(name) || !SAFE_COL_DEF.test(def)) {
                    console.error('[DB/PG] Skipping unsafe tx migration:', name, def);
                    continue;
                }
                if (!txColNames.includes(name)) {
                    await this.pool.query(`ALTER TABLE transactions ADD COLUMN ${name} ${def}`);
                }
            }
        }

        // Spins table column migrations
        if (schema.SPIN_MIGRATIONS) {
            const spResult = await this.pool.query(
                "SELECT column_name FROM information_schema.columns WHERE table_name = 'spins'"
            );
            const spColNames = spResult.rows.map(r => r.column_name);
            for (const [name, def] of schema.SPIN_MIGRATIONS) {
                if (!SAFE_COL_NAME.test(name) || !SAFE_COL_DEF.test(def)) {
                    console.error('[DB/PG] Skipping unsafe spin migration:', name, def);
                    continue;
                }
                if (!spColNames.includes(name)) {
                    await this.pool.query(`ALTER TABLE spins ADD COLUMN ${name} ${def}`);
                }
            }
        }

        // audit_log table column migrations — amount/reference were added after the
        // table shipped, so existing DBs lack them and the audit helper's INSERT fails
        // with: column "amount" of relation "audit_log" does not exist. Wrapped in
        // try/catch so a failed ALTER can NEVER abort init() and trip degraded mode
        // (an audit-trail column add must never block money ops — same rule as INDEXES).
        if (schema.AUDIT_LOG_MIGRATIONS) {
            try {
                const alResult = await this.pool.query(
                    "SELECT column_name FROM information_schema.columns WHERE table_name = 'audit_log'"
                );
                const alColNames = alResult.rows.map(r => r.column_name);
                for (const [name, def] of schema.AUDIT_LOG_MIGRATIONS) {
                    if (!SAFE_COL_NAME.test(name) || !SAFE_COL_DEF.test(def)) {
                        console.error('[DB/PG] Skipping unsafe audit_log migration:', name, def);
                        continue;
                    }
                    if (!alColNames.includes(name)) {
                        await this.pool.query(`ALTER TABLE audit_log ADD COLUMN ${name} ${def}`);
                    }
                }
            } catch (err) {
                console.warn('[DB/PG] audit_log migration skipped (non-fatal):', err.message);
            }
        }

        // Indexes — per-index try/catch. An index is a PERFORMANCE optimization;
        // a single failing CREATE INDEX must NEVER abort init() and trip degraded
        // mode on a real-money casino. Some indexes target tables that are created
        // lazily by route bootstraps (self_exclusions, notifications, audit_log…) —
        // those tables are now also defined in schema.TABLES above so these succeed,
        // but the guard is kept as defense-in-depth against future schema drift.
        // (Mirrors the DEFERRED_INDEXES try/catch in sqlite-backend.js.)
        for (const idx of schema.INDEXES) {
            try {
                await this.pool.query(idx);
            } catch (err) {
                console.warn('[DB/PG] Skipping index (non-fatal):', err.message);
            }
        }

        // Deferred indexes — target tables bootstrapped lazily by route/service
        // modules (promo_codes, gem_balances, …) that are NOT in schema.TABLES.
        // Applied here, after the eager indexes, each in its own try/catch so a
        // not-yet-created table is a no-op rather than a degraded-mode trip.
        // (Mirrors sqlite-backend.js DEFERRED_INDEXES handling.)
        for (const idx of schema.DEFERRED_INDEXES || []) {
            try {
                await this.pool.query(idx);
            } catch (err) {
                console.warn('[DB/PG] Skipping deferred index (non-fatal):', err.message);
            }
        }

        // Seed admin
        await this._seedAdmin();

        console.warn('[DB/PG] Schema initialized');
    }

    async _seedAdmin() {
        const config = require('../config');
        const bcrypt = require('bcryptjs');
        var adminUser = config.ADMIN_USERNAME || 'matrix';
        var hash = bcrypt.hashSync(config.ADMIN_PASSWORD, 13);

        // Update existing 'admin' user if it exists (from old seed)
        var oldAdmin = await this.pool.query("SELECT id FROM users WHERE username = 'admin'");
        if (oldAdmin.rows.length > 0) {
            await this.pool.query(
                "UPDATE users SET password_hash = $1, is_admin = 1 WHERE username = 'admin'",
                [hash]
            );
            console.warn('[DB/PG] Updated admin account password');
        }

        // Create the configured admin user if different from 'admin'
        if (adminUser !== 'admin') {
            var check = await this.pool.query("SELECT id FROM users WHERE username = $1", [adminUser]);
            if (check.rows.length === 0) {
                await this.pool.query(
                    "INSERT INTO users (username, email, password_hash, balance, is_admin) VALUES ($1, $2, $3, $4, $5) ON CONFLICT (username) DO NOTHING",
                    [adminUser, adminUser + '@matrixspins.com', hash, 0, 1]
                );
                console.warn('[DB/PG] Admin account created (username: ' + adminUser + ')');
            } else {
                await this.pool.query(
                    "UPDATE users SET password_hash = $1, is_admin = 1 WHERE username = $2",
                    [hash, adminUser]
                );
            }
        }
    }

    // ─── Transaction support ───
    // PG transactions are connection-scoped, so we acquire a dedicated client
    // from the pool on BEGIN and route all queries through it until COMMIT/ROLLBACK.

    async beginTransaction() {
        var store = _txStore.getStore();
        if (store && store.client) {
            console.warn('[DB/PG] beginTransaction called while already in transaction — ignoring');
            return;
        }
        var client = await this.pool.connect();
        await client.query('BEGIN');
        // Store the client in AsyncLocalStorage for this async context
        if (!store) {
            // If we're not already in a store, enter one
            _txStore.enterWith({ client: client });
        } else {
            store.client = client;
        }
    }

    async commit() {
        var store = _txStore.getStore();
        var client = store && store.client;
        if (!client) {
            console.warn('[DB/PG] commit called without active transaction');
            return;
        }
        try {
            await client.query('COMMIT');
        } finally {
            client.release();
            store.client = null;
        }
    }

    async rollback() {
        var store = _txStore.getStore();
        var client = store && store.client;
        if (!client) {
            console.warn('[DB/PG] rollback called without active transaction');
            return;
        }
        try {
            await client.query('ROLLBACK');
        } finally {
            client.release();
            store.client = null;
        }
    }

    /**
     * Returns the query target: the transaction client for this async context
     * if inside a transaction, otherwise the pool.
     */
    _queryTarget() {
        var store = _txStore.getStore();
        return (store && store.client) || this.pool;
    }

    // ─── Query helpers ───

    async run(sql, params) {
        if (params === undefined) params = [];
        var pgSQL = adaptSQL(sql);

        // For plain INSERTs (no ON CONFLICT DO UPDATE), append RETURNING *
        // so we can extract `id` if the table has one. Tables without an `id`
        // column (game_stats, session_win_caps, user_verification, user_limits)
        // still succeed — we just get null for lastInsertRowid.
        // Skip for upserts (ON CONFLICT DO UPDATE) which may not insert a row.
        var isInsert = /^\s*INSERT/i.test(pgSQL);
        var hasReturning = /RETURNING\s/i.test(pgSQL);
        var isUpsert = /ON\s+CONFLICT.*DO\s+UPDATE/i.test(pgSQL);
        if (isInsert && !hasReturning && !isUpsert) {
            pgSQL = pgSQL.replace(/\s*;?\s*$/, '') + ' RETURNING *';
        }

        var result = await this._queryTarget().query(pgSQL, params);

        return {
            changes: result.rowCount,
            lastInsertRowid: (result.rows && result.rows.length > 0 && result.rows[0].id !== undefined)
                ? result.rows[0].id
                : null,
        };
    }

    async get(sql, params) {
        if (params === undefined) params = [];
        var pgSQL = adaptSQL(sql);
        var result = await this._queryTarget().query(pgSQL, params);
        return (result.rows && result.rows.length > 0) ? result.rows[0] : null;
    }

    async all(sql, params) {
        if (params === undefined) params = [];
        var pgSQL = adaptSQL(sql);
        var result = await this._queryTarget().query(pgSQL, params);
        return result.rows || [];
    }

    /** No-op — PostgreSQL manages its own persistence. */
    saveToFile() {}

    async close() {
        await this.pool.end();
        console.warn('[DB/PG] Connection pool closed');
    }
}

module.exports = PgBackend;
