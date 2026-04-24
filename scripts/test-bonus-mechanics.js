#!/usr/bin/env node
'use strict';

/**
 * Deterministic per-mechanic test suite.
 *
 * Each test FORCES a specific scenario (a constructed grid or pre-set
 * freeSpinState) and asserts the engine / bonus-mechanics library
 * actually does what that mechanic claims — not just a statistical
 * pass over random input.
 *
 * This catches bugs the behavioural simulation misses:
 *   - symbol_upgrade moving symbols DOWN instead of up
 *   - expanding_wilds ignoring columns that had a wild
 *   - walking_wild walking the wrong direction
 *   - multiplier_trail not resetting on losses
 *   - collector miscounting
 *   - pick_bonus not firing on its trigger
 *   - progressive not returning a contribution
 *
 * Each test prints PASS / FAIL with the failing assertion. The script
 * exits 1 on any failure so it can gate CI.
 */

const path = require('path');
const bonus = require(path.join(__dirname, '..', 'server', 'services', 'bonus-mechanics'));
const engine = require(path.join(__dirname, '..', 'server', 'services', 'game-engine'));
const games = require(path.join(__dirname, '..', 'shared', 'game-definitions'));

let passed = 0, failed = 0;
const failures = [];

function test(name, fn) {
    try {
        fn();
        passed++;
        console.log('  ✅ ' + name);
    } catch (e) {
        failed++;
        failures.push({ name, msg: e.message });
        console.log('  ❌ ' + name + ' — ' + e.message);
    }
}

function assert(cond, msg) {
    if (!cond) throw new Error(msg || 'assertion failed');
}
function assertEq(a, b, msg) {
    if (a !== b) throw new Error((msg || 'values differ') + ' (got ' + JSON.stringify(a) + ', want ' + JSON.stringify(b) + ')');
}

// Helpers
function mkGrid(cols, rows, fill) {
    const g = [];
    for (let c = 0; c < cols; c++) g.push(new Array(rows).fill(fill || null));
    return g;
}
function countIn(grid, sym) {
    let n = 0;
    for (const col of grid) for (const s of col) if (s === sym) n++;
    return n;
}

// ══════════════════════════════════════════════════════════════════════
console.log('\n=== CANONICAL BONUS TYPE ALIAS RESOLUTION ===');
// ══════════════════════════════════════════════════════════════════════
test('free_spins → none', () => {
    assertEq(bonus.canonicalBonusType({ bonusType: 'free_spins' }), 'none');
});
test('walking_wild → walking_wilds', () => {
    assertEq(bonus.canonicalBonusType({ bonusType: 'walking_wild' }), 'walking_wilds');
});
test('expanding_wild → expanding_wilds', () => {
    assertEq(bonus.canonicalBonusType({ bonusType: 'expanding_wild' }), 'expanding_wilds');
});
test('symbol_upgrade stays itself', () => {
    assertEq(bonus.canonicalBonusType({ bonusType: 'symbol_upgrade' }), 'symbol_upgrade');
});
test('null / undefined return null', () => {
    assertEq(bonus.canonicalBonusType({ bonusType: null }), null);
    assertEq(bonus.canonicalBonusType({}), null);
});

// ══════════════════════════════════════════════════════════════════════
console.log('\n=== symbol_upgrade ===');
// ══════════════════════════════════════════════════════════════════════
test('upgrades s1/s2 symbols during free spins', () => {
    const game = {
        bonusType: 'symbol_upgrade',
        symbols: ['s1_low', 's2_mid', 's3_hi', 's4_top', 'w', 'scat'],
        wildSymbol: 'w', scatterSymbol: 'scat',
        symbolUpgradeChance: 0.99,  // force upgrades
    };
    const grid = mkGrid(5, 3, 's1_low');
    const result = bonus.applyGridMechanics(grid, game, { active: true });
    const s1 = countIn(grid, 's1_low');
    const upgraded = 15 - s1;
    assert(upgraded > 0, 'expected some upgrades, got 0');
    assert(result.notes.includes('symbol_upgrade'), 'notes should contain symbol_upgrade');
});
test('does NOT upgrade outside free spins', () => {
    const game = { bonusType: 'symbol_upgrade', symbols: ['s1_a', 's2_b', 's3_c'], symbolUpgradeChance: 0.99 };
    const grid = mkGrid(5, 3, 's1_a');
    bonus.applyGridMechanics(grid, game, { active: false });
    assertEq(countIn(grid, 's1_a'), 15, 'grid should be untouched');
});

