'use strict';

/**
 * Referral Commission Service
 *
 * Handles ongoing referral revenue-share earnings:
 *   - Tier 1 (direct referrer): 5% of referee's net loss for 30 days
 *   - Tier 2 (referrer's referrer): 1% of sub-referee's net loss for 30 days
 *
 * Commissions accrue per-spin into `referral_commissions` (status='pending')
 * and are batched daily into `referral_commission_summary`. Users explicitly
 * claim accrued commissions, which credits `bonus_balance` with 10x wagering
 * (loss-compensation tier per CLAUDE.md).
 *
 * Anti-fraud:
 *   - 30-day window per referee is hard-coded
 *   - Minimum referee wagering before any commission unlocks ($10)
 *   - Self-exclusion check on referrer before payout
 *   - Commissions only accrue on REAL balance bets (not bonus_balance bets)
 */

const db = require('../database');

const TIER_1_RATE        = 0.05;   // 5% of net loss
const TIER_2_RATE        = 0.01;   // 1% of net loss
const COMMISSION_WINDOW_DAYS = 30;
const MIN_REFEREE_WAGER  = 10.0;   // referee must have wagered ≥$10 lifetime
const MIN_PAYOUT_AMOUNT  = 1.0;    // minimum to unlock claim

let schemaReady = false;

async function ensureSchema() {
    if (schemaReady) return;
    try {
        const isPg = db.isPg();
        const idDef = isPg ? 'SERIAL PRIMARY KEY' : 'INTEGER PRIMARY KEY AUTOINCREMENT';
        const tsDef = isPg ? 'TIMESTAMPTZ DEFAULT NOW()' : "TEXT DEFAULT (datetime('now'))";

        await db.run(
            'CREATE TABLE IF NOT EXISTS referral_commissions (' +
            '  id ' + idDef + ',' +
            '  referrer_id INTEGER NOT NULL,' +
            '  referee_id INTEGER NOT NULL,' +
            '  tier INTEGER NOT NULL,' +
            '  bet_amount REAL NOT NULL,' +
            '  win_amount REAL NOT NULL,' +
            '  net_loss REAL NOT NULL,' +
            '  rate REAL NOT NULL,' +
            '  commission REAL NOT NULL,' +
            '  status TEXT DEFAULT \'pending\',' +
            '  created_at ' + tsDef + ',' +
            '  paid_at TEXT' +
            ')'
        );

        // Index: fast lookup of pending commissions per referrer
        try { await db.run('CREATE INDEX IF NOT EXISTS idx_refcomm_referrer_status ON referral_commissions(referrer_id, status)'); } catch (_) {}
        try { await db.run('CREATE INDEX IF NOT EXISTS idx_refcomm_referee ON referral_commissions(referee_id)'); } catch (_) {}

        schemaReady = true;
        console.warn('[RefCommission] Tables initialized');
    } catch (err) {
        console.warn('[RefCommission] ensureSchema error:', err.message);
    }
}

ensureSchema();

/**
 * Find the referrer chain for a given user (tier 1 + tier 2).
 * Returns { tier1: <referrerId|null>, tier2: <referrerId|null> }.
 *
 * Tier 1 = the user that referred this user
 * Tier 2 = the user that referred the tier 1 referrer
 */
async function getReferrerChain(userId) {
    try {
        const tier1Row = await db.get(
            'SELECT referrer_id, created_at FROM referral_claims WHERE referred_id = ?',
            [userId]
        );
        if (!tier1Row) return { tier1: null, tier2: null, tier1ClaimedAt: null };

        // Check 30-day window
        const claimedAt = new Date(tier1Row.created_at);
        const ageMs = Date.now() - claimedAt.getTime();
        if (ageMs > COMMISSION_WINDOW_DAYS * 24 * 60 * 60 * 1000) {
            return { tier1: null, tier2: null, tier1ClaimedAt: tier1Row.created_at };
        }

        const tier2Row = await db.get(
            'SELECT referrer_id FROM referral_claims WHERE referred_id = ?',
            [tier1Row.referrer_id]
        );

        return {
            tier1: tier1Row.referrer_id,
            tier2: tier2Row ? tier2Row.referrer_id : null,
            tier1ClaimedAt: tier1Row.created_at
        };
    } catch (err) {
        console.warn('[RefCommission] getReferrerChain error:', err.message);
        return { tier1: null, tier2: null };
    }
}

/**
 * Accrue commissions for a real-money spin. Called from spin.routes.js
 * after the spin is logged. Fire-and-forget — failures must not block
 * the spin response.
 *
 * @param {number} userId    — the user who just spun
 * @param {number} betAmount — amount wagered (real balance only)
 * @param {number} winAmount — amount won
 */
