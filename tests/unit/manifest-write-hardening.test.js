'use strict';

/**
 * Regression test for the manifest-writer hardening rollout that followed
 * the data/symbol-art.json corruption incident.
 *
 * Background: symbol-art.json was wiped to 59K of pure whitespace by a
 * Windows crash-replay against a non-fsync'd writeAtomic. The fix shipped
 * fsync'd IO via scripts/lib/symbol-art-manifest.js. A follow-up audit found
 * FOUR more writers in the same trap targeting data/game-thumbnails.json
 * (slot-art generate + optimize, adult-slots × 2) and data/game-lore.json
 * (adult-slots × 2). Two of those writers also pair the bad write with a
 * silent JSON.parse catch that would overwrite a corrupted manifest with
 * only the current studio's ~10 entries — wiping the other ~110 games.
 *
 * This test locks the post-rollout contract so a future refactor can't
 * silently reintroduce either vulnerability:
 *   Part 1: each writer's source code imports writeAtomicFsync from the
 *           shared lib, AND contains zero bare `fs.writeFileSync(` calls
 *           targeting the JSON manifest paths.
 *   Part 2: the adult-slots mergeJson helper THROWS on a corrupted manifest
 *           input instead of silently falling back to {} (verified by
 *           evaluating each script's mergeJson in a vm sandbox against a
 *           tmp manifest containing '{garbage').
 *   Part 3: the lib's writeAtomicFsync round-trips data through a real
 *           write+read cycle, so the shared primitive itself stays healthy.
 *
 * The tests are pure jest — no DB, no network, no Fooocus. They scrub
 * tmp dirs under os.tmpdir() so the working tree stays clean.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..', '..');
const SCRIPTS = path.join(ROOT, 'scripts');

const VULNERABLE_WRITERS = [
    {
        file: path.join(SCRIPTS, 'generate-slot-art.js'),
        manifests: ['game-thumbnails.json'],
    },
    {
        file: path.join(SCRIPTS, 'optimize-slot-art.js'),
        manifests: ['game-thumbnails.json'],
    },
    {
        file: path.join(SCRIPTS, 'generate-adult-slots.js'),
        manifests: ['game-thumbnails.json', 'game-lore.json'],
    },
    {
        file: path.join(SCRIPTS, 'generate-adult-slots-2.js'),
        manifests: ['game-thumbnails.json', 'game-lore.json'],
    },
];

const ADULT_SLOTS_SCRIPTS = [
    path.join(SCRIPTS, 'generate-adult-slots.js'),
    path.join(SCRIPTS, 'generate-adult-slots-2.js'),
];

function readSrc(p) { return fs.readFileSync(p, 'utf8'); }
function mkTmp(prefix) { return fs.mkdtempSync(path.join(os.tmpdir(), prefix)); }
function rmTmp(p) { try { fs.rmSync(p, { recursive: true, force: true }); } catch (_) { /* best-effort */ } }

