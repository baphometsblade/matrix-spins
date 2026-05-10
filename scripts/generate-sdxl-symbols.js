#!/usr/bin/env node
'use strict';

/**
 * Premium Symbol Generator — Fooocus API.
 *
 * Generates a unique 512×512 WebP for every symbol of every game.
 * Each prompt is crafted from the game's individual artDirection + colorNote,
 * guaranteeing no two games share a visual identity.
 *
 * Per-game asset counts:
 *   s1–s5  : pay-table icons (tier 1–5)
 *   wild   : glowing wild symbol
 *   scatter: bonus-trigger scatter (if separate from symbols list)
 *
 * At Speed perf (~15s/image) 600 symbols ≈ 2.5 hours.
 * At Lightning perf (~5s/image) 600 symbols ≈ 50 minutes.
 *
 * Usage:
 *   node scripts/generate-sdxl-symbols.js                  # all games
 *   node scripts/generate-sdxl-symbols.js --only=sugar_rush,wolf_gold
 *   node scripts/generate-sdxl-symbols.js --force          # overwrite existing
 *   node scripts/generate-sdxl-symbols.js --perf=Quality   # Lightning|Speed|Quality
 *   node scripts/generate-sdxl-symbols.js --skip-existing  # skip files >40KB (default)
 */

const fs   = require('fs');
const path = require('path');
const sharp = require('sharp');

const games = require('../shared/game-definitions');
const { ART_DIRECTION } = require('../shared/game-art-direction');

const API_URL  = process.env.FOOOCUS_API || 'http://localhost:7865';
const OUT_ROOT = path.join(__dirname, '..', 'assets', 'game_symbols');

// ── CLI args ────────────────────────────────────────────────────────────────
const args    = process.argv.slice(2);
const onlyArg = args.find(a => a.startsWith('--only='));
const onlyIds = onlyArg ? new Set(onlyArg.slice(7).split(',')) : null;
const perfArg = args.find(a => a.startsWith('--perf='));
const perf    = perfArg ? perfArg.slice(7) : 'Speed';
const FORCE   = args.includes('--force');
const MIN_SIZE = 40_000; // bytes — skip if file already looks HD

// ── Prompts ─────────────────────────────────────────────────────────────────
const NEGATIVE = [
  'text, letters, words, numbers, watermark, signature, logo,',
  'blurry, low quality, deformed, ugly, duplicate, mutated, extra limbs,',
  'amateur, flat, 2d, cartoon style, anime style, sketch, pencil,',
  'oversaturated, washed out, noisy, jpeg artefact',
].join(' ');

// Styles tuned for crisp slot-machine icons on Fooocus
const SYMBOL_STYLES = ['Fooocus V2', 'Fooocus Sharp', 'SAI Fantasy Art', 'Fooocus Enhance'];

function humanize(sym) {
  return sym
    .replace(/^s\d+_/, '')
    .replace(/^wild_/, '')
    .replace(/^scatter_/, '')
    .replace(/_/g, ' ');
}

function tierTag(sym, game) {
  if (sym.startsWith('wild')) {
    return 'glowing wild casino symbol, radiant W emblem, rainbow shimmer aura, heavy gold-foil border, crown jewel centrepiece,';
  }
  if (sym === game.scatterSymbol) {
    return 'brilliant scatter bonus symbol, radial starburst energy, ornate gold frame, gem-encrusted star pattern,';
  }
  // Pay-table tier — richness increases with symbol index
  const idx = (game.symbols || []).indexOf(sym);
  if (idx >= 4) return 'premium high-value game icon, platinum bevel, multi-gem encrustation, dramatic spotlight,';
  if (idx >= 2) return 'polished mid-tier game icon, glossy 3D bevel, gold rim accent, soft rim light,';
  return 'crisp low-tier game icon, clean gloss bevel, thin gold outline,';
}

function symbolPrompt(game, sym) {
  const ad  = ART_DIRECTION[game.id] || {};
  const art  = ad.artDirection || `${game.themeCategory} themed casino slot game`;
  const col  = ad.colorNote    || game.accentColor || 'vibrant color scheme';
  const subj = humanize(sym);
  const tier = tierTag(sym, game);

  return [
    `masterpiece, ultra-detailed ${subj} casino slot symbol,`,
    tier,
    `${art}`,
    `${col} color palette,`,
    'centered on pure black background, strong directional rim lighting,',
    'hyper-realistic material rendering, deep specular highlight,',
    '8k resolution, professional casino-grade asset,',
    'no text, no letters, no watermark',
  ].join(' ');
}

