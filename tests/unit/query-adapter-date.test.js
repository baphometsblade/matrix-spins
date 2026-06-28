'use strict';

/**
 * Regression lock: the SQLite→PostgreSQL query adapter MUST translate the
 * date('now') family to a TEXT result.
 *
 * Background (live bug): the lobby/daily-challenges endpoint /api/challenges
 * 500'd on production with
 *     NeonDbError: operator does not exist: text = date
 * because challenges.service.js (and 9 other route/service files) compare a
 * TEXT day column against date('now'):
 *     WHERE date = date('now')
 * On SQLite date('now') returns TEXT 'YYYY-MM-DD' (text = text — fine). On
 * PostgreSQL date('now') is a cast to the DATE *type*, so text = date throws.
 * The adapter translated datetime('now') but NOT the bare date('now'), so the
 * whole family slipped through untranslated and blew up only on PG.
 *
 * The fix added date('now') rules that emit to_char(...,'YYYY-MM-DD') (TEXT).
 * This test makes sure nobody removes them or lets a bare date('now') survive.
 *
 * Pure module-load + string assertions — no DB, no network.
 */

const { adaptSQL } = require('../../server/db/query-adapter');

describe('query-adapter — date(\'now\') family → TEXT', () => {
    test('bare date(\'now\') becomes a TEXT to_char, never a DATE-typed value', () => {
        const out = adaptSQL("SELECT id FROM daily_challenges WHERE user_id = ? AND date = date('now')");
        expect(out).toContain("to_char(CURRENT_DATE, 'YYYY-MM-DD')");
        // the offending text = date comparison must be gone
        expect(out).not.toMatch(/=\s*date\('now'\)/i);
    });

    test('no bare date(\'now\') survives translation (the exact thing PG rejects)', () => {
        const samples = [
            "SELECT date('now') AS today",
            "INSERT INTO daily_challenges (date) VALUES (date('now'))",
            "SELECT * FROM t WHERE d = date('now') AND date('now') > x",
        ];
        samples.forEach((s) => {
            const out = adaptSQL(s);
            // No standalone date('now')/date("now") may remain (datetime/DATE(col) are fine)
            expect(out).not.toMatch(/(?<![a-z_])date\(\s*['"]now['"]/i);
        });
    });

    test("date('now', '-N days') → to_char(CURRENT_DATE - INTERVAL ...)", () => {
        expect(adaptSQL("SELECT date('now', '-1 day') AS y"))
            .toContain("to_char(CURRENT_DATE - INTERVAL '1 day', 'YYYY-MM-DD')");
        expect(adaptSQL("WHERE date >= date('now', '-30 days')"))
            .toContain("to_char(CURRENT_DATE - INTERVAL '30 days', 'YYYY-MM-DD')");
    });

    test("parameterised concat date('now', '-' || ? || ' days') is handled and keeps its param", () => {
        const out = adaptSQL("WHERE date >= date('now', '-' || ? || ' days')");
        expect(out).toContain("::INTERVAL");
        expect(out).toContain("to_char(");
        // the single ? must be preserved and become exactly one positional param
        expect((out.match(/\$\d+/g) || []).length).toBe(1);
    });

    test('param ordering is preserved around a translated date() interval', () => {
        const out = adaptSQL(
            "SELECT x FROM rtp_daily_stats WHERE game_id = ? AND date >= date('now', '-' || ? || ' days')"
        );
        expect(out).toContain('game_id = $1');
        expect(out).toContain('($2)');
    });

    test('does NOT touch datetime(\'now\') (still → NOW()) or DATE(<column>) extraction', () => {
        expect(adaptSQL("WHERE created_at < datetime('now', '-7 days')"))
            .toBe("WHERE created_at < NOW() - INTERVAL '7 days'");
        // column extraction date(col) must be left intact (valid PG)
        expect(adaptSQL('SELECT DATE(spun_at) AS d FROM daily_wheel_spins'))
            .toBe('SELECT DATE(spun_at) AS d FROM daily_wheel_spins');
    });

    test('DATE(\'now\') inserted into a real DATE column still emits TEXT (PG assignment-casts it)', () => {
        const out = adaptSQL("INSERT INTO daily_wheel_spins (user_id, spin_date) VALUES (?, DATE('now'))");
        expect(out).toContain("to_char(CURRENT_DATE, 'YYYY-MM-DD')");
        expect(out).toContain('VALUES ($1,');
    });
});
