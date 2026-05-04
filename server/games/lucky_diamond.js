'use strict';

/**
 * lucky_diamond — 5 reels × reel-length-12, single payline (5-of-a-kind
 * on the center row). Reel composition is identical on every reel so
 * RTP math is closed-form: P(5-of-a-kind for symbol with count c) =
 * (c/12)^5, contribution = pay × c^5 / 12^5.
 *
 * Counts: cherry=4, plum=3, bell=2, ruby=2, diamond=1 (sum 12).
 *
 * Theoretical RTP (sum of pay × c^5, divided by 12^5 = 248832):
 *   cherry    50 × 1024 =  51200
 *   plum     200 ×  243 =  48600
 *   bell    1500 ×   32 =  48000
 *   ruby    2000 ×   32 =  64000
 *   diamond 25000 ×   1 =  25000
 *   total              = 236800 / 248832 = 0.951646 → 95.16% RTP
 *
 * The shape mirrors classic_777 and neon_burst — single payline, 5-of-
 * a-kind only, no scatter, no wild — so it stays auditable against the
 * same closed-form check that test-slots.js applies. The math runs at a
 * different reel length (12 vs 10/15) and a different paytable, so the
 * volatility profile lands between classic_777's high-frequency low-pay
 * fruit machine and neon_burst's lottery-style nova jackpot. The ruby
 * pay (2000× at 1/(7776) ≈ 1 in 7776 spins) gives the game its
 * signature "decent hit every few thousand spins" rhythm.
 */

const REEL = [
    'cherry', 'cherry', 'cherry', 'cherry',
    'plum', 'plum', 'plum',
    'bell', 'bell',
    'ruby', 'ruby',
    'diamond',
];

const PAYTABLE = Object.freeze({
    cherry: 50,
    plum: 200,
    bell: 1500,
    ruby: 2000,
    diamond: 25000,
});

const REELS = Object.freeze([REEL, REEL, REEL, REEL, REEL]);

/**
 * Per-game evaluator. Same shape as classic_777 / neon_burst, kept
 * deliberately separate so a future lucky_diamond tweak (a scatter
 * pay, a stacked wild, a second payline) can land here without
 * touching any other game.
 */
function evaluate(stops, betCents) {
    const symbols = stops.map((s) => s.symbol);
    const first = symbols[0];
    const allMatch = symbols.every((s) => s === first);
    if (!allMatch) return { win_cents: 0, line: null };
    const multiplier = Number(PAYTABLE[first] || 0);
    const win = Math.round(multiplier * betCents);
    return { win_cents: win, line: { symbols, multiplier } };
}

module.exports = {
    id: 'lucky_diamond',
    name: 'Lucky Diamond',
    reels: REELS,
    paytable: PAYTABLE,
    min_bet_cents: 10,
    max_bet_cents: 10000,
    rtp: 0.9516,
    evaluate,
};
