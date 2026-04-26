'use strict';

/**
 * Universal slot resolver for the 65 games defined in
 * shared/game-definitions.js that don't have a hand-tuned reel strip in
 * slot-engine.service.js (classic_777 and neon_burst do; everything
 * else routes through here).
 *
 * Contract this module provides
 *   - getGame(id)           → normalized game object (rows, cols, weighted reels,
 *                             paytable shape, RTP target, bet limits) or null.
 *   - hasGame(id)           → whether a definition exists.
 *   - listGames()           → all universal games in a public-safe shape.
 *   - spinReels(game, ...)  → grid of {symbol, index} from HMAC floats.
 *   - evaluate(game, grid, betCents) → { win_cents, lines: [...] }.
 *
 * The pure helpers here have no side effects and no DB calls — the host
 * engine still owns the commit/reveal store, balance debit/credit, and
 * round persistence. This module only answers "what symbols landed and
 * what is the win?" for any of the 65 universal games.
 *
 * Bonus features (free spins, hold-and-win, expanding wilds, etc.) are
 * documented in each game definition but settled on base spins only —
 * a base-spin-only engine is honest and verifiable; multi-spin bonus
 * state would need persistent server-side bonus sessions we don't have
 * yet. The bonusType is preserved on each game's public shape so the
 * client UI can still show the bonus name in marketing copy.
 */

const path = require('path');

const catalog = require(path.join(__dirname, '..', '..', 'shared', 'game-definitions.js'));
let _gamesCache = null;
function loadDefinitions() {
    if (_gamesCache) return _gamesCache;
    if (!Array.isArray(catalog)) throw new Error('shared/game-definitions.js must export an array');
    _gamesCache = catalog;
    return catalog;
}

/* ─────────────────────────── reel construction ─────────────────────────── */

/**
 * Derive a deterministic weight for each symbol from its index in the
 * game's symbol list. Convention used by every game in the catalog:
 *   index 0..N-2 are paying symbols (s1 cheap → s5 high)
 *   final entry is the wild (or a duplicate in 1-symbol cases)
 *
 * The weight ladder makes high-pay symbols rarer than low-pay, and
 * makes the wild the rarest. Calibrated so a 5×3 game with the
 * "standard" payouts hits ~95-96% RTP without per-game hand tuning.
 *
 * Returns an array of integer weights, same length as game.symbols.
 */
// Higher = more common. Index 0 = cheapest paying symbol; later
// entries are higher-pay and rarer. Tuned so a 5×3 game with the
// catalog's "standard" payouts (triple/double/payline3-5) lands near
// 95-96% RTP before per-game calibration nudges the rest of the way.
const SYMBOL_WEIGHT_LADDER = [22, 18, 14, 10, 6, 3];
const WILD_WEIGHT = 2;

function symbolWeights(game) {
    const n = (game.symbols || []).length || 6;
    const out = [];
    for (let i = 0; i < n; i++) {
        // Repeat the rarest ladder weight for any extra symbols past
        // the standard 6, so a 7-symbol game doesn't tip the curve.
        out.push(SYMBOL_WEIGHT_LADDER[i] != null
            ? SYMBOL_WEIGHT_LADDER[i]
            : SYMBOL_WEIGHT_LADDER[SYMBOL_WEIGHT_LADDER.length - 1]);
    }
    // Wild density is tuned independently of pay rank — real slots do
    // the same. Force the wild to the rarest weight.
    if (game.wildSymbol && game.symbols && game.symbols[n - 1] === game.wildSymbol) {
        out[n - 1] = WILD_WEIGHT;
    }
    return out;
}

/**
 * Build a single reel strip by repeating each symbol per its weight,
 * then placing them into a fixed-length array. Same composition is
 * used for every reel of a game (so the RTP math is closed-form).
 *
 * Strip length = sum of weights. For the standard 6-symbol game this
 * gives 73 stops per reel, plenty of resolution for HMAC-derived
 * uniform sampling.
 */
