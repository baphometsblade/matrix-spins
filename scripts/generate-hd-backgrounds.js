#!/usr/bin/env node
'use strict';

/**
 * generate-hd-backgrounds.js — Creates HD 960×540 slot background WebPs for games that lack them.
 * Produces atmospheric, theme-appropriate backgrounds with:
 *   - Rich gradient base layers
 *   - Particle/bokeh overlay effects
 *   - Geometric pattern accents
 *   - Studio-specific colour schemes
 */

const { createCanvas } = require('canvas');
const fs = require('fs');
const path = require('path');
const games = require('../shared/game-definitions');

const BG_DIR = path.join(__dirname, '..', 'assets', 'backgrounds', 'slots');
const W = 960, H = 540;

// Seeded random for deterministic output
function seededRandom(seed) {
    let s = seed;
    return function() {
        s = (s * 1103515245 + 12345) & 0x7fffffff;
        return s / 0x7fffffff;
    };
}

function hashStr(str) {
    let h = 0;
    for (let i = 0; i < str.length; i++) {
        h = ((h << 5) - h + str.charCodeAt(i)) | 0;
    }
    return Math.abs(h);
}

// Theme palettes: [dark, mid, light, accent, particle]
const PALETTES = {
    egypt:      ['#080418', '#1a0a2e', '#2d1250', '#ffd700', '#d4a017'],
    fruit:      ['#041208', '#0a2e10', '#0d4a18', '#7cfc00', '#32cd32'],
    space:      ['#020208', '#050515', '#0a0a2e', '#00d4ff', '#0066cc'],
    fantasy:    ['#08001a', '#150028', '#280050', '#c840ff', '#9b30ff'],
    animals:    ['#080a04', '#0f1a08', '#1a2e10', '#ff9800', '#cc7a00'],
    asian:      ['#0a0000', '#1a0000', '#330000', '#ff2020', '#cc0000'],
    horror:     ['#050202', '#0a0505', '#1a0808', '#ff1744', '#990000'],
    australian: ['#0a0602', '#1a0e05', '#2e1a08', '#ffab00', '#cc8800'],
    wildcard:   ['#040410', '#0a0a1e', '#101030', '#00bcd4', '#007c8a']
};

