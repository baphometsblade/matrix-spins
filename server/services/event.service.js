'use strict';
const db = require('../database');

const VALID_EVENT_TYPES = ['payout_boost', 'free_spins_boost', 'cashback_boost', 'xp_boost'];

/**
 * Returns all currently active bonus events (now is between start_at and end_at, active=1).
 */
async function getActiveEvents() {
    return db.all(`
        SELECT id, name, description, event_type, multiplier, target_games, start_at, end_at, active FROM bonus_events
        WHERE active = 1
          AND start_at <= datetime('now')
          AND end_at > datetime('now')
        ORDER BY multiplier DESC
    `);
}

/**
 * Returns the best active event that applies to a specific game (or all games).
 * "Best" = highest multiplier among matching events of the given type.
 */
async function getActiveEventForGame(gameId, eventType) {
    const type = eventType || 'payout_boost';
    const events = await db.all(`
        SELECT id, name, description, event_type, multiplier, target_games, start_at, end_at, active FROM bonus_events
        WHERE active = 1
          AND event_type = ?
          AND start_at <= datetime('now')
          AND end_at > datetime('now')
        ORDER BY multiplier DESC
    `, [type]);

    for (const event of events) {
        if (event.target_games === 'all') {
            return event;
        }
        try {
            const targets = JSON.parse(event.target_games);
            if (Array.isArray(targets) && targets.includes(gameId)) {
                return event;
            }
        } catch (_) {
            // Malformed JSON — skip this event
        }
    }
    return null;
}

/**
 * Admin: create a new bonus event.
 */
async function createEvent(data) {
    if (!data.name) {
        throw new Error('Event name is required');
    }
    if (!data.event_type || !VALID_EVENT_TYPES.includes(data.event_type)) {
        throw new Error('Invalid event_type. Must be one of: ' + VALID_EVENT_TYPES.join(', '));
    }
    if (!data.start_at || !data.end_at) {
        throw new Error('start_at and end_at are required');
    }

    const multiplier = parseFloat(data.multiplier) || 2.0;
    const targetGames = data.target_games || 'all';
    const description = data.description || '';

    return db.run(`
        INSERT INTO bonus_events (name, description, event_type, multiplier, target_games, start_at, end_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
    `, [data.name, description, data.event_type, multiplier, targetGames, data.start_at, data.end_at]);
}

/**
 * Admin: list all bonus events (most recent first).
 */
async function getAllEvents() {
    return db.all('SELECT id, name, description, event_type, multiplier, target_games, start_at, end_at, active, created_at FROM bonus_events ORDER BY created_at DESC LIMIT 100');
}

/**
 * Admin: toggle an event's active status.
 */
async function toggleEvent(eventId, active) {
    return db.run('UPDATE bonus_events SET active = ? WHERE id = ?', [active ? 1 : 0, eventId]);
}

module.exports = {
    VALID_EVENT_TYPES,
    getActiveEvents,
    getActiveEventForGame,
    createEvent,
    getAllEvents,
    toggleEvent,
};
