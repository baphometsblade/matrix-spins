'use strict';

/**
 * neon_burst — 5 reels × reel-length-15, single payline (5-of-a-kind on
 * the center row). Reel composition is identical on each reel so RTP
 * math is closed-form: P(5-of-a-kind for symbol with count c) = (c/15)^5,
 * contribution = pay × c^5 / 15^5.
 *
 * Counts: neon=5, pulse=4, star=3, comet=2, nova=1 (sum 15).
 *
 * Theoretical RTP (sum of pay × c^5, divided by 15^5 = 759375):
 *   neon    40 × 3125 = 125000
 *   pulse  100 × 1024 = 102400
 *   star   800 ×  243 = 194400
 *   comet 6000 ×   32 = 192000
 *   nova 110000 ×   1 = 110000
 *   total            723800 / 759375 = 0.95315 → 95.32% RTP
 *
 * Earlier draft used pays of [0.4, 1, 8, 60, 1100] and read
 * 7238/759375 as "95.32% RTP" — that ratio is actually 0.95% and would
 * have shipped a sub-1%-RTP game while advertising 95.32%. Scaling
 * each payout by 100 fixes the math without changing the symbol mix
 * or the volatility profile — the relative payouts (and the rare
 * nova-line jackpot feel) are preserved.
 */

const REEL = [
    'neon', 'neon', 'neon', 'neon', 'neon',
    'pulse', 'pulse', 'pulse', 'pulse',
    'star', 'star', 'star',
    'comet', 'comet',
    'nova',
];

const PAYTABLE = Object.freeze({
    neon: 40,
    pulse: 100,
    star: 800,
    comet: 6000,
    nova: 110000,
});

const REELS = Object.freeze([REEL, REEL, REEL, REEL, REEL]);

/**
 * Per-game evaluator. Takes the resolved reel stops and bet, returns
 * `{ win_cents, line }`. Pure function — same shape as classic_777 but
 * deliberately separate so a future neon_burst tweak (wilds, scatter
 * pays, alternate paylines) can land here without touching any other
 * game.
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
    id: 'neon_burst',
    name: 'Neon Burst',
    reels: REELS,
    paytable: PAYTABLE,
    min_bet_cents: 10,
    max_bet_cents: 10000,
    rtp: 0.9532,
    evaluate,
};
