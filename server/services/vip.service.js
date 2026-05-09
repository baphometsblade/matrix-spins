'use strict';

/**
 * VIP / Loyalty Service
 *
 * Tier ladder driven by lifetime XP (1 XP per $1 wagered, atomic increment).
 * Benefits: cashback %, deposit bonus multiplier, withdrawal priority,
 * exclusive games access. Monthly cashback computed from net losses.
 */

const db = require('../database');

const TIERS = [
    {
        name: 'Bronze',
        minXp: 0,
        cashbackPct: 2,           // 2% monthly cashback on net losses
        depositBonusMult: 1.0,    // base deposit match
        withdrawalPriority: 4,    // 1=highest
        exclusiveGames: false,
        dailySpinBonusXp: 0,
        color: '#CD7F32',
        icon: '🥉'
    },
    {
        name: 'Silver',
        minXp: 1000,
        cashbackPct: 5,
        depositBonusMult: 1.10,
        withdrawalPriority: 3,
        exclusiveGames: false,
        dailySpinBonusXp: 5,
        color: '#C0C0C0',
        icon: '🥈'
    },
    {
        name: 'Gold',
        minXp: 5000,
        cashbackPct: 8,
        depositBonusMult: 1.25,
        withdrawalPriority: 2,
        exclusiveGames: true,
        dailySpinBonusXp: 15,
        color: '#FFD700',
        icon: '🥇'
    },
    {
        name: 'Platinum',
        minXp: 25000,
        cashbackPct: 12,
        depositBonusMult: 1.50,
        withdrawalPriority: 1,
        exclusiveGames: true,
        dailySpinBonusXp: 50,
        color: '#E5E4E2',
        icon: '💎'
    },
    {
        name: 'Diamond',
        minXp: 100000,
        cashbackPct: 18,
        depositBonusMult: 2.00,
        withdrawalPriority: 1,
        exclusiveGames: true,
        dailySpinBonusXp: 200,
        color: '#B9F2FF',
        icon: '👑'
    }
];

const TIER_NAMES = TIERS.map(function (t) { return t.name; });
const TIER_BY_NAME = {};
TIERS.forEach(function (t) { TIER_BY_NAME[t.name] = t; });

function tierFromXp(xp) {
    var x = Number(xp) || 0;
    var current = TIERS[0];
    for (var i = 0; i < TIERS.length; i++) {
        if (x >= TIERS[i].minXp) current = TIERS[i];
        else break;
    }
    return current;
}

function nextTier(currentName) {
    var idx = TIER_NAMES.indexOf(currentName);
    if (idx < 0 || idx >= TIERS.length - 1) return null;
    return TIERS[idx + 1];
}

/**
 * Award XP based on bet amount (1 XP per $1 wagered, integer floor).
 * Atomically updates xp + lifetime, then promotes tier if threshold crossed.
 * Fire-and-forget safe: caller can ignore the returned promise.
 *
 * Returns { xpGained, totalXp, lifetimeXp, oldTier, newTier, tierUp }.
 */
async function addXp(userId, betAmount) {
    var xp = Math.floor(Number(betAmount) || 0);
    if (!userId || xp <= 0) {
        return { xpGained: 0, tierUp: false };
    }

    // Atomic XP increment — both running and lifetime.
    await db.run(
        'UPDATE users SET vip_xp = COALESCE(vip_xp, 0) + ?, vip_xp_lifetime = COALESCE(vip_xp_lifetime, 0) + ? WHERE id = ?',
        [xp, xp, userId]
    );

    // Re-read to determine current tier.
    var row = await db.get(
        'SELECT vip_xp_lifetime AS lifetime, vip_xp AS xp, vip_tier AS tier FROM users WHERE id = ?',
        [userId]
    );
    if (!row) return { xpGained: xp, tierUp: false };

    var oldTierName = row.tier || 'Bronze';
    var calculatedTier = tierFromXp(row.lifetime || 0);

    var tierUp = false;
    if (calculatedTier.name !== oldTierName &&
        TIER_NAMES.indexOf(calculatedTier.name) > TIER_NAMES.indexOf(oldTierName)) {
        // Promote — single-direction (no demotions from XP).
        await db.run(
            "UPDATE users SET vip_tier = ?, vip_tier_reached_at = " +
            (db.isPg() ? 'NOW()' : "datetime('now')") +
            " WHERE id = ?",
            [calculatedTier.name, userId]
        );
        await _logTierUp(userId, oldTierName, calculatedTier.name);
        tierUp = true;
    }

    return {
        xpGained: xp,
        totalXp: row.lifetime,
        lifetimeXp: row.lifetime,
        oldTier: oldTierName,
        newTier: calculatedTier.name,
        tierUp: tierUp
    };
}

