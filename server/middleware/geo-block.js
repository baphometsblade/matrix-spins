'use strict';

/**
 * Geo-blocking middleware for jurisdictional compliance.
 *
 * Usage (in server/index.js):
 *   const { geoBlock } = require('./middleware/geo-block');
 *   app.use('/api/payment/create-checkout', geoBlock);
 *   app.use('/api/payment/deposit',         geoBlock);
 *   app.use('/api/payment/withdraw',        geoBlock);
 *   app.use('/api/auth/register',           geoBlock);
 *
 * Configuration (env vars):
 *   ALLOWED_COUNTRIES   — comma-separated ISO-3166-1 alpha-2 codes,
 *                         e.g. "AU,NZ" or "US,CA,GB". Empty/missing = allow all
 *                         (development mode). In production, you MUST set this.
 *   BLOCKED_COUNTRIES   — optional denylist applied AFTER the allowlist check,
 *                         e.g. "US" to explicitly forbid a country even if
 *                         ALLOWED_COUNTRIES is empty. Useful during migration.
 *   GEO_LOOKUP_PROVIDER — "ipapi" (default) | "disabled". When "disabled" the
 *                         middleware is a no-op (useful for tests).
 *   GEO_FAIL_MODE       — "open" (default) | "closed". On lookup failure,
 *                         "open" = allow (don't block legitimate users when
 *                         the geo provider is down); "closed" = deny (strict).
 *
 * Design notes:
 * - Uses ipapi.co free tier (already in CSP connectSrc allowlist).
 * - In-memory LRU cache keyed by IP (24h TTL) minimises provider calls and
 *   keeps the free tier comfortable. Max 10k IPs (~2MB).
 * - Honours X-Forwarded-For via Express trust-proxy (already set in index.js
 *   for the Render/Railway reverse proxy).
 * - Localhost / private-range IPs always pass (dev loopback).
 * - Responds 451 "Unavailable For Legal Reasons" so the client can render a
 *   polite jurisdictional-block page (RFC 7725).
 */

const MAX_CACHE = 10000;
const TTL_MS = 24 * 60 * 60 * 1000; // 24h

const cache = new Map(); // ip → { country, expires }

function now() { return Date.now(); }

function cacheGet(ip) {
    const hit = cache.get(ip);
    if (!hit) return null;
    if (hit.expires < now()) { cache.delete(ip); return null; }
    // refresh LRU order
    cache.delete(ip);
    cache.set(ip, hit);
    return hit.country;
}

function cacheSet(ip, country) {
    if (cache.size >= MAX_CACHE) {
        // evict oldest
        const firstKey = cache.keys().next().value;
        if (firstKey !== undefined) cache.delete(firstKey);
    }
    cache.set(ip, { country, expires: now() + TTL_MS });
}

function isPrivateIp(ip) {
    if (!ip) return true;
    if (ip === '::1' || ip === '127.0.0.1' || ip === 'localhost') return true;
    if (ip.startsWith('::ffff:')) ip = ip.slice(7); // IPv4-mapped IPv6
    if (ip.startsWith('10.') || ip.startsWith('127.') || ip.startsWith('192.168.')) return true;
    const m = ip.match(/^172\.(\d+)\./);
    if (m && +m[1] >= 16 && +m[1] <= 31) return true;
    return false;
}

async function lookupCountry(ip) {
    const cached = cacheGet(ip);
    if (cached !== null) return cached;

    try {
        // 3 second timeout — we prefer fail-open over hanging the request
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 3000);
        const res = await fetch(`https://ipapi.co/${encodeURIComponent(ip)}/country/`, {
            signal: controller.signal,
            headers: { 'User-Agent': 'matrix-spins-geo-block/1.0' }
        });
        clearTimeout(timer);
        if (!res.ok) return null;
        const text = (await res.text()).trim().toUpperCase();
        // ipapi returns a 2-letter ISO code on success, or "Undefined" / error JSON
        if (!/^[A-Z]{2}$/.test(text)) return null;
        cacheSet(ip, text);
        return text;
    } catch (_) {
        return null;
    }
}

function parseList(v) {
    return String(v || '')
        .split(',')
        .map(s => s.trim().toUpperCase())
        .filter(s => /^[A-Z]{2}$/.test(s));
}

function geoBlock(req, res, next) {
    const provider = (process.env.GEO_LOOKUP_PROVIDER || 'ipapi').toLowerCase();
    if (provider === 'disabled') return next();

    const allowList = parseList(process.env.ALLOWED_COUNTRIES);
    const blockList = parseList(process.env.BLOCKED_COUNTRIES);

    // If neither list configured, middleware is inert (backward compatible).
    if (allowList.length === 0 && blockList.length === 0) return next();

    const ip = req.ip || req.connection?.remoteAddress || '';
    if (isPrivateIp(ip)) return next();

    const failMode = (process.env.GEO_FAIL_MODE || 'open').toLowerCase();

    lookupCountry(ip).then(country => {
        if (!country) {
            if (failMode === 'closed') {
                return res.status(451).json({
                    error: 'We could not verify your jurisdiction. Please try again later.',
                    code: 'geo_lookup_failed'
                });
            }
            return next(); // fail-open
        }

        if (blockList.length && blockList.includes(country)) {
            return res.status(451).json({
                error: 'This service is not available in your jurisdiction.',
                code: 'geo_blocked',
                country
            });
        }

        if (allowList.length && !allowList.includes(country)) {
            return res.status(451).json({
                error: 'This service is not available in your jurisdiction.',
                code: 'geo_not_allowed',
                country
            });
        }

        // Attach to req for downstream consumers (compliance audit, analytics)
        req.userCountry = country;
        next();
    }).catch(() => {
        if (failMode === 'closed') {
            return res.status(451).json({ error: 'Geo check failed', code: 'geo_lookup_failed' });
        }
        next(); // fail-open
    });
}

module.exports = {
    geoBlock,
    // Exported for tests
    _internal: { cacheGet, cacheSet, isPrivateIp, parseList, lookupCountry }
};
