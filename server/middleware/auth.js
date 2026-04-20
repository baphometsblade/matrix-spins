const jwt = require('jsonwebtoken');
const config = require('../config');
const db = require('../database');

// In-memory JWT blacklist (for logout / forced invalidation)
// In production with multiple instances, replace with Redis
const blacklistedTokens = new Map(); // token -> expiryTimestamp
const TOKEN_CLEANUP_INTERVAL = 30 * 60 * 1000; // 30 min

// Periodic cleanup — remove expired tokens from blacklist to prevent memory leak
setInterval(() => {
    const now = Math.floor(Date.now() / 1000);
    let cleaned = 0;
    for (const [token, expiryTime] of blacklistedTokens) {
        if (expiryTime < now) {
            blacklistedTokens.delete(token);
            cleaned++;
        }
    }
    if (cleaned > 0) console.warn(`[Auth] Cleaned ${cleaned} expired tokens from blacklist`);
}, TOKEN_CLEANUP_INTERVAL);

/**
 * Blacklist a JWT token (call on logout)
 */
function blacklistToken(token) {
    if (token) {
        try {
            const decoded = jwt.decode(token);
            const expiryTime = decoded && decoded.exp ? decoded.exp : (Math.floor(Date.now() / 1000) + 86400);
            blacklistedTokens.set(token, expiryTime);
        } catch (_) {
            blacklistedTokens.set(token, Math.floor(Date.now() / 1000) + 86400);
        }
    }
}

/**
 * Check if a token is blacklisted
 */
function isBlacklisted(token) {
    return blacklistedTokens.has(token);
}

// JWT authentication middleware
async function authenticate(req, res, next) {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'Authentication required' });
    }

    const token = authHeader.slice(7);

    // Reject blacklisted tokens (logged-out sessions)
    if (isBlacklisted(token)) {
        return res.status(401).json({ error: 'Token has been revoked' });
    }

    try {
        const payload = jwt.verify(token, config.JWT_SECRET, { algorithms: ['HS256'] });
        const user = await db.get('SELECT id, username, email, balance, is_admin, is_banned, password_changed_at FROM users WHERE id = ?', [payload.userId]);
        if (!user) {
            return res.status(401).json({ error: 'User not found' });
        }
        if (user.is_banned) {
            return res.status(403).json({ error: 'Account banned' });
        }
        // Invalidate tokens issued before password change
        if (user.password_changed_at && payload.iat && payload.iat < user.password_changed_at) {
            return res.status(401).json({ error: 'Token invalidated after password change. Please log in again.' });
        }
        req.user = user;
        req.token = token; // Make token accessible for logout
        next();
    } catch (err) {
        return res.status(401).json({ error: 'Invalid or expired token' });
    }
}

// Optional auth — populates req.user from JWT if present but does NOT reject.
// Used globally before CSRF middleware so req.user is available for CSRF checks.
async function optionalAuth(req, res, next) {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return next(); // No token — pass through silently
    }
    const token = authHeader.slice(7);
    if (isBlacklisted(token)) {
        return next(); // Blacklisted — pass through silently
    }
    try {
        const payload = jwt.verify(token, config.JWT_SECRET, { algorithms: ['HS256'] });
        const user = await db.get('SELECT id, username, email, balance, is_admin, is_banned, password_changed_at FROM users WHERE id = ?', [payload.userId]);
        if (user && !user.is_banned) {
            if (!user.password_changed_at || !payload.iat || payload.iat >= user.password_changed_at) {
                req.user = user;
                req.token = token;
            }
        }
    } catch (_) {
        // Invalid token — pass through silently
    }
    next();
}

// Admin-only middleware (must be used AFTER authenticate)
function requireAdmin(req, res, next) {
    if (!req.user || !req.user.is_admin) {
        return res.status(403).json({ error: 'Admin access required' });
    }
    next();
}

module.exports = { authenticate, optionalAuth, requireAdmin, blacklistToken, isBlacklisted };
