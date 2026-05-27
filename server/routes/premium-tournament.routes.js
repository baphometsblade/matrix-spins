'use strict';

const router = require('express').Router();
const { authenticate, requireAdmin } = require('../middleware/auth');
const db = require('../database');

// Bootstrap tables at module load — tables are also in schema files for production
// This is a fallback for dev/SQLite; PG uses schema-pg.js SERIAL definitions
(async function bootstrapTables() {
    try {
        var isPg = db.isPg();
        var idDef = isPg ? 'SERIAL PRIMARY KEY' : 'INTEGER PRIMARY KEY AUTOINCREMENT';
        var tsDef = isPg ? 'TIMESTAMPTZ DEFAULT NOW()' : "TEXT DEFAULT (datetime('now'))";
        await db.run(
            'CREATE TABLE IF NOT EXISTS premium_tournaments (' +
            '  id ' + idDef + ',' +
            '  name TEXT NOT NULL,' +
            '  entry_fee REAL NOT NULL,' +
            '  prize_pool REAL NOT NULL,' +
            '  max_players INTEGER DEFAULT 100,' +
            '  current_players INTEGER DEFAULT 0,' +
            "  status TEXT DEFAULT 'active'," +
            '  starts_at TEXT,' +
            '  ends_at TEXT,' +
            '  created_at ' + tsDef +
            ')'
        );
        await db.run(
            'CREATE TABLE IF NOT EXISTS premium_tournament_entries (' +
            '  id ' + idDef + ',' +
            '  tournament_id INTEGER NOT NULL,' +
            '  user_id INTEGER NOT NULL,' +
            '  score REAL DEFAULT 0,' +
            '  spins INTEGER DEFAULT 0,' +
            '  best_win REAL DEFAULT 0,' +
            '  joined_at ' + tsDef + ',' +
            '  UNIQUE(tournament_id, user_id)' +
            ')'
        );
        console.warn('[PremiumTournaments] Tables initialized');
    } catch (err) {
        console.warn('[PremiumTournaments] Bootstrap error (tables may already exist):', err.message);
    }
})();

// Seed default premium tournaments at module load (with 5s delay to allow schema setup)
setTimeout(function() {
    seedDefaultTournaments().catch(function() {});
}, 5000);

/**
 * Seed 3 default premium tournaments if they don't exist
 */
async function seedDefaultTournaments() {
    try {
        // Check if tournaments already seeded
        const count = await db.get(
            'SELECT COUNT(*) as cnt FROM premium_tournaments'
        );

        if (count && parseInt(count.cnt, 10) > 0) {
            return; // Already seeded
        }

        const now = new Date();
        const sevenDaysFromNow = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 19).replace('T', ' ');
        const oneDayFromNow = new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString().slice(0, 19).replace('T', ' ');

        // ROUND 59: Prize pools now set to ~85% of max entry revenue — house keeps 15% rake
        // Old values: Diamond Classic had $10K pool on $5K max entries — guaranteed loss

        // High Roller Showdown — $50 entry × 100 = $5K max revenue, $4250 pool (85%)
        await db.run(
            'INSERT INTO premium_tournaments (name, entry_fee, prize_pool, max_players, status, starts_at, ends_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
            ['High Roller Showdown', 50, 4250, 100, 'active', now.toISOString().slice(0, 19).replace('T', ' '), sevenDaysFromNow]
        );

        // Speed Spinner — $10 entry × 50 = $500 max revenue, $425 pool (85%)
        await db.run(
            'INSERT INTO premium_tournaments (name, entry_fee, prize_pool, max_players, status, starts_at, ends_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
            ['Speed Spinner', 10, 425, 50, 'active', now.toISOString().slice(0, 19).replace('T', ' '), oneDayFromNow]
        );

        // Diamond Classic — $100 entry × 50 = $5K max revenue, $4250 pool (85%)
        await db.run(
            'INSERT INTO premium_tournaments (name, entry_fee, prize_pool, max_players, status, starts_at, ends_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
            ['Diamond Classic', 100, 4250, 50, 'active', now.toISOString().slice(0, 19).replace('T', ' '), sevenDaysFromNow]
        );

        console.warn('[premium-tournament] Seeded 3 default tournaments');
    } catch (err) {
        console.warn('[premium-tournament] seedDefaultTournaments error:', err.message);
    }
}

