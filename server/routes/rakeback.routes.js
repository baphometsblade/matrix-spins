const router = require('express').Router();
const { authenticate } = require('../middleware/auth');
const { bonusGuard } = require('../middleware/bonus-guard');
const db = require('../database');

function getCurrentWeekMondayStr() {
    const now = new Date();
    const dayOfWeek = now.getUTCDay();
    const daysToMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
    const monday = new Date(now);
    monday.setUTCDate(monday.getUTCDate() - daysToMonday);
    monday.setUTCHours(0, 0, 0, 0);
    return monday.toISOString().slice(0, 19).replace('T', ' ');
}

function getNextSundayMidnightUTC() {
    const now = new Date();
    const daysUntilSunday = (7 - now.getUTCDay()) % 7 || 7;
    const nextSunday = new Date(now);
    nextSunday.setUTCDate(nextSunday.getUTCDate() + daysUntilSunday);
    nextSunday.setUTCHours(0, 0, 0, 0);
    return nextSunday;
}

const RAKEBACK_RATE = 0.01;
const RAKEBACK_CAP  = 50;

async function computePending(userId) {
    const mondayStr = getCurrentWeekMondayStr();
    const row = await db.get(
        'SELECT COALESCE(SUM(bet_amount), 0) AS wagered, COALESCE(SUM(win_amount), 0) AS won FROM spins WHERE user_id = ? AND created_at >= ?',
        [userId, mondayStr]
    );
    const weeklyWagered   = parseFloat(row.wagered) || 0;
    const weeklyWon       = parseFloat(row.won)     || 0;
    const weeklyNetLoss   = Math.max(0, weeklyWagered - weeklyWon);
    const pendingRakeback = Math.min(weeklyNetLoss * RAKEBACK_RATE, RAKEBACK_CAP);
    return { weeklyWagered, weeklyWon, weeklyNetLoss, pendingRakeback };
}

router.get('/status', authenticate, async (req, res) => {
    try {
        const { weeklyWagered, weeklyWon, weeklyNetLoss, pendingRakeback } = await computePending(req.user.id);
        const history = await db.all(
            'SELECT amount, description, created_at FROM transactions WHERE user_id = ? AND type = ?  ORDER BY created_at DESC LIMIT 4',
            [req.user.id, 'rakeback']
        );
        const nextPayoutAt = getNextSundayMidnightUTC().toISOString();
        res.json({ weeklyWagered, weeklyWon, weeklyNetLoss, pendingRakeback, rakebackRate: RAKEBACK_RATE, nextPayoutAt, history });
    } catch (err) {
        res.status(500).json({ error: 'Failed to fetch rakeback status' });
    }
});

router.post('/claim', authenticate, bonusGuard, async (req, res) => {
    try {
        // ROUND 32: Self-exclusion check (was missing entirely)
        try {
            var exclusion = await db.get(
                "SELECT id FROM self_exclusions WHERE user_id = ? AND is_active = 1 AND (ends_at IS NULL OR ends_at > datetime('now'))",
                [req.user.id]
            );
            if (exclusion) {
                return res.status(403).json({ error: 'Account is self-excluded. Bonuses are disabled.' });
            }
        } catch (exclErr) {
            if (exclErr.message && exclErr.message.includes('no such table')) { /* OK */ }
            else {
                console.error('[Rakeback] Self-exclusion check failed:', exclErr.message);
                return res.status(500).json({ error: 'Security check failed' });
            }
        }

        // Enforce once-per-week claim (check if already claimed this week)
        const mondayStr = getCurrentWeekMondayStr();
        const existingClaim = await db.get(
            "SELECT id FROM transactions WHERE user_id = ? AND type = 'rakeback' AND created_at >= ?",
            [req.user.id, mondayStr]
        );
        if (existingClaim) {
            return res.status(400).json({ error: 'Rakeback already claimed this week' });
        }

        var { weeklyWagered, pendingRakeback } = await computePending(req.user.id);
        if (pendingRakeback < 0.01) {
            return res.status(400).json({ error: 'Nothing to claim - minimum is $0.01' });
        }

        // ROUND 55: Cap rakeback to remaining daily bonus limit
        if (pendingRakeback > 0 && req.bonusCapRemaining !== undefined && pendingRakeback > req.bonusCapRemaining) {
            pendingRakeback = Math.max(0, Math.floor(req.bonusCapRemaining * 100) / 100);
            if (pendingRakeback <= 0) {
                return res.status(400).json({ error: 'Daily bonus limit reached' });
            }
        }

        // Credit to bonus_balance with 10x wagering (loss compensation)
        await db.run('UPDATE users SET bonus_balance = COALESCE(bonus_balance, 0) + ?, wagering_requirement = COALESCE(wagering_requirement, 0) + ? WHERE id = ?', [pendingRakeback, pendingRakeback * 10, req.user.id]);
        const description = 'Weekly rakeback - ' + weeklyWagered.toFixed(2) + ' wagered (bonus, 10x wagering)';
        await db.run("INSERT INTO transactions (user_id, type, amount, description) VALUES (?, 'rakeback', ?, ?)", [req.user.id, pendingRakeback, description]);
        const userRow = await db.get('SELECT balance FROM users WHERE id = ?', [req.user.id]);
        const newBalance = userRow ? parseFloat(userRow.balance) : 0;
        res.json({ success: true, credited: pendingRakeback, newBalance });
    } catch (err) {
        res.status(500).json({ error: 'Claim failed' });
    }
});

module.exports = router;