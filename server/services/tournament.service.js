'use strict';

/**
 * Tournament Service
 *
 * Daily + weekly slot tournaments with cron-driven lifecycle:
 *   - Daily: free entry, 24h window, scoring = total winnings
 *   - Daily Hi-Roller: $5 buy-in (deducted from balance), 24h, scoring = best multiplier
 *   - Weekly: free entry, Mon→Sun UTC, scoring = total winnings
 *   - Weekly Hi-Roller: $20 buy-in, weekly, scoring = best multiplier
 *
 * Prize pool distribution: 1st 50%, 2nd 30%, 3rd 20% (credited as bonus_balance, 15x WR).
 * All money flows respect CLAUDE.md revenue rules.
 */

const db = require('../database');

const TOURNAMENT_TYPES = {
    daily_free: {
        type: 'daily_free',
        name: '🎰 Daily Spin Blitz',
        description: 'Free daily tournament — top 3 by total winnings split the prize pool',
        durationHours: 24,
        entry_fee: 0,
        prize_pool: 500,
        scoring: 'total_wins'
    },
    daily_hi: {
        type: 'daily_hi',
        name: '💎 Daily High Roller',
        description: 'Buy-in tournament — top 3 by best multiplier split the pot',
        durationHours: 24,
        entry_fee: 5,
        prize_pool: 0, // dynamic from buy-ins (90% to prize pool, 10% house)
        scoring: 'best_multiplier'
    },
    weekly_free: {
        type: 'weekly_free',
        name: '🏆 Weekly Slot Championship',
        description: 'Week-long free tournament — top 3 by total winnings',
        durationHours: 24 * 7,
        entry_fee: 0,
        prize_pool: 2500,
        scoring: 'total_wins'
    },
    weekly_hi: {
        type: 'weekly_hi',
        name: '👑 Weekly High Roller',
        description: 'Premium weekly buy-in tournament — top 3 by best multiplier',
        durationHours: 24 * 7,
        entry_fee: 20,
        prize_pool: 0, // dynamic
        scoring: 'best_multiplier'
    }
};

// Prize distribution
const PRIZE_SPLIT = [0.50, 0.30, 0.20];
const HOUSE_RAKE_PCT = 0.10;

function nowSql() {
    return db.isPg() ? 'NOW()' : "datetime('now')";
}

function nowIso() {
    return new Date().toISOString().slice(0, 19).replace('T', ' ');
}

function isoFromDate(d) {
    return d.toISOString().slice(0, 19).replace('T', ' ');
}

function addHoursIso(h) {
    return isoFromDate(new Date(Date.now() + h * 3600 * 1000));
}

function hoursUntilEndOfWeek() {
    var now = new Date();
    var day = now.getUTCDay(); // 0 = Sunday
    var hoursToSundayMidnight;
    if (day === 0) {
        hoursToSundayMidnight = 24 - now.getUTCHours() - (now.getUTCMinutes() / 60);
    } else {
        hoursToSundayMidnight = (7 - day) * 24 + (24 - now.getUTCHours() - (now.getUTCMinutes() / 60));
    }
    return Math.max(1, Math.floor(hoursToSundayMidnight));
}

function hoursUntilEndOfDay() {
    var now = new Date();
    return Math.max(1, Math.floor(24 - now.getUTCHours() - (now.getUTCMinutes() / 60)));
}

/**
 * Ensure one active tournament exists for each type. Called on startup and from cron.
 */
async function ensureActive() {
    var keys = Object.keys(TOURNAMENT_TYPES);
    for (var i = 0; i < keys.length; i++) {
        var cfg = TOURNAMENT_TYPES[keys[i]];
        var existing = await db.get(
            "SELECT id FROM tournaments WHERE type = ? AND status = 'active'",
            [cfg.type]
        );
        if (existing) continue;

        var dur = cfg.type.indexOf('weekly') === 0 ? hoursUntilEndOfWeek() : hoursUntilEndOfDay();
        // Use natural day/week boundaries when possible
        var startIso = nowIso();
        var endIso = addHoursIso(dur);

        await db.run(
            "INSERT INTO tournaments (name, description, type, entry_fee, prize_pool, start_date, end_date, status) " +
            "VALUES (?, ?, ?, ?, ?, ?, ?, 'active')",
            [cfg.name, cfg.description, cfg.type, cfg.entry_fee, cfg.prize_pool, startIso, endIso]
        );
    }
}

