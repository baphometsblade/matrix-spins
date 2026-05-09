'use strict';

const { setupTestDb, teardownTestDb, resetTables, createTestUser } = require('../helpers/test-db');
const refService = require('../../server/services/referral-commission.service');
const db = require('../../server/database');

beforeAll(async () => {
    await setupTestDb();
    await refService.ensureSchema();
    // Make sure referral_claims exists (created on demand by auth)
    await db.run(`CREATE TABLE IF NOT EXISTS referral_claims (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        referrer_id INTEGER NOT NULL,
        referred_id INTEGER NOT NULL,
        bonus_given REAL,
        created_at TEXT DEFAULT (datetime('now'))
    )`).catch(() => {});
});
afterAll(async () => { await teardownTestDb(); });
beforeEach(async () => {
    await resetTables('users', 'referral_commissions', 'referral_claims', 'spins', 'transactions', 'self_exclusions');
});

describe('Referral Commission — Constants', () => {
    test('TIER_1_RATE is 5%', () => {
        expect(refService.TIER_1_RATE).toBe(0.05);
    });

    test('TIER_2_RATE is 1%', () => {
        expect(refService.TIER_2_RATE).toBe(0.01);
    });

    test('COMMISSION_WINDOW_DAYS is 30', () => {
        expect(refService.COMMISSION_WINDOW_DAYS).toBe(30);
    });
});

describe('Referral Commission — accrueCommission', () => {
    async function setupReferralChain() {
        const tier2 = await createTestUser({ username: 't2_ref', email: 't2@test.com' });
        const tier1 = await createTestUser({ username: 't1_ref', email: 't1@test.com' });
        const referee = await createTestUser({ username: 'referee', email: 'referee@test.com' });
        await db.run('INSERT INTO referral_claims (referrer_id, referred_id) VALUES (?, ?)', [tier2.id, tier1.id]);
        await db.run('INSERT INTO referral_claims (referrer_id, referred_id) VALUES (?, ?)', [tier1.id, referee.id]);
        // Pre-fill referee with $20 wagering history to clear the MIN_REFEREE_WAGER threshold
        await db.run('INSERT INTO spins (user_id, game_id, bet_amount, result_grid, win_amount) VALUES (?, ?, ?, ?, ?)', [referee.id, 'g', 20, '[]', 0]);
        return { tier1, tier2, referee };
    }

    test('skips commission when net loss is zero (winning spin)', async () => {
        const { referee } = await setupReferralChain();
        await refService.accrueCommission(referee.id, 5, 5); // net 0
        const rows = await db.all('SELECT * FROM referral_commissions');
        expect(rows.length).toBe(0);
    });

    test('skips when referee has not reached MIN_REFEREE_WAGER ($10)', async () => {
        const tier1 = await createTestUser({ username: 'mr_t1', email: 'mr_t1@test.com' });
        const referee = await createTestUser({ username: 'mr_ref', email: 'mr_ref@test.com' });
        await db.run('INSERT INTO referral_claims (referrer_id, referred_id) VALUES (?, ?)', [tier1.id, referee.id]);
        // Only $5 wagered → below threshold
        await db.run('INSERT INTO spins (user_id, game_id, bet_amount, result_grid, win_amount) VALUES (?, ?, ?, ?, ?)', [referee.id, 'g', 5, '[]', 0]);
        await refService.accrueCommission(referee.id, 1, 0);
        const rows = await db.all('SELECT * FROM referral_commissions');
        expect(rows.length).toBe(0);
    });

    test('accrues 5% tier-1 + 1% tier-2 on net loss', async () => {
        const { tier1, tier2, referee } = await setupReferralChain();
        await refService.accrueCommission(referee.id, 100, 0); // 100 net loss
        const rows = await db.all('SELECT referrer_id, tier, commission FROM referral_commissions ORDER BY tier');
        expect(rows.length).toBe(2);
        const t1Row = rows.find(r => r.tier === 1);
        const t2Row = rows.find(r => r.tier === 2);
        expect(t1Row.commission).toBe(5);   // 5% of 100
        expect(t2Row.commission).toBe(1);   // 1% of 100
        expect(t1Row.referrer_id).toBe(tier1.id);
        expect(t2Row.referrer_id).toBe(tier2.id);
    });

    test('does not accrue on negative or zero bet', async () => {
        const { referee } = await setupReferralChain();
        await refService.accrueCommission(referee.id, 0, 0);
        await refService.accrueCommission(referee.id, -5, 0);
        const rows = await db.all('SELECT * FROM referral_commissions');
        expect(rows.length).toBe(0);
    });
});

describe('Referral Commission — claimPendingCommissions', () => {
    test('rejects below minimum payout', async () => {
        const tier1 = await createTestUser({ username: 'cp_t1', email: 'cp_t1@test.com' });
        await db.run("INSERT INTO referral_commissions (referrer_id, referee_id, tier, bet_amount, win_amount, net_loss, rate, commission, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending')", [tier1.id, 99, 1, 1, 0, 1, 0.05, 0.5]);
        await expect(refService.claimPendingCommissions(tier1.id)).rejects.toThrow();
    });

    test('credits bonus_balance with 10x wagering on successful claim', async () => {
        const tier1 = await createTestUser({ username: 'cl_t1', email: 'cl_t1@test.com' });
        await db.run("INSERT INTO referral_commissions (referrer_id, referee_id, tier, bet_amount, win_amount, net_loss, rate, commission, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending')", [tier1.id, 99, 1, 100, 0, 100, 0.05, 5]);
        const result = await refService.claimPendingCommissions(tier1.id);
        expect(result.credited).toBe(5);
        expect(result.wageringRequirement).toBe(50); // 10x

        const u = await db.get('SELECT bonus_balance, wagering_requirement FROM users WHERE id = ?', [tier1.id]);
        expect(u.bonus_balance).toBe(5);
        expect(u.wagering_requirement).toBe(50);

        // Pending → paid
        const remaining = await db.all("SELECT * FROM referral_commissions WHERE referrer_id = ? AND status = 'pending'", [tier1.id]);
        expect(remaining.length).toBe(0);
    });
});
