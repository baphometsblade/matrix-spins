/* ═══════════════════════════════════════════════════════════
   GAME RUNTIME JS v4.0.0 — Matrix Spins Casino
   Phase 4: Premium Polish — 60fps animations, bloom, particles,
   anticipation, screen shake, demo mode, idle attract.
   Requires casino-engine.js v3.0.0 loaded before this file.
   Each game provides: window.GAME_CONFIG and window.GAME_MECHANIC
   ═══════════════════════════════════════════════════════════ */

(function(window) {
    'use strict';

    var CE = window.CasinoEngine;
    var CONFIG = null;
    var MECHANIC = null;
    var state = {
        balance: 1000.00,
        bet: 1.00,
        spinning: false,
        grid: null,
        lastWin: 0,
        freeSpinsActive: false,
        freeSpinsRemaining: 0,
        freeSpinsTotalWon: 0,
        isDemo: true,
        spinCount: 0
    };

    // ── Performance: requestAnimationFrame ticker with setTimeout fallback ──
    var _rafCallbacks = [];
    var _rafRunning = false;

    function rafTick(ts) {
        if (!ts) ts = performance.now();
        var alive = [];
        for (var i = 0; i < _rafCallbacks.length; i++) {
            if (_rafCallbacks[i](ts) !== false) alive.push(_rafCallbacks[i]);
        }
        _rafCallbacks = alive;
        if (_rafCallbacks.length > 0) {
            _scheduleNext();
        } else {
            _rafRunning = false;
        }
    }

    function _scheduleNext() {
        // Use RAF if available, setTimeout(16ms) as fallback
        if (typeof requestAnimationFrame === 'function' && document.visibilityState !== 'hidden') {
            requestAnimationFrame(rafTick);
        } else {
            setTimeout(function() { rafTick(performance.now()); }, 16);
        }
    }

    function scheduleRAF(fn) {
        _rafCallbacks.push(fn);
        if (!_rafRunning) {
            _rafRunning = true;
            _scheduleNext();
        }
    }

    // ── Initialization ──
    function init() {
        CONFIG = window.GAME_CONFIG;
        MECHANIC = window.GAME_MECHANIC || {};
        if (!CONFIG) { console.error('[Runtime] No GAME_CONFIG found'); return; }
        if (!CE) { console.error('[Runtime] CasinoEngine not loaded'); return; }

        CE.init(CONFIG);
        state.bet = CONFIG.minBet || 1.00;

        buildUI();
        bindEvents();
        renderBalance();
        renderBet();
        setupDemoModeBanner();

        // Initialize mechanic if it has an init function
        if (MECHANIC.init) MECHANIC.init(CONFIG, state);

        console.log('[Runtime] Game initialized:', CONFIG.id, 'v' + CE.version);
    }

    // ── UI Construction ──
    function buildUI() {
        var cols = CONFIG.gridCols || 3;
        var rows = CONFIG.gridRows || 1;
        var reelsGrid = document.getElementById('reelsGrid');
        if (!reelsGrid) return;

        reelsGrid.style.gridTemplateColumns = 'repeat(' + cols + ', var(--reel-cell-size))';
        reelsGrid.style.gridTemplateRows = 'repeat(' + rows + ', var(--reel-cell-size))';

        for (var r = 0; r < rows; r++) {
            for (var c = 0; c < cols; c++) {
                var cell = document.createElement('div');
                cell.className = 'reel-cell';
                cell.id = 'cell_' + c + '_' + r;
                cell.dataset.col = c;
                cell.dataset.row = r;
                reelsGrid.appendChild(cell);
            }
        }

        // Generate initial display
        state.grid = CE.generateWeightedGrid(CONFIG);
        renderGrid(state.grid);
    }

    // ── Demo Mode Banner ──
    function setupDemoModeBanner() {
        var banner = document.getElementById('demoBanner');
        if (!banner) {
            banner = document.createElement('div');
            banner.id = 'demoBanner';
            banner.className = 'demo-mode-banner';
            banner.textContent = 'DEMO MODE — Playing with virtual credits';
            var topbar = document.querySelector('.game-topbar');
            if (topbar && topbar.parentNode) {
                topbar.parentNode.insertBefore(banner, topbar.nextSibling);
            } else {
                document.body.insertBefore(banner, document.body.firstChild);
            }
        }
        // Show if not logged in (check for auth token)
        var isLoggedIn = !!(window.authToken || window.sessionStorage.getItem('auth') || document.cookie.indexOf('auth=') > -1);
        state.isDemo = !isLoggedIn;
        banner.style.display = state.isDemo ? 'block' : 'none';
    }

    // ── Event Binding ──
    function bindEvents() {
        var spinBtn = document.getElementById('spinBtn');
        var betUp = document.getElementById('betUp');
        var betDown = document.getElementById('betDown');
        var maxBet = document.getElementById('maxBet');
        var autoplay = document.getElementById('autoplayBtn');
        var backBtn = document.getElementById('backBtn');

        if (spinBtn) spinBtn.addEventListener('click', function() { doSpin(); });
        if (betUp) betUp.addEventListener('click', function() {
            state.bet = CE.BetManager.increase();
            renderBet();
        });
        if (betDown) betDown.addEventListener('click', function() {
            state.bet = CE.BetManager.decrease();
            renderBet();
        });
        if (maxBet) maxBet.addEventListener('click', function() {
            state.bet = CE.BetManager.setMax();
            renderBet();
        });
        if (autoplay) autoplay.addEventListener('click', function() {
            if (CE.Autoplay.isRunning()) {
                CE.Autoplay.stop();
                autoplay.textContent = 'Auto';
                autoplay.classList.remove('active');
            } else {
                CE.Autoplay.configure({ totalSpins: 25, stopOnFeature: true });
                CE.Autoplay.start(function() { doSpin(); });
                autoplay.textContent = 'Stop';
                autoplay.classList.add('active');
            }
        });
        if (backBtn) backBtn.addEventListener('click', function() {
            window.location.href = '/';
        });

        // Spacebar to spin
        document.addEventListener('keydown', function(e) {
            if (e.code === 'Space' && !state.spinning) {
                e.preventDefault();
                doSpin();
            }
        });
    }

    // ══════════════════════════════════════════════════════════════
    // 60FPS REEL ANIMATION SYSTEM
    // ══════════════════════════════════════════════════════════════

    var SPIN_SYMBOLS_PER_REEL = 12;     // symbols that fly past during spin
    var REEL_ACCEL_MS = 180;             // time to reach full speed
    var REEL_FULL_SPEED_MS = 300;        // time at full speed
    var REEL_STAGGER_MS = 100;           // delay between reels stopping
    var NEAR_MISS_EXTRA_MS = 500;        // extra spin time for near-miss reels
    var ANTICIPATION_EXTRA_MS = 600;     // extra time for anticipation reels
    var REEL_DECEL_MS = 250;             // deceleration time
    var BOUNCE_MS = 180;                 // overshoot bounce time
    var BOUNCE_PX = 6;                   // bounce overshoot in pixels

    function animateReelSpin(callback) {
        var cols = CONFIG.gridCols || 3;
        var rows = CONFIG.gridRows || 1;
        var symbols = CONFIG.symbols || [];
        var cellSize = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--reel-cell-size')) || 80;

        // Phase timeline per reel
        var startTime = performance.now();
        var reelsDone = 0;
        var callbackFired = false;

        // Safety timeout: if animation callbacks never fire (headless/hidden tab),
        // force-complete after a reasonable max duration
        var maxAnimTime = 300 + cols * (REEL_STAGGER_MS + NEAR_MISS_EXTRA_MS + ANTICIPATION_EXTRA_MS + REEL_ACCEL_MS + REEL_FULL_SPEED_MS + REEL_DECEL_MS + BOUNCE_MS);
        setTimeout(function() {
            if (!callbackFired) {
                callbackFired = true;
                // Place all final symbols
                for (var c = 0; c < cols; c++) placeReelResult(c, rows);
                // Clean up all cell classes
                var cells = document.querySelectorAll('.reel-cell');
                for (var i = 0; i < cells.length; i++) {
                    cells[i].classList.remove('spinning', 'reel-tension', 'landing');
                    cells[i].style.filter = '';
                    cells[i].style.transform = '';
                }
                clearAnticipationLabel();
                callback();
            }
        }, Math.min(maxAnimTime + 500, 8000));

        // Check near-miss and anticipation on the result grid (already generated)
        var nearMiss = CE.NearMiss.check(state.grid, CONFIG);
        var anticipation = CE.Anticipation.check(state.grid, CONFIG);

        // Audio cue label for anticipation
        if (anticipation || nearMiss) {
            CE.Sound.trigger('anticipation');
            showAnticipationLabel();
        }

        for (var c = 0; c < cols; c++) {
            animateSingleReel(c, cols, rows, symbols, cellSize, startTime, nearMiss, anticipation, function() {
                reelsDone++;
                if (reelsDone >= cols && !callbackFired) {
                    callbackFired = true;
                    clearAnticipationLabel();
                    setTimeout(callback, 60);
                }
            });
        }
    }

    function animateSingleReel(colIdx, totalCols, rows, symbols, cellSize, startTime, nearMiss, anticipation, onDone) {
        var isNearMissReel = nearMiss && colIdx >= (nearMiss.startReel || 2);
        var isAnticipationReel = anticipation && colIdx >= (anticipation.startReel || 2);
        var extraDelay = 0;
        if (isNearMissReel) extraDelay += NEAR_MISS_EXTRA_MS;
        if (isAnticipationReel) extraDelay += ANTICIPATION_EXTRA_MS;

        var reelStartDelay = colIdx * CE.ReelPhysics.CASCADE_STAGGER;
        var accelEnd = reelStartDelay + REEL_ACCEL_MS;
        var fullSpeedEnd = accelEnd + REEL_FULL_SPEED_MS + (colIdx * REEL_STAGGER_MS) + extraDelay;
        var decelEnd = fullSpeedEnd + REEL_DECEL_MS;
        var bounceEnd = decelEnd + BOUNCE_MS;
        var totalDuration = bounceEnd;

        var cells = [];
        for (var r = 0; r < rows; r++) {
            var cell = document.getElementById('cell_' + colIdx + '_' + r);
            if (cell) cells.push(cell);
        }

        // Start blur
        cells.forEach(function(c) { c.classList.add('spinning'); });

        // If this is a near-miss/anticipation reel, add tension glow
        if (isNearMissReel || isAnticipationReel) {
            var frame = document.querySelector('.reels-frame');
            if (frame) {
                setTimeout(function() {
                    cells.forEach(function(c) { c.classList.add('reel-tension'); });
                }, fullSpeedEnd - REEL_DECEL_MS - 200);
            }
        }

        var speed = CE.ReelPhysics.getReelSpeed(1.0, colIdx);

        scheduleRAF(function tick(now) {
            var elapsed = now - startTime;

            if (elapsed < reelStartDelay) return true; // not started yet

            var phase = elapsed - reelStartDelay;

            if (phase < REEL_ACCEL_MS) {
                // Accelerating — increasing blur
                var t = phase / REEL_ACCEL_MS;
                var blurAmt = 1 + CE.smoothstep(t) * 3;
                cells.forEach(function(c) {
                    c.style.filter = 'blur(' + blurAmt.toFixed(1) + 'px) brightness(0.7)';
                    c.style.transform = 'translateY(' + (Math.sin(phase * 0.05 * speed) * 4).toFixed(1) + 'px)';
                });
                return true;
            }

            if (elapsed < fullSpeedEnd) {
                // Full speed — max blur, rapid cycle
                var cyclePhase = (elapsed - accelEnd) * 0.08 * speed;
                cells.forEach(function(c) {
                    c.style.filter = 'blur(3px) brightness(0.65)';
                    c.style.transform = 'translateY(' + (Math.sin(cyclePhase) * 5).toFixed(1) + 'px)';
                });
                return true;
            }

            if (elapsed < decelEnd) {
                // Decelerating — blur reducing
                var dt = (elapsed - fullSpeedEnd) / REEL_DECEL_MS;
                var eased = CE.easeOutCubic(dt);
                var blurAmt2 = 3 * (1 - eased);
                var bright = 0.65 + eased * 0.35;
                cells.forEach(function(c) {
                    c.style.filter = 'blur(' + blurAmt2.toFixed(1) + 'px) brightness(' + bright.toFixed(2) + ')';
                    c.style.transform = 'translateY(' + ((1 - eased) * 3).toFixed(1) + 'px)';
                });

                // Place final symbols when nearly done decelerating
                if (dt > 0.8) {
                    placeReelResult(colIdx, rows);
                }
                return true;
            }

            if (elapsed < bounceEnd) {
                // Bounce overshoot
                var bt = (elapsed - decelEnd) / BOUNCE_MS;
                var bounceAmt = BOUNCE_PX * Math.sin(bt * Math.PI) * (1 - bt);
                cells.forEach(function(c) {
                    c.style.filter = '';
                    c.style.transform = 'translateY(' + bounceAmt.toFixed(1) + 'px)';
                });
                return true;
            }

            // Done — clean up
            cells.forEach(function(c) {
                c.classList.remove('spinning', 'reel-tension');
                c.style.filter = '';
                c.style.transform = '';
                c.classList.add('landing');
            });
            placeReelResult(colIdx, rows);
            CE.Sound.trigger('reel_stop');

            setTimeout(function() {
                cells.forEach(function(c) { c.classList.remove('landing'); });
            }, 260);

            onDone();
            return false; // remove from RAF loop
        });
    }

    function placeReelResult(col, rows) {
        if (!state.grid || !state.grid[col]) return;
        for (var r = 0; r < rows; r++) {
            var cell = document.getElementById('cell_' + col + '_' + r);
            if (cell && state.grid[col][r]) {
                renderSymbolInCell(cell, state.grid[col][r]);
            }
        }
    }

    // ── Anticipation label (audio cue visual) ──
    function showAnticipationLabel() {
        var existing = document.getElementById('anticipationLabel');
        if (existing) existing.remove();
        var label = document.createElement('div');
        label.id = 'anticipationLabel';
        label.className = 'anticipation-label';
        label.textContent = '...';
        var frame = document.querySelector('.reels-frame');
        if (frame) {
            frame.style.position = 'relative';
            frame.appendChild(label);
        }
    }

    function clearAnticipationLabel() {
        var label = document.getElementById('anticipationLabel');
        if (label) {
            label.classList.add('fade-out');
            setTimeout(function() { if (label.parentNode) label.remove(); }, 400);
        }
    }

    // ══════════════════════════════════════════════════════════════
    // SPIN CYCLE
    // ══════════════════════════════════════════════════════════════

    function doSpin() {
        if (state.spinning) return;

        // Check balance
        if (!state.freeSpinsActive && state.balance < state.bet) {
            showMechanic('INSUFFICIENT FUNDS', 'Reduce your bet or add funds');
            return;
        }

        state.spinning = true;
        state.lastWin = 0;
        state.spinCount++;
        var spinBtn = document.getElementById('spinBtn');
        if (spinBtn) {
            spinBtn.disabled = true;
            spinBtn.classList.add('spinning-active');
        }

        // Deduct bet (unless free spin)
        if (!state.freeSpinsActive) {
            state.balance -= state.bet;
            renderBalance();
        }

        // Clear previous wins
        clearWinHighlights();
        CE.hideCelebration();
        clearBloom();

        // Pre-mechanic hook
        if (MECHANIC.onBeforeSpin) MECHANIC.onBeforeSpin(state);

        // Generate result grid BEFORE animation starts (so near-miss/anticipation can be detected)
        state.grid = CE.generateSpinGrid(CONFIG, state.freeSpinsActive);

        // Sound
        CE.Sound.trigger('reel_spin');

        // 60fps animated spin
        animateReelSpin(function() {
            evaluateResult();
        });
    }

    // ══════════════════════════════════════════════════════════════
    // RESULT EVALUATION — with tier-scaled glow + bloom
    // ══════════════════════════════════════════════════════════════

    function evaluateResult() {
        var grid = state.grid;
        var winAmount = 0;
        var winLines = [];
        var winCells = [];
        var isFeature = false;
        var winType = CONFIG.winType || 'classic';

        if (winType === 'cluster') {
            var clusters = CE.findClusters(grid, CONFIG);
            for (var i = 0; i < clusters.length; i++) {
                var cl = clusters[i];
                var mult = CE.getPayMultiplier(cl.symbol, cl.size, CONFIG, 'cluster');
                winAmount += state.bet * mult;
                for (var j = 0; j < cl.cells.length; j++) {
                    winCells.push(cl.cells[j]);
                }
            }
        } else if (winType === 'payline') {
            var paylineWins = CE.evaluatePaylines(grid, CONFIG);
            for (var p = 0; p < paylineWins.length; p++) {
                var pw = paylineWins[p];
                var pmult = CE.getPayMultiplier(pw.symbol, pw.matchCount, CONFIG, 'payline');
                winAmount += state.bet * pmult;
                winLines.push(pw);
                for (var k = 0; k < pw.cells.length; k++) {
                    winCells.push(pw.cells[k]);
                }
            }
        } else {
            // Classic 3-reel
            var row0 = [];
            for (var cc = 0; cc < grid.length; cc++) row0.push(grid[cc][0]);
            if (allMatch(row0, CONFIG)) {
                var cmult = CE.getPayMultiplier(getEffective(row0, CONFIG), row0.length, CONFIG, 'classic');
                winAmount += state.bet * cmult;
                for (var h = 0; h < grid.length; h++) winCells.push([h, 0]);
            }
        }

        // Highlight wilds and scatters
        highlightSpecials(grid);

        // Determine win tier BEFORE applying mechanic (for glow scaling)
        var preTier = CE.getWinTier(winAmount, state.bet);

        // Check scatter for free spins
        var fsCount = CE.FreeSpins.checkTrigger(grid, CONFIG);
        if (fsCount > 0) {
            isFeature = true;
            if (!state.freeSpinsActive) {
                state.freeSpinsActive = true;
                state.freeSpinsRemaining = fsCount;
                state.freeSpinsTotalWon = 0;
                showFreeSpinsBanner(true);
                showMechanic('FREE SPINS!', fsCount + ' Free Spins Awarded');
            } else {
                state.freeSpinsRemaining += fsCount;
                showMechanic('RETRIGGER!', '+' + fsCount + ' Free Spins');
            }
        }

        // Apply mechanic modifier
        if (MECHANIC.onResult) {
            var mechResult = MECHANIC.onResult(grid, CONFIG, state, winAmount);
            if (mechResult) {
                if (mechResult.winAmount !== undefined) winAmount = mechResult.winAmount;
                if (mechResult.isFeature) isFeature = true;
                if (mechResult.message) showMechanic(mechResult.message, mechResult.sub || '');
            }
        }

        // Cap win
        winAmount = CE.capWin(winAmount, state.bet, CONFIG);
        winAmount = Math.round(winAmount * 100) / 100;
        state.lastWin = winAmount;

        // ── Tier-scaled effects ──
        var tier = CE.getWinTier(winAmount, state.bet);

        // Apply tier-scaled glow to winning cells
        applyTierGlow(winCells, tier);

        // Credit win
        if (winAmount > 0) {
            state.balance += winAmount;

            // Show celebration (handles particles, shake, sound internally)
            CE.showWinCelebration(winAmount, state.bet, document.querySelector('.reels-frame'));

            // Win line flash (payline only)
            if (winLines.length > 0) {
                CE.WinLineFlash.drawLines(winLines, document.querySelector('.reels-frame'));
            }

            // Bloom filter on game-area background for big+ wins
            if (tier === 'big' || tier === 'mega' || tier === 'jackpot') {
                applyBloom(tier);
            }

            // Animated win counter
            animateWinCounter(winAmount, tier);
        }

        // Record stats
        CE.recordSpinForRTP(state.bet, winAmount, CONFIG);
        CE.Session.recordSpin(state.bet, winAmount, isFeature, CONFIG.id);

        // Free spins management
        if (state.freeSpinsActive) {
            state.freeSpinsTotalWon += winAmount;
            state.freeSpinsRemaining--;
            updateFreeSpinsBanner();
            if (state.freeSpinsRemaining <= 0) {
                setTimeout(function() {
                    showMechanic('FREE SPINS COMPLETE', 'Total Won: $' + state.freeSpinsTotalWon.toFixed(2));
                    state.freeSpinsActive = false;
                    showFreeSpinsBanner(false);
                }, 1500);
            }
        }

        // Update UI
        renderBalance();
        renderWin(winAmount);

        // End spin
        state.spinning = false;
        var spinBtn = document.getElementById('spinBtn');
        if (spinBtn) {
            spinBtn.disabled = false;
            spinBtn.classList.remove('spinning-active');
        }

        // Autoplay callback
        CE.Autoplay.onSpinComplete({
            winAmount: winAmount,
            isFeature: isFeature,
            netResult: winAmount - state.bet
        });

        // Auto-spin free spins
        if (state.freeSpinsActive && state.freeSpinsRemaining > 0) {
            setTimeout(function() { doSpin(); }, 1200);
        }
    }

    // ── Tier-scaled cell glow ──
    var TIER_GLOW = {
        small:   { class: 'win-glow-small',   shadow: '0 0 8px var(--studio-glow)' },
        medium:  { class: 'win-glow-medium',  shadow: '0 0 15px var(--studio-glow), inset 0 0 8px var(--studio-glow)' },
        big:     { class: 'win-glow-big',     shadow: '0 0 22px var(--studio-glow), inset 0 0 12px var(--studio-glow), 0 0 40px rgba(233,30,99,0.3)' },
        mega:    { class: 'win-glow-mega',    shadow: '0 0 30px var(--studio-glow), inset 0 0 15px var(--studio-glow), 0 0 60px rgba(156,39,176,0.4)' },
        jackpot: { class: 'win-glow-jackpot', shadow: '0 0 40px var(--studio-glow), inset 0 0 20px var(--studio-glow), 0 0 80px rgba(255,0,0,0.5)' }
    };

    function applyTierGlow(cells, tier) {
        if (!cells || cells.length === 0) return;
        var glowConfig = tier ? TIER_GLOW[tier] : TIER_GLOW.small;
        if (!glowConfig) glowConfig = TIER_GLOW.small;

        for (var i = 0; i < cells.length; i++) {
            var cell = document.getElementById('cell_' + cells[i][0] + '_' + cells[i][1]);
            if (cell) {
                cell.classList.add('win-glow', glowConfig.class);
            }
        }
    }

    // ── Bloom filter on game-area ──
    function applyBloom(tier) {
        var gameArea = document.querySelector('.game-area');
        if (!gameArea) return;

        var bloom = { big: 1.25, mega: 1.4, jackpot: 1.5 };
        var sat = { big: 1.2, mega: 1.3, jackpot: 1.4 };
        var b = bloom[tier] || 1.0;
        var s = sat[tier] || 1.0;

        gameArea.classList.add('bloom-active');
        gameArea.style.setProperty('--bloom-brightness', b);
        gameArea.style.setProperty('--bloom-saturate', s);
    }

    function clearBloom() {
        var gameArea = document.querySelector('.game-area');
        if (!gameArea) return;
        gameArea.classList.remove('bloom-active');
        gameArea.style.removeProperty('--bloom-brightness');
        gameArea.style.removeProperty('--bloom-saturate');
    }

    // ── Animated win counter ──
    function animateWinCounter(targetAmount, tier) {
        var el = document.getElementById('winValue');
        if (!el) return;
        var duration = tier === 'jackpot' ? 3000 : tier === 'mega' ? 2000 : tier === 'big' ? 1500 : 800;
        var start = performance.now();

        scheduleRAF(function(now) {
            var progress = Math.min((now - start) / duration, 1);
            var eased = CE.easeOutCubic(progress);
            var current = targetAmount * eased;
            el.textContent = '$' + current.toFixed(2);
            return progress < 1;
        });
    }

    // ── Rendering Helpers ──
    function renderGrid(grid) {
        var cols = CONFIG.gridCols || 3;
        var rows = CONFIG.gridRows || 1;
        for (var c = 0; c < cols; c++) {
            for (var r = 0; r < rows; r++) {
                var cell = document.getElementById('cell_' + c + '_' + r);
                if (cell && grid[c] && grid[c][r]) {
                    renderSymbolInCell(cell, grid[c][r]);
                }
            }
        }
    }

    // HD asset image cache — avoid creating new Image objects every render
    var _imgCache = {};

    function renderSymbolInCell(cell, symbolId) {
        cell.textContent = '';
        // Remove previous children
        while (cell.firstChild) cell.removeChild(cell.firstChild);

        var gameId = CONFIG ? CONFIG.id : '';
        // Try HD image: WebP first, then PNG
        var basePath = '/assets/game_symbols/' + gameId + '/' + symbolId;
        var cacheKey = gameId + '/' + symbolId;

        if (_imgCache[cacheKey]) {
            // Clone cached image for fast render
            var cached = _imgCache[cacheKey].cloneNode(false);
            cached.className = 'symbol-img';
            cell.appendChild(cached);
            return;
        }

        var img = document.createElement('img');
        img.className = 'symbol-img';
        img.alt = symbolId;
        img.draggable = false;
        img.loading = 'eager';
        // Try PNG (all 100 games have PNG), WebP for the 7 that have it
        img.src = basePath + '.png';
        img.onerror = function() {
            // Final fallback: inline SVG if available
            var svgEl = document.getElementById('svg_' + symbolId);
            if (svgEl) {
                cell.textContent = '';
                var clone = svgEl.cloneNode(true);
                clone.style.display = 'block';
                clone.removeAttribute('id');
                cell.appendChild(clone);
            } else {
                cell.textContent = symbolId.replace(/^s\d+_/, '').replace(/_/g, ' ').substring(0, 6);
                cell.style.fontSize = '0.6rem';
                cell.style.fontWeight = '700';
                cell.style.color = 'var(--studio-primary)';
            }
        };
        img.onload = function() {
            _imgCache[cacheKey] = img; // Cache on successful load
        };
        cell.appendChild(img);
    }

    function renderBalance() {
        var el = document.getElementById('balanceValue');
        if (el) el.textContent = '$' + state.balance.toFixed(2);
    }

    function renderBet() {
        var el = document.getElementById('betDisplay');
        if (el) el.textContent = '$' + state.bet.toFixed(2);
        var el2 = document.getElementById('betValue');
        if (el2) el2.textContent = '$' + state.bet.toFixed(2);
    }

    function renderWin(amount) {
        var el = document.getElementById('winValue');
        if (el) {
            el.textContent = '$' + amount.toFixed(2);
            if (amount > 0) {
                el.classList.add('win-highlight');
                setTimeout(function() { el.classList.remove('win-highlight'); }, 2000);
            }
        }
    }

    function highlightCell(col, row, cls) {
        var cell = document.getElementById('cell_' + col + '_' + row);
        if (cell) cell.classList.add(cls);
    }

    function highlightSpecials(grid) {
        for (var c = 0; c < grid.length; c++) {
            for (var r = 0; r < grid[c].length; r++) {
                if (CE.isWild(grid[c][r], CONFIG)) highlightCell(c, r, 'wild-glow');
                if (CE.isScatter(grid[c][r], CONFIG)) highlightCell(c, r, 'scatter-glow');
            }
        }
    }

    function clearWinHighlights() {
        var els = document.querySelectorAll('.win-glow,.win-glow-small,.win-glow-medium,.win-glow-big,.win-glow-mega,.win-glow-jackpot,.wild-glow,.scatter-glow');
        for (var i = 0; i < els.length; i++) {
            els[i].classList.remove('win-glow', 'win-glow-small', 'win-glow-medium', 'win-glow-big', 'win-glow-mega', 'win-glow-jackpot', 'wild-glow', 'scatter-glow');
        }
        CE.WinLineFlash.clear();
    }

    function showMechanic(text, sub) {
        var overlay = document.getElementById('mechanicOverlay');
        if (!overlay) return;
        var textEl = overlay.querySelector('.mechanic-text');
        var subEl = overlay.querySelector('.mechanic-sub');
        if (textEl) textEl.textContent = text;
        if (subEl) subEl.textContent = sub || '';
        overlay.classList.add('active');
        setTimeout(function() { overlay.classList.remove('active'); }, 2500);
    }

    function showFreeSpinsBanner(show) {
        var banner = document.getElementById('freeSpinsBanner');
        if (banner) banner.classList.toggle('active', show);
    }

    function updateFreeSpinsBanner() {
        var banner = document.getElementById('freeSpinsBanner');
        if (banner && state.freeSpinsActive) {
            banner.textContent = 'FREE SPINS: ' + state.freeSpinsRemaining +
                ' remaining | Won: $' + state.freeSpinsTotalWon.toFixed(2);
        }
    }

    // ── Classic match helpers ──
    function allMatch(symbols, game) {
        if (symbols.length < 2) return false;
        for (var i = 1; i < symbols.length; i++) {
            if (symbols[i] !== symbols[0] && !CE.isWild(symbols[i], game) && !CE.isWild(symbols[0], game)) {
                return false;
            }
        }
        return true;
    }

    function getEffective(symbols, game) {
        for (var i = 0; i < symbols.length; i++) {
            if (!CE.isWild(symbols[i], game)) return symbols[i];
        }
        return symbols[0];
    }

    // ── Public API ──
    window.GameRuntime = {
        version: '4.0.0',
        init: init,
        getState: function() { return state; },
        showMechanic: showMechanic,
        renderGrid: renderGrid,
        highlightCell: highlightCell,
        clearWinHighlights: clearWinHighlights,
        doSpin: doSpin
    };

    // Auto-init on DOMContentLoaded
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

})(window);
