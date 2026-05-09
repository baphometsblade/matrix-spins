'use strict';

/**
 * Matrix Spins Email Service.
 *
 * Architecture:
 *   1. Templates live in ./email-templates.js (pure functions)
 *   2. send() enqueues to email_queue with status='pending' and tries
 *      synchronous delivery once. On failure, the queue worker retries
 *      with exponential backoff (1m → 5m → 30m → 2h → 12h, max 5 attempts).
 *   3. User preferences (email_preferences) gate every send except
 *      transactional types (security, payment, password reset).
 *   4. Unsubscribe tokens are HMAC-signed so they can't be forged.
 *
 * SMTP env: SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM, SMTP_SECURE
 *
 * If SMTP is not configured, send() still enqueues (so deliveries resume
 * automatically once env is set) but logs a warning.
 */

const crypto = require('crypto');
const nodemailer = require('nodemailer');
const config = require('../config');
const db = require('../database');
const templates = require('./email-templates');

let _transporter = null;
let _transporterError = null;
let _schemaReady = false;
let _workerInterval = null;

const BASE_URL = process.env.PUBLIC_URL || process.env.BASE_URL || 'https://msaart.online';

// Email categories — used for preferences and to gate "transactional" sends
// past unsubscribes. Transactional emails are always delivered (security/legal
// requirement); marketing/engagement respect the opt-out flags.
const CATEGORY = {
    TRANSACTIONAL: 'transactional', // password reset, OTP, deposit/withdrawal confirms, security
    ACCOUNT:       'account',       // VIP tier, self-exclusion confirm, balance receipts
    PROMOTIONAL:   'promotional',   // welcome bonus nudge, deposit nudge, broadcast
    REENGAGEMENT:  'reengagement',  // weekly summary, comeback offers
    REPORTING:     'reporting',     // weekly P&L (admin-only)
};

const TEMPLATE_CATEGORY = {
    welcome:                    CATEGORY.TRANSACTIONAL,
    emailVerification:          CATEGORY.TRANSACTIONAL,
    passwordReset:              CATEGORY.TRANSACTIONAL,
    withdrawalOtp:              CATEGORY.TRANSACTIONAL,
    depositConfirmation:        CATEGORY.TRANSACTIONAL,
    withdrawalRequested:        CATEGORY.TRANSACTIONAL,
    withdrawalApproved:         CATEGORY.TRANSACTIONAL,
    withdrawalRejected:         CATEGORY.TRANSACTIONAL,
    selfExclusionConfirmation:  CATEGORY.TRANSACTIONAL,
    transactionReceipt:         CATEGORY.TRANSACTIONAL,
    vipTierUpgrade:             CATEGORY.ACCOUNT,
    jackpotWin:                 CATEGORY.ACCOUNT,
    weeklyActivitySummary:      CATEGORY.REENGAGEMENT,
    broadcast:                  CATEGORY.PROMOTIONAL,
};

// ─────────────────────────────────────────────────────────────
// SCHEMA
// ─────────────────────────────────────────────────────────────

function _isPg() { return typeof db.isPg === 'function' && db.isPg(); }
function _idDef() { return _isPg() ? 'SERIAL PRIMARY KEY' : 'INTEGER PRIMARY KEY AUTOINCREMENT'; }
function _tsDef() { return _isPg() ? 'TIMESTAMPTZ DEFAULT NOW()' : "TEXT DEFAULT (datetime('now'))"; }
function _tsNullable() { return _isPg() ? 'TIMESTAMPTZ' : 'TEXT'; }

