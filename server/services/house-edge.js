const config = require('../config');
const rng = require('./rng.service');

/**
 * House Edge / RTP Enforcement Service.
 *
 * Based on real slot mathematics scraped from actual Pragmatic Play,
 * Play'n GO, and other major provider paytables:
 *
 * KEY REAL-WORLD SLOT DATA:
 * ─────────────────────────
 * Wolf Gold (5x3, 25 lines): RTP 96.01%, medium volatility, max 2500x
 *   - Low symbols (J,Q,K,A): 0.2x-2x total bet for 3-5 of a kind
 *   - High symbols: 0.4x-20x total bet for 3-5 of a kind
 *   - Hit frequency: ~25-30%
 *
 * Gates of Olympus (6x5, scatter pays): RTP 96.50%, high volatility, max 5000x
 *   - Low symbols: 0.25x-10x total bet for 8-12+ of a kind
 *   - High symbols: 1.5x-50x total bet for 8-12+ of a kind
 *   - Requires 8+ matching symbols (much harder than paylines)
 *
 * Sweet Bonanza (6x5, scatter pays): RTP 96.48%, high volatility, max 21100x
 *   - Low symbols: 0.25x-2x for 8-12+
 *   - High candy: up to 50x for 12+
 *
 * Sugar Rush (7x7, cluster pays): RTP 96.50%, high volatility, max 5000x
 *   - 5-symbol cluster: 0.2x-1x bet
 *   - 15+ cluster: 20x-150x bet (extremely rare)
 *
 * Fire Joker (3x3, classic): RTP 96.15%, medium volatility, max 800x
 *   - Per-line pays: 2x-80x (but only 5 paylines)
 *   - Most value comes from wheel bonus
 *
 * CRITICAL INSIGHT: Real slots have 10-30% hit frequency.
 * Most spins are complete losses. Wins that DO occur are mostly
 * smaller than the bet ("losses disguised as wins" = ~27% of outcomes).
 */

// ═══════════════════════════════════════════════════════════
// VIRTUAL REEL STRIP WEIGHTS
// ═══════════════════════════════════════════════════════════
// Real slots use virtual reels with 100-200 stops per reel.
// Most stops are low-value symbols. Wild/scatter are very rare.
//
// Our games have 6 symbols indexed 0-5:
// [0]=common, [1]=common, [2]=medium, [3]=medium-high, [4]=rare, [5]=wild
//
// These weights control how often each symbol appears on the grid.

// 5x3 payline games (Wolf Gold style) — 15 cells
const BASE_WEIGHTS_5x3 = [100, 90, 50, 25, 8, 3]; // Wild ~1.1%

// 5x4 payline games — 20 cells, 40 paylines
const BASE_WEIGHTS_5x4 = [110, 100, 55, 25, 6, 2]; // Wild ~0.7%

// 6x5 cluster/scatter games (Gates of Olympus, Sweet Bonanza) — 30 cells
const BASE_WEIGHTS_6x5 = [120, 110, 60, 28, 5, 1]; // Wild ~0.3%

// 7x7 cluster games (Sugar Rush) — 49 cells
const BASE_WEIGHTS_7x7 = [140, 130, 70, 30, 4, 1]; // Wild ~0.3%

// 3x3 classic games (Fire Joker) — 9 cells
const BASE_WEIGHTS_3x3 = [80, 70, 40, 20, 10, 5]; // Wild ~2.2%

// 3x1 single-line classic — 3 cells
const BASE_WEIGHTS_3x1 = [70, 60, 35, 18, 10, 6]; // Wild ~3.0%

// 5x5 cluster games — 25 cells
const BASE_WEIGHTS_5x5 = [110, 100, 55, 25, 6, 2]; // Wild ~0.7%

