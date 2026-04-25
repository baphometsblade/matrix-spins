'use strict';

const crypto = require('crypto');

// Crypto-secure float in [0, 1) — replaces Math.random() for prize-determining rolls.
function secureFloat() {
    return crypto.randomBytes(4).readUInt32BE(0) / 0x100000000;
}

// ── Spin Tier Definitions ───────────────────────────────────────────────────

var SPIN_TIERS = {
    basic: { gemCost: 50, multiplier: 1 },
    super: { gemCost: 200, multiplier: 2 },
    mega: { gemCost: 500, multiplier: 5 }
};

// ── Wheel Segment Definitions (base values) ─────────────────────────────────

var SEGMENTS = [
    { label: '5 Gems', type: 'gems', amount: 5, weight: 25 },
    { label: '10 Gems', type: 'gems', amount: 10, weight: 20 },
    { label: '25 Gems', type: 'gems', amount: 25, weight: 15 },
    { label: '$1', type: 'credits', amount: 1, weight: 15 },
    { label: '50 Gems', type: 'gems', amount: 50, weight: 10 },
    { label: '$5', type: 'credits', amount: 5, weight: 8 },
    { label: '100 Gems', type: 'gems', amount: 100, weight: 5 },
    { label: '$25', type: 'credits', amount: 25, weight: 1.5 },
    { label: 'JACKPOT $100', type: 'credits', amount: 100, weight: 0.5 }
];

// ── Schema Init ─────────────────────────────────────────────────────────────

async function initSchema() {
    const db = require('../database');
    const isPg  = !!process.env.DATABASE_URL;
    const idDef = isPg ? 'SERIAL PRIMARY KEY' : 'INTEGER PRIMARY KEY AUTOINCREMENT';
    const tsType    = isPg ? 'TIMESTAMPTZ' : 'TEXT';
    const tsDefault = isPg ? 'NOW()' : "(datetime('now'))";
    await db.run(`CREATE TABLE IF NOT EXISTS mega_wheel_spins (
        id ${idDef},
        user_id INTEGER NOT NULL,
        spin_tier TEXT NOT NULL,
        segment_index INTEGER NOT NULL,
        prize_type TEXT NOT NULL,
        prize_amount REAL NOT NULL,
        gem_cost INTEGER NOT NULL,
        created_at ${tsType} DEFAULT ${tsDefault}
    )`);
}

// ── Weighted Random Selection ───────────────────────────────────────────────

function _rollWheel() {
    var totalWeight = 0;
    for (var i = 0; i < SEGMENTS.length; i++) totalWeight += SEGMENTS[i].weight;
    var roll = secureFloat() * totalWeight;
    var cumulative = 0;
    for (var i = 0; i < SEGMENTS.length; i++) {
        cumulative += SEGMENTS[i].weight;
        if (roll < cumulative) return i;
    }
    return SEGMENTS.length - 1; // fallback
}

// ── Core Functions ──────────────────────────────────────────────────────────

/**
 * Get the wheel configuration for a given tier.
 * Returns segments with display labels adjusted for the tier multiplier.
 */
function getWheelConfig(tier) {
    var tierKey = tier || 'basic';
    var tierConfig = SPIN_TIERS[tierKey];
    if (!tierConfig) {
        throw new Error('Invalid tier: ' + tierKey);
    }

    var multiplier = tierConfig.multiplier;
    var displaySegments = SEGMENTS.map(function (seg) {
        var adjustedAmount = seg.amount * multiplier;
        var displayLabel;
        if (seg.type === 'gems') {
            displayLabel = adjustedAmount + ' Gems';
        } else if (seg.amount === 100) {
            displayLabel = 'JACKPOT $' + adjustedAmount;
        } else {
            displayLabel = '$' + adjustedAmount;
        }
        return {
            label: displayLabel,
            type: seg.type,
            amount: adjustedAmount,
            weight: seg.weight
        };
    });

    return {
        segments: displaySegments,
        gemCost: tierConfig.gemCost,
        tierName: tierKey
    };
}

/**
 * Spin the Mega Wheel for a user.
 * Validates tier, checks gem balance, deducts cost, rolls, grants prize, logs spin.
 */
async function spin(userId, tier) {
    const db = require('../database');
    var tierKey = tier || 'basic';
    var tierConfig = SPIN_TIERS[tierKey];
    if (!tierConfig) {
        throw new Error('Invalid tier: ' + tierKey);
    }

    var gemCost = tierConfig.gemCost;
    var multiplier = tierConfig.multiplier;

    // Check gem balance
    const gemsService = require('./gems.service');
    const bal = await gemsService.getBalance(userId);
    if (bal.gems < gemCost) {
        throw new Error('Insufficient gems');
    }

    // Spend gems
    await gemsService.spendGems(userId, gemCost, 'Mega Wheel: ' + tierKey);

    // Roll the wheel
    var segmentIndex = _rollWheel();
    var baseSeg = SEGMENTS[segmentIndex];
    var prizeAmount = baseSeg.amount * multiplier;
    var prizeType = baseSeg.type;

    // Generate display label for the prize
    var prizeLabel;
    if (prizeType === 'gems') {
        prizeLabel = prizeAmount + ' Gems';
    } else if (baseSeg.amount === 100) {
        prizeLabel = 'JACKPOT $' + prizeAmount;
    } else {
        prizeLabel = '$' + prizeAmount;
    }

    // Grant prize
    if (prizeType === 'gems') {
        await gemsService.addGems(userId, prizeAmount, 'Mega Wheel win');
    } else if (prizeType === 'credits') {
        await db.run('UPDATE users SET balance = balance + ? WHERE id = ?', [prizeAmount, userId]);
    }

    // Log the spin
    await db.run(
        "INSERT INTO mega_wheel_spins (user_id, spin_tier, segment_index, prize_type, prize_amount, gem_cost, created_at) VALUES (?, ?, ?, ?, ?, ?, datetime('now'))",
        [userId, tierKey, segmentIndex, prizeType, prizeAmount, gemCost]
    );

    return {
        segmentIndex: segmentIndex,
        prize: {
            type: prizeType,
            amount: prizeAmount,
            label: prizeLabel
        },
        tierMultiplier: multiplier,
        gemCost: gemCost
    };
}

/**
 * Get recent spin history for a user.
 */
async function getHistory(userId, limit) {
    const db = require('../database');
    var historyLimit = limit || 20;
    var rows = await db.all(
        'SELECT id, spin_tier, segment_index, prize_type, prize_amount, gem_cost, created_at FROM mega_wheel_spins WHERE user_id = ? ORDER BY created_at DESC LIMIT ?',
        [userId, historyLimit]
    );
    return rows;
}

module.exports = { initSchema, getWheelConfig, spin, getHistory };
