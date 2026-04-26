'use strict';

/**
 * Bonus-session lifecycle test.
 *
 * Exercises the universal engine's scatter detector and the
 * bonus-session service's state machine. Does NOT hit the live
 * server — uses an in-memory db shim so the test is fast and
 * runnable without `npm install`.
 *
 * Run: `node scripts/test-bonus-session.js`. Exits non-zero on failure.
 */

const universal = require('../server/services/slot-engine-universal.service');

let failures = 0;
function fail(msg) { failures += 1; console.error('FAIL:', msg); }
function ok(msg) { console.log('  ok ', msg); }

console.log('1. Scatter detection on universal grids');

// Fabricate a grid with a known number of scatters and verify
// countScatters() reports it accurately.
const game = universal.getGame('sugar_rush');
const cols = game.cols, gridRows = game.rows;
const fakeGrid = [];
for (let c = 0; c < cols; c++) {
    const col = [];
    for (let r = 0; r < gridRows; r++) col.push('s1_lollipop');
    fakeGrid.push(col);
}
let n = universal.countScatters(game, fakeGrid);
if (n !== 0) fail('expected 0 scatters on all-s1 grid, got ' + n);
else ok('grid with no scatters reports 0');

// Drop in 5 scatters at known positions
fakeGrid[0][0] = game.scatterSymbol;
fakeGrid[1][1] = game.scatterSymbol;
fakeGrid[2][2] = game.scatterSymbol;
fakeGrid[3][3] = game.scatterSymbol;
fakeGrid[4][4] = game.scatterSymbol;
n = universal.countScatters(game, fakeGrid);
if (n !== 5) fail('expected 5 scatters, got ' + n);
else ok('grid with 5 scatters reports 5');

// Game without a scatter symbol returns 0 regardless
const noScatter = { scatterSymbol: null, cols, rows: gridRows };
if (universal.countScatters(noScatter, fakeGrid) !== 0) fail('null scatter symbol should yield 0');
else ok('game without scatter symbol returns 0');

console.log('\n2. Bonus session state machine (in-memory shim)');

// Spin up an in-memory DB shim: the service module uses
// db.run/db.get/db.sqlNow, so we mock just those.
const Module = require('module');
const origRequire = Module.prototype.require;
const sessionRows = []; // bonus_sessions rows
let seq = 0;
function nowIso() { return new Date().toISOString(); }
const dbShim = {
    sqlNow() { return "'" + nowIso() + "'"; },
    async run(sql, params) {
        if (/INSERT INTO bonus_sessions/i.test(sql)) {
            seq += 1;
            // The service's INSERT has literal 0 / '{}' / 'active' for
            // the spins_consumed / total_win_cents / state_json /
            // status columns, with only 6 placeholders. Mirror that.
            const r = {
                id: seq,
                user_id: params[0],
                game_id: params[1],
                bonus_type: params[2],
                trigger_round_id: params[3],
                original_bet_cents: params[4],
                spins_remaining: params[5],
                spins_consumed: 0,
                total_win_cents: 0,
                state_json: '{}',
                status: 'active',
                created_at: nowIso(),
                completed_at: null,
            };
            sessionRows.push(r);
            return { lastID: seq, changes: 1 };
        }
        if (/UPDATE bonus_sessions SET spins_remaining = spins_remaining \+/i.test(sql)) {
            const sid = params[1];
            const r = sessionRows.find(x => x.id === Number(sid) && x.status === 'active');
            if (!r) return { changes: 0 };
            r.spins_remaining += params[0];
            return { changes: 1 };
        }
        if (/UPDATE bonus_sessions SET\s+spins_remaining = spins_remaining - 1/i.test(sql)) {
            const sid = params[1];
            const r = sessionRows.find(x => x.id === Number(sid) && x.status === 'active' && x.spins_remaining > 0);
            if (!r) return { changes: 0 };
            r.spins_remaining -= 1;
            r.spins_consumed += 1;
            r.total_win_cents += Number(params[0]) || 0;
            return { changes: 1 };
        }
        if (/UPDATE bonus_sessions SET status = 'completed'/i.test(sql)) {
            const sid = params[0];
            const r = sessionRows.find(x => x.id === Number(sid) && x.status === 'active');
            if (!r) return { changes: 0 };
            r.status = 'completed';
            r.completed_at = nowIso();
            return { changes: 1 };
        }
        return { changes: 0 };
    },
    async get(sql, params) {
        if (process.env.DEBUG_BONUS_TEST) console.log('SQL:', sql.replace(/\s+/g, ' ').slice(0, 100), 'params:', params);
        if (/FROM bonus_sessions WHERE user_id = \? AND status = 'active'/i.test(sql)) {
            return sessionRows.filter(r => Number(r.user_id) === Number(params[0]) && r.status === 'active')
                .sort((a, b) => b.id - a.id)[0] || null;
        }
        if (/FROM bonus_sessions WHERE id = \?/i.test(sql)) {
            return sessionRows.find(r => Number(r.id) === Number(params[0])) || null;
        }
        // spins_remaining-only fetch
        if (/SELECT spins_remaining FROM bonus_sessions WHERE id = \?/i.test(sql)) {
            const r = sessionRows.find(x => Number(x.id) === Number(params[0]));
            return r ? { spins_remaining: r.spins_remaining } : null;
        }
        return null;
    },
};
// Stub out the database require so the service uses our shim.
Module.prototype.require = function (id) {
    if (id === '../database') return dbShim;
    return origRequire.call(this, id);
};
const bonus = require('../server/services/bonus-session.service');
Module.prototype.require = origRequire;

