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
        var sslSetting = process.env.NODE_ENV === 'production'
            ? { rejectUnauthorized: false }   // Render / Railway require SSL
            : false;

        this.pool = new Pool({
            connectionString: connectionString,
            max: 20,
            idleTimeoutMillis: 30000,
            connectionTimeoutMillis: 30000,
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

        // Indexes
        for (const idx of schema.INDEXES) {
            await this.pool.query(idx);
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
        if (this._txClient) {
            // Nested transaction guard — just log and continue (SQLite also doesn't nest)
            console.warn('[DB/PG] beginTransaction called while already in transaction — ignoring');
            return;
        }
        this._txClient = await this.pool.connect();
        await this._txClient.query('BEGIN');
    }

    async commit() {
        if (!this._txClient) {
            console.warn('[DB/PG] commit called without active transaction');
            return;
        }
        try {
            await this._txClient.query('COMMIT');
        } finally {
            this._txClient.release();
            this._txClient = null;
        }
    }

    async rollback() {
        if (!this._txClient) {
            console.warn('[DB/PG] rollback called without active transaction');
            return;
        }
        try {
            await this._txClient.query('ROLLBACK');
        } finally {
            this._txClient.release();
            this._txClient = null;
        }
    }

    /**
     * Returns the query target: the transaction client if inside a transaction,
     * otherwise the pool (which auto-checks-out a connection per query).
     */
    _queryTarget() {
        return this._txClient || this.pool;
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
