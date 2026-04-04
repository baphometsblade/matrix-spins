/**
 * Crypto Payment Routes — MetaMask / Ethereum deposit & withdrawal verification.
 *
 * Flow:
 *   1. Client fetches ETH/AUD rate from GET /api/crypto/rate
 *   2. Client connects MetaMask & sends ETH to the configured wallet
 *   3. Client posts tx hash to POST /api/crypto/verify-deposit
 *   4. Server waits for on-chain confirmation, credits AUD balance
 *
 * Requires:
 *   CRYPTO_WALLET_ADDRESS  — the owner's MetaMask receiving address
 *   ETH_RPC_URL            — Ethereum JSON-RPC endpoint (default: public Cloudflare)
 */

'use strict';

const express = require('express');
const { authenticate } = require('../middleware/auth');
const db = require('../database');
const config = require('../config');
const crypto = require('crypto');
const { mintOnDeposit } = require('../services/nft-ledger');

const router = express.Router();

// ─── Config ───

const WALLET_ADDRESS = (process.env.CRYPTO_WALLET_ADDRESS || '').toLowerCase();
const ETH_RPC_URL = process.env.ETH_RPC_URL || 'https://cloudflare-eth.com';
const ETH_CHAIN_ID = parseInt(process.env.ETH_CHAIN_ID, 10) || 1; // 1 = mainnet
const MIN_CONFIRMATIONS = parseInt(process.env.CRYPTO_MIN_CONFIRMATIONS, 10) || 2;

// Cache ETH price for 60 seconds to avoid hammering the API
let cachedPrice = null;
let cachedPriceTime = 0;
const PRICE_CACHE_TTL = 60 * 1000; // 60 seconds

// ─── Helpers ───

