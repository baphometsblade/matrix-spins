'use strict';

/**
 * Audit-log helper — writes financial/security events to:
 *   1. winston `audit-YYYY-MM-DD.log` (always, fast, immutable file trail)
 *   2. `audit_log` DB table (best-effort; non-fatal if DB is degraded)
 *
 * Use for: deposits, withdrawals, bonus credits, admin actions, login/logout,
 * password changes, self-exclusion changes, etc. Do NOT use for routine spins
 * (volume too high; transactions table already records those).
 */

const logger = require('./logger');

let dbRef = null;
function db() {
    if (!dbRef) dbRef = require('../database');
    return dbRef;
}

/**
 * @param {string}  eventType   e.g. 'deposit', 'withdrawal', 'admin.bonus.bulk'
 * @param {object}  meta        { userId, amount, reference, ip, ...details }
 */
async function audit(eventType, meta = {}) {
    const safeMeta = logger.redact(meta) || {};
    logger.audit.info(eventType, safeMeta);
    try {
        const d = db();
        const userId = meta.userId || meta.user_id || null;
        const amount = (typeof meta.amount === 'number') ? meta.amount : null;
        const reference = meta.reference || meta.ref || null;
        // The remaining fields go into details JSON
        const details = JSON.stringify({
            ip: meta.ip || null,
            userAgent: meta.userAgent || null,
            requestId: meta.requestId || null,
            ...meta.details,
        });
        await d.run(
            'INSERT INTO audit_log (event_type, user_id, amount, reference, details) VALUES (?, ?, ?, ?, ?)',
            [eventType, userId, amount, reference, details]
        );
    } catch (err) {
        // Audit log table may not exist yet on cold-start — fall back to file only.
        logger.warn('audit DB write failed', { eventType, error: err.message });
    }
}

module.exports = { audit };
