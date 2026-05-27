'use strict';

/**
 * One-shot migration: stagger per-game `minBet` and `maxBet` across the
 * 100-game registry so they're no longer all identical at 0.20 / 100.00.
 *
 * Why this exists:
 *   Industry premium operators use the bet range to signal game tier:
 *   classic-fruit / low-volatility slots invite smaller stakes, while
 *   high-volatility jackpot / dragon / horror games stake higher. With
 *   all 100 games at the same range, every game's stake ladder looks
 *   identical — players have no signal that they should think of "Wolf
 *   Pack Frenzy" differently from "Sunshine Lemon Drop".
 *
 *   This migration produces ~24 distinct bet-range pairs across the 100
 *   games, keyed off (themeCategory × volatility). It's idempotent and
 *   non-destructive — already-staggered games keep their values.
 *
 * Run once:
 *   node scripts/apply-bet-ranges.js
 *
 * After running, regenerate the dist bundle.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const REGISTRY_SRC = path.join(ROOT, 'js', 'game-registry.js');
const REGISTRY_DIST = path.join(ROOT, 'dist', 'js', 'game-registry.js');

// Bet ranges keyed by (themeCategory + volatility). Themes that share
// the same "feel" (Asian/Lucky and Space/Sci-Fi both invite high
// stakes due to jackpot/cosmic vibe; Fruit Classics invite low stakes
// due to classic-slot pacing) share scale factors.
const BET_RANGES = {
    // Classic fruit — accessible, smaller stakes
    'Fruit Classics/low':    { min: 0.10, max: 40 },
    'Fruit Classics/medium': { min: 0.10, max: 80 },
    'Fruit Classics/high':   { min: 0.20, max: 150 },
    // Fantasy/Magic — mid-tier
    'Fantasy / Magic/low':    { min: 0.15, max: 60 },
    'Fantasy / Magic/medium': { min: 0.20, max: 120 },
    'Fantasy / Magic/high':   { min: 0.40, max: 250 },
    // Ancient Egypt — premium feel, slightly higher
    'Ancient Egypt / Mythology/low':    { min: 0.20, max: 80 },
    'Ancient Egypt / Mythology/medium': { min: 0.25, max: 150 },
    'Ancient Egypt / Mythology/high':   { min: 0.50, max: 250 },
    // Space — invites high stakes (jackpot tier)
    'Space / Sci-Fi/low':    { min: 0.20, max: 100 },
    'Space / Sci-Fi/medium': { min: 0.30, max: 150 },
    'Space / Sci-Fi/high':   { min: 0.50, max: 300 },
    // Asian / Lucky — invites high stakes (fortune theme)
    'Asian / Lucky/low':    { min: 0.20, max: 100 },
    'Asian / Lucky/medium': { min: 0.25, max: 150 },
    'Asian / Lucky/high':   { min: 0.50, max: 300 },
    // Horror — mid-to-high
    'Horror / Dark/low':    { min: 0.20, max: 80 },
    'Horror / Dark/medium': { min: 0.30, max: 150 },
    'Horror / Dark/high':   { min: 0.50, max: 250 },
    // Animals — mid
    'Animals / Wildlife/low':    { min: 0.20, max: 80 },
    'Animals / Wildlife/medium': { min: 0.25, max: 120 },
    'Animals / Wildlife/high':   { min: 0.40, max: 200 },
    // Australian — mid
    'Australian / Outback/low':    { min: 0.20, max: 80 },
    'Australian / Outback/medium': { min: 0.25, max: 120 },
    'Australian / Outback/high':   { min: 0.40, max: 200 },
    // Wildcard / Experimental — varied for novelty
    'Wildcard / Experimental/low':    { min: 0.10, max: 50 },
    'Wildcard / Experimental/medium': { min: 0.20, max: 100 },
    'Wildcard / Experimental/high':   { min: 0.50, max: 250 },
    // Wildcard (alt theme name)
    'Wildcard/low':    { min: 0.10, max: 50 },
    'Wildcard/medium': { min: 0.20, max: 100 },
    'Wildcard/high':   { min: 0.50, max: 250 },
};

const DEFAULT_RANGE = { min: 0.20, max: 100 };

function rangeFor(game) {
    const key = (game.theme || '') + '/' + (game.volatility || '');
    return BET_RANGES[key] || DEFAULT_RANGE;
}

// Update one registry file in place. Reads each game object, finds its
// theme + volatility via regex, then rewrites minBet/maxBet fields.
function applyToRegistry(filePath) {
    if (!fs.existsSync(filePath)) {
        console.warn('[apply-bet-ranges] ' + filePath + ' does not exist — skipping');
        return { written: false, changed: 0 };
    }
    let src = fs.readFileSync(filePath, 'utf8');

    // Walk each top-level object inside `window.GAME_REGISTRY = [ ... ]`.
    // Use the same bracket-depth scan as apply-game-themes.js.
    const arrStart = src.indexOf('[', src.indexOf('window.GAME_REGISTRY'));
    let depth = 0;
    let arrEnd = -1;
    let inStr = null;
    for (let i = arrStart; i < src.length; i++) {
        const c = src[i];
        if (inStr) {
            if (c === '\\') { i++; continue; }
            if (c === inStr) inStr = null;
            continue;
        }
        if (c === '\'' || c === '"' || c === '`') { inStr = c; continue; }
        if (c === '[' || c === '{') depth++;
        else if (c === ']' || c === '}') {
            depth--;
            if (depth === 0) { arrEnd = i; break; }
        }
    }
    if (arrEnd < 0) {
        console.error('[apply-bet-ranges] could not find end of GAME_REGISTRY array in ' + filePath);
        return { written: false, changed: 0 };
    }

    const before = src.slice(0, arrStart + 1);
    const after  = src.slice(arrEnd);
    const body   = src.slice(arrStart + 1, arrEnd);

    // Split into objects.
    const objects = [];
    {
        let i = 0;
        while (i < body.length) {
            while (i < body.length && /[\s,]/.test(body[i])) i++;
            if (i >= body.length) break;
            if (body[i] !== '{') { i++; continue; }
            const s = i;
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
            objects.push(body.slice(s, i));
        }
    }

    let changed = 0;
    const rewritten = objects.map(obj => {
        const themeMatch = obj.match(/theme:\s*'([^']+)'/);
        const volMatch = obj.match(/volatility:\s*'([^']+)'/);
        if (!themeMatch || !volMatch) return obj;
        const theme = themeMatch[1];
        const vol = volMatch[1];
        const range = rangeFor({ theme: theme, volatility: vol });

        // Replace `minBet: N` and `maxBet: N` in place. If either field
        // is missing the regex won't match — fall through unchanged.
        let next = obj.replace(/minBet:\s*[\d.]+/g, 'minBet: ' + range.min);
        next = next.replace(/maxBet:\s*[\d.]+/g, 'maxBet: ' + range.max);
        if (next !== obj) changed++;
        return next;
    });

    if (changed === 0) {
        console.log('[apply-bet-ranges] ' + path.basename(filePath) + ' — no changes');
        return { written: false, changed: 0 };
    }

    const out = before + rewritten.join(',\n  ') + after;
    fs.writeFileSync(filePath, out);
    console.log('[apply-bet-ranges] ' + path.basename(filePath) + ' — wrote ' + changed + ' game(s)');
    return { written: true, changed: changed };
}

function main() {
    console.log('[apply-bet-ranges] mapping entries:', Object.keys(BET_RANGES).length);
    applyToRegistry(REGISTRY_SRC);
    applyToRegistry(REGISTRY_DIST);
}

if (require.main === module) main();

module.exports = { rangeFor, BET_RANGES };