async function accrueCommission(userId, betAmount, winAmount) {
    try {
        await ensureSchema();

        const bet = Number(betAmount) || 0;
        const win = Number(winAmount) || 0;
        const netLoss = bet - win;

        // Only accrue on net losses
        if (netLoss <= 0) return;
        if (bet <= 0) return;

        // Verify referee meets minimum lifetime wager threshold
        const wagerRow = await db.get(
            'SELECT COALESCE(SUM(bet_amount), 0) as total FROM spins WHERE user_id = ?',
            [userId]
        );
        const lifetimeWagered = wagerRow ? Number(wagerRow.total) : 0;
        if (lifetimeWagered < MIN_REFEREE_WAGER) return;

        const chain = await getReferrerChain(userId);

        // Tier 1 — never pay a referrer commission on their own loss.
        // Without this guard, a user who registers a second account using
        // their own referral code would earn tier-1 commission on every
        // loss they incur — funded by the casino's own house edge. The
        // tier-2 path already checks `chain.tier2 !== userId`; this just
        // brings tier 1 to the same standard.
        if (chain.tier1 && chain.tier1 !== userId) {
            const t1Commission = Math.round(netLoss * TIER_1_RATE * 100) / 100;
            if (t1Commission > 0) {
                await db.run(
                    'INSERT INTO referral_commissions (referrer_id, referee_id, tier, bet_amount, win_amount, net_loss, rate, commission, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
                    [chain.tier1, userId, 1, bet, win, netLoss, TIER_1_RATE, t1Commission, 'pending']
                );
            }
        }

        // Tier 2 (if exists and is different from tier 1)
        if (chain.tier2 && chain.tier2 !== chain.tier1 && chain.tier2 !== userId) {
            const t2Commission = Math.round(netLoss * TIER_2_RATE * 100) / 100;
            if (t2Commission > 0) {
                await db.run(
                    'INSERT INTO referral_commissions (referrer_id, referee_id, tier, bet_amount, win_amount, net_loss, rate, commission, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
                    [chain.tier2, userId, 2, bet, win, netLoss, TIER_2_RATE, t2Commission, 'pending']
                );
            }
        }
    } catch (err) {
        // Fire-and-forget — never crash the spin response
        console.warn('[RefCommission] accrueCommission error:', err.message);
    }
}

/**
 * Get pending and lifetime commission summary for a referrer.
 */
async function getCommissionStats(referrerId) {
    await ensureSchema();
    try {
        const summary = await db.get(`
            SELECT
                COALESCE(SUM(CASE WHEN status = 'pending' THEN commission ELSE 0 END), 0) as pending,
                COALESCE(SUM(CASE WHEN status = 'paid' THEN commission ELSE 0 END), 0) as paid,
                COALESCE(SUM(CASE WHEN tier = 1 THEN commission ELSE 0 END), 0) as tier1_total,
                COALESCE(SUM(CASE WHEN tier = 2 THEN commission ELSE 0 END), 0) as tier2_total,
                COUNT(DISTINCT referee_id) as active_referees
            FROM referral_commissions
            WHERE referrer_id = ?
        `, [referrerId]);

        return {
            pending: Number((summary?.pending || 0).toFixed(2)),
            paid: Number((summary?.paid || 0).toFixed(2)),
            tier1Total: Number((summary?.tier1_total || 0).toFixed(2)),
            tier2Total: Number((summary?.tier2_total || 0).toFixed(2)),
            activeReferees: Number(summary?.active_referees || 0),
            tier1Rate: TIER_1_RATE,
            tier2Rate: TIER_2_RATE,
            windowDays: COMMISSION_WINDOW_DAYS,
            minPayout: MIN_PAYOUT_AMOUNT
        };
    } catch (err) {
        console.warn('[RefCommission] getCommissionStats error:', err.message);
        return {
            pending: 0, paid: 0, tier1Total: 0, tier2Total: 0,
            activeReferees: 0, tier1Rate: TIER_1_RATE, tier2Rate: TIER_2_RATE,
            windowDays: COMMISSION_WINDOW_DAYS, minPayout: MIN_PAYOUT_AMOUNT
        };
    }
}

/**
 * Get per-referee earnings breakdown (for dashboard table).
 */
