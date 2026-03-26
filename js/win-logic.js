// ═══════════════════════════════════════════════════════
// WIN-LOGIC MODULE
// ═══════════════════════════════════════════════════════

        // ── Comeback Bonus State ──
        var _comebackLossStreak = 0;
        var _comebackCheckInFlight = false;

        // ═══ Payline Definitions ═══
        // Standard paylines for different grid configs
        // Each payline is an array of row indices, one per column
        function getPaylines(game) {
            const cols = getGridCols(game);
            const rows = getGridRows(game);

            if (rows === 1) {
                // Classic 1-row: just the single row
                return [[0, 0, 0]];
            }

            if (rows === 3 && cols === 3) {
                // Classic 3×3 (Fire Joker style): horizontal + diagonal + V shapes
                return [
                    [0, 0, 0], // top
                    [1, 1, 1], // middle
                    [2, 2, 2], // bottom
                    [0, 1, 2], // diagonal down
                    [2, 1, 0], // diagonal up
                ];
            }

            if (rows === 3 && cols === 5) {
                // Standard 5×3 (20 paylines — Book of Dead / Wolf Gold / Starburst / Big Bass / Gonzo's)
                return [
                    [1, 1, 1, 1, 1], // middle
                    [0, 0, 0, 0, 0], // top
                    [2, 2, 2, 2, 2], // bottom
                    [0, 1, 2, 1, 0], // V shape
                    [2, 1, 0, 1, 2], // inverted V
                    [0, 0, 1, 0, 0], // slight dip
                    [2, 2, 1, 2, 2], // slight rise
                    [1, 0, 0, 0, 1], // U shape
                    [1, 2, 2, 2, 1], // inverted U
                    [0, 1, 1, 1, 0], // flat top dip
                    [2, 1, 1, 1, 2], // flat bottom rise
                    [1, 0, 1, 0, 1], // zigzag high
                    [1, 2, 1, 2, 1], // zigzag low
                    [0, 1, 0, 1, 0], // wave high
                    [2, 1, 2, 1, 2], // wave low
                    [1, 1, 0, 1, 1], // center dip
                    [1, 1, 2, 1, 1], // center bump
                    [0, 0, 1, 2, 2], // descending stair
                    [2, 2, 1, 0, 0], // ascending stair
                    [0, 2, 0, 2, 0], // zigzag extreme
                ];
            }

            if (rows === 4 && cols === 5) {
                // 5×4 (Black Bull style — 40 paylines)
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

            // Fallback: generate basic paylines
            const lines = [];
            for (let r = 0; r < rows; r++) {
                lines.push(Array(cols).fill(r));
            }
            return lines;
        }


        // ═══ Cluster Pay Detection ═══
        // Flood-fill to find connected clusters of matching symbols
        function findClusters(grid, game) {
            const cols = grid.length;
            const rows = grid[0].length;
            const visited = createEmptyGrid(cols, rows);
            const clusters = [];

            for (let c = 0; c < cols; c++) {
                for (let r = 0; r < rows; r++) {
                    if (visited[c][r]) continue;
                    const symbol = grid[c][r];
                    if (!symbol) continue;

                    // BFS to find cluster
                    const cluster = [];
                    const queue = [[c, r]];
                    visited[c][r] = true;

                    while (queue.length > 0) {
                        const [cc, cr] = queue.shift();
                        cluster.push([cc, cr]);

                        // Check 4-directional neighbors
                        const neighbors = [[cc-1, cr], [cc+1, cr], [cc, cr-1], [cc, cr+1]];
                        for (const [nc, nr] of neighbors) {
                            if (nc < 0 || nc >= cols || nr < 0 || nr >= rows) continue;
                            if (visited[nc][nr]) continue;
                            const nSym = grid[nc][nr];
                            if (nSym === symbol || isWild(nSym, game) || isWild(symbol, game)) {
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


        // ═══ Payline Win Detection ═══
        function checkPaylineWins(grid, game) {
            const paylines = getPaylines(game);
            const cols = getGridCols(game);
            const wins = [];

            for (let lineIdx = 0; lineIdx < paylines.length; lineIdx++) {
                const line = paylines[lineIdx];
                // Get symbols on this payline
                const lineSymbols = [];
                for (let c = 0; c < Math.min(cols, line.length); c++) {
                    const rowIdx = line[c];
                    if (!grid[c] || rowIdx < 0 || rowIdx >= grid[c].length) continue;
                    lineSymbols.push(grid[c][rowIdx]);
                }

                // Check for left-to-right consecutive matches
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

                if (matchCount >= PAYLINE_MIN_MATCH_COUNT) {
                    wins.push({
                        lineIndex: lineIdx,
                        line,
                        matchCount,
                        symbol: effectiveSym || firstSym,
                        cells: line.slice(0, matchCount).map((row, col) => [col, row])
                    });
                }
            }

            return wins;
        }


        // ═══ Bonus Mechanic Handlers ═══

        // Apply game-specific bonus multiplier to win
        function applyBonusMultiplier(baseWin, game) {
            let multiplier = freeSpinsMultiplier;
            let bonusText = '';

            if (freeSpinsActive && game.bonusType === 'random_multiplier') {
                // Sweet Bonanza: random bomb multiplier
                const range = game.randomMultiplierRange || [2, 3, 5];
                const bombMult = range[Math.floor(getRandomNumber() * range.length)];
                multiplier *= bombMult;
                bonusText = ` (${bombMult}x Bomb!)`;
                showBonusEffect(`${bombMult}x MULTIPLIER!`, game.accentColor);
            } else if (!freeSpinsActive && game.bonusType === 'random_multiplier') {
                // Base game: apply a small random multiplier on wins (1x-3x)
                const baseMultChoices = [1, 1, 1, 2, 2, 3];
                multiplier = baseMultChoices[Math.floor(Math.random() * baseMultChoices.length)];
                if (multiplier > 1) bonusText = '×' + multiplier + ' Random!';
            }

            if (freeSpinsActive && game.bonusType === 'zeus_multiplier') {
                // Gates of Olympus: Zeus drops a multiplier on wins
                const zMults = game.zeusMultipliers || [2, 3, 5];
                const zeusMult = zMults[Math.floor(getRandomNumber() * zMults.length)];
                multiplier *= zeusMult;
                bonusText = ` (Zeus ${zeusMult}x!)`;
                showBonusEffect(`ZEUS ${zeusMult}x!`, '#f5c842');
            } else if (!freeSpinsActive && game.bonusType === 'zeus_multiplier') {
                // Base game: 20% chance of 2x-4x divine multiplier
                if (Math.random() < 0.20) {
                    multiplier = 2 + Math.floor(Math.random() * 3); // 2, 3, or 4
                    bonusText = '⚡ ×' + multiplier + ' Zeus!';
                }
            }

            if (freeSpinsActive && (game.bonusType === 'tumble' || game.bonusType === 'avalanche')) {
                const mults = game.tumbleMultipliers || game.avalancheMultipliers || [1, 2, 3, 5];
                const idx = Math.min(freeSpinsCascadeLevel, mults.length - 1);
                multiplier = mults[idx];
                freeSpinsCascadeLevel++;
                bonusText = ` (Cascade ${multiplier}x!)`;
                if (multiplier > 1) showBonusEffect(`CASCADE ${multiplier}x!`, game.accentColor);
            } else if (!freeSpinsActive && (game.bonusType === 'tumble' || game.bonusType === 'avalanche')) {
                // Base game: use the running tumble chain multiplier if > 1
                if (typeof window._tumbleChain !== 'undefined' && window._tumbleChain > 1) {
                    multiplier = window._tumbleChain;
                    bonusText = '🔗 Chain ×' + multiplier;
                }
            }

            return { amount: Math.round(baseWin * multiplier * 100) / 100, multiplier, bonusText };
        }


        // Get money value for money-type symbols (Black Bull, Big Bass)
        function getMoneyValue(symbol, game) {
            const moneySyms = game.moneySymbols || game.fishSymbols || [];
            if (!moneySyms.includes(symbol)) return 0;
            // Realistic money values: small fractions of bet (real Hold & Win values)
            const values = [0.5, 1, 1.5, 2, 3, 5];
            return currentBet * values[Math.floor(getRandomNumber() * values.length)] * 0.05;
        }


        // Fire Joker wheel multiplier
        function getWheelMultiplier(game) {
            const mults = game.wheelMultipliers || [2, 3, 5];
            return mults[Math.floor(getRandomNumber() * mults.length)];
        }


        // ═══ Expanding Symbol Handler ═══
        // Book of Dead style: picks a random symbol, expands it to fill entire
        // reels where it appears, then re-evaluates paylines with the expanded grid.
        function applyExpandingSymbol(grid, game) {
            if (!grid) return { grid: grid, extraWin: 0, expandedSymbol: null };
            var cols = getGridCols(game);
            var rows = getGridRows(game);

            // Pick a random non-wild, non-scatter symbol from the grid
            var candidates = [];
            for (var c = 0; c < cols; c++) {
                for (var r = 0; r < rows; r++) {
                    if (!grid[c]) continue;
                    var sym = grid[c][r];
                    if (sym && !isWild(sym, game) && !isScatter(sym, game)) {
                        if (candidates.indexOf(sym) === -1) candidates.push(sym);
                    }
                }
            }
            if (candidates.length === 0) return { grid: grid, extraWin: 0, expandedSymbol: null };

            var expandSym = candidates[Math.floor(getRandomNumber() * candidates.length)];

            // Find which reels contain the expanding symbol
            var reelsWithSymbol = [];
            for (var c2 = 0; c2 < cols; c2++) {
                for (var r2 = 0; r2 < rows; r2++) {
                    if (grid[c2] && grid[c2][r2] === expandSym) {
                        if (reelsWithSymbol.indexOf(c2) === -1) reelsWithSymbol.push(c2);
                        break;
                    }
                }
            }

            if (reelsWithSymbol.length === 0) return { grid: grid, extraWin: 0, expandedSymbol: expandSym };

            // Create expanded grid — fill entire reels where the symbol appeared
            var expandedGrid = [];
            for (var c3 = 0; c3 < cols; c3++) {
                expandedGrid[c3] = [];
                for (var r3 = 0; r3 < rows; r3++) {
                    if (reelsWithSymbol.indexOf(c3) !== -1) {
                        expandedGrid[c3][r3] = expandSym;
                    } else {
                        expandedGrid[c3][r3] = grid[c3] ? grid[c3][r3] : null;
                    }
                }
            }

            // Re-evaluate paylines with the expanded grid
            var expandedWins = checkPaylineWins(expandedGrid, game);
            var extraWin = 0;
            for (var w = 0; w < expandedWins.length; w++) {
                var eWin = expandedWins[w];
                var symIdx = game.symbols.indexOf(eWin.symbol);
                var payMultiplier;
                if (window.HouseEdge) {
                    payMultiplier = window.HouseEdge.getPaylinePayMultiplier(
                        symIdx >= 0 ? symIdx : 0, eWin.matchCount, game
                    );
                } else {
                    if (eWin.matchCount >= 5) payMultiplier = 0.40;
                    else if (eWin.matchCount >= 4) payMultiplier = 0.12;
                    else payMultiplier = 0.04;
                }
                extraWin += currentBet * payMultiplier;
            }

            // Highlight expanded reel cells
            for (var c4 = 0; c4 < reelsWithSymbol.length; c4++) {
                for (var r4 = 0; r4 < rows; r4++) {
                    var cell = document.getElementById('reel_' + reelsWithSymbol[c4] + '_' + r4);
                    if (cell) {
                        cell.classList.add('reel-wild-expand');
                        cell.classList.add('reel-win-glow');
                    }
                }
            }

            return { grid: expandedGrid, extraWin: Math.round(extraWin * 100) / 100, expandedSymbol: expandSym };
        }


        // ═══ Multiplier Wilds Handler ═══
        // Wilds carry random multipliers (2x 50%, 3x 35%, 5x 15%).
        // When a wild is part of a winning payline, the highest multiplier applies.
        function applyMultiplierWilds(grid, game, paylineWins) {
            if (!grid || !paylineWins || paylineWins.length === 0) return 0;

            var totalBonus = 0;
            var highestMult = 1;
            for (var w = 0; w < paylineWins.length; w++) {
                var pWin = paylineWins[w];
                var lineMult = 1;

                // Check each cell in the winning line for wilds
                for (var i = 0; i < pWin.cells.length; i++) {
                    var col = pWin.cells[i][0];
                    var row = pWin.cells[i][1];
                    if (grid[col] && isWild(grid[col][row], game)) {
                        // Assign random multiplier: 2x (50%), 3x (35%), 5x (15%)
                        var roll = getRandomNumber();
                        var wildMult;
                        if (roll < 0.50) wildMult = 2;
                        else if (roll < 0.85) wildMult = 3;
                        else wildMult = 5;

                        if (wildMult > lineMult) lineMult = wildMult;

                        // Visual highlight on the wild cell
                        var cell = document.getElementById('reel_' + col + '_' + row);
                        if (cell) {
                            cell.classList.add('reel-wild-glow');
                        }
                    }
                }

                if (lineMult > 1) {
                    // Calculate the base line win to determine the bonus portion
                    var symIdx = game.symbols.indexOf(pWin.symbol);
                    var payMultiplier;
                    if (window.HouseEdge) {
                        payMultiplier = window.HouseEdge.getPaylinePayMultiplier(
                            symIdx >= 0 ? symIdx : 0, pWin.matchCount, game
                        );
                    } else {
                        if (pWin.matchCount >= 5) payMultiplier = 0.40;
                        else if (pWin.matchCount >= 4) payMultiplier = 0.12;
                        else payMultiplier = 0.04;
                    }
                    var baseLineWin = currentBet * payMultiplier;
                    // Bonus is the extra from the multiplier (subtract the 1x already counted)
                    totalBonus += baseLineWin * (lineMult - 1);
                    if (lineMult > highestMult) highestMult = lineMult;
                }
            }

            if (totalBonus > 0) {
                showBonusEffect(highestMult + 'x WILD MULTIPLIER!', '#ff6d00');
            }

            return Math.round(totalBonus * 100) / 100;
        }


        // ═══ Mystery Stacks Handler ═══
        // Picks a random non-wild symbol, replaces an entire column with
        // the chosen symbol (mystery reveal), then re-evaluates paylines.
        function applyMysteryStacksWinLogic(grid, game) {
            if (!grid) return { grid: grid, extraWin: 0, mysterySymbol: null };
            var cols = getGridCols(game);
            var rows = getGridRows(game);

            // Pick a random non-wild, non-scatter symbol to be the mystery reveal
            var regularSyms = [];
            for (var s = 0; s < game.symbols.length; s++) {
                var sym = game.symbols[s];
                if (!isWild(sym, game) && !isScatter(sym, game)) {
                    regularSyms.push(sym);
                }
            }
            if (regularSyms.length === 0) return { grid: grid, extraWin: 0, mysterySymbol: null };

            var mysterySymbol = regularSyms[Math.floor(getRandomNumber() * regularSyms.length)];

            // Pick a random column to be the mystery stack column
            var mysteryCol = Math.floor(getRandomNumber() * cols);

            // Build the modified grid — fill the mystery column with the chosen symbol
            var modifiedGrid = [];
            for (var c = 0; c < cols; c++) {
                modifiedGrid[c] = [];
                for (var r = 0; r < rows; r++) {
                    if (c === mysteryCol) {
                        modifiedGrid[c][r] = mysterySymbol;
                    } else {
                        modifiedGrid[c][r] = grid[c] ? grid[c][r] : null;
                    }
                }
            }

            // Re-evaluate paylines with the modified grid
            var mysteryWins = checkPaylineWins(modifiedGrid, game);
            var extraWin = 0;
            for (var w = 0; w < mysteryWins.length; w++) {
                var mWin = mysteryWins[w];
                var symIdx = game.symbols.indexOf(mWin.symbol);
                var payMultiplier;
                if (window.HouseEdge) {
                    payMultiplier = window.HouseEdge.getPaylinePayMultiplier(
                        symIdx >= 0 ? symIdx : 0, mWin.matchCount, game
                    );
                } else {
                    if (mWin.matchCount >= 5) payMultiplier = 0.40;
                    else if (mWin.matchCount >= 4) payMultiplier = 0.12;
                    else payMultiplier = 0.04;
                }
                extraWin += currentBet * payMultiplier;
            }

            // Highlight the mystery column
            for (var r2 = 0; r2 < rows; r2++) {
                var cell = document.getElementById('reel_' + mysteryCol + '_' + r2);
                if (cell) {
                    cell.classList.add('reel-win-glow');
                }
            }

            return { grid: modifiedGrid, extraWin: Math.round(extraWin * 100) / 100, mysterySymbol: mysterySymbol };
        }


        // ═══ Stacked Wilds Handler ═══
        // Counts consecutive wilds in each column. If 2+ found, applies a
        // bonus multiplier: 1.5x per stack, capped at 3x total.
        function applyStackedWilds(grid, game, baseWin) {
            if (!grid || baseWin <= 0) return { bonusWin: 0, stackCount: 0, totalMultiplier: 1 };
            var cols = getGridCols(game);
            var rows = getGridRows(game);
            var stackCount = 0;

            for (var c = 0; c < cols; c++) {
                var consecutiveWilds = 0;
                var maxConsecutive = 0;
                for (var r = 0; r < rows; r++) {
                    if (grid[c] && isWild(grid[c][r], game)) {
                        consecutiveWilds++;
                        if (consecutiveWilds > maxConsecutive) maxConsecutive = consecutiveWilds;
                    } else {
                        consecutiveWilds = 0;
                    }
                }
                if (maxConsecutive >= 2) {
                    stackCount++;
                    // Highlight the stacked wilds
                    for (var r2 = 0; r2 < rows; r2++) {
                        if (grid[c] && isWild(grid[c][r2], game)) {
                            var cell = document.getElementById('reel_' + c + '_' + r2);
                            if (cell) {
                                cell.classList.add('reel-wild-glow');
                                cell.classList.add('reel-wild-expand');
                            }
                        }
                    }
                }
            }

            if (stackCount === 0) return { bonusWin: 0, stackCount: 0, totalMultiplier: 1 };

            // 1.5x per stack, capped at 3x total
            var totalMultiplier = Math.min(3, 1 + (stackCount * 0.5));
            var bonusWin = Math.round(baseWin * (totalMultiplier - 1) * 100) / 100;

            showBonusEffect('STACKED WILDS ' + totalMultiplier.toFixed(1) + 'x!', '#a855f7');

            return { bonusWin: bonusWin, stackCount: stackCount, totalMultiplier: totalMultiplier };
        }


        // ═══ Wild Collect Handler ═══
        // Tracks wilds across spins. After collecting 5+ wilds, triggers a bonus
        // round placing extra wilds and re-evaluating for boosted wins.
        var _wildCollectCount = typeof window._wildCollectCount !== 'undefined' ? window._wildCollectCount : 0;
        var WILD_COLLECT_THRESHOLD = 5;

        function applyWildCollectWinLogic(grid, game, baseWin) {
            if (!grid) return { extraWin: 0, triggered: false };
            var cols = getGridCols(game);
            var rows = getGridRows(game);

            // Count wilds in the current grid
            var wildCount = 0;
            for (var c = 0; c < cols; c++) {
                for (var r = 0; r < rows; r++) {
                    if (grid[c] && isWild(grid[c][r], game)) {
                        wildCount++;
                    }
                }
            }

            // Accumulate wild count (persisted on window for cross-spin tracking)
            _wildCollectCount += wildCount;
            window._wildCollectCount = _wildCollectCount;

            // Check if threshold reached
            if (_wildCollectCount < WILD_COLLECT_THRESHOLD) {
                return { extraWin: 0, triggered: false };
            }

            // Threshold reached — trigger bonus: place 2-3 extra wilds in optimal positions
            var extraWildCount = 2 + Math.floor(getRandomNumber() * 2); // 2 or 3
            var emptyPositions = [];
            for (var c2 = 0; c2 < cols; c2++) {
                for (var r2 = 0; r2 < rows; r2++) {
                    if (grid[c2] && !isWild(grid[c2][r2], game) && !isScatter(grid[c2][r2], game)) {
                        emptyPositions.push([c2, r2]);
                    }
                }
            }

            // Place extra wilds
            var placed = 0;
            while (placed < extraWildCount && emptyPositions.length > 0) {
                var idx = Math.floor(getRandomNumber() * emptyPositions.length);
                var pos = emptyPositions.splice(idx, 1)[0];
                grid[pos[0]][pos[1]] = game.wildSymbol;
                placed++;

                // Highlight the bonus wild cell
                var cell = document.getElementById('reel_' + pos[0] + '_' + pos[1]);
                if (cell) {
                    cell.classList.add('reel-wild-glow');
                    cell.classList.add('reel-wild-expand');
                }
            }

            // Re-evaluate paylines with the bonus wilds
            var bonusWins = checkPaylineWins(grid, game);
            var extraWin = 0;
            for (var w = 0; w < bonusWins.length; w++) {
                var bWin = bonusWins[w];
                var symIdx = game.symbols.indexOf(bWin.symbol);
                var payMultiplier;
                if (window.HouseEdge) {
                    payMultiplier = window.HouseEdge.getPaylinePayMultiplier(
                        symIdx >= 0 ? symIdx : 0, bWin.matchCount, game
                    );
                } else {
                    if (bWin.matchCount >= 5) payMultiplier = 0.40;
                    else if (bWin.matchCount >= 4) payMultiplier = 0.12;
                    else payMultiplier = 0.04;
                }
                extraWin += currentBet * payMultiplier;
            }

            // Reset counter after triggering
            _wildCollectCount = 0;
            window._wildCollectCount = 0;

            if (placed > 0) {
                showBonusEffect('WILD COLLECT BONUS! +' + placed + ' WILDS!', '#c6ff00');
            }

            return { extraWin: Math.round(extraWin * 100) / 100, triggered: true };
        }


        // ═══ Win Payline Flash Animation ═══
        function _flashWinLines(winLines) {
            if (!winLines || winLines.length === 0) return;
            var reels = document.getElementById('reels');
            if (!reels) return;

            // Create or reuse canvas overlay
            var canvas = document.getElementById('winLineCanvas');
            if (!canvas) {
                canvas = document.createElement('canvas');
                canvas.id = 'winLineCanvas';
                canvas.style.cssText = 'position:absolute;top:0;left:0;pointer-events:none;z-index:20;border-radius:inherit;';
                if (getComputedStyle(reels).position === 'static') reels.style.position = 'relative';
                reels.appendChild(canvas);
            }

            var rect = reels.getBoundingClientRect();
            canvas.width = rect.width;
            canvas.height = rect.height;
            canvas.style.width = rect.width + 'px';
            canvas.style.height = rect.height + 'px';
            var ctx = canvas.getContext('2d');

            function getCellCenter(col, row) {
                var cell = document.getElementById('reel_' + col + '_' + row);
                if (!cell) return null;
                var cr = cell.getBoundingClientRect();
                return { x: cr.left - rect.left + cr.width / 2, y: cr.top - rect.top + cr.height / 2 };
            }

            var LINE_COLORS = ['#fbbf24','#a78bfa','#34d399','#60a5fa','#f472b6','#fb923c','#e879f9'];

            function drawLines(alpha) {
                ctx.clearRect(0, 0, canvas.width, canvas.height);
                ctx.globalAlpha = alpha;
                winLines.forEach(function(win, idx) {
                    var color = LINE_COLORS[idx % LINE_COLORS.length];
                    var points = win.cells.map(function(pair) { return getCellCenter(pair[0], pair[1]); }).filter(Boolean);
                    if (points.length < 2) return;
                    ctx.beginPath();
                    ctx.moveTo(points[0].x, points[0].y);
                    for (var i = 1; i < points.length; i++) ctx.lineTo(points[i].x, points[i].y);
                    ctx.strokeStyle = color;
                    ctx.lineWidth = 3;
                    ctx.shadowColor = color;
                    ctx.shadowBlur = 14;
                    ctx.lineCap = 'round';
                    ctx.lineJoin = 'round';
                    ctx.stroke();
                    // Draw endpoint dots
                    [points[0], points[points.length - 1]].forEach(function(p) {
                        ctx.beginPath();
                        ctx.arc(p.x, p.y, 5, 0, Math.PI * 2);
                        ctx.fillStyle = color;
                        ctx.fill();
                    });
                });
                ctx.globalAlpha = 1;
                ctx.shadowBlur = 0;
            }

            // Flash sequence: on/off pulses then fade
            var seq = [1, 0, 1, 0, 1, 0.8, 0.5, 0.2, 0];
            var step = 0;
            function tick() {
                if (step >= seq.length) { ctx.clearRect(0, 0, canvas.width, canvas.height); return; }
                drawLines(seq[step]);
                step++;
                setTimeout(tick, step <= 4 ? 160 : 220);
            }
            setTimeout(tick, 80);
        }


        // ═══ Main Win Check — supports classic, payline, and cluster win types ═══
        function checkWin(symbols, game = currentGame) {
            if (!game) return;

            const winType = getWinType(game);
            let grid = currentGrid;
            let winAmount = 0;
            let message = '';
            let isTriple = false;
            let isDouble = false;

            // Reset win lines for SVG visualiser
            _lastWinLines = [];
            let isBigWin = false;

            // Clear all cell highlights
            getAllCells().forEach(cell => {
                cell.classList.remove('reel-win-glow', 'reel-wild-glow', 'reel-scatter-glow', 'reel-wild-expand');
            });

            // Highlight wilds and scatters across entire grid
            if (grid) {
                const cols = getGridCols(game);
                const rows = getGridRows(game);
                for (let c = 0; c < cols; c++) {
                    for (let r = 0; r < rows; r++) {
                        const cell = document.getElementById(`reel_${c}_${r}`);
                        if (!cell || !grid[c]) continue;
                        if (isWild(grid[c][r], game)) cell.classList.add('reel-wild-glow');
                        if (isScatter(grid[c][r], game)) cell.classList.add('reel-scatter-glow');
                    }
                }
            }

            // ═══ CLUSTER PAY DETECTION ═══
            if (winType === 'cluster' && grid) {
                const clusters = findClusters(grid, game);
                let totalClusterWin = 0;
                let clusterCount = 0;

                for (const cluster of clusters) {
                    const size = cluster.size;
                    let payMultiplier = 0;

                    // Use realistic paytable from House Edge engine
                    const symIdx = game.symbols.indexOf(cluster.symbol);
                    if (window.HouseEdge) {
                        payMultiplier = window.HouseEdge.getClusterPayMultiplier(
                            symIdx >= 0 ? symIdx : 0, size, game
                        );
                    } else {
                        // Fallback: use realistic fractions
                        if (size >= 12) payMultiplier = 2.0;
                        else if (size >= 10) payMultiplier = 0.75;
                        else if (size >= 8) payMultiplier = 0.25;
                        else if (size >= 5) payMultiplier = 0.05;
                    }

                    if (payMultiplier > 0) {
                        let clusterWin = currentBet * payMultiplier;
                        const bonus = applyBonusMultiplier(clusterWin, game);
                        totalClusterWin += bonus.amount;
                        clusterCount++;

                        // Highlight winning cells
                        cluster.cells.forEach(([c, r]) => {
                            const cell = document.getElementById(`reel_${c}_${r}`);
                            if (cell) {
                                cell.classList.add('reel-win-glow');
                                if (typeof triggerSymbolHitAnimation === 'function') {
                                    triggerSymbolHitAnimation(cell, game);
                                }
                            }
                        });
                    }
                }

                if (totalClusterWin > 0) {
                    winAmount = totalClusterWin;
                    isBigWin = winAmount >= currentBet * 3;
                    const totalSize = clusters.reduce((sum, cl) => sum + cl.size, 0);
                    message = `CLUSTER WIN! ${clusterCount} cluster${clusterCount > 1 ? 's' : ''} (${totalSize} symbols) = $${winAmount.toLocaleString()}!`;
                    { const _wm = currentBet > 0 ? winAmount / currentBet : 0;
                      playSound(_wm >= WIN_TIER_EPIC_THRESHOLD ? 'jackpot' : _wm >= WIN_TIER_MEGA_THRESHOLD ? 'megawin' : _wm >= WIN_TIER_BIG_THRESHOLD ? 'bigwin' : 'win'); }
                    showWinAnimation(winAmount); upgradeWinGlow(winAmount);
                } else {
                    message = 'No clusters. Try again.';
                    if (freeSpinsActive && (game.bonusType === 'tumble' || game.bonusType === 'avalanche')) {
                        freeSpinsCascadeLevel = 0;
                    }
                }

            // ═══ PAYLINE WIN DETECTION ═══
            } else if (winType === 'payline' && grid) {

                // ── Mystery Stacks: replace a column before payline evaluation ──
                if (game.bonusType === 'mystery_stacks') {
                    const mysteryResult = applyMysteryStacksWinLogic(grid, game);
                    if (mysteryResult.mysterySymbol) {
                        grid = mysteryResult.grid;
                        if (mysteryResult.extraWin > 0) {
                            showBonusEffect('MYSTERY REVEAL: ' + mysteryResult.mysterySymbol.replace(/^s\d+_/, '').replace(/_/g, ' ').toUpperCase() + '!', '#00bcd4');
                        }
                    }
                }

                // ── Expanding Symbol: expand reels before payline evaluation (during free spins) ──
                if (game.bonusType === 'expanding_symbol' && freeSpinsActive) {
                    const expandResult = applyExpandingSymbol(grid, game);
                    if (expandResult.expandedSymbol) {
                        grid = expandResult.grid;
                        if (expandResult.extraWin > 0) {
                            showBonusEffect('EXPANDING: ' + expandResult.expandedSymbol.replace(/^s\d+_/, '').replace(/_/g, ' ').toUpperCase() + '!', '#c7a94e');
                        }
                    }
                }

                const paylineWins = checkPaylineWins(grid, game);
                let totalPaylineWin = 0;
                let bestLine = null;

                for (const win of paylineWins) {
                    // Use realistic paytable from House Edge engine
                    const symIdx = game.symbols.indexOf(win.symbol);
                    let payMultiplier;
                    if (window.HouseEdge) {
                        payMultiplier = window.HouseEdge.getPaylinePayMultiplier(
                            symIdx >= 0 ? symIdx : 0, win.matchCount, game
                        );
                    } else {
                        // Fallback: realistic fractions
                        if (win.matchCount >= 5) payMultiplier = 0.40;
                        else if (win.matchCount >= 4) payMultiplier = 0.12;
                        else payMultiplier = 0.04;
                    }

                    // Wild bonus: 1.5x on wild-assisted wins
                    const lineSymbols = win.cells.map(([c, r]) => grid[c][r]);
                    const lineWilds = lineSymbols.filter(s => isWild(s, game)).length;
                    if (lineWilds > 0) payMultiplier *= Math.min(3, 1 + lineWilds * 0.5);

                    let lineWin = currentBet * payMultiplier;
                    const bonus = applyBonusMultiplier(lineWin, game);
                    totalPaylineWin += bonus.amount;

                    // Highlight winning cells
                    win.cells.forEach(([c, r]) => {
                        const cell = document.getElementById(`reel_${c}_${r}`);
                        if (cell) {
                            cell.classList.add('reel-win-glow');
                            if (typeof triggerSymbolHitAnimation === 'function') {
                                triggerSymbolHitAnimation(cell, game);
                            }
                        }
                    });

                    // Store for SVG payline visualiser
                    _lastWinLines.push({ cells: win.cells, lineIndex: win.lineIndex });

                    if (!bestLine || bonus.amount > bestLine.amount) {
                        bestLine = { ...win, amount: bonus.amount, bonusText: bonus.bonusText };
                    }
                }

                if (totalPaylineWin > 0) {
                    winAmount = totalPaylineWin;
                    isBigWin = winAmount >= currentBet * 3;
                    isTriple = paylineWins.some(w => w.matchCount >= 3);
                    if (paylineWins.length === 1) {
                        message = `WIN! ${bestLine.matchCount}-of-a-kind on payline = $${winAmount.toLocaleString()}!${bestLine.bonusText || ''}`;
                    } else {
                        message = `MULTI-LINE WIN! ${paylineWins.length} paylines = $${winAmount.toLocaleString()}!`;
                    }

                    // Fire Joker wheel on 5-of-a-kind (fires in base game and free spins)
                    if (game.bonusType === 'wheel_multiplier' && paylineWins.some(w => w.matchCount >= getGridCols(game))) {
                        const wheelMult = getWheelMultiplier(game);
                        winAmount = Math.round(winAmount * wheelMult * 100) / 100;
                        message = `WHEEL OF FIRE! Full match x${wheelMult} = $${winAmount.toLocaleString()}!`;
                        showBonusEffect(`WHEEL ${wheelMult}x!`, '#ff0844');
                    }

                    // ── Multiplier Wilds: wilds in winning lines multiply the payout ──
                    if (game.bonusType === 'multiplier_wilds') {
                        const mwBonus = applyMultiplierWilds(grid, game, paylineWins);
                        if (mwBonus > 0) {
                            winAmount += mwBonus;
                            winAmount = Math.round(winAmount * 100) / 100;
                            message = `MULTIPLIER WILDS! $${winAmount.toLocaleString()}!`;
                        }
                    }

                    // ── Stacked Wilds: bonus multiplier from stacked wild columns ──
                    if (game.bonusType === 'stacked_wilds') {
                        const swResult = applyStackedWilds(grid, game, winAmount);
                        if (swResult.bonusWin > 0) {
                            winAmount += swResult.bonusWin;
                            winAmount = Math.round(winAmount * 100) / 100;
                            message = `STACKED WILDS ${swResult.totalMultiplier.toFixed(1)}x! $${winAmount.toLocaleString()}!`;
                        }
                    }

                    // ── Wild Collect: track wilds, bonus round on threshold ──
                    if (game.bonusType === 'wild_collect') {
                        const wcResult = applyWildCollectWinLogic(grid, game, winAmount);
                        if (wcResult.triggered && wcResult.extraWin > 0) {
                            winAmount += wcResult.extraWin;
                            winAmount = Math.round(winAmount * 100) / 100;
                            message = `WILD COLLECT BONUS! $${winAmount.toLocaleString()}!`;
                        }
                    }

                    // ── Expanding Symbol: add extra payline wins from expanded grid (non-free-spin) ──
                    if (game.bonusType === 'expanding_symbol' && !freeSpinsActive) {
                        const expandResult = applyExpandingSymbol(grid, game);
                        if (expandResult.extraWin > 0) {
                            winAmount += expandResult.extraWin;
                            winAmount = Math.round(winAmount * 100) / 100;
                            message = `EXPANDING SYMBOL! $${winAmount.toLocaleString()}!`;
                            showBonusEffect('EXPANDING: ' + (expandResult.expandedSymbol || '').replace(/^s\d+_/, '').replace(/_/g, ' ').toUpperCase() + '!', '#c7a94e');
                        }
                    }

                    // ── Mystery Stacks: add bonus from re-evaluated grid ──
                    if (game.bonusType === 'mystery_stacks') {
                        // Mystery stacks grid modification was applied before payline evaluation;
                        // any additional mystery multiplier chance (5% rare multiplier)
                        if (getRandomNumber() < 0.05 && winAmount > 0) {
                            const mysteryMults = game.mysteryRevealMultipliers || [1, 2, 5, 10];
                            const rareIdx = 1 + Math.floor(getRandomNumber() * (mysteryMults.length - 1));
                            const mystMult = mysteryMults[rareIdx] || 2;
                            if (mystMult > 1) {
                                winAmount = Math.round(winAmount * mystMult * 100) / 100;
                                message = `MYSTERY x${mystMult}! $${winAmount.toLocaleString()}!`;
                                showBonusEffect('MYSTERY x' + mystMult + '!', '#00bcd4');
                            }
                        }
                    }

                    _flashWinLines(_lastWinLines);
                    { const _wm = currentBet > 0 ? winAmount / currentBet : 0;
                      playSound(_wm >= WIN_TIER_EPIC_THRESHOLD ? 'jackpot' : _wm >= WIN_TIER_MEGA_THRESHOLD ? 'megawin' : _wm >= WIN_TIER_BIG_THRESHOLD ? 'bigwin' : 'win'); }
                    showWinAnimation(winAmount); upgradeWinGlow(winAmount);
                } else {
                    message = 'No winning lines. Try again.';
                    playSound('lose');
                    if (freeSpinsActive && (game.bonusType === 'tumble' || game.bonusType === 'avalanche')) {
                        freeSpinsCascadeLevel = 0;
                    }

                    // ── Wild Collect: still track wilds on non-winning spins ──
                    if (game.bonusType === 'wild_collect') {
                        const wcLossResult = applyWildCollectWinLogic(grid, game, 0);
                        if (wcLossResult.triggered && wcLossResult.extraWin > 0) {
                            winAmount = wcLossResult.extraWin;
                            winAmount = Math.round(winAmount * 100) / 100;
                            message = `WILD COLLECT BONUS! $${winAmount.toLocaleString()}!`;
                        }
                    }
                }

            // ═══ CLASSIC 3-REEL WIN DETECTION ═══
            } else {
                // For multi-row classic games (e.g. 3x3), check all paylines and pick the best
                // single-row games use the symbols param directly (row 0)
                let evalSymbols = symbols;
                if (grid && isMultiRow(game)) {
                    const paylines = getPaylines(game);
                    let foundTriple = null;
                    let foundDouble = null;
                    for (const pl of paylines) {
                        // pl is [rowIdx_col0, rowIdx_col1, ...] — extract symbol from each column
                        const plSyms = pl.map((rowIdx, colIdx) => grid[colIdx] ? grid[colIdx][rowIdx] : null).filter(s => s != null);
                        if (plSyms.length >= 3) {
                            if (!foundTriple && isTripleMatch(plSyms, game)) foundTriple = plSyms;
                            else if (!foundDouble && getDoubleMatch(plSyms, game)) foundDouble = plSyms;
                        }
                    }
                    evalSymbols = foundTriple || foundDouble || symbols;
                }

                const wildCount = countWilds(evalSymbols, game);
                const hasWild = wildCount > 0;

                if (isTripleMatch(evalSymbols, game)) {
                    isTriple = true;
                    isBigWin = true;
                    const allWilds = wildCount === 3;
                    // Use realistic paytable from House Edge engine
                    const matchSym = evalSymbols.find(s => !isWild(s, game)) || evalSymbols[0];
                    const symIdx = game.symbols.indexOf(matchSym);
                    let payMultiplier;
                    if (window.HouseEdge) {
                        payMultiplier = window.HouseEdge.getClassicPayMultiplier(
                            symIdx >= 0 ? symIdx : 0, 'triple', game
                        );
                    } else {
                        payMultiplier = 1.0; // Fallback: 1x bet
                    }
                    // Wild bonus
                    if (hasWild) payMultiplier *= 1.5;
                    let baseWin = currentBet * payMultiplier;
                    const bonus = applyBonusMultiplier(baseWin, game);
                    winAmount = bonus.amount;

                    if (allWilds) {
                        message = `WILD JACKPOT! Triple wilds paid $${winAmount.toLocaleString()}!${bonus.bonusText}`;
                    } else if (hasWild) {
                        message = `WILD MEGA WIN! Wild helped complete a triple for $${winAmount.toLocaleString()}!${bonus.bonusText}`;
                    } else {
                        message = `MEGA WIN! Triple match paid $${winAmount.toLocaleString()}!${bonus.bonusText}`;
                    }

                    // Fire Joker: Wheel of Multipliers on triple (fires in base game and free spins)
                    if (game.bonusType === 'wheel_multiplier') {
                        const wheelMult = getWheelMultiplier(game);
                        winAmount = Math.round(winAmount * wheelMult * 100) / 100;
                        message = `WHEEL OF FIRE! Triple match x${wheelMult} = $${winAmount.toLocaleString()}!`;
                        showBonusEffect(`WHEEL ${wheelMult}x!`, '#ff0844');
                    }

                    // ── Stacked Wilds: bonus multiplier from stacked wilds (classic) ──
                    if (game.bonusType === 'stacked_wilds' && grid) {
                        const swResult = applyStackedWilds(grid, game, winAmount);
                        if (swResult.bonusWin > 0) {
                            winAmount += swResult.bonusWin;
                            winAmount = Math.round(winAmount * 100) / 100;
                            message = `STACKED WILDS ${swResult.totalMultiplier.toFixed(1)}x! $${winAmount.toLocaleString()}!`;
                        }
                    }

                    // ── Multiplier Wilds: wild multiplier bonus (classic) ──
                    if (game.bonusType === 'multiplier_wilds' && hasWild) {
                        const mwRoll = getRandomNumber();
                        let mwMult;
                        if (mwRoll < 0.50) mwMult = 2;
                        else if (mwRoll < 0.85) mwMult = 3;
                        else mwMult = 5;
                        const mwBonus = Math.round(winAmount * (mwMult - 1) * 100) / 100;
                        winAmount += mwBonus;
                        winAmount = Math.round(winAmount * 100) / 100;
                        message = `${mwMult}x WILD MULTIPLIER! $${winAmount.toLocaleString()}!`;
                        showBonusEffect(mwMult + 'x WILD MULTIPLIER!', '#ff6d00');
                    }

                    // ── Wild Collect: track wilds on wins (classic) ──
                    if (game.bonusType === 'wild_collect' && grid) {
                        const wcResult = applyWildCollectWinLogic(grid, game, winAmount);
                        if (wcResult.triggered && wcResult.extraWin > 0) {
                            winAmount += wcResult.extraWin;
                            winAmount = Math.round(winAmount * 100) / 100;
                            message = `WILD COLLECT BONUS! $${winAmount.toLocaleString()}!`;
                        }
                    }

                    { const _wm = currentBet > 0 ? winAmount / currentBet : 0;
                      playSound(_wm >= WIN_TIER_EPIC_THRESHOLD ? 'jackpot' : _wm >= WIN_TIER_MEGA_THRESHOLD ? 'megawin' : _wm >= WIN_TIER_BIG_THRESHOLD ? 'bigwin' : 'win'); }
                    showWinAnimation(winAmount); upgradeWinGlow(winAmount);
                    getAllCells().forEach(cell => {
                        cell.classList.add('reel-win-glow');
                        if (typeof triggerSymbolHitAnimation === 'function') {
                            triggerSymbolHitAnimation(cell, game);
                        }
                    });
                    // Classic 3-reel triple: line through all 3 cells on row 0
                    const cols3 = getGridCols(game);
                    _lastWinLines.push({ cells: Array.from({length: cols3}, (_, c) => [c, 0]), lineIndex: 0 });

                } else {
                    const doublePair = getDoubleMatch(evalSymbols, game);
                    if (doublePair) {
                        isDouble = true;
                        // Use realistic paytable from House Edge engine
                        const matchSym = evalSymbols[doublePair[0]];
                        const symIdx = game.symbols.indexOf(matchSym);
                        let payMultiplier;
                        if (window.HouseEdge) {
                            payMultiplier = window.HouseEdge.getClassicPayMultiplier(
                                symIdx >= 0 ? symIdx : 0, 'double', game
                            );
                        } else {
                            payMultiplier = 0.15; // Fallback
                        }
                        let baseWin = currentBet * payMultiplier;
                        if (hasWild) baseWin *= 1.5;
                        const bonus = applyBonusMultiplier(baseWin, game);
                        winAmount = bonus.amount;

                        if (hasWild) {
                            message = `WILD WIN! Wild symbol helped match for $${winAmount.toLocaleString()}!${bonus.bonusText}`;
                        } else {
                            message = `Nice win! Two symbols matched for $${winAmount.toLocaleString()}.${bonus.bonusText}`;
                        }
                        playSound('win');
                        showWinAnimation(winAmount); upgradeWinGlow(winAmount);
                        doublePair.forEach(idx => {
                            const cell = document.getElementById(`reel_${idx}_0`);
                            if (cell) {
                                cell.classList.add('reel-win-glow');
                                if (typeof triggerSymbolHitAnimation === 'function') {
                                    triggerSymbolHitAnimation(cell, game);
                                }
                            }
                        });
                        // Classic double: line through the 2 matched cells
                        _lastWinLines.push({ cells: doublePair.map(idx => [idx, 0]), lineIndex: 0 });
                    } else {
                        message = 'No match. Try again.';
                        if (freeSpinsActive && (game.bonusType === 'tumble' || game.bonusType === 'avalanche')) {
                            freeSpinsCascadeLevel = 0;
                        }

                        // ── Wild Collect: still track wilds on non-winning classic spins ──
                        if (game.bonusType === 'wild_collect' && grid) {
                            const wcLossResult = applyWildCollectWinLogic(grid, game, 0);
                            if (wcLossResult.triggered && wcLossResult.extraWin > 0) {
                                winAmount = wcLossResult.extraWin;
                                winAmount = Math.round(winAmount * 100) / 100;
                                message = `WILD COLLECT BONUS! $${winAmount.toLocaleString()}!`;
                            }
                        }
                    }
                }
            }

            // ── Money Collect mechanics (Black Bull, Big Bass) — grid-aware ──
            const gridWilds = grid ? countWildsInGrid(grid, game) : countWilds(symbols, game);
            if (game.bonusType === 'money_collect' || game.bonusType === 'fisherman_collect') {
                const collectSyms = game.moneySymbols || game.fishSymbols || [];
                let collectTotal = 0;
                if (grid) {
                    for (const col of grid) {
                        for (const s of col) {
                            if (collectSyms.includes(s)) collectTotal += getMoneyValue(s, game);
                        }
                    }
                } else {
                    symbols.forEach(s => {
                        if (collectSyms.includes(s)) collectTotal += getMoneyValue(s, game);
                    });
                }
                if (collectTotal > 0) {
                    winAmount += collectTotal;
                    message += ` Collected $${collectTotal.toLocaleString()} in ${game.bonusType === 'fisherman_collect' ? 'fish' : 'coin'} values!`;
                    showBonusEffect(`COLLECT $${collectTotal.toLocaleString()}!`, game.accentColor);
                }
            }

            // ── Scatter detection — grid-aware ──
            const scatterCount = grid ? countSymbolInGrid(grid, game.scatterSymbol || '') : countScatters(symbols, game);
            const scatterThreshold     = isMultiRow(game) ? SCATTER_THRESHOLD_MULTI_ROW      : SCATTER_THRESHOLD_CLASSIC;
            const fullScatterThreshold = isMultiRow(game) ? FULL_SCATTER_THRESHOLD_MULTI_ROW : FULL_SCATTER_THRESHOLD_CLASSIC;

            // ── Hold & Win / Coin Respin bonus trigger ──
            if (scatterCount >= scatterThreshold && !freeSpinsActive &&
                (game.bonusType === 'hold_and_win' || game.bonusType === 'coin_respin') &&
                typeof triggerHoldAndWin === 'function') {
                // Build list of locked cell positions from currentGrid
                const scatterCells = [];
                if (grid) {
                    const cols = getGridCols(game);
                    const rows = getGridRows(game);
                    for (let c = 0; c < cols; c++) {
                        for (let r = 0; r < rows; r++) {
                            if (grid[c] && grid[c][r] === game.scatterSymbol) {
                                scatterCells.push({ col: c, row: r });
                            }
                        }
                    }
                }
                playSound('freespin');
                message = `BONUS! HOLD & WIN TRIGGERED!`;
                triggerHoldAndWin(game, scatterCells, currentBet);
                if (typeof onChallengeEvent === 'function') onChallengeEvent('bonus', { gameId: game ? game.id : null });
            } else if (scatterCount >= scatterThreshold && !freeSpinsActive && game.freeSpinsCount > 0) {
                // Realistic scatter pay: 0.5x per scatter (real slots: 0.5x-1x)
                const scatterPayMult = window.HouseEdge ? window.HouseEdge.getScatterPay(scatterCount) : scatterCount * 0.5;
                const scatterWin = currentBet * scatterPayMult;
                winAmount += scatterWin;

                // ── chamber_spins hook — Eternal Romance ──
                if (game.bonusType === 'chamber_spins') {
                    if (typeof triggerChamberSpins === 'function') {
                        playSound('freespin');
                        message = `CHAMBER BONUS! +$${scatterWin.toLocaleString()} scatter pay!`;
                        triggerChamberSpins(game);
                        if (typeof onChallengeEvent === 'function') onChallengeEvent('bonus', { gameId: game ? game.id : null });
                    }
                } else if (game.bonusType === 'sticky_wilds') {
                    if (typeof triggerStickyWildsFreeSpins === 'function') {
                        message = `STICKY WILDS! $${game.freeSpinsCount} FREE SPINS! +$${scatterWin.toLocaleString()}!`;
                        triggerStickyWildsFreeSpins(game, scatterWin);
                        if (typeof onChallengeEvent === 'function') onChallengeEvent('bonus', { gameId: game ? game.id : null });
                    } else {
                        playSound('freespin');
                        triggerFreeSpins(game, game.freeSpinsCount);
                        if (typeof onChallengeEvent === 'function') onChallengeEvent('bonus', { gameId: game ? game.id : null });
                        message = `STICKY WILDS! $${game.freeSpinsCount} FREE SPINS! +$${scatterWin.toLocaleString()}!`;
                    }
                } else if (game.bonusType === 'walking_wilds') {
                    if (typeof triggerWalkingWildsFreeSpins === 'function') {
                        message = `WALKING WILDS! $${game.freeSpinsCount} FREE SPINS! +$${scatterWin.toLocaleString()}!`;
                        triggerWalkingWildsFreeSpins(game, scatterWin);
                        if (typeof onChallengeEvent === 'function') onChallengeEvent('bonus', { gameId: game ? game.id : null });
                    } else {
                        playSound('freespin');
                        triggerFreeSpins(game, game.freeSpinsCount);
                        if (typeof onChallengeEvent === 'function') onChallengeEvent('bonus', { gameId: game ? game.id : null });
                        message = `WALKING WILDS! $${game.freeSpinsCount} FREE SPINS! +$${scatterWin.toLocaleString()}!`;
                    }
                } else if (game.bonusType === 'increasing_mult') {
                    if (typeof triggerFreeSpins === 'function') {
                        playSound('freespin');
                        message = `INCREASING MULTIPLIER! ${game.freeSpinsCount} FREE SPINS! +${scatterWin.toLocaleString()}!`;
                        if (typeof resetIncrMult === 'function') resetIncrMult();
                        triggerFreeSpins(game, game.freeSpinsCount);
                        if (typeof onChallengeEvent === 'function') onChallengeEvent('bonus', { gameId: game ? game.id : null });
                    }
                } else if (game.bonusType === 'respin') {
                    if (typeof triggerFreeSpins === 'function') {
                        playSound('freespin');
                        message = `RE-SPIN BONUS! ${game.freeSpinsCount} FREE SPINS! +$${scatterWin.toLocaleString()}!`;
                        triggerFreeSpins(game, game.freeSpinsCount);
                        if (typeof onChallengeEvent === 'function') onChallengeEvent('bonus', { gameId: game ? game.id : null });
                    }
                } else if (game.bonusType === 'expanding_symbol') {
                    playSound('freespin');
                    message = `EXPANDING SYMBOL! ${game.freeSpinsCount} FREE SPINS! +$${scatterWin.toLocaleString()}!`;
                    triggerFreeSpins(game, game.freeSpinsCount);
                    if (typeof onChallengeEvent === 'function') onChallengeEvent('bonus', { gameId: game ? game.id : null });
                } else if (game.bonusType === 'multiplier_wilds') {
                    playSound('freespin');
                    message = `MULTIPLIER WILDS! ${game.freeSpinsCount} FREE SPINS! +$${scatterWin.toLocaleString()}!`;
                    triggerFreeSpins(game, game.freeSpinsCount);
                    if (typeof onChallengeEvent === 'function') onChallengeEvent('bonus', { gameId: game ? game.id : null });
                } else if (game.bonusType === 'mystery_stacks') {
                    playSound('freespin');
                    message = `MYSTERY STACKS! ${game.freeSpinsCount} FREE SPINS! +$${scatterWin.toLocaleString()}!`;
                    triggerFreeSpins(game, game.freeSpinsCount);
                    if (typeof onChallengeEvent === 'function') onChallengeEvent('bonus', { gameId: game ? game.id : null });
                } else if (game.bonusType === 'stacked_wilds') {
                    playSound('freespin');
                    message = `STACKED WILDS! ${game.freeSpinsCount} FREE SPINS! +$${scatterWin.toLocaleString()}!`;
                    triggerFreeSpins(game, game.freeSpinsCount);
                    if (typeof onChallengeEvent === 'function') onChallengeEvent('bonus', { gameId: game ? game.id : null });
                } else if (game.bonusType === 'wild_collect') {
                    playSound('freespin');
                    _wildCollectCount = 0;
                    window._wildCollectCount = 0;
                    message = `WILD COLLECT! ${game.freeSpinsCount} FREE SPINS! +$${scatterWin.toLocaleString()}!`;
                    triggerFreeSpins(game, game.freeSpinsCount);
                    if (typeof onChallengeEvent === 'function') onChallengeEvent('bonus', { gameId: game ? game.id : null });
                } else if (game.bonusType === 'prize_wheel') {
                    if (typeof triggerPrizeWheel === 'function') {
                        playSound('freespin');
                        message = `PRIZE WHEEL! +${scatterWin.toLocaleString()}!`;
                        triggerPrizeWheel(game);
                        if (typeof onChallengeEvent === 'function') onChallengeEvent('bonus', { gameId: game ? game.id : null });
                    }
                } else if (game.bonusType === 'tumble' || game.bonusType === 'avalanche' ||
                           game.bonusType === 'random_multiplier' || game.bonusType === 'zeus_multiplier' ||
                           game.bonusType === 'wheel_multiplier' || game.bonusType === 'money_collect' ||
                           game.bonusType === 'fisherman_collect') {
                    // These types use standard free spins — the per-spin mechanic fires
                    // inside freeSpinSpin() based on bonusType. Always grant full freeSpinsCount.
                    playSound('freespin');
                    const _bonusLabel = game.bonusType.replace(/_/g, ' ').toUpperCase();
                    message = `${_bonusLabel}! ${game.freeSpinsCount} FREE SPINS! +$${scatterWin.toLocaleString()}!`;
                    triggerFreeSpins(game, game.freeSpinsCount);
                    if (typeof onChallengeEvent === 'function') onChallengeEvent('bonus', { gameId: game ? game.id : null });
                } else if (scatterCount >= fullScatterThreshold) {
                    playSound('freespin');
                    triggerFreeSpins(game, game.freeSpinsCount);
                    if (typeof onChallengeEvent === 'function') onChallengeEvent('bonus', { gameId: game ? game.id : null });
                    message = `SCATTER BONUS! ${game.freeSpinsCount} FREE SPINS AWARDED! +$${scatterWin.toLocaleString()} scatter pay!`;
                } else {
                    const halfSpins = Math.max(3, Math.floor(game.freeSpinsCount / 2));
                    playSound('freespin');
                    triggerFreeSpins(game, halfSpins);
                    if (typeof onChallengeEvent === 'function') onChallengeEvent('bonus', { gameId: game ? game.id : null });
                    message = `SCATTER! ${halfSpins} FREE SPINS! +$${scatterWin.toLocaleString()}!`;
                }
            }

            // ── Scatter retrigger during free spins (capped to prevent runaway) ──
            // MAX_FREE_SPINS — from constants.js
            if (scatterCount >= scatterThreshold && freeSpinsActive && game.freeSpinsRetrigger && freeSpinsRemaining < MAX_FREE_SPINS) {
                // ── chamber_spins retrigger — advance chamber level ──
                if (game.bonusType === 'chamber_spins') {
                    if (typeof advanceChamberLevel === 'function') {
                        advanceChamberLevel(game);
                        message += ' CHAMBER ADVANCED!';
                    }
                } else {
                    const extraSpins = scatterCount >= fullScatterThreshold ? game.freeSpinsCount : Math.max(2, Math.floor(game.freeSpinsCount / 3));
                    const capped = Math.min(extraSpins, MAX_FREE_SPINS - freeSpinsRemaining);
                    if (capped > 0) {
                        freeSpinsRemaining += capped;
                        message += ` +${capped} EXTRA FREE SPINS!`;
                        updateFreeSpinsDisplay();
                        showBonusEffect(`+${capped} FREE SPINS!`, '#fbbf24');
                        if (typeof showRetriggerBanner === 'function') showRetriggerBanner(capped);
                    }
                }
            }

            // ── HOUSE EDGE: Cap win amount before crediting ──
            if (winAmount > 0 && window.HouseEdge) {
                winAmount = window.HouseEdge.capWin(winAmount, currentBet, game);
                winAmount = Math.round(winAmount * 100) / 100;
            }

            // ── HOUSE EDGE: Record spin for profit tracking ──
            if (window.HouseEdge) {
                window.HouseEdge.recordSpin(currentBet, winAmount, game.id);
            }

            // ── Process win ──
            if (winAmount > 0) {
                balance += winAmount;
                updateBalance();
                saveBalance();
                stats.totalWon += winAmount;
                if (winAmount > stats.biggestWin) stats.biggestWin = winAmount;
                saveStats();
                updateStatsSummary();
                showMessage(message, 'win');
                const xpBonus = isBigWin ? XP_AWARD_BIG_WIN : XP_AWARD_REGULAR_WIN;
                if (typeof awardXP === 'function') awardXP(xpBonus);

                // Apply celebration animations based on win size (adjusted thresholds)
                const isMegaWin = winAmount >= currentBet * 10;
                const winCells = document.querySelectorAll('.reel-win-glow');
                if (winCells.length > 0) {
                    if (isMegaWin) {
                        winCells.forEach(cell => cell.classList.add('reel-mega-win'));
                    } else {
                        winCells.forEach(cell => cell.classList.add('reel-celebrating'));
                    }
                }

                if (freeSpinsActive) {
                    freeSpinsTotalWin += winAmount;
                    updateFreeSpinsDisplay();
                }

                // Show gamble button for wins >= 1x bet (not during free spins / autoplay)
                if (!freeSpinsActive && !autoSpinActive && winAmount >= currentBet) {
                    showGambleButton(winAmount);
                }

                // Big win celebration for wins >= 10x bet
                if (winAmount >= currentBet * 10 && !freeSpinsActive) {
                    setTimeout(() => showBigWinCelebration(winAmount), 800);
                }
                // Reset comeback loss streak on any win
                _comebackLossStreak = 0;
            } else {
                // Still record the loss for tracking
                if (window.HouseEdge && winAmount === 0) {
                    // Already recorded above
                }
                showMessage(message, 'lose');
                hideGambleButton();
                // Track loss streak for comeback bonus
                _comebackLossStreak++;
                if (_comebackLossStreak > 0 && _comebackLossStreak % 20 === 0) {
                    checkComebackBonus();
                }
            }
            if (typeof awardXP === 'function') awardXP(XP_AWARD_PER_SPIN);
            // Community Jackpot contribution (Sprint 30)
            if (typeof communityJackpotSpin === 'function') communityJackpotSpin(currentBet);

            // ── Hot Chillies Respin (classic 3-reel only) ──
            if (winType === 'classic' && !freeSpinsActive && isDouble && !isTriple && game.bonusType === 'respin' && respinCount < (game.maxRespins || 3)) {
                const doublePair = getDoubleMatch(symbols, game);
                if (doublePair) {
                    respinCount++;
                    const nonMatch = [0, 1, 2].filter(i => !doublePair.includes(i))[0];
                    showBonusEffect(`RESPIN ${respinCount}/${game.maxRespins || 3}!`, game.accentColor);
                    setTimeout(() => triggerRespin(nonMatch, symbols, game), 800);
                    return;
                }
            } else if (!isDouble || isTriple) {
                respinCount = 0;
            }

            // ── Starburst Expanding Wild Respin ──
            if (gridWilds > 0 && game.bonusType === 'expanding_wild_respin' && expandingWildRespinsLeft < (game.expandingWildMaxRespins || 3)) {
                expandingWildRespinsLeft++;
                showBonusEffect('EXPANDING WILD RESPIN!', '#a855f7');
                if (grid) {
                    for (let c = 0; c < grid.length; c++) {
                        for (let r = 0; r < grid[c].length; r++) {
                            if (isWild(grid[c][r], game)) {
                                const cell = document.getElementById(`reel_${c}_${r}`);
                                if (cell) cell.classList.add('reel-wild-expand');
                            }
                        }
                    }
                }
                setTimeout(() => triggerExpandingWildRespin(symbols, game), 1000);
                return;
            }

            // Refresh slot session stats (sssNet P/L) after every win/loss
            if (typeof window._updateSlotSessionStats === 'function') window._updateSlotSessionStats();

            // ── Process free spin advancement ──
            if (freeSpinsActive) {
                advanceFreeSpins(game);
            }
        }

        // ── Comeback Bonus Functions ──
        function checkComebackBonus() {
            if (_comebackCheckInFlight) return;
            if (!currentUser || !currentUser.token) return;
            _comebackCheckInFlight = true;
            fetch('/api/user/comeback-bonus', {
                headers: { 'Authorization': 'Bearer ' + currentUser.token }
            }).then(function(r) {
                if (!r.ok) return null;
                return r.json();
            }).then(function(data) {
                _comebackCheckInFlight = false;
                if (data && data.eligible) {
                    _showComebackToast(data);
                }
            }).catch(function() {
                _comebackCheckInFlight = false;
            });
        }

        function _showComebackToast(data) {
            var existing = document.querySelector('.comeback-toast');
            if (existing) existing.remove();

            var toast = document.createElement('div');
            toast.className = 'comeback-toast';

            var icon = document.createElement('div');
            icon.className = 'comeback-toast-icon';
            icon.textContent = '\uD83D\uDCB0';

            var text = document.createElement('div');
            text.className = 'comeback-toast-text';
            text.textContent = 'Tough luck! Claim your $' + data.amount.toFixed(2) + ' ' + data.tier + ' comeback bonus!';

            var btn = document.createElement('button');
            btn.className = 'comeback-toast-btn';
            btn.textContent = 'Claim $' + data.amount.toFixed(2);
            btn.onclick = function() { _claimComebackBonus(toast); };

            var close = document.createElement('button');
            close.className = 'comeback-toast-close';
            close.textContent = '\u2715';
            close.onclick = function() {
                toast.classList.add('closing');
                setTimeout(function() { toast.remove(); }, 300);
            };

            toast.appendChild(icon);
            toast.appendChild(text);
            toast.appendChild(btn);
            toast.appendChild(close);

            var target = document.querySelector('#slotView') || document.body;
            target.appendChild(toast);

            // Auto-dismiss after 15 seconds
            setTimeout(function() {
                if (toast.parentNode) {
                    toast.classList.add('closing');
                    setTimeout(function() { toast.remove(); }, 300);
                }
            }, 15000);
        }

        function _claimComebackBonus(toast) {
            if (!currentUser || !currentUser.token) return;
            var btn = toast.querySelector('.comeback-toast-btn');
            if (btn) { btn.disabled = true; btn.textContent = 'Claiming...'; }

            fetch('/api/user/claim-comeback-bonus', {
                method: 'POST',
                headers: {
                    'Authorization': 'Bearer ' + currentUser.token,
                    'Content-Type': 'application/json'
                }
            }).then(function(r) { return r.json(); }).then(function(data) {
                if (data.success) {
                    balance = data.newBalance;
                    updateBalanceDisplay();
                    var text = toast.querySelector('.comeback-toast-text');
                    if (text) text.textContent = 'Bonus credited! New balance: $' + data.newBalance.toFixed(2);
                    if (btn) btn.remove();
                    _comebackLossStreak = 0;
                    setTimeout(function() {
                        toast.classList.add('closing');
                        setTimeout(function() { toast.remove(); }, 300);
                    }, 3000);
                } else {
                    if (btn) { btn.disabled = false; btn.textContent = 'Retry'; }
                }
            }).catch(function() {
                if (btn) { btn.disabled = false; btn.textContent = 'Retry'; }
            });
        }
