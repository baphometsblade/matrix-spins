#!/usr/bin/env node
'use strict';

/**
 * Master Asset Generator — runs the full Fooocus pipeline for all 100 games.
 *
 * Generation order (most gameplay-critical first):
 *   1. Symbols     600 images  512×512  WebP
 *   2. Thumbnails  100 images  400×300  WebP
 *   3. Backgrounds 100 images  1920×1080 WebP
 *
 * Total at Speed perf (~15s/img): ~800 images ≈ 3.3 hours
 * Total at Lightning perf (~5s/img): ~800 images ≈ 67 minutes
 *
 * Usage:
 *   node scripts/generate-all-assets.js                   # full run, Speed perf
 *   node scripts/generate-all-assets.js --perf=Lightning
 *   node scripts/generate-all-assets.js --perf=Quality
 *   node scripts/generate-all-assets.js --only=sugar_rush,wolf_gold
 *   node scripts/generate-all-assets.js --force
 *   node scripts/generate-all-assets.js --symbols-only
 *   node scripts/generate-all-assets.js --thumbs-only
 *   node scripts/generate-all-assets.js --backgrounds-only
 *
 * Requires Fooocus API running:
 *   cd C:/Users/markm/FooocusApp && python launch_api.py --listen
 */

const { spawnSync } = require('child_process');
const path = require('path');

const API_URL = process.env.FOOOCUS_API || 'http://localhost:7865';

// ── CLI ───────────────────────────────────────────────────────────────────────
const args    = process.argv.slice(2);
const onlyArg = args.find(a => a.startsWith('--only='));
const perfArg = args.find(a => a.startsWith('--perf='));
const perf    = perfArg ? perfArg.slice(7) : 'Speed';
const FORCE   = args.includes('--force');
const ONLY    = onlyArg || null;

const SYMBOLS_ONLY = args.includes('--symbols-only');
const THUMBS_ONLY  = args.includes('--thumbs-only');
const BGS_ONLY     = args.includes('--backgrounds-only');
const ALL = !SYMBOLS_ONLY && !THUMBS_ONLY && !BGS_ONLY;

// ── Fooocus health ────────────────────────────────────────────────────────────
async function ping() {
  try {
    const r = await fetch(API_URL + '/ping');
    return r.ok;
  } catch {
    return false;
  }
}

// ── Runner — uses spawnSync (no shell, no injection) ─────────────────────────
function run(scriptName, extraArgs = []) {
  const scriptPath = path.join(__dirname, scriptName);
  const nodeArgs = [
    scriptPath,
    `--perf=${perf}`,
    ...(FORCE ? ['--force'] : []),
    ...(ONLY  ? [ONLY]      : []),
    ...extraArgs,
  ];

  console.log(`\n${'═'.repeat(60)}`);
  console.log(`▶  node ${scriptName} ${nodeArgs.slice(1).join(' ')}`);
  console.log('═'.repeat(60));

  const result = spawnSync(process.execPath, nodeArgs, {
    stdio: 'inherit',
    env:   { ...process.env, FOOOCUS_API: API_URL },
  });

  if (result.error) {
    console.warn(`Script spawn error: ${result.error.message}. Continuing…`);
  }
  // Non-zero exit is logged by the child — we continue the pipeline regardless
}

function eta(images, secPerImage) {
  const total = images * secPerImage;
  return `~${Math.floor(total / 3600)}h ${Math.floor((total % 3600) / 60)}m`;
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  console.log('╔══════════════════════════════════════════════════════════╗');
  console.log('║        Matrix Spins — Full Fooocus Asset Pipeline        ║');
  console.log('╚══════════════════════════════════════════════════════════╝');
  console.log(`  API    : ${API_URL}`);
  console.log(`  Perf   : ${perf}`);
  console.log(`  Force  : ${FORCE ? 'yes' : 'no (skip existing)'}`);
  console.log(`  Filter : ${ONLY || 'all 100 games'}`);
  console.log('');

  const spPerImg = perf === 'Lightning' ? 5 : perf === 'Quality' ? 45 : 15;
  if (ALL || SYMBOLS_ONLY) console.log(`  Symbols     : 600 images  ${eta(600, spPerImg)}`);
  if (ALL || THUMBS_ONLY)  console.log(`  Thumbnails  : 100 images  ${eta(100, spPerImg)}`);
  if (ALL || BGS_ONLY)     console.log(`  Backgrounds : 100 images  ${eta(100, spPerImg)}`);
  const totalImgs = ALL ? 800 : (SYMBOLS_ONLY ? 600 : 100);
  console.log(`  Total ETA   : ${eta(totalImgs, spPerImg)} at ${perf} perf\n`);

  if (!(await ping())) {
    console.error('╔══════════════════════════════════════════════════════════╗');
    console.error('║  FATAL: Fooocus API is not running                       ║');
    console.error('║  Start: cd C:/Users/markm/FooocusApp                     ║');
    console.error('║         python launch_api.py --listen                    ║');
    console.error('╚══════════════════════════════════════════════════════════╝');
    process.exit(1);
  }
  console.log('✓ Fooocus API is running\n');

  const t0 = Date.now();

  if (ALL || SYMBOLS_ONLY) run('generate-sdxl-symbols.js');
  if (ALL || THUMBS_ONLY)  run('generate-sdxl-assets.js', ['--thumbs']);
  if (ALL || BGS_ONLY)     run('generate-sdxl-assets.js', ['--backgrounds']);

  const elapsed = Math.round((Date.now() - t0) / 1000);
  console.log('\n╔══════════════════════════════════════════════════════════╗');
  console.log(`║  Pipeline complete — ${String(Math.floor(elapsed / 3600)).padStart(1)}h ${String(Math.floor((elapsed % 3600) / 60)).padStart(2, '0')}m ${String(elapsed % 60).padStart(2, '0')}s elapsed`);
  console.log('╚══════════════════════════════════════════════════════════╝');
  console.log('\nNext steps:');
  console.log('  git add -f assets/thumbnails/ assets/backgrounds/slots/ assets/game_symbols/');
  console.log('  git commit -m "feat(assets): AI-generated unique Fooocus assets for all 100 games"');
}

main().catch(err => { console.error('Fatal:', err.message); process.exit(1); });
