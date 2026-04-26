'use strict';

/**
 * Bonus-type adapters for the universal slot engine.
 *
 * Each free-spin tick goes through this module. The base engine has
 * already produced a grid and a baseline outcome (paylines / clusters
 * / classic match scored at the original bet). The adapter then applies
 * per-bonus-type transformations:
 *
 *   • multiplier — scale the win (random, fixed list, increasing)
 *   • tumble     — winning symbols disappear, replacements drop, score
 *                  the new grid; cascade level multiplies the win
 *   • expanding  — a chosen symbol expands to fill a column; rescore
 *   • walking    — a wild from the previous spin walks one column
 *                  right and locks; rescore
 *   • hold_and_win — special "coin" symbol mode: if 3+ coins land,
 *                    flip into respins with sticky coins; pays only
 *                    coins, wins paid by face-value sum
 *   • respin     — pairs lock and unmatched columns respin
 *   • wild_collect — wilds accumulate across the session and grant a
 *                    growing multiplier
 *
 * Each adapter exposes one function:
 *
 *   applyBonusSpin({ state, baseGrid, baseWinCents, baseLines,
 *                    game, prng, scatterCount }) →
 *     { gridOverride?, winCents, lines, state, extraRespins?,
 *       multiplier? }
 *
 * Where `state` is the running per-session state (mirrored to
 * bonus_sessions.state_json), `prng` is a seeded PRNG passed in by
 * the engine (so adapter-derived randomness is also provably-fair),
 * and `extraRespins` is added to the session's spins_remaining.
 *
 * Adapter selection is by `gameDef.bonusType`; aliases collapse to
 * a single family (tumble/avalanche → tumble, etc.).
 */

const universal = require('./slot-engine-universal.service');

/* ─────────────────────────── helpers ─────────────────────────────── */

function pickFromList(list, prng) {
    if (!Array.isArray(list) || list.length === 0) return 1;
    const idx = Math.min(list.length - 1, Math.floor(prng() * list.length));
    return list[idx];
}

function deepCopyGrid(grid) {
    return grid.map(col => col.slice());
}

function countSymbol(grid, sym) {
    let n = 0;
    for (const col of grid) for (const s of col) if (s === sym) n++;
    return n;
}

/**
 * Re-score a grid through the universal evaluator. Used by adapters
 * (tumble, expanding) that mutate the grid mid-spin and need a fresh
 * line/cluster evaluation. The win comes back already calibrated.
 */
function rescore(game, grid, betCents) {
    return universal.evaluateUniversal(game, grid, betCents);
}

/* ─────────────────────────── multiplier family ───────────────────── */

/**
 * Catch-all for the 28 games whose bonus is "win × N", where N is
 * picked per spin from a list defined in the catalog. Includes:
 *   - random_multiplier  → randomMultiplierRange
 *   - zeus_multiplier    → zeusMultipliers
 *   - multiplier_wilds   → randomMultiplierRange (default [2,3,5])
 *   - wheel_multiplier   → randomMultiplierRange (default [2,3,5,10])
 *   - mystery_stacks     → randomMultiplierRange
 *
 * State unused — the multiplier is independent each spin.
 */
function multiplierAdapter(opts) {
    const { state, baseWinCents, baseLines, game, prng } = opts;
    const def = game._catalogDef || {};
    const list = def.randomMultiplierRange || def.zeusMultipliers ||
                 def.tumbleMultipliers || [2, 3, 5];
    const mult = pickFromList(list, prng);
    if (mult <= 1 || baseWinCents <= 0) {
        return { winCents: baseWinCents, lines: baseLines, state, multiplier: 1 };
    }
    return {
        winCents: Math.round(baseWinCents * mult),
        lines: (baseLines || []).map(l => Object.assign({}, l, {
            win_cents: Math.round((l.win_cents || 0) * mult),
        })),
        state,
        multiplier: mult,
    };
}

/* ─────────────────────────── tumble / avalanche ───────────────────── */

/**
 * Tumble: when there's a win, the winning symbols disappear and new
 * ones drop in from above. We rescore. The cascade level (how many
 * tumbles in a row this spin produced wins) drives a multiplier
 * picked from `tumbleMultipliers` (or `avalancheMultipliers`) on the
 * game definition.
 *
 * State carries a session-wide running cascade level so multipliers
 * accumulate across the session, the way modern Pragmatic-style
 * tumble bonuses work.
 *
 * Limit cascades to `MAX_TUMBLES` per spin to bound the engine cost
 * for a pathological grid.
 */
const MAX_TUMBLES = 12;

