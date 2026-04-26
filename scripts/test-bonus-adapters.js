'use strict';

/**
 * Bonus-adapter unit tests.
 *
 * One test per adapter family. Each test fabricates a controlled grid
 * + base outcome and verifies the adapter's transformation:
 *   - multiplier scales the win
 *   - tumble re-scores after dropping winning cells
 *   - expanding fills a column
 *   - walking-wild carries wilds across spins
 *   - hold-and-win stickies coins and pays per coin
 *   - respin locks pairs and re-drops other reels
 *   - wild_collect grows a session-wide multiplier
 *
 * Standalone — no DB, no node_modules.
 *
 * Run: `node scripts/test-bonus-adapters.js`
 */

const adapters = require('../server/services/bonus-adapters');
const universal = require('../server/services/slot-engine-universal.service');

let failures = 0;
function fail(msg) { failures += 1; console.error('FAIL:', msg); }
function ok(msg) { console.log('  ok ', msg); }

// Deterministic test PRNG (always returns the same sequence)
function makePrng(seed) {
    let s = seed >>> 0;
    return function () {
        s = (s + 0x6D2B79F5) >>> 0;
        let t = s;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

function emptyGrid(cols, rows, fill) {
    const g = [];
    for (let c = 0; c < cols; c++) {
        const col = [];
        for (let r = 0; r < rows; r++) col.push(fill || null);
        g.push(col);
    }
    return g;
}

console.log('1. Multiplier adapter');
{
    const game = universal.getGame('gates_olympus');
    const grid = emptyGrid(game.cols, game.rows, 's1_chalice');
    const r = adapters._adapters.multiplierAdapter({
        state: {},
        baseGrid: grid,
        baseWinCents: 1000,
        baseLines: [{ line: 0, length: 5, win_cents: 1000 }],
        game, betCents: 100, prng: makePrng(42),
    });
    if (r.winCents <= 1000) fail('multiplier should scale win, got ' + r.winCents);
    else ok('multiplier scaled 1000 → ' + r.winCents + ' (×' + r.multiplier + ')');
    if (r.lines[0].win_cents !== r.winCents) fail('line win_cents not scaled in lockstep');
    else ok('line win_cents scaled to match total');
}

console.log('\n2. Tumble adapter (cascade level)');
{
    const game = universal.getGame('sugar_rush');
    // Start with a grid where cluster pays. Use a 7x7 of s1 with a
    // few wilds to ensure a cluster forms.
    const grid = emptyGrid(game.cols, game.rows, 's1_lollipop');
    const r = adapters._adapters.tumbleAdapter({
        state: { cascadeLevel: 0 },
        baseGrid: grid,
        baseWinCents: 500,
        baseLines: [{ symbol: 's1_lollipop', size: 49, cells: gridAllCells(game.cols, game.rows), win_cents: 500 }],
        game, betCents: 100, prng: makePrng(7),
    });
    if (r.state.cascadeLevel <= 0) fail('expected cascade level to advance, got ' + r.state.cascadeLevel);
    else ok('cascade level advances after tumbles (level=' + r.state.cascadeLevel + ')');
    if (r.winCents < 500) fail('tumble should never lose money vs base, got ' + r.winCents);
    else ok('tumble winCents >= base (' + r.winCents + ' >= 500)');
}

console.log('\n3. Expanding-symbol adapter');
{
    const game = universal.getGame('book_dead');
    const grid = emptyGrid(game.cols, game.rows, 's1_ankh');
    grid[2][1] = 's4_pharaoh'; // one pharaoh on column 2
    const r = adapters._adapters.expandingAdapter({
        state: {},
        baseGrid: grid,
        baseWinCents: 0,
        baseLines: [],
        game, betCents: 100, prng: makePrng(0),
    });
    if (!r.state.expandingSymbol) fail('expandingSymbol not picked');
    else ok('expanding symbol picked: ' + r.state.expandingSymbol);
    // If the chosen symbol matches a column's contents, the column is filled
    if (r.gridOverride) {
        const chosen = r.state.expandingSymbol;
        for (let c = 0; c < game.cols; c++) {
            if (r.gridOverride[c].indexOf(chosen) !== -1) {
                const allMatch = r.gridOverride[c].every(s => s === chosen);
                if (!allMatch) fail('column with chosen symbol not fully filled');
            }
        }
        ok('expanded columns are fully filled');
    }
}

console.log('\n4. Walking-wild adapter');
{
    const game = universal.getGame('mystic_wolf');
    const grid = emptyGrid(game.cols, game.rows, 's1_feather');
    grid[0][1] = game.wildSymbol; // a wild at column 0, row 1
    let r = adapters._adapters.walkingWildAdapter({
        state: {},
        baseGrid: grid,
        baseWinCents: 0,
        baseLines: [],
        game, betCents: 100, prng: makePrng(5),
    });
    if (!r.state.carriedWilds || r.state.carriedWilds.length === 0) fail('wild not carried');
    else ok('wild positions carried: ' + JSON.stringify(r.state.carriedWilds));
    // Next spin: that wild should walk one column right
    const nextGrid = emptyGrid(game.cols, game.rows, 's1_feather');
    r = adapters._adapters.walkingWildAdapter({
        state: { carriedWilds: [[0, 1]] },
        baseGrid: nextGrid,
        baseWinCents: 0,
        baseLines: [],
        game, betCents: 100, prng: makePrng(6),
    });
    if (!r.gridOverride || r.gridOverride[1][1] !== game.wildSymbol) {
        fail('walking wild did not advance to column 1, row 1');
    } else ok('wild walked from col 0 → col 1');
}

console.log('\n5. Hold-and-Win adapter (sticky coins)');
{
    const game = universal.getGame('wolf_gold');
    const grid = emptyGrid(game.cols, game.rows, 's1_feather');
    // First spin: 3 coins at known positions
    grid[0][0] = game.scatterSymbol;
    grid[2][1] = game.scatterSymbol;
    grid[4][2] = game.scatterSymbol;
    const r = adapters._adapters.holdAndWinAdapter({
        state: {},
        baseGrid: grid,
        baseWinCents: 0,
        baseLines: [],
        game, betCents: 100, prng: makePrng(0),
    });
    if (!r.state.coins || r.state.coins.length !== 3) fail('expected 3 coins captured, got ' + (r.state.coins && r.state.coins.length));
    else ok('captured 3 coins');
    // Next spin: the 3 coins should still be on the board
    const fresh = emptyGrid(game.cols, game.rows, 's1_feather');
    const r2 = adapters._adapters.holdAndWinAdapter({
        state: { coins: r.state.coins },
        baseGrid: fresh,
        baseWinCents: 0,
        baseLines: [],
        game, betCents: 100, prng: makePrng(1),
    });
    if (!r2.gridOverride) fail('gridOverride missing on respin');
    else {
        const stuck = r2.gridOverride[0][0] === game.scatterSymbol &&
                      r2.gridOverride[2][1] === game.scatterSymbol &&
                      r2.gridOverride[4][2] === game.scatterSymbol;
        if (!stuck) fail('coins did not stick to next spin');
        else ok('coins stick across respins');
    }
}

console.log('\n6. Respin adapter (pairs lock)');
{
    const game = universal.getGame('hot_chillies');
    const grid = emptyGrid(game.cols, game.rows, 's1_taco');
    // Center row: two tacos and one chilli
    grid[0][1] = 's1_taco'; grid[1][1] = 's1_taco'; grid[2][1] = 's4_chilli';
    const r = adapters._adapters.respinAdapter({
        state: {},
        baseGrid: grid,
        baseWinCents: 50,
        baseLines: [],
        game, betCents: 100, prng: makePrng(3),
    });
    if (r.gridOverride) {
        // The two pair cells must remain s1_taco
        if (r.gridOverride[0][1] !== 's1_taco' || r.gridOverride[1][1] !== 's1_taco') {
            fail('paired cells did not lock');
        } else ok('respin locks paired cells');
    } else ok('no respin needed (no pair) — adapter tolerated grid');
}

console.log('\n7. Wild-collect adapter (session multiplier)');
{
    const game = universal.getGame('wolf_gold');
    let state = {};
    // First spin: 3 wilds → multiplier becomes 1 + floor(3/3) = 2
    const grid = emptyGrid(game.cols, game.rows, 's1_feather');
    grid[1][1] = game.wildSymbol;
    grid[2][2] = game.wildSymbol;
    grid[3][0] = game.wildSymbol;
    const r = adapters._adapters.wildCollectAdapter({
        state,
        baseGrid: grid,
        baseWinCents: 100,
        baseLines: [{ line: 0, length: 3, win_cents: 100 }],
        game, betCents: 100, prng: makePrng(0),
    });
    if (r.state.wildCount !== 3) fail('wildCount should be 3, got ' + r.state.wildCount);
    else ok('wild_collect counts wilds (3 collected)');
    if (r.winCents !== 200 || r.multiplier !== 2) fail('expected 100×2=200, got ' + r.winCents + ' (mult=' + r.multiplier + ')');
    else ok('×2 multiplier applied (3 wilds → +1× per 3)');
}

console.log('\n8. Routing table covers every catalog bonusType');
{
    const catalog = require('../shared/game-definitions.js');
    const seenTypes = new Set();
    let unrouted = 0;
    for (const def of catalog) {
        if (!def || !def.bonusType) continue;
        seenTypes.add(def.bonusType);
        if (!adapters.adapterFor(def.bonusType)) {
            unrouted += 1;
            console.error('  unrouted bonusType:', def.bonusType, '(' + def.id + ')');
        }
    }
    if (unrouted > 0) fail(unrouted + ' catalog bonus types have no adapter');
    else ok(seenTypes.size + ' distinct bonus types in catalog, all routed');
}

console.log('\nDone. ' + (failures === 0 ? 'All checks passed.' : failures + ' failures.'));
process.exit(failures === 0 ? 0 : 1);


function gridAllCells(cols, rows) {
    const out = [];
    for (let c = 0; c < cols; c++) for (let r = 0; r < rows; r++) out.push([c, r]);
    return out;
}
