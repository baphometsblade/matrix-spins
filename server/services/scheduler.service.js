'use strict';

const cron = require('node-cron');
const db = require('../database');
const emailService = require('./email.service');
const config = require('../config');

let _started = false;
let _tableReady = false;

// Moved table creation into ensureTable() — called from start() to avoid
// module-level DB access that can crash on PG cold starts (Render free tier).
async function _ensureEmailLogTable() {
    if (_tableReady) return;
    try {
        const _isPg = db.isPg();
        const _idDef = _isPg ? 'SERIAL PRIMARY KEY' : 'INTEGER PRIMARY KEY AUTOINCREMENT';
        await db.run(`CREATE TABLE IF NOT EXISTS email_log (
            id ${_idDef},
            user_id INTEGER NOT NULL,
            email_type TEXT NOT NULL,
            created_at TEXT NOT NULL,
            UNIQUE(user_id, email_type)
        )`);
        _tableReady = true;
    } catch (err) {
        console.warn('[Scheduler] email_log table create:', err.message);
    }
}

/**
 * Send re-engagement emails to players who haven't logged in recently.
 * Runs daily at 10:00 AM server time.
 */
async function _sendReengagementEmails() {
    if (!config.SMTP_HOST || !config.SMTP_USER) {
        // No SMTP configured — skip silently
        return;
    }
    try {
        // Find players who haven't logged in for 3-7 days and have played at least once
        // Uses last spin as a proxy for "last active"
        const dormant = await db.all(`
            SELECT u.id, u.email, u.username, u.balance,
                   MAX(s.created_at) as last_spin,
                   COUNT(s.id) as total_spins,
                   SUM(s.bet_amount) as total_wagered
            FROM users u
            JOIN spins s ON s.user_id = u.id
            WHERE u.is_banned = 0
              AND u.email IS NOT NULL
              AND s.created_at < datetime('now', '-3 days')
            GROUP BY u.id, u.email, u.username, u.balance
            HAVING MAX(s.created_at) > datetime('now', '-7 days')
            ORDER BY total_wagered DESC
            LIMIT 50
        `);

        for (const player of dormant) {
            await emailService.sendReengagementEmail(player.email, player.username, player.balance);
            // Small delay to avoid SMTP rate limits
            await new Promise(r => setTimeout(r, 500));
        }

        if (dormant.length > 0) {
            console.warn(`[Scheduler] Re-engagement emails sent to ${dormant.length} players`);
        }
    } catch (err) {
        console.warn('[Scheduler] Re-engagement error:', err.message);
    }
}

/**
 * Send weekly P&L report to admin.
 * Runs every Monday at 8:00 AM.
 */
async function _sendWeeklyReport() {
    if (!config.SMTP_HOST || !config.ADMIN_EMAIL) return;
    try {
        const stats = await db.get(`
            SELECT
                COUNT(DISTINCT s.user_id) as active_players,
                COUNT(s.id) as total_spins,
                SUM(s.bet_amount) as total_wagered,
                SUM(s.win_amount) as total_paid,
                SUM(s.bet_amount) - SUM(s.win_amount) as gross_profit,
                COALESCE(SUM(d.amount), 0) as deposits_this_week
            FROM spins s
            LEFT JOIN deposits d ON d.user_id = s.user_id
                AND d.status = 'completed'
                AND d.created_at > datetime('now', '-7 days')
            WHERE s.created_at > datetime('now', '-7 days')
        `);

        await emailService.sendWeeklyReport(config.ADMIN_EMAIL, stats);
    } catch (err) {
        console.warn('[Scheduler] Weekly report error:', err.message);
    }
}

/**
 * Send deposit nudge emails to registered users who have never deposited.
 * Targets users registered 2-7 days ago with no completed deposit.
 * Runs every 6 hours.
 */
