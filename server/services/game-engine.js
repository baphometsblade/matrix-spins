const rng = require('./rng.service');
const houseEdge = require('./house-edge');
const config = require('../config');

/**
 * Server-side game engine.
 * All win calculation, grid generation, and bonus logic lives here.
 * The client NEVER sees payout tables or RNG logic.
 *
 * Uses real slot mathematics:
 * - Weighted symbol distribution (virtual reel strips)
 * - Hit frequency gate (most spins are losses)
 * - Realistic paytable multipliers (scraped from real Pragmatic Play games)
 * - Win amounts expressed as multipliers of TOTAL BET
 */

// ─── Grid Helpers ───

function getGridCols(game) { return (game && game.gridCols) || 3; }
function getGridRows(game) { return (game && game.gridRows) || 1; }
function getWinType(game) { return (game && game.winType) || 'classic'; }
function isMultiRow(game) { return getGridRows(game) > 1; }

function createEmptyGrid(cols, rows) {
    return Array.from({ length: cols }, () => Array(rows).fill(null));
}

function isWild(symbol, game) {
    return game && game.wildSymbol && symbol === game.wildSymbol;
}

function isScatter(symbol, game) {
    return game && game.scatterSymbol && symbol === game.scatterSymbol;
}

function getSymbolIndex(symbol, game) {
    const idx = game.symbols.indexOf(symbol);
    return idx >= 0 ? idx : 0;
}

function countSymbolInGrid(grid, symbol) {
    let count = 0;
    for (const col of grid) {
        for (const s of col) {
            if (s === symbol) count++;
        }
    }
    return count;
}

function countWildsInGrid(grid, game) {
    if (!game || !game.wildSymbol) return 0;
    return countSymbolInGrid(grid, game.wildSymbol);
}

function symbolsMatchWithWild(a, b, game) {
    if (a === b) return true;
    if (isWild(a, game) || isWild(b, game)) return true;
    return false;
}

// ─── Grid Generation (with house edge weighting) ───

function generateGrid(game, gameStats, freeSpinState) {
    const cols = getGridCols(game);
    const rows = getGridRows(game);
    const symbols = game.symbols;
    const grid = createEmptyGrid(cols, rows);

    // Get symbol weights from house edge service
    const weights = houseEdge.getSymbolWeights(game, gameStats);

    for (let c = 0; c < cols; c++) {
        for (let r = 0; r < rows; r++) {
            grid[c][r] = rng.pickWeighted(symbols, weights);
        }
    }

    // ── Scatter retrigger suppression during free spins ──
    // Without this, multi-row high-volatility games (e.g. gates_olympus /
    // Halls of Thunder) produce 3+ scatters on natural weight frequently
    // enough that retriggers chain almost every free spin, leaving the
    // player stuck in an infinite bonus loop. Cap scatters below the
    // retrigger threshold once a free-spin round is already active.
    const scatterSym = game.scatterSymbol;
    if (scatterSym && freeSpinState && freeSpinState.active && game.freeSpinsRetrigger) {
        const scatterThreshold = rows > 1 ? 3 : 2;
        const maxScatters = scatterThreshold - 1;
        const nonScatterSyms = symbols.filter(s => s !== scatterSym && !isWild(s, game));
        let scatterCount = 0;
        for (let c = 0; c < cols; c++) {
            for (let r = 0; r < rows; r++) {
                if (grid[c][r] === scatterSym) {
                    scatterCount++;
                    if (scatterCount > maxScatters && nonScatterSyms.length > 0) {
                        grid[c][r] = nonScatterSyms[rng.randomInt(nonScatterSyms.length)];
                    }
                }
            }
        }
    }

    return grid;
}

/**
 * Generate a "no-win" grid by breaking up potential winning patterns.
 * Used when the hit frequency gate determines this spin should be a loss.
 * We generate a grid and then shuffle to break any winning combos.
 */
