'use strict';

/**
 * Per-game RTP regression. For every module in server/games/, asserts:
 *   1. The exported shape is well-formed (id, name, reels, paytable,
 *      bet bounds, rtp, evaluate).
 *   2. The closed-form theoretical RTP matches the declared rtp to
 *      within 0.01pp.
 *   3. The evaluator is pure: same input always produces the same
 *      output.
 *   4. A short Monte-Carlo sanity run exercises the engine's
 *      derive-floats → spin-reels → evaluate pipeline end to end.
 *
 * We rely on the closed-form check (not Monte-Carlo) for the RTP
 * assertion because high-volatility games like neon_burst have a
 * top-pay event at p≈1/759k — even 5M spins leaves ±10pp of variance
 * in the empirical RTP. The closed-form is exact and immune to that.
 *
 * Run: node scripts/test-slots.js
 */

process.env.SQLITE_FILE = process.env.SQLITE_FILE || ':memory:';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test_jwt_secret_at_least_32_chars_long_xx';
process.env.ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'test_admin_pw_xxxxxxxxxxxxxxx';
process.env.NFT_SIGNING_SECRET = process.env.NFT_SIGNING_SECRET || 'test_nft_secret_xxxxxxxxxxxxxxxxxxxxxxxxxx';

const crypto = require('crypto');
const games = require('../server/games');
const engine = require('../server/services/slot-engine.service');

const RTP_TOLERANCE = 0.0001; // 0.01pp — closed-form should be exact, this is float slack
const SHAPE_FIELDS = ['id', 'name', 'reels', 'paytable', 'min_bet_cents', 'max_bet_cents', 'rtp', 'evaluate'];

let failures = 0;
function fail(msg) { failures += 1; console.error('  FAIL: ' + msg); }
function pass(msg) { console.log('  ok   ' + msg); }

/**
 * Closed-form theoretical RTP for the single-payline N-reel format used
 * by every game in this catalog: every reel is identical, the win is
 * N-of-a-kind on the center row, and pay = paytable[symbol].
 *
 *   EV / bet = Σ_s pay_s × (count_s / reel_len)^N
 *
 * If a game introduces wilds, scatters, or multiple paylines, this
 * formula stops being valid — at that point the test should switch to
 * a per-game theoretical computation owned by the game module.
 */
function theoreticalRTP(game) {
    const reel = game.reels[0];
    const N = game.reels.length;
    const counts = Object.create(null);
    for (const s of reel) counts[s] = (counts[s] || 0) + 1;
    let ev = 0;
    for (const s of Object.keys(counts)) {
        if (game.paytable[s] == null) continue;
        ev += game.paytable[s] * Math.pow(counts[s] / reel.length, N);
    }
    return ev;
}

function checkShape(game) {
    for (const field of SHAPE_FIELDS) {
        if (game[field] == null) {
            fail(`${game.id || '<unknown>'}: missing field "${field}"`);
            return false;
        }
    }
    if (!Array.isArray(game.reels) || game.reels.length === 0) {
        fail(`${game.id}: reels must be a non-empty array of arrays`);
        return false;
    }
    const len = game.reels[0].length;
    for (let i = 0; i < game.reels.length; i++) {
        if (!Array.isArray(game.reels[i]) || game.reels[i].length !== len) {
            fail(`${game.id}: reel ${i} length mismatch (expected ${len}, got ${game.reels[i] && game.reels[i].length})`);
            return false;
        }
    }
    if (typeof game.evaluate !== 'function') {
        fail(`${game.id}: evaluate must be a function`);
        return false;
    }
    if (!(game.min_bet_cents > 0 && game.max_bet_cents >= game.min_bet_cents)) {
        fail(`${game.id}: bet bounds invalid (min=${game.min_bet_cents}, max=${game.max_bet_cents})`);
        return false;
    }
    return true;
}

function checkRTP(game) {
    const empirical = theoreticalRTP(game);
    const drift = Math.abs(empirical - game.rtp);
    if (drift > RTP_TOLERANCE) {
        fail(`${game.id}: RTP drift ${(drift*100).toFixed(4)}pp exceeds ${RTP_TOLERANCE*100}pp (theoretical ${(empirical*100).toFixed(4)}%, declared ${(game.rtp*100).toFixed(4)}%)`);
        return false;
    }
    pass(`${game.id}: RTP theoretical ${(empirical*100).toFixed(4)}% ≈ declared ${(game.rtp*100).toFixed(4)}%`);
    return true;
}

function checkEvaluatorIsPure(game) {
    // Same input → same output, twice.
    const stops = game.reels.map((reel) => ({ index: 0, symbol: reel[0] }));
    const a = game.evaluate(stops, 100);
    const b = game.evaluate(stops, 100);
    if (JSON.stringify(a) !== JSON.stringify(b)) {
        fail(`${game.id}: evaluate is not deterministic`);
        return false;
    }
    // Zero bet should not produce a negative or NaN win.
    const z = game.evaluate(stops, 0);
    if (!(z.win_cents >= 0 && Number.isFinite(z.win_cents))) {
        fail(`${game.id}: evaluate(stops, 0) returned non-finite or negative win_cents (${z.win_cents})`);
        return false;
    }
    pass(`${game.id}: evaluator is pure and well-behaved at bet=0`);
    return true;
}

function checkPipeline(game) {
    // Exercise the derive-floats → spin-reels → evaluate pipeline once.
    // We don't assert anything about the win amount (that's RTP's job) —
    // we just verify it doesn't throw and produces a valid shape.
    const seed = crypto.randomBytes(32).toString('hex');
    const stops = engine._internals.spinReels(game, seed, 'pipeline_test', 1);
    if (stops.length !== game.reels.length) {
        fail(`${game.id}: spinReels produced ${stops.length} stops, expected ${game.reels.length}`);
        return false;
    }
    for (const stop of stops) {
        if (typeof stop.symbol !== 'string' || stop.symbol.length === 0) {
            fail(`${game.id}: spinReels produced invalid stop: ${JSON.stringify(stop)}`);
            return false;
        }
    }
    const out = game.evaluate(stops, 100);
    if (typeof out.win_cents !== 'number' || !Number.isFinite(out.win_cents) || out.win_cents < 0) {
        fail(`${game.id}: evaluate produced invalid win_cents: ${out.win_cents}`);
        return false;
    }
    pass(`${game.id}: spinReels + evaluate pipeline produces well-formed output`);
    return true;
}

function main() {
    const ids = games.ids();
    if (ids.length === 0) {
        console.error('FAIL: no games registered');
        process.exit(1);
    }
    console.log(`Found ${ids.length} game(s): ${ids.join(', ')}`);
    console.log('');

    for (const id of ids) {
        const game = games.get(id);
        console.log(`[${id}]`);
        if (!checkShape(game)) continue;
        checkRTP(game);
        checkEvaluatorIsPure(game);
        checkPipeline(game);
        console.log('');
    }

    if (failures > 0) {
        console.error(`\n${failures} check(s) FAILED`);
        process.exit(1);
    }
    console.log(`All checks passed for ${ids.length} game(s).`);
    process.exit(0);
}

main();