// GET /api/premium-tournament/
// List active premium tournaments
router.get('/', async function(req, res) {
    try {
        const rows = await db.all(
            "SELECT id, name, entry_fee, prize_pool, max_players, current_players, status, starts_at, ends_at FROM premium_tournaments WHERE status = 'active' AND ends_at > datetime('now') ORDER BY ends_at ASC"
        );

        if (!rows || rows.length === 0) {
            return res.json({ tournaments: [] });
        }

        const tournaments = rows.map(function(row) {
            const now = new Date();
            const endsAt = new Date(row.ends_at);
            const timeRemaining = Math.max(0, endsAt.getTime() - now.getTime()); // milliseconds

            return {
                id: row.id,
                name: row.name,
                entryFee: parseFloat(row.entry_fee) || 0,
                prizePool: parseFloat(row.prize_pool) || 0,
                maxPlayers: parseInt(row.max_players, 10) || 100,
                currentPlayers: parseInt(row.current_players, 10) || 0,
                status: row.status,
                startsAt: row.starts_at,
                endsAt: row.ends_at,
                timeRemainingMs: timeRemaining
            };
        });

        return res.json({ tournaments: tournaments });
    } catch (err) {
        console.warn('[premium-tournament] GET / error:', err.message);
        return res.status(500).json({ error: 'Failed to fetch tournaments' });
    }
});

