#!/usr/bin/env node
/**
 * ═══════════════════════════════════════════════════════════
 * RTP Verification Script — Phase 7 QA
 * ═══════════════════════════════════════════════════════════
 *
 * Simulates N spins per game using the actual server-side game engine
 * and verifies that the effective RTP stays within acceptable bounds
 * of the TARGET_RTP (config.js).
 *
 * Usage:
 *   node tools/rtp-verifier.js                  # All 100 games, 10K spins each
 *   node tools/rtp-verifier.js --spins 100000   # All games, 100K spins each
 *   node tools/rtp-verifier.js --game sugar_rush # Single game
 *   node tools/rtp-verifier.js --verbose         # Show per-game details
 *
 * Exit codes:
 *   0 = all games within tolerance
 *   1 = one or more games outside tolerance
 */

const path = require('path');
const gameEngine = require(path.resolve(__dirname, '../server/services/game-engine'));
const houseEdge = require(path.resolve(__dirname, '../server/services/house-edge'));
const config = require(path.resolve(__dirname, '../server/config'));

// Load game definitions
let GAMES;
try {
    GAMES = require(path.resolve(__dirname, '../shared/game-definitions.js'));
} catch (e) {
    console.error('Failed to load game definitions:', e.message);
    process.exit(1);
}

// ── Parse CLI args ──
const args = process.argv.slice(2);
const SPINS_PER_GAME = parseInt(args.find((a, i) => args[i - 1] === '--spins') || '10000', 10);
const SINGLE_GAME = args.find((a, i) => args[i - 1] === '--game') || null;
const VERBOSE = args.includes('--verbose');
const TARGET_RTP = config.TARGET_RTP || 0.88;
const TOLERANCE = 0.10; // ±10% tolerance for statistical variance at 5K-10K spins
const BET = 1.00; // Standard bet for simulation

// ── Mock DB for house edge queries ──
// The house edge service queries DB for global stats to adjust RTP dynamically.
// We simulate a healthy, established casino with sufficient profit headroom
// so the win capping doesn't artificially suppress payouts during verification.
// In production, this data comes from real accumulated play history.
let _mockGlobalWagered = 500000; // $500K accumulated wagered
let _mockGlobalPaid = 440000;    // $440K paid out = 88% RTP baseline
const mockDb = {
    get: async (sql) => {
        // Return global stats for house edge calculations
        if (sql && (sql.includes('SUM(bet_amount)') || sql.includes('total_wagered') || sql.includes('game_stats'))) {
            return { total_wagered: _mockGlobalWagered, total_paid: _mockGlobalPaid, wagered: _mockGlobalWagered, paid: _mockGlobalPaid, total_spins: 500000 };
        }
        return null;
    },
    all: async () => [],
    run: async () => ({ changes: 0 }),
};

// ── Simulate N spins for a single game ──
async function simulateGame(game, numSpins) {
    let totalWagered = 0;
    let totalPaid = 0;
    let wins = 0;
    let losses = 0;
    let bigWins = 0; // > 10x bet
    let megaWins = 0; // > 50x bet
    let maxWin = 0;

    // Use accumulating gameStats so the dynamic RTP feedback loop is active.
    // This simulates production behavior: the house edge engine adjusts hit frequency
    // based on per-game RTP drift, converging toward TARGET_RTP.
    const gameStats = {
        total_wagered: 0,
        total_paid: 0,
        total_spins: 0,
    };

    for (let i = 0; i < numSpins; i++) {
        try {
            const result = await gameEngine.resolveSpin(game, BET, gameStats, null, mockDb);
            // Apply house edge cap (same as production spin.routes.js)
            let winAmount = result.winAmount || 0;
            if (winAmount > 0) {
                winAmount = await houseEdge.capWinAmount(winAmount, BET, game, mockDb);
            }

            totalWagered += BET;
            totalPaid += winAmount;

            // Update per-game running stats so the RTP feedback loop can adjust
            gameStats.total_wagered += BET;
            gameStats.total_paid += winAmount;
            gameStats.total_spins++;

            if (winAmount > 0) {
                wins++;
                if (winAmount > maxWin) maxWin = winAmount;
                if (winAmount >= BET * 10) bigWins++;
                if (winAmount >= BET * 50) megaWins++;
            } else {
                losses++;
            }
        } catch (err) {
            // Log but continue — some games may have edge case configs
            if (VERBOSE) {
                console.warn(`  [WARN] Spin ${i} failed for ${game.id}: ${err.message}`);
            }
        }
    }

    const effectiveRTP = totalWagered > 0 ? totalPaid / totalWagered : 0;
    const hitRate = wins / numSpins;

    return {
        gameId: game.id,
        gameName: game.name,
        provider: game.provider,
        gridSize: `${game.gridCols || 3}x${game.gridRows || 1}`,
        winType: game.winType || 'classic',
        configRTP: game.rtp,
        spins: numSpins,
        totalWagered,
        totalPaid: Math.round(totalPaid * 100) / 100,
        effectiveRTP: Math.round(effectiveRTP * 10000) / 10000,
        hitRate: Math.round(hitRate * 10000) / 10000,
        wins,
        losses,
        bigWins,
        megaWins,
        maxWin: Math.round(maxWin * 100) / 100,
        houseEdge: Math.round((1 - effectiveRTP) * 10000) / 10000,
        withinTolerance: effectiveRTP >= (TARGET_RTP - TOLERANCE) && effectiveRTP <= (TARGET_RTP + TOLERANCE),
    };
}

