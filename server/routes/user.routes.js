'use strict';

const express = require('express');
const db = require('../database');
const { authenticate, bumpTokenVersion } = require('../middleware/auth');
const authEvents = require('../services/auth-events.service');
const mailer = require('../services/email.service');

function reqIp(req) {
    const fwd = req && req.headers && req.headers['x-forwarded-for'];
    if (fwd) return String(fwd).split(',')[0].trim();
    return (req && req.ip) || null;
}
function reqUa(req) {
    return (req && req.headers && req.headers['user-agent']) || null;
}

const router = express.Router();

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function userPublic(u) {
    return {
        id: u.id,
        username: u.username,
        email: u.email,
        email_verified: !!u.email_verified,
        display_name: u.display_name || null,
        date_of_birth: u.date_of_birth,
        balance: Number(u.balance_cents || 0) / 100,
        balance_cents: Number(u.balance_cents || 0),
        is_admin: !!u.is_admin,
        created_at: u.created_at,
    };
}

router.get('/me', authenticate, async (req, res) => {
    try {
        const user = await db.get(
            'SELECT id, username, email, email_verified, display_name, date_of_birth, balance_cents, is_admin, created_at FROM users WHERE id = ?',
            [req.user.id]
        );
        if (!user) return res.status(404).json({ error: 'User not found.' });
        res.json({ user: userPublic(user) });
    } catch (err) {
        console.error('[user/me]', err);
        res.status(500).json({ error: 'Failed to fetch user.' });
    }
});

router.patch('/me', authenticate, async (req, res) => {
    const { email, display_name } = req.body || {};
    const updates = [];
    const params = [];

    if (email !== undefined) {
        if (typeof email !== 'string' || !EMAIL_RE.test(email.trim())) {
            return res.status(400).json({ error: 'Please provide a valid email address.' });
        }
        const conflict = await db.get(
            'SELECT id FROM users WHERE lower(email) = lower(?) AND id <> ?',
            [email.trim(), req.user.id]
        );
        if (conflict) return res.status(409).json({ error: 'That email is already in use.' });
        updates.push('email = ?');
        params.push(email.trim());
    }
    if (display_name !== undefined) {
        if (display_name !== null) {
            if (typeof display_name !== 'string') return res.status(400).json({ error: 'display_name must be a string.' });
            const name = display_name.trim();
            if (name.length > 40) return res.status(400).json({ error: 'display_name must be ≤ 40 characters.' });
            if (name && !/^[\p{L}\p{N} ._-]{1,40}$/u.test(name)) {
                return res.status(400).json({ error: 'display_name contains unsupported characters.' });
            }
            updates.push('display_name = ?');
            params.push(name || null);
        } else {
            updates.push('display_name = NULL');
        }
    }

    if (updates.length === 0) return res.status(400).json({ error: 'No valid fields to update.' });
    params.push(req.user.id);

    try {
        const before = await db.get('SELECT email, username FROM users WHERE id = ?', [req.user.id]);
        await db.run('UPDATE users SET ' + updates.join(', ') + ' WHERE id = ?', params);
        const updated = await db.get(
            'SELECT id, username, email, email_verified, display_name, date_of_birth, balance_cents, is_admin, created_at FROM users WHERE id = ?',
            [req.user.id]
        );
        await authEvents.log({ userId: req.user.id, username: req.user.username, eventType: 'profile_update', outcome: 'success', req });
        // If the email address changed, alert BOTH addresses — the old
        // one so a compromised account surfaces the change, the new
        // one so we don't rely solely on a potentially-attacker inbox.
        if (before && before.email && email !== undefined && email.trim() && email.trim().toLowerCase() !== String(before.email).toLowerCase()) {
            for (const to of new Set([before.email, email.trim()])) {
                mailer.sendSecurityAlert({
                    to: to, username: req.user.username, event: 'email_change',
                    ip: reqIp(req), userAgent: reqUa(req),
                }).catch(function (err) { console.warn('[user/me] email alert failed:', err && err.message); });
            }
        }
        res.json({ user: userPublic(updated) });
    } catch (err) {
        console.error('[user/me PATCH]', err);
        res.status(500).json({ error: 'Failed to update profile.' });
    }
});

