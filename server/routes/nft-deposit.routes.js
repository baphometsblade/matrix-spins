/**
 * NFT Deposit System — server/routes/nft-deposit.routes.js
 *
 * Flow: User deposits via Stripe → Stripe webhook confirms → Mint NFT → Credit balance
 * Each deposit creates a unique NFT (database record) owned by the user.
 * The NFT represents the user's "credit token" in the casino.
 * All money goes to the owner's Stripe account (acct_1NVVDUEs7PHC7HDV).
 */
'use strict';

const express = require('express');
const router = express.Router();
const config = require('../config');
const crypto = require('crypto');
const { getBackend } = require('../database');
// ROUND 33: Import authenticate middleware for user-facing endpoints
const { authenticate } = require('../middleware/auth');

// ── Ensure NFT tables exist ──
async function ensureNFTTables() {
    const db = getBackend();
    await db.run(`CREATE TABLE IF NOT EXISTS nfts (
        id TEXT PRIMARY KEY,
        user_id INTEGER NOT NULL,
        amount REAL NOT NULL,
        name TEXT NOT NULL,
        description TEXT,
        metadata TEXT,
        status TEXT DEFAULT 'active',
        minted_at TEXT DEFAULT (datetime('now')),
        burned_at TEXT,
        stripe_payment_id TEXT,
        FOREIGN KEY (user_id) REFERENCES users(id)
    )`);
    await db.run(`CREATE TABLE IF NOT EXISTS withdrawal_requests (
        id TEXT PRIMARY KEY,
        user_id INTEGER NOT NULL,
        amount REAL NOT NULL,
        nft_id TEXT,
        method TEXT DEFAULT 'stripe',
        account_details TEXT,
        status TEXT DEFAULT 'pending',
        admin_notes TEXT,
        requested_at TEXT DEFAULT (datetime('now')),
        processed_at TEXT,
        processed_by TEXT,
        stripe_payout_id TEXT,
        FOREIGN KEY (user_id) REFERENCES users(id),
        FOREIGN KEY (nft_id) REFERENCES nfts(id)
    )`);
    console.warn('[NFT] Tables ensured');
}

// ── Mint NFT on successful deposit ──
function generateNFTId() {
    return 'NFT-' + Date.now().toString(36).toUpperCase() + '-' + crypto.randomBytes(4).toString('hex').toUpperCase();
}

function generateNFTName(amount) {
    if (amount >= 250) return 'Diamond Casino Token';
    if (amount >= 100) return 'Gold Casino Token';
    if (amount >= 50) return 'Silver Casino Token';
    if (amount >= 25) return 'Bronze Casino Token';
    return 'Casino Token';
}

// SECURITY: Mint endpoint requires webhook secret or admin auth.
// Previously had NO authentication — anyone could POST to credit arbitrary users.
router.post('/nft/mint-on-deposit', async (req, res) => {
    try {
        // ── Validate webhook secret (same constant-time pattern as payment webhook) ──
        const webhookSecret = req.headers['x-webhook-secret'] || req.body.webhookSecret;
        const expectedSecret = process.env.WEBHOOK_SECRET;
        if (!expectedSecret || !webhookSecret || typeof webhookSecret !== 'string') {
            return res.status(401).json({ error: 'Authentication required' });
        }
        try {
            const isValid = crypto.timingSafeEqual(
                Buffer.from(webhookSecret, 'utf8'),
                Buffer.from(expectedSecret, 'utf8')
            );
            if (!isValid) return res.status(401).json({ error: 'Invalid credentials' });
        } catch (_) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }

        // ── Input validation ──
        const userId = parseInt(req.body.userId, 10);
        const amount = parseFloat(req.body.amount);
        const stripePaymentId = req.body.stripePaymentId || null;

        if (!Number.isInteger(userId) || userId <= 0) {
            return res.status(400).json({ error: 'userId must be a positive integer' });
        }
        if (!Number.isFinite(amount) || amount <= 0 || amount > 50000) {
            return res.status(400).json({ error: 'amount must be between 0.01 and 50000' });
        }
        // Require a non-empty stripePaymentId so the idempotency check below
        // cannot be bypassed by omitting the field. Without this, a replayed
        // webhook without stripePaymentId would mint duplicate NFTs and
        // credit the user multiple times.
        if (!stripePaymentId || typeof stripePaymentId !== 'string' || stripePaymentId.length < 4) {
            return res.status(400).json({ error: 'stripePaymentId is required and must be a non-empty string' });
        }

        const db = getBackend();
        await ensureNFTTables();

        // ROUND 33: CRITICAL — Idempotency check on stripePaymentId.
        // Was missing entirely — same payment ID could mint unlimited NFTs.
        const existingMint = await db.get(
            'SELECT id FROM nfts WHERE stripe_payment_id = ? LIMIT 1',
            [stripePaymentId]
        );
        if (existingMint) {
            return res.json({ success: true, duplicate: true, nftId: existingMint.id });
        }

        const nftId = generateNFTId();
        const nftName = generateNFTName(amount);
        const metadata = JSON.stringify({
            type: 'casino_credit',
            denomination: amount,
            mintedBy: 'matrix-spins',
            chain: 'internal',
            stripePaymentId: stripePaymentId
        });

        // ── Wrap mint + balance credit in transaction ──
        await db.beginTransaction();
        try {
            await db.run(
                `INSERT INTO nfts (id, user_id, amount, name, description, metadata, stripe_payment_id)
                 VALUES (?, ?, ?, ?, ?, ?, ?)`,
                [nftId, userId, amount, nftName, `$${amount} Casino Credit NFT`, metadata, stripePaymentId]
            );

            await db.run(
                `UPDATE users SET balance = balance + ? WHERE id = ?`,
                [amount, userId]
            );

            await db.commit();
        } catch (txErr) {
            try { await db.rollback(); } catch (rbErr) { console.warn('[NFTDeposit] Rollback failed:', rbErr.message || rbErr); }
            throw txErr;
        }

        const user = await db.get(`SELECT balance FROM users WHERE id = ?`, [userId]);

        console.warn(`[NFT] Minted ${nftId} for user ${userId}: $${amount}`);

        res.json({
            success: true,
            nft: {
                id: nftId,
                name: nftName,
                amount: amount,
                status: 'active'
            },
            newBalance: user ? user.balance : null
        });
    } catch (err) {
        console.error('[NFT] Mint error:', err.message);
        res.status(500).json({ error: 'Failed to mint NFT' });
    }
});

// ── Get user's NFTs ──
// ROUND 33: Added authenticate middleware (was missing — relied on optional req.user)
router.get('/nft/my-nfts', authenticate, async (req, res) => {
    try {
        const userId = req.user.id;

        const db = getBackend();
        await ensureNFTTables();

        const nfts = await db.all(
            `SELECT id, amount, name, description, status, minted_at FROM nfts WHERE user_id = ? ORDER BY minted_at DESC LIMIT 100`,
            [userId]
        );

        res.json({ nfts });
    } catch (err) {
        console.error('[NFT] List error:', err.message);
        res.status(500).json({ error: 'Failed to list NFTs' });
    }
});

// SECURITY 2026-05-08: /nft/request-withdrawal route removed.
// It bypassed every withdrawal safeguard (KYC, AML, wagering, OTP,
// velocity, deposit-hold) — only checked balance >= amount.
// Use /api/payment/withdraw which enforces them all.

module.exports = { router, ensureNFTTables };