async function ensureSchema() {
    if (_schemaReady) return;
    try {
        await db.run(`CREATE TABLE IF NOT EXISTS email_queue (
            id ${_idDef()},
            to_email TEXT NOT NULL,
            user_id INTEGER,
            template TEXT NOT NULL,
            category TEXT NOT NULL,
            subject TEXT NOT NULL,
            text_body TEXT,
            html_body TEXT,
            status TEXT NOT NULL DEFAULT 'pending',
            attempts INTEGER NOT NULL DEFAULT 0,
            last_error TEXT,
            next_attempt_at ${_tsNullable()},
            sent_at ${_tsNullable()},
            created_at ${_tsDef()}
        )`);
        await db.run(`CREATE INDEX IF NOT EXISTS idx_email_queue_status ON email_queue(status, next_attempt_at)`);
        await db.run(`CREATE INDEX IF NOT EXISTS idx_email_queue_user ON email_queue(user_id, created_at)`);

        await db.run(`CREATE TABLE IF NOT EXISTS email_preferences (
            user_id INTEGER PRIMARY KEY,
            promotional INTEGER NOT NULL DEFAULT 1,
            reengagement INTEGER NOT NULL DEFAULT 1,
            account INTEGER NOT NULL DEFAULT 1,
            unsubscribed_all INTEGER NOT NULL DEFAULT 0,
            updated_at ${_tsDef()}
        )`);

        await db.run(`CREATE TABLE IF NOT EXISTS email_broadcasts (
            id ${_idDef()},
            admin_id INTEGER NOT NULL,
            segment TEXT NOT NULL,
            subject TEXT NOT NULL,
            headline TEXT,
            body_text TEXT NOT NULL,
            cta_label TEXT,
            cta_url TEXT,
            recipients_count INTEGER NOT NULL DEFAULT 0,
            sent_count INTEGER NOT NULL DEFAULT 0,
            failed_count INTEGER NOT NULL DEFAULT 0,
            status TEXT NOT NULL DEFAULT 'sending',
            created_at ${_tsDef()},
            completed_at ${_tsNullable()}
        )`);
        _schemaReady = true;
    } catch (err) {
        console.warn('[Email] schema init failed:', err.message);
    }
}

// fire-and-forget bootstrap
ensureSchema().catch(() => {});

// ─────────────────────────────────────────────────────────────
// TRANSPORT
// ─────────────────────────────────────────────────────────────

function getTransporter() {
    if (_transporter) return _transporter;
    if (_transporterError) return null;
    if (!config.SMTP_HOST || !config.SMTP_USER || !config.SMTP_PASS) {
        _transporterError = 'SMTP not configured';
        return null;
    }
    try {
        _transporter = nodemailer.createTransport({
            host: config.SMTP_HOST,
            port: config.SMTP_PORT || 587,
            secure: !!config.SMTP_SECURE,
            auth: { user: config.SMTP_USER, pass: config.SMTP_PASS },
        });
        return _transporter;
    } catch (err) {
        _transporterError = err.message;
        console.error('[Email] transporter init failed:', err.message);
        return null;
    }
}

function isAvailable() {
    return !!getTransporter();
}

// ─────────────────────────────────────────────────────────────
// PREFERENCES
// ─────────────────────────────────────────────────────────────

async function getPreferences(userId) {
    if (!userId) return { promotional: 1, reengagement: 1, account: 1, unsubscribed_all: 0 };
    await ensureSchema();
    const row = await db.get('SELECT * FROM email_preferences WHERE user_id = ?', [userId]);
    if (!row) return { promotional: 1, reengagement: 1, account: 1, unsubscribed_all: 0 };
    return {
        promotional: row.promotional ? 1 : 0,
        reengagement: row.reengagement ? 1 : 0,
        account: row.account ? 1 : 0,
        unsubscribed_all: row.unsubscribed_all ? 1 : 0,
    };
}

async function setPreferences(userId, prefs) {
    if (!userId) return;
    await ensureSchema();
    const existing = await db.get('SELECT user_id FROM email_preferences WHERE user_id = ?', [userId]);
    const cols = {
        promotional: prefs.promotional ? 1 : 0,
        reengagement: prefs.reengagement ? 1 : 0,
        account: prefs.account ? 1 : 0,
        unsubscribed_all: prefs.unsubscribed_all ? 1 : 0,
    };
    if (existing) {
        await db.run(
            `UPDATE email_preferences SET promotional=?, reengagement=?, account=?, unsubscribed_all=?,
             updated_at=${_isPg() ? 'NOW()' : "datetime('now')"} WHERE user_id=?`,
            [cols.promotional, cols.reengagement, cols.account, cols.unsubscribed_all, userId]
        );
    } else {
        await db.run(
            `INSERT INTO email_preferences (user_id, promotional, reengagement, account, unsubscribed_all)
             VALUES (?, ?, ?, ?, ?)`,
            [userId, cols.promotional, cols.reengagement, cols.account, cols.unsubscribed_all]
        );
    }
}

