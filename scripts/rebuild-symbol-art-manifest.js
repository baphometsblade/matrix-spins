'use strict';

/**
 * Rebuild data/symbol-art.json from the truth of disk.
 *
 * WHY THIS EXISTS — symbol-art.json is the engine's lookup table for swapping
 * emoji glyphs for custom bitmap tiles. If it is corrupted (e.g. a stray write
 * filled it with whitespace, an editor saved a blank, two processes raced its
 * tmp file), the engine silently falls back to emoji on every game. We want a
 * deterministic, idempotent recovery: scan assets/symbols/<game>/<sym>.{webp,png}
 * and reconstruct the manifest exactly as the generate/optimize pipeline does.
 *
 * Format (matches scripts/generate-symbol-art.js + optimize-symbol-art.js):
 *   { "<gameId>": { "<symbolId>": "<gameId>/<symbolId>.webp|png" } }
 *
 * Preference: when both <sym>.webp and <sym>.png exist for the same id, the
 * webp wins (it is the optimized form served to clients — the optimizer
 * deletes the PNG by default once webp is written).
 *
 * Safety:
 *   - Atomic write (.tmp + rename, same volume).
 *   - Only writes if the new content differs from what's on disk.
 *   - Validates ids against /^[a-z0-9][a-z0-9_-]*$/i (the same SAFE_ID guard
 *     used by the generator, so we never persist a path that wouldn't have
 *     come from a real run).
 *   - Skips zero-byte / suspiciously-tiny files (< 256 B) so we don't index
 *     a partially-written tile.
 *
 * Usage:
 *   node scripts/rebuild-symbol-art-manifest.js          # rebuild + write
 *   node scripts/rebuild-symbol-art-manifest.js --check  # exit 1 if rebuild would change disk
 */

const fs = require('fs');
const path = require('path');
const manifestLib = require('./lib/symbol-art-manifest');

const ROOT = path.resolve(__dirname, '..');
const SYM_ROOT = path.join(ROOT, 'assets', 'symbols');
const MANIFEST = path.join(ROOT, 'data', 'symbol-art.json');

const args = process.argv.slice(2);
const CHECK_ONLY = args.includes('--check');

function rebuild() {
    if (!fs.existsSync(SYM_ROOT)) {
        console.error('[rebuild-sym] no assets/symbols dir, nothing to do.');
        process.exit(0);
    }

    const out = manifestLib.rebuildFromDisk(SYM_ROOT);

    let games = 0, tiles = 0;
    for (const g of Object.keys(out)) { games++; tiles += Object.keys(out[g]).length; }

    const newJson = JSON.stringify(out, null, 2) + '\n';
    const currentJson = fs.existsSync(MANIFEST) ? fs.readFileSync(MANIFEST, 'utf8') : '';
    const changed = currentJson !== newJson;

    console.log('[rebuild-sym] games=' + games + ' tiles=' + tiles + ' changed=' + changed);

    if (CHECK_ONLY) {
        process.exit(changed ? 1 : 0);
    }

    if (changed) {
        manifestLib.persistManifest(MANIFEST, out);
        console.log('[rebuild-sym] wrote ' + MANIFEST);
    } else {
        console.log('[rebuild-sym] manifest already matches disk, no write.');
    }
}

rebuild();
