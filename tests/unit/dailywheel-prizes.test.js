'use strict';

/**
 * Daily Wheel — 12-segment prize set + day-7 guaranteed-premium selection.
 */

const { WHEEL_PRIZES, DAY7_POOL, selectPrizeIndex, publicPrizes } =
    require('../../server/routes/dailywheel.routes')._test;

describe('Daily Wheel — prize set', () => {
    test('has exactly 12 segments', () => {
        expect(WHEEL_PRIZES.length).toBe(12);
    });

    test('every segment has a valid kind', () => {
        WHEEL_PRIZES.forEach(p => {
            expect(['cash', 'free_spins', 'deposit_bonus']).toContain(p.kind);
            expect(p.label).toBeTruthy();
            expect(p.emoji).toBeTruthy();
            expect(p.weight).toBeGreaterThan(0);
        });
    });

    test('includes the required special prizes (free spins + 10% deposit bonus)', () => {
        const fs = WHEEL_PRIZES.filter(p => p.kind === 'free_spins');
        const dep = WHEEL_PRIZES.filter(p => p.kind === 'deposit_bonus');
        expect(fs.length).toBe(1);
        expect(fs[0].value).toBe(5);
        expect(dep.length).toBe(1);
        expect(dep[0].percent).toBe(10);
    });

    test('includes the rare $10 and ultra-rare $50 cash prizes', () => {
        const amounts = WHEEL_PRIZES.filter(p => p.kind === 'cash').map(p => p.amount);
        expect(amounts).toContain(10);
        expect(amounts).toContain(50);
        // The big prizes must be the rarest.
        const c50 = WHEEL_PRIZES.find(p => p.amount === 50);
        const c010 = WHEEL_PRIZES.find(p => p.amount === 0.10);
        expect(c50.weight).toBeLessThan(c010.weight);
    });

    test('publicPrizes exposes index + shape for the client wheel', () => {
        const pub = publicPrizes();
        expect(pub.length).toBe(12);
        pub.forEach((p, i) => {
            expect(p.index).toBe(i);
            expect(p).toHaveProperty('kind');
            expect(p).toHaveProperty('label');
            expect(p).toHaveProperty('color');
        });
    });
});

describe('Daily Wheel — selection', () => {
    test('normal spins return a valid segment index', () => {
        for (let i = 0; i < 2000; i++) {
            const idx = selectPrizeIndex(false);
            expect(idx).toBeGreaterThanOrEqual(0);
            expect(idx).toBeLessThan(12);
        }
    });

    test('day-7 spins only draw from the premium pool', () => {
        const premium = new Set(DAY7_POOL.map(p => p.index));
        for (let i = 0; i < 3000; i++) {
            expect(premium.has(selectPrizeIndex(true))).toBe(true);
        }
    });

    test('day-7 premium pool never includes sub-dollar cash', () => {
        DAY7_POOL.forEach(({ index }) => {
            const p = WHEEL_PRIZES[index];
            if (p.kind === 'cash') expect(p.amount).toBeGreaterThanOrEqual(5);
        });
    });
});
