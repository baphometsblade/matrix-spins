'use strict';

/**
 * Public, no-auth endpoints — the surface third parties (and the lobby
 * itself, before the user has signed in) reach without a session.
 *
 *   GET /api/public/hot-wins?limit=N
 *
 * Lists the biggest slot wins in the last 24 hours. Usernames are
 * anonymized to discourage doxing winners; server seeds and round
 * IDs are NOT exposed (round verification is a private flow gated
 * by /api/slot/rounds/:id).
 *
 * Authenticated routes that touch user state never live here. If a
 * future addition needs req.user, mount it elsewhere — the global
 * authenticateOptional middleware still runs ahead of this router,
 * but the handlers ignore it.
 */

const express = require('express');
const db = require('../database');

const router = express.Router();

const HOT_WINS_DEFAULT = 20;
const HOT_WINS_MAX = 50;
const HOT_WINS_WINDOW_SEC = 24 * 3600;

// Tiny in-process cache — every visitor on the lobby polls this; we
// don't want each poll to scan slot_rounds. 30s feels live enough
// for engagement without hammering the DB.
const cache = new Map(); // key -> { value, expiresAt }
const CACHE_TTL_MS = 30 * 1000;

function cacheGet(key) {
    const e = cache.get(key);
    if (e && e.expiresAt > Date.now()) return e.value;
    if (e) cache.delete(key);
    return null;
}
function cachePut(key, value) {
    cache.set(key, { value, expiresAt: Date.now() + CACHE_TTL_MS });
}

/**
 * "smoke142cd1c1f8" -> "sm***f8". Keeps a hint of identity so the
 * winner can recognize themselves without exposing the full handle
 * to scrapers / search engines.
 */
function anonymizeUsername(u) {
    if (!u) return 'anon';
    const s = String(u);
    if (s.length <= 4) return s.charAt(0) + '***';
    return s.slice(0, 2) + '***' + s.slice(-2);
}

router.get('/hot-wins', async (req, res) => {
    let limit = Number(req.query.limit);
    if (!Number.isFinite(limit) || limit < 1 || limit > HOT_WINS_MAX) limit = HOT_WINS_DEFAULT;

    const cacheKey = 'hot-wins:' + limit;
    const hit = cacheGet(cacheKey);
    if (hit) return res.json(hit);

    try {
        const isPg = db.kind === 'pg';
        const rows = await db.all(
            isPg
                ? `SELECT r.game_id, r.bet_cents, r.win_cents, r.created_at,
                          u.username
                     FROM slot_rounds r LEFT JOIN users u ON u.id = r.user_id
                    WHERE r.win_cents > 0
                      AND r.created_at >= NOW() - (? * INTERVAL '1 second')
                    ORDER BY r.win_cents DESC LIMIT ?`
                : `SELECT r.game_id, r.bet_cents, r.win_cents, r.created_at,
                          u.username
                     FROM slot_rounds r LEFT JOIN users u ON u.id = r.user_id
                    WHERE r.win_cents > 0
                      AND r.created_at >= datetime('now', ? || ' seconds')
                    ORDER BY r.win_cents DESC LIMIT ?`,
            isPg ? [HOT_WINS_WINDOW_SEC, limit] : ['-' + HOT_WINS_WINDOW_SEC, limit]
        );

        const payload = {
            window_seconds: HOT_WINS_WINDOW_SEC,
            wins: rows.map(r => {
                const bet = Number(r.bet_cents) || 0;
                const win = Number(r.win_cents) || 0;
                return {
                    game_id: r.game_id,
                    user: anonymizeUsername(r.username),
                    bet_cents: bet,
                    win_cents: win,
                    multiplier: bet > 0 ? Number((win / bet).toFixed(2)) : null,
                    at: r.created_at,
                };
            }),
        };
        cachePut(cacheKey, payload);
        res.json(payload);
    } catch (err) {
        console.error('[public/hot-wins]', err);
        res.status(500).json({ error: 'Failed to fetch hot wins.' });
    }
});

