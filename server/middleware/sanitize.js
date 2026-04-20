'use strict';

/**
 * Input sanitization middleware. Strips prototype-pollution keys from
 * req.body / req.query and trims oversized string values.
 */

const BLOCKED_KEYS = new Set(['__proto__', 'prototype', 'constructor']);
const MAX_STRING = 8192;

function clean(value) {
    if (value == null) return value;
    if (typeof value === 'string') {
        return value.length > MAX_STRING ? value.slice(0, MAX_STRING) : value;
    }
    if (Array.isArray(value)) {
        return value.map(clean);
    }
    if (typeof value === 'object') {
        const out = {};
        for (const k of Object.keys(value)) {
            if (BLOCKED_KEYS.has(k)) continue;
            out[k] = clean(value[k]);
        }
        return out;
    }
    return value;
}

module.exports = function sanitize(req, _res, next) {
    if (req.body && typeof req.body === 'object' && !Buffer.isBuffer(req.body)) {
        req.body = clean(req.body);
    }
    if (req.query && typeof req.query === 'object') {
        req.query = clean(req.query);
    }
    next();
};
