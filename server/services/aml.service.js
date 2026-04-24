'use strict';

/**
 * AML (Anti-Money-Laundering) event logger.
 *
 * Records large or suspicious transactions to a dedicated `aml_events`
 * table. Operators review these events daily to:
 *   - File Currency Transaction Reports (CTRs) for large movements
 *     (US / AUSTRAC / similar require reports above a threshold)
 *   - File Suspicious Activity Reports (SARs) when patterns indicate
 *     money laundering (rapid deposits + immediate withdrawals,
 *     structured transactions just below reporting thresholds, etc.)
 *
 * This is a first-class compliance signal, not a fraud block — events
 * are logged fire-and-forget so they never fail the underlying money
 * operation. Operators / admins consume them via
 * `/api/admin/aml-events`.
 *
 * Thresholds (AUD — matches config.CURRENCY default):
 *   LARGE_TRANSACTION:     $10,000  (single deposit or withdrawal)
 *   DAILY_AGGREGATE:       $10,000  (sum of same-type tx in 24h)
 *   STRUCTURING_WINDOW:    $8,000+  ($9,999 repeated = structuring)
 *   RAPID_TURNAROUND:      deposit → withdraw within 1 hour with
 *                          minimal wagering in between
 */

const db = require('../database');

const LARGE_TX_THRESHOLD   = 10_000;  // $10k single transaction
const DAILY_AGG_THRESHOLD  = 10_000;  // $10k aggregate per 24h
const STRUCTURING_FLOOR    = 8_000;   // transactions ≥ $8k trigger aggregate check
const RAPID_TURNAROUND_MIN = 60;      // deposit → withdraw within 60 min

let _schemaReady = false;
async function ensureSchema() {
    if (_schemaReady) return;
    try {
        const isPg = typeof db.isPg === 'function' ? db.isPg() : false;
        const idDef = isPg ? 'SERIAL PRIMARY KEY' : 'INTEGER PRIMARY KEY AUTOINCREMENT';
        const tsDef = isPg ? 'TIMESTAMPTZ DEFAULT NOW()' : "TEXT DEFAULT (datetime('now'))";
        await db.run(
            `CREATE TABLE IF NOT EXISTS aml_events (
                id ${idDef},
                user_id INTEGER NOT NULL,
                event_type TEXT NOT NULL,
                amount NUMERIC(15,2) NOT NULL,
                reference TEXT,
                details TEXT,
                reviewed INTEGER DEFAULT 0,
                reviewed_by INTEGER,
                reviewed_at ${isPg ? 'TIMESTAMPTZ' : 'TEXT'},
                reviewer_notes TEXT,
                created_at ${tsDef}
            )`
        );
        await db.run('CREATE INDEX IF NOT EXISTS idx_aml_user ON aml_events (user_id)');
        await db.run('CREATE INDEX IF NOT EXISTS idx_aml_type ON aml_events (event_type)');
        await db.run('CREATE INDEX IF NOT EXISTS idx_aml_reviewed ON aml_events (reviewed, created_at)');
        _schemaReady = true;
    } catch (err) {
        console.warn('[AML] Schema bootstrap error:', err.message);
    }
}
ensureSchema();

/**
 * Log a single AML event. Fire-and-forget.
 * Never throws — AML logging must not block money operations.
 */
async function logEvent(userId, eventType, amount, reference, details) {
    try {
        await ensureSchema();
        await db.run(
            'INSERT INTO aml_events (user_id, event_type, amount, reference, details) VALUES (?, ?, ?, ?, ?)',
            [
                userId,
                String(eventType).slice(0, 60),
                Number(amount) || 0,
                reference ? String(reference).slice(0, 200) : null,
                details ? (typeof details === 'string' ? details.slice(0, 2000) : JSON.stringify(details).slice(0, 2000)) : null,
            ]
        );
        // Loud log — operators should see these in server output too
        console.warn(`[AML] ${eventType} logged: user=${userId} amount=$${amount} ref=${reference || '—'}`);
    } catch (err) {
        console.warn('[AML] Log event error (non-blocking):', err.message);
    }
}

/**
 * Analyse a deposit against AML thresholds and log any triggered events.
 * Called from the Stripe webhook after a successful credit.
 */
