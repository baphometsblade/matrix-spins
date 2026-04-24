#!/usr/bin/env node
'use strict';

/**
 * Premium HD Thumbnail Generator
 *
 * Produces 400×300 WebP thumbnails for every game with industry-standard
 * visual polish: multi-layer compositions, theme-specific decorative motifs,
 * dramatic lighting, depth, and typography. These are procedural (no AI) but
 * finished to a casino-lobby quality bar — far beyond the plain text-on-
 * gradient placeholders previously in tree.
 *
 * Output: assets/thumbnails/<game_id>.webp (quality 88)
 * Intermediate PNGs are written then converted via sharp to WebP, and the
 * PNG is removed so only the WebP ships.
 */

const { createCanvas } = require('canvas');
const sharp = require('sharp');
const fs = require('fs');
const path = require('path');
const games = require('../shared/game-definitions');

const OUT_DIR = path.join(__dirname, '..', 'assets', 'thumbnails');
if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });

const W = 400, H = 300;

// ────────────────────────────────────────────────────────────────────
//  Theme palettes
//
//  Each palette carries 6 colours:
//   0,1  linear-gradient top→bottom (background)
//   2    primary accent (title underline, glow, highlights)
//   3    secondary accent (border, motif)
//   4    deep shadow / vignette
//   5    light spotlight (top-down)
// ────────────────────────────────────────────────────────────────────
const THEMES = {
    egypt:      ['#2c1810', '#5a2a1f', '#ffd700', '#c8a415', '#0a0704', '#ffcc66'],
    fruit:      ['#1e4d28', '#3a7d45', '#ffd747', '#ff6f3c', '#0a1f0d', '#ffef99'],
    space:      ['#0a0a2e', '#1a1a4e', '#00e5ff', '#8a7dff', '#030315', '#66f0ff'],
    fantasy:    ['#2a0a3e', '#5a1a7e', '#e040fb', '#ffb347', '#0d0420', '#ffccf7'],
    animals:    ['#2a1f0a', '#5a3f1a', '#d4a017', '#cc5500', '#15100a', '#ffd966'],
    asian:      ['#3a0a0a', '#7a1a1a', '#ffd700', '#ff3030', '#150505', '#ff9999'],
    horror:     ['#0a0a0a', '#2a0505', '#ff1744', '#9932cc', '#000000', '#ff6666'],
    australian: ['#3a2317', '#8b4513', '#ffab00', '#66bb6a', '#1f130a', '#ffd966'],
    wildcard:   ['#1a1a2e', '#2a2a4e', '#00d4ff', '#ffcc00', '#0a0a15', '#99e6ff'],
    halloween:  ['#1a0533', '#4a0a5e', '#ff7700', '#a020f0', '#0a0215', '#ffcc99'],
};

function pickTheme(game) {
    return THEMES[game.themeCategory] || THEMES[game.theme] || THEMES.wildcard;
}

// ────────────────────────────────────────────────────────────────────
//  Deterministic PRNG (so regeneration is stable per game)
// ────────────────────────────────────────────────────────────────────
function makeRng(seed) {
    // mulberry32
    let s = 0;
    for (let i = 0; i < seed.length; i++) s = (s * 31 + seed.charCodeAt(i)) | 0;
    return function() {
        s |= 0; s = s + 0x6D2B79F5 | 0;
        let t = Math.imul(s ^ s >>> 15, 1 | s);
        t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
        return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
}

// ────────────────────────────────────────────────────────────────────
//  Painters
// ────────────────────────────────────────────────────────────────────
function paintBackground(ctx, palette, rng) {
    // Base diagonal gradient
    const g = ctx.createLinearGradient(0, 0, W, H);
    g.addColorStop(0, palette[0]);
    g.addColorStop(1, palette[1]);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);

    // Top spotlight (dramatic lighting from above)
    const spot = ctx.createRadialGradient(W / 2, -40, 0, W / 2, -40, W * 0.9);
    spot.addColorStop(0, palette[5] + 'cc');
    spot.addColorStop(0.35, palette[5] + '33');
    spot.addColorStop(1, palette[5] + '00');
    ctx.fillStyle = spot;
    ctx.fillRect(0, 0, W, H);

    // Bottom shadow fade (for title readability)
    const shade = ctx.createLinearGradient(0, H * 0.55, 0, H);
    shade.addColorStop(0, palette[4] + '00');
    shade.addColorStop(1, palette[4] + 'e0');
    ctx.fillStyle = shade;
    ctx.fillRect(0, 0, W, H);

    // Bokeh points for ambient depth
    for (let i = 0; i < 14; i++) {
        const cx = rng() * W;
        const cy = rng() * H;
        const r = 30 + rng() * 90;
        const bg = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
        bg.addColorStop(0, palette[2] + '18');
        bg.addColorStop(1, palette[2] + '00');
        ctx.fillStyle = bg;
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.fill();
    }
}

