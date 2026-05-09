'use strict';

/**
 * /api/games — public game catalog + search
 *
 * Backs the global site search bar. Returns the same 100-game catalog defined
 * in shared/game-definitions.js, trimmed to the fields the search UI needs
 * (no payouts, symbol lists, or back-office config leak through).
 *
 * Sub-routes:
 *   GET /api/games                     — full catalog (cached, public)
 *   GET /api/games/search?q=...        — server-side fuzzy search + analytics log
 *   GET /api/games/popular             — top searched terms (last 7 days)
 *   POST /api/games/search/track       — log a search query (analytics)
 */

const express = require('express');
const games = require('../../shared/game-definitions');
const db = require('../database');
const { optionalAuth } = require('../middleware/auth');

const router = express.Router();

const PUBLIC_FIELDS = [
    'id', 'name', 'provider', 'themeCategory',
    'tag', 'tagClass', 'thumbnail', 'rtp', 'volatility',
    'minBet', 'maxBet', 'hot', 'jackpot', 'bonusType'
];

function projectGame(g) {
    const out = {};
    for (const f of PUBLIC_FIELDS) {
        if (g[f] !== undefined) out[f] = g[f];
    }
    out.slug = g.id;
    out.url = `/games/${encodeURIComponent(g.id)}.html`;
    return out;
}

const PUBLIC_CATALOG = games.map(projectGame);

// One-time async creation of the analytics table — fire and forget on first hit.
let _tableReady = false;
async function ensureTable() {
    if (_tableReady) return;
    try {
        const isPg = db.isPg && db.isPg();
        if (isPg) {
            await db.run(`
                CREATE TABLE IF NOT EXISTS search_analytics (
                    id SERIAL PRIMARY KEY,
                    user_id INTEGER,
                    query TEXT NOT NULL,
                    result_count INTEGER DEFAULT 0,
                    clicked_game_id TEXT,
                    ip TEXT,
                    user_agent TEXT,
                    created_at TIMESTAMPTZ DEFAULT NOW()
                )
            `);
            await db.run(`CREATE INDEX IF NOT EXISTS idx_search_analytics_query ON search_analytics(LOWER(query))`);
            await db.run(`CREATE INDEX IF NOT EXISTS idx_search_analytics_created_at ON search_analytics(created_at)`);
        } else {
            await db.run(`
                CREATE TABLE IF NOT EXISTS search_analytics (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    user_id INTEGER,
                    query TEXT NOT NULL,
                    result_count INTEGER DEFAULT 0,
                    clicked_game_id TEXT,
                    ip TEXT,
                    user_agent TEXT,
                    created_at TEXT DEFAULT (datetime('now'))
                )
            `);
            await db.run(`CREATE INDEX IF NOT EXISTS idx_search_analytics_query ON search_analytics(query)`);
            await db.run(`CREATE INDEX IF NOT EXISTS idx_search_analytics_created_at ON search_analytics(created_at)`);
        }
        _tableReady = true;
    } catch (e) {
        // Don't crash search just because analytics couldn't initialise.
        console.warn('[search-analytics] table init failed:', e.message);
    }
}

function fuzzyScore(query, text) {
    if (!query || !text) return 0;
    const q = String(query).toLowerCase().trim();
    const t = String(text).toLowerCase();
    if (!q) return 0;
    const idx = t.indexOf(q);
    if (idx === 0) return 100;
    if (idx > 0) return 80;
    const words = t.split(/\s+/);
    const qWords = q.split(/\s+/);
    let matched = 0;
    for (const qw of qWords) {
        for (const w of words) {
            if (w.indexOf(qw) === 0) { matched += 1; break; }
            if (w.indexOf(qw) !== -1) { matched += 0.5; break; }
        }
    }
    if (matched > 0) return (matched / qWords.length) * 60;
    return 0;
}

function searchCatalog(query, limit = 20) {
    if (!query || !String(query).trim()) return [];
    const results = [];
    for (const g of PUBLIC_CATALOG) {
        const nameScore = fuzzyScore(query, g.name);
        const providerScore = fuzzyScore(query, g.provider) * 0.6;
        const themeScore = fuzzyScore(query, g.themeCategory) * 0.5;
        const best = Math.max(nameScore, providerScore, themeScore);
        if (best > 10) results.push({ game: g, score: best });
    }
    results.sort((a, b) => b.score - a.score);
    return results.slice(0, limit).map(r => ({ ...r.game, _score: Math.round(r.score) }));
}

// ── Public catalog ────────────────────────────────────────────
router.get('/', (req, res) => {
    res.set('Cache-Control', 'public, max-age=300');
    res.json({
        success: true,
        count: PUBLIC_CATALOG.length,
        games: PUBLIC_CATALOG
    });
});

// ── Search ────────────────────────────────────────────────────
router.get('/search', optionalAuth, async (req, res) => {
    const q = String(req.query.q || '').trim().slice(0, 80);
    const limit = Math.min(parseInt(req.query.limit, 10) || 12, 50);

    const results = searchCatalog(q, limit);

    // Fire-and-forget analytics logging for non-trivial searches
    if (q && q.length >= 2) {
        ensureTable().then(() => {
            const userId = req.user ? req.user.id : null;
            const ip = (req.ip || '').slice(0, 64);
            const ua = (req.get('user-agent') || '').slice(0, 240);
            return db.run(
                `INSERT INTO search_analytics (user_id, query, result_count, ip, user_agent) VALUES (?, ?, ?, ?, ?)`,
                [userId, q.toLowerCase(), results.length, ip, ua]
            );
        }).catch(e => console.warn('[search] analytics insert failed:', e.message));
    }

    res.json({ success: true, query: q, count: results.length, results });
});

// ── Track a result-click for analytics ────────────────────────
router.post('/search/track', optionalAuth, express.json({ limit: '4kb' }), async (req, res) => {
    const q = String((req.body && req.body.query) || '').trim().toLowerCase().slice(0, 80);
    const gameId = String((req.body && req.body.gameId) || '').slice(0, 64) || null;
    if (!q) return res.json({ success: true, skipped: true });

    try {
        await ensureTable();
        const userId = req.user ? req.user.id : null;
        const ip = (req.ip || '').slice(0, 64);
        const ua = (req.get('user-agent') || '').slice(0, 240);
        await db.run(
            `INSERT INTO search_analytics (user_id, query, result_count, clicked_game_id, ip, user_agent) VALUES (?, ?, ?, ?, ?, ?)`,
            [userId, q, 1, gameId, ip, ua]
        );
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ success: false, error: 'track_failed' });
    }
});

// ── Popular searches (last 7 days) — public ───────────────────
router.get('/popular', async (req, res) => {
    try {
        await ensureTable();
        const isPg = db.isPg && db.isPg();
        const sql = isPg
            ? `SELECT query, COUNT(*) AS hits
               FROM search_analytics
               WHERE created_at > NOW() - INTERVAL '7 days' AND LENGTH(query) >= 2
               GROUP BY query
               ORDER BY hits DESC
               LIMIT 8`
            : `SELECT query, COUNT(*) AS hits
               FROM search_analytics
               WHERE created_at > datetime('now', '-7 days') AND length(query) >= 2
               GROUP BY query
               ORDER BY hits DESC
               LIMIT 8`;
        const rows = await db.all(sql);
        res.set('Cache-Control', 'public, max-age=120');
        res.json({
            success: true,
            popular: (rows || []).map(r => ({ query: r.query, hits: Number(r.hits) }))
        });
    } catch (e) {
        // Surface an empty list rather than 500ing — search bar must always render.
        res.json({ success: true, popular: [] });
    }
});

module.exports = router;
