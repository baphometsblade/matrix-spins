'use strict';

// Bundles purchase stub.
// Returns 501 (Not Implemented) until Stripe is wired so the smoke test
// (scripts/smoke-money-flow.js) can verify no revenue leak in unconfigured envs.
// When STRIPE_SECRET_KEY is set, this should be replaced/superseded by the
// real bundle purchase implementation in payment.routes.js or stripe-checkout.routes.js.

const router = require('express').Router();
const config = require('../config');

router.post('/purchase', (req, res) => {
  if (!config.STRIPE_SECRET_KEY) {
    return res.status(501).json({
      error: 'Bundle purchases are temporarily disabled — Stripe is not configured on this deployment.',
      code: 'STRIPE_NOT_CONFIGURED',
    });
  }
  // Placeholder for real implementation.
  return res.status(501).json({
    error: 'Bundle purchases not yet implemented. Use /api/payment/create-checkout instead.',
    code: 'NOT_IMPLEMENTED',
  });
});

router.get('/', (_req, res) => {
  res.json({ bundles: [], note: 'Bundle product catalog not yet configured.' });
});

module.exports = router;
