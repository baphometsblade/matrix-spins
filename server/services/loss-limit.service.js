'use strict';
const db = require('../database');
const config = require('../config');

/**
 * Map VIP tier string labels (from total wagered) to numeric tier 0-5
 * for cashback rate lookup.
 */
function computeVipTierNumeric(totalWagered) {
    const w = parseFloat(totalWagered) || 0;
    if (w >= 100000) return 5; // Elite
    if (w >= 50000)  return 4; // Diamond
    if (w >= 20000)  return 3; // Platinum
    if (w >= 10000)  return 2; // Gold
    if (w >= 5000)   return 1; // Silver
    return 0;                  // Bronze / unranked
}

/**
 * Check if user has exceeded daily loss limit.
 * Returns { allowed: boolean, dailyLoss: number, limit: number, cashback: object|null }
 */
async function checkDailyLossLimit(userId, proposedBet) {
    try {
        // Get user's balance
        const user = await db.get(
            'SELECT balance FROM users WHERE id = ?', [userId]
        );
        if (!user) return { allowed: true, dailyLoss: 0, limit: 0 };

        // Get user's loss limit from user_limits table, fall back to config default
        const limitsRow = await db.get(
            'SELECT daily_loss_limit FROM user_limits WHERE user_id = ?', [userId]
        );
        const limit = (limitsRow && limitsRow.daily_loss_limit)
            ? limitsRow.daily_loss_limit
            : config.DAILY_LOSS_LIMIT_DEFAULT;

        // Calculate today's net loss (wagered - won)
        const today = await db.get(`
            SELECT COALESCE(SUM(bet_amount), 0) as wagered, COALESCE(SUM(win_amount), 0) as won
            FROM spins WHERE user_id = ? AND created_at >= datetime('now', 'start of day')
        `, [userId]);

        const dailyLoss = (today ? today.wagered - today.won : 0);

        // If adding this bet would exceed limit, check if cashback should trigger
        if (dailyLoss + proposedBet > limit) {
            // Check if cashback already granted today
            const existingCashback = await db.get(`
                SELECT id FROM transactions
                WHERE user_id = ? AND type = 'loss_cashback'
                AND created_at >= datetime('now', 'start of day')
            `, [userId]);

            if (!existingCashback && dailyLoss > 0) {
                // Compute VIP tier from total wagered across all games
                const wagerRow = await db.get(
                    'SELECT COALESCE(SUM(bet_amount), 0) as total_wagered FROM spins WHERE user_id = ?',
                    [userId]
                );
                const vipTier = computeVipTierNumeric(wagerRow ? wagerRow.total_wagered : 0);
                const rate = (config.LOSS_CASHBACK_VIP_RATES && config.LOSS_CASHBACK_VIP_RATES[vipTier])
                    || config.LOSS_CASHBACK_RATE;
                let cashbackAmount = Math.min(dailyLoss * rate, config.LOSS_CASHBACK_MAX);
                cashbackAmount = Math.round(cashbackAmount * 100) / 100;

                if (cashbackAmount > 0) {
                    // Read balance before crediting
                    const balBefore = user.balance;

                    // Credit cashback to bonus_balance with 10x wagering (loss compensation)
                    await db.run('UPDATE users SET bonus_balance = COALESCE(bonus_balance, 0) + ?, wagering_requirement = COALESCE(wagering_requirement, 0) + ? WHERE id = ?', [cashbackAmount, cashbackAmount * 10, userId]);

                    // Log transaction with balance_before and balance_after
                    const balanceAfter = balBefore + cashbackAmount;
                    await db.run(`
                        INSERT INTO transactions (user_id, type, amount, balance_before, balance_after, reference, created_at)
                        VALUES (?, 'loss_cashback', ?, ?, ?, ?, datetime('now'))
                    `, [userId, cashbackAmount, balBefore, balanceAfter,
                        'Daily loss limit cashback (' + Math.round(rate * 100) + '% of $' + dailyLoss.toFixed(0) + ' loss)']);

                    return {
                        allowed: false,
                        dailyLoss: dailyLoss,
                        limit: limit,
                        cashback: {
                            amount: cashbackAmount,
                            rate: rate,
                            message: 'Daily loss limit reached! $' + cashbackAmount.toFixed(2) + ' cashback credited.'
                        }
                    };
                }
            }

            return { allowed: false, dailyLoss: dailyLoss, limit: limit, cashback: null };
        }

        return {
            allowed: true,
            dailyLoss: dailyLoss,
            limit: limit,
            remaining: limit - dailyLoss,
            cashback: null
        };
    } catch (e) {
        console.warn('[LossLimit] check error:', e.message);
        return { allowed: true, dailyLoss: 0, limit: 0 }; // fail open
    }
}

module.exports = { checkDailyLossLimit };
