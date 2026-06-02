'use strict';

const engine = require('../../server/services/game-engine');
const { setupTestDb, teardownTestDb } = require('../helpers/test-db');

beforeAll(async () => { await setupTestDb(); });
afterAll(async () => { await teardownTestDb(); });

// Build a deterministic 3x3 grid in column-major form expected by the engine
function gridFromRows(rowsOfSymbols) {
    const cols = rowsOfSymbols[0].length;
    const rows = rowsOfSymbols.length;
    const g = Array.from({ length: cols }, () => Array(rows).fill(null));
    for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
            g[c][r] = rowsOfSymbols[r][c];
        }
    }
    return g;
}

const classicGame = {
    id: 'test_classic',
    symbols: ['s1', 's2', 's3', 's4', 's5', 'wild'],
    wildSymbol: 'wild',
    scatterSymbol: 's5',
    gridCols: 3,
    gridRows: 1,
    winType: 'classic',
};

const paylineGame = {
    id: 'test_payline',
    symbols: ['s1', 's2', 's3', 's4', 's5', 'wild'],
    wildSymbol: 'wild',
    scatterSymbol: 's5',
    gridCols: 5,
    gridRows: 3,
    winType: 'payline',
};

const clusterGame = {
    id: 'test_cluster',
    symbols: ['s1', 's2', 's3', 's4', 's5', 'wild'],
    wildSymbol: 'wild',
    scatterSymbol: 's5',
    gridCols: 5,
    gridRows: 5,
    winType: 'cluster',
    clusterMin: 5,
};

describe('Game Engine — Classic detection', () => {
    test('triple match across 3 reels is detected', () => {
        const grid = gridFromRows([['s1', 's1', 's1']]);
        const result = engine.checkClassicWins(grid, classicGame);
        expect(result).not.toBeNull();
        expect(result.type).toBe('triple');
        expect(result.symbol).toBe('s1');
        expect(result.hasWild).toBe(false);
    });

    test('triple with wild substitution is detected as triple', () => {
        const grid = gridFromRows([['s1', 'wild', 's1']]);
        const result = engine.checkClassicWins(grid, classicGame);
        expect(result).not.toBeNull();
        expect(result.type).toBe('triple');
        expect(result.symbol).toBe('s1');
        expect(result.hasWild).toBe(true);
    });

    test('all-wilds is detected as triple with allWilds flag', () => {
        const grid = gridFromRows([['wild', 'wild', 'wild']]);
        const result = engine.checkClassicWins(grid, classicGame);
        expect(result).not.toBeNull();
        expect(result.type).toBe('triple');
        expect(result.allWilds).toBe(true);
    });

    test('double match returns type=double', () => {
        const grid = gridFromRows([['s1', 's1', 's2']]);
        const result = engine.checkClassicWins(grid, classicGame);
        expect(result).not.toBeNull();
        expect(result.type).toBe('double');
    });

    test('no match returns null', () => {
        const grid = gridFromRows([['s1', 's2', 's3']]);
        const result = engine.checkClassicWins(grid, classicGame);
        expect(result).toBeNull();
    });
});

describe('Game Engine — Payline detection', () => {
    test('5-of-a-kind on top payline returns matchCount 5', () => {
        const grid = gridFromRows([
            ['s2', 's2', 's2', 's2', 's2'],
            ['s4', 's3', 's4', 's3', 's4'],
            ['s4', 's3', 's4', 's3', 's4'],
        ]);
        const wins = engine.checkPaylineWins(grid, paylineGame);
        const fiveOfKindS2 = wins.find(w => w.matchCount === 5 && w.symbol === 's2');
        expect(fiveOfKindS2).toBeDefined();
        // Winning cells must be [col,row] pairs so the client can highlight the
        // paying symbols (surfaced via winDetails.cells → engine highlight).
        // Regression guard for the win-highlight pipeline added 2026-06-03.
        expect(Array.isArray(fiveOfKindS2.cells)).toBe(true);
        expect(fiveOfKindS2.cells).toHaveLength(5);
        fiveOfKindS2.cells.forEach(([col, row]) => {
            expect(Number.isInteger(col)).toBe(true);
            expect(Number.isInteger(row)).toBe(true);
        });
        // top payline → all five cells on row 0, reels 0..4
        expect(fiveOfKindS2.cells).toEqual([[0, 0], [1, 0], [2, 0], [3, 0], [4, 0]]);
    });

    test('3-of-a-kind on middle payline (line 0)', () => {
        const grid = gridFromRows([
            ['x',  'x',  'x',  'x',  'x'],
            ['s3', 's3', 's3', 'y',  'z'],
            ['x',  'x',  'x',  'x',  'x'],
        ]);
        const wins = engine.checkPaylineWins(grid, paylineGame);
        const threeOfKind = wins.find(w => w.matchCount === 3 && w.symbol === 's3');
        expect(threeOfKind).toBeDefined();
    });

    test('wild substitutes in payline', () => {
        const grid = gridFromRows([
            ['x',  'x',  'x',  'x',  'x'],
            ['s4', 'wild', 's4', 'y',  'z'],
            ['x',  'x',  'x',  'x',  'x'],
        ]);
        const wins = engine.checkPaylineWins(grid, paylineGame);
        const wildWin = wins.find(w => w.symbol === 's4' && w.matchCount === 3);
        expect(wildWin).toBeDefined();
        expect(wildWin.hasWild).toBe(true);
    });
});

