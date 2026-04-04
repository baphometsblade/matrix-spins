'use strict';

/**
 * Crash game service — manages crash rounds and bets.
 * Uses dialect-aware DDL so it works on both SQLite and PostgreSQL.
 */

async function initSchema() {
    const db = require('../database');
    const isPg = !!process.env.DATABASE_URL;

    const tsType    = isPg ? 'TIMESTAMPTZ' : 'TEXT';
    const tsDefault = isPg ? 'NOW()' : "(datetime('now'))";
    const idDef     = isPg ? 'SERIAL PRIMARY KEY' : 'INTEGER PRIMARY KEY AUTOINCREMENT';

    await db.run(`CREATE TABLE IF NOT EXISTS crash_rounds (
        id ${idDef},
        crash_point REAL NOT NULL,
        hash TEXT NOT NULL,
        created_at ${tsType} DEFAULT ${tsDefault}
    )`);

    await db.run(`CREATE TABLE IF NOT EXISTS crash_bets (
        id ${idDef},
        round_id INTEGER NOT NULL,
        user_id INTEGER NOT NULL,
        bet_amount REAL NOT NULL,
        auto_cashout REAL,
        cashout_at REAL,
        payout REAL DEFAULT 0,
        created_at ${tsType} DEFAULT ${tsDefault}
    )`);
}

module.exports = { initSchema };