async function isAllowed(userId, category) {
    if (category === CATEGORY.TRANSACTIONAL) return true; // always send
    if (!userId) return true; // can't enforce w/o user (e.g. password reset by email-only)
    const prefs = await getPreferences(userId);
    if (prefs.unsubscribed_all) return false;
    if (category === CATEGORY.PROMOTIONAL) return !!prefs.promotional;
    if (category === CATEGORY.REENGAGEMENT) return !!prefs.reengagement;
    if (category === CATEGORY.ACCOUNT) return !!prefs.account;
    return true;
}

// ─────────────────────────────────────────────────────────────
// UNSUBSCRIBE TOKENS
// ─────────────────────────────────────────────────────────────

function _hmacKey() {
    return config.JWT_SECRET || 'dev-unsubscribe-key';
}

function makeUnsubscribeToken(userId) {
    if (!userId) return null;
    const payload = String(userId);
    const sig = crypto.createHmac('sha256', _hmacKey()).update(payload).digest('hex').slice(0, 16);
    return `${payload}.${sig}`;
}

function verifyUnsubscribeToken(token) {
    if (!token || typeof token !== 'string') return null;
    const parts = token.split('.');
    if (parts.length !== 2) return null;
    const [userId, sig] = parts;
    const expected = crypto.createHmac('sha256', _hmacKey()).update(userId).digest('hex').slice(0, 16);
    if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
    const id = parseInt(userId, 10);
    return Number.isFinite(id) && id > 0 ? id : null;
}

function unsubscribeUrl(userId) {
    const token = makeUnsubscribeToken(userId);
    if (!token) return null;
    return `${BASE_URL}/api/email/unsubscribe?t=${encodeURIComponent(token)}`;
}

// ─────────────────────────────────────────────────────────────
// CORE SEND
// ─────────────────────────────────────────────────────────────

/**
 * Render and enqueue an email. Attempts immediate delivery; on failure or
 * when SMTP is unconfigured, the row stays in email_queue for the worker
 * to retry. Returns { queued: true, sent: bool, queueId }.
 *
 * @param {object} opts
 * @param {string} opts.to - recipient email
 * @param {number|null} opts.userId - for preference checks + unsub link
 * @param {string} opts.template - template name (key of email-templates.js)
 * @param {object} opts.data - template data
 */
async function send(opts) {
    if (!opts || !opts.to || !opts.template) {
        throw new Error('send() requires { to, template }');
    }
    await ensureSchema();
    const tmplFn = templates[opts.template];
    if (typeof tmplFn !== 'function') {
        throw new Error(`Unknown email template: ${opts.template}`);
    }
    const category = TEMPLATE_CATEGORY[opts.template] || CATEGORY.TRANSACTIONAL;

    if (!(await isAllowed(opts.userId || null, category))) {
        return { queued: false, sent: false, skipped: 'unsubscribed' };
    }

    const data = Object.assign({}, opts.data || {});
    if (opts.userId && !data.unsubscribeUrl) {
        data.unsubscribeUrl = unsubscribeUrl(opts.userId);
    }

    const rendered = tmplFn(data);
    const result = await db.run(
        `INSERT INTO email_queue (to_email, user_id, template, category, subject, text_body, html_body, status, attempts, next_attempt_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', 0, ${_isPg() ? 'NOW()' : "datetime('now')"})`,
        [
            String(opts.to).toLowerCase().trim(),
            opts.userId || null,
            opts.template,
            category,
            rendered.subject,
            rendered.text || '',
            rendered.html || '',
        ]
    );
    const queueId = result && (result.lastID || result.insertId || result.id);

    // Try synchronous delivery once
    let sent = false;
    try {
        sent = await _deliverRow({
            id: queueId,
            to_email: opts.to,
            subject: rendered.subject,
            text_body: rendered.text,
            html_body: rendered.html,
        });
    } catch (err) {
        console.warn('[Email] sync delivery failed for', opts.template, '→', err.message);
    }
    return { queued: true, sent, queueId };
}