// POST /api/premium-tournament/:id/join
// Join a premium tournament (authenticate required)
router.post('/:id/join', authenticate, async function(req, res) {
    try {
        const tournamentId = parseInt(req.params.id, 10);
        const userId = req.user.id;

        // SECURITY: Check self-exclusion before allowing premium tournament entry
        const selfExcl = await db.get(
            "SELECT id FROM self_exclusions WHERE user_id = ? AND is_active = 1 AND (ends_at IS NULL OR ends_at > datetime('now'))",
            [userId]
        );
        if (selfExcl) return res.status(403).json({ error: 'Your account is currently self-excluded from playing.' });

        // Check tournament exists and is active
        const tournament = await db.get(
            "SELECT id, name, entry_fee, prize_pool, max_players, current_players, status, ends_at FROM premium_tournaments WHERE id = ? AND status = 'active' AND ends_at > datetime('now')",
            [tournamentId]
        );

        if (!tournament) {
            return res.status(404).json({ error: 'Tournament not found or inactive' });
        }

        // Check user not already joined
        const existingEntry = await db.get(
            'SELECT id FROM premium_tournament_entries WHERE tournament_id = ? AND user_id = ?',
            [tournamentId, userId]
        );

        if (existingEntry) {
            return res.status(400).json({ error: 'You have already joined this tournament' });
        }

        // Check max_players not reached
        const currentPlayers = parseInt(tournament.current_players, 10) || 0;
        const maxPlayers = parseInt(tournament.max_players, 10) || 100;

        if (currentPlayers >= maxPlayers) {
            return res.status(400).json({ error: 'Tournament is full' });
        }

        // Check user balance
        const user = await db.get(
            'SELECT balance FROM users WHERE id = ?',
            [userId]
        );

        const entryFee = parseFloat(tournament.entry_fee) || 0;

        if (!user || user.balance === null) {
            return res.status(400).json({ error: 'Unable to verify balance' });
        }

        const userBalance = parseFloat(user.balance) || 0;
        if (userBalance < entryFee) {
            return res.status(400).json({ error: 'Insufficient balance. Entry fee: $' + entryFee.toFixed(2) });
        }

        // ROUND 29: Atomic balance deduction with WHERE guard — prevents going negative
        // and ensures fee is only taken if balance is sufficient. Previously deducted
        // without checking, and entry creation wasn't atomic with fee deduction.
        var deductResult = await db.run(
            'UPDATE users SET balance = balance - ? WHERE id = ? AND balance >= ?',
            [entryFee, userId, entryFee]
        );
        if (!deductResult || deductResult.changes === 0) {
            return res.status(400).json({ error: 'Insufficient balance for entry fee' });
        }

        // Create tournament entry — if this fails, refund
        try {
            await db.run(
                'INSERT INTO premium_tournament_entries (tournament_id, user_id, score, spins, best_win) VALUES (?, ?, 0, 0, 0)',
                [tournamentId, userId]
            );
        } catch (entryErr) {
            // Refund entry fee on failure
            await db.run('UPDATE users SET balance = balance + ? WHERE id = ?', [entryFee, userId]);
            console.warn('[premium-tournament] Entry insert failed, refunded:', entryErr.message);
            return res.status(500).json({ error: 'Failed to create tournament entry' });
        }

        // Record transaction
        await db.run(
            'INSERT INTO transactions (user_id, type, amount, balance_before, balance_after, reference) VALUES (?, ?, ?, COALESCE((SELECT balance FROM users WHERE id = ?), 0), COALESCE((SELECT balance FROM users WHERE id = ?), 0), ?)',
            [userId, 'tournament_entry', -entryFee, userId, userId, 'Premium Tournament Entry: ' + tournament.name]
        );

        // Increment current_players
        await db.run(
            'UPDATE premium_tournaments SET current_players = current_players + 1 WHERE id = ?',
            [tournamentId]
        );

        // Fetch updated user balance
        const updated = await db.get(
            'SELECT balance FROM users WHERE id = ?',
            [userId]
        );

        const newBalance = updated ? parseFloat(updated.balance) || 0 : 0;

        return res.json({
            joined: true,
            tournamentId: tournamentId,
            tournamentName: tournament.name,
            entryFee: entryFee,
            newBalance: newBalance,
            message: 'Successfully joined tournament'
        });
    } catch (err) {
        console.warn('[premium-tournament] POST /:id/join error:', err.message);
        return res.status(500).json({ error: 'Failed to join tournament' });
    }
});