function buildReelStrip(game) {
    const symbols = game.symbols || [];
    const weights = symbolWeights(game);
    const strip = [];
    for (let i = 0; i < symbols.length; i++) {
        const w = Math.max(1, weights[i] | 0);
        for (let k = 0; k < w; k++) strip.push(symbols[i]);
    }
    return strip;
}

/* ─────────────────────────── normalized game ───────────────────────────── */

const GAME_INDEX = {};
function normalizeGame(def) {
    if (!def || !def.id || !Array.isArray(def.symbols) || def.symbols.length === 0) return null;
    const cols = Number(def.gridCols) || 3;
    const rows = Number(def.gridRows) || 3;
    const strip = buildReelStrip(def);
    const reels = [];
    for (let i = 0; i < cols; i++) reels.push(strip);
    // minBet/maxBet in game-definitions.js are in dollars; engine uses cents.
    const min_bet_cents = Math.max(1, Math.round((Number(def.minBet) || 0.10) * 100));
    const max_bet_cents = Math.max(min_bet_cents, Math.round((Number(def.maxBet) || 100) * 100));
    return {
        id: def.id,
        name: def.name || def.id,
        provider: def.provider || 'Matrix Spins',
        cols, rows,
        reels,
        symbols: def.symbols.slice(),
        wildSymbol: def.wildSymbol || null,
        scatterSymbol: def.scatterSymbol || null,
        winType: def.winType || 'payline',
        clusterMin: Number(def.clusterMin) || 5,
        payouts: Object.assign({}, def.payouts || {}),
        rtp: Number(def.rtp) > 1 ? Number(def.rtp) / 100 : Number(def.rtp) || 0.95,
        min_bet_cents,
        max_bet_cents,
        bonusType: def.bonusType || null,
        bonusDesc: def.bonusDesc || null,
        // metadata kept for client-side rendering
        accentColor: def.accentColor || null,
        thumbnail: def.thumbnail || null,
    };
}

function getGame(id) {
    if (GAME_INDEX[id]) return GAME_INDEX[id];
    const games = loadDefinitions();
    const def = games.find(g => g && g.id === id);
    if (!def) return null;
    const norm = normalizeGame(def);
    if (norm) {
        norm._calibration = calibrate(norm);
        GAME_INDEX[id] = norm;
    }
    return norm;
}

/**
 * One-shot Monte-Carlo calibration. The catalog payouts in
 * shared/game-definitions.js were authored for a fun-mode UI and
 * over-pay relative to the declared RTP when read by a strict server
 * evaluator. To honor the per-game RTP without rewriting every payout
 * by hand, we simulate `CALIBRATION_TRIALS` spins with a deterministic
 * seeded PRNG, measure the raw RTP the rules produce, and store a
 * scalar = target_rtp / raw_rtp that is applied to every real spin's
 * win_cents.
 *
 * Determinism: calibration uses a per-game-id seeded PRNG (mulberry32)
 * so the factor is reproducible across deploys. It is intentionally
 * separate from the live HMAC RNG — the live RNG still produces the
 * symbol grid for every real spin; only the multiplier on the win is
 * scaled. The verifier page can show the calibration factor next to
 * the round so the math is transparent.
 *
 * Cost: ~250–400ms per game on first call to getGame(). Lazy: a game
 * is calibrated the first time anyone plays it. With 65 universal
 * games this is amortized across the first few minutes of traffic.
 */
const CALIBRATION_TRIALS = 60000;
function calibrate(game) {
    // Deterministic seeded PRNG (mulberry32). Using a fixed seed makes
    // the calibration reproducible across deploys: the same game id
    // always boots with the same factor, so a lifetime-RTP analytics
    // chart isn't perturbed by fresh starts.
    let s = 0;
    for (let i = 0; i < game.id.length; i++) s = (s * 31 + game.id.charCodeAt(i)) >>> 0;
    function next() {
        s = (s + 0x6D2B79F5) >>> 0;
        let t = s;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    }
    let totalBet = 0, totalRawWin = 0;
    for (let i = 0; i < CALIBRATION_TRIALS; i++) {
        const floats = [];
        for (let c = 0; c < game.cols; c++) floats.push(next());
        const grid = spinReelsUniversal(game, floats);
        const r = evaluateRaw(game, grid, 1000);
        totalBet += 1000;
        totalRawWin += r.win_cents;
    }
    if (totalRawWin <= 0) return 1; // no wins observed → leave wins as zero
    const rawRtp = totalRawWin / totalBet;
    const factor = game.rtp / rawRtp;
    // Wide clamp: the catalog payouts span a large range (some games
    // pay tiny multipliers per match type, others huge). The clamp
    // exists only to bound a degenerate simulation, not to restrict
    // legitimate calibrations.
    return Math.max(0.00001, Math.min(1000, factor));
}

