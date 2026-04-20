'use strict';

/**
 * Maintenance mode gate. When MAINTENANCE_MODE=1 in env, all /api/*
 * routes return 503 except for health, login, and admin endpoints.
 */

const ALLOW_PREFIXES = ['/api/health', '/api/auth/login', '/api/admin'];

function maintenanceMiddleware(req, _res_ignored, next) {
    const res = _res_ignored;
    const on = String(process.env.MAINTENANCE_MODE || '0') === '1';
    if (!on) return next();
    if (!req.path.startsWith('/api')) return next();
    if (ALLOW_PREFIXES.some(p => req.path.startsWith(p))) return next();
    res.status(503).json({ error: 'Service under maintenance. Please try again shortly.' });
}

module.exports = { maintenanceMiddleware };