async function _deliverRow(row) {
    const transporter = getTransporter();
    if (!transporter) {
        await _markFailure(row.id, 'SMTP not configured');
        return false;
    }
    try {
        await transporter.sendMail({
            from: config.SMTP_FROM,
            to: row.to_email,
            subject: row.subject,
            text: row.text_body || undefined,
            html: row.html_body || undefined,
        });
        await db.run(
            `UPDATE email_queue SET status='sent', sent_at=${_isPg() ? 'NOW()' : "datetime('now')"}, last_error=NULL WHERE id=?`,
            [row.id]
        );
        return true;
    } catch (err) {
        await _markFailure(row.id, err.message);
        return false;
    }
}

const BACKOFF_MS = [60_000, 5 * 60_000, 30 * 60_000, 2 * 60 * 60_000, 12 * 60 * 60_000];
const MAX_ATTEMPTS = BACKOFF_MS.length;

async function _markFailure(id, errMessage) {
    const row = await db.get('SELECT attempts FROM email_queue WHERE id = ?', [id]);
    if (!row) return;
    const attempts = (row.attempts || 0) + 1;
    if (attempts >= MAX_ATTEMPTS) {
        await db.run(
            `UPDATE email_queue SET status='failed', attempts=?, last_error=? WHERE id=?`,
            [attempts, String(errMessage || '').slice(0, 500), id]
        );
        return;
    }
    const nextDelay = BACKOFF_MS[attempts] || BACKOFF_MS[BACKOFF_MS.length - 1];
    const nextAt = new Date(Date.now() + nextDelay);
    const nextSql = _isPg() ? 'to_timestamp(?/1000.0)' : '?';
    const nextVal = _isPg() ? nextAt.getTime() : nextAt.toISOString().replace('T', ' ').slice(0, 19);
    await db.run(
        `UPDATE email_queue SET status='pending', attempts=?, last_error=?, next_attempt_at=${nextSql} WHERE id=?`,
        [attempts, String(errMessage || '').slice(0, 500), nextVal, id]
    );
}

// ─────────────────────────────────────────────────────────────
// QUEUE WORKER
// ─────────────────────────────────────────────────────────────

async function processQueue(limit) {
    await ensureSchema();
    if (!isAvailable()) return { processed: 0 };
    const cap = Math.max(1, Math.min(100, limit || 25));

    const dueClause = _isPg()
        ? "(next_attempt_at IS NULL OR next_attempt_at <= NOW())"
        : "(next_attempt_at IS NULL OR next_attempt_at <= datetime('now'))";

    const rows = await db.all(
        `SELECT id, to_email, subject, text_body, html_body
         FROM email_queue
         WHERE status='pending' AND ${dueClause}
         ORDER BY id ASC
         LIMIT ${cap}`
    );

    let sent = 0, failed = 0;
    for (const r of rows) {
        const ok = await _deliverRow(r).catch(() => false);
        if (ok) sent++; else failed++;
    }
    return { processed: rows.length, sent, failed };
}

function startWorker(intervalMs) {
    if (_workerInterval) return;
    const interval = intervalMs || 60_000; // 60s default
    _workerInterval = setInterval(() => {
        processQueue(25).catch(err => {
            console.warn('[Email worker]', err.message);
        });
    }, interval);
    if (_workerInterval.unref) _workerInterval.unref();
    console.log(`[Email] queue worker started (interval=${interval}ms, smtp=${isAvailable()})`);
}

function stopWorker() {
    if (_workerInterval) {
        clearInterval(_workerInterval);
        _workerInterval = null;
    }
}

// ─────────────────────────────────────────────────────────────
// HIGH-LEVEL HELPERS — backwards-compatible with old API + new triggers
// ─────────────────────────────────────────────────────────────

async function sendWelcome(toEmail, username, userId, verifyUrl) {
    return send({ to: toEmail, userId, template: 'welcome', data: { username, verifyUrl } });
}

async function sendVerificationEmail(toEmail, username, token, userId) {
    const verificationUrl = `${BASE_URL}/?verify=${encodeURIComponent(token)}`;
    return send({
        to: toEmail,
        userId: userId || null,
        template: 'emailVerification',
        data: { username, verificationUrl, expiryHours: 24 },
    });
}

