'use strict';
const router = require('express').Router();
const db = require('../database');
const cache = require('../services/cache.service');

// GET /api/leaderboard — returns available leaderboard endpoints
router.get('/', (req, res) => {
    res.json({
        endpoints: [
            '/api/leaderboard/bigwins', '/api/leaderboard/weekly', '/api/leaderboard/richlist',
            '/api/leaderboard/recent-wins', '/api/leaderboard/top',
            '/api/leaderboard/daily', '/api/leaderboard/monthly', '/api/leaderboard/all-time',
            '/api/leaderboard/biggest-multiplier'
        ]
    });
});

function maskUsername(username) {
    if (!username || username.length <= 3) return username.slice(0, 1) + '***';
    return username.slice(0, 2) + '***' + username.slice(-1);
}

// Public-name picker — respects show_on_leaderboard + display_name; falls back to mask.
function publicName(row) {
    if (row.show_on_leaderboard === 0) return null;
    return row.display_name || maskUsername(row.username);
}

// Period bounds — UTC, ISO datetime string for SQL comparison.
function periodStart(period) {
    const now = new Date();
    let d = new Date(now);
    if (period === 'daily') {
        d.setUTCHours(0, 0, 0, 0);
    } else if (period === 'weekly') {
        const dayOfWeek = now.getUTCDay();
        const daysToMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
        d.setUTCDate(d.getUTCDate() - daysToMonday);
        d.setUTCHours(0, 0, 0, 0);
    } else if (period === 'monthly') {
        d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    } else {
        return null; // all-time
    }
    return d.toISOString().slice(0, 19).replace('T', ' ');
}

const VALID_METRICS = new Set(['biggest_win', 'most_wagered', 'highest_multiplier']);

async function fetchLeaderboard(period, metric, limit) {
    const start = periodStart(period);
    const params = [];
    let where = `u.is_banned = 0 AND COALESCE(u.show_on_leaderboard, 1) = 1
                 AND COALESCE(u.profile_visibility, 'public') != 'private'`;
    if (start) {
        where += ' AND s.created_at >= ?';
        params.push(start);
    }

    let select, orderBy;
    if (metric === 'biggest_win') {
        select = `s.user_id, u.username, u.display_name, u.show_on_leaderboard,
                  s.bet_amount, s.win_amount, s.game_id, s.created_at,
                  CAST(CASE WHEN s.bet_amount > 0 THEN s.win_amount / s.bet_amount ELSE 0 END AS REAL) as multiplier`;
        orderBy = 's.win_amount DESC';
    } else if (metric === 'highest_multiplier') {
        select = `s.user_id, u.username, u.display_name, u.show_on_leaderboard,
                  s.bet_amount, s.win_amount, s.game_id, s.created_at,
                  CAST(CASE WHEN s.bet_amount > 0 THEN s.win_amount / s.bet_amount ELSE 0 END AS REAL) as multiplier`;
        orderBy = 'multiplier DESC';
        where += ' AND s.bet_amount > 0 AND s.win_amount > 0';
    } else {
        // most_wagered → aggregated
        const aggParams = params.slice();
        const sql = `SELECT s.user_id, u.username, u.display_name, u.show_on_leaderboard,
                            SUM(s.bet_amount) as total_wagered,
                            COUNT(*) as spin_count,
                            MAX(s.win_amount) as biggest_win
                     FROM spins s JOIN users u ON u.id = s.user_id
                     WHERE ${where}
                     GROUP BY s.user_id, u.username, u.display_name, u.show_on_leaderboard
                     ORDER BY total_wagered DESC
                     LIMIT ?`;
        aggParams.push(limit);
        const rows = await db.all(sql, aggParams);
        return rows.map((r, i) => ({
            rank: i + 1,
            displayName: publicName(r),
            totalWagered: Number(r.total_wagered) || 0,
            spinCount: Number(r.spin_count) || 0,
            biggestWin: Number(r.biggest_win) || 0,
        })).filter(e => e.displayName);
    }

    params.push(limit);
    const rows = await db.all(
        `SELECT ${select}
         FROM spins s JOIN users u ON u.id = s.user_id
         WHERE ${where}
         ORDER BY ${orderBy}
         LIMIT ?`,
        params
    );
    return rows.map((r, i) => ({
        rank: i + 1,
        displayName: publicName(r),
        gameId: r.game_id,
        betAmount: Number(r.bet_amount) || 0,
        winAmount: Number(r.win_amount) || 0,
        multiplier: Number(r.multiplier) || 0,
        date: r.created_at ? String(r.created_at).slice(0, 10) : '',
    })).filter(e => e.displayName);
}

