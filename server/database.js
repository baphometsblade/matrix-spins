'use strict';

/**
 * Database abstraction.
 * Uses Postgres (node-postgres) when DATABASE_URL is set; falls back to
 * a local SQLite file via sql.js for dev and single-instance deploys.
 *
 * Exposes a unified {run, get, all, exec} interface that both drivers
 * respect, plus initDatabase() to apply schema migrations.
 */

const fs = require('fs');
const path = require('path');
const config = require('./config');

let driver = null;
let ready = false;
let readyPromise = null;

/* ────── Postgres driver ────── */

function makePgDriver() {
    const { Pool } = require('pg');
    const pool = new Pool({
        connectionString: config.DATABASE_URL,
        ssl: /sslmode=require/.test(config.DATABASE_URL) ? { rejectUnauthorized: false } : false,
        max: 10,
    });

    // Convert "?" parameter placeholders (SQLite style) into "$1, $2..." for pg.
    function rewrite(sql) {
        let i = 0;
        return sql.replace(/\?/g, () => '$' + (++i));
    }

    return {
        kind: 'pg',
        async run(sql, params = []) {
            const r = await pool.query(rewrite(sql), params);
            return { changes: r.rowCount, lastID: null };
        },
        async get(sql, params = []) {
            const r = await pool.query(rewrite(sql), params);
            return r.rows[0] || null;
        },
        async all(sql, params = []) {
            const r = await pool.query(rewrite(sql), params);
            return r.rows;
        },
        async exec(sql) {
            await pool.query(sql);
        },
        async close() { await pool.end(); },
    };
}

/* ────── SQLite (sql.js) driver ────── */

function makeSqliteDriver() {
    const initSqlJs = require('sql.js');
    let db = null;
    let sqljs = null;
    const filePath = path.resolve(config.SQLITE_FILE);
    let writeScheduled = false;

    function scheduleWrite() {
        if (writeScheduled) return;
        writeScheduled = true;
        setImmediate(() => {
            writeScheduled = false;
            try {
                const data = db.export();
                fs.mkdirSync(path.dirname(filePath), { recursive: true });
                fs.writeFileSync(filePath, Buffer.from(data));
            } catch (err) {
                console.warn('[db] sqlite write failed:', err.message);
            }
        });
    }

    async function ensureLoaded() {
        if (db) return;
        sqljs = await initSqlJs();
        if (fs.existsSync(filePath)) {
            const bytes = fs.readFileSync(filePath);
            db = new sqljs.Database(bytes);
        } else {
            db = new sqljs.Database();
        }
    }

    function rowsOf(stmt) {
        const out = [];
        while (stmt.step()) out.push(stmt.getAsObject());
        stmt.free();
        return out;
    }

    return {
        kind: 'sqlite',
        async run(sql, params = []) {
            await ensureLoaded();
            const stmt = db.prepare(sql);
            stmt.bind(params);
            stmt.step();
            const changes = db.getRowsModified();
            stmt.free();
            scheduleWrite();
            return { changes, lastID: null };
        },
        async get(sql, params = []) {
            await ensureLoaded();
            const stmt = db.prepare(sql);
            stmt.bind(params);
            const row = stmt.step() ? stmt.getAsObject() : null;
            stmt.free();
            return row;
        },
        async all(sql, params = []) {
            await ensureLoaded();
            const stmt = db.prepare(sql);
            stmt.bind(params);
            return rowsOf(stmt);
        },
        async exec(sql) {
            await ensureLoaded();
            db.exec(sql);
            scheduleWrite();
        },
        async close() {
            if (db) { db.close(); db = null; }
        },
    };
}

/* ────── Initialization + schema ────── */

const PG_TYPES = {
    pk: 'SERIAL PRIMARY KEY',
    bigintPk: 'BIGSERIAL PRIMARY KEY',
    ts: 'TIMESTAMPTZ DEFAULT NOW()',
    json: 'JSONB',
    bool: 'BOOLEAN',
};
const SQLITE_TYPES = {
    pk: 'INTEGER PRIMARY KEY AUTOINCREMENT',
    bigintPk: 'INTEGER PRIMARY KEY AUTOINCREMENT',
    ts: "TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))",
    json: 'TEXT',
    bool: 'INTEGER',
};

function t() {
    return driver.kind === 'pg' ? PG_TYPES : SQLITE_TYPES;
}

