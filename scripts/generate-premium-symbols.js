#!/usr/bin/env node
'use strict';

/**
 * Premium HD Symbol Generator
 *
 * Produces 256×256 WebP game symbols with distinctive per-tier shapes,
 * rich gradients, 3D bezels, highlights, shadows, and theme-aware colours.
 * Output: assets/game_symbols/<game_id>/<symbol_name>.webp
 *
 * Each game gets its own set of symbols derived from game.symbols[],
 * game.wildSymbol, and game.scatterSymbol. Symbol tiers (s1..s5) each
 * get a distinct hero shape so the reel variety is visible:
 *   s1  → 10 / low  (clover)
 *   s2  → J  / low  (bell)
 *   s3  → Q  / mid  (hexagon shield)
 *   s4  → K  / mid  (star)
 *   s5  → A  / hi   (crown)
 *   wild → shimmering W star
 *   scatter → radial burst
 *
 * The shape is "carrying" — the label at the bottom names the game-specific
 * theme meaning (e.g. s5_star_crystal → "STAR CRYSTAL"), so players still
 * read the theme correctly while the shape communicates the tier.
 */

const { createCanvas } = require('canvas');
const sharp = require('sharp');
const fs = require('fs');
const path = require('path');
const games = require('../shared/game-definitions');

const SIZE = 256;
const OUT_ROOT = path.join(__dirname, '..', 'assets', 'game_symbols');

// ────────────────────────────────────────────────────────────────────
//  Theme palettes (consistent with thumbnail generator)
// ────────────────────────────────────────────────────────────────────
const THEMES = {
    egypt:      { base: '#2c1810', frame: '#ffd700', highlight: '#ffcc66', accent: '#c8a415', deep: '#0a0704' },
    fruit:      { base: '#1e4d28', frame: '#ffd747', highlight: '#ffef99', accent: '#ff6f3c', deep: '#0a1f0d' },
    space:      { base: '#0a0a2e', frame: '#00e5ff', highlight: '#66f0ff', accent: '#8a7dff', deep: '#030315' },
    fantasy:    { base: '#2a0a3e', frame: '#e040fb', highlight: '#ffccf7', accent: '#ffb347', deep: '#0d0420' },
    animals:    { base: '#2a1f0a', frame: '#d4a017', highlight: '#ffd966', accent: '#cc5500', deep: '#15100a' },
    asian:      { base: '#3a0a0a', frame: '#ffd700', highlight: '#ff9999', accent: '#ff3030', deep: '#150505' },
    horror:     { base: '#0a0a0a', frame: '#ff1744', highlight: '#ff6666', accent: '#9932cc', deep: '#000000' },
    australian: { base: '#3a2317', frame: '#ffab00', highlight: '#ffd966', accent: '#66bb6a', deep: '#1f130a' },
    wildcard:   { base: '#1a1a2e', frame: '#00d4ff', highlight: '#99e6ff', accent: '#ffcc00', deep: '#0a0a15' },
    halloween:  { base: '#1a0533', frame: '#ff7700', highlight: '#ffcc99', accent: '#a020f0', deep: '#0a0215' },
};

function pickTheme(game) {
    return THEMES[game.themeCategory] || THEMES[game.theme] || THEMES.wildcard;
}

// ────────────────────────────────────────────────────────────────────
//  Helpers
// ────────────────────────────────────────────────────────────────────
function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
}

function withShadow(ctx, color, blur, offX, offY, fn) {
    ctx.save();
    ctx.shadowColor = color;
    ctx.shadowBlur = blur;
    ctx.shadowOffsetX = offX;
    ctx.shadowOffsetY = offY;
    fn();
    ctx.restore();
}

