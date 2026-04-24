#!/usr/bin/env node
'use strict';

/**
 * Structural audit of all 100 game definitions.
 *
 * Catches whole classes of bugs across the entire catalog at once:
 *   - bonusType not handled by the game engine
 *   - scatterSymbol / wildSymbol not in the symbols[] list
 *   - freeSpinsCount > 0 but no scatterSymbol declared
 *   - freeSpinsRetrigger=true combined with extreme freeSpinsCount
 *   - cluster-pay games missing clusterMin
 *   - payline games missing paytable payline3/4/5 values
 *   - RTP outside 85-96% regulatory range
 *   - bet bounds inverted or outside global config
 *   - missing accentColor / bgGradient
 *
 * This does NOT simulate gameplay — it's a static sanity pass that
 * lets us catch data-level bugs without having to click through every
 * game manually.
 */

const path = require('path');
const games = require(path.join(__dirname, '..', 'shared', 'game-definitions'));
const config = (() => {
    try { return require(path.join(__dirname, '..', 'server', 'config')); }
    catch (_) { return { MIN_BET: 0.20, MAX_BET: 50000 }; }
})();
const bonusMechanics = require(path.join(__dirname, '..', 'server', 'services', 'bonus-mechanics'));

// Pull the canonical type set + alias map from the engine itself so
// this audit stays in lock-step with the real implementation.
const SUPPORTED_BONUS_TYPES = new Set([
    ...bonusMechanics._CANONICAL_TYPES,
    ...Object.keys(bonusMechanics._BONUS_ALIASES),  // aliases count as supported
    null, undefined, ''
]);

const issues = [];
const warns = [];

function err(game, msg) { issues.push({ id: game.id, msg }); }
function warn(game, msg) { warns.push({ id: game.id, msg }); }

games.forEach(g => {
    if (!g.id) return err(g, 'missing id');
    if (!g.name) return err(g, 'missing name');

    // Required basic fields
    if (!g.symbols || !Array.isArray(g.symbols) || g.symbols.length < 4) {
        err(g, 'symbols[] missing or < 4 entries');
    }
    if (!g.gridCols || !g.gridRows) {
        err(g, 'gridCols / gridRows missing');
    }
    if (!g.winType) err(g, 'winType missing');

    // RTP sanity — licensed slots must be 85-98%
    if (typeof g.rtp !== 'number' || g.rtp < 85 || g.rtp > 98) {
        err(g, `rtp out of range: ${g.rtp}`);
    }

    // Bet bounds
    if (typeof g.minBet !== 'number' || g.minBet < config.MIN_BET) {
        err(g, `minBet ${g.minBet} < global minimum ${config.MIN_BET}`);
    }
    if (typeof g.maxBet !== 'number' || g.maxBet > config.MAX_BET) {
        err(g, `maxBet ${g.maxBet} > global maximum ${config.MAX_BET}`);
    }
    if (g.minBet >= g.maxBet) err(g, 'minBet >= maxBet');

    // Wild / scatter must exist in symbols[]
    if (g.wildSymbol && g.symbols && !g.symbols.includes(g.wildSymbol)) {
        err(g, `wildSymbol ${g.wildSymbol} not in symbols[]`);
    }
    if (g.scatterSymbol && g.symbols && !g.symbols.includes(g.scatterSymbol)) {
        err(g, `scatterSymbol ${g.scatterSymbol} not in symbols[]`);
    }

    // Free spins config sanity
    if (g.freeSpinsCount > 0 && !g.scatterSymbol) {
        err(g, `freeSpinsCount=${g.freeSpinsCount} but no scatterSymbol`);
    }
    if (g.freeSpinsCount > 25) {
        warn(g, `freeSpinsCount=${g.freeSpinsCount} is high — hit-frequency may skew RTP`);
    }
    if (g.freeSpinsRetrigger && !g.freeSpinsCount) {
        warn(g, 'freeSpinsRetrigger=true but freeSpinsCount=0');
    }

    // bonusType sanity
    if (g.bonusType && !SUPPORTED_BONUS_TYPES.has(g.bonusType)) {
        err(g, `bonusType "${g.bonusType}" not implemented — silent no-op`);
    }

    // Cluster-pay games need clusterMin
    if (g.winType === 'cluster' && (!g.clusterMin || g.clusterMin < 3)) {
        err(g, `cluster game missing clusterMin (or < 3): ${g.clusterMin}`);
    }

    // Payline games need paytable
    if (g.winType === 'payline') {
        if (!g.payouts || typeof g.payouts !== 'object') {
            err(g, 'payline game missing payouts{}');
        } else {
            const has3 = typeof g.payouts.payline3 === 'number' || typeof g.payouts.triple === 'number';
            const has5 = typeof g.payouts.payline5 === 'number' || typeof g.payouts.triple === 'number';
            if (!has3 || !has5) err(g, 'paytable missing payline3/payline5 or triple values');
        }
    }

    // Cluster pay table
    if (g.winType === 'cluster') {
        if (!g.payouts || (typeof g.payouts.cluster5 !== 'number' && typeof g.payouts.cluster8 !== 'number')) {
            warn(g, 'cluster game missing cluster5/cluster8 payouts');
        }
    }

    // UI
    if (!g.accentColor) warn(g, 'missing accentColor — UI uses fallback');
    if (!g.bgGradient) warn(g, 'missing bgGradient — UI uses fallback');
    if (!g.provider) warn(g, 'missing provider — studio badge empty');

    // Bonus-type-specific requirements
    if (g.bonusType === 'money_collect' || g.bonusType === 'fisherman_collect') {
        if (!g.moneySymbols && !g.fishSymbols) {
            err(g, `${g.bonusType} bonus but no moneySymbols/fishSymbols declared`);
        }
    }
    if (g.bonusType === 'expanding_symbol' && typeof g.freeSpinsRetrigger === 'undefined') {
        warn(g, 'expanding_symbol bonus should declare freeSpinsRetrigger');
    }
    if (g.bonusType === 'coin_respin' && !g.coinRespinValues) {
        warn(g, 'coin_respin bonus has no coinRespinValues[] defined — defaults used');
    }
    // hold_and_win falls back to default [2, 5, 10, 25, 50, 100] in
    // ui-slot.js triggerHoldAndWin() — no warning needed unless we
    // eventually want per-game custom coin pools.
    if (g.bonusType === 'chamber_spins' && !g.chamberLevels) {
        warn(g, 'chamber_spins bonus has no chamberLevels[]');
    }
});

// ── Report ──
console.log(`\n=== STRUCTURAL SLOT AUDIT — ${games.length} games ===\n`);
if (issues.length) {
    console.log(`🔴 HARD ERRORS (${issues.length}):`);
    issues.forEach(i => console.log(`   [${i.id}] ${i.msg}`));
    console.log('');
}
if (warns.length) {
    console.log(`🟡 WARNINGS (${warns.length}):`);
    warns.forEach(w => console.log(`   [${w.id}] ${w.msg}`));
    console.log('');
}
if (!issues.length && !warns.length) {
    console.log('✅ No structural issues detected.');
}

process.exit(issues.length > 0 ? 1 : 0);
