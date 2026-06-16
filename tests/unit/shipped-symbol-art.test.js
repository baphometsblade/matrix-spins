'use strict';

/**
 * Locks in the curated symbol-art shipping contract:
 *  - the engine fetches the CURATED manifest, never the raw generator one
 *  - the shipped manifest contains ZERO tiles that failed visual QA
 *  - the shipped manifest contains ZERO un-reviewed games
 *  - every shipped tile path actually exists on disk (no 404 → blank cell)
 *
 * Why this matters: data/symbol-art.json is the generator's full "what exists"
 * list and has historically included broken tiles (gibberish text, empty frames)
 * and a CLAUDE.md crypto violation (Bitcoin coins on `gold`). Those were live in
 * production. build-shipped-symbol-art.js subtracts the QA exclusion lists; this
 * test fails if a regression re-points the engine at the raw manifest or a bad
 * tile sneaks back into the shipped set.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const readJson = (p, f) => { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (_) { return f; } };

const shipped = readJson(path.join(ROOT, 'data', 'symbol-art-shipped.json'), null);
const flagged = readJson(path.join(ROOT, 'data', 'qa-flagged.json'), []);
const unreviewed = readJson(path.join(ROOT, 'data', 'qa-unreviewed.json'), []);
const engineSrc = fs.readFileSync(path.join(ROOT, 'js', 'casino-engine.js'), 'utf8');

describe('curated symbol-art shipping contract', () => {
  test('the shipped manifest exists and is a non-empty object', () => {
    expect(shipped && typeof shipped === 'object').toBe(true);
    expect(Object.keys(shipped).length).toBeGreaterThan(0);
  });

  test('engine fetches the curated shipped manifest, not the raw generator manifest', () => {
    expect(engineSrc).toContain("fetch('/data/symbol-art-shipped.json'");
    expect(engineSrc).not.toContain("fetch('/data/symbol-art.json'");
  });

  test('ZERO QA-flagged tiles are present in the shipped manifest', () => {
    const leaks = [];
    for (const f of flagged) {
      const tile = (typeof f === 'string' ? f : f && f.tile) || '';
      const [game, sym] = tile.replace(/\.(png|webp)$/i, '').split('/');
      if (game && sym && shipped[game] && shipped[game][sym]) leaks.push(tile);
    }
    expect(leaks).toEqual([]);
  });

  test('ZERO un-reviewed games are present in the shipped manifest', () => {
    const leaks = unreviewed.filter((g) => shipped[g]);
    expect(leaks).toEqual([]);
  });

  test('every shipped tile path resolves to a real file on disk', () => {
    const missing = [];
    for (const [, syms] of Object.entries(shipped)) {
      for (const rel of Object.values(syms)) {
        if (!fs.existsSync(path.join(ROOT, 'assets', 'symbols', rel))) missing.push(rel);
      }
    }
    expect(missing).toEqual([]);
  });

  test('the specific Bitcoin/crypto gold tile is NOT shipped (CLAUDE.md zero-crypto)', () => {
    expect(shipped['aboriginal-dreamtime-quest'] &&
      shipped['aboriginal-dreamtime-quest'].gold).toBeFalsy();
  });
});
