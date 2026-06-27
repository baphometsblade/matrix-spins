'use strict';

/**
 * Mines — multiplier ladder + provably-fair mine placement (pure functions).
 */

const { multiplierFor, multiplierTable, minePositions, GRID, MINES_RTP, MAX_MULT } =
    require('../../server/routes/mines.routes')._test;
const crypto = require('crypto');

describe('Mines — multiplier ladder', () => {
    test('first safe tile multiplier = RTP * 25/(25-mines)', () => {
        for (let m = 1; m <= 24; m++) {
            const expected = Math.round(MINES_RTP * (GRID / (GRID - m)) * 10000) / 10000;
            expect(multiplierFor(m, 1)).toBeCloseTo(expected, 4);
        }
    });

    test('first-tile multiplier strictly increases with more mines', () => {
        for (let m = 1; m < 24; m++) {
            expect(multiplierFor(m + 1, 1)).toBeGreaterThan(multiplierFor(m, 1));
        }
    });

    test('more mines => higher multiplier for the same (valid) reveal count', () => {
        for (let k = 1; k <= 3; k++) {
            for (let m = 1; m < 24; m++) {
                if (k > GRID - (m + 1)) continue; // keep k valid for both
                expect(multiplierFor(m + 1, k)).toBeGreaterThanOrEqual(multiplierFor(m, k));
            }
        }
    });

    test('multiplier increases as more tiles are revealed (until the cap)', () => {
        const m = 5;
        const max = GRID - m;
        for (let k = 1; k < max; k++) {
            const a = multiplierFor(m, k), b = multiplierFor(m, k + 1);
            expect(b).toBeGreaterThanOrEqual(a);
            if (b < MAX_MULT) expect(b).toBeGreaterThan(a);
        }
    });

    test('multiplier never exceeds the configured cap', () => {
        for (let m = 1; m <= 24; m++) {
            multiplierTable(m).forEach(x => expect(x).toBeLessThanOrEqual(MAX_MULT));
        }
    });

    test('ladder length equals the number of safe tiles', () => {
        for (let m = 1; m <= 24; m++) {
            expect(multiplierTable(m).length).toBe(GRID - m);
        }
    });
});

describe('Mines — provably-fair placement', () => {
    test('positions are deterministic for a given seed', () => {
        const s = crypto.randomBytes(16).toString('hex');
        expect(minePositions(s, 5)).toEqual(minePositions(s, 5));
    });

    test('produces the right count, unique, in-range', () => {
        for (let m = 1; m <= 24; m++) {
            const s = crypto.randomBytes(16).toString('hex');
            const pos = minePositions(s, m);
            expect(pos.length).toBe(m);
            expect(new Set(pos).size).toBe(m);
            pos.forEach(p => { expect(p).toBeGreaterThanOrEqual(0); expect(p).toBeLessThan(GRID); });
        }
    });

    test('different seeds generally yield different layouts', () => {
        const a = minePositions(crypto.randomBytes(16).toString('hex'), 5).join(',');
        const b = minePositions(crypto.randomBytes(16).toString('hex'), 5).join(',');
        // Not a hard guarantee, but collision is astronomically unlikely.
        expect(a === b).toBe(false);
    });
});
