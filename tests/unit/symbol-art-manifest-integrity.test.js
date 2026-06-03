'use strict';

/**
 * Regression test for the "59K-of-whitespace manifest" incident.
 *
 * Before this lib existed, three scripts each had their own writeAtomic +
 * loadManifest. None fsync'd the data before rename (a Windows crash-replay
 * could land the renamed file pointing at uncommitted memory pages full of
 * 0x20), and loadManifest silently returned {} on parse failure — so the
 * next persistManifest would overwrite a corrupted-but-recoverable manifest
 * with a near-empty one, wiping coverage for every game it had not yet
 * regenerated in the current run.
 *
 * The lib (scripts/lib/symbol-art-manifest.js) closes both failure modes.
 * This file locks the contract so a future refactor can't reintroduce them.
 *
 * Tests use os.tmpdir() so they leave no traces in the working tree.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const lib = require('../../scripts/lib/symbol-art-manifest');

function mkTmpDir(prefix) {
    return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}
function rmRf(p) {
    try { fs.rmSync(p, { recursive: true, force: true }); }
    catch (_) { /* tmpdir cleanup is best-effort */ }
}

// A 256-byte minimum-size buffer with a valid PNG signature so the lib's
// MIN_TILE_BYTES + magic-byte conventions are satisfied (the lib only checks
// size; magic bytes future-proof against a stricter check).
const PNG_SIG = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
function fakeTile() {
    return Buffer.concat([PNG_SIG, Buffer.alloc(256, 0xAA)]);
}

function seedGame(symRoot, gameId, syms) {
    const dir = path.join(symRoot, gameId);
    fs.mkdirSync(dir, { recursive: true });
    for (const sym of syms) fs.writeFileSync(path.join(dir, sym + '.webp'), fakeTile());
}

