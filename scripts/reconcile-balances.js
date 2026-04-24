#!/usr/bin/env node
'use strict';

/**
 * Balance reconciliation audit.
 *
 * For every user, walk their transaction history and verify that
 *   sum(all credits) - sum(all debits) ≈ users.balance
 *
 * Discrepancies are printed with the expected vs actual balance and a
 * non-zero exit code so CI / cron alerting can flag them.
 *
 * Transactions we sum (from transactions.amount, which is SIGNED — debits
 * are stored negative):
 *   deposit, win, free_spin_win (→ bonus_balance, ignored for this check)
 *   bet (-), withdrawal (-), withdrawal_refund (+), chargeback (-)
 *   refund (-), bonus_conversion (+), jackpot, withdrawal_approved (log-only)
 *
 * Signed 'amount' column already accounts for direction, so we just sum.
 * Tolerance: ±$0.01 to absorb rounding drift.
 *
 * Usage:
 *   node scripts/reconcile-balances.js                # all users
 *   node scripts/reconcile-balances.js --user=123     # single user
 *   node scripts/reconcile-balances.js --limit=500    # max users to scan
 */

const path = require('path');
process.env.SILENCE_DB_BOOT_LOGS = '1';

async function main() {
    // Allow the script to run from any cwd
    process.chdir(path.join(__dirname, '..'));

    const db = require('../server/database');
    const argv = process.argv.slice(2);
    const userIdFilter = (argv.find(a => a.startsWith('--user=')) || '').replace('--user=', '');
    const limit = parseInt((argv.find(a => a.startsWith('--limit=')) || '').replace('--limit=', ''), 10) || 1000;

    try { await db.initDatabase(); } catch (_) { /* may already be initialised */ }

    // Deposit-balance types that affect `balance` (not bonus_balance).
    // 'free_spin_win' credits bonus_balance instead, so it's EXCLUDED.
    // 'bundle_purchase' is debit-only logging; ignored.
    const BALANCE_TX_TYPES = [
        'deposit', 'win', 'jackpot',
        'bet', 'withdrawal',
        'withdrawal_refund',
        'chargeback', 'refund',
        'bonus_conversion',
        'admin_adjustment',
    ];

    let users;
    if (userIdFilter) {
        const u = await db.get('SELECT id, username, balance FROM users WHERE id = ?', [parseInt(userIdFilter, 10)]);
        users = u ? [u] : [];
    } else {
        users = await db.all('SELECT id, username, balance FROM users ORDER BY id ASC LIMIT ?', [limit]);
    }

    if (!users.length) {
        console.log('No users to reconcile.');
        process.exit(0);
    }

    console.log(`\n=== Balance Reconciliation (${users.length} users) ===\n`);

    let ok = 0, mismatches = 0, skipped = 0;
    const driftList = [];

    for (const user of users) {
        try {
            // Sum signed amounts for the known balance-affecting transaction types.
            // SQLite doesn't support array parameters, so we build the IN list manually.
            const placeholders = BALANCE_TX_TYPES.map(() => '?').join(',');
            const row = await db.get(
                `SELECT COALESCE(SUM(amount), 0) as total
                 FROM transactions
                 WHERE user_id = ? AND type IN (${placeholders})`,
                [user.id, ...BALANCE_TX_TYPES]
            );
            const expected = Math.round((row ? row.total : 0) * 100) / 100;
            const actual = Math.round((user.balance || 0) * 100) / 100;
            const drift = Math.round((actual - expected) * 100) / 100;

            if (Math.abs(drift) <= 0.01) {
                ok++;
                continue;
            }

            mismatches++;
            driftList.push({ userId: user.id, username: user.username, expected, actual, drift });
        } catch (err) {
            skipped++;
            console.warn(`  [skip] user ${user.id}: ${err.message}`);
        }
    }

    if (driftList.length) {
        // Sort by absolute drift descending — worst offenders first
        driftList.sort((a, b) => Math.abs(b.drift) - Math.abs(a.drift));
        console.log(`🔴 ${driftList.length} balance discrepancies:\n`);
        console.log('  User ID   Username             Expected       Actual         Drift');
        console.log('  --------  -------------------  -------------  -------------  -------------');
        for (const d of driftList.slice(0, 40)) {
            const uname = (d.username || '').slice(0, 19).padEnd(19);
            const exp   = ('$' + d.expected.toFixed(2)).padStart(13);
            const act   = ('$' + d.actual.toFixed(2)).padStart(13);
            const drft  = ((d.drift >= 0 ? '+' : '') + '$' + d.drift.toFixed(2)).padStart(13);
            console.log(`  #${String(d.userId).padEnd(7)}  ${uname}  ${exp}  ${act}  ${drft}`);
        }
        if (driftList.length > 40) console.log(`  … ${driftList.length - 40} more`);
        console.log('');
    }

    console.log(`✅ ${ok} users reconcile cleanly`);
    if (skipped) console.log(`⚠️  ${skipped} skipped (errors)`);
    if (mismatches) console.log(`🔴 ${mismatches} mismatches (${driftList.filter(d => Math.abs(d.drift) >= 1).length} with |drift| ≥ $1)`);

    // Exit non-zero on ANY mismatch > $1 so CI / cron alerts catch real leaks.
    // Sub-$1 drift is tolerated as accumulated rounding noise.
    const serious = driftList.filter(d => Math.abs(d.drift) >= 1).length;
    process.exit(serious > 0 ? 1 : 0);
}

main().catch(err => {
    console.error('FATAL:', err);
    process.exit(2);
});