async function analyseDeposit(userId, amount, reference) {
    try {
        if (amount >= LARGE_TX_THRESHOLD) {
            await logEvent(userId, 'large_deposit', amount, reference,
                { threshold: LARGE_TX_THRESHOLD, rule: 'single_transaction' });
        } else if (amount >= STRUCTURING_FLOOR) {
            // Could be structuring — check the 24h aggregate
            const row = await db.get(
                "SELECT COALESCE(SUM(amount), 0) as total, COUNT(*) as count FROM deposits WHERE user_id = ? AND status = 'completed' AND created_at >= datetime('now', '-24 hours')",
                [userId]
            ).catch(() => null);
            const total = (row && row.total) || 0;
            if (total >= DAILY_AGG_THRESHOLD) {
                await logEvent(userId, 'structured_deposits', total, reference,
                    { dailyTotal: total, dailyCount: row.count, thisAmount: amount, threshold: DAILY_AGG_THRESHOLD });
            }
        }
    } catch (err) {
        console.warn('[AML] analyseDeposit error:', err.message);
    }
}

/**
 * Analyse a withdrawal against AML thresholds.
 * Called from /api/payment/withdraw after a successful request.
 */
async function analyseWithdrawal(userId, amount, reference) {
    try {
        if (amount >= LARGE_TX_THRESHOLD) {
            await logEvent(userId, 'large_withdrawal', amount, reference,
                { threshold: LARGE_TX_THRESHOLD, rule: 'single_transaction' });
        }

        // Rapid-turnaround check: deposit within RAPID_TURNAROUND_MIN minutes
        // AND minimal wagering between. Classic laundering pattern.
        const recentDeposit = await db.get(
            `SELECT amount, created_at FROM deposits
             WHERE user_id = ? AND status = 'completed'
               AND created_at >= datetime('now', '-${RAPID_TURNAROUND_MIN} minutes')
             ORDER BY created_at DESC LIMIT 1`,
            [userId]
        ).catch(() => null);

        if (recentDeposit && recentDeposit.amount >= 1000) {
            // Check how much was wagered between deposit and now
            const wagered = await db.get(
                'SELECT COALESCE(SUM(bet_amount), 0) as total FROM spins WHERE user_id = ? AND created_at >= ?',
                [userId, recentDeposit.created_at]
            ).catch(() => ({ total: 0 }));
            const wagerRatio = (wagered.total || 0) / recentDeposit.amount;
            if (wagerRatio < 0.5) {
                await logEvent(userId, 'rapid_turnaround', amount, reference, {
                    recentDeposit: recentDeposit.amount,
                    wagered: wagered.total,
                    wagerRatio: Math.round(wagerRatio * 100) / 100,
                    rule: 'deposit→withdraw within ' + RAPID_TURNAROUND_MIN + 'min with <50% wagered',
                });
            }
        }
    } catch (err) {
        console.warn('[AML] analyseWithdrawal error:', err.message);
    }
}

/**
 * Admin query: unreviewed AML events.
 */
async function getUnreviewedEvents(limit) {
    try {
        return await db.all(
            `SELECT e.*, u.username, u.email
             FROM aml_events e
             LEFT JOIN users u ON e.user_id = u.id
             WHERE e.reviewed = 0
             ORDER BY e.created_at DESC
             LIMIT ?`,
            [limit || 100]
        );
    } catch (err) {
        console.warn('[AML] getUnreviewedEvents error:', err.message);
        return [];
    }
}

/**
 * Mark an AML event as reviewed.
 */
async function markReviewed(eventId, reviewerId, notes) {
    await db.run(
        "UPDATE aml_events SET reviewed = 1, reviewed_by = ?, reviewed_at = datetime('now'), reviewer_notes = ? WHERE id = ?",
        [reviewerId, notes ? String(notes).slice(0, 2000) : null, eventId]
    );
}

module.exports = {
    logEvent,
    analyseDeposit,
    analyseWithdrawal,
    getUnreviewedEvents,
    markReviewed,
    LARGE_TX_THRESHOLD,
    DAILY_AGG_THRESHOLD,
    STRUCTURING_FLOOR,
    RAPID_TURNAROUND_MIN,
};