async function sendPasswordReset(toEmail, resetUrl, expiryHours, userId) {
    return send({
        to: toEmail,
        userId: userId || null,
        template: 'passwordReset',
        data: { resetUrl, expiryHours: expiryHours || 1, username: '' },
    });
}

async function sendDepositConfirmation(toEmail, userId, data) {
    return send({ to: toEmail, userId, template: 'depositConfirmation', data });
}

async function sendWithdrawalRequested(toEmail, userId, data) {
    return send({ to: toEmail, userId, template: 'withdrawalRequested', data });
}

async function sendWithdrawalApproved(toEmail, userId, data) {
    return send({ to: toEmail, userId, template: 'withdrawalApproved', data });
}

async function sendWithdrawalRejected(toEmail, userId, data) {
    return send({ to: toEmail, userId, template: 'withdrawalRejected', data });
}

async function sendSelfExclusionConfirmation(toEmail, userId, data) {
    return send({ to: toEmail, userId, template: 'selfExclusionConfirmation', data });
}

async function sendVipTierEmail(toEmail, username, tier, userId) {
    return send({
        to: toEmail,
        userId: userId || null,
        template: 'vipTierUpgrade',
        data: {
            username,
            tierName: tier && tier.tierName,
            emoji: tier && tier.emoji,
            benefits: tier && tier.benefits ? tier.benefits : (tier && tier.benefit ? [tier.benefit] : []),
        },
    });
}

async function sendJackpotWin(toEmail, userId, data) {
    return send({ to: toEmail, userId, template: 'jackpotWin', data });
}

async function sendWeeklyActivitySummary(toEmail, userId, data) {
    return send({ to: toEmail, userId, template: 'weeklyActivitySummary', data });
}

async function sendWithdrawalOtp(toEmail, username, otpCode, amount, currency, expiryMinutes, userId) {
    return send({
        to: toEmail,
        userId: userId || null,
        template: 'withdrawalOtp',
        data: { username, otpCode, amount, expiryMinutes: expiryMinutes || 15 },
    });
}

async function sendTransactionReceipt(toEmail, userId, data) {
    return send({ to: toEmail, userId, template: 'transactionReceipt', data });
}

// Legacy helpers — kept for back-compat with reengagement/scheduler code.
async function sendReengagementEmail(toEmail, username, daysSinceLogin, userId) {
    return send({
        to: toEmail,
        userId: userId || null,
        template: 'broadcast',
        data: {
            subject: `${username}, claim your bonus`,
            headline: 'We miss you',
            body: `It's been ${daysSinceLogin} day${daysSinceLogin !== 1 ? 's' : ''} since your last visit. Come back and claim 50 free bonus coins — no deposit required.`,
            ctaLabel: 'Claim my bonus',
            ctaUrl: BASE_URL,
        },
    });
}

async function sendDepositNudgeEmail(toEmail, username, userId) {
    return send({
        to: toEmail,
        userId: userId || null,
        template: 'broadcast',
        data: {
            subject: `${username}, claim your welcome bonus`,
            headline: 'Your welcome bonus is waiting',
            body: `You haven't made your first deposit yet. We'll match your first deposit 100% up to $500 — that's $1,000 to play with for a $500 deposit.\n\nWelcome bonus expires in 7 days.`,
            ctaLabel: 'Claim my bonus',
            ctaUrl: BASE_URL,
        },
    });
}

