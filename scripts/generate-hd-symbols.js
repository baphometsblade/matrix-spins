#!/usr/bin/env node
'use strict';

/**
 * generate-hd-symbols.js — Premium 256×256 slot symbols.
 *
 * Renders each symbol as a faceted gem or medallion set inside an ornate
 * metallic frame — the look associated with high-end casino slots. Every
 * symbol gets:
 *   - Multi-stop radial base gradient with top-light highlight
 *   - Faceted body (cut lines from centre to vertices) for a gemstone feel
 *   - Specular highlight blob (top-left soft light)
 *   - Inner shadow / rim light (subtle bevel)
 *   - Outer dark rim + bright highlight edge (metallic frame effect)
 *   - Drop shadow with themed glow
 *   - Background plate with corner ornaments + theme tint
 *   - Symbol name text in a tablet at the bottom
 *   - Wild symbols use gold palette + "WILD" tablet
 *
 * Output: both .png and .webp (bit-identical — server sets content-type).
 */

const { createCanvas } = require('canvas');
const fs = require('fs');
const path = require('path');
const games = require('../shared/game-definitions');

const SYM_DIR = path.join(__dirname, '..', 'assets', 'game_symbols');
const SIZE = 256;

// ═══════════════════════════════════════════════════════════════
// Theme palettes — accent, frame (brass / silver / gold), gem body, glow
// ═══════════════════════════════════════════════════════════════
const PALETTES = {
    egypt:      { bg1: '#1f0a06', bg2: '#080200', frame1: '#fde0a0', frame2: '#8b6914', frameDark: '#3b2a0a', gem1: '#ffd700', gem2: '#b8860b', gem3: '#fff3b0', glow: 'rgba(255,215,0,0.55)', text: '#fff4c0', tabletBg: '#4a2c08' },
    fruit:      { bg1: '#0a2e14', bg2: '#02110a', frame1: '#c9f7a8', frame2: '#2e7d32', frameDark: '#0d3114', gem1: '#a3e635', gem2: '#4d7c0f', gem3: '#f0ffc4', glow: 'rgba(163,230,53,0.55)', text: '#ecfccb', tabletBg: '#14370f' },
    space:      { bg1: '#0a1330', bg2: '#020616', frame1: '#90e0ff', frame2: '#1976d2', frameDark: '#0b2545', gem1: '#38bdf8', gem2: '#0369a1', gem3: '#d0f2ff', glow: 'rgba(56,189,248,0.55)', text: '#e0f4ff', tabletBg: '#082342' },
    fantasy:    { bg1: '#220a3c', bg2: '#0a0316', frame1: '#e3c8ff', frame2: '#7e22ce', frameDark: '#2d1058', gem1: '#c084fc', gem2: '#7e22ce', gem3: '#f3e8ff', glow: 'rgba(192,132,252,0.55)', text: '#f3e8ff', tabletBg: '#2b1158' },
    animals:    { bg1: '#1f1407', bg2: '#0e0804', frame1: '#ffd599', frame2: '#d97706', frameDark: '#432a0a', gem1: '#fb923c', gem2: '#c2410c', gem3: '#fff1de', glow: 'rgba(251,146,60,0.55)', text: '#fff7ed', tabletBg: '#3b1f04' },
    asian:      { bg1: '#260606', bg2: '#0d0202', frame1: '#ffc0b0', frame2: '#b91c1c', frameDark: '#3b0a0a', gem1: '#ef4444', gem2: '#991b1b', gem3: '#ffd7ce', glow: 'rgba(239,68,68,0.55)', text: '#ffe4e4', tabletBg: '#3c0606' },
    horror:     { bg1: '#110505', bg2: '#050202', frame1: '#fca5a5', frame2: '#881337', frameDark: '#2a0606', gem1: '#dc2626', gem2: '#7f1d1d', gem3: '#fecaca', glow: 'rgba(220,38,38,0.55)', text: '#fecaca', tabletBg: '#240606' },
    australian: { bg1: '#1a1005', bg2: '#0a0602', frame1: '#ffdc99', frame2: '#c2410c', frameDark: '#3d2102', gem1: '#f97316', gem2: '#9a3412', gem3: '#ffe4c8', glow: 'rgba(249,115,22,0.55)', text: '#fff7ed', tabletBg: '#3b1f04' },
    wildcard:   { bg1: '#0a1420', bg2: '#020508', frame1: '#b2ebf2', frame2: '#0891b2', frameDark: '#063848', gem1: '#22d3ee', gem2: '#0e7490', gem3: '#d7f9ff', glow: 'rgba(34,211,238,0.55)', text: '#e0f7fa', tabletBg: '#083847' }
};

