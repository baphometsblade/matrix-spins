'use strict';

/**
 * slug-registry.js — single source of truth for the 120 hyphenated game pages.
 *
 * The site has TWO parallel game catalogs:
 *   • shared/game-definitions.js — 100 underscore IDs (e.g. 'sugar_rush')
 *   • js/game-registry.js        — 120 hyphenated IDs (e.g. 'ra-sun-god-royale')
 *
 * The slot pages under /games/<slug>.html are driven by the hyphenated registry.
 * Each registry entry carries the game's REAL themed symbol list
 * (e.g. ['ra','sun','pyramid','scarab','ankh',...]) — which the casino engine
 * maps to themed emoji glyphs.
 *
 * Historically only spin.routes.js parsed this registry (for server-authoritative
 * spins). The public catalog route (/api/games/:id) did NOT — so when the engine
 * fetched a hyphenated game's config it fell through to a synthetic placeholder
 * with generic ['s1','s2','s3','s4','s5','wild'] symbols. Result: EVERY slot's
 * reels rendered "S1".."S5" text chips instead of the themed emoji. This module
 * centralises the registry load so the catalog route can return the real config.
 *
 * Pure read-only config derivation — no DB, no money. Safe to require anywhere.
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

// studioId ("mythic-forge") → engine chrome theme key ("mythicforge").
function studioThemeKey(studioId) {
  return String(studioId || '').replace(/-/g, '').toLowerCase() || null;
}

function deriveWild(symbols) {
  return symbols.find((s) => String(s).includes('wild')) || null;
}
function deriveScatter(symbols) {
  return symbols.find((s) => String(s).includes('scatter')) || null;
}

// Mirror spin.routes.js: structure → winType → a sane synthesized payout table
// so the engine's info-modal shows real multipliers (registry has no paytable).
function buildPayouts(reels, rows) {
  let winType = 'payline';
  if (reels <= 3 && rows <= 3) winType = 'classic';
  else if (reels >= 6 && rows >= 5) winType = 'cluster';
  if (winType === 'classic') {
    return { winType, payouts: { triple: 100, double: 10, wildTriple: 150, scatterPay: 5 } };
  }
  if (winType === 'cluster') {
    return { winType, payouts: { triple: 130, double: 13, wildTriple: 200, scatterPay: 5, cluster5: 5, cluster8: 15, cluster12: 50, cluster15: 140 } };
  }
  return { winType, payouts: { triple: 100, double: 10, wildTriple: 150, scatterPay: 5, payline3: 10, payline4: 50, payline5: 100 } };
}

// Build the slug → normalized-game index from js/game-registry.js once at load.
const slugIndex = new Map();
let _loaded = false;
let _loadError = null;

function load() {
  if (_loaded) return;
  _loaded = true;
  try {
    const registryPath = path.resolve(__dirname, '../../js/game-registry.js');
    const registryCode = fs.readFileSync(registryPath, 'utf8');
    // Evaluate the browser file in a minimal, isolated VM sandbox that only
    // exposes a stub `window`. The file is a trusted in-repo asset (not user
    // input); the sandbox has no access to require/process/fs.
    const sandbox = { window: { STUDIO_CONFIG: {}, GAME_REGISTRY: [] } };
    vm.createContext(sandbox);
    vm.runInContext(registryCode, sandbox, { filename: 'game-registry.js', timeout: 2000 });
    const registry = sandbox.window.GAME_REGISTRY || [];
    registry.forEach((entry) => {
      if (!entry || !entry.id) return;
      const symbols = Array.isArray(entry.symbols) && entry.symbols.length
        ? entry.symbols
        : ['s1', 's2', 's3', 's4', 's5', 'wild'];
      const reels = Number(entry.reels) || 5;
      const rows = Number(entry.rows) || 3;
      const { payouts } = buildPayouts(reels, rows);
      slugIndex.set(entry.id, {
        id: entry.id,
        name: entry.name || entry.id,
        provider: entry.studio || 'Matrix Spins',
        studioTheme: studioThemeKey(entry.studioId),
        themeCategory: String(entry.theme || '').toLowerCase(),
        rtp: Number(entry.rtp) || 90,
        volatility: entry.volatility || 'medium',
        // registry paylines is often 0 for cluster/ways games — fall back to grid size.
        paylines: Number(entry.paylines) || (reels * rows),
        reels,
        rows,
        gridCols: reels,
        gridRows: rows,
        symbols,
        wildSymbol: deriveWild(symbols),
        scatterSymbol: deriveScatter(symbols),
        paytable: payouts,
        payouts,
        bonusType: entry.mechanic ? 'free_spins' : null,
        bonusDesc: entry.mechanicDesc || '',
        freeSpinsCount: 10,
        freeSpinsRetrigger: true,
        minBet: Number(entry.minBet) || 0.20,
        maxBet: Number(entry.maxBet) || 100,
        betStep: Number(entry.minBet) || 0.20,
        thumbnail: entry.thumbnail || null,
        bgGradient: entry.bgGradient || null,
        jackpot: 0,
      });
    });
  } catch (err) {
    _loadError = err;
    // Non-fatal: callers fall back to their own defaults. Log once.
    // eslint-disable-next-line no-console
    console.warn('[slug-registry] could not load js/game-registry.js:', err.message);
  }
}

/**
 * Resolve a hyphenated (or underscore-variant) slug to its themed game config.
 * Returns a normalized object (see slugIndex above) or null if unknown.
 */
function getSlugGame(id) {
  load();
  const raw = String(id || '').toLowerCase();
  if (!raw) return null;
  return (
    slugIndex.get(raw) ||
    slugIndex.get(raw.replace(/_/g, '-')) ||
    slugIndex.get(raw.replace(/-/g, '_')) ||
    null
  );
}

function size() {
  load();
  return slugIndex.size;
}

module.exports = { getSlugGame, size, _loadError: () => _loadError };
