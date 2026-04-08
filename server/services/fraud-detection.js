/**
 * Fraud Detection Service — server/services/fraud-detection.js
 *
 * Detects and flags suspicious patterns:
 * - Multi-account abuse (same IP registering multiple accounts)
 * - Rapid registration (burst of accounts from same IP)
 * - Bonus abuse (accounts that only play during promotions)
 * - Chip dumping (coordinated play between accounts)
 * - Win-and-run (deposit, win, immediately withdraw)
 */
'use strict';

const db = require('../database');

/**
 * Record a registration event and check for multi-account abuse
 * IMPROVEMENT: Lowered threshold to 2, added velocity check (3+ in 1 hour)
 * @param {string} ip - Client IP address
 * @param {number} userId - New user ID
 * @returns {Object} { flagged: boolean, reason: string|null, existingAccounts: number }
 */
async function checkMultiAccountRegistration(ip, userId) {
    try {
        // Record the IP
        await db.run(
            'INSERT INTO registration_ips (user_id, ip_address) VALUES (?, ?)',
            [userId, ip]
        ).catch(function(e) { if (e && !String(e.message || e).match(/no such table|does not exist/i)) console.warn('[Fraud] IP log error:', e.message || e); });

        // Count accounts from this IP in last 30 days
        const result = await db.get(
            "SELECT COUNT(DISTINCT user_id) as count FROM registration_ips WHERE ip_address = ? AND created_at >= datetime('now', '-30 days')",
            [ip]
        );
        const count = result ? result.count : 0;

        // IMPROVEMENT: Velocity check — flag 3+ registrations within 1 hour (bot farm)
        const recentResult = await db.get(
            "SELECT COUNT(DISTINCT user_id) as count FROM registration_ips WHERE ip_address = ? AND created_at >= datetime('now', '-1 hour')",
            [ip]
        );
        const recentCount = recentResult ? recentResult.count : 0;

        if (recentCount >= 3) {
            await db.run(
                "UPDATE users SET fraud_flag = 'rapid_registration', fraud_flag_reason = ? WHERE id = ?",
                ['IP ' + ip + ' registered ' + recentCount + ' accounts in 1 hour', userId]
            ).catch(function(e) { console.warn('[Fraud] flag update error:', e.message || e); });
            return { flagged: true, reason: 'rapid_registration', existingAccounts: count };
        }

        // IMPROVEMENT: Lowered from 3 to 2 — 2+ accounts from same IP in 30 days is suspicious
        if (count >= 2) {
            await db.run(
                "UPDATE users SET fraud_flag = 'multi_account', fraud_flag_reason = ? WHERE id = ?",
                ['IP ' + ip + ' has ' + count + ' registrations in 30 days', userId]
            ).catch(function(e) { console.warn('[Fraud] flag update error:', e.message || e); });

            return { flagged: true, reason: 'multi_account', existingAccounts: count };
        }

        return { flagged: false, reason: null, existingAccounts: count };
    } catch (err) {
        console.warn('[Fraud] Multi-account check error:', err.message);
        return { flagged: false, reason: null, existingAccounts: 0 };
    }
}

/**
 * Check for win-and-run pattern before processing withdrawal
 * IMPROVEMENT: Added wagering requirement check
 * @param {number} userId - User requesting withdrawal
 * @returns {Object} { suspicious: boolean, reason: string|null }
 */
async function checkWinAndRun(userId) {
    try {
        // Get account age
        const user = await db.get('SELECT created_at, wagering_requirement FROM users WHERE id = ?', [userId]);
        if (!user) return { suspicious: false, reason: null };

        const accountAge = Date.now() - new Date(user.created_at).getTime();
        const hoursOld = accountAge / (1000 * 60 * 60);

        // IMPROVEMENT: Block withdrawal if wagering requirement not met
        if (user.wagering_requirement > 0) {
            return {
                suspicious: true,
                reason: 'Outstanding wagering requirement of $' + Math.round(user.wagering_requirement * 100) / 100
            };
        }

        // Get deposit and spin history
        const stats = await db.get(
            "SELECT " +
            "(SELECT COALESCE(SUM(amount), 0) FROM deposits WHERE user_id = ? AND status = 'completed') as total_deposited, " +
            "(SELECT COALESCE(SUM(bet_amount), 0) FROM spins WHERE user_id = ?) as total_wagered, " +
            "(SELECT COUNT(*) FROM spins WHERE user_id = ?) as total_spins",
            [userId, userId, userId]
        );

        // Flag: account < 24 hours old AND fewer than 50 spins AND trying to withdraw
        if (hoursOld < 24 && stats && stats.total_spins < 50) {
            return {
                suspicious: true,
                reason: 'Account is ' + Math.round(hoursOld) + ' hours old with only ' + stats.total_spins + ' spins'
            };
        }

        // Flag: wagered less than 50% of deposits (not really playing)
        if (stats && stats.total_deposited > 0 && stats.total_wagered < stats.total_deposited * 0.5) {
            return {
                suspicious: true,
                reason: 'Wagered only ' + Math.round((stats.total_wagered / stats.total_deposited) * 100) + '% of deposits'
            };
        }

        return { suspicious: false, reason: null };
    } catch (err) {
        console.warn('[Fraud] Win-and-run check error:', err.message);
        return { suspicious: false, reason: null };
    }
}

/**
 * Ensure required tables exist
 */
async function ensureFraudTables() {
    try {
        const isPg = !!process.env.DATABASE_URL;
        const idDef = isPg ? 'SERIAL PRIMARY KEY' : 'INTEGER PRIMARY KEY AUTOINCREMENT';
        const tsDef = isPg ? 'TIMESTAMPTZ DEFAULT NOW()' : "TEXT DEFAULT (datetime('now'))";
        await db.run("CREATE TABLE IF NOT EXISTS registration_ips (id " + idDef + ", user_id INTEGER NOT NULL, ip_address TEXT NOT NULL, created_at " + tsDef + ")");
        await db.run("CREATE INDEX IF NOT EXISTS idx_reg_ips_ip ON registration_ips (ip_address)");
        await db.run("CREATE INDEX IF NOT EXISTS idx_reg_ips_created ON registration_ips (created_at)");
    } catch (e) { /* ignore during early startup */ }
}

// Auto-init tables
ensureFraudTables();

module.exports = {
    checkMultiAccountRegistration,
    checkWinAndRun,
    ensureFraudTables
};