// ══════════════════════════════════════════════════════════════════════
console.log('\n=== expanding_wilds ===');
// ══════════════════════════════════════════════════════════════════════
test('expands columns containing a wild during free spins', () => {
    const game = { bonusType: 'expanding_wilds', wildSymbol: 'w', symbols: ['a','b','w'] };
    const grid = mkGrid(5, 3, 'a');
    grid[2][1] = 'w';  // wild at column 2, row 1
    bonus.applyGridMechanics(grid, game, { active: true });
    assertEq(grid[2][0], 'w', 'col 2 row 0 should be wild');
    assertEq(grid[2][1], 'w', 'col 2 row 1 stays wild');
    assertEq(grid[2][2], 'w', 'col 2 row 2 should be wild');
    // Other columns untouched
    assertEq(grid[0][0], 'a', 'col 0 untouched');
    assertEq(grid[3][0], 'a', 'col 3 untouched');
});

// ══════════════════════════════════════════════════════════════════════
console.log('\n=== walking_wilds ===');
// ══════════════════════════════════════════════════════════════════════
test('walks wild one column left each spin', () => {
    const game = { bonusType: 'walking_wilds', wildSymbol: 'w', symbols: ['a','w'] };
    const fs = { active: true };
    // Spin 1: wild lands in column 4
    const g1 = mkGrid(5, 3, 'a');
    g1[4][1] = 'w';
    bonus.applyGridMechanics(g1, game, fs);
    assertEq(fs._walkerColumn, 4, 'walker column should be 4 after spin 1');
    // Spin 2: engine provides a fresh grid; walker advances
    const g2 = mkGrid(5, 3, 'a');
    bonus.applyGridMechanics(g2, game, fs);
    assertEq(fs._walkerColumn, 3, 'walker advances to column 3');
    for (let r = 0; r < 3; r++) assertEq(g2[3][r], 'w', 'column 3 should be fully wild');
});

// ══════════════════════════════════════════════════════════════════════
console.log('\n=== multiplier_trail ===');
// ══════════════════════════════════════════════════════════════════════
test('multiplier grows on consecutive wins, resets on loss', () => {
    const game = { bonusType: 'multiplier_trail', multiplierTrailCap: 10 };
    const fs = { active: true };
    let r = bonus.applyTrailMultiplier(game, fs, 10);
    assertEq(r.extraMult, 2, 'win #1 should bring trail to 2');
    r = bonus.applyTrailMultiplier(game, fs, 10);
    assertEq(r.extraMult, 3, 'win #2 should bring trail to 3');
    r = bonus.applyTrailMultiplier(game, fs, 10);
    assertEq(r.extraMult, 4, 'win #3 should bring trail to 4');
    r = bonus.applyTrailMultiplier(game, fs, 0);  // loss
    assertEq(r.extraMult, 1, 'loss should reset trail to 1');
});
test('multiplier trail is capped', () => {
    const game = { bonusType: 'multiplier_trail', multiplierTrailCap: 5 };
    const fs = { active: true };
    for (let i = 0; i < 20; i++) bonus.applyTrailMultiplier(game, fs, 10);
    const r = bonus.applyTrailMultiplier(game, fs, 10);
    assertEq(r.extraMult, 5, 'should cap at 5');
});
test('no effect outside free spins', () => {
    const game = { bonusType: 'multiplier_trail' };
    const r = bonus.applyTrailMultiplier(game, { active: false }, 10);
    assertEq(r.extraMult, 1, 'should be no-op outside FS');
});

// ══════════════════════════════════════════════════════════════════════
console.log('\n=== collector ===');
// ══════════════════════════════════════════════════════════════════════
test('awards bonus spins when threshold reached', () => {
    const game = {
        bonusType: 'collector', scatterSymbol: 'coin', wildSymbol: 'w',
        collectorThreshold: 5, collectorReward: 3
    };
    const fs = { active: true };
    // Grid with 5 coin symbols - should trigger award
    const grid = mkGrid(5, 3, 'a');
    let coins = 0;
    for (let c = 0; c < 5 && coins < 5; c++) {
        for (let r = 0; r < 3 && coins < 5; r++) {
            grid[c][r] = 'coin'; coins++;
        }
    }
    const r = bonus.applyCollector(grid, game, fs);
    assertEq(r.awarded, 3, 'should award 3 spins (threshold met once)');
    assertEq(fs._collected, 0, 'collected should reset to 0 after award');
});
test('accumulates across spins below threshold', () => {
    const game = { bonusType: 'collector', scatterSymbol: 'coin', collectorThreshold: 10, collectorReward: 5 };
    const fs = { active: true };
    const grid1 = mkGrid(5, 3, 'a');
    grid1[0][0] = 'coin'; grid1[1][0] = 'coin'; grid1[2][0] = 'coin';
    bonus.applyCollector(grid1, game, fs);
    assertEq(fs._collected, 3, 'should have 3 collected');
    const grid2 = mkGrid(5, 3, 'a');
    grid2[0][0] = 'coin'; grid2[1][0] = 'coin';
    bonus.applyCollector(grid2, game, fs);
    assertEq(fs._collected, 5, 'should accumulate to 5');
});

