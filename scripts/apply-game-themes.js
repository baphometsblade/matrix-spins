'use strict';

/**
 * One-shot migration: inject per-game `bgGradient` (themed) and
 * `thumbnail` (path) fields into js/game-registry.js.
 *
 * Why this exists:
 *   - The lobby renderGames code already reads `game.bgGradient` (it
 *     falls back to a studio-color wash when missing) — but the
 *     registry never populated it, so all 100 cards share one of 8
 *     studio gradients regardless of theme.
 *   - getGameThumbnail() falls back to a hash-of-id random pool when
 *     `game.thumbnail` is absent — so players see fruit art on dragon
 *     slots, ancient-Egypt art on samurai slots, etc.
 *
 * Run once:
 *   node scripts/apply-game-themes.js
 *
 * Idempotent: skips any game that already has both fields populated.
 *
 * The thumbnail map comes from `data/game-thumbnails.json` (a subagent
 * produces this by fuzzy-matching the 100 game names against the 215
 * thumbnail filenames in assets/thumbnails/). If the JSON file is
 * absent, this script will skip the thumbnail injection and only
 * apply gradients — useful for incremental development.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const REGISTRY_SRC = path.join(ROOT, 'js', 'game-registry.js');
const REGISTRY_DIST = path.join(ROOT, 'dist', 'js', 'game-registry.js');
const THUMB_MAP_PATH = path.join(ROOT, 'data', 'game-thumbnails.json');

// Themed gradient palette keyed by the `theme` field. Curated for
// readability over a slot-art thumbnail (mid-saturation, dark edges so
// white text reads). All gradients use 135deg for a consistent diagonal.
const GRADIENTS_BY_THEME = {
    'Fantasy / Magic':           'linear-gradient(135deg, #6B21A8 0%, #C026D3 50%, #F472B6 100%)',
    'Fruit Classics':            'linear-gradient(135deg, #DB2777 0%, #FB923C 50%, #FACC15 100%)',
    'Space / Sci-Fi':            'linear-gradient(135deg, #0F172A 0%, #1E3A8A 50%, #06B6D4 100%)',
    'Ancient Egypt / Mythology': 'linear-gradient(135deg, #92400E 0%, #D4A853 50%, #FCD34D 100%)',
    'Asian / Lucky':             'linear-gradient(135deg, #7F1D1D 0%, #DC2626 50%, #FBBF24 100%)',
    'Australian / Outback':      'linear-gradient(135deg, #78350F 0%, #C2410C 50%, #FB923C 100%)',
    'Horror / Dark':             'linear-gradient(135deg, #0A0A0A 0%, #450A0A 50%, #991B1B 100%)',
    'Wildcard / Experimental':   'linear-gradient(135deg, #C026D3 0%, #38BDF8 50%, #FACC15 100%)',
    'Animals / Wildlife':        'linear-gradient(135deg, #064E3B 0%, #15803D 50%, #84CC16 100%)',
    'Wildcard':                  'linear-gradient(135deg, #475569 0%, #94A3B8 50%, #E2E8F0 100%)',
    // Fallback if theme is missing or unknown.
    '_default':                  'linear-gradient(135deg, #1F2937 0%, #4B5563 100%)',
};

function gradientFor(theme) {
    return GRADIENTS_BY_THEME[theme] || GRADIENTS_BY_THEME._default;
}

function loadThumbnailMap() {
    if (!fs.existsSync(THUMB_MAP_PATH)) {
        console.warn('[apply-game-themes] no thumbnail map at ' + THUMB_MAP_PATH + ' — skipping thumbnail injection');
        return {};
    }
    try {
        return JSON.parse(fs.readFileSync(THUMB_MAP_PATH, 'utf8'));
    } catch (err) {
        console.error('[apply-game-themes] failed to parse thumbnail map:', err.message);
        process.exit(1);
    }
}

// Inject (or update) `bgGradient` and `thumbnail` fields into each
// game object in the registry. Strategy: regex-find each game by
// `id: 'X'`, then locate that game object's closing brace and inject
// the fields just before it. Skip games that already have both
// fields. Preserve all other formatting/comments.
function applyToRegistry(filePath, thumbnailMap) {
    if (!fs.existsSync(filePath)) {
        console.warn('[apply-game-themes] ' + filePath + ' does not exist — skipping');
        return { written: false, changed: 0 };
    }
    const src = fs.readFileSync(filePath, 'utf8');

    // Match each game object: find `{ ... id: '...' ... }` blocks
    // inside the `window.GAME_REGISTRY = [ ... ]` array. We scan
    // character-by-character with bracket-depth tracking so a nested
    // array (symbols, features) doesn't trip the match.
    const registryStart = src.indexOf('window.GAME_REGISTRY');
    if (registryStart < 0) {
        console.error('[apply-game-themes] could not find window.GAME_REGISTRY in ' + filePath);
        return { written: false, changed: 0 };
    }
    const arrayStart = src.indexOf('[', registryStart);
    if (arrayStart < 0) return { written: false, changed: 0 };

    // Find the matching `]` for that array.
    let depth = 0;
    let arrayEnd = -1;
    let inStr = null;
    for (let i = arrayStart; i < src.length; i++) {
        const ch = src[i];
        if (inStr) {
            if (ch === '\\') { i++; continue; }
            if (ch === inStr) inStr = null;
            continue;
        }
        if (ch === '\'' || ch === '"' || ch === '`') { inStr = ch; continue; }
        if (ch === '[' || ch === '{') depth++;
        else if (ch === ']' || ch === '}') {
            depth--;
            if (depth === 0) { arrayEnd = i; break; }
        }
    }
    if (arrayEnd < 0) {
        console.error('[apply-game-themes] could not find end of GAME_REGISTRY array');
        return { written: false, changed: 0 };
    }

    // Walk each top-level object inside the array.
    const before = src.slice(0, arrayStart + 1);
    const after  = src.slice(arrayEnd);
    const body   = src.slice(arrayStart + 1, arrayEnd);

    // Split into objects by scanning for top-level `{...}` blocks.
    const objects = [];
    {
        let i = 0;
        while (i < body.length) {
            // Skip whitespace/commas
            while (i < body.length && /[\s,]/.test(body[i])) i++;
            if (i >= body.length) break;
            if (body[i] !== '{') { i++; continue; }
            const start = i;
            let d = 0;
            let str = null;
            while (i < body.length) {
                const c = body[i];
                if (str) {
                    if (c === '\\') { i += 2; continue; }
                    if (c === str) str = null;
                    i++;
                    continue;
                }
                if (c === '\'' || c === '"' || c === '`') { str = c; i++; continue; }
                if (c === '{') d++;
                else if (c === '}') { d--; if (d === 0) { i++; break; } }
                i++;
            }
            objects.push(body.slice(start, i));
        }
    }

    let changed = 0;
    const rewritten = objects.map(obj => {
        const idMatch = obj.match(/id:\s*'([^']+)'/);
        const themeMatch = obj.match(/theme:\s*'([^']+)'/);
        if (!idMatch) return obj;
        const id = idMatch[1];
        const theme = themeMatch ? themeMatch[1] : null;

        const hasGradient  = /\bbgGradient\s*:/.test(obj);
        const hasThumbnail = /\bthumbnail\s*:/.test(obj);

        const additions = [];
        if (!hasGradient) {
            additions.push("    bgGradient: '" + gradientFor(theme) + "'");
        }
        if (!hasThumbnail && thumbnailMap[id]) {
            additions.push("    thumbnail: 'assets/thumbnails/" + thumbnailMap[id] + "'");
        }
        if (additions.length === 0) return obj;
        changed++;

        // Inject before the closing brace. We rebuild the tail so the
        // formatting stays clean — strip trailing whitespace off the
        // existing head, append a comma if the last field doesn't have
        // one, then add the new fields and the closing brace at the
        // same 2-space indent the registry uses.
        const lastBrace = obj.lastIndexOf('}');
        const head = obj.slice(0, lastBrace).replace(/\s+$/, '');
        const comma = head.endsWith(',') ? '' : ',';
        return head + comma + '\n' + additions.join(',\n') + '\n  }';
    });

    if (changed === 0) {
        console.log('[apply-game-themes] ' + path.basename(filePath) + ' — no changes (already up to date)');
        return { written: false, changed: 0 };
    }

    const out = before + rewritten.join(',\n  ') + after;
    fs.writeFileSync(filePath, out);
    console.log('[apply-game-themes] ' + path.basename(filePath) + ' — wrote ' + changed + ' updated game(s)');
    return { written: true, changed: changed };
}

function main() {
    const thumbMap = loadThumbnailMap();
    console.log('[apply-game-themes] thumbnail map entries:', Object.keys(thumbMap).length);
    const themes = Object.keys(GRADIENTS_BY_THEME).filter(k => !k.startsWith('_'));
    console.log('[apply-game-themes] gradient themes registered:', themes.length, '+', '_default');
    applyToRegistry(REGISTRY_SRC, thumbMap);
    applyToRegistry(REGISTRY_DIST, thumbMap);
}

if (require.main === module) main();

module.exports = { gradientFor, GRADIENTS_BY_THEME };
