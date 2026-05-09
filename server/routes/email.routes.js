'use strict';

/**
 * Player-facing email preferences + unsubscribe endpoints.
 *
 *   GET  /api/email/preferences            — current prefs (auth)
 *   PUT  /api/email/preferences            — update prefs   (auth)
 *   GET  /api/email/unsubscribe?t=TOKEN    — one-click unsub (token, no auth)
 *   POST /api/email/unsubscribe            — confirm unsub via JSON
 *   POST /api/email/resubscribe            — re-enable everything (auth)
 *   GET  /api/email/queue/status           — quick health check
 */

const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth');
const emailService = require('../services/email.service');
const db = require('../database');

// ─── Preferences ────────────────────────────────────────────

router.get('/preferences', authenticate, async (req, res) => {
    try {
        const prefs = await emailService.getPreferences(req.user.id);
        res.json({ success: true, preferences: prefs });
    } catch (err) {
        console.error('[email/preferences GET]', err);
        res.status(500).json({ error: 'Failed to load preferences' });
    }
});

router.put('/preferences', authenticate, async (req, res) => {
    try {
        const { promotional, reengagement, account, unsubscribed_all } = req.body || {};
        await emailService.setPreferences(req.user.id, {
            promotional: !!promotional,
            reengagement: !!reengagement,
            account: !!account,
            unsubscribed_all: !!unsubscribed_all,
        });
        const prefs = await emailService.getPreferences(req.user.id);
        res.json({ success: true, preferences: prefs });
    } catch (err) {
        console.error('[email/preferences PUT]', err);
        res.status(500).json({ error: 'Failed to update preferences' });
    }
});

// ─── Unsubscribe via signed token (one-click email link) ────

router.get('/unsubscribe', async (req, res) => {
    const token = req.query.t;
    const userId = emailService.verifyUnsubscribeToken(token);
    if (!userId) {
        return res.status(400).send(_unsubPage({
            ok: false,
            title: 'Invalid unsubscribe link',
            message: 'This link is malformed or has expired. Please log in to manage your email preferences.',
        }));
    }
    try {
        await emailService.setPreferences(userId, {
            promotional: false,
            reengagement: false,
            account: true,
            unsubscribed_all: false,
        });
        res.send(_unsubPage({
            ok: true,
            title: 'Unsubscribed',
            message: 'You have been unsubscribed from promotional and re-engagement emails. You will still receive transactional notifications (deposits, withdrawals, security).',
        }));
    } catch (err) {
        console.error('[email/unsubscribe GET]', err);
        res.status(500).send(_unsubPage({
            ok: false,
            title: 'Something went wrong',
            message: 'We could not update your preferences. Please try again or contact support.',
        }));
    }
});

router.post('/unsubscribe', async (req, res) => {
    const token = (req.body && req.body.token) || req.query.t;
    const userId = emailService.verifyUnsubscribeToken(token);
    if (!userId) return res.status(400).json({ error: 'Invalid token' });
    try {
        await emailService.setPreferences(userId, {
            promotional: false,
            reengagement: false,
            account: true,
            unsubscribed_all: false,
        });
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: 'Failed to unsubscribe' });
    }
});

router.post('/resubscribe', authenticate, async (req, res) => {
    try {
        await emailService.setPreferences(req.user.id, {
            promotional: true, reengagement: true, account: true, unsubscribed_all: false,
        });
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: 'Failed to resubscribe' });
    }
});

router.get('/queue/status', async (req, res) => {
    try {
        const stats = await emailService.getQueueStats();
        res.json({ success: true, available: emailService.isAvailable(), queue: stats });
    } catch (err) {
        res.status(500).json({ error: 'Failed to load queue status' });
    }
});

function _unsubPage({ ok, title, message }) {
    const accent = ok ? '#00ff41' : '#ff3860';
    return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${title}</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
body{margin:0;background:#0a0e0a;color:#d6f5d6;font-family:'Segoe UI',Roboto,Helvetica,Arial,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;padding:20px;}
.card{max-width:480px;background:linear-gradient(135deg,#0d1f0d,#051005);border:1px solid rgba(0,255,65,0.3);border-left:3px solid ${accent};border-radius:14px;padding:32px;box-shadow:0 0 40px rgba(0,255,65,0.08);}
h1{margin:0 0 16px;color:${accent};font-family:'Courier New',monospace;font-size:22px;letter-spacing:1px;}
p{line-height:1.65;color:#d6f5d6;}
a{color:#00ff41;}
.foot{margin-top:24px;font-size:12px;color:#6a8a6a;}
</style></head>
<body><div class="card">
<h1>${title}</h1><p>${message}</p>
<p class="foot"><a href="https://msaart.online/email-preferences.html">Manage email preferences</a> &middot; <a href="https://msaart.online">Return to Matrix Spins</a></p>
</div></body></html>`;
}

module.exports = router;