function getBaseWeightsForGrid(game) {
    const cols = game.gridCols || 3;
    const rows = game.gridRows || 1;
    const cells = cols * rows;

    if (cols === 7 && rows === 7) return BASE_WEIGHTS_7x7;
    if (cols === 6 && rows === 5) return BASE_WEIGHTS_6x5;
    if (cols === 5 && rows === 4) return BASE_WEIGHTS_5x4;
    if (cols === 5 && rows === 5) return BASE_WEIGHTS_5x5;
    if (cols === 5 && rows === 3) return BASE_WEIGHTS_5x3;
    if (cols === 3 && rows === 3) return BASE_WEIGHTS_3x3;
    if (rows === 1) return BASE_WEIGHTS_3x1;

    // Fallback based on cell count
    if (cells >= 40) return BASE_WEIGHTS_7x7;
    if (cells >= 25) return BASE_WEIGHTS_6x5;
    if (cells >= 15) return BASE_WEIGHTS_5x3;
    return BASE_WEIGHTS_3x3;
}

// ═══════════════════════════════════════════════════════════
// HIT FREQUENCY GATE
// ═══════════════════════════════════════════════════════════

function getHitFrequency(game) {
    const cols = game.gridCols || 3;
    const rows = game.gridRows || 1;
    const winType = game.winType || 'classic';

    if (winType === 'classic') {
        if (rows === 1) return 0.15;
        return 0.20;
    }

    if (winType === 'cluster') {
        if (cols >= 7) return 0.28;
        if (cols >= 6) return 0.25;
        return 0.22;
    }

    if (winType === 'payline') {
        if (rows >= 4) return 0.28;
        if (cols >= 5) return 0.30;
        return 0.20;
    }

    return 0.25;
}

// ═══════════════════════════════════════════════════════════
// SYMBOL WEIGHT CALCULATION (with RTP tracking)
// ═══════════════════════════════════════════════════════════

function getSymbolWeights(game, gameStats) {
    const symbols = game.symbols;
    const numSymbols = symbols.length;
    const baseWeights = getBaseWeightsForGrid(game);

    const weights = [];
    for (let i = 0; i < numSymbols; i++) {
        if (i < baseWeights.length) {
            weights.push(baseWeights[i]);
        } else {
            weights.push(baseWeights[baseWeights.length - 1]);
        }
    }

    if (gameStats && gameStats.total_wagered > 0 && gameStats.total_spins > 50) {
        const actualRTP = gameStats.total_paid / gameStats.total_wagered;
        const targetRTP = config.TARGET_RTP;
        const drift = actualRTP - targetRTP;

        if (Math.abs(drift) > config.RTP_ADJUSTMENT_THRESHOLD) {
            const driftMagnitude = Math.min(Math.abs(drift), 2.0);
            const baseAdj = drift > 0 ? -0.40 : 0.08;
            const scaleFactor = Math.min(driftMagnitude / 0.05, 5);
            const adjustment = baseAdj * scaleFactor;

            for (let i = 0; i < numSymbols; i++) {
                if (i >= numSymbols - 2) {
                    weights[i] = Math.max(0.1, weights[i] * (1 + adjustment));
                } else if (i >= numSymbols - 4) {
                    weights[i] = Math.max(0.5, weights[i] * (1 + adjustment * 0.5));
                }
                if (i < 2 && drift > 0) {
                    weights[i] *= 1 + driftMagnitude * 0.5;
                }
            }
        }
    }

    return weights;
}

// ═══════════════════════════════════════════════════════════
// DYNAMIC HIT FREQUENCY
// ═══════════════════════════════════════════════════════════

function getEffectiveHitFrequency(game, gameStats) {
    let baseHitFreq = getHitFrequency(game);

    if (gameStats && gameStats.total_wagered > 0 && gameStats.total_spins > 30) {
        const actualRTP = gameStats.total_paid / gameStats.total_wagered;
        const targetRTP = config.TARGET_RTP;
        const drift = actualRTP - targetRTP;

        if (drift > 0.05) {
            const reduction = Math.min(drift * 0.8, 0.20);
            baseHitFreq = Math.max(0.05, baseHitFreq - reduction);
        } else if (drift < -0.10) {
            const increase = Math.min(Math.abs(drift) * 0.2, 0.08);
            baseHitFreq = Math.min(0.45, baseHitFreq + increase);
        }
    }

    return baseHitFreq;
}

