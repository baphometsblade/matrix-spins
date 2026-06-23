'use strict';

/**
 * Regression guard for the "column declared on one backend only / not at all" bug class.
 *
 * Production runs PostgreSQL (server/db/schema-pg.js); dev/test runs SQLite
 * (server/db/schema-sqlite.js). A column referenced by a static INSERT/UPDATE that is
 * declared on only one backend passes locally but throws `column "X" does not exist`
 * on the production PostgreSQL backend. Three such incidents have shipped:
 *   - audit_log.amount / .reference        (commit 63631c92)
 *   - user_limits.daily_wager_limit        (missing from schema-pg.js)
 *   - rg_admin_audit.admin_user_id/payload (stale sqlite creator)
 *
 * scripts/check-schema-dml-consistency.js statically cross-references every declared
 * column (both schema files + their migration arrays + route/service CREATE TABLE &
 * ALTER ADD COLUMN) against every static INSERT/UPDATE column reference in server/.
 * This test fails the build if it finds any undeclared/drifted column — keeping the
 * two backend schemas and the DML that uses them in lock-step.
 *
 * Pure child-process invocation of the checker; no DB, no network.
 */

const path = require('path');
const { execFileSync } = require('child_process');

describe('schema ⇄ DML column consistency', () => {
    test('no INSERT/UPDATE references an undeclared or backend-drifted column', () => {
        const script = path.join(__dirname, '..', '..', 'scripts', 'check-schema-dml-consistency.js');
        let stdout = '';
        let failed = false;
        try {
            stdout = execFileSync(process.execPath, [script], { encoding: 'utf8' });
        } catch (err) {
            failed = true;
            stdout = (err.stdout || '') + (err.stderr || '');
        }
        // Surface the checker's own report when it fails so the offending columns are visible.
        if (failed) {
            throw new Error('schema⇄DML drift detected:\n' + stdout);
        }
        expect(stdout).toMatch(/no statically-provable column drift/);
    });
});
