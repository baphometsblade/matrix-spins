'use strict';

const db = require('../database');
const config = require('../config');
const crypto = require('crypto');

// Crypto-secure float in [0, 1) — replaces Math.random() for prize-determining rolls.
// Predictable RNG on jackpot logic = direct cash exfil.
function secureFloat() {
    return crypto.randomBytes(4).readUInt32BE(0) / 0x100000000;
}

/**
 * Jackpot Pooling Service
 *
 * 4-tier progressive jackpot system:
 *   mini  — small frequent wins
 *   minor — moderate wins
 *   major — large wins
 *   grand — rare massive wins
 *
 * Every real-money spin contributes JACKPOT_CONTRIBUTION_RATE of the bet,
 * split equally across all 4 tiers. Each tier has a "must hit at" ceiling —
 * if current_amount >= mustHitAt the jackpot is guaranteed to trigger.
 */

const TIER_NAMES = ['mini', 'minor', 'major', 'grand'];

// Map tier name to its win chance from config
function getWinChance(tier) {
    switch (tier) {
        case 'mini':  return config.JACKPOT_MINI_WIN_CHANCE;
        case 'minor': return config.JACKPOT_MINOR_WIN_CHANCE;
        case 'major': return config.JACKPOT_MAJOR_WIN_CHANCE;
        case 'grand': return config.JACKPOT_GRAND_WIN_CHANCE;
        default:      return 0;
    }
}

/**
 * Seed the jackpot_pool table with all 4 tiers if they don't already exist.
 * Called once at server startup.
 */
async function initJackpotPool() {
    const tiers = config.JACKPOT_TIERS;
    for (const tierName of TIER_NAMES) {
        const tierConfig = tiers[tierName];
        if (!tierConfig) continue;
        await db.run(
            'INSERT OR IGNORE INTO jackpot_pool (tier, current_amount, seed_amount, contribution_rate) VALUES (?, ?, ?, ?)',
            [tierName, tierConfig.seed, tierConfig.seed, config.JACKPOT_CONTRIBUTION_RATE / TIER_NAMES.length]
        );
    }
    console.log('[Jackpot] Pool initialised — 4 tiers seeded');
}

/**
 * Process a jackpot contribution from a spin bet and check for wins.
 *
 * @param {number} userId - The user who spun
 * @param {number} betAmount - The bet amount (before deduction)
 * @returns {Promise<{tier: string, amount: number}|null>} Win info or null
 */
async function processJackpotContribution(userId, betAmount) {
    const totalContribution = Math.round(betAmount * config.JACKPOT_CONTRIBUTION_RATE * 100) / 100;
    if (totalContribution <= 0) return null;

    const perTier = Math.round((totalContribution / TIER_NAMES.length) * 100) / 100;

    // Update all tiers with their contribution
    for (const tierName of TIER_NAMES) {
        if (perTier > 0) {
            await db.run(
                'UPDATE jackpot_pool SET current_amount = current_amount + ?, total_contributed = total_contributed + ? WHERE tier = ?',
                [perTier, perTier, tierName]
            );
        }
    }

    // Check for jackpot win — iterate from lowest to highest tier
    // Only one jackpot can be won per spin
    const tiers = config.JACKPOT_TIERS;
    for (const tierName of TIER_NAMES) {
        const tierConfig = tiers[tierName];
        if (!tierConfig) continue;

        const row = await db.get('SELECT current_amount, seed_amount FROM jackpot_pool WHERE tier = ?', [tierName]);
        if (!row || row.current_amount <= 0) continue;

        const winChance = getWinChance(tierName);
        const mustHit = row.current_amount >= tierConfig.mustHitAt;
        const randomHit = secureFloat() < winChance;

        if (mustHit || randomHit) {
            // Jackpot won!
            const wonAmount = Math.round(row.current_amount * 100) / 100;

            // Reset pool to seed amount
            await db.run(
                "UPDATE jackpot_pool SET current_amount = seed_amount, total_paid_out = total_paid_out + ?, last_won_at = datetime('now'), last_winner_id = ? WHERE tier = ?",
                [wonAmount, userId, tierName]
            );

            // Credit user balance (atomic accumulator)
            const userRow = await db.get('SELECT balance FROM users WHERE id = ?', [userId]);
            if (userRow) {
                const balanceBefore = userRow.balance;
                const balanceAfter = balanceBefore + wonAmount;
                await db.run('UPDATE users SET balance = balance + ? WHERE id = ?', [wonAmount, userId]);

                // Log transaction
                await db.run(
                    'INSERT INTO transactions (user_id, type, amount, balance_before, balance_after, reference) VALUES (?, ?, ?, ?, ?, ?)',
                    [userId, 'jackpot', wonAmount, balanceBefore, balanceAfter, 'jackpot:' + tierName]
                );
            }

            return { tier: tierName, amount: wonAmount };
        }
    }

    return null;
}

