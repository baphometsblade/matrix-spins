#!/usr/bin/env node
/**
 * scripts/seed.js — Seed initial admin account + sample data
 *
 * Idempotent. Run after `npm run migrate`. Safe in production:
 *   - Only inserts the admin user if none exists
 *   - Only seeds sample game-config rows when the table is empty
 *   - Never overwrites existing data
 *
 * Reads:
 *   SEED_ADMIN_USERNAME (default: "admin")
 *   SEED_ADMIN_EMAIL    (default: "admin@msaart.online")
 *   SEED_ADMIN_PASSWORD (falls back to ADMIN_PASSWORD)
 *
 * Usage:
 *   npm run seed
 */
'use strict';

require('dotenv').config();
require('../server/utils/secure-rng');

const bcrypt = require('bcryptjs');

async function tableExists(db, name) {
    if (db.isPg()) {
        const r = await db.get(
            "SELECT 1 AS ok FROM information_schema.tables WHERE table_name = $1",
            [name]
        );
        return !!r;
    }
    const r = await db.get(
        "SELECT 1 AS ok FROM sqlite_master WHERE type='table' AND name = ?",
        [name]
    );
    return !!r;
}

async function seedAdmin(db) {
    const username = process.env.SEED_ADMIN_USERNAME || 'admin';
    const email = process.env.SEED_ADMIN_EMAIL || 'admin@msaart.online';
    const password = process.env.SEED_ADMIN_PASSWORD || process.env.ADMIN_PASSWORD;

    if (!password) {
        console.warn('[seed] No SEED_ADMIN_PASSWORD or ADMIN_PASSWORD set — skipping admin seed.');
        return;
    }
    if (!(await tableExists(db, 'users'))) {
        console.warn('[seed] users table missing — run migrate first.');
        return;
    }

    const existing = await db.get('SELECT id, is_admin FROM users WHERE username = ? OR email = ?', [
        username,
        email,
    ]);
    if (existing) {
        if (!existing.is_admin) {
            await db.run('UPDATE users SET is_admin = 1 WHERE id = ?', [existing.id]);
            console.log(`[seed] Promoted user ${username} to admin.`);
        } else {
            console.log(`[seed] Admin user ${username} already exists — skipping.`);
        }
        return;
    }

    const hash = await bcrypt.hash(password, 10);
    await db.run(
        `INSERT INTO users (username, email, password_hash, is_admin, balance, bonus_balance, wagering_requirement, created_at)
         VALUES (?, ?, ?, 1, 0, 0, 0, ?)`,
        [username, email, hash, new Date().toISOString()]
    );
    console.log(`[seed] Created admin user "${username}" (${email}).`);
}

async function seedGameConfigs(db) {
    if (!(await tableExists(db, 'games'))) {
        console.log('[seed] games table missing — skipping sample game configs.');
        return;
    }
    const row = await db.get('SELECT COUNT(*) AS c FROM games');
    const count = row && row.c != null ? Number(row.c) : 0;
    if (count > 0) {
        console.log(`[seed] games table already has ${count} rows — leaving untouched.`);
        return;
    }

    // Pull canonical definitions from the bundled shared/ module so we don't
    // duplicate them. If unavailable, skip — never invent fake data.
    let defs = null;
    try {
        defs = require('../shared/game-definitions');
    } catch (err) {
        console.warn('[seed] shared/game-definitions not loadable — skipping game seed:', err.message);
        return;
    }
    const list = Array.isArray(defs) ? defs : (defs && defs.GAMES) || [];
    if (!list.length) {
        console.warn('[seed] game-definitions module exported no games — skipping.');
        return;
    }

    let inserted = 0;
    for (const g of list) {
        try {
            await db.run(
                `INSERT INTO games (id, name, provider, rtp, volatility, enabled)
                 VALUES (?, ?, ?, ?, ?, 1)`,
                [g.id, g.name || g.id, g.provider || g.studio || null, g.rtp || 86, g.volatility || 'medium']
            );
            inserted++;
        } catch (err) {
            // Schema may use a different column shape — bail gracefully on first mismatch
            if (inserted === 0) {
                console.warn('[seed] games schema differs from expected — skipping game seed:', err.message);
                return;
            }
        }
    }
    console.log(`[seed] Seeded ${inserted} game definitions.`);
}

async function main() {
    const db = require('../server/database');
    console.log('[seed] Initializing database backend…');
    await db.initDatabase();
    if (db.isDegraded()) {
        console.warn('[seed] Running against degraded SQLite fallback (PG unreachable).');
    }

    await seedAdmin(db);
    await seedGameConfigs(db);
    console.log('[seed] Done.');
}

main()
    .then(() => process.exit(0))
    .catch((err) => {
        console.error('[seed] FATAL:', err.message);
        process.exit(1);
    });