describe('symbol-art-manifest lib — corruption recovery', () => {
    let symRoot, manifestPath;

    beforeEach(() => {
        const tmp = mkTmpDir('sa-mfst-');
        symRoot = path.join(tmp, 'symbols');
        manifestPath = path.join(tmp, 'symbol-art.json');
        fs.mkdirSync(symRoot, { recursive: true });
    });
    afterEach(() => rmRf(path.dirname(symRoot)));

    test('loadManifest rebuilds from disk when manifest is 59K of pure whitespace', () => {
        seedGame(symRoot, 'aboriginal-dreamtime-quest', ['wild', 'scatter', 'spirit']);
        seedGame(symRoot, 'cherry-blossom-temple', ['cherry', 'wild']);

        // Reproduce the exact corruption shape: ~59K of 0x20 with no other bytes.
        fs.writeFileSync(manifestPath, ' '.repeat(59486));

        const map = lib.loadManifest(manifestPath, symRoot);

        expect(Object.keys(map).sort()).toEqual([
            'aboriginal-dreamtime-quest',
            'cherry-blossom-temple',
        ]);
        expect(map['aboriginal-dreamtime-quest'].wild).toBe('aboriginal-dreamtime-quest/wild.webp');
        expect(Object.keys(map['cherry-blossom-temple']).sort()).toEqual(['cherry', 'wild']);
    });

    test('loadManifest rebuilds from disk on unparseable JSON', () => {
        seedGame(symRoot, 'nebula-quest', ['wild', 'star']);
        fs.writeFileSync(manifestPath, '{"nebula-quest": this is not json');

        const map = lib.loadManifest(manifestPath, symRoot);

        expect(map['nebula-quest']).toBeDefined();
        expect(map['nebula-quest'].wild).toBe('nebula-quest/wild.webp');
    });

    test('loadManifest rebuilds from disk on shape-invalid JSON', () => {
        seedGame(symRoot, 'demo-game', ['wild']);
        // Wrong shape: top-level array, not object.
        fs.writeFileSync(manifestPath, JSON.stringify(['not', 'an', 'object']));

        const map = lib.loadManifest(manifestPath, symRoot);

        expect(Array.isArray(map)).toBe(false);
        expect(map['demo-game']).toBeDefined();
    });

    test('loadManifest returns {} when manifest is missing AND disk is empty', () => {
        // No file, no tiles — the legitimate fresh-start case.
        expect(lib.loadManifest(manifestPath, symRoot)).toEqual({});
    });

    test('loadManifest returns parsed map unchanged when valid', () => {
        const good = {
            'demo-game': { wild: 'demo-game/wild.webp', scatter: 'demo-game/scatter.webp' },
        };
        fs.writeFileSync(manifestPath, JSON.stringify(good, null, 2) + '\n');

        const map = lib.loadManifest(manifestPath, symRoot);

        expect(map).toEqual(good);
    });

    test('persistManifest refuses to write a shape-invalid map', () => {
        // Path with traversal characters — must be rejected before hitting disk.
        const bad = { 'demo-game': { wild: '../etc/passwd' } };
        expect(() => lib.persistManifest(manifestPath, bad)).toThrow(/invalid path/);
        expect(fs.existsSync(manifestPath)).toBe(false);
    });

    test('persistManifest refuses unsafe gameId', () => {
        const bad = { '../escape': { wild: 'escape/wild.webp' } };
        expect(() => lib.persistManifest(manifestPath, bad)).toThrow(/unsafe gameId/);
    });

    test('persistManifest refuses path/key gameId mismatch', () => {
        const bad = { 'game-a': { wild: 'game-b/wild.webp' } };
        expect(() => lib.persistManifest(manifestPath, bad)).toThrow(/gameId mismatch/);
    });

    test('persistManifest writes byte-identical output to JSON.stringify(map,null,2)+"\\n"', () => {
        const good = {
            'demo-game': { scatter: 'demo-game/scatter.webp', wild: 'demo-game/wild.webp' },
        };
        lib.persistManifest(manifestPath, good);
        const raw = fs.readFileSync(manifestPath, 'utf8');
        expect(raw).toBe(JSON.stringify(good, null, 2) + '\n');
    });

    test('writeAtomicFsync never leaves the .tmp behind on success', () => {
        const target = path.join(path.dirname(manifestPath), 'fsync-probe.bin');
        lib.writeAtomicFsync(target, Buffer.from('hello'));
        const sib = fs.readdirSync(path.dirname(target));
        expect(sib).toContain('fsync-probe.bin');
        expect(sib.some(f => f.startsWith('fsync-probe.bin.') && f.endsWith('.tmp'))).toBe(false);
    });

    test('rebuildFromDisk prefers .webp when both .png and .webp exist for the same symbol', () => {
        const gameDir = path.join(symRoot, 'mixed-game');
        fs.mkdirSync(gameDir);
        fs.writeFileSync(path.join(gameDir, 'wild.png'), fakeTile());
        fs.writeFileSync(path.join(gameDir, 'wild.webp'), fakeTile());

        const map = lib.rebuildFromDisk(symRoot);
        expect(map['mixed-game'].wild).toBe('mixed-game/wild.webp');
    });

    test('rebuildFromDisk skips tiles under the minimum byte threshold', () => {
        const gameDir = path.join(symRoot, 'truncated-game');
        fs.mkdirSync(gameDir);
        fs.writeFileSync(path.join(gameDir, 'partial.webp'), Buffer.alloc(8));  // way under 256
        fs.writeFileSync(path.join(gameDir, 'good.webp'), fakeTile());

        const map = lib.rebuildFromDisk(symRoot);
        expect(map['truncated-game'].partial).toBeUndefined();
        expect(map['truncated-game'].good).toBe('truncated-game/good.webp');
    });

    test('rebuildFromDisk ignores unsafe directory names', () => {
        // A directory whose name fails SAFE_ID must not appear in the manifest.
        // Use a name with a leading dash — also passes the filesystem.
        const dir = path.join(symRoot, '-leading-dash');
        fs.mkdirSync(dir);
        fs.writeFileSync(path.join(dir, 'wild.webp'), fakeTile());

        const map = lib.rebuildFromDisk(symRoot);
        expect(map['-leading-dash']).toBeUndefined();
    });

    test('looksAllWhitespace recognises tabs, CR, LF in addition to spaces', () => {
        expect(lib.looksAllWhitespace('')).toBe(true);
        expect(lib.looksAllWhitespace('   ')).toBe(true);
        expect(lib.looksAllWhitespace('\t\t\n\r')).toBe(true);
        expect(lib.looksAllWhitespace('{}')).toBe(false);
        expect(lib.looksAllWhitespace('  x  ')).toBe(false);
    });
});