(async () => {
    const userId = 42;
    // No active session yet
    let active = await bonus.getActiveForUser(userId);
    if (active) fail('expected no active session at start');
    else ok('no active session initially');

    // Open a 10-spin session
    const sid = await bonus.open({
        userId, gameId: 'sugar_rush',
        gameDef: { freeSpinsCount: 10, bonusType: 'tumble' },
        betCents: 200, triggerRoundId: 999,
    });
    if (!sid) fail('open() returned null');
    else ok('opened session id=' + sid);

    active = await bonus.getActiveForUser(userId);
    if (!active || Number(active.spins_remaining) !== 10) fail('active session should have 10 spins remaining');
    else ok('active session has 10 spins remaining');

    // Consume 3 spins, with one win
    await bonus.consumeSpin(sid, 0);
    await bonus.consumeSpin(sid, 250);
    await bonus.consumeSpin(sid, 0);
    active = await bonus.getActiveForUser(userId);
    if (!active || Number(active.spins_remaining) !== 7 || Number(active.total_win_cents) !== 250) {
        fail('after 3 spins (one paying 250) expected 7 remaining / 250 won; got ' +
             active.spins_remaining + ' / ' + active.total_win_cents);
    } else ok('after 3 spins: 7 remaining, 250 cents won');

    // Retrigger adds 8 more
    const after = await bonus.addRetriggerSpins(sid, 8);
    if (after !== 15) fail('retrigger should bring remaining to 15, got ' + after);
    else ok('retrigger adds 8 spins → 15 remaining');

    // Drain the rest. Last consume should mark complete.
    for (let i = 0; i < 15; i++) await bonus.consumeSpin(sid, 100);
    const final = await bonus.getById(sid);
    if (final.status !== 'completed') fail('session should be completed, got ' + final.status);
    else ok('session marked completed after final spin');
    if (Number(final.total_win_cents) !== 250 + 1500) fail('total wins wrong: ' + final.total_win_cents);
    else ok('total wins accumulate correctly (250 + 1500 = 1750)');

    // Once completed, getActiveForUser returns null
    active = await bonus.getActiveForUser(userId);
    if (active) fail('completed session should not be returned as active');
    else ok('completed session not returned as active');

    // Consuming a completed session is a no-op
    const noop = await bonus.consumeSpin(sid, 100);
    if (noop) fail('consume on completed session should return null');
    else ok('consume on completed session returns null');

    console.log('\nDone. ' + (failures === 0 ? 'All checks passed.' : failures + ' failures.'));
    process.exit(failures === 0 ? 0 : 1);
})();
