'use strict';

/**
 * Global Daily Bonus Cap Service
 *
 * Prevents players from stacking unlimited bonuses across all bonus types.
 * Industry standard for premium slots: cap total daily bonuses to prevent
 * exploitation and protect house profitability.
 *
 * Maximum daily bonus: $75 across all types combined.
 */

const db = require('../database');

const MAX_DAILY_BONUS_TOTAL = 75; // $75 max across all bonus types per day

/**
 * Check how much bonus a user has already received today.
 * Returns { totalToday, remaining, canReceive }
 */
async function checkDailyCap(userId) {
    try {
        // ROUND 45: Expanded to cover ALL bonus transaction types. Previously
        // only counted type='bonus', allowing daily_login, referral_bonus,
        // achievement_reward, winback_bonus, comeback_bonus, etc. to bypass
        // the $75/day global cap entirely.
        // ROUND 50: Changed from rolling 24-hour window to UTC calendar day.
        // Previously used datetime('now', '-1 day') — a user could claim $75 at
        // 11PM, then another $75 at 1AM = $150 in 2 hours by straddling the
        // 24-hour boundary. Calendar day resets at midnight UTC, which is standard
        // practice for online gaming daily caps.
        const row = await db.get(
            "SELECT COALESCE(SUM(amount), 0) as total FROM transactions WHERE user_id = ? AND type IN ('bonus', 'daily_login', 'referral_bonus', 'achievement_reward', 'winback_bonus', 'comeback_bonus', 'session_reengage', 'session_bonus', 'cashback', 'daily_bonus', 'promo_code', 'promo', 'retention_bonus', 'battle_pass', 'battle_pass_reward', 'free_spin', 'milestone_reward', 'xpshop', 'deposit_streak', 'loss_streak', 'reload_bonus', 'first_deposit_bonus', 'vip_wheel', 'subscription_daily', 'rakeback', 'loss_cashback', 'birthday_bonus', 'streak_reward') AND DATE(created_at) = DATE('now')",
            [userId]
        );

        const totalToday = row ? parseFloat(row.total) : 0;
        const remaining = Math.max(0, MAX_DAILY_BONUS_TOTAL - totalToday);

        return {
            totalToday: Math.round(totalToday * 100) / 100,
            remaining: Math.round(remaining * 100) / 100,
            canReceive: remaining > 0
        };
    } catch (err) {
        // ROUND 32: Fail CLOSED — was returning canReceive:true on DB error,
        // letting all bonuses through when database is unreachable.
        console.error('[BonusCap] Check error (fail-closed):', err.message);
        return { totalToday: MAX_DAILY_BONUS_TOTAL, remaining: 0, canReceive: false };
    }
}

/**
 * Cap a bonus amount to not exceed the daily limit.
 * Returns the capped amount (may be 0 if cap reached).
 */
async function capBonusAmount(userId, requestedAmount) {
    // SECURITY: Validate input to prevent NaN/Infinity propagation
    if (!Number.isFinite(requestedAmount) || requestedAmount <= 0) {
        return 0;
    }
    const { remaining } = await checkDailyCap(userId);
    var result = Math.min(requestedAmount, remaining);
    // Final safety: ensure we never return NaN or negative
    if (!Number.isFinite(result) || result < 0) return 0;
    return Math.round(result * 100) / 100;
}

module.exports = {
    checkDailyCap,
    capBonusAmount,
    MAX_DAILY_BONUS_TOTAL
};
