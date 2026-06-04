'use strict';

/**
 * Repo-wide preventive scan for bare fs.writeFileSync calls targeting
 * HIGH-IMPACT runtime files. Complements tests/unit/manifest-write-hardening.test.js:
 *
 *   - manifest-write-hardening.test.js locks specific KNOWN-HARDENED writers
 *     to their current shape (catches a regression that removes the lib
 *     import or reintroduces a bare write).
 *
 *   - THIS file walks every scripts/*.js and FAILS if any of them contains
 *     a bare fs.writeFileSync targeting one of the deny-list paths or
 *     identifier names — even files we haven't audited yet.
 *
 * Why both: the existing test scopes to known files. A new script that
 * shows up in scripts/ tomorrow with a bare write to js/game-registry.js
 * would pass that test (it only asserts on known files) but fail THIS
 * one. Defense in depth: a developer adding a new script can't accidentally
 * skip the durability primitive — CI catches it.
 *
 * Deny list = the targets whose corruption would take down revenue:
 *   js/game-registry.js          full-site-down (lobby + slug-registry)
 *   js/casino-engine.js          engine-broken (all 120 slot pages)
 *   shared/game-definitions.js   engine-broken (server boot catalog)
 *   dist/index.html              full-site-down (production SPA entry)
 *   dist/sw.js                   full-site-down for returning PWA users
 *   data/symbol-art.json         engine degrades to emoji fallback
 *   data/game-thumbnails.json    lobby thumbnails fall to placeholders
 *   data/game-lore.json          info modal blanks
 *   assets/manifest.json         lobby fallback resolution breaks
 *   shared/asset-map.json        asset-map-driven generators break
 *
 * Identifier deny list = the constant names scripts commonly bind those
 * paths to. Catches `fs.writeFileSync(REGISTRY, ...)` even when the
 * literal path string isn't on the same line.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const SCRIPTS_DIR = path.join(ROOT, 'scripts');

const DENY_PATHS = [
    'js/game-registry.js',
    'js/casino-engine.js',
    'shared/game-definitions.js',
    'dist/index.html',
    'dist/sw.js',
    'data/symbol-art.json',
    'data/game-thumbnails.json',
    'data/game-lore.json',
    'assets/manifest.json',
    'shared/asset-map.json',
];

const DENY_IDENTIFIERS = [
    'REGISTRY',
    'REGISTRY_SRC',
    'REGISTRY_DIST',
    'ENGINE',
    'GAME_DEFS',
    'THUMBS',
    'THUMB_MAP',
    'LORE',
    'MANIFEST',
    'MAP_OUT',
];

function listScripts() {
    return fs.readdirSync(SCRIPTS_DIR, { withFileTypes: true })
        .filter(d => d.isFile() && d.name.endsWith('.js'))
        .map(d => path.join(SCRIPTS_DIR, d.name));
}

function stripComments(src) {
    return src
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/\/\/[^\n]*/g, '');
}

describe('repo-wide writer deny-list scan', () => {
    const offenders = [];

    beforeAll(() => {
        for (const file of listScripts()) {
            const stripped = stripComments(fs.readFileSync(file, 'utf8'));
            const lines = stripped.split('\n');
            for (let i = 0; i < lines.length; i++) {
                const line = lines[i];
                if (!/fs\.writeFileSync\s*\(/.test(line)) continue;

                // Match: fs.writeFileSync(IDENTIFIER  or  fs.writeFileSync(path.join(IDENTIFIER, ...))
                const idMatch = line.match(/fs\.writeFileSync\s*\(\s*(?:path\.join\s*\(\s*)?([A-Za-z_$][A-Za-z0-9_$]*)/);
                const id = idMatch && idMatch[1];

                let bad = false;
                let reason = '';
                if (id && DENY_IDENTIFIERS.includes(id)) {
                    bad = true;
                    reason = 'identifier ' + id;
                }
                for (const denyPath of DENY_PATHS) {
                    if (line.includes(denyPath)) {
                        bad = true;
                        reason = 'literal path ' + denyPath;
                        break;
                    }
                }
                if (bad) {
                    offenders.push({
                        file: path.relative(ROOT, file).replace(/\\/g, '/'),
                        line: i + 1,
                        reason,
                        snippet: line.trim().slice(0, 120),
                    });
                }
            }
        }
    });

    test('no scripts/*.js contains a bare fs.writeFileSync targeting a deny-listed runtime file', () => {
        // Render the failure as a structured list so adding a new offender produces
        // a readable jest diff — not just `expected [] but got [Object,Object]`.
        const failureMessage = offenders.length === 0 ? '' :
            'Bare fs.writeFileSync detected against the high-impact deny-list:\n' +
            offenders.map(o => `  ${o.file}:${o.line}  [${o.reason}]  ${o.snippet}`).join('\n') +
            '\n\nRoute each through writeAtomicFsync from scripts/lib/symbol-art-manifest.js.';
        if (offenders.length > 0) {
            throw new Error(failureMessage);
        }
        expect(offenders).toEqual([]);
    });

    test('the scan actually loaded scripts (sanity)', () => {
        // Guards against a future refactor that silently breaks the scan
        // and lets the suite pass on an empty walk.
        const scripts = listScripts();
        expect(scripts.length).toBeGreaterThan(10);
        expect(scripts.some(p => /symbol-art|generate-/.test(path.basename(p)))).toBe(true);
    });
});
