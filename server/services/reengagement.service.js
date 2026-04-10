'use strict';

const db = require('../database');
const { sendReengagementEmail } = require('./email.service');

/**
 * Tracks when reengagement emails were sent to prevent spam.
 * Table: reengagement_emails
 * Fields: id, user_id, email, sent_at, created_at
 */

/**
 * Initialize reengagement tracking table if it doesn't exist.
 */
async function initReengagementTable() {
    var isPg = db.isPg();
    var idDef = isPg ? 'SERIAL PRIMARY KEY' : 'INTEGER PRIMARY KEY AUTOINCREMENT';
    var tsDef = isPg ? 'TIMESTAMPTZ DEFAULT NOW()' : "TEXT DEFAULT (datetime('now'))";
    await db.run(`
        CREATE TABLE IF NOT EXISTS reengagement_emails (
            id ${idDef},
            user_id INTEGER NOT NULL,
            email TEXT NOT NULL,
            sent_at ${tsDef},
            created_at ${tsDef},
            UNIQUE(user_id, sent_at)
        )
    `);
}

/**
 * Find users who are eligible for reengagement emails:
 * - Haven't logged in for 3+ days (based on last spin/activity)
 * - Not banned
 * - Not self-excluded
 * - Haven't received a reengagement email in the last 7 days
 * - Limits to 50 per run to avoid spam
 */
async function findInactiveUsers() {
    const rows = await db.all(`
        SELECT
            u.id AS userId,
            u.username,
            u.email,
            MAX(s.created_at) AS lastActivity,
            CAST(julianday('now') - julianday(MAX(s.created_at)) AS INTEGER) AS daysSinceActivity
        FROM users u
        LEFT JOIN spins s ON s.user_id = u.id
        WHERE u.is_banned = 0
          AND (
            -- Last spin is 3+ days ago
            (s.created_at IS NOT NULL AND s.created_at < datetime('now', '-3 days'))
            -- OR user has never spun but registered 3+ days ago
            OR (s.created_at IS NULL AND u.created_at < datetime('now', '-3 days'))
          )
          -- Exclude users who got a reengagement email in the last 7 days
          AND u.id NOT IN (
            SELECT user_id FROM reengagement_emails
            WHERE sent_at > datetime('now', '-7 days')
          )
        GROUP BY u.id, u.username, u.email
        ORDER BY daysSinceActivity DESC
        LIMIT 50
    `);

    return rows.map(function (r) {
        return {
            userId: r.userId,
            username: r.username,
            email: r.email,
            lastActivity: r.lastActivity,
            daysSinceActivity: r.daysSinceActivity || 3, // Default to 3 if never played
        };
    });
}

/**
 * Record that a reengagement email was sent to a user.
 * Prevents duplicate sends within 7 days.
 */
async function recordEmailSent(userId, email) {
    await db.run(
        `INSERT INTO reengagement_emails (user_id, email, sent_at)
         VALUES (?, ?, datetime('now'))`,
        [userId, email]
    );
}

/**
 * Run the reengagement check:
 * 1. Find inactive users (3+ days)
 * 2. Send them personalized reengagement emails (max 50 per run)
 * 3. Track sent emails to prevent re-sending within 7 days
 * 4. Return summary of emails sent
 */
async function runReengagementCheck() {
    try {
        // Ensure tracking table exists
        await initReengagementTable();

        // Find eligible inactive users
        const inactiveUsers = await findInactiveUsers();

        if (inactiveUsers.length === 0) {
            console.warn('[Reengagement] No inactive users found for reengagement');
            return { sent: 0, failed: 0, total: 0 };
        }

        let sent = 0;
        let failed = 0;

        // Send reengagement emails
        for (const user of inactiveUsers) {
            try {
                const success = await sendReengagementEmail(
                    user.email,
                    user.username,
                    user.daysSinceActivity
                );

                if (success) {
                    // Record the send
                    await recordEmailSent(user.userId, user.email);
                    sent++;
                    console.warn(
                        `[Reengagement] Email sent to ${user.username} (${user.daysSinceActivity} days inactive)`
                    );
                } else {
                    failed++;
                    console.warn(`[Reengagement] Failed to send to ${user.username}`);
                }
            } catch (err) {
                failed++;
                console.warn(
                    `[Reengagement] Error sending email to ${user.username}:`,
                    err.message
                );
            }
        }

        console.warn(
            `[Reengagement] Check complete: ${sent} sent, ${failed} failed (out of ${inactiveUsers.length})`
        );

        return {
            sent,
            failed,
            total: inactiveUsers.length,
        };
    } catch (err) {
        console.warn('[Reengagement] Error during reengagement check:', err.message);
        throw err;
    }
}

module.exports = {
    initReengagementTable,
    findInactiveUsers,
    recordEmailSent,
    runReengagementCheck,
};