async function _sendDepositNudgeEmails() {
    if (!config.SMTP_HOST || !config.SMTP_USER) return;
    try {
        // Find registered users with no deposits who registered 2-7 days ago
        const prospects = await db.all(`
            SELECT u.id, u.email, u.username, u.balance, u.created_at
            FROM users u
            LEFT JOIN deposits d ON d.user_id = u.id AND d.status = 'completed'
            WHERE u.is_banned = 0
              AND u.email IS NOT NULL
              AND d.id IS NULL
              AND u.created_at < datetime('now', '-2 days')
              AND u.created_at > datetime('now', '-7 days')
              AND NOT EXISTS (
                SELECT 1 FROM email_log el WHERE el.user_id = u.id AND el.email_type = 'deposit_nudge'
                AND el.created_at > datetime('now', '-5 days')
              )
            ORDER BY u.created_at DESC
            LIMIT 30
        `);

        for (const player of prospects) {
            await emailService.sendDepositNudgeEmail(player.email, player.username);
            // Log to avoid re-sending
            await db.run(`INSERT OR IGNORE INTO email_log (user_id, email_type, created_at) VALUES (?, 'deposit_nudge', datetime('now'))`, [player.id]).catch(function(e) { console.warn('[Scheduler] email_log insert error:', e.message || e); });
            await new Promise(r => setTimeout(r, 300));
        }
        if (prospects.length > 0) console.warn(`[Scheduler] Deposit nudge emails sent to ${prospects.length} players`);
    } catch (err) {
        console.warn('[Scheduler] Deposit nudge error:', err.message);
    }
}

/**
 * Send VIP tier-up congratulation emails to players who recently crossed a milestone.
 * Checks spin count milestones: 500 (Silver), 2000 (Gold), 5000 (Platinum), 10000 (Diamond).
 * Runs daily at 11:00 AM.
 */
async function _sendVipTierUpEmails() {
    if (!config.SMTP_HOST || !config.SMTP_USER) return;
    try {
        const tierThresholds = [
            { minSpins: 500,   tierName: 'Silver',   emoji: '🥈', benefit: '5% win boost on all games' },
            { minSpins: 2000,  tierName: 'Gold',     emoji: '🥇', benefit: 'Priority withdrawals + exclusive games' },
            { minSpins: 5000,  tierName: 'Platinum', emoji: '💎', benefit: 'Personal manager + 10% rakeback' },
            { minSpins: 10000, tierName: 'Diamond',  emoji: '💠', benefit: 'Max rakeback + custom limits + VIP lounge' },
        ];

        for (const tier of tierThresholds) {
            const newlyTiered = await db.all(`
                SELECT u.id, u.email, u.username, COUNT(s.id) as spin_count
                FROM users u
                JOIN spins s ON s.user_id = u.id
                WHERE u.is_banned = 0 AND u.email IS NOT NULL
                GROUP BY u.id, u.email, u.username
                HAVING COUNT(s.id) >= ?
                  AND COUNT(s.id) < ? + 50
                  AND NOT EXISTS (
                    SELECT 1 FROM email_log el WHERE el.user_id = u.id
                    AND el.email_type = 'vip_' || ?
                  )
                LIMIT 20
            `, [tier.minSpins, tier.minSpins, tier.tierName.toLowerCase()]);

            for (const player of newlyTiered) {
                await emailService.sendVipTierEmail(player.email, player.username, tier);
                await db.run(`INSERT OR IGNORE INTO email_log (user_id, email_type, created_at) VALUES (?, ?, datetime('now'))`,
                    [player.id, `vip_${tier.tierName.toLowerCase()}`]).catch(function(e) { console.warn('[Scheduler] VIP email_log error:', e.message || e); });
                await new Promise(r => setTimeout(r, 300));
            }
        }
    } catch (err) {
        console.warn('[Scheduler] VIP tier-up email error:', err.message);
    }
}

function start() {
    if (_started) return;
    _started = true;

    // Create email_log table (deferred from module load to avoid PG cold-start crashes)
    _ensureEmailLogTable();

    // Daily re-engagement: 10:00 AM
    cron.schedule('0 10 * * *', _sendReengagementEmails);

    // Weekly P&L report: Monday 8:00 AM
    cron.schedule('0 8 * * 1', _sendWeeklyReport);

    // Deposit nudge: every 6 hours
    cron.schedule('0 */6 * * *', _sendDepositNudgeEmails);

    // VIP tier-up notifications: daily at 11 AM
    cron.schedule('0 11 * * *', _sendVipTierUpEmails);

    console.warn('[Scheduler] Cron jobs started (re-engagement daily 10AM, P&L weekly Mon 8AM, deposit nudge every 6h, VIP tier-up daily 11AM)');
}

module.exports = { start };
