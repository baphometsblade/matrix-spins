'use strict';

/**
 * Payment Methods Management
 *
 *   GET    /api/payment-methods/list          — list user's saved methods
 *   POST   /api/payment-methods/add           — add a new method
 *   PUT    /api/payment-methods/:id/default   — mark as default
 *   DELETE /api/payment-methods/:id           — remove a method
 *   GET    /api/payment-methods/limits        — deposit/withdrawal limits
 *
 * Sensitive material (raw card PAN / CVV / full bank account) is NEVER
 * persisted. Only the last 4 digits are kept (in the label) for display.
 * For crypto, the wallet address is stored verbatim (it is already public).
 *
 * The `details_encrypted` column is populated with an AES-256-GCM blob of a
 * minimal JSON payload (e.g. last4 + brand + masked exp) so we can audit
 * what was stored without ever exposing card numbers.
 */

const express = require('express');
const crypto = require('crypto');
const router = express.Router();

const db = require('../database');
const config = require('../config');
const { authenticate } = require('../middleware/auth');

// ─── Constants ──────────────────────────────────────────────

const VALID_TYPES = new Set([
    'visa', 'mastercard', 'payid', 'bank_transfer',
    'crypto_btc', 'crypto_eth', 'crypto_usdt'
]);
const CARD_TYPES = new Set(['visa', 'mastercard']);
const BANK_TYPES = new Set(['payid', 'bank_transfer']);
const CRYPTO_TYPES = new Set(['crypto_btc', 'crypto_eth', 'crypto_usdt']);

// ─── Encryption helpers ─────────────────────────────────────

// Derive a 32-byte key from JWT_SECRET so we can rotate via env.
function _key() {
    return crypto.createHash('sha256').update(String(config.JWT_SECRET || '')).digest();
}

function encryptDetails(obj) {
    try {
        const iv = crypto.randomBytes(12);
        const cipher = crypto.createCipheriv('aes-256-gcm', _key(), iv);
        const plain = Buffer.from(JSON.stringify(obj || {}), 'utf8');
        const enc = Buffer.concat([cipher.update(plain), cipher.final()]);
        const tag = cipher.getAuthTag();
        return Buffer.concat([iv, tag, enc]).toString('base64');
    } catch (_e) {
        return null;
    }
}

// ─── Validation helpers ─────────────────────────────────────

function luhnCheck(num) {
    const s = String(num || '').replace(/\D/g, '');
    if (s.length < 12 || s.length > 19) return false;
    let sum = 0, alt = false;
    for (let i = s.length - 1; i >= 0; i--) {
        let n = parseInt(s.charAt(i), 10);
        if (alt) { n *= 2; if (n > 9) n -= 9; }
        sum += n;
        alt = !alt;
    }
    return sum % 10 === 0;
}

function detectCardBrand(num) {
    const s = String(num || '').replace(/\D/g, '');
    if (/^4/.test(s)) return 'visa';
    if (/^(5[1-5]|2[2-7])/.test(s)) return 'mastercard';
    return null;
}

function validExpiry(month, year) {
    const m = parseInt(month, 10);
    const y = parseInt(year, 10);
    if (!Number.isInteger(m) || !Number.isInteger(y)) return false;
    if (m < 1 || m > 12) return false;
    const fullYear = y < 100 ? 2000 + y : y;
    if (fullYear < 2024 || fullYear > 2099) return false;
    const now = new Date();
    const exp = new Date(fullYear, m, 0, 23, 59, 59);
    return exp >= now;
}

