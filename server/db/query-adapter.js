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

    // F. datetime('now') or datetime("now") → NOW()
    adapted = adapted.replace(/datetime\(\s*['"]now['"]\s*\)/gi, 'NOW()');

    // F2. datetime(?) → (?::TIMESTAMP)
    //     Route code passes ISO date strings as params; PostgreSQL needs
    //     an explicit cast so the comparison uses timestamp semantics.
    adapted = adapted.replace(/datetime\(\s*\?\s*\)/gi, '(?::TIMESTAMP)');

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

    // ── date('now') family ─────────────────────────────────────────────
    // SQLite's date('now') returns TEXT 'YYYY-MM-DD'. Many tables store the
    // day as a TEXT column (daily_challenges.date, challenge_streaks.
    // last_completed_date, rtp_daily_stats.date, …) and compare/insert with
    // date('now'). On PG, date('now') is a cast to the DATE *type*, so
    // `text_col = date('now')` throws "operator does not exist: text = date".
    // We translate to to_char(...,'YYYY-MM-DD') so the result stays TEXT and
    // matches the stored values. (The only real DATE columns — spin_date,
    // subscription_daily_claimed — are never compared against date('now');
    // spin_date is only INSERTed, and PG's text→date assignment cast covers
    // that.)  Lookbehind guards against matching the tail of identifiers.

    // D1. date('now', '-' || ? || ' days') — parameterised concat (rtp-monitor).
    //     Must run before the literal-interval rule.
    adapted = adapted.replace(
        /(?<![a-z_])date\(\s*'now'\s*,\s*'-'\s*\|\|\s*\?\s*\|\|\s*' days'\s*\)/gi,
        "to_char(CURRENT_DATE - ((?) || ' days')::INTERVAL, 'YYYY-MM-DD')"
    );

    // D2. date('now', '±N <unit>') → to_char(CURRENT_DATE ± INTERVAL 'N unit', 'YYYY-MM-DD')
    adapted = adapted.replace(
        /(?<![a-z_])date\(\s*'now'\s*,\s*'([+-]?\s*\d+\s+\w+)'\s*\)/gi,
        function (_, interval) {
            var t = interval.trim();
            var isAdd = /^\+/.test(t);
            var clean = t.replace(/^[+-]\s*/, '');
            var op = isAdd ? '+' : '-';
            return "to_char(CURRENT_DATE " + op + " INTERVAL '" + clean + "', 'YYYY-MM-DD')";
        }
    );

    // D3. date('now') → to_char(CURRENT_DATE, 'YYYY-MM-DD')
    adapted = adapted.replace(
        /(?<![a-z_])date\(\s*'now'\s*\)/gi,
        "to_char(CURRENT_DATE, 'YYYY-MM-DD')"
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

    // K0. strftime('%H', <col>) → TO_CHAR(<col>, 'HH24')
    //     Hour extraction (admin peak-hours analysis).
    adapted = adapted.replace(
        /strftime\(\s*'%H'\s*,\s*([^)]+)\)/gi,
        function (_, col) {
            return "TO_CHAR(" + col.trim() + ", 'HH24')";
        }
    );

    // K1. strftime('%w', <col>) → EXTRACT(DOW FROM <col>)::TEXT
    //     Day-of-week (0 = Sunday). SQLite returns '0'–'6', PG EXTRACT(DOW)
    //     also uses 0 = Sunday, and ::TEXT matches the string type.
    adapted = adapted.replace(
        /strftime\(\s*'%w'\s*,\s*([^)]+)\)/gi,
        function (_, col) {
            return "EXTRACT(DOW FROM " + col.trim() + ")::TEXT";
        }
    );

    // K2. strftime('%Y-%W', <col>) → TO_CHAR(<col>, 'IYYY-IW')
    //     Year-week without "W" prefix (revenue cohort analysis).
    adapted = adapted.replace(
        /strftime\(\s*'%Y-%W'\s*,\s*([^)]+)\)/gi,
        function (_, col) {
            return "TO_CHAR(" + col.trim() + ", 'IYYY-IW')";
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
