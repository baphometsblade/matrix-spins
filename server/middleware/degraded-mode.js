'use strict';

/**
 * Degraded-mode guard.
 *
 * When PostgreSQL is unreachable and the server has fallen back to SQLite
 * (`database.isDegraded() === true`), all money-handling endpoints return
 * 503 Service Unavailable. This prevents:
 *
 *   1. Stripe charging the user while we cannot durably record the deposit
 *      (SQLite on ephemeral Render disks is wiped on every redeploy).
 *   2. Withdrawal records being lost on redeploy.
 *   3. Race between PG reconnect and in-flight money ops hitting stale rows.
 *
 * The Stripe webhook is INTENTIONALLY not blocked — if a checkout session
 * was created before we went degraded, we still need to credit the user
 * when Stripe confirms the payment. If we return 5xx Stripe will retry,
 * and by the time PG reconnects the webhook will succeed. Retuning 2xx
 * here would tell Stripe "already handled" and we'd permanently miss it.
 */

const db = require('../database');

function degradedModeGuard(req, res, next) {
    if (typeof db.isDegraded === 'function' && db.isDegraded()) {
        return res.status(503).json({
            error: 'Money operations are temporarily unavailable while the database reconnects. Please try again in a few minutes.',
            code: 'db_degraded',
        });
    }
    next();
}

module.exports = { degradedModeGuard };