router.get('/login-history', authenticate, async (req, res) => {
    try {
        const rows = await authEvents.recentForUser(req.user.id, req.query.limit || 50);
        res.json({
            events: rows.map(r => ({
                id: r.id,
                type: r.event_type,
                outcome: r.outcome,
                ip: r.ip,
                user_agent: r.user_agent,
                reason: r.reason,
                at: r.created_at,
            })),
        });
    } catch (err) {
        console.error('[user/login-history]', err);
        res.status(500).json({ error: 'Failed to fetch history.' });
    }
});

function csvEscape(v) {
    if (v == null) return '';
    const s = String(v);
    if (/[",\n\r]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
    return s;
}

router.get('/deposits.csv', authenticate, async (req, res) => {
    try {
        const rows = await db.all(
            'SELECT id, amount_cents, currency, status, provider, created_at, completed_at FROM deposits WHERE user_id = ? ORDER BY id DESC LIMIT 5000',
            [req.user.id]
        );
        const header = 'id,amount,currency,status,provider,created_at,completed_at\n';
        const body = rows.map(r => [
            r.id,
            (Number(r.amount_cents) / 100).toFixed(2),
            r.currency, r.status, r.provider, r.created_at, r.completed_at,
        ].map(csvEscape).join(',')).join('\n');
        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', 'attachment; filename="my-deposits-' + new Date().toISOString().slice(0, 10) + '.csv"');
        // UTF-8 BOM so Excel on Windows doesn't read this as Windows-1252.
        res.send('﻿' + header + body + '\n');
    } catch (err) {
        console.error('[user/deposits.csv]', err);
        res.status(500).json({ error: 'Export failed.' });
    }
});

/**
 * Slot stats — total spins, total wagered, total won, biggest single
 * win, last spin time, and a per-game breakdown. Pure aggregate over
 * slot_rounds; nothing here changes balance or settles anything.
 *
 * The `?` placeholder reused via the db wrapper is rewritten to $N for
 * pg automatically — same SQL serves both backends.
 */
router.get('/slot-stats', authenticate, async (req, res) => {
    try {
        const totals = await db.get(
            `SELECT COUNT(*) AS spins,
                    COALESCE(SUM(bet_cents), 0) AS wagered,
                    COALESCE(SUM(win_cents), 0) AS won,
                    COALESCE(MAX(win_cents), 0) AS biggest_win,
                    MAX(created_at) AS last_spin_at
               FROM slot_rounds WHERE user_id = ?`,
            [req.user.id]
        );
        const wagered = Number((totals && totals.wagered) || 0);
        const won = Number((totals && totals.won) || 0);
        const biggest = Number((totals && totals.biggest_win) || 0);

        let biggestWinRound = null;
        if (biggest > 0) {
            const row = await db.get(
                `SELECT id, game_id, bet_cents, win_cents, created_at
                   FROM slot_rounds
                  WHERE user_id = ? AND win_cents = ?
                  ORDER BY id DESC LIMIT 1`,
                [req.user.id, biggest]
            );
            if (row) {
                biggestWinRound = {
                    id: row.id,
                    game_id: row.game_id,
                    bet_cents: Number(row.bet_cents),
                    win_cents: Number(row.win_cents),
                    created_at: row.created_at,
                };
            }
        }

        const byGameRows = await db.all(
            `SELECT game_id,
                    COUNT(*) AS spins,
                    COALESCE(SUM(bet_cents), 0) AS wagered,
                    COALESCE(SUM(win_cents), 0) AS won,
                    COALESCE(MAX(win_cents), 0) AS biggest_win
               FROM slot_rounds WHERE user_id = ?
              GROUP BY game_id ORDER BY spins DESC`,
            [req.user.id]
        );

        res.json({
            total_spins: Number((totals && totals.spins) || 0),
            wagered_cents: wagered,
            won_cents: won,
            net_cents: won - wagered,
            biggest_win_cents: biggest,
            // Empirical RTP from the user's own play history. Useful for
            // sanity-checking long-term variance against the published
            // theoretical RTP (95.2% / 95.32%).
            empirical_rtp: wagered > 0 ? won / wagered : null,
            biggest_win_round: biggestWinRound,
            last_spin_at: (totals && totals.last_spin_at) || null,
            by_game: byGameRows.map(r => ({
                game_id: r.game_id,
                spins: Number(r.spins),
                wagered_cents: Number(r.wagered),
                won_cents: Number(r.won),
                biggest_win_cents: Number(r.biggest_win),
            })),
        });
    } catch (err) {
        console.error('[user/slot-stats]', err);
        res.status(500).json({ error: 'Failed to fetch slot stats.' });
    }
});

/**
 * Streamed CSV download of the user's full spin history (capped at
 * 50,000 rows). Mirrors /api/user/deposits.csv: UTF-8 BOM so Excel
 * doesn't mojibake the header, attachment Content-Disposition.
 */
router.get('/slot-history.csv', authenticate, async (req, res) => {
    try {
        const rows = await db.all(
            `SELECT id, game_id, bet_cents, win_cents, balance_after_cents,
                    server_seed, server_seed_hash, client_seed, nonce, created_at
               FROM slot_rounds
              WHERE user_id = ?
              ORDER BY id DESC LIMIT 50000`,
            [req.user.id]
        );
        const header = 'id,game_id,bet,win,net,balance_after,server_seed,server_seed_hash,client_seed,nonce,created_at\n';
        const body = rows.map(r => [
            r.id,
            r.game_id,
            (Number(r.bet_cents) / 100).toFixed(2),
            (Number(r.win_cents) / 100).toFixed(2),
            ((Number(r.win_cents) - Number(r.bet_cents)) / 100).toFixed(2),
            (Number(r.balance_after_cents) / 100).toFixed(2),
            r.server_seed, r.server_seed_hash, r.client_seed, r.nonce, r.created_at,
        ].map(csvEscape).join(',')).join('\n');
        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', 'attachment; filename="my-slot-history-' + new Date().toISOString().slice(0, 10) + '.csv"');
        res.send('﻿' + header + body + '\n');
    } catch (err) {
        console.error('[user/slot-history.csv]', err);
        res.status(500).json({ error: 'Export failed.' });
    }
});

router.get('/deposits', authenticate, async (req, res) => {
    try {
        const rows = await db.all(
            'SELECT id, amount_cents, currency, status, created_at, completed_at FROM deposits WHERE user_id = ? ORDER BY id DESC LIMIT 100',
            [req.user.id]
        );
        res.json({
            deposits: rows.map(r => ({
                id: r.id,
                amount: Number(r.amount_cents) / 100,
                amount_cents: Number(r.amount_cents),
                currency: r.currency,
                status: r.status,
                created_at: r.created_at,
                completed_at: r.completed_at,
            })),
        });
    } catch (err) {
        console.error('[user/deposits]', err);
        res.status(500).json({ error: 'Failed to fetch deposit history.' });
    }
});

/**
 * GET /api/user/export.json
 *
 * GDPR-style full export of everything the server holds about the
 * signed-in user. Authed; streams the whole payload inline. Clients
 * use this for "download my data" in the account page.
 *
 * Secrets are redacted:
 *   - password_hash never appears
 *   - recovery code hashes are omitted; counts are surfaced
 *   - TOTP secret is never returned
 *   - only safe columns from auth_events are included
 */
router.get('/export.json', authenticate, async (req, res) => {
    try {
        const user = await db.get(
            `SELECT id, username, email, display_name, date_of_birth, balance_cents, is_admin,
                    deposit_limit_daily_cents, deposit_limit_weekly_cents, deposit_limit_monthly_cents,
                    loss_limit_daily_cents,
                    created_at
               FROM users WHERE id = ?`,
            [req.user.id]
        );
        if (!user) return res.status(404).json({ error: 'User not found.' });

        const [deposits, refunds, nfts, adjustments, events, twofa, recoveryCount] = await Promise.all([
            db.all(
                `SELECT id, provider, provider_ref, amount_cents, currency, status, created_at, completed_at
                   FROM deposits WHERE user_id = ? ORDER BY id DESC`,
                [req.user.id]
            ),
            db.all(
                `SELECT id, deposit_id, amount_cents, provider_ref, reason, created_at
                   FROM refunds WHERE user_id = ? ORDER BY id DESC`,
                [req.user.id]
            ),
            db.all(
                `SELECT id, token_id, provider, chain, contract_address, metadata, signature, minted_at
                   FROM nft_receipts WHERE user_id = ? ORDER BY id DESC`,
                [req.user.id]
            ),
            db.all(
                `SELECT id, admin_username, delta_cents, balance_after_cents, reason, created_at
                   FROM balance_adjustments WHERE user_id = ? ORDER BY id DESC`,
                [req.user.id]
            ),
            db.all(
                `SELECT id, event_type, outcome, ip, user_agent, reason, created_at
                   FROM auth_events WHERE user_id = ? ORDER BY id DESC LIMIT 500`,
                [req.user.id]
            ),
            db.get(
                `SELECT enabled, created_at, enabled_at FROM user_totp_secrets WHERE user_id = ?`,
                [req.user.id]
            ),
            db.get(
                `SELECT COUNT(*) AS n FROM user_recovery_codes WHERE user_id = ? AND used_at IS NULL`,
                [req.user.id]
            ),
        ]);

        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.setHeader('Content-Disposition', 'attachment; filename="matrix-spins-data-' + user.username + '-' + new Date().toISOString().slice(0, 10) + '.json"');
        res.json({
            exported_at: new Date().toISOString(),
            user: user,
            deposits: deposits.map(d => ({ ...d, amount: Number(d.amount_cents) / 100 })),
            refunds: refunds.map(r => ({ ...r, amount: Number(r.amount_cents) / 100 })),
            nft_receipts: nfts.map(n => ({
                ...n,
                metadata: typeof n.metadata === 'string' ? JSON.parse(n.metadata) : n.metadata,
            })),
            balance_adjustments: adjustments.map(a => ({
                ...a,
                delta: Number(a.delta_cents) / 100,
                balance_after: Number(a.balance_after_cents) / 100,
            })),
            account_activity: events,
            two_factor: {
                enabled: !!(twofa && twofa.enabled),
                configured_at: twofa && twofa.created_at,
                enabled_at: twofa && twofa.enabled_at,
                recovery_codes_remaining: Number((recoveryCount && recoveryCount.n) || 0),
            },
        });
    } catch (err) {
        console.error('[user/export.json]', err);
        res.status(500).json({ error: 'Export failed.' });
    }
});

/**
 * GET/PUT /api/user/stats — per-user gameplay stats blob.
 *
 * The client keeps its running counters (spins, wins, wager, etc.) in
 * localStorage and syncs the whole object here so sessions carry across
 * devices. We don't interpret the shape on the server — we validate a
 * size cap, store it, and give it back on read.
 */
router.get('/stats', authenticate, async (req, res) => {
    try {
        const row = await db.get('SELECT stats_json, updated_at FROM user_stats WHERE user_id = ?', [req.user.id]);
        if (!row) return res.json({ stats: null, updated_at: null });
        let stats;
        try { stats = JSON.parse(row.stats_json); } catch { stats = null; }
        res.json({ stats, updated_at: row.updated_at });
    } catch (err) {
        console.error('[user/stats GET]', err);
        res.status(500).json({ error: 'Failed to fetch stats.' });
    }
});

router.put('/stats', authenticate, async (req, res) => {
    const body = req.body || {};
    const stats = body.stats;
    if (!stats || typeof stats !== 'object' || Array.isArray(stats)) {
        return res.status(400).json({ error: 'stats must be an object.' });
    }
    let json;
    try { json = JSON.stringify(stats); }
    catch { return res.status(400).json({ error: 'stats must be JSON-serializable.' }); }
    if (json.length > 64 * 1024) {
        return res.status(413).json({ error: 'stats payload too large (max 64 KB).' });
    }
    try {
        const existing = await db.get('SELECT user_id FROM user_stats WHERE user_id = ?', [req.user.id]);
        if (existing) {
            await db.run(
                "UPDATE user_stats SET stats_json = ?, updated_at = " + db.sqlNow() + " WHERE user_id = ?",
                [json, req.user.id]
            );
        } else {
            await db.run(
                'INSERT INTO user_stats (user_id, stats_json) VALUES (?, ?)',
                [req.user.id, json]
            );
        }
        res.json({ ok: true });
    } catch (err) {
        console.error('[user/stats PUT]', err);
        res.status(500).json({ error: 'Failed to save stats.' });
    }
});

/**
 * GET /api/user/return-status — "is this a returning user?"
 *
 * Honest signal only: derived from real auth history and deposit totals.
 * - isReturn is true when the previous successful login happened 7+
 *   days ago (ignoring the current session).
 * - offerTier is seeded by lifetime completed-deposit volume. Platinum
 *   ≥ $1,000, gold ≥ $250, silver ≥ $50, otherwise bronze.
 * The client uses the tier to theme the welcome-back overlay; it never
 * affects balances or bonuses.
 */
router.get('/return-status', authenticate, async (req, res) => {
    try {
        const prev = await db.get(
            `SELECT created_at FROM auth_events
              WHERE user_id = ? AND event_type = 'login' AND outcome = 'success'
              ORDER BY id DESC LIMIT 1 OFFSET 1`,
            [req.user.id]
        );
        let isReturn = false;
        let daysAway = 0;
        if (prev && prev.created_at) {
            const prevMs = new Date(prev.created_at).getTime();
            if (Number.isFinite(prevMs)) {
                daysAway = Math.floor((Date.now() - prevMs) / 86400000);
                isReturn = daysAway >= 7;
            }
        }

        const agg = await db.get(
            `SELECT COALESCE(SUM(amount_cents), 0) AS total
               FROM deposits WHERE user_id = ? AND status = 'completed'`,
            [req.user.id]
        );
        const cents = Number((agg && agg.total) || 0);
        let offerTier = 'bronze';
        if (cents >= 100000) offerTier = 'platinum';
        else if (cents >= 25000) offerTier = 'gold';
        else if (cents >= 5000) offerTier = 'silver';

        res.json({
            isReturn,
            daysAway,
            offerTier,
            lifetimeDepositCents: cents,
        });
    } catch (err) {
        console.error('[user/return-status]', err);
        res.status(500).json({ error: 'Failed to fetch return status.' });
    }
});

/**
 * GET /api/user/loss-streak-offer — compensatory-offer eligibility.
 *
 * This build settles wagers client-side and does not yet persist round
 * results to the server, so we don't have a real loss-streak signal to
 * act on. We report the only honest answer — { eligible: false } — and
 * the client's handler already treats that as "show nothing." When
 * server-side bet accounting lands, the real rule (e.g. "4+ consecutive
 * losing sessions totaling ≥ $50 net loss in the last 24h") replaces
 * this body.
 */
router.get('/loss-streak-offer', authenticate, async (_req, res) => {
    res.json({ eligible: false, offer: null });
});

/**
 * Self-exclusion ("take a break"). Responsible-gambling feature.
 *
 * POST /api/user/self-exclude { hours }
 *   Sets users.self_excluded_until = now() + hours. Active exclusions
 *   can only be extended — never shortened or cancelled — by the user;
 *   only an operator may lift one. Session is also invalidated so the
 *   user gets logged out immediately.
 *
 * GET /api/user/self-exclusion
 *   Returns { active, until, seconds_remaining } — used by the client
 *   to render the overlay and block bets.
 */
const SELF_EXCLUDE_CHOICES_HOURS = [24, 48, 72, 168, 336, 720, 2160, 4320, 8760];

router.post('/self-exclude', authenticate, async (req, res) => {
    const hours = Number((req.body || {}).hours);
    if (!Number.isFinite(hours) || !SELF_EXCLUDE_CHOICES_HOURS.includes(hours)) {
        return res.status(400).json({
            error: 'hours must be one of: ' + SELF_EXCLUDE_CHOICES_HOURS.join(', '),
            allowed_hours: SELF_EXCLUDE_CHOICES_HOURS,
        });
    }
    try {
        const current = await db.get(
            'SELECT self_excluded_until, token_version FROM users WHERE id = ?',
            [req.user.id]
        );
        if (!current) return res.status(404).json({ error: 'User not found.' });

        const nowMs = Date.now();
        const requestedMs = nowMs + hours * 3600 * 1000;
        const existingMs = current.self_excluded_until ? Date.parse(current.self_excluded_until) : 0;
        // Can only extend. If the user asks for 24h while already excluded
        // for 7 days, we keep the longer exclusion.
        const effectiveMs = Math.max(requestedMs, existingMs || 0);
        const untilIso = new Date(effectiveMs).toISOString();

        await db.run(
            'UPDATE users SET self_excluded_until = ? WHERE id = ?',
            [untilIso, req.user.id]
        );
        // Bumping token_version (with cache invalidation) kicks every
        // device currently signed into this account — including the one
        // that just made this call. The client will get 401 on its next
        // authed request.
        await bumpTokenVersion(req.user.id);

        await authEvents.log({
            userId: req.user.id, username: req.user.username,
            eventType: 'self_exclude', outcome: 'success', req,
            reason: 'hours=' + hours + ' until=' + untilIso,
        });

        res.json({
            ok: true,
            self_exclusion: {
                active: true,
                until: untilIso,
                seconds_remaining: Math.max(0, Math.round((effectiveMs - nowMs) / 1000)),
            },
        });
    } catch (err) {
        console.error('[user/self-exclude]', err);
        res.status(500).json({ error: 'Failed to set self-exclusion.' });
    }
});

router.get('/self-exclusion', authenticate, async (req, res) => {
    try {
        const row = await db.get('SELECT self_excluded_until FROM users WHERE id = ?', [req.user.id]);
        const untilIso = row && row.self_excluded_until;
        const untilMs = untilIso ? Date.parse(untilIso) : 0;
        const nowMs = Date.now();
        const active = Number.isFinite(untilMs) && untilMs > nowMs;
        res.json({
            active,
            until: active ? new Date(untilMs).toISOString() : null,
            seconds_remaining: active ? Math.round((untilMs - nowMs) / 1000) : 0,
        });
    } catch (err) {
        console.error('[user/self-exclusion]', err);
        res.status(500).json({ error: 'Failed to fetch self-exclusion.' });
    }
});

/**
 * Daily loss limit (responsible-gambling).
 *
 * GET  /api/user/loss-limit
 *     { limit_cents, used_cents, remaining_cents, reset_at }
 *
 * PUT  /api/user/loss-limit { daily_cents }
 *     Decreases apply immediately. Increases (and moves from a real
 *     cap back to 0/unlimited) are rejected — same cooling-off
 *     policy as the deposit-limit endpoint.
 */
const LOSS_LIMIT_MAX_CENTS = 10000 * 100; // $10,000
const LOSS_WINDOW_SEC = 86400;

router.get('/loss-limit', authenticate, async (req, res) => {
    try {
        const row = await db.get('SELECT loss_limit_daily_cents FROM users WHERE id = ?', [req.user.id]);
        if (!row) return res.status(404).json({ error: 'User not found.' });
        const limit = Number(row.loss_limit_daily_cents || 0);
        const engine = require('../services/slot-engine.service');
        const { used, oldestAt } = await engine.sumNetLossSince(req.user.id, LOSS_WINDOW_SEC);
        const resetAt = oldestAt
            ? new Date(Date.parse(oldestAt) + LOSS_WINDOW_SEC * 1000).toISOString()
            : new Date(Date.now() + LOSS_WINDOW_SEC * 1000).toISOString();
        res.json({
            limit_cents: limit,
            used_cents: used,
            remaining_cents: limit > 0 ? Math.max(0, limit - used) : null,
            reset_at: resetAt,
        });
    } catch (err) {
        console.error('[user/loss-limit GET]', err);
        res.status(500).json({ error: 'Failed to fetch loss limit.' });
    }
});

router.put('/loss-limit', authenticate, async (req, res) => {
    const { daily_cents } = req.body || {};
    const n = Number(daily_cents);
    if (!Number.isFinite(n) || n < 0 || n > LOSS_LIMIT_MAX_CENTS || Math.round(n) !== n) {
        return res.status(400).json({
            error: 'daily_cents must be an integer between 0 and ' + LOSS_LIMIT_MAX_CENTS + '.',
        });
    }
    try {
        const cur = await db.get('SELECT loss_limit_daily_cents FROM users WHERE id = ?', [req.user.id]);
        if (!cur) return res.status(404).json({ error: 'User not found.' });
        const current = Number(cur.loss_limit_daily_cents || 0);
        if (n === current) return res.json({ limit_cents: current, note: 'No change.' });
        // Decreases: a real non-zero cap moving down to a smaller non-zero
        // cap. Moving from some cap to 0 (unlimited) or from 0 to anything
        // non-zero are both "increases" (weakening the gate). Reject.
        const isDecrease = current !== 0 && n !== 0 && n < current;
        if (!isDecrease) {
            return res.status(403).json({
                error: 'Loss-limit increases require a 24-hour cooling-off period and must be applied by an operator. Only decreases take effect immediately.',
                code: 'increase_rejected',
                current_cents: current,
            });
        }
        await db.run('UPDATE users SET loss_limit_daily_cents = ? WHERE id = ?', [n, req.user.id]);
        res.json({ limit_cents: n, note: 'Limit decreased.' });
    } catch (err) {
        console.error('[user/loss-limit PUT]', err);
        res.status(500).json({ error: 'Failed to update loss limit.' });
    }
});

router.delete('/', authenticate, async (req, res) => {
    // Hard-deletes the user row; deposits and NFT receipts are retained
    // so refunds and accounting can still resolve, but user_id is
    // anonymized (0) so no PII persists. Matches the GDPR "right to
    // erasure" pattern used by regulated platforms.
    const { confirm_username } = req.body || {};
    try {
        const user = await db.get('SELECT username FROM users WHERE id = ?', [req.user.id]);
        if (!user) return res.status(404).json({ error: 'User not found.' });
        if (confirm_username !== user.username) {
            return res.status(400).json({ error: 'To confirm deletion, send { "confirm_username": "<your username>" }.' });
        }
        const isPg = db.kind === 'pg';
        // Detach deposits and NFTs (keep the rows for accounting, drop PII)
        await db.run('UPDATE deposits SET user_id = 0 WHERE user_id = ?', [req.user.id]);
        await db.run('UPDATE nft_receipts SET user_id = 0 WHERE user_id = ?', [req.user.id]);
        await db.run('DELETE FROM password_resets WHERE user_id = ?', [req.user.id]);
        await db.run('DELETE FROM refunds WHERE user_id = ?', [req.user.id]);
        await db.run('DELETE FROM users WHERE id = ?', [req.user.id]);
        console.log('[user/delete] account ' + req.user.id + ' deleted');
        res.json({ ok: true });
        void isPg;
    } catch (err) {
        console.error('[user/delete]', err);
        res.status(500).json({ error: 'Failed to delete account.' });
    }
});

module.exports = router;