const GOLD = {
    frame1: '#fff1ad', frame2: '#e0a800', frameDark: '#5a3a06',
    gem1: '#ffd700', gem2: '#b8860b', gem3: '#fff8dc',
    glow: 'rgba(255,215,0,0.75)', text: '#1a0e00', tabletBg: '#ffd700'
};

function formatLabel(symbolName) {
    return symbolName.replace(/^s\d+_/, '').replace(/_/g, ' ').toUpperCase();
}

// Deterministic per-symbol hash → used for subtle rotation/accent variance
function hashString(str) {
    let h = 0;
    for (let i = 0; i < str.length; i++) h = ((h << 5) - h) + str.charCodeAt(i) | 0;
    return Math.abs(h);
}

function lighten(hex, amt) {
    const n = parseInt(hex.replace('#', ''), 16);
    const r = Math.min(255, ((n >> 16) & 0xff) + amt);
    const g = Math.min(255, ((n >> 8) & 0xff) + amt);
    const b = Math.min(255, (n & 0xff) + amt);
    return '#' + ((r << 16 | g << 8 | b) >>> 0).toString(16).padStart(6, '0');
}

function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.arcTo(x + w, y, x + w, y + r, r);
    ctx.lineTo(x + w, y + h - r);
    ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
    ctx.lineTo(x + r, y + h);
    ctx.arcTo(x, y + h, x, y + h - r, r);
    ctx.lineTo(x, y + r);
    ctx.arcTo(x, y, x + r, y, r);
    ctx.closePath();
}

