'use strict';

/**
 * GET /api/admin/setup-status
 *
 * Returns a structured JSON report of all revenue-critical env vars and DB
 * connectivity WITHOUT exposing actual secret values — only configured: true/false.
 *
 * Used by admin/setup.html to surface configuration gaps to operators.
 */

const express = require('express');
const { authenticate, requireAdmin } = require('../middleware/auth');

const router = express.Router();

/**
 * Checks DB connectivity with a 2-second timeout.
 * Returns { ok, isPg, degraded, error }
 */
async function checkDatabase() {
    try {
        const db = require('../database');
        const timeoutPromise = new Promise((_, reject) =>
            setTimeout(() => reject(new Error('DB ping timeout after 2s')), 2000)
        );
        await Promise.race([db.get('SELECT 1'), timeoutPromise]);

        const degraded = typeof db.isDegraded === 'function' ? db.isDegraded() : false;
        const pgActive = typeof db.isPg === 'function' ? db.isPg() : false;

        return { ok: true, isPg: pgActive, degraded };
    } catch (err) {
        let pgActive = false;
        try {
            const db = require('../database');
            pgActive = typeof db.isPg === 'function' ? db.isPg() : false;
        } catch (_) { /* ignore */ }
        return { ok: false, isPg: pgActive, degraded: true, error: 'Database check failed' };
    }
}

/**
 * GET /api/admin/setup-status
 */
router.get('/', authenticate, requireAdmin, async (req, res) => {
    try {
        // ── Stripe ─────────────────────────────────────────────────────────
        const stripeSecret    = !!process.env.STRIPE_SECRET_KEY;
        const stripePublish   = !!process.env.STRIPE_PUBLISHABLE_KEY;
        const stripeWebhook   = !!process.env.STRIPE_WEBHOOK_SECRET;
        const stripeAllSet    = stripeSecret && stripePublish && stripeWebhook;

        // ── Database ────────────────────────────────────────────────────────
        const dbCheck = await checkDatabase();

        // ── Other env vars ──────────────────────────────────────────────────
        const jwtConfigured        = !!(process.env.JWT_SECRET && process.env.JWT_SECRET.length >= 32);
        const smtpConfigured       = !!(process.env.SMTP_HOST || process.env.SENDGRID_API_KEY || process.env.MAILGUN_API_KEY);
        const adminApiKeyConf      = !!process.env.ADMIN_API_KEY;
        const allowedOriginVal     = process.env.ALLOWED_ORIGIN || '';
        const allowedOriginConf    = !!allowedOriginVal;

        // ── Revenue-blocked list ────────────────────────────────────────────
        const revenueBlocked = [];
        if (!stripeAllSet) revenueBlocked.push('stripe');
        if (!dbCheck.ok || dbCheck.degraded) revenueBlocked.push('database');
        if (!jwtConfigured) revenueBlocked.push('jwt');

        const overallReady = revenueBlocked.length === 0;

        // ── Safe display value for ALLOWED_ORIGIN ───────────────────────────
        // Truncate to domain only — never expose full URLs with tokens/paths
        let originDisplay = null;
        if (allowedOriginConf) {
            try {
                originDisplay = new URL(allowedOriginVal).hostname || allowedOriginVal;
            } catch (_) {
                // not a valid URL — strip to first 40 chars max, safe to show
                originDisplay = allowedOriginVal.replace(/[<>"']/g, '').slice(0, 40);
            }
        }

        res.json({
            stripe: {
                configured: stripeAllSet,
                blocksRevenue: true,
                keys: {
                    secretKey:      { configured: stripeSecret },
                    publishableKey: { configured: stripePublish },
                    webhookSecret:  { configured: stripeWebhook },
                },
            },
            database: {
                configured: dbCheck.ok,
                isPg:       dbCheck.isPg,
                degraded:   dbCheck.degraded,
                ...(dbCheck.error ? { error: dbCheck.error } : {}),
            },
            jwt: {
                configured: jwtConfigured,
            },
            smtp: {
                configured: smtpConfigured,
            },
            adminApiKey: {
                configured: adminApiKeyConf,
            },
            allowedOrigin: {
                configured: allowedOriginConf,
                value:      originDisplay,
            },
            overallReady,
            revenueBlocked,
            timestamp: new Date().toISOString(),
        });
    } catch (err) {
        console.error('[setup-status] Unexpected error:', err.message);
        res.status(500).json({ error: 'Failed to retrieve setup status' });
    }
});

module.exports = router;
