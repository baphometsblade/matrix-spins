'use strict';

/**
 * Shared responsible-gambling + fraud-velocity checks for every
 * deposit-initiating route.
 *
 * Used by:
 *   server/routes/payment.routes.js       (/api/payment/deposit)
 *   server/routes/stripe-checkout.routes.js (/api/payment/create-checkout)
 *   server/routes/matrix-money.routes.js   (/api/matrix-money/purchase)
 *   server/routes/bundle.routes.js         (/api/bundles/purchase)
 *
 * Centralised here so a user cannot bypass their own daily limit just by
 * hitting a different deposit endpoint. Each check returns null on pass
 * or a human-readable error message on block.
 */

const db = require('../database');

/**
 * Check self-exclusion + cooling-off windows.
 * @returns {Promise<string|null>} null if OK, error string if blocked.
 */
async function checkExclusion(userId) {
    let limits;
    try {
        limits = await db.get(
            'SELECT self_excluded_until, cooling_off_until FROM user_limits WHERE user_id = ?',
            [userId]
        );
    } catch (e) {
        if (e.message && e.message.includes('no such table')) return null;
        throw e;
    }
    if (!limits) return null;

    const now = new Date().toISOString();
    if (limits.self_excluded_until && limits.self_excluded_until > now) {
        return `Account is self-excluded until ${limits.self_excluded_until}`;
    }
    if (limits.cooling_off_until && limits.cooling_off_until > now) {
        return `Account is in cooling-off period until ${limits.cooling_off_until}`;
    }

    // Also check self_exclusions table (legacy path)
    try {
        const exclusion = await db.get(
            "SELECT id FROM self_exclusions WHERE user_id = ? AND is_active = 1 AND (ends_at IS NULL OR ends_at > datetime('now'))",
            [userId]
        );
        if (exclusion) {
            return 'Account is self-excluded from deposits.';
        }
    } catch (e) {
        if (e.message && !e.message.includes('no such table')) throw e;
    }

    return null;
}

/**
 * Check daily/weekly/monthly deposit limits the user has configured.
 * @returns {Promise<string|null>} null if OK, error string if blocked.
 */
async function checkDepositLimits(userId, amount) {
    let limits;
    try {
        limits = await db.get(
            'SELECT daily_deposit_limit, weekly_deposit_limit, monthly_deposit_limit FROM user_limits WHERE user_id = ?',
            [userId]
        );
    } catch (e) {
        if (e.message && e.message.includes('no such table')) return null;
        throw e;
    }
    if (!limits) return null;

    const now = new Date();

    if (limits.daily_deposit_limit !== null && limits.daily_deposit_limit !== undefined) {
        const dayStart = new Date(now);
        dayStart.setHours(0, 0, 0, 0);
        const daily = await db.get(
            "SELECT COALESCE(SUM(amount), 0) as total FROM deposits WHERE user_id = ? AND status = 'completed' AND created_at >= ?",
            [userId, dayStart.toISOString()]
        );
        const total = (daily && daily.total) || 0;
        if (total + amount > limits.daily_deposit_limit) {
            return `Daily deposit limit of $${limits.daily_deposit_limit.toFixed(2)} would be exceeded. Already deposited $${total.toFixed(2)} today.`;
        }
    }

    if (limits.weekly_deposit_limit !== null && limits.weekly_deposit_limit !== undefined) {
        const weekStart = new Date(now);
        weekStart.setDate(weekStart.getDate() - 7);
        const weekly = await db.get(
            "SELECT COALESCE(SUM(amount), 0) as total FROM deposits WHERE user_id = ? AND status = 'completed' AND created_at >= ?",
            [userId, weekStart.toISOString()]
        );
        const total = (weekly && weekly.total) || 0;
        if (total + amount > limits.weekly_deposit_limit) {
            return `Weekly deposit limit of $${limits.weekly_deposit_limit.toFixed(2)} would be exceeded. Already deposited $${total.toFixed(2)} this week.`;
        }
    }

    if (limits.monthly_deposit_limit !== null && limits.monthly_deposit_limit !== undefined) {
        const monthStart = new Date(now);
        monthStart.setDate(monthStart.getDate() - 30);
        const monthly = await db.get(
            "SELECT COALESCE(SUM(amount), 0) as total FROM deposits WHERE user_id = ? AND status = 'completed' AND created_at >= ?",
            [userId, monthStart.toISOString()]
        );
        const total = (monthly && monthly.total) || 0;
        if (total + amount > limits.monthly_deposit_limit) {
            return `Monthly deposit limit of $${limits.monthly_deposit_limit.toFixed(2)} would be exceeded. Already deposited $${total.toFixed(2)} this month.`;
        }
    }

    return null;
}

/**
 * Rate-limit deposit INITIATIONS — blocks automated abuse / stolen-card runs.
 * Counts ALL deposits (pending + completed) within the window because a
 * sophisticated attacker would try many pending sessions without completing.
 * @returns {Promise<string|null>} null if OK, error string if blocked.
 */
async function checkDepositVelocity(userId) {
    // Max 3 deposits per hour
    const hourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const hourly = await db.get(
        'SELECT COUNT(*) as count FROM deposits WHERE user_id = ? AND created_at >= ?',
        [userId, hourAgo]
    );
    if (hourly && hourly.count >= 3) {
        return 'Too many deposit attempts. Please wait before trying again.';
    }

    // Max 5 deposits per 24 hours
    const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const daily = await db.get(
        'SELECT COUNT(*) as count FROM deposits WHERE user_id = ? AND created_at >= ?',
        [userId, dayAgo]
    );
    if (daily && daily.count >= 5) {
        return 'Daily deposit attempt limit reached. Please try again tomorrow.';
    }

    // Max 3 pending deposits at once (prevents queue flooding)
    const pending = await db.get(
        "SELECT COUNT(*) as count FROM deposits WHERE user_id = ? AND status = 'pending'",
        [userId]
    );
    if (pending && pending.count >= 3) {
        return 'You have too many pending deposits. Please wait for them to process.';
    }

    return null;
}

/**
 * Run all three checks in sequence. First failure wins.
 * Return shape matches what express routes need: { allowed, error }.
 */
async function runAllChecks(userId, amount) {
    const exclusion = await checkExclusion(userId);
    if (exclusion) return { allowed: false, error: exclusion };

    const limits = await checkDepositLimits(userId, amount);
    if (limits) return { allowed: false, error: limits };

    const velocity = await checkDepositVelocity(userId);
    if (velocity) return { allowed: false, error: velocity };

    return { allowed: true, error: null };
}

module.exports = {
    checkExclusion,
    checkDepositLimits,
    checkDepositVelocity,
    runAllChecks,
};