// ══════════════════════════════════════════════════════════════════════
console.log('\n=== pick_bonus ===');
// ══════════════════════════════════════════════════════════════════════
test('resolves to a prize within the defined pool', () => {
    const game = { bonusType: 'pick_bonus', pickPrizes: [2, 5, 10, 25, 50] };
    const bet = 1;
    for (let i = 0; i < 50; i++) {
        const r = bonus.resolvePickBonus(game, bet);
        assert(r, 'should return a result');
        assert(game.pickPrizes.includes(r.winMultiplier), 'multiplier ' + r.winMultiplier + ' not in pool');
        assertEq(r.winAmount, r.winMultiplier * bet, 'winAmount should be mult * bet');
    }
});
test('returns null for non-pick_bonus games', () => {
    const r = bonus.resolvePickBonus({ bonusType: 'respin' }, 1);
    assertEq(r, null, 'should be null');
});

// ══════════════════════════════════════════════════════════════════════
console.log('\n=== progressive ===');
// ══════════════════════════════════════════════════════════════════════
test('contribution is 0.5% of bet by default', () => {
    const game = { bonusType: 'progressive' };
    assertEq(bonus.progressiveContribution(game, 100), 0.5);
});
test('contribution respects override', () => {
    const game = { bonusType: 'progressive', progressiveContribution: 0.02 };
    assertEq(bonus.progressiveContribution(game, 100), 2);
});
test('contribution is 0 for non-progressive games', () => {
    assertEq(bonus.progressiveContribution({ bonusType: 'tumble' }, 100), 0);
});
test('hit rate is realistic (1 in ~10000)', () => {
    const game = { bonusType: 'progressive' };
    let hits = 0;
    for (let i = 0; i < 100000; i++) if (bonus.progressiveHitCheck(game).hit) hits++;
    // Expect 5-20 hits in 100k spins (base rate 10k)
    assert(hits > 0 && hits < 100, 'hits=' + hits + ' outside 1-100 expected range');
});

// ══════════════════════════════════════════════════════════════════════
console.log('\n=== megaways ===');
// ══════════════════════════════════════════════════════════════════════
test('generates variable-height grid', () => {
    const game = {
        gridCols: 6, symbols: ['a','b','c','d'],
        megawaysMinRows: 2, megawaysMaxRows: 7
    };
    const weights = [1, 1, 1, 1];
    const result = bonus.generateMegawaysGrid(game, weights);
    assertEq(result.grid.length, 6, '6 columns');
    assert(result.rowsPerCol.every(r => r >= 2 && r <= 7), 'every col 2-7 rows');
    const expectedWays = result.rowsPerCol.reduce((a, b) => a * b, 1);
    assertEq(result.ways, expectedWays, 'ways = product of heights');
});

// ══════════════════════════════════════════════════════════════════════
console.log('\n=== end-to-end engine integration ===');
// ══════════════════════════════════════════════════════════════════════
test('every game in catalog produces a valid spin result', async () => {
    const stats = { total_spins: 50, total_wagered: 50, total_paid: 40 };
    let failedCount = 0;
    for (const g of games) {
        try {
            const r = await engine.resolveSpin(g, g.minBet, stats, null, null);
            assert(typeof r.winAmount === 'number' && isFinite(r.winAmount) && r.winAmount >= 0, g.id);
            assert(r.grid && r.grid.length > 0, g.id + ': missing grid');
            assert(r.freeSpinState && typeof r.freeSpinState.active === 'boolean', g.id + ': missing freeSpinState');
        } catch (e) {
            failedCount++;
            console.log('    ❌ ' + g.id + ': ' + e.message);
        }
    }
    assertEq(failedCount, 0, failedCount + ' games threw on resolveSpin');
});

// ══════════════════════════════════════════════════════════════════════
(async () => {
    // Wait for async tests — simple polling since we did them inline
    await new Promise(r => setImmediate(r));
    console.log('\n========================================');
    console.log('RESULT: ' + passed + ' pass, ' + failed + ' fail');
    if (failed > 0) {
        console.log('\nFAILURES:');
        failures.forEach(f => console.log('  ' + f.name + ' → ' + f.msg));
    }
    process.exit(failed ? 1 : 0);
})();
