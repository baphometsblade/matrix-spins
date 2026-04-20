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
    { min: 0,      max: 1999,   tier: 'bronze',   rarity: 'Common',    color: '#cd7f32', accent: '#8a5a2a' },
    { min: 2000,   max: 9999,   tier: 'silver',   rarity: 'Uncommon',  color: '#c0c0c0', accent: '#7a7a7a' },
    { min: 10000,  max: 49999,  tier: 'gold',     rarity: 'Rare',      color: '#ffd700', accent: '#b8860b' },
    { min: 50000,  max: 199999, tier: 'platinum', rarity: 'Epic',      color: '#e5e4e2', accent: '#a9a9a9' },
    { min: 200000, max: Infinity, tier: 'diamond', rarity: 'Legendary', color: '#b9f2ff', accent: '#00a2c7' },
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

function buildSvg({ tier, amountCents, currency, tokenId }) {
    const short = tokenId.length > 16 ? tokenId.slice(0, 16) + '…' : tokenId;
    const amount = (amountCents / 100).toFixed(2) + ' ' + currency.toUpperCase();
    const title = tier.tier.toUpperCase();
    return (
        `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 600" role="img" aria-label="Matrix Receipt ${title}">` +
        `<defs>` +
            `<linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">` +
                `<stop offset="0%" stop-color="#0d1117"/>` +
                `<stop offset="100%" stop-color="${tier.accent}"/>` +
            `</linearGradient>` +
            `<linearGradient id="stroke" x1="0" y1="0" x2="1" y2="1">` +
                `<stop offset="0%" stop-color="${tier.color}"/>` +
                `<stop offset="100%" stop-color="${tier.accent}"/>` +
            `</linearGradient>` +
        `</defs>` +
        `<rect width="600" height="600" fill="url(#bg)"/>` +
        `<rect x="20" y="20" width="560" height="560" rx="24" fill="none" stroke="url(#stroke)" stroke-width="4"/>` +
        `<text x="300" y="110" font-family="Helvetica,Arial,sans-serif" font-size="28" font-weight="700" fill="${tier.color}" text-anchor="middle" letter-spacing="6">MATRIX RECEIPT</text>` +
        `<text x="300" y="170" font-family="Helvetica,Arial,sans-serif" font-size="18" fill="#e0e0e0" text-anchor="middle" letter-spacing="3">${tier.rarity.toUpperCase()} · ${title}</text>` +
        `<circle cx="300" cy="330" r="110" fill="none" stroke="${tier.color}" stroke-width="3" opacity="0.6"/>` +
        `<circle cx="300" cy="330" r="80" fill="${tier.accent}" opacity="0.25"/>` +
        `<text x="300" y="340" font-family="Helvetica,Arial,sans-serif" font-size="46" font-weight="800" fill="${tier.color}" text-anchor="middle">$${(amountCents / 100).toFixed(2)}</text>` +
        `<text x="300" y="370" font-family="Helvetica,Arial,sans-serif" font-size="14" fill="#c0c0c0" text-anchor="middle" letter-spacing="4">${currency.toUpperCase()}</text>` +
        `<text x="300" y="500" font-family="Menlo,monospace" font-size="16" fill="${tier.color}" text-anchor="middle" opacity="0.75">${short}</text>` +
        `<text x="300" y="550" font-family="Helvetica,Arial,sans-serif" font-size="12" fill="#7f8ca0" text-anchor="middle" letter-spacing="2">PROOF OF DEPOSIT · ${amount}</text>` +
        `</svg>`
    );
}

function svgDataUrl(svg) {
    return 'data:image/svg+xml;utf8,' + encodeURIComponent(svg);
}

function buildMetadata({ tokenId, userId, depositId, amountCents, currency, tier }) {
    const svg = buildSvg({ tier, amountCents, currency, tokenId });
    return {
        token_id: tokenId,
        name: `Matrix Receipt · ${tier.tier.toUpperCase()} · ${(amountCents / 100).toFixed(2)} ${currency.toUpperCase()}`,
        description: `Proof of deposit on Matrix Spins. Tier: ${tier.rarity}.`,
        image: svgDataUrl(svg),
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
