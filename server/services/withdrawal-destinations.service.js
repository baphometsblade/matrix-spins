'use strict';

/**
 * Saved payout-destination whitelist. Users save destinations once,
 * wait out a 24-hour cooldown, then reference them by id when
 * requesting a withdrawal. Defends against session-hijack drains:
 * an attacker who steals a session can ADD a destination, but the
 * cooldown gates its USE long enough for the legitimate owner to
 * see the notification email and delete the rogue entry.
 *
 *   raw status         active gate
 *   ─────────────      ──────────────────────────────────────
 *   pending_verification  cooldown_until in the past (lazy flip)
 *   active             always usable
 *   blocked            never usable; survives audit / can be deleted
 *
 * The "lazy flip" pattern matches industry standard: rather than a
 * background worker promoting rows, we compute the effective status
 * on read. The first successful withdrawal against a usable row also
 * persists the flip so the admin UI shows the right state.
 */

const db = require('../database');

const ALLOWED_METHODS = new Set(['bank_transfer', 'crypto']);
const ALLOWED_CURRENCIES = new Set(['usd', 'eur', 'gbp', 'btc', 'eth', 'usdc']);
const COOLDOWN_MS = 24 * 60 * 60 * 1000;
const MAX_DESTINATIONS_PER_USER = 20;
const DESTINATION_MAX_LEN = 200;
const LABEL_MAX_LEN = 64;

// Same printable-ASCII filter the existing withdrawal route uses, so
// behavior matches whether destination is supplied raw or via id.
function sanitizeDestination(s) {
    if (s == null) return null;
    const trimmed = String(s).trim();
    if (!trimmed || trimmed.length > DESTINATION_MAX_LEN) return null;
    if (!/^[\x20-\x7e]+$/.test(trimmed)) return null;
    return trimmed;
}

function effectiveStatus(row, now) {
    if (!row) return null;
    if (row.status === 'blocked') return 'blocked';
    if (row.status === 'active') return 'active';
    // pending_verification → active once cooldown passes.
    if (row.cooldown_until && Date.parse(row.cooldown_until) <= now) return 'active';
    return 'pending_verification';
}

function shapeRow(row, now) {
    return {
        id: row.id,
        method: row.method,
        destination: row.destination,
        currency: row.currency,
        label: row.label,
        status: effectiveStatus(row, now),
        raw_status: row.status,
        cooldown_until: row.cooldown_until,
        cooldown_remaining_ms: row.cooldown_until
            ? Math.max(0, Date.parse(row.cooldown_until) - now)
            : 0,
        created_at: row.created_at,
        verified_at: row.verified_at,
        last_used_at: row.last_used_at,
    };
}

async function listForUser(userId) {
    const numId = Number(userId);
    if (!Number.isInteger(numId) || numId < 1) return [];
    const rows = await db.all(
        `SELECT id, user_id, method, destination, currency, label, status,
                cooldown_until, created_at, verified_at, last_used_at
           FROM withdrawal_destinations
          WHERE user_id = ?
          ORDER BY id DESC`,
        [numId]
    );
    const now = Date.now();
    return rows.map(r => shapeRow(r, now));
}

