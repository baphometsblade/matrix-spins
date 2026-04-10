/**
 * SQLite backend — wraps sql.js with the unified async API.
 *
 * Extracted from the original monolithic database.js.
 * Behaviour is identical to the pre-refactor version.
 */

'use strict';

const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');

class SqliteBackend {
    constructor(dbPath) {
        this.dbPath = path.resolve(dbPath);
        this.db = null;
        this._saveInterval = null;
        this._savePending = false;
        this._saveDebounceTimer = null;
        this._inTransaction = false;
    }

    async init() {
        const SQL = await initSqlJs();

        // Load existing DB file if it exists
        if (fs.existsSync(this.dbPath)) {
            const buf = fs.readFileSync(this.dbPath);
            this.db = new SQL.Database(buf);
            console.warn('[DB/SQLite] Loaded existing database from', this.dbPath);
        } else {
            this.db = new SQL.Database();
            console.warn('[DB/SQLite] Created new in-memory database');
        }

        // Schema
        const schema = require('./schema-sqlite');

        for (const ddl of schema.TABLES) {
            this.db.run(ddl);
        }

        // Column migrations (validate names/types to prevent SQL injection)
        const SAFE_COL_NAME = /^[a-z_][a-z0-9_]{0,63}$/;
        const SAFE_COL_DEF = /^[A-Z0-9_ (),']+$/i;
        const userCols = this.db.exec("PRAGMA table_info(users)");
        const colNames = userCols.length > 0 ? userCols[0].values.map(r => r[1]) : [];
        for (const [name, def] of schema.USER_MIGRATIONS) {
            if (!SAFE_COL_NAME.test(name) || !SAFE_COL_DEF.test(def)) {
                console.error(`[DB/SQLite] Skipping unsafe migration: ${name} ${def}`);
                continue;
            }
            if (!colNames.includes(name)) {
                this.db.run(`ALTER TABLE users ADD COLUMN ${name} ${def}`);
            }
        }

        // Withdrawals table column migrations
        if (schema.WITHDRAWAL_MIGRATIONS) {
            const wdCols = this.db.exec('PRAGMA table_info(withdrawals)');
            const wdColNames = wdCols.length > 0 ? wdCols[0].values.map(r => r[1]) : [];
            for (const [name, def] of schema.WITHDRAWAL_MIGRATIONS) {
                if (!SAFE_COL_NAME.test(name) || !SAFE_COL_DEF.test(def)) {
                    console.error(`[DB/SQLite] Skipping unsafe migration: ${name} ${def}`);
                    continue;
                }
                if (!wdColNames.includes(name)) {
                    this.db.run(`ALTER TABLE withdrawals ADD COLUMN ${name} ${def}`);
                }
            }
        }

        // Indexes
        for (const idx of schema.INDEXES) {
            this.db.run(idx);
        }

        // Deferred indexes — tables may not exist yet (created by lazy-init routes)
        if (schema.DEFERRED_INDEXES) {
            for (const idx of schema.DEFERRED_INDEXES) {
                try { this.db.run(idx); } catch (_) { /* table not yet created */ }
            }
        }

        // Seed admin
        await this._seedAdmin();

        this.saveToFile();
        console.warn('[DB/SQLite] Schema initialized');

        // Auto-save every 30 seconds
        this._saveInterval = setInterval(() => this.saveToFile(), 30000);
    }

    async _seedAdmin() {
        const config = require('../config');
        const bcrypt = require('bcryptjs');
        var adminUser = config.ADMIN_USERNAME || 'matrix';
        var hash = bcrypt.hashSync(config.ADMIN_PASSWORD, 13);

        // Update existing 'admin' user if it exists (from old seed)
        var oldAdmin = this.db.exec("SELECT id FROM users WHERE username = 'admin'");
        if (oldAdmin.length > 0 && oldAdmin[0].values.length > 0) {
            this.db.run("UPDATE users SET password_hash = ?, is_admin = 1 WHERE username = 'admin'", [hash]);
            console.warn('[DB/SQLite] Updated admin account password');
        }

        // Create the configured admin user if different from 'admin'
        if (adminUser !== 'admin') {
            var checkStmt = this.db.prepare("SELECT id FROM users WHERE username = ?");
            checkStmt.bind([adminUser]);
            var check = checkStmt.step() ? [{ values: [[checkStmt.get()[0]]] }] : [];
            checkStmt.free();
            if (check.length === 0 || check[0].values.length === 0) {
                this.db.run(
                    "INSERT OR IGNORE INTO users (username, email, password_hash, balance, is_admin) VALUES (?, ?, ?, ?, ?)",
                    [adminUser, adminUser + '@matrixspins.com', hash, 0, 1]
                );
                console.warn('[DB/SQLite] Admin account created');
            } else {
                this.db.run("UPDATE users SET password_hash = ?, is_admin = 1 WHERE username = ?", [hash, adminUser]);
            }
        }

        // Performance indexes
        try { this.db.run("CREATE INDEX IF NOT EXISTS idx_spins_game_id ON spins(game_id)"); } catch(_) {}
        try { this.db.run("CREATE INDEX IF NOT EXISTS idx_spins_user_id ON spins(user_id)"); } catch(_) {}
        try { this.db.run("CREATE INDEX IF NOT EXISTS idx_deposits_created ON deposits(created_at)"); } catch(_) {}
        try { this.db.run("CREATE INDEX IF NOT EXISTS idx_transactions_user ON transactions(user_id)"); } catch(_) {}
        // Round 6: additional indexes for responsible gaming & query performance
        try { this.db.run("CREATE INDEX IF NOT EXISTS idx_spins_user_created ON spins(user_id, created_at)"); } catch(_) {}
        try { this.db.run("CREATE INDEX IF NOT EXISTS idx_transactions_user_created ON transactions(user_id, created_at)"); } catch(_) {}
        try { this.db.run("CREATE INDEX IF NOT EXISTS idx_deposits_user_created ON deposits(user_id, created_at)"); } catch(_) {}
        try { this.db.run("CREATE INDEX IF NOT EXISTS idx_self_exclusions_user ON self_exclusions(user_id, is_active)"); } catch(_) {}
        // Round 74: indexes for admin dashboard status-filtered queries
        try { this.db.run("CREATE INDEX IF NOT EXISTS idx_deposits_status ON deposits(status)"); } catch(_) {}
        try { this.db.run("CREATE INDEX IF NOT EXISTS idx_deposits_status_created ON deposits(status, created_at)"); } catch(_) {}
        try { this.db.run("CREATE INDEX IF NOT EXISTS idx_withdrawals_status ON withdrawal_requests(status)"); } catch(_) {}
        try { this.db.run("CREATE INDEX IF NOT EXISTS idx_withdrawals_status_created ON withdrawal_requests(status, created_at)"); } catch(_) {}
        try { this.db.run("CREATE INDEX IF NOT EXISTS idx_transactions_type ON transactions(type)"); } catch(_) {}
    }

    // ─── Transaction support ───

    async beginTransaction() {
        if (this._inTransaction) return;
        this.db.run('BEGIN TRANSACTION');
        this._inTransaction = true;
    }

    async commit() {
        if (!this._inTransaction) return;
        this.db.run('COMMIT');
        this._inTransaction = false;
        // ROUND 27: Flush immediately on commit (not debounced) to minimize data loss window.
        // Financial transactions (spins, deposits, withdrawals) MUST be persisted immediately.
        // Previously used _debouncedSave() with 500ms delay — a crash during that window
        // could lose completed spin results, balance credits, or withdrawal records.
        this._flushToDisk();
    }

    async rollback() {
        if (!this._inTransaction) return;
        try { this.db.run('ROLLBACK'); } catch (_) { /* already rolled back */ }
        this._inTransaction = false;
    }

    // ─── Query helpers (async wrappers over synchronous sql.js) ───

    async run(sql, params) {
        if (params === undefined) params = [];
        this.db.run(sql, params);
        const lastId = this._getLastInsertId();
        const changes = this.db.getRowsModified();
        // Only persist immediately outside transactions; inside txn, commit() handles it
        if (!this._inTransaction) this._debouncedSave();
        return { changes: changes, lastInsertRowid: lastId };
    }

    async get(sql, params) {
        if (params === undefined) params = [];
        var stmt = this.db.prepare(sql);
        stmt.bind(params);
        if (stmt.step()) {
            var row = stmt.getAsObject();
            stmt.free();
            return row;
        }
        stmt.free();
        return null;
    }

    async all(sql, params) {
        if (params === undefined) params = [];
        var stmt = this.db.prepare(sql);
        stmt.bind(params);
        var rows = [];
        while (stmt.step()) {
            rows.push(stmt.getAsObject());
        }
        stmt.free();
        return rows;
    }

    _getLastInsertId() {
        var result = this.db.exec('SELECT last_insert_rowid() as id');
        return result.length > 0 ? result[0].values[0][0] : null;
    }

    // Debounced save: coalesce rapid writes into a single disk flush (max 500ms delay)
    _debouncedSave() {
        this._savePending = true;
        if (this._saveDebounceTimer) return; // already scheduled
        this._saveDebounceTimer = setTimeout(() => {
            this._saveDebounceTimer = null;
            this._flushToDisk();
        }, 500);
    }

    _flushToDisk() {
        if (!this.db || !this._savePending) return;
        this._savePending = false;
        try {
            var data = this.db.export();
            var buffer = Buffer.from(data);
            fs.writeFileSync(this.dbPath + '.tmp', buffer);
            fs.renameSync(this.dbPath + '.tmp', this.dbPath);
        } catch (err) {
            console.error('[DB/SQLite] Write error:', err.message);
        }
    }

    // Legacy compat: immediate flush (used by init and close)
    saveToFile() {
        this._flushToDisk();
    }

    async close() {
        if (this._saveInterval) {
            clearInterval(this._saveInterval);
            this._saveInterval = null;
        }
        if (this._saveDebounceTimer) {
            clearTimeout(this._saveDebounceTimer);
            this._saveDebounceTimer = null;
        }
        this._flushToDisk(); // final synchronous flush
        if (this.db) {
            this.db.close();
            this.db = null;
        }
    }
}

module.exports = SqliteBackend;