// POST /api/premium-tournament/:id/score
// Record a spin score during tournament (authenticate required)
router.post('/:id/score', authenticate, async function(req, res) {
    try {
        const tournamentId = parseInt(req.params.id, 10);
        const userId = req.user.id;
        const { scoreIncrement, spinCount, bestWin } = req.body;

        if (typeof scoreIncrement !== 'number' || scoreIncrement < 0) {
            return res.status(400).json({ error: 'scoreIncrement must be a non-negative number' });
        }

        // Check user has joined tournament
        const entry = await db.get(
            'SELECT id, score, spins, best_win FROM premium_tournament_entries WHERE tournament_id = ? AND user_id = ?',
            [tournamentId, userId]
        );

        if (!entry) {
            return res.status(403).json({ error: 'You have not joined this tournament' });
        }

        // ROUND 29: Server-side score validation — cap scoreIncrement to prevent
        // manipulation. Client-submitted scores must not exceed realistic maximums.
        // Max win per spin is capped by house-edge (500x bet, and max bet is $100),
        // so max legitimate scoreIncrement is $50,000. We cap conservatively at $10,000.
        var MAX_SCORE_INCREMENT = 10000;
        var MAX_BEST_WIN = 10000;
        var safeIncrement = Number.isFinite(scoreIncrement) ? Math.min(scoreIncrement, MAX_SCORE_INCREMENT) : 0;
        var safeBestWin = Number.isFinite(bestWin) ? Math.min(bestWin, MAX_BEST_WIN) : 0;

        // Verify this score corresponds to a recent spin by this user
        // (lightweight check — ensures at least one spin happened in the last 30 seconds)
        var recentSpin = await db.get(
            "SELECT id FROM spins WHERE user_id = ? AND created_at > datetime('now', '-30 seconds') ORDER BY id DESC LIMIT 1",
            [userId]
        );
        if (!recentSpin) {
            return res.status(400).json({ error: 'No recent spin found. Score rejected.' });
        }

        await db.run(
            'UPDATE premium_tournament_entries SET score = score + ?, spins = spins + 1, best_win = MAX(best_win, ?) WHERE tournament_id = ? AND user_id = ?',
            [safeIncrement, safeBestWin, tournamentId, userId]
        );

        // Re-read updated entry for response
        var updatedEntry = await db.get(
            'SELECT score, spins, best_win FROM premium_tournament_entries WHERE tournament_id = ? AND user_id = ?',
            [tournamentId, userId]
        );
        var newScore = updatedEntry ? updatedEntry.score : safeIncrement;
        var newSpins = updatedEntry ? updatedEntry.spins : 1;
        var newBestWin = updatedEntry ? updatedEntry.best_win : safeBestWin;

        // Get rank
        const rankRow = await db.get(
            'SELECT COUNT(*) as cnt FROM premium_tournament_entries WHERE tournament_id = ? AND score > ?',
            [tournamentId, newScore]
        );

        const rank = (rankRow ? parseInt(rankRow.cnt, 10) : 0) + 1;

        return res.json({
            score: newScore,
            spins: newSpins,
            bestWin: newBestWin,
            rank: rank
        });
    } catch (err) {
        console.warn('[premium-tournament] POST /:id/score error:', err.message);
        return res.status(500).json({ error: 'Failed to record score' });
    }
});

// GET /api/premium-tournament/:id/leaderboard
// Tournament leaderboard (public, top 50)
router.get('/:id/leaderboard', async function(req, res) {
    try {
        const tournamentId = parseInt(req.params.id, 10);

        const rows = await db.all(
            'SELECT pte.score, pte.spins, pte.best_win, COALESCE(u.display_name, u.username) as username ' +
            'FROM premium_tournament_entries pte ' +
            'JOIN users u ON u.id = pte.user_id ' +
            'WHERE pte.tournament_id = ? ' +
            'ORDER BY pte.score DESC ' +
            'LIMIT 50',
            [tournamentId]
        );

        if (!rows || rows.length === 0) {
            return res.json({ leaderboard: [] });
        }

        const leaderboard = rows.map(function(row, idx) {
            return {
                rank: idx + 1,
                username: row.username,
                score: parseFloat(row.score) || 0,
                spins: parseInt(row.spins, 10) || 0,
                bestWin: parseFloat(row.best_win) || 0
            };
        });

        return res.json({ leaderboard: leaderboard });
    } catch (err) {
        console.warn('[premium-tournament] GET /:id/leaderboard error:', err.message);
        return res.status(500).json({ error: 'Failed to load leaderboard' });
    }
});

