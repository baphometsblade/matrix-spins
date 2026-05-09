'use strict';

const { setupTestDb, teardownTestDb, resetTables, createTestUser } = require('../helpers/test-db');
const ach = require('../../server/services/achievement.service');
const db = require('../../server/database');

beforeAll(async () => {
    await setupTestDb();
    // user_achievements table needed
    try {
        await db.run('CREATE TABLE IF NOT EXISTS user_achievements (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, achievement_id TEXT, unlocked_at TEXT DEFAULT (datetime(\'now\')), UNIQUE(user_id, achievement_id))');
    } catch (_) {}
});
afterAll(async () => { await teardownTestDb(); });
beforeEach(async () => {
    await resetTables('users', 'user_achievements', 'notifications', 'spins', 'deposits');
});

describe('Achievement Service — Definitions', () => {
    test('all achievement IDs are valid', () => {
        const defs = ach.getAllDefinitions();
        expect(Array.isArray(defs)).toBe(true);
        expect(defs.length).toBeGreaterThan(30);
        for (const d of defs) {
            expect(d).toHaveProperty('id');
            expect(d).toHaveProperty('name');
            expect(d).toHaveProperty('xp');
            expect(d).toHaveProperty('points');
            expect(d).toHaveProperty('category');
            expect(['betting', 'games', 'social', 'loyalty']).toContain(d.category);
        }
    });

    test('first_spin definition exists with correct shape', () => {
        const a = ach.ACHIEVEMENTS.first_spin;
        expect(a).toBeDefined();
        expect(a.xp).toBe(50);
        expect(a.points).toBe(10);
    });
});

describe('Achievement Service — grant()', () => {
    test('granting an unknown achievement returns null', async () => {
        const user = await createTestUser({ username: 'a1', email: 'a1@test.com' });
        const result = await ach.grant(user.id, 'no_such_achievement');
        expect(result).toBeNull();
    });

    test('granting a valid achievement returns newlyUnlocked: true', async () => {
        const user = await createTestUser({ username: 'a2', email: 'a2@test.com' });
        const result = await ach.grant(user.id, 'first_spin');
        expect(result).not.toBeNull();
        expect(result.newlyUnlocked).toBe(true);
        expect(result.id).toBe('first_spin');
    });

    test('granting twice is idempotent — second call returns null', async () => {
        const user = await createTestUser({ username: 'a3', email: 'a3@test.com' });
        const r1 = await ach.grant(user.id, 'first_spin');
        const r2 = await ach.grant(user.id, 'first_spin');
        expect(r1).not.toBeNull();
        expect(r2).toBeNull();
    });

    test('granting credits achievement_points and vip_xp', async () => {
        const user = await createTestUser({ username: 'a4', email: 'a4@test.com' });
        await ach.grant(user.id, 'first_spin');
        const row = await db.get('SELECT achievement_points, vip_xp FROM users WHERE id = ?', [user.id]);
        expect(row.achievement_points).toBeGreaterThanOrEqual(10);
        expect(row.vip_xp).toBeGreaterThanOrEqual(50);
    });
});

describe('Achievement Service — checkSpinAchievements', () => {
    test('first spin unlocks first_spin', async () => {
        const user = await createTestUser({ username: 'a5', email: 'a5@test.com' });
        const unlocked = await ach.checkSpinAchievements(user.id, 1, 0, 1, 1, 1);
        expect(unlocked.find(u => u.id === 'first_spin')).toBeDefined();
    });

    test('100 spins unlocks ten_spins AND hundred_spins', async () => {
        const user = await createTestUser({ username: 'a6', email: 'a6@test.com' });
        const unlocked = await ach.checkSpinAchievements(user.id, 100, 0, 1, 100, 1);
        const ids = unlocked.map(u => u.id);
        expect(ids).toContain('ten_spins');
        expect(ids).toContain('hundred_spins');
    });

    test('big win (50x) unlocks big_win', async () => {
        const user = await createTestUser({ username: 'a7', email: 'a7@test.com' });
        const unlocked = await ach.checkSpinAchievements(user.id, 1, 50, 1, 1, 1);
        expect(unlocked.find(u => u.id === 'big_win')).toBeDefined();
    });

    test('50+ bet unlocks whale_bet', async () => {
        const user = await createTestUser({ username: 'a8', email: 'a8@test.com' });
        const unlocked = await ach.checkSpinAchievements(user.id, 1, 0, 1, 1, 50);
        expect(unlocked.find(u => u.id === 'whale_bet')).toBeDefined();
    });
});

describe('Achievement Service — getUserAchievements', () => {
    test('returns full list with unlocked state', async () => {
        const user = await createTestUser({ username: 'a9', email: 'a9@test.com' });
        await ach.grant(user.id, 'first_spin');
        const result = await ach.getUserAchievements(user.id);
        expect(result.achievements.length).toBeGreaterThan(30);
        const fs = result.achievements.find(a => a.id === 'first_spin');
        expect(fs.unlocked).toBe(true);
        expect(result.stats.unlocked).toBe(1);
    });
});
