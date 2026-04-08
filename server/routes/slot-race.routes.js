'use strict';

const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth');
const db = require('../database');

// ─────────────────────────────────────────────────────────────────────────────
// SLOT RACE LAZY INITIALIZATION
// ─────────────────────────────────────────────────────────────────────────────

var _initialized = false;

async function _ensureSlotRaceTables() {
    if (_initialized) return;
    _initialized = true;

    const isPg = !!process.env.DATABASE_URL;
    const idDef = isPg ? 'SERIAL PRIMARY KEY' : 'INTEGER PRIMARY KEY AUTOINCREMENT';
    const tsDefault = isPg ? 'CURRENT_TIMESTAMP' : "(datetime('now'))";
    const dateFunc = isPg ? "CURRENT_DATE::text" : "date('now')";

    try {
        // slot_races: recurring races
        await db.run(`
            CREATE TABLE IF NOT EXISTS slot_races (
                id ${idDef},
                name TEXT NOT NULL,
                duration_minutes INTEGER DEFAULT 5,
                entry_fee INTEGER DEFAULT 0,
                prize_pool INTEGER DEFAULT 0,
                max_players INTEGER DEFAULT 50,
                status TEXT DEFAULT 'waiting',
                started_at TEXT,
                ends_at TEXT,
                created_at TEXT DEFAULT ${tsDefault}
            )
        `);

        // slot_race_entries: per-player stats in each race
        await db.run(`
            CREATE TABLE IF NOT EXISTS slot_race_entries (
                id ${idDef},
                race_id INTEGER NOT NULL,
                user_id INTEGER NOT NULL,
                spins_count INTEGER DEFAULT 0,
                total_wagered INTEGER DEFAULT 0,
                total_won INTEGER DEFAULT 0,
                score INTEGER DEFAULT 0,
                joined_at TEXT DEFAULT ${tsDefault},
                UNIQUE(race_id, user_id)
            )
        `);

        // slot_race_results: completed race results & prizes
        await db.run(`
            CREATE TABLE IF NOT EXISTS slot_race_results (
                id ${idDef},
                race_id INTEGER NOT NULL,
                user_id INTEGER NOT NULL,
                placement INTEGER,
                score INTEGER,
                prize_gems INTEGER DEFAULT 0,
                prize_credits INTEGER DEFAULT 0,
                claimed_at TEXT,
                created_at TEXT DEFAULT ${tsDefault}
            )
        `);

        console.warn('[SlotRace] Tables initialized');
    } catch (e) {
        console.warn('[SlotRace] _ensureSlotRaceTables error:', e.message);
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// SLOT RACE CONFIGURATION
// ─────────────────────────────────────────────────────────────────────────────

const RACE_CONFIGS = [
    {
        type: 'Sprint',
        duration_minutes: 3,
        entry_fee: 0,
        prize_pool: 500,  // gems
        score_metric: 'spins_count',
        description: 'Fast 3-minute sprint. Free entry. Spin the most to win!'
    },
    {
        type: 'High Stakes',
        duration_minutes: 5,
        entry_fee: 100,   // gems
        prize_pool: 2000, // gems
        score_metric: 'total_wagered',
        description: '5-minute wagering battle. Entry fee: 100 gems. Highest wagers win!'
    },
    {
        type: 'Lucky Strike',
        duration_minutes: 5,
        entry_fee: 50,    // gems
        prize_pool: 1500, // gems
        score_metric: 'lucky_strike',
        description: '5-minute luck challenge. Entry fee: 50 gems. Biggest single win takes it!'
    }
];

const PRIZE_DISTRIBUTION = [
    { place: 1, pct: 50 },
    { place: 2, pct: 25 },
    { place: 3, pct: 15 },
    { place: 4, pct: 5 },
    { place: 5, pct: 5 }
];

// ─────────────────────────────────────────────────────────────────────────────
// CORE LOGIC: Race Lifecycle
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Get or create the current active race.
 * Races auto-cycle: new race every 15 minutes rotating through RACE_CONFIGS.
 */
async function _ensureCurrentRace() {
    await _ensureSlotRaceTables();

    const active = await db.get(
        "SELECT id, name, duration_minutes, entry_fee, prize_pool, status, started_at, ends_at FROM slot_races WHERE status = 'active' LIMIT 1"
    );

    if (active && new Date(active.ends_at) > new Date()) {
        return active;
    }

    // No active race or expired — create new one
    // Rotate through configs based on time
    const raceIndex = Math.floor(Date.now() / 1000 / 60 / 15) % RACE_CONFIGS.length;
    const config = RACE_CONFIGS[raceIndex];

    const isPg = !!process.env.DATABASE_URL;
    const now = new Date();
    const startsAt = now.toISOString();
    const endsAt = new Date(now.getTime() + config.duration_minutes * 60000).toISOString();

    try {
        await db.run(`
            INSERT INTO slot_races (name, duration_minutes, entry_fee, prize_pool, status, started_at, ends_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        `, [config.type, config.duration_minutes, config.entry_fee, config.prize_pool, 'active', startsAt, endsAt]);

        const newRace = await db.get(
            "SELECT id, name, duration_minutes, entry_fee, prize_pool, status, started_at, ends_at FROM slot_races WHERE status = 'active' ORDER BY id DESC LIMIT 1"
        );
        return newRace;
    } catch (e) {
        console.warn('[SlotRace] _ensureCurrentRace error:', e.message);
        // Return the existing active race even if creation failed
        return active;
    }
}

/**
 * Get current race with leaderboard.
 */
async function _getCurrentRaceWithLeaderboard() {
    const race = await _ensureCurrentRace();
    if (!race) return null;

    // Get leaderboard (top 10)
    const leaderboard = await db.all(`
        SELECT e.user_id, u.username, u.display_name,
               e.spins_count, e.total_wagered, e.total_won, e.score
        FROM slot_race_entries e
        JOIN users u ON e.user_id = u.id
        WHERE e.race_id = ?
        ORDER BY e.score DESC
        LIMIT 10
    `, [race.id]);

    const leaderboardWithRank = leaderboard.map((row, idx) => ({
        rank: idx + 1,
        user_id: row.user_id,
        username: row.username,
        display_name: row.display_name || row.username,
        spins_count: row.spins_count,
        total_wagered: row.total_wagered,
        total_won: row.total_won,
        score: row.score
    }));

    return {
        race: {
            id: race.id,
            name: race.name,
            duration_minutes: race.duration_minutes,
            entry_fee: race.entry_fee,
            prize_pool: race.prize_pool,
            status: race.status,
            started_at: race.started_at,
            ends_at: race.ends_at
        },
        leaderboard: leaderboardWithRank,
        config: RACE_CONFIGS.find(c => c.type === race.name)
    };
}

/**
 * Record a spin for the current race (updates score).
 */
async function _recordSpin(userId, spinData) {
    await _ensureSlotRaceTables();

    const race = await _ensureCurrentRace();
    if (!race || race.status !== 'active') return null;

    const betAmount = spinData.betAmount || 0;
    const winAmount = spinData.winAmount || 0;

    try {
        // Upsert entry
        const entry = await db.get(
            "SELECT id, score FROM slot_race_entries WHERE race_id = ? AND user_id = ?",
            [race.id, userId]
        );

        if (!entry) {
            // New participant
            await db.run(`
                INSERT INTO slot_race_entries (race_id, user_id, spins_count, total_wagered, total_won, score)
                VALUES (?, ?, 1, ?, ?, ?)
            `, [race.id, userId, betAmount, winAmount, 1]); // score = spins_count by default
        } else {
            // Update existing
            const config = RACE_CONFIGS.find(c => c.type === race.name);
            let newScore = entry.score;

            if (config.score_metric === 'spins_count') {
                newScore = entry.score + 1;
            } else if (config.score_metric === 'total_wagered') {
                newScore = entry.score + betAmount;
            } else if (config.score_metric === 'lucky_strike') {
                // Score = biggest single win (max of current score and new win)
                newScore = Math.max(entry.score, winAmount);
            }

            await db.run(`
                UPDATE slot_race_entries
                SET spins_count = spins_count + 1,
                    total_wagered = total_wagered + ?,
                    total_won = total_won + ?,
                    score = ?
                WHERE race_id = ? AND user_id = ?
            `, [betAmount, winAmount, newScore, race.id, userId]);
        }

        return race;
    } catch (e) {
        console.warn('[SlotRace] _recordSpin error:', e.message);
        return null;
    }
}

/**
 * Award prizes for completed race. Called when race expires.
 */
async function _completeRace(raceId) {
    try {
        // Get final leaderboard
        const topEntries = await db.all(`
            SELECT user_id, score FROM slot_race_entries
            WHERE race_id = ?
            ORDER BY score DESC
            LIMIT 5
        `, [raceId]);

        const race = await db.get(
            "SELECT prize_pool FROM slot_races WHERE id = ?",
            [raceId]
        );

        if (!race || !topEntries.length) return;

        const prizePool = race.prize_pool;

        // ── Wrap entire prize distribution in transaction ──
        // Ensures results records and gem awards are atomic — no partial payouts
        await db.beginTransaction();
        try {
            for (let i = 0; i < topEntries.length && i < PRIZE_DISTRIBUTION.length; i++) {
                const entry = topEntries[i];
                const dist = PRIZE_DISTRIBUTION[i];
                const prizeAmount = Math.floor((prizePool * dist.pct) / 100);

                await db.run(`
                    INSERT INTO slot_race_results (race_id, user_id, placement, score, prize_gems)
                    VALUES (?, ?, ?, ?, ?)
                `, [raceId, entry.user_id, i + 1, entry.score, prizeAmount]);

                // Add gems atomically via SQL (gems.service may not exist)
                if (prizeAmount > 0) {
                    await db.run(
                        'UPDATE users SET gems = COALESCE(gems, 0) + ? WHERE id = ?',
                        [prizeAmount, entry.user_id]
                    );
                }
            }

            // Mark race as completed inside same transaction
            await db.run(
                "UPDATE slot_races SET status = 'completed' WHERE id = ?",
                [raceId]
            );

            await db.commit();
        } catch (txErr) {
            try { await db.rollback(); } catch (rbErr) { console.warn('[SlotRace] Rollback failed:', rbErr.message || rbErr); }
            console.warn('[SlotRace] Prize distribution rollback for race', raceId, ':', txErr.message);
        }
    } catch (e) {
        console.warn('[SlotRace] _completeRace error:', e.message);
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// ROUTES
// ─────────────────────────────────────────────────────────────────────────────

/**
 * GET /api/slot-race/current
 * Get current active race + leaderboard + user's status
 */
router.get('/current', async (req, res) => {
    try {
        const raceData = await _getCurrentRaceWithLeaderboard();
        if (!raceData) {
            return res.status(500).json({ error: 'Failed to load race' });
        }

        // Check if user is joined (if authenticated)
        let userEntry = null;
        if (req.user) {
            userEntry = await db.get(
                "SELECT spins_count, total_wagered, total_won, score FROM slot_race_entries WHERE race_id = ? AND user_id = ?",
                [raceData.race.id, req.user.id]
            );
        }

        res.json({
            race: raceData.race,
            config: raceData.config,
            leaderboard: raceData.leaderboard,
            userEntry: userEntry || null
        });
    } catch (e) {
        console.warn('[SlotRace] GET /current error:', e.message);
        res.status(500).json({ error: 'Failed to load race' });
    }
});

/**
 * POST /api/slot-race/join
 * Join current race (deducts entry fee if applicable)
 */
router.post('/join', authenticate, async (req, res) => {
    try {
        // SECURITY: Check self-exclusion before allowing slot race entry
        const selfExcl = await db.get(
            "SELECT id FROM self_exclusions WHERE user_id = ? AND is_active = 1 AND (ends_at IS NULL OR ends_at > datetime('now'))",
            [req.user.id]
        );
        if (selfExcl) return res.status(403).json({ error: 'Your account is currently self-excluded from playing.' });

        const race = await _ensureCurrentRace();
        if (!race || race.status !== 'active') {
            return res.status(400).json({ error: 'No active race' });
        }

        // Check if already joined
        const existing = await db.get(
            "SELECT id FROM slot_race_entries WHERE race_id = ? AND user_id = ?",
            [race.id, req.user.id]
        );

        if (existing) {
            return res.json({ joined: true, race_id: race.id });
        }

        // Check max players
        const count = await db.get(
            "SELECT COUNT(*) as cnt FROM slot_race_entries WHERE race_id = ?",
            [race.id]
        );

        if (count.cnt >= race.max_players) {
            return res.status(400).json({ error: 'Race is full' });
        }

        // ── Wrap fee deduction + entry creation in transaction ──
        await db.beginTransaction();
        try {
            // Deduct entry fee with atomic balance guard
            if (race.entry_fee > 0) {
                var deductResult = await db.run(
                    "UPDATE users SET balance = balance - ? WHERE id = ? AND balance >= ?",
                    [race.entry_fee, req.user.id, race.entry_fee]
                );
                if (!deductResult || deductResult.changes === 0) {
                    await db.rollback();
                    return res.status(400).json({ error: 'Insufficient balance' });
                }
            }

            // Create entry
            await db.run(`
                INSERT INTO slot_race_entries (race_id, user_id, spins_count, total_wagered, total_won, score)
                VALUES (?, ?, 0, 0, 0, 0)
            `, [race.id, req.user.id]);

            await db.commit();
            res.json({ joined: true, race_id: race.id });
        } catch (txErr) {
            try { await db.rollback(); } catch (rbErr) { console.warn('[SlotRace] Rollback failed:', rbErr.message || rbErr); }
            throw txErr;
        }
    } catch (e) {
        console.warn('[SlotRace] POST /join error:', e.message);
        res.status(500).json({ error: 'Failed to join race' });
    }
});

/**
 * POST /api/slot-race/record-spin
 * Record a spin for the current race
 * Body: { betAmount, winAmount }
 */
router.post('/record-spin', authenticate, async (req, res) => {
    try {
        const { betAmount, winAmount } = req.body;

        if (typeof betAmount !== 'number' || typeof winAmount !== 'number') {
            return res.status(400).json({ error: 'Invalid spin data' });
        }

        const race = await _recordSpin(req.user.id, { betAmount, winAmount });

        if (!race) {
            return res.status(400).json({ error: 'No active race or not joined' });
        }

        res.json({ success: true, race_id: race.id });
    } catch (e) {
        console.warn('[SlotRace] POST /record-spin error:', e.message);
        res.status(500).json({ error: 'Failed to record spin' });
    }
});

/**
 * GET /api/slot-race/results/:id
 * Get final results of a completed race
 */
router.get('/results/:id', async (req, res) => {
    try {
        const raceId = parseInt(req.params.id, 10);
        if (!Number.isFinite(raceId)) return res.status(400).json({ error: 'Invalid race ID' });

        const race = await db.get(
            "SELECT id, name, prize_pool, status FROM slot_races WHERE id = ?",
            [raceId]
        );

        if (!race) {
            return res.status(404).json({ error: 'Race not found' });
        }

        const results = await db.all(`
            SELECT r.user_id, u.username, u.display_name,
                   r.placement, r.score, r.prize_gems
            FROM slot_race_results r
            JOIN users u ON r.user_id = u.id
            WHERE r.race_id = ?
            ORDER BY r.placement ASC
        `, [raceId]);

        res.json({
            race: {
                id: race.id,
                name: race.name,
                prize_pool: race.prize_pool,
                status: race.status
            },
            results: results.map(row => ({
                user_id: row.user_id,
                username: row.username,
                display_name: row.display_name || row.username,
                placement: row.placement,
                score: row.score,
                prize_gems: row.prize_gems
            }))
        });
    } catch (e) {
        console.warn('[SlotRace] GET /results error:', e.message);
        res.status(500).json({ error: 'Failed to load results' });
    }
});

/**
 * GET /api/slot-race/history
 * Get user's slot race history (last 20)
 */
router.get('/history', authenticate, async (req, res) => {
    try {
        const history = await db.all(`
            SELECT r.id, r.name, r.started_at, r.ends_at,
                   res.placement, res.score, res.prize_gems
            FROM slot_race_results res
            JOIN slot_races r ON res.race_id = r.id
            WHERE res.user_id = ?
            ORDER BY r.id DESC
            LIMIT 20
        `, [req.user.id]);

        res.json({ history });
    } catch (e) {
        console.warn('[SlotRace] GET /history error:', e.message);
        res.status(500).json({ error: 'Failed to load history' });
    }
});

module.exports = router;
