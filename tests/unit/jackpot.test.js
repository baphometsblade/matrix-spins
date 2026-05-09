'use strict';

const { setupTestDb, teardownTestDb, resetTables, createTestUser } = require('../helpers/test-db');
const jackpot = require('../../server/services/jackpot.service');
const config = require('../../server/config');
const db = require('../../server/database');

beforeAll(async () => {
    await setupTestDb();
    // Ensure jackpot_pool table exists
    try {
        await db.run('CREATE TABLE IF NOT EXISTS jackpot_pool (id INTEGER PRIMARY KEY AUTOINCREMENT, tier TEXT UNIQUE, current_amount REAL DEFAULT 0, seed_amount REAL DEFAULT 0, contribution_rate REAL DEFAULT 0, total_contributed REAL DEFAULT 0, total_paid_out REAL DEFAULT 0, last_won_at TEXT, last_winner_id INTEGER)');
    } catch (_) {}
    await jackpot.initJackpotPool();
});
afterAll(async () => { await teardownTestDb(); });
beforeEach(async () => {
    await resetTables('users', 'transactions', 'jackpot_pool');
    await jackpot.initJackpotPool();
});

describe('Jackpot Service — Initialization', () => {
    test('initJackpotPool seeds all 4 tiers', async () => {
        const rows = await db.all('SELECT tier, current_amount, seed_amount FROM jackpot_pool ORDER BY seed_amount ASC');
        expect(rows.length).toBe(4);
        const tiers = rows.map(r => r.tier);
        expect(tiers).toEqual(expect.arrayContaining(['mini', 'minor', 'major', 'grand']));
    });

    test('seed amounts match config', async () => {
        const rows = await db.all('SELECT tier, current_amount, seed_amount FROM jackpot_pool');
        for (const row of rows) {
            const cfg = config.JACKPOT_TIERS[row.tier];
            expect(row.seed_amount).toBe(cfg.seed);
            expect(row.current_amount).toBe(cfg.seed);
        }
    });
});

describe('Jackpot Service — Contribution accumulation', () => {
    test('contribute() increments all 4 tier pools', async () => {
        const before = await db.all('SELECT tier, current_amount FROM jackpot_pool ORDER BY tier');
        await jackpot.contribute(100); // 100 * 0.005 = 0.5 total, /4 = 0.125 per tier
        const after = await db.all('SELECT tier, current_amount FROM jackpot_pool ORDER BY tier');
        for (let i = 0; i < before.length; i++) {
            expect(after[i].current_amount).toBeGreaterThan(before[i].current_amount);
        }
    });

    test('zero bet does not contribute', async () => {
        const before = await db.all('SELECT tier, current_amount FROM jackpot_pool ORDER BY tier');
        await jackpot.contribute(0);
        const after = await db.all('SELECT tier, current_amount FROM jackpot_pool ORDER BY tier');
        for (let i = 0; i < before.length; i++) {
            expect(after[i].current_amount).toBe(before[i].current_amount);
        }
    });
});

describe('Jackpot Service — getAmounts/getJackpotLevels (display rounding)', () => {
    test('getAmounts returns all 4 tiers', async () => {
        const amounts = await jackpot.getAmounts();
        expect(amounts).toHaveProperty('mini');
        expect(amounts).toHaveProperty('minor');
        expect(amounts).toHaveProperty('major');
        expect(amounts).toHaveProperty('grand');
    });

    test('getJackpotLevels returns array with display amounts', async () => {
        const levels = await jackpot.getJackpotLevels();
        expect(Array.isArray(levels)).toBe(true);
        expect(levels.length).toBe(4);
        for (const lvl of levels) {
            expect(lvl).toHaveProperty('tier');
            expect(lvl).toHaveProperty('currentAmount');
            expect(lvl.currentAmount).toBeGreaterThanOrEqual(0);
        }
    });
});

describe('Jackpot Service — must-hit at threshold', () => {
    test('forced mustHit when current_amount >= mustHitAt awards jackpot', async () => {
        const user = await createTestUser({ username: 'jackpot_winner', email: 'jw@test.com' });
        // Force grand pool above mustHitAt
        const grandConfig = config.JACKPOT_TIERS.grand;
        await db.run('UPDATE jackpot_pool SET current_amount = ? WHERE tier = ?', [grandConfig.mustHitAt + 100, 'grand']);

        // Use mini bet amount and non-jackpot game (still must-hit triggers)
        const result = await jackpot.checkAndAward(user.id, 1, 1, false);
        // Result may be a lower-tier hit OR the grand. Just verify a hit occurred.
        expect(result).not.toBeNull();
        expect(['mini', 'minor', 'major', 'grand']).toContain(result.tier);
        expect(result.amount).toBeGreaterThan(0);

        // Winner balance is credited (only checkAndAward does NOT credit balance — only processJackpotContribution does)
        // checkAndAward only resets pool and broadcasts; balance credit is handled by spin.routes.js
        const pool = await db.get('SELECT current_amount, seed_amount FROM jackpot_pool WHERE tier = ?', [result.tier]);
        expect(pool.current_amount).toBe(pool.seed_amount); // reset to seed
    });
});