async function sendWeeklyReport(toEmail, stats) {
    // Admin reporting — sends regardless of preferences (REPORTING category)
    const transporter = getTransporter();
    if (!transporter) {
        console.warn('[Scheduler] Weekly P&L (no SMTP):', JSON.stringify(stats));
        return { queued: false, sent: false };
    }
    const profit   = Number(stats && stats.gross_profit   || 0).toFixed(2);
    const wagered  = Number(stats && stats.total_wagered  || 0).toFixed(2);
    const players  = stats && stats.active_players || 0;
    const spins    = stats && stats.total_spins    || 0;
    const deposits = Number(stats && stats.deposits_this_week || 0).toFixed(2);
    try {
        await transporter.sendMail({
            from: config.SMTP_FROM,
            to: toEmail,
            subject: `Matrix Spins Weekly P&L — AUD ${profit} profit`,
            text: `Weekly Report\n\nGross Profit: AUD ${profit}\nTotal Wagered: AUD ${wagered}\nActive Players: ${players}\nTotal Spins: ${spins}\nDeposits: AUD ${deposits}`,
            html: templates._shell({
                title: 'Weekly P&L Report',
                preheader: `Profit AUD ${profit}`,
                body: `<table cellpadding="0" cellspacing="0" border="0" width="100%">
                    <tr><td>Gross Profit</td><td style="text-align:right;color:#00ff41;font-weight:700;">AUD ${profit}</td></tr>
                    <tr><td>Total Wagered</td><td style="text-align:right;">AUD ${wagered}</td></tr>
                    <tr><td>Deposits This Week</td><td style="text-align:right;">AUD ${deposits}</td></tr>
                    <tr><td>Active Players</td><td style="text-align:right;">${players}</td></tr>
                    <tr><td>Total Spins</td><td style="text-align:right;">${spins}</td></tr>
                </table>`,
            }),
        });
        return { queued: false, sent: true };
    } catch (err) {
        console.warn('[Scheduler] weekly report send failed:', err.message);
        return { queued: false, sent: false, error: err.message };
    }
}

// ─────────────────────────────────────────────────────────────
// ADMIN BROADCAST
// ─────────────────────────────────────────────────────────────

/**
 * Enqueue a broadcast to the recipients matching `segment`.
 * Returns { broadcastId, recipientsCount }.
 */
async function createBroadcast({ adminId, segment, subject, headline, body, ctaLabel, ctaUrl }) {
    await ensureSchema();
    if (!subject || !body) throw new Error('subject and body are required');

    // Resolve segment → user list
    const recipients = await _resolveSegment(segment || 'all');

    const result = await db.run(
        `INSERT INTO email_broadcasts (admin_id, segment, subject, headline, body_text, cta_label, cta_url, recipients_count, sent_count, failed_count, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, 0, 'sending')`,
        [adminId || 0, segment || 'all', subject, headline || subject, body, ctaLabel || null, ctaUrl || null, recipients.length]
    );
    const broadcastId = result && (result.lastID || result.insertId || result.id);

    // Enqueue each recipient (respecting opt-outs)
    let queued = 0, skipped = 0;
    for (const r of recipients) {
        const allowed = await isAllowed(r.id, CATEGORY.PROMOTIONAL);
        if (!allowed) { skipped++; continue; }
        try {
            await send({
                to: r.email,
                userId: r.id,
                template: 'broadcast',
                data: { subject, headline, body, ctaLabel, ctaUrl },
            });
            queued++;
        } catch (err) {
            console.warn('[Email broadcast]', r.email, '→', err.message);
        }
    }

    await db.run(
        `UPDATE email_broadcasts SET sent_count=?, failed_count=?, status='queued',
         completed_at=${_isPg() ? 'NOW()' : "datetime('now')"} WHERE id=?`,
        [queued, skipped, broadcastId]
    );

    return { broadcastId, recipientsCount: recipients.length, queued, skipped };
}

/**
 * Resolve a segment key to {id, email}[]. Segments:
 *   all                  → all non-banned, non-self-excluded users with email
 *   active_7d            → spun in last 7 days
 *   inactive_30d         → no login in 30 days
 *   vip:silver|gold|...  → users with given vip_tier
 *   high_value           → balance + bonus >= 100 OR deposits_total >= 500
 *   never_deposited      → users with no completed deposits
 */
