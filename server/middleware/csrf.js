const crypto = require('crypto');

// Token storage: Map<userId, { token: string, expiresAt: number }>
const tokenMap = new Map();

// TTL for tokens: 1 hour
const TOKEN_TTL_MS = 60 * 60 * 1000;

// Cleanup interval: remove expired tokens every 30 minutes
const CLEANUP_INTERVAL = 30 * 60 * 1000;

// Start periodic cleanup
setInterval(() => {
    const now = Date.now();
    let cleaned = 0;
    for (const [userId, data] of tokenMap.entries()) {
        if (data.expiresAt < now) {
            tokenMap.delete(userId);
            cleaned++;
        }
    }
    if (cleaned > 0) {
        console.warn(`[CSRF] Cleaned ${cleaned} expired tokens`);
    }
}, CLEANUP_INTERVAL);

/**
 * Generate a new CSRF token
 */
function generateToken() {
    return crypto.randomBytes(32).toString('hex');
}

/**
 * Store or update token for user
 */
function storeToken(userId, token) {
    tokenMap.set(userId, {
        token,
        expiresAt: Date.now() + TOKEN_TTL_MS
    });
}

/**
 * Retrieve stored token for user
 */
function getStoredToken(userId) {
    const data = tokenMap.get(userId);
    if (!data) return null;

    // Check if expired
    if (data.expiresAt < Date.now()) {
        tokenMap.delete(userId);
        return null;
    }

    return data.token;
}

/**
 * Validate token for user
 */
function validateToken(userId, token) {
    if (!userId || !token) return false;

    const stored = getStoredToken(userId);
    if (!stored) return false;

    // timingSafeEqual throws if buffers differ in length — guard against that
    const a = Buffer.from(String(token));
    const b = Buffer.from(String(stored));
    if (a.length !== b.length) return false;

    // Constant-time comparison to prevent timing attacks
    return crypto.timingSafeEqual(a, b);
}

/**
 * Endpoints that do NOT require CSRF protection
 */
const CSRF_EXEMPT_PATHS = [
    /^\/api\/auth\/login$/,
    /^\/api\/auth\/register$/,
    /^\/api\/auth\/forgot-password$/,
    /^\/api\/auth\/admin-reset$/,
    /^\/api\/auth\/guest$/,
    /^\/api\/perf/,
    /^\/api\/affiliate\/track$/,
    /^\/api\/socialproof/,
    /^\/api\/newsletter\/subscribe$/,
    /^\/api\/newsletter\/unsubscribe$/,
    /^\/api\/auth\/logout$/,              // Logout should always work, even with stale CSRF
    /^\/api\/payment\/stripe\/webhook$/,    // Stripe sends server-to-server; no CSRF token
    /^\/api\/payment\/webhook$/,            // Canonical Stripe webhook (stripe-checkout.routes.js)
    /^\/api\/payment\/webhook\/confirm$/,   // Generic payment processor webhook (WEBHOOK_SECRET auth)
    /^\/api\/health/,                       // Health checks have no user context
    /^\/api\/bundles\/purchase$/,           // Stub returns 501 until Stripe is wired (smoke test guard)
    /^\/api\/age-deny$/,                    // Age-gate deny audit fires from a logged-out page, fire-and-forget keepalive
];

/**
 * Check if a path should be exempt from CSRF
 */
function isExemptPath(path) {
    return CSRF_EXEMPT_PATHS.some(pattern => pattern.test(path));
}

/**
 * CSRF middleware factory
 */
function csrfMiddleware(req, res, next) {
    // Only enforce CSRF on mutation methods (POST, PUT, DELETE)
    const isMutation = ['POST', 'PUT', 'DELETE'].includes(req.method);

    // Only check /api/* routes
    const isApiRoute = req.path.startsWith('/api/');

    // Skip if not a mutation or not an API route
    if (!isMutation || !isApiRoute) {
        return next();
    }

    // Skip exempt paths
    if (isExemptPath(req.path)) {
        return next();
    }

    // Must be authenticated (req.user set by auth middleware)
    if (!req.user || !req.user.id) {
        return res.status(401).json({ error: 'Authentication required for this operation' });
    }

    // Get token from request header
    const tokenFromHeader = req.headers['x-csrf-token'];

    if (!tokenFromHeader) {
        return res.status(403).json({ error: 'CSRF token missing' });
    }

    // Validate token
    if (!validateToken(req.user.id, tokenFromHeader)) {
        return res.status(403).json({ error: 'CSRF token invalid' });
    }

    next();
}

/**
 * GET /api/csrf-token — fetch a fresh token (requires authentication)
 */
function getCsrfTokenHandler(req, res) {
    // Must be authenticated
    if (!req.user || !req.user.id) {
        return res.status(401).json({ error: 'Authentication required' });
    }

    // Generate and store new token
    const token = generateToken();
    storeToken(req.user.id, token);

    res.json({ csrfToken: token });
}

module.exports = {
    csrfMiddleware,
    getCsrfTokenHandler,
    generateToken,
    storeToken,
    getStoredToken,
    validateToken,
    isExemptPath,
};
