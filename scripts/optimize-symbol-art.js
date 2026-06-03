'use strict';

/**
 * Post-process the raw Fooocus symbol output. The generator writes 768x768
 * PNGs (~600-900 KB each) to assets/symbols/<game-id>/. Those are far too
 * heavy to serve as live reel-cell tiles, so this converts each to a
 * web-optimised WebP (square, 224x224, quality 82 — ~8-25 KB), deletes
 * the PNG original, and rewrites data/symbol-art.json to point at the .webp.
 *
 * Mirror of optimize-slot-art.js — same atomic-write pattern, same logging
 * shape, same idempotent skip rule. Differences: a 2-level tree
 * (<game-id>/<symbol-id>.png) instead of a flat ai/ dir, and a nested
 * manifest shape ({ "<game-id>": { "<symbol-id>": "<rel-path>" } }).
 *
 * Idempotent: a PNG with an up-to-date .webp sibling is skipped unless
 * --force. Run after `node scripts/generate-symbol-art.js`.
 *
 * Usage:
 *   node scripts/optimize-symbol-art.js
 *   node scripts/optimize-symbol-art.js --force
 *   node scripts/optimize-symbol-art.js --keep-png
 *   node scripts/optimize-symbol-art.js --only sugar_rush
 */

const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const manifestLib = require('./lib/symbol-art-manifest');

const ROOT = path.resolve(__dirname, '..');
const SYM_ROOT = path.join(ROOT, 'assets', 'symbols');
const MANIFEST = path.join(ROOT, 'data', 'symbol-art.json');

const args = process.argv.slice(2);
function argVal(name) { const i = args.indexOf('--' + name); return i >= 0 ? args[i + 1] : null; }
const ONLY = argVal('only');
const FORCE = args.includes('--force');
const KEEP_PNG = args.includes('--keep-png');

const SIZE = 224;     // matches the 2x retina cell render size for ~112px cells
const QUALITY = 82;
const SAFE_ID = manifestLib.SAFE_ID;

// Manifest IO delegates to scripts/lib/symbol-art-manifest.js. fsync'd write,
// whitespace-rejecting load, shape-validated persist — see the lib for the
// failure modes this closes.
const writeAtomic = manifestLib.writeAtomicFsync;
function loadManifest() { return manifestLib.loadManifest(MANIFEST, SYM_ROOT); }
function persistMap(map) { manifestLib.persistManifest(MANIFEST, map); }

async function main() {
    if (!fs.existsSync(SYM_ROOT)) { console.error('No symbol-art dir:', SYM_ROOT); process.exit(1); }

    let gameDirs = fs.readdirSync(SYM_ROOT, { withFileTypes: true })
        .filter(d => d.isDirectory())
        .map(d => d.name)
        .filter(id => SAFE_ID.test(id));
    if (ONLY) gameDirs = gameDirs.filter(id => id === ONLY);
    if (!gameDirs.length) { console.log('[optimize-sym] no game dirs to convert.'); return; }

    const map = loadManifest();
    let done = 0, skipped = 0, failed = 0;

    for (const gameId of gameDirs) {
        const gameDir = path.join(SYM_ROOT, gameId);
        const pngs = fs.readdirSync(gameDir).filter(f => f.toLowerCase().endsWith('.png'));
        if (!pngs.length) continue;
        if (!map[gameId]) map[gameId] = {};

        for (const png of pngs) {
            const symId = png.replace(/\.png$/i, '');
            if (!SAFE_ID.test(symId)) { console.error(`[optimize-sym] SKIP unsafe id: ${gameId}/${symId}`); failed++; continue; }
            const pngPath = path.join(gameDir, png);
            const webpPath = path.join(gameDir, symId + '.webp');
            const rel = gameId + '/' + symId + '.webp';

            if (!FORCE && fs.existsSync(webpPath) &&
                fs.statSync(webpPath).mtimeMs >= fs.statSync(pngPath).mtimeMs) {
                map[gameId][symId] = rel;
                skipped++;
                continue;
            }
            try {
                // sharp() pipeline writes the webp itself; on error sharp
                // throws before emitting any output file. We update the JSON
                // map BEFORE unlinking the PNG so a kill between unlink +
                // map-persist can never leave a .webp on disk that the map
                // doesn't know about. Square resize via { width, height, fit:'cover' }.
                await sharp(pngPath)
                    .resize({ width: SIZE, height: SIZE, fit: 'cover', position: 'centre', withoutEnlargement: false })
                    .webp({ quality: QUALITY, effort: 5 })
                    .toFile(webpPath);
                map[gameId][symId] = rel;
                persistMap(map);
                if (!KEEP_PNG) fs.unlinkSync(pngPath);
                const kb = (fs.statSync(webpPath).size / 1024).toFixed(0);
                console.log(`[optimize-sym] ${gameId}/${symId}.webp (${kb} KB)`);
                done++;
            } catch (err) {
                console.error(`[optimize-sym] FAIL ${gameId}/${symId}: ${err.message}`);
                failed++;
            }
        }
    }

    persistMap(map);
    const totalTiles = Object.values(map).reduce((n, o) => n + Object.keys(o).length, 0);
    console.log(`[optimize-sym] done — converted ${done}, skipped ${skipped}, failed ${failed}; manifest has ${Object.keys(map).length} game(s) / ${totalTiles} tiles`);
}

main().catch(e => { console.error(e); process.exit(1); });
