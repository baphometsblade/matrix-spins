// ═══════════════════════════════════════════════════════
// QA-TOOLS MODULE
// ═══════════════════════════════════════════════════════


        function applyUrlDebugConfig() {
            const params = new URLSearchParams(window.location.search);

            const seedParam = params.get('spinSeed');
            if (seedParam) {
                setDeterministicSeed(seedParam);
            }

            const forceSpinParam = params.get('forceSpin');
            if (forceSpinParam) {
                queueForcedSpin(forceSpinParam);
            }

            const forceOutcomeParam = params.get('forceOutcome');
            if (forceOutcomeParam) {
                queueForcedOutcome(forceOutcomeParam, params.get('forceSymbol'));
            }

            const qaToolsParam = params.get('qaTools');
            if (qaToolsParam === '1' || qaToolsParam === 'true') {
                // Show the QA container (may be hidden via inline style for production)
                const qaContainer = getQaNode('qaTools');
                if (qaContainer) qaContainer.style.display = '';
                setQaToolsExpanded(true);
            }

            const qaResetClearSeedParam = params.get('qaResetClearSeed');
            if (qaResetClearSeedParam === '1' || qaResetClearSeedParam === 'true') {
                const clearSeedToggle = getQaNode('qaResetClearSeed');
                if (clearSeedToggle) {
                    clearSeedToggle.checked = true;
                }
            }

            const openSlotId = params.get('openSlot');
            const openTarget = games.find((game) => game.id === openSlotId);
            if (openTarget) {
                openSlot(openTarget.id);
            }

            const autoSpinValue = params.get('autoSpin');
            if ((autoSpinValue === '1' || autoSpinValue === 'true') && openTarget) {
                const delayParam = Number.parseInt(params.get('autoSpinDelay') || '700', 10);
                const delay = Number.isFinite(delayParam) ? Math.max(0, delayParam) : 700;
                setTimeout(() => {
                    if (currentGame && !spinning) {
                        spin();
                    }
                }, delay);
            }

            refreshQaStateDisplay();
        }


        function getDebugState() {
            return {
                deterministicMode: Boolean(deterministicRng),
                deterministicSeed,
                queuedForcedSpins: forcedSpinQueue.map((symbols) => [...symbols]),
                availableSymbols: [...SLOT_SYMBOLS]
            };
        }


        function getQaNode(id) {
            return document.getElementById(id);
        }


        function setQaStatus(text, type = 'info') {
            const statusEl = getQaNode('qaStatusLine');
            if (!statusEl) return;

            statusEl.textContent = text || '';
            statusEl.className = 'qa-status';

            if (type === 'good') {
                statusEl.classList.add('qa-status-good');
            } else if (type === 'warn') {
                statusEl.classList.add('qa-status-warn');
            } else if (type === 'error') {
                statusEl.classList.add('qa-status-error');
            }
        }


        function setQaToolsExpanded(expanded) {
            qaToolsOpen = Boolean(expanded);
            const container = getQaNode('qaTools');
            const bodyEl = getQaNode('qaToolsBody');
            const toggleBtn = getQaNode('qaToggleBtn');

            // Ensure the QA container is visible when expanding
            if (container && qaToolsOpen) {
                container.style.display = '';
            }
            if (bodyEl) {
                bodyEl.classList.toggle('active', qaToolsOpen);
            }
            if (toggleBtn) {
                toggleBtn.textContent = qaToolsOpen ? 'Hide' : 'Show';
            }
        }


        function refreshQaStateDisplay() {
            const lineEl = getQaNode('qaStateLine');
            if (!lineEl) return;
            const state = getDebugState();
            const seedLabel = state.deterministicMode ? `seed=${state.deterministicSeed}` : 'seed=off';
            lineEl.textContent = `${seedLabel} | queued=${state.queuedForcedSpins.length}`;
        }


        function resetSessionState(options = {}) {
            if (spinning) return false;

            const config = {
                clearDeterministic: false,
                clearQueue: true,
                ...options
            };

            balance = DEFAULT_BALANCE;
            stats = createDefaultStats();
            lastMessage = { type: 'info', text: '' };

            // Clear free spins state
            freeSpinsActive = false;
            freeSpinsRemaining = 0;
            freeSpinsTotalWin = 0;
            freeSpinsMultiplier = 1;
            freeSpinsCascadeLevel = 0;
            freeSpinsExpandedSymbol = null;
            expandingWildRespinsLeft = 0;
            respinCount = 0;
            hideFreeSpinsDisplay();

            if (config.clearQueue) {
                forcedSpinQueue = [];
            }
            if (config.clearDeterministic) {
                setDeterministicSeed(null);
            }

            saveBalance();
            saveStats();
            updateBalance();
            updateStatsSummary();
            renderGames();

            if (currentGame) {
                currentBet = currentGame.minBet;
                // Rebuild grid with initial symbols
                const cols = getGridCols(currentGame);
                const rows = getGridRows(currentGame);
                const syms = currentGame.symbols || SLOT_SYMBOLS;
                const initGrid = createEmptyGrid(cols, rows);
                for (let c = 0; c < cols; c++) {
                    for (let r = 0; r < rows; r++) {
                        initGrid[c][r] = syms[(c * rows + r) % syms.length];
                    }
                }
                currentGrid = initGrid;
                currentReels = flattenGrid(initGrid);
                renderGrid(initGrid, currentGame);
                refreshBetControls();
            }

            const msgDiv = document.getElementById('messageDisplay');
            if (msgDiv) {
                msgDiv.innerHTML = '';
            }

            const winDiv = document.getElementById('winAnimation');
            if (winDiv) {
                winDiv.innerHTML = '';
            }

            refreshQaStateDisplay();
            return true;
        }


        function refreshQaSymbolList() {
            const symbolSelect = getQaNode('qaOutcomeSymbol');
            if (!symbolSelect) return;
            // Keep first option (placeholder), remove the rest
            while (symbolSelect.options.length > 1) symbolSelect.remove(1);
            const syms = getGameSymbols(currentGame);
            syms.forEach((symbol) => {
                const option = document.createElement('option');
                option.value = symbol;
                option.textContent = symbol;
                symbolSelect.appendChild(option);
            });
        }


        function initQaTools() {
            refreshQaSymbolList();

            const seedInput = getQaNode('qaSeedInput');
            if (seedInput && deterministicSeed) {
                seedInput.value = deterministicSeed;
            }

            setQaToolsExpanded(false);
            refreshQaStateDisplay();
            setQaStatus('');
        }


        function toggleQaTools() {
            setQaToolsExpanded(!qaToolsOpen);
        }


        function applyQaSeed() {
            const seedInput = getQaNode('qaSeedInput');
            if (!seedInput) return;

            const seed = seedInput.value.trim();
            if (!setDeterministicSeed(seed)) {
                setQaStatus('Enter a seed before applying.', 'warn');
                return;
            }

            refreshQaStateDisplay();
            setQaStatus(`Seed applied: ${seed}`, 'good');
        }


        function clearQaSeed() {
            const seedInput = getQaNode('qaSeedInput');
            if (seedInput) {
                seedInput.value = '';
            }
            setDeterministicSeed(null);
            refreshQaStateDisplay();
            setQaStatus('Deterministic seed cleared.', 'good');
        }


        function queueQaOutcome(autoplay) {
            const outcomeSelect = getQaNode('qaOutcomeType');
            const symbolSelect = getQaNode('qaOutcomeSymbol');
            if (!outcomeSelect || !symbolSelect) return;

            const queued = autoplay
                ? queueAndSpin(outcomeSelect.value, symbolSelect.value || undefined)
                : queueForcedOutcome(outcomeSelect.value, symbolSelect.value || undefined);

            if (!queued) {
                setQaStatus('Failed to queue outcome.', 'error');
                return;
            }

            refreshQaStateDisplay();
            setQaStatus(`Queued outcome: ${queued.join(', ')}`, 'good');
        }


        function queueQaExactReels(autoplay) {
            const reelsInput = getQaNode('qaExactReels');
            if (!reelsInput) return;

            const raw = reelsInput.value.trim();
            const queued = autoplay
                ? queueAndSpin(raw)
                : queueForcedSpin(raw);

            if (!queued) {
                setQaStatus('Use exactly three valid symbols, comma-separated.', 'warn');
                return;
            }

            refreshQaStateDisplay();
            setQaStatus(`Queued reels: ${queued.join(', ')}`, 'good');
        }


        function clearQaQueue() {
            forcedSpinQueue = [];
            refreshQaStateDisplay();
            setQaStatus('Forced reel queue cleared.', 'good');
        }


        function resetQaSession() {
            const clearSeedToggle = getQaNode('qaResetClearSeed');
            const clearDeterministic = Boolean(clearSeedToggle?.checked);
            const didReset = resetSessionState({ clearDeterministic, clearQueue: true });
            if (!didReset) {
                setQaStatus('Wait for spin to finish before reset.', 'warn');
                return;
            }
            setQaStatus(
                clearDeterministic
                    ? 'Balance/stats reset. Deterministic seed cleared.'
                    : 'Balance and stats reset to defaults.',
                'good'
            );
        }


        function queueAndSpin(symbolsOrMode, preferredSymbol) {
            if (Array.isArray(symbolsOrMode) || String(symbolsOrMode ?? '').includes(',')) {
                const queued = queueForcedSpin(symbolsOrMode);
                if (!queued) return null;
                if (!spinning && currentGame) spin();
                return queued;
            }

            const queued = queueForcedOutcome(symbolsOrMode, preferredSymbol);
            if (!queued) return null;
            if (!spinning && currentGame) spin();
            return queued;
        }


        // showBonusEffect() and showPageTransition() moved to animations.js

        // Sound system (toggleSound, getAudioContext, playSound, updateSoundButton)
        // moved to sound-manager.js

        function renderGameToText() {
            const slotModalOpen = document.getElementById('slotModal').classList.contains('active');
            const statsModalOpen = document.getElementById('statsModal').classList.contains('active');

            const payload = {
                coordinateSystem: 'DOM viewport pixels; origin is top-left; +x right, +y down.',
                mode: slotModalOpen ? 'slot' : (statsModalOpen ? 'stats' : 'lobby'),
                balance: Number(balance.toFixed(2)),
                spinning,
                currentBet,
                currentGame: currentGame
                    ? {
                        id: currentGame.id,
                        name: currentGame.name,
                        minBet: currentGame.minBet,
                        maxBet: currentGame.maxBet,
                        gridCols: getGridCols(currentGame),
                        gridRows: getGridRows(currentGame),
                        winType: getWinType(currentGame),
                        payoutTriple: currentGame.payouts && currentGame.payouts.triple,
                        payoutDouble: currentGame.payouts && currentGame.payouts.double
                    }
                    : null,
                reels: [...currentReels],
                grid: currentGrid,
                message: lastMessage,
                freeSpins: {
                    active: freeSpinsActive,
                    remaining: freeSpinsRemaining,
                    totalWin: freeSpinsTotalWin,
                    multiplier: freeSpinsMultiplier,
                    cascadeLevel: freeSpinsCascadeLevel,
                    expandedSymbol: freeSpinsExpandedSymbol
                },
                xp: { level: playerLevel, xp: playerXP, tier: getTier(playerLevel).name },
                debug: getDebugState(),
                stats: {
                    totalSpins: stats.totalSpins,
                    totalWagered: Number(stats.totalWagered.toFixed(2)),
                    totalWon: Number(stats.totalWon.toFixed(2)),
                    biggestWin: Number(stats.biggestWin.toFixed(2)),
                    gamesPlayed: stats.gamesPlayed
                }
            };

            return JSON.stringify(payload);
        }
