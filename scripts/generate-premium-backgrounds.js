#!/usr/bin/env node
'use strict';

/**
 * Premium HD Background Generator (slot game backdrops)
 *
 * Produces 1920×1080 WebP backgrounds that sit behind the reels during
 * gameplay. Each background is a layered composition — base gradient,
 * theme atmosphere, bokeh, dramatic lighting — that provides depth
 * without competing visually with the reel symbols.
 *
 * Output: assets/backgrounds/slots/<game_id>_bg.webp
 */

const { createCanvas } = require('canvas');
const sharp = require('sharp');
const fs = require('fs');
const path = require('path');
const games = require('../shared/game-definitions');

const W = 1920, H = 1080;
const OUT_DIR = path.join(__dirname, '..', 'assets', 'backgrounds', 'slots');

// ────────────────────────────────────────────────────────────────────
const THEMES = {
    egypt:      { g1: '#2c1810', g2: '#5a2a1f', glow: '#ffd700', accent: '#c8a415', atmo: '#ffcc66' },
    fruit:      { g1: '#1e4d28', g2: '#3a7d45', glow: '#ffd747', accent: '#ff6f3c', atmo: '#ffef99' },
    space:      { g1: '#030312', g2: '#141448', glow: '#00e5ff', accent: '#8a7dff', atmo: '#66f0ff' },
    fantasy:    { g1: '#1a0533', g2: '#4a1275', glow: '#e040fb', accent: '#ffb347', atmo: '#ffccf7' },
    animals:    { g1: '#2a1f0a', g2: '#5a3f1a', glow: '#d4a017', accent: '#cc5500', atmo: '#ffd966' },
    asian:      { g1: '#2a0505', g2: '#5a1010', glow: '#ffd700', accent: '#ff3030', atmo: '#ff9999' },
    horror:     { g1: '#0a0a0a', g2: '#1a0505', glow: '#ff1744', accent: '#9932cc', atmo: '#ff6666' },
    australian: { g1: '#2a180f', g2: '#5a3318', glow: '#ffab00', accent: '#66bb6a', atmo: '#ffd966' },
    wildcard:   { g1: '#0a0a1a', g2: '#1a1a3a', glow: '#00d4ff', accent: '#ffcc00', atmo: '#99e6ff' },
    halloween:  { g1: '#0d0218', g2: '#3a0a4a', glow: '#ff7700', accent: '#a020f0', atmo: '#ffcc99' },
};

function pickTheme(game) {
    return THEMES[game.themeCategory] || THEMES[game.theme] || THEMES.wildcard;
}

