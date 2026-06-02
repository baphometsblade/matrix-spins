#!/usr/bin/env node
/**
 * unique-game-themes.js
 *
 * Gives EVERY game a unique in-game accent colour so no two slots share the
 * same GUI chrome. The casino engine renders all chrome (topbar, buttons, reel
 * border, win glow, focus rings) from `studioTheme.primaryColor`, so a unique
 * primaryColor per game = a unique-looking GUI.
 *
 * Each accent is derived from the game's (now unique) background art — the most
 * vibrant hue in the image — so the chrome harmonises with the art. Greyscale
 * art falls back to a deterministic hue from the slug. A final dedupe pass
 * guarantees no two games end up with the same hex.
 *
 * Updates the inline `studioTheme` { primaryColor, secondaryColor, accentColor }
 * in each games/<slug>.html. Idempotent-ish (re-run recomputes from art).
 *
 *   node scripts/unique-game-themes.js            apply
 *   node scripts/unique-game-themes.js --dry-run  print the colour table only
 */
'use strict';

const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const ROOT = path.resolve(__dirname, '..');
const GAMES_DIR = path.join(ROOT, 'games');
const BG_DIR = path.join(ROOT, 'assets', 'backgrounds', 'slots');
const DRY = process.argv.includes('--dry-run');

// ── colour helpers ──────────────────────────────────────────────────────────
function rgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
  let h, s; const l = (mx + mn) / 2;
  if (mx === mn) { h = 0; s = 0; }
  else {
    const d = mx - mn;
    s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
    switch (mx) {
      case r: h = (g - b) / d + (g < b ? 6 : 0); break;
      case g: h = (b - r) / d + 2; break;
      default: h = (r - g) / d + 4;
    }
    h /= 6;
  }
  return [h * 360, s, l];
}
function hslToHex(h, s, l) {
  h = ((h % 360) + 360) % 360 / 360;
  const f = (p, q, t) => {
    if (t < 0) t += 1; if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  let r, g, b;
  if (s === 0) { r = g = b = l; }
  else {
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    r = f(p, q, h + 1 / 3); g = f(p, q, h); b = f(p, q, h - 1 / 3);
  }
  const to = (x) => ('0' + Math.round(x * 255).toString(16)).slice(-2);
  return '#' + to(r) + to(g) + to(b);
}
function hashHue(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) >>> 0;
  return h % 360;
}

// Extract the dominant *vibrant* hue: histogram saturated, mid-bright pixels.
async function vibrantHue(file, slug) {
  try {
    const { data, info } = await sharp(file).resize(40, 40, { fit: 'cover' })
      .raw().toBuffer({ resolveWithObject: true });
    const ch = info.channels;
    const buckets = new Array(36).fill(0); // 10° buckets
    for (let i = 0; i < data.length; i += ch) {
      const [h, s, l] = rgbToHsl(data[i], data[i + 1], data[i + 2]);
      if (s > 0.22 && l > 0.18 && l < 0.85) buckets[Math.floor(h / 10) % 36] += s * s;
    }
    let best = -1, bi = -1;
    for (let i = 0; i < 36; i++) if (buckets[i] > best) { best = buckets[i]; bi = i; }
    if (best <= 0) return { hue: hashHue(slug), src: 'hash(greyscale art)' };
    // refine: saturation-weighted mean hue within the winning bucket's neighbourhood
    let sx = 0, sy = 0, w = 0;
    for (let i = 0; i < data.length; i += ch) {
      const [h, s, l] = rgbToHsl(data[i], data[i + 1], data[i + 2]);
      if (s > 0.22 && l > 0.18 && l < 0.85) {
        const dist = Math.min(Math.abs(h - bi * 10 - 5), 360 - Math.abs(h - bi * 10 - 5));
        if (dist < 25) { const ww = s * s; sx += Math.cos(h * Math.PI / 180) * ww; sy += Math.sin(h * Math.PI / 180) * ww; w += ww; }
      }
    }
    const hue = w > 0 ? (Math.atan2(sy, sx) * 180 / Math.PI + 360) % 360 : bi * 10 + 5;
    return { hue, src: 'art' };
  } catch (e) {
    return { hue: hashHue(slug), src: 'hash(' + e.message + ')' };
  }
}

function listSlugs() {
  return fs.readdirSync(GAMES_DIR).filter((f) => f.endsWith('.html')).map((f) => f.replace(/\.html$/, '')).sort();
}

// Replace a colour value INSIDE the studioTheme block. Handles BOTH the
// single-quote JS style (primaryColor: '#abc') used by ~100 pages AND the
// double-quote JSON style ("primaryColor": "#abc") used by ~20 pages.
function setThemeColor(html, key, value) {
  // single-quote: studioTheme: { ... primaryColor: '...'
  let re = new RegExp('("?studioTheme"?\\s*:\\s*\\{[\\s\\S]*?\\b' + key + ":\\s*')([^']*)(')");
  if (re.test(html)) return html.replace(re, '$1' + value + '$3');
  // double-quote: "studioTheme": { ... "primaryColor": "..."
  re = new RegExp('("?studioTheme"?\\s*:\\s*\\{[\\s\\S]*?"' + key + '"\\s*:\\s*")([^"]*)(")');
  if (re.test(html)) return html.replace(re, '$1' + value + '$3');
  return html; // key absent — leave as-is
}

async function main() {
  const slugs = listSlugs();
  const used = new Set();
  const rows = [];

  for (const slug of slugs) {
    const bg = path.join(BG_DIR, `${slug}.webp`);
    const { hue, src } = fs.existsSync(bg) ? await vibrantHue(bg, slug) : { hue: hashHue(slug), src: 'hash(no bg)' };
    // vivid, UI-usable accent on a dark interface
    let primary = hslToHex(hue, 0.66, 0.57);
    // dedupe: nudge hue until the hex is globally unique
    let nudge = 0;
    while (used.has(primary)) { nudge += 11; primary = hslToHex(hue + nudge, 0.66, 0.57); }
    used.add(primary);
    const finalHue = hue + nudge;
    const secondary = hslToHex(finalHue + 28, 0.6, 0.55);   // analogous
    const accent = hslToHex(finalHue + 160, 0.6, 0.58);     // ~complementary
    rows.push({ slug, hue: Math.round(((finalHue % 360) + 360) % 360), primary, secondary, accent, src });
  }

  console.log(`Computed ${rows.length} unique accents (${new Set(rows.map((r) => r.primary)).size} distinct primary hexes).`);
  const fromArt = rows.filter((r) => r.src === 'art').length;
  console.log(`  ${fromArt} derived from art, ${rows.length - fromArt} from slug-hash fallback.\n`);
  for (const r of rows.slice(0, 12)) console.log(`  ${r.slug.padEnd(30)} hue ${String(r.hue).padStart(3)}  ${r.primary} / ${r.secondary} / ${r.accent}  [${r.src}]`);
  console.log('  …');

  if (DRY) { console.log('\nDRY RUN — no files changed.'); return; }

  let changed = 0;
  for (const r of rows) {
    const file = path.join(GAMES_DIR, `${r.slug}.html`);
    let html = fs.readFileSync(file, 'utf8');
    const before = html;
    html = setThemeColor(html, 'primaryColor', r.primary);
    html = setThemeColor(html, 'secondaryColor', r.secondary);
    html = setThemeColor(html, 'accentColor', r.accent);
    if (html !== before) { fs.writeFileSync(file, html); changed++; }
  }
  console.log(`\nUpdated studioTheme colours in ${changed}/${rows.length} game pages.`);
}

main().catch((e) => { console.error(e); process.exit(1); });
