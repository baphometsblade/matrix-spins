'use strict';

const router = require('express').Router();
const { authenticate, requireAdmin } = require('../middleware/auth');
const db = require('../database');

var isPg = !!process.env.DATABASE_URL;
var idDef = isPg ? 'SERIAL PRIMARY KEY' : 'INTEGER PRIMARY KEY AUTOINCREMENT';
var tsDef = isPg ? 'TIMESTAMPTZ DEFAULT NOW()' : "TEXT DEFAULT (datetime('now'))";

// Initialize table
async function bootstrapSlotEventsTable() {
    await db.run(
        `CREATE TABLE IF NOT EXISTS slot_events (
            id ${idDef},
            name TEXT NOT NULL,
            game_id TEXT,
            bonus_type TEXT NOT NULL,
            bonus_value REAL NOT NULL,
            start_at TEXT NOT NULL,
            end_at TEXT NOT NULL,
            is_active INTEGER DEFAULT 1,
            created_at ${tsDef}
        )`
    );
    console.warn('[slot-events] Table initialized');
    await seedSlotEvents();
}

// Table initialization deferred to server startup (see server/index.js)

// Helper: format timestamp as SQLite-compatible string
function formatTs(ts) {
    if (!ts) return new Date().toISOString().slice(0, 19).replace('T', ' ');
    if (typeof ts === 'string') return ts;
    return new Date(ts).toISOString().slice(0, 19).replace('T', ' ');
}

// Helper: add hours to date string
function addHours(isoStr, hours) {
    var d = new Date(isoStr);
    d.setHours(d.getHours() + hours);
    return d.toISOString().slice(0, 19).replace('T', ' ');
}

// Seed default events (called from bootstrapSlotEventsTable after table creation)
async function seedSlotEvents() {
    try {
        // Check if events already exist
        var existing = await db.get('SELECT COUNT(*) as cnt FROM slot_events', []);
        if (existing && existing.cnt > 0) {
            return;
        }

        // Event 1: Double Payout Hour (2hr window, specific game)
        var event1Start = new Date();
        event1Start.setHours(15, 0, 0, 0);
        var event1StartIso = event1Start.toISOString();
        var event1EndIso = addHours(event1StartIso, 2);

        await db.run(
            'INSERT INTO slot_events (name, game_id, bonus_type, bonus_value, start_at, end_at, is_active) VALUES (?, ?, ?, ?, ?, ?, 1)',
            ['Double Payout Hour', 'lucky-cherry', 'multiplier', 2.0, event1StartIso, event1EndIso]
        );

        // Event 2: Free Spin Frenzy (1hr window, all games)
        var event2Start = new Date();
        event2Start.setHours(18, 0, 0, 0);
        var event2StartIso = event2Start.toISOString();
        var event2EndIso = addHours(event2StartIso, 1);

        await db.run(
            'INSERT INTO slot_events (name, game_id, bonus_type, bonus_value, start_at, end_at, is_active) VALUES (?, ?, ?, ?, ?, ?, 1)',
            ['Free Spin Frenzy', null, 'free_spins', 10, event2StartIso, event2EndIso]
        );

        // Event 3: Mystery Jackpot Boost (3hr window, all games)
        var event3Start = new Date();
        event3Start.setHours(20, 0, 0, 0);
        var event3StartIso = event3Start.toISOString();
        var event3EndIso = addHours(event3StartIso, 3);

        await db.run(
            'INSERT INTO slot_events (name, game_id, bonus_type, bonus_value, start_at, end_at, is_active) VALUES (?, ?, ?, ?, ?, ?, 1)',
            ['Mystery Jackpot Boost', null, 'jackpot_multiplier', 3.0, event3StartIso, event3EndIso]
        );

        console.warn('[slot-events] Seeded 3 default events');
    } catch (err) {
        console.warn('[slot-events] Seed failed:', err.message);
    }
}

// GET /api/slot-events — Get active events (public)
router.get('/', async function(req, res) {
    try {
        var now = new Date().toISOString().slice(0, 19).replace('T', ' ');
        var rows = await db.all(
            'SELECT id, name, game_id, bonus_type, bonus_value, start_at, end_at, is_active FROM slot_events WHERE is_active = 1 AND start_at <= datetime(?) AND end_at > datetime(?) ORDER BY start_at ASC',
            [now, now]
        );

        if (!rows) {
            return res.json([]);
        }

        return res.json(rows);
    } catch (err) {
        console.warn('[slot-events] GET / failed:', err.message);
        return res.status(500).json({ error: 'Internal server error' });
    }
});

// POST /api/slot-events/admin/create — Create new event (admin only)
router.post('/admin/create', authenticate, requireAdmin, async function(req, res) {
    try {
        var body = req.body || {};
        var name = body.name;
        var gameId = body.game_id || null;
        var bonusType = body.bonus_type;
        var bonusValue = parseFloat(body.bonus_value);
        var startAt = body.start_at;
        var endAt = body.end_at;

        if (!name || !bonusType || !bonusValue || !startAt || !endAt) {
            return res.status(400).json({ error: 'Missing required fields' });
        }

        var result = await db.run(
            'INSERT INTO slot_events (name, game_id, bonus_type, bonus_value, start_at, end_at, is_active) VALUES (?, ?, ?, ?, ?, ?, 1)',
            [name, gameId, bonusType, bonusValue, startAt, endAt]
        );

        return res.json({
            id: result.lastInsertRowid || result.lastId,
            name: name,
            game_id: gameId,
            bonus_type: bonusType,
            bonus_value: bonusValue,
            start_at: startAt,
            end_at: endAt,
            is_active: 1
        });
    } catch (err) {
        console.warn('[slot-events] POST /admin/create failed:', err.message);
        return res.status(500).json({ error: 'Internal server error' });
    }
});

// GET /api/slot-events/admin/all — Get all events (admin only)
router.get('/admin/all', authenticate, requireAdmin, async function(req, res) {
    try {
        var rows = await db.all(
            'SELECT id, name, game_id, bonus_type, bonus_value, start_at, end_at, is_active, created_at FROM slot_events ORDER BY created_at DESC',
            []
        );

        if (!rows) {
            return res.json([]);
        }

        return res.json(rows);
    } catch (err) {
        console.warn('[slot-events] GET /admin/all failed:', err.message);
        return res.status(500).json({ error: 'Internal server error' });
    }
});

module.exports = router;
module.exports.bootstrapSlotEventsTable = bootstrapSlotEventsTable;
