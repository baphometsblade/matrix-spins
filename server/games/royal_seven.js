'use strict';

/**
 * royal_seven — 3 reels × reel-length-12, single payline (3-of-a-kind
 * on the center row). Reel composition is identical on every reel so
 * RTP math is closed-form: P(3-of-a-kind for symbol with count c) =
 * (c/12)^3, contribution = pay × c^3 / 12^3.
 *
 * Counts: cherry=4, lemon=3, plum=2, bell=1, crown=1, seven=1 (sum 12).
 *
 * Theoretical RTP (sum of pay × c^3, divided by 12^3 = 1728):
 *   cherry  5 × 64 =  320
 *   lemon  12 × 27 =  324
 *   plum   40 ×  8 =  320
 *   bell   80 ×  1 =   80
 *   crown 200 ×  1 =  200
 *   seven 400 ×  1 =  400
 *   total          = 1644 / 1728 = 0.951389 → 95.14% RTP
 *
 * Volatility profile:
 *   - Sits between classic_777 (3 reels × 10) and lucky_diamond
 *     (5 reels × 12). The 3-reel layout gives a fast hit rhythm
 *     (~5.6% any-3-of-a-kind hit), the longer 12-strip stretches
 *     the rare top-pay tail, and the seven (1/12)^3 ≈ 1 in 1,728
 *     for the 400× jackpot keeps the chase real without burning
 *     bankroll the way a 5-reel 25,000× top pay does.
 *
 * Same shape as the other three live games — single payline,
 * N-of-a-kind only, no scatter, no wild — so test-slots.js's
 * closed-form RTP regression applies without modification.
 */

const REEL = [
    'cherry', 'cherry', 'cherry', 'cherry',
    'lemon', 'lemon', 'lemon',
    'plum', 'plum',
    'bell',
    'crown',
    'seven',
];

const PAYTABLE = Object.freeze({
    cherry: 5,
    lemon: 12,
    plum: 40,
    bell: 80,
    crown: 200,
    seven: 400,
});

const REELS = Object.freeze([REEL, REEL, REEL]);

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
    id: 'royal_seven',
    name: 'Royal Seven',
    reels: REELS,
    paytable: PAYTABLE,
    min_bet_cents: 10,
    max_bet_cents: 10000,
    rtp: 0.9514,
    evaluate,
};
