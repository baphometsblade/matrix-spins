'use strict';

/**
 * Lock-in regression test for themed slot symbols on the 120 hyphenated game
 * pages (/games/<slug>.html).
 *
 * BUG (fixed 2026-06-03): The casino engine fetches each game's config from
 * GET /api/games/:id (games-catalog.routes.js). That route only knew the 100
 * underscore games in shared/game-definitions.js — so for every hyphenated slot
 * page it fell through to a SYNTHETIC placeholder config whose symbols were the
 * generic ['s1','s2','s3','s4','s5','wild']. The engine has no emoji glyph for
 * 's1'..'s5', so it rendered 2-letter text chips ("S1".."S5") on every reel of
 * every game — "slots assets are not loading correctly".
 *
 * FIX: server/services/slug-registry.js parses js/game-registry.js (the real
 * hyphenated catalog) and exposes getSlugGame(); the catalog route consults it
 * before the synthetic fallback, returning each game's REAL descriptive symbol
 * list (e.g. ['ra','sun','pyramid','scarab','ankh',...]) which DO have glyphs.
 *
 * These tests fail if anyone:
 *   - removes the slug-registry wiring (symbols revert to s1..s5), or
 *   - ships a registry where games carry only generic placeholder symbols.
 */

const path = require('path');
const fs = require('fs');
const { getSlugGame, size } = require('../../server/services/slug-registry');

const GENERIC = new Set(['s1', 's2', 's3', 's4', 's5', 's6', 's7', 's8']);

// Non-slot game pages (casual games with their own engines/routes — NOT driven
// by the slot symbol registry). Excluded from the themed-symbol checks below.
const NON_SLOT_PAGES = new Set(['template', 'scratch-cards', 'mines']);

// Build the list of expected slugs straight from the game HTML pages, so the
// test scales with the real catalog instead of a hard-coded count.
function listGamePageSlugs() {
  const dir = path.resolve(__dirname, '../../games');
  return fs.readdirSync(dir)
    .filter((f) => f.endsWith('.html') && !NON_SLOT_PAGES.has(f.replace(/\.html$/, '')))
    .map((f) => f.replace(/\.html$/, ''));
}

describe('slug-registry themed symbols', () => {
  test('registry loads a substantial catalog', () => {
    expect(size()).toBeGreaterThanOrEqual(100);
  });

  test('a known Egyptian game resolves to its themed symbols (not s1..s5)', () => {
    const g = getSlugGame('ra-sun-god-royale');
    expect(g).toBeTruthy();
    expect(g.symbols).toEqual(
      expect.arrayContaining(['ra', 'sun', 'pyramid', 'scarab', 'ankh'])
    );
    // No generic placeholder leaked in.
    g.symbols.forEach((s) => expect(GENERIC.has(String(s).toLowerCase())).toBe(false));
    // RTP must match the operator target (80), not the synthetic default (96).
    expect(g.rtp).toBe(80);
  });

  test('EVERY game page slug resolves to non-generic symbols', () => {
    const slugs = listGamePageSlugs();
    expect(slugs.length).toBeGreaterThanOrEqual(100);
    const offenders = [];
    for (const slug of slugs) {
      const g = getSlugGame(slug);
      if (!g || !Array.isArray(g.symbols) || g.symbols.length < 3) {
        offenders.push(`${slug}: no themed config`);
        continue;
      }
      const generic = g.symbols.filter((s) => GENERIC.has(String(s).toLowerCase()));
      const themed = g.symbols.filter((s) => !GENERIC.has(String(s).toLowerCase()) && !/^(wild|scatter|bonus)$/i.test(String(s)));
      if (themed.length === 0 && generic.length > 0) {
        offenders.push(`${slug}: ${JSON.stringify(g.symbols)}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  test('catalog route source still wires in the slug-registry', () => {
    const src = fs.readFileSync(
      path.resolve(__dirname, '../../server/routes/games-catalog.routes.js'),
      'utf8'
    );
    expect(src).toMatch(/require\(['"]\.\.\/services\/slug-registry['"]\)/);
    expect(src).toMatch(/getSlugGame\s*\(/);
  });
});

// Extract the SYMBOL_GLYPHS object keys from casino-engine.js (both quoted and
// bare identifier keys). Uses String.matchAll — no dynamic evaluation.
function readGlyphKeys() {
  const eng = fs.readFileSync(
    path.resolve(__dirname, '../../js/casino-engine.js'),
    'utf8'
  );
  const start = eng.indexOf('const SYMBOL_GLYPHS');
  const open = eng.indexOf('{', start);
  let depth = 0; let end = -1;
  for (let i = open; i < eng.length; i++) {
    const c = eng[i];
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) { end = i; break; } }
  }
  const body = eng.slice(open + 1, end);
  const keys = new Set();
  const re = /(?:^|,|\{|\n)\s*(?:'([^']+)'|"([^"]+)"|([a-zA-Z0-9_$-]+))\s*:/g;
  for (const m of body.matchAll(re)) {
    const k = (m[1] || m[2] || m[3] || '').toLowerCase();
    if (k) keys.add(k);
  }
  return keys;
}

describe('engine glyph coverage', () => {
  test('every registry symbol has an emoji glyph (no 2-letter fallback)', () => {
    const keys = readGlyphKeys();
    const slugs = listGamePageSlugs();
    const symbols = new Set();
    for (const slug of slugs) {
      const g = getSlugGame(slug);
      if (g && Array.isArray(g.symbols)) g.symbols.forEach((s) => symbols.add(String(s).toLowerCase()));
    }
    const head = (s) => s.split('-')[0];
    const missing = [...symbols].filter((s) => !keys.has(s) && !keys.has(head(s)) && !GENERIC.has(s));
    expect(missing).toEqual([]);
  });
});