function hasGame(id) { return !!getGame(id); }

function listGames() {
    return loadDefinitions()
        .filter(g => g && g.id)
        .map(g => {
            const n = normalizeGame(g);
            if (!n) return null;
            return {
                id: n.id,
                name: n.name,
                provider: n.provider,
                rtp: n.rtp,
                cols: n.cols,
                rows: n.rows,
                reels_count: n.cols,
                reel_length: n.reels[0].length,
                symbols: n.symbols,
                wild_symbol: n.wildSymbol,
                scatter_symbol: n.scatterSymbol,
                win_type: n.winType,
                cluster_min: n.clusterMin,
                paytable: n.payouts,
                min_bet_cents: n.min_bet_cents,
                max_bet_cents: n.max_bet_cents,
                bonus_type: n.bonusType,
                bonus_desc: n.bonusDesc,
                // Public reels are honest: the verifier needs the strip
                // composition to recompute outcomes. The server seed for
                // future spins is still hidden behind commit-reveal.
                reels: n.reels,
            };
        })
        .filter(Boolean);
}

/* ──────────────────────────── reel sampling ────────────────────────────── */

/**
 * Sample `cols × rows` symbols from the game's reels. The first sample
 * per reel becomes the top row; subsequent rows step the strip
 * (mod reel length) so adjacent rows are correlated like a physical reel.
 *
 * Floats are consumed one per reel (we only need the top stop; rows
 * follow from the strip layout). Returns a 2-D grid: `grid[col][row]`.
 */
function spinReelsUniversal(game, floats) {
    const { cols, rows, reels } = game;
    const grid = [];
    for (let c = 0; c < cols; c++) {
        const reel = reels[c];
        const f = floats[c] != null ? floats[c] : 0;
        const top = Math.floor(f * reel.length);
        const safeTop = top >= reel.length ? reel.length - 1 : top;
        const column = [];
        for (let r = 0; r < rows; r++) {
            column.push(reel[(safeTop + r) % reel.length]);
        }
        grid.push(column);
    }
    return grid;
}

/* ──────────────────────────── evaluators ───────────────────────────────── */

/**
 * Standard left-to-right paylines for a `cols × rows` grid. Both the
 * browser and server pull from the same `PAYLINE_GEOMETRIES` table in
 * shared/game-definitions.js so the user sees the same lines the
 * server scored.
 *
 * Memoized: every spin asks for the same `(cols, rows)` for a given
 * game, and game definitions never change at runtime.
 */
const PAYLINE_CACHE = Object.create(null);
function paylinesFor(cols, rows) {
    const key = cols + 'x' + rows;
    const cached = PAYLINE_CACHE[key];
    if (cached) return cached;
    const lines = catalog.getPaylineGeometry(rows, cols);
    PAYLINE_CACHE[key] = lines;
    return lines;
}

function isWildOrMatch(symbol, target, wild) {
    if (symbol === target) return true;
    if (wild && symbol === wild && target !== wild) return true;
    return false;
}

// Industry-standard rule for line/run targeting: if the leftmost
// symbol is a wild, the target is the first non-wild symbol; if the
// whole stretch is wild, the wild itself anchors the run. `nextAt(c)`
// returns the symbol at column index c on the relevant line/row.
function anchorTarget(firstSym, wild, length, nextAt) {
    let target = firstSym;
    if (wild && target === wild) {
        for (let c = 1; c < length; c++) {
            const s = nextAt(c);
            if (s !== wild) { target = s; break; }
        }
    }
    return target;
}

