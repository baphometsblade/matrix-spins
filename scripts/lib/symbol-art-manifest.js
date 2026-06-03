'use strict';

/**
 * Single source of truth for reading and writing data/symbol-art.json.
 *
 * Three writers used to ship their own duplicated writeAtomic + loadManifest
 * implementations (generate-symbol-art.js, optimize-symbol-art.js,
 * rebuild-symbol-art-manifest.js). They drifted, none of them fsync'd, and
 * none rejected an all-whitespace manifest at load time. That combination
 * silently overwrote a corrupted manifest with `{}` and lost all coverage
 * after the first generated tile.
 *
 * This module fixes those three failure modes in ONE place:
 *
 *   1. writeAtomicFsync — open + write + fsync + close + rename. On Windows
 *      a plain renameSync after a buffered writeFileSync commits the rename
 *      before the data blocks have necessarily flushed; a power-loss replay
 *      can leave the renamed file pointing at uncommitted clusters whose
 *      contents are leftover memory pages (often all 0x20). fsync closes
 *      that window.
 *
 *   2. loadManifest — refuses to silently downgrade. If the manifest is
 *      missing, empty, all-whitespace, malformed JSON, or shape-invalid AND
 *      there are tiles already on disk, we REBUILD from disk rather than
 *      return `{}`. The next persistManifest can no longer wipe coverage.
 *
 *   3. persistManifest — shape-validates the in-memory map before writing.
 *      JSON.parse(JSON.stringify(map)) round-trip + structural assertions
 *      guarantee we never persist a degenerate value.
 *
 * Format (matches what every reader already expects):
 *   { "<gameId>": { "<symbolId>": "<gameId>/<symbolId>.webp|png" } }
 */

const fs = require('fs');
const path = require('path');

const SAFE_ID = /^[a-z0-9][a-z0-9_-]*$/i;
const MIN_TILE_BYTES = 256;

function writeAtomicFsync(targetPath, buffer) {
    const tmp = targetPath + '.' + process.pid + '.tmp';
    const fd = fs.openSync(tmp, 'w');
    try {
        fs.writeSync(fd, buffer, 0, buffer.length, 0);
        fs.fsyncSync(fd);
    } finally {
        fs.closeSync(fd);
    }
    fs.renameSync(tmp, targetPath);
}

function looksAllWhitespace(raw) {
    if (typeof raw !== 'string' || raw.length === 0) return true;
    for (let i = 0; i < raw.length; i++) {
        const c = raw.charCodeAt(i);
        if (c !== 0x20 && c !== 0x09 && c !== 0x0A && c !== 0x0D) return false;
    }
    return true;
}

function validateShape(map) {
    if (!map || typeof map !== 'object' || Array.isArray(map)) {
        throw new Error('manifest must be a plain object');
    }
    for (const gameId of Object.keys(map)) {
        if (!SAFE_ID.test(gameId)) throw new Error('unsafe gameId: ' + gameId);
        const syms = map[gameId];
        if (!syms || typeof syms !== 'object' || Array.isArray(syms)) {
            throw new Error('manifest[' + gameId + '] must be an object');
        }
        for (const symId of Object.keys(syms)) {
            if (!SAFE_ID.test(symId)) throw new Error('unsafe symId: ' + gameId + '/' + symId);
            const rel = syms[symId];
            if (typeof rel !== 'string') throw new Error('manifest[' + gameId + '][' + symId + '] must be a string path');
            const m = rel.match(/^([a-z0-9][a-z0-9_-]*)\/([a-z0-9][a-z0-9_-]*)\.(webp|png)$/i);
            if (!m) throw new Error('invalid path: ' + rel);
            if (m[1] !== gameId) throw new Error('path gameId mismatch: ' + rel + ' under ' + gameId);
            if (m[2] !== symId) throw new Error('path symId mismatch: ' + rel + ' under ' + symId);
        }
    }
}