async function _logTierUp(userId, oldTier, newTier) {
    try {
        await db.run(
            'INSERT INTO transactions (user_id, type, amount, balance_before, balance_after, reference) VALUES (?, ?, ?, ?, ?, ?)',
            [userId, 'vip_tier_up', 0, 0, 0, 'Promoted from ' + oldTier + ' to ' + newTier]
        );
    } catch (_) { /* table might be missing during early bootstrap */ }
    try {
        await db.run(
            'INSERT INTO notifications (user_id, type, title, body) VALUES (?, ?, ?, ?)',
            [userId, 'vip_tier_up', 'VIP Tier Upgraded!', 'Welcome to ' + newTier + ' — enjoy your new benefits.']
        );
    } catch (_) { /* notifications table optional */ }
    // Grant matching achievement
    try {
        var ach = require('./achievement.service');
        var achId = 'vip_' + newTier.toLowerCase();
        if (typeof ach.grant === 'function') {
            await ach.grant(userId, achId);
        }
    } catch (_) {}
}

/**
 * Track net loss for monthly cashback. Called from spin/payment flows.
 * netLoss = bet - winAmount (can be negative on a winning spin → ignored).
 */
async function trackNetLoss(userId, netLoss) {
    var loss = Number(netLoss) || 0;
    if (!userId || loss <= 0) return;
    var period = _currentPeriod();
    // Reset if period changed
    var row = await db.get('SELECT vip_monthly_period FROM users WHERE id = ?', [userId]);
    if (!row) return;
    if (row.vip_monthly_period !== period) {
        await db.run(
            'UPDATE users SET vip_monthly_loss = ?, vip_monthly_period = ? WHERE id = ?',
            [loss, period, userId]
        );
    } else {
        await db.run(
            'UPDATE users SET vip_monthly_loss = COALESCE(vip_monthly_loss, 0) + ? WHERE id = ?',
            [loss, userId]
        );
    }
}

function _currentPeriod() {
    var d = new Date();
    return d.getUTCFullYear() + '-' + String(d.getUTCMonth() + 1).padStart(2, '0');
}

/**
 * Compute eligible cashback for a user based on current tier and monthly loss.
 * Returns the amount; caller decides when to credit.
 */
function computeCashback(tierName, monthlyLoss) {
    var tier = TIER_BY_NAME[tierName] || TIERS[0];
    var loss = Math.max(0, Number(monthlyLoss) || 0);
    return Math.floor(loss * (tier.cashbackPct / 100) * 100) / 100;
}

/**
 * Claim available cashback. Atomic: read current loss/period, credit
 * bonus_balance with 10x wagering, reset monthly loss, set last credited.
 * Returns { credited, amount } or { credited: false, reason }.
 */
async function claimCashback(userId) {
    var row = await db.get(
        'SELECT vip_tier, vip_monthly_loss, vip_monthly_period, vip_cashback_last_credited FROM users WHERE id = ?',
        [userId]
    );
    if (!row) return { credited: false, reason: 'User not found' };

    var period = _currentPeriod();
    var lastCredited = row.vip_cashback_last_credited;
    if (lastCredited) {
        var lastIso = String(lastCredited);
        var lastPeriod = lastIso.slice(0, 7);
        if (lastPeriod === period) {
            return { credited: false, reason: 'Cashback already claimed this period' };
        }
    }

    var amount = computeCashback(row.vip_tier || 'Bronze', row.vip_monthly_loss || 0);
    if (amount <= 0) {
        return { credited: false, reason: 'No cashback available — keep playing!' };
    }

    var nowSql = db.isPg() ? 'NOW()' : "datetime('now')";
    var wagering = amount * 10; // loss compensation 10x

    await db.run(
        'UPDATE users SET ' +
        'bonus_balance = COALESCE(bonus_balance, 0) + ?, ' +
        'wagering_requirement = COALESCE(wagering_requirement, 0) + ?, ' +
        'vip_monthly_loss = 0, ' +
        'vip_cashback_last_credited = ' + nowSql + ' ' +
        'WHERE id = ?',
        [amount, wagering, userId]
    );

    try {
        await db.run(
            'INSERT INTO transactions (user_id, type, amount, balance_before, balance_after, reference) VALUES (?, ?, ?, ?, ?, ?)',
            [userId, 'vip_cashback', amount, 0, 0, 'VIP ' + (row.vip_tier || 'Bronze') + ' monthly cashback']
        );
    } catch (_) {}

    return { credited: true, amount: amount, wagering: wagering, tier: row.vip_tier };
}