describe('Game Engine — Cluster detection', () => {
    test('5+ adjacent same-symbol cluster is detected', () => {
        const grid = gridFromRows([
            ['s1', 's1', 's1', 'x',  'x'],
            ['s1', 's1', 'x',  'x',  'x'],
            ['x',  'x',  'x',  'x',  'x'],
            ['x',  'x',  'x',  'x',  'x'],
            ['x',  'x',  'x',  'x',  'x'],
        ]);
        const clusters = engine.findClusters(grid, clusterGame);
        const big = clusters.find(c => c.symbol === 's1');
        expect(big).toBeDefined();
        expect(big.size).toBeGreaterThanOrEqual(5);
    });

    test('cluster smaller than clusterMin is NOT returned', () => {
        const grid = gridFromRows([
            ['s1', 's1', 'x',  'x',  'x'],
            ['x',  'x',  'x',  'x',  'x'],
            ['x',  'x',  'x',  'x',  'x'],
            ['x',  'x',  'x',  'x',  'x'],
            ['x',  'x',  'x',  'x',  'x'],
        ]);
        const clusters = engine.findClusters(grid, clusterGame);
        expect(clusters.find(c => c.symbol === 's1')).toBeUndefined();
    });

    test('wilds connect clusters (wild as bridge)', () => {
        const grid = gridFromRows([
            ['s1', 'wild', 's1', 's1', 's1'],
            ['x',  'x',    'x',  'x',  'x'],
            ['x',  'x',    'x',  'x',  'x'],
            ['x',  'x',    'x',  'x',  'x'],
            ['x',  'x',    'x',  'x',  'x'],
        ]);
        const clusters = engine.findClusters(grid, clusterGame);
        const big = clusters.find(c => c.symbol === 's1');
        expect(big).toBeDefined();
        expect(big.size).toBe(5);
    });
});

describe('Game Engine — resolveSpin (full integration)', () => {
    test('rejects invalid bet amount', async () => {
        await expect(engine.resolveSpin(classicGame, 0.10, null)).rejects.toThrow(); // below MIN_BET
        await expect(engine.resolveSpin(classicGame, -5, null)).rejects.toThrow();
        await expect(engine.resolveSpin(classicGame, NaN, null)).rejects.toThrow();
    });

    test('rejects bet above MAX_BET', async () => {
        await expect(engine.resolveSpin(classicGame, 1000000, null)).rejects.toThrow();
    });

    test('rejects invalid game definition', async () => {
        await expect(engine.resolveSpin(null, 1, null)).rejects.toThrow();
        await expect(engine.resolveSpin({ id: 'x' }, 1, null)).rejects.toThrow();
    });

    test('returns valid result shape on a normal spin', async () => {
        const result = await engine.resolveSpin(classicGame, 1, null);
        expect(result).toHaveProperty('grid');
        expect(result).toHaveProperty('winAmount');
        expect(result).toHaveProperty('winDetails');
        expect(result).toHaveProperty('seed');
        expect(result).toHaveProperty('freeSpinState');
        expect(result.winAmount).toBeGreaterThanOrEqual(0);
    });

    test('grid dimensions match game definition', async () => {
        const result = await engine.resolveSpin(paylineGame, 1, null);
        expect(result.grid.length).toBe(5); // cols
        expect(result.grid[0].length).toBe(3); // rows
    });

    test('100 spins all produce valid results within max-win cap', async () => {
        const config = require('../../server/config');
        const maxWin = 1 * config.MAX_WIN_MULTIPLIER;
        for (let i = 0; i < 100; i++) {
            const result = await engine.resolveSpin(classicGame, 1, null);
            expect(result.winAmount).toBeGreaterThanOrEqual(0);
            // Max win cap enforced by house-edge layer
            expect(result.winAmount).toBeLessThanOrEqual(maxWin * 2); // 2x for free spins
        }
    });
});

describe('Game Engine — RTP statistical bound (1000 spins)', () => {
    test('classic game RTP stays in plausible range over 1000 spins', async () => {
        let totalBet = 0;
        let totalWin = 0;
        const N = 1000;
        for (let i = 0; i < N; i++) {
            const result = await engine.resolveSpin(classicGame, 1, null);
            totalBet += 1;
            totalWin += result.winAmount;
        }
        const rtp = totalWin / totalBet;
        // Expect RTP < 1.5 (plausible upper bound; real target is ~0.86)
        expect(rtp).toBeLessThan(1.5);
        // Should produce SOME winnings
        expect(totalWin).toBeGreaterThan(0);
    }, 60000);
});
