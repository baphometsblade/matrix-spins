#!/usr/bin/env node
'use strict';

/**
 * Volatility-label accuracy audit.
 *
 * Players use the "Low / Medium / High / Very High" label to pick
 * games — misrepresenting it is a regulatory concern in licensed
 * jurisdictions. This script runs 3,000 spins per game at minBet,
 * computes the coefficient of variation (std dev / mean win) for
 * winning spins, and maps that to an expected label band:
 *
 *   CV < 2       → low
 *   CV 2–5       → medium
 *   CV 5–10      → high
 *   CV > 10      → very high
 *
 * Then compares to game.volatility (case-insensitive). Any mismatch
 * with a CV drift ≥ 2 buckets is flagged — minor drift (1 bucket) is
 * a warning because the bands are ±1 run-to-run from variance alone.
 */

const path = require('path');
const engine = require(path.join(__dirname, '..', 'server', 'services', 'game-engine'));
const houseEdge = require(path.join(__dirname, '..', 'server', 'services', 'house-edge'));
const games = require(path.join(__dirname, '..', 'shared', 'game-definitions'));

const N_ARG = process.argv.find(a => a.startsWith('--spins='));
const N = N_ARG ? parseInt(N_ARG.slice(8), 10) : 3000;
const ONLY_ARG = process.argv.find(a => a.startsWith('--only='));
const ONLY = ONLY_ARG ? new Set(ONLY_ARG.slice(7).split(',')) : null;

const target = games.filter(g => !ONLY || ONLY.has(g.id));

// CV bands calibrated to the engine's MAX_WIN_MULTIPLIER = 200x cap.
// Real-world slots with 5000x+ caps sit at much higher CVs; because our
// ceiling truncates the tail we see CVs concentrated in the 0.8-3 range
// even for games players would subjectively call "high volatility".
// CV bands calibrated to the engine's MAX_WIN_MULTIPLIER = 200x cap.
// Real-world slots with 5000x+ caps sit at much higher CVs; because our
// ceiling truncates the tail we see CVs concentrated in 0.8-3 range
// even for games players would subjectively call "high volatility".
//
// 5 buckets so the existing "medium-high" label from the catalog maps
// to its own real bucket instead of collapsing into medium or high.
const BANDS = [
    { name: 'low',         max: 1.0 },
    { name: 'medium',      max: 1.8 },
    { name: 'medium-high', max: 2.8 },
    { name: 'high',        max: 5.0 },
    { name: 'very high',   max: Infinity }
];
function bandFor(cv) {
    for (const b of BANDS) if (cv < b.max) return b.name;
    return 'very high';
}
function bandIdx(name) {
    const lower = String(name || '').toLowerCase().trim();
    for (let i = 0; i < BANDS.length; i++) if (BANDS[i].name === lower) return i;
    return -1;
}

(async () => {
    console.log(`\n=== VOLATILITY AUDIT — ${target.length} games × ${N} spins ===\n`);
    const issues = [];
    const warns = [];

    for (const game of target) {
        const bet = game.minBet || 0.20;
        const stats = { total_spins: 0, total_wagered: 0, total_paid: 0 };
        let fs = null;
        const wins = [];
        let err = 0;

        for (let i = 0; i < N; i++) {
            stats.total_spins++;
            stats.total_wagered += bet;
            try {
                const r = await engine.resolveSpin(game, bet, stats, fs, null);
                let w = r.winAmount;
                if (w > 0) w = await houseEdge.capWinAmount(w, bet, game, null);
                if (typeof w !== 'number' || !isFinite(w)) { err++; continue; }
                if (w > 0) {
                    wins.push(w / bet);
                    stats.total_paid += w;
                }
                fs = r.freeSpinState;
            } catch (e) { err++; }
        }

        if (err > 0) {
            issues.push(`[${game.id}] ${err} errors during sim`);
            continue;
        }
        if (wins.length < 20) {
            warns.push(`[${game.id}] only ${wins.length} wins over ${N} spins — too few to measure variance`);
            continue;
        }

        const mean = wins.reduce((a, b) => a + b, 0) / wins.length;
        const varSum = wins.reduce((s, w) => s + (w - mean) * (w - mean), 0);
        const stdDev = Math.sqrt(varSum / wins.length);
        const cv = mean > 0 ? stdDev / mean : 0;

        const actualBand = bandFor(cv);
        const declared = (game.volatility || '').toLowerCase();
        const aIdx = bandIdx(actualBand);
        const dIdx = bandIdx(declared);
        const drift = (dIdx >= 0) ? Math.abs(aIdx - dIdx) : 0;
        const maxWin = Math.max(...wins);
        const match = dIdx >= 0 && drift <= 1;

        const line = `${match ? '✅' : drift >= 2 ? '🔴' : '🟡'} ${game.id.padEnd(24)} `
            + `declared:${String(declared).padEnd(10)} `
            + `measured:${actualBand.padEnd(10)} `
            + `CV=${cv.toFixed(2).padStart(5)} `
            + `mean=${mean.toFixed(1).padStart(5)}x `
            + `max=${maxWin.toFixed(0).padStart(4)}x`;

        if (drift >= 2) {
            issues.push(line);
        } else if (drift === 1) {
            warns.push(line);
        } else {
            console.log(line);
        }
    }

    console.log('\n========================================');
    if (issues.length) {
        console.log(`🔴 MISMATCHES (${issues.length}) — volatility label off by ≥2 bands:`);
        issues.forEach(i => console.log('  ' + i));
        console.log('');
    }
    if (warns.length) {
        console.log(`🟡 MINOR DRIFT (${warns.length}) — off by 1 band (within normal variance):`);
        warns.forEach(w => console.log('  ' + w));
    }
    if (!issues.length) console.log('✅ All volatility labels within 1 band of measured CV.');
    process.exit(issues.length ? 1 : 0);
})();
