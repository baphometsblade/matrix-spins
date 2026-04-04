/**
 * SQL Dialect Adapter — translates SQLite-dialect SQL to PostgreSQL at runtime.
 *
 * Route files keep writing SQLite-style SQL; this adapter converts it when
 * the active backend is PostgreSQL.  Only called by pg-backend.js.
 */

'use strict';

/**
 * Convert SQLite-dialect SQL to PostgreSQL.
 * Handles:  ?, datetime(), strftime(), julianday(), INSERT OR IGNORE/REPLACE
 *
 * RULE ORDER MATTERS — more specific patterns must run before general ones.
 */
function adaptSQL(sql) {
    let adapted = sql;

    // ── julianday ──────────────────────────────────────────────────────
    // A. julianday('now') → (EXTRACT(EPOCH FROM NOW()) / 86400.0)
    //    Must run before generic julianday(col) to avoid matching 'now' as a column.
    adapted = adapted.replace(
        /julianday\(\s*'now'\s*\)/gi,
        '(EXTRACT(EPOCH FROM NOW()) / 86400.0)'
    );

    // B. julianday(<column>) → (EXTRACT(EPOCH FROM <column>) / 86400.0)
    adapted = adapted.replace(
        /julianday\(\s*([^)]+)\s*\)/gi,
        function (_, expr) {
            return '(EXTRACT(EPOCH FROM ' + expr.trim() + ') / 86400.0)';
        }
    );

    // ── datetime ───────────────────────────────────────────────────────
    // C. datetime('now', 'start of day') → DATE_TRUNC('day', NOW())
    //    Must run before the general datetime('now', '±N unit') pattern.
    adapted = adapted.replace(
        /datetime\(\s*'now'\s*,\s*'start of day'\s*\)/gi,
        "DATE_TRUNC('day', NOW())"
    );

    // D. datetime('now', '±N <unit>') → NOW() ± INTERVAL 'N <unit>'
    //    Must run BEFORE the plain datetime('now') replacement.
    adapted = adapted.replace(
        /datetime\(\s*'now'\s*,\s*'([+-]?\s*\d+\s+\w+)'\s*\)/gi,
        function (_, interval) {
            var isAdd = /^\+/.test(interval.trim());
            var clean = interval.replace(/^[+-]\s*/, '');
            var op = isAdd ? '+' : '-';
            return "NOW() " + op + " INTERVAL '" + clean + "'";
        }
    );

    // E. datetime('now', ?) → NOW() + CAST(? AS INTERVAL)
    //    Parameterised interval (e.g. boost durations like '+30 minutes').
    //    The ? placeholder is later converted to $N by the param step.
    adapted = adapted.replace(
        /datetime\(\s*'now'\s*,\s*\?\s*\)/gi,
        'NOW() + CAST(? AS INTERVAL)'
    );

    // F. datetime('now') → NOW()
    adapted = adapted.replace(/datetime\(\s*'now'\s*\)/gi, 'NOW()');

    // G. datetime(<column>, '±N <unit>') → <column> ± INTERVAL 'N <unit>'
    //    Column-based date arithmetic (e.g. datetime(u.created_at, '+7 days')).
    //    Handles dotted names like u.created_at.
    adapted = adapted.replace(
        /datetime\(\s*([a-z_]\w*(?:\.[a-z_]\w*)*)\s*,\s*'([+-]?\s*\d+\s+\w+)'\s*\)/gi,
        function (_, col, interval) {
            var isAdd = !/^-/.test(interval.trim());
            var clean = interval.replace(/^[+-]\s*/, '');
            var op = isAdd ? '+' : '-';
            return col + " " + op + " INTERVAL '" + clean + "'";
        }
    );

    // ── strftime ───────────────────────────────────────────────────────
    // Most-specific formats first, then broader formats.

    // H. strftime('%Y-%m-%d %H:00', <col>) → TO_CHAR(<col>, 'YYYY-MM-DD HH24:00')
    adapted = adapted.replace(
        /strftime\(\s*'%Y-%m-%d %H:00'\s*,\s*([^)]+)\)/gi,
        function (_, col) {
            return "TO_CHAR(" + col.trim() + ", 'YYYY-MM-DD HH24:00')";
        }
    );

    // I. strftime('%Y-W%W', <col>) → TO_CHAR(<col>, 'IYYY-"W"IW')
    //    ISO year + ISO week number for cohort analysis.
    adapted = adapted.replace(
        /strftime\(\s*'%Y-W%W'\s*,\s*([^)]+)\)/gi,
        function (_, col) {
            return "TO_CHAR(" + col.trim() + ", 'IYYY-\"W\"IW')";
        }
    );

    // J. strftime('%Y-%m-%d', <col>) → TO_CHAR(<col>, 'YYYY-MM-DD')
    //    Date-only formatting.
    adapted = adapted.replace(
        /strftime\(\s*'%Y-%m-%d'\s*,\s*([^)]+)\)/gi,
        function (_, col) {
            return "TO_CHAR(" + col.trim() + ", 'YYYY-MM-DD')";
        }
    );

    // ── INSERT OR IGNORE ───────────────────────────────────────────────
    // K. INSERT OR IGNORE → INSERT … ON CONFLICT DO NOTHING
    if (/INSERT\s+OR\s+IGNORE/i.test(adapted)) {
        adapted = adapted.replace(/INSERT\s+OR\s+IGNORE/i, 'INSERT');
        if (!/ON\s+CONFLICT/i.test(adapted)) {
            adapted = adapted.replace(/(\)\s*;?\s*)$/, ') ON CONFLICT DO NOTHING');
        }
    }

    // ── Positional params ──────────────────────────────────────────────
    // L. ? → $1, $2, $3 …  (must be LAST — all other rules may still use ?)
    var paramIndex = 0;
    adapted = adapted.replace(/\?/g, function () {
        paramIndex += 1;
        return '$' + paramIndex;
    });

    return adapted;
}

module.exports = { adaptSQL };
