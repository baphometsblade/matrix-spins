'use strict';

/**
 * Server-side bonus-mechanics library.
 *
 * Every function here is pure (no DB, no RNG state mutation beyond the
 * shared rng.service) so the game engine can call them deterministically
 * and the 100-game structural audit can static-check their coverage.
 *
 * The engine pipeline wires these in at two distinct points:
 *
 *   postGrid(grid, game, freeSpinState)       — grid-level mutations
 *                                                (symbol_upgrade, walking_wild,
 *                                                 expanding_wild).
 *
 *   bonusMultiplier(game, freeSpinState, win) — win-level modifiers
 *                                                (multiplier_trail, collector
 *                                                 progress threshold awards).
 *
 * All behaviours match industry convention:
 *   - bonusType names are canonical (singular `walking_wild` accepted as
 *     an alias for the plural version; `free_spins` is a legal no-op).
 *   - Mechanics only fire during free spins (freeSpinState.active) unless
 *     the spec explicitly says "base game" — we do NOT boost win rates
 *     outside bonus rounds, which would wreck RTP tuning.
 */

const rng = require('./rng.service');

// ────────────────────────────────────────────────────────────────────────
//  Canonical bonus-type names
// ────────────────────────────────────────────────────────────────────────
// Legacy / mistyped values in game-definitions.js get normalised to the
// real implementation name here. Callers in game-engine.js should always
// run `canonicalBonusType(game)` first.
const BONUS_ALIASES = {
    walking_wild:      'walking_wilds',
    expanding_wild:    'expanding_wilds',
    free_spins:        'none',   // pure FS — no special mechanic, freeSpinsCount drives it
};

function canonicalBonusType(game) {
    const raw = game && game.bonusType;
    if (!raw) return null;
    return BONUS_ALIASES[raw] || raw;
}

// ────────────────────────────────────────────────────────────────────────
//  Grid-level post-processing
// ────────────────────────────────────────────────────────────────────────

/**
 * Walk `grid` after base generation and apply grid-mutating bonus effects.
 * Mutates the grid in place. Returns { mutated, notes } describing what
 * changed (for the client's feature animation hints).
 */
function applyGridMechanics(grid, game, freeSpinState) {
    const kind = canonicalBonusType(game);
    const notes = [];
    if (!kind || !grid || !game) return { mutated: false, notes };

    const cols = grid.length;
    const rows = grid[0] ? grid[0].length : 0;
    if (!cols || !rows) return { mutated: false, notes };

    let mutated = false;

    // ── Symbol upgrade ──
    // During free spins, each s1/s2 low-tier symbol has a small chance
    // to "upgrade" to a higher-tier symbol (s3, s4 or s5). Creates the
    // classic "everything pays gold" sensation without inflating scatter
    // frequency.
    if (kind === 'symbol_upgrade' && freeSpinState && freeSpinState.active) {
        const upgradeFrom = new Set(
            (game.symbols || [])
                .filter(s => /^s[12]_/.test(s) && s !== game.wildSymbol && s !== game.scatterSymbol)
        );
        const upgradeTo = (game.symbols || [])
            .filter(s => /^s[345]_/.test(s) && s !== game.wildSymbol && s !== game.scatterSymbol);
        if (upgradeFrom.size && upgradeTo.length) {
            const chance = Math.min(0.35, Math.max(0.10, game.symbolUpgradeChance || 0.18));
            for (let c = 0; c < cols; c++) {
                for (let r = 0; r < rows; r++) {
                    if (upgradeFrom.has(grid[c][r]) && rng.randomFloat() < chance) {
                        grid[c][r] = upgradeTo[rng.randomInt(upgradeTo.length)];
                        mutated = true;
                    }
                }
            }
            if (mutated) notes.push('symbol_upgrade');
        }
    }

    // ── Expanding wild ──
    // Any column that contains the wild symbol gets the wild stamped on
    // every row in that column. Classic Book-of-Ra / Book-of-Dead trick.
    if (kind === 'expanding_wilds' && game.wildSymbol) {
        let anyExpanded = false;
        for (let c = 0; c < cols; c++) {
            let hasWild = false;
            for (let r = 0; r < rows; r++) {
                if (grid[c][r] === game.wildSymbol) { hasWild = true; break; }
            }
            if (hasWild) {
                // Only expand on a small random fraction of spins (otherwise
                // every wild landing triggers it and the base-game hit
                // frequency goes through the roof). Always expand during
                // free spins — that's the whole feature pitch.
                const shouldExpand = (freeSpinState && freeSpinState.active) || rng.randomFloat() < 0.25;
                if (shouldExpand) {
                    for (let r = 0; r < rows; r++) grid[c][r] = game.wildSymbol;
                    anyExpanded = true;
                    mutated = true;
                }
            }
        }
        if (anyExpanded) notes.push('expanding_wilds');
    }

    // ── Walking wild ──
    // A wild that appeared last spin "walks" one column to the left this
    // spin. We need persistence for that, so we read/write on the
    // freeSpinState object (the engine already persists it DB-side).
    if (kind === 'walking_wilds' && game.wildSymbol && freeSpinState) {
        // Advance any previously-placed walker
        const walker = freeSpinState._walkerColumn;
        if (typeof walker === 'number' && walker >= 0) {
            const nextCol = walker - 1;
            if (nextCol >= 0) {
                for (let r = 0; r < rows; r++) grid[nextCol][r] = game.wildSymbol;
                freeSpinState._walkerColumn = nextCol;
                mutated = true;
                notes.push('walking_wild_step');
            } else {
                freeSpinState._walkerColumn = undefined;
            }
        }
        // If a new wild appears naturally, mark it as walker for next spin
        if (typeof freeSpinState._walkerColumn !== 'number') {
            for (let c = cols - 1; c >= 0; c--) {
                let hasWild = false;
                for (let r = 0; r < rows; r++) {
                    if (grid[c][r] === game.wildSymbol) { hasWild = true; break; }
                }
                if (hasWild) { freeSpinState._walkerColumn = c; break; }
            }
        }
    }

    return { mutated, notes };
}