// ═══════════════════════════════════════════════════════════════
// Gem body shapes — indexed by symbol position within its game
// Each returns the number of vertices + an array of points (for facet lines)
// ═══════════════════════════════════════════════════════════════
function polygonPath(ctx, cx, cy, r, sides, rotation) {
    const pts = [];
    ctx.beginPath();
    for (let i = 0; i < sides; i++) {
        const a = rotation + (Math.PI * 2 * i) / sides;
        const x = cx + r * Math.cos(a);
        const y = cy + r * Math.sin(a);
        pts.push({ x, y });
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.closePath();
    return pts;
}

function starPath(ctx, cx, cy, outerR, innerR, points, rotation) {
    const pts = [];
    ctx.beginPath();
    const total = points * 2;
    for (let i = 0; i < total; i++) {
        const r = i % 2 === 0 ? outerR : innerR;
        const a = rotation + (Math.PI * i) / points;
        const x = cx + r * Math.cos(a);
        const y = cy + r * Math.sin(a);
        pts.push({ x, y });
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.closePath();
    return pts;
}

function circlePath(ctx, cx, cy, r) {
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    // Return 8 vertices approximation for facet lines
    const pts = [];
    for (let i = 0; i < 8; i++) {
        const a = (Math.PI * 2 * i) / 8;
        pts.push({ x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) });
    }
    return pts;
}

// Returns an array of facet vertices and draws the main body path
function drawGemBody(ctx, cx, cy, r, symbolIndex, isWild) {
    const rot = -Math.PI / 2; // vertex at top
    if (isWild) return starPath(ctx, cx, cy, r, r * 0.48, 5, rot);
    const shapeIdx = symbolIndex % 6;
    switch (shapeIdx) {
        case 0: return polygonPath(ctx, cx, cy, r, 4, rot);        // diamond (4-sided)
        case 1: return circlePath(ctx, cx, cy, r);                 // round
        case 2: return polygonPath(ctx, cx, cy, r, 6, rot);        // hexagon
        case 3: return starPath(ctx, cx, cy, r, r * 0.55, 6, rot); // 6-pt star
        case 4: return polygonPath(ctx, cx, cy, r, 8, -Math.PI/8); // octagon
        case 5: return polygonPath(ctx, cx, cy, r, 3, rot);        // triangle
    }
    return polygonPath(ctx, cx, cy, r, 6, rot);
}

// ═══════════════════════════════════════════════════════════════
// Master render
// ═══════════════════════════════════════════════════════════════
function generateSymbol(symbolName, themeCategory, symbolIndex, isWild) {
    const S = SIZE;
    const canvas = createCanvas(S, S);
    const ctx = canvas.getContext('2d');
    const themePal = PALETTES[themeCategory] || PALETTES.wildcard;
    const pal = isWild ? { ...themePal, ...GOLD } : themePal;
    const cx = S / 2, cy = S / 2;
    const hash = hashString(symbolName);

    // ── Layer 1: background plate with deep-inset corners ──
    const bgGrad = ctx.createLinearGradient(0, 0, 0, S);
    bgGrad.addColorStop(0, themePal.bg1);
    bgGrad.addColorStop(1, themePal.bg2);
    ctx.fillStyle = bgGrad;
    roundRect(ctx, 0, 0, S, S, 26);
    ctx.fill();

    // Radial ambient from top — adds depth
    const ambient = ctx.createRadialGradient(cx, cy * 0.4, 0, cx, cy * 0.4, S * 0.9);
    ambient.addColorStop(0, lighten(themePal.bg1, 30));
    ambient.addColorStop(1, 'transparent');
    ctx.globalCompositeOperation = 'screen';
    ctx.fillStyle = ambient;
    ctx.fillRect(0, 0, S, S);
    ctx.globalCompositeOperation = 'source-over';

    // Corner ornaments (diagonal metallic slashes for luxury feel)
    ctx.save();
    ctx.globalAlpha = 0.35;
    ctx.strokeStyle = pal.frame1;
    ctx.lineWidth = 1.5;
    [{x:16,y:16,dx:1,dy:1}, {x:S-16,y:16,dx:-1,dy:1}, {x:16,y:S-16,dx:1,dy:-1}, {x:S-16,y:S-16,dx:-1,dy:-1}].forEach(c => {
        ctx.beginPath();
        ctx.moveTo(c.x, c.y);
        ctx.lineTo(c.x + c.dx * 22, c.y);
        ctx.moveTo(c.x, c.y);
        ctx.lineTo(c.x, c.y + c.dy * 22);
        ctx.stroke();
    });
    ctx.restore();

    // ── Layer 2: soft themed glow behind gem ──
    const glowGrad = ctx.createRadialGradient(cx, cy - 8, 10, cx, cy - 8, S * 0.55);
    glowGrad.addColorStop(0, pal.glow);
    glowGrad.addColorStop(0.6, 'transparent');
    ctx.fillStyle = glowGrad;
    ctx.fillRect(0, 0, S, S);

    // ── Layer 3: outer metallic frame (ring around gem) ──
    const gemR = S * 0.31;
    const frameOuterR = gemR + 14;
    const frameInnerR = gemR + 4;

    // Dark outer rim (cast shadow of frame)
    ctx.beginPath();
    ctx.arc(cx, cy - 4, frameOuterR + 2, 0, Math.PI * 2);
    ctx.fillStyle = pal.frameDark;
    ctx.fill();

    // Metallic gradient frame (brass/gold/silver by theme)
    const frameGrad = ctx.createLinearGradient(cx - frameOuterR, cy - frameOuterR, cx + frameOuterR, cy + frameOuterR);
    frameGrad.addColorStop(0, pal.frame1);
    frameGrad.addColorStop(0.3, pal.frame2);
    frameGrad.addColorStop(0.55, pal.frameDark);
    frameGrad.addColorStop(0.75, pal.frame2);
    frameGrad.addColorStop(1, pal.frame1);
    ctx.beginPath();
    ctx.arc(cx, cy - 4, frameOuterR, 0, Math.PI * 2);
    ctx.arc(cx, cy - 4, frameInnerR, 0, Math.PI * 2, true);
    ctx.fillStyle = frameGrad;
    ctx.fill('evenodd');

    // Small decorative studs on the frame (8 around)
    for (let i = 0; i < 8; i++) {
        const a = (Math.PI * 2 * i) / 8;
        const sx = cx + (frameOuterR - 7) * Math.cos(a);
        const sy = cy - 4 + (frameOuterR - 7) * Math.sin(a);
        ctx.beginPath();
        ctx.arc(sx, sy, 2.3, 0, Math.PI * 2);
        ctx.fillStyle = pal.frame1;
        ctx.fill();
        ctx.strokeStyle = pal.frameDark;
        ctx.lineWidth = 0.8;
        ctx.stroke();
    }

    // ── Layer 4: gem body (faceted) ──
    ctx.save();
    // Drop shadow beneath gem
    ctx.shadowColor = pal.glow;
    ctx.shadowBlur = 24;
    ctx.shadowOffsetY = 6;

    const gemPts = drawGemBody(ctx, cx, cy - 4, gemR, symbolIndex, isWild);

    // Main gem fill — deep center, brighter edges for faceted look
    const gemGrad = ctx.createRadialGradient(cx - gemR * 0.25, cy - gemR * 0.35, 0, cx, cy, gemR * 1.2);
    gemGrad.addColorStop(0, pal.gem3);
    gemGrad.addColorStop(0.35, pal.gem1);
    gemGrad.addColorStop(0.9, pal.gem2);
    gemGrad.addColorStop(1, lighten(pal.gem2, -20));
    ctx.fillStyle = gemGrad;
    ctx.fill();
    ctx.restore();

    // Facet lines from centre to each vertex (gemstone cut lines)
    ctx.save();
    drawGemBody(ctx, cx, cy - 4, gemR, symbolIndex, isWild);
    ctx.clip();
    ctx.strokeStyle = 'rgba(255,255,255,0.18)';
    ctx.lineWidth = 1;
    gemPts.forEach(p => {
        ctx.beginPath();
        ctx.moveTo(cx, cy - 4);
        ctx.lineTo(p.x, p.y);
        ctx.stroke();
    });
    // Darker inner facet shadows (every other vertex)
    ctx.strokeStyle = 'rgba(0,0,0,0.22)';
    for (let i = 0; i < gemPts.length; i += 2) {
        ctx.beginPath();
        ctx.moveTo(cx, cy - 4);
        ctx.lineTo(gemPts[i].x, gemPts[i].y);
        ctx.stroke();
    }
    ctx.restore();

    // Specular highlight — soft white blob top-left
    ctx.save();
    drawGemBody(ctx, cx, cy - 4, gemR, symbolIndex, isWild);
    ctx.clip();
    const spec = ctx.createRadialGradient(cx - gemR * 0.35, cy - gemR * 0.5, 0, cx - gemR * 0.2, cy - gemR * 0.4, gemR * 0.9);
    spec.addColorStop(0, 'rgba(255,255,255,0.75)');
    spec.addColorStop(0.5, 'rgba(255,255,255,0.18)');
    spec.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = spec;
    ctx.fillRect(cx - gemR * 1.2, cy - gemR * 1.2, gemR * 2.4, gemR * 2.4);
    ctx.restore();

    // Gem outline — thin dark line + bright inner highlight
    drawGemBody(ctx, cx, cy - 4, gemR, symbolIndex, isWild);
    ctx.lineWidth = 2;
    ctx.strokeStyle = 'rgba(0,0,0,0.55)';
    ctx.stroke();

    drawGemBody(ctx, cx, cy - 4, gemR * 0.96, symbolIndex, isWild);
    ctx.lineWidth = 1;
    ctx.strokeStyle = 'rgba(255,255,255,0.35)';
    ctx.stroke();

    // ── Layer 5: label tablet at bottom ──
    const tabletY = S - 38;
    const tabletH = 28;
    const label = formatLabel(symbolName);
    const fontSize = label.length > 10 ? 14 : label.length > 7 ? 16 : 18;
    ctx.font = `900 ${fontSize}px "Segoe UI", "Helvetica Neue", Arial, sans-serif`;
    const labelWidth = ctx.measureText(label).width;
    const tabletW = Math.min(S - 28, labelWidth + 32);
    const tabletX = (S - tabletW) / 2;

    // Tablet shadow
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    roundRect(ctx, tabletX, tabletY + 2, tabletW, tabletH, 6);
    ctx.fill();

    // Tablet gradient
    const tabGrad = ctx.createLinearGradient(0, tabletY, 0, tabletY + tabletH);
    if (isWild) {
        tabGrad.addColorStop(0, lighten(GOLD.frame1, 10));
        tabGrad.addColorStop(0.5, GOLD.gem1);
        tabGrad.addColorStop(1, GOLD.frame2);
    } else {
        tabGrad.addColorStop(0, lighten(pal.tabletBg, 22));
        tabGrad.addColorStop(1, pal.tabletBg);
    }
    ctx.fillStyle = tabGrad;
    roundRect(ctx, tabletX, tabletY, tabletW, tabletH, 6);
    ctx.fill();

    // Tablet border
    ctx.strokeStyle = isWild ? GOLD.frameDark : pal.frame2;
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // Label text with shadow
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.shadowColor = 'rgba(0,0,0,0.6)';
    ctx.shadowBlur = 2;
    ctx.shadowOffsetY = 1;
    ctx.fillStyle = isWild ? GOLD.text : pal.text;
    ctx.fillText(label, S / 2, tabletY + tabletH / 2 + 1);
    ctx.shadowBlur = 0;
    ctx.shadowOffsetY = 0;

    // ── Wild badge ──
    if (isWild) {
        const badgeR = 22;
        const bx = S - badgeR - 8, by = badgeR + 8;
        // Badge shadow
        ctx.fillStyle = 'rgba(0,0,0,0.5)';
        ctx.beginPath();
        ctx.arc(bx + 1, by + 2, badgeR, 0, Math.PI * 2);
        ctx.fill();
        // Badge fill
        const badgeGrad = ctx.createRadialGradient(bx - 4, by - 5, 0, bx, by, badgeR);
        badgeGrad.addColorStop(0, '#fff8dc');
        badgeGrad.addColorStop(0.5, '#ffd700');
        badgeGrad.addColorStop(1, '#b8860b');
        ctx.fillStyle = badgeGrad;
        ctx.beginPath();
        ctx.arc(bx, by, badgeR, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#8b6914';
        ctx.lineWidth = 1.5;
        ctx.stroke();
        // "W" glyph
        ctx.font = '900 20px "Segoe UI", Arial, sans-serif';
        ctx.fillStyle = '#3a2600';
        ctx.fillText('W', bx, by + 1);
    }

    return canvas.toBuffer('image/png');
}

// ═══════════════════════════════════════════════════════════════
// Main
// ═══════════════════════════════════════════════════════════════
const forceAll = process.argv.includes('--force');
let generated = 0, skipped = 0;

console.log('\n  ═══ Premium HD Symbol Generator (256×256) ═══\n');

games.forEach((game) => {
    const gameDir = path.join(SYM_DIR, game.id);
    if (!fs.existsSync(gameDir)) fs.mkdirSync(gameDir, { recursive: true });

    // The regenerate pass is opt-in via --force; otherwise skip games that
    // already have output. (Bundle cache is keyed off these files.)
    const existing = fs.readdirSync(gameDir);
    const hasWebp = existing.some(f => f.endsWith('.webp'));
    if (hasWebp && !forceAll) { skipped++; return; }

    const symbols = game.symbols || [];
    const theme = game.themeCategory || game.theme || 'wildcard';

    symbols.forEach((sym, si) => {
        const symName = typeof sym === 'string' ? sym : (sym.name || sym.id || `symbol_${si}`);
        const isWild = symName.startsWith('wild') || symName.includes('wild');
        const buf = generateSymbol(symName, theme, si, isWild);
        fs.writeFileSync(path.join(gameDir, symName + '.png'), buf);
        // Server serves .webp requests from this file with content-type image/webp.
        // PNG bytes work as-is (browsers accept either content-type mismatch in practice);
        // keeping one canonical render avoids drift between the two.
        fs.writeFileSync(path.join(gameDir, symName + '.webp'), buf);
    });

    generated++;
    if (generated % 20 === 0) console.log(`  ... ${generated} games processed`);
});

console.log(`\n  Generated: ${generated} games`);
console.log(`  Skipped (already HD): ${skipped} games\n`);
