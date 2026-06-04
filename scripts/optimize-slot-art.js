'use strict';

/**
 * Post-process the raw Fooocus output. The generator writes full-size PNGs
 * (~896x1152, ~1.5 MB each) to assets/thumbnails/ai/. Those are far too
 * heavy to serve as lobby card art, so this converts each to a
 * web-optimised WebP (portrait, max width 448, quality 82 — ~40-70 KB),
 * deletes the PNG original, and rewrites data/game-thumbnails.json to point
 * at the .webp.
 *
 * Idempotent: a PNG with an up-to-date .webp sibling is skipped unless
 * --force. Run after `node scripts/generate-slot-art.js`.
 *
 * Usage: node scripts/optimize-slot-art.js [--force] [--keep-png]
 */

const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const { writeAtomicFsync } = require('./lib/symbol-art-manifest');

const ROOT = path.resolve(__dirname, '..');
const AI_DIR = path.join(ROOT, 'assets', 'thumbnails', 'ai');
const THUMB_MAP = path.join(ROOT, 'data', 'game-thumbnails.json');

const FORCE = process.argv.includes('--force');
const KEEP_PNG = process.argv.includes('--keep-png');

const WIDTH = 448;   // 2x a ~224px card; portrait height follows aspect
const QUALITY = 82;
const SAFE_ID = /^[a-z0-9][a-z0-9-]*$/i;

// Atomic, fsync-safe write. Delegates to the shared lib so this script and
// its sibling generate-slot-art.js use the SAME write primitive — the prior
// in-script writeAtomic skipped fsync between writeFileSync and renameSync,
// the exact failure mode that wiped data/symbol-art.json under a Windows
// crash-replay (NTFS commits the rename's directory entry before the data
// blocks flush; on power-loss the rebooted FS sees a new directory entry
// pointing at uncommitted clusters whose contents are whatever was there
// before — often whitespace from a prior memory page).
const writeAtomic = writeAtomicFsync;

function persistMap(map) {
    writeAtomic(THUMB_MAP, Buffer.from(JSON.stringify(map, null, 2) + '\n', 'utf8'));
}

async function main() {
    if (!fs.existsSync(AI_DIR)) { console.error('No AI art dir:', AI_DIR); process.exit(1); }
    const pngs = fs.readdirSync(AI_DIR).filter(f => f.toLowerCase().endsWith('.png'));
    if (!pngs.length) { console.log('[optimize] no PNGs to convert.'); }

    const map = fs.existsSync(THUMB_MAP) ? JSON.parse(fs.readFileSync(THUMB_MAP, 'utf8')) : {};
    let done = 0, skipped = 0, failed = 0;

    for (const png of pngs) {
        const id = png.replace(/\.png$/i, '');
        if (!SAFE_ID.test(id)) { console.error(`[optimize] SKIP unsafe id: ${id}`); failed++; continue; }
        const pngPath = path.join(AI_DIR, png);
        const webpPath = path.join(AI_DIR, id + '.webp');

        if (!FORCE && fs.existsSync(webpPath) &&
            fs.statSync(webpPath).mtimeMs >= fs.statSync(pngPath).mtimeMs) {
            map[id] = 'ai/' + id + '.webp';
            skipped++;
            continue;
        }
        try {
            // sharp() pipeline writes the webp file itself; it's "atomic
            // enough" — on error sharp throws before emitting any output
            // file. We then update the JSON map BEFORE unlinking the PNG
            // so a kill between unlink + map-persist can never leave a
            // .webp on disk that the map doesn't know about.
            await sharp(pngPath)
                .resize({ width: WIDTH, withoutEnlargement: true })
                .webp({ quality: QUALITY, effort: 5 })
                .toFile(webpPath);
            map[id] = 'ai/' + id + '.webp';
            persistMap(map);
            if (!KEEP_PNG) fs.unlinkSync(pngPath);
            const kb = (fs.statSync(webpPath).size / 1024).toFixed(0);
            console.log(`[optimize] ${id}.webp (${kb} KB)`);
            done++;
        } catch (err) {
            console.error(`[optimize] FAIL ${id}: ${err.message}`);
            failed++;
        }
    }

    persistMap(map);
    console.log(`[optimize] done — converted ${done}, skipped ${skipped}, failed ${failed}; map has ${Object.keys(map).length} entries`);
}

main().catch(e => { console.error(e); process.exit(1); });
