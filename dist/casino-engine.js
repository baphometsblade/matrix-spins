// ═══════════════════════════════════════════════════════════════════════════
// CASINO-ENGINE.JS — Premium Shared Engine for Matrix Spins Casino
// ═══════════════════════════════════════════════════════════════════════════
// Provides: Win celebrations, coin particles, anticipation animations,
// idle attract mode, autoplay engine, session tracking, and mobile layout.
// All 100 games use this engine via their config object.
// ═══════════════════════════════════════════════════════════════════════════

(function(window) {
    'use strict';

    // ─── WIN CELEBRATION SYSTEM ─────────────────────────────────────────
    // Tiered celebrations: small → medium → big → mega → jackpot
    var WIN_TIERS = {
        small:   { minMultiplier: 1,   label: 'WIN',         duration: 1200, shake: 0,  particles: 8,   color: '#FFD700' },
        medium:  { minMultiplier: 5,   label: 'BIG WIN!',    duration: 2000, shake: 2,  particles: 25,  color: '#FF6B35' },
        big:     { minMultiplier: 15,  label: 'HUGE WIN!',   duration: 3000, shake: 4,  particles: 50,  color: '#E91E63' },
        mega:    { minMultiplier: 50,  label: 'MEGA WIN!!',  duration: 4500, shake: 6,  particles: 80,  color: '#9C27B0' },
        jackpot: { minMultiplier: 200, label: 'JACKPOT!!!',  duration: 6000, shake: 10, particles: 150, color: '#FF0000' }
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

    function showWinCelebration(winAmount, betAmount, containerEl) {
        var tier = getWinTier(winAmount, betAmount);
        if (!tier) return;
        var config = WIN_TIERS[tier];
        var container = containerEl || document.querySelector('.reels-container') || document.getElementById('reels');
        if (!container) return;

        // Cancel any existing celebration
        if (_celebrationTimer) { clearTimeout(_celebrationTimer); hideCelebration(); }

        // Create overlay
        var overlay = document.createElement('div');
        overlay.id = 'ce-win-overlay';
        overlay.className = 'ce-win-overlay ce-win-' + tier;
        overlay.innerHTML = '<div class="ce-win-label">' + config.label + '</div>' +
            '<div class="ce-win-amount">$' + winAmount.toFixed(2) + '</div>';
        container.style.position = 'relative';
        container.appendChild(overlay);

        // Screen shake
        if (config.shake > 0) {
            container.classList.add('ce-shake');
            container.style.setProperty('--ce-shake-intensity', config.shake + 'px');
        }

        // Coin particles
        if (config.particles > 0) {
            CoinParticleSystem.burst(container, config.particles, config.color);
        }

        // Sound hook
        if (typeof window.SoundManager !== 'undefined' && window.SoundManager.play) {
            window.SoundManager.play('win_' + tier);
        }

        // Auto-hide
        _celebrationTimer = setTimeout(function() {
            hideCelebration();
        }, config.duration);
    }

    function hideCelebration() {
        var overlay = document.getElementById('ce-win-overlay');
        if (overlay) overlay.remove();
        var containers = document.querySelectorAll('.ce-shake');
        containers.forEach(function(el) { el.classList.remove('ce-shake'); });
        _celebrationTimer = null;
    }


    // ─── COIN PARTICLE SYSTEM ───────────────────────────────────────────
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
                this._pool.push({
                    x: cx + (Math.random() - 0.5) * rect.width * 0.6,
                    y: cy + (Math.random() - 0.5) * rect.height * 0.3,
                    vx: (Math.random() - 0.5) * 8,
                    vy: -Math.random() * 12 - 4,
                    size: 4 + Math.random() * 8,
                    alpha: 1,
                    color: color || '#FFD700',
                    rotation: Math.random() * 360,
                    rotSpeed: (Math.random() - 0.5) * 10,
                    gravity: 0.25 + Math.random() * 0.15,
                    life: 1
                });
            }

            if (!this._animFrame) this._animate();
        },

        _animate: function() {
            var canvas = document.getElementById('ce-particle-canvas');
            if (!canvas || this._pool.length === 0) {
                if (canvas) { var ctx = canvas.getContext('2d'); ctx.clearRect(0, 0, canvas.width, canvas.height); }
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
                p.rotation += p.rotSpeed;
                p.life -= 0.012;
                p.alpha = Math.max(0, p.life);

                if (p.life > 0 && p.y < canvas.height + 20) {
                    alive.push(p);
                    ctx.save();
                    ctx.globalAlpha = p.alpha;
                    ctx.translate(p.x, p.y);
                    ctx.rotate(p.rotation * Math.PI / 180);
                    // Draw coin
                    ctx.fillStyle = p.color;
                    ctx.beginPath();
                    ctx.ellipse(0, 0, p.size, p.size * 0.7, 0, 0, Math.PI * 2);
                    ctx.fill();
                    // Coin shine
                    ctx.fillStyle = 'rgba(255,255,255,0.4)';
                    ctx.beginPath();
                    ctx.ellipse(-p.size * 0.2, -p.size * 0.15, p.size * 0.35, p.size * 0.2, -0.3, 0, Math.PI * 2);
                    ctx.fill();
                    ctx.restore();
                }
            }
            this._pool = alive;
            var self = this;
            this._animFrame = requestAnimationFrame(function() { self._animate(); });
        }
    };


    // ─── ANTICIPATION ANIMATION ─────────────────────────────────────────
    // Slows reel 3+ when reels 1-2 show potential win
    var Anticipation = {
        _active: false,

        check: function(grid, game) {
            // Check if first 2 reels have matching high-value symbols
            if (!grid || !grid[0] || !grid[1]) return false;
            var cols = grid.length;
            if (cols < 3) return false;

            var rows = grid[0].length;
            for (var r = 0; r < rows; r++) {
                if (grid[0][r] === grid[1][r]) {
                    // Two matching symbols on leftmost reels = anticipation
                    return { symbol: grid[0][r], row: r, startReel: 2 };
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

            // Sound hook
            if (typeof window.SoundManager !== 'undefined' && window.SoundManager.play) {
                window.SoundManager.play('anticipation');
            }
        },

        clear: function(reelElements) {
            this._active = false;
            if (!reelElements) return;
            for (var i = 0; i < reelElements.length; i++) {
                if (reelElements[i]) {
                    reelElements[i].classList.remove('ce-anticipation');
                }
            }
        }
    };


    // ─── IDLE ATTRACT MODE ──────────────────────────────────────────────
    var IdleAttract = {
        _timer: null,
        _active: false,
        _timeout: 30000, // 30 seconds

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
            var overlay = document.getElementById('ce-attract-overlay');
            if (overlay) overlay.remove();
        },

        _activate: function() {
            this._active = true;
            var container = document.querySelector('.reels-container') || document.getElementById('reels');
            if (!container) return;

            var overlay = document.createElement('div');
            overlay.id = 'ce-attract-overlay';
            overlay.className = 'ce-attract-overlay';
            overlay.innerHTML = '<div class="ce-attract-content">' +
                '<div class="ce-attract-logo">MATRIX SPINS</div>' +
                '<div class="ce-attract-text">Tap to Play</div>' +
                '<div class="ce-attract-shimmer"></div></div>';
            container.style.position = 'relative';
            container.appendChild(overlay);

            // Click to dismiss
            overlay.addEventListener('click', function() {
                IdleAttract.reset();
            });
        }
    };

    // Reset idle on any user interaction (guard against double-registration)
    if (!window._ceIdleListenersAttached) {
        window._ceIdleListenersAttached = true;
        ['click', 'touchstart', 'keydown', 'mousemove'].forEach(function(evt) {
            document.addEventListener(evt, function() {
                if (IdleAttract._timer) IdleAttract.reset();
            }, { passive: true });
        });
    }


    // ─── AUTOPLAY ENGINE ────────────────────────────────────────────────
    var AutoplayEngine = {
        _running: false,
        _remaining: 0,
        _config: {
            totalSpins: 10,
            stopOnFeature: true,
            stopOnWinAbove: 0,
            stopOnBalanceBelow: 0,
            delayMs: 1500
        },
        _spinFn: null,
        _timer: null,

        configure: function(opts) {
            if (opts.totalSpins) this._config.totalSpins = Math.min(Math.max(opts.totalSpins, 1), 1000);
            if (opts.stopOnFeature !== undefined) this._config.stopOnFeature = !!opts.stopOnFeature;
            if (opts.stopOnWinAbove !== undefined) this._config.stopOnWinAbove = parseFloat(opts.stopOnWinAbove) || 0;
            if (opts.stopOnBalanceBelow !== undefined) this._config.stopOnBalanceBelow = parseFloat(opts.stopOnBalanceBelow) || 0;
            if (opts.delayMs) this._config.delayMs = Math.min(Math.max(opts.delayMs, 500), 5000);
        },

        start: function(spinFunction) {
            if (this._running) return;
            this._spinFn = spinFunction;
            this._remaining = this._config.totalSpins;
            this._running = true;
            this._updateUI();
            this._next();
        },

        stop: function() {
            this._running = false;
            this._remaining = 0;
            clearTimeout(this._timer);
            this._updateUI();
        },

        isRunning: function() { return this._running; },

        // Called after each spin result
        onSpinComplete: function(result) {
            if (!this._running) return;

            this._remaining--;

            // Stop conditions
            if (this._remaining <= 0) { this.stop(); return; }
            if (this._config.stopOnFeature && result && result.isFeature) { this.stop(); return; }
            if (this._config.stopOnWinAbove > 0 && result && result.winAmount >= this._config.stopOnWinAbove) { this.stop(); return; }
            if (this._config.stopOnBalanceBelow > 0) {
                var bal = (typeof window.currentBalance !== 'undefined') ? window.currentBalance : 0;
                if (bal <= this._config.stopOnBalanceBelow) { this.stop(); return; }
            }

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
                    badge = document.createElement('div');
                    badge.id = 'ce-autoplay-badge';
                    badge.className = 'ce-autoplay-badge';
                    var spinBtn = document.querySelector('.spin-btn') || document.querySelector('#spinBtn');
                    if (spinBtn && spinBtn.parentNode) spinBtn.parentNode.appendChild(badge);
                }
                if (badge) badge.textContent = this._remaining + ' spins';
            } else {
                if (badge) badge.remove();
            }
        }
    };


    // ─── BET LEVEL MANAGEMENT ───────────────────────────────────────────
    var BetManager = {
        _levels: [0.20, 0.50, 1.00, 2.00, 5.00, 10.00, 20.00, 50.00, 100.00],
        _currentIndex: 2, // Default $1.00
        _minBet: 0.20,
        _maxBet: 100.00,

        init: function(gameConfig) {
            if (gameConfig) {
                this._minBet = gameConfig.minBet || 0.20;
                this._maxBet = gameConfig.maxBet || 100.00;
                this._levels = this._levels.filter(function(b) {
                    return b >= this._minBet && b <= this._maxBet;
                }.bind(this));
                if (this._levels.length === 0) this._levels = [this._minBet];
                this._currentIndex = Math.min(2, this._levels.length - 1);
            }
        },

        current: function() { return this._levels[this._currentIndex]; },

        increase: function() {
            if (this._currentIndex < this._levels.length - 1) {
                this._currentIndex++;
            }
            return this.current();
        },

        decrease: function() {
            if (this._currentIndex > 0) {
                this._currentIndex--;
            }
            return this.current();
        },

        setMax: function() {
            this._currentIndex = this._levels.length - 1;
            return this.current();
        },

        setMin: function() {
            this._currentIndex = 0;
            return this.current();
        },

        getLevels: function() { return this._levels.slice(); }
    };


    // ─── SESSION TRACKING ───────────────────────────────────────────────
    var SessionTracker = {
        _data: {
            spinsPlayed: 0,
            totalWagered: 0,
            totalWon: 0,
            biggestWin: 0,
            startTime: Date.now(),
            currentStreak: 0,
            longestStreak: 0,
            featuresTrigered: 0
        },

        reset: function() {
            this._data = {
                spinsPlayed: 0, totalWagered: 0, totalWon: 0, biggestWin: 0,
                startTime: Date.now(), currentStreak: 0, longestStreak: 0, featuresTrigered: 0
            };
        },

        recordSpin: function(bet, win, isFeature) {
            this._data.spinsPlayed++;
            this._data.totalWagered += bet;
            this._data.totalWon += win;
            if (win > this._data.biggestWin) this._data.biggestWin = win;
            if (isFeature) this._data.featuresTrigered++;

            if (win > 0) {
                this._data.currentStreak++;
                if (this._data.currentStreak > this._data.longestStreak) {
                    this._data.longestStreak = this._data.currentStreak;
                }
            } else {
                this._data.currentStreak = 0;
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
                sessionRTP: this._data.totalWagered > 0 ? (this._data.totalWon / this._data.totalWagered * 100) : 0,
                playTime: Math.floor(elapsed / 60000), // minutes
                avgBet: this._data.spinsPlayed > 0 ? this._data.totalWagered / this._data.spinsPlayed : 0,
                winRate: this._data.spinsPlayed > 0 ? ((this._data.totalWon > 0 ? 1 : 0) / this._data.spinsPlayed * 100) : 0,
                longestStreak: this._data.longestStreak,
                featuresTrigered: this._data.featuresTrigered
            };
        },

        getTimePlayed: function() {
            var mins = Math.floor((Date.now() - this._data.startTime) / 60000);
            if (mins < 60) return mins + 'm';
            return Math.floor(mins / 60) + 'h ' + (mins % 60) + 'm';
        }
    };


    // ─── MOBILE RESPONSIVE LAYOUT ───────────────────────────────────────
    var MobileLayout = {
        _isPortrait: false,
        _isMobile: false,

        init: function() {
            this._check();
            var self = this;
            window.addEventListener('resize', function() { self._check(); });
            window.addEventListener('orientationchange', function() {
                setTimeout(function() { self._check(); }, 100);
            });
        },

        _check: function() {
            this._isMobile = window.innerWidth <= 768;
            this._isPortrait = window.innerHeight > window.innerWidth;
            document.body.classList.toggle('ce-mobile', this._isMobile);
            document.body.classList.toggle('ce-portrait', this._isPortrait);
            document.body.classList.toggle('ce-landscape', !this._isPortrait);
        },

        isMobile: function() { return this._isMobile; },
        isPortrait: function() { return this._isPortrait; }
    };


    // ─── SOUND HOOK SYSTEM ──────────────────────────────────────────────
    var SoundHooks = {
        _hooks: {},

        register: function(label, callback) {
            this._hooks[label] = callback;
        },

        trigger: function(label) {
            if (this._hooks[label]) {
                try { this._hooks[label](); } catch(e) {}
            }
            // Also try global SoundManager
            if (typeof window.SoundManager !== 'undefined' && window.SoundManager.play) {
                try { window.SoundManager.play(label); } catch(e) {}
            }
        }
    };


    // ─── WIN LINE FLASH ─────────────────────────────────────────────────
    var WinLineFlash = {
        _elements: [],

        highlight: function(positions, container) {
            this.clear();
            if (!positions || !container) return;

            for (var i = 0; i < positions.length; i++) {
                var pos = positions[i];
                var cell = container.querySelector('[data-col="' + pos.col + '"][data-row="' + pos.row + '"]');
                if (cell) {
                    cell.classList.add('ce-win-cell');
                    this._elements.push(cell);
                }
            }
        },

        clear: function() {
            for (var i = 0; i < this._elements.length; i++) {
                this._elements[i].classList.remove('ce-win-cell');
            }
            this._elements = [];
        }
    };


    // ─── NEAR MISS LOGIC ────────────────────────────────────────────────
    var NearMiss = {
        // Determines if result is a "near miss" (2 of 3 reels match on payline)
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
                    if (matches[sym] === 2 && grid.length >= 3) {
                        return { symbol: sym, row: r };
                    }
                }
            }
            return false;
        }
    };


    // ─── CSS INJECTION ──────────────────────────────────────────────────
    function injectStyles() {
        if (document.getElementById('ce-engine-styles')) return;
        var style = document.createElement('style');
        style.id = 'ce-engine-styles';
        style.textContent = [
            // Win overlay
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

            // Screen shake
            '.ce-shake{animation:ce-screen-shake 0.15s linear infinite;}',

            // Win cell highlight
            '.ce-win-cell{animation:ce-cell-flash 0.5s ease infinite alternate !important;box-shadow:0 0 15px 3px rgba(255,215,0,.6) !important;z-index:10;position:relative;}',

            // Anticipation
            '.ce-anticipation{animation:ce-anticipation-glow 0.8s ease infinite alternate;}',

            // Attract mode
            '.ce-attract-overlay{position:absolute;inset:0;background:rgba(0,0,0,.7);display:flex;align-items:center;justify-content:center;z-index:900;cursor:pointer;animation:ce-fade-in .5s ease;}',
            '.ce-attract-content{text-align:center;}',
            '.ce-attract-logo{font-size:2.5rem;font-weight:900;background:linear-gradient(135deg,#FFD700,#FF6B35);-webkit-background-clip:text;-webkit-text-fill-color:transparent;animation:ce-pulse 2s ease infinite alternate;}',
            '.ce-attract-text{color:rgba(255,255,255,.7);font-size:1.1rem;margin-top:1rem;animation:ce-blink 1.5s ease infinite;}',

            // Autoplay badge
            '.ce-autoplay-badge{position:absolute;top:-8px;right:-8px;background:#FF6B35;color:#fff;font-size:.7rem;font-weight:700;padding:2px 8px;border-radius:10px;z-index:10;}',

            // Keyframes
            '@keyframes ce-fade-in{from{opacity:0}to{opacity:1}}',
            '@keyframes ce-pulse{from{transform:scale(1)}to{transform:scale(1.08)}}',
            '@keyframes ce-mega-pulse{from{transform:scale(1);filter:brightness(1)}to{transform:scale(1.15);filter:brightness(1.3)}}',
            '@keyframes ce-jackpot-pulse{from{transform:scale(1);filter:brightness(1) hue-rotate(0)}to{transform:scale(1.2);filter:brightness(1.5) hue-rotate(15deg)}}',
            '@keyframes ce-screen-shake{0%{transform:translate(0)}25%{transform:translate(var(--ce-shake-intensity),calc(var(--ce-shake-intensity)*-0.5))}50%{transform:translate(calc(var(--ce-shake-intensity)*-0.5),var(--ce-shake-intensity))}75%{transform:translate(var(--ce-shake-intensity),0)}100%{transform:translate(0)}}',
            '@keyframes ce-cell-flash{from{background:rgba(255,215,0,.15)}to{background:rgba(255,215,0,.4)}}',
            '@keyframes ce-anticipation-glow{from{box-shadow:inset 0 0 20px rgba(255,165,0,.2)}to{box-shadow:inset 0 0 40px rgba(255,165,0,.5)}}',
            '@keyframes ce-blink{0%,100%{opacity:.4}50%{opacity:1}}',

            // Mobile responsive
            '@media(max-width:768px){.ce-win-label{font-size:1.6rem !important;}.ce-win-amount{font-size:1.2rem !important;}.ce-attract-logo{font-size:1.8rem;}}',
        ].join('\n');
        document.head.appendChild(style);
    }


    // ─── STUDIO THEME INJECTION ───────────────────────────────────────
    // Per-studio visual customisation: particle colors, celebration palettes,
    // reel chrome, and sound labels. Games pass their studioTheme config at init.
    var _studioThemes = {
        'nebula-gaming':  { particleColor: '#00e5ff', accentGlow: 'rgba(0,229,255,0.4)',   celebBg: 'radial-gradient(circle,rgba(0,229,255,.12),transparent 70%)' },
        'golden-reels':   { particleColor: '#ffd700', accentGlow: 'rgba(255,215,0,0.4)',    celebBg: 'radial-gradient(circle,rgba(255,215,0,.12),transparent 70%)' },
        'mythic-forge':   { particleColor: '#b388ff', accentGlow: 'rgba(179,136,255,0.4)',  celebBg: 'radial-gradient(circle,rgba(179,136,255,.12),transparent 70%)' },
        'ironclad':       { particleColor: '#ff6d00', accentGlow: 'rgba(255,109,0,0.4)',    celebBg: 'radial-gradient(circle,rgba(255,109,0,.12),transparent 70%)' },
        'shadow-works':   { particleColor: '#69f0ae', accentGlow: 'rgba(105,240,174,0.4)',  celebBg: 'radial-gradient(circle,rgba(105,240,174,.12),transparent 70%)' },
        'wild-frontier':  { particleColor: '#ff4081', accentGlow: 'rgba(255,64,129,0.4)',   celebBg: 'radial-gradient(circle,rgba(255,64,129,.12),transparent 70%)' },
        'cascade-labs':   { particleColor: '#ffd740', accentGlow: 'rgba(255,215,64,0.4)',   celebBg: 'radial-gradient(circle,rgba(255,215,64,.12),transparent 70%)' },
        'dragon-pearl':   { particleColor: '#40c4ff', accentGlow: 'rgba(64,196,255,0.4)',   celebBg: 'radial-gradient(circle,rgba(64,196,255,.12),transparent 70%)' }
    };

    var _activeStudioTheme = null;

    function setStudioTheme(studioId) {
        _activeStudioTheme = _studioThemes[studioId] || null;
    }

    function getStudioTheme() {
        return _activeStudioTheme;
    }

    // Override particle color when studio theme is active
    var _origBurst = CoinParticleSystem.burst;
    CoinParticleSystem.burst = function(container, count, color) {
        var effectiveColor = color;
        if (_activeStudioTheme && _activeStudioTheme.particleColor) {
            effectiveColor = _activeStudioTheme.particleColor;
        }
        _origBurst.call(CoinParticleSystem, container, count, effectiveColor);
    };

    // Override celebration background when studio theme is active
    var _origShowCeleb = showWinCelebration;
    showWinCelebration = function(winAmount, betAmount, containerEl) {
        _origShowCeleb(winAmount, betAmount, containerEl);
        if (_activeStudioTheme && _activeStudioTheme.celebBg) {
            var overlay = document.getElementById('ce-win-overlay');
            if (overlay) overlay.style.background = _activeStudioTheme.celebBg;
        }
    };


    // ─── BONUS ROUND HOOKS ─────────────────────────────────────────────
    // Extensible hook system for bonus/feature rounds.
    // Games register their bonus triggers and the engine dispatches them.
    var BonusHooks = {
        _hooks: {},

        register: function(gameId, config) {
            // config: { trigger: fn(grid, game) => bool, activate: fn(grid, game), label: string }
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


    // ─── ENGINE INITIALIZATION ──────────────────────────────────────────
    function initEngine(gameConfig) {
        injectStyles();
        MobileLayout.init();
        BetManager.init(gameConfig);
        SessionTracker.reset();
        IdleAttract.start();
        // Apply studio theme if provided
        if (gameConfig && gameConfig.studioId) {
            setStudioTheme(gameConfig.studioId);
        }
    }


    // ─── PUBLIC API ─────────────────────────────────────────────────────
    window.CasinoEngine = {
        init: initEngine,
        version: '2.0.0',

        // Win celebrations
        showWinCelebration: showWinCelebration,
        hideCelebration: hideCelebration,
        getWinTier: getWinTier,
        WIN_TIERS: WIN_TIERS,

        // Particles
        CoinParticles: CoinParticleSystem,

        // Anticipation
        Anticipation: Anticipation,

        // Near miss
        NearMiss: NearMiss,

        // Idle attract
        IdleAttract: IdleAttract,

        // Autoplay
        Autoplay: AutoplayEngine,

        // Bet management
        BetManager: BetManager,

        // Session tracking
        Session: SessionTracker,

        // Win line flash
        WinLineFlash: WinLineFlash,

        // Mobile
        Mobile: MobileLayout,

        // Sound hooks
        Sound: SoundHooks,

        // Studio themes
        setStudioTheme: setStudioTheme,
        getStudioTheme: getStudioTheme,
        studioThemes: _studioThemes,

        // Bonus round hooks
        BonusHooks: BonusHooks
    };

})(window);
