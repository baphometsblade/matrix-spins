'use strict';

const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth');
const db = require('../database');

// Bootstrap birthday columns (silently ignore if already exist)
db.run("ALTER TABLE users ADD COLUMN birth_month INTEGER").catch(function() {});
db.run("ALTER TABLE users ADD COLUMN birth_day INTEGER").catch(function() {});
db.run("ALTER TABLE users ADD COLUMN birthday_claimed TEXT").catch(function() {});

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
        console.error('[Birthday] Status error:', err.message);
        res.status(500).json({ error: 'Failed to check birthday status' });
    }
});

// POST /api/birthday/claim — auth required
router.post('/claim', authenticate, async (req, res) => {
    try {
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

        // RACE-SAFE FLAG FLIP — only one claim per year succeeds.
        var flip = await db.run(
            'UPDATE users SET birthday_claimed = ? WHERE id = ? AND COALESCE(birthday_claimed, \'\') <> ?',
            [String(today.year), req.user.id, String(today.year)]
        );
        var flipRows = (flip && (flip.changes || flip.rowCount)) || 0;
        if (flipRows === 0) {
            return res.status(400).json({ error: 'Birthday bonus already claimed this year (race detected)' });
        }

        // Credit to bonus_balance with 15x wagering (free credit rule)
        var birthdayWager = BIRTHDAY_CREDITS * 15;
        await db.run(
            'UPDATE users SET bonus_balance = COALESCE(bonus_balance, 0) + ?, wagering_requirement = COALESCE(wagering_requirement, 0) + ? WHERE id = ?',
            [BIRTHDAY_CREDITS, birthdayWager, req.user.id]
        );

        // Award gems
        await db.run('UPDATE users SET gems = COALESCE(gems, 0) + ? WHERE id = ?',
            [BIRTHDAY_GEMS, req.user.id]).catch(function() {});

        // Award free spins (if free_spins column exists)
        await db.run('UPDATE users SET free_spins = COALESCE(free_spins, 0) + ? WHERE id = ?',
            [BIRTHDAY_FREE_SPINS, req.user.id]).catch(function() {});

        // Transaction record
        await db.run(
            "INSERT INTO transactions (user_id, type, amount, description) VALUES (?, 'birthday_bonus', ?, ?)",
            [req.user.id, BIRTHDAY_CREDITS, 'Birthday Bonus — Happy Birthday!']
        ).catch(function() {});

        res.json({
            success:      true,
            creditsAwarded:   BIRTHDAY_CREDITS,
            gemsAwarded:      BIRTHDAY_GEMS,
            freeSpinsAwarded: BIRTHDAY_FREE_SPINS,
            newBalance:       newBalance
        });
    } catch (err) {
        console.error('[Birthday] Claim error:', err.message);
        res.status(500).json({ error: 'Failed to claim birthday bonus' });
    }
});

// POST /api/birthday/set — auth required, set/update birthday
router.post('/set', authenticate, async (req, res) => {
    try {
        var { month, day } = req.body;
        var m = parseInt(month, 10);
        var d = parseInt(day, 10);
        if (!m || !d || m < 1 || m > 12 || d < 1 || d > 31) {
            return res.status(400).json({ error: 'Invalid month or day' });
        }
        await db.run('UPDATE users SET birth_month = ?, birth_day = ? WHERE id = ?',
            [m, d, req.user.id]);
        res.json({ success: true, month: m, day: d });
    } catch (err) {
        console.error('[Birthday] Set error:', err.message);
        res.status(500).json({ error: 'Failed to set birthday' });
    }
});

module.exports = router;
