'use strict';

const games = require('../../shared/game-definitions');

describe('Game Definitions — Validity', () => {
    test('exactly 100 games are loaded', () => {
        expect(Array.isArray(games)).toBe(true);
        expect(games.length).toBe(100);
    });

    test('every game has a unique id', () => {
        const ids = games.map(g => g.id);
        const uniq = new Set(ids);
        expect(uniq.size).toBe(games.length);
    });

    test('every game has the required core fields', () => {
        for (const g of games) {
            expect(g).toHaveProperty('id');
            expect(g).toHaveProperty('name');
            expect(g).toHaveProperty('provider');
            expect(g).toHaveProperty('symbols');
            expect(g).toHaveProperty('rtp');
            expect(g).toHaveProperty('volatility');
            expect(Array.isArray(g.symbols)).toBe(true);
            expect(g.symbols.length).toBeGreaterThan(0);
        }
    });

    test('every game has wildSymbol that exists in symbols', () => {
        for (const g of games) {
            if (g.wildSymbol) {
                expect(g.symbols).toContain(g.wildSymbol);
            }
        }
    });

    test('every game has scatterSymbol that exists in symbols (or equals wild)', () => {
        for (const g of games) {
            if (g.scatterSymbol) {
                expect(g.symbols).toContain(g.scatterSymbol);
            }
        }
    });

    test('rtp values are in valid percentage range (60-100)', () => {
        for (const g of games) {
            expect(g.rtp).toBeGreaterThan(60);
            expect(g.rtp).toBeLessThanOrEqual(100);
        }
    });

    test('every game has minBet < maxBet, both positive', () => {
        for (const g of games) {
            expect(g.minBet).toBeGreaterThan(0);
            expect(g.maxBet).toBeGreaterThan(g.minBet);
        }
    });

    test('grid dimensions are positive', () => {
        for (const g of games) {
            const cols = g.gridCols || 3;
            const rows = g.gridRows || 1;
            expect(cols).toBeGreaterThan(0);
            expect(rows).toBeGreaterThan(0);
        }
    });

    test('all 8 fictional studios are represented', () => {
        const expected = [
            'Golden Reels Studio', 'Nebula Gaming', 'Mythic Forge',
            'Wild Frontier Games', 'Shadow Works', 'Dragon Pearl Studios',
            'Ironclad Entertainment', 'Cascade Labs',
        ];
        const providers = new Set(games.map(g => g.provider));
        for (const p of expected) {
            expect(providers).toContain(p);
        }
    });

    test('every game has a payouts object', () => {
        for (const g of games) {
            expect(g).toHaveProperty('payouts');
            expect(typeof g.payouts).toBe('object');
        }
    });

    test('winType is one of classic/payline/cluster (or default classic)', () => {
        for (const g of games) {
            const wt = g.winType || 'classic';
            expect(['classic', 'payline', 'cluster']).toContain(wt);
        }
    });
});