function tumbleAdapter(opts) {
    const { state, baseGrid, baseWinCents, baseLines, game, prng } = opts;
    const def = game._catalogDef || {};
    const mults = def.tumbleMultipliers || def.avalancheMultipliers || [1, 2, 3, 5];

    let cascadeLevel = Math.max(0, Number(state && state.cascadeLevel) || 0);
    let totalWin = baseWinCents;
    let allLines = (baseLines || []).slice();
    let grid = deepCopyGrid(baseGrid);

    let win = baseWinCents;
    let lines = baseLines || [];
    let tumbles = 0;
    while (win > 0 && tumbles < MAX_TUMBLES) {
        // Identify cells that paid. Cluster lines list cells; payline
        // lines reference (line, length) on a row. We only know exact
        // cells for cluster pays; for paylines we drop the leftmost
        // run on row 0 (matches highlight in live-slot.js).
        const winningCells = collectWinningCells(grid, lines, game);
        if (winningCells.size === 0) break;
        // Drop winning cells: replace with new symbols using the
        // game's reel composition (uniform sample from a fresh strip).
        const stripSyms = (game.reels && game.reels[0]) || game.symbols || [];
        if (stripSyms.length === 0) break;
        for (const key of winningCells) {
            const [c, r] = key.split(',').map(Number);
            grid[c][r] = stripSyms[Math.floor(prng() * stripSyms.length)];
        }
        // Re-evaluate the new grid
        const r2 = rescore(game, grid, opts.betCents);
        win = r2.win_cents;
        lines = r2.lines || [];
        if (win > 0) {
            cascadeLevel += 1;
            const m = mults[Math.min(cascadeLevel, mults.length - 1)];
            totalWin += Math.round(win * m);
            allLines = allLines.concat(lines.map(l => Object.assign({}, l, {
                win_cents: Math.round((l.win_cents || 0) * m),
                cascade: cascadeLevel,
            })));
        }
        tumbles += 1;
    }
    return {
        gridOverride: grid,
        winCents: totalWin,
        lines: allLines,
        state: Object.assign({}, state, { cascadeLevel }),
    };
}

function collectWinningCells(grid, lines, game) {
    const set = new Set();
    if (!lines) return set;
    for (const l of lines) {
        if (Array.isArray(l.cells)) {
            for (const xy of l.cells) set.add(xy[0] + ',' + xy[1]);
        } else if (typeof l.line === 'number' && Number.isFinite(l.length)) {
            for (let i = 0; i < l.length; i++) set.add(i + ',0');
        }
    }
    return set;
}

/* ─────────────────────────── expanding symbol ─────────────────────── */

/**
 * One symbol (chosen at session open) expands to fill its column on
 * every spin. Modeled after Book of Dead: at session start a random
 * paying symbol is picked; thereafter, any cell in that symbol's
 * column gets force-filled to it before scoring.
 *
 * State carries the chosen symbol id. If state is fresh, we pick on
 * the first applySpin call.
 */
function expandingAdapter(opts) {
    const { state, baseGrid, game, prng } = opts;
    let chosen = state && state.expandingSymbol;
    if (!chosen) {
        // Pick a paying symbol — exclude wild and scatter to keep the
        // bonus economically interesting (full grid of wilds would be
        // a max-win every spin).
        const candidates = (game.symbols || []).filter(s =>
            s !== game.wildSymbol && s !== game.scatterSymbol);
        chosen = candidates[Math.floor(prng() * candidates.length)] || (game.symbols || [])[0];
    }
    if (!chosen) return { winCents: opts.baseWinCents, lines: opts.baseLines, state };
    const grid = deepCopyGrid(baseGrid);
    let touched = false;
    for (let c = 0; c < game.cols; c++) {
        const col = grid[c];
        if (col.indexOf(chosen) !== -1) {
            for (let r = 0; r < game.rows; r++) col[r] = chosen;
            touched = true;
        }
    }
    if (!touched) {
        return {
            winCents: opts.baseWinCents,
            lines: opts.baseLines,
            state: Object.assign({}, state, { expandingSymbol: chosen }),
        };
    }
    const r2 = rescore(game, grid, opts.betCents);
    return {
        gridOverride: grid,
        winCents: r2.win_cents,
        lines: r2.lines || [],
        state: Object.assign({}, state, { expandingSymbol: chosen }),
    };
}

/* ─────────────────────────── walking / sticky wilds ───────────────── */

/**
 * Walking wild: any wild that landed last spin walks one column right
 * (wraps off the board → disappears). Sticky/stacked variants instead
 * keep wilds in place for the rest of the session.
 *
 * State carries an array of [c, r] wild positions to apply before
 * scoring this spin's grid.
 */
