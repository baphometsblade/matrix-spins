// ═══════════════════════════════════════════════════════
// SPIN-ENGINE MODULE
// ═══════════════════════════════════════════════════════


        // Get the current game's symbol list
        function getGameSymbols(game) {
            return (game && game.symbols) ? game.symbols : SLOT_SYMBOLS;
        }


        // ═══ Grid Helpers ═══
        function getGridCols(game) { return (game && game.gridCols) || 3; }

        function getGridRows(game) { return (game && game.gridRows) || 1; }

        function getWinType(game) { return (game && game.winType) || 'classic'; }

        function isMultiRow(game) { return getGridRows(game) > 1; }


        // Create empty 2D grid [cols][rows]
        function createEmptyGrid(cols, rows) {
            return Array.from({ length: cols }, () => Array(rows).fill(null));
        }


        // Generate random grid for a game
        function generateRandomGrid(game) {
            const cols = getGridCols(game);
            const rows = getGridRows(game);
            const syms = getGameSymbols(game);
            const grid = createEmptyGrid(cols, rows);
            for (let c = 0; c < cols; c++) {
                for (let r = 0; r < rows; r++) {
                    grid[c][r] = syms[Math.floor(getRandomNumber() * syms.length)];
                }
            }
            return grid;
        }


        // Flatten grid to 1D array (for backwards compatibility with classic 3-reel)
        function flattenGrid(grid) {
            if (!grid) return [];
            // For classic: just first row across all cols
            return grid.map(col => col[0]);
        }


        // Build grid from 1D symbol array (classic 3-reel compat)
        function gridFrom1D(symbols, game) {
            const cols = getGridCols(game);
            const rows = getGridRows(game);
            if (rows === 1 || !isMultiRow(game)) {
                // Classic: each symbol = one column, one row
                return symbols.map(s => [s]);
            }
            // Already a grid scenario — shouldn't reach here from 1D
            return symbols.map(s => [s]);
        }


        // Generate spin result as 2D grid
        function generateSpinResult(game, isFreeSpins) {
            if (forcedSpinQueue.length > 0) {
                const forced = [...forcedSpinQueue.shift()];
                const cols = getGridCols(game);
                const rows = getGridRows(game);

                // If forced array matches cols (1D) — fill grid with those symbols
                if (rows > 1) {
                    const grid = createEmptyGrid(cols, rows);
                    for (let c = 0; c < cols; c++) {
                        const sym = forced[c % forced.length];
                        for (let r = 0; r < rows; r++) {
                            grid[c][r] = sym;
                        }
                    }
                    return grid;
                }
                return gridFrom1D(forced, game);
            }
            // Use House Edge engine for weighted grid generation with profit protection
            if (window.HouseEdge) {
                return window.HouseEdge.generateGrid(game, isFreeSpins || false);
            }
            return generateRandomGrid(game);
        }


        // Count all symbols in grid (for scatter detection on multi-row)
        function countSymbolInGrid(grid, symbol) {
            let count = 0;
            for (const col of grid) {
                for (const s of col) {
                    if (s === symbol) count++;
                }
            }
            return count;
        }


        // Count wilds in grid
        function countWildsInGrid(grid, game) {
            if (!game || !game.wildSymbol) return 0;
            return countSymbolInGrid(grid, game.wildSymbol);
        }


        function queueForcedSpin(symbolsInput) {
            const outcome = normalizeOutcomeSymbols(symbolsInput);
            if (!outcome) return null;
            forcedSpinQueue.push(outcome);
            return outcome;
        }


        function queueForcedOutcome(type, preferredSymbol) {
            const outcome = buildForcedOutcome(type, preferredSymbol);
            if (!outcome) return null;
            forcedSpinQueue.push(outcome);
            return outcome;
        }


        function consumeSpinResult(isFreeSpins) {
            // Use grid-aware generation with house edge
            return generateSpinResult(currentGame, isFreeSpins || false);
        }


        function getRandomSymbol() {
            const syms = getGameSymbols(currentGame);
            return syms[Math.floor(getRandomNumber() * syms.length)];
        }


        // ═══ Wild Symbol Helpers ═══
        function isWild(symbol, game) {
            return game && game.wildSymbol && symbol === game.wildSymbol;
        }


        function isScatter(symbol, game) {
            return game && game.scatterSymbol && symbol === game.scatterSymbol;
        }


        function countScatters(symbols, game) {
            if (!game || !game.scatterSymbol) return 0;
            return symbols.filter(s => s === game.scatterSymbol).length;
        }


        function countWilds(symbols, game) {
            if (!game || !game.wildSymbol) return 0;
            return symbols.filter(s => s === game.wildSymbol).length;
        }


        // Check if symbols match accounting for wild substitution
        function symbolsMatchWithWild(a, b, game) {
            if (a === b) return true;
            if (isWild(a, game) || isWild(b, game)) return true;
            return false;
        }


        // Get the "effective" matching symbol from a set (ignoring wilds)
        function getEffectiveSymbol(symbols, game) {
            for (const s of symbols) {
                if (!isWild(s, game)) return s;
            }
            return symbols[0]; // all wilds
        }


        // Check for triple match with wild support
        function isTripleMatch(symbols, game) {
            return symbolsMatchWithWild(symbols[0], symbols[1], game) &&
                   symbolsMatchWithWild(symbols[1], symbols[2], game) &&
                   symbolsMatchWithWild(symbols[0], symbols[2], game);
        }


        // Check for double match with wild support, returns matching pair indices
        function getDoubleMatch(symbols, game) {
            if (symbolsMatchWithWild(symbols[0], symbols[1], game)) return [0, 1];
            if (symbolsMatchWithWild(symbols[1], symbols[2], game)) return [1, 2];
            if (symbolsMatchWithWild(symbols[0], symbols[2], game)) return [0, 2];
            return null;
        }
