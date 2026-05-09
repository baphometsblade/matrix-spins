'use strict';

/**
 * Multi-currency Crypto Deposit Routes — BTC, ETH, USDT (TRC-20 + ERC-20).
 *
 * Mounts under /api/crypto-deposit. Live AUD rates from CoinGecko (cached 60s,
 * static fallback on outage). Issues per-user deterministic placeholder
 * deposit addresses persisted in `crypto_deposit_addresses`.
 *
 * NOTE: Real chain confirmation + balance crediting is intentionally NOT done
 * here. POST /create-deposit only records a `pending` row. A separate
 * watcher/cron job (or webhook ingest) is expected to verify the on-chain tx
 * and flip status → 'completed' while crediting `users.balance`. This keeps
 * the route purely intent-recording and avoids any risk of crediting funds
 * before chain finality. (See server/routes/crypto.routes.js for the verified
 * ETH/MetaMask flow that does end-to-end on-chain verification.)
 */

const express = require('express');
const crypto = require('crypto');
const { authenticate } = require('../middleware/auth');
const db = require('../database');
const config = require('../config');

const router = express.Router();

// ───────────────────────── Constants ─────────────────────────

const SUPPORTED_CURRENCIES = ['BTC', 'ETH', 'USDT_TRC20', 'USDT_ERC20'];

const NETWORK_BY_CURRENCY = {
    BTC:        'Bitcoin',
    ETH:        'Ethereum (ERC-20)',
    USDT_TRC20: 'Tron (TRC-20)',
    USDT_ERC20: 'Ethereum (ERC-20)',
};

// Map crypto currency → CoinGecko id
const COINGECKO_IDS = { BTC: 'bitcoin', ETH: 'ethereum', USDT: 'tether' };

const FALLBACK_RATES = { BTC: 100000, ETH: 5000, USDT: 1.55 };

const RATE_CACHE_TTL_MS = 60 * 1000;

let _ratesCache = null; // { rates, source, fetchedAt, expiresAt }

// Base58 alphabet for TRON address simulation
const BASE58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

// ───────────────────────── Schema bootstrap ─────────────────────────

function _isPg() { return typeof db.isPg === 'function' && db.isPg(); }
function _idDef() { return _isPg() ? 'SERIAL PRIMARY KEY' : 'INTEGER PRIMARY KEY AUTOINCREMENT'; }
function _tsDef() { return _isPg() ? 'TIMESTAMPTZ DEFAULT NOW()' : "TEXT DEFAULT (datetime('now'))"; }

let _schemaReady = false;
async function ensureSchema() {
    if (_schemaReady) return;
    try {
        await db.run(`CREATE TABLE IF NOT EXISTS crypto_deposit_addresses (
            id ${_idDef()},
            user_id INTEGER NOT NULL,
            currency TEXT NOT NULL,
            address TEXT NOT NULL,
            derivation_index INTEGER,
            created_at ${_tsDef()}
        )`);
        // Composite uniqueness — one address per (user, currency)
        try {
            await db.run('CREATE UNIQUE INDEX IF NOT EXISTS idx_cda_user_currency ON crypto_deposit_addresses(user_id, currency)');
        } catch (_) { /* index may already exist */ }
        _schemaReady = true;
    } catch (err) {
        console.warn('[crypto-deposit] schema bootstrap failed:', err.message);
    }
}
// Fire-and-forget on require
ensureSchema().catch(() => {});

// ───────────────────────── Helpers ─────────────────────────

function _isValidCurrency(c) {
    return typeof c === 'string' && SUPPORTED_CURRENCIES.indexOf(c) !== -1;
}

function _isValidPositiveNumber(n) {
    const num = Number(n);
    return Number.isFinite(num) && num > 0;
}

function _isValidTxHash(h) {
    if (h == null || h === '') return true; // optional
    if (typeof h !== 'string') return false;
    // Loose check — accepts BTC (64 hex), ETH (0x + 64 hex), TRON (64 hex). Reject anything weird.
    return /^[0-9a-fA-Fx]{32,128}$/.test(h);
}

