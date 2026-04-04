/**
 * NFT Ledger Service
 *
 * Every deposit mints an NFT record (type = 'sale').
 * Every withdrawal creates an NFT record (type = 'resale').
 *
 * This is a backend-only ledger — not exposed to players.
 * Each NFT gets a unique token ID and metadata linking it
 * to the underlying deposit/withdrawal.
 */

'use strict';

const crypto = require('crypto');

/**
 * Generate a unique NFT token ID.
 * Format: NFT-<hex(8)>-<hex(4)>-<hex(4)>
 */
function generateTokenId() {
    const bytes = crypto.randomBytes(8);
    const hex = bytes.toString('hex');
    return `NFT-${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}`;
}

/**
 * Generate NFT metadata for a deposit (sale).
 */
function buildSaleMetadata(deposit) {
    return JSON.stringify({
        collection: 'Matrix Spins Digital Collectibles',
        edition: deposit.depositId || null,
        paymentType: deposit.paymentType || 'unknown',
        reference: deposit.reference || null,
        currency: deposit.currency || 'AUD'
    });
}

/**
 * Generate NFT metadata for a withdrawal (resale).
 */
function buildResaleMetadata(withdrawal) {
    return JSON.stringify({
        collection: 'Matrix Spins Digital Collectibles',
        edition: withdrawal.withdrawalId || null,
        paymentType: withdrawal.paymentType || 'unknown',
        reference: withdrawal.reference || null,
        currency: withdrawal.currency || 'AUD'
    });
}

/**
 * Mint an NFT on deposit completion.
 * Called after balance has been credited.
 *
 * @param {object} db - database facade
 * @param {object} opts
 * @param {number} opts.userId
 * @param {number} opts.amount - AUD amount
 * @param {number} opts.depositId - deposits table PK
 * @param {string} opts.paymentType - e.g. 'crypto_eth', 'visa', 'bank_transfer'
 * @param {string} opts.reference - deposit reference string
 * @param {string} [opts.currency='AUD']
 */
async function mintOnDeposit(db, opts) {
    try {
        const tokenId = generateTokenId();
        const metadata = buildSaleMetadata(opts);

        await db.run(
            `INSERT INTO nft_ledger (token_id, user_id, type, amount, currency, source_table, source_id, metadata, created_at)
             VALUES (?, ?, 'sale', ?, ?, 'deposits', ?, ?, datetime('now'))`,
            [tokenId, opts.userId, opts.amount, opts.currency || 'AUD', opts.depositId, metadata]
        );

        return tokenId;
    } catch (err) {
        // Fire-and-forget — never block the deposit flow
        console.warn('[NFT] mintOnDeposit error:', err.message);
        return null;
    }
}

/**
 * Record an NFT resale on withdrawal request.
 * Called after balance has been deducted.
 *
 * @param {object} db - database facade
 * @param {object} opts
 * @param {number} opts.userId
 * @param {number} opts.amount - AUD amount
 * @param {number} opts.withdrawalId - withdrawals table PK
 * @param {string} opts.paymentType
 * @param {string} opts.reference - withdrawal reference string
 * @param {string} [opts.currency='AUD']
 */
async function recordResaleOnWithdrawal(db, opts) {
    try {
        const tokenId = generateTokenId();
        const metadata = buildResaleMetadata(opts);

        await db.run(
            `INSERT INTO nft_ledger (token_id, user_id, type, amount, currency, source_table, source_id, metadata, created_at)
             VALUES (?, ?, 'resale', ?, ?, 'withdrawals', ?, ?, datetime('now'))`,
            [tokenId, opts.userId, opts.amount, opts.currency || 'AUD', opts.withdrawalId, metadata]
        );

        return tokenId;
    } catch (err) {
        // Fire-and-forget — never block the withdrawal flow
        console.warn('[NFT] recordResaleOnWithdrawal error:', err.message);
        return null;
    }
}

module.exports = { mintOnDeposit, recordResaleOnWithdrawal, generateTokenId };
