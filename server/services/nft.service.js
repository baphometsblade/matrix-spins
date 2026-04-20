'use strict';

/**
 * NFT receipt service.
 *
 * v1 issues DB-backed receipts: deterministic token-id + HMAC signature
 * over the metadata, stored in nft_receipts. Callable from the Stripe
 * webhook once a deposit is paid.
 *
 * To upgrade to a real on-chain mint, swap the body of mintFor() to call
 * the provider of your choice (Crossmint, thirdweb Engine, Alchemy, etc.)
 * — the deposit flow and API surface don't change.
 */

const crypto = require('crypto');
const config = require('../config');
const db = require('../database');

const TIERS = [
    { min: 0,      max: 1999,   tier: 'bronze',   rarity: 'Common' },
    { min: 2000,   max: 9999,   tier: 'silver',   rarity: 'Uncommon' },
    { min: 10000,  max: 49999,  tier: 'gold',     rarity: 'Rare' },
    { min: 50000,  max: 199999, tier: 'platinum', rarity: 'Epic' },
    { min: 200000, max: Infinity, tier: 'diamond', rarity: 'Legendary' },
];

function tierFor(amountCents) {
    return TIERS.find(t => amountCents >= t.min && amountCents <= t.max) || TIERS[0];
}

function deterministicTokenId(userId, depositId) {
    const h = crypto.createHash('sha256').update(`ms:${userId}:${depositId}`).digest('hex');
    return 'msr_' + h.slice(0, 24);
}

function signMetadata(metadata) {
    return crypto.createHmac('sha256', config.NFT_SIGNING_SECRET)
        .update(JSON.stringify(metadata))
        .digest('hex');
}

function buildMetadata({ tokenId, userId, depositId, amountCents, currency, tier }) {
    return {
        token_id: tokenId,
        name: `Matrix Receipt · ${tier.tier.toUpperCase()} · ${(amountCents / 100).toFixed(2)} ${currency.toUpperCase()}`,
        description: `Proof of deposit on Matrix Spins. Tier: ${tier.rarity}.`,
        image: null, // UI renders a generated SVG based on tier; set a URL here once assets are hosted.
        attributes: [
            { trait_type: 'Tier', value: tier.tier },
            { trait_type: 'Rarity', value: tier.rarity },
            { trait_type: 'Amount', value: (amountCents / 100).toFixed(2) + ' ' + currency.toUpperCase() },
            { trait_type: 'Deposit ID', value: String(depositId) },
            { trait_type: 'Issued', value: new Date().toISOString() },
        ],
        issuer: 'matrix-spins',
        version: 1,
        user_id: String(userId),
    };
}

/**
 * Mint a receipt for a completed deposit. Idempotent per depositId — if
 * a receipt already exists, it is returned unchanged. Callers MUST
 * invoke this inside the webhook handler after a verified payment.
 */
async function mintFor({ userId, depositId, amountCents, currency }) {
    const existing = await db.get('SELECT * FROM nft_receipts WHERE deposit_id = ?', [depositId]);
    if (existing) return decorate(existing);

    const tier = tierFor(amountCents);
    const tokenId = deterministicTokenId(userId, depositId);
    const metadata = buildMetadata({ tokenId, userId, depositId, amountCents, currency, tier });
    const signature = signMetadata(metadata);

    await db.run(
        `INSERT INTO nft_receipts
            (user_id, deposit_id, token_id, provider, chain, contract_address, metadata, signature)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
            userId,
            depositId,
            tokenId,
            config.NFT_PROVIDER,
            null,
            null,
            JSON.stringify(metadata),
            signature,
        ]
    );

    const row = await db.get('SELECT * FROM nft_receipts WHERE deposit_id = ?', [depositId]);
    return decorate(row);
}

function decorate(row) {
    if (!row) return null;
    let meta;
    try { meta = typeof row.metadata === 'string' ? JSON.parse(row.metadata) : row.metadata; }
    catch (err) { meta = null; }
    return {
        id: row.id,
        tokenId: row.token_id,
        provider: row.provider,
        chain: row.chain,
        contractAddress: row.contract_address,
        metadata: meta,
        signature: row.signature,
        mintedAt: row.minted_at,
    };
}

async function listForUser(userId) {
    const rows = await db.all(
        'SELECT * FROM nft_receipts WHERE user_id = ? ORDER BY minted_at DESC',
        [userId]
    );
    return rows.map(decorate);
}

module.exports = { mintFor, listForUser, tierFor, signMetadata };
