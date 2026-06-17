'use strict';

/**
 * Account Deletion Scheduler — GDPR Article 17 compliance
 *
 * Runs every hour to find deletion_requests that:
 *   - Are past their scheduled_for date
 *   - Are not cancelled or already completed
 *
 * Anonymizes user data (replaces PII with placeholders) and marks completed.
 * Does NOT hard-delete — we retain anonymized records for AML/regulatory compliance.
 */

const db = require('../database');
const logger = require('../utils/logger');

let timer = null;

async function processExpiredDeletions() {
    try {
        const isPg = typeof db.isPg === 'function' && db.isPg();
        const now = new Date().toISOString();

        const pending = await db.all(
            'SELECT dr.id, dr.user_id FROM deletion_requests dr WHERE dr.completed = 0 AND dr.cancelled = 0 AND dr.scheduled_for <= ?',
            [now]
        );

        if (!pending || pending.length === 0) return;

        logger.info(`Account deletion scheduler: processing ${pending.length} expired deletion request(s)`);

        for (const req of pending) {
            try {
                await anonymizeUser(req.user_id, isPg);
                await db.run('UPDATE deletion_requests SET completed = 1 WHERE id = ?', [req.id]);
                logger.info('Account deletion completed', { userId: req.user_id, requestId: req.id });
            } catch (err) {
                logger.error('Account deletion failed for user', { userId: req.user_id, error: err.message });
            }
        }
    } catch (err) {
        logger.error('Account deletion scheduler error', { error: err.message });
    }
}

async function anonymizeUser(userId, isPg) {
    const anonEmail = `deleted_${userId}@anonymized.invalid`;
    const anonUsername = `deleted_user_${userId}`;

    // Anonymize user record — keep id and created_at for regulatory retention
    await db.run(
        `UPDATE users SET
            username = ?,
            email = ?,
            password_hash = 'ACCOUNT_DELETED',
            display_name = 'Deleted User',
            avatar_url = NULL,
            phone = NULL,
            date_of_birth = NULL,
            address = NULL,
            balance = 0,
            bonus_balance = 0,
            wagering_requirement = 0,
            is_active = 0,
            self_excluded = 1,
            self_exclusion_until = '2099-12-31'
        WHERE id = ?`,
        [anonUsername, anonEmail, userId]
    );

    // Clear sessions so the user is logged out everywhere
    await db.run('DELETE FROM user_sessions WHERE user_id = ?', [userId]).catch(() => {});

    // Clear personal preferences
    await db.run('DELETE FROM user_preferences WHERE user_id = ?', [userId]).catch(() => {});

    // Clear notification tokens
    await db.run('DELETE FROM push_subscriptions WHERE user_id = ?', [userId]).catch(() => {});

    // Anonymize support conversations
    await db.run(
        "UPDATE support_messages SET message = '[message removed — account deleted]' WHERE user_id = ?",
        [userId]
    ).catch(() => {});

    // Note: We retain transaction history, spin history, and deposit/withdrawal records
    // in anonymized form for AML regulatory compliance (5-year retention requirement).
}

function start() {
    if (timer) return;
    // Run immediately on startup, then every hour
    processExpiredDeletions().catch(err => logger.warn('Initial deletion check failed', { error: err.message }));
    timer = setInterval(processExpiredDeletions, 60 * 60 * 1000);
    timer.unref(); // Don't block process exit
    logger.info('Account deletion scheduler started (hourly)');
}

function stop() {
    if (timer) { clearInterval(timer); timer = null; }
}

module.exports = { start, stop, processExpiredDeletions };