// ── Fooocus API ──────────────────────────────────────────────────────────────
async function postJson(urlPath, body) {
  const res = await fetch(API_URL + urlPath, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body:    JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`API ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return res.json();
}

async function fetchBuffer(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`fetch ${url}: ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

async function generate(prompt) {
  const results = await postJson('/v1/generation/text-to-image', {
    prompt,
    negative_prompt:         NEGATIVE,
    aspect_ratios_selection: '1024*1024',
    performance_selection:   perf,
    image_number:            1,
    async_process:           false,
    style_selections:        SYMBOL_STYLES,
  });
  if (!results.length) throw new Error('no result from API');
  const r = results[0];
  if (r.url)    return fetchBuffer(r.url);
  if (r.base64) return Buffer.from(r.base64, 'base64');
  throw new Error('no url/base64 in API result');
}

// ── Per-symbol pipeline ──────────────────────────────────────────────────────
async function genSymbol(game, sym) {
  const dir     = path.join(OUT_ROOT, game.id);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const outPath = path.join(dir, sym + '.webp');

  if (!FORCE && fs.existsSync(outPath) && fs.statSync(outPath).size > MIN_SIZE) {
    return { skipped: true };
  }

  const png = await generate(symbolPrompt(game, sym));
  // 512×512 — 2× the old size, noticeably crisper on HiDPI displays
  await sharp(png)
    .resize(512, 512, { fit: 'cover', position: 'centre' })
    .webp({ quality: 92 })
    .toFile(outPath);

  return { ok: true, size: fs.statSync(outPath).size };
}

// ── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  console.log(`Symbol Generator — perf=${perf}  force=${FORCE}  api=${API_URL}`);

  // Fooocus health check
  try {
    const r = await fetch(API_URL + '/ping');
    if (!r.ok) throw new Error('ping failed');
    console.log('Fooocus API: OK');
  } catch {
    console.error(`\nFATAL: Fooocus API not reachable at ${API_URL}`);
    console.error('Start it: cd C:/Users/markm/FooocusApp && python launch_api.py --listen');
    process.exit(1);
  }

  const target = onlyIds ? games.filter(g => onlyIds.has(g.id)) : games;

  // Flatten all (game, symbol) pairs
  const tasks = [];
  for (const g of target) {
    const syms = [...(g.symbols || [])];
    if (g.wildSymbol    && !syms.includes(g.wildSymbol))    syms.push(g.wildSymbol);
    if (g.scatterSymbol && !syms.includes(g.scatterSymbol)) syms.push(g.scatterSymbol);
    syms.forEach(s => tasks.push({ game: g, sym: s }));
  }

  console.log(`Generating ${tasks.length} symbols across ${target.length} games…`);
  if (!ART_DIRECTION[target[0]?.id]) {
    console.warn('WARNING: game-art-direction.js missing entries — prompts will be generic');
  }

  let ok = 0, skip = 0, fail = 0;
  const t0 = Date.now();

  for (let i = 0; i < tasks.length; i++) {
    const { game, sym } = tasks[i];
    const label = `[${i + 1}/${tasks.length}] ${game.id}/${sym}`.padEnd(52);
    try {
      const r = await genSymbol(game, sym);
      if (r.skipped) { skip++; process.stdout.write(`${label} skip\n`); }
      else           { ok++;   process.stdout.write(`${label} ok  (${(r.size / 1024).toFixed(0)}KB)\n`); }
    } catch (e) {
      fail++;
      console.warn(`${label} FAIL — ${e.message}`);
    }
  }

  const elapsed = Math.round((Date.now() - t0) / 1000);
  console.log(`\n═══ DONE ═══  ok=${ok}  skip=${skip}  fail=${fail}  — ${Math.floor(elapsed / 60)}m ${elapsed % 60}s`);
}

main().catch(err => { console.error('Fatal:', err.message); process.exit(1); });
