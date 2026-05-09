'use strict';

/**
 * Slow-query logger — wraps the database facade so any query taking
 * longer than SLOW_QUERY_MS is logged with a stack-trace-trimmed
 * caller hint. Lightweight: stores rolling counts in-memory only.
 */

const logger = require('./logger');

const SLOW_MS = parseInt(process.env.SLOW_QUERY_MS, 10) || 500;
const top = new Map(); // sql -> { count, totalMs, maxMs }

function snippet(sql) {
    return String(sql || '').replace(/\s+/g, ' ').trim().slice(0, 160);
}

function callerHint() {
    const stack = new Error().stack || '';
    const lines = stack.split('\n').slice(3, 8);
    const hit = lines.find((l) => l.includes('routes') || l.includes('services') || l.includes('engine')) || lines[0] || '';
    return hit.trim().slice(0, 200);
}

function record(sql, ms) {
    const key = snippet(sql);
    let row = top.get(key);
    if (!row) { row = { count: 0, totalMs: 0, maxMs: 0 }; top.set(key, row); }
    row.count++;
    row.totalMs += ms;
    if (ms > row.maxMs) row.maxMs = ms;
    if (top.size > 200) {
        // Drop the least-impactful entry to keep the map bounded
        let worstKey = null, worstScore = Infinity;
        for (const [k, v] of top) {
            const score = v.totalMs;
            if (score < worstScore) { worstScore = score; worstKey = k; }
        }
        if (worstKey) top.delete(worstKey);
    }
}

/**
 * Wrap an instance of server/database.js so every run/get/all is timed.
 * Idempotent — calling twice has no effect.
 */
function install(db) {
    if (!db || db.__slowQueryWrapped) return db;
    const methods = ['run', 'get', 'all'];
    for (const m of methods) {
        const orig = db[m];
        if (typeof orig !== 'function') continue;
        db[m] = async function (sql, params) {
            const start = process.hrtime.bigint();
            try {
                const result = await orig.call(db, sql, params);
                const ms = Number(process.hrtime.bigint() - start) / 1e6;
                if (ms >= SLOW_MS) {
                    record(sql, ms);
                    logger.warn(`[slow-query] ${Math.round(ms)}ms ${snippet(sql)}`, {
                        ms: Math.round(ms),
                        method: m,
                        sqlSnippet: snippet(sql),
                        caller: callerHint(),
                    });
                }
                return result;
            } catch (err) {
                const ms = Number(process.hrtime.bigint() - start) / 1e6;
                // Idempotent bootstrap noise: ALTER TABLE ADD COLUMN against an existing
                // column is intentional (each route's "fire-and-forget" migration runs
                // on every boot). Don't log these — they're not real query errors.
                const expected =
                    /duplicate column|already exists|no such column/i.test(err.message || '') &&
                    /^\s*ALTER\s+TABLE/i.test(sql || '');
                if (!expected) {
                    logger.error(`[query-error] ${Math.round(ms)}ms ${snippet(sql)} — ${err.message}`, {
                        ms: Math.round(ms),
                        sqlSnippet: snippet(sql),
                        code: err.code,
                    });
                }
                throw err;
            }
        };
    }
    db.__slowQueryWrapped = true;
    return db;
}

function getTop(limit = 25) {
    const rows = [];
    for (const [sql, v] of top) {
        rows.push({ sql, count: v.count, totalMs: Math.round(v.totalMs), maxMs: Math.round(v.maxMs), avgMs: Math.round(v.totalMs / v.count) });
    }
    rows.sort((a, b) => b.totalMs - a.totalMs);
    return rows.slice(0, limit);
}

module.exports = { install, getTop };
