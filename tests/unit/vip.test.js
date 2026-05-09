'use strict';

const { setupTestDb, teardownTestDb, resetTables, createTestUser } = require('../helpers/test-db');
const vip = require('../../server/services/vip.service');

beforeAll(async () => { await setupTestDb(); });
afterAll(async () => { await teardownTestDb(); });
beforeEach(async () => { await resetTables('users', 'transactions', 'notifications'); });

describe('VIP Service — Tier resolution', () => {
    test('tierFromXp returns Bronze at 0 XP', () => {
        expect(vip.tierFromXp(0).name).toBe('Bronze');
    });

    test('tierFromXp returns Silver at 1000 XP', () => {
        expect(vip.tierFromXp(1000).name).toBe('Silver');
    });

    test('tierFromXp returns Gold at 5000 XP', () => {
        expect(vip.tierFromXp(5000).name).toBe('Gold');
    });

    test('tierFromXp returns Platinum at 25000 XP', () => {
        expect(vip.tierFromXp(25000).name).toBe('Platinum');
    });

    test('tierFromXp returns Diamond at 100000+ XP', () => {
        expect(vip.tierFromXp(100000).name).toBe('Diamond');
        expect(vip.tierFromXp(500000).name).toBe('Diamond');
    });

    test('tierFromXp at exactly threshold boundaries', () => {
        // Just below Silver threshold
        expect(vip.tierFromXp(999).name).toBe('Bronze');
        // Just below Gold
        expect(vip.tierFromXp(4999).name).toBe('Silver');
    });

    test('nextTier returns the next-higher tier', () => {
        expect(vip.nextTier('Bronze').name).toBe('Silver');
        expect(vip.nextTier('Gold').name).toBe('Platinum');
        expect(vip.nextTier('Diamond')).toBeNull();
    });
});

describe('VIP Service — Cashback computation', () => {
    test('Bronze 2% on $100 loss', () => {
        expect(vip.computeCashback('Bronze', 100)).toBe(2);
    });

    test('Gold 8% on $1000 loss', () => {
        expect(vip.computeCashback('Gold', 1000)).toBe(80);
    });

    test('Diamond 18% on $5000 loss', () => {
        expect(vip.computeCashback('Diamond', 5000)).toBe(900);
    });

    test('Cashback on zero loss is zero', () => {
        expect(vip.computeCashback('Gold', 0)).toBe(0);
    });

    test('Negative loss treated as zero', () => {
        expect(vip.computeCashback('Gold', -50)).toBe(0);
    });
});

describe('VIP Service — addXp (DB-integrated)', () => {
    test('addXp credits XP atomically', async () => {
        const user = await createTestUser({ username: 'xpuser', email: 'xp@test.com' });
        const result = await vip.addXp(user.id, 50);
        expect(result.xpGained).toBe(50);
        const db = require('../../server/database');
        const row = await db.get('SELECT vip_xp, vip_xp_lifetime FROM users WHERE id = ?', [user.id]);
        expect(row.vip_xp).toBe(50);
        expect(row.vip_xp_lifetime).toBe(50);
    });

    test('addXp ignores non-positive bets', async () => {
        const user = await createTestUser({ username: 'xpuser2', email: 'xp2@test.com' });
        const result = await vip.addXp(user.id, 0);
        expect(result.xpGained).toBe(0);
        expect(result.tierUp).toBe(false);
    });

    test('crossing 1000 lifetime XP promotes to Silver', async () => {
        const user = await createTestUser({ username: 'promo', email: 'promo@test.com' });
        const db = require('../../server/database');
        // Pre-set lifetime to 999
        await db.run('UPDATE users SET vip_xp_lifetime = 999, vip_xp = 999, vip_tier = ? WHERE id = ?', ['Bronze', user.id]);
        const result = await vip.addXp(user.id, 5);
        expect(result.tierUp).toBe(true);
        expect(result.newTier).toBe('Silver');
    });

    test('XP increment floors fractional bets', async () => {
        const user = await createTestUser({ username: 'frac', email: 'frac@test.com' });
        const result = await vip.addXp(user.id, 5.99);
        expect(result.xpGained).toBe(5);
    });
});

describe('VIP Service — getStatus', () => {
    test('getStatus returns full structure for new user', async () => {
        const user = await createTestUser({ username: 'getstat', email: 'getstat@test.com' });
        const status = await vip.getStatus(user.id);
        expect(status).toHaveProperty('tier');
        expect(status).toHaveProperty('xp');
        expect(status).toHaveProperty('benefits');
        expect(status.benefits).toHaveProperty('cashbackPct');
        expect(status.benefits).toHaveProperty('depositBonusMult');
    });
});
