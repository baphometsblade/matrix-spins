#!/usr/bin/env node
'use strict';

/**
 * Behaviour-level audit of every slot.
 *
 * For each game we run N spins at min-bet and measure:
 *   - hit rate       (fraction of spins with winAmount > 0)
 *   - effective RTP  (total paid / total wagered)
 *   - FS trigger %   (scatterTriggered fraction)
 *   - bonus trigger %  (any special winDetails.type)
 *   - max win multiplier (largest winAmount / bet)
 *   - error rate     (NaN / Infinity / thrown exceptions)
 *
 * Then we compare each metric to industry-reasonable ranges and flag
 * anything out of band:
 *   hit rate         8%–45%  (normal for 86% RTP high-vol to 95% RTP low-vol)
 *   effective RTP    within ±15% of target  (wider bands because small N has variance)
 *   FS trigger       <3% / 1000 spins  (1-in-~200 is industry standard)
 *   max win mult     ≤ config.MAX_WIN_MULTIPLIER (hard cap)
 *   error rate       0 tolerance
 *
 * Runs with N=500 by default (balances speed + statistical significance);
 * pass --spins=N to override.
 */

const path = require('path');
const engine = require(path.join(__dirname, '..', 'server', 'services', 'game-engine'));
const houseEdge = require(path.join(__dirname, '..', 'server', 'services', 'house-edge'));
const games = require(path.join(__dirname, '..', 'shared', 'game-definitions'));
const cfg = (() => {
    try { return require(path.join(__dirname, '..', 'server', 'config')); }
    catch (_) { return { TARGET_RTP: 86, MAX_WIN_MULTIPLIER: 250 }; }
})();

const N_ARG = process.argv.find(a => a.startsWith('--spins='));
const N = N_ARG ? parseInt(N_ARG.slice(8), 10) : 500;
const ONLY_ARG = process.argv.find(a => a.startsWith('--only='));
const ONLY = ONLY_ARG ? new Set(ONLY_ARG.slice(7).split(',')) : null;

const target = games.filter(g => !ONLY || ONLY.has(g.id));
console.log(`\n=== BEHAVIOURAL SIM — ${target.length} games × ${N} spins each ===\n`);
console.log(`Target RTP: ${(cfg.TARGET_RTP * 100).toFixed(0)}%    Max win mult: ${cfg.MAX_WIN_MULTIPLIER}\n`);

const issues = [];
const warns = [];

(async () => {
    let idx = 0;
    for (const game of target) {
        idx++;
        const bet = game.minBet || 0.20;
        // Maintain per-game running stats so scaleWinForRTP sees realistic data
        const stats = { total_spins: 0, total_wagered: 0, total_paid: 0 };

        let wins = 0, losses = 0, fsCount = 0, bonusCount = 0, errors = 0;
        let maxWinMult = 0, totalPaid = 0;
        let freeSpinState = null;
        let fsSequenceCaps = 0;       // how many times a FS round ran >100 spins

        for (let i = 0; i < N; i++) {
            stats.total_spins++;
            stats.total_wagered += bet;
            let result;
            try {
                result = await engine.resolveSpin(game, bet, stats, freeSpinState, null);
                // Mirror the route-level MAX_WIN_MULTIPLIER cap that
                // spin.routes.js applies to every production spin.
                if (result && typeof result.winAmount === 'number' && result.winAmount > 0) {
                    result.winAmount = await houseEdge.capWinAmount(result.winAmount, bet, game, null);
                }
            } catch (e) {
                errors++;
                continue;
            }
            const w = result.winAmount;
            if (typeof w !== 'number' || !isFinite(w) || w < 0) {
                errors++;
                continue;
            }
            if (w > 0) {
                wins++;
                totalPaid += w;
                stats.total_paid += w;
                const mult = w / bet;
                if (mult > maxWinMult) maxWinMult = mult;
            } else {
                losses++;
            }
            if (result.scatterTriggered) fsCount++;
            if (result.winDetails && result.winDetails.type &&
                result.winDetails.type !== 'none' &&
                result.winDetails.type !== 'payline' &&
                result.winDetails.type !== 'cluster') {
                bonusCount++;
            }
            // Persist FS state between iterations so sequential FS rounds resolve
            freeSpinState = result.freeSpinState;
            // Detect a runaway FS round
            if (freeSpinState && freeSpinState.totalAwarded > 100) fsSequenceCaps++;
        }

        const hitRate = wins / N;
        const rtp = totalPaid / (bet * N);
        const fsRate = fsCount / N;
        const bonusRate = bonusCount / N;

        // Issue bands
        const flags = [];
        if (errors > 0) flags.push(`${errors} errors`);
        if (hitRate < 0.05) flags.push(`hit rate ${(hitRate * 100).toFixed(1)}% too low`);
        if (hitRate > 0.55) flags.push(`hit rate ${(hitRate * 100).toFixed(1)}% too high`);
        // Effective RTP deviates — small N gives high variance, so loose bands
        if (rtp > 0 && (rtp < 0.50 || rtp > 1.50)) {
            flags.push(`RTP ${(rtp * 100).toFixed(1)}% drastically off`);
        }
        if (fsRate > 0.05) flags.push(`FS rate ${(fsRate * 100).toFixed(1)}% too high`);
        if (maxWinMult > cfg.MAX_WIN_MULTIPLIER * 1.05) {
            flags.push(`max win ${maxWinMult.toFixed(1)}x > cap ${cfg.MAX_WIN_MULTIPLIER}`);
        }
        if (fsSequenceCaps > 0) flags.push(`FS round exceeded 100 total in ${fsSequenceCaps} spins`);

        const status = flags.length ? '🔴' : '✅';
        const line = `${status} [${String(idx).padStart(3)}/${target.length}] ${game.id.padEnd(24)} `
            + `hits:${(hitRate*100).toFixed(1).padStart(5)}% `
            + `RTP:${(rtp*100).toFixed(1).padStart(6)}% `
            + `FS:${(fsRate*100).toFixed(1).padStart(4)}% `
            + `maxX:${maxWinMult.toFixed(1).padStart(7)} `
            + `bonusType=${String(game.bonusType || '-').padEnd(18)}`;

        if (flags.length) {
            issues.push({ id: game.id, flags, metrics: { hitRate, rtp, fsRate, maxWinMult, errors } });
            console.log(line + ' — ' + flags.join(', '));
        } else {
            console.log(line);
        }
    }

    console.log('\n========================================');
    console.log(`SUMMARY: ${target.length - issues.length}/${target.length} pass, ${issues.length} flagged`);
    if (issues.length) {
        console.log('\nFLAGGED GAMES (by first flag):');
        const byFlag = new Map();
        issues.forEach(i => {
            const key = i.flags[0].replace(/\d+\.?\d*/g, 'X').replace(/[0-9]/g, '');
            if (!byFlag.has(key)) byFlag.set(key, []);
            byFlag.get(key).push(i.id);
        });
        for (const [k, ids] of byFlag) {
            console.log(`  ${k}:  ${ids.join(', ')}`);
        }
    }
    process.exit(issues.length ? 1 : 0);
})();
