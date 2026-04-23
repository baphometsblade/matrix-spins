#!/usr/bin/env node
'use strict';

/**
 * Local asset generator.
 *
 * Writes one SVG per referenced asset under dist/assets/:
 *   - dist/assets/thumbnails/<gameId>.svg      (game card thumbnail)
 *   - dist/assets/game_symbols/<gameId>/<symbol>.svg  (per-game reel symbols)
 *   - dist/assets/ui/sym_<name>.svg            (11 generic fallback symbols)
 *
 * Reads game-definitions.js so it stays in lock-step with the catalog.
 * Running this before the bundler guarantees the manifest + the
 * <img> references line up — no 404s, no inline fallback render.
 *
 *   npm run gen:assets-local
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const DIST = path.join(ROOT, 'dist');
const ASSETS = path.join(DIST, 'assets');
const games = require(path.join(ROOT, 'shared/game-definitions.js'));

function ensureDir(p) { fs.mkdirSync(p, { recursive: true }); }
function xmlEscape(s) {
    return String(s).replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;' })[c]);
}

// ── THUMBNAILS ────────────────────────────────────────────────────

/**
 * Parse the CSS linear-gradient( …color… ) used in game.bgGradient into
 * the two hex stops. Falls back to sensible defaults if parsing fails.
 */