async function getActive() {
    var rows = await db.all(
        "SELECT t.id, t.name, t.description, t.type, t.prize_pool, t.entry_fee, " +
        "t.start_date, t.end_date, COUNT(te.id) AS entry_count " +
        "FROM tournaments t LEFT JOIN tournament_entries te ON te.tournament_id = t.id " +
        "WHERE t.status = 'active' AND t.end_date > " + nowSql() + " " +
        "GROUP BY t.id, t.name, t.description, t.type, t.prize_pool, t.entry_fee, t.start_date, t.end_date " +
        "ORDER BY t.end_date ASC"
    );
    return rows.map(_decorate);
}

async function getUpcoming() {
    var rows = await db.all(
        "SELECT id, name, description, type, prize_pool, entry_fee, start_date, end_date " +
        "FROM tournaments WHERE status = 'upcoming' " +
        "ORDER BY start_date ASC LIMIT 10"
    );
    return rows.map(_decorate);
}

async function getCompleted(limit) {
    limit = limit || 20;
    var rows = await db.all(
        "SELECT id, name, type, prize_pool, end_date FROM tournaments " +
        "WHERE status = 'completed' ORDER BY end_date DESC LIMIT ?",
        [limit]
    );
    return rows;
}

function _decorate(t) {
    var cfg = TOURNAMENT_TYPES[t.type];
    var end = new Date(t.end_date && t.end_date.replace ? t.end_date.replace(' ', 'T') + 'Z' : t.end_date);
    var ms = end.getTime() - Date.now();
    if (isNaN(ms)) ms = 0;
    return {
        id: t.id,
        name: t.name,
        description: t.description || (cfg && cfg.description) || '',
        type: t.type,
        scoring: cfg ? cfg.scoring : 'total_wins',
        prize_pool: Number(t.prize_pool || 0),
        entry_fee: Number(t.entry_fee || 0),
        entry_count: Number(t.entry_count || 0),
        start_date: t.start_date,
        end_date: t.end_date,
        ms_remaining: Math.max(0, ms),
        time_remaining: _humanizeMs(ms)
    };
}

function _humanizeMs(ms) {
    if (ms <= 0) return 'Ended';
    var h = Math.floor(ms / 3600000);
    var m = Math.floor((ms % 3600000) / 60000);
    var d = Math.floor(h / 24);
    if (d > 0) return d + 'd ' + (h % 24) + 'h';
    if (h > 0) return h + 'h ' + m + 'm';
    return m + 'm';
}

/**
 * Enter a tournament. Atomically deducts entry fee from balance if any.
 * For buy-in tournaments, 90% of fees go to prize pool, 10% house rake.
 */
async function enter(tournamentId, userId) {
    var t = await db.get(
        'SELECT id, type, entry_fee, prize_pool, status FROM tournaments WHERE id = ?',
        [tournamentId]
    );
    if (!t) return { ok: false, error: 'Tournament not found' };
    if (t.status !== 'active') return { ok: false, error: 'Tournament is not active' };

    var existing = await db.get(
        'SELECT id FROM tournament_entries WHERE tournament_id = ? AND user_id = ?',
        [tournamentId, userId]
    );
    if (existing) return { ok: false, error: 'Already entered' };

    var fee = Number(t.entry_fee || 0);
    if (fee > 0) {
        var deduct = await db.run(
            'UPDATE users SET balance = balance - ? WHERE id = ? AND balance >= ?',
            [fee, userId, fee]
        );
        if (!deduct || deduct.changes === 0) {
            return { ok: false, error: 'Insufficient balance for entry fee' };
        }
        // 90% of fee added to prize pool
        var poolAdd = fee * (1 - HOUSE_RAKE_PCT);
        await db.run(
            'UPDATE tournaments SET prize_pool = COALESCE(prize_pool, 0) + ? WHERE id = ?',
            [poolAdd, tournamentId]
        );
        try {
            await db.run(
                'INSERT INTO transactions (user_id, type, amount, balance_before, balance_after, reference) VALUES (?, ?, ?, ?, ?, ?)',
                [userId, 'tournament_entry', -fee, 0, 0, 'Entry fee for tournament ' + tournamentId]
            );
        } catch (_) {}
    }

    await db.run(
        'INSERT INTO tournament_entries (tournament_id, user_id, score, spins_played, biggest_win, entry_time, last_spin_time) ' +
        'VALUES (?, ?, 0, 0, 0, ?, ?)',
        [tournamentId, userId, nowIso(), nowIso()]
    );

    // Achievement: tournament_join
    try {
        await require('./achievement.service').grant(userId, 'tournament_join');
    } catch (_) {}

    return { ok: true };
}

