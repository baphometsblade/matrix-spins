'use strict';

/**
 * Regression guard: no static INSERT omits a NOT-NULL-without-default column, and no
 * multi-creator table has an actionable column conflict (a column some INSERT names that the
 * winning CREATE-TABLE creator lacks). Both classes throw at runtime AFTER side effects
 * (e.g. a bonus credit) and are usually swallowed. Real incidents fixed in this sweep:
 *   - loss_cashback_claims: /claim INSERT used a nonexistent session_losses + omitted NOT-NULL
 *     loss_amount → threw after the bonus credit → 24h re-claim guard defeated (revenue leak).
 *   - battle_pass_progress: two implementations collided on one table; the route's pass_id
 *     INSERTs threw on the winning season-based schema (whole route surface broken).
 *   - bundle/battlepass transactions omitted NOT-NULL balance_before/after; mystery omitted
 *     campaigns.start_at.
 *
 * Pure child-process invocation of scripts/check-insert-completeness.js; no DB, no network.
 */

const path = require('path');
const { execFileSync } = require('child_process');

describe('INSERT completeness + actionable creator-drift', () => {
    test('no INSERT omits a NOT-NULL column and no actionable creator-drift remains', () => {
        const script = path.join(__dirname, '..', '..', 'scripts', 'check-insert-completeness.js');
        let stdout = '';
        let failed = false;
        try {
            stdout = execFileSync(process.execPath, [script], { encoding: 'utf8' });
        } catch (err) {
            failed = true;
            stdout = (err.stdout || '') + (err.stderr || '');
        }
        if (failed) throw new Error('INSERT-completeness check failed:\n' + stdout);
        expect(stdout).toMatch(/no candidates found/);
    });
});
