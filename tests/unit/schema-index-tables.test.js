'use strict';

/**
 * Schema-lock regression test: every table referenced by a NON-deferred INDEX
 * must be defined in that schema's TABLES array.
 *
 * Background (2026-05-30 outage): schema-pg.js INDEXES contained
 *   CREATE INDEX ... ON self_exclusions(user_id, is_active)
 * but `self_exclusions` was created lazily by selfexclusion.routes.js and was
 * NOT in schema-pg.js TABLES. On a fresh PostgreSQL database the route bootstrap
 * has not run when PgBackend.init() builds indexes, so the CREATE INDEX threw
 *   relation "self_exclusions" does not exist
 * which aborted init(), tripped DEGRADED MODE, and returned 503 on every money
 * operation (deposit / withdraw / balance) AND blocked game-boot (engine needs
 * /api/balance). notifications + audit_log had the same latent defect.
 *
 * The fix added those tables to schema-pg.js TABLES. This test makes sure nobody
 * re-introduces an index on a table that isn't created in the schema.
 *
 * SQLite is exempt for indexes living in its DEFERRED_INDEXES array — those are
 * intentionally created (with try/catch) after route bootstraps; that is the
 * sanctioned escape hatch. The eager INDEXES array gets the same strict check.
 *
 * Pure module-load + regex — no DB, no network.
 */

const path = require('path');

function tableNamesOf(tablesArr) {
    const names = new Set();
    for (const ddl of tablesArr || []) {
        const m = ddl.match(/CREATE TABLE IF NOT EXISTS\s+"?([a-z_0-9]+)"?/i);
        if (m) names.add(m[1].toLowerCase());
    }
    return names;
}

function indexedTablesOf(indexesArr) {
    const refs = [];
    for (const idx of indexesArr || []) {
        const m = idx.match(/\sON\s+"?([a-z_0-9]+)"?\s*\(/i);
        if (m) refs.push({ table: m[1].toLowerCase(), ddl: idx });
    }
    return refs;
}

describe('schema index → table integrity', () => {
    test('schema-pg.js: every INDEX targets a table defined in TABLES', () => {
        const schema = require(path.join(__dirname, '../../server/db/schema-pg.js'));
        const tables = tableNamesOf(schema.TABLES);
        const missing = indexedTablesOf(schema.INDEXES)
            .filter(r => !tables.has(r.table))
            .map(r => `${r.table}  <=  ${r.ddl.trim().slice(0, 80)}`);
        expect(missing).toEqual([]);
    });

    test('schema-sqlite.js: every eager INDEX targets a table defined in TABLES', () => {
        const schema = require(path.join(__dirname, '../../server/db/schema-sqlite.js'));
        const tables = tableNamesOf(schema.TABLES);
        // DEFERRED_INDEXES are exempt by design (created post-bootstrap, try/catch).
        const missing = indexedTablesOf(schema.INDEXES)
            .filter(r => !tables.has(r.table))
            .map(r => `${r.table}  <=  ${r.ddl.trim().slice(0, 80)}`);
        expect(missing).toEqual([]);
    });

    test('the three regression tables are defined in schema-pg.js TABLES', () => {
        const schema = require(path.join(__dirname, '../../server/db/schema-pg.js'));
        const tables = tableNamesOf(schema.TABLES);
        for (const t of ['self_exclusions', 'notifications', 'audit_log']) {
            expect(tables.has(t)).toBe(true);
        }
    });
});