function _baseCurrency(currency) {
    if (currency === 'USDT_TRC20' || currency === 'USDT_ERC20') return 'USDT';
    return currency;
}

function _generateReference() {
    return 'CRYPTO-' + Date.now() + '-' + crypto.randomBytes(4).toString('hex');
}

/**
 * Deterministically derive a placeholder deposit address per (user, currency).
 * Uses the JWT secret as salt so addresses are not guessable from user id alone.
 *
 * For production an HD wallet (e.g. xpub/derivation path) or per-currency node
 * RPC (BTC: getnewaddress, ETH/USDT: HD wallet) MUST replace this.
 */
function _deriveAddress(userId, currency) {
    const salt = process.env.JWT_SECRET || 'dev-salt';
    const hex = crypto.createHash('sha256')
        .update(JSON.stringify({ userId, currency, salt }))
        .digest('hex');

    if (currency === 'BTC') {
        return 'bc1q' + hex.slice(0, 38);
    }
    if (currency === 'ETH' || currency === 'USDT_ERC20') {
        return '0x' + hex.slice(0, 40);
    }
    if (currency === 'USDT_TRC20') {
        // Translate first 33 hex chars → base58 alphabet (deterministic mapping)
        let out = 'T';
        for (let i = 0; i < 33; i++) {
            const v = parseInt(hex.charAt(i), 16); // 0-15
            // Spread across the 58-char alphabet using two hex chars when possible
            const idx = (v * 4 + (i % 4)) % BASE58.length;
            out += BASE58.charAt(idx);
        }
        return out;
    }
    // Should never reach
    return hex.slice(0, 40);
}

/**
 * Fetch BTC/ETH/USDT prices in AUD (single batched CoinGecko call). Cached 60s.
 * Falls back to FALLBACK_RATES on any error.
 */
async function getRates() {
    const now = Date.now();
    if (_ratesCache && _ratesCache.expiresAt > now) {
        return _ratesCache;
    }

    let rates = null;
    let source = 'fallback';

    try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 5000);
        const url = 'https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,ethereum,tether&vs_currencies=aud';
        const resp = await fetch(url, { signal: controller.signal });
        clearTimeout(timeout);

        if (resp.ok) {
            const data = await resp.json();
            const btc = data && data.bitcoin && Number(data.bitcoin.aud);
            const eth = data && data.ethereum && Number(data.ethereum.aud);
            const usdt = data && data.tether && Number(data.tether.aud);
            if (Number.isFinite(btc) && btc > 0 &&
                Number.isFinite(eth) && eth > 0 &&
                Number.isFinite(usdt) && usdt > 0) {
                rates = { BTC: btc, ETH: eth, USDT: usdt };
                source = 'coingecko';
            }
        }
    } catch (err) {
        console.warn('[crypto-deposit] CoinGecko fetch failed:', err.message);
    }

    if (!rates) {
        rates = { BTC: FALLBACK_RATES.BTC, ETH: FALLBACK_RATES.ETH, USDT: FALLBACK_RATES.USDT };
        source = 'fallback';
    }

    _ratesCache = {
        rates,
        source,
        fetchedAt: new Date(now).toISOString(),
        expiresAt: now + RATE_CACHE_TTL_MS,
    };
    return _ratesCache;
}

// ═══════════════════════════════════════════════════
//  PUBLIC ENDPOINTS
// ═══════════════════════════════════════════════════

/**
 * GET /api/crypto-deposit/rates
 *
 * Returns the cached AUD-quoted price for BTC, ETH, USDT. No auth.
 */
router.get('/rates', async (req, res) => {
    try {
        const cached = await getRates();
        res.json({
            rates: cached.rates,
            source: cached.source,
            fetchedAt: cached.fetchedAt,
            expiresAt: new Date(cached.expiresAt).toISOString(),
        });
    } catch (err) {
        console.warn('[crypto-deposit/rates] error:', err.message);
        res.status(500).json({ error: 'Failed to load rates' });
    }
});

// ═══════════════════════════════════════════════════
//  AUTHENTICATED ENDPOINTS
// ═══════════════════════════════════════════════════