function parseGradient(css, fallback) {
    if (!css) return fallback;
    const m = css.match(/#([0-9a-fA-F]{3,8})[^#]*#([0-9a-fA-F]{3,8})/);
    if (!m) return fallback;
    return ['#' + m[1], '#' + m[2]];
}

function thumbnailSvg(game) {
    const [c1, c2] = parseGradient(game.bgGradient, ['#1a2332', '#3a4a5a']);
    const accent = game.accentColor || '#d4af37';
    const title = game.name || game.id;
    const initial = (title || '?').trim().charAt(0).toUpperCase();
    const grad = 'g_' + game.id;
    const tagText = (game.tag || '').toUpperCase();
    const tagFill = game.tagClass === 'tag-hot' ? '#e74c3c'
        : game.tagClass === 'tag-jackpot' ? '#d4af37'
        : game.tagClass === 'tag-new' ? '#27ae60'
        : '#7f8ca0';
    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 480 270" role="img" aria-label="' + xmlEscape(title) + '">' +
        '<defs>' +
            '<linearGradient id="' + grad + '" x1="0" y1="0" x2="1" y2="1">' +
                '<stop offset="0%" stop-color="' + c1 + '"/>' +
                '<stop offset="100%" stop-color="' + c2 + '"/>' +
            '</linearGradient>' +
            '<radialGradient id="' + grad + 'g" cx="30%" cy="25%" r="65%">' +
                '<stop offset="0%" stop-color="#ffffff" stop-opacity="0.28"/>' +
                '<stop offset="100%" stop-color="#ffffff" stop-opacity="0"/>' +
            '</radialGradient>' +
        '</defs>' +
        '<rect width="480" height="270" fill="url(#' + grad + ')"/>' +
        '<rect width="480" height="270" fill="url(#' + grad + 'g)"/>' +
        '<text x="240" y="170" text-anchor="middle" font-family="Helvetica,Arial,sans-serif" font-size="160" font-weight="900" fill="' + accent + '" opacity="0.85" letter-spacing="-4">' +
            xmlEscape(initial) +
        '</text>' +
        '<text x="240" y="225" text-anchor="middle" font-family="Helvetica,Arial,sans-serif" font-size="18" font-weight="700" fill="#ffffff" opacity="0.92" letter-spacing="2">' +
            xmlEscape(title.toUpperCase()) +
        '</text>' +
        (tagText ?
            '<rect x="18" y="18" rx="6" ry="6" width="' + (12 + tagText.length * 9) + '" height="22" fill="' + tagFill + '"/>' +
            '<text x="' + (24) + '" y="34" font-family="Helvetica,Arial,sans-serif" font-size="12" font-weight="800" fill="#ffffff" letter-spacing="1.5">' +
                xmlEscape(tagText) +
            '</text>'
        : '') +
    '</svg>';
}

// ── PER-GAME REEL SYMBOLS ─────────────────────────────────────────

function parseSymbolId(symbolName) {
    const m = /^s([1-5])_?(.*)$/i.exec(symbolName);
    if (m) return { tier: parseInt(m[1], 10), role: 'regular', label: (m[2] || '').replace(/_/g, ' ') };
    if (/^wild/i.test(symbolName)) return { tier: 6, role: 'wild', label: symbolName.replace(/^wild_?/i, '').replace(/_/g, ' ') || 'wild' };
    if (/^scatter/i.test(symbolName) || /_scatter$/i.test(symbolName)) {
        return { tier: 5, role: 'scatter', label: symbolName.replace(/^scatter_?|_?scatter$/gi, '').replace(/_/g, ' ') || 'scatter' };
    }
    return { tier: 3, role: 'regular', label: symbolName.replace(/_/g, ' ') };
}

function hashHue(s) {
    let h = 0;
    for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
    return ((h % 360) + 360) % 360;
}

function symbolSvg(symbolName, game) {
    const accent = game.accentColor || '#d4af37';
    const p = parseSymbolId(symbolName);
    const hueShift = hashHue(symbolName + ':' + game.id);
    const darkness = 10 + (5 - Math.min(p.tier, 5)) * 12;
    const gradId = 'ss_' + game.id + '_' + symbolName.replace(/[^a-z0-9]/gi, '');
    const borderColor = p.role === 'wild' ? '#ffffff'
        : p.role === 'scatter' ? '#ffd700'
        : accent;
    const strokeWidth = (p.role === 'wild' || p.role === 'scatter') ? 3 : 1.5;
    let label = (p.label || symbolName).toUpperCase().trim();
    if (label.length > 8) label = label.slice(0, 7) + '…';
    const tierBadge = p.role === 'wild' ? 'W'
        : p.role === 'scatter' ? 'S'
        : String(p.tier);
    const tierFontSize = p.role === 'wild' ? 26 : p.role === 'scatter' ? 24 : 22;
    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" role="img" aria-label="' + xmlEscape(symbolName) + '">' +
        '<defs>' +
            '<linearGradient id="' + gradId + '" x1="0" y1="0" x2="1" y2="1">' +
                '<stop offset="0%" stop-color="' + accent + '" stop-opacity="' + (0.28 + (p.tier / 15)).toFixed(2) + '"/>' +
                '<stop offset="100%" stop-color="hsl(' + hueShift + ',70%,' + darkness + '%)" stop-opacity="1"/>' +
            '</linearGradient>' +
            (p.role === 'wild' ?
                '<radialGradient id="' + gradId + 'g" cx="50%" cy="50%" r="60%"><stop offset="0%" stop-color="#ffffff" stop-opacity="0.35"/><stop offset="100%" stop-color="#ffffff" stop-opacity="0"/></radialGradient>'
            : '') +
        '</defs>' +
        '<rect x="2" y="2" width="60" height="60" rx="10" fill="url(#' + gradId + ')" stroke="' + borderColor + '" stroke-width="' + strokeWidth + '"/>' +
        (p.role === 'wild' ? '<rect x="2" y="2" width="60" height="60" rx="10" fill="url(#' + gradId + 'g)"/>' : '') +
        '<text x="32" y="30" text-anchor="middle" font-family="Helvetica,Arial,sans-serif" font-size="' + tierFontSize + '" font-weight="800" fill="' + accent + '">' +
            xmlEscape(tierBadge) +
        '</text>' +
        '<text x="32" y="50" text-anchor="middle" font-family="Helvetica,Arial,sans-serif" font-size="' + (label.length > 5 ? 8 : 10) + '" font-weight="600" fill="#ffffff" opacity="0.92">' +
            xmlEscape(label) +
        '</text>' +
    '</svg>';
}

// ── DEFAULT UI SYMBOLS ────────────────────────────────────────────

const UI_SYMBOLS = {
    diamond:    { fill: '#9af2ff', bg: '#143747', glyph: '◆' },
    cherry:     { fill: '#ff6060', bg: '#3a0d0d', glyph: '♥' },
    seven:      { fill: '#ffd700', bg: '#3a1a00', glyph: '7' },
    star:       { fill: '#ffeb3b', bg: '#1a1805', glyph: '★' },
    bell:       { fill: '#ffca28', bg: '#2a1800', glyph: '⍾' },
    bar:        { fill: '#e0e0e0', bg: '#141414', glyph: 'BAR' },
    watermelon: { fill: '#ff6f91', bg: '#1a2a13', glyph: '🍉' },
    lemon:      { fill: '#ffe066', bg: '#2a2805', glyph: '🍋' },
};

function uiSymbolSvg(name, cfg) {
    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" role="img" aria-label="' + xmlEscape(name) + '">' +
        '<rect width="64" height="64" rx="10" fill="' + cfg.bg + '"/>' +
        '<text x="32" y="44" text-anchor="middle" font-family="Helvetica,Arial,sans-serif" font-size="' + (String(cfg.glyph).length > 2 ? 22 : 34) + '" font-weight="700" fill="' + cfg.fill + '">' +
            xmlEscape(cfg.glyph) +
        '</text>' +
    '</svg>';
}

// ── MAIN ─────────────────────────────────────────────────────────

function write(filePath, contents) {
    ensureDir(path.dirname(filePath));
    fs.writeFileSync(filePath, contents, 'utf8');
}

function main() {
    let thumbs = 0, symbols = 0, ui = 0;
    const seenGames = new Set();
    const dupes = [];

    for (const g of games) {
        if (!g || !g.id) continue;
        if (seenGames.has(g.id)) { dupes.push(g.id); continue; }
        seenGames.add(g.id);

        // Thumbnail
        write(path.join(ASSETS, 'thumbnails', g.id + '.svg'), thumbnailSvg(g));
        thumbs++;

        // Per-game reel symbols
        if (Array.isArray(g.symbols)) {
            for (const sym of g.symbols) {
                write(path.join(ASSETS, 'game_symbols', g.id, sym + '.svg'), symbolSvg(sym, g));
                symbols++;
            }
        }
    }

    for (const name of Object.keys(UI_SYMBOLS)) {
        write(path.join(ASSETS, 'ui', 'sym_' + name + '.svg'), uiSymbolSvg(name, UI_SYMBOLS[name]));
        ui++;
    }

    console.log('[gen-assets] wrote ' + thumbs + ' thumbnails, ' + symbols + ' reel symbols across ' + seenGames.size + ' games, ' + ui + ' ui symbols');
    if (dupes.length) console.warn('[gen-assets] skipped ' + dupes.length + ' duplicate game ids: ' + dupes.slice(0, 5).join(', ') + (dupes.length > 5 ? ', …' : ''));
}

main();