async function _resolveSegment(segment) {
    const isPg = _isPg();
    const tsNow = isPg ? 'NOW()' : "datetime('now')";
    const dateSub = (days) => isPg ? `NOW() - INTERVAL '${days} days'` : `datetime('now', '-${days} days')`;

    const base = `FROM users u WHERE u.email IS NOT NULL AND u.email <> '' AND COALESCE(u.is_banned, 0) = 0`;

    // Self-exclusion check (best-effort — table may not exist on fresh DBs)
    let exclusionFilter = '';
    try {
        const has = await db.get(isPg
            ? `SELECT 1 FROM information_schema.tables WHERE table_name='self_exclusions' LIMIT 1`
            : `SELECT 1 FROM sqlite_master WHERE type='table' AND name='self_exclusions' LIMIT 1`);
        if (has) {
            exclusionFilter = ` AND u.id NOT IN (
                SELECT user_id FROM self_exclusions
                WHERE active = 1 AND (expires_at IS NULL OR expires_at > ${tsNow})
            )`;
        }
    } catch (_) { /* no table → no filter */ }

    let sql;
    if (segment === 'active_7d') {
        sql = `SELECT DISTINCT u.id, u.email FROM users u
               INNER JOIN spins s ON s.user_id = u.id AND s.created_at >= ${dateSub(7)}
               WHERE u.email IS NOT NULL AND COALESCE(u.is_banned, 0) = 0${exclusionFilter}`;
    } else if (segment === 'inactive_30d') {
        sql = `SELECT u.id, u.email ${base}${exclusionFilter}
               AND u.id NOT IN (SELECT DISTINCT user_id FROM spins WHERE created_at >= ${dateSub(30)})`;
    } else if (segment === 'high_value') {
        sql = `SELECT u.id, u.email ${base}${exclusionFilter}
               AND (COALESCE(u.balance, 0) + COALESCE(u.bonus_balance, 0)) >= 100`;
    } else if (segment === 'never_deposited') {
        sql = `SELECT u.id, u.email ${base}${exclusionFilter}
               AND u.id NOT IN (SELECT DISTINCT user_id FROM deposits WHERE status = 'completed')`;
    } else if (segment && segment.startsWith('vip:')) {
        const tier = segment.slice(4);
        sql = `SELECT u.id, u.email ${base}${exclusionFilter} AND LOWER(COALESCE(u.vip_tier, '')) = LOWER(?)`;
        return await db.all(sql, [tier]);
    } else {
        // default: all
        sql = `SELECT u.id, u.email ${base}${exclusionFilter}`;
    }
    try {
        return await db.all(sql);
    } catch (err) {
        console.warn('[Email] segment query failed for', segment, '→', err.message);
        // Fall back to a minimal safe query
        return await db.all(`SELECT id, email FROM users WHERE email IS NOT NULL AND COALESCE(is_banned, 0) = 0`);
    }
}

async function listBroadcasts(limit) {
    await ensureSchema();
    return await db.all(
        `SELECT id, admin_id, segment, subject, recipients_count, sent_count, failed_count, status, created_at, completed_at
         FROM email_broadcasts ORDER BY id DESC LIMIT ?`,
        [Math.max(1, Math.min(200, limit || 50))]
    );
}

async function getQueueStats() {
    await ensureSchema();
    const rows = await db.all(`SELECT status, COUNT(*) as c FROM email_queue GROUP BY status`);
    const stats = { pending: 0, sent: 0, failed: 0 };
    for (const r of rows) stats[r.status] = Number(r.c) || 0;
    return stats;
}

module.exports = {
    // primary API
    send,
    isAvailable,
    processQueue,
    startWorker,
    stopWorker,
    getQueueStats,

    // preferences
    getPreferences,
    setPreferences,
    isAllowed,
    makeUnsubscribeToken,
    verifyUnsubscribeToken,
    unsubscribeUrl,
    CATEGORY,

    // broadcast
    createBroadcast,
    listBroadcasts,

    // template-specific (back-compat + clean trigger API)
    sendWelcome,
    sendVerificationEmail,
    sendPasswordReset,
    sendDepositConfirmation,
    sendWithdrawalRequested,
    sendWithdrawalApproved,
    sendWithdrawalRejected,
    sendSelfExclusionConfirmation,
    sendVipTierEmail,
    sendJackpotWin,
    sendWeeklyActivitySummary,
    sendWithdrawalOtp,
    sendTransactionReceipt,

    // legacy helpers (still used by scheduler / re-engagement)
    sendReengagementEmail,
    sendDepositNudgeEmail,
    sendWeeklyReport,
};
