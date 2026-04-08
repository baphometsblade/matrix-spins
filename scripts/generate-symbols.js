'use strict';

/**
 * generate-symbols.js — Creates symbol PNG sets for games that lack them.
 * Each game gets a directory with individual symbol PNGs (128×128).
 */

const { createCanvas } = require('canvas');
const fs = require('fs');
const path = require('path');
const games = require('../shared/game-definitions');

const SYM_DIR = path.join(__dirname, '..', 'assets', 'game_symbols');
if (!fs.existsSync(SYM_DIR)) fs.mkdirSync(SYM_DIR, { recursive: true });

const S = 128; // Symbol size

const THEME_PALETTES = {
  egypt:      { bg: '#1a0a2e', ring: '#ffd700', glow: '#ffd70060' },
  fruit:      { bg: '#1b5e20', ring: '#ffeb3b', glow: '#ffeb3b60' },
  space:      { bg: '#0d0221', ring: '#00e5ff', glow: '#00e5ff60' },
  fantasy:    { bg: '#1a0033', ring: '#e040fb', glow: '#e040fb60' },
  animals:    { bg: '#1b3a1a', ring: '#ff9800', glow: '#ff980060' },
  asian:      { bg: '#4a0000', ring: '#ffd700', glow: '#ffd70060' },
  horror:     { bg: '#0a0a0a', ring: '#ff1744', glow: '#ff174460' },
  australian: { bg: '#3e2723', ring: '#ffab00', glow: '#ffab0060' },
  wildcard:   { bg: '#1a1a2e', ring: '#00bcd4', glow: '#00bcd460' }
};

function generateSymbolPNG(emoji, theme, isWild) {
  const canvas = createCanvas(S, S);
  const ctx = canvas.getContext('2d');
  const pal = THEME_PALETTES[theme] || THEME_PALETTES.wildcard;

  // Background circle
  const cx = S / 2, cy = S / 2, r = S / 2 - 4;

  // Outer glow
  const glowGrad = ctx.createRadialGradient(cx, cy, r * 0.6, cx, cy, r * 1.1);
  glowGrad.addColorStop(0, pal.glow);
  glowGrad.addColorStop(1, 'transparent');
  ctx.fillStyle = glowGrad;
  ctx.fillRect(0, 0, S, S);

  // Main circle bg
  const bgGrad = ctx.createRadialGradient(cx, cy - 10, 0, cx, cy, r);
  bgGrad.addColorStop(0, lighten(pal.bg, 30));
  bgGrad.addColorStop(1, pal.bg);
  ctx.fillStyle = bgGrad;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fill();

  // Ring
  ctx.strokeStyle = isWild ? '#ffd700' : pal.ring;
  ctx.lineWidth = isWild ? 4 : 2;
  ctx.beginPath();
  ctx.arc(cx, cy, r - 2, 0, Math.PI * 2);
  ctx.stroke();

  // Emoji
  ctx.font = `${isWild ? 52 : 48}px serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.shadowColor = isWild ? '#ffd700' : pal.ring;
  ctx.shadowBlur = isWild ? 12 : 6;
  ctx.fillStyle = '#fff';
  ctx.fillText(emoji, cx, cy + 2);
  ctx.shadowBlur = 0;

  // Wild label
  if (isWild) {
    ctx.font = 'bold 14px sans-serif';
    ctx.fillStyle = '#ffd700';
    ctx.fillText('WILD', cx, cy + 36);
  }

  return canvas.toBuffer('image/png');
}

function lighten(hex, amount) {
  const num = parseInt(hex.replace('#', ''), 16);
  const r = Math.min(255, (num >> 16) + amount);
  const g = Math.min(255, ((num >> 8) & 0xff) + amount);
  const b = Math.min(255, (num & 0xff) + amount);
  return `#${(r << 16 | g << 8 | b).toString(16).padStart(6, '0')}`;
}

let totalGames = 0, totalSymbols = 0;

games.forEach(game => {
  const gameDir = path.join(SYM_DIR, game.id);

  // Skip games that already have good symbol dirs
  if (fs.existsSync(gameDir) && fs.readdirSync(gameDir).length >= 5) {
    return;
  }

  if (!fs.existsSync(gameDir)) fs.mkdirSync(gameDir, { recursive: true });

  const symbols = game.symbols || [];
  const theme = game.theme || 'wildcard';

  symbols.forEach((sym, si) => {
    const emoji = typeof sym === 'string' ? sym : (sym.emoji || sym.symbol || '⭐');
    const isWild = (typeof sym === 'object' && sym.wild) || emoji === '🃏' || (typeof sym === 'string' && sym === '🃏');
    const buf = generateSymbolPNG(emoji, theme, isWild);
    const filename = `symbol_${si}.png`;
    fs.writeFileSync(path.join(gameDir, filename), buf);
    totalSymbols++;
  });

  totalGames++;
  if (totalGames % 20 === 0) console.log(`  ... ${totalGames} games processed`);
});

console.log(`\nDone! Generated symbols for ${totalGames} games (${totalSymbols} total symbol PNGs)`);
console.log(`Total game_symbol dirs: ${fs.readdirSync(SYM_DIR).length}`);