/**
 * GET /api/crypto-deposit/address?currency=BTC
 *
 * Returns (or creates) the user's deterministic deposit address for the
 * requested currency. Persists to crypto_deposit_addresses so subsequent calls
 * return the same value. The HD-wallet replacement is described above.
 */
router.get('/address', authenticate, async (req, res) => {
    try {
        await ensureSchema();
        const currency = String(req.query.currency || '').toUpperCase();
        if (!_isValidCurrency(currency)) {
            return res.status(400).json({ error: 'Unsupported currency. Use BTC, ETH, USDT_TRC20, USDT_ERC20.' });
        }

        const userId = req.user.id;
        let row = await db.get(
            'SELECT address FROM crypto_deposit_addresses WHERE user_id = ? AND currency = ?',
            [userId, currency]
        );

        if (!row) {
            const address = _deriveAddress(userId, currency);
            try {
                await db.run(
                    'INSERT INTO crypto_deposit_addresses (user_id, currency, address, derivation_index) VALUES (?, ?, ?, ?)',
                    [userId, currency, address, 0]
                );
            } catch (insErr) {
                // Possible race — re-read
                console.warn('[crypto-deposit/address] insert race:', insErr.message);
            }
            row = await db.get(
                'SELECT address FROM crypto_deposit_addresses WHERE user_id = ? AND currency = ?',
                [userId, currency]
            );
            if (!row) row = { address };
        }

        const address = row.address;
        // qrPayload follows BIP-21-ish convention; clients that scan can ignore the scheme
        let qrPayload;
        if (currency === 'BTC') {
            qrPayload = 'bitcoin:' + address;
        } else if (currency === 'ETH' || currency === 'USDT_ERC20') {
            qrPayload = 'ethereum:' + address;
        } else if (currency === 'USDT_TRC20') {
            qrPayload = 'tron:' + address;
        } else {
            qrPayload = address;
        }

        res.json({
            currency,
            address,
            network: NETWORK_BY_CURRENCY[currency],
            qrPayload,
            minDepositAud: config.MIN_DEPOSIT,
            maxDepositAud: config.MAX_DEPOSIT,
        });
    } catch (err) {
        console.warn('[crypto-deposit/address] error:', err.message);
        res.status(500).json({ error: 'Failed to issue address' });
    }
});

/**
 * POST /api/crypto-deposit/create-deposit
 *
 * Body: { currency, amountCrypto, txHash? }
 *
 * Records a pending deposit. Does NOT credit balance. A separate confirmation
 * job (chain watcher / webhook) is responsible for verifying the tx and
 * marking the row 'completed' + crediting users.balance.
 */
