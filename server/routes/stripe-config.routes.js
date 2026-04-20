'use strict';

const express = require('express');
const config = require('../config');

const router = express.Router();

/**
 * Public endpoint the frontend uses to decide whether to show the
 * deposit button at all, and to load Stripe.js with the right key.
 * Exposes only non-secret values.
 */
router.get('/', (_req, res) => {
    res.json({
        enabled: !!config.STRIPE_SECRET_KEY,
        publishable_key: config.STRIPE_PUBLISHABLE_KEY || null,
        webhookConfigured: !!config.STRIPE_WEBHOOK_SECRET,
    });
});

module.exports = router;
