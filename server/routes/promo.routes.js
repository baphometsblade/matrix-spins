'use strict';

/**
 * User-facing promo / bonus code endpoints.
 *
 *   POST /api/promo/redeem    — redeem a code, credit balance
 *   GET  /api/promo/me        — list your own redemptions
 *
 * The authenticated middleware in server/index.js already runs
 * ahead of this router; both endpoints require a logged-in user.
 * CSRF is enforced by the global app.use('/api', csrfMiddleware)
 * for the POST.
 *
 * Operator-side endpoints (create / list / deactivate codes) live
 * in server/routes/admin.routes.js to keep admin auth concerns in
 * one place.
 */

const express = require('express');
const rateLimit = require('express-rate-limit');
const { authenticate } = require('../middleware/auth');
const promo = require('../services/promo.service');

const router = express.Router();

// Per-IP redeem limiter: stops trivial brute-force enumeration of
// valid codes via the public surface. 20 attempts / 5 min is plenty
// for legitimate users mistyping; a brute-force run hits the wall
// fast. Reuses express-rate-limit (already a dep).
const redeemLimiter = rateLimit({
    windowMs: 5 * 60 * 1000,
    max: 20,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many redemption attempts. Try again later.' },
});

router.post('/redeem', authenticate, redeemLimiter, async (req, res) => {
    try {
        const result = await promo.redeem(req.user.id, req.body && req.body.code);
        res.json({
            success: true,
            code: result.code,
            value_cents: result.value_cents,
            balance_after_cents: result.balance_after_cents,
            message: 'Redeemed +$' + (result.value_cents / 100).toFixed(2) + '.',
        });
    } catch (err) {
        const status = err.status || 500;
        if (status >= 500) console.error('[promo/redeem]', err);
        res.status(status).json({
            error: err.message || 'Redemption failed.',
            code: err.code || undefined,
        });
    }
});

router.get('/me', authenticate, async (req, res) => {
    try {
        const rows = await promo.listOwnRedemptions(req.user.id);
        res.json({ redemptions: rows });
    } catch (err) {
        console.error('[promo/me]', err);
        res.status(500).json({ error: 'Failed to load redemptions.' });
    }
});

module.exports = router;