/**
 * Submit a spin score to all active tournaments the user is entered in.
 * Called fire-and-forget from spin.routes.js.
 *
 *   winAmount: dollar amount won this spin
 *   bet: bet amount (used to compute multiplier)
 */
async function submitSpin(userId, winAmount, bet) {
    if (!userId) return;
    var win = Number(winAmount) || 0;
    var b = Number(bet) || 0;
    if (b <= 0) return;
    var mult = win / b;

    var activeRows = await db.all(
        "SELECT t.id, t.type FROM tournaments t " +
        "INNER JOIN tournament_entries te ON te.tournament_id = t.id AND te.user_id = ? " +
        "WHERE t.status = 'active' AND t.end_date > " + nowSql(),
        [userId]
    );

    for (var i = 0; i < activeRows.length; i++) {
        var t = activeRows[i];
        var cfg = TOURNAMENT_TYPES[t.type];
        var scoring = cfg ? cfg.scoring : 'total_wins';

        if (scoring === 'best_multiplier') {
            await db.run(
                'UPDATE tournament_entries SET ' +
                '  score = CASE WHEN ? > score THEN ? ELSE score END, ' +
                '  biggest_win = CASE WHEN ? > biggest_win THEN ? ELSE biggest_win END, ' +
                '  spins_played = spins_played + 1, last_spin_time = ? ' +
                'WHERE tournament_id = ? AND user_id = ?',
                [mult, mult, win, win, nowIso(), t.id, userId]
            );
        } else {
            // total_wins
            await db.run(
                'UPDATE tournament_entries SET ' +
                '  score = COALESCE(score, 0) + ?, ' +
                '  biggest_win = CASE WHEN ? > biggest_win THEN ? ELSE biggest_win END, ' +
                '  spins_played = spins_played + 1, last_spin_time = ? ' +
                'WHERE tournament_id = ? AND user_id = ?',
                [win, win, win, nowIso(), t.id, userId]
            );
        }
    }
}

/**
 * Backwards-compat shim — many existing call sites pass (tournamentId, userId, mult).
 */
async function submitScore(tournamentId, userId, mult) {
    if (!mult || mult <= 0) return;
    await db.run(
        'INSERT OR IGNORE INTO tournament_entries (tournament_id, user_id, score, spins_played, biggest_win, entry_time) VALUES (?, ?, 0, 0, 0, ?)',
        [tournamentId, userId, nowIso()]
    );
    var t = await db.get('SELECT type FROM tournaments WHERE id = ?', [tournamentId]);
    var cfg = t && TOURNAMENT_TYPES[t.type];
    var scoring = cfg ? cfg.scoring : 'best_multiplier';
    if (scoring === 'best_multiplier') {
        await db.run(
            'UPDATE tournament_entries SET score = CASE WHEN ? > score THEN ? ELSE score END, ' +
            'biggest_win = CASE WHEN ? > biggest_win THEN ? ELSE biggest_win END, ' +
            'spins_played = spins_played + 1 WHERE tournament_id = ? AND user_id = ?',
            [mult, mult, mult, mult, tournamentId, userId]
        );
    } else {
        await db.run(
            'UPDATE tournament_entries SET score = COALESCE(score, 0) + ?, spins_played = spins_played + 1 ' +
            'WHERE tournament_id = ? AND user_id = ?',
            [mult, tournamentId, userId]
        );
    }
}

async function getLeaderboard(tournamentId, limit) {
    limit = limit || 20;
    var rows = await db.all(
        'SELECT te.user_id, te.score, te.spins_played, te.biggest_win, te.entry_time, ' +
        '       COALESCE(u.display_name, u.username) AS username ' +
        'FROM tournament_entries te ' +
        'JOIN users u ON u.id = te.user_id ' +
        'WHERE te.tournament_id = ? ' +
        'ORDER BY te.score DESC LIMIT ?',
        [tournamentId, limit]
    );
    return rows.map(function (r, i) {
        return {
            rank: i + 1,
            user_id: r.user_id,
            username: r.username,
            score: Number(r.score || 0),
            spins_played: Number(r.spins_played || 0),
            biggest_win: Number(r.biggest_win || 0)
        };
    });
}

async function getMyEntry(tournamentId, userId) {
    var entry = await db.get(
        'SELECT id, score, spins_played, biggest_win, entry_time FROM tournament_entries WHERE tournament_id = ? AND user_id = ?',
        [tournamentId, userId]
    );
    if (!entry) return { entered: false };

    var rankRow = await db.get(
        'SELECT COUNT(*) AS cnt FROM tournament_entries WHERE tournament_id = ? AND score > ?',
        [tournamentId, entry.score]
    );
    return {
        entered: true,
        rank: (rankRow ? Number(rankRow.cnt) : 0) + 1,
        score: Number(entry.score || 0),
        spins_played: Number(entry.spins_played || 0),
        biggest_win: Number(entry.biggest_win || 0)
    };
}

