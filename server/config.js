'use strict';

/**
 * Environment configuration.
 *
 * No fallbacks. Every secret must come from the environment; the
 * server refuses to start if a required value is missing. Copy
 * `.env.example` to `.env` (dev) or set these in your host's
 * dashboard (prod) before running.
 */

require('dotenv').config();

const NODE_ENV = process.env.NODE_ENV || 'development';
const PORT = parseInt(process.env.PORT, 10) || 3000;

function requireEnv(name) {
    const v = process.env[name];
    if (typeof v !== 'string' || v.trim() === '') {
        console.error('[config] FATAL: required environment variable ' + name + ' is not set.');
        console.error('[config] Copy .env.example to .env and fill every required value before starting.');
        process.exit(1);
    }
    return v;
}

function requireAll(names) {
    const missing = names.filter(n => !process.env[n] || !String(process.env[n]).trim());
    if (missing.length) {
        console.error('[config] FATAL: the following environment variables are required and not set:');
        missing.forEach(n => console.error('  - ' + n));
        console.error('[config] Copy .env.example to .env and fill every required value before starting.');
        process.exit(1);
    }
}

// ── Core secrets — ALWAYS required, no fallback in any environment ──
requireAll(['JWT_SECRET', 'ADMIN_PASSWORD', 'NFT_SIGNING_SECRET']);
const JWT_SECRET = process.env.JWT_SECRET;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
const NFT_SIGNING_SECRET = process.env.NFT_SIGNING_SECRET;

// ── Database — Postgres via DATABASE_URL, or SQLite via explicit
//    SQLITE_FILE opt-in. Setting SQLITE_FILE in production is allowed
//    but logged as a warning since it loses data on redeploy.
const DATABASE_URL = (process.env.DATABASE_URL || '').trim();
const SQLITE_FILE = (process.env.SQLITE_FILE || '').trim();
if (!DATABASE_URL && !SQLITE_FILE) {
    console.error('[config] FATAL: set DATABASE_URL (Postgres) or SQLITE_FILE (single-instance SQLite).');
    console.error('[config] There is no default — the server will not fall back to an in-memory database.');
    process.exit(1);
}
if (NODE_ENV === 'production' && !DATABASE_URL && SQLITE_FILE) {
    console.warn('[config] WARNING: production is configured with SQLITE_FILE. Data will be lost on every redeploy; set DATABASE_URL for Postgres.');
}

// ── Stripe — required in production. In dev, all three can be absent
//    (deposit endpoint returns 503) but partial config is rejected. ──
const STRIPE_SECRET_KEY = (process.env.STRIPE_SECRET_KEY || '').trim();
const STRIPE_PUBLISHABLE_KEY = (process.env.STRIPE_PUBLISHABLE_KEY || '').trim();
const STRIPE_WEBHOOK_SECRET = (process.env.STRIPE_WEBHOOK_SECRET || '').trim();
const stripeFlags = [!!STRIPE_SECRET_KEY, !!STRIPE_PUBLISHABLE_KEY, !!STRIPE_WEBHOOK_SECRET];
const stripeSet = stripeFlags.filter(Boolean).length;
if (stripeSet !== 0 && stripeSet !== 3) {
    console.error('[config] FATAL: Stripe env vars are partially configured. Set all three or none:');
    console.error('  STRIPE_SECRET_KEY, STRIPE_PUBLISHABLE_KEY, STRIPE_WEBHOOK_SECRET');
    process.exit(1);
}
if (NODE_ENV === 'production' && stripeSet === 0) {
    console.error('[config] FATAL: Stripe must be configured in production. Set STRIPE_SECRET_KEY, STRIPE_PUBLISHABLE_KEY, STRIPE_WEBHOOK_SECRET.');
    process.exit(1);
}

// ── SMTP — required in production so deposit receipts and password
//    resets actually send. Partial config is rejected everywhere. ──
const SMTP_HOST = (process.env.SMTP_HOST || '').trim();
const SMTP_PORT = parseInt(process.env.SMTP_PORT, 10) || 0;
const SMTP_USER = (process.env.SMTP_USER || '').trim();
const SMTP_PASS = process.env.SMTP_PASS || '';
const SMTP_FROM = (process.env.SMTP_FROM || '').trim();
const smtpFlags = [!!SMTP_HOST, !!SMTP_PORT, !!SMTP_FROM];
const smtpSet = smtpFlags.filter(Boolean).length;
if (smtpSet !== 0 && smtpSet !== 3) {
    console.error('[config] FATAL: SMTP is partially configured. Set all required SMTP_* vars or none:');
    console.error('  SMTP_HOST, SMTP_PORT, SMTP_FROM  (+ SMTP_USER, SMTP_PASS if your provider requires auth)');
    process.exit(1);
}
if (NODE_ENV === 'production' && smtpSet === 0) {
    console.error('[config] FATAL: SMTP must be configured in production (password resets and deposit receipts depend on it).');
    process.exit(1);
}

// ── Other ──
const ALLOWED_ORIGIN = (process.env.ALLOWED_ORIGIN || '').trim();
const PUBLIC_URL = (process.env.PUBLIC_URL || '').trim();
if (NODE_ENV === 'production' && !PUBLIC_URL) {
    console.error('[config] FATAL: PUBLIC_URL must be set in production (used for Stripe success/cancel URLs and reset links).');
    process.exit(1);
}
if (NODE_ENV === 'production' && !ALLOWED_ORIGIN) {
    console.error('[config] FATAL: ALLOWED_ORIGIN must be set in production.');
    process.exit(1);
}

const NFT_PROVIDER = (process.env.NFT_PROVIDER || 'db').toLowerCase();

module.exports = {
    NODE_ENV,
    PORT,
    JWT_SECRET,
    ADMIN_PASSWORD,
    DATABASE_URL,
    SQLITE_FILE,
    STRIPE_SECRET_KEY,
    STRIPE_PUBLISHABLE_KEY,
    STRIPE_WEBHOOK_SECRET,
    SMTP_HOST,
    SMTP_PORT,
    SMTP_USER,
    SMTP_PASS,
    SMTP_FROM,
    ALLOWED_ORIGIN,
    PUBLIC_URL: PUBLIC_URL || ('http://localhost:' + PORT),
    NFT_PROVIDER,
    NFT_SIGNING_SECRET,
    hasStripe: stripeSet === 3,
    hasWebhookSecret: !!STRIPE_WEBHOOK_SECRET,
    hasSmtp: smtpSet === 3,
};