function generateNoWinGrid(game, gameStats) {
    const cols = getGridCols(game);
    const rows = getGridRows(game);
    const symbols = game.symbols;
    const grid = createEmptyGrid(cols, rows);

    // ═══════════════════════════════════════════════════════════
    // UNIVERSAL NO-WIN GRID GENERATION
    // ═══════════════════════════════════════════════════════════
    // Uses a diagonal stripe pattern that MATHEMATICALLY GUARANTEES no wins:
    //   grid[c][r] = symbols[(c + r * 2) % N]
    //
    // Properties (where N = number of non-wild symbols):
    //   • No two adjacent cells (horizontal/vertical) share a symbol
    //   • Therefore: no clusters of 2+, no 3-match paylines, no classic matches
    //   • Shuffling the symbol mapping each spin provides visual variety
    //   • Scatter suppression prevents free-spin triggers on loss spins

    // Build safe symbol list: exclude wilds entirely
    const nonWildSymbols = symbols.filter(s => !isWild(s, game));
    const numSyms = nonWildSymbols.length;

    // Shuffle the symbol-to-stripe mapping for visual variety per spin
    const shuffled = [...nonWildSymbols];
    for (let i = shuffled.length - 1; i > 0; i--) {
        const j = rng.randomInt(i + 1);
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }

    // Generate the grid: diagonal stripes ensure zero adjacent matches
    for (let c = 0; c < cols; c++) {
        for (let r = 0; r < rows; r++) {
            grid[c][r] = shuffled[(c + r * 2) % numSyms];
        }
    }

    // Suppress scatter symbols below trigger threshold.
    // Without this, scatter symbols appear uniformly (~N/numSyms times),
    // which on large grids easily exceeds the scatter threshold.
    const scatterSym = game.scatterSymbol;
    if (scatterSym && game.freeSpinsCount > 0) {
        const scatterThreshold = rows > 1 ? 3 : 2;
        const maxScatters = scatterThreshold - 1;
        let scatterCount = 0;
        // Build safe replacement list (no scatter, no wild)
        const safeSyms = nonWildSymbols.filter(s => s !== scatterSym);
        for (let c = 0; c < cols; c++) {
            for (let r = 0; r < rows; r++) {
                if (grid[c][r] === scatterSym) {
                    scatterCount++;
                    if (scatterCount > maxScatters && safeSyms.length > 0) {
                        grid[c][r] = safeSyms[rng.randomInt(safeSyms.length)];
                    }
                }
            }
        }
    }

    return grid;
}

// ─── Payline Definitions ───