/**
 * Lifetime, fully-public, fully-aggregate slot stats. No PII, no per-
 * user data, no seeds. Used by the /stats.html transparency page and
 * any third-party that wants to confirm we publish what we claim.
 *
 * Per-game empirical_rtp (lifetime) is the honest one to publish:
 * a casino claiming 95% RTP that pays out 80% over a million spins
 * is lying. Pairs with /provably-fair.html and /verify-round.html as
 * the third leg of the trust story.
 *
 * Cache 5 minutes — slow-changing data, no point hammering the DB on
 * every page load.
 */
const STATS_CACHE_TTL_MS = 5 * 60 * 1000;

router.get('/stats', async (_req, res) => {
    // cacheGet uses the shared 30s default; we want 5min TTL here, so
    // check the underlying Map entry directly.
    const entry = cache.get('public-stats');
    if (entry && entry.expiresAt > Date.now()) return res.json(entry.value);

    try {
        // Single query for lifetime totals; second query GROUPed for
        // per-game empirical RTP. The engine's listGames() supplies
        // theoretical RTP and human-readable name.
        const totals = await db.get(
            `SELECT COUNT(*) AS spins,
                    COUNT(DISTINCT user_id) AS unique_players,
                    COALESCE(SUM(bet_cents), 0) AS wagered,
                    COALESCE(SUM(win_cents), 0) AS won,
                    COALESCE(MAX(win_cents), 0) AS biggest_win
               FROM slot_rounds`
        );
        const perGame = await db.all(
            `SELECT game_id,
                    COUNT(*) AS spins,
                    COALESCE(SUM(bet_cents), 0) AS wagered,
                    COALESCE(SUM(win_cents), 0) AS won,
                    COALESCE(MAX(win_cents), 0) AS biggest_win
               FROM slot_rounds GROUP BY game_id`
        );
        const engine = require('../services/slot-engine.service');
        const games = engine.listGames();
        const perGameMap = new Map(perGame.map(r => [r.game_id, r]));
        const wagered = Number((totals && totals.wagered) || 0);
        const won = Number((totals && totals.won) || 0);

        const payload = {
            generated_at: new Date().toISOString(),
            total_spins: Number((totals && totals.spins) || 0),
            unique_players: Number((totals && totals.unique_players) || 0),
            total_wagered_cents: wagered,
            total_won_cents: won,
            empirical_rtp: wagered > 0 ? won / wagered : null,
            biggest_single_win_cents: Number((totals && totals.biggest_win) || 0),
            games: games.map(g => {
                const pg = perGameMap.get(g.id) || { spins: 0, wagered: 0, won: 0, biggest_win: 0 };
                const w = Number(pg.wagered) || 0;
                const wn = Number(pg.won) || 0;
                return {
                    game_id: g.id,
                    name: g.name,
                    theoretical_rtp: g.rtp,
                    spins: Number(pg.spins) || 0,
                    wagered_cents: w,
                    won_cents: wn,
                    empirical_rtp: w > 0 ? wn / w : null,
                    biggest_win_cents: Number(pg.biggest_win) || 0,
                };
            }),
        };

        // Hand-rolled cache entry with a longer TTL than the hot-wins
        // map. Both share the same Map but the entry's expiresAt is
        // independent.
        cache.set('public-stats', { value: payload, expiresAt: Date.now() + STATS_CACHE_TTL_MS });
        res.json(payload);
    } catch (err) {
        console.error('[public/stats]', err);
        res.status(500).json({ error: 'Failed to compute public stats.' });
    }
});

/**
 * Public leaderboard — top users by NET WIN (won − wagered) over a
 * rolling window. Fully aggregate, anonymized, no PII. Built for
 * /stats.html and any third-party that wants "is anyone actually
 * winning?" answered honestly.
 *
 * MIN_QUALIFYING_SPINS keeps the board honest at low volume: a user
 * who happened to land one big win on their first spin would
 * dominate forever otherwise. Industry standard ranks high-volume
 * players, not lucky one-shots.
 */
