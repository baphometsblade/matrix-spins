#!/usr/bin/env node
'use strict';

/**
 * Import Fooocus-generated AI assets into the Casino asset tree.
 *
 * Reads every log.html in C:/Users/markm/FooocusApp/outputs/*, parses
 * (filename → prompt) pairs, classifies each image by prompt pattern,
 * and copies the best candidate into the right asset path.
 *
 * Prompt patterns used:
 *   "masterpiece, <Game Name> casino slot machine promotional art"  → THUMBNAIL
 *   "masterpiece, cinematic <Game Name> landscape"                   → BACKGROUND
 *   "masterpiece, ... hyper-detailed <symbol> icon for <Game Name>" → SYMBOL
 *   "masterpiece, ... hyper-detailed wild <name> symbol for <Game>" → WILD
 *
 * For each matched game the script picks the largest candidate file per slot
 * (larger = more detail) and produces:
 *   assets/thumbnails/<id>.webp               (400×300)
 *   assets/backgrounds/slots/<id>_bg.webp     (1920×1080)
 *   assets/game_symbols/<id>/<sym>.webp       (256×256)
 */

const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const games = require('../shared/game-definitions');

const OUTPUTS_ROOT = 'C:/Users/markm/FooocusApp/outputs';
const REPO_ROOT = path.join(__dirname, '..');

// ────────────────────────────────────────────────────────────────────
function parseLog(logPath) {
    const html = fs.readFileSync(logPath, 'utf8');
    const rows = [];
    html.split('<div id="').forEach(block => {
        const f = block.match(/^([^"]+)_png" class=/);
        const p = block.match(/<td class='label'>Prompt<\/td><td class='value'>([^<]+)/);
        const r = block.match(/<td class='label'>Resolution<\/td><td class='value'>\(([0-9]+),\s*([0-9]+)\)/);
        if (!f || !p || !r) return;
        rows.push({ file: f[1] + '.png', prompt: p[1].trim(), w: +r[1], h: +r[2] });
    });
    return rows;
}

function collectAll() {
    const out = [];
    for (const day of fs.readdirSync(OUTPUTS_ROOT).filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d))) {
        const logPath = path.join(OUTPUTS_ROOT, day, 'log.html');
        if (!fs.existsSync(logPath)) continue;
        for (const r of parseLog(logPath)) {
            const full = path.join(OUTPUTS_ROOT, day, r.file);
            if (fs.existsSync(full)) out.push({ ...r, full, size: fs.statSync(full).size, day });
        }
    }
    return out;
}