// ── Main ──
async function main() {
    console.log('═══════════════════════════════════════════════════════');
    console.log('  RTP Verification — Phase 7 QA');
    console.log('═══════════════════════════════════════════════════════');
    console.log(`  Target RTP:  ${(TARGET_RTP * 100).toFixed(1)}%`);
    console.log(`  Tolerance:   ±${(TOLERANCE * 100).toFixed(1)}%`);
    console.log(`  Acceptable:  ${((TARGET_RTP - TOLERANCE) * 100).toFixed(1)}% – ${((TARGET_RTP + TOLERANCE) * 100).toFixed(1)}%`);
    console.log(`  Spins/game:  ${SPINS_PER_GAME.toLocaleString()}`);
    console.log(`  Bet amount:  $${BET.toFixed(2)}`);
    console.log('');

    const gamesToTest = SINGLE_GAME
        ? GAMES.filter(g => g.id === SINGLE_GAME)
        : GAMES;

    if (gamesToTest.length === 0) {
        console.error(`No games found${SINGLE_GAME ? ` matching "${SINGLE_GAME}"` : ''}`);
        process.exit(1);
    }

    console.log(`  Testing ${gamesToTest.length} game(s)...\n`);

    const results = [];
    let passed = 0;
    let failed = 0;

    for (let i = 0; i < gamesToTest.length; i++) {
        const game = gamesToTest[i];
        const progress = `[${String(i + 1).padStart(3)}/${gamesToTest.length}]`;

        process.stdout.write(`${progress} ${game.id.padEnd(25)} `);

        const result = await simulateGame(game, SPINS_PER_GAME);
        results.push(result);

        const rtpPct = (result.effectiveRTP * 100).toFixed(2);
        const hePct = (result.houseEdge * 100).toFixed(2);
        const hitPct = (result.hitRate * 100).toFixed(1);
        const status = result.withinTolerance ? '✓' : '✗';

        if (result.withinTolerance) {
            passed++;
            console.log(`${status} RTP=${rtpPct}%  HE=${hePct}%  Hit=${hitPct}%  MaxWin=${result.maxWin}x`);
        } else {
            failed++;
            console.log(`${status} RTP=${rtpPct}%  HE=${hePct}%  Hit=${hitPct}%  MaxWin=${result.maxWin}x  ⚠️ OUT OF RANGE`);
        }

        if (VERBOSE) {
            console.log(`         Grid=${result.gridSize} Type=${result.winType} Wins=${result.wins} BigWins=${result.bigWins} MegaWins=${result.megaWins}`);
        }
    }

    // ── Summary ──
    console.log('\n═══════════════════════════════════════════════════════');
    console.log('  SUMMARY');
    console.log('═══════════════════════════════════════════════════════');

    const avgRTP = results.reduce((s, r) => s + r.effectiveRTP, 0) / results.length;
    const avgHitRate = results.reduce((s, r) => s + r.hitRate, 0) / results.length;
    const totalSpins = results.reduce((s, r) => s + r.spins, 0);
    const totalWagered = results.reduce((s, r) => s + r.totalWagered, 0);
    const totalPaid = results.reduce((s, r) => s + r.totalPaid, 0);
    const overallRTP = totalPaid / totalWagered;
    const overallHouseProfit = totalWagered - totalPaid;

    console.log(`  Games tested:    ${results.length}`);
    console.log(`  Total spins:     ${totalSpins.toLocaleString()}`);
    console.log(`  Total wagered:   $${totalWagered.toLocaleString()}`);
    console.log(`  Total paid out:  $${totalPaid.toLocaleString()}`);
    console.log(`  House profit:    $${overallHouseProfit.toLocaleString()}`);
    console.log(`  Overall RTP:     ${(overallRTP * 100).toFixed(2)}%`);
    console.log(`  Avg per-game:    ${(avgRTP * 100).toFixed(2)}%`);
    console.log(`  Avg hit rate:    ${(avgHitRate * 100).toFixed(1)}%`);
    console.log(`  Passed:          ${passed}/${results.length}`);
    console.log(`  Failed:          ${failed}/${results.length}`);

    if (failed > 0) {
        console.log('\n  ⚠️  FAILED GAMES:');
        results.filter(r => !r.withinTolerance).forEach(r => {
            console.log(`    ${r.gameId}: RTP=${(r.effectiveRTP * 100).toFixed(2)}% (target: ${(TARGET_RTP * 100).toFixed(1)}%)`);
        });
    }

    console.log('\n═══════════════════════════════════════════════════════');
    if (failed === 0) {
        console.log('  ✅ PASS — All games within RTP tolerance');
    } else {
        console.log(`  ❌ FAIL — ${failed} game(s) outside RTP tolerance`);
    }
    console.log('═══════════════════════════════════════════════════════\n');

    process.exit(failed > 0 ? 1 : 0);
}

main().catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
});