/**
 * Complete a tournament — distribute prizes 50/30/20 to top 3.
 * Prizes go to bonus_balance with 15x wagering.
 */
async function _completeTournament(tournamentId) {
    var t = await db.get('SELECT id, name, type, prize_pool, status FROM tournaments WHERE id = ?', [tournamentId]);
    if (!t || t.status !== 'active') return { distributed: 0 };

    await db.run("UPDATE tournaments SET status = 'completed' WHERE id = ?", [tournamentId]);

    var board = await getLeaderboard(tournamentId, 3);
    var pool = Number(t.prize_pool || 0);
    if (pool <= 0 || board.length === 0) return { distributed: 0 };

    var distributed = 0;
    for (var i = 0; i < board.length && i < PRIZE_SPLIT.length; i++) {
        var amount = Math.floor(pool * PRIZE_SPLIT[i] * 100) / 100;
        if (amount <= 0) continue;
        var winner = board[i];
        try {
            await db.run(
                'UPDATE users SET bonus_balance = COALESCE(bonus_balance, 0) + ?, ' +
                'wagering_requirement = COALESCE(wagering_requirement, 0) + ? WHERE id = ?',
                [amount, amount * 15, winner.user_id]
            );
            await db.run(
                'INSERT INTO transactions (user_id, type, amount, balance_before, balance_after, reference) ' +
                'VALUES (?, ?, ?, ?, ?, ?)',
                [winner.user_id, 'tournament_prize', amount, 0, 0,
                 'Tournament: ' + t.name + ' rank ' + (i + 1)]
            );
            // Persist final results
            try {
                await db.run(
                    'CREATE TABLE IF NOT EXISTS tournament_results (' +
                    '  id INTEGER PRIMARY KEY AUTOINCREMENT,' +
                    '  tournament_id INTEGER, user_id INTEGER, rank INTEGER,' +
                    '  score REAL, prize REAL, awarded_at TEXT)'
                );
            } catch (_) {}
            try {
                await db.run(
                    'INSERT INTO tournament_results (tournament_id, user_id, rank, score, prize, awarded_at) ' +
                    'VALUES (?, ?, ?, ?, ?, ?)',
                    [tournamentId, winner.user_id, i + 1, winner.score, amount, nowIso()]
                );
            } catch (_) {}
            try {
                await db.run(
                    'INSERT INTO notifications (user_id, type, title, body) VALUES (?, ?, ?, ?)',
                    [winner.user_id, 'tournament_win',
                     'Tournament Prize!',
                     'You finished rank ' + (i + 1) + ' in ' + t.name + ' — $' + amount.toFixed(2) + ' credited (bonus, 15x wagering).']
                );
            } catch (_) {}
            // Achievements
            try {
                var ach = require('./achievement.service');
                if (i === 0) await ach.grant(winner.user_id, 'tournament_win');
                if (i < 3)   await ach.grant(winner.user_id, 'tournament_top3');
            } catch (_) {}
            distributed += amount;
        } catch (e) {
            console.warn('[Tournament] payout failed for user', winner.user_id, e.message);
        }
    }
    return { distributed: distributed, winners: board.length };
}

/**
 * Cron tick: finalize expired tournaments, then create new ones.
 * Safe to call frequently — idempotent.
 */
async function tick() {
    try {
        var expired = await db.all(
            "SELECT id FROM tournaments WHERE status = 'active' AND end_date < " + nowSql()
        );
        for (var i = 0; i < expired.length; i++) {
            try {
                await _completeTournament(expired[i].id);
            } catch (e) {
                console.warn('[Tournament] complete error:', e.message);
            }
        }
    } catch (e) {
        console.warn('[Tournament] tick lookup error:', e.message);
    }
    await ensureActive();
}

module.exports = {
    TOURNAMENT_TYPES: TOURNAMENT_TYPES,
    PRIZE_SPLIT: PRIZE_SPLIT,
    ensureActive: ensureActive,
    getActive: getActive,
    getUpcoming: getUpcoming,
    getCompleted: getCompleted,
    enter: enter,
    join: enter, // back-compat
    submitSpin: submitSpin,
    submitScore: submitScore,
    getLeaderboard: getLeaderboard,
    getMyEntry: getMyEntry,
    tick: tick,
    _completeTournament: _completeTournament
};
