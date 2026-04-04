const router = require('express').Router();
const { authenticate } = require('../middleware/auth');
const { bonusGuard } = require('../middleware/bonus-guard');
const db = require('../database');

// Bootstrap: add cashback_last column if it doesn't exist yet
db.run("ALTER TABLE users ADD COLUMN cashback_last TEXT").catch(function(e) { if (e && !String(e.message || e).match(/already exists|duplicate column/i)) console.warn('[dailycashback] ALTER failed:', e.message || e); });

const CASHBACK_TIERS = [
    { level: 0, label: 'Base',     rate: 0.02, cap: 1.00,  min: 0.50 },
    { level: 1, label: 'Bronze',   rate: 0.02, cap: 2.00,  min: 0.50 },
    { level: 2, label: 'Silver',   rate: 0.03, cap: 3.00,  min: 0.50 },
    { level: 3, label: 'Gold',     rate: 0.03, cap: 5.00,  min: 0.25 },
    { level: 4, label: 'Platinum', rate: 0.04, cap: 8.00,  min: 0.10 },
    { level: 5, label: 'Diamond',  rate: 0.05, cap: 15.00, min: 0.05 }
];

function getCashbackConfig(totalWagered) {
    const w = parseFloat(totalWagered) || 0;
    if (w >= 50000) return CASHBACK_TIERS[5];
    if (w >= 10000) return CASHBACK_TIERS[4];
    if (w >= 2000)  return CASHBACK_TIERS[3];
    if (w >= 500)   return CASHBACK_TIERS[2];
    if (w >= 100)   return CASHBACK_TIERS[1];
    return CASHBACK_TIERS[0];
}

/**
 * Calculate the cashback amount owed to a user for the past 24 hours.
 * Net losses = sum of bet_amount for spins where win_amount < bet_amount.
 * Returns { netLosses, cashbackAmount }
 */
async function computeCashback(userId, cfg) {
    const row = await db.get(
        "SELECT COALESCE(SUM(bet_amount - win_amount), 0) AS net_losses " +
        "FROM spins " +
        "WHERE user_id = ? " +
        "  AND win_amount < bet_amount " +
        "  AND created_at >= datetime('now', '-24 hours')",
        [userId]
    );
    const netLosses = parseFloat(row.net_losses) || 0;
    const cashbackAmount = Math.min(netLosses * cfg.rate, cfg.cap);
    return { netLosses, cashbackAmount };
}

/**
 * GET /api/dailycashback/status
 * Returns eligibility info for the authenticated user.
 * Response: { eligible, amount, claimed, claimedAt }
 */
router.get('/status', authenticate, async (req, res) => {
    try {
        const user = await db.get(
            'SELECT cashback_last, total_wagered FROM users WHERE id = ?',
            [req.user.id]
        );

        const claimedAt = user ? user.cashback_last : null;

        // Check 24-hour cooldown
        let claimed = false;
        if (claimedAt) {
            const lastClaim = new Date(claimedAt);
            const msSinceClaim = Date.now() - lastClaim.getTime();
            claimed = msSinceClaim < 24 * 60 * 60 * 1000;
        }

        const cfg = getCashbackConfig(user ? user.total_wagered : 0);
        const { netLosses, cashbackAmount } = await computeCashback(req.user.id, cfg);

        const eligible = !claimed && netLosses >= cfg.min && cashbackAmount > 0;

        res.json({
            eligible,
            amount: parseFloat(cashbackAmount.toFixed(2)),
            netLosses: parseFloat(netLosses.toFixed(2)),
            claimed,
            claimedAt: claimedAt || null,
            vipLevel: cfg.level,
            vipLabel: cfg.label,
            cashbackRate: cfg.rate,
            cashbackCap: cfg.cap
        });
    } catch (err) {
        res.status(500).json({ error: 'Failed to fetch cashback status' });
    }
});

/**
 * POST /api/dailycashback/claim
 * Credits daily cashback to balance and records a transaction.
 * Response: { success, credited, newBalance }
 */
router.post('/claim', authenticate, bonusGuard, async (req, res) => {
    try {
        const user = await db.get(
            'SELECT balance, cashback_last, total_wagered FROM users WHERE id = ?',
            [req.user.id]
        );

        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        // Enforce 24-hour cooldown
        if (user.cashback_last) {
            const lastClaim = new Date(user.cashback_last);
            const msSinceClaim = Date.now() - lastClaim.getTime();
            if (msSinceClaim < 24 * 60 * 60 * 1000) {
                return res.status(400).json({ error: 'Cashback already claimed in the past 24 hours' });
            }
        }

        const cfg = getCashbackConfig(user.total_wagered);
        const { netLosses, cashbackAmount } = await computeCashback(req.user.id, cfg);

        if (netLosses < cfg.min) {
            return res.status(400).json({
                error: 'Minimum $' + cfg.min.toFixed(2) + ' in net losses required to qualify'
            });
        }

        if (cashbackAmount <= 0) {
            return res.status(400).json({ error: 'No cashback available to claim' });
        }

        const credited = parseFloat(cashbackAmount.toFixed(2));

        // Atomic guard: set cashback_last only if 24h have passed (prevents race condition double-claim)
        const claimGuard = await db.run(
            "UPDATE users SET cashback_last = datetime('now') WHERE id = ? AND (cashback_last IS NULL OR cashback_last <= datetime('now', '-24 hours'))",
            [req.user.id]
        );
        if (!claimGuard || claimGuard.changes === 0) {
            return res.status(400).json({ error: 'Cashback already claimed in the past 24 hours' });
        }

        // Credit to bonus_balance with 10x wagering (reduced since it's loss compensation)
        await db.run(
            'UPDATE users SET bonus_balance = COALESCE(bonus_balance, 0) + ?, wagering_requirement = COALESCE(wagering_requirement, 0) + ? WHERE id = ?',
            [credited, credited * 10, req.user.id]
        );

        // Record transaction
        await db.run(
            "INSERT INTO transactions (user_id, type, amount, description) VALUES (?, 'cashback', ?, ?)",
            [
                req.user.id,
                credited,
                'Daily cashback (' + cfg.label + ') — ' + (cfg.rate * 100).toFixed(0) + '% of $' + netLosses.toFixed(2) + ' net losses'
            ]
        );

        const updatedUser = await db.get(
            'SELECT balance FROM users WHERE id = ?',
            [req.user.id]
        );
        const newBalance = updatedUser ? parseFloat(updatedUser.balance) : 0;

        res.json({ success: true, credited, newBalance, vipLabel: cfg.label, cashbackRate: cfg.rate });
    } catch (err) {
        res.status(500).json({ error: 'Claim failed' });
    }
});

module.exports = router;
