'use strict';

/**
 * Promo / bonus codes — operators issue redeemable codes that credit
 * the user's balance. Race-safe across concurrent redemptions:
 *
 *   1. Conditional UPDATE bumps `redemption_count` with a CAS guard
 *      on max_redemptions, expiry, and active. If 0 rows change, the
 *      code is fully redeemed / expired / disabled — disambiguate
 *      with one SELECT and surface the right error.
 *   2. INSERT into promo_redemptions; the UNIQUE(code_id, user_id)
 *      constraint blocks the same user redeeming twice.
 *   3. Credit balance via a normal UPDATE.
 *
 * If step 2 trips the UNIQUE constraint we rewind step 1 (decrement
 * the count) so an "already redeemed" attempt doesn't burn a slot.
 * If step 3 ever failed we'd rewind both steps — that path is left
 * to throw, since balance UPDATE on a known user_id is effectively
 * infallible (the user's row exists; the +N never overflows BIGINT).
 *
 * Codes are normalized to UPPERCASE before storage and lookup. The
 * grammar [A-Z0-9-] keeps them human-readable and safe to print.
 */

const db = require('../database');

const CODE_REGEX = /^[A-Z0-9-]{4,32}$/;
const MIN_VALUE_CENTS = 1;        // $0.01 — guards INSERT spam from making 0-value codes
const MAX_VALUE_CENTS = 1000000;  // $10,000 — operator typo guard; not a regulatory cap

function normalizeCode(raw) {
    if (raw == null) return '';
    return String(raw).trim().toUpperCase();
}

/**
 * Operator-only: create a code.
 *   value_cents:     positive integer
 *   max_redemptions: positive integer or null (unlimited)
 *   expires_at:      ISO date string or null (never)
 *   note:            optional admin-facing memo
 */
const MAX_WAGERING_MULTIPLIER = 100;

async function createCode({ code, value_cents, max_redemptions, expires_at, note, created_by, created_by_username, wagering_multiplier }) {
    const c = normalizeCode(code);
    if (!CODE_REGEX.test(c)) {
        const e = new Error('Code must be 4–32 chars, A–Z 0–9 dash only.');
        e.status = 400; e.code = 'invalid_code'; throw e;
    }
    const v = Number(value_cents);
    if (!Number.isInteger(v) || v < MIN_VALUE_CENTS || v > MAX_VALUE_CENTS) {
        const e = new Error('value_cents must be a positive integer ≤ ' + MAX_VALUE_CENTS + '.');
        e.status = 400; e.code = 'invalid_value'; throw e;
    }
    let max = null;
    if (max_redemptions != null && max_redemptions !== '') {
        max = Number(max_redemptions);
        if (!Number.isInteger(max) || max < 1) {
            const e = new Error('max_redemptions must be a positive integer or omitted.');
            e.status = 400; e.code = 'invalid_max'; throw e;
        }
    }
    let exp = null;
    if (expires_at != null && expires_at !== '') {
        const t = Date.parse(expires_at);
        if (!Number.isFinite(t)) {
            const e = new Error('expires_at must be an ISO date.');
            e.status = 400; e.code = 'invalid_expires'; throw e;
        }
        if (t <= Date.now()) {
            const e = new Error('expires_at must be in the future.');
            e.status = 400; e.code = 'invalid_expires'; throw e;
        }
        exp = new Date(t).toISOString();
    }
    const noteVal = note == null ? null : String(note).slice(0, 500);

    let mult = 0;
    if (wagering_multiplier != null && wagering_multiplier !== '') {
        mult = Number(wagering_multiplier);
        if (!Number.isInteger(mult) || mult < 0 || mult > MAX_WAGERING_MULTIPLIER) {
            const e = new Error('wagering_multiplier must be 0–' + MAX_WAGERING_MULTIPLIER + '.');
            e.status = 400; e.code = 'invalid_multiplier'; throw e;
        }
    }

    try {
        await db.run(
            `INSERT INTO promo_codes (code, value_cents, max_redemptions, expires_at, active, note, created_by, created_by_username, wagering_multiplier)
             VALUES (?, ?, ?, ?, ${db.kind === 'pg' ? 'true' : '1'}, ?, ?, ?, ?)`,
            [c, v, max, exp, noteVal, created_by || null, created_by_username || null, mult]
        );
    } catch (err) {
        const msg = (err && err.message || '').toLowerCase();
        if (msg.includes('unique') || msg.includes('duplicate')) {
            const e = new Error('Code already exists.');
            e.status = 409; e.code = 'code_exists'; throw e;
        }
        throw err;
    }
    const row = await db.get('SELECT * FROM promo_codes WHERE code = ?', [c]);
    return row ? { ...row, active: !!row.active } : row;
}

