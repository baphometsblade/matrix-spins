'use strict';

/**
 * Achievements API
 *
 * GET  /api/achievements           — full list with unlock state + progress
 * GET  /api/achievements/categories — list of categories
 * POST /api/achievements/check     — re-evaluate achievements based on stats (idempotent)
 *
 * Achievements credit XP into the VIP ladder via achievement.service.grant().
 */

const express = require('express');
const router = express.Router();
const db = require('../database');
const { authenticate } = require('../middleware/auth');
const { bonusGuard } = require('../middleware/bonus-guard');
const achievementService = require('../services/achievement.service');

async function _checkSelfExclusion(userId) {
    try {
        var row = await db.get(
            "SELECT id FROM self_exclusions WHERE user_id = ? AND is_active = 1 AND (ends_at IS NULL OR ends_at > datetime('now'))",
            [userId]
        );
        return !!row;
    } catch (e) {
        if (e.message && e.message.indexOf('no such table') >= 0) return false;
        throw e;
    }
}

router.get('/', authenticate, async function (req, res) {
    try {
        var data = await achievementService.getUserAchievements(req.user.id);
        // group by category for the UI
        var byCategory = {};
        data.achievements.forEach(function (a) {
            var c = a.category || 'misc';
            if (!byCategory[c]) byCategory[c] = [];
            byCategory[c].push(a);
        });
        res.json({
            achievements: data.achievements,
            byCategory: byCategory,
            stats: data.stats
        });
    } catch (err) {
        console.warn('[Achievements] GET / error:', err.message);
        res.status(500).json({ error: 'Failed to fetch achievements' });
    }
});

router.get('/definitions', function (req, res) {
    res.json({ achievements: achievementService.getAllDefinitions() });
});

router.get('/categories', function (req, res) {
    var cats = {};
    achievementService.getAllDefinitions().forEach(function (a) {
        var c = a.category || 'misc';
        cats[c] = (cats[c] || 0) + 1;
    });
    res.json({ categories: cats });
});

/**
 * Check & grant pending achievements based on current stats.
 * Used by clients to force a re-evaluation (e.g. after returning to the achievements page).
 */
router.post('/check', authenticate, bonusGuard, async function (req, res) {
    try {
        var userId = req.user.id;

        if (await _checkSelfExclusion(userId)) {
            return res.status(403).json({ error: 'Account is self-excluded.' });
        }

        var [spinRow, multRow, betRow, gamesRow, daysRow, wageredRow, depositRow, refRow] = await Promise.all([
            db.get('SELECT COUNT(*) as cnt FROM spins WHERE user_id = ?', [userId]),
            db.get('SELECT MAX(win_amount / CAST(bet_amount AS REAL)) as mult FROM spins WHERE user_id = ? AND bet_amount > 0', [userId]),
            db.get('SELECT MAX(bet_amount) as mx FROM spins WHERE user_id = ?', [userId]),
            db.get('SELECT COUNT(DISTINCT game_id) as cnt FROM spins WHERE user_id = ?', [userId]),
            db.get('SELECT COALESCE(streak_count, 0) AS s FROM users WHERE id = ?', [userId]),
            db.get('SELECT COALESCE(SUM(bet_amount), 0) as total FROM spins WHERE user_id = ?', [userId]),
            db.get("SELECT COUNT(*) as cnt FROM deposits WHERE user_id = ? AND status = 'completed'", [userId]),
            db.get('SELECT COALESCE(referral_count, 0) AS cnt FROM users WHERE id = ?', [userId])
        ]);

        var totalSpins    = spinRow    && spinRow.cnt    != null ? Number(spinRow.cnt)        : 0;
        var maxMultiplier = multRow    && multRow.mult   != null ? Number(multRow.mult)       : 0;
        var maxBet        = betRow     && betRow.mx      != null ? Number(betRow.mx)          : 0;
        var distinctGames = gamesRow   && gamesRow.cnt   != null ? Number(gamesRow.cnt)       : 0;
        var streak        = daysRow    && daysRow.s      != null ? Number(daysRow.s)          : 0;
        var totalWagered  = wageredRow && wageredRow.total != null ? Number(wageredRow.total) : 0;
        var deposits      = depositRow && depositRow.cnt != null ? Number(depositRow.cnt)     : 0;
        var refs          = refRow     && refRow.cnt     != null ? Number(refRow.cnt)         : 0;

        var unlocked = await achievementService.checkSpinAchievements(
            userId, totalSpins, maxMultiplier, distinctGames, totalWagered, maxBet
        );

        // Streak achievements
        if (streak >= 3)    { var r1 = await achievementService.grant(userId, 'streak_3');   if (r1) unlocked.push(r1); }
        if (streak >= 7)    { var r2 = await achievementService.grant(userId, 'streak_7');   if (r2) unlocked.push(r2); }
        if (streak >= 30)   { var r3 = await achievementService.grant(userId, 'streak_30');  if (r3) unlocked.push(r3); }
        if (streak >= 100)  { var r4 = await achievementService.grant(userId, 'streak_100'); if (r4) unlocked.push(r4); }

        // Deposit achievements
        if (deposits >= 1) { var r5 = await achievementService.grant(userId, 'first_deposit'); if (r5) unlocked.push(r5); }
        if (deposits >= 5) { var r6 = await achievementService.grant(userId, 'deposit_5');     if (r6) unlocked.push(r6); }

        // Referral achievements
        if (refs >= 1) { var r7 = await achievementService.grant(userId, 'referral_made'); if (r7) unlocked.push(r7); }
        if (refs >= 5) { var r8 = await achievementService.grant(userId, 'referral_5');    if (r8) unlocked.push(r8); }

        res.json({
            newlyUnlocked: unlocked.map(function (a) {
                return {
                    id: a.id, name: a.name, icon: a.icon, desc: a.desc,
                    xp: a.xp, points: a.points, category: a.category
                };
            })
        });
    } catch (err) {
        console.warn('[Achievements] POST /check error:', err.message);
        res.status(500).json({ error: 'Failed to check achievements' });
    }
});

module.exports = router;
