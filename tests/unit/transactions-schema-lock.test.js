'use strict';

/**
 * Schema-lock regression test for the `transactions` table.
 *
 * Background: schema-sqlite.js + schema-pg.js define the `transactions` table
 * with columns (user_id, type, amount, balance_before, balance_after, reference).
 * There is **no** `description` column. Any INSERT that targets a
 * `description` column silently 500s the route AFTER a bonus_balance UPDATE
 * has already credited the user — players see an error toast on a claim
 * that actually succeeded, and the audit trail is broken.
 *
 * This test source-greps every file in server/routes/ and server/services/
 * to make sure nobody ever reintroduces the broken pattern.
 *
 * Pure source-grep — no DB, no mocks, no module loading.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const SCAN_DIRS = [
    path.join(ROOT, 'server', 'routes'),
    path.join(ROOT, 'server', 'services'),
];

// Match an `INSERT INTO transactions ( ... description ... )` column list.
// We require `description` to appear inside the parenthesised column list of
// the INSERT, not just anywhere on the line (a JS variable named
// `description` passed as a SQL parameter is fine — only the SQL column
// reference is the broken pattern). The `[^)]*` constraint keeps the match
// confined to the column list of a single INSERT statement.
const BROKEN_PATTERN = /INSERT\s+INTO\s+transactions\s*\([^)]*\bdescription\b[^)]*\)/i;

// Naive single-line comment stripper. The disabled-code multi-line block in
// referralbonus.routes.js (and any future similar blocks) opens with `/*` at
// the start of a comment-only line — we honour that too.
function loadStrippedLines(filePath) {
    const raw = fs.readFileSync(filePath, 'utf8');
    const lines = raw.split(/\r?\n/);
    const out = [];
    let inBlockComment = false;
    for (let i = 0; i < lines.length; i++) {
        let line = lines[i];

        if (inBlockComment) {
            const endIdx = line.indexOf('*/');
            if (endIdx === -1) {
                out.push(''); // entire line is comment
                continue;
            }
            line = line.slice(endIdx + 2);
            inBlockComment = false;
        }

        // Strip /* ... */ blocks that open + close on the same line, repeatedly.
        for (;;) {
            const start = line.indexOf('/*');
            if (start === -1) break;
            const end = line.indexOf('*/', start + 2);
            if (end === -1) {
                line = line.slice(0, start);
                inBlockComment = true;
                break;
            }
            line = line.slice(0, start) + line.slice(end + 2);
        }

        // Strip // line comments (best effort — does not handle // inside strings,
        // but that is acceptable for an SQL-source grep).
        const slashIdx = line.indexOf('//');
        if (slashIdx !== -1) line = line.slice(0, slashIdx);

        out.push(line);
    }
    return out;
}

function walk(dir) {
    if (!fs.existsSync(dir)) return [];
    const out = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) out.push(...walk(full));
        else if (entry.isFile() && entry.name.endsWith('.js')) out.push(full);
    }
    return out;
}

describe('transactions schema lock — no INSERT into non-existent `description` column', () => {
    const violations = [];

    for (const dir of SCAN_DIRS) {
        const files = walk(dir);
        for (const file of files) {
            const lines = loadStrippedLines(file);
            for (let i = 0; i < lines.length; i++) {
                // Multi-line INSERTs: stitch the line with up to 2 lookahead
                // lines so that template literals split across newlines are
                // covered (campaigns.routes.js / dailywheel.routes.js style).
                const stitched = lines.slice(i, i + 3).join(' ');
                if (BROKEN_PATTERN.test(stitched)) {
                    violations.push({
                        file: path.relative(ROOT, file).replace(/\\/g, '/'),
                        line: i + 1,
                        snippet: stitched.trim().slice(0, 200),
                    });
                }
            }
        }
    }

    test('no broken INSERT into transactions(description, ...) exists', () => {
        if (violations.length > 0) {
            const formatted = violations
                .map(v => `  ${v.file}:${v.line}\n    ${v.snippet}`)
                .join('\n');
            throw new Error(
                'Found ' + violations.length + ' broken INSERT(s) into the ' +
                'non-existent `transactions.description` column. The real ' +
                'schema columns are (user_id, type, amount, balance_before, ' +
                'balance_after, reference). See server/routes/admin.routes.js ' +
                'or freespins.routes.js for the canonical fix pattern.\n\n' +
                formatted
            );
        }
        expect(violations).toEqual([]);
    });
});
