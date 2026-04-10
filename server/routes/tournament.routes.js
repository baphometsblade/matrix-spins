'use strict';

/**
 * Tournament/Leaderboard System
 *
 * Supports multiple concurrent tournaments with flexible scoring and entry fees.
 * Daily tournaments reset at midnight UTC, weekly on Monday midnight UTC.
 */

const express = require('express');
const { authenticate } = require('../middleware/auth');
const db = require('../database');

const router = express.Router();

// ─────────────────────────────────────────────────────────────────────────────
// Initialize schema and seed data (lazy pattern)
// ─────────────────────────────────────────────────────────────────────────────

var _schemaReady = false;

async function _ensureTournamentTables() {
    if (_schemaReady) return;

    var isPg = db.isPg();
    var idDef = isPg ? 'SERIAL PRIMARY KEY' : 'INTEGER PRIMARY KEY AUTOINCREMENT';
    var dateDef = isPg ? 'TIMESTAMPTZ DEFAULT NOW()' : "TEXT DEFAULT (datetime('now'))";

    // Tables should already exist from schema bootstrap, but ensure they do
    try {
        await db.run(
            'CREATE TABLE IF NOT EXISTS tournaments (' +
            '  id               ' + idDef + ',' +
            '  name             TEXT NOT NULL,' +
            '  description      TEXT,' +
            '  type             TEXT NOT NULL,' +
            '  entry_fee        REAL DEFAULT 0,' +
            '  prize_pool       REAL DEFAULT 0,' +
            '  start_date       TEXT NOT NULL,' +
            '  end_date         TEXT NOT NULL,' +
            '  status           TEXT DEFAULT "active",' +
            '  max_participants INTEGER,' +
            '  created_at       ' + dateDef +
            ')'
        );

        await db.run(
            'CREATE TABLE IF NOT EXISTS tournament_entries (' +
            '  id               ' + idDef + ',' +
            '  tournament_id    INTEGER NOT NULL,' +
            '  user_id          INTEGER NOT NULL,' +
            '  score            REAL DEFAULT 0,' +
            '  spins_played     INTEGER DEFAULT 0,' +
            '  biggest_win      REAL DEFAULT 0,' +
            '  entry_time       TEXT,' +
            '  last_spin_time   TEXT,' +
            '  UNIQUE(tournament_id, user_id),' +
            '  FOREIGN KEY (tournament_id) REFERENCES tournaments(id),' +
            '  FOREIGN KEY (user_id) REFERENCES users(id)' +
            ')'
        );

        await db.run(
            'CREATE TABLE IF NOT EXISTS tournament_prizes (' +
            '  id               ' + idDef + ',' +
            '  tournament_id    INTEGER NOT NULL,' +
            '  rank             INTEGER NOT NULL,' +
            '  prize_gems       INTEGER DEFAULT 0,' +
            '  prize_description TEXT,' +
            '  UNIQUE(tournament_id, rank),' +
            '  FOREIGN KEY (tournament_id) REFERENCES tournaments(id)' +
            ')'
        );
    } catch (err) {
        // Tables may already exist
    }

    _schemaReady = true;
}

