'use strict';

/**
 * generate-thumbnails.js — Creates HD thumbnail PNGs for all 100 games.
 * Each thumbnail: 400×300 with theme-coloured gradient background,
 * game title, emoji symbols, and provider badge.
 */

const { createCanvas, registerFont } = require('canvas');
const fs = require('fs');
const path = require('path');
const games = require('../shared/game-definitions');

const OUT_DIR = path.join(__dirname, '..', 'assets', 'thumbnails');
if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });

const W = 400, H = 300;

// Theme colour palettes: [gradStart, gradEnd, accent, textShadow]
const THEME_PALETTES = {
  egypt:      ['#1a0a2e', '#3d1c6e', '#ffd700', '#000'],
  fruit:      ['#1b5e20', '#388e3c', '#ffeb3b', '#000'],
  space:      ['#0d0221', '#1a237e', '#00e5ff', '#000'],
  fantasy:    ['#1a0033', '#4a148c', '#e040fb', '#000'],
  animals:    ['#1b3a1a', '#2e7d32', '#ff9800', '#000'],
  asian:      ['#4a0000', '#b71c1c', '#ffd700', '#000'],
  horror:     ['#0a0a0a', '#2c0a0a', '#ff1744', '#000'],
  australian: ['#3e2723', '#bf360c', '#ffab00', '#000'],
  wildcard:   ['#1a1a2e', '#16213e', '#00bcd4', '#000']
};

// Provider mapping — matches the 8 fictional studios
const STUDIO_MAP = {
  'Golden Reels Studio': { name: 'Golden Reels', color: '#D4A017' },
  'Nebula Gaming':       { name: 'Nebula', color: '#00F0FF' },
  'Mythic Forge':        { name: 'Mythic Forge', color: '#C8A415' },
  'Wild Frontier Games': { name: 'Wild Frontier', color: '#CC5500' },
  'Shadow Works':        { name: 'Shadow Works', color: '#8B0000' },
  'Dragon Pearl Studios':{ name: 'Dragon Pearl', color: '#CC0000' },
  'Ironclad Entertainment':{ name: 'Ironclad', color: '#B5651D' },
  'Cascade Labs':        { name: 'Cascade Labs', color: '#0066FF' }
};
const PROVIDERS = Object.values(STUDIO_MAP);

function getProvider(game, index) {
  if (game.provider && STUDIO_MAP[game.provider]) return STUDIO_MAP[game.provider];
  return PROVIDERS[index % PROVIDERS.length];
}