async function getPerRefereeBreakdown(referrerId, limit = 50) {
    await ensureSchema();
    try {
        const rows = await db.all(`
            SELECT
                rc.referee_id,
                u.username,
                COALESCE(SUM(CASE WHEN rc.tier = 1 THEN rc.commission ELSE 0 END), 0) as tier1_earned,
                COALESCE(SUM(CASE WHEN rc.tier = 2 THEN rc.commission ELSE 0 END), 0) as tier2_earned,
                COALESCE(SUM(CASE WHEN rc.status = 'pending' THEN rc.commission ELSE 0 END), 0) as pending,
                COALESCE(SUM(CASE WHEN rc.status = 'paid' THEN rc.commission ELSE 0 END), 0) as paid,
                COALESCE(SUM(rc.net_loss), 0) as referee_total_loss,
                MAX(rc.created_at) as last_activity
            FROM referral_commissions rc
            LEFT JOIN users u ON u.id = rc.referee_id
            WHERE rc.referrer_id = ?
            GROUP BY rc.referee_id, u.username
            ORDER BY pending DESC, last_activity DESC
            LIMIT ?
        `, [referrerId, limit]);

        return rows.map(r => ({
            refereeId: r.referee_id,
            username: r.username || 'Unknown',
            tier1Earned: Number((r.tier1_earned || 0).toFixed(2)),
            tier2Earned: Number((r.tier2_earned || 0).toFixed(2)),
            pending: Number((r.pending || 0).toFixed(2)),
            paid: Number((r.paid || 0).toFixed(2)),
            refereeTotalLoss: Number((r.referee_total_loss || 0).toFixed(2)),
            lastActivity: r.last_activity
        }));
    } catch (err) {
        console.warn('[RefCommission] getPerRefereeBreakdown error:', err.message);
        return [];
    }
}

/**
 * Atomically mark all pending commissions for a referrer as paid and credit
 * the total to bonus_balance with 10x wagering. Returns the credited amount.
 */
async function claimPendingCommissions(referrerId) {
    await ensureSchema();

    // Self-exclusion check
    try {
        const exclusion = await db.get(
            "SELECT id FROM self_exclusions WHERE user_id = ? AND is_active = 1 AND (ends_at IS NULL OR ends_at > datetime('now'))",
            [referrerId]
        );
        if (exclusion) {
            const err = new Error('Account is self-excluded; commissions cannot be claimed.');
            err.code = 'self_excluded';
            throw err;
        }
    } catch (e) {
        if (e.code === 'self_excluded') throw e;
        // Table missing OK — pass through
    }

    await db.beginTransaction();
    try {
        const pending = await db.get(
            "SELECT COALESCE(SUM(commission), 0) as total FROM referral_commissions WHERE referrer_id = ? AND status = 'pending'",
            [referrerId]
        );
        const totalPending = Number((pending?.total || 0).toFixed(2));

        if (totalPending < MIN_PAYOUT_AMOUNT) {
            await db.rollback();
            const err = new Error(`Minimum payout is $${MIN_PAYOUT_AMOUNT.toFixed(2)}. Current pending: $${totalPending.toFixed(2)}.`);
            err.code = 'below_min';
            throw err;
        }

        // Mark all pending as paid
        await db.run(
            "UPDATE referral_commissions SET status = 'paid', paid_at = datetime('now') WHERE referrer_id = ? AND status = 'pending'",
            [referrerId]
        );

        // Credit bonus_balance with 10x wagering (loss-compensation tier per CLAUDE.md)
        const wageringMult = 10;
        const user = await db.get('SELECT balance, bonus_balance FROM users WHERE id = ?', [referrerId]);
        await db.run(
            'UPDATE users SET bonus_balance = COALESCE(bonus_balance, 0) + ?, wagering_requirement = COALESCE(wagering_requirement, 0) + ? WHERE id = ?',
            [totalPending, totalPending * wageringMult, referrerId]
        );

        await db.run(
            'INSERT INTO transactions (user_id, type, amount, balance_before, balance_after, reference) VALUES (?, ?, ?, ?, ?, ?)',
            [referrerId, 'referral_commission', totalPending,
             user ? Number(user.balance || 0) : 0,
             user ? Number(user.balance || 0) : 0,
             'Referral commission payout (' + totalPending.toFixed(2) + ' to bonus_balance, 10x wagering)']
        );

        await db.commit();

        return {
            credited: totalPending,
            wageringRequirement: totalPending * wageringMult
        };
    } catch (err) {
        try { await db.rollback(); } catch (_) {}
        throw err;
    }
}

module.exports = {
    accrueCommission,
    getCommissionStats,
    getPerRefereeBreakdown,
    claimPendingCommissions,
    getReferrerChain,
    ensureSchema,
    TIER_1_RATE,
    TIER_2_RATE,
    COMMISSION_WINDOW_DAYS,
    MIN_REFEREE_WAGER,
    MIN_PAYOUT_AMOUNT
};