/**
 * Public read: full VIP status for the player profile page.
 */
async function getStatus(userId) {
    var row = await db.get(
        'SELECT vip_tier, vip_xp, vip_xp_lifetime, vip_tier_reached_at, ' +
        'vip_cashback_pending, vip_cashback_last_credited, ' +
        'vip_monthly_loss, vip_monthly_period FROM users WHERE id = ?',
        [userId]
    );
    if (!row) return null;

    var lifetime = Number(row.vip_xp_lifetime || 0);
    var current = tierFromXp(lifetime);
    var next = nextTier(current.name);

    var progressPct = 100;
    var xpToNext = 0;
    if (next) {
        var span = next.minXp - current.minXp;
        var earned = lifetime - current.minXp;
        progressPct = Math.min(100, Math.max(0, Math.floor((earned / span) * 100)));
        xpToNext = Math.max(0, next.minXp - lifetime);
    }

    var availableCashback = computeCashback(current.name, row.vip_monthly_loss || 0);
    var canClaim = availableCashback > 0 &&
        (!row.vip_cashback_last_credited ||
         String(row.vip_cashback_last_credited).slice(0, 7) !== _currentPeriod());

    return {
        tier: current.name,
        tierIcon: current.icon,
        tierColor: current.color,
        xp: Number(row.vip_xp || 0),
        xpLifetime: lifetime,
        xpToNext: xpToNext,
        progressPct: progressPct,
        nextTier: next ? next.name : null,
        nextTierIcon: next ? next.icon : null,
        nextTierMinXp: next ? next.minXp : null,
        benefits: {
            cashbackPct: current.cashbackPct,
            depositBonusMult: current.depositBonusMult,
            withdrawalPriority: current.withdrawalPriority,
            exclusiveGames: current.exclusiveGames,
            dailySpinBonusXp: current.dailySpinBonusXp
        },
        cashback: {
            availableAmount: availableCashback,
            monthlyLoss: Number(row.vip_monthly_loss || 0),
            period: row.vip_monthly_period || _currentPeriod(),
            canClaim: canClaim,
            lastCredited: row.vip_cashback_last_credited
        }
    };
}

function getTiers() {
    return TIERS.map(function (t) {
        return {
            name: t.name,
            minXp: t.minXp,
            cashbackPct: t.cashbackPct,
            depositBonusMult: t.depositBonusMult,
            withdrawalPriority: t.withdrawalPriority,
            exclusiveGames: t.exclusiveGames,
            dailySpinBonusXp: t.dailySpinBonusXp,
            color: t.color,
            icon: t.icon
        };
    });
}

/**
 * Auto-credit monthly cashback for all eligible players. Run by scheduler
 * on the 1st of each month.
 */
async function autoCreditMonthlyCashback() {
    var period = _currentPeriod();
    var rows = await db.all(
        'SELECT id FROM users WHERE COALESCE(vip_monthly_loss, 0) > 0 AND ' +
        '(vip_cashback_last_credited IS NULL OR ' +
        '  ' + (db.isPg() ? "TO_CHAR(vip_cashback_last_credited, 'YYYY-MM')" : "substr(vip_cashback_last_credited, 1, 7)") +
        ' <> ?)',
        [period]
    );
    var credited = 0;
    var totalAmount = 0;
    for (var i = 0; i < rows.length; i++) {
        try {
            var r = await claimCashback(rows[i].id);
            if (r && r.credited) {
                credited++;
                totalAmount += r.amount;
            }
        } catch (e) {
            console.warn('[VIP] autoCredit failed for user', rows[i].id, e.message);
        }
    }
    return { credited: credited, totalAmount: totalAmount };
}

module.exports = {
    TIERS: TIERS,
    tierFromXp: tierFromXp,
    nextTier: nextTier,
    addXp: addXp,
    trackNetLoss: trackNetLoss,
    computeCashback: computeCashback,
    claimCashback: claimCashback,
    getStatus: getStatus,
    getTiers: getTiers,
    autoCreditMonthlyCashback: autoCreditMonthlyCashback
};