function paintCard(ctx, theme, rarity) {
    // Card background — rounded-corner rectangle with theme gradient
    const pad = 12;
    const W = SIZE, H = SIZE;
    // outer shadow
    ctx.fillStyle = '#00000066';
    roundRect(ctx, pad + 2, pad + 4, W - pad * 2, H - pad * 2, 28);
    ctx.fill();

    // card gradient base
    const g = ctx.createLinearGradient(0, 0, W, H);
    g.addColorStop(0, theme.base);
    g.addColorStop(1, theme.deep);
    ctx.fillStyle = g;
    roundRect(ctx, pad, pad, W - pad * 2, H - pad * 2, 26);
    ctx.fill();

    // Top-down light overlay
    const lg = ctx.createLinearGradient(0, pad, 0, H * 0.6);
    lg.addColorStop(0, theme.highlight + '33');
    lg.addColorStop(1, theme.highlight + '00');
    ctx.fillStyle = lg;
    roundRect(ctx, pad, pad, W - pad * 2, H - pad * 2, 26);
    ctx.fill();

    // Inner shadow on bottom
    const sg = ctx.createLinearGradient(0, H * 0.6, 0, H - pad);
    sg.addColorStop(0, theme.deep + '00');
    sg.addColorStop(1, theme.deep + 'bb');
    ctx.fillStyle = sg;
    roundRect(ctx, pad, pad, W - pad * 2, H - pad * 2, 26);
    ctx.fill();

    // Gold frame
    ctx.strokeStyle = rarity >= 5 ? theme.frame : theme.frame + 'aa';
    ctx.lineWidth = rarity >= 5 ? 4 : 3;
    roundRect(ctx, pad, pad, W - pad * 2, H - pad * 2, 26);
    ctx.stroke();

    // Subtle inner frame
    ctx.strokeStyle = theme.frame + '44';
    ctx.lineWidth = 1;
    roundRect(ctx, pad + 6, pad + 6, W - (pad + 6) * 2, H - (pad + 6) * 2, 22);
    ctx.stroke();

    // Corner sparkles for high-tier cards
    if (rarity >= 4) {
        [[pad + 10, pad + 10], [W - pad - 10, pad + 10], [pad + 10, H - pad - 10], [W - pad - 10, H - pad - 10]].forEach(([x, y]) => {
            ctx.fillStyle = theme.highlight;
            ctx.beginPath();
            ctx.arc(x, y, 2, 0, Math.PI * 2);
            ctx.fill();
        });
    }
}

// ────────────────────────────────────────────────────────────────────
//  Symbol shapes — each tier gets its own hero silhouette
// ────────────────────────────────────────────────────────────────────
function paintShape(ctx, symbolName, theme) {
    const W = SIZE, H = SIZE;
    const cx = W / 2;
    const cy = H / 2 - 18; // shift up to leave room for label
    const tier = tierOf(symbolName);

    if (symbolName.startsWith('wild')) return paintWild(ctx, cx, cy, theme);
    if (symbolName.startsWith('scatter') || isScatter(symbolName)) return paintScatter(ctx, cx, cy, theme);

    const painters = [paintClover, paintBell, paintShield, paintBigStar, paintCrown];
    painters[Math.min(tier - 1, 4)](ctx, cx, cy, theme);
}

function tierOf(name) {
    const m = name.match(/^s(\d)_/);
    return m ? Math.max(1, Math.min(5, parseInt(m[1], 10))) : 3;
}

function isScatter(name) {
    const lowered = name.toLowerCase();
    return /scatter|diamond|pyramid|skull|moon|sun|coin|ring|pearl|orb/.test(lowered);
}

// ── Paint helpers — each returns coloured 3D-effect shape ──

