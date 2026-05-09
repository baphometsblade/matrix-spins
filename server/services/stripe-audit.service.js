'use strict';

/**
 * Stripe webhook event audit log.
 *
 * Every Stripe webhook event we receive — verified or not, processed or not —
 * is recorded here. This lets ops:
 *
 *   - Verify a "missing" deposit really did (or didn't) hit our webhook
 *   - See replay/duplicate counts for debugging idempotency
 *   - Investigate signature-verification failures
 *   - Reconcile against the Stripe dashboard
 *
 * Table is intentionally append-only (no UPDATE/DELETE in normal flow).
 */

const db = require('../database');

let _ready = false;

function _isPg() { return typeof db.isPg === 'function' && db.isPg(); }
function _idDef() { return _isPg() ? 'SERIAL PRIMARY KEY' : 'INTEGER PRIMARY KEY AUTOINCREMENT'; }
function _tsDef() { return _isPg() ? 'TIMESTAMPTZ DEFAULT NOW()' : "TEXT DEFAULT (datetime('now'))"; }

async function ensureSchema() {
    if (_ready) return;
    try {
        await db.run(`CREATE TABLE IF NOT EXISTS stripe_webhook_log (
            id ${_idDef()},
            event_id TEXT,
            event_type TEXT NOT NULL,
            verified INTEGER NOT NULL DEFAULT 0,
            processed INTEGER NOT NULL DEFAULT 0,
            duplicate INTEGER NOT NULL DEFAULT 0,
            outcome TEXT,
            stripe_object_id TEXT,
            user_id INTEGER,
            amount NUMERIC(15,2),
            error_message TEXT,
            payload_summary TEXT,
            received_at ${_tsDef()}
        )`);
        await db.run(`CREATE INDEX IF NOT EXISTS idx_stripe_log_event_id ON stripe_webhook_log(event_id)`);
        await db.run(`CREATE INDEX IF NOT EXISTS idx_stripe_log_type_time ON stripe_webhook_log(event_type, received_at)`);
        _ready = true;
    } catch (err) {
        console.warn('[StripeAudit] schema init failed:', err.message);
    }
}
ensureSchema().catch(() => {});

/**
 * Log a webhook event.
 *
 * @param {object} entry
 * @param {string} entry.eventId        - Stripe event id (evt_xxx) or null if unverified
 * @param {string} entry.eventType      - e.g. 'checkout.session.completed'
 * @param {boolean} entry.verified      - signature verification passed?
 * @param {boolean} entry.processed     - did we mutate state for this event?
 * @param {boolean} entry.duplicate     - was this an idempotent no-op?
 * @param {string}  [entry.outcome]     - free-form (e.g. 'credited', 'banned', 'skipped')
 * @param {string}  [entry.objectId]    - session id / charge id / dispute id
 * @param {number}  [entry.userId]      - resolved user id, if any
 * @param {number}  [entry.amount]      - dollar amount, if any
 * @param {string}  [entry.errorMessage]
 * @param {string}  [entry.payloadSummary]
 */
async function logEvent(entry) {
    try {
        await ensureSchema();
        await db.run(
            `INSERT INTO stripe_webhook_log
             (event_id, event_type, verified, processed, duplicate, outcome, stripe_object_id, user_id, amount, error_message, payload_summary)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                entry.eventId || null,
                entry.eventType || 'unknown',
                entry.verified ? 1 : 0,
                entry.processed ? 1 : 0,
                entry.duplicate ? 1 : 0,
                entry.outcome || null,
                entry.objectId || null,
                entry.userId || null,
                entry.amount != null ? Number(entry.amount) : null,
                entry.errorMessage ? String(entry.errorMessage).slice(0, 500) : null,
                entry.payloadSummary ? String(entry.payloadSummary).slice(0, 1000) : null,
            ]
        );
    } catch (err) {
        // Audit must NEVER block webhook processing.
        console.warn('[StripeAudit] log failed:', err.message);
    }
}

async function recentEvents(limit) {
    await ensureSchema();
    const cap = Math.max(1, Math.min(500, limit || 100));
    return db.all(
        `SELECT id, event_id, event_type, verified, processed, duplicate, outcome,
                stripe_object_id, user_id, amount, error_message, received_at
         FROM stripe_webhook_log
         ORDER BY id DESC LIMIT ${cap}`
    );
}

async function statsByType(daysBack) {
    await ensureSchema();
    const days = Math.max(1, Math.min(90, daysBack || 7));
    const since = _isPg() ? `NOW() - INTERVAL '${days} days'` : `datetime('now', '-${days} days')`;
    return db.all(
        `SELECT event_type,
                COUNT(*) AS total,
                SUM(CASE WHEN verified=1 THEN 1 ELSE 0 END) AS verified,
                SUM(CASE WHEN processed=1 THEN 1 ELSE 0 END) AS processed,
                SUM(CASE WHEN duplicate=1 THEN 1 ELSE 0 END) AS duplicate,
                COALESCE(SUM(amount), 0) AS amount_total
         FROM stripe_webhook_log
         WHERE received_at >= ${since}
         GROUP BY event_type
         ORDER BY total DESC`
    );
}

module.exports = {
    logEvent,
    recentEvents,
    statsByType,
};
