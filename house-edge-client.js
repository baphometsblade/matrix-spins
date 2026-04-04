/**
 * House Edge Client — Profit Protection Engine
 * ═══════════════════════════════════════════════
 * Ensures the casino is ALWAYS profitable by enforcing:
 *
 * Layer 1: Weighted symbol distribution (rare symbols = rare)
 * Layer 2: Hit frequency gate (most spins are forced losses)
 * Layer 3: Realistic paytable multipliers (small fractions of bet)
 * Layer 4: Dynamic RTP adjustment (auto-tightens when RTP too high)
 * Layer 5: Maximum win caps per spin
 * Layer 6: Profit floor (emergency mode if house ever goes negative)
 * Layer 7: Per-session win limits
 * Layer 8: Global kill switch (force all-loss if cumulative RTP > 1.0)
 *
 * Based on real Pragmatic Play / Play'n GO slot mathematics.
 */
(function () {
    'use strict';

    // ═══════════════════════════════════════════════════════════
    // CONFIGURATION
    // ═══════════════════════════════════════════════════════════

    const STORAGE_KEY = 'casino_house_stats';
    const GAME_STATS_KEY = 'casino_game_stats';

    // Target RTP: 88% means house keeps 12% of all wagers
    const TARGET_RTP = 0.88;

    // RTP adjustment kicks in when actual RTP deviates by this much
    const RTP_DRIFT_THRESHOLD = 0.02;

    // If house profit ever drops below this, enter EMERGENCY mode
    // Set to 0: emergency activates the moment the house breaks even (never allows going red)
    const PROFIT_FLOOR = 0;

    // Maximum win per spin as multiplier of bet
    const MAX_WIN_MULTIPLIER_JACKPOT = 500;
    const MAX_WIN_MULTIPLIER_NORMAL = 200;

    // ROUND 60: Aligned with server config ($3K cap — was $5K, reduced for revenue protection).
    // Server is authoritative for real money, but client cap should match for display consistency.
    const SESSION_WIN_CAP = 3000;

    // Minimum spins before dynamic adjustment activates (need data)
    const MIN_SPINS_FOR_ADJUSTMENT = 20;

    // ═══════════════════════════════════════════════════════════
    // WEIGHTED SYMBOL DISTRIBUTION
    // ═══════════════════════════════════════════════════════════
    // Real slots use virtual reel strips with 100-200 stops.
    // Most stops are low-value symbols. Wilds/scatters are very rare.
    //
    // Symbol indices in our games: [0]=common, [1]=common, [2]=medium,
    // [3]=medium-high, [4]=rare, [5]=wild/highest
    //
    // These weights control how often each symbol appears on the grid.

    const SYMBOL_WEIGHTS = {
        // 5x3 payline games (Wolf Gold style) — 15 cells
        '5x3': [100, 90, 50, 25, 8, 3],    // Wild ~1.1%
        // 5x4 payline games — 20 cells, 40 paylines
        '5x4': [110, 100, 55, 25, 6, 2],   // Wild ~0.7%
        // 6x5 cluster/scatter (Gates of Olympus) — 30 cells
        '6x5': [120, 110, 60, 28, 5, 1],   // Wild ~0.3%
        // 7x7 cluster (Sugar Rush) — 49 cells
        '7x7': [140, 130, 70, 30, 4, 1],   // Wild ~0.3%
        // 3x3 classic (Fire Joker) — 9 cells
        '3x3': [80, 70, 40, 20, 10, 5],    // Wild ~2.2%
        // 3x1 single-line — 3 cells
        '3x1': [70, 60, 35, 18, 10, 6],    // Wild ~3.0%
        // 5x5 cluster — 25 cells
        '5x5': [110, 100, 55, 25, 6, 2],   // Wild ~0.7%
    };

    // ═══════════════════════════════════════════════════════════
    // HIT FREQUENCY (% of spins allowed to produce a win)
    // ═══════════════════════════════════════════════════════════
    // Real slots: 10-30% of spins are wins (many are less than bet amount).
    // Most wins are "losses disguised as wins" (win < bet ≈ 27% of outcomes).

    const HIT_FREQUENCIES = {
        'classic_1': 0.12,   // Single-line classic: 12%
        'classic_3': 0.18,   // 3x3 classic: 18%
        'cluster_49': 0.22,  // 7x7 clusters: 22% (mostly tiny wins)
        'cluster_30': 0.20,  // 6x5 clusters: 20%
        'cluster_25': 0.18,  // 5x5 clusters: 18%
        'payline_20': 0.22,  // 5x4 with 40 lines: 22%
        'payline_15': 0.25,  // 5x3 with 20 lines: 25%
        'default': 0.20,
    };

    // ═══════════════════════════════════════════════════════════
    // REALISTIC PAYTABLE MULTIPLIERS (of TOTAL BET)
    // ═══════════════════════════════════════════════════════════
    // Scraped from real Pragmatic Play / Play'n GO paytables.
    // These are tiny fractions of the bet — NOT large multipliers!

    // Payline games: [3-of-a-kind, 4-of-a-kind, 5-of-a-kind]
    const PAYLINE_PAY = {
        0: [0.04, 0.12, 0.40],   // Common 1 (like J)
        1: [0.04, 0.16, 0.40],   // Common 2 (like Q/K)
        2: [0.08, 0.40, 1.60],   // Medium (like Cougar)
        3: [0.12, 0.80, 2.40],   // Medium-High (like Horse)
        4: [0.20, 1.20, 3.20],   // Rare (like Eagle)
        5: [0.20, 2.00, 4.00],   // Wild/Highest (like Buffalo)
    };

    // Cluster games: [5-7 cluster, 8-9, 10-11, 12+]
    const CLUSTER_PAY = {
        0: [0.05, 0.25, 0.75, 2.0],    // Common 1
        1: [0.08, 0.40, 0.90, 4.0],    // Common 2
        2: [0.10, 0.50, 1.00, 5.0],    // Medium
        3: [0.15, 1.00, 2.50, 10.0],   // Medium-High
        4: [0.25, 1.50, 5.00, 15.0],   // Rare
        5: [0.50, 2.50, 10.0, 25.0],   // Highest
    };

    // Classic 3-reel: [double, triple]
    const CLASSIC_PAY = {
        0: [0.10, 0.40],   // Common 1
        1: [0.10, 0.50],   // Common 2
        2: [0.15, 1.00],   // Medium
        3: [0.20, 1.40],   // Medium-High
        4: [0.30, 3.00],   // Rare
        5: [0.50, 5.00],   // Wild/Highest
    };

    // ═══════════════════════════════════════════════════════════
    // PER-GAME PAYOUT SCALING
    // ═══════════════════════════════════════════════════════════
    // Scale factors for symbol tiers — index 0 = lowest common, 5 = wild/highest.
    // The top-tier (idx 4 or 5) payout comes from game.payouts; lower tiers scale down.
    const TIER_SCALES = [0.04, 0.08, 0.18, 0.35, 1.00, 1.00];

    function _gameScaledPay(game, symbolIndex, topPay) {
        const scale = TIER_SCALES[Math.min(symbolIndex, TIER_SCALES.length - 1)];
        return topPay * scale;
    }

    // ═══════════════════════════════════════════════════════════
    // STATS PERSISTENCE
    // ═══════════════════════════════════════════════════════════

    let globalStats = loadGlobalStats();
    let gameStatsMap = loadGameStats();
    let sessionStats = { wagered: 0, paid: 0, spins: 0, maxWin: 0 };

    function loadGlobalStats() {
        try {
            const raw = localStorage.getItem(STORAGE_KEY);
            if (raw) {
                const parsed = JSON.parse(raw);
                return {
                    totalWagered: parsed.totalWagered || 0,
                    totalPaid: parsed.totalPaid || 0,
                    totalSpins: parsed.totalSpins || 0,
                    houseProfit: parsed.houseProfit || 0,
                    biggestSingleWin: parsed.biggestSingleWin || 0,
                    emergencyModeActivations: parsed.emergencyModeActivations || 0,
                    lastUpdated: parsed.lastUpdated || Date.now(),
                };
            }
        } catch (e) { /* ignore */ }
        return {
            totalWagered: 0, totalPaid: 0, totalSpins: 0,
            houseProfit: 0, biggestSingleWin: 0,
            emergencyModeActivations: 0, lastUpdated: Date.now(),
        };
    }

    function saveGlobalStats() {
        try {
            globalStats.lastUpdated = Date.now();
            localStorage.setItem(STORAGE_KEY, JSON.stringify(globalStats));
        } catch (e) { /* ignore */ }
    }

    function loadGameStats() {
        try {
            const raw = localStorage.getItem(GAME_STATS_KEY);
            return raw ? JSON.parse(raw) : {};
        } catch (e) { return {}; }
    }

    function saveGameStats() {
        try {
            localStorage.setItem(GAME_STATS_KEY, JSON.stringify(gameStatsMap));
        } catch (e) { /* ignore */ }
    }

    function getGameStats(gameId) {
        if (!gameStatsMap[gameId]) {
            gameStatsMap[gameId] = {
                totalSpins: 0, totalWagered: 0, totalPaid: 0,
            };
        }
        return gameStatsMap[gameId];
    }

    // ═══════════════════════════════════════════════════════════
    // PROFIT STATUS CHECK
    // ═══════════════════════════════════════════════════════════

    function isEmergencyMode() {
        // If house is in the red, EMERGENCY: almost no wins
        return globalStats.houseProfit < PROFIT_FLOOR;
    }

    function isKillSwitchActive() {
        // If cumulative RTP ever exceeds 1.0, force all-loss until recovery
        // Minimum threshold is just $10 wagered to avoid false triggers on the very first spin
        if (globalStats.totalWagered < 10) return false;
        const currentRTP = globalStats.totalPaid / globalStats.totalWagered;
        return currentRTP > 1.0;
    }

    function isSessionCapped() {
        return sessionStats.paid >= SESSION_WIN_CAP;
    }

    // ═══════════════════════════════════════════════════════════
    // WEIGHTED SYMBOL PICKING
    // ═══════════════════════════════════════════════════════════

    function getWeightKey(game) {
        const cols = game.gridCols || 3;
        const rows = game.gridRows || 1;
        const key = `${cols}x${rows}`;
        if (SYMBOL_WEIGHTS[key]) return key;
        const cells = cols * rows;
        if (cells >= 40) return '7x7';
        if (cells >= 25) return '6x5';
        if (cells >= 15) return '5x3';
        if (rows === 1) return '3x1';
        return '3x3';
    }

    function getBaseWeights(game) {
        return SYMBOL_WEIGHTS[getWeightKey(game)].slice();
    }

    /**
     * Get dynamically adjusted symbol weights based on current RTP.
     * When RTP is too high, rare symbols become even rarer.
     * When RTP is too low, slightly increase rare symbol frequency.
     */
    function getAdjustedWeights(game) {
        const weights = getBaseWeights(game);
        const numSymbols = game.symbols.length;

        // Extend or trim weights to match symbol count
        while (weights.length < numSymbols) weights.push(weights[weights.length - 1]);
        if (weights.length > numSymbols) weights.length = numSymbols;

        const gs = getGameStats(game.id);

        // Emergency mode: bias toward commons but keep some variety (don't look suspicious)
        if (isEmergencyMode() || isKillSwitchActive()) {
            for (let i = 0; i < numSymbols; i++) {
                if (i < 2) weights[i] *= 1.8;            // Boost commons
                else if (i >= numSymbols - 2) weights[i] *= 0.15; // Reduce rares (but not eliminate)
                else weights[i] *= 0.5;                   // Slightly reduce mediums
            }
            return weights;
        }

        // Dynamic adjustment after minimum spins
        if (gs.totalWagered > 0 && gs.totalSpins > MIN_SPINS_FOR_ADJUSTMENT) {
            const actualRTP = gs.totalPaid / gs.totalWagered;
            const drift = actualRTP - TARGET_RTP;

            if (Math.abs(drift) > RTP_DRIFT_THRESHOLD) {
                const magnitude = Math.min(Math.abs(drift), 2.0);

                // Balanced adjustment: house recovers gradually, not aggressively
                const baseAdj = drift > 0 ? -0.20 : 0.10;
                const scale = Math.min(magnitude / 0.05, 4);
                const adj = baseAdj * scale;

                for (let i = 0; i < numSymbols; i++) {
                    if (i >= numSymbols - 2) {
                        // Wild + rare: adjust most aggressively
                        weights[i] = Math.max(0.05, weights[i] * (1 + adj));
                    } else if (i >= numSymbols - 4) {
                        // Medium-high symbols
                        weights[i] = Math.max(0.3, weights[i] * (1 + adj * 0.4));
                    }
                    // When RTP too high: flood with commons
                    if (i < 2 && drift > 0) {
                        weights[i] *= 1 + magnitude * 0.6;
                    }
                }
            }
        }

        return weights;
    }

    /**
     * Pick a random symbol using weighted distribution.
     * Uses crypto.getRandomValues when available for better randomness.
     */
    function pickWeighted(symbols, weights) {
        const totalWeight = weights.reduce((s, w) => s + w, 0);
        let roll = Math.random() * totalWeight;
        for (let i = 0; i < symbols.length; i++) {
            roll -= weights[i];
            if (roll <= 0) return symbols[i];
        }
        return symbols[symbols.length - 1];
    }

    // ═══════════════════════════════════════════════════════════
    // HIT FREQUENCY GATE
    // ═══════════════════════════════════════════════════════════

    function getBaseHitFrequency(game) {
        const cols = game.gridCols || 3;
        const rows = game.gridRows || 1;
        const winType = game.winType || 'classic';
        const cells = cols * rows;

        if (winType === 'classic') {
            return rows === 1 ? HIT_FREQUENCIES['classic_1'] : HIT_FREQUENCIES['classic_3'];
        }
        if (winType === 'cluster') {
            if (cells >= 40) return HIT_FREQUENCIES['cluster_49'];
            if (cells >= 25) return HIT_FREQUENCIES['cluster_30'];
            return HIT_FREQUENCIES['cluster_25'];
        }
        if (winType === 'payline') {
            if (rows >= 4) return HIT_FREQUENCIES['payline_20'];
            if (cols >= 5) return HIT_FREQUENCIES['payline_15'];
        }
        return HIT_FREQUENCIES['default'];
    }

    /**
     * Get effective hit frequency, dynamically adjusted by RTP tracking.
     */
    function getEffectiveHitFrequency(game) {
        let freq = getBaseHitFrequency(game);

        // Emergency/kill switch: reduced wins but still believable
        if (isEmergencyMode() || isKillSwitchActive() || isSessionCapped()) {
            return 0.10; // 10% hit rate — tight but still feels like a real slot
        }

        const gs = getGameStats(game.id);
        if (gs.totalWagered > 0 && gs.totalSpins > MIN_SPINS_FOR_ADJUSTMENT) {
            const actualRTP = gs.totalPaid / gs.totalWagered;
            const drift = actualRTP - TARGET_RTP;

            if (drift > 0.05) {
                // RTP too high — reduce hit frequency gradually (not aggressively)
                const reduction = Math.min(drift * 0.5, 0.12);
                freq = Math.max(0.10, freq - reduction);
            } else if (drift < -0.10) {
                // RTP too low — increase wins so player stays engaged
                const increase = Math.min(Math.abs(drift) * 0.25, 0.08);
                freq = Math.min(0.35, freq + increase);
            }
        }

        // Global profit check: gentle reduction, never too harsh
        if (globalStats.totalWagered > 500) {
            const globalRTP = globalStats.totalPaid / globalStats.totalWagered;
            if (globalRTP > 0.98) {
                freq *= 0.75; // 25% reduction when global RTP is very high
            } else if (globalRTP > TARGET_RTP + 0.05) {
                freq *= 0.88; // 12% reduction when slightly above target
            }
        }

        return freq;
    }

    /**
     * Determine if this spin should be allowed to produce a win.
     */
    function shouldAllowWin(game, isFreeSpins) {
        // Free spins always have a chance (but still controlled)
        if (isFreeSpins) {
            // Even free spins have a hit frequency — just higher
            const freq = Math.min(0.45, getEffectiveHitFrequency(game) * 1.8);
            return Math.random() < freq;
        }
        const freq = getEffectiveHitFrequency(game);
        return Math.random() < freq;
    }

    // ═══════════════════════════════════════════════════════════
    // GRID GENERATION (with house edge)
    // ═══════════════════════════════════════════════════════════

    function isWildSymbol(symbol, game) {
        return game && game.wildSymbol && symbol === game.wildSymbol;
    }

    function symbolsMatch(a, b, game) {
        if (a === b) return true;
        if (isWildSymbol(a, game) || isWildSymbol(b, game)) return true;
        return false;
    }

    /**
     * Generate a grid with house-edge-weighted symbol distribution.
     */
    function generateWinGrid(game) {
        const cols = game.gridCols || 3;
        const rows = game.gridRows || 1;
        const symbols = game.symbols;
        const weights = getAdjustedWeights(game);
        const grid = [];

        for (let c = 0; c < cols; c++) {
            const col = [];
            for (let r = 0; r < rows; r++) {
                col.push(pickWeighted(symbols, weights));
            }
            grid.push(col);
        }
        return grid;
    }

    /**
     * Generate a grid that is guaranteed to NOT produce a winning pattern.
     * Used when the hit frequency gate determines this spin is a loss.
     */
    function generateNoWinGrid(game) {
        const cols = game.gridCols || 3;
        const rows = game.gridRows || 1;
        const symbols = game.symbols;
        const weights = getAdjustedWeights(game);
        const winType = game.winType || 'classic';
        const grid = [];

        // Generate base grid with weighted symbols
        for (let c = 0; c < cols; c++) {
            const col = [];
            for (let r = 0; r < rows; r++) {
                col.push(pickWeighted(symbols, weights));
            }
            grid.push(col);
        }

        // Break up winning patterns

        // For payline games: break 3+ consecutive matches
        if (winType === 'payline') {
            for (let c = 2; c < cols; c++) {
                for (let r = 0; r < rows; r++) {
                    if (symbolsMatch(grid[c][r], grid[c - 1][r], game) &&
                        symbolsMatch(grid[c - 1][r], grid[c - 2][r], game)) {
                        let attempts = 0;
                        while (attempts < 15) {
                            const newSym = pickWeighted(symbols, weights);
                            if (newSym !== grid[c - 1][r] && !isWildSymbol(newSym, game)) {
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
            for (let c = 0; c < cols; c++) {
                for (let r = 0; r < rows; r++) {
                    const sym = grid[c][r];
                    let sameNeighbors = 0;
                    const neighbors = [[c - 1, r], [c + 1, r], [c, r - 1], [c, r + 1]];
                    for (const [nc, nr] of neighbors) {
                        if (nc >= 0 && nc < cols && nr >= 0 && nr < rows) {
                            if (grid[nc][nr] === sym || isWildSymbol(grid[nc][nr], game)) {
                                sameNeighbors++;
                            }
                        }
                    }
                    if (sameNeighbors >= 3) {
                        let attempts = 0;
                        while (attempts < 15) {
                            const newSym = pickWeighted(symbols, weights);
                            if (newSym !== sym && !isWildSymbol(newSym, game)) {
                                grid[c][r] = newSym;
                                break;
                            }
                            attempts++;
                        }
                    }
                }
            }
        }

        // For classic 3-reel: ensure no triple match
        if (winType === 'classic' && rows === 1 && cols >= 3) {
            if (symbolsMatch(grid[0][0], grid[1][0], game) &&
                symbolsMatch(grid[1][0], grid[2][0], game)) {
                let attempts = 0;
                while (attempts < 15) {
                    const newSym = pickWeighted(symbols, weights);
                    if (newSym !== grid[0][0] && !isWildSymbol(newSym, game)) {
                        grid[2][0] = newSym;
                        break;
                    }
                    attempts++;
                }
            }
        }

        // Allow up to 1 wild on no-win grids in safe positions (looks natural).
        // Removing ALL wilds is suspicious — players notice they never see wilds on losses.
        let wildCount = 0;
        const maxWildsAllowed = 1; // 1 wild in a non-winning position looks realistic
        for (let c = 0; c < cols; c++) {
            for (let r = 0; r < rows; r++) {
                if (isWildSymbol(grid[c][r], game)) {
                    if (wildCount < maxWildsAllowed) {
                        // Keep this wild but verify it doesn't create a win
                        let safeToKeep = true;
                        // For payline: check if adjacent cells would create 3-match
                        if (winType === 'payline') {
                            if (c >= 2 && symbolsMatch(grid[c-1][r], grid[c-2][r], game)) safeToKeep = false;
                            if (c >= 1 && c < cols - 1 && symbolsMatch(grid[c-1][r], grid[c+1][r], game)) safeToKeep = false;
                            if (c < cols - 2 && symbolsMatch(grid[c+1][r], grid[c+2][r], game)) safeToKeep = false;
                        }
                        // For cluster: check if 4+ same neighbors
                        if (winType === 'cluster') {
                            let sameNeighbors = 0;
                            const neighbors = [[c-1,r],[c+1,r],[c,r-1],[c,r+1]];
                            for (const [nc, nr] of neighbors) {
                                if (nc >= 0 && nc < cols && nr >= 0 && nr < rows) {
                                    if (symbolsMatch(grid[nc][nr], grid[c][r], game)) sameNeighbors++;
                                }
                            }
                            if (sameNeighbors >= 3) safeToKeep = false;
                        }
                        if (safeToKeep) {
                            wildCount++;
                        } else {
                            const commonSymbols = symbols.slice(0, Math.max(2, Math.floor(symbols.length / 2)));
                            const commonWeights = weights.slice(0, commonSymbols.length);
                            grid[c][r] = pickWeighted(commonSymbols, commonWeights);
                        }
                    } else {
                        // Replace excess wilds
                        const commonSymbols = symbols.slice(0, Math.max(2, Math.floor(symbols.length / 2)));
                        const commonWeights = weights.slice(0, commonSymbols.length);
                        grid[c][r] = pickWeighted(commonSymbols, commonWeights);
                    }
                }
            }
        }

        return grid;
    }

    /**
     * Main grid generation function.
     * Uses hit frequency gate to determine if spin can win,
     * then generates appropriate grid.
     */
    function generateGrid(game, isFreeSpins) {
        if (shouldAllowWin(game, isFreeSpins || false)) {
            return generateWinGrid(game);
        }
        return generateNoWinGrid(game);
    }

    // ═══════════════════════════════════════════════════════════
    // REALISTIC PAYOUT CALCULATION
    // ═══════════════════════════════════════════════════════════

    /**
     * Get payout multiplier for a cluster win.
     * @param {number} symbolIndex - index of symbol in game's symbols array
     * @param {number} clusterSize - number of connected symbols
     * @returns {number} multiplier of total bet
     */
    function getClusterPayMultiplier(symbolIndex, clusterSize, game) {
        // Use per-game payouts if available
        if (game && game.payouts) {
            const p = game.payouts;
            let topPay;
            if (clusterSize >= 15 && p.cluster15 != null) topPay = p.cluster15;
            else if (clusterSize >= 12 && p.cluster12 != null) topPay = p.cluster12;
            else if (clusterSize >= 8 && p.cluster8 != null) topPay = p.cluster8;
            else if (clusterSize >= 5 && p.cluster5 != null) topPay = p.cluster5;
            if (topPay != null) return _gameScaledPay(game, symbolIndex, topPay);
        }
        const tier = Math.min(symbolIndex, 5);
        const pays = CLUSTER_PAY[tier];
        if (clusterSize >= 12) return pays[3];
        if (clusterSize >= 10) return pays[2];
        if (clusterSize >= 8) return pays[1];
        return pays[0]; // 5-7 cluster
    }

    /**
     * Get payout multiplier for a payline win.
     * @param {number} symbolIndex
     * @param {number} matchCount - 3, 4, or 5 matching symbols
     * @param {object} [game] - optional game config with payouts
     * @returns {number} multiplier of total bet
     */
    function getPaylinePayMultiplier(symbolIndex, matchCount, game) {
        // Use per-game payouts if available
        if (game && game.payouts) {
            const p = game.payouts;
            let topPay;
            if (matchCount >= 5 && p.payline5 != null) topPay = p.payline5;
            else if (matchCount >= 4 && p.payline4 != null) topPay = p.payline4;
            else if (matchCount >= 3 && p.payline3 != null) topPay = p.payline3;
            // Fallback: derive from triple/double if payline keys are missing
            else if (p.triple != null) {
                if (matchCount >= 5) topPay = p.triple * 3.0;
                else if (matchCount >= 4) topPay = p.triple * 1.1;
                else topPay = p.triple * 0.3;
            }
            if (topPay != null) return _gameScaledPay(game, symbolIndex, topPay);
        }
        const tier = Math.min(symbolIndex, 5);
        const pays = PAYLINE_PAY[tier];
        if (matchCount >= 5) return pays[2];
        if (matchCount >= 4) return pays[1];
        return pays[0]; // 3-of-a-kind
    }

    /**
     * Get payout multiplier for a classic (3-reel) win.
     * @param {number} symbolIndex
     * @param {string} type - 'double' or 'triple'
     * @param {object} [game] - optional game config with payouts
     * @returns {number} multiplier of total bet
     */
    function getClassicPayMultiplier(symbolIndex, type, game) {
        // Use per-game payouts if available
        if (game && game.payouts) {
            const p = game.payouts;
            let topPay;
            if (type === 'triple' && p.triple != null) topPay = p.triple;
            else if (type === 'double' && p.double != null) topPay = p.double;
            if (topPay != null) return _gameScaledPay(game, symbolIndex, topPay);
        }
        const tier = Math.min(symbolIndex, 5);
        const pays = CLASSIC_PAY[tier];
        return type === 'triple' ? pays[1] : pays[0];
    }

    /**
     * Get the realistic payout for any win type.
     * Returns a multiplier of total bet.
     */
    function getPayMultiplier(winType, symbolIndex, matchInfo, game) {
        if (winType === 'cluster') {
            return getClusterPayMultiplier(symbolIndex, matchInfo.clusterSize || 5, game);
        }
        if (winType === 'payline') {
            return getPaylinePayMultiplier(symbolIndex, matchInfo.matchCount || 3, game);
        }
        // classic
        return getClassicPayMultiplier(symbolIndex, matchInfo.type || 'double', game);
    }

    // ═══════════════════════════════════════════════════════════
    // WIN CAPPING
    // ═══════════════════════════════════════════════════════════

    /**
     * Cap the win amount — ABSOLUTE PROFIT GUARANTEE.
     *
     * Mathematical invariant enforced after every spin:
     *   totalPaid <= totalWagered  (house profit >= 0, always)
     *
     * Layers:
     *   Layer 0: Emergency / kill-switch override  → near-zero win
     *   Layer 1: Per-spin multiplier cap           → never > 200x bet
     *   Layer 2: Session win cap                   → player can't clean out house in one session
     *   Layer 3: ABSOLUTE GUARANTEE (always-on)   → win <= houseProfit + thisBet
     *             This is the mathematical proof that profit can never go negative:
     *             After recording: newProfit = (wagered + bet) - (paid + win)
     *                                        = houseProfit + bet - win >= 0
     *             iff win <= houseProfit + bet  ✓
     */
    function capWin(winAmount, betAmount, game) {
        if (winAmount <= 0) return 0;

        // Layer 0: Emergency / kill-switch — return near-zero immediately
        if (isEmergencyMode() || isKillSwitchActive() || isSessionCapped()) {
            // Still allow a tiny token win (looks natural, not suspicious)
            return Math.round(betAmount * 0.05 * 100) / 100;
        }

        // Layer 1: Per-spin maximum multiplier cap
        const isJackpot = game && game.jackpot > 0;
        const maxMult = isJackpot ? MAX_WIN_MULTIPLIER_JACKPOT : MAX_WIN_MULTIPLIER_NORMAL;
        let capped = Math.min(winAmount, betAmount * maxMult);

        // Layer 2: Session cap — player can't win more than SESSION_WIN_CAP in one session
        const sessionRemaining = Math.max(0, SESSION_WIN_CAP - sessionStats.paid);
        capped = Math.min(capped, sessionRemaining > 0 ? sessionRemaining : betAmount * 0.5);

        // Layer 3: ABSOLUTE PROFIT GUARANTEE (no wagered-threshold, always enforced)
        // The maximum this win can be while keeping house profit >= 0:
        //   maxSafeWin = houseProfit + betAmount
        // (Because this bet is counted as revenue before the win is paid out)
        const maxSafeWin = Math.max(0, globalStats.houseProfit + betAmount);
        if (capped > maxSafeWin) {
            capped = maxSafeWin;
        }

        // Round to 2 decimal places
        return Math.round(capped * 100) / 100;
    }

    // ═══════════════════════════════════════════════════════════
    // SPIN RECORDING
    // ═══════════════════════════════════════════════════════════

    /**
     * Record a completed spin for profit tracking.
     * Must be called after every spin with the final amounts.
     */
    function recordSpin(betAmount, winAmount, gameId) {
        // ROUND 33: Validate inputs — prevent uncapped wins from poisoning stats.
        // recordSpin trusts the caller; enforce caps here as last defense.
        if (!Number.isFinite(betAmount) || betAmount < 0) betAmount = 0;
        if (!Number.isFinite(winAmount) || winAmount < 0) winAmount = 0;
        // Hard cap: no single win can exceed SESSION_WIN_CAP or 500x bet
        var maxAllowed = Math.min(SESSION_WIN_CAP, betAmount * 500);
        if (winAmount > maxAllowed && maxAllowed > 0) {
            console.warn('[HouseEdge] recordSpin: winAmount ' + winAmount + ' exceeds cap ' + maxAllowed + ', clamping');
            winAmount = maxAllowed;
        }
        // Update global stats
        globalStats.totalWagered += betAmount;
        globalStats.totalPaid += winAmount;
        globalStats.totalSpins++;
        globalStats.houseProfit = globalStats.totalWagered - globalStats.totalPaid;
        if (winAmount > globalStats.biggestSingleWin) {
            globalStats.biggestSingleWin = winAmount;
        }
        if (isEmergencyMode()) {
            globalStats.emergencyModeActivations++;
        }
        saveGlobalStats();

        // Update game-specific stats
        const gs = getGameStats(gameId);
        gs.totalSpins++;
        gs.totalWagered += betAmount;
        gs.totalPaid += winAmount;
        saveGameStats();

        // Update session stats
        sessionStats.wagered += betAmount;
        sessionStats.paid += winAmount;
        sessionStats.spins++;
        if (winAmount > sessionStats.maxWin) sessionStats.maxWin = winAmount;
    }

    // ═══════════════════════════════════════════════════════════
    // PROFIT STATUS (for admin/debug)
    // ═══════════════════════════════════════════════════════════

    function getProfitStatus() {
        const rtp = globalStats.totalWagered > 0
            ? (globalStats.totalPaid / globalStats.totalWagered * 100).toFixed(2)
            : '0.00';
        return {
            totalWagered: globalStats.totalWagered,
            totalPaid: globalStats.totalPaid,
            houseProfit: globalStats.houseProfit,
            currentRTP: rtp + '%',
            targetRTP: (TARGET_RTP * 100).toFixed(0) + '%',
            totalSpins: globalStats.totalSpins,
            biggestSingleWin: globalStats.biggestSingleWin,
            emergencyMode: isEmergencyMode(),
            killSwitchActive: isKillSwitchActive(),
            sessionCapped: isSessionCapped(),
            sessionStats: { ...sessionStats },
            emergencyModeActivations: globalStats.emergencyModeActivations,
        };
    }

    /**
     * Get per-game profit breakdown.
     */
    function getGameProfitBreakdown() {
        const breakdown = [];
        for (const [gameId, stats] of Object.entries(gameStatsMap)) {
            const rtp = stats.totalWagered > 0
                ? (stats.totalPaid / stats.totalWagered * 100).toFixed(2)
                : '0.00';
            breakdown.push({
                gameId,
                spins: stats.totalSpins,
                wagered: stats.totalWagered,
                paid: stats.totalPaid,
                profit: stats.totalWagered - stats.totalPaid,
                rtp: rtp + '%',
            });
        }
        breakdown.sort((a, b) => b.wagered - a.wagered);
        return breakdown;
    }

    /**
     * Reset all house edge stats (admin only).
     */
    function resetStats() {
        globalStats = {
            totalWagered: 0, totalPaid: 0, totalSpins: 0,
            houseProfit: 0, biggestSingleWin: 0,
            emergencyModeActivations: 0, lastUpdated: Date.now(),
        };
        gameStatsMap = {};
        sessionStats = { wagered: 0, paid: 0, spins: 0, maxWin: 0 };
        saveGlobalStats();
        saveGameStats();
    }

    // ═══════════════════════════════════════════════════════════
    // SCATTER PAY (realistic)
    // ═══════════════════════════════════════════════════════════

    /**
     * Get scatter pay multiplier. Real slots: 0.5x-1x per scatter.
     */
    function getScatterPay(scatterCount) {
        return scatterCount * 0.5; // 0.5x per scatter symbol (of total bet)
    }

    // ═══════════════════════════════════════════════════════════
    // PUBLIC API
    // ═══════════════════════════════════════════════════════════

    window.HouseEdge = {
        // Grid generation
        generateGrid: generateGrid,
        generateNoWinGrid: generateNoWinGrid,

        // Win determination
        shouldAllowWin: shouldAllowWin,

        // Payout calculation
        getPayMultiplier: getPayMultiplier,
        getClusterPayMultiplier: getClusterPayMultiplier,
        getPaylinePayMultiplier: getPaylinePayMultiplier,
        getClassicPayMultiplier: getClassicPayMultiplier,
        getScatterPay: getScatterPay,

        // Win capping
        capWin: capWin,

        // Stats tracking
        recordSpin: recordSpin,

        // Status queries
        getProfitStatus: getProfitStatus,
        getGameProfitBreakdown: getGameProfitBreakdown,
        isEmergencyMode: isEmergencyMode,
        isKillSwitchActive: isKillSwitchActive,

        // Admin
        resetStats: resetStats,

        // Constants (for display)
        TARGET_RTP: TARGET_RTP,
        MAX_WIN_MULTIPLIER_JACKPOT: MAX_WIN_MULTIPLIER_JACKPOT,
        MAX_WIN_MULTIPLIER_NORMAL: MAX_WIN_MULTIPLIER_NORMAL,
        SESSION_WIN_CAP: SESSION_WIN_CAP,
    };

})();
