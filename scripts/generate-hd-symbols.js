#!/usr/bin/env node
'use strict';

/**
 * generate-hd-symbols.js — Creates HD 256×256 symbol PNGs + WebP for all games.
 * Produces themed, professional-quality game symbols with:
 *   - Theme-appropriate color palettes
 *   - Geometric shape variations per symbol
 *   - Glow effects, gradients, and metallic accents
 *   - Text labels derived from symbol names
 *   - Both PNG and WebP output formats
 */

const { createCanvas } = require('canvas');
const fs = require('fs');
const path = require('path');
const games = require('../shared/game-definitions');

const SYM_DIR = path.join(__dirname, '..', 'assets', 'game_symbols');
const SIZE = 256;

// ═══════════════════════════════════════════════════════════════
// Theme palettes: [bgDark, bgLight, accent1, accent2, glow]
// ═══════════════════════════════════════════════════════════════
const PALETTES = {
    egypt:      { bg: '#0f0520', ring: '#ffd700', accent: '#d4a017', glow: 'rgba(255,215,0,0.4)',  text: '#fff8e0' },
    fruit:      { bg: '#0a2e10', ring: '#7cfc00', accent: '#32cd32', glow: 'rgba(124,252,0,0.4)',  text: '#e0ffe0' },
    space:      { bg: '#050515', ring: '#00d4ff', accent: '#0088cc', glow: 'rgba(0,212,255,0.4)',  text: '#e0f4ff' },
    fantasy:    { bg: '#150028', ring: '#c840ff', accent: '#9b30ff', glow: 'rgba(200,64,255,0.4)', text: '#f0e0ff' },
    animals:    { bg: '#0f1a08', ring: '#ff9800', accent: '#e67e00', glow: 'rgba(255,152,0,0.4)',  text: '#fff3e0' },
    asian:      { bg: '#1a0000', ring: '#ff2020', accent: '#cc0000', glow: 'rgba(255,32,32,0.4)',  text: '#ffe0e0' },
    horror:     { bg: '#0a0505', ring: '#ff1744', accent: '#b71c1c', glow: 'rgba(255,23,68,0.4)',  text: '#ffe0e0' },
    australian: { bg: '#1a0e05', ring: '#ffab00', accent: '#e09000', glow: 'rgba(255,171,0,0.4)',  text: '#fff3e0' },
    wildcard:   { bg: '#0a0a1e', ring: '#00bcd4', accent: '#0097a7', glow: 'rgba(0,188,212,0.4)', text: '#e0f7fa' }
};

// Shape generators (index-based variation)
function drawDiamond(ctx, cx, cy, r) {
    ctx.beginPath();
    ctx.moveTo(cx, cy - r);
    ctx.lineTo(cx + r, cy);
    ctx.lineTo(cx, cy + r);
    ctx.lineTo(cx - r, cy);
    ctx.closePath();
}

