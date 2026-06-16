'use strict';

/**
 * build-shipped-symbol-art.js — curate the SHIPPED symbol-art manifest.
 *
 * The generator owns data/symbol-art.json — the FULL manifest of every tile it
 * has produced (1056+ tiles, all 120 games). That file is "what exists" and is
 * rewritten continuously by the (resumable, still-running) generator. It must
 * NOT be hand-edited or the next generated tile clobbers the edit.
 *
 * The slot engine, however, must ship only tiles we have VERIFIED. A handful of
 * tiles failed visual QA (gibberish text, empty frames, off-theme, and — worst —
 * Bitcoin/crypto coinage on `gold`/`coin` symbols, which violates the CLAUDE.md
 * zero-crypto rule and was live in production). Six games were never QA'd at all.
 *
 * This script reads the full manifest and SUBTRACTS:
 *   1. every tile listed in data/qa-flagged.json   (failed visual QA)
 *   2. every tile of a game in data/qa-unreviewed.json (never reviewed)
 * and writes the result to data/symbol-art-shipped.json — the manifest the
 * engine actually fetches. Excluded symbols fall back to the themed emoji glyph
 * (clean, already the universal fallback), so dropping a tile is always safe.
 *
 * Per-TILE (not per-game) exclusion is deliberate: flagged games average <2 bad
 * tiles out of ~9, so per-game all-or-nothing would needlessly strip ~900 good
 * AI tiles back to emoji. We keep every verified tile live and only mask the bad
 * ones; the background regen replaces flagged tiles in place, after which they're
 * removed from qa-flagged.json and re-ship on the next build.
 *
 * Idempotent. Run after QA changes or a regen+reQA pass:
 *   node scripts/build-shipped-symbol-art.js
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const FULL = path.join(ROOT, 'data', 'symbol-art.json');
const FLAGGED = path.join(ROOT, 'data', 'qa-flagged.json');
const UNREVIEWED = path.join(ROOT, 'data', 'qa-unreviewed.json');
const SHIPPED = path.join(ROOT, 'data', 'symbol-art-shipped.json');
const TILE_ROOT = path.join(ROOT, 'assets', 'symbols');

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (_) { return fallback; }
}

// Atomic write (stage → fsync → rename → fsync dir) — same durability contract
// the generator/manifest writers use; a torn shipped-manifest would blank reels.
function writeAtomic(file, text) {
  const tmp = file + '.tmp-' + process.pid;
  const fd = fs.openSync(tmp, 'w');
  try {
    fs.writeFileSync(fd, text);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  fs.renameSync(tmp, file);
  try {
    const dfd = fs.openSync(path.dirname(file), 'r');
    try { fs.fsyncSync(dfd); } finally { fs.closeSync(dfd); }
  } catch (_) { /* dir fsync unsupported on some FS — best effort */ }
}

function tileFileExists(rel) {
  // rel is like "game/symbol.png" — confirm the referenced file is actually on disk
  return fs.existsSync(path.join(TILE_ROOT, rel));
}

function main() {
  const full = readJson(FULL, null);
  if (!full || typeof full !== 'object') {
    console.error('[build-shipped] cannot read full manifest at', FULL);
    process.exit(1);
  }
  const flagged = readJson(FLAGGED, []);
  const unreviewed = readJson(UNREVIEWED, []);

  // Exclusion sets
  const flaggedTiles = new Set(
    (Array.isArray(flagged) ? flagged : [])
      .map((f) => (typeof f === 'string' ? f : f && f.tile))
      .filter(Boolean)
      .map((t) => t.replace(/\.(png|webp)$/i, '')) // normalise "game/sym"
  );
  const unreviewedGames = new Set(Array.isArray(unreviewed) ? unreviewed : []);

  const shipped = {};
  let kept = 0, droppedFlag = 0, droppedUnrev = 0, droppedMissing = 0;

  for (const [game, syms] of Object.entries(full)) {
    if (unreviewedGames.has(game)) { droppedUnrev += Object.keys(syms || {}).length; continue; }
    const out = {};
    for (const [sym, rel] of Object.entries(syms || {})) {
      const key = game + '/' + sym;
      if (flaggedTiles.has(key)) { droppedFlag++; continue; }
      if (!tileFileExists(rel)) { droppedMissing++; continue; } // manifest entry but no file → would 404
      out[sym] = rel;
      kept++;
    }
    if (Object.keys(out).length) shipped[game] = out;
  }

  // Stable key order for a clean, churn-free diff.
  const ordered = {};
  for (const g of Object.keys(shipped).sort()) {
    ordered[g] = {};
    for (const s of Object.keys(shipped[g]).sort()) ordered[g][s] = shipped[g][s];
  }

  writeAtomic(SHIPPED, JSON.stringify(ordered, null, 0) + '\n');

  console.log('[build-shipped] shipped manifest written:', path.relative(ROOT, SHIPPED));
  console.log('[build-shipped] games shipped:', Object.keys(ordered).length, '/', Object.keys(full).length);
  console.log('[build-shipped] tiles kept:', kept,
    '| dropped flagged:', droppedFlag,
    '| dropped unreviewed:', droppedUnrev,
    '| dropped missing-file:', droppedMissing);
}

main();