// GET /api/leaderboard/daily?metric=biggest_win|most_wagered|highest_multiplier
function periodHandler(period) {
    return async (req, res) => {
        try {
            const metric = String(req.query.metric || 'biggest_win').toLowerCase();
            if (!VALID_METRICS.has(metric)) return res.status(400).json({ error: 'Invalid metric' });
            const limit = Math.min(parseInt(req.query.limit, 10) || 25, 100);
            const cacheKey = 'lb:' + period + ':' + metric + ':' + limit;
            var cached = cache.get(cacheKey);
            if (cached) return res.json(cached);
            const entries = await fetchLeaderboard(period, metric, limit);
            const payload = { period, metric, entries };
            cache.set(cacheKey, payload, 30);
            res.json(payload);
        } catch (err) {
            res.status(500).json({ error: 'Failed to load leaderboard' });
        }
    };
}

router.get('/daily',    periodHandler('daily'));
router.get('/monthly',  periodHandler('monthly'));
router.get('/all-time', periodHandler('all_time'));

// GET /api/leaderboard/biggest-multiplier — alias for highest_multiplier all-time
router.get('/biggest-multiplier', async (req, res) => {
    try {
        const period = String(req.query.period || 'all_time').toLowerCase();
        const limit = Math.min(parseInt(req.query.limit, 10) || 25, 100);
        const validPeriods = new Set(['daily', 'weekly', 'monthly', 'all_time']);
        if (!validPeriods.has(period)) return res.status(400).json({ error: 'Invalid period' });
        const cacheKey = 'lb:' + period + ':highest_multiplier:' + limit;
        var cached = cache.get(cacheKey);
        if (cached) return res.json(cached);
        const entries = await fetchLeaderboard(period, 'highest_multiplier', limit);
        const payload = { period, metric: 'highest_multiplier', entries };
        cache.set(cacheKey, payload, 30);
        res.json(payload);
    } catch (err) {
        res.status(500).json({ error: 'Failed to load leaderboard' });
    }
});

// GET /api/leaderboard/bigwins — top 20 all-time biggest wins by win_amount
router.get('/bigwins', async (req, res) => {
    try {
        var cached = cache.get('lb:bigwins');
        if (cached) return res.json(cached);
        const rows = await db.all(
            `SELECT s.user_id, u.username, s.game_id, s.bet_amount, s.win_amount,
                    ROUND(CAST(s.win_amount / NULLIF(s.bet_amount, 0) AS NUMERIC), 2) as multiplier,
                    s.created_at
             FROM spins s
             JOIN users u ON s.user_id = u.id
             WHERE s.win_amount > 0 AND s.bet_amount > 0 AND u.is_banned = 0
             ORDER BY s.win_amount DESC
             LIMIT 20`
        );

        const entries = rows.map(function (r, i) {
            return {
                rank: i + 1,
                maskedUser: maskUsername(r.username),
                gameId: r.game_id,
                betAmount: parseFloat(r.bet_amount) || 0,
                winAmount: parseFloat(r.win_amount) || 0,
                multiplier: parseFloat(r.multiplier) || 0,
                date: r.created_at ? String(r.created_at).slice(0, 10) : ''
            };
        });

        const payload = { entries: entries };
        cache.set('lb:bigwins', payload, 30);
        res.json(payload);
    } catch (err) {
        res.status(500).json({ error: 'Failed to load big wins leaderboard' });
    }
});

// GET /api/leaderboard/weekly — top 20 wagerers this calendar week (Mon 00:00 UTC to now)
router.get('/weekly', async (req, res) => {
    try {
        var cached = cache.get('lb:weekly');
        if (cached) return res.json(cached);
        const now = new Date();
        const dayOfWeek = now.getUTCDay();
        const daysToMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
        const monday = new Date(now);
        monday.setUTCDate(monday.getUTCDate() - daysToMonday);
        monday.setUTCHours(0, 0, 0, 0);
        const mondayStr = monday.toISOString().slice(0, 19).replace('T', ' ');

        const rows = await db.all(
            `SELECT s.user_id, u.username,
                    SUM(s.bet_amount) as total_wagered,
                    COUNT(*) as spin_count
             FROM spins s
             JOIN users u ON s.user_id = u.id
             WHERE s.created_at >= ? AND u.is_banned = 0
             GROUP BY s.user_id, u.username
             ORDER BY total_wagered DESC
             LIMIT 20`,
            [mondayStr]
        );

        const entries = rows.map(function (r, i) {
            return {
                rank: i + 1,
                maskedUser: maskUsername(r.username),
                totalWagered: parseFloat(r.total_wagered) || 0,
                spinCount: parseInt(r.spin_count, 10) || 0
            };
        });

        const payload = { entries: entries, weekStart: mondayStr };
        cache.set('lb:weekly', payload, 30);
        res.json(payload);
    } catch (err) {
        res.status(500).json({ error: 'Failed to load weekly leaderboard' });
    }
});