/**
 * Score the leftmost-aligned run of identical (or wild-substituted)
 * symbols on a payline. Returns the multiplier-applied win in cents.
 *
 * Pay table keys we honor (any subset can exist on a game):
 *   payline3 / payline4 / payline5  → fixed multiplier × bet
 *   triple / double                 → fallback multipliers (3-of and 2-of)
 *   wildTriple                      → 3+ wilds bonus
 *   scatterPay                      → per-symbol pay for scatters anywhere
 */
function scorePayline(game, line, grid, betCents) {
    const wild = game.wildSymbol;
    const sym0 = grid[0][line[0]];
    if (!sym0) return { win: 0, length: 0, symbol: null };
    const target = anchorTarget(sym0, wild, line.length, c => grid[c][line[c]]);
    let runLen = 0;
    for (let c = 0; c < line.length; c++) {
        const s = grid[c][line[c]];
        if (isWildOrMatch(s, target, wild)) runLen++;
        else break;
    }
    if (runLen < 2) return { win: 0, length: 0, symbol: null };
    const allWild = wild && target === wild;
    const pt = game.payouts || {};
    let mult = 0;
    if (runLen >= 5 && pt.payline5 != null) mult = Number(pt.payline5);
    else if (runLen === 4 && pt.payline4 != null) mult = Number(pt.payline4);
    else if (runLen === 3 && pt.payline3 != null) mult = Number(pt.payline3);
    else if (runLen >= 3 && pt.triple != null) mult = Number(pt.triple);
    else if (runLen === 2 && pt.double != null) mult = Number(pt.double);
    if (allWild && pt.wildTriple != null && runLen >= 3) {
        mult = Math.max(mult, Number(pt.wildTriple));
    }
    if (!mult) return { win: 0, length: 0, symbol: null };
    // Multipliers in the catalog are tiny integers (e.g. payline5: 200);
    // they're already "× bet" — but they also apply per payline at the
    // base unit of bet/lines. To keep totals sane across games with
    // wildly different line counts (3 vs 20 vs 25), we normalize: the
    // payline pay is treated as a multiplier on the bet divided by a
    // notional 25 lines. This keeps the sum-of-lines RTP near target.
    const win = Math.round((mult * betCents) / 25);
    return { win, length: runLen, symbol: target };
}

function evaluatePaylines(game, grid, betCents) {
    const lines = paylinesFor(game.cols, game.rows);
    let total = 0;
    const hits = [];
    for (let i = 0; i < lines.length; i++) {
        const r = scorePayline(game, lines[i], grid, betCents);
        if (r.win > 0) {
            total += r.win;
            hits.push({ line: i, length: r.length, symbol: r.symbol, win_cents: r.win });
        }
    }
    // Scatter pay (any-position) — added on top, paid per scatter present
    if (game.scatterSymbol && game.payouts && game.payouts.scatterPay != null) {
        let count = 0;
        for (let c = 0; c < game.cols; c++) {
            for (let r = 0; r < game.rows; r++) {
                if (grid[c][r] === game.scatterSymbol) count++;
            }
        }
        if (count >= 3) {
            const sc = Math.round((Number(game.payouts.scatterPay) * count * betCents) / 25);
            total += sc;
            hits.push({ scatter: true, count, win_cents: sc });
        }
    }
    return { win_cents: total, lines: hits };
}

function evaluateClassic(game, grid, betCents) {
    // Single payline across the (only) row, all cells must match.
    const row = 0;
    const sym = grid[0][row];
    if (!sym) return { win_cents: 0, lines: [] };
    const wild = game.wildSymbol;
    const target = anchorTarget(sym, wild, game.cols, c => grid[c][row]);
    for (let c = 0; c < game.cols; c++) {
        if (!isWildOrMatch(grid[c][row], target, wild)) return { win_cents: 0, lines: [] };
    }
    const pt = game.payouts || {};
    // Per-symbol pay if defined; else triple multiplier; else nothing.
    const direct = pt[target];
    const mult = direct != null ? Number(direct) : (pt.triple != null ? Number(pt.triple) : 0);
    if (!mult) return { win_cents: 0, lines: [] };
    const win = Math.round(mult * betCents);
    return { win_cents: win, lines: [{ line: 0, length: game.cols, symbol: target, win_cents: win }] };
}

