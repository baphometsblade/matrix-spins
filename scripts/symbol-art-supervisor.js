'use strict';

/**
 * symbol-art-supervisor.js — self-healing driver for the symbol-art generation.
 *
 * Fooocus-API (local SDXL, port 8888) leaks VRAM and CRASHES after a handful of
 * tiles on this machine (tile times balloon 14s → 90s → 490s, then the API dies).
 * Generating ~1100 tiles therefore can't be a single long run — it needs the
 * backend restarted periodically to reclaim VRAM. This supervisor does that:
 *
 *   loop until every (game,symbol) tile exists OR progress stalls:
 *     1. make sure Fooocus is up (kill stale python, launch start_8888 python,
 *        poll /v1/engines/styles until ready)
 *     2. run scripts/generate-symbol-art.js (resumable — skips existing tiles)
 *     3. while it runs, watchdog Fooocus health + tile-progress; if Fooocus
 *        dies or progress stalls, kill the generator and loop (→ restart Fooocus)
 *     4. recount missing tiles
 *
 * No generator changes required. Idempotent + resumable: every restart skips
 * the tiles already on disk, so total compute is ~constant regardless of how
 * many times Fooocus crashes.
 *
 * Logs to stdout. Run in the background:
 *   node scripts/symbol-art-supervisor.js
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { spawn, spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const REGISTRY = path.join(ROOT, 'js', 'game-registry.js');
const OUT_ROOT = path.join(ROOT, 'assets', 'symbols');
const FOOOCUS_DIR = 'C:\\Users\\markm\\Fooocus-API';
const FOOOCUS_BAT = path.join(FOOOCUS_DIR, 'start_8888.bat');
const PYTHON = 'C:\\Users\\markm\\AppData\\Local\\Programs\\Python\\Python310\\python.exe';
const API = 'http://127.0.0.1:8888/v1/engines/styles';
const SAFE_ID = /^[a-z0-9][a-z0-9_-]*$/i;

const MAX_ITERS = 120;          // hard cap on restart cycles
const FOOOCUS_BOOT_TIMEOUT = 6 * 60 * 1000;  // wait up to 6 min for model load
const HEALTH_EVERY = 15 * 1000; // poll Fooocus every 15s while generating
const HEALTH_FAILS_TO_KILL = 4; // 4 × 15s = 60s of API-down → Fooocus is dead
const STALL_LIMIT = 6 * 60 * 1000; // no new tile in 6 min → stuck, restart

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function log(...a) { console.log('[supervisor]', new Date().toISOString().slice(11, 19), ...a); }

// ── Required (game,symbol) work-list — mirrors generate-symbol-art.js ──
function requiredTiles() {
  const sb = { window: { STUDIO_CONFIG: {}, GAME_REGISTRY: [] } };
  vm.createContext(sb);
  vm.runInContext(fs.readFileSync(REGISTRY, 'utf8'), sb, { timeout: 4000 });
  const reg = sb.window.GAME_REGISTRY || [];
  const list = [];
  for (const g of reg) {
    if (!g || !g.id || !SAFE_ID.test(g.id)) continue;
    for (const s of (g.symbols || [])) {
      const sym = String(s || '').toLowerCase();
      if (SAFE_ID.test(sym)) list.push([g.id, sym]);
    }
  }
  return list;
}
function tileExists(game, sym) {
  return fs.existsSync(path.join(OUT_ROOT, game, sym + '.webp')) ||
         fs.existsSync(path.join(OUT_ROOT, game, sym + '.png'));
}
function countMissing(list) { return list.filter(([g, s]) => !tileExists(g, s)).length; }
function countOnDisk() {
  let n = 0;
  if (!fs.existsSync(OUT_ROOT)) return 0;
  for (const d of fs.readdirSync(OUT_ROOT)) {
    const dir = path.join(OUT_ROOT, d);
    try { n += fs.readdirSync(dir).filter((f) => /\.(webp|png)$/.test(f)).length; } catch (_) {}
  }
  return n;
}

async function fooocusUp() {
  try { const r = await fetch(API, { signal: AbortSignal.timeout(4000) }); return r.ok; }
  catch (_) { return false; }
}

// Kill a process tree on Windows (Fooocus spawns workers that hold VRAM + the port).
function killTree(pid) {
  if (!pid) return;
  try { spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' }); } catch (_) {}
}
function killStaleFooocus() {
  // Any python running main.py on 8888 — free VRAM + the port before relaunch.
  try {
    const out = spawnSync('powershell', ['-NoProfile', '-Command',
      "Get-CimInstance Win32_Process -Filter \"Name='python.exe'\" | Where-Object { $_.CommandLine -like '*main.py*8888*' } | ForEach-Object { $_.ProcessId }"],
      { encoding: 'utf8' });
    (out.stdout || '').split(/\s+/).filter(Boolean).forEach((pid) => killTree(pid.trim()));
  } catch (_) {}
}

async function ensureFooocus() {
  if (await fooocusUp()) return true;
  log('Fooocus down — clearing stale procs + launching…');
  killStaleFooocus();
  await sleep(3000);
  // Launch via the python entrypoint detached so the supervisor isn't its parent
  // dependency; we track/kill it through killStaleFooocus on the next cycle.
  const child = spawn(PYTHON, ['main.py', '--host', '0.0.0.0', '--port', '8888', '--skip-pip'],
    { cwd: FOOOCUS_DIR, detached: true, stdio: 'ignore' });
  child.unref();
  const deadline = Date.now() + FOOOCUS_BOOT_TIMEOUT;
  while (Date.now() < deadline) {
    await sleep(5000);
    if (await fooocusUp()) { log('Fooocus is UP.'); return true; }
  }
  log('Fooocus failed to come up within boot timeout.');
  return false;
}

// Run the generator once; resolve when it exits OR when we kill it (Fooocus dead / stalled).
function runGeneratorWithWatchdog() {
  return new Promise((resolve) => {
    const logFd = fs.openSync(path.join(require('os').tmpdir(), 'symart-supervised.log'), 'a');
    const gen = spawn('node', ['scripts/generate-symbol-art.js'],
      { cwd: ROOT, stdio: ['ignore', logFd, logFd] });
    let done = false;
    const finish = (why) => { if (done) return; done = true; clearInterval(timer); try { fs.closeSync(logFd); } catch (_) {} resolve(why); };

    gen.on('exit', (code) => finish('generator-exit:' + code));

    let healthFails = 0;
    let lastCount = countOnDisk();
    let lastProgressAt = Date.now();
    const timer = setInterval(async () => {
      if (done) return;
      // progress check
      const now = countOnDisk();
      if (now !== lastCount) { lastCount = now; lastProgressAt = Date.now(); }
      // health check
      const up = await fooocusUp();
      if (up) healthFails = 0; else healthFails++;
      if (healthFails >= HEALTH_FAILS_TO_KILL) {
        log(`Fooocus unresponsive ${healthFails}×${HEALTH_EVERY / 1000}s — killing generator to restart backend.`);
        killTree(gen.pid); finish('fooocus-died');
      } else if (Date.now() - lastProgressAt > STALL_LIMIT) {
        log('No tile progress in', Math.round(STALL_LIMIT / 60000), 'min — killing generator to restart.');
        killTree(gen.pid); finish('stalled');
      }
    }, HEALTH_EVERY);
  });
}

async function main() {
  const work = requiredTiles();
  log(`required tiles: ${work.length}`);
  let prevMissing = Infinity;
  let noProgressStreak = 0;

  for (let iter = 1; iter <= MAX_ITERS; iter++) {
    const missing = countMissing(work);
    log(`iter ${iter}: ${missing} tiles missing (${work.length - missing}/${work.length} done)`);
    if (missing === 0) { log('ALL TILES PRESENT — done.'); return; }

    // progress guard: if two full cycles make no headway, the remaining tiles are
    // persistently failing (bad prompt / unsafe id). Stop rather than spin forever.
    if (missing >= prevMissing) {
      noProgressStreak++;
      if (noProgressStreak >= 3) {
        log(`No progress across ${noProgressStreak} cycles — ${missing} tiles persistently failing. Stopping.`);
        const stuck = work.filter(([g, s]) => !tileExists(g, s)).slice(0, 40).map(([g, s]) => g + '/' + s);
        log('first stuck tiles:', JSON.stringify(stuck));
        return;
      }
    } else {
      noProgressStreak = 0;
    }
    prevMissing = missing;

    const ok = await ensureFooocus();
    if (!ok) { log('Could not bring Fooocus up; retrying next cycle.'); await sleep(10000); continue; }

    const why = await runGeneratorWithWatchdog();
    log('generator cycle ended:', why);
    await sleep(3000); // let processes settle before recount/relaunch
  }
  log('Hit MAX_ITERS — stopping. Remaining:', countMissing(work));
}

main().catch((e) => { console.error('[supervisor] FATAL', e); process.exit(1); });