// IMPROVEMENT: Cache global stats to avoid expensive aggregate query on every spin
// Refreshes every 5 seconds — amortises thousands of queries per refresh
let _globalStatsCache = null;
let _globalStatsCacheExpiry = 0;
async function getGlobalStats(db) {
    if (!db) return null;
    const now = Date.now();
    if (_globalStatsCache && now < _globalStatsCacheExpiry) return _globalStatsCache;
    _globalStatsCache = await db.get('SELECT SUM(bet_amount) as wagered, SUM(win_amount) as paid FROM spins');
    // ROUND 35: Reduced from 2s to 500ms — prevents burst-spin race conditions
    // where 50+ spins all pass the RTP check before stats refresh.
    _globalStatsCacheExpiry = now + 500;
    return _globalStatsCache;
}

/**
 * Determine if this spin should be allowed to produce a win.
 */
async function shouldAllowWin(game, gameStats, db) {
    let hitFreq = getEffectiveHitFrequency(game, gameStats);

    const globalStats = await getGlobalStats(db);
    if (globalStats && globalStats.wagered > 0) {
        const globalRTP = (globalStats.paid || 0) / globalStats.wagered;
        // ROUND 32: Hard ceiling — block ALL wins at RTP >= 1.0 (was > 1.0).
        // Previous boundary let house go exactly to break-even before blocking,
        // meaning one more win could push house negative.
        if (globalRTP >= 1.0) {
            return false; // Force loss — house must stay profitable
        }
        // Aggressive throttle when approaching break-even (>95% RTP)
        if (globalRTP > 0.95) {
            hitFreq *= 0.25; // 75% reduction (was 50% — too lenient)
        } else if (globalRTP > 0.90) {
            hitFreq *= 0.6; // Moderate throttle above target 88% RTP
        }
    }

    return rng.randomFloat() < hitFreq;
}

// ═══════════════════════════════════════════════════════════
// DYNAMIC RTP CONVERGENCE
// ═══════════════════════════════════════════════════════════
// Scales win amounts based on per-game RTP drift vs target.
// This handles different grid sizes, cluster minimums, and payline counts
// automatically — no fragile per-game-type static multiplier tuning needed.
//
// Target resolution (in priority order):
//   1. game.rtp (per-game published RTP — what regulators audit us against)
//   2. config.TARGET_RTP (global house floor)
//   3. 0.88 fallback
// The caller passes the `game` object so we can converge toward the
// advertised number specifically — prior versions always used the global
// config floor which left per-game RTP systematically ~15% below what the
// UI displayed, which is a regulator-red-flag misrepresentation.

function scaleWinForRTP(winAmount, betAmount, gameStats, game) {
    if (!gameStats || gameStats.total_spins < 30 || gameStats.total_wagered <= 0) {
        return winAmount; // Not enough data — use raw paytable value
    }

    // Per-game RTP first, fall back to global floor. game.rtp is stored
    // as a percentage (e.g. 91.5) so divide by 100 if it looks like one.
    let targetRTP;
    if (game && typeof game.rtp === 'number' && game.rtp > 0) {
        targetRTP = game.rtp > 1 ? game.rtp / 100 : game.rtp;
    } else {
        targetRTP = config.TARGET_RTP || 0.88;
    }
    // Safety clamp — never target outside 80-97% even if data is bad
    targetRTP = Math.max(0.80, Math.min(0.97, targetRTP));

    const targetPaid = gameStats.total_wagered * targetRTP;
    const deficit = targetPaid - gameStats.total_paid; // Positive = underpaying

    // Only adjust if deficit is significant (> 1 bet worth)
    if (Math.abs(deficit) < betAmount) return winAmount;

    // Aggressive catch-up: close 15% of the deficit per winning spin.
    // Prior 2% correction was too slow — volatile games with few wins
    // never converged within a typical session. 15% means a game that
    // is 20% under target closes the gap in ~7 winning spins.
    const correction = deficit * 0.15;

    let scaled = winAmount + correction;

    // Clamp: never go below 25% of original or above 12x original
    scaled = Math.max(winAmount * 0.25, Math.min(winAmount * 12, scaled));

    return Math.round(scaled * 100) / 100;
}