function makeRng(seed) {
    let s = 0;
    for (let i = 0; i < seed.length; i++) s = (s * 31 + seed.charCodeAt(i)) | 0;
    return () => {
        s |= 0; s = s + 0x6D2B79F5 | 0;
        let t = Math.imul(s ^ s >>> 15, 1 | s);
        t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
        return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
}

// ────────────────────────────────────────────────────────────────────
function paintBase(ctx, theme) {
    // Radial gradient — brighter at the center where the reels sit, darker at edges
    const rg = ctx.createRadialGradient(W / 2, H / 2 - 80, 100, W / 2, H / 2, W * 0.7);
    rg.addColorStop(0, theme.g2);
    rg.addColorStop(1, theme.g1);
    ctx.fillStyle = rg;
    ctx.fillRect(0, 0, W, H);

    // Heavy dark vignette on all edges
    const vg = ctx.createRadialGradient(W / 2, H / 2, H * 0.4, W / 2, H / 2, W * 0.7);
    vg.addColorStop(0, '#00000000');
    vg.addColorStop(1, '#000000aa');
    ctx.fillStyle = vg;
    ctx.fillRect(0, 0, W, H);

    // Top-down spotlight
    const sg = ctx.createLinearGradient(0, 0, 0, H * 0.6);
    sg.addColorStop(0, theme.atmo + '33');
    sg.addColorStop(1, theme.atmo + '00');
    ctx.fillStyle = sg;
    ctx.fillRect(0, 0, W, H * 0.6);
}

function paintAtmosphere(ctx, theme, rng) {
    // Bokeh particles
    const count = 80;
    for (let i = 0; i < count; i++) {
        const x = rng() * W;
        const y = rng() * H;
        const r = 8 + rng() * 40;
        const alpha = Math.floor(30 + rng() * 90).toString(16).padStart(2, '0');
        const g = ctx.createRadialGradient(x, y, 0, x, y, r);
        g.addColorStop(0, theme.glow + alpha);
        g.addColorStop(1, theme.glow + '00');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fill();
    }

    // Accent streaks
    ctx.globalCompositeOperation = 'screen';
    for (let i = 0; i < 4; i++) {
        const x1 = rng() * W, y1 = rng() * H;
        const x2 = x1 + (rng() - 0.5) * 800;
        const y2 = y1 + (rng() - 0.5) * 400;
        const lg = ctx.createLinearGradient(x1, y1, x2, y2);
        lg.addColorStop(0, theme.accent + '00');
        lg.addColorStop(0.5, theme.accent + '44');
        lg.addColorStop(1, theme.accent + '00');
        ctx.strokeStyle = lg;
        ctx.lineWidth = 30 + rng() * 40;
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.stroke();
    }
    ctx.globalCompositeOperation = 'source-over';
}

function paintTheme(ctx, theme, cat, rng) {
    ctx.save();
    ctx.globalAlpha = 0.35;
    switch (cat) {
        case 'egypt': {
            // Pyramids silhouette on horizon
            const horizon = H * 0.72;
            ctx.fillStyle = theme.g1;
            ctx.beginPath();
            ctx.moveTo(0, horizon);
            ctx.lineTo(W * 0.15, horizon - 220);
            ctx.lineTo(W * 0.28, horizon);
            ctx.lineTo(W * 0.55, horizon - 340);
            ctx.lineTo(W * 0.82, horizon);
            ctx.lineTo(W * 0.92, horizon - 180);
            ctx.lineTo(W, horizon);
            ctx.lineTo(W, H);
            ctx.lineTo(0, H);
            ctx.closePath();
            ctx.fill();
            // Sand dunes
            ctx.fillStyle = theme.glow + '44';
            ctx.beginPath();
            ctx.moveTo(0, horizon + 40);
            for (let x = 0; x <= W; x += 40) {
                ctx.lineTo(x, horizon + 40 + Math.sin(x * 0.003) * 25);
            }
            ctx.lineTo(W, H);
            ctx.lineTo(0, H);
            ctx.closePath();
            ctx.fill();
            // Sun glow
            const sg = ctx.createRadialGradient(W * 0.55, horizon - 280, 0, W * 0.55, horizon - 280, 220);
            sg.addColorStop(0, theme.atmo + 'cc');
            sg.addColorStop(1, theme.atmo + '00');
            ctx.fillStyle = sg;
            ctx.globalAlpha = 0.6;
            ctx.fillRect(W * 0.4, horizon - 500, W * 0.3, 500);
            break;
        }
        case 'space': {
            // Stars
            ctx.globalAlpha = 1;
            for (let i = 0; i < 400; i++) {
                const x = rng() * W, y = rng() * H * 0.8;
                const s = rng() * 2 + 0.3;
                ctx.fillStyle = '#ffffff' + Math.floor(rng() * 200 + 55).toString(16).padStart(2, '0');
                ctx.beginPath();
                ctx.arc(x, y, s, 0, Math.PI * 2);
                ctx.fill();
            }
            // Nebula
            for (let i = 0; i < 5; i++) {
                const x = rng() * W;
                const y = rng() * H * 0.7;
                const r = 200 + rng() * 400;
                const ng = ctx.createRadialGradient(x, y, 0, x, y, r);
                ng.addColorStop(0, theme.glow + '55');
                ng.addColorStop(1, theme.glow + '00');
                ctx.fillStyle = ng;
                ctx.globalAlpha = 0.4;
                ctx.beginPath();
                ctx.arc(x, y, r, 0, Math.PI * 2);
                ctx.fill();
            }
            // Planet
            const px = W * 0.85, py = H * 0.3, pr = 180;
            const pg = ctx.createRadialGradient(px - pr * 0.3, py - pr * 0.3, 0, px, py, pr);
            pg.addColorStop(0, theme.accent);
            pg.addColorStop(0.6, theme.g2);
            pg.addColorStop(1, theme.g1);
            ctx.fillStyle = pg;
            ctx.globalAlpha = 1;
            ctx.beginPath();
            ctx.arc(px, py, pr, 0, Math.PI * 2);
            ctx.fill();
            // Planet rim light
            ctx.strokeStyle = theme.atmo + '66';
            ctx.lineWidth = 3;
            ctx.stroke();
            break;
        }
        case 'fantasy': {
            // Magical mist + floating orbs
            for (let i = 0; i < 60; i++) {
                const x = rng() * W;
                const y = rng() * H;
                const r = 20 + rng() * 80;
                drawStar(ctx, x, y, 5, r, r / 3, theme.glow + '33');
            }
            // Crystal pillar silhouettes
            ctx.fillStyle = theme.glow + '55';
            for (let i = 0; i < 3; i++) {
                const x = W * (0.2 + i * 0.3);
                const top = H * 0.3;
                const h = 400;
                ctx.beginPath();
                ctx.moveTo(x, top);
                ctx.lineTo(x + 40, top + h);
                ctx.lineTo(x - 40, top + h);
                ctx.closePath();
                ctx.fill();
            }
            break;
        }
        case 'fruit': {
            // Blurry fruit shapes
            for (let i = 0; i < 15; i++) {
                const x = rng() * W, y = rng() * H;
                const r = 40 + rng() * 100;
                const color = [theme.glow, theme.accent, '#ff3030', '#aa44dd'][Math.floor(rng() * 4)];
                const fg = ctx.createRadialGradient(x, y, 0, x, y, r);
                fg.addColorStop(0, color + 'aa');
                fg.addColorStop(0.6, color + '33');
                fg.addColorStop(1, color + '00');
                ctx.fillStyle = fg;
                ctx.beginPath();
                ctx.arc(x, y, r, 0, Math.PI * 2);
                ctx.fill();
            }
            break;
        }
        case 'asian': {
            // Dragon scale pattern
            ctx.strokeStyle = theme.glow + '55';
            ctx.lineWidth = 2;
            for (let r = 0; r < 20; r++) {
                for (let c = 0; c < 30; c++) {
                    const x = c * 80 + (r % 2 ? 40 : 0);
                    const y = r * 50 + 40;
                    ctx.beginPath();
                    ctx.arc(x, y, 30, Math.PI, Math.PI * 2);
                    ctx.stroke();
                }
            }
            break;
        }
        case 'horror': {
            // Moon + branches
            const mx = W * 0.8, my = H * 0.28, mr = 100;
            const mg = ctx.createRadialGradient(mx, my, 0, mx, my, mr);
            mg.addColorStop(0, '#e6e6e6');
            mg.addColorStop(1, '#e6e6e600');
            ctx.globalAlpha = 1;
            ctx.fillStyle = mg;
            ctx.beginPath();
            ctx.arc(mx, my, mr, 0, Math.PI * 2);
            ctx.fill();
            // Blood drips
            ctx.fillStyle = theme.glow + '88';
            for (let i = 0; i < 12; i++) {
                const x = rng() * W;
                ctx.beginPath();
                ctx.moveTo(x, 0);
                ctx.bezierCurveTo(x - 10, 60, x + 10, 100, x, 150 + rng() * 100);
                ctx.lineTo(x + 20, 150);
                ctx.bezierCurveTo(x + 30, 100, x + 10, 60, x + 20, 0);
                ctx.closePath();
                ctx.fill();
            }
            break;
        }
        case 'animals': {
            // Jungle leaves
            ctx.strokeStyle = theme.glow + '66';
            ctx.lineWidth = 4;
            for (let i = 0; i < 20; i++) {
                const x = rng() * W, y = rng() * H;
                const r = 80 + rng() * 120;
                ctx.beginPath();
                ctx.ellipse(x, y, r, r * 0.35, rng() * Math.PI, 0, Math.PI * 2);
                ctx.stroke();
            }
            break;
        }
        case 'australian': {
            // Outback horizon with acacia trees
            const horizon = H * 0.7;
            ctx.fillStyle = theme.glow + '55';
            ctx.fillRect(0, horizon, W, H - horizon);
            // Tree silhouettes
            ctx.fillStyle = theme.g1;
            for (let i = 0; i < 5; i++) {
                const tx = 100 + i * 400;
                ctx.beginPath();
                ctx.moveTo(tx, horizon);
                ctx.lineTo(tx - 3, horizon - 80);
                ctx.lineTo(tx + 3, horizon - 80);
                ctx.closePath();
                ctx.fill();
                ctx.beginPath();
                ctx.ellipse(tx, horizon - 100, 60, 30, 0, 0, Math.PI * 2);
                ctx.fill();
            }
            // Sun
            const sg = ctx.createRadialGradient(W * 0.75, horizon - 120, 0, W * 0.75, horizon - 120, 180);
            sg.addColorStop(0, theme.atmo);
            sg.addColorStop(0.5, theme.atmo + '66');
            sg.addColorStop(1, theme.atmo + '00');
            ctx.fillStyle = sg;
            ctx.globalAlpha = 0.8;
            ctx.beginPath();
            ctx.arc(W * 0.75, horizon - 120, 180, 0, Math.PI * 2);
            ctx.fill();
            break;
        }
        default: {
            // Generic — concentric rings
            for (let i = 0; i < 8; i++) {
                ctx.strokeStyle = theme.glow + '33';
                ctx.lineWidth = 2;
                ctx.beginPath();
                ctx.arc(W / 2, H / 2, 100 + i * 80, 0, Math.PI * 2);
                ctx.stroke();
            }
        }
    }
    ctx.restore();
}

function drawStar(ctx, cx, cy, spikes, outer, inner, color) {
    ctx.fillStyle = color;
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
    ctx.fill();
}

function paintVignette(ctx, theme) {
    // Final dark vignette overlay
    const vg = ctx.createRadialGradient(W / 2, H / 2, W * 0.2, W / 2, H / 2, W * 0.6);
    vg.addColorStop(0, '#00000000');
    vg.addColorStop(0.7, '#00000044');
    vg.addColorStop(1, '#000000cc');
    ctx.fillStyle = vg;
    ctx.fillRect(0, 0, W, H);

    // Bottom fade for bottom-bar contrast
    const bf = ctx.createLinearGradient(0, H - 150, 0, H);
    bf.addColorStop(0, '#00000000');
    bf.addColorStop(1, '#000000dd');
    ctx.fillStyle = bf;
    ctx.fillRect(0, H - 150, W, 150);
}

// ────────────────────────────────────────────────────────────────────
function renderBackground(game) {
    const canvas = createCanvas(W, H);
    const ctx = canvas.getContext('2d');
    const theme = pickTheme(game);
    const cat = game.themeCategory || game.theme || 'wildcard';
    const rng = makeRng(game.id + '_bg');

    paintBase(ctx, theme);
    paintAtmosphere(ctx, theme, rng);
    paintTheme(ctx, theme, cat, rng);
    paintVignette(ctx, theme);

    return canvas.toBuffer('image/png');
}

async function main() {
    if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });
    console.log(`Generating ${games.length} premium HD backgrounds (1920×1080)...`);
    let done = 0, failed = 0;
    for (const game of games) {
        try {
            const png = renderBackground(game);
            // Quality 78 keeps file size ~200KB for 1920×1080 backgrounds
            const webp = await sharp(png).webp({ quality: 78 }).toBuffer();
            fs.writeFileSync(path.join(OUT_DIR, game.id + '_bg.webp'), webp);
            done++;
            if (done % 10 === 0) process.stdout.write(`  ${done}/${games.length} `);
        } catch (err) {
            failed++;
            console.warn(`\n  [FAIL] ${game.id}: ${err.message}`);
        }
    }
    console.log(`\n\nDone. ${done} ok, ${failed} failed`);
    if (failed > 0) process.exit(1);
}

main().catch(err => {
    console.error('Fatal:', err);
    process.exit(1);
});
