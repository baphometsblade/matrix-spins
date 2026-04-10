/**
 * Player behavior analytics for revenue optimization
 * Tracks key metrics that drive monetization decisions
 */
const db = require('../database');

let _schemaReady = false;

async function ensureSchema() {
    if (_schemaReady) return;
    const _isPg = db.isPg();
    const _id = _isPg ? 'SERIAL PRIMARY KEY' : 'INTEGER PRIMARY KEY AUTOINCREMENT';
    await db.run(
        'CREATE TABLE IF NOT EXISTS player_analytics (' +
        '  id ' + _id + ',' +
        '  user_id INTEGER NOT NULL,' +
        '  event_type TEXT NOT NULL,' +
        '  event_data TEXT,' +
        "  created_at TEXT DEFAULT (datetime('now'))," +
        '  session_id TEXT' +
        ')'
    );
    try { await db.run('CREATE INDEX IF NOT EXISTS idx_pa_user ON player_analytics(user_id)'); } catch(_) {}
    try { await db.run('CREATE INDEX IF NOT EXISTS idx_pa_type ON player_analytics(event_type)'); } catch(_) {}
    _schemaReady = true;
}

async function track(userId, eventType, eventData = {}) {
    await ensureSchema();
    await db.run(
        'INSERT INTO player_analytics (user_id, event_type, event_data) VALUES (?, ?, ?)',
        [userId, eventType, JSON.stringify(eventData)]
    );
}

async function getPlayerMetrics(userId, days = 30) {
    await ensureSchema();
    return db.all(
        "SELECT event_type, COUNT(*) as count, MAX(created_at) as last_at FROM player_analytics WHERE user_id = ? AND created_at > datetime('now', '-' || ? || ' days') GROUP BY event_type",
        [userId, days]
    );
}

module.exports = { track, getPlayerMetrics, ensureSchema };