#!/usr/bin/env node
'use strict';

/**
 * Pre-deploy preflight check.
 *
 * Validates that every required environment variable is set, pings
 * the database (Postgres or the SQLite path), pings the Stripe API,
 * and verifies the SMTP transport. Exits 1 on any failure so a CI
 * job can gate deploys on success.
 *
 *   $ node scripts/preflight.js
 *
 * Skips Stripe + SMTP checks if the corresponding keys aren't set
 * (they'd already be required by config.js in production; in dev
 * absence is allowed).
 */

const REQUIRED = ['NODE_ENV', 'JWT_SECRET', 'ADMIN_PASSWORD', 'NFT_SIGNING_SECRET'];
const REQUIRED_PROD_EXTRA = ['PUBLIC_URL', 'ALLOWED_ORIGIN'];

let failed = false;

function ok(msg) { console.log('  ✓ ' + msg); }
function fail(msg) { console.error('  ✗ ' + msg); failed = true; }
function warn(msg) { console.warn('  · ' + msg); }
function section(title) { console.log('\n[' + title + ']'); }

async function main() {
    require('dotenv').config();

    section('Environment');
    REQUIRED.forEach(name => {
        if (!process.env[name] || !String(process.env[name]).trim()) fail(name + ' is not set');
        else ok(name + ' set (' + (name.endsWith('PASSWORD') || name.endsWith('SECRET') ? 'redacted' : process.env[name]) + ')');
    });
    if (process.env.NODE_ENV === 'production') {
        REQUIRED_PROD_EXTRA.forEach(name => {
            if (!process.env[name] || !String(process.env[name]).trim()) fail(name + ' is not set (required in production)');
            else ok(name + ' = ' + process.env[name]);
        });
    }

    section('Database');
    if (!process.env.DATABASE_URL && !process.env.SQLITE_FILE) {
        fail('DATABASE_URL and SQLITE_FILE are both unset');
    } else if (process.env.DATABASE_URL) {
        try {
            const { Pool } = require('pg');
            const pool = new Pool({
                connectionString: process.env.DATABASE_URL,
                ssl: /sslmode=require/.test(process.env.DATABASE_URL) ? { rejectUnauthorized: false } : false,
            });
            const t0 = Date.now();
            const r = await pool.query('SELECT 1 AS ok');
            ok('Postgres ping ' + (Date.now() - t0) + 'ms (rows: ' + r.rowCount + ')');
            await pool.end();
        } catch (err) {
            fail('Postgres ping failed: ' + err.message);
        }
    } else {
        const fs = require('fs');
        const path = require('path');
        const dir = path.dirname(path.resolve(process.env.SQLITE_FILE));
        try {
            fs.mkdirSync(dir, { recursive: true });
            ok('SQLITE_FILE writable directory: ' + dir);
            if (process.env.NODE_ENV === 'production') warn('Production with SQLITE_FILE — data is lost on every redeploy');
        } catch (err) {
            fail('SQLITE_FILE directory not writable: ' + err.message);
        }
    }

    section('Stripe');
    const sk = process.env.STRIPE_SECRET_KEY;
    const pk = process.env.STRIPE_PUBLISHABLE_KEY;
    const ws = process.env.STRIPE_WEBHOOK_SECRET;
    const stripeFlags = [!!sk, !!pk, !!ws].filter(Boolean).length;
    if (stripeFlags === 0) {
        warn('Stripe not configured — deposits disabled (config.js will refuse to start in production)');
    } else if (stripeFlags !== 3) {
        fail('Stripe partially configured — set STRIPE_SECRET_KEY, STRIPE_PUBLISHABLE_KEY, STRIPE_WEBHOOK_SECRET together');
    } else {
        try {
            const Stripe = require('stripe');
            const stripe = new Stripe(sk);
            const t0 = Date.now();
            const acct = await stripe.balance.retrieve();
            ok('Stripe ping ' + (Date.now() - t0) + 'ms (livemode: ' + (acct.livemode ? 'YES' : 'no') + ')');
            if (acct.livemode && /^sk_test_/.test(sk)) fail('STRIPE_SECRET_KEY is a test key but Stripe reports livemode — investigate');
            if (!acct.livemode && process.env.NODE_ENV === 'production') warn('Production deploy with Stripe TEST keys — no real money will move');
        } catch (err) {
            fail('Stripe ping failed: ' + err.message);
        }
    }

    section('SMTP');
    const smtp = ['SMTP_HOST', 'SMTP_PORT', 'SMTP_FROM'];
    const smtpSet = smtp.filter(n => !!process.env[n]).length;
    if (smtpSet === 0) {
        warn('SMTP not configured — emails will be dropped (config.js refuses to start in production)');
    } else if (smtpSet !== smtp.length) {
        fail('SMTP partially configured — set SMTP_HOST, SMTP_PORT, SMTP_FROM together (SMTP_USER/SMTP_PASS optional)');
    } else {
        try {
            const nodemailer = require('nodemailer');
            const t = nodemailer.createTransport({
                host: process.env.SMTP_HOST,
                port: parseInt(process.env.SMTP_PORT, 10) || 587,
                secure: parseInt(process.env.SMTP_PORT, 10) === 465,
                auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined,
            });
            const t0 = Date.now();
            await t.verify();
            ok('SMTP verify ' + (Date.now() - t0) + 'ms');
        } catch (err) {
            fail('SMTP verify failed: ' + err.message);
        }
    }

    section('Result');
    if (failed) {
        console.error('  ✗ Preflight FAILED — fix the above before deploying.\n');
        process.exit(1);
    }
    console.log('  ✓ Preflight passed.\n');
}

main().catch(err => {
    console.error('\n[fatal]', err);
    process.exit(1);
});
