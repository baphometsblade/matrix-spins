#!/usr/bin/env node
/**
 * scripts/migrate.js — Database migration runner
 *
 * Idempotent. Handles both fresh installs and upgrades.
 *
 *   - Initializes the active backend (PG when DATABASE_URL is set,
 *     SQLite otherwise) which creates the canonical schema.
 *   - Runs all *.sql migration files in scripts/migrations/ in
 *     filename-sorted order. Each file's hash is recorded in
 *     `_migrations` so re-runs are no-ops.
 *   - Exits 0 on success, 1 on any failure.
 *
 * Usage:
 *   npm run migrate
 *   DATABASE_URL=postgres://... npm run migrate
 */
'use strict';

require('dotenv').config();
require('../server/utils/secure-rng');

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const MIGRATIONS_DIR = path.join(__dirname, 'migrations');

async function ensureMigrationsTable(db) {
    const isPg = db.isPg();
    if (isPg) {
        await db.run(`CREATE TABLE IF NOT EXISTS _migrations (
            id SERIAL PRIMARY KEY,
            name TEXT NOT NULL UNIQUE,
            checksum TEXT NOT NULL,
            applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )`);
    } else {
        await db.run(`CREATE TABLE IF NOT EXISTS _migrations (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL UNIQUE,
            checksum TEXT NOT NULL,
            applied_at TEXT NOT NULL DEFAULT (datetime('now'))
        )`);
    }
}

function discoverMigrations() {
    if (!fs.existsSync(MIGRATIONS_DIR)) return [];
    return fs
        .readdirSync(MIGRATIONS_DIR)
        .filter((f) => f.endsWith('.sql'))
        .sort()
        .map((name) => {
            const file = path.join(MIGRATIONS_DIR, name);
            const sql = fs.readFileSync(file, 'utf8');
            const checksum = crypto.createHash('sha256').update(sql).digest('hex');
            return { name, sql, checksum };
        });
}

async function applyMigration(db, m) {
    const existing = await db.get('SELECT checksum FROM _migrations WHERE name = ?', [m.name]);
    if (existing) {
        if (existing.checksum !== m.checksum) {
            throw new Error(
                `Migration ${m.name} checksum mismatch — file edited after apply. ` +
                `Add a new migration instead of editing applied ones.`
            );
        }
        return false; // already applied
    }
    // Split on top-level semicolons. Migrations should be plain DDL.
    const statements = m.sql
        .split(/;\s*[\r\n]+/)
        .map((s) => s.trim())
        .filter((s) => s && !s.startsWith('--'));

    for (const stmt of statements) {
        await db.run(stmt);
    }
    await db.run('INSERT INTO _migrations (name, checksum) VALUES (?, ?)', [m.name, m.checksum]);
    return true;
}

async function main() {
    const db = require('../server/database');
    console.log('[migrate] Initializing database backend…');
    await db.initDatabase();

    if (db.isDegraded()) {
        console.error('[migrate] DATABASE_URL set but PostgreSQL unreachable — refusing to migrate against ephemeral SQLite fallback.');
        console.error('[migrate] Last PG error:', db.lastPgError());
        process.exit(2);
    }

    console.log(`[migrate] Backend: ${db.isPg() ? 'PostgreSQL' : 'SQLite'}`);
    await ensureMigrationsTable(db);

    const migrations = discoverMigrations();
    if (!migrations.length) {
        console.log('[migrate] No migration files found in', MIGRATIONS_DIR);
        console.log('[migrate] Schema bootstrap (handled by initDatabase) complete.');
        return;
    }

    let applied = 0;
    for (const m of migrations) {
        process.stdout.write(`[migrate] ${m.name} … `);
        try {
            const did = await applyMigration(db, m);
            console.log(did ? 'APPLIED' : 'skip (already applied)');
            if (did) applied++;
        } catch (err) {
            console.log('FAILED');
            console.error(`[migrate] ${m.name} failed:`, err.message);
            throw err;
        }
    }
    console.log(`[migrate] Done. ${applied} migration(s) newly applied, ${migrations.length - applied} already present.`);
}

main()
    .then(() => process.exit(0))
    .catch((err) => {
        console.error('[migrate] FATAL:', err.message);
        process.exit(1);
    });
