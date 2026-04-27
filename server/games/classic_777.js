'use strict';

/**
 * classic_777 — 3 reels × 1 payline (center row), reel length 10.
 *
 * Reel strip (one per reel, same composition on all three so RTP math
 * stays closed-form):
 *   cherry × 4, lemon × 2, orange × 2, bar × 1, seven × 1
 *
 * Paytable (multiplier × bet for 3-of-a-kind on the center row):
 *   cherry =   3x   →  4³  = 64  × 3   =  192
 *   lemon  =  10x   →  2³  =  8  × 10  =   80
 *   orange =  15x   →  2³  =  8  × 15  =  120
 *   bar    =  60x   →  1³  =  1  × 60  =   60
 *   seven  = 500x   →  1³  =  1  × 500 =  500
 *                                        ────
 *                                        952 / 1000 = 95.2% RTP
 *
 * No partial wins, no scatter, no wild — one payline, center row,
 * matching three. Small and verifiable.
 */

const REEL = [
    'cherry', 'cherry', 'cherry', 'cherry',
    'lemon', 'lemon',
    'orange', 'orange',
    'bar',
    'seven',
];

const PAYTABLE = Object.freeze({
    cherry: 3,
    lemon: 10,
    orange: 15,
    bar: 60,
    seven: 500,
});

const REELS = Object.freeze([REEL, REEL, REEL]);

/**
 * Per-game evaluator. Takes the resolved reel stops and bet, returns
 * `{ win_cents, line }`. Pure function — no I/O, no side effects, no
 * dependence on globals — so it's trivially unit-testable and the same
 * input always produces the same output.
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
    id: 'classic_777',
    name: 'Classic 777',
    reels: REELS,
    paytable: PAYTABLE,
    min_bet_cents: 10,      // $0.10
    max_bet_cents: 10000,   // $100
    rtp: 0.952,
    evaluate,
};
