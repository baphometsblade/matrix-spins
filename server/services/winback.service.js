'use strict';

const db = require('../database');

/**
 * Win-back bonus tiers based on dormancy duration.
 * 3-7 days dormant: $2, 7-14 days: $5, 14+ days: $10.
 */
const WINBACK_TIERS = [
    { minDays: 14, amount: 10 },
    { minDays: 7,  amount: 5 },
    { minDays: 3,  amount: 2 },
];

const WAGERING_MULTIPLIER = 10;

/**
 * Identify players who have gone dormant (3+ days since last spin),
 * have low balance (< $5), are not banned, and have spun at least once.
 */
async function identifyDormantPlayers() {
    const rows = await db.all(`
        SELECT
            u.id AS userId,
            u.username,
            u.email,
            u.balance,
            MAX(s.created_at) AS last_spin,
            CAST(julianday('now') - julianday(MAX(s.created_at)) AS INTEGER) AS lastSpinDays
        FROM users u
        JOIN spins s ON s.user_id = u.id
        WHERE u.is_banned = 0
          AND u.balance < 5
          AND s.created_at < datetime('now', '-3 days')
        GROUP BY u.id, u.username, u.email, u.balance
        HAVING MAX(s.created_at) < datetime('now', '-3 days')
        ORDER BY lastSpinDays DESC
    `);

    return rows.map(function (r) {
        return {
            userId: r.userId,
            username: r.username,
            email: r.email,
            lastSpinDays: r.lastSpinDays,
            balance: r.balance,
        };
    });
}

/**
 * Grant a win-back bonus to a single user.
 * Credits bonus_balance and sets wagering requirement at 10x the bonus.
 * Inserts a transaction record for audit.
 */
async function grantWinBackBonus(userId, amount) {
    const wageringReq = amount * WAGERING_MULTIPLIER;

    await db.run(
        `UPDATE users SET bonus_balance = bonus_balance + ?,
             wagering_requirement = wagering_requirement + ?
         WHERE id = ?`,
        [amount, wageringReq, userId]
    );

    const user = await db.get('SELECT balance, bonus_balance FROM users WHERE id = ?', [userId]);

    await db.run(
        `INSERT INTO transactions (user_id, type, amount, balance_before, balance_after, reference)
         VALUES (?, 'winback_bonus', ?, ?, ?, ?)`,
        [userId, amount, user ? user.balance : 0, user ? user.balance : 0,
            'winback:$' + amount + ':10x_wager']
    );

    return { success: true, bonusAmount: amount };
}

/**
 * Determine the bonus amount for a given dormancy duration.
 */
function getTierAmount(lastSpinDays) {
    for (const tier of WINBACK_TIERS) {
        if (lastSpinDays >= tier.minDays) {
            return tier.amount;
        }
    }
    return 0;
}

/**
 * Run the full win-back cycle: identify dormant players and grant tiered bonuses.
 * Returns a summary of how many players were processed and total bonus granted.
 */
async function runWinBackCycle() {
    const dormantPlayers = await identifyDormantPlayers();

    let processed = 0;
    let totalBonused = 0;

    for (const player of dormantPlayers) {
        const amount = getTierAmount(player.lastSpinDays);
        if (amount <= 0) continue;

        await grantWinBackBonus(player.userId, amount);
        processed++;
        totalBonused += amount;
    }

    if (processed > 0) {
        console.warn(`[WinBack] Granted bonuses to ${processed} dormant players, total: $${totalBonused}`);
    }

    return { processed, totalBonused };
}

module.exports = {
    identifyDormantPlayers,
    grantWinBackBonus,
    runWinBackCycle,
};