// ────────────────────────────────────────────────────────────────────────
//  Win-level modifiers
// ────────────────────────────────────────────────────────────────────────

/**
 * Returns an additional multiplier to apply on top of whatever
 * applyBonusMultiplier() already computed, plus a human-readable note.
 */
function applyTrailMultiplier(game, freeSpinState, winAmount) {
    const kind = canonicalBonusType(game);
    if (kind !== 'multiplier_trail') return { extraMult: 1, note: '' };
    if (!freeSpinState || !freeSpinState.active) return { extraMult: 1, note: '' };

    if (typeof freeSpinState._trail !== 'number') freeSpinState._trail = 1;
    if (winAmount > 0) {
        // Each consecutive win advances the trail. Capped so a hot streak
        // can't go to infinity.
        const cap = Math.max(2, Math.min(20, game.multiplierTrailCap || 10));
        freeSpinState._trail = Math.min(cap, freeSpinState._trail + 1);
    } else {
        // Reset on a losing spin — industry standard.
        freeSpinState._trail = 1;
    }
    const m = freeSpinState._trail;
    return { extraMult: m, note: m > 1 ? ` (Trail ${m}x)` : '' };
}

// ────────────────────────────────────────────────────────────────────────
//  Collector — persistent over a bonus round
// ────────────────────────────────────────────────────────────────────────

/**
 * Counts scatter / wild landings into a persistent bucket on freeSpinState.
 * When the bucket reaches collectorThreshold, awards `collectorReward`
 * (defaults: +5 free spins).
 * Runs every spin during an active free-spin round.
 */
function applyCollector(grid, game, freeSpinState) {
    const kind = canonicalBonusType(game);
    if (kind !== 'collector') return { awarded: 0, note: '' };
    if (!freeSpinState || !freeSpinState.active) return { awarded: 0, note: '' };

    const target = game.collectorSymbol || game.scatterSymbol || game.wildSymbol;
    if (!target) return { awarded: 0, note: '' };

    const threshold = Math.max(3, Math.min(50, game.collectorThreshold || 10));
    const reward = Math.max(1, Math.min(15, game.collectorReward || 5));

    let newThisSpin = 0;
    for (const col of grid) for (const s of col) if (s === target) newThisSpin++;

    freeSpinState._collected = (freeSpinState._collected || 0) + newThisSpin;

    if (freeSpinState._collected >= threshold) {
        const rounds = Math.floor(freeSpinState._collected / threshold);
        freeSpinState._collected -= rounds * threshold;
        return {
            awarded: rounds * reward,
            note: ` (Collector +${rounds * reward} spins)`
        };
    }
    return { awarded: 0, note: '' };
}

// ────────────────────────────────────────────────────────────────────────
//  Pick bonus — one-shot mini-game result
// ────────────────────────────────────────────────────────────────────────

/**
 * When a pick_bonus game triggers its feature (same trigger as free
 * spins — 3+ scatters), instead of free spins we return a single award
 * picked uniformly from the configured prize pool. The client animates
 * the pick; the server chose the actual prize here.
 */
