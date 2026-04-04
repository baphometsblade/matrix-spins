'use strict';
const db = require('../database');

// VIP tier thresholds (mirrors constants.js VIP_TIERS on the client)
const VIP_TIERS = [
    { id: 'bronze',   name: 'Bronze',   minWagered: 0 },
    { id: 'silver',   name: 'Silver',   minWagered: 250 },
    { id: 'gold',     name: 'Gold',     minWagered: 5000 },
    { id: 'platinum', name: 'Platinum', minWagered: 20000 },
    { id: 'diamond',  name: 'Diamond',  minWagered: 50000 }
];

/**
 * Resolve the VIP tier and next-tier info from a total wagered amount.
 * Returns { current, next, progressPct, amountNeeded }
 */
function resolveVipTier(totalWagered) {
    let idx = 0;
    for (let i = VIP_TIERS.length - 1; i >= 0; i--) {
        if (totalWagered >= VIP_TIERS[i].minWagered) { idx = i; break; }
    }
    const current = VIP_TIERS[idx];
    const next    = idx < VIP_TIERS.length - 1 ? VIP_TIERS[idx + 1] : null;
    let progressPct = 100;
    let amountNeeded = 0;
    if (next) {
        const range    = next.minWagered - current.minWagered;
        const progress = totalWagered - current.minWagered;
        progressPct  = Math.min(100, Math.max(0, (progress / range) * 100));
        amountNeeded = next.minWagered - totalWagered;
    }
    return { current, next, progressPct, amountNeeded };
}

/**
 * Evaluate bonus rules for a user and return personalized, data-driven bonus offers.
 * Called after login or on demand to show personalized promotions.
 *
 * Returns an array of up to 3 offers, each with:
 *   { type, title, message, cta, priority, tag? }
 */
