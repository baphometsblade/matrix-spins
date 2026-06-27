'use strict';

/**
 * Scratch Cards outcome integrity + RTP.
 * Pure-function tests (no DB) on the sealed-outcome generator.
 */

const { WIN_TABLE, computeOutcome } = require('../../server/routes/scratch-cards.routes')._test;
const crypto = require('crypto');

function seed() { return crypto.randomBytes(16).toString('hex'); }

describe('Scratch Cards — paytable', () => {
    test('expected return per ticket is ~0.80 (house edge protected)', () => {
        const ev = WIN_TABLE.reduce((s, w) => s + w.multiplier * w.prob, 0);
        expect(ev).toBeGreaterThan(0.78);
        expect(ev).toBeLessThan(0.82);
    });

    test('total win probability is < 1 (most cards lose)', () => {
        const p = WIN_TABLE.reduce((s, w) => s + w.prob, 0);
        expect(p).toBeGreaterThan(0);
        expect(p).toBeLessThan(0.25);
    });
});

describe('Scratch Cards — outcome generation', () => {
    test('is deterministic for a given seed', () => {
        const s = seed();
        const a = computeOutcome(s);
        const b = computeOutcome(s);
        expect(a.grid).toEqual(b.grid);
        expect(a.winSymbol).toBe(b.winSymbol);
        expect(a.multiplier).toBe(b.multiplier);
    });

    test('grids are always 9 cells', () => {
        for (let i = 0; i < 50; i++) {
            expect(computeOutcome(seed()).grid.length).toBe(9);
        }
    });

    test('winning grids contain exactly three of the winning symbol and no other triple', () => {
        let wins = 0;
        for (let i = 0; i < 3000 && wins < 200; i++) {
            const o = computeOutcome(seed());
            if (!o.winSymbol) continue;
            wins++;
            const counts = {};
            o.grid.forEach(s => { counts[s] = (counts[s] || 0) + 1; });
            expect(counts[o.winSymbol]).toBe(3);
            // No OTHER symbol may also reach 3 (would be an ambiguous double win).
            Object.keys(counts).forEach(sym => {
                if (sym !== o.winSymbol) expect(counts[sym]).toBeLessThan(3);
            });
            // Declared multiplier matches the paytable for that symbol.
            const def = WIN_TABLE.find(w => w.symbol === o.winSymbol);
            expect(o.multiplier).toBe(def.multiplier);
        }
        expect(wins).toBeGreaterThan(0);
    });

    test('losing grids never contain any triple', () => {
        let losses = 0;
        for (let i = 0; i < 500 && losses < 200; i++) {
            const o = computeOutcome(seed());
            if (o.winSymbol) continue;
            losses++;
            const counts = {};
            o.grid.forEach(s => { counts[s] = (counts[s] || 0) + 1; });
            Object.values(counts).forEach(c => expect(c).toBeLessThan(3));
            expect(o.multiplier).toBe(0);
        }
        expect(losses).toBeGreaterThan(0);
    });

    test('empirical RTP over many cards stays near 0.80', () => {
        const N = 60000;
        let totalMult = 0;
        for (let i = 0; i < N; i++) totalMult += computeOutcome(seed()).multiplier;
        const rtp = totalMult / N;
        // Wide band — variance is dominated by the rare 100x symbol.
        expect(rtp).toBeGreaterThan(0.6);
        expect(rtp).toBeLessThan(1.0);
    });
});