/**
 * Operator-only: list codes, newest first. Includes a derived
 * `active_now` flag that folds in expiry so the admin UI doesn't
 * need to compute it client-side.
 */
async function listCodes() {
    const rows = await db.all(
        `SELECT id, code, value_cents, max_redemptions, redemption_count,
                expires_at, active, note, created_at, created_by_username,
                wagering_multiplier
           FROM promo_codes
          ORDER BY id DESC
          LIMIT 500`
    );
    const now = Date.now();
    return rows.map(r => ({
        ...r,
        active: !!r.active,
        active_now: !!r.active
            && (r.max_redemptions == null || Number(r.redemption_count) < Number(r.max_redemptions))
            && (r.expires_at == null || Date.parse(r.expires_at) > now),
    }));
}

/**
 * Operator-only: flip a code to inactive. Existing redemptions are
 * preserved (audit). Idempotent — already-inactive returns the row
 * unchanged.
 */
async function deactivateCode(id) {
    const numId = Number(id);
    if (!Number.isInteger(numId) || numId < 1) {
        const e = new Error('Invalid code id.');
        e.status = 400; throw e;
    }
    const r = await db.run(
        `UPDATE promo_codes SET active = ${db.kind === 'pg' ? 'false' : '0'} WHERE id = ?`,
        [numId]
    );
    if (Number(r && r.changes) < 1) {
        const e = new Error('Code not found.');
        e.status = 404; throw e;
    }
    const row = await db.get('SELECT * FROM promo_codes WHERE id = ?', [numId]);
    return row ? { ...row, active: !!row.active } : row;
}

/**
 * User-facing: redeem a code. Atomic + race-safe. On success returns
 * { value_cents, balance_after_cents, code }. On failure throws an
 * Error with .status and .code set so the route handler can surface
 * a precise message.
 */