function titleCase(str) {
  return str.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

function drawRoundedRect(ctx, x, y, w, h, r) {
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

function generateThumbnail(game, index) {
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');
  const palette = THEME_PALETTES[game.themeCategory] || THEME_PALETTES[game.theme] || THEME_PALETTES.wildcard;
  const provider = getProvider(game, index);

  // === Background gradient ===
  const grad = ctx.createLinearGradient(0, 0, W, H);
  grad.addColorStop(0, palette[0]);
  grad.addColorStop(1, palette[1]);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, W, H);

  // === Decorative circles (bokeh effect) ===
  for (let i = 0; i < 8; i++) {
    const cx = Math.random() * W;
    const cy = Math.random() * H;
    const r = 20 + Math.random() * 60;
    const radGrad = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
    radGrad.addColorStop(0, palette[2] + '15');
    radGrad.addColorStop(1, palette[2] + '00');
    ctx.fillStyle = radGrad;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();
  }

  // === Border frame ===
  ctx.strokeStyle = palette[2] + '40';
  ctx.lineWidth = 2;
  drawRoundedRect(ctx, 8, 8, W - 16, H - 16, 12);
  ctx.stroke();

  // === Accent line at top ===
  const topGrad = ctx.createLinearGradient(0, 0, W, 0);
  topGrad.addColorStop(0, palette[2] + '00');
  topGrad.addColorStop(0.5, palette[2] + 'aa');
  topGrad.addColorStop(1, palette[2] + '00');
  ctx.fillStyle = topGrad;
  ctx.fillRect(0, 0, W, 3);

  // === Decorative symbol dots (replaces garbled text symbols) ===
  // Instead of rendering symbol ID strings, draw themed decorative dots
  const symCount = Math.min((game.symbols || []).length, 5) || 3;
  ctx.textAlign = 'center';
  const symY = 65;
  const dotSpacing = W / (symCount + 1);
  for (let si = 0; si < symCount; si++) {
    const dx = dotSpacing * (si + 1);
    // Glowing accent dot
    const dotGrad = ctx.createRadialGradient(dx, symY, 0, dx, symY, 14);
    dotGrad.addColorStop(0, palette[2]);
    dotGrad.addColorStop(0.5, palette[2] + '60');
    dotGrad.addColorStop(1, palette[2] + '00');
    ctx.fillStyle = dotGrad;
    ctx.beginPath();
    ctx.arc(dx, symY, 14, 0, Math.PI * 2);
    ctx.fill();
    // Solid center
    ctx.fillStyle = palette[2];
    ctx.beginPath();
    ctx.arc(dx, symY, 4, 0, Math.PI * 2);
    ctx.fill();
  }

  // === Game title ===
  const title = game.name || titleCase(game.id);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  // Auto-size font
  let fontSize = 34;
  ctx.font = `bold ${fontSize}px sans-serif`;
  while (ctx.measureText(title).width > W - 60 && fontSize > 18) {
    fontSize -= 2;
    ctx.font = `bold ${fontSize}px sans-serif`;
  }

  // Text shadow
  ctx.shadowColor = '#000';
  ctx.shadowBlur = 8;
  ctx.shadowOffsetX = 2;
  ctx.shadowOffsetY = 2;
  ctx.fillStyle = '#ffffff';
  ctx.fillText(title, W / 2, H / 2 + 10);
  ctx.shadowBlur = 0;
  ctx.shadowOffsetX = 0;
  ctx.shadowOffsetY = 0;

  // === Accent underline below title ===
  const tw = ctx.measureText(title).width;
  const underGrad = ctx.createLinearGradient(W/2 - tw/2, 0, W/2 + tw/2, 0);
  underGrad.addColorStop(0, palette[2] + '00');
  underGrad.addColorStop(0.5, palette[2]);
  underGrad.addColorStop(1, palette[2] + '00');
  ctx.fillStyle = underGrad;
  ctx.fillRect(W/2 - tw/2, H/2 + 10 + fontSize/2 + 4, tw, 2);

  // === RTP badge (bottom left) ===
  const rtpText = (game.rtp || 0).toFixed(1) + '% RTP';
  ctx.font = 'bold 12px sans-serif';
  ctx.textAlign = 'left';
  ctx.fillStyle = palette[2] + 'cc';
  ctx.fillText(rtpText, 20, H - 20);

  // === Provider badge (bottom right) ===
  ctx.font = 'bold 11px sans-serif';
  ctx.textAlign = 'right';
  ctx.fillStyle = provider.color + 'cc';
  ctx.fillText(provider.name, W - 20, H - 20);

  // === Theme badge (top right) ===
  ctx.font = '10px sans-serif';
  ctx.textAlign = 'right';
  ctx.fillStyle = '#ffffff80';
  ctx.fillText((game.themeCategory || game.theme || 'wildcard').toUpperCase(), W - 20, 25);

  // === Hot badge ===
  if (game.hot || game.tag === 'HOT') {
    ctx.font = 'bold 11px sans-serif';
    ctx.textAlign = 'left';
    ctx.fillStyle = '#ff1744';
    ctx.fillText('🔥 HOT', 20, 25);
  }

  return canvas.toBuffer('image/png');
}

// === Generate all ===
let created = 0, skipped = 0;
games.forEach((game, i) => {
  const outPath = path.join(OUT_DIR, game.id + '.png');
  // Always regenerate to get consistent style
  const buf = generateThumbnail(game, i);
  fs.writeFileSync(outPath, buf);
  created++;
  if ((created % 20) === 0) console.log(`  ... ${created}/${games.length}`);
});

console.log(`\nDone! Created ${created} thumbnails in ${OUT_DIR}`);
console.log(`Skipped ${skipped} (already existed)`);

// Verify
const files = fs.readdirSync(OUT_DIR);
console.log(`Total files in thumbnails dir: ${files.length}`);
