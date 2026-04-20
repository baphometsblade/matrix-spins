'use strict';

/**
 * Environment configuration.
 * Loaded by ./index.js before any other require, so every module can
 * `require('./config')` and get consistent values.
 */

require('dotenv').config();

const crypto = require('crypto');

function randomToken(bytes) {
    return crypto.randomBytes(bytes).toString('hex');
}

const NODE_ENV = process.env.NODE_ENV || 'development';
const PORT = parseInt(process.env.PORT, 10) || 3000;

// Secrets — generated randomly if missing so dev works out-of-the-box.
// Production MUST set these in the environment; server/index.js refuses
// to start if the dev defaults are detected in production.
const JWT_SECRET = process.env.JWT_SECRET || randomToken(32);
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || randomToken(8);

const DATABASE_URL = process.env.DATABASE_URL || '';
const SQLITE_FILE = process.env.SQLITE_FILE || './server/data.sqlite';

// Stripe keys — optional; if absent the deposit endpoint responds with
// a clear "payments not configured" error rather than silently failing.
const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || '';
const STRIPE_PUBLISHABLE_KEY = process.env.STRIPE_PUBLISHABLE_KEY || '';
const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET || '';

const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || '';
const PUBLIC_URL = process.env.PUBLIC_URL || 'http://localhost:' + PORT;

// NFT receipt configuration. v1 persists signed receipts in our DB; if an
// on-chain provider is configured later, mint.service.js routes to it.
const NFT_PROVIDER = (process.env.NFT_PROVIDER || 'db').toLowerCase();
const NFT_SIGNING_SECRET = process.env.NFT_SIGNING_SECRET || randomToken(32);

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
    ALLOWED_ORIGIN,
    PUBLIC_URL,
    NFT_PROVIDER,
    NFT_SIGNING_SECRET,
    hasStripe: !!STRIPE_SECRET_KEY,
    hasWebhookSecret: !!STRIPE_WEBHOOK_SECRET,
};
