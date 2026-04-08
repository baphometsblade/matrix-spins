'use strict';

/**
 * Recursively sanitizes objects to prevent XSS and prototype pollution attacks
 * @param {*} obj - The object to sanitize
 * @param {number} depth - Current recursion depth (max 20)
 * @returns {*} The sanitized object
 */
function sanitize(obj, depth = 0) {
    // Prevent stack overflow from circular references
    if (depth > 20) {
        return obj;
    }

    // Handle null and primitives
    if (obj === null || obj === undefined) {
        return obj;
    }

    // Sanitize strings: strip HTML, encode entities, trim, enforce max length
    if (typeof obj === 'string') {
        // Strip HTML tags (prevent XSS) — also handle unclosed tags
        let sanitized = obj.replace(/<[^>]*>?/g, '');
        // Encode remaining dangerous characters as HTML entities
        sanitized = sanitized
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#x27;');
        // Strip null bytes (used in some injection attacks)
        sanitized = sanitized.replace(/\0/g, '');
        // Trim whitespace
        sanitized = sanitized.trim();
        // Enforce maximum string length
        if (sanitized.length > 10000) {
            sanitized = sanitized.substring(0, 10000);
        }
        return sanitized;
    }

    // Primitives other than string pass through
    if (typeof obj !== 'object') {
        return obj;
    }

    // Handle arrays
    if (Array.isArray(obj)) {
        return obj.map((item, idx) => {
            try {
                return sanitize(item, depth + 1);
            } catch (e) {
                console.warn(`[Sanitize] Error sanitizing array[${idx}]:`, e.message);
                return item;
            }
        });
    }

    // Handle objects
    const sanitized = {};
    for (const key in obj) {
        // Skip own property check — we check prototype pollution keys
        // Prevent prototype pollution
        if (key === '__proto__' || key === 'constructor' || key === 'prototype') {
            console.warn(`[Sanitize] Rejected suspicious key: "${key}"`);
            continue;
        }

        // Only process own properties
        if (!Object.prototype.hasOwnProperty.call(obj, key)) {
            continue;
        }

        try {
            sanitized[key] = sanitize(obj[key], depth + 1);
        } catch (e) {
            console.warn(`[Sanitize] Error sanitizing key "${key}":`, e.message);
            // Skip this key if sanitization fails
        }
    }

    return sanitized;
}

/**
 * Express middleware to sanitize incoming request data
 * Applies to req.body, req.query, and req.params
 */
module.exports = function sanitizeMiddleware(req, res, next) {
    try {
        // Sanitize request body
        if (req.body && typeof req.body === 'object') {
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
        console.warn('[Sanitize] Unexpected error during sanitization:', e.message);
        // Continue to next middleware even if sanitization encounters an issue
    }

    next();
};
