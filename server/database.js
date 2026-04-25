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
        return true;
    } catch (err) {
        // SQLite throws "duplicate column", Postgres throws "column already exists".
        const msg = (err && err.message || '').toLowerCase();
        if (msg.includes('duplicate column') || msg.includes('already exists')) return false;
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

    // Responsible-gambling self-exclusion. An ISO timestamp (NULL = not
    // excluded). While now() < this timestamp the user cannot log in or
    // deposit. Once set, it can only be shortened by an operator (never
    // by the user themselves) — encoded in the self-exclude route.
    await addColumnIfMissing('users', 'self_excluded_until', driver.kind === 'pg' ? 'TIMESTAMPTZ' : 'TEXT');

    // Responsible-gambling loss limit. 0 = unlimited. Enforced over a
    // rolling 24h window of slot_rounds in the engine's spin() gate.
    // Decreases apply immediately; increases are rejected (same policy
    // as the deposit-limit columns above). See
    // server/routes/user.routes.js GET/PUT /api/user/loss-limit.
    await addColumnIfMissing('users', 'loss_limit_daily_cents', driver.kind === 'pg' ? 'BIGINT NOT NULL DEFAULT 0' : 'INTEGER NOT NULL DEFAULT 0');
    // token_version bumps invalidate every JWT issued before the bump
    // (e.g. password change, 2FA disable, admin-triggered revoke).
    await addColumnIfMissing('users', 'token_version', driver.kind === 'pg' ? 'INTEGER NOT NULL DEFAULT 0' : 'INTEGER NOT NULL DEFAULT 0');
    // email_verified gates first deposit behind a click on the
    // verification link. Defaults to 0/false so newly-registered
    // accounts must verify before moving money.
    const wasAdded = await addColumnIfMissing('users', 'email_verified', driver.kind === 'pg' ? 'BOOLEAN NOT NULL DEFAULT false' : 'INTEGER NOT NULL DEFAULT 0');
    if (wasAdded) {
        // Grandfather existing users — they registered before this gate
        // existed and shouldn't suddenly be locked out of deposits.
        const pgTrue = driver.kind === 'pg' ? 'true' : '1';
        await driver.run('UPDATE users SET email_verified = ' + pgTrue);
        console.log('[db] grandfathered existing users as email_verified');
    }

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

    await driver.exec(`
        CREATE TABLE IF NOT EXISTS email_verification_tokens (
            id ${T.pk},
            user_id ${driver.kind === 'pg' ? 'INTEGER' : 'INTEGER'} NOT NULL,
            token_hash TEXT UNIQUE NOT NULL,
            expires_at ${driver.kind === 'pg' ? 'TIMESTAMPTZ' : 'TEXT'} NOT NULL,
            used_at ${driver.kind === 'pg' ? 'TIMESTAMPTZ' : 'TEXT'},
            created_at ${T.ts}
        );
    `);
    await driver.exec(`CREATE INDEX IF NOT EXISTS idx_email_verif_user ON email_verification_tokens (user_id);`);

    await addColumnIfMissing('users', 'display_name', 'TEXT');

    // Persistent slot client seed. NULL = treated as the engine's
    // 'default' sentinel by normalizeClientSeed. The user can rotate
    // via PUT /api/slot/client-seed; per-spin requests may still
    // override by including client_seed in the body (used by tests
    // and direct API callers).
    await addColumnIfMissing('users', 'slot_client_seed', 'TEXT');

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

    await driver.exec(`
        CREATE TABLE IF NOT EXISTS balance_adjustments (
            id ${T.pk},
            user_id ${driver.kind === 'pg' ? 'INTEGER' : 'INTEGER'} NOT NULL,
            admin_id ${driver.kind === 'pg' ? 'INTEGER' : 'INTEGER'} NOT NULL,
            admin_username TEXT,
            delta_cents ${driver.kind === 'pg' ? 'BIGINT' : 'INTEGER'} NOT NULL,
            balance_after_cents ${driver.kind === 'pg' ? 'BIGINT' : 'INTEGER'} NOT NULL,
            reason TEXT NOT NULL,
            created_at ${T.ts}
        );
    `);
    await driver.exec(`CREATE INDEX IF NOT EXISTS idx_balance_adjustments_user ON balance_adjustments (user_id);`);

    // Per-user game stats blob. The client keeps its running counters in
    // localStorage and periodically syncs the whole object up here so
    // session/device switches don't lose history. One row per user;
    // last_updated helps admin audits.
    await driver.exec(`
        CREATE TABLE IF NOT EXISTS user_stats (
            user_id ${driver.kind === 'pg' ? 'INTEGER' : 'INTEGER'} PRIMARY KEY,
            stats_json TEXT NOT NULL,
            updated_at ${T.ts}
        );
    `);

    // Server-authoritative slot rounds. Every spin is settled server-side:
    // we debit the bet, run the RNG, credit the win, and log the full
    // outcome here. The server_seed / server_seed_hash / client_seed /
    // nonce tuple lets the user verify the round was fair after the
    // fact (standard commit-reveal).
    await driver.exec(`
        CREATE TABLE IF NOT EXISTS slot_rounds (
            id ${T.pk},
            user_id ${driver.kind === 'pg' ? 'INTEGER' : 'INTEGER'} NOT NULL,
            game_id TEXT NOT NULL,
            bet_cents ${driver.kind === 'pg' ? 'BIGINT' : 'INTEGER'} NOT NULL,
            win_cents ${driver.kind === 'pg' ? 'BIGINT' : 'INTEGER'} NOT NULL,
            balance_after_cents ${driver.kind === 'pg' ? 'BIGINT' : 'INTEGER'} NOT NULL,
            server_seed TEXT NOT NULL,
            server_seed_hash TEXT NOT NULL,
            client_seed TEXT NOT NULL,
            nonce ${driver.kind === 'pg' ? 'INTEGER' : 'INTEGER'} NOT NULL,
            outcome_json TEXT NOT NULL,
            created_at ${T.ts}
        );
    `);
    await driver.exec(`CREATE INDEX IF NOT EXISTS idx_slot_rounds_user ON slot_rounds (user_id, id DESC);`);
    // Supports the rolling-window loss-limit aggregate in
    // server/services/slot-engine.service.js:sumNetLossSince. The
    // (user_id, id) index above would narrow to one user's rows but
    // then still scan them for the created_at predicate; (user_id,
    // created_at) serves the range filter directly.
    await driver.exec(`CREATE INDEX IF NOT EXISTS idx_slot_rounds_user_created ON slot_rounds (user_id, created_at);`);

    // Holds the CURRENT unused commit for each user. On each spin we
    // consume this row (revealing the seed to the user in the response)
    // and roll a fresh one. The hash is exposed via /api/slot/commit
    // before the spin so the user can verify post hoc.
    await driver.exec(`
        CREATE TABLE IF NOT EXISTS user_slot_seeds (
            user_id ${driver.kind === 'pg' ? 'INTEGER' : 'INTEGER'} PRIMARY KEY,
            server_seed TEXT NOT NULL,
            server_seed_hash TEXT NOT NULL,
            nonce ${driver.kind === 'pg' ? 'INTEGER' : 'INTEGER'} NOT NULL DEFAULT 0,
            created_at ${T.ts}
        );
    `);

    // Operator feature flags. Namespaced key → JSON value. Used today for
    // the slot-engine kill switch (key='slot.paused', value={ paused:
    // true|false, reason: string }), but the shape is generic so future
    // flags (per-game pauses, rollout toggles, banner text) don't need
    // another table.
    await driver.exec(`
        CREATE TABLE IF NOT EXISTS feature_flags (
            key TEXT PRIMARY KEY,
            value_json TEXT NOT NULL,
            updated_at ${T.ts},
            updated_by_id ${driver.kind === 'pg' ? 'INTEGER' : 'INTEGER'},
            updated_by_username TEXT
        );
    `);

    // Withdrawals. When a user requests a cash-out we atomically debit
    // their balance and create a row here in status='pending'. An
    // operator approves (marks 'paid' once the real transfer settles
    // off-system) or denies (status='denied'; the debited amount is
    // refunded back to the user's balance atomically).
    //
    // Status machine:
    //   pending  → paid           (approved by operator, external
    //                              transfer done)
    //   pending  → denied         (operator rejects; balance refunded)
    //   pending  → cancelled      (user withdrew the request before
    //                              approval; balance refunded)
    // No other transitions are allowed. Every state change is logged.
    await driver.exec(`
        CREATE TABLE IF NOT EXISTS withdrawals (
            id ${T.pk},
            user_id ${driver.kind === 'pg' ? 'INTEGER' : 'INTEGER'} NOT NULL,
            amount_cents ${driver.kind === 'pg' ? 'BIGINT' : 'INTEGER'} NOT NULL,
            currency TEXT NOT NULL DEFAULT 'usd',
            method TEXT NOT NULL,
            destination TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'pending',
            admin_id ${driver.kind === 'pg' ? 'INTEGER' : 'INTEGER'},
            admin_username TEXT,
            admin_note TEXT,
            created_at ${T.ts},
            processed_at ${driver.kind === 'pg' ? 'TIMESTAMPTZ' : 'TEXT'}
        );
    `);
    await driver.exec(`CREATE INDEX IF NOT EXISTS idx_withdrawals_user ON withdrawals (user_id, id DESC);`);
    await driver.exec(`CREATE INDEX IF NOT EXISTS idx_withdrawals_status ON withdrawals (status);`);
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
    // SQL fragment for "the current timestamp", dialect-aware. Interpolated
    // into query strings, NOT bound as a parameter — params go through `?`.
    // Centralized so adding another backend (or swapping to CURRENT_TIMESTAMP
    // everywhere) is a one-line change.
    sqlNow: () => (driver && driver.kind === 'pg') ? 'now()' : "strftime('%Y-%m-%d %H:%M:%f','now')",
};