/**
 * Draw theme-appropriate decorative motif — the hero element that gives each
 * theme its own visual identity.
 */
function paintMotif(ctx, theme, palette, rng) {
    ctx.save();
    ctx.globalAlpha = 0.55;
    switch (theme) {
        case 'egypt': {
            // Pyramid silhouettes
            const base = H * 0.62;
            ctx.fillStyle = palette[2] + '66';
            ctx.beginPath();
            ctx.moveTo(W * 0.50, base - 90);
            ctx.lineTo(W * 0.30, base);
            ctx.lineTo(W * 0.70, base);
            ctx.closePath();
            ctx.fill();
            ctx.fillStyle = palette[3] + '44';
            ctx.beginPath();
            ctx.moveTo(W * 0.72, base - 55);
            ctx.lineTo(W * 0.58, base);
            ctx.lineTo(W * 0.86, base);
            ctx.closePath();
            ctx.fill();
            // Desert sand line
            ctx.strokeStyle = palette[2] + '99';
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            ctx.moveTo(0, base);
            ctx.lineTo(W, base);
            ctx.stroke();
            break;
        }
        case 'space': {
            // Stars + planet
            for (let i = 0; i < 40; i++) {
                const x = rng() * W;
                const y = rng() * H * 0.7;
                const s = rng() * 1.8 + 0.4;
                ctx.fillStyle = '#ffffff' + Math.floor(rng() * 180 + 40).toString(16).padStart(2, '0');
                ctx.beginPath();
                ctx.arc(x, y, s, 0, Math.PI * 2);
                ctx.fill();
            }
            // Crescent planet
            const pg = ctx.createRadialGradient(W * 0.78, H * 0.32, 5, W * 0.78, H * 0.32, 55);
            pg.addColorStop(0, palette[2]);
            pg.addColorStop(0.7, palette[1]);
            pg.addColorStop(1, palette[4] + '00');
            ctx.fillStyle = pg;
            ctx.beginPath();
            ctx.arc(W * 0.78, H * 0.32, 50, 0, Math.PI * 2);
            ctx.fill();
            break;
        }
        case 'fruit': {
            // Cluster of glossy fruit shapes
            const apples = [
                [W * 0.25, H * 0.4, 28, '#ff4545'],
                [W * 0.72, H * 0.35, 34, '#ffee55'],
                [W * 0.50, H * 0.48, 42, '#66dd33'],
                [W * 0.85, H * 0.55, 22, '#ff8844'],
                [W * 0.15, H * 0.55, 26, '#aa44dd']
            ];
            apples.forEach(([x, y, r, c]) => {
                const fg = ctx.createRadialGradient(x - r/3, y - r/3, 0, x, y, r);
                fg.addColorStop(0, c);
                fg.addColorStop(1, palette[4]);
                ctx.fillStyle = fg;
                ctx.beginPath();
                ctx.arc(x, y, r, 0, Math.PI * 2);
                ctx.fill();
                // Highlight
                ctx.fillStyle = '#ffffff88';
                ctx.beginPath();
                ctx.ellipse(x - r/3, y - r/3, r/4, r/6, -Math.PI/4, 0, Math.PI * 2);
                ctx.fill();
            });
            break;
        }
        case 'fantasy': {
            // Star bursts + sparkles
            for (let i = 0; i < 8; i++) {
                const x = rng() * W;
                const y = rng() * H * 0.7 + H * 0.1;
                const s = 6 + rng() * 14;
                drawStar(ctx, x, y, 5, s, s / 2.5, palette[2] + 'cc');
            }
            // Crystal pyramid
            const cx = W * 0.5, cy = H * 0.45;
            const h = 60;
            ctx.fillStyle = palette[2] + '77';
            ctx.beginPath();
            ctx.moveTo(cx, cy - h);
            ctx.lineTo(cx + h * 0.6, cy);
            ctx.lineTo(cx, cy + h);
            ctx.lineTo(cx - h * 0.6, cy);
            ctx.closePath();
            ctx.fill();
            ctx.fillStyle = palette[5] + '99';
            ctx.beginPath();
            ctx.moveTo(cx, cy - h);
            ctx.lineTo(cx + h * 0.6, cy);
            ctx.lineTo(cx - h * 0.6, cy);
            ctx.closePath();
            ctx.fill();
            break;
        }
        case 'animals': {
            // Jungle leaf silhouettes + animal eyes glow
            ctx.strokeStyle = palette[3] + '88';
            ctx.lineWidth = 3;
            for (let i = 0; i < 6; i++) {
                const x = rng() * W;
                const y = rng() * H;
                const r = 30 + rng() * 40;
                ctx.beginPath();
                ctx.ellipse(x, y, r, r * 0.35, rng() * Math.PI, 0, Math.PI * 2);
                ctx.stroke();
            }
            // Glowing eyes
            [[W * 0.3, H * 0.45], [W * 0.7, H * 0.45]].forEach(([x, y]) => {
                const eg = ctx.createRadialGradient(x, y, 0, x, y, 14);
                eg.addColorStop(0, palette[2]);
                eg.addColorStop(1, palette[2] + '00');
                ctx.fillStyle = eg;
                ctx.beginPath();
                ctx.arc(x, y, 14, 0, Math.PI * 2);
                ctx.fill();
            });
            break;
        }
        case 'asian': {
            // Dragon scales (diamond grid) + red lanterns
            ctx.fillStyle = palette[3] + '55';
            for (let r = 0; r < 6; r++) {
                for (let c = 0; c < 8; c++) {
                    const x = c * 55 + (r % 2 ? 27 : 0);
                    const y = r * 30 + 40;
                    ctx.beginPath();
                    ctx.moveTo(x, y - 8);
                    ctx.lineTo(x + 12, y);
                    ctx.lineTo(x, y + 8);
                    ctx.lineTo(x - 12, y);
                    ctx.closePath();
                    ctx.fill();
                }
            }
            break;
        }
        case 'horror': {
            // Blood drips + moon
            ctx.fillStyle = palette[2] + '88';
            for (let i = 0; i < 5; i++) {
                const x = 40 + i * 80;
                ctx.beginPath();
                ctx.moveTo(x, 0);
                ctx.bezierCurveTo(x - 4, 20, x + 4, 30, x, 50 + rng() * 30);
                ctx.lineTo(x + 5, 50);
                ctx.bezierCurveTo(x + 9, 30, x + 1, 20, x + 5, 0);
                ctx.closePath();
                ctx.fill();
            }
            // Moon
            const mg = ctx.createRadialGradient(W * 0.78, H * 0.28, 5, W * 0.78, H * 0.28, 40);
            mg.addColorStop(0, '#eeeeee');
            mg.addColorStop(1, '#eeeeee00');
            ctx.fillStyle = mg;
            ctx.beginPath();
            ctx.arc(W * 0.78, H * 0.28, 38, 0, Math.PI * 2);
            ctx.fill();
            break;
        }
        case 'australian': {
            // Boomerang arcs + sun
            ctx.strokeStyle = palette[2] + '88';
            ctx.lineWidth = 4;
            for (let i = 0; i < 3; i++) {
                ctx.beginPath();
                const cx = W * (0.3 + i * 0.2);
                const cy = H * 0.35 + i * 20;
                ctx.arc(cx, cy, 35 + i * 8, Math.PI * 0.8, Math.PI * 2.2);
                ctx.stroke();
            }
            // Sun
            const sg = ctx.createRadialGradient(W * 0.8, H * 0.3, 5, W * 0.8, H * 0.3, 50);
            sg.addColorStop(0, palette[2]);
            sg.addColorStop(0.6, palette[2] + '44');
            sg.addColorStop(1, palette[2] + '00');
            ctx.fillStyle = sg;
            ctx.beginPath();
            ctx.arc(W * 0.8, H * 0.3, 50, 0, Math.PI * 2);
            ctx.fill();
            break;
        }
        default: {
            // Generic glow rings
            for (let i = 0; i < 5; i++) {
                ctx.strokeStyle = palette[2] + '55';
                ctx.lineWidth = 2;
                ctx.beginPath();
                ctx.arc(W * 0.5, H * 0.45, 30 + i * 22, 0, Math.PI * 2);
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

function paintBorder(ctx, palette) {
    // Outer gold frame
    ctx.strokeStyle = palette[2];
    ctx.lineWidth = 3;
    roundRect(ctx, 5, 5, W - 10, H - 10, 14);
    ctx.stroke();
    // Inner thin frame
    ctx.strokeStyle = palette[3] + '88';
    ctx.lineWidth = 1;
    roundRect(ctx, 10, 10, W - 20, H - 20, 10);
    ctx.stroke();
    // Corner accents
    const accentLen = 22;
    ctx.strokeStyle = palette[2];
    ctx.lineWidth = 2.5;
    [[12, 12, 1, 1], [W - 12, 12, -1, 1], [12, H - 12, 1, -1], [W - 12, H - 12, -1, -1]].forEach(([x, y, dx, dy]) => {
        ctx.beginPath();
        ctx.moveTo(x, y + dy * accentLen);
        ctx.lineTo(x, y);
        ctx.lineTo(x + dx * accentLen, y);
        ctx.stroke();
    });
}

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

function paintTitle(ctx, title, palette) {
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    // Auto-size
    let size = 38;
    ctx.font = `900 ${size}px "Arial Black", sans-serif`;
    while (ctx.measureText(title).width > W - 60 && size > 20) {
        size -= 2;
        ctx.font = `900 ${size}px "Arial Black", sans-serif`;
    }
    const cx = W / 2;
    const cy = H * 0.68;

    // Stroke shadow for punch
    ctx.strokeStyle = palette[4];
    ctx.lineWidth = 5;
    ctx.strokeText(title, cx, cy + 2);

    // Glow
    ctx.shadowColor = palette[2];
    ctx.shadowBlur = 18;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 0;
    ctx.fillStyle = '#ffffff';
    ctx.fillText(title, cx, cy);
    ctx.shadowBlur = 0;

    // Accent underline
    const w = ctx.measureText(title).width;
    const ug = ctx.createLinearGradient(cx - w/2, 0, cx + w/2, 0);
    ug.addColorStop(0, palette[2] + '00');
    ug.addColorStop(0.5, palette[2]);
    ug.addColorStop(1, palette[2] + '00');
    ctx.fillStyle = ug;
    ctx.fillRect(cx - w/2, cy + size/2 + 4, w, 2);
}

function paintChrome(ctx, game, palette) {
    ctx.font = 'bold 12px sans-serif';

    // RTP badge (bottom-left)
    const rtp = (game.rtp || 88).toFixed(1) + '% RTP';
    ctx.textAlign = 'left';
    ctx.fillStyle = palette[2];
    ctx.fillText(rtp, 18, H - 18);

    // Provider badge (bottom-right)
    if (game.provider) {
        ctx.textAlign = 'right';
        ctx.font = 'bold 11px sans-serif';
        ctx.fillStyle = '#ffffffaa';
        ctx.fillText(game.provider.toUpperCase(), W - 18, H - 18);
    }

    // Theme pill (top-right)
    const theme = (game.themeCategory || 'slots').toUpperCase();
    ctx.font = 'bold 10px sans-serif';
    ctx.textAlign = 'right';
    ctx.fillStyle = '#ffffff88';
    ctx.fillText(theme, W - 18, 22);

    // HOT / NEW / JACKPOT badge (top-left)
    const tag = game.tag;
    if (tag) {
        const colors = {
            HOT:     ['#ff3030', '#ffffff', '🔥'],
            NEW:     ['#2ecc71', '#ffffff', '✨'],
            JACKPOT: ['#ffd700', '#000000', '💰'],
            MEGA:    ['#e040fb', '#ffffff', '⭐']
        };
        const c = colors[tag] || ['#ffffff', '#000000', '●'];
        ctx.textAlign = 'left';
        ctx.font = 'bold 10px sans-serif';
        // Pill background
        const text = c[2] + ' ' + tag;
        const pillW = ctx.measureText(text).width + 14;
        ctx.fillStyle = c[0];
        roundRect(ctx, 14, 12, pillW, 18, 9);
        ctx.fill();
        ctx.fillStyle = c[1];
        ctx.textBaseline = 'middle';
        ctx.fillText(text, 21, 21);
    }
}

// ────────────────────────────────────────────────────────────────────
//  Compose one thumbnail
// ────────────────────────────────────────────────────────────────────
function renderThumbnail(game) {
    const canvas = createCanvas(W, H);
    const ctx = canvas.getContext('2d');
    const palette = pickTheme(game);
    const rng = makeRng(game.id);
    const theme = game.themeCategory || game.theme || 'wildcard';

    paintBackground(ctx, palette, rng);
    paintMotif(ctx, theme, palette, rng);
    paintBorder(ctx, palette);
    paintTitle(ctx, game.name || game.id, palette);
    paintChrome(ctx, game, palette);

    return canvas.toBuffer('image/png');
}

// ────────────────────────────────────────────────────────────────────
//  Main
// ────────────────────────────────────────────────────────────────────
async function main() {
    console.log(`Generating ${games.length} premium HD thumbnails...`);
    let done = 0, failed = 0;
    for (const game of games) {
        try {
            const png = renderThumbnail(game);
            const webp = await sharp(png).webp({ quality: 88 }).toBuffer();
            fs.writeFileSync(path.join(OUT_DIR, game.id + '.webp'), webp);
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