function sanitizeLabel(s, max = 80) {
    return String(s || '').replace(/[<>"'`]/g, '').trim().slice(0, max);
}

function isLikelyCryptoAddress(addr, network) {
    const a = String(addr || '').trim();
    if (a.length < 20 || a.length > 120) return false;
    // Conservative character set across BTC/ETH/USDT (TRC20/ERC20)
    if (!/^[A-Za-z0-9]+$/.test(a)) return false;
    const n = String(network || '').toLowerCase();
    if (n && !['btc', 'eth', 'erc20', 'trc20', 'bsc', 'polygon', 'matic', 'tron'].includes(n)) {
        return false;
    }
    return true;
}

// ─── Route helpers ─────────────────────────────────────────

function publicRow(row) {
    if (!row) return null;
    return {
        id: row.id,
        type: row.type,
        label: row.label,
        last4: row.last4 || null,
        is_default: !!row.is_default,
        is_verified: !!row.is_verified,
        created_at: row.created_at,
    };
}

// Tries to extract a last4 hint from a stored masked label like "Visa •••• 4242"
function last4FromLabel(label) {
    const m = String(label || '').match(/(\d{4})\s*$/);
    return m ? m[1] : null;
}

// ─── GET /list ──────────────────────────────────────────────

router.get('/list', authenticate, async (req, res) => {
    try {
        const rows = await db.all(
            'SELECT id, type, label, is_default, is_verified, created_at FROM payment_methods WHERE user_id = ? ORDER BY is_default DESC, created_at DESC',
            [req.user.id]
        );
        const methods = (rows || []).map(r => publicRow({ ...r, last4: last4FromLabel(r.label) }));
        res.json({ success: true, methods });
    } catch (err) {
        console.error('[payment-methods/list]', err);
        res.status(500).json({ error: 'Failed to load payment methods' });
    }
});

// ─── POST /add ──────────────────────────────────────────────

router.post('/add', authenticate, async (req, res) => {
    try {
        const { type, label, details } = req.body || {};
        if (!type || typeof type !== 'string' || !VALID_TYPES.has(type)) {
            return res.status(400).json({ error: 'Invalid payment method type' });
        }
        if (!details || typeof details !== 'object') {
            return res.status(400).json({ error: 'Missing details' });
        }

        let storedLabel = sanitizeLabel(label);
        let last4 = null;
        let safePayload = {};

        if (CARD_TYPES.has(type)) {
            const { cardNumber, expMonth, expYear } = details;
            const digits = String(cardNumber || '').replace(/\D/g, '');
            if (!luhnCheck(digits)) {
                return res.status(400).json({ error: 'Invalid card number' });
            }
            const brand = detectCardBrand(digits);
            if (!brand || brand !== type) {
                return res.status(400).json({ error: 'Card number does not match selected brand' });
            }
            if (!validExpiry(expMonth, expYear)) {
                return res.status(400).json({ error: 'Invalid or expired card date' });
            }
            last4 = digits.slice(-4);
            const brandName = brand === 'visa' ? 'Visa' : 'Mastercard';
            storedLabel = storedLabel || `${brandName} •••• ${last4}`;
            const mm = String(parseInt(expMonth, 10)).padStart(2, '0');
            const yy = String(parseInt(expYear, 10) % 100).padStart(2, '0');
            safePayload = { brand, last4, exp: `${mm}/${yy}` };
        } else if (BANK_TYPES.has(type)) {
            const { bsb, accountNumber } = details;
            const acct = String(accountNumber || '').replace(/\D/g, '');
            const bsbDigits = String(bsb || '').replace(/\D/g, '');
            if (acct.length < 4 || acct.length > 20) {
                return res.status(400).json({ error: 'Invalid account number' });
            }
            if (bsbDigits && (bsbDigits.length < 4 || bsbDigits.length > 9)) {
                return res.status(400).json({ error: 'Invalid BSB' });
            }
            last4 = acct.slice(-4);
            const typeName = type === 'payid' ? 'PayID' : 'Bank';
            storedLabel = storedLabel || `${typeName} •••• ${last4}`;
            safePayload = {
                last4,
                bsb_last4: bsbDigits ? bsbDigits.slice(-4) : null,
            };
        } else if (CRYPTO_TYPES.has(type)) {
            const { walletAddress, network } = details;
            if (!isLikelyCryptoAddress(walletAddress, network)) {
                return res.status(400).json({ error: 'Invalid wallet address' });
            }
            const addr = String(walletAddress).trim();
            const tail = addr.slice(-4);
            last4 = tail;
            const coin = type.replace('crypto_', '').toUpperCase();
            storedLabel = storedLabel || `${coin} ${addr.slice(0, 6)}…${tail}`;
            safePayload = { walletAddress: addr, network: String(network || '').toLowerCase() || null };
        }

        const encrypted = encryptDetails(safePayload);

        // Detect if this is the user's first method — if so, mark default.
        const existing = await db.get(
            'SELECT COUNT(*)::int AS n FROM payment_methods WHERE user_id = ?',
            [req.user.id]
        ).catch(async () => {
            // Sqlite path: no ::int cast
            return await db.get('SELECT COUNT(*) AS n FROM payment_methods WHERE user_id = ?', [req.user.id]);
        });
        const count = parseInt((existing && (existing.n != null ? existing.n : existing['COUNT(*)'])) || 0, 10);
        const makeDefault = count === 0 ? 1 : 0;

        const isPg = typeof db.isPg === 'function' && db.isPg();

        let createdId = null;
        if (isPg) {
            const row = await db.get(
                'INSERT INTO payment_methods (user_id, type, label, details_encrypted, is_default, is_verified) VALUES (?, ?, ?, ?, ?, 0) RETURNING id',
                [req.user.id, type, storedLabel, encrypted, makeDefault]
            );
            createdId = row && row.id;
        } else {
            const result = await db.run(
                'INSERT INTO payment_methods (user_id, type, label, details_encrypted, is_default, is_verified) VALUES (?, ?, ?, ?, ?, 0)',
                [req.user.id, type, storedLabel, encrypted, makeDefault]
            );
            createdId = result && (result.lastInsertRowid || result.lastID);
        }

        const created = await db.get(
            'SELECT id, type, label, is_default, is_verified, created_at FROM payment_methods WHERE id = ? AND user_id = ?',
            [createdId, req.user.id]
        );

        res.status(201).json({
            success: true,
            method: publicRow({ ...created, last4 }),
        });
    } catch (err) {
        console.error('[payment-methods/add]', err);
        res.status(500).json({ error: 'Failed to add payment method' });
    }
});

// ─── PUT /:id/default ───────────────────────────────────────

router.put('/:id/default', authenticate, async (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (!Number.isInteger(id) || id <= 0) {
        return res.status(400).json({ error: 'Invalid id' });
    }
    let inTx = false;
    try {
        const owned = await db.get(
            'SELECT id FROM payment_methods WHERE id = ? AND user_id = ?',
            [id, req.user.id]
        );
        if (!owned) return res.status(404).json({ error: 'Not found' });

        // Atomic: clear all defaults for this user, then set the new one.
        try { await db.beginTransaction(); inTx = true; } catch (_e) { inTx = false; }

        await db.run(
            'UPDATE payment_methods SET is_default = 0 WHERE user_id = ?',
            [req.user.id]
        );
        await db.run(
            'UPDATE payment_methods SET is_default = 1 WHERE id = ? AND user_id = ?',
            [id, req.user.id]
        );

        if (inTx) { await db.commit(); inTx = false; }

        res.json({ success: true });
    } catch (err) {
        if (inTx) { try { await db.rollback(); } catch (_e) {} }
        console.error('[payment-methods/default]', err);
        res.status(500).json({ error: 'Failed to set default' });
    }
});

// ─── DELETE /:id ────────────────────────────────────────────

router.delete('/:id', authenticate, async (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (!Number.isInteger(id) || id <= 0) {
        return res.status(400).json({ error: 'Invalid id' });
    }
    try {
        const row = await db.get(
            'SELECT id, is_default FROM payment_methods WHERE id = ? AND user_id = ?',
            [id, req.user.id]
        );
        if (!row) return res.status(404).json({ error: 'Not found' });

        await db.run(
            'DELETE FROM payment_methods WHERE id = ? AND user_id = ?',
            [id, req.user.id]
        );

        // If we removed the default, promote the most recent surviving method.
        if (row.is_default) {
            const next = await db.get(
                'SELECT id FROM payment_methods WHERE user_id = ? ORDER BY created_at DESC LIMIT 1',
                [req.user.id]
            );
            if (next) {
                await db.run(
                    'UPDATE payment_methods SET is_default = 1 WHERE id = ? AND user_id = ?',
                    [next.id, req.user.id]
                );
            }
        }

        res.json({ success: true });
    } catch (err) {
        console.error('[payment-methods/delete]', err);
        res.status(500).json({ error: 'Failed to delete payment method' });
    }
});

// ─── GET /limits ────────────────────────────────────────────

router.get('/limits', authenticate, async (_req, res) => {
    res.json({
        minDeposit: config.MIN_DEPOSIT,
        maxDeposit: config.MAX_DEPOSIT,
        minWithdrawal: config.MIN_WITHDRAWAL,
        maxWithdrawal: config.MAX_WITHDRAWAL,
        currency: 'AUD',
    });
});

module.exports = router;