// ═══════════════════════════════════════════════════════════
// WIN AMOUNT CAPPING
// ═══════════════════════════════════════════════════════════

async function capWinAmount(winAmount, betAmount, game, db) {
    const maxMultiplier = game.jackpot > 0
        ? config.MAX_WIN_MULTIPLIER || 500
        : Math.min(config.MAX_WIN_MULTIPLIER || 500, 200);
    let capped = Math.min(winAmount, betAmount * maxMultiplier);

    const globalStats = await getGlobalStats(db);
    if (globalStats && globalStats.wagered > 0) {
        {
            const currentProfit = (globalStats.wagered || 0) - (globalStats.paid || 0);

            // ── Profit percentage cap (config: 12%, fallback: 20%) ────────
            // A single payout may never exceed MAX_PAYOUT_PROFIT_PCT of accumulated profit.
            // Ensures the house is always net-positive after paying out.
            // A small floor (MIN_WIN_MULTIPLIER_FLOOR × bet) keeps the game
            // playable during early low-profit bootstrap phase.
            const profitPct = config.MAX_PAYOUT_PROFIT_PCT || 0.20;
            // ROUND 35: Min floor only applies when house has enough profit headroom.
            // Previously, minFloor of 2x bet meant a $1000 bet could win $2000 even
            // when house profit was only $500, pushing house to -$1500.
            // Now: if profit < $2000, skip the minFloor and let profitPct govern.
            const minFloor = currentProfit > 2000
                ? betAmount * (config.MIN_WIN_MULTIPLIER_FLOOR || 1.5)
                : 0;
            const profitCap = Math.max(minFloor, currentProfit * profitPct);
            capped = Math.min(capped, profitCap);

            // ── Absolute profit-floor guard ───────────────────────────────
            // Refuse any payout that would push house below PROFIT_FLOOR (0).
            const projectedProfit = currentProfit - capped;
            if (projectedProfit < (config.PROFIT_FLOOR || 0)) {
                const maxAllowed = Math.max(0, currentProfit - (config.PROFIT_FLOOR || 0));
                capped = Math.min(capped, maxAllowed);
                // No betAmount * 0.1 fallback — if house can't afford it, cap to 0
            }
        }
    }

    // IMPROVEMENT: Round to cents using integer arithmetic to avoid floating-point drift
    return Math.round(capped * 100) / 100;
}

// ═══════════════════════════════════════════════════════════
// REAL PAYTABLE MULTIPLIERS
// ═══════════════════════════════════════════════════════════

// ── PAYLINE PAYTABLE ──
// Calibrated via RTP verification (tools/rtp-verifier.js).
// Format: [3-match, 4-match, 5-match] — indexed by symbol tier (0=common → 5=rare)
// Base hit freq ~30% for 5-reel payline games. Target RTP: 88%.
const PAYLINE_PAYTABLE = {
    0: [0.55, 1.40, 3.50],   // Low: card 9/10
    1: [0.70, 2.10, 5.00],   // Low: J/Q
    2: [1.10, 3.50, 8.50],   // Medium: K/A
    3: [1.70, 5.70, 14.0],   // Medium-high: themed low
    4: [2.80, 8.50, 21.0],   // High: themed medium
    5: [4.20, 14.0, 35.0],   // Premium: themed high
};

// ── CLUSTER PAYTABLE ──
// Calibrated via RTP verification. Scaled ×0.78 from initial estimate.
// Format: [5-7 cluster, 8-9, 10-11, 12+] — indexed by symbol tier
// Base hit freq ~28% for 7x7 cluster games. Target RTP: 88%.
const CLUSTER_PAYTABLE = {
    0: [0.15, 0.80, 2.40, 8.0],    // Common candy
    1: [0.25, 1.20, 3.50, 12.0],   // Common gummy
    2: [0.40, 2.00, 6.00, 16.0],   // Medium treat
    3: [0.80, 4.00, 12.0, 32.0],   // Rare dessert
    4: [1.60, 6.00, 20.0, 48.0],   // Premium sweet
    5: [2.40, 9.00, 32.0, 80.0],   // Jackpot candy
};