function rebuildFromDisk(symRoot) {
    const out = {};
    if (!fs.existsSync(symRoot)) return out;

    const gameDirs = fs.readdirSync(symRoot, { withFileTypes: true })
        .filter(d => d.isDirectory())
        .map(d => d.name)
        .filter(id => SAFE_ID.test(id))
        .sort();

    for (const gameId of gameDirs) {
        const dir = path.join(symRoot, gameId);
        const files = fs.readdirSync(dir).filter(f => /\.(webp|png)$/i.test(f));
        if (!files.length) continue;

        const bySym = new Map();
        for (const file of files) {
            const m = file.match(/^(.+)\.(webp|png)$/i);
            if (!m) continue;
            const symId = m[1];
            const ext = m[2].toLowerCase();
            if (!SAFE_ID.test(symId)) continue;

            let size = 0;
            try { size = fs.statSync(path.join(dir, file)).size; } catch (_) { /* fallthrough */ }
            if (size < MIN_TILE_BYTES) continue;

            const prev = bySym.get(symId);
            if (!prev || (ext === 'webp' && prev.ext === 'png')) {
                bySym.set(symId, { ext, rel: gameId + '/' + file });
            }
        }
        if (!bySym.size) continue;

        const symObj = {};
        for (const sym of [...bySym.keys()].sort()) symObj[sym] = bySym.get(sym).rel;
        out[gameId] = symObj;
    }
    return out;
}

function countDiskTiles(symRoot) {
    if (!fs.existsSync(symRoot)) return 0;
    let n = 0;
    for (const d of fs.readdirSync(symRoot, { withFileTypes: true })) {
        if (!d.isDirectory()) continue;
        try {
            for (const f of fs.readdirSync(path.join(symRoot, d.name))) {
                if (/\.(webp|png)$/i.test(f)) n++;
            }
        } catch (_) { /* unreadable subdir — skip */ }
    }
    return n;
}

/**
 * Load the manifest, refusing to silently downgrade on corruption.
 *
 * Returns an object always. Behaviour by case:
 *   - missing file              → {}
 *   - whitespace/empty/garbage  → rebuild-from-disk when tiles exist, else {}
 *   - shape-invalid             → rebuild-from-disk when tiles exist, else {}
 *   - good                      → parsed map
 */
function loadManifest(manifestPath, symRoot) {
    if (!fs.existsSync(manifestPath)) return {};

    let raw;
    try { raw = fs.readFileSync(manifestPath, 'utf8'); }
    catch (e) {
        console.error('[manifest] WARN unreadable file:', e.message);
        return rebuildFromDisk(symRoot);
    }

    if (looksAllWhitespace(raw)) {
        const tileCount = countDiskTiles(symRoot);
        if (tileCount > 0) {
            console.error('[manifest] WARN whitespace-only manifest detected; rebuilding from ' + tileCount + ' on-disk tiles');
            return rebuildFromDisk(symRoot);
        }
        console.error('[manifest] WARN whitespace-only manifest with empty disk; starting fresh');
        return {};
    }

    let parsed;
    try { parsed = JSON.parse(raw); }
    catch (e) {
        const tileCount = countDiskTiles(symRoot);
        console.error('[manifest] WARN unparseable JSON: ' + e.message + (tileCount > 0 ? '; rebuilding from ' + tileCount + ' on-disk tiles' : '; starting fresh'));
        return tileCount > 0 ? rebuildFromDisk(symRoot) : {};
    }

    try { validateShape(parsed); return parsed; }
    catch (e) {
        const tileCount = countDiskTiles(symRoot);
        console.error('[manifest] WARN shape-invalid: ' + e.message + (tileCount > 0 ? '; rebuilding from ' + tileCount + ' on-disk tiles' : '; starting fresh'));
        return tileCount > 0 ? rebuildFromDisk(symRoot) : {};
    }
}

/**
 * Persist the manifest after shape-validation + atomic-fsync write.
 *
 * Throws (and does NOT write) if the map's shape is invalid. Callers should
 * let that crash the run rather than catch-and-continue — a corrupted in-
 * memory map is a bug we want to surface, not a state we want to ship.
 */
function persistManifest(manifestPath, map) {
    validateShape(map);
    const body = JSON.stringify(map, null, 2) + '\n';
    JSON.parse(body); // round-trip sanity — would throw on a non-serialisable value.
    writeAtomicFsync(manifestPath, Buffer.from(body, 'utf8'));
}

module.exports = {
    SAFE_ID,
    MIN_TILE_BYTES,
    writeAtomicFsync,
    looksAllWhitespace,
    validateShape,
    rebuildFromDisk,
    countDiskTiles,
    loadManifest,
    persistManifest,
};