// ────────────────────────────────────────────────────────────────────
//  Matching
// ────────────────────────────────────────────────────────────────────
function normalize(s) {
    return String(s || '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
}

/**
 * Extract the game-name chunk from a structured prompt.
 * Handles forms like:
 *   "masterpiece, <NAME> casino slot machine promotional art ..."
 *   "masterpiece, cinematic <NAME> landscape, ..."
 *   "masterpiece, best quality, hyper-detailed ... icon for <NAME> casino slot ..."
 */
function extractGameHint(prompt) {
    const p = prompt.replace(/\s+/g, ' ');
    // Pattern 1: "<NAME> casino slot machine promotional art"
    let m = p.match(/masterpiece,\s*([^,]+?)\s+casino\s+slot\s+machine\s+promotional/i);
    if (m) return m[1];
    // Pattern 2: "cinematic <NAME> landscape"
    m = p.match(/cinematic\s+([^,]+?)\s+landscape/i);
    if (m) return m[1];
    // Pattern 3: "icon for <NAME> casino slot"
    m = p.match(/icon\s+for\s+([^,]+?)\s+casino\s+slot/i);
    if (m) return m[1];
    // Pattern 4: "symbol for <NAME> casino slot"
    m = p.match(/symbol\s+for\s+([^,]+?)\s+casino\s+slot/i);
    if (m) return m[1];
    return null;
}

function classifyPrompt(prompt) {
    if (/casino\s+slot\s+machine\s+promotional/i.test(prompt)) return 'thumb';
    if (/cinematic.+landscape/i.test(prompt)) return 'bg';
    const m = prompt.match(/hyper-detailed\s+(.+?)\s+(?:icon|symbol)\s+for\s+/i);
    if (m) return 'symbol:' + normalize(m[1]);
    return null;
}

// Build a rich game-hint lookup: game.name, game.id, and thematic keywords
function buildGameIndex() {
    // Additional fuzzy aliases pulled from the symbols list of each game —
    // if the prompt mentions a distinctive symbol name from exactly one game,
    // we can use it to disambiguate.
    const byHint = new Map(); // normalized hint → game
    for (const g of games) {
        [g.name, g.id.replace(/_/g, ' ')].forEach(n => {
            const k = normalize(n);
            if (k && k.length >= 3) byHint.set(k, g);
        });
    }
    return byHint;
}

function matchGame(hint, byHint) {
    if (!hint) return null;
    const h = normalize(hint);
    if (!h) return null;
    // Direct
    if (byHint.has(h)) return byHint.get(h);
    // Contains a full game name / id
    for (const [k, g] of byHint) {
        if (k.length >= 5 && h.includes(k)) return g;
    }
    // Hint is contained within a game name (e.g. "samurai" ⊂ "samurai honor")
    for (const [k, g] of byHint) {
        if (h.length >= 5 && k.includes(h)) return g;
    }
    // Token overlap
    const hTokens = new Set(h.split(' ').filter(t => t.length > 2));
    if (hTokens.size === 0) return null;
    let best = null, bestScore = 0;
    for (const [k, g] of byHint) {
        const kTokens = new Set(k.split(' ').filter(t => t.length > 2));
        if (kTokens.size === 0) continue;
        let hits = 0;
        for (const t of hTokens) if (kTokens.has(t)) hits++;
        const score = hits / Math.max(hTokens.size, kTokens.size);
        if (score > bestScore && hits >= 2) { best = g; bestScore = score; }
    }
    return bestScore >= 0.5 ? best : null;
}

// Map a parsed symbol hint to a real symbol filename in a game.
// Symbol hint examples: "mega diamond", "wild diamond cutter", "sapphire",
// "cherry blossom". Game symbols look like "s1_lollipop", "wild_empress", etc.
function matchSymbol(symHint, game) {
    const syms = [...(game.symbols || [])];
    if (game.wildSymbol && !syms.includes(game.wildSymbol)) syms.push(game.wildSymbol);
    if (game.scatterSymbol && !syms.includes(game.scatterSymbol)) syms.push(game.scatterSymbol);

    const h = normalize(symHint);
    const isWild = h.startsWith('wild ') || symHint.toLowerCase().startsWith('wild');
    const hClean = h.replace(/^wild\s+/, '');

    // Exact match on cleaned symbol name (strip prefix and _)
    for (const s of syms) {
        const cleaned = normalize(s.replace(/^s\d+_|^wild_|^scatter_/, '').replace(/_/g, ' '));
        if (cleaned === hClean) {
            if (isWild && !s.startsWith('wild')) continue;
            return s;
        }
    }
    // Partial: last token of hint in symbol name
    const hTokens = hClean.split(' ');
    const lastTok = hTokens[hTokens.length - 1];
    if (lastTok && lastTok.length >= 3) {
        for (const s of syms) {
            const cleaned = normalize(s);
            if (cleaned.includes(lastTok)) return s;
        }
    }
    // Wild fallback
    if (isWild && game.wildSymbol) return game.wildSymbol;
    return null;
}

// ────────────────────────────────────────────────────────────────────
async function main() {
    console.log('Collecting Fooocus images...');
    const imgs = collectAll();
    console.log('  Found', imgs.length, 'images');

    const byHint = buildGameIndex();

    // Classify and bucket
    const byGame = {}; // gameId → { thumb: [], bg: [], symbols: { symName: [] } }
    let classified = 0, unclassified = 0, unmatched = 0;

    for (const img of imgs) {
        const kind = classifyPrompt(img.prompt);
        if (!kind) { unclassified++; continue; }
        classified++;

        const hint = extractGameHint(img.prompt);
        const game = matchGame(hint, byHint);
        if (!game) { unmatched++; continue; }

        const gid = game.id;
        if (!byGame[gid]) byGame[gid] = { thumb: [], bg: [], symbols: {} };
        if (kind === 'thumb') {
            byGame[gid].thumb.push(img);
        } else if (kind === 'bg') {
            byGame[gid].bg.push(img);
        } else if (kind.startsWith('symbol:')) {
            const symHint = kind.slice(7);
            const sym = matchSymbol(symHint, game);
            if (sym) {
                if (!byGame[gid].symbols[sym]) byGame[gid].symbols[sym] = [];
                byGame[gid].symbols[sym].push(img);
            }
        }
    }

    console.log('  Classified:', classified, '| Unclassified:', unclassified, '| Matched games:', Object.keys(byGame).length, '| Hint no-match:', unmatched);

    // Import — pick the BIGGEST image per slot (more detail = more likely the final render)
    let tC = 0, bC = 0, sC = 0;
    for (const [gid, buckets] of Object.entries(byGame)) {
        // Thumbnail
        const t = buckets.thumb.sort((a, b) => b.size - a.size)[0];
        if (t) {
            const out = path.join(REPO_ROOT, 'assets', 'thumbnails', gid + '.webp');
            try {
                await sharp(t.full).resize(400, 300, { fit: 'cover' }).webp({ quality: 88 }).toFile(out);
                tC++;
            } catch (e) { console.warn('  [FAIL] thumb', gid, e.message); }
        }
        // Background
        const b = buckets.bg.sort((a, b) => b.size - a.size)[0];
        if (b) {
            const out = path.join(REPO_ROOT, 'assets', 'backgrounds', 'slots', gid + '_bg.webp');
            try {
                await sharp(b.full).resize(1920, 1080, { fit: 'cover' }).webp({ quality: 80 }).toFile(out);
                bC++;
            } catch (e) { console.warn('  [FAIL] bg', gid, e.message); }
        }
        // Symbols
        const symDir = path.join(REPO_ROOT, 'assets', 'game_symbols', gid);
        if (!fs.existsSync(symDir)) fs.mkdirSync(symDir, { recursive: true });
        for (const [sym, list] of Object.entries(buckets.symbols)) {
            const s = list.sort((a, b) => b.size - a.size)[0];
            if (!s) continue;
            const out = path.join(symDir, sym + '.webp');
            try {
                await sharp(s.full).resize(256, 256, { fit: 'cover' }).webp({ quality: 90 }).toFile(out);
                sC++;
            } catch (e) { console.warn('  [FAIL] sym', gid + '/' + sym, e.message); }
        }
    }

    console.log('\n=== IMPORT SUMMARY ===');
    console.log('  Thumbnails:', tC);
    console.log('  Backgrounds:', bC);
    console.log('  Symbols:', sC);

    console.log('\nMatched games (sorted by coverage):');
    const scored = Object.entries(byGame).map(([gid, b]) => ({
        gid,
        thumb: b.thumb.length > 0,
        bg: b.bg.length > 0,
        symCount: Object.keys(b.symbols).length
    })).sort((a, b) => (b.thumb + b.bg + b.symCount) - (a.thumb + a.bg + a.symCount));
    scored.slice(0, 40).forEach(s => console.log('  ' + s.gid.padEnd(24) + ' thumb:' + (s.thumb ? '✓' : ' ') + ' bg:' + (s.bg ? '✓' : ' ') + ' syms:' + s.symCount));

    const notMatched = games.filter(g => !byGame[g.id]);
    console.log('\nUnmatched (' + notMatched.length + '):');
    notMatched.slice(0, 20).forEach(g => console.log('  ' + g.id.padEnd(24) + ' "' + g.name + '"'));
    if (notMatched.length > 20) console.log('  ... and', notMatched.length - 20, 'more');
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });
