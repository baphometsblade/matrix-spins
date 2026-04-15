#!/usr/bin/env node
/**
 * PostgreSQL Connection Diagnostic
 *
 * Run: node scripts/check-pg.js
 *
 * Checks if DATABASE_URL is set and whether the PostgreSQL server is reachable.
 * Reports actionable steps if the connection fails.
 */
'use strict';

require('dotenv').config();

const url = process.env.DATABASE_URL;

if (!url) {
    console.log('\n  DATABASE_URL is not set.');
    console.log('  The server will use SQLite (local development mode).');
    console.log('\n  To use PostgreSQL, set DATABASE_URL in .env or Render environment.\n');
    process.exit(0);
}

// Mask the password for display
const masked = url.replace(/:([^@]+)@/, ':***@');
console.log('\n  DATABASE_URL: ' + masked);
console.log('  Attempting connection...\n');

const pg = require('pg');
const pool = new pg.Pool({
    connectionString: url,
    connectionTimeoutMillis: 10000,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
});

(async () => {
    try {
        const client = await pool.connect();
        const result = await client.query('SELECT version()');
        client.release();
        console.log('  ✓ Connected successfully!');
        console.log('  ' + result.rows[0].version);

        // Check key tables
        const tables = await pool.query(
            "SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename"
        );
        console.log('\n  Tables (' + tables.rows.length + '):');
        tables.rows.forEach(r => console.log('    - ' + r.tablename));

        // Check user count
        try {
            const users = await pool.query('SELECT COUNT(*) as count FROM users');
            console.log('\n  Total users: ' + users.rows[0].count);
        } catch (_) {}

        console.log('\n  PostgreSQL is healthy.\n');
        await pool.end();
        process.exit(0);
    } catch (err) {
        console.error('  ✗ Connection failed: ' + err.message);
        console.error('');

        if (err.code === 'ENOTFOUND' || err.message.includes('getaddrinfo')) {
            console.error('  DNS resolution failed — the hostname does not exist.');
            console.error('  This usually means the Render PostgreSQL instance was deleted.');
            console.error('');
            console.error('  Fix: Provision a new PostgreSQL database in Render dashboard,');
            console.error('  then update DATABASE_URL in the web service environment.');
        } else if (err.code === 'ECONNREFUSED') {
            console.error('  Connection refused — PostgreSQL server is not listening.');
            console.error('  The server might be restarting or suspended.');
            console.error('');
            console.error('  Fix: Check the Render dashboard for PG service status.');
        } else if (err.code === 'ETIMEDOUT' || err.message.includes('timeout')) {
            console.error('  Connection timed out — server is unreachable.');
            console.error('  This could be a network issue or firewall block.');
            console.error('');
            console.error('  Fix: Check Render dashboard → PostgreSQL → Connectivity.');
        } else if (err.message.includes('password authentication failed')) {
            console.error('  Authentication failed — wrong credentials.');
            console.error('');
            console.error('  Fix: Check DATABASE_URL has the correct password.');
            console.error('  Render: Use the Internal Database URL from the PG dashboard.');
        } else if (err.message.includes('SSL')) {
            console.error('  SSL handshake failed.');
            console.error('');
            console.error('  Fix: Ensure NODE_ENV=production is set (enables SSL).');
        } else {
            console.error('  Unknown error. Check the Render PostgreSQL dashboard.');
        }

        console.error('');
        await pool.end();
        process.exit(1);
    }
})();
