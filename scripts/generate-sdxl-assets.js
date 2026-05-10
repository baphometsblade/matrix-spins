#!/usr/bin/env node
'use strict';

/**
 * Premium Thumbnail + Background Generator — Fooocus API.
 *
 * Per game:
 *   assets/thumbnails/<id>.webp          400×300  (lobby card)
 *   assets/backgrounds/slots/<id>_bg.webp  1920×1080  (slot game backdrop)
 *
 * Every prompt is built from the game's individual artDirection + colorNote
 * in shared/game-art-direction.js — no two games share the same brief.
 *
 * Usage:
 *   node scripts/generate-sdxl-assets.js                 # thumbs + backgrounds
 *   node scripts/generate-sdxl-assets.js --thumbs        # thumbnails only
 *   node scripts/generate-sdxl-assets.js --backgrounds   # backgrounds only
 *   node scripts/generate-sdxl-assets.js --only=sugar_rush,wolf_gold
 *   node scripts/generate-sdxl-assets.js --force         # regenerate all
 *   node scripts/generate-sdxl-assets.js --perf=Quality  # Lightning|Speed|Quality
 */

const fs    = require('fs');
const path  = require('path');
const sharp = require('sharp');

const games = require('../shared/game-definitions');
const { ART_DIRECTION } = require('../shared/game-art-direction');

const API_URL  = process.env.FOOOCUS_API || 'http://localhost:7865';
const REPO_ROOT = path.join(__dirname, '..');
const THUMB_DIR = path.join(REPO_ROOT, 'assets', 'thumbnails');
const BG_DIR    = path.join(REPO_ROOT, 'assets', 'backgrounds', 'slots');

// ── CLI args ─────────────────────────────────────────────────────────────────
const args    = process.argv.slice(2);
const onlyArg = args.find(a => a.startsWith('--only='));
const onlyIds = onlyArg ? new Set(onlyArg.slice(7).split(',')) : null;
const perfArg = args.find(a => a.startsWith('--perf='));
const perf    = perfArg ? perfArg.slice(7) : 'Speed';
const FORCE   = args.includes('--force');
const DO_THUMBS = !args.includes('--backgrounds') || args.includes('--thumbs');
const DO_BGS    = !args.includes('--thumbs')      || args.includes('--backgrounds');

if (!fs.existsSync(THUMB_DIR)) fs.mkdirSync(THUMB_DIR, { recursive: true });
if (!fs.existsSync(BG_DIR))    fs.mkdirSync(BG_DIR,    { recursive: true });

// ── Negative prompt ──────────────────────────────────────────────────────────
const NEGATIVE = [
  'text, letters, words, numbers, watermark, signature, logo,',
  'low quality, blurry, deformed, ugly, amateur, flat, 2d,',
  'oversaturated, washed out, noisy, jpeg artefact, duplicate',
].join(' ');

// ── Style presets ─────────────────────────────────────────────────────────────
// Thumbnails: cinematic, saturated, premium marketing art
const THUMB_STYLES = ['Fooocus V2', 'MRE Cinematic Dynamic', 'Fooocus Masterpiece', 'SAI Enhance'];
// Backgrounds: atmospheric, wide, non-distracting centre
const BG_STYLES    = ['Fooocus V2', 'MRE Cinematic Dynamic', 'Fooocus Enhance'];

// ── Prompt builders ───────────────────────────────────────────────────────────
function getArt(game) {
  const ad = ART_DIRECTION[game.id] || {};
  return {
    art: ad.artDirection || `premium ${game.themeCategory} themed casino slot`,
    col: ad.colorNote    || game.accentColor || 'vibrant colors',
  };
}

function thumbnailPrompt(game) {
  const { art, col } = getArt(game);
  return [
    `masterpiece, ${game.name} casino slot machine promotional key art,`,
    art,
    `${col} color scheme,`,
    'premium casino aesthetic, centered hero composition, strong depth of field,',
    'ornate golden frame border, volumetric cinematic lighting, rich saturation,',
    'hyper-realistic ultra-detailed 8k, no text, no letters, no watermark',
  ].join(' ');
}

function backgroundPrompt(game) {
  const { art, col } = getArt(game);
  return [
    `cinematic ${game.name} slot game ambient background,`,
    art,
    `${col} color palette,`,
    'wide panoramic landscape, dark vignette at all edges,',
    'large empty blurred negative-space centre for game reels to overlay,',
    'atmospheric depth of field, moody dramatic lighting,',
    'no text, no letters, no watermark, no UI elements',
  ].join(' ');
}

// ── Fooocus API ───────────────────────────────────────────────────────────────
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

