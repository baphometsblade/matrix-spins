'use strict';

/**
 * Periodic maintenance cron.
 *
 * Sweeps rows that accumulate with no cleanup path elsewhere:
 *   - password_resets: used or expired tokens are never needed again
 *   - processed_webhook_events: after 90 days Stripe will not retry any
 *     event we already processed, so we can trim the ledger
 *
 * Runs once on boot (so a freshly-redeployed server cleans up on
 * startup) and then hourly. Disable with MAINTENANCE_CRON_DISABLED=1
 * for tests.
 */

const cron = require('node-cron');
const db = require('../database');

const WEBHOOK_RETENTION_DAYS = 90;

let scheduled = null;
let lastRun = { startedAt: null, finishedAt: null, summary: null, error: null };

async function sweepExpiredPasswordResets() {
    const nowIso = new Date().toISOString();
    const r1 = await db.run('DELETE FROM password_resets WHERE used_at IS NOT NULL', []);
    const r2 = await db.run('DELETE FROM password_resets WHERE expires_at < ?', [nowIso]);
    return {
        used_rows_deleted: (r1 && r1.changes) || 0,
        expired_rows_deleted: (r2 && r2.changes) || 0,
    };
}

async function sweepOldProcessedEvents() {
    const cutoff = new Date(Date.now() - WEBHOOK_RETENTION_DAYS * 86400000).toISOString();
    const r = await db.run('DELETE FROM processed_webhook_events WHERE processed_at < ?', [cutoff]);
    return { old_webhook_events_deleted: (r && r.changes) || 0 };
}

async function sweepExpiredEmailTokens() {
    const nowIso = new Date().toISOString();
    const r1 = await db.run('DELETE FROM email_verification_tokens WHERE used_at IS NOT NULL', []);
    const r2 = await db.run('DELETE FROM email_verification_tokens WHERE expires_at < ?', [nowIso]);
    return {
        email_tokens_used_deleted: (r1 && r1.changes) || 0,
        email_tokens_expired_deleted: (r2 && r2.changes) || 0,
    };
}

async function runOnce() {
    const startedAt = new Date().toISOString();
    lastRun = { startedAt, finishedAt: null, summary: null, error: null };
    try {
        const summary = Object.assign(
            {},
            await sweepExpiredPasswordResets(),
            await sweepOldProcessedEvents(),
            await sweepExpiredEmailTokens()
        );
        lastRun = { startedAt, finishedAt: new Date().toISOString(), summary, error: null };
        const changed = Object.values(summary).some(v => v > 0);
        if (changed) console.log('[maintenance] ' + JSON.stringify(summary));
        return summary;
    } catch (err) {
        lastRun = { startedAt, finishedAt: new Date().toISOString(), summary: null, error: err.message };
        console.warn('[maintenance] run failed:', err.message);
        throw err;
    }
}

function schedule() {
    if (process.env.MAINTENANCE_CRON_DISABLED === '1') {
        console.log('[maintenance] disabled via MAINTENANCE_CRON_DISABLED=1');
        return;
    }
    if (scheduled) return;
    // Fire once shortly after boot, then hourly on the zero minute.
    setTimeout(() => { runOnce().catch(() => {}); }, 10000).unref();
    scheduled = cron.schedule('0 * * * *', () => {
        runOnce().catch(err => console.warn('[maintenance] tick failed:', err.message));
    });
    console.log('[maintenance] scheduled hourly; first sweep in 10s');
}

function stop() {
    if (scheduled) { scheduled.stop(); scheduled = null; }
}

function getStatus() {
    return { scheduled: !!scheduled, last_run: lastRun };
}

module.exports = { runOnce, schedule, stop, getStatus };
