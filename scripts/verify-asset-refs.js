#!/usr/bin/env node
/**
 * verify-asset-refs.js — Audit that every custom asset *referenced* across the
 * app actually exists on disk at the path it is referenced by.
 *
 * Distinct from verify-assets.js (which validates game-definition completeness).
 * This walks the SHIPPED reference surface and resolves each path:
 *   1. BACKGROUNDS   — games/*.html  background-image url() -> file on disk
 *   2. THUMBNAILS    — shared/game-definitions.js + js/game-registry.js thumbnail paths
 *   3. SYMBOL ART    — shared/asset-map.json symbolDir -> assets/game_symbols/<dir>/
 *   4. UI ASSETS     — assets/ui sym_* referenced in js/globals.js
 *   5. BRANDING      — assets/branding logo / hero / loading
 *   6. STUDIO LOGOS  — assets/studio-logos/*.svg referenced in games/*.html
 *   7. STATIC SERVE  — confirm server mounts the assets dir statically
 *
 * Exit 0 = all good, 1 = missing references. Run: node scripts/verify-asset-refs.js
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const exists = (p) => { try { return fs.statSync(p).isFile(); } catch { return false; } };
const dirExists = (p) => { try { return fs.statSync(p).isDirectory(); } catch { return false; } };
const rel = (p) => path.relative(ROOT, p).replace(/\\/g, '/');

const missing = [];
let checked = 0;

function check(section, refStr, resolvedPath, source) {
  checked++;
  if (!exists(resolvedPath)) {
    missing.push({ section, ref: refStr, resolved: rel(resolvedPath), source });
    return false;
  }
  return true;
}

// 1. BACKGROUNDS ------------------------------------------------------------
function checkBackgrounds() {
  const gamesDir = path.join(ROOT, 'games');
  const htmls = fs.readdirSync(gamesDir).filter((f) => f.endsWith('.html'));
  let withBg = 0;
  for (const file of htmls) {
    const html = fs.readFileSync(path.join(gamesDir, file), 'utf8');
    const re = /background-image\s*:\s*url\(\s*['"]?([^'")]+)['"]?\s*\)/gi;
    let m, found = false;
    while ((m = re.exec(html)) !== null) {
      const url = m[1].trim();
      if (/^(data:|https?:)/i.test(url)) continue;
      found = true; withBg++;
      check('BACKGROUND', url, path.resolve(gamesDir, url), `games/${file}`);
    }
    // A page with a CSS gradient background-image (no asset url) is a valid
    // fallback — common for non-slot/casual pages (mines, scratch-cards).
    const hasGradient = /background(?:-image)?\s*:\s*[^;}]*gradient\(/i.test(html);
    if (!found && !hasGradient) {
      missing.push({ section: 'BACKGROUND', ref: '(no background-image or gradient)', resolved: '-', source: `games/${file}` });
    }
  }
  return { total: htmls.length, withBg };
}

// 2. THUMBNAILS -------------------------------------------------------------
function checkThumbnails() {
  const sources = ['shared/game-definitions.js', 'js/game-registry.js'];
  let count = 0;
  for (const src of sources) {
    const p = path.join(ROOT, src);
    if (!exists(p)) continue;
    const txt = fs.readFileSync(p, 'utf8');
    const re = /thumbnail\s*:\s*['"]([^'"]+)['"]/g;
    let m;
    while ((m = re.exec(txt)) !== null) {
      const url = m[1].trim();
      if (/^(data:|https?:)/i.test(url)) continue;
      count++;
      check('THUMBNAIL', url, path.resolve(ROOT, url.replace(/^\//, '')), src);
    }
  }
  return count;
}

// 3. SYMBOL ART -------------------------------------------------------------
function checkSymbolArt() {
  const map = JSON.parse(fs.readFileSync(path.join(ROOT, 'shared/asset-map.json'), 'utf8'));
  const games = map.games || {};
  let symDirs = 0;
  for (const [slug, info] of Object.entries(games)) {
    if (!info || !info.symbolDir) continue;
    symDirs++;
    const dir = path.join(ROOT, 'assets/game_symbols', info.symbolDir);
    checked++;
    if (!dirExists(dir)) {
      missing.push({ section: 'SYMBOL_ART', ref: info.symbolDir, resolved: rel(dir), source: `asset-map:${slug}` });
      continue;
    }
    const imgs = fs.readdirSync(dir).filter((f) => /\.(webp|png|jpg|jpeg|svg)$/i.test(f));
    if (imgs.length === 0) {
      missing.push({ section: 'SYMBOL_ART', ref: `${info.symbolDir} (empty)`, resolved: rel(dir), source: `asset-map:${slug}` });
    }
  }
  return { symDirs };
}

// 4. UI ASSETS --------------------------------------------------------------
function checkUiAssets() {
  const p = path.join(ROOT, 'js/globals.js');
  const refs = new Set();
  if (exists(p)) {
    const txt = fs.readFileSync(p, 'utf8');
    const re = /assets\/ui\/[A-Za-z0-9_./-]+/g;
    let m;
    while ((m = re.exec(txt)) !== null) refs.add(m[0]);
  }
  for (const url of refs) check('UI_ASSET', url, path.resolve(ROOT, url), 'js/globals.js');
  return refs.size;
}

// 5. BRANDING ---------------------------------------------------------------
function checkBranding() {
  const refs = new Set();
  const scanExts = ['.html', '.js', '.css'];
  (function walk(dir) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (['node_modules', 'dist', '.git'].includes(e.name)) continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) walk(full);
      else if (scanExts.includes(path.extname(e.name))) {
        const txt = fs.readFileSync(full, 'utf8');
        const re = /assets\/branding\/[A-Za-z0-9_./-]+/g;
        let m;
        while ((m = re.exec(txt)) !== null) refs.add(m[0]);
      }
    }
  })(ROOT);
  for (const url of refs) check('BRANDING', url, path.resolve(ROOT, url), 'html/js/css');
  for (const base of ['logo_matrix_spins', 'hero_matrix_rain', 'loading_screen']) {
    checked++;
    const webp = path.join(ROOT, 'assets/branding', base + '.webp');
    const png = path.join(ROOT, 'assets/branding', base + '.png');
    if (!exists(webp) && !exists(png)) {
      missing.push({ section: 'BRANDING', ref: base + '.{webp,png}', resolved: `assets/branding/${base}`, source: 'expected-trio' });
    }
  }
  return refs.size;
}

// 6. STUDIO LOGOS -----------------------------------------------------------
function checkStudioLogos() {
  const gamesDir = path.join(ROOT, 'games');
  const refs = new Set();
  for (const file of fs.readdirSync(gamesDir).filter((f) => f.endsWith('.html'))) {
    const txt = fs.readFileSync(path.join(gamesDir, file), 'utf8');
    const re = /assets\/studio-logos\/[A-Za-z0-9_.-]+\.svg/g;
    let m;
    while ((m = re.exec(txt)) !== null) refs.add(m[0]);
  }
  for (const url of refs) check('STUDIO_LOGO', url, path.resolve(ROOT, url), 'games/*.html');
  return refs.size;
}

// 7. STATIC SERVE -----------------------------------------------------------
function checkStaticServe() {
  const idx = path.join(ROOT, 'server/index.js');
  if (!exists(idx)) return { ok: false, note: 'server/index.js missing' };
  const txt = fs.readFileSync(idx, 'utf8');
  const servesRoot = /express\.static\(/.test(txt);
  const mentionsAssets = /['"]assets['"]|\/assets/.test(txt);
  return { ok: servesRoot, servesRoot, mentionsAssets };
}

// RUN -----------------------------------------------------------------------
console.log('\n=== ASSET REFERENCE VERIFICATION ===\n');
const bg = checkBackgrounds();
console.log(`1. BACKGROUNDS : ${bg.total} game HTMLs, ${bg.withBg} background-image rules`);
const th = checkThumbnails();
console.log(`2. THUMBNAILS  : ${th} thumbnail refs`);
const sa = checkSymbolArt();
console.log(`3. SYMBOL ART  : ${sa.symDirs} symbolDir mappings`);
const ui = checkUiAssets();
console.log(`4. UI ASSETS   : ${ui} assets/ui refs`);
const br = checkBranding();
console.log(`5. BRANDING    : ${br} branding refs`);
const sl = checkStudioLogos();
console.log(`6. STUDIO LOGOS: ${sl} studio-logo refs`);
const ss = checkStaticServe();
console.log(`7. STATIC SERVE: ${ss.ok ? 'OK' : 'NOT FOUND'} ${JSON.stringify(ss)}`);

console.log(`\nChecked ${checked} asset references.`);
if (missing.length === 0) {
  console.log('\nALL ASSETS PRESENT — no missing references.\n');
  process.exit(0);
}
console.log(`\n${missing.length} MISSING / BROKEN references:\n`);
const bySection = {};
for (const x of missing) (bySection[x.section] ||= []).push(x);
for (const [sec, items] of Object.entries(bySection)) {
  console.log(`  [${sec}] ${items.length}`);
  for (const it of items.slice(0, 60)) {
    console.log(`    - ${it.source}  ref="${it.ref}"  ->  ${it.resolved}`);
  }
  if (items.length > 60) console.log(`    ...and ${items.length - 60} more`);
}
console.log('');
process.exit(1);
