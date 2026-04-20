'use strict';

/**
 * Server-side auth event ledger. Every login (success + failure),
 * register, logout, password change/reset is appended here so support
 * can reconstruct what a customer saw, and security can spot brute-force
 * patterns. Indexes on username + created_at make lockout queries cheap.
 */

const db = require('../database');

const LOCKOUT_WINDOW_MS = 15 * 60 * 1000;
const LOCKOUT_THRESHOLD = 5;

function clientIp(req) {
    if (!req) return null;
    const fwd = req.headers && req.headers['x-forwarded-for'];
    if (fwd) return String(fwd).split(',')[0].trim();
    return req.ip || null;
}

function userAgent(req) {
    if (!req || !req.headers) return null;
    const ua = req.headers['user-agent'];
    if (!ua) return null;
    return String(ua).slice(0, 500);
}

async function log({ userId, username, eventType, outcome, reason, req }) {
    try {
        await db.run(
            `INSERT INTO auth_events (user_id, username, event_type, outcome, ip, user_agent, reason)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [
                userId || null,
                username ? String(username).slice(0, 64) : null,
                eventType,
                outcome,
                clientIp(req),
                userAgent(req),
                reason ? String(reason).slice(0, 200) : null,
            ]
        );
    } catch (err) {
        // Never let telemetry fail the request — just warn.
        console.warn('[auth-events] log failed:', err.message);
    }
}

async function failedLoginCount(username, windowMs = LOCKOUT_WINDOW_MS) {
    try {
        const sinceIso = new Date(Date.now() - windowMs).toISOString();
        const row = await db.get(
            `SELECT COUNT(*) AS n FROM auth_events
              WHERE event_type = 'login' AND outcome = 'failed'
                AND lower(username) = lower(?)
                AND created_at >= ?`,
            [username, sinceIso]
        );
        return Number((row && row.n) || 0);
    } catch (err) {
        console.warn('[auth-events] count failed:', err.message);
        return 0;
    }
}

async function isLockedOut(username) {
    if (!username) return false;
    const failures = await failedLoginCount(username);
    return failures >= LOCKOUT_THRESHOLD;
}

async function lockoutStatus(username) {
    const failures = await failedLoginCount(username);
    return {
        failures,
        threshold: LOCKOUT_THRESHOLD,
        locked: failures >= LOCKOUT_THRESHOLD,
        windowSeconds: LOCKOUT_WINDOW_MS / 1000,
    };
}

async function recentForUser(userId, limit = 50) {
    const n = Math.max(1, Math.min(200, Number(limit) || 50));
    try {
        return await db.all(
            `SELECT id, event_type, outcome, ip, user_agent, reason, created_at
               FROM auth_events WHERE user_id = ?
           ORDER BY id DESC LIMIT ?`,
            [userId, n]
        );
    } catch (err) {
        console.warn('[auth-events] recentForUser failed:', err.message);
        return [];
    }
}

async function recentAll(limit = 100) {
    const n = Math.max(1, Math.min(500, Number(limit) || 100));
    try {
        return await db.all(
            `SELECT id, user_id, username, event_type, outcome, ip, user_agent, reason, created_at
               FROM auth_events ORDER BY id DESC LIMIT ?`,
            [n]
        );
    } catch (err) {
        console.warn('[auth-events] recentAll failed:', err.message);
        return [];
    }
}

module.exports = {
    log,
    failedLoginCount,
    isLockedOut,
    lockoutStatus,
    recentForUser,
    recentAll,
    LOCKOUT_WINDOW_MS,
    LOCKOUT_THRESHOLD,
};