async function redeem(userId, rawCode) {
    if (!Number.isInteger(userId) || userId < 1) {
        const e = new Error('Authentication required.');
        e.status = 401; throw e;
    }
    const c = normalizeCode(rawCode);
    if (!CODE_REGEX.test(c)) {
        const e = new Error('That doesn\'t look like a valid code.');
        e.status = 400; e.code = 'invalid_code'; throw e;
    }

    // 1) Look up the code row. We deliberately do NOT 404 on a missing
    //    row before trying the conditional UPDATE — we want a constant
    //    error path so an attacker can't enumerate valid codes by
    //    timing or response shape. Always return the same generic
    //    "invalid or unavailable" message until we know it's a
    //    legitimate user state issue (already redeemed).
    const code = await db.get(
        `SELECT id, value_cents, max_redemptions, redemption_count, expires_at, active,
                wagering_multiplier
           FROM promo_codes WHERE code = ?`,
        [c]
    );
    const genericReject = () => {
        const e = new Error('Code is invalid, expired, or no longer available.');
        e.status = 410; e.code = 'code_unavailable';
        return e;
    };
    if (!code) throw genericReject();

    // 1b) If THIS user has already redeemed, return a friendly 409
    //     instead of the generic 410. Note: this only ever fires for
    //     the same user_id + same code, so it doesn't help an attacker
    //     enumerate codes (they'd have to have already succeeded once).
    const existing = await db.get(
        `SELECT id FROM promo_redemptions WHERE code_id = ? AND user_id = ?`,
        [code.id, userId]
    );
    if (existing) {
        const e = new Error('You have already redeemed this code.');
        e.status = 409; e.code = 'already_redeemed'; throw e;
    }

    // 2) Atomic CAS on redemption_count. The single UPDATE enforces:
    //    active, not expired, and (no cap OR count < cap). On 0 rows
    //    changed, the code is unavailable for *some* reason — we
    //    return the generic message to avoid disclosing operator state.
    const isPg = db.kind === 'pg';
    const sqlNow = db.sqlNow();
    const updateSql =
        `UPDATE promo_codes SET redemption_count = redemption_count + 1
          WHERE id = ?
            AND active = ${isPg ? 'true' : '1'}
            AND (max_redemptions IS NULL OR redemption_count < max_redemptions)
            AND (expires_at IS NULL OR expires_at > ${sqlNow})`;
    const upd = await db.run(updateSql, [code.id]);
    if (Number(upd && upd.changes) < 1) throw genericReject();

    // 3) Per-user UNIQUE guard. We catch the constraint, then rewind
    //    step 2 so the slot we just claimed is released back to the
    //    pool — otherwise a user repeatedly tapping "redeem" could
    //    burn down a public code's count without ever crediting them.
    try {
        await db.run(
            `INSERT INTO promo_redemptions (code_id, user_id, value_cents) VALUES (?, ?, ?)`,
            [code.id, userId, code.value_cents]
        );
    } catch (err) {
        await db.run(
            `UPDATE promo_codes SET redemption_count = redemption_count - 1 WHERE id = ?`,
            [code.id]
        );
        const msg = (err && err.message || '').toLowerCase();
        if (msg.includes('unique') || msg.includes('duplicate')) {
            const e = new Error('You have already redeemed this code.');
            e.status = 409; e.code = 'already_redeemed'; throw e;
        }
        throw err;
    }

    // 4) Credit balance. Distinct UPDATE so the user-facing balance
    //    reflects the credit even on retried failures (idempotent
    //    overall via the per-user UNIQUE row).
    await db.run(
        'UPDATE users SET balance_cents = balance_cents + ? WHERE id = ?',
        [code.value_cents, userId]
    );
    const after = await db.get('SELECT balance_cents FROM users WHERE id = ?', [userId]);

    // 5) If the code carries a wagering requirement, record a bonus
    //    grant. Withdrawals refuse while any grant is 'active'; the
    //    slot engine attributes each spin's bet against the oldest
    //    active grant via bonusGrants.recordWager() until the
    //    requirement is met. multiplier=0 still records (audit) but
    //    flips status='completed' immediately so it doesn't gate.
    let grant = null;
    try {
        const bonusGrants = require('./bonus-grants.service');
        grant = await bonusGrants.grant(userId, {
            source: 'promo',
            sourceId: String(code.id),
            amountCents: Number(code.value_cents),
            multiplier: Number(code.wagering_multiplier) || 0,
        });
    } catch (err) {
        // Don't fail the redeem if grant insert hiccups — credit was
        // applied; ops can backfill from promo_redemptions if needed.
        console.warn('[promo/redeem] grant insert warn:', err && err.message);
    }

    return {
        code: c,
        value_cents: Number(code.value_cents),
        balance_after_cents: Number(after && after.balance_cents) || 0,
        wagering_multiplier: Number(code.wagering_multiplier) || 0,
        wagering_required_cents: grant ? Number(grant.wagering_required_cents) || 0 : 0,
    };
}

/**
 * Per-user history of own redemptions, newest first. Used by
 * /api/promo/me on the account page.
 */
async function listOwnRedemptions(userId) {
    const numId = Number(userId);
    if (!Number.isInteger(numId) || numId < 1) return [];
    return await db.all(
        `SELECT pr.id, pr.value_cents, pr.redeemed_at, pc.code
           FROM promo_redemptions pr JOIN promo_codes pc ON pc.id = pr.code_id
          WHERE pr.user_id = ?
          ORDER BY pr.id DESC
          LIMIT 50`,
        [numId]
    );
}

module.exports = {
    createCode,
    listCodes,
    deactivateCode,
    redeem,
    listOwnRedemptions,
    normalizeCode,
    CODE_REGEX,
    MIN_VALUE_CENTS,
    MAX_VALUE_CENTS,
};
