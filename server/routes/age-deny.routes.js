'use strict';

/**
 * Age-Gate Deny Audit Endpoint
 *
 * Players who click "I am under 18" on the age gate (js/age-gate.js) hit this
 * route just before being navigated to google.com. The deny choice is also
 * persisted in localStorage for 30 days so the back-button bypass is closed,
 * but a server-side audit row is the only thing that's actually defensible
 * in a compliance audit (the client-side flag can be cleared).
 *
 * Schema: a single `age_deny_log` table with IP, user-agent, and timestamp.
 * No user_id because by definition the player is NOT signed in.
 *
 * IMPORTANT: no auth, no CSRF — this is fired with `keepalive: true` from a
 * page that is about to navigate away. Rate-limited to prevent abuse.
 */

const express = require('express');
const rateLimit = require('express-rate-limit');
const db = require('../database');

const router = express.Router();

// Bootstrap the audit table. Idempotent.
(async function ensureTable() {
    try {
        await db.run(`
            CREATE TABLE IF NOT EXISTS age_deny_log (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                ip TEXT,
                user_agent TEXT,
                created_at TEXT DEFAULT CURRENT_TIMESTAMP
            )
        `);
    } catch (err) {
        console.warn('[AgeDeny] schema bootstrap failed:', err.message);
    }
})();

// Rate limit: max 20 deny events per IP per hour. A determined script
// could still fill the table, but a single curious user can't.
const denyLimiter = rateLimit({
    windowMs: 60 * 60 * 1000,
    max: 20,
    message: { ok: false },
});

router.post('/', denyLimiter, async (req, res) => {
    const ip = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
    const ua = String(req.headers['user-agent'] || '').slice(0, 500);
    try {
        await db.run(
            'INSERT INTO age_deny_log (ip, user_agent) VALUES (?, ?)',
            [ip, ua]
        );
    } catch (err) {
        // Never block the user navigation on a DB hiccup.
        console.warn('[AgeDeny] insert failed:', err.message);
    }
    res.json({ ok: true });
});

module.exports = router;
