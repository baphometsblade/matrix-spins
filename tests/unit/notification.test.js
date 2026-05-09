'use strict';

const { setupTestDb, teardownTestDb, resetTables, createTestUser } = require('../helpers/test-db');
const notify = require('../../server/services/notification.service');
const db = require('../../server/database');

beforeAll(async () => {
    await setupTestDb();
    await notify.ensureTable();
});
afterAll(async () => { await teardownTestDb(); });
beforeEach(async () => {
    await resetTables('users', 'notifications');
});

describe('Notification Service — Creation', () => {
    test('notify() persists a row and returns it', async () => {
        const user = await createTestUser({ username: 'n1', email: 'n1@test.com' });
        const row = await notify.notify({ userId: user.id, type: 'system', title: 'Hi', body: 'Hello world' });
        expect(row).not.toBeNull();
        expect(row.title).toBe('Hi');
        expect(row.body).toBe('Hello world');
        expect(row.type).toBe('system');
    });

    test('notify() without userId returns null', async () => {
        const row = await notify.notify({ type: 'system', title: 'No', body: 'No' });
        expect(row).toBeNull();
    });

    test('notify() truncates oversized title and body', async () => {
        const user = await createTestUser({ username: 'n2', email: 'n2@test.com' });
        const longTitle = 'a'.repeat(500);
        const longBody = 'b'.repeat(2000);
        const row = await notify.notify({ userId: user.id, type: 'system', title: longTitle, body: longBody });
        expect(row.title.length).toBeLessThanOrEqual(200);
        expect(row.body.length).toBeLessThanOrEqual(1000);
    });

    test('default type "info" is applied if omitted', async () => {
        const user = await createTestUser({ username: 'n3', email: 'n3@test.com' });
        const row = await notify.notify({ userId: user.id, title: 'X', body: 'Y' });
        expect(row.type).toBe('info');
    });
});

describe('Notification Service — Convenience builders', () => {
    test('bonusAwarded creates a bonus-typed notification', async () => {
        const user = await createTestUser({ username: 'n4', email: 'n4@test.com' });
        const row = await notify.bonusAwarded(user.id, 25.00, 'welcome bonus');
        expect(row.type).toBe('bonus');
        expect(row.body).toMatch(/25/);
    });

    test('depositConfirmed creates a deposit-typed notification', async () => {
        const user = await createTestUser({ username: 'n5', email: 'n5@test.com' });
        const row = await notify.depositConfirmed(user.id, 100, 'visa');
        expect(row.type).toBe('deposit');
        expect(row.body).toMatch(/100/);
    });

    test('withdrawalProcessed varies wording by status', async () => {
        const user = await createTestUser({ username: 'n6', email: 'n6@test.com' });
        const r1 = await notify.withdrawalProcessed(user.id, 50, 'approved');
        expect(r1.body).toMatch(/approved|on its way/i);
        const r2 = await notify.withdrawalProcessed(user.id, 50, 'rejected');
        expect(r2.body).toMatch(/could not|returned/i);
    });

    test('TYPES export contains all expected channel keys', () => {
        for (const k of ['bonus', 'deposit', 'withdrawal', 'level_up', 'system', 'win']) {
            expect(notify.TYPES).toHaveProperty(k);
        }
    });
});

describe('Notification Service — Read state', () => {
    test('rows default to read=0', async () => {
        const user = await createTestUser({ username: 'n7', email: 'n7@test.com' });
        await notify.notify({ userId: user.id, type: 'info', title: 'Test', body: 'Body' });
        const row = await db.get('SELECT read FROM notifications WHERE user_id = ? ORDER BY id DESC LIMIT 1', [user.id]);
        expect(row.read).toBe(0);
    });
});