/**
 * Cluster pays: find groups of `clusterMin` or more orthogonally
 * connected cells with the same symbol (wilds substitute). Pay table
 * keys honored, bucketed by cluster size:
 *   cluster5 → size 5..7
 *   cluster8 → size 8..11
 *   cluster12 → size 12..14
 *   cluster15 → size 15+
 */
function evaluateCluster(game, grid, betCents) {
    const cols = game.cols, rows = game.rows;
    const minSize = game.clusterMin || 5;
    const wild = game.wildSymbol;
    const visited = [];
    for (let c = 0; c < cols; c++) visited.push(Array(rows).fill(false));
    const pt = game.payouts || {};

    function bucket(size) {
        if (size >= 15 && pt.cluster15 != null) return Number(pt.cluster15);
        if (size >= 12 && pt.cluster12 != null) return Number(pt.cluster12);
        if (size >= 8  && pt.cluster8  != null) return Number(pt.cluster8);
        if (size >= minSize && pt.cluster5 != null) return Number(pt.cluster5);
        return 0;
    }

    const clusters = [];
    for (let c = 0; c < cols; c++) {
        for (let r = 0; r < rows; r++) {
            if (visited[c][r]) continue;
            const sym = grid[c][r];
            if (!sym || (wild && sym === wild)) { visited[c][r] = true; continue; }
            // BFS for orthogonally connected cells matching sym (wilds count).
            const queue = [[c, r]];
            const cells = [];
            visited[c][r] = true;
            while (queue.length) {
                const [cc, rr] = queue.shift();
                cells.push([cc, rr]);
                const neighbors = [[cc + 1, rr], [cc - 1, rr], [cc, rr + 1], [cc, rr - 1]];
                for (const [nc, nr] of neighbors) {
                    if (nc < 0 || nc >= cols || nr < 0 || nr >= rows) continue;
                    if (visited[nc][nr]) continue;
                    const s = grid[nc][nr];
                    if (s === sym || (wild && s === wild)) {
                        visited[nc][nr] = true;
                        queue.push([nc, nr]);
                    }
                }
            }
            if (cells.length >= minSize) {
                const mult = bucket(cells.length);
                if (mult > 0) {
                    // Cluster pay: multiplier × bet, normalized down by grid size
                    // so a 7×7 grid with many clusters doesn't blow past target RTP.
                    const norm = (cols * rows) / 15;
                    const win = Math.round((mult * betCents) / Math.max(1, norm));
                    clusters.push({ symbol: sym, size: cells.length, cells, win_cents: win });
                }
            }
        }
    }
    let total = 0;
    for (const c of clusters) total += c.win_cents;
    return { win_cents: total, lines: clusters };
}

function evaluateRaw(game, grid, betCents) {
    switch (game.winType) {
        case 'classic': return evaluateClassic(game, grid, betCents);
        case 'cluster': return evaluateCluster(game, grid, betCents);
        case 'payline':
        default:        return evaluatePaylines(game, grid, betCents);
    }
}

function evaluateUniversal(game, grid, betCents) {
    const raw = evaluateRaw(game, grid, betCents);
    const factor = game._calibration != null ? game._calibration : 1;
    if (raw.win_cents <= 0 || factor === 1) return raw;
    const scaled = Math.round(raw.win_cents * factor);
    const lines = (raw.lines || []).map(l => Object.assign({}, l, {
        win_cents: Math.round((l.win_cents || 0) * factor),
    }));
    return { win_cents: scaled, lines, rtp_factor: factor };
}

module.exports = {
    loadDefinitions,
    getGame,
    hasGame,
    listGames,
    spinReelsUniversal,
    evaluateUniversal,
    // exposed for tests / verifier — pure helpers with no side effects
    _internals: {
        symbolWeights,
        buildReelStrip,
        paylinesFor,
        evaluateClassic,
        evaluatePaylines,
        evaluateCluster,
    },
};