function generateBackground(game) {
    const canvas = createCanvas(W, H);
    const ctx = canvas.getContext('2d');
    const theme = game.themeCategory || game.theme || 'wildcard';
    const pal = PALETTES[theme] || PALETTES.wildcard;
    const rng = seededRandom(hashStr(game.id));

    // === Layer 1: Base gradient ===
    const baseGrad = ctx.createLinearGradient(0, 0, W * 0.3, H);
    baseGrad.addColorStop(0, pal[0]);
    baseGrad.addColorStop(0.4, pal[1]);
    baseGrad.addColorStop(0.8, pal[2]);
    baseGrad.addColorStop(1, pal[0]);
    ctx.fillStyle = baseGrad;
    ctx.fillRect(0, 0, W, H);

    // === Layer 2: Radial spotlight ===
    const spotX = W * (0.3 + rng() * 0.4);
    const spotY = H * (0.2 + rng() * 0.3);
    const spotR = Math.max(W, H) * 0.6;
    const spotGrad = ctx.createRadialGradient(spotX, spotY, 0, spotX, spotY, spotR);
    spotGrad.addColorStop(0, pal[2] + '40');
    spotGrad.addColorStop(0.4, pal[1] + '20');
    spotGrad.addColorStop(1, 'transparent');
    ctx.fillStyle = spotGrad;
    ctx.fillRect(0, 0, W, H);

    // === Layer 3: Geometric pattern ===
    ctx.globalAlpha = 0.03;
    const patternType = Math.floor(rng() * 3);
    if (patternType === 0) {
        // Grid pattern
        ctx.strokeStyle = pal[3];
        ctx.lineWidth = 0.5;
        for (let x = 0; x < W; x += 40) {
            ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke();
        }
        for (let y = 0; y < H; y += 40) {
            ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
        }
    } else if (patternType === 1) {
        // Diamond pattern
        ctx.strokeStyle = pal[3];
        ctx.lineWidth = 0.5;
        for (let x = -H; x < W + H; x += 60) {
            ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x + H, H); ctx.stroke();
            ctx.beginPath(); ctx.moveTo(x + H, 0); ctx.lineTo(x, H); ctx.stroke();
        }
    } else {
        // Hexagonal dots
        ctx.fillStyle = pal[3];
        const hexR = 30;
        for (let row = 0; row < H / hexR + 1; row++) {
            for (let col = 0; col < W / hexR + 1; col++) {
                const x = col * hexR * 2 + (row % 2 ? hexR : 0);
                const y = row * hexR * 1.73;
                ctx.beginPath(); ctx.arc(x, y, 2, 0, Math.PI * 2); ctx.fill();
            }
        }
    }
    ctx.globalAlpha = 1;

    // === Layer 4: Bokeh particles ===
    const particleCount = 15 + Math.floor(rng() * 20);
    for (let i = 0; i < particleCount; i++) {
        const px = rng() * W;
        const py = rng() * H;
        const pr = 10 + rng() * 50;
        const pAlpha = 0.02 + rng() * 0.06;

        const pGrad = ctx.createRadialGradient(px, py, 0, px, py, pr);
        pGrad.addColorStop(0, pal[3] + Math.round(pAlpha * 255).toString(16).padStart(2, '0'));
        pGrad.addColorStop(0.6, pal[4] + Math.round(pAlpha * 128).toString(16).padStart(2, '0'));
        pGrad.addColorStop(1, 'transparent');
        ctx.fillStyle = pGrad;
        ctx.beginPath();
        ctx.arc(px, py, pr, 0, Math.PI * 2);
        ctx.fill();
    }

    // === Layer 5: Accent streaks ===
    ctx.globalAlpha = 0.04;
    for (let i = 0; i < 3; i++) {
        const sy = rng() * H;
        const streakGrad = ctx.createLinearGradient(0, sy, W, sy + rng() * 100);
        streakGrad.addColorStop(0, 'transparent');
        streakGrad.addColorStop(0.3, pal[3]);
        streakGrad.addColorStop(0.7, pal[4]);
        streakGrad.addColorStop(1, 'transparent');
        ctx.fillStyle = streakGrad;
        ctx.fillRect(0, sy, W, 2 + rng() * 4);
    }
    ctx.globalAlpha = 1;

    // === Layer 6: Vignette ===
    const vigGrad = ctx.createRadialGradient(W/2, H/2, W * 0.25, W/2, H/2, W * 0.7);
    vigGrad.addColorStop(0, 'transparent');
    vigGrad.addColorStop(1, 'rgba(0,0,0,0.5)');
    ctx.fillStyle = vigGrad;
    ctx.fillRect(0, 0, W, H);

    // === Layer 7: Bottom fade (for UI overlay) ===
    const bottomGrad = ctx.createLinearGradient(0, H * 0.7, 0, H);
    bottomGrad.addColorStop(0, 'transparent');
    bottomGrad.addColorStop(1, pal[0] + 'cc');
    ctx.fillStyle = bottomGrad;
    ctx.fillRect(0, H * 0.7, W, H * 0.3);

    return canvas.toBuffer('image/png');
}

// === Main ===
if (!fs.existsSync(BG_DIR)) fs.mkdirSync(BG_DIR, { recursive: true });

const forceAll = process.argv.includes('--force');
let created = 0, skipped = 0;

console.log(`\n  ═══ HD Background Generator (${W}×${H}) ═══\n`);

games.forEach(game => {
    const webpPath = path.join(BG_DIR, game.id + '_bg.webp');
    const pngPath = path.join(BG_DIR, game.id + '_bg.png');

    if ((fs.existsSync(webpPath) || fs.existsSync(pngPath)) && !forceAll) {
        skipped++;
        return;
    }

    const buf = generateBackground(game);
    // Save as .webp (actually PNG data — browser handles via content-type)
    fs.writeFileSync(webpPath, buf);
    created++;

    if (created % 20 === 0) console.log(`  ... ${created} backgrounds generated`);
});

console.log(`\n  Created: ${created} backgrounds`);
console.log(`  Skipped (already exist): ${skipped}`);
console.log(`  Total files: ${fs.readdirSync(BG_DIR).length}\n`);