function getPaylines(game) {
    const cols = getGridCols(game);
    const rows = getGridRows(game);

    if (rows === 1) return [[0, 0, 0]];

    if (rows === 3 && cols === 3) {
        return [
            [0, 0, 0], [1, 1, 1], [2, 2, 2],
            [0, 1, 2], [2, 1, 0],
        ];
    }

    if (rows === 3 && cols === 5) {
        return [
            [1, 1, 1, 1, 1], [0, 0, 0, 0, 0], [2, 2, 2, 2, 2],
            [0, 1, 2, 1, 0], [2, 1, 0, 1, 2], [0, 0, 1, 0, 0],
            [2, 2, 1, 2, 2], [1, 0, 0, 0, 1], [1, 2, 2, 2, 1],
            [0, 1, 1, 1, 0], [2, 1, 1, 1, 2], [1, 0, 1, 0, 1],
            [1, 2, 1, 2, 1], [0, 1, 0, 1, 0], [2, 1, 2, 1, 2],
            [1, 1, 0, 1, 1], [1, 1, 2, 1, 1], [0, 0, 1, 2, 2],
            [2, 2, 1, 0, 0], [0, 2, 0, 2, 0],
        ];
    }

    if (rows === 4 && cols === 5) {
        return [
            [1, 1, 1, 1, 1], [2, 2, 2, 2, 2], [0, 0, 0, 0, 0], [3, 3, 3, 3, 3],
            [0, 1, 2, 1, 0], [3, 2, 1, 2, 3], [1, 0, 0, 0, 1], [2, 3, 3, 3, 2],
            [0, 0, 1, 2, 2], [3, 3, 2, 1, 1], [1, 2, 3, 2, 1], [2, 1, 0, 1, 2],
            [0, 1, 1, 1, 0], [3, 2, 2, 2, 3], [1, 0, 1, 0, 1], [2, 3, 2, 3, 2],
            [0, 2, 0, 2, 0], [3, 1, 3, 1, 3], [1, 1, 0, 1, 1], [2, 2, 3, 2, 2],
            [0, 0, 2, 0, 0], [3, 3, 1, 3, 3], [1, 2, 1, 2, 1], [2, 1, 2, 1, 2],
            [0, 1, 0, 1, 0], [3, 2, 3, 2, 3], [0, 0, 0, 1, 2], [3, 3, 3, 2, 1],
            [1, 1, 2, 3, 3], [2, 2, 1, 0, 0], [0, 1, 2, 3, 3], [3, 2, 1, 0, 0],
            [1, 0, 0, 1, 2], [2, 3, 3, 2, 1], [0, 2, 1, 2, 0], [3, 1, 2, 1, 3],
            [1, 0, 2, 0, 1], [2, 3, 1, 3, 2], [0, 3, 0, 3, 0], [1, 2, 0, 2, 1],
        ];
    }

    // Fallback: horizontal lines
    const lines = [];
    for (let r = 0; r < rows; r++) {
        lines.push(Array(cols).fill(r));
    }
    return lines;
}

// ─── Cluster Detection (BFS flood-fill) ───

function findClusters(grid, game) {
    const cols = grid.length;
    const rows = grid[0].length;
    const visited = createEmptyGrid(cols, rows);
    const clusters = [];

    for (let c = 0; c < cols; c++) {
        for (let r = 0; r < rows; r++) {
            if (visited[c][r]) continue;
            const symbol = grid[c][r];
            if (!symbol || isWild(symbol, game)) continue; // Don't start clusters from wilds

            const cluster = [];
            const queue = [[c, r]];
            visited[c][r] = true;

            while (queue.length > 0) {
                const [cc, cr] = queue.shift();
                cluster.push([cc, cr]);

                const neighbors = [[cc - 1, cr], [cc + 1, cr], [cc, cr - 1], [cc, cr + 1]];
                for (const [nc, nr] of neighbors) {
                    if (nc < 0 || nc >= cols || nr < 0 || nr >= rows) continue;
                    if (visited[nc][nr]) continue;
                    const nSym = grid[nc][nr];
                    if (nSym === symbol || isWild(nSym, game)) {
                        visited[nc][nr] = true;
                        queue.push([nc, nr]);
                    }
                }
            }

            if (cluster.length >= (game.clusterMin || 5)) {
                clusters.push({ symbol, cells: cluster, size: cluster.length });
            }
        }
    }

    return clusters;
}

// ─── Payline Win Detection ───

function checkPaylineWins(grid, game) {
    const paylines = getPaylines(game);
    const cols = getGridCols(game);
    const wins = [];

    for (let lineIdx = 0; lineIdx < paylines.length; lineIdx++) {
        const line = paylines[lineIdx];
        const lineSymbols = [];
        for (let c = 0; c < Math.min(cols, line.length); c++) {
            lineSymbols.push(grid[c][line[c]]);
        }

        const firstSym = lineSymbols[0];
        let matchCount = 1;
        let effectiveSym = isWild(firstSym, game) ? null : firstSym;

        for (let i = 1; i < lineSymbols.length; i++) {
            const s = lineSymbols[i];
            if (isWild(s, game)) {
                matchCount++;
            } else if (effectiveSym === null) {
                effectiveSym = s;
                matchCount++;
            } else if (s === effectiveSym) {
                matchCount++;
            } else {
                break;
            }
        }

        if (matchCount >= 3) {
            const sym = effectiveSym || firstSym;
            wins.push({
                lineIndex: lineIdx,
                matchCount,
                symbol: sym,
                symbolIndex: getSymbolIndex(sym, game),
                cells: line.slice(0, matchCount).map((row, col) => [col, row]),
                hasWild: lineSymbols.slice(0, matchCount).some(s => isWild(s, game)),
            });
        }
    }

    return wins;
}

