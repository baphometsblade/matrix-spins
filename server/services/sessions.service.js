'use strict';

/**
 * Per-session tracking for authenticated JWTs.
 *
 *   recordSession(jti, userId, req)   — explicit, called from login flow
 *   findByJti(jti)                    — used by auth middleware (cached)
 *   isNewDevice(userId, req)          — login-time check for fingerprint
 *   bumpLastSeen(jti)                 — debounced UPDATE on each request
 *   listForUser(userId)               — own-only listing, sorted by recency
 *   revoke(userId, jti)               — owner-scoped revocation
 *   revokeOthers(userId, currentJti)  — bulk revoke all other sessions
 *
 * The middleware lazy-creates a session row when it sees a valid JWT
 * with a jti that isn't in the table yet (e.g. tokens issued before
 * the migration, or by tests). This means the FIRST time a token is
 * used after migration the user can see + revoke that session — no
 * silent grandfathered tokens.
 */

const crypto = require('crypto');
const db = require('../database');

const SESSION_CACHE_TTL_MS = 30 * 1000;
const LAST_SEEN_DEBOUNCE_MS = 60 * 1000;

const sessionCache = new Map();   // jti -> { row, expiresAt }
const lastSeenSeen  = new Map();  // jti -> timestamp of last UPDATE

function newJti() {
    return crypto.randomBytes(16).toString('hex');
}

function invalidate(jti) {
    sessionCache.delete(jti);
}

/**
 * Best-effort IP extractor. Reads X-Forwarded-For (first hop) when
 * the express `trust proxy` setting is on; otherwise falls back to
 * the connection remote address. Used to display the session origin
 * in the user-facing list and to fingerprint new-device detection.
 */
function ipOf(req) {
    if (!req) return null;
    const xff = req.headers && req.headers['x-forwarded-for'];
    if (xff && typeof xff === 'string') {
        const first = xff.split(',')[0].trim();
        if (first) return first.slice(0, 64);
    }
    const a = req.ip || (req.connection && req.connection.remoteAddress) || null;
    return a ? String(a).slice(0, 64) : null;
}

function uaOf(req) {
    if (!req) return null;
    const v = req.headers && req.headers['user-agent'];
    return v ? String(v).slice(0, 512) : null;
}

/**
 * Best-effort "Chrome on Mac" style label. Built off the UA on a
 * narrow set of common signatures; returns 'Unknown' for anything
 * we don't recognize. Stored once at session-create time so the
 * displayed label doesn't churn if the user's UA shifts mid-life
 * (some Chromium-based browsers rotate minor-version strings).
 */