async function generate(prompt, aspect, styles) {
  const results = await postJson('/v1/generation/text-to-image', {
    prompt,
    negative_prompt:         NEGATIVE,
    aspect_ratios_selection: aspect,
    performance_selection:   perf,
    image_number:            1,
    async_process:           false,
    style_selections:        styles,
  });
  if (!results.length) throw new Error('no images returned');
  const r = results[0];
  if (r.url)    return fetchBuffer(r.url);
  if (r.base64) return Buffer.from(r.base64, 'base64');
  throw new Error('no url/base64 in result');
}

// ── Asset pipeline ────────────────────────────────────────────────────────────
async function genThumbnail(game) {
  const outPath = path.join(THUMB_DIR, game.id + '.webp');
  if (!FORCE && fs.existsSync(outPath) && fs.statSync(outPath).size > 30_000) {
    return { skipped: true };
  }
  // 1344×768 source → 400×300 output (keeps premium detail before downsample)
  const png = await generate(thumbnailPrompt(game), '1344*768', THUMB_STYLES);
  await sharp(png)
    .resize(400, 300, { fit: 'cover', position: 'centre' })
    .webp({ quality: 90 })
    .toFile(outPath);
  return { ok: true, size: fs.statSync(outPath).size };
}

async function genBackground(game) {
  const outPath = path.join(BG_DIR, game.id + '_bg.webp');
  if (!FORCE && fs.existsSync(outPath) && fs.statSync(outPath).size > 100_000) {
    return { skipped: true };
  }
  // 1536×640 source → 1920×1080 stretched (letterbox fill)
  const png = await generate(backgroundPrompt(game), '1536*640', BG_STYLES);
  await sharp(png)
    .resize(1920, 1080, { fit: 'cover', position: 'centre' })
    .webp({ quality: 84 })
    .toFile(outPath);
  return { ok: true, size: fs.statSync(outPath).size };
}

async function ping() {
  try { const r = await fetch(API_URL + '/ping'); return r.ok; } catch { return false; }
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  console.log(`Asset Generator — perf=${perf}  force=${FORCE}  api=${API_URL}`);
  console.log(`Mode: ${DO_THUMBS ? 'thumbnails ' : ''}${DO_BGS ? 'backgrounds' : ''}`);

  if (!(await ping())) {
    console.error(`\nFATAL: Fooocus API not reachable at ${API_URL}`);
    console.error('Start it: cd C:/Users/markm/FooocusApp && python launch_api.py --listen');
    process.exit(1);
  }
  console.log('Fooocus API: OK\n');

  const target = onlyIds ? games.filter(g => onlyIds.has(g.id)) : games;
  console.log(`Target: ${target.length} games`);

  const s = { tOk: 0, tSkip: 0, tFail: 0, bOk: 0, bSkip: 0, bFail: 0 };
  const t0 = Date.now();

  for (let i = 0; i < target.length; i++) {
    const game   = target[i];
    const prefix = `[${i + 1}/${target.length}] ${game.id.padEnd(26)}`;

    if (DO_THUMBS) {
      try {
        const r = await genThumbnail(game);
        if (r.skipped) { s.tSkip++; process.stdout.write(`${prefix} thumb:skip  `); }
        else           { s.tOk++;   process.stdout.write(`${prefix} thumb:ok(${(r.size/1024).toFixed(0)}KB)  `); }
      } catch (e) {
        s.tFail++;
        console.warn(`\n${prefix} thumb:FAIL — ${e.message}`);
      }
    }

    if (DO_BGS) {
      try {
        const r = await genBackground(game);
        if (r.skipped) { s.bSkip++; process.stdout.write(`bg:skip\n`); }
        else           { s.bOk++;   process.stdout.write(`bg:ok(${(r.size/1024).toFixed(0)}KB)\n`); }
      } catch (e) {
        s.bFail++;
        console.warn(`\n${prefix} bg:FAIL — ${e.message}`);
      }
    } else {
      process.stdout.write('\n');
    }
  }

  const elapsed = Math.round((Date.now() - t0) / 1000);
  console.log('\n═══ SUMMARY ═══');
  if (DO_THUMBS) console.log(`Thumbnails : ok=${s.tOk}  skip=${s.tSkip}  fail=${s.tFail}`);
  if (DO_BGS)    console.log(`Backgrounds: ok=${s.bOk}  skip=${s.bSkip}  fail=${s.bFail}`);
  console.log(`Elapsed: ${Math.floor(elapsed / 60)}m ${elapsed % 60}s`);
}

main().catch(err => { console.error('Fatal:', err.message); process.exit(1); });
