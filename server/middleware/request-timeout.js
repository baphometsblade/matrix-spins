'use strict';

/**
 * Request timeout middleware.
 *
 * Express doesn't apply a hard upper bound on response time. A single
 * hung request can tie up a worker forever — particularly on the
 * Stripe webhook path if the payment provider lags, or on the refund
 * flow if stripe.refunds.create() is slow. This middleware forces a
 * 503 after `ms` if no response has been sent.
 *
 * The webhook path is intentionally given a longer budget because
 * retries are expensive.
 */

module.exports = function requestTimeout({ defaultMs = 30000, paths = {} } = {}) {
    return function timeout(req, res, next) {
        let ms = defaultMs;
        for (const p of Object.keys(paths)) {
            if (req.path === p || req.path.startsWith(p + '/') || req.path.startsWith(p)) { ms = paths[p]; break; }
        }
        const timer = setTimeout(() => {
            if (res.headersSent) return;
            try {
                res.status(503).json({ error: 'Request timed out.', timeout_ms: ms });
            } catch (err) {
                // Response may already be closing; nothing more to do.
            }
        }, ms);
        timer.unref();
        res.on('finish', () => clearTimeout(timer));
        res.on('close', () => clearTimeout(timer));
        next();
    };
};