// GET /api/premium-tournament/my-tournaments
// User's tournament history (authenticate required)
router.get('/my-tournaments', authenticate, async function(req, res) {
    try {
        const userId = req.user.id;

        const rows = await db.all(
            'SELECT pt.id, pt.name, pt.entry_fee, pt.prize_pool, pt.status, pt.starts_at, pt.ends_at, ' +
            '       pte.score, pte.spins, pte.best_win, pte.joined_at, ' +
            '       (SELECT COUNT(*) FROM premium_tournament_entries WHERE tournament_id = pt.id AND score > pte.score) + 1 as placement ' +
            'FROM premium_tournament_entries pte ' +
            'JOIN premium_tournaments pt ON pt.id = pte.tournament_id ' +
            'WHERE pte.user_id = ? ' +
            'ORDER BY pt.ends_at DESC',
            [userId]
        );

        if (!rows || rows.length === 0) {
            return res.json({ tournaments: [] });
        }

        const tournaments = rows.map(function(row) {
            return {
                id: row.id,
                name: row.name,
                entryFee: parseFloat(row.entry_fee) || 0,
                prizePool: parseFloat(row.prize_pool) || 0,
                status: row.status,
                startsAt: row.starts_at,
                endsAt: row.ends_at,
                joinedAt: row.joined_at,
                score: parseFloat(row.score) || 0,
                spins: parseInt(row.spins, 10) || 0,
                bestWin: parseFloat(row.best_win) || 0,
                placement: parseInt(row.placement, 10) || 0,
                winnings: calculateWinnings(parseInt(row.placement, 10), parseFloat(row.prize_pool) || 0)
            };
        });

        return res.json({ tournaments: tournaments });
    } catch (err) {
        console.warn('[premium-tournament] GET /my-tournaments error:', err.message);
        return res.status(500).json({ error: 'Failed to load tournament history' });
    }
});

// POST /api/premium-tournament/admin/create
// Create a new tournament (admin required)
router.post('/admin/create', authenticate, requireAdmin, async function(req, res) {
    try {
        const { name, entryFee, prizePool, maxPlayers, startsAt, endsAt } = req.body;

        if (!name || !entryFee || !prizePool || !maxPlayers || !startsAt || !endsAt) {
            return res.status(400).json({ error: 'Missing required fields: name, entryFee, prizePool, maxPlayers, startsAt, endsAt' });
        }

        const fee = parseFloat(entryFee) || 0;
        const pool = parseFloat(prizePool) || 0;
        const max = parseInt(maxPlayers, 10) || 100;

        if (fee < 0 || pool < 0 || max <= 0) {
            return res.status(400).json({ error: 'Invalid values: fees/pool must be >= 0, maxPlayers must be > 0' });
        }

        const startDate = new Date(startsAt);
        const endDate = new Date(endsAt);

        if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
            return res.status(400).json({ error: 'Invalid date format for startsAt or endsAt' });
        }

        if (endDate <= startDate) {
            return res.status(400).json({ error: 'endsAt must be after startsAt' });
        }

        const result = await db.run(
            'INSERT INTO premium_tournaments (name, entry_fee, prize_pool, max_players, status, starts_at, ends_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
            [name, fee, pool, max, 'active', startDate.toISOString().slice(0, 19).replace('T', ' '), endDate.toISOString().slice(0, 19).replace('T', ' ')]
        );

        return res.json({
            created: true,
            tournamentId: result.id,
            name: name,
            entryFee: fee,
            prizePool: pool,
            maxPlayers: max,
            startsAt: startDate.toISOString(),
            endsAt: endDate.toISOString()
        });
    } catch (err) {
        console.warn('[premium-tournament] POST /admin/create error:', err.message);
        return res.status(500).json({ error: 'Failed to create tournament' });
    }
});