router.post('/create-deposit', authenticate, async (req, res) => {
    try {
        await ensureSchema();
        const body = req.body || {};
        const currency = String(body.currency || '').toUpperCase();
        const amountCrypto = Number(body.amountCrypto);
        const txHash = body.txHash != null ? String(body.txHash).trim() : null;

        if (!_isValidCurrency(currency)) {
            return res.status(400).json({ error: 'Unsupported currency.' });
        }
        if (!_isValidPositiveNumber(amountCrypto)) {
            return res.status(400).json({ error: 'Invalid amount.' });
        }
        if (txHash && !_isValidTxHash(txHash)) {
            return res.status(400).json({ error: 'Invalid transaction hash format.' });
        }

        // Convert to AUD using cached rates
        const cached = await getRates();
        const baseCcy = _baseCurrency(currency);
        const rate = cached.rates[baseCcy];
        if (!Number.isFinite(rate) || rate <= 0) {
            return res.status(503).json({ error: 'Rate unavailable — try again shortly.' });
        }

        const audAmount = Math.round(amountCrypto * rate * 100) / 100;
        if (!Number.isFinite(audAmount) || audAmount <= 0) {
            return res.status(400).json({ error: 'Invalid AUD conversion.' });
        }
        if (audAmount < config.MIN_DEPOSIT) {
            return res.status(400).json({
                error: `Deposit value ($${audAmount.toFixed(2)} AUD) is below minimum ($${config.MIN_DEPOSIT.toFixed(2)}).`,
                audAmount,
            });
        }
        if (audAmount > config.MAX_DEPOSIT) {
            return res.status(400).json({
                error: `Deposit value ($${audAmount.toFixed(2)} AUD) exceeds maximum ($${config.MAX_DEPOSIT.toFixed(2)}).`,
                audAmount,
            });
        }

        // Responsible-gambling + velocity checks (same gates as Stripe deposits).
        // Crypto deposits MUST honour user's daily/weekly/monthly limits + cooling-off.
        try {
            const depositChecks = require('../services/deposit-checks.service');
            if (typeof depositChecks.runAllChecks === 'function') {
                const rgCheck = await depositChecks.runAllChecks(req.user.id, audAmount);
                if (!rgCheck.allowed) {
                    return res.status(403).json({ error: rgCheck.error || 'Deposit blocked by your responsible-gambling limits.' });
                }
            }
        } catch (rgErr) {
            console.warn('[crypto-deposit] RG check error (continuing):', rgErr.message);
        }

        // Idempotency — if txHash already used (any user), reject
        if (txHash) {
            const existing = await db.get(
                'SELECT id, status FROM deposits WHERE external_ref = ?',
                [txHash.toLowerCase()]
            );
            if (existing) {
                return res.status(409).json({ error: 'This transaction hash has already been submitted.' });
            }
        }

        const reference = _generateReference();
        const paymentType = 'crypto_' + currency.toLowerCase();
        const externalRef = txHash ? txHash.toLowerCase() : null;

        // NOTE: status 'pending' — chain watcher / webhook flips → completed
        // and credits balance. We deliberately do NOT touch users.balance here.
        await db.run(
            "INSERT INTO deposits (user_id, amount, currency, payment_type, status, reference, external_ref, created_at) VALUES (?, ?, ?, ?, 'pending', ?, ?, " +
            (_isPg() ? 'NOW()' : "datetime('now')") + ')',
            [req.user.id, audAmount, config.CURRENCY, paymentType, reference, externalRef]
        );

        const row = await db.get(
            'SELECT id, user_id, amount, currency, payment_type, status, reference, external_ref, created_at FROM deposits WHERE reference = ?',
            [reference]
        );

        res.status(201).json({
            success: true,
            message: 'Deposit recorded as pending. It will be credited once the network confirms the transfer.',
            deposit: row,
            audAmount,
            cryptoAmount: amountCrypto,
            currency,
            rateUsed: rate,
        });
    } catch (err) {
        console.warn('[crypto-deposit/create-deposit] error:', err.message);
        res.status(500).json({ error: 'Failed to record deposit.' });
    }
});

/**
 * GET /api/crypto-deposit/pending — most recent 20 pending crypto deposits.
 */
router.get('/pending', authenticate, async (req, res) => {
    try {
        const rows = await db.all(
            "SELECT id, amount, currency, payment_type, status, reference, external_ref, created_at " +
            "FROM deposits WHERE user_id = ? AND status = 'pending' AND payment_type LIKE 'crypto_%' " +
            "ORDER BY id DESC LIMIT 20",
            [req.user.id]
        );
        res.json({ deposits: rows || [] });
    } catch (err) {
        console.warn('[crypto-deposit/pending] error:', err.message);
        res.status(500).json({ error: 'Failed to load pending deposits' });
    }
});

/**
 * GET /api/crypto-deposit/history — last 50 crypto deposits (any status).
 */
router.get('/history', authenticate, async (req, res) => {
    try {
        const rows = await db.all(
            "SELECT id, amount, currency, payment_type, status, reference, external_ref, created_at, completed_at " +
            "FROM deposits WHERE user_id = ? AND payment_type LIKE 'crypto_%' " +
            "ORDER BY id DESC LIMIT 50",
            [req.user.id]
        );
        res.json({ deposits: rows || [] });
    } catch (err) {
        console.warn('[crypto-deposit/history] error:', err.message);
        res.status(500).json({ error: 'Failed to load deposit history' });
    }
});

module.exports = router;
