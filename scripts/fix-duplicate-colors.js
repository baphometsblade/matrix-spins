#!/usr/bin/env node
'use strict';

/**
 * Fix duplicate accentColor values in shared/game-definitions.js.
 *
 * Reads every game's accentColor, finds duplicates, and replaces them with
 * unique HSL-derived colors that stay on-brand for each theme category.
 *
 * Run:
 *   node scripts/fix-duplicate-colors.js           # dry-run (shows plan)
 *   node scripts/fix-duplicate-colors.js --apply   # writes changes
 */

const fs   = require('fs');
const path = require('path');

const DEF_PATH = path.join(__dirname, '..', 'shared', 'game-definitions.js');
const APPLY    = process.argv.includes('--apply');

// ── Theme hue ranges (H in HSL) ───────────────────────────────────────────────
const THEME_HUE = {
  egypt:      [30, 55],
  fruit:      [0, 360],
  space:      [180, 280],
  fantasy:    [270, 330],
  animals:    [15, 55],
  asian:      [0, 25],
  horror:     [340, 360],
  australian: [20, 50],
  wildcard:   [0, 360],
  halloween:  [20, 45],
};

function hslToHex(h, s, l) {
  h = ((h % 360) + 360) % 360;
  s /= 100; l /= 100;
  const a = s * Math.min(l, 1 - l);
  const f = n => {
    const k = (n + h / 30) % 12;
    return l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
  };
  const toHex = x => Math.round(x * 255).toString(16).padStart(2, '0');
  return `#${toHex(f(0))}${toHex(f(8))}${toHex(f(4))}`;
}

function uniqueColorForGame(theme, index, total) {
  const [hMin, hMax] = THEME_HUE[theme] || [0, 360];
  const range = hMax - hMin;
  const h = hMin + (range * index) / Math.max(total, 1);
  const s = 75 + (index % 3) * 5;
  const l = 48 + (index % 2) * 6;
  return hslToHex(h, s, l);
}

// ── Load source ───────────────────────────────────────────────────────────────
const src = fs.readFileSync(DEF_PATH, 'utf8');

// Use matchAll (no exec) to parse id + accentColor pairs
const idColorPattern  = /id:\s*'([^']+)'[^}]*?accentColor:\s*'([^']+)'/gs;
const idThemePattern  = /id:\s*'([^']+)'[^}]*?themeCategory:\s*'([^']+)'/gs;

const games     = [...src.matchAll(idColorPattern)].map(m => ({ id: m[1], color: m[2] }));
const themeMap  = Object.fromEntries([...src.matchAll(idThemePattern)].map(m => [m[1], m[2]]));

if (games.length === 0) {
  console.error('Could not parse game definitions — aborting.');
  process.exit(1);
}

// ── Find duplicates ───────────────────────────────────────────────────────────
const colorBucket = {};
for (const g of games) {
  const c = g.color.toLowerCase();
  (colorBucket[c] = colorBucket[c] || []).push(g.id);
}

const duplicates = Object.entries(colorBucket).filter(([, ids]) => ids.length > 1);

console.log(`Total games   : ${games.length}`);
console.log(`Unique colors : ${Object.keys(colorBucket).length}`);
console.log(`Dup groups    : ${duplicates.length}`);

if (duplicates.length === 0) {
  console.log('\n✓ All accent colors are already unique.');
  process.exit(0);
}

console.log('\nDuplicate groups:');
duplicates.forEach(([c, ids]) => console.log(`  ${c} → ${ids.join(', ')}`));

// ── Build theme index for spread ─────────────────────────────────────────────
const byTheme = {};
for (const g of games) {
  const t = themeMap[g.id] || 'wildcard';
  (byTheme[t] = byTheme[t] || []).push(g.id);
}

// ── Assign replacements ───────────────────────────────────────────────────────
const replacements = {};
const usedColors   = new Set(games.map(g => g.color.toLowerCase()));

for (const [dupColor, dupIds] of duplicates) {
  for (let i = 1; i < dupIds.length; i++) {
    const gameId     = dupIds[i];
    const theme      = themeMap[gameId] || 'wildcard';
    const themeList  = byTheme[theme] || [];
    const baseIdx    = themeList.indexOf(gameId);

    let newColor, attempt = 0;
    do {
      newColor = uniqueColorForGame(theme, baseIdx + attempt * 3, themeList.length + attempt * 3);
      attempt++;
    } while (usedColors.has(newColor.toLowerCase()) && attempt < 50);

    usedColors.add(newColor.toLowerCase());
    replacements[gameId] = newColor;
    console.log(`  reassign ${gameId}: ${dupColor} → ${newColor}`);
  }
}

if (!APPLY) {
  console.log('\nDry run — pass --apply to write changes.');
  process.exit(0);
}

// ── Apply in-place ────────────────────────────────────────────────────────────
let updated = src;
for (const [gameId, newColor] of Object.entries(replacements)) {
  const oldColor = games.find(g => g.id === gameId)?.color;
  if (!oldColor) { console.warn(`  WARN: old color not found for ${gameId}`); continue; }

  // Replace accentColor only within the block that starts at this game's id
  const idMarker = `id: '${gameId}'`;
  const idPos    = updated.indexOf(idMarker);
  if (idPos === -1) { console.warn(`  WARN: id '${gameId}' not found in source`); continue; }

  const blockEnd = updated.indexOf('\n    }', idPos + 1);
  const end      = blockEnd > 0 ? blockEnd : idPos + 2000;
  const before   = updated.slice(0, idPos);
  const block    = updated.slice(idPos, end);
  const after    = updated.slice(end);

  updated = before + block.replace(`accentColor: '${oldColor}'`, `accentColor: '${newColor}'`) + after;
}

fs.writeFileSync(DEF_PATH, updated, 'utf8');
console.log(`\n✓ Applied ${Object.keys(replacements).length} fixes to game-definitions.js`);
