'use strict';

const MAX_STRING_LENGTH = 10000;
const MAX_DEPTH = 20;

// Custom error class so the middleware can distinguish "reject this request"
// from other unexpected sanitize errors (which should be logged + passed
// through rather than 400'd).
class SanitizeRejectError extends Error {
    constructor(message) { super(message); this.name = 'SanitizeRejectError'; }
}

/**
 * Recursively sanitizes objects to prevent XSS and prototype pollution attacks.
 *
 * ROUND 65: two DoS / bypass hardenings:
 *   1. Truncate long strings BEFORE the 7-regex chain runs. Previously a
 *      1MB string ran through 7 full-string regex passes (~10MB of string
 *      allocations) before being truncated to 10KB. Attacker could saturate
 *      the Node event loop with ~50 concurrent pathological-body requests.
 *   2. Depth > 20 now THROWS a SanitizeRejectError (caught by the middleware
 *      → 400 Bad Request) instead of returning the object unsanitized. The
 *      previous pass-through allowed stored XSS to survive to admin views
 *      when JSON nesting exceeded the cap.
 *
 * @param {*} obj - The object to sanitize
 * @param {number} depth - Current recursion depth
 * @returns {*} The sanitized object
 * @throws {SanitizeRejectError} when depth > MAX_DEPTH
 */
function sanitize(obj, depth = 0) {
    if (depth > MAX_DEPTH) {
        throw new SanitizeRejectError('Max nesting depth (' + MAX_DEPTH + ') exceeded');
    }

    // Handle null and primitives
    if (obj === null || obj === undefined) {
        return obj;
    }

    // Sanitize strings: truncate FIRST so the regex chain is bounded,
    // then strip HTML / encode entities / strip null bytes / trim.
    if (typeof obj === 'string') {
        let s = obj;
        if (s.length > MAX_STRING_LENGTH) {
            s = s.substring(0, MAX_STRING_LENGTH);
        }
        // Strip HTML tags (prevent XSS) — also handles unclosed tags
        s = s.replace(/<[^>]*>?/g, '');
        // Encode remaining dangerous characters as HTML entities
        s = s
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#x27;');
        // Strip null bytes (used in some injection attacks)
        s = s.replace(/\0/g, '');
        // Trim whitespace
        s = s.trim();
        return s;
    }

    // Primitives other than string pass through
    if (typeof obj !== 'object') {
        return obj;
    }

    // Handle arrays
    if (Array.isArray(obj)) {
        return obj.map((item) => sanitize(item, depth + 1));
    }

    // Handle objects
    const sanitized = {};
    for (const key in obj) {
        // Prevent prototype pollution
        if (key === '__proto__' || key === 'constructor' || key === 'prototype') {
            console.warn(`[Sanitize] Rejected suspicious key: "${key}"`);
            continue;
        }
        // Only process own properties
        if (!Object.prototype.hasOwnProperty.call(obj, key)) {
            continue;
        }
        sanitized[key] = sanitize(obj[key], depth + 1);
    }

    return sanitized;
}

/**
 * Express middleware to sanitize incoming request data.
 * Applies to req.body, req.query, and req.params.
 * 400s on pathological input (> MAX_DEPTH nesting).
 */
module.exports = function sanitizeMiddleware(req, res, next) {
    try {
        // Sanitize request body — but NEVER touch raw Buffers.
        // Stripe webhook bodies arrive as Buffers for signature verification;
        // mangling them into plain objects breaks constructEvent().
        if (req.body && typeof req.body === 'object' && !Buffer.isBuffer(req.body)) {
            req.body = sanitize(req.body);
        }

        // Sanitize query parameters
        if (req.query && typeof req.query === 'object') {
            req.query = sanitize(req.query);
        }

        // Sanitize URL parameters
        if (req.params && typeof req.params === 'object') {
            req.params = sanitize(req.params);
        }
    } catch (e) {
        if (e instanceof SanitizeRejectError) {
            return res.status(400).json({ error: 'Request body rejected: ' + e.message });
        }
        // Unexpected sanitize errors — log and continue so we don't block
        // legitimate traffic on a transient issue.
        console.warn('[Sanitize] Unexpected error during sanitization:', e.message);
    }

    next();
};

// Expose the sanitize fn + error class for tests
module.exports.sanitize = sanitize;
module.exports.SanitizeRejectError = SanitizeRejectError;
module.exports.MAX_STRING_LENGTH = MAX_STRING_LENGTH;
module.exports.MAX_DEPTH = MAX_DEPTH;