function paintClover(ctx, cx, cy, theme) {
    // s1 — clover / leaf cluster (lowest tier)
    ctx.save();
    const r = 34;
    const color = theme.accent;
    const petals = [[0, -r], [r, 0], [0, r], [-r, 0]];
    petals.forEach(([dx, dy]) => {
        const g = ctx.createRadialGradient(cx + dx, cy + dy, 0, cx + dx, cy + dy, r);
        g.addColorStop(0, lighten(color, 0.4));
        g.addColorStop(0.7, color);
        g.addColorStop(1, darken(color, 0.5));
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(cx + dx, cy + dy, r * 0.75, 0, Math.PI * 2);
        ctx.fill();
    });
    // Center
    ctx.fillStyle = theme.highlight;
    ctx.beginPath();
    ctx.arc(cx, cy, 12, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
}

function paintBell(ctx, cx, cy, theme) {
    // s2 — bell (classic slot)
    ctx.save();
    const color = theme.frame;
    const g = ctx.createLinearGradient(cx, cy - 50, cx, cy + 40);
    g.addColorStop(0, lighten(color, 0.3));
    g.addColorStop(0.5, color);
    g.addColorStop(1, darken(color, 0.4));
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(cx, cy - 55);
    ctx.quadraticCurveTo(cx + 45, cy - 50, cx + 45, cy + 25);
    ctx.lineTo(cx + 52, cy + 32);
    ctx.lineTo(cx - 52, cy + 32);
    ctx.lineTo(cx - 45, cy + 25);
    ctx.quadraticCurveTo(cx - 45, cy - 50, cx, cy - 55);
    ctx.closePath();
    ctx.fill();
    // Bell bottom
    ctx.fillStyle = darken(color, 0.3);
    ctx.beginPath();
    ctx.ellipse(cx, cy + 32, 52, 6, 0, 0, Math.PI * 2);
    ctx.fill();
    // Clapper
    ctx.fillStyle = theme.deep;
    ctx.beginPath();
    ctx.ellipse(cx, cy + 42, 12, 8, 0, 0, Math.PI * 2);
    ctx.fill();
    // Highlight stripe
    ctx.strokeStyle = theme.highlight + '99';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(cx - 25, cy - 35);
    ctx.quadraticCurveTo(cx - 35, cy, cx - 25, cy + 20);
    ctx.stroke();
    ctx.restore();
}

function paintShield(ctx, cx, cy, theme) {
    // s3 — hexagonal shield
    ctx.save();
    const r = 58;
    const color = theme.accent;
    const points = [];
    for (let i = 0; i < 6; i++) {
        const angle = Math.PI / 2 + (i * Math.PI) / 3;
        points.push([cx + Math.cos(angle) * r, cy + Math.sin(angle) * r]);
    }
    // Fill
    const g = ctx.createLinearGradient(cx, cy - r, cx, cy + r);
    g.addColorStop(0, lighten(color, 0.3));
    g.addColorStop(1, darken(color, 0.4));
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(points[0][0], points[0][1]);
    points.slice(1).forEach(p => ctx.lineTo(p[0], p[1]));
    ctx.closePath();
    ctx.fill();
    // Border
    ctx.strokeStyle = theme.frame;
    ctx.lineWidth = 4;
    ctx.stroke();
    // Inner emblem (diamond)
    ctx.fillStyle = theme.highlight;
    ctx.beginPath();
    ctx.moveTo(cx, cy - 22);
    ctx.lineTo(cx + 18, cy);
    ctx.lineTo(cx, cy + 22);
    ctx.lineTo(cx - 18, cy);
    ctx.closePath();
    ctx.fill();
    // Center point
    ctx.fillStyle = theme.frame;
    ctx.beginPath();
    ctx.arc(cx, cy, 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
}

function paintBigStar(ctx, cx, cy, theme) {
    // s4 — big 5-point star with glow
    ctx.save();
    // Glow
    const glow = ctx.createRadialGradient(cx, cy, 0, cx, cy, 80);
    glow.addColorStop(0, theme.frame + '88');
    glow.addColorStop(1, theme.frame + '00');
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(cx, cy, 80, 0, Math.PI * 2);
    ctx.fill();

    // Star
    drawStar(ctx, cx, cy, 5, 56, 24, (g) => {
        const lg = ctx.createLinearGradient(cx, cy - 56, cx, cy + 56);
        lg.addColorStop(0, lighten(theme.frame, 0.4));
        lg.addColorStop(0.5, theme.frame);
        lg.addColorStop(1, darken(theme.frame, 0.3));
        return lg;
    });
    // Outline
    ctx.strokeStyle = darken(theme.frame, 0.5);
    ctx.lineWidth = 2;
    ctx.stroke();
    // Center jewel
    ctx.fillStyle = theme.highlight;
    ctx.beginPath();
    ctx.arc(cx, cy, 8, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
}

function paintCrown(ctx, cx, cy, theme) {
    // s5 — royal crown (highest regular tier)
    ctx.save();
    const color = theme.frame;
    // Base band
    const bandY = cy + 20;
    const bg = ctx.createLinearGradient(0, bandY - 18, 0, bandY + 18);
    bg.addColorStop(0, lighten(color, 0.4));
    bg.addColorStop(0.5, color);
    bg.addColorStop(1, darken(color, 0.4));
    ctx.fillStyle = bg;
    roundRect(ctx, cx - 70, bandY - 8, 140, 28, 6);
    ctx.fill();
    ctx.strokeStyle = darken(color, 0.4);
    ctx.lineWidth = 2;
    ctx.stroke();

    // 5 points with jewels
    const points = [
        [cx - 60, bandY - 8, 10, 30, theme.accent],
        [cx - 30, bandY - 8, 12, 45, '#ff3030'],
        [cx      , bandY - 8, 14, 55, theme.highlight],
        [cx + 30, bandY - 8, 12, 45, '#ff3030'],
        [cx + 60, bandY - 8, 10, 30, theme.accent]
    ];
    points.forEach(([px, py, w, h, jewel]) => {
        // Point
        const pg = ctx.createLinearGradient(px, py - h, px, py);
        pg.addColorStop(0, lighten(color, 0.5));
        pg.addColorStop(1, color);
        ctx.fillStyle = pg;
        ctx.beginPath();
        ctx.moveTo(px - w, py);
        ctx.lineTo(px, py - h);
        ctx.lineTo(px + w, py);
        ctx.closePath();
        ctx.fill();
        ctx.strokeStyle = darken(color, 0.4);
        ctx.lineWidth = 1.5;
        ctx.stroke();
        // Jewel
        const jg = ctx.createRadialGradient(px, py - h + 4, 0, px, py - h + 4, 6);
        jg.addColorStop(0, '#ffffff');
        jg.addColorStop(0.5, jewel);
        jg.addColorStop(1, darken(jewel, 0.5));
        ctx.fillStyle = jg;
        ctx.beginPath();
        ctx.arc(px, py - h + 4, 5, 0, Math.PI * 2);
        ctx.fill();
    });

    // Central large jewel
    const cg = ctx.createRadialGradient(cx, bandY + 6, 0, cx, bandY + 6, 12);
    cg.addColorStop(0, '#ffffff');
    cg.addColorStop(0.3, theme.highlight);
    cg.addColorStop(1, theme.accent);
    ctx.fillStyle = cg;
    ctx.beginPath();
    ctx.arc(cx, bandY + 6, 10, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
}

function paintWild(ctx, cx, cy, theme) {
    // Wild: glowing star with W overlay
    ctx.save();
    // Large glow
    const glow = ctx.createRadialGradient(cx, cy, 0, cx, cy, 90);
    glow.addColorStop(0, theme.frame + 'cc');
    glow.addColorStop(0.5, theme.frame + '55');
    glow.addColorStop(1, theme.frame + '00');
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(cx, cy, 90, 0, Math.PI * 2);
    ctx.fill();

    // Rainbow star (shimmer effect)
    drawStar(ctx, cx, cy, 8, 60, 20, () => {
        const g = ctx.createLinearGradient(cx - 60, cy - 60, cx + 60, cy + 60);
        g.addColorStop(0, '#ff3030');
        g.addColorStop(0.25, '#ffd700');
        g.addColorStop(0.5, '#00ff88');
        g.addColorStop(0.75, '#00d4ff');
        g.addColorStop(1, '#e040fb');
        return g;
    });
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 2;
    ctx.stroke();

    // "W" letter overlay
    ctx.fillStyle = '#ffffff';
    ctx.font = '900 52px "Arial Black", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.shadowColor = '#000000';
    ctx.shadowBlur = 6;
    ctx.fillText('W', cx, cy);
    ctx.restore();
}

function paintScatter(ctx, cx, cy, theme) {
    // Scatter: radial star burst with orb center
    ctx.save();
    // Burst rays
    ctx.strokeStyle = theme.frame + 'cc';
    ctx.lineWidth = 5;
    ctx.lineCap = 'round';
    for (let i = 0; i < 12; i++) {
        const angle = (i * Math.PI * 2) / 12;
        const r1 = 32;
        const r2 = 70;
        ctx.beginPath();
        ctx.moveTo(cx + Math.cos(angle) * r1, cy + Math.sin(angle) * r1);
        ctx.lineTo(cx + Math.cos(angle) * r2, cy + Math.sin(angle) * r2);
        ctx.stroke();
    }
    // Central orb
    const orb = ctx.createRadialGradient(cx - 6, cy - 8, 0, cx, cy, 32);
    orb.addColorStop(0, '#ffffff');
    orb.addColorStop(0.4, theme.highlight);
    orb.addColorStop(0.8, theme.accent);
    orb.addColorStop(1, darken(theme.accent, 0.5));
    ctx.fillStyle = orb;
    ctx.beginPath();
    ctx.arc(cx, cy, 32, 0, Math.PI * 2);
    ctx.fill();
    // Outer ring
    ctx.strokeStyle = theme.frame;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(cx, cy, 32, 0, Math.PI * 2);
    ctx.stroke();
    // "S" letter
    ctx.fillStyle = '#ffffff';
    ctx.font = '900 32px "Arial Black", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('S', cx, cy);
    ctx.restore();
}

// ────────────────────────────────────────────────────────────────────
//  Shape + colour helpers
// ────────────────────────────────────────────────────────────────────
function drawStar(ctx, cx, cy, spikes, outer, inner, gradFn) {
    ctx.beginPath();
    let rot = Math.PI / 2 * 3;
    const step = Math.PI / spikes;
    ctx.moveTo(cx, cy - outer);
    for (let i = 0; i < spikes; i++) {
        ctx.lineTo(cx + Math.cos(rot) * outer, cy + Math.sin(rot) * outer);
        rot += step;
        ctx.lineTo(cx + Math.cos(rot) * inner, cy + Math.sin(rot) * inner);
        rot += step;
    }
    ctx.closePath();
    ctx.fillStyle = gradFn();
    ctx.fill();
}

function lighten(hex, amount) {
    return shift(hex, amount, true);
}
function darken(hex, amount) {
    return shift(hex, amount, false);
}
function shift(hex, amount, lighter) {
    hex = hex.replace('#', '');
    const r = parseInt(hex.slice(0, 2), 16);
    const g = parseInt(hex.slice(2, 4), 16);
    const b = parseInt(hex.slice(4, 6), 16);
    const f = lighter
        ? (v) => Math.min(255, Math.round(v + (255 - v) * amount))
        : (v) => Math.max(0, Math.round(v * (1 - amount)));
    const hex2 = (v) => f(v).toString(16).padStart(2, '0');
    return '#' + hex2(r) + hex2(g) + hex2(b);
}

// ────────────────────────────────────────────────────────────────────
//  Label band
// ────────────────────────────────────────────────────────────────────
function paintLabel(ctx, symbolName, theme) {
    const W = SIZE, H = SIZE;
    // Extract human-readable name: strip s1_ / s5_ / wild_ prefix, replace underscores
    const display = symbolName
        .replace(/^s\d+_/, '')
        .replace(/^wild_/, '')
        .replace(/^scatter_/, '')
        .replace(/_/g, ' ')
        .toUpperCase();

    // Pill background
    const pad = 18;
    const y = H - 42;
    const h = 24;
    const padX = 14;
    ctx.font = '900 14px "Arial Black", sans-serif';
    const textW = ctx.measureText(display).width;
    const pillW = Math.min(W - pad * 2, textW + padX * 2);
    const px = (W - pillW) / 2;

    // Shadow
    ctx.fillStyle = '#00000088';
    roundRect(ctx, px + 1, y + 2, pillW, h, h / 2);
    ctx.fill();

    // Pill
    const pg = ctx.createLinearGradient(0, y, 0, y + h);
    pg.addColorStop(0, theme.frame);
    pg.addColorStop(1, darken(theme.frame, 0.3));
    ctx.fillStyle = pg;
    roundRect(ctx, px, y, pillW, h, h / 2);
    ctx.fill();

    ctx.strokeStyle = darken(theme.frame, 0.5);
    ctx.lineWidth = 1;
    ctx.stroke();

    // Text
    ctx.fillStyle = theme.deep;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    // Scale font down if pill was capped
    let fontSize = 14;
    while (ctx.measureText(display).width > pillW - padX * 2 && fontSize > 8) {
        fontSize -= 1;
        ctx.font = `900 ${fontSize}px "Arial Black", sans-serif`;
    }
    ctx.fillText(display, W / 2, y + h / 2 + 1);
}

// ────────────────────────────────────────────────────────────────────
//  Compose one symbol
// ────────────────────────────────────────────────────────────────────
function renderSymbol(game, symbolName) {
    const canvas = createCanvas(SIZE, SIZE);
    const ctx = canvas.getContext('2d');
    const theme = pickTheme(game);
    const tier = tierOf(symbolName);

    // Layered composition
    paintCard(ctx, theme, tier);
    paintShape(ctx, symbolName, theme);
    paintLabel(ctx, symbolName, theme);

    return canvas.toBuffer('image/png');
}

// ────────────────────────────────────────────────────────────────────
//  Main
// ────────────────────────────────────────────────────────────────────
async function main() {
    if (!fs.existsSync(OUT_ROOT)) fs.mkdirSync(OUT_ROOT, { recursive: true });

    let totalSymbols = 0;
    games.forEach(g => {
        const syms = (g.symbols || []).slice();
        if (g.wildSymbol && !syms.includes(g.wildSymbol)) syms.push(g.wildSymbol);
        if (g.scatterSymbol && !syms.includes(g.scatterSymbol)) syms.push(g.scatterSymbol);
        totalSymbols += syms.length;
    });
    console.log(`Generating ${totalSymbols} premium HD symbols across ${games.length} games...`);

    let done = 0, failed = 0;
    for (const game of games) {
        const gameDir = path.join(OUT_ROOT, game.id);
        if (!fs.existsSync(gameDir)) fs.mkdirSync(gameDir, { recursive: true });

        const syms = (game.symbols || []).slice();
        if (game.wildSymbol && !syms.includes(game.wildSymbol)) syms.push(game.wildSymbol);
        if (game.scatterSymbol && !syms.includes(game.scatterSymbol)) syms.push(game.scatterSymbol);

        for (const sym of syms) {
            try {
                const png = renderSymbol(game, sym);
                const webp = await sharp(png).webp({ quality: 90 }).toBuffer();
                fs.writeFileSync(path.join(gameDir, sym + '.webp'), webp);
                done++;
                if (done % 50 === 0) process.stdout.write(`  ${done}/${totalSymbols} `);
            } catch (err) {
                failed++;
                console.warn(`\n  [FAIL] ${game.id}/${sym}: ${err.message}`);
            }
        }
    }

    console.log(`\n\nDone. ${done} symbols ok, ${failed} failed`);
    if (failed > 0) process.exit(1);
}

main().catch(err => {
    console.error('Fatal:', err);
    process.exit(1);
});
