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

  test('known Bitcoin/crypto tiles are NOT shipped (CLAUDE.md zero-crypto)', () => {
    // Each of these was a real ₿ Bitcoin tile that reached the live shipped reels
    // and was caught by visual QA. SDXL renders crypto coinage on gold/coin prompts,
    // and the single-pass finder has a crypto false-negative rate — these were only
    // caught by a dedicated crypto-skeptic re-inspection. Lock them out explicitly so
    // a regression that drops them from qa-flagged.json fails here with a crypto label.
    //
    // 2026-06-17: luck-prosperity-wheel/coin and wizard-spellbook-master/gold were
    // GENUINELY fixed — re-generated with anti-crypto game-scoped subjects, then
    // verified crypto-clean by a dedicated crypto-skeptic visual re-inspection.
    // aboriginal-dreamtime-quest/gold was likewise regenerated (raw gold dust + nuggets,
    // no coins) and verified clean, so it now ships and leaves this guard.
    //
    // A 16-agent two-pass crypto audit of the 96 shipped gold/coin tiles then caught
    // TWO live Bitcoin tiles the earlier single-pass audit had shipped — confirmed by
    // both audit passes AND a manual crypto-skeptic re-read. They are now masked
    // (qa-flagged) pending a clean nugget-based regen; lock them out explicitly so a
    // regression that drops them from qa-flagged.json fails here with a crypto label.
    const cryptoTiles = [
      'thoth-wisdom-keeper/gold',
      'pharaoh-eternal-dynasty/gold',
    ];
    const live = cryptoTiles.filter((t) => {
      const [game, sym] = t.split('/');
      return shipped[game] && shipped[game][sym];
    });
    expect(live).toEqual([]);
  });

  test('every shipped tile is an optimised .webp — no raw PNG on live reels', () => {
    // The generator emits 768x768 PNGs (~600-900 KB); optimize-symbol-art.js
    // converts them to ~8-25 KB 224px webp. A raw PNG reaching the shipped
    // manifest means the optimize step was skipped and live reels would pull
    // ~700 KB per cell — a serious perf regression. Lock it to webp-only.
    const rawPng = [];
    for (const [game, syms] of Object.entries(shipped)) {
      for (const [sym, rel] of Object.entries(syms)) {
        if (!/\.webp$/i.test(rel)) rawPng.push(`${game}/${sym} -> ${rel}`);
      }
    }
    expect(rawPng).toEqual([]);
  });
});
