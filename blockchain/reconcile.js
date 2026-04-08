#!/usr/bin/env node
'use strict';

/**
 * reconcile.js — Daily chain ↔ DB balance reconciliation.
 * Compares on-chain token balance against PostgreSQL aggregate.
 * Flags discrepancies for manual review.
 *
 * Schedule: Run daily via cron or node-cron.
 * Usage: node blockchain/reconcile.js
 */

require('dotenv').config({ path: __dirname + '/.env' });
const { getChainBalance } = require('./balance');

async function reconcile() {
    console.log('\n  ═══ Daily Balance Reconciliation ═══');
    console.log(`  Timestamp: ${new Date().toISOString()}\n`);

    // 1. Get on-chain balance
    let chainBalance;
    try {
        chainBalance = await getChainBalance();
        console.log(`  On-chain balance:  ${chainBalance.formatted} (${chainBalance.tokens} tokens)`);
    } catch (err) {
        console.error(`  ❌ Failed to read chain balance: ${err.message}`);
        console.error('  Reconciliation aborted — chain unreachable.');
        process.exit(1);
    }

    // 2. Get DB aggregate balance
    // This would connect to PostgreSQL in production
    let dbBalance;
    try {
        // In production: SELECT SUM(balance_cents) FROM players WHERE status = 'active'
        // For now, read from SQLite if available
        const path = require('path');
        const dbPath = path.join(__dirname, '..', 'casino.db');
        const fs = require('fs');

        if (fs.existsSync(dbPath)) {
            const Database = require('better-sqlite3');
            const db = new Database(dbPath, { readonly: true });
            const result = db.prepare('SELECT SUM(balance) as total FROM users WHERE balance > 0').get();
            dbBalance = result ? (result.total || 0) : 0;
            db.close();
        } else {
            // Fallback: use server's DB module
            const serverDb = require('../server/database');
            const result = await serverDb.get('SELECT SUM(balance) as total FROM users WHERE balance > 0');
            dbBalance = result ? (result.total || 0) : 0;
        }

        console.log(`  Database balance:  $${dbBalance.toFixed(2)} AUD`);
    } catch (err) {
        console.error(`  ❌ Failed to read DB balance: ${err.message}`);
        dbBalance = null;
    }

    // 3. Compare
    if (dbBalance !== null) {
        const diff = Math.abs(chainBalance.balanceAUD - dbBalance);
        const pctDiff = dbBalance > 0 ? (diff / dbBalance * 100) : 0;

        console.log(`\n  Difference:        $${diff.toFixed(2)} (${pctDiff.toFixed(4)}%)`);

        if (diff < 0.01) {
            console.log('  Status:            ✅ BALANCED');
        } else if (pctDiff < 0.1) {
            console.log('  Status:            ⚠️ MINOR DRIFT (< 0.1%) — likely pending transactions');
        } else if (pctDiff < 1.0) {
            console.log('  Status:            ⚠️ MODERATE DRIFT — review recent transactions');
        } else {
            console.log('  Status:            ❌ SIGNIFICANT DISCREPANCY — manual investigation required');
        }
    }

    // 4. Log reconciliation result
    const result = {
        timestamp: new Date().toISOString(),
        chainTokens: chainBalance.tokens,
        chainAUD: chainBalance.balanceAUD,
        dbAUD: dbBalance,
        difference: dbBalance !== null ? Math.abs(chainBalance.balanceAUD - dbBalance) : null,
        status: dbBalance === null ? 'DB_UNREACHABLE' :
            Math.abs(chainBalance.balanceAUD - dbBalance) < 0.01 ? 'BALANCED' :
            'DRIFT',
    };

    console.log(`\n  Reconciliation complete.`);
    console.log(`  Result: ${JSON.stringify(result)}\n`);

    return result;
}

module.exports = { reconcile };

if (require.main === module) {
    reconcile().catch(e => { console.error(e); process.exit(1); });
}
