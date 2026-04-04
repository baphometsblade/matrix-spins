// ═══════════════════════════════════════════════════════════════════════════
// CASINO-ENGINE.JS v3.0.0 — Complete Shared Engine for Matrix Spins Casino
// ═══════════════════════════════════════════════════════════════════════════
// Single authoritative engine: accepts a game config object and runs any of
// the 100 games with zero logic duplication.
//
// Systems: Reel spin with momentum easing, weighted RNG, payline evaluation,
// RTP enforcement, near-miss logic, wild/scatter/free-spin handling, bonus
// hooks, autoplay engine, bet management, win celebration tiers, coin
// particle system, anticipation animations, screen shake, idle attract loop,
// mobile responsive layout engine, sound hook system, session tracker, and
// studio theme injection.
// ═══════════════════════════════════════════════════════════════════════════

(function(window) {
    'use strict';

    // ═══════════════════════════════════════════════════════════════════════
    // SECTION 1: WEIGHTED RNG SYSTEM
    // ═══════════════════════════════════════════════════════════════════════
    // Crypto-grade randomness on the client with weighted symbol distribution.
    // Server-authoritative spins override this for real-money play.

    var _rngBuffer = null;
    var _rngIndex = 0;
    var RNG_BUFFER_SIZE = 256;

    function _fillRngBuffer() {
        if (window.crypto && window.crypto.getRandomValues) {
            _rngBuffer = new Uint32Array(RNG_BUFFER_SIZE);
            window.crypto.getRandomValues(_rngBuffer);
        } else {
            _rngBuffer = new Uint32Array(RNG_BUFFER_SIZE);
            for (var i = 0; i < RNG_BUFFER_SIZE; i++) {
                _rngBuffer[i] = (Math.random() * 0xFFFFFFFF) >>> 0;
            }
        }
        _rngIndex = 0;
    }

    function secureRandom() {
        if (!_rngBuffer || _rngIndex >= RNG_BUFFER_SIZE) {
            _fillRngBuffer();
        }
        return _rngBuffer[_rngIndex++] / 0x100000000;
    }

    var SYMBOL_WEIGHTS = {
        '5x3':  [4, 6, 8, 12, 16, 22],
        '5x4':  [3, 5, 7, 11, 15, 24],
        '6x5':  [2, 4, 6, 10, 14, 26],
        '7x7':  [2, 3, 5, 9, 13, 28],
        '3x3':  [6, 8, 10, 14, 18, 20],
        '3x1':  [5, 8, 10, 14, 18, 22],
        '5x5':  [3, 5, 7, 10, 14, 24]
    };

    function weightedSymbolPick(game) {
        var symbols = game.symbols;
        if (!symbols || symbols.length === 0) return null;
        var key = (game.gridCols || 3) + 'x' + (game.gridRows || 1);
        var weights = SYMBOL_WEIGHTS[key] || SYMBOL_WEIGHTS['5x3'];

        var totalWeight = 0;
        var cumulative = [];
        for (var i = 0; i < symbols.length; i++) {
            var w = (i < weights.length) ? weights[i] : weights[weights.length - 1];
            totalWeight += w;
            cumulative.push(totalWeight);
        }

        var roll = secureRandom() * totalWeight;
        for (var j = 0; j < cumulative.length; j++) {
            if (roll < cumulative[j]) return symbols[j];
        }
        return symbols[symbols.length - 1];
    }

    function generateWeightedGrid(game) {
        var cols = game.gridCols || 3;
        var rows = game.gridRows || 1;
        var grid = [];
        for (var c = 0; c < cols; c++) {
            grid[c] = [];
            for (var r = 0; r < rows; r++) {
                grid[c][r] = weightedSymbolPick(game);
            }
        }
        return grid;
    }

    function generateSpinGrid(game, isFreeSpins) {
        if (window.HouseEdge && window.HouseEdge.generateGrid) {
            return window.HouseEdge.generateGrid(game, isFreeSpins || false);
        }
        return generateWeightedGrid(game);
    }


    // ═══════════════════════════════════════════════════════════════════════
    // SECTION 2: PAYLINE EVALUATION ENGINE
    // ═══════════════════════════════════════════════════════════════════════

    var PAYLINE_MIN_MATCH = 3;

    function getPaylines(game) {
        var cols = game.gridCols || 3;
        var rows = game.gridRows || 1;

        if (rows === 1) return [[0, 0, 0]];

        if (rows === 3 && cols === 3) {
            return [
                [0, 0, 0], [1, 1, 1], [2, 2, 2],
                [0, 1, 2], [2, 1, 0]
            ];
        }

        if (rows === 3 && cols === 5) {
            return [
                [1,1,1,1,1],[0,0,0,0,0],[2,2,2,2,2],
                [0,1,2,1,0],[2,1,0,1,2],[0,0,1,0,0],
                [2,2,1,2,2],[1,0,0,0,1],[1,2,2,2,1],
                [0,1,1,1,0],[2,1,1,1,2],[1,0,1,0,1],
                [1,2,1,2,1],[0,1,0,1,0],[2,1,2,1,2],
                [1,1,0,1,1],[1,1,2,1,1],[0,0,1,2,2],
                [2,2,1,0,0],[0,2,0,2,0]
            ];
        }

        if (rows === 4 && cols === 5) {
            return [
                [1,1,1,1,1],[2,2,2,2,2],[0,0,0,0,0],[3,3,3,3,3],
                [0,1,2,1,0],[3,2,1,2,3],[1,0,0,0,1],[2,3,3,3,2],
                [0,0,1,2,2],[3,3,2,1,1],[1,2,3,2,1],[2,1,0,1,2],
                [0,1,1,1,0],[3,2,2,2,3],[1,0,1,0,1],[2,3,2,3,2],
                [0,2,0,2,0],[3,1,3,1,3],[1,1,0,1,1],[2,2,3,2,2],
                [0,0,2,0,0],[3,3,1,3,3],[1,2,1,2,1],[2,1,2,1,2],
                [0,1,0,1,0],[3,2,3,2,3],[0,0,0,1,2],[3,3,3,2,1],
                [1,1,2,3,3],[2,2,1,0,0],[0,1,2,3,3],[3,2,1,0,0],
                [1,0,0,1,2],[2,3,3,2,1],[0,2,1,2,0],[3,1,2,1,3],
                [1,0,2,0,1],[2,3,1,3,2],[0,3,0,3,0],[1,2,0,2,1]
            ];
        }

        var lines = [];
        for (var r = 0; r < rows; r++) {
            var line = [];
            for (var ci = 0; ci < cols; ci++) line.push(r);
            lines.push(line);
        }
        return lines;
    }

    function isWild(symbol, game) {
        return game && game.wildSymbol && symbol === game.wildSymbol;
    }

    function isScatter(symbol, game) {
        return game && game.scatterSymbol && symbol === game.scatterSymbol;
    }

    function countScattersInGrid(grid, game) {
        if (!game || !game.scatterSymbol) return 0;
        var count = 0;
        for (var c = 0; c < grid.length; c++) {
            for (var r = 0; r < grid[c].length; r++) {
                if (grid[c][r] === game.scatterSymbol) count++;
            }
        }
        return count;
    }

    function countWildsInGrid(grid, game) {
        if (!game || !game.wildSymbol) return 0;
        var count = 0;
        for (var c = 0; c < grid.length; c++) {
            for (var r = 0; r < grid[c].length; r++) {
                if (grid[c][r] === game.wildSymbol) count++;
            }
        }
        return count;
    }

    function evaluatePaylines(grid, game) {
        var paylines = getPaylines(game);
        var cols = game.gridCols || 3;
        var wins = [];

        for (var lineIdx = 0; lineIdx < paylines.length; lineIdx++) {
            var line = paylines[lineIdx];
            var lineSymbols = [];
            for (var c = 0; c < Math.min(cols, line.length); c++) {
                var rowIdx = line[c];
                if (grid[c] && rowIdx >= 0 && rowIdx < grid[c].length) {
                    lineSymbols.push(grid[c][rowIdx]);
                }
            }
            if (lineSymbols.length === 0) continue;

            var firstSym = lineSymbols[0];
            var matchCount = 1;
            var effectiveSym = isWild(firstSym, game) ? null : firstSym;

            for (var i = 1; i < lineSymbols.length; i++) {
                var s = lineSymbols[i];
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

            if (matchCount >= PAYLINE_MIN_MATCH) {
                wins.push({
                    lineIndex: lineIdx,
                    line: line,
                    matchCount: matchCount,
                    symbol: effectiveSym || firstSym,
                    cells: line.slice(0, matchCount).map(function(row, col) { return [col, row]; })
                });
            }
        }

        return wins;
    }

    function findClusters(grid, game) {
        var cols = grid.length;
        var rows = grid[0].length;
        var visited = [];
        for (var vc = 0; vc < cols; vc++) {
            visited[vc] = [];
            for (var vr = 0; vr < rows; vr++) visited[vc][vr] = false;
        }
        var clusters = [];
        var clusterMin = game.clusterMin || 5;

        for (var c = 0; c < cols; c++) {
            for (var r = 0; r < rows; r++) {
                if (visited[c][r]) continue;
                var symbol = grid[c][r];
                if (!symbol || isWild(symbol, game)) continue;

                var cluster = [];
                var queue = [[c, r]];
                var qi = 0;
                visited[c][r] = true;

                while (qi < queue.length) {
                    var pos = queue[qi++];
                    var cc = pos[0], cr = pos[1];
                    cluster.push([cc, cr]);

                    var neighbors = [[cc-1,cr],[cc+1,cr],[cc,cr-1],[cc,cr+1]];
                    for (var n = 0; n < neighbors.length; n++) {
                        var nc = neighbors[n][0], nr = neighbors[n][1];
                        if (nc < 0 || nc >= cols || nr < 0 || nr >= rows) continue;
                        if (visited[nc][nr]) continue;
                        var nSym = grid[nc][nr];
                        if (nSym === symbol || isWild(nSym, game)) {
                            visited[nc][nr] = true;
                            queue.push([nc, nr]);
                        }
                    }
                }

                if (cluster.length >= clusterMin) {
                    clusters.push({ symbol: symbol, cells: cluster, size: cluster.length });
                }
            }
        }
        return clusters;
    }

    function getPayMultiplier(symbol, matchCount, game, winType) {
        var symIdx = game.symbols ? game.symbols.indexOf(symbol) : 0;
        if (symIdx < 0) symIdx = 0;

        if (window.HouseEdge) {
            if (winType === 'cluster') {
                return window.HouseEdge.getClusterPayMultiplier(symIdx, matchCount, game);
            } else if (winType === 'classic') {
                return window.HouseEdge.getClassicPayMultiplier(symIdx, matchCount, game);
            } else {
                return window.HouseEdge.getPaylinePayMultiplier(symIdx, matchCount, game);
            }
        }

        var tierMultipliers = {
            3: [0.08, 0.06, 0.05, 0.04, 0.03, 0.02],
            4: [0.20, 0.15, 0.12, 0.08, 0.06, 0.04],
            5: [0.60, 0.40, 0.30, 0.20, 0.15, 0.08]
        };
        var mc = Math.min(matchCount, 5);
        var tiers = tierMultipliers[mc] || tierMultipliers[3];
        return tiers[Math.min(symIdx, tiers.length - 1)];
    }

    function capWin(winAmount, bet, game) {
        if (window.HouseEdge && window.HouseEdge.capWin) {
            return window.HouseEdge.capWin(winAmount, bet, game);
        }
        return Math.min(winAmount, bet * 200);
    }


    // ═══════════════════════════════════════════════════════════════════════
    // SECTION 3: RTP ENFORCEMENT
    // ═══════════════════════════════════════════════════════════════════════

    var TARGET_RTP = 0.88;

    function shouldAllowWin(game) {
        if (window.HouseEdge && window.HouseEdge.shouldAllowWin) {
            return window.HouseEdge.shouldAllowWin(game);
        }
        return true;
    }

    function recordSpinForRTP(bet, win, game) {
        if (window.HouseEdge && window.HouseEdge.recordSpin) {
            window.HouseEdge.recordSpin(bet, win, game ? game.id : 'unknown');
        }
    }

    function getProfitStatus() {
        if (window.HouseEdge && window.HouseEdge.getProfitStatus) {
            return window.HouseEdge.getProfitStatus();
        }
        return { rtp: 0, profit: 0, spins: 0 };
    }


    // ═══════════════════════════════════════════════════════════════════════
    // SECTION 4: REEL SPIN PHYSICS & MOMENTUM EASING
    // ═══════════════════════════════════════════════════════════════════════

    function smoothstep(t) {
        t = Math.max(0, Math.min(1, t));
        return t * t * (3 - 2 * t);
    }

    function easeOutCubic(t) {
        t = Math.max(0, Math.min(1, t));
        return 1 - Math.pow(1 - t, 3);
    }

    function easeOutBack(t) {
        var c1 = 1.70158;
        var c3 = c1 + 1;
        return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
    }

    var ReelPhysics = {
        SPINUP_DURATION: 300,
        SPEED_VARIANCE: 0.08,
        CASCADE_STAGGER: 25,
        STOP_DURATION_BASE: 650,
        STOP_DURATION_NEARMISS: 1100,
        BOUNCE_SCALE_PER_REEL: 1.4,
        BOUNCE_MAX_PX: 28,
        BOUNCE_DURATION: 260,

        getReelSpeed: function(baseSpeed, reelIndex) {
            var variance = (secureRandom() - 0.5) * 2 * this.SPEED_VARIANCE;
            return baseSpeed * (1 + variance);
        },

        getLaunchDelay: function(reelIndex) {
            return reelIndex * this.CASCADE_STAGGER;
        },

        getBounceAmount: function(reelIndex) {
            var amount = 8 * Math.pow(this.BOUNCE_SCALE_PER_REEL, reelIndex);
            return Math.min(amount, this.BOUNCE_MAX_PX);
        },

        getStopDuration: function(isNearMiss) {
            return isNearMiss ? this.STOP_DURATION_NEARMISS : this.STOP_DURATION_BASE;
        },

        spinUpPosition: function(elapsed, totalDistance) {
            var t = Math.min(elapsed / this.SPINUP_DURATION, 1);
            return smoothstep(t) * totalDistance;
        },

        deceleratePosition: function(elapsed, stopDuration, totalDistance) {
            var t = Math.min(elapsed / stopDuration, 1);
            return easeOutCubic(t) * totalDistance;
        },

        bounceOffset: function(elapsed, reelIndex) {
            var t = Math.min(elapsed / this.BOUNCE_DURATION, 1);
            var maxBounce = this.getBounceAmount(reelIndex);
            var decay = 1 - t;
            return maxBounce * Math.sin(t * Math.PI) * decay;
        },

        getReelTimeline: function(reelIndex, totalReels, isNearMiss) {
            var launchDelay = this.getLaunchDelay(reelIndex);
            var stopDelay = reelIndex * 120;
            var stopDuration = this.getStopDuration(isNearMiss && reelIndex >= totalReels - 1);

            return {
                launchDelay: launchDelay,
                spinUpEnd: launchDelay + this.SPINUP_DURATION,
                stopBegin: launchDelay + this.SPINUP_DURATION + 400 + stopDelay,
                stopDuration: stopDuration,
                bounceBegin: launchDelay + this.SPINUP_DURATION + 400 + stopDelay + stopDuration,
                bounceDuration: this.BOUNCE_DURATION,
                bounceAmount: this.getBounceAmount(reelIndex),
                speed: this.getReelSpeed(1.0, reelIndex)
            };
        }
    };


    // ═══════════════════════════════════════════════════════════════════════
    // SECTION 5: NEAR-MISS DETECTION
    // ═══════════════════════════════════════════════════════════════════════

    var NearMiss = {
        check: function(grid, game) {
            if (!grid || grid.length < 3) return false;
            var rows = grid[0].length;
            for (var r = 0; r < rows; r++) {
                var matches = {};
                for (var c = 0; c < Math.min(grid.length, 3); c++) {
                    var sym = grid[c][r];
                    matches[sym] = (matches[sym] || 0) + 1;
                }
                for (var sym in matches) {
                    if (matches.hasOwnProperty(sym) && matches[sym] === 2) {
                        return { symbol: sym, row: r, startReel: 2 };
                    }
                }
            }
            return false;
        },

        applyTension: function(reelElements, nearMissData) {
            if (!nearMissData || !reelElements) return;
            var startReel = nearMissData.startReel || 2;
            for (var i = startReel; i < reelElements.length; i++) {
                if (reelElements[i]) {
                    reelElements[i].classList.add('near-miss-decel');
                    reelElements[i].classList.add('reel-near-miss-tension');
                }
            }
        },

        clearTension: function(reelElements) {
            if (!reelElements) return;
            for (var i = 0; i < reelElements.length; i++) {
                if (reelElements[i]) {
                    reelElements[i].classList.remove('near-miss-decel');
                    reelElements[i].classList.remove('reel-near-miss-tension');
                }
            }
        }
    };


    // ═══════════════════════════════════════════════════════════════════════
    // SECTION 6: FREE SPIN / SCATTER / WILD STATE MANAGEMENT
    // ═══════════════════════════════════════════════════════════════════════

    var FreeSpinState = {
        _active: false,
        _remaining: 0,
        _totalAwarded: 0,
        _totalWon: 0,
        _multiplier: 1,
        _cascadeLevel: 0,
        _triggerCallback: null,
        _completeCallback: null,

        isActive: function() { return this._active; },
        remaining: function() { return this._remaining; },
        multiplier: function() { return this._multiplier; },
        cascadeLevel: function() { return this._cascadeLevel; },

        checkTrigger: function(grid, game) {
            var scatterCount = countScattersInGrid(grid, game);
            var threshold = game.freeSpinsTrigger || 3;
            if (scatterCount >= threshold) {
                var count = game.freeSpinsCount || 10;
                if (scatterCount > threshold) {
                    count += (scatterCount - threshold) * (game.extraSpinsPerScatter || 2);
                }
                return count;
            }
            return 0;
        },

        trigger: function(count, game) {
            if (this._active) {
                this._remaining += count;
                this._totalAwarded += count;
            } else {
                this._active = true;
                this._remaining = count;
                this._totalAwarded = count;
                this._totalWon = 0;
                this._multiplier = game.freeSpinsMultiplier || 1;
                this._cascadeLevel = 0;
            }
            SoundHooks.trigger('free_spins_trigger');
            if (this._triggerCallback) {
                this._triggerCallback(count, this._remaining, this._totalAwarded);
            }
        },

        consume: function() {
            if (!this._active || this._remaining <= 0) return false;
            this._remaining--;
            return true;
        },

        recordWin: function(amount) {
            this._totalWon += amount;
        },

        advanceCascade: function() {
            this._cascadeLevel++;
        },

        resetCascade: function() {
            this._cascadeLevel = 0;
        },

        complete: function() {
            var summary = {
                totalAwarded: this._totalAwarded,
                totalWon: this._totalWon,
                active: false
            };
            this._active = false;
            this._remaining = 0;
            this._totalAwarded = 0;
            this._cascadeLevel = 0;
            SoundHooks.trigger('free_spins_complete');
            if (this._completeCallback) {
                this._completeCallback(summary);
            }
            return summary;
        },

        onTrigger: function(fn) { this._triggerCallback = fn; },
        onComplete: function(fn) { this._completeCallback = fn; },

        reset: function() {
            this._active = false;
            this._remaining = 0;
            this._totalAwarded = 0;
            this._totalWon = 0;
            this._multiplier = 1;
            this._cascadeLevel = 0;
        }
    };


    // ═══════════════════════════════════════════════════════════════════════
    // SECTION 7: BONUS ROUND HOOKS
    // ═══════════════════════════════════════════════════════════════════════

    var BonusHooks = {
        _hooks: {},

        register: function(gameId, config) {
            this._hooks[gameId] = config;
        },

        check: function(grid, game) {
            if (!game || !game.id) return null;
            var hook = this._hooks[game.id];
            if (hook && hook.trigger && hook.trigger(grid, game)) {
                return hook;
            }
            return null;
        },

        activate: function(grid, game) {
            var hook = this.check(grid, game);
            if (hook && hook.activate) {
                SoundHooks.trigger('bonus_trigger');
                hook.activate(grid, game);
                return true;
            }
            return false;
        },

        getLabel: function(gameId) {
            var hook = this._hooks[gameId];
            return hook ? (hook.label || 'BONUS') : null;
        },

        unregister: function(gameId) {
            delete this._hooks[gameId];
        }
    };


    // ═══════════════════════════════════════════════════════════════════════
    // SECTION 8: WIN CELEBRATION SYSTEM (5 TIERS)
    // ═══════════════════════════════════════════════════════════════════════

    var WIN_TIERS = {
        small:   { minMultiplier: 1,   label: 'WIN',         duration: 1200, shake: 0,  particles: 8,   color: '#FFD700', bloom: 0 },
        medium:  { minMultiplier: 5,   label: 'BIG WIN!',    duration: 2000, shake: 2,  particles: 25,  color: '#FF6B35', bloom: 0 },
        big:     { minMultiplier: 15,  label: 'HUGE WIN!',   duration: 3000, shake: 4,  particles: 50,  color: '#E91E63', bloom: 1.25 },
        mega:    { minMultiplier: 50,  label: 'MEGA WIN!!',  duration: 4500, shake: 6,  particles: 80,  color: '#9C27B0', bloom: 1.4 },
        jackpot: { minMultiplier: 200, label: 'JACKPOT!!!',  duration: 6000, shake: 10, particles: 150, color: '#FF0000', bloom: 1.5 }
    };

    function getWinTier(winAmount, betAmount) {
        if (!betAmount || betAmount <= 0) return null;
        var mult = winAmount / betAmount;
        if (mult >= WIN_TIERS.jackpot.minMultiplier) return 'jackpot';
        if (mult >= WIN_TIERS.mega.minMultiplier) return 'mega';
        if (mult >= WIN_TIERS.big.minMultiplier) return 'big';
        if (mult >= WIN_TIERS.medium.minMultiplier) return 'medium';
        if (mult >= WIN_TIERS.small.minMultiplier) return 'small';
        return null;
    }

    var _celebrationTimer = null;

    /** Helper: safely build DOM elements without innerHTML */
    function _buildElement(tag, className, textContent) {
        var el = document.createElement(tag);
        if (className) el.className = className;
        if (textContent) el.textContent = textContent;
        return el;
    }

    function showWinCelebration(winAmount, betAmount, containerEl) {
        var tier = getWinTier(winAmount, betAmount);
        if (!tier) return;
        var config = WIN_TIERS[tier];
        var container = containerEl || document.querySelector('.reels-frame') || document.querySelector('.reels-container') || document.getElementById('reels');
        if (!container) return;

        if (_celebrationTimer) { clearTimeout(_celebrationTimer); hideCelebration(); }

        // Build overlay using safe DOM methods
        var overlay = _buildElement('div', 'ce-win-overlay ce-win-' + tier);
        overlay.id = 'ce-win-overlay';
        var label = _buildElement('div', 'ce-win-label', config.label);
        var amount = _buildElement('div', 'ce-win-amount', '$' + winAmount.toFixed(2));
        overlay.appendChild(label);
        overlay.appendChild(amount);
        container.style.position = 'relative';
        container.appendChild(overlay);

        // Bloom effect for big+ wins
        if (config.bloom > 0) {
            container.style.filter = 'brightness(' + config.bloom + ') saturate(' + (config.bloom * 0.95) + ')';
            container.style.transition = 'filter 0.4s ease';
        }

        // Screen shake
        if (config.shake > 0) {
            ScreenShake.start(container, config.shake, config.duration);
        }

        // Coin particles — studio theme overrides color
        var particleColor = config.color;
        if (_activeStudioTheme && _activeStudioTheme.particleColor) {
            particleColor = _activeStudioTheme.particleColor;
        }
        if (config.particles > 0) {
            CoinParticleSystem.burst(container, config.particles, particleColor);
        }

        // Studio theme celebration background
        if (_activeStudioTheme && _activeStudioTheme.celebBg) {
            overlay.style.background = _activeStudioTheme.celebBg;
        }

        SoundHooks.trigger('win_' + tier);

        _celebrationTimer = setTimeout(function() {
            hideCelebration();
            if (config.bloom > 0 && container) {
                container.style.filter = '';
            }
        }, config.duration);

        return tier;
    }

    function hideCelebration() {
        var overlay = document.getElementById('ce-win-overlay');
        if (overlay) overlay.remove();
        ScreenShake.stop();
        _celebrationTimer = null;
    }


    // ═══════════════════════════════════════════════════════════════════════
    // SECTION 9: COIN PARTICLE SYSTEM
    // ═══════════════════════════════════════════════════════════════════════

    var CoinParticleSystem = {
        _pool: [],
        _animFrame: null,

        burst: function(container, count, color) {
            if (!container) return;
            var rect = container.getBoundingClientRect();
            var canvas = document.getElementById('ce-particle-canvas');
            if (!canvas) {
                canvas = document.createElement('canvas');
                canvas.id = 'ce-particle-canvas';
                canvas.style.cssText = 'position:fixed;top:0;left:0;width:100vw;height:100vh;pointer-events:none;z-index:99999;';
                document.body.appendChild(canvas);
            }
            canvas.width = window.innerWidth;
            canvas.height = window.innerHeight;

            var cx = rect.left + rect.width / 2;
            var cy = rect.top + rect.height / 2;

            for (var i = 0; i < count; i++) {
                var angle = secureRandom() * Math.PI * 2;
                var speed = 4 + secureRandom() * 10;
                this._pool.push({
                    x: cx + (secureRandom() - 0.5) * rect.width * 0.6,
                    y: cy + (secureRandom() - 0.5) * rect.height * 0.3,
                    vx: Math.cos(angle) * speed,
                    vy: -Math.abs(Math.sin(angle)) * speed - 3,
                    size: 4 + secureRandom() * 8,
                    alpha: 1,
                    color: color || '#FFD700',
                    rotation: secureRandom() * 360,
                    rotSpeed: (secureRandom() - 0.5) * 12,
                    gravity: 0.25 + secureRandom() * 0.15,
                    life: 1,
                    shimmer: secureRandom() > 0.5
                });
            }

            if (!this._animFrame) this._animate();
        },

        _animate: function() {
            var canvas = document.getElementById('ce-particle-canvas');
            if (!canvas || this._pool.length === 0) {
                if (canvas) {
                    var ctx = canvas.getContext('2d');
                    ctx.clearRect(0, 0, canvas.width, canvas.height);
                }
                this._animFrame = null;
                return;
            }
            var ctx = canvas.getContext('2d');
            ctx.clearRect(0, 0, canvas.width, canvas.height);

            var alive = [];
            for (var i = 0; i < this._pool.length; i++) {
                var p = this._pool[i];
                p.vy += p.gravity;
                p.x += p.vx;
                p.y += p.vy;
                p.vx *= 0.995;
                p.rotation += p.rotSpeed;
                p.life -= 0.012;
                p.alpha = Math.max(0, p.life);

                if (p.life > 0 && p.y < canvas.height + 20) {
                    alive.push(p);
                    ctx.save();
                    ctx.globalAlpha = p.alpha;
                    ctx.translate(p.x, p.y);
                    ctx.rotate(p.rotation * Math.PI / 180);

                    ctx.fillStyle = p.color;
                    ctx.beginPath();
                    ctx.ellipse(0, 0, p.size, p.size * 0.7, 0, 0, Math.PI * 2);
                    ctx.fill();

                    ctx.strokeStyle = 'rgba(0,0,0,0.2)';
                    ctx.lineWidth = 0.5;
                    ctx.stroke();

                    ctx.fillStyle = 'rgba(255,255,255,' + (p.shimmer ? '0.5' : '0.3') + ')';
                    ctx.beginPath();
                    ctx.ellipse(-p.size * 0.2, -p.size * 0.15, p.size * 0.35, p.size * 0.2, -0.3, 0, Math.PI * 2);
                    ctx.fill();

                    ctx.restore();
                }
            }
            this._pool = alive;
            var self = this;
            this._animFrame = requestAnimationFrame(function() { self._animate(); });
        },

        clear: function() {
            this._pool = [];
            var canvas = document.getElementById('ce-particle-canvas');
            if (canvas) {
                var ctx = canvas.getContext('2d');
                ctx.clearRect(0, 0, canvas.width, canvas.height);
            }
            if (this._animFrame) {
                cancelAnimationFrame(this._animFrame);
                this._animFrame = null;
            }
        }
    };


    // ═══════════════════════════════════════════════════════════════════════
    // SECTION 10: SCREEN SHAKE SYSTEM
    // ═══════════════════════════════════════════════════════════════════════

    var ScreenShake = {
        _animFrame: null,
        _container: null,
        _intensity: 0,
        _startTime: 0,
        _duration: 0,

        start: function(container, intensity, duration) {
            this.stop();
            this._container = container;
            this._intensity = intensity;
            this._startTime = performance.now();
            this._duration = duration || 300;
            this._animate();
        },

        _animate: function() {
            var now = performance.now();
            var elapsed = now - this._startTime;
            if (elapsed > this._duration || !this._container) {
                this.stop();
                return;
            }

            var progress = elapsed / this._duration;
            var decay = 1 - progress;
            var currentIntensity = this._intensity * decay;

            var x = (secureRandom() - 0.5) * 2 * currentIntensity;
            var y = (secureRandom() - 0.5) * 2 * currentIntensity;
            this._container.style.transform = 'translate(' + x.toFixed(1) + 'px, ' + y.toFixed(1) + 'px)';

            var self = this;
            this._animFrame = requestAnimationFrame(function() { self._animate(); });
        },

        stop: function() {
            if (this._animFrame) {
                cancelAnimationFrame(this._animFrame);
                this._animFrame = null;
            }
            if (this._container) {
                this._container.style.transform = '';
                this._container = null;
            }
        }
    };


    // ═══════════════════════════════════════════════════════════════════════
    // SECTION 11: ANTICIPATION ANIMATION
    // ═══════════════════════════════════════════════════════════════════════

    var Anticipation = {
        _active: false,

        check: function(grid, game) {
            if (!grid || !grid[0] || !grid[1]) return false;
            if (grid.length < 3) return false;

            var rows = grid[0].length;
            for (var r = 0; r < rows; r++) {
                var sym0 = grid[0][r];
                var sym1 = grid[1][r];
                if (sym0 === sym1 || isWild(sym0, game) || isWild(sym1, game)) {
                    var effectiveSym = isWild(sym0, game) ? sym1 : sym0;
                    return { symbol: effectiveSym, row: r, startReel: 2 };
                }
            }
            return false;
        },

        apply: function(reelElements, anticipationData) {
            if (!anticipationData || !reelElements) return;
            this._active = true;
            var startReel = anticipationData.startReel || 2;

            for (var i = startReel; i < reelElements.length; i++) {
                var reel = reelElements[i];
                if (reel) {
                    reel.classList.add('ce-anticipation');
                    reel.style.setProperty('--ce-antic-delay', ((i - startReel) * 0.4) + 's');
                }
            }

            SoundHooks.trigger('anticipation');
        },

        clear: function(reelElements) {
            this._active = false;
            if (!reelElements) return;
            for (var i = 0; i < reelElements.length; i++) {
                if (reelElements[i]) {
                    reelElements[i].classList.remove('ce-anticipation');
                }
            }
        },

        isActive: function() { return this._active; }
    };


    // ═══════════════════════════════════════════════════════════════════════
    // SECTION 12: AUTOPLAY ENGINE
    // ═══════════════════════════════════════════════════════════════════════

    var AutoplayEngine = {
        _running: false,
        _remaining: 0,
        _config: {
            totalSpins: 10,
            stopOnFeature: true,
            stopOnWinAbove: 0,
            stopOnBalanceBelow: 0,
            stopOnLossLimit: 0,
            delayMs: 1500
        },
        _spinFn: null,
        _timer: null,
        _sessionLoss: 0,

        configure: function(opts) {
            if (opts.totalSpins) this._config.totalSpins = Math.min(Math.max(opts.totalSpins, 1), 1000);
            if (opts.stopOnFeature !== undefined) this._config.stopOnFeature = !!opts.stopOnFeature;
            if (opts.stopOnWinAbove !== undefined) this._config.stopOnWinAbove = parseFloat(opts.stopOnWinAbove) || 0;
            if (opts.stopOnBalanceBelow !== undefined) this._config.stopOnBalanceBelow = parseFloat(opts.stopOnBalanceBelow) || 0;
            if (opts.stopOnLossLimit !== undefined) this._config.stopOnLossLimit = parseFloat(opts.stopOnLossLimit) || 0;
            if (opts.delayMs) this._config.delayMs = Math.min(Math.max(opts.delayMs, 500), 5000);
        },

        start: function(spinFunction) {
            if (this._running) return;
            this._spinFn = spinFunction;
            this._remaining = this._config.totalSpins;
            this._running = true;
            this._sessionLoss = 0;
            this._updateUI();
            this._next();
            SoundHooks.trigger('autoplay_start');
        },

        stop: function() {
            this._running = false;
            this._remaining = 0;
            clearTimeout(this._timer);
            this._updateUI();
            SoundHooks.trigger('autoplay_stop');
        },

        isRunning: function() { return this._running; },

        onSpinComplete: function(result) {
            if (!this._running) return;

            this._remaining--;

            if (result && result.netResult !== undefined) {
                if (result.netResult < 0) this._sessionLoss += Math.abs(result.netResult);
            }

            if (this._remaining <= 0) { this.stop(); return; }
            if (this._config.stopOnFeature && result && result.isFeature) { this.stop(); return; }
            if (this._config.stopOnWinAbove > 0 && result && result.winAmount >= this._config.stopOnWinAbove) { this.stop(); return; }
            if (this._config.stopOnBalanceBelow > 0) {
                var bal = (typeof window.currentBalance !== 'undefined') ? window.currentBalance : 0;
                if (bal <= this._config.stopOnBalanceBelow) { this.stop(); return; }
            }
            if (this._config.stopOnLossLimit > 0 && this._sessionLoss >= this._config.stopOnLossLimit) { this.stop(); return; }

            this._updateUI();
            var self = this;
            this._timer = setTimeout(function() { self._next(); }, this._config.delayMs);
        },

        _next: function() {
            if (!this._running || !this._spinFn) { this.stop(); return; }
            try { this._spinFn(); } catch(e) { console.warn('[Autoplay] Spin error:', e); this.stop(); }
        },

        _updateUI: function() {
            var badge = document.getElementById('ce-autoplay-badge');
            if (this._running) {
                if (!badge) {
                    badge = _buildElement('div', 'ce-autoplay-badge');
                    badge.id = 'ce-autoplay-badge';
                    var spinBtn = document.querySelector('.spin-btn') || document.querySelector('#spinBtn');
                    if (spinBtn && spinBtn.parentNode) spinBtn.parentNode.appendChild(badge);
                }
                if (badge) badge.textContent = this._remaining + ' spins';
            } else {
                if (badge) badge.remove();
            }
        }
    };


    // ═══════════════════════════════════════════════════════════════════════
    // SECTION 13: BET LEVEL MANAGEMENT
    // ═══════════════════════════════════════════════════════════════════════

    var BetManager = {
        _levels: [0.20, 0.50, 1.00, 2.00, 5.00, 10.00, 20.00, 50.00, 100.00],
        _currentIndex: 2,
        _minBet: 0.20,
        _maxBet: 100.00,
        _onChange: null,

        init: function(gameConfig) {
            if (gameConfig) {
                this._minBet = gameConfig.minBet || 0.20;
                this._maxBet = gameConfig.maxBet || 100.00;
                var self = this;
                this._levels = [0.20, 0.50, 1.00, 2.00, 5.00, 10.00, 20.00, 50.00, 100.00].filter(function(b) {
                    return b >= self._minBet && b <= self._maxBet;
                });
                if (this._levels.length === 0) this._levels = [this._minBet];
                this._currentIndex = Math.min(2, this._levels.length - 1);
            }
        },

        current: function() { return this._levels[this._currentIndex]; },

        increase: function() {
            if (this._currentIndex < this._levels.length - 1) {
                this._currentIndex++;
                if (this._onChange) this._onChange(this.current());
            }
            return this.current();
        },

        decrease: function() {
            if (this._currentIndex > 0) {
                this._currentIndex--;
                if (this._onChange) this._onChange(this.current());
            }
            return this.current();
        },

        setMax: function() {
            this._currentIndex = this._levels.length - 1;
            if (this._onChange) this._onChange(this.current());
            return this.current();
        },

        setMin: function() {
            this._currentIndex = 0;
            if (this._onChange) this._onChange(this.current());
            return this.current();
        },

        getLevels: function() { return this._levels.slice(); },

        onChange: function(fn) { this._onChange = fn; }
    };


    // ═══════════════════════════════════════════════════════════════════════
    // SECTION 14: SESSION TRACKER
    // ═══════════════════════════════════════════════════════════════════════

    var SessionTracker = {
        _data: {
            spinsPlayed: 0,
            totalWagered: 0,
            totalWon: 0,
            biggestWin: 0,
            biggestMultiplier: 0,
            startTime: Date.now(),
            currentStreak: 0,
            longestWinStreak: 0,
            longestLossStreak: 0,
            currentLossStreak: 0,
            featuresTriggered: 0,
            gamesPlayed: {}
        },

        reset: function() {
            this._data = {
                spinsPlayed: 0, totalWagered: 0, totalWon: 0, biggestWin: 0,
                biggestMultiplier: 0, startTime: Date.now(), currentStreak: 0,
                longestWinStreak: 0, longestLossStreak: 0, currentLossStreak: 0,
                featuresTriggered: 0, gamesPlayed: {}
            };
        },

        recordSpin: function(bet, win, isFeature, gameId) {
            this._data.spinsPlayed++;
            this._data.totalWagered += bet;
            this._data.totalWon += win;
            if (win > this._data.biggestWin) this._data.biggestWin = win;
            if (bet > 0 && (win / bet) > this._data.biggestMultiplier) {
                this._data.biggestMultiplier = win / bet;
            }
            if (isFeature) this._data.featuresTriggered++;

            if (gameId) {
                if (!this._data.gamesPlayed[gameId]) {
                    this._data.gamesPlayed[gameId] = { spins: 0, wagered: 0, won: 0 };
                }
                this._data.gamesPlayed[gameId].spins++;
                this._data.gamesPlayed[gameId].wagered += bet;
                this._data.gamesPlayed[gameId].won += win;
            }

            if (win > 0) {
                this._data.currentStreak++;
                this._data.currentLossStreak = 0;
                if (this._data.currentStreak > this._data.longestWinStreak) {
                    this._data.longestWinStreak = this._data.currentStreak;
                }
            } else {
                this._data.currentLossStreak++;
                this._data.currentStreak = 0;
                if (this._data.currentLossStreak > this._data.longestLossStreak) {
                    this._data.longestLossStreak = this._data.currentLossStreak;
                }
            }
        },

        getStats: function() {
            var elapsed = Date.now() - this._data.startTime;
            return {
                spinsPlayed: this._data.spinsPlayed,
                totalWagered: this._data.totalWagered,
                totalWon: this._data.totalWon,
                netResult: this._data.totalWon - this._data.totalWagered,
                biggestWin: this._data.biggestWin,
                biggestMultiplier: this._data.biggestMultiplier,
                sessionRTP: this._data.totalWagered > 0 ? (this._data.totalWon / this._data.totalWagered * 100) : 0,
                playTime: Math.floor(elapsed / 60000),
                avgBet: this._data.spinsPlayed > 0 ? (this._data.totalWagered / this._data.spinsPlayed) : 0,
                winRate: this._data.spinsPlayed > 0 ? (this._data.currentStreak / this._data.spinsPlayed * 100) : 0,
                longestWinStreak: this._data.longestWinStreak,
                longestLossStreak: this._data.longestLossStreak,
                featuresTriggered: this._data.featuresTriggered,
                gamesPlayed: this._data.gamesPlayed
            };
        },

        getTimePlayed: function() {
            var mins = Math.floor((Date.now() - this._data.startTime) / 60000);
            if (mins < 60) return mins + 'm';
            return Math.floor(mins / 60) + 'h ' + (mins % 60) + 'm';
        },

        getCurrentLossStreak: function() {
            return this._data.currentLossStreak;
        }
    };


    // ═══════════════════════════════════════════════════════════════════════
    // SECTION 15: WIN LINE FLASH
    // ═══════════════════════════════════════════════════════════════════════

    var WinLineFlash = {
        _elements: [],
        _canvas: null,

        highlight: function(positions, container) {
            this.clear();
            if (!positions || !container) return;

            for (var i = 0; i < positions.length; i++) {
                var pos = positions[i];
                var cell = container.querySelector('[data-col="' + pos.col + '"][data-row="' + pos.row + '"]') ||
                           document.getElementById('cell_' + pos.col + '_' + pos.row);
                if (cell) {
                    cell.classList.add('ce-win-cell');
                    this._elements.push(cell);
                }
            }
        },

        drawLines: function(winLines, container) {
            if (!winLines || winLines.length === 0 || !container) return;

            var canvas = document.getElementById('ce-winline-canvas');
            if (!canvas) {
                canvas = document.createElement('canvas');
                canvas.id = 'ce-winline-canvas';
                canvas.style.cssText = 'position:absolute;top:0;left:0;pointer-events:none;z-index:20;border-radius:inherit;';
                if (getComputedStyle(container).position === 'static') container.style.position = 'relative';
                container.appendChild(canvas);
            }

            var rect = container.getBoundingClientRect();
            canvas.width = rect.width;
            canvas.height = rect.height;
            this._canvas = canvas;

            var LINE_COLORS = ['#fbbf24','#a78bfa','#34d399','#60a5fa','#f472b6','#fb923c','#e879f9'];

            function getCellCenter(col, row) {
                var cell = document.getElementById('cell_' + col + '_' + row);
                if (!cell) return null;
                var cr = cell.getBoundingClientRect();
                return { x: cr.left - rect.left + cr.width / 2, y: cr.top - rect.top + cr.height / 2 };
            }

            var ctx = canvas.getContext('2d');
            var seq = [1, 0, 1, 0, 1, 0.8, 0.5, 0.2, 0];
            var step = 0;

            function drawFrame(alpha) {
                ctx.clearRect(0, 0, canvas.width, canvas.height);
                ctx.globalAlpha = alpha;
                for (var idx = 0; idx < winLines.length; idx++) {
                    var win = winLines[idx];
                    var color = LINE_COLORS[idx % LINE_COLORS.length];
                    var points = win.cells.map(function(pair) { return getCellCenter(pair[0], pair[1]); }).filter(Boolean);
                    if (points.length < 2) continue;
                    ctx.beginPath();
                    ctx.moveTo(points[0].x, points[0].y);
                    for (var p = 1; p < points.length; p++) ctx.lineTo(points[p].x, points[p].y);
                    ctx.strokeStyle = color;
                    ctx.lineWidth = 3;
                    ctx.shadowColor = color;
                    ctx.shadowBlur = 14;
                    ctx.lineCap = 'round';
                    ctx.lineJoin = 'round';
                    ctx.stroke();
                    for (var d = 0; d < points.length; d++) {
                        if (d === 0 || d === points.length - 1) {
                            ctx.beginPath();
                            ctx.arc(points[d].x, points[d].y, 5, 0, Math.PI * 2);
                            ctx.fillStyle = color;
                            ctx.fill();
                        }
                    }
                }
                ctx.globalAlpha = 1;
                ctx.shadowBlur = 0;
            }

            function tick() {
                if (step >= seq.length) { ctx.clearRect(0, 0, canvas.width, canvas.height); return; }
                drawFrame(seq[step]);
                step++;
                setTimeout(tick, step <= 4 ? 160 : 220);
            }
            setTimeout(tick, 80);
        },

        clear: function() {
            for (var i = 0; i < this._elements.length; i++) {
                this._elements[i].classList.remove('ce-win-cell');
            }
            this._elements = [];
            if (this._canvas) {
                var ctx = this._canvas.getContext('2d');
                ctx.clearRect(0, 0, this._canvas.width, this._canvas.height);
            }
        }
    };


    // ═══════════════════════════════════════════════════════════════════════
    // SECTION 16: IDLE ATTRACT LOOP
    // ═══════════════════════════════════════════════════════════════════════

    var IdleAttract = {
        _timer: null,
        _active: false,
        _timeout: 30000,
        _demoReelTimer: null,

        start: function() {
            this.reset();
        },

        reset: function() {
            if (this._active) this.stop();
            clearTimeout(this._timer);
            var self = this;
            this._timer = setTimeout(function() { self._activate(); }, this._timeout);
        },

        stop: function() {
            this._active = false;
            clearTimeout(this._timer);
            clearInterval(this._demoReelTimer);
            var overlay = document.getElementById('ce-attract-overlay');
            if (overlay) overlay.remove();
        },

        _activate: function() {
            this._active = true;
            var container = document.querySelector('.reels-frame') || document.querySelector('.reels-container') || document.getElementById('reels');
            if (!container) return;

            // Build attract overlay using safe DOM methods
            var overlay = _buildElement('div', 'ce-attract-overlay');
            overlay.id = 'ce-attract-overlay';
            var content = _buildElement('div', 'ce-attract-content');
            var logo = _buildElement('div', 'ce-attract-logo', 'MATRIX SPINS');
            var text = _buildElement('div', 'ce-attract-text', 'Tap to Play');
            var shimmer = _buildElement('div', 'ce-attract-shimmer');
            content.appendChild(logo);
            content.appendChild(text);
            content.appendChild(shimmer);
            overlay.appendChild(content);
            container.style.position = 'relative';
            container.appendChild(overlay);

            var self = this;
            this._demoReelTimer = setInterval(function() {
                if (!self._active) return;
                CoinParticleSystem.burst(container, 5, '#FFD700');
            }, 3000);

            overlay.addEventListener('click', function() {
                IdleAttract.reset();
            });

            SoundHooks.trigger('attract_mode');
        },

        isActive: function() { return this._active; },

        setTimeout: function(ms) {
            this._timeout = Math.max(5000, ms);
        }
    };

    if (!window._ceIdleListenersAttached) {
        window._ceIdleListenersAttached = true;
        ['click', 'touchstart', 'keydown', 'mousemove'].forEach(function(evt) {
            document.addEventListener(evt, function() {
                if (IdleAttract._timer) IdleAttract.reset();
            }, { passive: true });
        });
    }


    // ═══════════════════════════════════════════════════════════════════════
    // SECTION 17: MOBILE RESPONSIVE LAYOUT ENGINE
    // ═══════════════════════════════════════════════════════════════════════

    var MobileLayout = {
        _isPortrait: false,
        _isMobile: false,
        _isTablet: false,
        _breakpoints: { mobile: 768, tablet: 1024 },
        _onChangeCallbacks: [],

        init: function() {
            this._check();
            var self = this;
            window.addEventListener('resize', function() { self._check(); });
            window.addEventListener('orientationchange', function() {
                setTimeout(function() { self._check(); }, 100);
            });
        },

        _check: function() {
            var prevMobile = this._isMobile;
            var prevPortrait = this._isPortrait;

            this._isMobile = window.innerWidth <= this._breakpoints.mobile;
            this._isTablet = window.innerWidth > this._breakpoints.mobile && window.innerWidth <= this._breakpoints.tablet;
            this._isPortrait = window.innerHeight > window.innerWidth;

            document.body.classList.toggle('ce-mobile', this._isMobile);
            document.body.classList.toggle('ce-tablet', this._isTablet);
            document.body.classList.toggle('ce-desktop', !this._isMobile && !this._isTablet);
            document.body.classList.toggle('ce-portrait', this._isPortrait);
            document.body.classList.toggle('ce-landscape', !this._isPortrait);

            if (prevMobile !== this._isMobile || prevPortrait !== this._isPortrait) {
                for (var i = 0; i < this._onChangeCallbacks.length; i++) {
                    this._onChangeCallbacks[i]({
                        isMobile: this._isMobile,
                        isTablet: this._isTablet,
                        isPortrait: this._isPortrait
                    });
                }
            }
        },

        isMobile: function() { return this._isMobile; },
        isTablet: function() { return this._isTablet; },
        isPortrait: function() { return this._isPortrait; },

        getOptimalCellSize: function(cols, rows) {
            var vw = window.innerWidth;
            var vh = window.innerHeight;
            var available = this._isMobile ?
                { width: vw * 0.95, height: vh * 0.55 } :
                { width: Math.min(vw * 0.7, 800), height: Math.min(vh * 0.6, 600) };

            var cellW = Math.floor(available.width / cols);
            var cellH = Math.floor(available.height / rows);
            var size = Math.min(cellW, cellH);

            return {
                width: size,
                height: size,
                fontSize: Math.max(12, Math.floor(size * 0.45)),
                gap: Math.max(2, Math.floor(size * 0.05))
            };
        },

        onChange: function(fn) {
            this._onChangeCallbacks.push(fn);
        }
    };


    // ═══════════════════════════════════════════════════════════════════════
    // SECTION 18: SOUND HOOK SYSTEM
    // ═══════════════════════════════════════════════════════════════════════

    var SoundHooks = {
        _hooks: {},
        _muted: false,

        register: function(label, callback) {
            this._hooks[label] = callback;
        },

        trigger: function(label, data) {
            if (this._muted) return;
            if (this._hooks[label]) {
                try { this._hooks[label](data); } catch(e) {}
            }
            if (typeof window.SoundManager !== 'undefined' && window.SoundManager.play) {
                try { window.SoundManager.play(label); } catch(e) {}
            }
        },

        mute: function() { this._muted = true; },
        unmute: function() { this._muted = false; },
        isMuted: function() { return this._muted; },

        registerBatch: function(hookMap) {
            for (var key in hookMap) {
                if (hookMap.hasOwnProperty(key)) {
                    this._hooks[key] = hookMap[key];
                }
            }
        }
    };


    // ═══════════════════════════════════════════════════════════════════════
    // SECTION 19: STUDIO THEME INJECTION
    // ═══════════════════════════════════════════════════════════════════════

    var _studioThemes = {
        'nebula-gaming':  { particleColor: '#00e5ff', accentGlow: 'rgba(0,229,255,0.4)',   celebBg: 'radial-gradient(circle,rgba(0,229,255,.12),transparent 70%)',  reelBorder: '#00e5ff', fontFamily: "'Orbitron', sans-serif" },
        'golden-reels':   { particleColor: '#ffd700', accentGlow: 'rgba(255,215,0,0.4)',    celebBg: 'radial-gradient(circle,rgba(255,215,0,.12),transparent 70%)',   reelBorder: '#ffd700', fontFamily: "'Playfair Display', serif" },
        'mythic-forge':   { particleColor: '#b388ff', accentGlow: 'rgba(179,136,255,0.4)',  celebBg: 'radial-gradient(circle,rgba(179,136,255,.12),transparent 70%)', reelBorder: '#b388ff', fontFamily: "'Cinzel', serif" },
        'ironclad':       { particleColor: '#ff6d00', accentGlow: 'rgba(255,109,0,0.4)',    celebBg: 'radial-gradient(circle,rgba(255,109,0,.12),transparent 70%)',   reelBorder: '#ff6d00', fontFamily: "'Rajdhani', sans-serif" },
        'shadow-works':   { particleColor: '#69f0ae', accentGlow: 'rgba(105,240,174,0.4)',  celebBg: 'radial-gradient(circle,rgba(105,240,174,.12),transparent 70%)', reelBorder: '#69f0ae', fontFamily: "'Share Tech Mono', monospace" },
        'wild-frontier':  { particleColor: '#ff4081', accentGlow: 'rgba(255,64,129,0.4)',   celebBg: 'radial-gradient(circle,rgba(255,64,129,.12),transparent 70%)',  reelBorder: '#ff4081', fontFamily: "'Bungee', cursive" },
        'cascade-labs':   { particleColor: '#ffd740', accentGlow: 'rgba(255,215,64,0.4)',   celebBg: 'radial-gradient(circle,rgba(255,215,64,.12),transparent 70%)',  reelBorder: '#ffd740', fontFamily: "'Chakra Petch', sans-serif" },
        'dragon-pearl':   { particleColor: '#40c4ff', accentGlow: 'rgba(64,196,255,0.4)',   celebBg: 'radial-gradient(circle,rgba(64,196,255,.12),transparent 70%)',  reelBorder: '#40c4ff', fontFamily: "'Ma Shan Zheng', cursive" }
    };

    var _activeStudioTheme = null;
    var _activeStudioId = null;

    function setStudioTheme(studioId) {
        _activeStudioTheme = _studioThemes[studioId] || null;
        _activeStudioId = studioId || null;

        if (_activeStudioTheme) {
            var root = document.documentElement;
            root.style.setProperty('--ce-studio-particle', _activeStudioTheme.particleColor);
            root.style.setProperty('--ce-studio-glow', _activeStudioTheme.accentGlow);
            root.style.setProperty('--ce-studio-border', _activeStudioTheme.reelBorder);
        }
    }

    function getStudioTheme() {
        return _activeStudioTheme;
    }

    function getStudioId() {
        return _activeStudioId;
    }


    // ═══════════════════════════════════════════════════════════════════════
    // SECTION 20: CSS INJECTION
    // ═══════════════════════════════════════════════════════════════════════

    function injectStyles() {
        if (document.getElementById('ce-engine-styles-v3')) return;
        var style = document.createElement('style');
        style.id = 'ce-engine-styles-v3';
        style.textContent = [
            '.ce-win-overlay{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;z-index:1000;pointer-events:none;animation:ce-fade-in .3s ease;}',
            '.ce-win-label{font-size:2.5rem;font-weight:900;text-transform:uppercase;text-shadow:0 0 20px currentColor,0 4px 8px rgba(0,0,0,.5);animation:ce-pulse 0.6s ease infinite alternate;}',
            '.ce-win-amount{font-size:1.8rem;font-weight:700;color:#fff;text-shadow:0 2px 8px rgba(0,0,0,.6);margin-top:.5rem;}',
            '.ce-win-small .ce-win-label{color:#FFD700;font-size:1.8rem;}',
            '.ce-win-medium .ce-win-label{color:#FF6B35;font-size:2.2rem;}',
            '.ce-win-big .ce-win-label{color:#E91E63;font-size:2.8rem;}',
            '.ce-win-mega .ce-win-label{color:#9C27B0;font-size:3.2rem;animation:ce-mega-pulse 0.4s ease infinite alternate;}',
            '.ce-win-jackpot .ce-win-label{color:#FF0000;font-size:3.8rem;animation:ce-jackpot-pulse 0.3s ease infinite alternate;}',
            '.ce-win-jackpot{background:radial-gradient(circle,rgba(255,0,0,.15),transparent 70%);}',
            '.ce-win-mega{background:radial-gradient(circle,rgba(156,39,176,.12),transparent 70%);}',
            '.ce-win-big{background:radial-gradient(circle,rgba(233,30,99,.08),transparent 70%);}',
            '.ce-shake{animation:ce-screen-shake 0.15s linear infinite;}',
            '.ce-win-cell{animation:ce-cell-flash 0.5s ease infinite alternate !important;box-shadow:0 0 15px 3px rgba(255,215,0,.6) !important;z-index:10;position:relative;}',
            '.ce-anticipation{animation:ce-anticipation-glow 0.8s ease infinite alternate;}',
            '.ce-attract-overlay{position:absolute;inset:0;background:rgba(0,0,0,.7);display:flex;align-items:center;justify-content:center;z-index:900;cursor:pointer;animation:ce-fade-in .5s ease;backdrop-filter:blur(4px);}',
            '.ce-attract-content{text-align:center;}',
            '.ce-attract-logo{font-size:2.5rem;font-weight:900;background:linear-gradient(135deg,#FFD700,#FF6B35,#E91E63);-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text;animation:ce-pulse 2s ease infinite alternate;letter-spacing:0.1em;}',
            '.ce-attract-text{color:rgba(255,255,255,.7);font-size:1.1rem;margin-top:1rem;animation:ce-blink 1.5s ease infinite;}',
            '.ce-attract-shimmer{position:absolute;inset:0;background:linear-gradient(45deg,transparent 40%,rgba(255,215,0,.05) 50%,transparent 60%);animation:ce-shimmer 3s ease infinite;}',
            '.ce-autoplay-badge{position:absolute;top:-8px;right:-8px;background:#FF6B35;color:#fff;font-size:.7rem;font-weight:700;padding:2px 8px;border-radius:10px;z-index:10;animation:ce-pulse 1s ease infinite alternate;}',
            '.reel-near-miss-tension{animation:ce-reel-tension-pulse 0.4s ease infinite alternate;}',
            '.near-miss-decel{transition:transform 1100ms cubic-bezier(0.16,1,0.3,1) !important;}',
            '@keyframes ce-fade-in{from{opacity:0}to{opacity:1}}',
            '@keyframes ce-pulse{from{transform:scale(1)}to{transform:scale(1.08)}}',
            '@keyframes ce-mega-pulse{from{transform:scale(1);filter:brightness(1)}to{transform:scale(1.15);filter:brightness(1.3)}}',
            '@keyframes ce-jackpot-pulse{from{transform:scale(1);filter:brightness(1) hue-rotate(0)}to{transform:scale(1.2);filter:brightness(1.5) hue-rotate(15deg)}}',
            '@keyframes ce-screen-shake{0%{transform:translate(0)}25%{transform:translate(var(--ce-shake-intensity),calc(var(--ce-shake-intensity)*-0.5))}50%{transform:translate(calc(var(--ce-shake-intensity)*-0.5),var(--ce-shake-intensity))}75%{transform:translate(var(--ce-shake-intensity),0)}100%{transform:translate(0)}}',
            '@keyframes ce-cell-flash{from{background:rgba(255,215,0,.15)}to{background:rgba(255,215,0,.4)}}',
            '@keyframes ce-anticipation-glow{from{box-shadow:inset 0 0 20px rgba(255,165,0,.2)}to{box-shadow:inset 0 0 40px rgba(255,165,0,.5)}}',
            '@keyframes ce-blink{0%,100%{opacity:.4}50%{opacity:1}}',
            '@keyframes ce-shimmer{0%{background-position:-200% 0}100%{background-position:200% 0}}',
            '@keyframes ce-reel-tension-pulse{from{box-shadow:0 0 10px rgba(255,165,0,.3)}to{box-shadow:0 0 25px rgba(255,165,0,.6)}}',
            '@media(max-width:768px){.ce-win-label{font-size:1.6rem !important;}.ce-win-amount{font-size:1.2rem !important;}.ce-attract-logo{font-size:1.8rem;}.ce-win-mega .ce-win-label{font-size:2.2rem !important;}.ce-win-jackpot .ce-win-label{font-size:2.6rem !important;}}',
            '@media(max-width:480px){.ce-win-label{font-size:1.3rem !important;}.ce-win-amount{font-size:1rem !important;}.ce-attract-logo{font-size:1.4rem;}}',
            '.ce-studio-border{border-color:var(--ce-studio-border,#333) !important;}',
            '.ce-studio-glow{box-shadow:0 0 15px var(--ce-studio-glow,transparent);}',
        ].join('\n');
        document.head.appendChild(style);

        var oldStyle = document.getElementById('ce-engine-styles');
        if (oldStyle) oldStyle.remove();
    }


    // ═══════════════════════════════════════════════════════════════════════
    // SECTION 21: ENGINE INITIALIZATION & GAME RUNNER
    // ═══════════════════════════════════════════════════════════════════════

    var _currentGame = null;
    var _initialized = false;

    function initEngine(gameConfig) {
        _currentGame = gameConfig;
        injectStyles();
        MobileLayout.init();
        BetManager.init(gameConfig);
        SessionTracker.reset();
        FreeSpinState.reset();
        IdleAttract.start();

        if (gameConfig && gameConfig.provider) {
            setStudioTheme(gameConfig.provider);
        } else if (gameConfig && gameConfig.studioId) {
            setStudioTheme(gameConfig.studioId);
        }

        _initialized = true;
    }

    function switchGame(gameConfig) {
        _currentGame = gameConfig;
        BetManager.init(gameConfig);
        FreeSpinState.reset();
        hideCelebration();
        CoinParticleSystem.clear();

        if (gameConfig && gameConfig.provider) {
            setStudioTheme(gameConfig.provider);
        }
    }

    function getCurrentGame() {
        return _currentGame;
    }


    // ═══════════════════════════════════════════════════════════════════════
    // SECTION 22: PUBLIC API
    // ═══════════════════════════════════════════════════════════════════════

    window.CasinoEngine = {
        init: initEngine,
        switchGame: switchGame,
        getCurrentGame: getCurrentGame,
        version: '3.1.0',

        // Weighted RNG
        secureRandom: secureRandom,
        weightedSymbolPick: weightedSymbolPick,
        generateWeightedGrid: generateWeightedGrid,
        generateSpinGrid: generateSpinGrid,
        SYMBOL_WEIGHTS: SYMBOL_WEIGHTS,

        // Payline Evaluation
        getPaylines: getPaylines,
        evaluatePaylines: evaluatePaylines,
        findClusters: findClusters,
        getPayMultiplier: getPayMultiplier,
        capWin: capWin,

        // RTP Enforcement
        shouldAllowWin: shouldAllowWin,
        recordSpinForRTP: recordSpinForRTP,
        getProfitStatus: getProfitStatus,
        TARGET_RTP: TARGET_RTP,

        // Symbol Helpers
        isWild: isWild,
        isScatter: isScatter,
        countScattersInGrid: countScattersInGrid,
        countWildsInGrid: countWildsInGrid,

        // Reel Physics
        ReelPhysics: ReelPhysics,
        smoothstep: smoothstep,
        easeOutCubic: easeOutCubic,
        easeOutBack: easeOutBack,

        // Near Miss
        NearMiss: NearMiss,

        // Free Spins
        FreeSpins: FreeSpinState,

        // Bonus Hooks
        BonusHooks: BonusHooks,

        // Win Celebrations
        showWinCelebration: showWinCelebration,
        hideCelebration: hideCelebration,
        getWinTier: getWinTier,
        WIN_TIERS: WIN_TIERS,

        // Particles
        CoinParticles: CoinParticleSystem,

        // Screen Shake
        ScreenShake: ScreenShake,

        // Anticipation
        Anticipation: Anticipation,

        // Autoplay
        Autoplay: AutoplayEngine,

        // Bet Management
        BetManager: BetManager,

        // Session Tracking
        Session: SessionTracker,

        // Win Line Flash
        WinLineFlash: WinLineFlash,

        // Idle Attract
        IdleAttract: IdleAttract,

        // Mobile Layout
        Mobile: MobileLayout,

        // Sound Hooks
        Sound: SoundHooks,

        // Studio Themes
        setStudioTheme: setStudioTheme,
        getStudioTheme: getStudioTheme,
        getStudioId: getStudioId,
        studioThemes: _studioThemes
    };

})(window);