function generateReference(prefix) {
    return `${prefix}-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
}

/**
 * Fetch ETH price in AUD from CoinGecko free API.
 * Falls back to a configurable static rate if the API is unreachable.
 */
async function getEthPriceAUD() {
    const now = Date.now();
    if (cachedPrice && (now - cachedPriceTime) < PRICE_CACHE_TTL) {
        return cachedPrice;
    }

    try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 5000);

        const resp = await fetch(
            'https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=aud',
            { signal: controller.signal }
        );
        clearTimeout(timeout);

        if (resp.ok) {
            const data = await resp.json();
            if (data.ethereum && data.ethereum.aud) {
                cachedPrice = data.ethereum.aud;
                cachedPriceTime = now;
                return cachedPrice;
            }
        }
    } catch (err) {
        console.warn('[Crypto] CoinGecko price fetch failed:', err.message);
    }

    // Fallback to env-configured static rate
    const fallback = parseFloat(process.env.ETH_AUD_FALLBACK_RATE) || 5000;
    return fallback;
}

/**
 * Fetch transaction receipt from Ethereum RPC.
 */
async function getTransactionReceipt(txHash) {
    const resp = await fetch(ETH_RPC_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            jsonrpc: '2.0',
            id: 1,
            method: 'eth_getTransactionReceipt',
            params: [txHash]
        })
    });
    const data = await resp.json();
    return data.result;
}

/**
 * Fetch transaction details from Ethereum RPC.
 */
async function getTransaction(txHash) {
    const resp = await fetch(ETH_RPC_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            jsonrpc: '2.0',
            id: 1,
            method: 'eth_getTransactionByHash',
            params: [txHash]
        })
    });
    const data = await resp.json();
    return data.result;
}

/**
 * Fetch current block number from Ethereum RPC.
 */
async function getBlockNumber() {
    const resp = await fetch(ETH_RPC_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            jsonrpc: '2.0',
            id: 1,
            method: 'eth_blockNumber',
            params: []
        })
    });
    const data = await resp.json();
    return parseInt(data.result, 16);
}

// ═══════════════════════════════════════════════════
//  PUBLIC ENDPOINTS
// ═══════════════════════════════════════════════════

/**
 * GET /api/crypto/config — public config for the frontend
 */
router.get('/config', (req, res) => {
    if (!WALLET_ADDRESS) {
        return res.status(503).json({ error: 'Crypto payments not configured' });
    }
    res.json({
        walletAddress: WALLET_ADDRESS,
        chainId: ETH_CHAIN_ID,
        chainName: ETH_CHAIN_ID === 1 ? 'Ethereum Mainnet' : ETH_CHAIN_ID === 11155111 ? 'Sepolia Testnet' : `Chain ${ETH_CHAIN_ID}`,
        minDepositAUD: config.MIN_DEPOSIT,
        maxDepositAUD: config.MAX_DEPOSIT,
        minConfirmations: MIN_CONFIRMATIONS,
        currency: config.CURRENCY
    });
});

/**
 * GET /api/crypto/rate — current ETH/AUD exchange rate
 */
router.get('/rate', async (req, res) => {
    try {
        const ethPrice = await getEthPriceAUD();
        res.json({
            eth_aud: ethPrice,
            updated_at: new Date().toISOString()
        });
    } catch (err) {
        console.warn('[Crypto] Rate fetch error:', err.message);
        res.status(500).json({ error: 'Failed to fetch ETH price' });
    }
});

// ═══════════════════════════════════════════════════
//  AUTHENTICATED ENDPOINTS
// ═══════════════════════════════════════════════════

/**
 * POST /api/crypto/verify-deposit — verify an on-chain ETH transaction
 *
 * Body: { txHash: "0x..." }
 *
 * Server verifies:
 *   1. Transaction exists on-chain
 *   2. It was sent TO the configured wallet address
 *   3. It has enough confirmations
 *   4. It hasn't already been claimed
 *   5. Credits balance with AUD equivalent
 */
router.post('/verify-deposit', authenticate, async (req, res) => {
    try {
        if (!WALLET_ADDRESS) {
            return res.status(503).json({ error: 'Crypto payments not configured' });
        }

        const { txHash } = req.body;
        if (!txHash || !/^0x[a-fA-F0-9]{64}$/.test(txHash)) {
            return res.status(400).json({ error: 'Invalid transaction hash' });
        }

        const txHashLower = txHash.toLowerCase();

        // Check if tx was already claimed
        const existing = await db.get(
            "SELECT id FROM deposits WHERE external_ref = ? AND status = 'completed'",
            [txHashLower]
        );
        if (existing) {
            return res.status(409).json({ error: 'This transaction has already been credited' });
        }

        // Fetch transaction from chain
        const [tx, receipt] = await Promise.all([
            getTransaction(txHashLower),
            getTransactionReceipt(txHashLower)
        ]);

        if (!tx) {
            return res.status(404).json({
                error: 'Transaction not found on-chain. It may still be pending — try again in a minute.',
                status: 'pending'
            });
        }

        if (!receipt) {
            return res.status(202).json({
                message: 'Transaction found but not yet confirmed. Please wait.',
                status: 'pending'
            });
        }

        // Verify recipient is our wallet
        if (tx.to && tx.to.toLowerCase() !== WALLET_ADDRESS) {
            return res.status(400).json({ error: 'Transaction was not sent to the correct wallet address' });
        }

        // Verify transaction succeeded
        if (receipt.status !== '0x1') {
            return res.status(400).json({ error: 'Transaction failed on-chain' });
        }

        // Verify confirmations
        const currentBlock = await getBlockNumber();
        const txBlock = parseInt(receipt.blockNumber, 16);
        const confirmations = currentBlock - txBlock;

        if (confirmations < MIN_CONFIRMATIONS) {
            return res.status(202).json({
                message: `Transaction needs ${MIN_CONFIRMATIONS} confirmations. Currently at ${confirmations}.`,
                status: 'confirming',
                confirmations,
                required: MIN_CONFIRMATIONS
            });
        }

        // Calculate ETH value
        const weiValue = BigInt(tx.value);
        const ethValue = Number(weiValue) / 1e18;

        if (ethValue <= 0) {
            return res.status(400).json({ error: 'Transaction has zero ETH value' });
        }

        // ROUND 61: Self-exclusion check — crypto deposits must respect self-exclusion
        try {
            var exclusion = await db.get(
                "SELECT id FROM self_exclusions WHERE user_id = ? AND is_active = 1 AND (ends_at IS NULL OR ends_at > datetime('now'))",
                [req.user.id]
            );
            if (exclusion) {
                return res.status(403).json({ error: 'Account is self-excluded. Deposits are disabled.' });
            }
        } catch (exclErr) {
            if (exclErr.message && exclErr.message.includes('no such table')) { /* OK */ }
            else {
                console.error('[Crypto] Self-exclusion check failed:', exclErr.message);
                return res.status(500).json({ error: 'Security check failed' });
            }
        }

        // Convert to AUD
        const ethPrice = await getEthPriceAUD();
        const audAmount = Math.round(ethValue * ethPrice * 100) / 100; // Round to 2 decimal places

        // ROUND 61: Number.isFinite — guards against NaN/Infinity from bad price feeds
        if (!Number.isFinite(audAmount) || audAmount <= 0) {
            return res.status(400).json({ error: 'Invalid ETH/AUD conversion — try again later' });
        }

        if (audAmount < config.MIN_DEPOSIT) {
            return res.status(400).json({
                error: `Deposit value ($${audAmount.toFixed(2)} AUD) is below minimum ($${config.MIN_DEPOSIT.toFixed(2)})`,
                ethValue: ethValue.toFixed(6),
                audValue: audAmount.toFixed(2),
                ethRate: ethPrice
            });
        }

        if (audAmount > config.MAX_DEPOSIT) {
            return res.status(400).json({
                error: `Deposit value ($${audAmount.toFixed(2)} AUD) exceeds maximum ($${config.MAX_DEPOSIT.toFixed(2)})`,
                ethValue: ethValue.toFixed(6),
                audValue: audAmount.toFixed(2)
            });
        }

        const reference = generateReference('CRYPTO');

        // Create deposit record as completed (on-chain verification = payment confirmed)
        await db.run(
            "INSERT INTO deposits (user_id, amount, currency, payment_type, status, reference, external_ref, created_at, completed_at) VALUES (?, ?, ?, ?, 'completed', ?, ?, datetime('now'), datetime('now'))",
            [req.user.id, audAmount, config.CURRENCY, 'crypto_eth', reference, txHashLower]
        );

        // ROUND 61: Atomic balance update — old read-then-write was vulnerable to race conditions
        const userBefore = await db.get('SELECT balance FROM users WHERE id = ?', [req.user.id]);
        const oldBalance = parseFloat(userBefore.balance) || 0;

        await db.run('UPDATE users SET balance = balance + ? WHERE id = ?', [audAmount, req.user.id]);

        // Record transaction
        await db.run(
            "INSERT INTO transactions (user_id, type, amount, balance_before, balance_after, reference, created_at) VALUES (?, 'deposit', ?, ?, ?, ?, datetime('now'))",
            [req.user.id, audAmount, oldBalance, oldBalance + audAmount, reference]
        );

        // ── NFT ledger: record crypto deposit as NFT sale (fire-and-forget) ──
        mintOnDeposit(db, { userId: req.user.id, amount: audAmount, depositId: null, paymentType: 'crypto_eth', reference: reference, currency: config.CURRENCY }).catch(function(e) { console.warn('[Crypto] mintOnDeposit error:', e.message || e); });

        // Award gems based on deposit amount
        let gemsAwarded = 0;
        if (audAmount >= 100) gemsAwarded = 2500;
        else if (audAmount >= 50) gemsAwarded = 1000;
        else if (audAmount >= 5) gemsAwarded = 100;

        if (gemsAwarded > 0) {
            await db.run(
                'UPDATE users SET gems = COALESCE(gems, 0) + ? WHERE id = ?',
                [gemsAwarded, req.user.id]
            );
        }

        console.log(`[Crypto] Deposit verified: user=${req.user.id} tx=${txHashLower} eth=${ethValue.toFixed(6)} aud=$${audAmount.toFixed(2)} ref=${reference}`);

        res.json({
            message: `Deposit of $${audAmount.toFixed(2)} AUD confirmed!`,
            deposit: {
                amount: audAmount,
                currency: config.CURRENCY,
                ethValue: ethValue.toFixed(6),
                ethRate: ethPrice,
                txHash: txHashLower,
                reference,
                status: 'completed',
                confirmations
            },
            balance: newBalance,
            gemsAwarded
        });

    } catch (err) {
        console.warn('[Crypto] Verify deposit error:', err.message);
        res.status(500).json({ error: 'Failed to verify transaction. Please try again.' });
    }
});

/**
 * GET /api/crypto/deposit-status/:txHash — check status of a pending deposit
 */
router.get('/deposit-status/:txHash', authenticate, async (req, res) => {
    try {
        const txHash = req.params.txHash.toLowerCase();
        if (!/^0x[a-fA-F0-9]{64}$/.test(txHash)) {
            return res.status(400).json({ error: 'Invalid transaction hash' });
        }

        // Check if already completed
        const existing = await db.get(
            "SELECT id, amount, status FROM deposits WHERE external_ref = ? AND user_id = ?",
            [txHash, req.user.id]
        );
        if (existing && existing.status === 'completed') {
            return res.json({ status: 'completed', amount: existing.amount });
        }

        // Check on-chain
        const receipt = await getTransactionReceipt(txHash);
        if (!receipt) {
            return res.json({ status: 'pending', confirmations: 0 });
        }

        const currentBlock = await getBlockNumber();
        const txBlock = parseInt(receipt.blockNumber, 16);
        const confirmations = currentBlock - txBlock;

        res.json({
            status: confirmations >= MIN_CONFIRMATIONS ? 'confirmed' : 'confirming',
            confirmations,
            required: MIN_CONFIRMATIONS
        });
    } catch (err) {
        console.warn('[Crypto] Deposit status error:', err.message);
        res.status(500).json({ error: 'Failed to check transaction status' });
    }
});

module.exports = router;
