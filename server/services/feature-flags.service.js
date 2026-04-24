'use strict';

/**
 * Operator feature flags.
 *
 * A thin key/JSON-value store for operational toggles — today used for
 * the slot-engine kill switch ('slot.paused'), but the shape is generic
 * so future flags (per-game pauses, rollout toggles, banner text) can
 * live here without another table.
 *
 * Reads are cached in-process for CACHE_TTL_MS so the spin hot path
 * can check the flag without a per-request DB round-trip. setFlag()
 * busts the cache synchronously, so a pause pushed by an operator
 * takes effect on the next spin across the same process. (Multi-
 * instance deployments will converge within CACHE_TTL_MS.)
 */

const db = require('../database');

const CACHE_TTL_MS = 5 * 1000;
const cache = new Map(); // key -> { value, expiresAt }

function invalidate(key) {
    if (key == null) cache.clear();
    else cache.delete(key);
}

async function getFlag(key, defaultValue) {
    const now = Date.now();
    const cached = cache.get(key);
    if (cached && cached.expiresAt > now) return cached.value;
    const row = await db.get('SELECT value_json FROM feature_flags WHERE key = ?', [key]);
    let value = defaultValue;
    if (row && row.value_json) {
        try { value = JSON.parse(row.value_json); }
        catch { value = defaultValue; }
    }
    cache.set(key, { value, expiresAt: now + CACHE_TTL_MS });
    return value;
}

async function setFlag(key, value, admin) {
    const json = JSON.stringify(value);
    const existing = await db.get('SELECT key FROM feature_flags WHERE key = ?', [key]);
    if (existing) {
        await db.run(
            'UPDATE feature_flags SET value_json = ?, updated_at = ' + db.sqlNow() +
            ', updated_by_id = ?, updated_by_username = ? WHERE key = ?',
            [json, (admin && admin.id) || null, (admin && admin.username) || null, key]
        );
    } else {
        await db.run(
            'INSERT INTO feature_flags (key, value_json, updated_by_id, updated_by_username) VALUES (?, ?, ?, ?)',
            [key, json, (admin && admin.id) || null, (admin && admin.username) || null]
        );
    }
    invalidate(key);
    return value;
}

async function listAll() {
    const rows = await db.all(
        'SELECT key, value_json, updated_at, updated_by_id, updated_by_username FROM feature_flags ORDER BY key'
    );
    return rows.map(r => {
        let value = null;
        try { value = JSON.parse(r.value_json); } catch { /* leave null */ }
        return {
            key: r.key,
            value,
            updated_at: r.updated_at,
            updated_by_id: r.updated_by_id,
            updated_by_username: r.updated_by_username,
        };
    });
}

module.exports = { getFlag, setFlag, listAll, invalidate };