/**
 * Return current jackpot pool amounts for all tiers.
 * Used by the public GET /api/jackpot endpoint.
 */
async function getJackpotLevels() {
    const rows = await db.all('SELECT tier, current_amount, seed_amount, last_won_at, last_winner_id FROM jackpot_pool ORDER BY seed_amount ASC');
    return rows.map(r => ({
        tier: r.tier,
        currentAmount: r.current_amount,
        seedAmount: r.seed_amount,
        lastWonAt: r.last_won_at,
        lastWinnerId: r.last_winner_id
    }));
}

/**
 * Return recent jackpot win history with winner usernames.
 */
async function getHistory() {
    return db.all(
        `SELECT j.tier, j.total_paid_out, j.last_won_at, u.username as winner
         FROM jackpot_pool j
         LEFT JOIN users u ON j.last_winner_id = u.id
         WHERE j.last_won_at IS NOT NULL
         ORDER BY j.last_won_at DESC`
    );
}

// ── Legacy compatibility aliases ──
// The existing jackpot.routes.js and spin.routes.js call ensureSeeded/contribute/checkAndAward/getAmounts
const ensureSeeded = initJackpotPool;

async function contribute(betAmount) {
    const totalContribution = Math.round(betAmount * config.JACKPOT_CONTRIBUTION_RATE * 100) / 100;
    if (totalContribution <= 0) return;
    const perTier = Math.round((totalContribution / TIER_NAMES.length) * 100) / 100;
    for (const tierName of TIER_NAMES) {
        if (perTier > 0) {
            await db.run(
                'UPDATE jackpot_pool SET current_amount = current_amount + ?, total_contributed = total_contributed + ? WHERE tier = ?',
                [perTier, perTier, tierName]
            );
        }
    }
}

async function checkAndAward(userId, betAmount, minBet, isJackpotGame) {
    const tiers = config.JACKPOT_TIERS;
    for (const tierName of TIER_NAMES) {
        const tierConfig = tiers[tierName];
        if (!tierConfig) continue;

        const row = await db.get('SELECT current_amount, seed_amount FROM jackpot_pool WHERE tier = ?', [tierName]);
        if (!row || row.current_amount <= 0) continue;

        const baseChance = getWinChance(tierName);
        // Scale probability with bet size (capped at 3x boost), 10x lower on non-jackpot games
        const betMultiplier = Math.min(3, betAmount / Math.max(minBet, 1));
        const gameMultiplier = isJackpotGame ? 1 : 0.1;
        const prob = baseChance * betMultiplier * gameMultiplier;

        const mustHit = row.current_amount >= tierConfig.mustHitAt;
        const randomHit = secureFloat() < prob;

        if (mustHit || randomHit) {
            // RACE-SAFE jackpot claim — concurrent spins can both pass the random check;
            // only the spin whose UPDATE matches the observed amount wins.
            const flip = await db.run(
                "UPDATE jackpot_pool SET current_amount = seed_amount, total_paid_out = total_paid_out + ?, last_won_at = datetime('now'), last_winner_id = ? WHERE tier = ? AND current_amount = ?",
                [row.current_amount, userId, tierName, row.current_amount]
            );
            const flipRows = (flip && (flip.changes || flip.rowCount)) || 0;
            if (flipRows === 0) {
                continue; // Another spin won this tier first
            }
            const wonAmount = Math.round(row.current_amount * 100) / 100;
            return { tier: tierName, amount: wonAmount };
        }
    }
    return null;
}

async function getAmounts() {
    const rows = await db.all('SELECT tier, current_amount FROM jackpot_pool');
    const amounts = {};
    // Seed defaults from config
    for (const tierName of TIER_NAMES) {
        const tierConfig = config.JACKPOT_TIERS[tierName];
        amounts[tierName] = tierConfig ? tierConfig.seed : 0;
    }
    for (const row of rows) {
        amounts[row.tier] = row.current_amount;
    }
    return amounts;
}

module.exports = {
    initJackpotPool,
    processJackpotContribution,
    getJackpotLevels,
    getHistory,
    // Legacy aliases used by existing routes
    ensureSeeded,
    contribute,
    checkAndAward,
    getAmounts,
};