function walkingWildAdapter(opts) {
    const { state, baseGrid, game } = opts;
    const def = game._catalogDef || {};
    const isStickyOrStacked = def.bonusType === 'sticky_wilds' || def.bonusType === 'stacked_wilds';
    const grid = deepCopyGrid(baseGrid);
    const wild = game.wildSymbol;
    if (!wild) return { winCents: opts.baseWinCents, lines: opts.baseLines, state };

    // Place carried-over wilds.
    const carry = (state && state.carriedWilds) || [];
    const stillOnBoard = [];
    for (const [c, r] of carry) {
        const nc = isStickyOrStacked ? c : c + 1;
        if (nc < game.cols) {
            grid[nc][r] = wild;
            stillOnBoard.push([nc, r]);
        }
    }
    // Find any new wilds landed this spin and add them to next-spin carry.
    for (let c = 0; c < game.cols; c++) {
        for (let r = 0; r < game.rows; r++) {
            if (grid[c][r] === wild && !stillOnBoard.some(([cc, rr]) => cc === c && rr === r)) {
                stillOnBoard.push([c, r]);
            }
        }
    }
    const r2 = rescore(game, grid, opts.betCents);
    return {
        gridOverride: grid,
        winCents: r2.win_cents,
        lines: r2.lines || [],
        state: Object.assign({}, state, { carriedWilds: stillOnBoard }),
    };
}

/* ─────────────────────────── hold-and-win / coin ──────────────────── */

/**
 * Hold-and-Win: special "coin" symbols are sticky for the duration of
 * the session. Each non-coin cell respins. If the entire grid fills
 * with coins, jackpot mode (catalog.jackpots.grand). Pays the coin
 * face-value sum each spin.
 *
 * Simplified: we don't model coin face values per-cell (the catalog
 * doesn't carry that). Instead, each spin pays a flat amount per
 * coin = scatterPay (multiplier) × bet, plus a session-wide running
 * total that gets credited on the final spin.
 *
 * State: { coins: [[c,r], …], spinsLeft: int }
 */
function holdAndWinAdapter(opts) {
    const { state, baseGrid, game } = opts;
    const def = game._catalogDef || {};
    const grid = deepCopyGrid(baseGrid);
    const coinSym = game.scatterSymbol; // catalog convention: coin = scatter
    if (!coinSym) {
        return { winCents: opts.baseWinCents, lines: opts.baseLines, state };
    }
    const carry = (state && state.coins) || [];
    // Apply carried coins.
    for (const [c, r] of carry) {
        if (c >= 0 && c < game.cols && r >= 0 && r < game.rows) grid[c][r] = coinSym;
    }
    // Collect all coin positions on this spin.
    const coins = [];
    for (let c = 0; c < game.cols; c++) {
        for (let r = 0; r < game.rows; r++) {
            if (grid[c][r] === coinSym) coins.push([c, r]);
        }
    }
    // Pay = scatterPay × coin count × bet (with the same /25 normalization
    // the universal evaluator uses for line pays).
    const scatterPay = Number((def.payouts || {}).scatterPay) || 0;
    const flatPay = scatterPay > 0
        ? Math.round((scatterPay * coins.length * opts.betCents) / 25)
        : 0;
    // Apply the engine's per-game calibration so payouts converge to
    // the declared RTP for the bonus too.
    const factor = game._calibration != null ? game._calibration : 1;
    const totalWin = Math.round((opts.baseWinCents + flatPay) * factor / (factor || 1));
    return {
        gridOverride: grid,
        winCents: opts.baseWinCents + Math.round(flatPay * factor),
        lines: (opts.baseLines || []).concat(coins.length > 0 ? [{
            scatter: true, count: coins.length,
            win_cents: Math.round(flatPay * factor),
            coins: true,
        }] : []),
        state: Object.assign({}, state, { coins }),
    };
}

/* ─────────────────────────── respin (pairs lock) ──────────────────── */

/**
 * Respin: pairs of matching symbols lock; unmatched columns respin
 * once. Free-spin path applies it as a one-shot post-spin bonus when
 * the engine sees ≥2 same symbols on the center row.
 *
 * Stateless — single shot per spin.
 */