// POST /api/premium-tournament/admin/finalize/:id
// End tournament and pay out prizes (admin required)
router.post('/admin/finalize/:id', authenticate, requireAdmin, async function(req, res) {
    try {
        const tournamentId = parseInt(req.params.id, 10);

        // Get tournament details
        const tournament = await db.get(
            'SELECT id, name, prize_pool, status FROM premium_tournaments WHERE id = ?',
            [tournamentId]
        );

        if (!tournament) {
            return res.status(404).json({ error: 'Tournament not found' });
        }

        if (tournament.status === 'completed') {
            return res.status(400).json({ error: 'Tournament already finalized' });
        }

        // Get top 5 finishers
        const topFinishers = await db.all(
            'SELECT user_id, score FROM premium_tournament_entries WHERE tournament_id = ? ORDER BY score DESC LIMIT 5',
            [tournamentId]
        );

        // ROUND 41: Wrap ENTIRE finalization in transaction — status + all payouts are atomic.
        // Previously: status was set to 'completed' BEFORE prize loop. If prize distribution
        // errored mid-loop, tournament was stuck in 'completed' with partial payouts and
        // no way to re-finalize. Now: everything succeeds or everything rolls back.
        const prizePool = parseFloat(tournament.prize_pool) || 0;
        const prizeDistribution = [
            { position: 1, percent: 0.50 },
            { position: 2, percent: 0.25 },
            { position: 3, percent: 0.15 },
            { position: 4, percent: 0.05 },
            { position: 5, percent: 0.05 }
        ];

        await db.beginTransaction();
        try {
            // Atomic status change with WHERE guard (prevents double-finalize race)
            var statusResult = await db.run(
                "UPDATE premium_tournaments SET status = 'completed' WHERE id = ? AND status != 'completed'",
                [tournamentId]
            );
            if (!statusResult || statusResult.changes === 0) {
                await db.rollback();
                return res.status(400).json({ error: 'Tournament already finalized (race condition prevented)' });
            }

            const payouts = [];

            if (topFinishers && topFinishers.length > 0) {
                // ROUND 41: Cap individual prize at $10,000 to prevent pool manipulation
                var MAX_PRIZE = 10000;

                for (let i = 0; i < topFinishers.length && i < 5; i++) {
                    const finisher = topFinishers[i];
                    const distribution = prizeDistribution[i];
                    var winnings = Math.round(prizePool * distribution.percent * 100) / 100;
                    winnings = Math.min(winnings, MAX_PRIZE);

                    // Credit winner's bonus_balance with 15x wagering requirement
                    await db.run(
                        'UPDATE users SET bonus_balance = COALESCE(bonus_balance, 0) + ?, wagering_requirement = COALESCE(wagering_requirement, 0) + ? WHERE id = ?',
                        [winnings, winnings * 15, finisher.user_id]
                    );

                    // Record transaction
                    var ordinalSuffix = ['st', 'nd', 'rd', 'th', 'th'][i] || 'th';
                    await db.run(
                        'INSERT INTO transactions (user_id, type, amount, balance_before, balance_after, reference) VALUES (?, ?, ?, COALESCE((SELECT balance FROM users WHERE id = ?), 0), COALESCE((SELECT balance FROM users WHERE id = ?), 0), ?)',
                        [finisher.user_id, 'tournament_payout', winnings, finisher.user_id, finisher.user_id, tournament.name + ' Prize — ' + (i + 1) + ordinalSuffix + ' place: $' + winnings.toFixed(2)]
                    );

                    payouts.push({
                        position: distribution.position,
                        userId: finisher.user_id,
                        winnings: winnings
                    });
                }
            }

            await db.commit();

            return res.json({
                finalized: true,
                tournamentId: tournamentId,
                tournamentName: tournament.name,
                prizePool: prizePool,
                payouts: payouts
            });
        } catch (txErr) {
            try { await db.rollback(); } catch (_rbErr) { console.warn('[PremiumTournament] rollback error:', _rbErr.message); }
            throw txErr;
        }
    } catch (err) {
        console.warn('[premium-tournament] POST /admin/finalize/:id error:', err.message);
        return res.status(500).json({ error: 'Failed to finalize tournament' });
    }
});

/**
 * Calculate winnings based on placement and prize pool
 * Prize distribution: 1st=50%, 2nd=25%, 3rd=15%, 4th-5th=5% each
 */
function calculateWinnings(placement, prizePool) {
    if (!placement || placement > 5) {
        return 0;
    }

    const distribution = [0.50, 0.25, 0.15, 0.05, 0.05];
    const percent = distribution[placement - 1] || 0;
    const winnings = Math.round(prizePool * percent * 100) / 100;

    return winnings;
}

module.exports = router;