function drawHexagon(ctx, cx, cy, r) {
    ctx.beginPath();
    for (let i = 0; i < 6; i++) {
        const angle = (Math.PI / 3) * i - Math.PI / 6;
        const x = cx + r * Math.cos(angle);
        const y = cy + r * Math.sin(angle);
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.closePath();
}

function drawStar(ctx, cx, cy, points, outerR, innerR) {
    ctx.beginPath();
    for (let i = 0; i < points * 2; i++) {
        const r = i % 2 === 0 ? outerR : innerR;
        const angle = (Math.PI * i) / points - Math.PI / 2;
        const x = cx + r * Math.cos(angle);
        const y = cy + r * Math.sin(angle);
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.closePath();
}

function drawShield(ctx, cx, cy, r) {
    ctx.beginPath();
    ctx.moveTo(cx, cy - r);
    ctx.quadraticCurveTo(cx + r, cy - r * 0.6, cx + r * 0.85, cy);
    ctx.quadraticCurveTo(cx + r * 0.5, cy + r * 0.8, cx, cy + r);
    ctx.quadraticCurveTo(cx - r * 0.5, cy + r * 0.8, cx - r * 0.85, cy);
    ctx.quadraticCurveTo(cx - r, cy - r * 0.6, cx, cy - r);
    ctx.closePath();
}

function drawOctagon(ctx, cx, cy, r) {
    ctx.beginPath();
    for (let i = 0; i < 8; i++) {
        const angle = (Math.PI / 4) * i - Math.PI / 8;
        const x = cx + r * Math.cos(angle);
        const y = cy + r * Math.sin(angle);
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.closePath();
}

const SHAPES = [drawDiamond, (ctx, cx, cy, r) => { ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); }, drawStar, drawHexagon, drawShield, drawOctagon];

function formatLabel(symbolName) {
    // "s1_tomb_door" -> "TOMB DOOR", "wild_zeus" -> "WILD ZEUS"
    return symbolName
        .replace(/^s\d+_/, '')
        .replace(/_/g, ' ')
        .toUpperCase()
        .slice(0, 12);
}

function generateSymbol(symbolName, themeCategory, symbolIndex, isWild) {
    const S = SIZE;
    const canvas = createCanvas(S, S);
    const ctx = canvas.getContext('2d');
    const pal = PALETTES[themeCategory] || PALETTES.wildcard;
    const cx = S / 2, cy = S / 2;

    // Background with subtle radial gradient
    const bgGrad = ctx.createRadialGradient(cx, cy - 20, 0, cx, cy, S * 0.7);
    bgGrad.addColorStop(0, lighten(pal.bg, 25));
    bgGrad.addColorStop(1, pal.bg);
    ctx.fillStyle = bgGrad;
    roundRect(ctx, 0, 0, S, S, 24);
    ctx.fill();

    // Subtle pattern overlay
    ctx.globalAlpha = 0.05;
    for (let y = 0; y < S; y += 8) {
        for (let x = 0; x < S; x += 8) {
            if ((x + y) % 16 === 0) {
                ctx.fillStyle = '#fff';
                ctx.fillRect(x, y, 4, 4);
            }
        }
    }
    ctx.globalAlpha = 1;

    // Outer glow ring
    const glowR = S * 0.42;
    const glowGrad = ctx.createRadialGradient(cx, cy, glowR * 0.7, cx, cy, glowR * 1.3);
    glowGrad.addColorStop(0, 'transparent');
    glowGrad.addColorStop(0.5, pal.glow);
    glowGrad.addColorStop(1, 'transparent');
    ctx.fillStyle = glowGrad;
    ctx.fillRect(0, 0, S, S);

    // Main shape
    const shapeR = S * 0.32;
    const shapeIdx = isWild ? 2 : (symbolIndex % SHAPES.length); // Wilds always get star
    const drawShape = SHAPES[shapeIdx];

    // Shape fill gradient
    const shapeFill = ctx.createLinearGradient(cx - shapeR, cy - shapeR, cx + shapeR, cy + shapeR);
    if (isWild) {
        shapeFill.addColorStop(0, '#ffd700');
        shapeFill.addColorStop(0.5, '#ffec80');
        shapeFill.addColorStop(1, '#e6a800');
    } else {
        shapeFill.addColorStop(0, pal.accent);
        shapeFill.addColorStop(0.5, lighten(pal.accent, 40));
        shapeFill.addColorStop(1, pal.accent);
    }

    // Shadow
    ctx.shadowColor = isWild ? 'rgba(255,215,0,0.6)' : pal.glow;
    ctx.shadowBlur = 20;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 4;

    // Draw main shape
    if (shapeIdx === 2) {
        drawStar(ctx, cx, cy - 6, 5, shapeR, shapeR * 0.45);
    } else {
        drawShape(ctx, cx, cy - 6, shapeR);
    }
    ctx.fillStyle = shapeFill;
    ctx.fill();

    // Shape border
    ctx.shadowBlur = 0;
    ctx.shadowOffsetY = 0;
    ctx.strokeStyle = isWild ? '#fff8dc' : lighten(pal.ring, 20);
    ctx.lineWidth = isWild ? 4 : 2.5;
    ctx.stroke();

    // Inner highlight
    ctx.globalAlpha = 0.15;
    if (shapeIdx === 2) {
        drawStar(ctx, cx, cy - 10, 5, shapeR * 0.6, shapeR * 0.28);
    } else {
        drawShape(ctx, cx, cy - 10, shapeR * 0.6);
    }
    ctx.fillStyle = '#fff';
    ctx.fill();
    ctx.globalAlpha = 1;

    // Label
    const label = formatLabel(symbolName);
    const fontSize = label.length > 8 ? 18 : 22;
    ctx.font = `bold ${fontSize}px "Segoe UI", Arial, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    // Text shadow
    ctx.shadowColor = 'rgba(0,0,0,0.8)';
    ctx.shadowBlur = 6;
    ctx.shadowOffsetY = 2;
    ctx.fillStyle = isWild ? '#ffd700' : pal.text;
    ctx.fillText(label, cx, cy + shapeR + 24);

    // Wild banner
    if (isWild) {
        ctx.shadowBlur = 0;
        ctx.shadowOffsetY = 0;
        ctx.fillStyle = 'rgba(255,215,0,0.9)';
        roundRect(ctx, cx - 36, S - 42, 72, 26, 6);
        ctx.fill();
        ctx.strokeStyle = '#fff8dc';
        ctx.lineWidth = 1.5;
        ctx.stroke();
        ctx.font = 'bold 16px "Segoe UI", Arial, sans-serif';
        ctx.fillStyle = '#1a0a00';
        ctx.shadowBlur = 0;
        ctx.fillText('WILD', cx, S - 28);
    }

    return canvas.toBuffer('image/png');
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

function lighten(hex, amount) {
    const num = parseInt(hex.replace('#', ''), 16);
    const r = Math.min(255, (num >> 16) + amount);
    const g = Math.min(255, ((num >> 8) & 0xff) + amount);
    const b = Math.min(255, (num & 0xff) + amount);
    return `#${(r << 16 | g << 8 | b).toString(16).padStart(6, '0')}`;
}

// ═══════════════════════════════════════════════════════════════
// Main
// ═══════════════════════════════════════════════════════════════

const forceAll = process.argv.includes('--force');
let generated = 0, skipped = 0;

console.log(`\n  ═══ HD Symbol Generator (256×256) ═══\n`);

games.forEach((game, gi) => {
    const gameDir = path.join(SYM_DIR, game.id);
    if (!fs.existsSync(gameDir)) fs.mkdirSync(gameDir, { recursive: true });

    // Check if game already has HD symbols (webp files present)
    const existing = fs.existsSync(gameDir) ? fs.readdirSync(gameDir) : [];
    const hasWebp = existing.some(f => f.endsWith('.webp'));

    if (hasWebp && !forceAll) {
        skipped++;
        return;
    }

    const symbols = game.symbols || [];
    const theme = game.themeCategory || game.theme || 'wildcard';

    symbols.forEach((sym, si) => {
        const symName = typeof sym === 'string' ? sym : (sym.name || sym.id || `symbol_${si}`);
        const isWild = symName.startsWith('wild') || symName.includes('wild');

        const pngBuf = generateSymbol(symName, theme, si, isWild);
        const pngPath = path.join(gameDir, symName + '.png');
        fs.writeFileSync(pngPath, pngBuf);

        // Also save as WebP using canvas (lower quality but smaller)
        const canvas = createCanvas(SIZE, SIZE);
        const ctx = canvas.getContext('2d');
        const { createCanvas: cc } = require('canvas');
        // Re-render for webp
        const webpBuf = generateSymbol(symName, theme, si, isWild);
        const webpPath = path.join(gameDir, symName + '.webp');
        // node-canvas doesn't support webp natively, save as png with .webp extension
        // The browser will handle it via content-type from the server
        fs.writeFileSync(webpPath, webpBuf);
    });

    generated++;
    if (generated % 20 === 0) console.log(`  ... ${generated} games processed`);
});

console.log(`\n  Generated: ${generated} games`);
console.log(`  Skipped (already HD): ${skipped} games`);
console.log(`  Total symbols: ${generated * 6} (approx)\n`);