// GET /api/leaderboard/richlist — top 20 users by current balance
router.get('/richlist', async (req, res) => {
    try {
        var cached = cache.get('lb:richlist');
        if (cached) return res.json(cached);
        const rows = await db.all(
            `SELECT id as user_id, username, balance
             FROM users
             WHERE is_banned = 0 AND balance > 0
             ORDER BY balance DESC
             LIMIT 20`
        );

        const entries = rows.map(function (r, i) {
            return {
                rank: i + 1,
                maskedUser: maskUsername(r.username),
                balance: parseFloat(r.balance) || 0
            };
        });

        const payload = { entries: entries };
        cache.set('lb:richlist', payload, 30);
        res.json(payload);
    } catch (err) {
        res.status(500).json({ error: 'Failed to load rich list' });
    }
});

// GET /api/leaderboard/recent-wins — top 10 biggest wins in last 24 hours (lobby FOMO widget)
router.get('/recent-wins', async (req, res) => {
    try {
        var cached = cache.get('lb:recent-wins');
        if (cached) return res.json(cached);
        const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000)
            .toISOString().slice(0, 19).replace('T', ' ');

        const rows = await db.all(
            `SELECT s.user_id, u.username, s.game_id, s.bet_amount, s.win_amount, s.created_at
             FROM spins s
             JOIN users u ON s.user_id = u.id
             WHERE s.win_amount > 0 AND s.bet_amount > 0
               AND s.created_at >= ? AND u.is_banned = 0
             ORDER BY s.win_amount DESC
             LIMIT 10`,
            [cutoff]
        );

        // Load game definitions once (not per-row) for O(1) lookups
        var _gameMap = {};
        try {
            var GAMES = require('../../shared/game-definitions');
            for (var i = 0; i < GAMES.length; i++) _gameMap[GAMES[i].id] = GAMES[i];
        } catch(e) { /* game-definitions may not exist */ }

        const wins = rows.map(function(r) {
            var gameDef = _gameMap[r.game_id] || null;
            return {
                username: maskUsername(r.username),
                game_id: r.game_id,
                game_name: gameDef ? gameDef.name : r.game_id,
                bet_amount: parseFloat(r.bet_amount) || 0,
                win_amount: parseFloat(r.win_amount) || 0,
                multiplier: parseFloat(r.win_amount) / Math.max(parseFloat(r.bet_amount), 0.01),
                created_at: r.created_at
            };
        });

        const payload = { wins: wins };
        cache.set('lb:recent-wins', payload, 30);
        res.json(payload);
    } catch (err) {
        res.status(500).json({ error: 'Failed to load recent wins' });
    }
});


// GET /api/leaderboard/top — top 20 all-time players by total wagered (Season Leaderboard widget)
router.get('/top', async (req, res) => {
    try {
        var cached = cache.get('lb:top');
        if (cached) return res.json(cached);
        const rows = await db.all(
            `SELECT s.user_id, u.username,
                    SUM(s.bet_amount) as total_wagered,
                    SUM(CASE WHEN s.win_amount > s.bet_amount THEN s.win_amount - s.bet_amount ELSE 0 END) as total_profit,
                    COUNT(*) as spin_count
             FROM spins s
             JOIN users u ON s.user_id = u.id
             WHERE u.is_banned = 0
             GROUP BY s.user_id, u.username
             ORDER BY total_wagered DESC
             LIMIT 20`
        );

        const entries = rows.map(function (r, i) {
            return {
                rank: i + 1,
                maskedUser: maskUsername(r.username),
                totalWagered: parseFloat(r.total_wagered) || 0,
                totalProfit: parseFloat(r.total_profit) || 0,
                spinCount: parseInt(r.spin_count, 10) || 0
            };
        });

        const payload = { entries: entries };
        cache.set('lb:top', payload, 30);
        res.json(payload);
    } catch (err) {
        res.status(500).json({ error: 'Failed to load top leaderboard' });
    }
});
module.exports = router;
