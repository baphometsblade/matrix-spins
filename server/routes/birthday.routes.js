'use strict';

const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth');
const { bonusGuard }   = require('../middleware/bonus-guard'); // ROUND 46
const db = require('../database');

// Bootstrap birthday columns (silently ignore if already exist)
db.run("ALTER TABLE users ADD COLUMN birth_month INTEGER").catch(function(e) { if (e && !String(e.message||e).match(/already exists|duplicate column/i)) console.warn('[birthday] ALTER failed:', e.message); });
db.run("ALTER TABLE users ADD COLUMN birth_day INTEGER").catch(function(e) { if (e && !String(e.message||e).match(/already exists|duplicate column/i)) console.warn('[birthday] ALTER failed:', e.message); });
db.run("ALTER TABLE users ADD COLUMN birthday_claimed TEXT").catch(function(e) { if (e && !String(e.message||e).match(/already exists|duplicate column/i)) console.warn('[birthday] ALTER failed:', e.message); });

// Birthday bonus config
var BIRTHDAY_CREDITS = 10.00;
var BIRTHDAY_GEMS    = 500;
var BIRTHDAY_FREE_SPINS = 10;

function getTodayMD() {
    var d = new Date();
    return { month: d.getMonth() + 1, day: d.getDate(), year: d.getFullYear() };
}

// GET /api/birthday/status — auth required
// Returns: { hasBirthday, isBirthday, alreadyClaimed, bonusCredits, bonusGems, bonusFreeSpins }
router.get('/status', authenticate, async (req, res) => {
    try {
        var user = await db.get(
            'SELECT birth_month, birth_day, birthday_claimed FROM users WHERE id = ?',
            [req.user.id]
        );
        if (!user) return res.json({ hasBirthday: false, isBirthday: false, alreadyClaimed: false });

        var hasBirthday = !!(user.birth_month && user.birth_day);
        if (!hasBirthday) {
            return res.json({ hasBirthday: false, isBirthday: false, alreadyClaimed: false });
        }

        var today = getTodayMD();
        var isBirthday = (user.birth_month === today.month && user.birth_day === today.day);
        var alreadyClaimed = (user.birthday_claimed === String(today.year));

        res.json({
            hasBirthday: true,
            isBirthday: isBirthday,
            alreadyClaimed: alreadyClaimed,
            bonusCredits:   BIRTHDAY_CREDITS,
            bonusGems:      BIRTHDAY_GEMS,
            bonusFreeSpins: BIRTHDAY_FREE_SPINS
        });
    } catch (err) {
        console.warn('[Birthday] Status error:', err.message);
        res.status(500).json({ error: 'Failed to check birthday status' });
    }
});

// POST /api/birthday/claim — auth required
// Uses atomic UPDATE with WHERE guard to prevent race condition double-claim
router.post('/claim', authenticate, bonusGuard, async (req, res) => { // ROUND 46: Added bonusGuard
    try {
        // ROUND 34: Self-exclusion check (regulatory compliance)
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
                console.error('[SelfExcl] Check failed:', exclErr.message);
                return res.status(500).json({ error: 'Security check failed' });
            }
        }

        var user = await db.get(
            'SELECT birth_month, birth_day, birthday_claimed, balance FROM users WHERE id = ?',
            [req.user.id]
        );
        if (!user) return res.status(404).json({ error: 'User not found' });
        if (!user.birth_month || !user.birth_day) {
            return res.status(400).json({ error: 'No birthday set on your account' });
        }

        var today = getTodayMD();
        if (user.birth_month !== today.month || user.birth_day !== today.day) {
            return res.status(400).json({ error: 'Today is not your birthday!' });
        }
        if (user.birthday_claimed === String(today.year)) {
            return res.status(400).json({ error: 'Birthday bonus already claimed this year' });
        }

        // Atomic: credit bonus AND set claimed year in one UPDATE
        // WHERE guard prevents race condition: two concurrent requests both pass the SELECT check,
        // but only one can succeed the UPDATE (birthday_claimed != year)
        var yearStr = String(today.year);
        var result = await db.run(
            'UPDATE users SET bonus_balance = COALESCE(bonus_balance, 0) + ?, wagering_requirement = COALESCE(wagering_requirement, 0) + ?, birthday_claimed = ? WHERE id = ? AND (birthday_claimed IS NULL OR birthday_claimed != ?)',
            [BIRTHDAY_CREDITS, BIRTHDAY_CREDITS * 15, yearStr, req.user.id, yearStr]
        );
        if (result.changes === 0) {
            return res.status(400).json({ error: 'Birthday bonus already claimed this year' });
        }

        // Award gems (non-critical)
        await db.run('UPDATE users SET gems = COALESCE(gems, 0) + ? WHERE id = ?',
            [BIRTHDAY_GEMS, req.user.id]).catch(function(e) { console.warn('[birthday] Gems award error:', e.message); });

        // Award free spins (if free_spins column exists)
        await db.run('UPDATE users SET free_spins = COALESCE(free_spins, 0) + ? WHERE id = ?',
            [BIRTHDAY_FREE_SPINS, req.user.id]).catch(function(e) { console.warn('[birthday] Free spins award error:', e.message); });

        // Transaction record
        await db.run(
            "INSERT INTO transactions (user_id, type, amount, description) VALUES (?, 'birthday_bonus', ?, ?)",
            [req.user.id, BIRTHDAY_CREDITS, 'Birthday Bonus — Happy Birthday!']
        ).catch(function(e) { console.warn('[birthday] Transaction record error:', e.message); });

        var updatedUser = await db.get('SELECT balance FROM users WHERE id = ?', [req.user.id]);
        res.json({
            success:      true,
            creditsAwarded:   BIRTHDAY_CREDITS,
            gemsAwarded:      BIRTHDAY_GEMS,
            freeSpinsAwarded: BIRTHDAY_FREE_SPINS,
            newBalance:       updatedUser ? parseFloat(updatedUser.balance) : 0
        });
    } catch (err) {
        console.warn('[Birthday] Claim error:', err.message);
        res.status(500).json({ error: 'Failed to claim birthday bonus' });
    }
});

// POST /api/birthday/set — auth required, set birthday (ONE-TIME only)
// Birthday can only be set once to prevent daily re-claiming exploit
router.post('/set', authenticate, async (req, res) => {
    try {
        // Check if birthday is already set — one-time only, no changes allowed
        var existing = await db.get('SELECT birth_month, birth_day FROM users WHERE id = ?', [req.user.id]);
        if (existing && existing.birth_month && existing.birth_day) {
            return res.status(400).json({ error: 'Birthday is already set and cannot be changed. Contact support if needed.' });
        }

        var { month, day } = req.body;
        var m = parseInt(month, 10);
        var d = parseInt(day, 10);
        if (!m || !d || m < 1 || m > 12 || d < 1 || d > 31) {
            return res.status(400).json({ error: 'Invalid month or day' });
        }

        // Atomic: only set if not already set (race condition guard)
        var result = await db.run(
            'UPDATE users SET birth_month = ?, birth_day = ? WHERE id = ? AND (birth_month IS NULL OR birth_day IS NULL)',
            [m, d, req.user.id]
        );
        if (result.changes === 0) {
            return res.status(400).json({ error: 'Birthday is already set and cannot be changed.' });
        }

        res.json({ success: true, month: m, day: d });
    } catch (err) {
        console.warn('[Birthday] Set error:', err.message);
        res.status(500).json({ error: 'Failed to set birthday' });
    }
});

module.exports = router;