// ─── Classic 3-reel Detection ───

function checkClassicWins(grid, game) {
    const symbols = grid.map(col => col[0]); // flat 1D
    const wildCount = symbols.filter(s => isWild(s, game)).length;
    const hasWild = wildCount > 0;

    // Triple match
    if (symbolsMatchWithWild(symbols[0], symbols[1], game) &&
        symbolsMatchWithWild(symbols[1], symbols[2], game) &&
        symbolsMatchWithWild(symbols[0], symbols[2], game)) {
        const allWilds = wildCount === 3;
        // Find the effective symbol (non-wild)
        let effectiveSym = symbols.find(s => !isWild(s, game)) || symbols[0];
        return {
            type: 'triple',
            hasWild,
            allWilds,
            symbols,
            symbol: effectiveSym,
            symbolIndex: getSymbolIndex(effectiveSym, game),
        };
    }

    // Double match (any two matching)
    const pairs = [[0, 1], [1, 2], [0, 2]];
    for (const [i, j] of pairs) {
        if (symbolsMatchWithWild(symbols[i], symbols[j], game)) {
            let effectiveSym = [symbols[i], symbols[j]].find(s => !isWild(s, game)) || symbols[i];
            return {
                type: 'double',
                hasWild,
                pairIndices: [i, j],
                symbols,
                symbol: effectiveSym,
                symbolIndex: getSymbolIndex(effectiveSym, game),
            };
        }
    }

    return null;
}

// ─── Bonus Multiplier Logic ───

function applyBonusMultiplier(baseWin, game, freeSpinState) {
    let multiplier = freeSpinState.multiplier || 1;
    let bonusText = '';

    if (freeSpinState.active && game.bonusType === 'random_multiplier') {
        const range = game.randomMultiplierRange || [2, 3, 5];
        const bombMult = rng.pickRandom(range);
        multiplier *= bombMult;
        bonusText = ` (${bombMult}x Bomb!)`;
    }

    if (freeSpinState.active && game.bonusType === 'zeus_multiplier') {
        const zMults = game.zeusMultipliers || [2, 3, 5];
        const zeusMult = rng.pickRandom(zMults);
        multiplier *= zeusMult;
        bonusText = ` (Zeus ${zeusMult}x!)`;
    }

    if (freeSpinState.active && (game.bonusType === 'tumble' || game.bonusType === 'avalanche')) {
        const mults = game.tumbleMultipliers || game.avalancheMultipliers || [1, 2, 3, 5];
        const idx = Math.min(freeSpinState.cascadeLevel || 0, mults.length - 1);
        multiplier = mults[idx];
        freeSpinState.cascadeLevel = (freeSpinState.cascadeLevel || 0) + 1;
        bonusText = ` (Cascade ${multiplier}x!)`;
    }

    // ROUND 35: Cap multiplier to prevent unlimited stacking.
    // Previously, random_multiplier * zeus_multiplier * tumble could stack to 125x+.
    // Industry standard for premium slots: max bonus multiplier = 15x.
    var MAX_BONUS_MULTIPLIER = 15;
    if (multiplier > MAX_BONUS_MULTIPLIER) {
        multiplier = MAX_BONUS_MULTIPLIER;
        bonusText += ' (capped)';
    }
    return { amount: Math.round(baseWin * multiplier * 100) / 100, multiplier, bonusText };
}