// ── CLASSIC 3-REEL PAYTABLE ──
// Calibrated via RTP verification. Scaled ×5.9 from initial estimate.
// Format: [double (2-match), triple (3-match)] — indexed by symbol tier
// Base hit freq ~15% for 3x1 classic. Target RTP: 88%.
const CLASSIC_PAYTABLE = {
    0: [3.00, 18.0],   // Cherry
    1: [3.50, 24.0],   // Lemon
    2: [4.80, 36.0],   // Orange
    3: [6.00, 60.0],   // Plum
    4: [9.00, 90.0],   // Bell
    5: [15.0, 150.0],  // 7/Diamond
};

function getPaylinePay(symbolIndex, matchCount, game) {
    const tier = Math.min(symbolIndex, 5);
    const pays = PAYLINE_PAYTABLE[tier];
    let base;
    if (matchCount >= 5) base = pays[2];
    else if (matchCount >= 4) base = pays[1];
    else base = pays[0];

    // NOTE: No static row-count scaling. Dynamic RTP convergence (scaleWinForRTP)
    // handles different grid configurations automatically.
    return base;
}

function getClusterPay(symbolIndex, clusterSize, game) {
    const tier = Math.min(symbolIndex, 5);
    const pays = CLUSTER_PAYTABLE[tier];
    let base;
    if (clusterSize >= 12) base = pays[3];
    else if (clusterSize >= 10) base = pays[2];
    else if (clusterSize >= 8) base = pays[1];
    else base = pays[0];

    // NOTE: No static grid-size scaling. Dynamic RTP convergence (scaleWinForRTP)
    // handles different grid configurations by adjusting win amounts based on
    // per-game accumulated stats. This is more robust than static multiplier tuning.
    return base;
}

function getClassicPay(symbolIndex, type) {
    const tier = Math.min(symbolIndex, 5);
    const pays = CLASSIC_PAYTABLE[tier];
    return type === 'triple' ? pays[1] : pays[0];
}

// ═══════════════════════════════════════════════════════════
// GAME STATS TRACKING
// ═══════════════════════════════════════════════════════════

async function updateGameStats(db, gameId, betAmount, winAmount) {
    const existing = await db.get('SELECT game_id, total_spins, total_wagered, total_paid, actual_rtp FROM game_stats WHERE game_id = ?', [gameId]);

    if (existing) {
        const totalWagered = existing.total_wagered + betAmount;
        const totalPaid = existing.total_paid + winAmount;
        const actualRtp = totalWagered > 0 ? totalPaid / totalWagered : 0;

        await db.run(
            `UPDATE game_stats SET total_spins = total_spins + 1, total_wagered = ?, total_paid = ?, actual_rtp = ? WHERE game_id = ?`,
            [totalWagered, totalPaid, actualRtp, gameId]
        );
    } else {
        const actualRtp = betAmount > 0 ? winAmount / betAmount : 0;
        await db.run(
            `INSERT INTO game_stats (game_id, total_spins, total_wagered, total_paid, actual_rtp) VALUES (?, 1, ?, ?, ?)`,
            [gameId, betAmount, winAmount, actualRtp]
        );
    }
}

async function getGameStats(db, gameId) {
    return await db.get('SELECT game_id, total_spins, total_wagered, total_paid, actual_rtp FROM game_stats WHERE game_id = ?', [gameId]) || {
        game_id: gameId,
        total_spins: 0,
        total_wagered: 0,
        total_paid: 0,
        actual_rtp: 0,
    };
}

module.exports = {
    getSymbolWeights,
    getEffectiveHitFrequency,
    shouldAllowWin,
    updateGameStats,
    getGameStats,
    getGlobalStats,  // ROUND 35: Exposed for game-engine.js free spin RTP check + jackpot profit floor
    capWinAmount,
    scaleWinForRTP,
    getPaylinePay,
    getClusterPay,
    getClassicPay,
    getHitFrequency,
};