function deviceLabel(ua) {
    if (!ua) return 'Unknown';
    const s = String(ua);
    let browser = 'Browser';
    if (/Edg\//.test(s))             browser = 'Edge';
    else if (/Firefox\//.test(s))    browser = 'Firefox';
    else if (/OPR\/|Opera/.test(s))  browser = 'Opera';
    else if (/Chrome\//.test(s))     browser = 'Chrome';
    else if (/Safari\//.test(s))     browser = 'Safari';
    else if (/curl\//.test(s))       browser = 'curl';
    else if (/Postman/.test(s))      browser = 'Postman';
    else if (/Node\.js|node-fetch/.test(s)) browser = 'Node';
    let os = 'Unknown';
    if (/Windows/.test(s))           os = 'Windows';
    else if (/iPhone|iPad/.test(s))  os = 'iOS';
    else if (/Android/.test(s))      os = 'Android';
    else if (/Mac OS X|Macintosh/.test(s)) os = 'Mac';
    else if (/Linux/.test(s))        os = 'Linux';
    return browser + ' on ' + os;
}

/**
 * /24 prefix of an IPv4 (or full address for IPv6) — what we use to
 * decide "same network" without overweighting NAT-shared addresses
 * down to the exact octet.
 */
function ipNetwork(ip) {
    if (!ip) return null;
    const s = String(ip);
    if (s.includes(':')) return s;  // IPv6: don't subnet
    const m = s.match(/^(\d{1,3}\.\d{1,3}\.\d{1,3})\./);
    return m ? m[1] + '.0/24' : s;
}

/**
 * Insert a session row. Idempotent on jti (PRIMARY KEY); dupes are
 * swallowed so the auth middleware's lazy-create path doesn't trip
 * the login flow's explicit insert under a race.
 */
async function recordSession(jti, userId, req) {
    if (!jti || !userId) return;
    const ip = ipOf(req);
    const ua = uaOf(req);
    const label = deviceLabel(ua);
    try {
        await db.run(
            `INSERT INTO auth_sessions (jti, user_id, ip, user_agent, device_label)
             VALUES (?, ?, ?, ?, ?)`,
            [jti, userId, ip, ua, label]
        );
    } catch (err) {
        const msg = (err && err.message || '').toLowerCase();
        if (msg.includes('unique') || msg.includes('duplicate')) return;
        throw err;
    }
    sessionCache.set(jti, {
        row: { jti, user_id: userId, revoked_at: null, ip, user_agent: ua, device_label: label },
        expiresAt: Date.now() + SESSION_CACHE_TTL_MS,
    });
}

/**
 * Used by the auth middleware. Returns the row or null. Caches the
 * row (or its absence) for SESSION_CACHE_TTL_MS so successive
 * authed requests on the same jti don't hit the DB.
 *
 * On revoke we invalidate the cache so the next request rejects.
 */
async function findByJti(jti) {
    if (!jti) return null;
    const now = Date.now();
    const cached = sessionCache.get(jti);
    if (cached && cached.expiresAt > now) return cached.row;
    let row = null;
    try {
        row = await db.get(
            `SELECT jti, user_id, ip, user_agent, device_label, created_at, last_seen_at, revoked_at
               FROM auth_sessions WHERE jti = ?`,
            [jti]
        );
    } catch (err) {
        // DB unavailable — fail closed at the middleware layer.
        return null;
    }
    sessionCache.set(jti, { row: row || null, expiresAt: now + SESSION_CACHE_TTL_MS });
    return row;
}

/**
 * Update last_seen_at no more than once per minute per jti. We don't
 * await — the auth path stays fast even if the DB is slow.
 */
function bumpLastSeen(jti) {
    if (!jti) return;
    const now = Date.now();
    const last = lastSeenSeen.get(jti) || 0;
    if (now - last < LAST_SEEN_DEBOUNCE_MS) return;
    lastSeenSeen.set(jti, now);
    db.run(
        `UPDATE auth_sessions SET last_seen_at = ` + db.sqlNow() + ` WHERE jti = ?`,
        [jti]
    ).catch(function () { /* swallow */ });
}

/**
 * Compare the incoming request's (ip-net, browser, os) signature
 * against the user's previous non-revoked sessions. Returns true on
 * the first session ever, OR when none of the saved sessions share
 * both the ip-net and the device label.
 */
async function isNewDevice(userId, req) {
    if (!userId) return false;
    const network = ipNetwork(ipOf(req));
    const label = deviceLabel(uaOf(req));
    const rows = await db.all(
        `SELECT ip, device_label FROM auth_sessions
          WHERE user_id = ? AND revoked_at IS NULL`,
        [userId]
    );
    if (!rows || rows.length === 0) return false; // first session ever, no email
    return !rows.some(r => ipNetwork(r.ip) === network && r.device_label === label);
}

async function listForUser(userId) {
    const numId = Number(userId);
    if (!Number.isInteger(numId) || numId < 1) return [];
    const rows = await db.all(
        `SELECT jti, ip, user_agent, device_label, created_at, last_seen_at, revoked_at
           FROM auth_sessions
          WHERE user_id = ?
          ORDER BY last_seen_at DESC NULLS LAST, created_at DESC
          LIMIT 200`,
        [numId]
    ).catch(async () => {
        // SQLite predates NULLS LAST; fall back to created_at-only ordering.
        return await db.all(
            `SELECT jti, ip, user_agent, device_label, created_at, last_seen_at, revoked_at
               FROM auth_sessions
              WHERE user_id = ?
              ORDER BY last_seen_at DESC, created_at DESC
              LIMIT 200`,
            [numId]
        );
    });
    return rows.map(r => ({
        jti: r.jti,
        ip: r.ip || null,
        device_label: r.device_label || 'Unknown',
        created_at: r.created_at,
        last_seen_at: r.last_seen_at,
        revoked_at: r.revoked_at || null,
    }));
}

async function revoke(userId, jti) {
    const numUser = Number(userId);
    if (!Number.isInteger(numUser) || numUser < 1) {
        const e = new Error('Authentication required.'); e.status = 401; throw e;
    }
    if (!jti || typeof jti !== 'string' || !/^[a-f0-9]{8,64}$/i.test(jti)) {
        const e = new Error('Invalid session id.'); e.status = 400; throw e;
    }
    const r = await db.run(
        `UPDATE auth_sessions SET revoked_at = ` + db.sqlNow() +
        `  WHERE jti = ? AND user_id = ? AND revoked_at IS NULL`,
        [jti, numUser]
    );
    invalidate(jti);
    if (Number(r && r.changes) < 1) {
        const e = new Error('Session not found or already revoked.'); e.status = 404; throw e;
    }
    return { ok: true, jti };
}

async function revokeOthers(userId, currentJti) {
    const numUser = Number(userId);
    if (!Number.isInteger(numUser) || numUser < 1) {
        const e = new Error('Authentication required.'); e.status = 401; throw e;
    }
    let r;
    if (currentJti && typeof currentJti === 'string' && /^[a-f0-9]{8,64}$/i.test(currentJti)) {
        r = await db.run(
            `UPDATE auth_sessions SET revoked_at = ` + db.sqlNow() +
            `  WHERE user_id = ? AND jti <> ? AND revoked_at IS NULL`,
            [numUser, currentJti]
        );
    } else {
        // No current jti (legacy token without jti) — revoke nothing,
        // but tell the caller. In practice the route also calls
        // bumpTokenVersion, so the user does still get fully signed
        // out on next request.
        return { ok: true, revoked: 0 };
    }
    // We can't surgically invalidate the cache without iterating the
    // full Map — the SESSION_CACHE_TTL_MS is short (30s) so the
    // staleness window is bounded, and the user-visible side-effect
    // (other tabs sign out within 30s) is acceptable.
    return { ok: true, revoked: Number(r && r.changes) || 0 };
}

module.exports = {
    newJti,
    invalidate,
    ipOf,
    uaOf,
    deviceLabel,
    ipNetwork,
    recordSession,
    findByJti,
    bumpLastSeen,
    isNewDevice,
    listForUser,
    revoke,
    revokeOthers,
};