function respinAdapter(opts) {
    const { baseGrid, baseWinCents, baseLines, game, betCents } = opts;
    if (game.rows !== 3 && game.rows !== 1) {
        return { winCents: baseWinCents, lines: baseLines, state: opts.state };
    }
    const row = game.rows === 1 ? 0 : 1; // center row
    const wild = game.wildSymbol;
    const tally = Object.create(null);
    for (let c = 0; c < game.cols; c++) {
        const s = baseGrid[c][row];
        if (!s) continue;
        tally[s] = (tally[s] || 0) + 1;
    }
    const pairs = Object.entries(tally).filter(([s, n]) =>
        n >= 2 && s !== game.scatterSymbol);
    if (pairs.length === 0) {
        return { winCents: baseWinCents, lines: baseLines, state: opts.state };
    }
    // Lock the pair; respin the others.
    const grid = deepCopyGrid(baseGrid);
    const pairSym = pairs[0][0];
    const stripSyms = (game.reels && game.reels[0]) || game.symbols || [];
    if (stripSyms.length === 0) return { winCents: baseWinCents, lines: baseLines, state: opts.state };
    const prng = opts.prng;
    for (let c = 0; c < game.cols; c++) {
        if (grid[c][row] !== pairSym && grid[c][row] !== wild) {
            grid[c][row] = stripSyms[Math.floor(prng() * stripSyms.length)];
        }
    }
    const r2 = rescore(game, grid, betCents);
    return {
        gridOverride: grid,
        winCents: Math.max(baseWinCents, r2.win_cents),
        lines: r2.win_cents > baseWinCents ? r2.lines : baseLines,
        state: opts.state,
    };
}

/* ─────────────────────────── wild collect / chamber ───────────────── */

/**
 * Wild Collect / Chamber Spins: every wild that lands during the
 * session adds 1 to the running multiplier. The session multiplier
 * is applied to all wins.
 *
 * State: { wildCount: int }
 */
function wildCollectAdapter(opts) {
    const { state, baseGrid, baseWinCents, baseLines, game } = opts;
    const wild = game.wildSymbol;
    let collected = (state && state.wildCount) || 0;
    if (wild) {
        for (let c = 0; c < game.cols; c++) {
            for (let r = 0; r < game.rows; r++) {
                if (baseGrid[c][r] === wild) collected += 1;
            }
        }
    }
    const sessionMult = 1 + Math.floor(collected / 3); // every 3 wilds = +1x
    if (sessionMult === 1 || baseWinCents <= 0) {
        return {
            winCents: baseWinCents, lines: baseLines,
            state: Object.assign({}, state, { wildCount: collected }),
        };
    }
    return {
        winCents: Math.round(baseWinCents * sessionMult),
        lines: (baseLines || []).map(l => Object.assign({}, l, {
            win_cents: Math.round((l.win_cents || 0) * sessionMult),
        })),
        state: Object.assign({}, state, { wildCount: collected }),
        multiplier: sessionMult,
    };
}

/* ─────────────────────────── routing table ────────────────────────── */

const ADAPTERS = {
    // multiplier family
    random_multiplier: multiplierAdapter,
    zeus_multiplier: multiplierAdapter,
    multiplier_wilds: multiplierAdapter,
    wheel_multiplier: multiplierAdapter,
    mystery_stacks: multiplierAdapter,
    // tumble family
    tumble: tumbleAdapter,
    avalanche: tumbleAdapter,
    // expanding family
    expanding_symbol: expandingAdapter,
    expanding_wild_respin: expandingAdapter,
    // walking / sticky wilds
    walking_wilds: walkingWildAdapter,
    sticky_wilds: walkingWildAdapter,
    stacked_wilds: walkingWildAdapter,
    // hold-and-win family
    hold_and_win: holdAndWinAdapter,
    money_collect: holdAndWinAdapter,
    coin_respin: holdAndWinAdapter,
    // respin
    respin: respinAdapter,
    // wild collect
    wild_collect: wildCollectAdapter,
    chamber_spins: wildCollectAdapter,
};

function adapterFor(bonusType) {
    return ADAPTERS[bonusType] || null;
}

/**
 * Apply the bonus-type adapter for `gameDef.bonusType`. If no adapter
 * exists for the type, returns the base outcome unchanged. This is the
 * single entry point the engine calls during a free-spin tick.
 *
 * `state` is the running per-session state object (deserialized from
 * bonus_sessions.state_json). The returned `state` is what gets
 * persisted for the next spin.
 */
function applyBonusSpin(opts) {
    const bonusType = opts.game && opts.game.bonusType;
    const adapter = adapterFor(bonusType);
    if (!adapter) {
        return {
            winCents: opts.baseWinCents,
            lines: opts.baseLines,
            state: opts.state || {},
        };
    }
    return adapter(opts);
}

module.exports = {
    applyBonusSpin,
    adapterFor,
    // exposed for tests
    _adapters: {
        multiplierAdapter, tumbleAdapter, expandingAdapter,
        walkingWildAdapter, holdAndWinAdapter, respinAdapter,
        wildCollectAdapter,
    },
    _internals: { collectWinningCells, deepCopyGrid, countSymbol },
};