describe('Part 1 — every vulnerable writer is now hardened', () => {
    VULNERABLE_WRITERS.forEach(w => {
        const name = path.basename(w.file);

        test(`${name} imports writeAtomicFsync from the shared lib`, () => {
            const src = readSrc(w.file);
            expect(src).toMatch(/require\(['"]\.\/lib\/symbol-art-manifest['"]\)/);
            expect(src).toMatch(/writeAtomicFsync/);
        });

        test(`${name} contains no bare fs.writeFileSync targeting the JSON manifest paths`, () => {
            const src = readSrc(w.file);
            // Strip block + line comments so comments mentioning writeFileSync
            // do not produce false positives.
            const stripped = src
                .replace(/\/\*[\s\S]*?\*\//g, '')
                .replace(/\/\/[^\n]*/g, '');

            // The forbidden pattern: a real call site that writes to one of
            // this writer's tracked manifests via the bare API.
            const lines = stripped.split('\n');
            const offenders = [];
            for (let i = 0; i < lines.length; i++) {
                const line = lines[i];
                if (!/fs\.writeFileSync\s*\(/.test(line)) continue;
                for (const manifest of w.manifests) {
                    // Match either a literal path string OR the THUMBS/THUMB_MAP/LORE
                    // identifier the script binds to the path. We're conservative:
                    // any direct-write line mentioning the manifest name is a fail.
                    if (line.includes(manifest)) offenders.push(`${i + 1}: ${line.trim()}`);
                }
            }
            // The other failure shape: a writeFileSync targeting the LORE / THUMBS /
            // THUMB_MAP constant identifier (these scripts define those constants
            // to point at the manifest paths). Lookups are cheap; do them once.
            const constNames = ['LORE', 'THUMBS', 'THUMB_MAP'];
            for (let i = 0; i < lines.length; i++) {
                const line = lines[i];
                const m = line.match(/fs\.writeFileSync\s*\(\s*([A-Z_][A-Z0-9_]*)/);
                if (m && constNames.includes(m[1])) offenders.push(`${i + 1}: ${line.trim()}`);
            }
            expect(offenders).toEqual([]);
        });
    });
});

describe('Part 2 — adult-slots mergeJson throws loudly on a corrupted manifest', () => {
    // Evaluate each script in a vm sandbox so we can call its mergeJson
    // helper without actually running the whole "regenerate game files"
    // pipeline (which would mutate js/game-registry.js + write hundreds
    // of HTML pages). We grab the helper by intercepting global.module.exports.
    function loadMergeJson(scriptPath) {
        const src = readSrc(scriptPath);
        const tmpDir = mkTmp('mw-');
        try {
            // Stub modules: only fs + path + the shared manifest lib are referenced.
            // The vm runs `require` directly because the script does not use ESM.
            const sandbox = {
                require: (id) => {
                    if (id === 'fs') return fs;
                    if (id === 'path') return path;
                    if (id === './lib/symbol-art-manifest') return require('../../scripts/lib/symbol-art-manifest');
                    throw new Error('unexpected require in sandbox: ' + id);
                },
                module: { exports: {} },
                __filename: scriptPath,
                __dirname: path.dirname(scriptPath),
                process: { argv: ['node', scriptPath] },
                console: { log: () => {}, warn: () => {}, error: () => {} },
                Buffer,
            };
            vm.createContext(sandbox);

            // Stub `main()` so requiring the script does not run anything.
            // We only need the mergeJson function definition; isolate by
            // truncating the source to the point just AFTER mergeJson and
            // before any top-level invocation.
            const mergeMatch = src.match(/function mergeJson\([\s\S]*?\n\}/);
            if (!mergeMatch) throw new Error('mergeJson not found in ' + scriptPath);

            // Make `ROOT` available so the throw message in mergeJson can
            // construct a relative path — the script binds ROOT near the top.
            // mergeJson uses fs + path as bare identifiers (top-level requires
            // in the real script), so re-bind both inside the sandbox source.
            const truncated =
                "const fs = require('fs');\n" +
                "const path = require('path');\n" +
                "const ROOT = " + JSON.stringify(path.dirname(scriptPath)) + ";\n" +
                "const { writeAtomicFsync } = require('./lib/symbol-art-manifest');\n" +
                mergeMatch[0] + "\nmodule.exports.mergeJson = mergeJson;\n";

            vm.runInContext(truncated, sandbox);
            return { mergeJson: sandbox.module.exports.mergeJson, tmpDir };
        } catch (e) {
            rmTmp(tmpDir);
            throw e;
        }
    }

    ADULT_SLOTS_SCRIPTS.forEach(s => {
        const name = path.basename(s);

        test(`${name} mergeJson throws on a manifest containing unparseable JSON`, () => {
            const { mergeJson, tmpDir } = loadMergeJson(s);
            try {
                const manifestPath = path.join(tmpDir, 'test-manifest.json');
                fs.writeFileSync(manifestPath, '{garbage not json');
                expect(() =>
                    mergeJson(manifestPath, obj => { obj.a = 1; })
                ).toThrow(/unparseable/i);
                // And critically — the corrupted file MUST NOT be overwritten.
                expect(fs.readFileSync(manifestPath, 'utf8')).toBe('{garbage not json');
            } finally {
                rmTmp(tmpDir);
            }
        });

        test(`${name} mergeJson throws on a whitespace-only manifest`, () => {
            const { mergeJson, tmpDir } = loadMergeJson(s);
            try {
                const manifestPath = path.join(tmpDir, 'test-manifest.json');
                // Exact reproduction of the symbol-art corruption shape.
                const whitespace = ' '.repeat(59486);
                fs.writeFileSync(manifestPath, whitespace);
                expect(() =>
                    mergeJson(manifestPath, obj => { obj.a = 1; })
                ).toThrow(/unparseable/i);
                expect(fs.readFileSync(manifestPath, 'utf8')).toBe(whitespace);
            } finally {
                rmTmp(tmpDir);
            }
        });

        test(`${name} mergeJson throws when the manifest is a non-object (array)`, () => {
            const { mergeJson, tmpDir } = loadMergeJson(s);
            try {
                const manifestPath = path.join(tmpDir, 'test-manifest.json');
                fs.writeFileSync(manifestPath, JSON.stringify(['this','is','an','array']));
                expect(() =>
                    mergeJson(manifestPath, obj => { obj.a = 1; })
                ).toThrow(/not a plain object/i);
            } finally {
                rmTmp(tmpDir);
            }
        });

        test(`${name} mergeJson successfully merges into a valid manifest via fsync'd write`, () => {
            const { mergeJson, tmpDir } = loadMergeJson(s);
            try {
                const manifestPath = path.join(tmpDir, 'test-manifest.json');
                fs.writeFileSync(manifestPath, JSON.stringify({ existing: 'value' }, null, 2) + '\n');
                mergeJson(manifestPath, obj => { obj.added = 'now'; });
                const after = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
                expect(after).toEqual({ existing: 'value', added: 'now' });
                // .tmp staging file from the atomic write must be gone.
                const stragglers = fs.readdirSync(tmpDir).filter(f => /\.\d+\.tmp$/.test(f));
                expect(stragglers).toEqual([]);
            } finally {
                rmTmp(tmpDir);
            }
        });

        test(`${name} mergeJson initialises a missing file via fsync'd write`, () => {
            const { mergeJson, tmpDir } = loadMergeJson(s);
            try {
                const manifestPath = path.join(tmpDir, 'never-existed.json');
                mergeJson(manifestPath, obj => { obj.created = true; });
                expect(JSON.parse(fs.readFileSync(manifestPath, 'utf8'))).toEqual({ created: true });
            } finally {
                rmTmp(tmpDir);
            }
        });
    });
});

describe('Part 3 — writeAtomicFsync round-trips data through write+read', () => {
    const { writeAtomicFsync } = require('../../scripts/lib/symbol-art-manifest');

    test('writes binary data atomically and removes the staged .tmp', () => {
        const tmpDir = mkTmp('mw-');
        try {
            const target = path.join(tmpDir, 'probe.bin');
            const payload = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, ...Array(120).fill(0xAA)]);
            writeAtomicFsync(target, payload);
            const back = fs.readFileSync(target);
            expect(back.equals(payload)).toBe(true);
            // No leftover tmp staging file.
            const stragglers = fs.readdirSync(tmpDir).filter(f => f.startsWith('probe.bin.') && f.endsWith('.tmp'));
            expect(stragglers).toEqual([]);
        } finally {
            rmTmp(tmpDir);
        }
    });
});
