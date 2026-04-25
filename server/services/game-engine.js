const rng = require('./rng.service');
const houseEdge = require('./house-edge');

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

function generateGrid(game, gameStats) {
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
    const weights = houseEdge.getSymbolWeights(game, gameStats);
    const grid = createEmptyGrid(cols, rows);
    const winType = getWinType(game);

    // Generate base grid with weighted symbols
    for (let c = 0; c < cols; c++) {
        for (let r = 0; r < rows; r++) {
            grid[c][r] = rng.pickWeighted(symbols, weights);
        }
    }

    // For payline games: ensure no 3+ consecutive matches on any payline
    if (winType === 'payline') {
        // Simple approach: ensure adjacent columns don't have matching symbols
        // on the same row positions too often
        for (let c = 2; c < cols; c++) {
            for (let r = 0; r < rows; r++) {
                // If 3 consecutive on this row match, replace the current one
                if (symbolsMatchWithWild(grid[c][r], grid[c - 1][r], game) &&
                    symbolsMatchWithWild(grid[c - 1][r], grid[c - 2][r], game)) {
                    // Pick a different symbol (commons only to maintain weight distribution)
                    let attempts = 0;
                    while (attempts < 10) {
                        const newSym = rng.pickWeighted(symbols, weights);
                        if (newSym !== grid[c - 1][r] && !isWild(newSym, game)) {
                            grid[c][r] = newSym;
                            break;
                        }
                        attempts++;
                    }
                }
            }
        }
    }

    // For cluster games: break up large clusters
    if (winType === 'cluster') {
        const minCluster = game.clusterMin || 5;
        // Do a pass to break up large same-symbol regions
        for (let c = 0; c < cols; c++) {
            for (let r = 0; r < rows; r++) {
                // Check if this cell has too many same neighbors
                const sym = grid[c][r];
                let sameNeighbors = 0;
                const neighbors = [[c - 1, r], [c + 1, r], [c, r - 1], [c, r + 1]];
                for (const [nc, nr] of neighbors) {
                    if (nc >= 0 && nc < cols && nr >= 0 && nr < rows) {
                        if (grid[nc][nr] === sym || isWild(grid[nc][nr], game)) {
                            sameNeighbors++;
                        }
                    }
                }
                // If 3+ same neighbors, this is likely part of a big cluster — break it
                if (sameNeighbors >= 3) {
                    let attempts = 0;
                    while (attempts < 10) {
                        const newSym = rng.pickWeighted(symbols, weights);
                        if (newSym !== sym && !isWild(newSym, game)) {
                            grid[c][r] = newSym;
                            break;
                        }
                        attempts++;
                    }
                }
            }
        }
    }

    // For classic: ensure no triple match
    if (winType === 'classic' && rows === 1) {
        // 3x1: ensure all 3 symbols are different
        if (grid[0][0] === grid[1][0] && grid[1][0] === grid[2][0]) {
            let attempts = 0;
            while (attempts < 10) {
                const newSym = rng.pickWeighted(symbols, weights);
                if (newSym !== grid[0][0] && !isWild(newSym, game)) {
                    grid[2][0] = newSym;
                    break;
                }
                attempts++;
            }
        }
    }

    // Remove all wilds from no-win grids (wilds create unexpected wins)
    for (let c = 0; c < cols; c++) {
        for (let r = 0; r < rows; r++) {
            if (isWild(grid[c][r], game)) {
                // Replace wild with a random common symbol
                const commonWeights = weights.slice(0, Math.max(3, Math.floor(symbols.length / 2)));
                const commonSymbols = symbols.slice(0, commonWeights.length);
                grid[c][r] = rng.pickWeighted(commonSymbols, commonWeights);
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
    if (!freeSpinState) {
        freeSpinState = { active: false, remaining: 0, multiplier: 1, cascadeLevel: 0, totalWin: 0 };
    }

    const winType = getWinType(game);
    const seed = rng.generateSeed();

    // ═══ HIT FREQUENCY GATE ═══
    // Determine if this spin is allowed to produce a win.
    // Free spins have a higher but still controlled chance
    const allowWin = freeSpinState.active
        ? (await houseEdge.shouldAllowWin(game, gameStats, db)) || rng.randomFloat() < 0.35
        : await houseEdge.shouldAllowWin(game, gameStats, db);

    // Generate appropriate grid
    const grid = allowWin
        ? generateGrid(game, gameStats)
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
            const payMultiplier = houseEdge.getClusterPay(symIndex, cluster.size);

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
            let payMultiplier = houseEdge.getPaylinePay(win.symbolIndex, win.matchCount);

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
        };
    }

    // Scatter retrigger during free spins
    const MAX_FREE_SPINS = 50;
    if (scatterCount >= scatterThreshold && freeSpinState.active && game.freeSpinsRetrigger && freeSpinState.remaining < MAX_FREE_SPINS) {
        const extraSpins = scatterCount >= fullScatterThreshold ? game.freeSpinsCount : Math.max(2, Math.floor(game.freeSpinsCount / 3));
        const capped = Math.min(extraSpins, MAX_FREE_SPINS - freeSpinState.remaining);
        if (capped > 0) {
            freeSpinState.remaining += capped;
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
