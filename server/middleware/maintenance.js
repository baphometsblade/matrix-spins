const fs = require('fs');
const path = require('path');

const MAINTENANCE_FILE = path.join(__dirname, '..', 'data', 'maintenance.json');
const CACHE_TTL_MS = 10000; // Re-check file every 10 seconds (not every request)

let cachedState = null;
let cacheExpiry = 0;

/**
 * Reads and parses the maintenance mode flag from disk (with caching)
 * @returns {object} { enabled: boolean, message: string }
 */
function getMaintenanceState() {
    const now = Date.now();
    if (cachedState && now < cacheExpiry) return cachedState;

    try {
        if (!fs.existsSync(MAINTENANCE_FILE)) {
            cachedState = { enabled: false, message: 'System is currently under maintenance.' };
        } else {
            try {
                const data = fs.readFileSync(MAINTENANCE_FILE, 'utf-8');
                const parsed = JSON.parse(data);
                cachedState = {
                    enabled: Boolean(parsed.enabled),
                    message: parsed.message || 'Matrix Spins is undergoing scheduled maintenance. We\'ll be back shortly!'
                };
            } catch (parseErr) {
                console.warn('[Maintenance] Failed to parse maintenance.json:', parseErr.message);
                cachedState = { enabled: false, message: 'System is currently under maintenance.' };
            }
        }
    } catch (err) {
        console.warn('[Maintenance] Failed to read maintenance state:', err.message);
        cachedState = { enabled: false, message: 'System is currently under maintenance.' };
    }

    cacheExpiry = now + CACHE_TTL_MS;
    return cachedState;
}

/**
 * Force-refresh the cache (call after toggling maintenance mode via admin API)
 */
function invalidateCache() {
    cachedState = null;
    cacheExpiry = 0;
}

/**
 * Middleware that checks maintenance mode and returns 503 if enabled
 * Admin API routes (/api/admin/*) and health checks are always allowed
 * Static file serving is not affected
 */
function maintenanceMiddleware(req, res, next) {
    // Admin routes and health checks always bypass maintenance mode
    if (req.path.startsWith('/api/admin/') || req.path.startsWith('/api/health')) {
        return next();
    }

    // Non-API requests (static files, etc.) bypass maintenance mode
    if (!req.path.startsWith('/api/')) {
        return next();
    }

    const state = getMaintenanceState();
    if (state.enabled) {
        return res.status(503).json({
            maintenance: true,
            message: state.message
        });
    }

    next();
}

module.exports = {
    maintenanceMiddleware,
    getMaintenanceState,
    invalidateCache,
};
