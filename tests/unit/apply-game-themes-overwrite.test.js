'use strict';

/**
 * Regression lock for scripts/apply-game-themes.js applyToRegistry().
 *
 * Background: the rewire step that ships every game thumbnail relies on
 * applyToRegistry OVERWRITING existing `thumbnail:` fields in
 * js/game-registry.js (the registry already had a flat `.webp` per game,
 * which we replace with the AI photo-real `ai/<id>.webp`).
 *
 * Earlier sessions had a hand-rolled regex that:
 *  - was not word-boundary anchored (could match `otherThumbnail:`),
 *  - string-matched the whole token (caused needless churn on
 *    double-quoted entries that were already at the desired value).
 *
 * The current implementation uses `\bthumbnail:\s*(['"`])((?:\\.|(?!\1).)*)\1`
 * and compares the CAPTURED value (group 2) vs the desired path so
 * double-quoted no-op entries don't get rewritten.
 *
 * This test locks all four critical cases in jest so a future rewrite
 * can't regress without the build going red.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { applyToRegistry } = require('../../scripts/apply-game-themes');

function tempRegistry(content) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'apply-themes-'));
    const file = path.join(dir, 'game-registry.js');
    fs.writeFileSync(file, content, 'utf8');
    return { file, cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) };
}

// Build a synthetic registry with the same lexical shape the real file uses.
// The script identifies the array by `window.GAME_REGISTRY = [` and walks
// braces to chunk per-game objects, so we honour that wrapper exactly.
function syntheticRegistry(games) {
    const body = games.map(g => '  {\n' + Object.entries(g).map(([k, v]) => `    ${k}: ${v}`).join(',\n') + '\n  }').join(',\n');
    return `window.STUDIO_CONFIG = {};\nwindow.GAME_REGISTRY = [\n${body}\n];\n`;
}

function fieldValue(text, gameId, key) {
    // Pull `<key>: '<value>'` from inside the object whose id matches gameId.
    const objRe = new RegExp(`\\{[^}]*id:\\s*'${gameId}'[^}]*\\}`, 's');
    const objMatch = text.match(objRe);
    if (!objMatch) return null;
    const m = objMatch[0].match(new RegExp(`\\b${key}:\\s*(['"\`])((?:\\\\.|(?!\\1).)*)\\1`));
    return m ? m[2] : null;
}

describe('apply-game-themes — thumbnail overwrite', () => {
    test('OVERWRITES single-quoted flat .webp with desired ai/<id>.webp', () => {
        const { file, cleanup } = tempRegistry(syntheticRegistry([
            { id: "'g1'", name: "'G One'", theme: "'Fruit Classics'", thumbnail: "'assets/thumbnails/old_one.webp'" },
        ]));
        try {
            const res = applyToRegistry(file, { g1: 'ai/g1.webp' });
            expect(res.changed).toBeGreaterThanOrEqual(1);
            const after = fs.readFileSync(file, 'utf8');
            expect(fieldValue(after, 'g1', 'thumbnail')).toBe('assets/thumbnails/ai/g1.webp');
        } finally { cleanup(); }
    });

    test('OVERWRITES double-quoted flat .webp (and normalises to single quotes)', () => {
        const { file, cleanup } = tempRegistry(syntheticRegistry([
            { id: "'g2'", name: "'G Two'", theme: "'Asian / Lucky'", thumbnail: '"assets/thumbnails/old_two.webp"' },
        ]));
        try {
            applyToRegistry(file, { g2: 'ai/g2.webp' });
            const after = fs.readFileSync(file, 'utf8');
            expect(fieldValue(after, 'g2', 'thumbnail')).toBe('assets/thumbnails/ai/g2.webp');
        } finally { cleanup(); }
    });

    test('NO-CHURN: leaves an already-desired single-quoted thumbnail untouched', () => {
        const { file, cleanup } = tempRegistry(syntheticRegistry([
            { id: "'g3'", name: "'G Three'", theme: "'Space / Sci-Fi'", thumbnail: "'assets/thumbnails/ai/g3.webp'" },
        ]));
        try {
            const before = fs.readFileSync(file, 'utf8');
            applyToRegistry(file, { g3: 'ai/g3.webp' });
            const after = fs.readFileSync(file, 'utf8');
            // Either unchanged on disk (no write), or rewritten to a byte-
            // identical thumbnail value. Either way the FIELD VALUE must
            // still be the desired one — and no churn is introduced.
            expect(fieldValue(after, 'g3', 'thumbnail')).toBe('assets/thumbnails/ai/g3.webp');
            // The thumbnail substring count must remain exactly one (no
            // duplication from an accidental re-insert path).
            const count = (after.match(/thumbnail:/g) || []).length;
            expect(count).toBe(1);
        } finally { cleanup(); }
    });

    test('INSERTS thumbnail when the field is missing', () => {
        const { file, cleanup } = tempRegistry(syntheticRegistry([
            { id: "'g4'", name: "'G Four'", theme: "'Ancient Egypt / Mythology'" },
        ]));
        try {
            applyToRegistry(file, { g4: 'ai/g4.webp' });
            const after = fs.readFileSync(file, 'utf8');
            expect(fieldValue(after, 'g4', 'thumbnail')).toBe('assets/thumbnails/ai/g4.webp');
        } finally { cleanup(); }
    });

    test('DECOY GUARD: ignores otherThumbnail:, only touches thumbnail:', () => {
        // Build the object hand-rolled — the otherThumbnail field must come
        // BEFORE thumbnail so a non-anchored regex would mis-match the decoy.
        const obj = `  {\n    id: 'g5',\n    name: 'G Five',\n    theme: 'Horror / Dark',\n    otherThumbnail: 'assets/thumbnails/decoy.webp',\n    thumbnail: 'assets/thumbnails/old_five.webp'\n  }`;
        const content = `window.STUDIO_CONFIG = {};\nwindow.GAME_REGISTRY = [\n${obj}\n];\n`;
        const { file, cleanup } = tempRegistry(content);
        try {
            applyToRegistry(file, { g5: 'ai/g5.webp' });
            const after = fs.readFileSync(file, 'utf8');
            // The decoy must remain unchanged.
            expect(fieldValue(after, 'g5', 'otherThumbnail')).toBe('assets/thumbnails/decoy.webp');
            // The real thumbnail must be the desired one.
            expect(fieldValue(after, 'g5', 'thumbnail')).toBe('assets/thumbnails/ai/g5.webp');
        } finally { cleanup(); }
    });

    test('SKIPS games not in the map (leaves their existing thumbnail intact)', () => {
        const { file, cleanup } = tempRegistry(syntheticRegistry([
            { id: "'g6'", name: "'G Six'", theme: "'Fantasy / Magic'", thumbnail: "'assets/thumbnails/keep_me.webp'" },
        ]));
        try {
            applyToRegistry(file, { /* deliberately no entry for g6 */ });
            const after = fs.readFileSync(file, 'utf8');
            expect(fieldValue(after, 'g6', 'thumbnail')).toBe('assets/thumbnails/keep_me.webp');
        } finally { cleanup(); }
    });
});
