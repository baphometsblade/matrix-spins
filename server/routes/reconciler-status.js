'use strict';

/**
 * Tiny indirection so health.routes can read reconciler status without
 * pulling in the full deposit-reconciler service module (which loads
 * node-cron + Stripe). Keeps the health endpoint cheap.
 */

function snapshot() {
    try {
        const reconciler = require('../services/deposit-reconciler.service');
        return reconciler.getStatus();
    } catch (err) {
        return { error: err.message };
    }
}

module.exports = { snapshot };
