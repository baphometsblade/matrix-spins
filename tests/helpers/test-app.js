/**
 * Test Express app builder.
 *
 * Spins up a minimal Express app for integration tests — wires the auth
 * middleware and a hand-picked set of routes, without starting Socket.IO,
 * static-file serving, schedulers, etc.
 *
 * Tests use supertest against this app rather than launching the full
 * server.
 */

'use strict';

const express = require('express');
const cookieParser = require('cookie-parser');

function buildApp({ routes = [] } = {}) {
    const app = express();
    app.use(express.json({ limit: '100kb' }));
    app.use(express.urlencoded({ extended: false }));
    app.use(cookieParser());

    // Trust proxy so rate limiters look at the right key
    app.set('trust proxy', 1);

    // Apply optional auth before routes
    const auth = require('../../server/middleware/auth');
    app.use('/api', auth.optionalAuth);

    // Mount each requested route
    for (const { prefix, modulePath } of routes) {
        try {
            const mod = require(modulePath);
            const router = mod && mod.router ? mod.router : mod;
            app.use(prefix, router);
        } catch (err) {
            console.warn(`[test-app] Failed to mount ${prefix} from ${modulePath}: ${err.message}`);
        }
    }

    // Generic error handler so test failures don't crash with HTML 500
    app.use((err, req, res, _next) => {
        if (!res.headersSent) {
            res.status(err.status || 500).json({ error: err.message || 'Server error' });
        }
    });

    return app;
}

module.exports = { buildApp };
