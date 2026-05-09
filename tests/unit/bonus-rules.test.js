'use strict';

const { setupTestDb, teardownTestDb, resetTables, createTestUser } = require('../helpers/test-db');
const bonusRules = require('../../server/services/bonus-rules.service');
const db = require('../../server/database');

beforeAll(async () => {
    await setupTestDb();
    // Ensure deposits table exists
    await db.run(`CREATE TABLE IF NOT EXISTS deposits (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER, amount REAL, status TEXT,
        created_at TEXT DEFAULT (datetime('now'))
    )`).catch(() => {});
});
afterAll(async () => { await teardownTestDb(); });
beforeEach(async () => {
    await resetTables('users', 'spins', 'deposits');
});

describe('Bonus Rules — getPersonalizedOffers', () => {
    test('returns at least one offer (fallback) for empty user', async () => {
        const user = await createTestUser({ username: 'br1', email: 'br1@test.com' });
        const offers = await bonusRules.getPersonalizedOffers(user.id);
        expect(Array.isArray(offers)).toBe(true);
        expect(offers.length).toBeGreaterThan(0);
        expect(offers.length).toBeLessThanOrEqual(3);
    });

    test('first-deposit offer for new user without deposits', async () => {
        const user = await createTestUser({ username: 'br2', email: 'br2@test.com' });
        const offers = await bonusRules.getPersonalizedOffers(user.id);
        const fd = offers.find(o => o.type === 'first_deposit');
        expect(fd).toBeDefined();
    });

    test('returns empty-safe array for non-existent user', async () => {
        const offers = await bonusRules.getPersonalizedOffers(999999);
        expect(Array.isArray(offers)).toBe(true);
    });

    test('offers are sorted by priority descending', async () => {
        const user = await createTestUser({ username: 'br3', email: 'br3@test.com' });
        const offers = await bonusRules.getPersonalizedOffers(user.id);
        for (let i = 1; i < offers.length; i++) {
            expect(offers[i - 1].priority).toBeGreaterThanOrEqual(offers[i].priority);
        }
    });
});