async function create(userId, { method, destination, currency, label }) {
    const numId = Number(userId);
    if (!Number.isInteger(numId) || numId < 1) {
        const e = new Error('Authentication required.'); e.status = 401; throw e;
    }
    const m = String(method || '').trim().toLowerCase();
    if (!ALLOWED_METHODS.has(m)) {
        const e = new Error('Unsupported method.'); e.status = 400; e.code = 'invalid_method'; throw e;
    }
    const dest = sanitizeDestination(destination);
    if (!dest) {
        const e = new Error('Invalid destination.'); e.status = 400; e.code = 'invalid_destination'; throw e;
    }
    const cur = String(currency || 'usd').trim().toLowerCase();
    if (!ALLOWED_CURRENCIES.has(cur)) {
        const e = new Error('Unsupported currency.'); e.status = 400; e.code = 'invalid_currency'; throw e;
    }
    let lbl = null;
    if (label != null) {
        lbl = String(label).trim().slice(0, LABEL_MAX_LEN);
        if (lbl === '') lbl = null;
    }

    // Per-user cap. Keeps the picker dropdown manageable and stops a
    // hijacker from spamming the table; existing-row UNIQUE blocks
    // the trivial flood path but a polymorphic flood could still
    // bloat the user's view.
    const countRow = await db.get(
        'SELECT COUNT(*) AS n FROM withdrawal_destinations WHERE user_id = ?',
        [numId]
    );
    if (Number(countRow && countRow.n) >= MAX_DESTINATIONS_PER_USER) {
        const e = new Error('Saved destination limit reached. Delete an old one first.');
        e.status = 409; e.code = 'limit_reached'; throw e;
    }

    const cooldownUntil = new Date(Date.now() + COOLDOWN_MS).toISOString();

    try {
        await db.run(
            `INSERT INTO withdrawal_destinations
                 (user_id, method, destination, currency, label, status, cooldown_until)
             VALUES (?, ?, ?, ?, ?, 'pending_verification', ?)`,
            [numId, m, dest, cur, lbl, cooldownUntil]
        );
    } catch (err) {
        const msg = (err && err.message || '').toLowerCase();
        if (msg.includes('unique') || msg.includes('duplicate')) {
            const e = new Error('That destination is already saved on your account.');
            e.status = 409; e.code = 'already_saved'; throw e;
        }
        throw err;
    }
    const row = await db.get(
        `SELECT * FROM withdrawal_destinations
          WHERE user_id = ? AND method = ? AND destination = ?`,
        [numId, m, dest]
    );
    return shapeRow(row, Date.now());
}

async function remove(userId, id) {
    const numUser = Number(userId);
    const numId = Number(id);
    if (!Number.isInteger(numUser) || numUser < 1
     || !Number.isInteger(numId) || numId < 1) {
        const e = new Error('Invalid id.'); e.status = 400; throw e;
    }
    const r = await db.run(
        'DELETE FROM withdrawal_destinations WHERE id = ? AND user_id = ?',
        [numId, numUser]
    );
    if (Number(r && r.changes) < 1) {
        const e = new Error('Destination not found.'); e.status = 404; throw e;
    }
    return { ok: true, id: numId };
}

/**
 * Resolve a saved destination for a withdrawal request. Throws with
 * .status / .code on any failure path so the route handler can map
 * directly to a JSON response.
 *
 * Returns { id, method, destination, currency, label } on success.
 * Also persists the lazy promotion to status='active' the first
 * time a pending_verification row is found to be cooldown-elapsed,
 * so the admin view stops showing it as pending.
 */
async function assertUsable(userId, id) {
    const numUser = Number(userId);
    const numId = Number(id);
    if (!Number.isInteger(numUser) || numUser < 1
     || !Number.isInteger(numId) || numId < 1) {
        const e = new Error('Invalid destination id.'); e.status = 400; throw e;
    }
    const row = await db.get(
        `SELECT id, user_id, method, destination, currency, label, status, cooldown_until
           FROM withdrawal_destinations WHERE id = ? AND user_id = ?`,
        [numId, numUser]
    );
    if (!row) {
        const e = new Error('Destination not found.'); e.status = 404; e.code = 'not_found'; throw e;
    }
    if (row.status === 'blocked') {
        const e = new Error('Destination is blocked.'); e.status = 403; e.code = 'destination_blocked'; throw e;
    }
    const now = Date.now();
    const eff = effectiveStatus(row, now);
    if (eff !== 'active') {
        const e = new Error('Destination is still under cooldown.');
        e.status = 403;
        e.code = 'destination_cooldown';
        e.cooldown_until = row.cooldown_until;
        throw e;
    }
    // Lazy flip + last_used_at bump in one UPDATE. We deliberately do
    // NOT set verified_at here on the lazy flip — verified_at = the
    // moment of explicit user action; the cooldown promotion is
    // implicit and we keep the columns distinguishable for audit.
    await db.run(
        `UPDATE withdrawal_destinations
            SET status = CASE WHEN status = 'pending_verification' THEN 'active' ELSE status END,
                last_used_at = ` + db.sqlNow() + `
          WHERE id = ?`,
        [row.id]
    );
    return {
        id: row.id,
        method: row.method,
        destination: row.destination,
        currency: row.currency,
        label: row.label,
    };
}

module.exports = {
    listForUser,
    create,
    remove,
    assertUsable,
    sanitizeDestination,
    ALLOWED_METHODS,
    ALLOWED_CURRENCIES,
    COOLDOWN_MS,
    MAX_DESTINATIONS_PER_USER,
};
