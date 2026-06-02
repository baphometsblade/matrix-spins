'use strict';

/**
 * Regression test for the audit-log "no column named amount" bug.
 *
 * The audit helper (server/utils/audit-log.js) INSERTs:
 *   INSERT INTO audit_log (event_type, user_id, amount, reference, details) ...
 * but schema-sqlite.js / schema-pg.js defined audit_log WITHOUT the amount and
 * reference columns, so on a fresh DB every audit write failed with
 *   "table audit_log has no column named amount"
 * The error was caught and only logged as a WARN, so the compliance/audit trail
 * silently stopped persisting (auth.register, deposits, withdrawals, admin
 * actions, etc.). Two more call sites use the same INSERT shape:
 * bonus-forfeit.routes.js and jackpot.routes.js.
 *
 * Part 1 (pure, no DB): both schemas declare amount + reference on audit_log.
 * Part 2 (integration): the audit() helper actually writes a row on a real DB.
 */

const fs = require('fs');
const path = require('path');

describe('audit_log schema declares amount + reference', () => {
    function auditLogDdl(tablesArr) {
        return (tablesArr || []).find(d => /CREATE TABLE IF NOT EXISTS\s+audit_log\b/i.test(d)) || '';
    }

    test('schema-sqlite.js audit_log has amount and reference columns', () => {
        const schema = require('../../server/db/schema-sqlite.js');
        const ddl = auditLogDdl(schema.TABLES);
        expect(ddl).toMatch(/\bamount\b/);
        expect(ddl).toMatch(/\breference\b/);
    });

    test('schema-pg.js audit_log has amount and reference columns', () => {
        const schema = require('../../server/db/schema-pg.js');
        const ddl = auditLogDdl(schema.TABLES);
        expect(ddl).toMatch(/\bamount\b/);
        expect(ddl).toMatch(/\breference\b/);
    });

    test('both schemas expose AUDIT_LOG_MIGRATIONS covering amount + reference (for already-deployed tables)', () => {
        for (const file of ['../../server/db/schema-sqlite.js', '../../server/db/schema-pg.js']) {
            const schema = require(file);
            const cols = (schema.AUDIT_LOG_MIGRATIONS || []).map(([name]) => name);
            expect(cols).toContain('amount');
            expect(cols).toContain('reference');
        }
    });
});

describe('audit() helper persists to audit_log without WARN', () => {
    let db;
    let warnSpy;

    beforeAll(async () => {
        const { setupTestDb } = require('../helpers/test-db');
        await setupTestDb();
        db = require('../../server/database');
    });

    afterAll(async () => {
        const { teardownTestDb } = require('../helpers/test-db');
        await teardownTestDb();
    });

    beforeEach(() => {
        // Spy on the logger.warn the helper uses on a failed DB write.
        const logger = require('../../server/utils/logger');
        warnSpy = jest.spyOn(logger, 'warn').mockImplementation(() => {});
    });

    afterEach(() => {
        if (warnSpy) warnSpy.mockRestore();
    });

    test('writes a row with amount + reference and emits no "audit DB write failed" warning', async () => {
        const { audit } = require('../../server/utils/audit-log');

        await audit('auth.register', {
            userId: 4242,
            amount: 19.95,
            reference: 'reg-test-001',
            ip: '203.0.113.7',
            details: { method: 'password' },
        });

        // The pre-fix bug logged exactly this warning and dropped the row.
        const failedWarns = warnSpy.mock.calls.filter(
            ([msg]) => typeof msg === 'string' && msg.includes('audit DB write failed')
        );
        expect(failedWarns).toEqual([]);

        const row = await db.get(
            'SELECT event_type, user_id, amount, reference FROM audit_log WHERE reference = ?',
            ['reg-test-001']
        );
        expect(row).toBeTruthy();
        expect(row.event_type).toBe('auth.register');
        expect(Number(row.user_id)).toBe(4242);
        expect(Number(row.amount)).toBeCloseTo(19.95, 2);
        expect(row.reference).toBe('reg-test-001');
    });

    test('non-numeric amount is stored as NULL (helper guards the type)', async () => {
        const { audit } = require('../../server/utils/audit-log');

        await audit('auth.login', { userId: 4243, reference: 'login-test-001' });

        const failedWarns = warnSpy.mock.calls.filter(
            ([msg]) => typeof msg === 'string' && msg.includes('audit DB write failed')
        );
        expect(failedWarns).toEqual([]);

        const row = await db.get(
            'SELECT amount, reference FROM audit_log WHERE reference = ?',
            ['login-test-001']
        );
        expect(row).toBeTruthy();
        expect(row.amount === null || row.amount === undefined).toBe(true);
    });
});

// Sanity: the source file path referenced in the test description exists.
test('audit helper source exists at the documented path', () => {
    expect(fs.existsSync(path.join(__dirname, '../../server/utils/audit-log.js'))).toBe(true);
});