const LB_DEFAULT_WINDOW_DAYS = 30;
const LB_MAX_WINDOW_DAYS = 365;
const LB_DEFAULT_LIMIT = 10;
const LB_MAX_LIMIT = 50;
const LB_MIN_SPINS = 10;
const LB_CACHE_TTL_MS = 60 * 1000;

router.get('/leaderboard', async (req, res) => {
    let windowDays = Number(req.query.window_days);
    if (!Number.isFinite(windowDays) || windowDays < 1 || windowDays > LB_MAX_WINDOW_DAYS) {
        windowDays = LB_DEFAULT_WINDOW_DAYS;
    }
    let limit = Number(req.query.limit);
    if (!Number.isFinite(limit) || limit < 1 || limit > LB_MAX_LIMIT) limit = LB_DEFAULT_LIMIT;
    const sinceSec = windowDays * 86400;

    const cacheKey = 'leaderboard:' + windowDays + ':' + limit;
    const entry = cache.get(cacheKey);
    if (entry && entry.expiresAt > Date.now()) return res.json(entry.value);

    try {
        const isPg = db.kind === 'pg';
        // Per-user net = SUM(win - bet) over the window; only users
        // with >= LB_MIN_SPINS qualify; ORDER BY net DESC LIMIT N.
        // Both backends use the same SQL via the wrapper's auto-rewrite
        // of '?' placeholders.
        const sql = isPg
            ? `SELECT u.username,
                      COUNT(*) AS spins,
                      COALESCE(SUM(r.bet_cents), 0) AS wagered,
                      COALESCE(SUM(r.win_cents), 0) AS won,
                      COALESCE(SUM(r.win_cents - r.bet_cents), 0) AS net
                 FROM slot_rounds r LEFT JOIN users u ON u.id = r.user_id
                WHERE r.created_at >= NOW() - (? * INTERVAL '1 second')
                GROUP BY u.username
               HAVING COUNT(*) >= ?
                ORDER BY net DESC
                LIMIT ?`
            : `SELECT u.username,
                      COUNT(*) AS spins,
                      COALESCE(SUM(r.bet_cents), 0) AS wagered,
                      COALESCE(SUM(r.win_cents), 0) AS won,
                      COALESCE(SUM(r.win_cents - r.bet_cents), 0) AS net
                 FROM slot_rounds r LEFT JOIN users u ON u.id = r.user_id
                WHERE r.created_at >= datetime('now', ? || ' seconds')
                GROUP BY u.username
               HAVING COUNT(*) >= ?
                ORDER BY net DESC
                LIMIT ?`;
        const params = isPg
            ? [sinceSec, LB_MIN_SPINS, limit]
            : ['-' + sinceSec, LB_MIN_SPINS, limit];
        const rows = await db.all(sql, params);

        const payload = {
            generated_at: new Date().toISOString(),
            window_days: windowDays,
            min_qualifying_spins: LB_MIN_SPINS,
            entries: rows.map((r, i) => ({
                rank: i + 1,
                user: anonymizeUsername(r.username),
                spins: Number(r.spins) || 0,
                wagered_cents: Number(r.wagered) || 0,
                won_cents: Number(r.won) || 0,
                net_cents: Number(r.net) || 0,
            })),
        };
        cache.set(cacheKey, { value: payload, expiresAt: Date.now() + LB_CACHE_TTL_MS });
        res.json(payload);
    } catch (err) {
        console.error('[public/leaderboard]', err);
        res.status(500).json({ error: 'Failed to compute leaderboard.' });
    }
});

module.exports = router;
// Exposed for tests so they can blow the in-process cache between
// assertions without restarting the server.
module.exports._test = { resetCache: () => cache.clear() };