async function _seedTournaments() {
    // Seed only once per process
    var existing = await db.get('SELECT COUNT(*) AS cnt FROM tournaments');
    if (existing && existing.cnt > 0) return;

    var today = new Date().toISOString().split('T')[0];
    var tomorrow = new Date(Date.now() + 86400000).toISOString().split('T')[0];
    var nextMonday = getNextMondayDate();
    var nextSunday = new Date(new Date(nextMonday).getTime() + 6 * 86400000).toISOString().split('T')[0];

    try {
        // 1. Daily Spin Blitz — free entry, daily, score by total winnings
        var daily = await db.run(
            'INSERT INTO tournaments (name, description, type, entry_fee, prize_pool, start_date, end_date, status, max_participants) ' +
            'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
            [
                'Daily Spin Blitz',
                'Free daily tournament — top 10 by total winnings win gems',
                'daily',
                0,  // free entry
                4600,  // 1000+500+250+100*7
                today,
                tomorrow,
                'active',
                null
            ]
        );
        var dailyId = daily.lastID || (await db.get('SELECT id FROM tournaments WHERE name = ? LIMIT 1', ['Daily Spin Blitz'])).id;

        // Daily prizes
        var dailyPrizes = [
            { rank: 1, gems: 1000, desc: '1st Place - Daily Champ' },
            { rank: 2, gems: 500, desc: '2nd Place' },
            { rank: 3, gems: 250, desc: '3rd Place' },
            { rank: 4, gems: 100, desc: '4-10th Place' },
            { rank: 5, gems: 100, desc: '4-10th Place' },
            { rank: 6, gems: 100, desc: '4-10th Place' },
            { rank: 7, gems: 100, desc: '4-10th Place' },
            { rank: 8, gems: 100, desc: '4-10th Place' },
            { rank: 9, gems: 100, desc: '4-10th Place' },
            { rank: 10, gems: 100, desc: '4-10th Place' }
        ];

        for (var i = 0; i < dailyPrizes.length; i++) {
            await db.run(
                'INSERT OR IGNORE INTO tournament_prizes (tournament_id, rank, prize_gems, prize_description) VALUES (?, ?, ?, ?)',
                [dailyId, dailyPrizes[i].rank, dailyPrizes[i].gems, dailyPrizes[i].desc]
            );
        }

        // 2. High Roller Weekly — 500 gem entry, weekly, score by biggest single win
        var weekly = await db.run(
            'INSERT INTO tournaments (name, description, type, entry_fee, prize_pool, start_date, end_date, status, max_participants) ' +
            'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
            [
                'High Roller Weekly',
                'Elite tournament — 500 gem entry, top 5 by biggest single win get gems',
                'weekly',
                500,  // gem entry fee
                9250,  // 5000+2500+1000+500+250
                today,
                nextSunday,
                'active',
                null
            ]
        );
        var weeklyId = weekly.lastID || (await db.get('SELECT id FROM tournaments WHERE name = ? LIMIT 1', ['High Roller Weekly'])).id;

        var weeklyPrizes = [
            { rank: 1, gems: 5000, desc: '1st Place - High Roller Champion' },
            { rank: 2, gems: 2500, desc: '2nd Place' },
            { rank: 3, gems: 1000, desc: '3rd Place' },
            { rank: 4, gems: 500, desc: '4th Place' },
            { rank: 5, gems: 250, desc: '5th Place' }
        ];

        for (var j = 0; j < weeklyPrizes.length; j++) {
            await db.run(
                'INSERT OR IGNORE INTO tournament_prizes (tournament_id, rank, prize_gems, prize_description) VALUES (?, ?, ?, ?)',
                [weeklyId, weeklyPrizes[j].rank, weeklyPrizes[j].gems, weeklyPrizes[j].desc]
            );
        }

        // 3. Matrix Marathon — 100 gem entry, weekly, score by total spins
        var matrix = await db.run(
            'INSERT INTO tournaments (name, description, type, entry_fee, prize_pool, start_date, end_date, status, max_participants) ' +
            'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
            [
                'Matrix Marathon',
                'Spin grind tournament — 100 gem entry, top 10 by spins played get gems',
                'weekly',
                100,  // gem entry fee
                4200,  // 2000+1000+500+200*7
                today,
                nextSunday,
                'active',
                null
            ]
        );
        var matrixId = matrix.lastID || (await db.get('SELECT id FROM tournaments WHERE name = ? LIMIT 1', ['Matrix Marathon'])).id;

        var matrixPrizes = [
            { rank: 1, gems: 2000, desc: '1st Place - Marathon Master' },
            { rank: 2, gems: 1000, desc: '2nd Place' },
            { rank: 3, gems: 500, desc: '3rd Place' },
            { rank: 4, gems: 200, desc: '4-10th Place' },
            { rank: 5, gems: 200, desc: '4-10th Place' },
            { rank: 6, gems: 200, desc: '4-10th Place' },
            { rank: 7, gems: 200, desc: '4-10th Place' },
            { rank: 8, gems: 200, desc: '4-10th Place' },
            { rank: 9, gems: 200, desc: '4-10th Place' },
            { rank: 10, gems: 200, desc: '4-10th Place' }
        ];

        for (var k = 0; k < matrixPrizes.length; k++) {
            await db.run(
                'INSERT OR IGNORE INTO tournament_prizes (tournament_id, rank, prize_gems, prize_description) VALUES (?, ?, ?, ?)',
                [matrixId, matrixPrizes[k].rank, matrixPrizes[k].gems, matrixPrizes[k].desc]
            );
        }
    } catch (err) {
        console.warn('[Tournament] Seed error:', err.message);
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function getTodayDate() {
    return new Date().toISOString().split('T')[0];
}

function getNextMondayDate() {
    var now = new Date();
    var day = now.getUTCDay();
    var daysBack = day === 0 ? 6 : day - 1;
    var monday = new Date(Date.UTC(
        now.getUTCFullYear(),
        now.getUTCMonth(),
        now.getUTCDate() - daysBack + 7  // next Monday
    ));
    return monday.toISOString().split('T')[0];
}

function getTimeRemaining(endDate) {
    var end = new Date(endDate);
    var now = new Date();
    var ms = end.getTime() - now.getTime();
    if (ms < 0) return '0s';

    var hours = Math.floor(ms / 3600000);
    var mins = Math.floor((ms % 3600000) / 60000);
    if (hours > 0) return hours + 'h ' + mins + 'm';
    return mins + 'm';
}

// ─────────────────────────────────────────────────────────────────────────────
// Routes
// ─────────────────────────────────────────────────────────────────────────────

// GET /api/tournament/active — list active tournaments with entry counts
// Root route - return active tournaments (alias for /active)
router.get('/', async (req, res) => {
    try {
        await _ensureTournamentTables();
        var now = new Date().toISOString().slice(0, 19).replace('T', ' ');
        var tournaments = await db.all(
            'SELECT id, name, description, type, entry_fee, prize_pool, start_date, end_date, status, max_participants, created_at FROM tournaments WHERE status = ? AND end_time > datetime(?) ORDER BY end_time ASC LIMIT 10',
            ['active', now]
        );
        res.json({ tournaments: tournaments || [] });
    } catch (err) {
        res.json({ tournaments: [] });
    }
});

router.get('/active', async (req, res) => {
    try {
        await _ensureTournamentTables();

        var rows = await db.all(
            'SELECT t.id, t.name, t.description, t.type, t.entry_fee, t.prize_pool, t.start_date, t.end_date, t.status, t.max_participants, COUNT(te.id) AS entry_count ' +
            'FROM tournaments t ' +
            'LEFT JOIN tournament_entries te ON te.tournament_id = t.id ' +
            'WHERE t.status = ? ' +
            'GROUP BY t.id, t.name, t.description, t.type, t.entry_fee, t.prize_pool, t.start_date, t.end_date, t.status, t.max_participants',
            ['active']
        );

        var result = rows.map(function(t) {
            return {
                id: t.id,
                name: t.name,
                description: t.description,
                type: t.type,
                entry_fee: t.entry_fee,
                prize_pool: t.prize_pool,
                participant_count: t.entry_count || 0,
                time_remaining: getTimeRemaining(t.end_date),
                start_date: t.start_date,
                end_date: t.end_date
            };
        });

        return res.json({ tournaments: result });
    } catch (err) {
        console.warn('[Tournament] GET /active error:', err.message);
        return res.status(500).json({ error: 'Failed to load active tournaments' });
    }
});

// GET /api/tournament/:id — tournament details + leaderboard (top 20)
router.get('/:id', async (req, res) => {
    try {
        await _ensureTournamentTables();

        var id = parseInt(req.params.id, 10);
        if (!id || isNaN(id)) return res.status(400).json({ error: 'Invalid tournament id' });

        var tournament = await db.get('SELECT id, name, description, type, entry_fee, prize_pool, start_date, end_date, status, max_participants FROM tournaments WHERE id = ?', [id]);
        if (!tournament) return res.status(404).json({ error: 'Tournament not found' });

        // Get leaderboard (top 20)
        var leaderboard = await db.all(
            'SELECT te.id, te.user_id, te.score, te.spins_played, te.biggest_win, te.entry_time, ' +
            '       COALESCE(u.display_name, u.username) AS username ' +
            'FROM tournament_entries te ' +
            'JOIN users u ON u.id = te.user_id ' +
            'WHERE te.tournament_id = ? ' +
            'ORDER BY te.score DESC LIMIT 20',
            [id]
        );

        var leaderboardWithRank = leaderboard.map(function(row, idx) {
            return {
                rank: idx + 1,
                user_id: row.user_id,
                username: row.username,
                score: row.score,
                spins_played: row.spins_played,
                biggest_win: row.biggest_win
            };
        });

        // Get prizes
        var prizes = await db.all(
            'SELECT id, tournament_id, rank, prize_gems, prize_description FROM tournament_prizes WHERE tournament_id = ? ORDER BY rank ASC',
            [id]
        );

        return res.json({
            tournament: {
                id: tournament.id,
                name: tournament.name,
                description: tournament.description,
                type: tournament.type,
                entry_fee: tournament.entry_fee,
                prize_pool: tournament.prize_pool,
                start_date: tournament.start_date,
                end_date: tournament.end_date,
                time_remaining: getTimeRemaining(tournament.end_date)
            },
            leaderboard: leaderboardWithRank,
            prizes: prizes
        });
    } catch (err) {
        console.warn('[Tournament] GET /:id error:', err.message);
        return res.status(500).json({ error: 'Failed to load tournament' });
    }
});

// GET /api/tournament/:id/my-rank — user's current rank and score
router.get('/:id/my-rank', authenticate, async (req, res) => {
    try {
        await _ensureTournamentTables();

        var id = parseInt(req.params.id, 10);
        if (!Number.isFinite(id)) return res.status(400).json({ error: 'Invalid tournament ID' });
        var userId = req.user.id;

        var entry = await db.get(
            'SELECT id, score, spins_played, biggest_win FROM tournament_entries WHERE tournament_id = ? AND user_id = ?',
            [id, userId]
        );

        if (!entry) {
            return res.json({ rank: null, score: 0, entered: false });
        }

        var rankRow = await db.get(
            'SELECT COUNT(*) AS cnt FROM tournament_entries WHERE tournament_id = ? AND score > ?',
            [id, entry.score]
        );

        var rank = (rankRow ? parseInt(rankRow.cnt, 10) : 0) + 1;

        return res.json({
            entered: true,
            rank: rank,
            score: entry.score,
            spins_played: entry.spins_played,
            biggest_win: entry.biggest_win
        });
    } catch (err) {
        console.warn('[Tournament] GET /:id/my-rank error:', err.message);
        return res.status(500).json({ error: 'Failed to load rank' });
    }
});

// POST /api/tournament/:id/enter — enter tournament (deduct entry fee if applicable)
router.post('/:id/enter', authenticate, async (req, res) => {
    try {
        await _ensureTournamentTables();

        var id = parseInt(req.params.id, 10);
        if (!Number.isFinite(id)) return res.status(400).json({ error: 'Invalid tournament ID' });
        var userId = req.user.id;

        // SECURITY: Check self-exclusion before allowing tournament entry
        var selfExcl = await db.get(
            "SELECT id FROM self_exclusions WHERE user_id = ? AND is_active = 1 AND (ends_at IS NULL OR ends_at > datetime('now'))",
            [userId]
        );
        if (selfExcl) return res.status(403).json({ error: 'Your account is currently self-excluded from playing.' });

        var tournament = await db.get('SELECT id, name, type, entry_fee, prize_pool, start_date, end_date, status, max_participants FROM tournaments WHERE id = ?', [id]);
        if (!tournament) return res.status(404).json({ error: 'Tournament not found' });

        // Check if already entered
        var existing = await db.get(
            'SELECT id FROM tournament_entries WHERE tournament_id = ? AND user_id = ?',
            [id, userId]
        );
        if (existing) return res.status(400).json({ error: 'Already entered' });

        // ── Wrap entry fee deduction + entry creation in transaction ──
        // Prevents: user pays fee but INSERT fails → lost gems with no entry
        await db.beginTransaction();
        try {
            // Check & deduct gem balance atomically if entry fee required
            if (tournament.entry_fee > 0) {
                var deductResult = await db.run(
                    'UPDATE users SET balance = balance - ? WHERE id = ? AND balance >= ?',
                    [tournament.entry_fee, userId, tournament.entry_fee]
                );
                if (!deductResult || deductResult.changes === 0) {
                    await db.rollback();
                    return res.status(400).json({ error: 'Insufficient gems for entry fee' });
                }
            }

            // Create entry
            var now = new Date().toISOString().slice(0, 19).replace('T', ' ');
            var result = await db.run(
                'INSERT INTO tournament_entries (tournament_id, user_id, score, spins_played, biggest_win, entry_time, last_spin_time) ' +
                'VALUES (?, ?, 0, 0, 0, ?, ?)',
                [id, userId, now, now]
            );

            await db.commit();

            return res.json({
                success: true,
                message: 'Entered tournament successfully',
                entry_id: result.lastID
            });
        } catch (txErr) {
            try { await db.rollback(); } catch (rbErr) { console.warn('[Tournament] Rollback failed:', rbErr.message || rbErr); }
            throw txErr;
        }
    } catch (err) {
        console.warn('[Tournament] POST /:id/enter error:', err.message);
        return res.status(500).json({ error: 'Failed to enter tournament' });
    }
});

// POST /api/tournament/:id/record-spin — record a spin result
router.post('/:id/record-spin', authenticate, async (req, res) => {
    try {
        await _ensureTournamentTables();

        var id = parseInt(req.params.id, 10);
        if (!Number.isFinite(id)) return res.status(400).json({ error: 'Invalid tournament ID' });
        var userId = req.user.id;
        var { winAmount, spins, betAmount } = req.body;

        var entry = await db.get(
            'SELECT id, score, spins_played, biggest_win FROM tournament_entries WHERE tournament_id = ? AND user_id = ?',
            [id, userId]
        );
        if (!entry) return res.status(404).json({ error: 'Not entered in tournament' });

        // Update entry based on tournament type
        var tournament = await db.get('SELECT type FROM tournaments WHERE id = ?', [id]);
        var newScore = entry.score;
        var newBiggestWin = entry.biggest_win;

        if (tournament.type === 'daily') {
            // Daily: score by total winnings
            newScore = entry.score + (winAmount || 0);
        } else if (tournament.type === 'weekly') {
            // Detect scoring type from name or use biggest win as default
            if (tournament.name && tournament.name.includes('Roller')) {
                // High Roller: score by biggest single win
                newBiggestWin = Math.max(entry.biggest_win, winAmount || 0);
                newScore = newBiggestWin;
            } else if (tournament.name && tournament.name.includes('Marathon')) {
                // Marathon: score by total spins
                newScore = entry.spins_played + (spins || 1);
            } else {
                // Default: total winnings
                newScore = entry.score + (winAmount || 0);
            }
        }

        if (winAmount && winAmount > newBiggestWin) {
            newBiggestWin = winAmount;
        }

        var now = new Date().toISOString().slice(0, 19).replace('T', ' ');
        await db.run(
            'UPDATE tournament_entries SET score = ?, spins_played = spins_played + ?, ' +
            'biggest_win = ?, last_spin_time = ? WHERE tournament_id = ? AND user_id = ?',
            [newScore, (spins || 1), newBiggestWin, now, id, userId]
        );

        // Get updated rank
        var rankRow = await db.get(
            'SELECT COUNT(*) AS cnt FROM tournament_entries WHERE tournament_id = ? AND score > ?',
            [id, newScore]
        );
        var rank = (rankRow ? parseInt(rankRow.cnt, 10) : 0) + 1;

        return res.json({
            recorded: true,
            score: newScore,
            rank: rank
        });
    } catch (err) {
        console.warn('[Tournament] POST /:id/record-spin error:', err.message);
        return res.status(500).json({ error: 'Failed to record spin' });
    }
});

// GET /api/tournament/history — past tournament results (inactive tournaments)
router.get('/history', async (req, res) => {
    try {
        await _ensureTournamentTables();

        var tournaments = await db.all(
            'SELECT t.id, t.name, t.type, t.prize_pool, t.end_date, t.status, COUNT(te.id) AS participants ' +
            'FROM tournaments t ' +
            'LEFT JOIN tournament_entries te ON te.tournament_id = t.id ' +
            'WHERE t.status = ? OR t.end_date < ? ' +
            'GROUP BY t.id, t.name, t.type, t.prize_pool, t.end_date, t.status ' +
            'ORDER BY t.end_date DESC ' +
            'LIMIT 50',
            ['inactive', getTodayDate()]
        );

        var result = tournaments.map(function(t) {
            return {
                id: t.id,
                name: t.name,
                type: t.type,
                prize_pool: t.prize_pool,
                participants: t.participants || 0,
                end_date: t.end_date
            };
        });

        return res.json({ history: result });
    } catch (err) {
        console.warn('[Tournament] GET /history error:', err.message);
        return res.status(500).json({ error: 'Failed to load history' });
    }
});

// Bootstrap on load (delayed to ensure DB is initialized)
setTimeout(function() {
    _ensureTournamentTables().then(function() {
        _seedTournaments().catch(function(err) {
            console.warn('[Tournament] Seed failed:', err.message);
        });
    }).catch(function(err) {
        console.warn('[Tournament] Bootstrap failed:', err.message);
    });
}, 3000);

module.exports = router;