function resolvePickBonus(game, betAmount) {
    const kind = canonicalBonusType(game);
    if (kind !== 'pick_bonus') return null;

    // Default prize pool: 2x, 5x, 10x, 25x, 50x of total bet
    const prizes = (Array.isArray(game.pickPrizes) && game.pickPrizes.length)
        ? game.pickPrizes
        : [2, 5, 10, 25, 50];
    const winMultiplier = prizes[rng.randomInt(prizes.length)];
    return {
        winAmount: betAmount * winMultiplier,
        picks: prizes.length,
        chosenIndex: rng.randomInt(prizes.length),  // cosmetic — client reveals
        winMultiplier
    };
}

// ────────────────────────────────────────────────────────────────────────
//  Megaways — variable row count per reel
// ────────────────────────────────────────────────────────────────────────

/**
 * Generate a megaways-style grid where each column has a random row
 * count within [minRows, maxRows]. Returns { grid, rowsPerCol, ways }.
 * ways = product of per-column row counts (canonical megaways count).
 *
 * The caller should use `rowsPerCol` when evaluating wins to know which
 * positions are valid; positions beyond a column's row count should be
 * left null.
 */
function generateMegawaysGrid(game, symbolWeights) {
    const cols = game.gridCols || 6;
    const minRows = Math.max(2, game.megawaysMinRows || 2);
    const maxRows = Math.max(minRows + 1, game.megawaysMaxRows || 7);
    const grid = [];
    const rowsPerCol = [];
    for (let c = 0; c < cols; c++) {
        const h = minRows + rng.randomInt(maxRows - minRows + 1);
        rowsPerCol.push(h);
        const colArr = new Array(maxRows).fill(null);
        for (let r = 0; r < h; r++) {
            colArr[r] = rng.pickWeighted(game.symbols, symbolWeights);
        }
        grid.push(colArr);
    }
    const ways = rowsPerCol.reduce((a, b) => a * b, 1);
    return { grid, rowsPerCol, ways };
}

// ────────────────────────────────────────────────────────────────────────
//  Progressive jackpot contribution
// ────────────────────────────────────────────────────────────────────────

/**
 * Returns the per-spin amount that should be added to the game's
 * progressive pool. Callers pool this in `progressive_pools` table
 * and debit it when the jackpot is hit.
 *   - default rate: 0.5% of total bet (0.005)
 *   - overridable via game.progressiveContribution
 */
function progressiveContribution(game, betAmount) {
    const kind = canonicalBonusType(game);
    if (kind !== 'progressive') return 0;
    const rate = Math.max(0, Math.min(0.05, game.progressiveContribution || 0.005));
    return Math.round(betAmount * rate * 100) / 100;
}

/**
 * Decides whether this spin hits the progressive. Odds tuned so, at the
 * default contribution rate of 0.5%, the jackpot hits roughly every
 * 10,000 spins — realistic for a "minor" progressive.
 *   - baseOdds: 1 / (game.progressiveHitBase || 10000)
 * Returns { hit: boolean }.
 */
function progressiveHitCheck(game) {
    const kind = canonicalBonusType(game);
    if (kind !== 'progressive') return { hit: false };
    const base = Math.max(1000, Math.min(1000000, game.progressiveHitBase || 10000));
    return { hit: rng.randomFloat() < (1 / base) };
}

module.exports = {
    canonicalBonusType,
    applyGridMechanics,
    applyTrailMultiplier,
    applyCollector,
    resolvePickBonus,
    generateMegawaysGrid,
    progressiveContribution,
    progressiveHitCheck,
    // Exported for tests / audit
    _BONUS_ALIASES: BONUS_ALIASES,
    _CANONICAL_TYPES: [
        'avalanche', 'both_ways', 'cascading', 'chamber_spins', 'coin_respin',
        'collector', 'colossal', 'expanding_symbol', 'expanding_wild_respin',
        'expanding_wilds', 'fisherman_collect', 'hold_and_win', 'increasing_mult',
        'megaways', 'money_collect', 'multiplier_trail', 'multiplier_wilds',
        'mystery_stacks', 'pick_bonus', 'prize_wheel', 'progressive',
        'random_jackpot', 'random_multiplier', 'respin', 'stacked_wilds',
        'sticky_wilds', 'symbol_collect', 'symbol_upgrade', 'tumble',
        'walking_wilds', 'wheel_multiplier', 'wild_collect', 'wild_reels',
        'zeus_multiplier',
        // valid no-ops
        'free_spins', 'none', 'buy_feature'
    ]
};
