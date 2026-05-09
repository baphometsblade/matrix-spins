'use strict';

const rng = require('../../server/services/rng.service');

describe('RNG Service', () => {
    test('randomInt returns integer in [0, max)', () => {
        for (let i = 0; i < 1000; i++) {
            const v = rng.randomInt(10);
            expect(Number.isInteger(v)).toBe(true);
            expect(v).toBeGreaterThanOrEqual(0);
            expect(v).toBeLessThan(10);
        }
    });

    test('randomFloat returns float in [0, 1)', () => {
        for (let i = 0; i < 1000; i++) {
            const v = rng.randomFloat();
            expect(typeof v).toBe('number');
            expect(v).toBeGreaterThanOrEqual(0);
            expect(v).toBeLessThan(1);
        }
    });

    test('pickRandom returns an element from the array', () => {
        const arr = ['a', 'b', 'c', 'd'];
        for (let i = 0; i < 100; i++) {
            const v = rng.pickRandom(arr);
            expect(arr).toContain(v);
        }
    });

    test('pickWeighted respects weights — heavy bias produces near-100% picks', () => {
        const arr = ['a', 'b'];
        const weights = [99, 1];
        let aCount = 0;
        for (let i = 0; i < 1000; i++) {
            if (rng.pickWeighted(arr, weights) === 'a') aCount++;
        }
        // 99% weight should yield >= 90% in 1000 trials (CLT)
        expect(aCount).toBeGreaterThan(900);
    });

    test('pickWeighted returns a valid element (no off-by-one)', () => {
        const arr = ['x', 'y', 'z'];
        for (let i = 0; i < 1000; i++) {
            const v = rng.pickWeighted(arr, [1, 1, 1]);
            expect(arr).toContain(v);
        }
    });

    test('generateSeed returns a 32-char hex string', () => {
        const seed = rng.generateSeed();
        expect(typeof seed).toBe('string');
        expect(seed).toMatch(/^[a-f0-9]{32}$/);
    });

    test('two seeds in a row are not equal (entropy check)', () => {
        const s1 = rng.generateSeed();
        const s2 = rng.generateSeed();
        expect(s1).not.toBe(s2);
    });

    test('random() alias works as drop-in for Math.random', () => {
        expect(typeof rng.random).toBe('function');
        expect(rng.random()).toBeGreaterThanOrEqual(0);
        expect(rng.random()).toBeLessThan(1);
    });
});