async function addColumnIfMissing(table, column, typeDef) {
    try {
        await driver.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${typeDef}`);
    } catch (err) {
        // SQLite throws "duplicate column", Postgres throws "column already exists".
        const msg = (err && err.message || '').toLowerCase();
        if (msg.includes('duplicate column') || msg.includes('already exists')) return;
        throw err;
    }
}

async function migrate() {
    const T = t();

    await driver.exec(`
        CREATE TABLE IF NOT EXISTS users (
            id ${T.pk},
            username TEXT UNIQUE NOT NULL,
            email TEXT UNIQUE,
            password_hash TEXT NOT NULL,
            date_of_birth TEXT,
            balance_cents ${driver.kind === 'pg' ? 'BIGINT' : 'INTEGER'} NOT NULL DEFAULT 0,
            is_admin ${T.bool} NOT NULL DEFAULT ${driver.kind === 'pg' ? 'false' : '0'},
            deposit_limit_daily_cents ${driver.kind === 'pg' ? 'BIGINT' : 'INTEGER'} NOT NULL DEFAULT 50000,
            deposit_limit_weekly_cents ${driver.kind === 'pg' ? 'BIGINT' : 'INTEGER'} NOT NULL DEFAULT 200000,
            deposit_limit_monthly_cents ${driver.kind === 'pg' ? 'BIGINT' : 'INTEGER'} NOT NULL DEFAULT 500000,
            token_version INTEGER NOT NULL DEFAULT 0,
            created_at ${T.ts}
        );
    `);

    // Forward-migration for existing users — columns may not have existed
    // on first deploy. ADD COLUMN IF NOT EXISTS is Postgres-only; sql.js
    // throws a descriptive error on duplicates so we swallow it.
    await addColumnIfMissing('users', 'deposit_limit_daily_cents', driver.kind === 'pg' ? 'BIGINT NOT NULL DEFAULT 50000' : 'INTEGER NOT NULL DEFAULT 50000');
    await addColumnIfMissing('users', 'deposit_limit_weekly_cents', driver.kind === 'pg' ? 'BIGINT NOT NULL DEFAULT 200000' : 'INTEGER NOT NULL DEFAULT 200000');
    await addColumnIfMissing('users', 'deposit_limit_monthly_cents', driver.kind === 'pg' ? 'BIGINT NOT NULL DEFAULT 500000' : 'INTEGER NOT NULL DEFAULT 500000');
    // token_version bumps invalidate every JWT issued before the bump
    // (e.g. password change, 2FA disable, admin-triggered revoke).
    await addColumnIfMissing('users', 'token_version', driver.kind === 'pg' ? 'INTEGER NOT NULL DEFAULT 0' : 'INTEGER NOT NULL DEFAULT 0');

    await driver.exec(`
        CREATE TABLE IF NOT EXISTS deposits (
            id ${T.pk},
            user_id ${driver.kind === 'pg' ? 'INTEGER' : 'INTEGER'} NOT NULL,
            provider TEXT NOT NULL,
            provider_ref TEXT UNIQUE,
            amount_cents ${driver.kind === 'pg' ? 'BIGINT' : 'INTEGER'} NOT NULL,
            currency TEXT NOT NULL DEFAULT 'usd',
            status TEXT NOT NULL DEFAULT 'pending',
            created_at ${T.ts},
            completed_at ${driver.kind === 'pg' ? 'TIMESTAMPTZ' : 'TEXT'}
        );
    `);

    await driver.exec(`CREATE INDEX IF NOT EXISTS idx_deposits_user ON deposits (user_id);`);

    await driver.exec(`
        CREATE TABLE IF NOT EXISTS nft_receipts (
            id ${T.pk},
            user_id ${driver.kind === 'pg' ? 'INTEGER' : 'INTEGER'} NOT NULL,
            deposit_id ${driver.kind === 'pg' ? 'INTEGER' : 'INTEGER'} NOT NULL UNIQUE,
            token_id TEXT UNIQUE NOT NULL,
            provider TEXT NOT NULL DEFAULT 'db',
            chain TEXT,
            contract_address TEXT,
            metadata ${T.json} NOT NULL,
            signature TEXT NOT NULL,
            minted_at ${T.ts}
        );
    `);

    await driver.exec(`CREATE INDEX IF NOT EXISTS idx_nft_user ON nft_receipts (user_id);`);

    await driver.exec(`
        CREATE TABLE IF NOT EXISTS processed_webhook_events (
            id ${T.pk},
            provider TEXT NOT NULL,
            event_id TEXT NOT NULL,
            event_type TEXT,
            processed_at ${T.ts}
        );
    `);
    await driver.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_webhook_provider_event ON processed_webhook_events (provider, event_id);`);

    await driver.exec(`
        CREATE TABLE IF NOT EXISTS refunds (
            id ${T.pk},
            deposit_id ${driver.kind === 'pg' ? 'INTEGER' : 'INTEGER'} NOT NULL,
            user_id ${driver.kind === 'pg' ? 'INTEGER' : 'INTEGER'} NOT NULL,
            amount_cents ${driver.kind === 'pg' ? 'BIGINT' : 'INTEGER'} NOT NULL,
            provider_ref TEXT UNIQUE,
            reason TEXT,
            created_at ${T.ts}
        );
    `);
    await driver.exec(`CREATE INDEX IF NOT EXISTS idx_refunds_deposit ON refunds (deposit_id);`);

    await driver.exec(`
        CREATE TABLE IF NOT EXISTS password_resets (
            id ${T.pk},
            user_id ${driver.kind === 'pg' ? 'INTEGER' : 'INTEGER'} NOT NULL,
            token_hash TEXT UNIQUE NOT NULL,
            expires_at ${driver.kind === 'pg' ? 'TIMESTAMPTZ' : 'TEXT'} NOT NULL,
            used_at ${driver.kind === 'pg' ? 'TIMESTAMPTZ' : 'TEXT'},
            created_at ${T.ts}
        );
    `);
    await driver.exec(`CREATE INDEX IF NOT EXISTS idx_password_resets_user ON password_resets (user_id);`);

    await addColumnIfMissing('users', 'display_name', 'TEXT');

    await driver.exec(`
        CREATE TABLE IF NOT EXISTS auth_events (
            id ${T.pk},
            user_id ${driver.kind === 'pg' ? 'INTEGER' : 'INTEGER'},
            username TEXT,
            event_type TEXT NOT NULL,
            outcome TEXT NOT NULL,
            ip TEXT,
            user_agent TEXT,
            reason TEXT,
            created_at ${T.ts}
        );
    `);
    await driver.exec(`CREATE INDEX IF NOT EXISTS idx_auth_events_user ON auth_events (user_id);`);
    await driver.exec(`CREATE INDEX IF NOT EXISTS idx_auth_events_username ON auth_events (username);`);
    await driver.exec(`CREATE INDEX IF NOT EXISTS idx_auth_events_created ON auth_events (created_at);`);

    await driver.exec(`
        CREATE TABLE IF NOT EXISTS user_totp_secrets (
            user_id ${driver.kind === 'pg' ? 'INTEGER PRIMARY KEY' : 'INTEGER PRIMARY KEY'},
            secret TEXT NOT NULL,
            enabled ${T.bool} NOT NULL DEFAULT ${driver.kind === 'pg' ? 'false' : '0'},
            created_at ${T.ts},
            enabled_at ${driver.kind === 'pg' ? 'TIMESTAMPTZ' : 'TEXT'}
        );
    `);

    await driver.exec(`
        CREATE TABLE IF NOT EXISTS user_recovery_codes (
            id ${T.pk},
            user_id ${driver.kind === 'pg' ? 'INTEGER' : 'INTEGER'} NOT NULL,
            code_hash TEXT UNIQUE NOT NULL,
            used_at ${driver.kind === 'pg' ? 'TIMESTAMPTZ' : 'TEXT'},
            created_at ${T.ts}
        );
    `);
    await driver.exec(`CREATE INDEX IF NOT EXISTS idx_recovery_codes_user ON user_recovery_codes (user_id);`);
}

async function initDatabase() {
    if (readyPromise) return readyPromise;
    readyPromise = (async () => {
        if (config.DATABASE_URL) {
            driver = makePgDriver();
            console.log('[db] using Postgres');
        } else {
            driver = makeSqliteDriver();
            console.log('[db] using SQLite at ' + path.resolve(config.SQLITE_FILE));
        }
        await migrate();
        ready = true;
    })();
    return readyPromise;
}

function guard() {
    if (!ready) throw new Error('Database not initialized yet');
}

module.exports = {
    initDatabase,
    get kind() { return driver && driver.kind; },
    run: (sql, params) => { guard(); return driver.run(sql, params); },
    get: (sql, params) => { guard(); return driver.get(sql, params); },
    all: (sql, params) => { guard(); return driver.all(sql, params); },
    exec: (sql) => { guard(); return driver.exec(sql); },
    close: () => driver && driver.close ? driver.close() : Promise.resolve(),
};