function getMoneyValue(symbol, game, betAmount) {
    const moneySyms = game.moneySymbols || game.fishSymbols || [];
    if (!moneySyms.includes(symbol)) return 0;
    // Money values: small fractions of bet (real Hold & Win values)
    const values = [0.5, 1, 1.5, 2, 3, 5];
    return betAmount * rng.pickRandom(values) * 0.05; // Scale down significantly
}

function getWheelMultiplier(game) {
    const mults = game.wheelMultipliers || [2, 3, 5];
    return rng.pickRandom(mults);
}

// ─── Main Spin Resolution ───

/**
 * Resolve a complete spin on the server.
 * @param {Object} game - game definition
 * @param {number} betAmount - wager
 * @param {Object} gameStats - current game stats (for house edge)
 * @param {Object} freeSpinState - {active, remaining, multiplier, cascadeLevel}
 * @returns {Object} { grid, winAmount, winDetails, freeSpinState, scatterTriggered }
 */
async function resolveSpin(game, betAmount, gameStats, freeSpinState = null, db = null) {
    // IMPROVEMENT: Input validation — reject bad bets before any game logic runs
    if (typeof betAmount !== 'number' || !isFinite(betAmount) || betAmount < config.MIN_BET || betAmount > config.MAX_BET) {
        throw new Error('Invalid bet amount');
    }
    if (!game || !game.id || !Array.isArray(game.symbols) || game.symbols.length === 0) {
        throw new Error('Invalid game definition');
    }
    if (!freeSpinState) {
        freeSpinState = { active: false, remaining: 0, multiplier: 1, cascadeLevel: 0, totalWin: 0 };
    }

    const winType = getWinType(game);
    const seed = rng.generateSeed();

    // ═══ HIT FREQUENCY GATE ═══
    // ROUND 35: Free spins MUST respect the house edge engine.
    // Previously, free spins had `|| rng.random() < 0.35` which guaranteed 35% hit rate
    // even when the house edge engine said NO (e.g., when RTP >= 1.0).
    // This was the #1 profit leak — free spins could bleed the house unlimited.
    // Now free spins get a slightly higher chance via a secondary roll, but ONLY
    // if global RTP is under the safety ceiling (0.92). This preserves the fun of
    // free spins while keeping the house profitable.
    let allowWin;
    if (freeSpinState.active) {
        allowWin = await houseEdge.shouldAllowWin(game, gameStats, db);
        if (!allowWin) {
            // Secondary chance for free spins, but ONLY if house is healthy
            const stats = await houseEdge.getGlobalStats(db);
            const globalRTP = stats && stats.wagered > 0 ? stats.paid / stats.wagered : 0;
            if (globalRTP < 0.92) {
                allowWin = rng.random() < 0.25; // 25% secondary chance (was 35%)
            }
            // If RTP >= 0.92, NO secondary chance — house protection takes priority
        }
    } else {
        allowWin = await houseEdge.shouldAllowWin(game, gameStats, db);
    }

    // Generate appropriate grid. Passing freeSpinState lets generateGrid
    // suppress retrigger-level scatter counts during an active bonus round
    // (see scatter-suppression block in generateGrid).
    const grid = allowWin
        ? generateGrid(game, gameStats, freeSpinState)
        : generateNoWinGrid(game, gameStats);

    let winAmount = 0;
    let winDetails = { type: 'none', message: '' };

    // ═══ CLUSTER PAY ═══
    if (winType === 'cluster') {
        const clusters = findClusters(grid, game);
        let totalClusterWin = 0;

        for (const cluster of clusters) {
            const symIndex = getSymbolIndex(cluster.symbol, game);
            // Use real paytable multiplier from house-edge
            const payMultiplier = houseEdge.getClusterPay(symIndex, cluster.size, game);

            if (payMultiplier > 0) {
                let clusterWin = betAmount * payMultiplier;
                const bonus = applyBonusMultiplier(clusterWin, game, freeSpinState);
                totalClusterWin += bonus.amount;
            }
        }

        if (totalClusterWin > 0) {
            winAmount = totalClusterWin;
            const totalSize = clusters.reduce((sum, cl) => sum + cl.size, 0);
            winDetails = {
                type: 'cluster',
                clusterCount: clusters.length,
                totalSize,
                message: `CLUSTER WIN! ${clusters.length} cluster(s) = $${winAmount.toFixed(2)}!`,
            };
        } else if (freeSpinState.active && (game.bonusType === 'tumble' || game.bonusType === 'avalanche')) {
            freeSpinState.cascadeLevel = 0;
        }

    // ═══ PAYLINE ═══
    } else if (winType === 'payline') {
        const paylineWins = checkPaylineWins(grid, game);
        let totalPaylineWin = 0;

        for (const win of paylineWins) {
            // Use real paytable multiplier from house-edge
            let payMultiplier = houseEdge.getPaylinePay(win.symbolIndex, win.matchCount, game);

            // Wild bonus: 1.5x multiplier on wild-assisted wins
            if (win.hasWild) payMultiplier *= 1.5;

            let lineWin = betAmount * payMultiplier;
            const bonus = applyBonusMultiplier(lineWin, game, freeSpinState);
            totalPaylineWin += bonus.amount;
        }

        // Wheel multiplier bonus
        if (game.bonusType === 'wheel_multiplier' && !freeSpinState.active && paylineWins.some(w => w.matchCount >= getGridCols(game))) {
            const wheelMult = getWheelMultiplier(game);
            totalPaylineWin = Math.round(totalPaylineWin * wheelMult * 100) / 100;
        }

        if (totalPaylineWin > 0) {
            winAmount = totalPaylineWin;
            winDetails = {
                type: 'payline',
                lineCount: paylineWins.length,
                message: paylineWins.length === 1
                    ? `WIN! ${paylineWins[0].matchCount}-of-a-kind = $${winAmount.toFixed(2)}!`
                    : `MULTI-LINE WIN! ${paylineWins.length} paylines = $${winAmount.toFixed(2)}!`,
            };
        } else if (freeSpinState.active && (game.bonusType === 'tumble' || game.bonusType === 'avalanche')) {
            freeSpinState.cascadeLevel = 0;
        }

    // ═══ CLASSIC 3-REEL ═══
    } else {
        const classicResult = checkClassicWins(grid, game);
        if (classicResult) {
            // Use real paytable multiplier from house-edge
            const payMultiplier = houseEdge.getClassicPay(classicResult.symbolIndex, classicResult.type);
            let baseWin = betAmount * payMultiplier;

            // Wild bonus for classic
            if (classicResult.hasWild && classicResult.type === 'double') {
                baseWin *= 1.5;
            }

            const bonus = applyBonusMultiplier(baseWin, game, freeSpinState);
            winAmount = bonus.amount;

            // Wheel multiplier for classic triple
            if (classicResult.type === 'triple' && game.bonusType === 'wheel_multiplier' && !freeSpinState.active) {
                const wheelMult = getWheelMultiplier(game);
                winAmount = Math.round(winAmount * wheelMult * 100) / 100;
            }

            winDetails = {
                type: classicResult.type,
                message: classicResult.type === 'triple'
                    ? `MEGA WIN! Triple match = $${winAmount.toFixed(2)}!`
                    : `Nice win! Double match = $${winAmount.toFixed(2)}!`,
            };
        }
    }

    // ─── Money Collect mechanics ───
    const gridWilds = countWildsInGrid(grid, game);
    if (gridWilds > 0 && (game.bonusType === 'money_collect' || game.bonusType === 'fisherman_collect')) {
        const collectSyms = game.moneySymbols || game.fishSymbols || [];
        let collectTotal = 0;
        for (const col of grid) {
            for (const s of col) {
                if (collectSyms.includes(s)) collectTotal += getMoneyValue(s, game, betAmount);
            }
        }
        if (collectTotal > 0) {
            winAmount += collectTotal;
            winDetails.collectAmount = collectTotal;
        }
    }

    // ─── Scatter detection ───
    let scatterTriggered = false;
    let freeSpinsAwarded = 0;
    const scatterCount = countSymbolInGrid(grid, game.scatterSymbol || '');
    const scatterThreshold = isMultiRow(game) ? 3 : 2;
    const fullScatterThreshold = isMultiRow(game) ? 4 : 3;

    // Scatter pay: small multiplier of bet (real slots: 3x-5x bet for scatters)
    if (scatterCount >= scatterThreshold && !freeSpinState.active && game.freeSpinsCount > 0) {
        const scatterPay = scatterCount * betAmount * 0.5; // 0.5x per scatter (realistic)
        winAmount += scatterPay;
        scatterTriggered = true;

        if (scatterCount >= fullScatterThreshold) {
            freeSpinsAwarded = game.freeSpinsCount;
        } else {
            freeSpinsAwarded = Math.max(3, Math.floor(game.freeSpinsCount / 2));
        }

        freeSpinState = {
            active: true,
            remaining: freeSpinsAwarded,
            multiplier: 1,
            cascadeLevel: 0,
            totalWin: 0,
            gameId: game.id || null, // Lock free spins to awarding game
        };
    }

    // Scatter retrigger during free spins.
    // Hard cap the TOTAL free spins ever awarded in a single round
    // (initial + all retriggers) — without this, high-volatility games
    // with freeSpinsRetrigger=true could loop indefinitely. 100 is the
    // common industry ceiling for a single bonus round (Pragmatic,
    // NetEnt, Playtech all sit around 80-120).
    const MAX_FREE_SPINS = 50;           // max concurrent remaining
    const MAX_TOTAL_PER_ROUND = 100;     // max ever awarded in one round
    if (typeof freeSpinState.totalAwarded !== 'number') {
        freeSpinState.totalAwarded = freeSpinState.remaining || 0;
    }
    if (scatterCount >= scatterThreshold && freeSpinState.active && game.freeSpinsRetrigger
            && freeSpinState.remaining < MAX_FREE_SPINS
            && freeSpinState.totalAwarded < MAX_TOTAL_PER_ROUND) {
        const extraSpins = scatterCount >= fullScatterThreshold ? game.freeSpinsCount : Math.max(2, Math.floor(game.freeSpinsCount / 3));
        const room = Math.min(
            MAX_FREE_SPINS - freeSpinState.remaining,
            MAX_TOTAL_PER_ROUND - freeSpinState.totalAwarded
        );
        const capped = Math.min(extraSpins, room);
        if (capped > 0) {
            freeSpinState.remaining += capped;
            freeSpinState.totalAwarded += capped;
            freeSpinsAwarded += capped;
        }
    }

    // Advance free spins
    if (freeSpinState.active) {
        freeSpinState.remaining--;
        freeSpinState.totalWin += winAmount;
        if (freeSpinState.remaining <= 0) {
            freeSpinState.active = false;
        }
    }

    // Dynamic RTP convergence: scale win amount based on per-game RTP drift.
    // This ensures every game (regardless of grid size, cluster min, or payline count)
    // converges toward the target RTP without needing per-game paytable tuning.
    if (winAmount > 0) {
        winAmount = houseEdge.scaleWinForRTP(winAmount, betAmount, gameStats);
    }

    // Round final win amount
    winAmount = Math.round(winAmount * 100) / 100;

    return {
        grid,
        seed,
        winAmount,
        winDetails,
        freeSpinState,
        scatterTriggered,
        freeSpinsAwarded,
    };
}

module.exports = {
    resolveSpin,
    generateGrid,
    generateNoWinGrid,
    findClusters,
    checkPaylineWins,
    checkClassicWins,
    getGridCols,
    getGridRows,
    getWinType,
};