async function getPersonalizedOffers(userId) {
    const offers = [];

    try {
        // ── Player profile ────────────────────────────────────────────────────
        const user = await db.get(
            `SELECT id, balance, bonus_balance, wagering_requirement, wagering_progress,
                    created_at, last_daily_claim, daily_streak, xp
             FROM users WHERE id = ?`, [userId]
        );
        if (!user) return offers;

        // ── Activity stats ────────────────────────────────────────────────────
        const lifetimeStats = await db.get(`
            SELECT COUNT(*) as spins,
                   COALESCE(SUM(bet_amount), 0) as wagered,
                   COALESCE(SUM(win_amount), 0) as won,
                   COALESCE(MAX(win_amount), 0)  as bestWin
            FROM spins WHERE user_id = ?
        `, [userId]);

        const last7d = await db.get(`
            SELECT COUNT(*) as spins,
                   COALESCE(SUM(bet_amount), 0) as wagered,
                   COALESCE(SUM(win_amount), 0) as won
            FROM spins WHERE user_id = ? AND created_at >= datetime('now', '-7 days')
        `, [userId]);

        const today = await db.get(`
            SELECT COALESCE(SUM(bet_amount), 0) as wagered,
                   COALESCE(SUM(win_amount), 0) as won
            FROM spins WHERE user_id = ? AND created_at >= datetime('now', 'start of day')
        `, [userId]);

        const last24h = await db.get(`
            SELECT COUNT(*) as spins
            FROM spins WHERE user_id = ? AND created_at >= datetime('now', '-1 day')
        `, [userId]);

        // ── Deposit history ───────────────────────────────────────────────────
        const depositStats = await db.get(
            `SELECT COUNT(*) as cnt, COALESCE(SUM(amount), 0) as total
             FROM deposits WHERE user_id = ? AND status = 'completed'`, [userId]
        );

        const lastDeposit = await db.get(
            `SELECT amount, created_at FROM deposits WHERE user_id = ? AND status = 'completed'
             ORDER BY created_at DESC LIMIT 1`, [userId]
        );

        // ── Derived values ────────────────────────────────────────────────────
        const totalWagered  = lifetimeStats ? lifetimeStats.wagered : 0;
        const hasDeposited  = depositStats && depositStats.cnt > 0;
        const lowBalance    = user.balance < 10;
        const todayNetLoss  = today ? (today.wagered - today.won) : 0;
        const vip           = resolveVipTier(totalWagered);
        const dayOfWeek     = new Date().getDay(); // 0=Sun, 5=Fri, 6=Sat
        const isWeekend     = dayOfWeek === 5 || dayOfWeek === 6 || dayOfWeek === 0;

        // ── Rule: First deposit — highest priority for new accounts ───────────
        if (!hasDeposited) {
            offers.push({
                type: 'first_deposit',
                title: '🎁 Welcome Bonus Ready!',
                message: '100% match on your first deposit up to $500 — double your starting balance!',
                cta: 'Claim Welcome Bonus',
                priority: 12,
                tag: 'NEW PLAYER'
            });
        }

        // ── Rule: Reload bonus — deposited before, balance critically low ─────
        if (hasDeposited && lowBalance && last7d && last7d.spins > 5) {
            offers.push({
                type: 'reload_bonus',
                title: '🔥 Reload Bonus Available!',
                message: 'Get 50% extra credits on your next deposit up to $250 — don\'t stop now!',
                cta: 'Deposit Now',
                priority: 11,
                tag: 'HOT DEAL'
            });
        }

        // ── Rule: High roller — wagered over $1,000 in the last 7 days ────────
        if (last7d && last7d.wagered > 1000) {
            offers.push({
                type: 'high_roller',
                title: '💎 High Roller Offer',
                message: 'You\'re playing big! Get a 75% match bonus on your next deposit of $200 or more.',
                cta: 'Get VIP Bonus',
                priority: 10,
                tag: 'EXCLUSIVE'
            });
        }

        // ── Rule: Loss recovery — net loss today > $100 ───────────────────────
        if (todayNetLoss > 100) {
            offers.push({
                type: 'loss_recovery',
                title: '💪 Recovery Boost',
                message: `You\'re down $${todayNetLoss.toFixed(0)} today — deposit $50+ and we\'ll add 25% extra credits to turn it around.`,
                cta: 'Claim Recovery Bonus',
                priority: 9,
                tag: 'CASHBACK'
            });
        }

        // ── Rule: VIP push — within 20% of next tier ─────────────────────────
        if (vip.next && vip.progressPct >= 80) {
            const needed = Math.ceil(vip.amountNeeded);
            offers.push({
                type: 'vip_push',
                title: `⚡ VIP Fast-Track to ${vip.next.name}!`,
                message: `You\'re only $${needed} in wagers away from ${vip.next.name} status — deposit and play to unlock exclusive ${vip.next.name} rewards!`,
                cta: 'Level Up Now',
                priority: 8,
                tag: 'VIP OFFER'
            });
        }

        // ── Rule: Weekend special ─────────────────────────────────────────────
        if (isWeekend) {
            offers.push({
                type: 'weekend_special',
                title: '🎉 Weekend Warrior Bonus',
                message: 'It\'s the weekend! Earn double XP on every spin all weekend long — play more, level up faster.',
                cta: 'Play Now',
                priority: 7,
                tag: 'WEEKEND'
            });
        }

        // ── Rule: Comeback nudge — inactive but was active recently ──────────
        if (last24h && last24h.spins === 0 && last7d && last7d.spins > 0) {
            offers.push({
                type: 'comeback',
                title: '👋 Welcome Back!',
                message: 'We\'ve missed you! Jump back in — your first win today is automatically doubled.',
                cta: 'Start Spinning',
                priority: 6,
                tag: 'COMEBACK'
            });
        }

        // ── Rule: Low-balance top-up for active players (general) ────────────
        if (hasDeposited && lowBalance && !(last7d && last7d.spins > 5)) {
            offers.push({
                type: 'low_balance',
                title: '⚡ Top Up Bonus',
                message: 'Your balance is running low! Deposit now and get 75% extra credits to keep the wins coming.',
                cta: 'Deposit Now',
                priority: 5,
                tag: 'LIMITED'
            });
        }

        // ── Rule: Streak reward — 5+ day login streak ─────────────────────────
        if (user.daily_streak >= 5) {
            offers.push({
                type: 'streak_reward',
                title: `🔥 ${user.daily_streak}-Day Streak Bonus!`,
                message: `You\'re on fire with a ${user.daily_streak}-day login streak! Claim your free bonus wheel spin as a reward.`,
                cta: 'Claim Wheel Spin',
                priority: 4,
                tag: 'STREAK'
            });
        }

        // ── Fallback: if no offers generated, return generic first-deposit ────
        if (offers.length === 0) {
            offers.push({
                type: 'first_deposit',
                title: '🎁 Welcome Bonus Ready!',
                message: '100% match on your first deposit up to $500 — double your starting balance!',
                cta: 'Claim Welcome Bonus',
                priority: 12,
                tag: 'NEW PLAYER'
            });
        }

        // Sort by priority (highest first) and return top 3
        offers.sort((a, b) => b.priority - a.priority);
        return offers.slice(0, 3);

    } catch (e) {
        console.warn('[BonusRules] error:', e.message);
        return offers;
    }
}

module.exports = { getPersonalizedOffers };
