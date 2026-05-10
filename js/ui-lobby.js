// ═══════════════════════════════════════════════════════
// UI-LOBBY MODULE
// ═══════════════════════════════════════════════════════

        // Module-level search state — persists across filter tab switches
        let lobbySearchQuery = '';
        let currentMechanicFilter = 'all'; // 'all' | 'tumble' | 'hold_win' | 'free_spins' | 'wilds' | 'jackpot'
        let currentThemeCategoryFilter = 'all'; // 'all' | 'egypt' | 'fruit' | 'space' | 'fantasy' | 'animals' | 'asian' | 'horror' | 'australian' | 'wildcard'
        // currentProviderFilter declared in globals.js — DO NOT redeclare here (duplicate let = SyntaxError)
        let currentSortMode = 'default';    // 'default' | 'vol_asc' | 'vol_desc'
        let _sortOrder = 'popular';          // Sprint 37 dropdown: 'popular'|'az'|'za'|'rtp'|'volatile'|'chill'
        let searchQuery = '';                      // real-time game search (compound with other filters)
        let _lobbySearchQuery = '';                // hide/show search query (Sprint 18 search bar)

        // ═══════════════════════════════════════════════════════
        // 8 FICTIONAL PROVIDER STUDIOS — accent colours for UI chrome
        // ═══════════════════════════════════════════════════════
        var _providerChrome = {
            'Nebula Gaming':       { logo: '🌟', accent: '#00e5ff', id: 'nebula-gaming' },
            'Golden Reels Studio':      { logo: '👑', accent: '#ffd700', id: 'golden-reels' },
            'Mythic Forge':        { logo: '⚡', accent: '#b388ff', id: 'mythic-forge' },
            'Ironclad Entertainment': { logo: '🔥', accent: '#ff6d00', id: 'ironclad' },
            'Shadow Works':           { logo: '👻', accent: '#69f0ae', id: 'shadow-works' },
            'Wild Frontier Games':            { logo: '🎮', accent: '#ff4081', id: 'wild-frontier' },
            'Cascade Labs':      { logo: '⚡', accent: '#ffd740', id: 'cascade-labs' },
            'Dragon Pearl Studios':             { logo: '🌀', accent: '#40c4ff', id: 'dragon-pearl' }
        };
        function _getProviderAccent(name) {
            var p = _providerChrome[name];
            return p ? p.accent : '#888';
        }
        function _getProviderLogo(name) {
            var p = _providerChrome[name];
            return p ? p.logo : '🎰';
        }

        // Slot of the Day state (Sprint 24)
        let gameOfDayId = null;
        let gameOfDayTimer = null;

        // Hot/Cold game stats cache (Sprint 25)
        let gameStatsMap = {};  // gameId -> { actualRtp, totalSpins }

        // Tournament banner state
        let _activeTournaments = [];
        let _tournamentCountdownInterval = null;
        let _tournamentRefreshInterval = null;

        // Wager Race banner state
        let _wagerRaceRefreshInterval = null;
        let _wagerRaceCountdownInterval = null;

        // Jackpot Ticker state
        let _jackpotRefreshInterval = null;

        // Lucky Hour banner state
        let _luckyHourRefreshInterval = null;
        let _luckyHourCountdownInterval = null;

        // Quick-resume banner state
        var _resumeBannerTimer = null;
        var _lastPlayedGameForResume = null;

        // Live player count — seeded per game, jittered every 12 s
        var _liveCounts = {};
        var _liveCountInterval = null;

        function _hashId(s) {
            var h = 0;
            for (var i = 0; i < s.length; i++) { h = (Math.imul(31, h) + s.charCodeAt(i)) | 0; }
            return Math.abs(h);
        }

        function _seedCount(gameId, isHot) {
            var base = isHot ? 18 : 4;
            var spread = isHot ? 22 : 12;
            _liveCounts[gameId] = base + (_hashId(gameId) % spread);
        }

        function _getLiveCount(gameId) {
            return _liveCounts[gameId] > 0 ? _liveCounts[gameId] : '';
        }

        function _tickLiveCounts() {
            Object.keys(_liveCounts).forEach(function(id) {
                var cur = _liveCounts[id];
                // Random walk ±1 clamped to [1, 60]
                _liveCounts[id] = Math.max(1, Math.min(60, cur + (Math.random() < 0.5 ? 1 : -1)));
            });
            document.querySelectorAll('.card-players-live').forEach(function(el) {
                var id = el.dataset.game;
                var count = _liveCounts[id];
                if (count > 0) {
                    el.textContent = count + ' playing';
                    el.style.display = '';
                }
            });
        }

        function _startLiveCountTicker() {
            if (_liveCountInterval) return;
            _liveCountInterval = setInterval(_tickLiveCounts, 12000);
        }


        // ═══════════════════════════════════════════════════════
        // LOADING SKELETONS
        // ═══════════════════════════════════════════════════════

        function createSkeletonCards(count) {
            let html = '';
            for (let i = 0; i < count; i++) {
                html += `<div class="game-card-skeleton">
                    <div class="game-card-skeleton-art"></div>
                    <div class="game-card-skeleton-info">
                        <div class="game-card-skeleton-line"></div>
                        <div class="game-card-skeleton-line short"></div>
                    </div>
                </div>`;
            }
            return html;
        }


        function _getMechanicCategory(game) {
            const bt = game.bonusType || '';
            if (bt === 'tumble' || bt === 'avalanche' || bt === 'cascading') return 'tumble';
            if (bt === 'hold_and_win' || bt === 'coin_respin') return 'hold_win';
            if (bt === 'random_jackpot' || game.tag === 'JACKPOT' || game.tag === 'MEGA') return 'jackpot';
            if (bt.includes('wild')) return 'wilds';
            if ((game.freeSpinsCount && game.freeSpinsCount > 0) || bt.includes('free') || bt.includes('spin') ||
                bt === 'chamber_spins' || bt === 'sticky_wilds' || bt === 'walking_wilds' ||
                bt === 'multiplier_wilds' || bt === 'increasing_mult' || bt === 'win_streak' ||
                bt === 'prize_wheel' || bt === 'symbol_collect') return 'free_spins';
            return 'other';
        }

        function _getVolatility(game) {
            const payouts = game.payouts || {};
            const vals = Object.values(payouts).filter(v => typeof v === 'number');
            if (!vals.length) return 2;
            const maxMult = game.minBet > 0 ? Math.max(...vals) / game.minBet : 0;
            if (maxMult >= 300) return 3;
            if (maxMult >= 100) return 2;
            return 1;
        }


        function updateBalance() {
            document.getElementById('balance').textContent = formatMoney(balance);
            const slotBal = document.getElementById('slotBalance');
            if (slotBal) slotBal.textContent = formatMoney(balance);
            refreshBetControls();
            // Balance sparkline (Sprint 29)
            recordBalancePoint(balance);
            // Engagement safeguards — low-balance check
            if (typeof EngagementSafeguards !== 'undefined' && EngagementSafeguards.checkLowBalance) {
                EngagementSafeguards.checkLowBalance(balance);
            }
        }

        // ── Wagering Progress Display ────────────────────────────────
        var _lastWageringStatus = null;

        function updateWageringDisplay(wagerStatus) {
            _lastWageringStatus = wagerStatus;
            var wrap = document.getElementById('wageringBarWrap');
            var fill = document.getElementById('wageringBarFill');
            var label = document.getElementById('wageringBarLabel');
            if (!wrap) return;
            if (!wagerStatus || !wagerStatus.active) {
                wrap.style.display = 'none';
                return;
            }
            wrap.style.display = '';
            if (fill) fill.style.width = Math.min(100, wagerStatus.pct || 0) + '%';
            if (label) label.textContent = 'Bonus: $' + (wagerStatus.bonusBalance || 0).toFixed(0) + ' (' + (wagerStatus.pct || 0) + '% wagered)';

            // Also update wallet display if visible
            var walletBonus = document.getElementById('walletBonusDisplay');
            if (walletBonus) {
                walletBonus.style.display = '';
                var bonusBal = document.getElementById('walletBonusBalance');
                if (bonusBal) bonusBal.textContent = (wagerStatus.bonusBalance || 0).toFixed(2);
                var info = document.getElementById('walletWageringInfo');
                if (info) {
                    var remaining = (wagerStatus.requirement - wagerStatus.progress).toFixed(0);
                    info.textContent = 'Wager $' + remaining + ' more to unlock (' + wagerStatus.pct + '% complete)';
                }
            }
        }

        function _refreshWageringDisplay() {
            var token = localStorage.getItem('authToken') || sessionStorage.getItem('authToken');
            if (!token) return;
            fetch('/api/user/profile', { headers: { Authorization: 'Bearer ' + token } })
                .then(function(r) { return r.ok ? r.json() : null; })
                .then(function(data) {
                    if (!data || !data.user) return;
                    var u = data.user;
                    var bonus = parseFloat(u.bonus_balance) || 0;
                    var req = parseFloat(u.wagering_requirement) || 0;
                    var prog = parseFloat(u.wagering_progress) || 0;
                    if (bonus <= 0 || req <= 0) { updateWageringDisplay(null); return; }
                    var pct = Math.min(100, Math.round((prog / req) * 100));
                    updateWageringDisplay({ active: true, bonusBalance: bonus, requirement: req, progress: prog, pct: pct });
                })
                .catch(function() {});
        }

        // ── Balance History Sparkline (Sprint 29) ────────────────────────────────
        var _BALANCE_HIST_KEY = 'matrixBalanceHistory';
        var _BALANCE_HIST_MAX = 100;

        function recordBalancePoint(bal) {
            try {
                var hist = JSON.parse(localStorage.getItem(_BALANCE_HIST_KEY) || '[]');
                hist.push({ t: Date.now(), v: bal });
                if (hist.length > _BALANCE_HIST_MAX) hist = hist.slice(-_BALANCE_HIST_MAX);
                localStorage.setItem(_BALANCE_HIST_KEY, JSON.stringify(hist));
            } catch(e) {}
            renderBalanceSparkline();
        }

        function renderBalanceSparkline() {
            var svgEl = document.getElementById('balanceSparkline');
            var wrapEl = document.getElementById('balanceSparklineWrap');
            if (!svgEl || !wrapEl) return;
            var hist = [];
            try { hist = JSON.parse(localStorage.getItem(_BALANCE_HIST_KEY) || '[]'); } catch(e) {}
            var pts = hist.slice(-50);
            if (pts.length < 3) { wrapEl.style.display = 'none'; return; }
            wrapEl.style.display = '';
            var vals = pts.map(function(p) { return p.v; });
            var minV = Math.min.apply(null, vals);
            var maxV = Math.max.apply(null, vals);
            var range = maxV - minV || 1;
            var W = 120, H = 36, pad = 3;
            var points = vals.map(function(v, i) {
                var x = pad + (i / (vals.length - 1)) * (W - pad * 2);
                var y = H - pad - ((v - minV) / range) * (H - pad * 2);
                return x.toFixed(1) + ',' + y.toFixed(1);
            }).join(' ');
            var isUp = vals[vals.length - 1] >= vals[0];
            var color = isUp ? '#4ade80' : '#f87171';
            svgEl.innerHTML =
                '<polyline points="' + points + '" fill="none" stroke="' + color + '" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>';
        }


        function getBetBounds() {
            if (!currentGame) return null;
            // Find the first BET_STEPS value at or above the game's minBet floor
            const gameMin = currentGame.minBet;
            const gameMax = Math.min(currentGame.maxBet, balance || gameMin);
            const validSteps = BET_STEPS.filter(v => v >= gameMin - 0.001 && v <= gameMax + 0.001);
            if (validSteps.length === 0) {
                // Edge case: balance too low for even the cheapest step — use game floor directly
                return { minBet: gameMin, maxBet: Math.max(gameMin, gameMax) };
            }
            return { minBet: validSteps[0], maxBet: validSteps[validSteps.length - 1] };
        }


        function refreshBetControls() {
            if (!currentGame) return;

            const betRange = document.getElementById('betRange');
            const bounds = getBetBounds();
            if (!betRange || !bounds) return;

            // Build valid step list for this game/balance combo
            const validSteps = BET_STEPS.filter(v => v >= bounds.minBet - 0.001 && v <= bounds.maxBet + 0.001);
            const stepCount = validSteps.length;

            // Range slider travels 0…(stepCount-1) indices — non-linear mapping
            betRange.min   = 0;
            betRange.max   = Math.max(0, stepCount - 1);
            betRange.step  = 1;

            // Snap currentBet to the nearest valid step
            if (stepCount > 0) {
                if (currentBet < bounds.minBet) currentBet = bounds.minBet;
                if (currentBet > bounds.maxBet) currentBet = bounds.maxBet;
                const nearest = validSteps.reduce((a, b) =>
                    Math.abs(b - currentBet) < Math.abs(a - currentBet) ? b : a);
                currentBet = nearest;
                betRange.value = validSteps.findIndex(v => Math.abs(v - currentBet) < 0.001);
            }

            document.getElementById('minBet').textContent = bounds.minBet.toFixed(2);
            document.getElementById('maxBet').textContent = currentGame.maxBet.toFixed(2);
            updateBetDisplay();

            const spinBtn = document.getElementById('spinBtn');
            if (spinBtn) {
                spinBtn.disabled = spinning || currentBet > balance;
            }
        }


        function showResumeBanner(game) {
            if (!game) return;
            // Remove existing banner
            var old = document.getElementById('lobbyResumeBanner');
            if (old) old.remove();
            if (_resumeBannerTimer) { clearTimeout(_resumeBannerTimer); _resumeBannerTimer = null; }

            var banner = document.createElement('div');
            banner.id = 'lobbyResumeBanner';
            banner.className = 'lobby-resume-banner';
            banner.innerHTML =
                '<span class="resume-icon">&#8629;</span>' +
                '<span class="resume-label">Resume <strong>' + escapeHtml(game.name || 'Last Game') + '</strong></span>' +
                '<span class="resume-x" id="resumeBannerX">&#x2715;</span>';

            document.body.appendChild(banner);

            // Slide in
            setTimeout(function() {
                setTimeout(function() { banner.classList.add('visible'); });
            });

            // Click banner body to resume
            banner.addEventListener('click', function(e) {
                if (e.target.id === 'resumeBannerX') return;
                banner.classList.remove('visible');
                setTimeout(function() { if (banner.parentNode) banner.remove(); }, 400);
                if (_resumeBannerTimer) { clearTimeout(_resumeBannerTimer); _resumeBannerTimer = null; }
                if (typeof openSlot === 'function') openSlot(game);
            });

            // X to dismiss
            document.getElementById('resumeBannerX').addEventListener('click', function(e) {
                e.stopPropagation();
                banner.classList.remove('visible');
                setTimeout(function() { if (banner.parentNode) banner.remove(); }, 400);
                if (_resumeBannerTimer) { clearTimeout(_resumeBannerTimer); _resumeBannerTimer = null; }
            });

            // Auto-dismiss after 8s
            _resumeBannerTimer = setTimeout(function() {
                banner.classList.remove('visible');
                setTimeout(function() { if (banner.parentNode) banner.remove(); }, 400);
                _resumeBannerTimer = null;
            }, 8000);
        }

        // Called from closeSlot in ui-slot.js to capture last played game before returning to lobby
        function captureLastPlayedGame() {
            if (typeof currentGame !== 'undefined' && currentGame) {
                _lastPlayedGameForResume = currentGame;
            }
        }

        function renderRecommendations(container) {
            // Need recently played data
            var rpRaw = localStorage.getItem(typeof RECENTLY_PLAYED_KEY !== 'undefined' ? RECENTLY_PLAYED_KEY : 'recentlyPlayed');
            var rpIds = [];
            try { rpIds = JSON.parse(rpRaw) || []; } catch(e) {}
            if (rpIds.length < 2) return; // Not enough history

            var allGames = typeof GAMES !== 'undefined' ? GAMES : [];
            var rpGames = rpIds.slice(0, 5).map(function(id) {
                return allGames.find(function(g) { return g.id === id; });
            }).filter(Boolean);
            if (rpGames.length < 2) return;

            // Collect providers and bonusTypes from recent plays
            var likedProviders = {};
            var likedBonus = {};
            rpGames.forEach(function(g) {
                if (g.provider) likedProviders[g.provider] = (likedProviders[g.provider] || 0) + 1;
                if (g.bonusType) likedBonus[g.bonusType] = (likedBonus[g.bonusType] || 0) + 1;
            });

            // Score all games by affinity
            var rpIdSet = new Set(rpIds);
            var scored = allGames.filter(function(g) { return !rpIdSet.has(g.id); }).map(function(g) {
                var score = 0;
                if (g.provider && likedProviders[g.provider]) score += likedProviders[g.provider] * 2;
                if (g.bonusType && likedBonus[g.bonusType]) score += likedBonus[g.bonusType];
                return { game: g, score: score };
            }).filter(function(x) { return x.score > 0; });
            scored.sort(function(a, b) { return b.score - a.score; });

            var picks = scored.slice(0, 4).map(function(x) { return x.game; });
            if (picks.length === 0) return;

            var row = document.createElement('div');
            row.className = 'lobby-recommendations';
            row.innerHTML = '<div class="lobby-rec-label">Recommended for you</div>';
            var chips = document.createElement('div');
            chips.className = 'lobby-rec-games';
            picks.forEach(function(g) {
                var chip = document.createElement('div');
                chip.className = 'lobby-rec-chip';
                chip.textContent = g.name || g.id;
                chip.addEventListener('click', function() {
                    if (typeof openSlot === 'function') openSlot(g.id);
                });
                chips.appendChild(chip);
            });
            row.appendChild(chips);
            container.appendChild(row);
        }


                // ── XP Level Badge (Sprint 20) ────────────────────────────────────────
        function _renderXPBadge() {
            // Read XP data from localStorage using the canonical key
            const XP_KEY = typeof XP_STORAGE_KEY !== 'undefined' ? XP_STORAGE_KEY
                         : typeof STORAGE_KEY_XP  !== 'undefined' ? STORAGE_KEY_XP
                         : 'casinoXP';
            let xpData = null;
            try {
                const raw = localStorage.getItem(XP_KEY);
                if (raw) xpData = JSON.parse(raw);
            } catch(e) {}

            // XP data is {xp: <within-level>, level: <level>} — same structure as saveXP()
            const level      = (xpData && xpData.level   != null) ? Math.max(1, xpData.level)   : 1;
            const xpIntoLvl  = (xpData && xpData.xp      != null) ? Math.max(0, xpData.xp)      : 0;

            // XP required for THIS level: floor(100 * 1.25^(level-1))
            const baseXP   = typeof BASE_XP_PER_LEVEL     !== 'undefined' ? BASE_XP_PER_LEVEL     : 100;
            const growth   = typeof XP_LEVEL_GROWTH_RATE  !== 'undefined' ? XP_LEVEL_GROWTH_RATE  : 1.25;
            const needed   = Math.max(1, Math.floor(baseXP * Math.pow(growth, level - 1)));
            const xpToNext = Math.max(0, needed - xpIntoLvl);
            const pct      = Math.min(100, Math.round((xpIntoLvl / needed) * 100));

            // Icon scales with level tier
            const icon = level >= 50 ? '💎' : level >= 20 ? '🏆' : level >= 10 ? '⭐' : '🎮';

            // Create badge element once; update on every call
            let badge = document.getElementById('xpLevelBadge');
            if (!badge) {
                badge = document.createElement('div');
                badge.id        = 'xpLevelBadge';
                badge.className = 'xp-level-badge';
                badge.title     = 'Your XP progress — click to open stats';
                badge.addEventListener('click', function() {
                    if (typeof openStatsModal === 'function') openStatsModal();
                    else if (typeof openXPModal === 'function') openXPModal();
                });

                // Insert before #filterTabs so it sits above the game filter row
                const filterTabs = document.getElementById('filterTabs');
                if (filterTabs && filterTabs.parentNode) {
                    filterTabs.parentNode.insertBefore(badge, filterTabs);
                } else {
                    // Fallback: prepend to main lobby container
                    const lobby = document.getElementById('lobby') ||
                                  document.getElementById('lobbyView') ||
                                  document.querySelector('.lobby-container');
                    if (lobby) lobby.insertBefore(badge, lobby.firstChild);
                }
            }

            badge.innerHTML = [
                '<span class="xp-badge-icon">' + icon + '</span>',
                '<div class="xp-badge-info">',
                  '<div class="xp-badge-level-row">',
                    '<span class="xp-badge-level">Level ' + level + '</span>',
                    '<span class="xp-badge-next">' + xpToNext.toLocaleString() + ' xp to next</span>',
                  '</div>',
                  '<div class="xp-bar-track">',
                    '<div class="xp-bar-fill" style="width:' + pct + '%"></div>',
                  '</div>',
                '</div>'
            ].join('');
        }

// ═══════════════════════════════════════════════════════
        // SLOT OF THE DAY (Sprint 24)
        // ═══════════════════════════════════════════════════════

        function applyGameOfDayBadge() {
            // Remove any stale badge first
            var oldBadge = document.querySelector('.game-of-day-badge');
            if (oldBadge) oldBadge.remove();
            var oldCard = document.querySelector('.game-of-day-card');
            if (oldCard) oldCard.classList.remove('game-of-day-card');
            if (!gameOfDayId) return;
            // data-game-id is stored lowercased in the DOM
            var card = document.querySelector('[data-game-id="' + gameOfDayId.toLowerCase() + '"]');
            if (card) {
                card.classList.add('game-of-day-card');
                var badge = document.createElement('div');
                badge.className = 'game-of-day-badge';
                badge.innerHTML = '&#11088; TODAY';
                card.appendChild(badge);
            }
        }

        function fetchGameOfDay() {
            fetch('/api/game-of-day')
                .then(function(r) { return r.json(); })
                .then(function(data) {
                    if (data && data.gameId) {
                        gameOfDayId = data.gameId;
                        applyGameOfDayBadge();
                        // Set up countdown to refresh at midnight UTC
                        if (gameOfDayTimer) clearTimeout(gameOfDayTimer);
                        if (data.secondsUntilNext > 0) {
                            gameOfDayTimer = setTimeout(fetchGameOfDay, data.secondsUntilNext * 1000);
                        }
                    }
                })
                .catch(function() {
                    // Fallback: client-side deterministic selection
                    if (typeof GAMES !== 'undefined' && GAMES && GAMES.length) {
                        var dayIdx = Math.floor(Date.now() / 86400000);
                        var sortedIds = GAMES.map(function(g) { return g.id; }).sort();
                        gameOfDayId = sortedIds[dayIdx % sortedIds.length];
                    }
                });
        }

function fetchGameStats() {
            fetch('/api/game-stats')
                .then(function(r) { return r.json(); })
                .then(function(data) {
                    if (data && Array.isArray(data.stats)) {
                        gameStatsMap = {};
                        data.stats.forEach(function(s) {
                            gameStatsMap[s.gameId] = { actualRtp: s.actualRtp, totalSpins: s.totalSpins };
                        });
                        // Re-apply badges to already-rendered cards
                        applyHotColdBadges();
                    }
                })
                .catch(function() {
                    // silently fail — hot/cold is cosmetic only
                });
        }

        function applyHotColdBadges() {
            // Remove any existing hot/cold badges
            document.querySelectorAll('.game-hot-badge, .game-cold-badge').forEach(function(el) { el.remove(); });
            document.querySelectorAll('.game-card').forEach(function(card) {
                var gameId = card.getAttribute('data-game-id');
                if (!gameId) return;
                var stats = gameStatsMap[gameId];
                if (!stats) return;
                var badge = document.createElement('div');
                if (stats.actualRtp > 92) {
                    badge.className = 'game-hot-badge';
                    badge.textContent = '🔥';
                    badge.title = 'Hot! Recent RTP: ' + stats.actualRtp.toFixed(1) + '%';
                    card.appendChild(badge);
                } else if (stats.actualRtp < 84) {
                    badge.className = 'game-cold-badge';
                    badge.textContent = '❄️';
                    badge.title = 'Cold. Recent RTP: ' + stats.actualRtp.toFixed(1) + '%';
                    card.appendChild(badge);
                }
            });
        }

function renderGames() {
            renderLobbyChallengeWidget();
            initTournamentBanner();
            initWagerRaceBanner();
            initJackpotTicker();
            initLuckyHourBanner();
            initHotGameHighlight();
            if (!window._jackpotTickerInit) initJackpotTicker();
            if (!window._jackpotTickerBarInit) initJackpotTickerBar();
            if (!window._gameOfDayInit)    initGameOfDayBanner();
            window._featuredHighlightsApplied = false;
            setTimeout(applyFeaturedGameHighlights, 150);
            if (!window._luckyHoursBannerInit) initLuckyHoursBanner();
            if (!window._loyaltyHookInit) { window._loyaltyHookInit = true; initLoyaltyEarnHook(); }
            if (!window._socialProofInit) { window._socialProofInit = true; initSocialProofTicker(); }
            if (!window._leaderboardWidgetInit) initLeaderboardWidget();
            if (!window._bigWinsFeedInit)       initBigWinsFeed();
            if (!window._promoCodeWidgetInit)   initPromoCodeWidget();
            // Load user's favorites from API (Sprint XX)
            if (typeof _loadFavoritesFromApi === 'function') _loadFavoritesFromApi();
            // Cashback available banner for eligible logged-in users
            if (!window._cashbackBannerInit) { window._cashbackBannerInit = true; initCashbackBanner(); }
            // Wagering progress bar — fetch once on login and refresh after each spin result
            _refreshWageringDisplay();
            // Apply HOT/COLD RTP labels from game-stats API (reset flag so re-render refreshes labels)
            window._gameStatsApplied = false;
            setTimeout(fetchAndApplyGameStats, 100);

            // Show resume banner if returning from a slot
            if (typeof _lastPlayedGameForResume !== 'undefined' && _lastPlayedGameForResume) {
                showResumeBanner(_lastPlayedGameForResume);
                _lastPlayedGameForResume = null;
            }

            // Inject search bar once — positioned before filter tabs
            if (!document.getElementById('lobbySearchBar')) {
                const filterTabs = document.getElementById('filterTabs');
                if (filterTabs) {
                    const searchBarEl = document.createElement('div');
                    searchBarEl.id = 'lobbySearchBar';
                    searchBarEl.innerHTML = `
                        <div style="position:relative; flex:1;">
                            <span style="position:absolute;left:10px;top:50%;transform:translateY(-50%);color:rgba(255,255,255,0.4);font-size:16px;">🔍</span>
                            <input id="lobbySearchInput" type="text" placeholder="Search games or providers..."
                                style="width:100%;padding:9px 36px 9px 34px;background:rgba(255,255,255,0.07);border:1px solid rgba(255,255,255,0.12);
                                       border-radius:20px;color:#fff;font-size:13px;outline:none;box-sizing:border-box;"
                                oninput="lobbyOnSearch(this.value)">
                            <button id="lobbySearchClear" onclick="lobbyOnSearch('')"
                                style="display:none;position:absolute;right:10px;top:50%;transform:translateY(-50%);
                                       background:none;border:none;color:rgba(255,255,255,0.5);cursor:pointer;font-size:18px;padding:0;line-height:1;">×</button>
                        </div>
                    `;
                    filterTabs.parentNode.insertBefore(searchBarEl, filterTabs);
                }
            }

            // Inject provider quick-link strip once — after search bar, before filter tabs
            if (!document.getElementById('lobbyProviderStrip')) {
                const filterTabs = document.getElementById('filterTabs');
                if (filterTabs) {
                    const providers = [...new Set(games.map(g => g.provider))].sort();
                    const stripEl = document.createElement('div');
                    stripEl.id = 'lobbyProviderStrip';
                    stripEl.style.cssText = 'display:flex;gap:6px;overflow-x:auto;padding:4px 0 8px;scrollbar-width:none;';
                    stripEl.innerHTML = providers.map(p => `
                        <button class="lobby-provider-pill" onclick="lobbySetProvider('${p.replace(/'/g, "\\'")}')"
                            data-provider="${p}"
                            style="flex-shrink:0;padding:4px 12px;border-radius:20px;border:1px solid rgba(255,255,255,0.15);
                                   background:rgba(255,255,255,0.06);color:rgba(255,255,255,0.7);font-size:11px;
                                   cursor:pointer;white-space:nowrap;transition:all 0.15s;">
                            ${p}
                        </button>`).join('');
                    filterTabs.parentNode.insertBefore(stripEl, filterTabs);
                }
            }

            // Inject Favourites filter tab once
            if (!document.getElementById('favFilterTab')) {
                const filterTabs = document.getElementById('filterTabs');
                if (filterTabs) {
                    const favTab = document.createElement('button');
                    favTab.id = 'favFilterTab';
                    favTab.className = 'filter-tab';
                    favTab.dataset.filter = 'favorites';
                    favTab.setAttribute('onclick', "setFilter('favorites')");
                    favTab.innerHTML = '\u2764\uFE0F Favourites';
                    filterTabs.appendChild(favTab);
                }
            }

            const hotGamesDiv = document.getElementById('hotGames');
            const allGamesDiv = document.getElementById('allGames');

            // Show loading skeletons first for a polished loading feel
            hotGamesDiv.innerHTML = createSkeletonCards(6);
            allGamesDiv.innerHTML = createSkeletonCards(12);

            // Small delay to ensure CSS animations render, then swap in real cards
            setTimeout(() => {
                    const hotGames = games.filter(g => g.hot);
                    hotGamesDiv.innerHTML = hotGames.map(g => createGameCard(g)).join('');
                    renderFilteredGames();
                    _injectLobbySearch();
                    renderRecentlyPlayed();
                    renderYouMightLike();
                    renderRecommendations(allGamesDiv.parentNode || document.getElementById('lobby') || allGamesDiv);
                    renderBestWins();
                    if (typeof _injectFilterCounts === 'function') _injectFilterCounts();
                    if (typeof _renderFeaturedSpotlight === 'function') _renderFeaturedSpotlight();
                    if (typeof _initLazyThumbnails === 'function') _initLazyThumbnails();
                    // Slot of the Day — fetch once on first render, timer handles subsequent days
                    if (!gameOfDayId) fetchGameOfDay();
                    else applyGameOfDayBadge();
                    // Hot/Cold badges — fire-and-forget, cosmetic only
                    fetchGameStats();
                    // Live-count tick removed — no fake player counts
                    // Initial tab count badges after games load (Sprint 19)
                    setTimeout(function() { if (typeof _updateTabCounts === 'function') _updateTabCounts(); }, 0);
                    // XP level badge update (Sprint 20)
                    setTimeout(function() { if (typeof _renderXPBadge === 'function') _renderXPBadge(); }, 50);
                    // Balance sparkline (Sprint 29)
                    renderBalanceSparkline();
                    // Instant Games section
                    // if (typeof renderInstantGamesSection === 'function') renderInstantGamesSection();
                    // Weekly Leaderboard widget
                    if (typeof renderWeeklyLeaderboard === 'function') renderWeeklyLeaderboard();
                    // Boosts Shop widget
                    if (typeof renderBoostsWidget === 'function') renderBoostsWidget();
                    // Mines mini-game widget
                    // // Hi-Lo card game widget
                    // Quick-bet widget removed
                    // // Keno mini-game widget
                    // // REMOVED: Chuck-a-Luck dice game widget (deleted)
                    // Big Six Wheel game widget
                    if (typeof renderBigSixWheelWidget === 'function') renderBigSixWheelWidget();
                    // Keno Turbo quick-play widget
                    // // Game stats hot/cold indicator widget
                    if (typeof renderGameStatsWidget === 'function') renderGameStatsWidget();
                }, 200);
        }


        function addRecentlyPlayed(gameId) {
            let recent = [];
            try { recent = JSON.parse(localStorage.getItem(RECENTLY_PLAYED_KEY)) || []; } catch(e) {}
            recent = recent.filter(id => id !== gameId);
            recent.unshift(gameId);
            if (recent.length > MAX_RECENTLY_PLAYED) recent = recent.slice(0, MAX_RECENTLY_PLAYED);
            try { localStorage.setItem(RECENTLY_PLAYED_KEY, JSON.stringify(recent)); } catch (e) { /* ignore */ }
            renderRecentlyPlayed();
        }


        function renderRecentlyPlayed() {
            let recent = [];
            try { recent = JSON.parse(localStorage.getItem(RECENTLY_PLAYED_KEY)) || []; } catch(e) {}
            const section = document.getElementById('recentlyPlayedSection');
            const container = document.getElementById('recentlyPlayedGames');
            if (!section || !container) return;
            if (recent.length === 0) { section.style.display = 'none'; return; }
            const recentGames = recent.map(id => games.find(g => g.id === id)).filter(Boolean);
            section.style.display = '';
            container.innerHTML = recentGames.map(g => createGameCard(g)).join('');
            renderYouMightLike();
            renderBestWins();
        }

        function renderYouMightLike() {
            // Clean up stale section if games list not ready
            if (!games || games.length === 0) return;

            // Get recently played IDs
            let recentIds = [];
            try { recentIds = JSON.parse(localStorage.getItem(RECENTLY_PLAYED_KEY)) || []; } catch(e) {}
            if (recentIds.length < 2) {
                // Not enough play history — hide the section
                const old = document.getElementById('youMightLikeSection');
                if (old) old.style.display = 'none';
                return;
            }

            // Determine dominant mechanic category from recent games
            const recentGames = recentIds.map(id => games.find(g => g.id === id)).filter(Boolean);
            const categoryCounts = {};
            recentGames.forEach(g => {
                const cat = _getMechanicCategory(g);
                categoryCounts[cat] = (categoryCounts[cat] || 0) + 1;
            });
            // Pick the most-played category (excluding 'other')
            let topCat = 'other';
            let topCount = 0;
            Object.entries(categoryCounts).forEach(([cat, count]) => {
                if (cat !== 'other' && count > topCount) { topCat = cat; topCount = count; }
            });
            // If all are 'other', pick any
            if (topCat === 'other') {
                topCat = Object.keys(categoryCounts)[0] || 'other';
            }

            // Find candidate games: same mechanic, not recently played
            const recentSet = new Set(recentIds);
            const candidates = games.filter(g => !recentSet.has(g.id) && _getMechanicCategory(g) === topCat);

            if (candidates.length === 0) {
                const old = document.getElementById('youMightLikeSection');
                if (old) old.style.display = 'none';
                return;
            }

            // Shuffle and take up to 6
            const shuffled = candidates.slice().sort(() => Math.random() - 0.5).slice(0, 6);

            const catLabels = {
                tumble: '🌊 Tumble Games', hold_win: '🎯 Hold & Win', free_spins: '🎁 Free Spins',
                wilds: '🌟 Wild Games', jackpot: '🏆 Jackpot Games', other: '🎰 Similar Games'
            };
            const label = catLabels[topCat] || 'Similar Games';
            const becauseGame = recentGames[0] ? recentGames[0].name : 'similar games';

            // Inject or update section
            let section = document.getElementById('youMightLikeSection');
            if (!section) {
                section = document.createElement('div');
                section.id = 'youMightLikeSection';
                // Insert after recentlyPlayedSection, or before allGames header
                const recentSec = document.getElementById('recentlyPlayedSection');
                if (recentSec && recentSec.parentNode) {
                    recentSec.parentNode.insertBefore(section, recentSec.nextSibling);
                } else {
                    const allGames = document.getElementById('allGames');
                    if (allGames && allGames.parentNode) allGames.parentNode.insertBefore(section, allGames);
                }
            }

            section.style.display = '';
            section.innerHTML = `
                <div class="section-header">
                    <h3 class="section-title" style="font-size:14px">${label}<span style="font-size:10px;font-weight:400;color:rgba(255,255,255,0.35);margin-left:8px;font-style:italic;">because you play ${becauseGame}</span></h3>
                </div>
                <div class="recently-played-scroll" id="youMightLikeGames">
                    ${shuffled.map(g => createGameCard(g)).join('')}
                </div>`;
        }

        function renderBestWins() {
            const HOF_KEY = typeof STORAGE_KEY_HALL_OF_FAME !== 'undefined'
                ? STORAGE_KEY_HALL_OF_FAME : 'matrixHallOfFame';
            let entries = [];
            try { entries = JSON.parse(localStorage.getItem(HOF_KEY)) || []; } catch(e) {}

            // Remove stale section if no data
            const existing = document.getElementById('bestWinsSection');
            if (entries.length === 0) {
                if (existing) existing.style.display = 'none';
                return;
            }

            // Take top 5 by amount
            const top = entries.slice().sort((a, b) => b.amount - a.amount).slice(0, 5);

            let section = existing;
            if (!section) {
                section = document.createElement('div');
                section.id = 'bestWinsSection';
                // Inject at end of lobby container (after youMightLikeSection or allGames)
                const yml = document.getElementById('youMightLikeSection');
                const allGames = document.getElementById('allGames');
                const anchor = yml || allGames;
                if (anchor && anchor.parentNode) {
                    anchor.parentNode.appendChild(section);
                } else {
                    const container = document.querySelector('.lobby-content') || document.querySelector('main');
                    if (container) container.appendChild(section);
                }
            }

            section.style.display = '';
            section.innerHTML = `
                <div class="section-header">
                    <h3 class="section-title" style="font-size:14px">🏆 Your Best Wins</h3>
                </div>
                <div class="best-wins-list">
                    ${top.map((e, idx) => `
                    <div class="best-win-row">
                        <span class="bw-rank">#${idx + 1}</span>
                        <span class="bw-game">${e.gameName || e.game || 'Unknown'}</span>
                        <span class="bw-mult">${e.mult ? e.mult.toFixed(1) + '×' : ''}</span>
                        <span class="bw-amount">$${(e.amount || 0).toLocaleString(undefined, {minimumFractionDigits:2,maximumFractionDigits:2})}</span>
                        <span class="bw-date">${e.date ? e.date.slice(0,10) : ''}</span>
                    </div>
                    `).join('')}
                </div>`;
        }


        function _giVolatility(game) {
            const maxMult = game.payouts && game.minBet > 0
                ? (game.payouts.triple || game.payouts.payline5 || 0) / game.minBet
                : 100;
            if (maxMult >= 300) return { cls: 'gi-vol--high', dots: '●●●', label: 'High' };
            if (maxMult >= 100) return { cls: 'gi-vol--med',  dots: '●●○', label: 'Med'  };
            return                     { cls: 'gi-vol--low',  dots: '●○○', label: 'Low'  };
        }

        function _giBonusLabel(game) {
            const map = {
                // Legacy/original types
                tumble: 'Tumble', avalanche: 'Tumble', random_multiplier: 'Random ×',
                zeus_multiplier: 'Zeus ×', money_collect: 'Collect', stacked_wilds: 'Stacked Wilds',
                expanding_wild_respin: 'Expand+Respin', expanding_symbol: 'Expanding',
                fisherman_collect: 'Fish Collect', wheel_multiplier: 'Wheel ×',
                hold_and_win: 'Hold & Win', coin_respin: 'Coin Respin',
                // Sprint 1-2
                wild_collect: 'Wild Meter', mystery_stacks: 'Mystery Stacks',
                chamber_spins: 'Chamber Spins', sticky_wilds: 'Sticky Wilds',
                walking_wilds: 'Walking Wilds', win_streak: 'Win Streak',
                multiplier_wilds: 'Mult Wilds', increasing_mult: 'Rising ×',
                // Sprint 3
                cascading: 'Cascade', expanding_wilds: 'Expand Wild', respin: 'Re-Spin',
                // Sprint 4
                prize_wheel: 'Prize Wheel', colossal: 'Colossal', symbol_collect: 'Symbol Collect',
                // Sprint 5
                wild_reels: 'Wild Reels', both_ways: 'Both Ways', random_jackpot: 'Random JP',
            };
            return map[game.bonusType] || 'Bonus';
        }

        function _getDailyHotGames() {
            var g = (typeof games !== 'undefined' && games) || window.GAMES;
            if (!g || !g.length) return new Set();
            // Simple deterministic daily seed from date string
            var seed = new Date().toDateString().split('').reduce(function(h, c) {
                return (Math.imul(31, h) + c.charCodeAt(0)) | 0;
            }, 0);
            var indices = new Set();
            var len = g.length;
            var s = Math.abs(seed);
            while (indices.size < 8) {
                s = (Math.imul(s, 1664525) + 1013904223) | 0;
                indices.add(Math.abs(s) % len);
            }
            return new Set(Array.from(indices).map(function(i) { return g[i].id; }));
        }

        function _getNewGameIds() {
            var g = (typeof games !== 'undefined' && games) || window.GAMES;
            if (!g || g.length < 6) return new Set();
            return new Set(g.slice(-6).map(function(x) { return x.id; }));
        }

        // Cache hot/new sets — recomputed only once per day
        var _cachedHotIds = null, _cachedNewIds = null, _cachedHotDate = '';
        function _getHotNewCached() {
            var today = new Date().toDateString();
            if (!_cachedHotIds || _cachedHotDate !== today) {
                _cachedHotIds  = _getDailyHotGames();
                _cachedNewIds  = _getNewGameIds();
                _cachedHotDate = today;
            }
            return { hotIds: _cachedHotIds, newIds: _cachedNewIds };
        }

        function _getMaxWinMultiplier(game) {
            var p = game.payouts || {};
            var candidates = [
                p.payline5, p.payline4, p.payline3,
                p.cluster15, p.cluster12, p.cluster8, p.cluster5,
                p.wildTriple, p.triple, p.double
            ].filter(function(v) { return typeof v === 'number' && v > 0; });
            return candidates.length ? Math.max.apply(null, candidates) : 0;
        }

        function createGameCard(game) {
            const { hotIds: _hotIds, newIds: _newIds } = _getHotNewCached();
            // Thumbnails are lazy-loaded via IntersectionObserver (_initLazyThumbnails).
            // data-bg stores the URL; the observer applies it only when the card is visible.
            const hasThumbnail = !!game.thumbnail;
            const thumbStyle = hasThumbnail
                ? `background-color: #1a2332; background-size: cover; background-position: center;`
                : `background: ${game.bgGradient};`;
            const thumbDataBg = hasThumbnail ? ` data-bg="${game.thumbnail}"` : '';
            const isJackpot = game.tag === 'JACKPOT' || game.tagClass === 'tag-jackpot';
            const isHot  = game.tag === 'HOT'  || game.tagClass === 'tag-hot';
            const isNew  = game.tag === 'NEW'  || game.tagClass === 'tag-new';
            // Non-jackpot tags go top-right; jackpot gets its own bottom badge
            const topTag = (!isJackpot && game.tag)
                ? `<div class="game-tag ${game.tagClass}${isHot ? ' tag-hot-flame' : ''}${isNew ? ' tag-new-glow' : ''}">${game.tag}</div>`
                : '';
            const jackpotBadge = isJackpot
                ? `<div class="game-jackpot-badge"><svg viewBox="0 0 12 12" fill="currentColor" width="9" height="9" style="margin-right:3px"><path d="M6 1l1 2.5h2.5l-2 1.5.8 2.5L6 6.2l-2.3 1.3.8-2.5-2-1.5H5z"/></svg>JACKPOT</div>`
                : '';
            const vol = deriveGameVolatility(game);
            const volClass = vol === 'Very High' ? 'vol-very-high' : vol === 'High' ? 'vol-high' : vol === 'Medium' ? 'vol-medium' : 'vol-low';
            const volDots = vol === 'Very High' ? 4 : vol === 'High' ? 3 : vol === 'Medium' ? 2 : 1;
            const dotsHtml = Array.from({length: 4}, (_, i) =>
                `<span class="vol-dot${i < volDots ? ' vol-dot-filled' : ''}"></span>`
            ).join('');
            const featureIconMap = {
                // Legacy/original types
                tumble: '⬇️', avalanche: '🪨', random_multiplier: '✨', zeus_multiplier: '⚡',
                money_collect: '💰', stacked_wilds: '🔥', hold_and_win: '🎯',
                fisherman_collect: '🎣', wheel_multiplier: '🎡', expanding_symbol: '📖',
                expanding_wild_respin: '🌟', progressive: '🏆', mystery_symbols: '❓',
                nudge: '👆', trail_bonus: '🗺️', pick_bonus: '🎁', super_meter: '📊',
                lightning_respin: '⚡', mega_symbols: '🔮', coin_respin: '🪙',
                // Sprint 1-2
                wild_collect: '⚡', mystery_stacks: '❓', chamber_spins: '🔫',
                sticky_wilds: '🍯', walking_wilds: '🚶', win_streak: '🔥',
                multiplier_wilds: '✖️', increasing_mult: '📈',
                // Sprint 3
                respin: '🔄', cascading: '🌊', expanding_wilds: '🌟',
                // Sprint 4
                prize_wheel: '🎡', colossal: '🔮', symbol_collect: '💎',
                // Sprint 5
                wild_reels: '🎰', both_ways: '↔️', random_jackpot: '💰',
            };
            const bonusIcon = (game.bonusType && featureIconMap[game.bonusType]) || '🎰';
            const gridLabel = (game.gridCols && game.gridRows) ? `${game.gridCols}×${game.gridRows}` : '';
            const fsLabel  = game.freeSpinsCount ? `${game.freeSpinsCount} FS` : '';
            const metaPills = [gridLabel, fsLabel].filter(Boolean)
                .map(t => `<span class="game-hover-pill">${t}</span>`).join('');
            const shortDesc = game.bonusDesc
                ? `<div class="game-hover-desc">${bonusIcon} ${game.bonusDesc.split(':').pop().trim().slice(0,60)}${game.bonusDesc.length > 70 ? '…' : ''}</div>`
                : '';
            const favored = isFavorite(game.id);
            const favIcon = favored ? '\u2764\uFE0F' : '\u2661';
            // Slot of the Day badge (Sprint 24)
            const isGameOfDay = gameOfDayId && game.id.toLowerCase() === gameOfDayId.toLowerCase();
            const gameDayBadgeHtml = isGameOfDay
                ? '<div class="game-of-day-badge">&#11088; TODAY</div>'
                : '';
            const gameDayCardClass = isGameOfDay ? ' game-of-day-card' : '';
            // Hot/Cold badge (Sprint 25)
            var stats = gameStatsMap[game.id] || gameStatsMap[(game.id || '').toLowerCase()];
            var hotColdHtml = '';
            if (stats) {
                if (stats.actualRtp > 92) {
                    hotColdHtml = '<div class="game-hot-badge" title="Hot! RTP ' + stats.actualRtp.toFixed(1) + '%">🔥</div>';
                } else if (stats.actualRtp < 84) {
                    hotColdHtml = '<div class="game-cold-badge" title="Cold. RTP ' + stats.actualRtp.toFixed(1) + '%">❄️</div>';
                }
            }
            // Max win badge — shows the top multiplier from the game's paytable
            var maxWin = _getMaxWinMultiplier(game);
            var maxWinHtml = maxWin > 0
                ? '<div class="game-max-win-badge" title="Max win multiplier">' + (maxWin >= 1000 ? (maxWin/1000).toFixed(1) + 'K' : maxWin) + 'x</div>'
                : '';
            _seedCount(game.id, isHot || _hotIds.has(game.id));
            // RTP chip
            const rtpChip = game.rtp
                ? '<span class="game-chip game-chip-rtp">' + game.rtp + '% RTP</span>'
                : '';
            // Max win chip
            var maxWinChip = maxWin > 0
                ? '<span class="game-chip game-chip-maxwin">' + (maxWin >= 1000 ? (maxWin/1000).toFixed(1) + 'K' : maxWin) + 'x MAX</span>'
                : '';
            // Mechanic chip from bonusType
            const mechanicLabel = game.bonusType
                ? game.bonusType.replace(/_/g, ' ').replace(/\b\w/g, function(c){ return c.toUpperCase(); })
                : '';
            const mechanicChip = mechanicLabel
                ? '<span class="game-chip">' + mechanicLabel + '</span>'
                : '';
            // Studio dot color
            const studioAccent = _getProviderAccent(game.provider);
            return `
                <div class="game-card${isHot ? ' game-card-hot' : ''}${isJackpot ? ' game-card-jackpot is-jackpot' : ''}${gameDayCardClass}" role="button" tabindex="0" aria-label="${escapeHtml(game.name)}" onclick="try{if(typeof _compareMode!=='undefined'&&_compareMode){_addToCompare('${game.id}');this.classList.toggle('compare-selected',typeof _compareGames!=='undefined'&&_compareGames.indexOf('${game.id}')>=0);}else{(window.openSlot||openSlot)('${game.id}');}}catch(e){console.warn('Game click error:',e.message);}" style="position:relative" data-game-name="${(game.name || game.id || '').toLowerCase()}" data-game-id="${(game.id || '').toLowerCase()}">
                    <button class="fav-btn${favored ? ' fav-active' : ''}" data-game-id="${game.id}" title="${favored ? 'Remove from favourites' : 'Add to favourites'}" onclick="event.stopPropagation(); (function(btn){var nowFav=toggleFavorite('${game.id}'); btn.textContent=nowFav?'\u2764\uFE0F':'\u2661'; btn.title=nowFav?'Remove from favourites':'Add to favourites'; btn.classList.add('fav-active'); setTimeout(function(){btn.classList.remove('fav-active');},350); updateFavTabBadge();})(this)">${favIcon}</button>
                    <div class="game-card-art" style="${thumbStyle}"${thumbDataBg}>
                        ${hasThumbnail ? '<img src="' + game.thumbnail + '" loading="lazy" decoding="async" alt="' + escapeHtml(game.name) + '" onerror="this.style.display=\'none\'">' : (!game.thumbnail && game.asset ? (assetTemplates[game.asset] || '') : '')}
                        <div class="card-anim-preview" style="background-image:url('assets/backgrounds/slots/${game.id}_bg.webp')">
                            <span class="preview-badge">&#9654; PREVIEW</span>
                        </div>
                        ${topTag}
                        ${jackpotBadge}
                        <div class="card-players-live" data-game="${game.id}" style="display:none"></div>
                        ${(function() { try { var _v = parseFloat(localStorage.getItem('personalBest_' + game.id) || '0'); if (_v > 0) { var _disp = _v >= 1000 ? ('$' + (_v/1000).toFixed(1) + 'K') : ('$' + Math.round(_v)); return '<div class="card-personal-best">\u{1F3C6} PB ' + _disp + '</div>'; } } catch(e) {} return ''; })()}
                        <div class="game-vol-badge ${volClass}" title="Volatility: ${vol}">
                            ${dotsHtml}
                        </div>
                        <div class="game-card-overlay">
                            <button class="game-overlay-play" onclick="event.stopPropagation();(window.openSlot||openSlot)('${game.id}')">PLAY NOW</button>
                        </div>
                        <div class="gi-strip">
                            <span class="gi-grid">${game.gridCols}\xd7${game.gridRows}</span>
                            <span class="gi-bonus">${_giBonusLabel(game)}</span>
                            <span class="gi-vol ${_giVolatility(game).cls}" title="Volatility: ${_giVolatility(game).label}">${_giVolatility(game).dots}</span>
                        </div>
                    </div>
                    <div class="game-card-info">
                        <div class="game-card-name">${escapeHtml(game.name)}</div>
                        <div class="game-card-studio">
                            <span class="game-card-studio-dot" style="background:${studioAccent}"></span>
                            <span style="color:${studioAccent}">${_getProviderLogo(game.provider)} ${escapeHtml(game.provider || '')}</span>
                        </div>
                        <div class="game-card-chips">
                            ${rtpChip}${maxWinChip}${mechanicChip}
                        </div>
                    </div>
                    ${_hotIds.has(game.id) ? '<span class="lobby-badge lobby-badge-hot">\uD83D\uDD25 HOT</span>' : ''}
                    ${_newIds.has(game.id) ? '<span class="lobby-badge lobby-badge-new">\u2728 NEW</span>' : ''}
                    ${gameDayBadgeHtml}
                    ${hotColdHtml}
                    ${maxWinHtml}
                </div>
            `;
        }


        function playRandomHotGame() {
            const hotGames = games.filter(g => g.hot);
            const pick = hotGames[Math.floor(Math.random() * hotGames.length)];
            openSlot(pick.id);
        }


        // ===== Favorites =====
        var _favKey = 'casinoFavorites';
        var _favsSet = (function() {
            try { return new Set(JSON.parse(localStorage.getItem(_favKey) || '[]')); }
            catch(e) { return new Set(); }
        })();

        function loadFavorites() {
            return [..._favsSet];
        }

        function isFavorite(gameId) {
            return _favsSet.has(gameId);
        }

        function toggleFavorite(gameId) {
            if (_favsSet.has(gameId)) {
                _favsSet.delete(gameId);
            } else {
                _favsSet.add(gameId);
            }
            try { localStorage.setItem(_favKey, JSON.stringify([..._favsSet])); } catch(e) {}

            // Send toggle to API
            _syncFavoriteToApi(gameId, _favsSet.has(gameId));

            return _favsSet.has(gameId);
        }

        function _syncFavoriteToApi(gameId, isFavorited) {
            var authToken = (typeof getAuthToken === 'function') ? getAuthToken() :
                           (typeof TOKEN !== 'undefined') ? TOKEN :
                           (typeof localStorage !== 'undefined' ? localStorage.getItem('authToken') : null);

            if (!authToken) {
                console.debug('No auth token available for favorite sync');
                return;
            }

            fetch('/api/favorites/toggle', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': 'Bearer ' + authToken
                },
                body: JSON.stringify({ gameId: gameId, favorited: isFavorited })
            }).catch(function(err) {
                console.warn('Failed to sync favorite for game ' + gameId + ':', err);
            });
        }

        function _loadFavoritesFromApi() {
            var authToken = (typeof getAuthToken === 'function') ? getAuthToken() :
                           (typeof TOKEN !== 'undefined') ? TOKEN :
                           (typeof localStorage !== 'undefined' ? localStorage.getItem('authToken') : null);

            if (!authToken) {
                console.debug('No auth token available for loading favorites');
                return;
            }

            fetch('/api/favorites/', {
                method: 'GET',
                headers: {
                    'Authorization': 'Bearer ' + authToken
                }
            })
            .then(function(res) {
                if (!res.ok) throw new Error('HTTP ' + res.status);
                return res.json();
            })
            .then(function(data) {
                if (data && Array.isArray(data.favorites)) {
                    _favsSet = new Set(data.favorites);
                    try { localStorage.setItem(_favKey, JSON.stringify([..._favsSet])); } catch(e) {}
                }
            })
            .catch(function(err) {
                console.warn('Failed to load favorites from API:', err);
            });
        }
        // ===== Filter Tabs =====
        function setFilter(filter) {
            currentFilter = filter;
            // Clear inline search bar when switching filter tabs
            const searchInput = document.getElementById('gameSearchInput');
            if (searchInput) searchInput.value = '';
            searchQuery = '';
            const _clrBtn = document.getElementById('gameSearchClear');
            if (_clrBtn) _clrBtn.style.display = 'none';
            const tabs = document.querySelectorAll('.filter-tab');
            tabs.forEach(tab => {
                tab.classList.toggle('filter-tab-active', tab.dataset.filter === filter);
            });
            renderFilteredGames();
        }


        function getFilteredGames(filter) {
            let list;
            switch (filter) {
                case 'hot':       list = games.filter(g => g.hot && !g.adult); break;
                case 'new':       list = games.filter(g => g.tag === 'NEW' && !g.adult); break;
                case 'jackpot':   list = games.filter(g => (g.tag === 'JACKPOT' || g.tag === 'MEGA') && !g.adult); break;
                case 'favorites': list = games.filter(g => isFavorite(g.id)); break;
                case 'adult':     list = games.filter(g => g.adult); break;
                default:          list = games.filter(g => !g.adult);
            }
            if (currentProviderFilter !== 'all') {
                list = list.filter(g => g.provider === currentProviderFilter);
            }
            // Apply lobby search query (set by lobbyOnSearch / lobbySetProvider)
            if (lobbySearchQuery) {
                if (lobbySearchQuery.startsWith('__provider__')) {
                    const prov = lobbySearchQuery.slice('__provider__'.length);
                    list = list.filter(g => g.provider.toLowerCase() === prov);
                } else {
                    list = list.filter(g =>
                        g.name.toLowerCase().includes(lobbySearchQuery) ||
                        g.provider.toLowerCase().includes(lobbySearchQuery) ||
                        (g.themeCategory && g.themeCategory.toLowerCase().includes(lobbySearchQuery))
                    );
                }
            }
            // Apply mechanic filter
            if (currentMechanicFilter !== 'all') {
                list = list.filter(g => _getMechanicCategory(g) === currentMechanicFilter);
            }
            // Apply theme category filter
            if (currentThemeCategoryFilter !== 'all') {
                list = list.filter(g => g.themeCategory === currentThemeCategoryFilter);
            }
            // Apply inline search bar query (compound with all other filters)
            if (searchQuery) {
                var _sq = searchQuery.toLowerCase();
                list = list.filter(function(g) { return g.name.toLowerCase().includes(_sq); });
            }
            // Apply sort (existing vol sort)
            if (currentSortMode === 'vol_asc') {
                list = [...list].sort((a, b) => _getVolatility(a) - _getVolatility(b));
            } else if (currentSortMode === 'vol_desc') {
                list = [...list].sort((a, b) => _getVolatility(b) - _getVolatility(a));
            }
            // Sprint 37 — additional sort order from dropdown
            if (typeof _sortOrder !== 'undefined' && _sortOrder !== 'popular') {
                switch (_sortOrder) {
                    case 'az':       list = [...list].sort((a,b) => a.name.localeCompare(b.name)); break;
                    case 'za':       list = [...list].sort((a,b) => b.name.localeCompare(a.name)); break;
                    case 'rtp':      list = [...list].sort((a,b) => ((b.payouts && b.payouts.triple) || 0) - ((a.payouts && a.payouts.triple) || 0)); break;
                    case 'volatile': list = [...list].sort((a,b) => _getVolatility(b) - _getVolatility(a)); break;
                    case 'chill':    list = [...list].sort((a,b) => _getVolatility(a) - _getVolatility(b)); break;
                }
            }
            return list;
        }


        function setProviderFilter(provider) {
            currentProviderFilter = provider;
            document.querySelectorAll('.provider-chip').forEach(chip => {
                chip.classList.toggle('provider-chip-active', chip.dataset.provider === provider);
            });
            // Update provider showcase cards
            document.querySelectorAll('.provider-showcase-card').forEach(function(card) {
                card.classList.toggle('provider-showcase-card-active', card.dataset.provider === provider);
            });
            renderFilteredGames();
        }


        function setMechanicFilter(mech) {
            currentMechanicFilter = mech;
            document.querySelectorAll('.mechanic-chip').forEach(c => {
                c.classList.toggle('mechanic-chip-active', c.dataset.mech === mech);
            });
            renderFilteredGames();
        }

        function setThemeCategoryFilter(theme) {
            currentThemeCategoryFilter = theme;
            document.querySelectorAll('#themeCategoryRow .provider-chip').forEach(function(c) {
                c.classList.toggle('provider-chip-active', c.dataset.theme === theme);
            });
            renderFilteredGames();
        }

        function setSortMode(mode) {
            currentSortMode = mode;
            document.querySelectorAll('.sort-btn').forEach(b => {
                b.classList.toggle('sort-btn-active', b.dataset.sort === mode);
            });
            renderFilteredGames();
        }

        // Sprint 37 — Game Sort Dropdown
        function setSortOrder(val) {
            _sortOrder = val || 'popular';
            renderFilteredGames();
        }


        function renderFilteredGames() {
            // ── Hero Carousel — 5 featured games (injected once) ──
            if (!document.getElementById('heroCarousel')) {
                var _gameList = typeof GAMES !== 'undefined' ? GAMES : [];
                if (_gameList.length >= 5) {
                    // Pick 5 featured games: rotate daily based on day-of-year
                    var _doy = Math.floor((Date.now() - new Date(new Date().getFullYear(),0,0).getTime()) / 86400000);
                    var _hot = _gameList.filter(function(g) { return g.hot || g.jackpot; });
                    if (_hot.length < 5) _hot = _gameList.slice();
                    var _featured5 = [];
                    for (var fi = 0; fi < 5; fi++) {
                        _featured5.push(_hot[(_doy + fi * 7) % _hot.length]);
                    }
                    // Deduplicate
                    var _seen5 = {};
                    _featured5 = _featured5.filter(function(g) { if (_seen5[g.id]) return false; _seen5[g.id] = true; return true; });
                    while (_featured5.length < 5 && _gameList.length >= 5) {
                        var _fill = _gameList[(_doy + _featured5.length * 13) % _gameList.length];
                        if (!_seen5[_fill.id]) { _featured5.push(_fill); _seen5[_fill.id] = true; }
                    }

                    var _heroEl = document.createElement('div');
                    _heroEl.id = 'heroCarousel';
                    _heroEl.className = 'hero-carousel';
                    var _slidesHtml = _featured5.map(function(g, idx) {
                        var _bg = g.bgGradient || 'linear-gradient(135deg, #0a0a1a, #1a1a2e)';
                        var _provKey = '';
                        var _prov2s = { 'Nebula Gaming':'nebula-gaming', 'Golden Reels Studio':'golden-reels', 'Mythic Forge':'mythic-forge',
                            'Ironclad Entertainment':'ironclad', 'Shadow Works':'shadow-works', 'Wild Frontier Games':'wild-frontier',
                            'Cascade Labs':'cascade-labs', 'Dragon Pearl Studios':'dragon-pearl' };
                        _provKey = _prov2s[g.provider] || 'ironclad';
                        var _accent = { 'nebula-gaming':'#00e5ff', 'golden-reels':'#ffd700', 'mythic-forge':'#e040fb', ironclad:'#ff6d00',
                            'shadow-works':'#b388ff', 'wild-frontier':'#76ff03', 'cascade-labs':'#ffea00', 'dragon-pearl':'#00bcd4' }[_provKey] || '#00ff41';
                        return '<div class="hero-slide' + (idx === 0 ? ' hero-slide-active' : '') + '" data-slide="' + idx + '" style="background:' + _bg + '">' +
                            '<div class="hero-slide-content">' +
                            '<div class="hero-studio-badge" style="background:' + _accent + ';color:#000">' + g.provider + '</div>' +
                            '<h2 class="hero-title">' + g.name + '</h2>' +
                            '<div class="hero-meta">' +
                            '<span class="hero-rtp">RTP ' + g.rtp + '%</span>' +
                            '<span class="hero-vol">' + (g.volatility || 'medium').replace('-', ' ') + '</span>' +
                            '</div>' +
                            '<button class="hero-play-btn" onclick="if(typeof openSlot===\'function\')openSlot(\'' + g.id + '\')" style="background:' + _accent + ';color:#000">PLAY NOW</button>' +
                            '</div>' +
                            '<div class="hero-slide-thumb">' +
                            '<img src="assets/thumbnails/' + g.id + '.webp" alt="' + g.name + '" loading="lazy" onerror="this.style.display=\'none\'" />' +
                            '</div>' +
                            '</div>';
                    }).join('');

                    var _dotsHtml = _featured5.map(function(g, idx) {
                        return '<span class="hero-dot' + (idx === 0 ? ' hero-dot-active' : '') + '" data-dot="' + idx + '"></span>';
                    }).join('');

                    _heroEl.innerHTML = '<div class="hero-slides">' + _slidesHtml + '</div>' +
                        '<div class="hero-dots">' + _dotsHtml + '</div>';

                    var _allGamesH = document.getElementById('allGames');
                    if (_allGamesH && _allGamesH.parentNode) _allGamesH.parentNode.insertBefore(_heroEl, _allGamesH);

                    // Auto-advance every 5s
                    var _currentSlide = 0;
                    var _totalSlides = _featured5.length;
                    function _goToSlide(n) {
                        _currentSlide = ((n % _totalSlides) + _totalSlides) % _totalSlides;
                        var slides = _heroEl.querySelectorAll('.hero-slide');
                        var dots = _heroEl.querySelectorAll('.hero-dot');
                        for (var si = 0; si < slides.length; si++) {
                            slides[si].classList.toggle('hero-slide-active', si === _currentSlide);
                            dots[si].classList.toggle('hero-dot-active', si === _currentSlide);
                        }
                    }
                    _heroEl.querySelectorAll('.hero-dot').forEach(function(dot) {
                        dot.addEventListener('click', function() {
                            _goToSlide(parseInt(this.getAttribute('data-dot')));
                        });
                    });
                    setInterval(function() { _goToSlide(_currentSlide + 1); }, 5000);
                }
            }

            // ── Provider showcase carousel (injected once) ──
            if (!document.getElementById('providerShowcase')) {
                var _showcase = document.createElement('div');
                _showcase.id = 'providerShowcase';
                _showcase.className = 'provider-showcase';
                var _provNames = Object.keys(_providerChrome);
                _showcase.innerHTML = '<div class="provider-showcase-title">🎰 Our Studios</div>' +
                    '<div class="provider-showcase-scroll">' +
                    '<button class="provider-showcase-card provider-showcase-card-active" data-provider="all" onclick="setProviderFilter(\'all\')">' +
                    '<span class="psc-logo">🎰</span><span class="psc-name">All Studios</span>' +
                    '<span class="psc-count">' + (typeof GAMES !== 'undefined' ? GAMES.length : 100) + ' games</span></button>' +
                    _provNames.map(function(name) {
                        var p = _providerChrome[name];
                        var count = (typeof GAMES !== 'undefined' ? GAMES : []).filter(function(g) { return g.provider === name; }).length;
                        return '<button class="provider-showcase-card" data-provider="' + name.replace(/"/g, '&quot;') + '" ' +
                            'onclick="setProviderFilter(\'' + name.replace(/'/g, "\\'") + '\')" ' +
                            'style="--prov-accent:' + p.accent + '">' +
                            '<span class="psc-logo">' + p.logo + '</span>' +
                            '<span class="psc-name">' + name + '</span>' +
                            '<span class="psc-count">' + count + ' games</span>' +
                            '</button>';
                    }).join('') +
                    '</div>';
                var _allGamesP = document.getElementById('allGames');
                if (_allGamesP && _allGamesP.parentNode) _allGamesP.parentNode.insertBefore(_showcase, _allGamesP);

                // ── Featured Studio of the Day ──
                (function() {
                    var _dayOfYear = Math.floor((Date.now() - new Date(new Date().getFullYear(),0,0).getTime()) / 86400000);
                    var _featIdx = _dayOfYear % _provNames.length;
                    var _featName = _provNames[_featIdx];
                    var _featP = _providerChrome[_featName];
                    var _featCard = _showcase.querySelector('[data-provider="' + _featName.replace(/"/g, '\\"') + '"]');
                    if (_featCard) {
                        _featCard.style.border = '2px solid ' + _featP.accent;
                        _featCard.style.boxShadow = '0 0 16px ' + _featP.accent + '44';
                        var _badge = document.createElement('span');
                        _badge.style.cssText = 'position:absolute;top:-8px;right:-8px;background:' + _featP.accent + ';color:#000;font-size:9px;font-weight:700;padding:2px 6px;border-radius:8px;white-space:nowrap;';
                        _badge.textContent = '\u2B50 FEATURED';
                        _featCard.style.position = 'relative';
                        _featCard.appendChild(_badge);
                    }
                })();
            }
            // ── Mechanic filter bar (injected once) ──
            if (!document.getElementById('mechanicFilterBar')) {
                const _mechBar = document.createElement('div');
                _mechBar.id = 'mechanicFilterBar';
                _mechBar.className = 'mechanic-filter-bar';
                const _mechs = [
                    { id: 'all',        label: 'All Mechanics' },
                    { id: 'tumble',     label: '\uD83C\uDF0A Tumble' },
                    { id: 'hold_win',   label: '\uD83C\uDFAF Hold & Win' },
                    { id: 'free_spins', label: '\uD83C\uDF81 Free Spins' },
                    { id: 'wilds',      label: '\uD83C\uDF1F Wilds' },
                    { id: 'jackpot',    label: '\uD83C\uDFC6 Jackpot' },
                ];
                _mechBar.innerHTML = `
                    <div class="mechanic-chips">
                        ${_mechs.map(m => `<button class="mechanic-chip${m.id==='all'?' mechanic-chip-active':''}" data-mech="${m.id}" onclick="setMechanicFilter('${m.id}')">${m.label}</button>`).join('')}
                    </div>
                    <div class="sort-controls">
                        <span style="font-size:11px;color:rgba(255,255,255,0.4)">Sort:</span>
                        <button class="sort-btn sort-btn-active" data-sort="default" onclick="setSortMode('default')">Default</button>
                        <button class="sort-btn" data-sort="vol_asc" onclick="setSortMode('vol_asc')">Vol \u2191</button>
                        <button class="sort-btn" data-sort="vol_desc" onclick="setSortMode('vol_desc')">Vol \u2193</button>
                    </div>`;
                const _allGames = document.getElementById('allGames');
                if (_allGames && _allGames.parentNode) _allGames.parentNode.insertBefore(_mechBar, _allGames);
            }
            // ── Game search bar (injected once, after mechanic filter bar) ──
            if (!document.getElementById('gameSearchWrap')) {
                var _searchWrap = document.createElement('div');
                _searchWrap.id = 'gameSearchWrap';
                _searchWrap.className = 'game-search-wrap';
                _searchWrap.innerHTML = '<input type="text" id="gameSearchInput" class="game-search-input" placeholder="🔍  Search games..." autocomplete="off" />' +
                    '<button id="gameSearchClear" class="game-search-clear" style="display:none">✕</button>';
                var _mechBar2 = document.getElementById('mechanicFilterBar');
                if (_mechBar2 && _mechBar2.parentNode) {
                    _mechBar2.parentNode.insertBefore(_searchWrap, _mechBar2.nextSibling);
                }
                document.getElementById('gameSearchInput').addEventListener('input', function() {
                    searchQuery = this.value.trim();
                    document.getElementById('gameSearchClear').style.display = searchQuery ? '' : 'none';
                    renderFilteredGames();
                });
                document.getElementById('gameSearchClear').addEventListener('click', function() {
                    searchQuery = '';
                    document.getElementById('gameSearchInput').value = '';
                    this.style.display = 'none';
                    renderFilteredGames();
                });
            }
            const allGamesDiv = document.getElementById('allGames');
            const filtered = getFilteredGames(currentFilter);
            if (currentFilter === 'favorites' && filtered.length === 0) {
                allGamesDiv.innerHTML = `<div class="games-fav-empty"><span class="fav-empty-icon">♡</span>Heart your first game to see it here!</div>`;
            } else if (filtered.length === 0 && searchQuery) {
                allGamesDiv.innerHTML = '<div class="search-no-results">No games found for "<strong>' + searchQuery.replace(/[<>]/g, '') + '</strong>"</div>';
            } else {
                // ROUND 62: Chunked rendering for 100+ games — render first 24 immediately, rest after paint
                var INITIAL_CHUNK = 24;
                if (filtered.length > INITIAL_CHUNK) {
                    allGamesDiv.innerHTML = filtered.slice(0, INITIAL_CHUNK).map(g => createGameCard(g)).join('');
                    setTimeout(function() {
                        var rest = filtered.slice(INITIAL_CHUNK).map(g => createGameCard(g)).join('');
                        allGamesDiv.insertAdjacentHTML('beforeend', rest);
                        if (typeof _initLazyThumbnails === 'function') _initLazyThumbnails();
                    });
                } else {
                    allGamesDiv.innerHTML = filtered.map(g => createGameCard(g)).join('');
                }
            }
            updateFilterCounts();
            // Update the "All Slots" count label
            const countEl = document.getElementById('allGamesCount');
            if (countEl) countEl.textContent = `${filtered.length} game${filtered.length !== 1 ? 's' : ''}`;
            // Re-apply hide/show search filter after every render
            if (typeof _applyLobbySearch === 'function') _applyLobbySearch();
            // Lazy-load thumbnails for newly rendered cards
            if (typeof _initLazyThumbnails === 'function') _initLazyThumbnails();
            // Populate live player count badges + start periodic ticker
            _applyLiveCounts();
            _startLiveCountTicker();
        }

        function _applyLiveCounts() {
            document.querySelectorAll('.card-players-live').forEach(function(el) {
                var id = el.dataset.game;
                var count = _liveCounts[id];
                if (count > 0) {
                    el.textContent = count + ' playing';
                    el.style.display = '';
                }
            });
        }


        function updateFilterCounts() {
            const favCount = loadFavorites().length;
            const counts = {
                all:       games.length,
                hot:       games.filter(g => g.hot).length,
                new:       games.filter(g => g.tag === 'NEW').length,
                jackpot:   games.filter(g => g.tag === 'JACKPOT' || g.tag === 'MEGA').length,
                favorites: favCount
            };
            document.querySelectorAll('.filter-tab').forEach(tab => {
                const f = tab.dataset.filter;
                if (f === 'favorites') {
                    // Use a distinct red badge for favorites count
                    let badge = tab.querySelector('.filter-fav-count');
                    if (!badge) {
                        badge = document.createElement('span');
                        badge.className = 'filter-fav-count';
                        tab.appendChild(badge);
                    }
                    badge.textContent = favCount > 0 ? favCount : '';
                    badge.style.display = favCount > 0 ? '' : 'none';
                } else {
                    let countEl = tab.querySelector('.filter-count');
                    if (!countEl) {
                        countEl = document.createElement('span');
                        countEl.className = 'filter-count';
                        tab.appendChild(countEl);
                    }
                    countEl.textContent = counts[f] ?? '';
                }
            });
            // Sync .filter-tab-count badges (Sprint 19)
            if (typeof _updateTabCounts === 'function') _updateTabCounts();
        }


        function _updateTabCounts() {
            try {
                var allGames = (typeof games !== 'undefined' ? games : []);
                if (!allGames || !allGames.length) return;

                // Build counts per filter key — mirrors getFilteredGames() switch cases
                var favCount = (typeof _favsSet !== 'undefined'
                    ? _favsSet.size
                    : (typeof loadFavorites === 'function' ? loadFavorites().length : 0));
                var counts = {
                    'all':       allGames.length,
                    'hot':       allGames.filter(function(g) { return g.hot; }).length,
                    'new':       allGames.filter(function(g) { return g.tag === 'NEW'; }).length,
                    'jackpot':   allGames.filter(function(g) { return g.tag === 'JACKPOT' || g.tag === 'MEGA'; }).length,
                    'favorites': favCount
                };

                // Update .filter-tab-count badge inside each tab button
                document.querySelectorAll('.filter-tab[data-filter]').forEach(function(btn) {
                    var key = btn.dataset.filter;
                    if (!(key in counts)) return;
                    var badge = btn.querySelector('.filter-tab-count');
                    if (!badge) {
                        badge = document.createElement('span');
                        badge.className = 'filter-tab-count';
                        btn.appendChild(badge);
                    }
                    badge.textContent = counts[key];
                });
            } catch (e) {
                // Defensive — never block render on count error
            }
        }

        function updateFavTabBadge() {
            const favTab = document.getElementById('favFilterTab');
            if (!favTab) return;
            let badge = favTab.querySelector('.filter-fav-count');
            if (!badge) {
                badge = document.createElement('span');
                badge.className = 'filter-fav-count';
                favTab.appendChild(badge);
            }
            const favCount = loadFavorites().length;
            badge.textContent = favCount > 0 ? favCount : '';
            badge.style.display = favCount > 0 ? '' : 'none';
            // If currently viewing favorites, re-render the list to reflect removals
            if (currentFilter === 'favorites') {
                renderFilteredGames();
            }
        }


        // ===== Game Search =====
        function searchGames(query) {
            const countEl = document.getElementById('searchResultCount');
            query = query.trim().toLowerCase();
            if (!query) {
                renderFilteredGames();
                if (countEl) { countEl.classList.remove('active'); countEl.textContent = ''; }
                return;
            }
            const allGamesDiv = document.getElementById('allGames');
            const results = games.filter(g =>
                g.name.toLowerCase().includes(query) ||
                (g.provider && g.provider.toLowerCase().includes(query)) ||
                (g.tag && g.tag.toLowerCase().includes(query))
            );
            // Update result count badge
            if (countEl) {
                countEl.textContent = results.length + ' found';
                countEl.classList.toggle('active', results.length > 0 || query.length > 0);
            }
            allGamesDiv.innerHTML = results.length
                ? results.map(g => createGameCard(g)).join('')
                : `<div class="games-empty-state">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="40" height="40"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
                    <p>No games found for "<strong>${query}</strong>"</p>
                    <p style="font-size:12px;color:rgba(255,255,255,0.35);margin-top:8px;">Try searching by game name, provider, or tag</p>
                   </div>`;
        }


        // Real win ticker — fetches from /api/big-wins instead of fabricating data
        let _tickerRealWins = [];

        async function _fetchTickerWins() {
            try {
                const resp = await fetch('/api/big-wins');
                if (!resp.ok) return [];
                const data = await resp.json();
                if (!data.wins || !Array.isArray(data.wins)) return [];
                return data.wins.map(function(w) {
                    var gameDef = games.find(function(g) { return g.id === w.gameId; });
                    var gameName = gameDef ? gameDef.name : (w.gameId || 'Slot Game');
                    var playerName = w.player || 'A player';
                    return playerName + ' won $' + Number(w.amount).toLocaleString() + ' on ' + gameName + '!';
                });
            } catch (e) {
                return [];
            }
        }

        function startWinTicker() {
            const content = document.getElementById('tickerContent');
            if (!content) return;

            // Clear any existing ticker interval to prevent leaks on re-init
            if (tickerInterval) clearInterval(tickerInterval);

            // Fetch real wins from server, then render
            _fetchTickerWins().then(function(messages) {
                _tickerRealWins = messages;
                if (_tickerRealWins.length > 0) {
                    renderTickerContent(_tickerRealWins);
                } else {
                    // No real wins yet — hide ticker rather than show fake data
                    content.textContent = '';
                }
            });

            // Periodically refresh from server
            tickerInterval = setInterval(function() {
                _fetchTickerWins().then(function(messages) {
                    _tickerRealWins = messages;
                    if (_tickerRealWins.length > 0) {
                        renderTickerContent(_tickerRealWins);
                    } else {
                        content.textContent = '';
                    }
                });
            }, 30000); // refresh every 30 seconds
        }


        function renderTickerContent(messages) {
            const content = document.getElementById('tickerContent');
            if (!content) return;

            const sep = '<span class="ticker-sep">\u00B7</span>';
            const itemsHtml = messages.map(m =>
                `<span class="ticker-item">${m}</span>`
            ).join(sep);

            // Duplicate the block so the CSS translate loop is seamless:
            // when the first copy scrolls fully left, the second copy is
            // in exactly the same position the first started.
            content.innerHTML =
                `<span class="ticker-half">${itemsHtml}${sep}</span>` +
                `<span class="ticker-half">${itemsHtml}${sep}</span>`;

            // Restart the animation cleanly so there's no mid-scroll jump
            content.style.animation = 'none';
            // Force reflow then re-apply
            void content.offsetWidth;
            content.style.animation = '';
        }


        /**
         * Called from ui-slot.js when a real player win >= 10x bet occurs.
         * Prepends the win to the live ticker with amber colour so it stands out.
         */
        function addPlayerWinToTicker(amount, gameName) {
            var ticker = document.querySelector('.win-ticker-inner') || document.getElementById('tickerContent');
            if (!ticker) return;
            var username = (typeof currentUser !== 'undefined' && currentUser && currentUser.username)
                ? currentUser.username : 'You';
            var formatted = typeof amount === 'number'
                ? '$' + amount.toLocaleString(undefined, { maximumFractionDigits: 0 })
                : '$' + amount;
            var span = document.createElement('span');
            span.className = 'ticker-item ticker-player-win';
            span.textContent = '🏆 ' + username + ' won ' + formatted + ' on ' + gameName + '!';
            // Prepend so it appears first; separate with bullet
            var sep = document.createElement('span');
            sep.className = 'ticker-sep';
            sep.textContent = ' · ';
            ticker.insertBefore(sep, ticker.firstChild);
            ticker.insertBefore(span, ticker.firstChild);
            // Auto-remove after 60 seconds so ticker stays fresh
            setTimeout(function() {
                if (span.parentNode) span.parentNode.removeChild(span);
                if (sep.parentNode) sep.parentNode.removeChild(sep);
            }, 60000);
        }


        // ═══════════════════════════════════════════════════════════
        // GAME SEARCH
        // ═══════════════════════════════════════════════════════════

        function filterGamesBySearch(value) {
            const clearBtn = document.getElementById('searchClearBtn');
            if (clearBtn) clearBtn.style.display = value ? 'flex' : 'none';
            searchGames(value);
        }


        function clearGameSearch() {
            const input = document.getElementById('gameSearchInput');
            if (input) { input.value = ''; input.focus(); }
            const clearBtn = document.getElementById('searchClearBtn');
            if (clearBtn) clearBtn.style.display = 'none';
            searchGames('');
        }


        // ═══════════════════════════════════════════════════════════
        // LOBBY SEARCH BAR + PROVIDER QUICK-LINKS
        // ═══════════════════════════════════════════════════════════

        // ═══════════════════════════════════════════════════════════
        // SPRINT 18 SEARCH BAR — hide/show filter (complements re-render search)
        // ═══════════════════════════════════════════════════════════

        function _injectLobbySearch() {
          if (document.getElementById('lobbySearchWrap')) return;
          var filtersEl = document.querySelector('.lobby-filters') ||
                          document.querySelector('.filter-tabs') ||
                          document.querySelector('.game-filters') ||
                          document.getElementById('filterTabs');
          if (!filtersEl) return;

          var wrap = document.createElement('div');
          wrap.id = 'lobbySearchWrap';
          wrap.className = 'lobby-search-wrap';

          var input = document.createElement('input');
          input.type = 'search';
          input.id = 'lobbySearchInput2';
          input.className = 'lobby-search-input';
          input.placeholder = 'Search games…';
          input.autocomplete = 'off';
          input.spellcheck = false;

          var clearBtn = document.createElement('button');
          clearBtn.id = 'lobbySearchClear2';
          clearBtn.className = 'lobby-search-clear';
          clearBtn.innerHTML = '✕';
          clearBtn.title = 'Clear search';
          clearBtn.type = 'button';

          wrap.appendChild(input);
          wrap.appendChild(clearBtn);

          // Insert above filter tabs (guard against double-injection)
          if (filtersEl.parentNode && !document.getElementById('lobbySearchWrap')) {
            filtersEl.parentNode.insertBefore(wrap, filtersEl);
          }

          // No-results message (appended after game grid)
          var noRes = document.getElementById('lobbySearchNoResults');
          if (!noRes) {
            noRes = document.createElement('div');
            noRes.id = 'lobbySearchNoResults';
            noRes.className = 'lobby-search-no-results';
            noRes.textContent = 'No games match your search.';
            if (filtersEl.parentNode) filtersEl.parentNode.appendChild(noRes);
          }

          var _searchDebounce = null;
          input.addEventListener('input', function() {
            clearTimeout(_searchDebounce);
            _searchDebounce = setTimeout(function() {
              _lobbySearchQuery = input.value.trim().toLowerCase();
              wrap.classList.toggle('active', _lobbySearchQuery.length > 0);
              input.classList.toggle('has-value', _lobbySearchQuery.length > 0);
              _applyLobbySearch();
            }, 150);
          });

          clearBtn.addEventListener('click', function() {
            input.value = '';
            _lobbySearchQuery = '';
            wrap.classList.remove('active');
            input.classList.remove('has-value');
            _applyLobbySearch();
            input.focus();
          });
        }

        function _applyLobbySearch() {
          var q = _lobbySearchQuery;
          var noRes = document.getElementById('lobbySearchNoResults');
          var cards = document.querySelectorAll('.game-card');
          var visible = 0;
          cards.forEach(function(card) {
            if (!q) { card.style.display = ''; visible++; return; }
            var nameEl = card.querySelector('.game-name, .card-title, h3, h4');
            var name = (card.dataset.gameName || (nameEl ? nameEl.textContent : '') || '').toLowerCase();
            var id   = (card.dataset.gameId   || '').toLowerCase();
            var matches = name.includes(q) || id.includes(q);
            card.style.display = matches ? '' : 'none';
            if (matches) visible++;
          });
          if (noRes) noRes.classList.toggle('visible', q.length > 0 && visible === 0);
          // Update tab count badges after search filter (Sprint 19)
          if (typeof _updateTabCounts === 'function') _updateTabCounts();
        }

        // ROUND 62: Debounced search for 100-game lobby — 200ms delay prevents jank on every keystroke
        var _lobbySearchTimer = null;
        function lobbyOnSearch(query) {
            lobbySearchQuery = query.trim().toLowerCase();
            const clearBtn = document.getElementById('lobbySearchClear');
            const input = document.getElementById('lobbySearchInput');
            if (clearBtn) clearBtn.style.display = lobbySearchQuery ? 'block' : 'none';
            if (input && input.value !== query) input.value = query;
            // Clear any active provider pill highlight when typing a free-text query
            if (!lobbySearchQuery.startsWith('__provider__')) {
                document.querySelectorAll('.lobby-provider-pill').forEach(pill => {
                    pill.style.background = 'rgba(255,255,255,0.06)';
                    pill.style.borderColor = 'rgba(255,255,255,0.15)';
                    pill.style.color = 'rgba(255,255,255,0.7)';
                });
            }
            clearTimeout(_lobbySearchTimer);
            _lobbySearchTimer = setTimeout(function() { renderFilteredGames(); }, 200);
        }


        function lobbySetProvider(providerName) {
            // Clear free-text search
            lobbySearchQuery = '';
            const input = document.getElementById('lobbySearchInput');
            if (input) input.value = '';
            const clearBtn = document.getElementById('lobbySearchClear');
            if (clearBtn) clearBtn.style.display = 'none';
            // Highlight the active provider pill
            document.querySelectorAll('.lobby-provider-pill').forEach(pill => {
                const active = pill.dataset.provider === providerName;
                pill.style.background   = active ? 'rgba(123,97,255,0.3)'    : 'rgba(255,255,255,0.06)';
                pill.style.borderColor  = active ? 'rgba(123,97,255,0.6)'    : 'rgba(255,255,255,0.15)';
                pill.style.color        = active ? '#b39ddb'                  : 'rgba(255,255,255,0.7)';
            });
            // Use the sentinel prefix so getFilteredGames does an exact provider match
            lobbySearchQuery = '__provider__' + providerName.toLowerCase();
            renderFilteredGames();
        }

        // ================================================================
        // TOURNAMENT BANNER
        // ================================================================

        function initTournamentBanner() {
            // Inject banner HTML once (id guard)
            if (document.getElementById('tournamentBanner')) return;

            var banner = document.createElement('div');
            banner.id = 'tournamentBanner';
            banner.className = 'tournament-banner';
            banner.innerHTML = '<div class="tourn-loading">Loading tournaments...</div>';

            // Insert before game grid
            var gamesSection = document.getElementById('games-section') || document.getElementById('gamesContainer') || document.querySelector('.games-grid') || document.querySelector('.game-grid');
            if (gamesSection && gamesSection.parentNode) {
                gamesSection.parentNode.insertBefore(banner, gamesSection);
            } else {
                var main = document.getElementById('main-content') || document.getElementById('lobby') || document.querySelector('.lobby-content');
                if (main) main.appendChild(banner);
            }

            _fetchAndRenderTournaments();
            _tournamentRefreshInterval = setInterval(_fetchAndRenderTournaments, 30000);
        }
        async function _fetchAndRenderTournaments() {
            var banner = document.getElementById('tournamentBanner');
            if (!banner) return;
            try {
                var res = await fetch('/api/tournaments');
                if (!res.ok) throw new Error('HTTP ' + res.status);
                var data = await res.json();
                _activeTournaments = data.active || [];
                _renderTournamentBanner(data.active || [], data.upcoming || []);
            } catch (e) {
                // Server may not be reachable in offline mode
                banner.style.display = 'none';
            }
        }
        function _renderTournamentBanner(active, upcoming) {
            var banner = document.getElementById('tournamentBanner');
            if (!banner) return;

            if (active.length === 0 && upcoming.length === 0) {
                banner.style.display = 'none';
                return;
            }

            banner.style.display = '';
            var t = active[0] || upcoming[0];
            var isActive = active.length > 0;

            // Prize display based on type
            var prizes = t.type === 'daily'
                ? '🥇 $200 &nbsp; 🥈 $100 &nbsp; 🥉 $75'
                : '🥇 $25 &nbsp; 🥈 $15 &nbsp; 🥉 $10';
            banner.innerHTML =
                '<div class="tourn-header">' +
                    '<span class="tourn-live-dot' + (isActive ? ' tourn-live-dot--active' : '') + '"></span>' +
                    '<span class="tourn-title">' + t.name + '</span>' +
                    '<span class="tourn-status-badge">' + (isActive ? 'LIVE' : 'UPCOMING') + '</span>' +
                    '<span class="tourn-timer" id="tournTimer" data-ends="' + (isActive ? t.ends_at : t.starts_at) + '" data-mode="' + (isActive ? 'ends' : 'starts') + '">--:--:--</span>' +
                '</div>' +
                '<div class="tourn-meta">' +
                    '<span class="tourn-prizes">' + prizes + '</span>' +
                    '<span class="tourn-entry-count" id="tournEntryCount">' + (t.entry_count || 0) + ' players</span>' +
                '</div>' +
                '<div class="tourn-leaderboard-wrap" id="tournLeaderboardWrap">' +
                    '<div class="tourn-lb-loading">Loading leaderboard...</div>' +
                '</div>' +
                '<div class="tourn-actions">' +
                    '<button class="tourn-join-btn" id="tournJoinBtn" onclick="joinTournament(' + t.id + ')">' + (isActive ? 'JOIN FREE' : 'NOTIFY ME') + '</button>' +
                    '<button class="tourn-expand-btn" onclick="_toggleTournLeaderboard(' + t.id + ')">View Leaderboard ▾</button>' +
                '</div>';

            // Start countdown
            if (_tournamentCountdownInterval) clearInterval(_tournamentCountdownInterval);
            _tournamentCountdownInterval = setInterval(function() { _updateTournTimer(); }, 1000);
            _updateTournTimer();

            // Load leaderboard for active tournament
            if (isActive) _loadTournLeaderboard(t.id);
        }
        function _updateTournTimer() {
            var el = document.getElementById('tournTimer');
            if (!el) { clearInterval(_tournamentCountdownInterval); return; }
            var endsAt = el.dataset.ends;
            var mode = el.dataset.mode;
            if (!endsAt) return;
            var diff = Math.max(0, new Date(endsAt).getTime() - Date.now());
            var h = Math.floor(diff / 3600000);
            var m = Math.floor((diff % 3600000) / 60000);
            var s = Math.floor((diff % 60000) / 1000);
            var label = mode === 'ends' ? '' : 'Starts in ';
            el.textContent = label + (h > 0 ? h + ':' : '') + String(m).padStart(2,'0') + ':' + String(s).padStart(2,'0');
            if (diff === 0) _fetchAndRenderTournaments();
        }
        async function _loadTournLeaderboard(tournamentId) {
            var wrap = document.getElementById('tournLeaderboardWrap');
            if (!wrap) return;
            try {
                var res = await fetch('/api/tournaments/' + tournamentId + '/leaderboard');
                if (!res.ok) throw new Error('HTTP ' + res.status);
                var data = await res.json();
                var board = data.leaderboard || [];
                if (board.length === 0) {
                    wrap.innerHTML = '<div class="tourn-lb-empty">Be the first to compete!</div>';
                    return;
                }
                var medals = ['🥇','🥈','🥉'];
                wrap.innerHTML = '<div class="tourn-lb-rows">' +
                    board.slice(0, 5).map(function(p, i) {
                        return '<div class="tourn-lb-row">' +
                            '<span class="tourn-lb-rank">' + (medals[i] || '#' + p.rank) + '</span>' +
                            '<span class="tourn-lb-name">' + escapeHtml(p.username) + '</span>' +
                            '<span class="tourn-lb-mult">' + p.best_mult.toFixed(2) + 'x</span>' +
                            '</div>';
                    }).join('') +
                    '</div>';
                wrap.style.display = 'none'; // collapsed by default
            } catch (e) {
                wrap.innerHTML = '';
            }
        }
        function _toggleTournLeaderboard(tournamentId) {
            var wrap = document.getElementById('tournLeaderboardWrap');
            var btn = document.querySelector('.tourn-expand-btn');
            if (!wrap) return;
            var hidden = wrap.style.display === 'none' || wrap.style.display === '';
            wrap.style.display = hidden ? '' : 'none';
            if (btn) btn.textContent = hidden ? 'Hide Leaderboard ▴' : 'View Leaderboard ▾';
            if (hidden && _activeTournaments.length > 0) _loadTournLeaderboard(_activeTournaments[0].id);
        }
        async function joinTournament(tournamentId) {
            var btn = document.getElementById('tournJoinBtn');
            if (!btn) return;
            if (!currentUser) {
                if (typeof openAuthModal === 'function') openAuthModal();
                return;
            }
            btn.disabled = true;
            btn.textContent = 'Joining...';
            try {
                var res = await fetch('/api/tournaments/' + tournamentId + '/join', {
                    method: 'POST',
                    headers: { 'Authorization': 'Bearer ' + (authToken || ''), 'Content-Type': 'application/json' }
                });
                var data = await res.json();
                if (data.ok || data.alreadyJoined) {
                    btn.textContent = '✓ Joined!';
                    btn.style.background = '#22c55e';
                } else {
                    btn.textContent = 'JOIN FREE';
                    btn.disabled = false;
                }
            } catch (e) {
                btn.textContent = 'JOIN FREE';
                btn.disabled = false;
            }
        }

        // ================================================================
        // WAGER RACE BANNER
        // ================================================================

        function _wrEscHtml(s) {
            return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
        }

        function initWagerRaceBanner() {
            // Inject banner CSS once
            if (!document.getElementById('wrBannerStyles')) {
                var style = document.createElement('style');
                style.id = 'wrBannerStyles';
                style.textContent = [
                    '.wager-race-banner{background:linear-gradient(135deg,#1a0a2e 0%,#0f172a 100%);border:1px solid rgba(139,92,246,0.4);border-radius:12px;padding:14px 18px;margin:0 0 16px 0;color:#e2e8f0;font-family:inherit;position:relative;overflow:hidden;}',
                    '.wager-race-banner::before{content:"";position:absolute;top:0;left:0;right:0;height:2px;background:linear-gradient(90deg,#7c3aed,#a78bfa,#7c3aed);animation:wrShimmer 2s linear infinite;}',
                    '@keyframes wrShimmer{0%{background-position:0% 50%}100%{background-position:200% 50%}}',
                    '.wr-header{display:flex;align-items:center;gap:8px;margin-bottom:10px;}',
                    '.wr-live-dot{width:8px;height:8px;border-radius:50%;background:#a78bfa;animation:wrPulse 1.2s ease-in-out infinite;flex-shrink:0;}',
                    '@keyframes wrPulse{0%,100%{opacity:1;transform:scale(1)}50%{opacity:0.5;transform:scale(0.8)}}',
                    '.wr-title{font-size:15px;font-weight:700;color:#c4b5fd;flex:1;}',
                    '.wr-badge{background:#7c3aed;color:#fff;font-size:10px;font-weight:700;padding:2px 7px;border-radius:4px;letter-spacing:0.5px;}',
                    '.wr-timer{font-size:12px;color:#a78bfa;font-variant-numeric:tabular-nums;min-width:90px;text-align:right;}',
                    '.wr-col-hdr{display:grid;grid-template-columns:38px 1fr 80px 90px;font-size:10px;color:rgba(255,255,255,0.4);text-transform:uppercase;letter-spacing:0.5px;padding:0 4px 4px;border-bottom:1px solid rgba(255,255,255,0.08);margin-bottom:4px;}',
                    '.wr-row{display:grid;grid-template-columns:38px 1fr 80px 90px;align-items:center;padding:5px 4px;border-radius:6px;font-size:13px;transition:background 0.15s;}',
                    '.wr-row:hover{background:rgba(124,58,237,0.12);}',
                    '.wr-row--me{background:rgba(124,58,237,0.2);border:1px solid rgba(167,139,250,0.3);}',
                    '.wr-rank{font-size:16px;}',
                    '.wr-name{color:#e2e8f0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}',
                    '.wr-wagered{color:#a78bfa;font-weight:600;text-align:right;}',
                    '.wr-prize{color:#fbbf24;font-size:11px;font-weight:600;text-align:right;}',
                    '.wr-my-rank{margin-top:8px;padding:6px 10px;background:rgba(124,58,237,0.15);border-radius:6px;font-size:12px;color:#c4b5fd;text-align:center;}',
                    '.wr-footer{margin-top:10px;font-size:11px;color:rgba(255,255,255,0.4);text-align:center;}'
                ].join('');
                document.head.appendChild(style);
            }

            if (document.getElementById('wagerRaceBanner')) {
                _fetchAndRenderWagerRace();
                return;
            }

            var banner = document.createElement('div');
            banner.id = 'wagerRaceBanner';
            banner.className = 'wager-race-banner';
            banner.style.display = 'none';

            // Insert before game grid
            var gamesSection = document.getElementById('games-section') || document.getElementById('gamesContainer') || document.querySelector('.games-grid') || document.querySelector('.game-grid');
            if (gamesSection && gamesSection.parentNode) {
                gamesSection.parentNode.insertBefore(banner, gamesSection);
            } else {
                var main = document.getElementById('main-content') || document.getElementById('lobby') || document.querySelector('.lobby-content');
                if (main) main.appendChild(banner);
            }

            _fetchAndRenderWagerRace();
            _wagerRaceRefreshInterval = setInterval(_fetchAndRenderWagerRace, 60000);
        }

        async function _fetchAndRenderWagerRace() {
            var banner = document.getElementById('wagerRaceBanner');
            if (!banner) return;
            try {
                var res = await fetch('/api/wagerace');
                if (!res.ok) throw new Error('HTTP ' + res.status);
                var data = await res.json();
                _renderWagerRaceBanner(data.race, data.leaderboard || []);
            } catch (e) {
                if (banner) banner.style.display = 'none';
            }
        }

        function _renderWagerRaceBanner(race, leaderboard) {
            var banner = document.getElementById('wagerRaceBanner');
            if (!banner) return;
            if (!race) { banner.style.display = 'none'; return; }

            banner.style.display = '';
            var myUsername = (typeof currentUser !== 'undefined' && currentUser) ? (currentUser.username || '') : '';
            var medals = ['🥇', '🥈', '🥉', '4️⃣', '5️⃣'];
            var prizes = ['$50+500💎', '$25+300💎', '$15+200💎', '$5+100💎', '$5+100💎'];
            var myEntry = leaderboard.find(function(p) { return myUsername && p.username === myUsername; });

            var rows = leaderboard.slice(0, 5).map(function(p, i) {
                var isMe = myUsername && p.username === myUsername;
                return '<div class="wr-row' + (isMe ? ' wr-row--me' : '') + '">' +
                    '<span class="wr-rank">' + (medals[i] || '#' + (i + 1)) + '</span>' +
                    '<span class="wr-name">' + _wrEscHtml(p.display_name || p.username || 'Player') + (isMe ? ' ★' : '') + '</span>' +
                    '<span class="wr-wagered">$' + parseFloat(p.total_wagered || 0).toFixed(2) + '</span>' +
                    '<span class="wr-prize">' + (prizes[i] || '') + '</span>' +
                    '</div>';
            }).join('');

            if (leaderboard.length === 0) {
                rows = '<div style="text-align:center;opacity:0.6;padding:8px 0;font-size:12px;">No players yet — spin any game to enter the race!</div>';
            }

            var myRankHtml = '';
            if (myEntry && myEntry.place > 5) {
                myRankHtml = '<div class="wr-my-rank">Your current rank: #' + myEntry.place + ' · $' + parseFloat(myEntry.total_wagered || 0).toFixed(2) + ' wagered</div>';
            }

            banner.innerHTML =
                '<div class="wr-header">' +
                    '<span class="wr-live-dot"></span>' +
                    '<span class="wr-title">⚡ Hourly Wager Race</span>' +
                    '<span class="wr-badge">LIVE</span>' +
                    '<span class="wr-timer" id="wagerRaceTimer" data-ends="' + race.ends_at + '">--:--</span>' +
                '</div>' +
                '<div class="wr-top5">' +
                    '<div class="wr-col-hdr"><span></span><span>Player</span><span>Wagered</span><span>Prize</span></div>' +
                    rows +
                '</div>' +
                myRankHtml +
                '<div class="wr-footer">🎰 Spin any game to enter · Prizes credited automatically · All participants earn 10💎</div>';

            if (_wagerRaceCountdownInterval) clearInterval(_wagerRaceCountdownInterval);
            _updateWagerRaceTimer();
            _wagerRaceCountdownInterval = setInterval(_updateWagerRaceTimer, 1000);
        }

        function _updateWagerRaceTimer() {
            var el = document.getElementById('wagerRaceTimer');
            if (!el) { clearInterval(_wagerRaceCountdownInterval); return; }
            var endsAt = el.dataset.ends;
            if (!endsAt) return;
            var diff = Math.max(0, new Date(endsAt).getTime() - Date.now());
            var m = Math.floor(diff / 60000);
            var s = Math.floor((diff % 60000) / 1000);
            el.textContent = 'Ends in ' + String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0');
            if (diff === 0) {
                clearInterval(_wagerRaceCountdownInterval);
                setTimeout(_fetchAndRenderWagerRace, 3000);
            }
        }

        // ── Jackpot Ticker ────────────────────────────────────────────────────

        function initJackpotTicker() {
            if (window._jackpotTickerInit) return; window._jackpotTickerInit = true;
            // Inject CSS once
            if (!document.getElementById('jackpotTickerStyles')) {
                var style = document.createElement('style');
                style.id = 'jackpotTickerStyles';
                style.textContent = [
                    '.jackpot-ticker{background:linear-gradient(135deg,#12071f 0%,#1a0a2e 50%,#0f0718 100%);border:1px solid rgba(139,92,246,0.35);border-radius:12px;padding:12px 16px;margin:0 0 14px 0;color:#e2e8f0;font-family:inherit;position:relative;overflow:hidden;}',
                    '.jackpot-ticker::before{content:"";position:absolute;top:0;left:0;right:0;height:2px;background:linear-gradient(90deg,#7c3aed,#f59e0b,#7c3aed);background-size:200%;animation:jtShimmer 3s linear infinite;}',
                    '@keyframes jtShimmer{0%{background-position:0%}100%{background-position:200%}}',
                    '.jackpot-ticker-label{font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:rgba(255,255,255,0.45);margin-bottom:10px;display:flex;align-items:center;gap:6px;}',
                    '.jackpot-ticker-label::after{content:"";flex:1;height:1px;background:rgba(255,255,255,0.1);}',
                    '.jackpot-tiers{display:flex;gap:10px;flex-wrap:wrap;}',
                    '.jackpot-tier{flex:1;min-width:120px;background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.1);border-radius:10px;padding:10px 12px;text-align:center;transition:transform 0.15s;}',
                    '.jackpot-tier:hover{transform:translateY(-2px);}',
                    '.jackpot-tier--grand{background:linear-gradient(135deg,rgba(245,158,11,0.12),rgba(180,83,9,0.08));border-color:#f59e0b;box-shadow:0 0 12px rgba(245,158,11,0.2);}',
                    '.jt-icon{font-size:18px;line-height:1;margin-bottom:4px;}',
                    '.jt-tier-name{font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:rgba(255,255,255,0.5);margin-bottom:6px;}',
                    '.jackpot-tier--grand .jt-tier-name{color:#fbbf24;}',
                    '.jt-amount{font-size:17px;font-weight:800;color:#fff;font-variant-numeric:tabular-nums;letter-spacing:-0.5px;}',
                    '.jackpot-tier--grand .jt-amount{color:#f59e0b;text-shadow:0 0 8px rgba(245,158,11,0.5);}',
                    '.jt-last-winner{font-size:10px;color:rgba(255,255,255,0.45);margin-top:5px;}'
                ].join('');
                document.head.appendChild(style);
            }

            if (document.getElementById('jackpotTicker')) {
                _fetchAndRenderJackpot();
                return;
            }

            var ticker = document.createElement('div');
            ticker.id = 'jackpotTicker';
            ticker.className = 'jackpot-ticker';
            ticker.style.display = 'none';

            // Insert before game grid — same pattern as wager race banner
            var gamesSection = document.getElementById('games-section') || document.getElementById('gamesContainer') || document.querySelector('.games-grid') || document.querySelector('.game-grid');
            if (gamesSection && gamesSection.parentNode) {
                gamesSection.parentNode.insertBefore(ticker, gamesSection);
            } else {
                var main = document.getElementById('main-content') || document.getElementById('lobby') || document.querySelector('.lobby-content');
                if (main) main.appendChild(ticker);
            }

            _fetchAndRenderJackpot();
            _jackpotRefreshInterval = setInterval(_fetchAndRenderJackpot, 30000);
        }

        async function _fetchAndRenderJackpot() {
            var ticker = document.getElementById('jackpotTicker');
            if (!ticker) return;
            try {
                var res = await fetch('/api/jackpot/status');
                if (!res.ok) throw new Error('HTTP ' + res.status);
                var data = await res.json();
                var pools = data.pools || [];
                if (pools.length === 0) { ticker.style.display = 'none'; return; }
                _renderJackpotTicker(pools);
            } catch (e) {
                if (ticker) ticker.style.display = 'none';
            }
        }

        function _renderJackpotTicker(pools) {
            var ticker = document.getElementById('jackpotTicker');
            if (!ticker || !pools || pools.length === 0) { if (ticker) ticker.style.display = 'none'; return; }

            var tierMeta = {
                mini:  { icon: '🥉', label: 'Mini' },
                minor: { icon: '🥈', label: 'Minor' },
                major: { icon: '🥇', label: 'Major' },
                grand: { icon: '🏆', label: 'Grand' }
            };

            // Build label row
            var labelDiv = document.createElement('div');
            labelDiv.className = 'jackpot-ticker-label';
            var labelSpan = document.createElement('span');
            labelSpan.textContent = '💰 Live Jackpots';
            labelDiv.appendChild(labelSpan);

            // Build tiers container
            var tiersDiv = document.createElement('div');
            tiersDiv.className = 'jackpot-tiers';

            // Sort by size so Grand is last (most prominent on right)
            var order = ['mini', 'minor', 'major', 'grand'];
            var sorted = order.map(function(t) { return pools.find(function(p) { return p.tier === t; }); }).filter(Boolean);
            // Also include any tiers not in order array
            pools.forEach(function(p) { if (order.indexOf(p.tier) === -1) sorted.push(p); });

            sorted.forEach(function(pool) {
                var meta = tierMeta[pool.tier] || { icon: '🎰', label: pool.tier };
                var isGrand = pool.tier === 'grand';

                var card = document.createElement('div');
                card.className = 'jackpot-tier' + (isGrand ? ' jackpot-tier--grand' : '');

                var iconDiv = document.createElement('div');
                iconDiv.className = 'jt-icon';
                iconDiv.textContent = meta.icon;

                var nameDiv = document.createElement('div');
                nameDiv.className = 'jt-tier-name';
                nameDiv.textContent = meta.label.toUpperCase();

                var amountDiv = document.createElement('div');
                amountDiv.className = 'jt-amount';
                var amount = parseFloat(pool.currentAmount || 0);
                amountDiv.textContent = '$' + amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

                card.appendChild(iconDiv);
                card.appendChild(nameDiv);
                card.appendChild(amountDiv);

                // Grand jackpot last winner note
                if (isGrand && pool.lastWinner && pool.lastWinner.username) {
                    var winnerDiv = document.createElement('div');
                    winnerDiv.className = 'jt-last-winner';
                    // Use textContent for server-provided username — safe from XSS
                    var wonAt = pool.lastWinner.wonAt ? new Date(pool.lastWinner.wonAt).toLocaleDateString() : '';
                    var prefix = document.createTextNode('\uD83C\uDF89 Last won by ');
                    var usernameSpan = document.createElement('strong');
                    usernameSpan.textContent = pool.lastWinner.username;
                    var suffix = wonAt ? document.createTextNode(' · ' + wonAt) : document.createTextNode('');
                    winnerDiv.appendChild(prefix);
                    winnerDiv.appendChild(usernameSpan);
                    winnerDiv.appendChild(suffix);
                    card.appendChild(winnerDiv);
                }

                tiersDiv.appendChild(card);
            });

            // Clear and rebuild
            while (ticker.firstChild) ticker.removeChild(ticker.firstChild);
            ticker.appendChild(labelDiv);
            ticker.appendChild(tiersDiv);
            ticker.style.display = '';
        }

        // ── Lucky Hour Banner ─────────────────────────────────────────────────

        function initLuckyHourBanner() {
            // Inject CSS once
            if (!document.getElementById('luckyHourStyles')) {
                var style = document.createElement('style');
                style.id = 'luckyHourStyles';
                style.textContent = [
                    '.lucky-hour-banner{border-radius:10px;padding:10px 16px;margin:0 0 14px 0;font-family:inherit;display:flex;align-items:center;gap:12px;transition:all 0.3s;}',
                    '.lucky-hour-banner--active{background:linear-gradient(135deg,#064e3b 0%,#065f46 50%,#047857 100%);border:1px solid #10b981;box-shadow:0 0 16px rgba(16,185,129,0.25);animation:lhPulse 2s ease-in-out infinite;}',
                    '.lucky-hour-banner--inactive{background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.1);}',
                    '@keyframes lhPulse{0%,100%{box-shadow:0 0 16px rgba(16,185,129,0.25)}50%{box-shadow:0 0 28px rgba(16,185,129,0.45)}}',
                    '.lh-icon{font-size:22px;flex-shrink:0;line-height:1;}',
                    '.lh-body{flex:1;min-width:0;}',
                    '.lh-title{font-size:13px;font-weight:700;color:#fff;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}',
                    '.lucky-hour-banner--active .lh-title{color:#6ee7b7;}',
                    '.lucky-hour-banner--inactive .lh-title{color:rgba(255,255,255,0.55);font-weight:600;font-size:12px;}',
                    '.lh-countdown{font-size:11px;font-variant-numeric:tabular-nums;margin-top:2px;}',
                    '.lucky-hour-banner--active .lh-countdown{color:#a7f3d0;}',
                    '.lucky-hour-banner--inactive .lh-countdown{color:rgba(255,255,255,0.35);}'
                ].join('');
                document.head.appendChild(style);
            }

            if (document.getElementById('luckyHourBanner')) {
                _fetchAndRenderLuckyHour();
                return;
            }

            var banner = document.createElement('div');
            banner.id = 'luckyHourBanner';
            banner.className = 'lucky-hour-banner';
            banner.style.display = 'none';

            // Insert before game grid — same pattern as other banners
            var gamesSection = document.getElementById('games-section') || document.getElementById('gamesContainer') || document.querySelector('.games-grid') || document.querySelector('.game-grid');
            if (gamesSection && gamesSection.parentNode) {
                gamesSection.parentNode.insertBefore(banner, gamesSection);
            } else {
                var main = document.getElementById('main-content') || document.getElementById('lobby') || document.querySelector('.lobby-content');
                if (main) main.appendChild(banner);
            }

            _fetchAndRenderLuckyHour();
            _luckyHourRefreshInterval = setInterval(_fetchAndRenderLuckyHour, 60000);
        }

        async function _fetchAndRenderLuckyHour() {
            var banner = document.getElementById('luckyHourBanner');
            if (!banner) return;
            try {
                var res = await fetch('/api/lucky-hour');
                if (!res.ok) throw new Error('HTTP ' + res.status);
                var data = await res.json();
                _renderLuckyHourBanner(data);
            } catch (e) {
                if (banner) banner.style.display = 'none';
            }
        }

        function _renderLuckyHourBanner(data) {
            var banner = document.getElementById('luckyHourBanner');
            if (!banner || !data) { if (banner) banner.style.display = 'none'; return; }

            // Clear existing content
            while (banner.firstChild) banner.removeChild(banner.firstChild);

            // Clear any existing countdown interval
            if (_luckyHourCountdownInterval) {
                clearInterval(_luckyHourCountdownInterval);
                _luckyHourCountdownInterval = null;
            }

            var isActive = !!data.active;
            var multiplier = parseFloat(data.multiplier || 1.5);
            var targetTime = isActive ? data.endsAt : data.nextAt;

            banner.className = 'lucky-hour-banner ' + (isActive ? 'lucky-hour-banner--active' : 'lucky-hour-banner--inactive');
            banner.style.display = '';

            // Icon
            var iconDiv = document.createElement('div');
            iconDiv.className = 'lh-icon';
            iconDiv.textContent = '\uD83C\uDF40'; // 🍀

            // Body
            var bodyDiv = document.createElement('div');
            bodyDiv.className = 'lh-body';

            var titleDiv = document.createElement('div');
            titleDiv.className = 'lh-title';

            if (isActive) {
                // Build: "🍀 LUCKY HOUR ACTIVE — 1.5× Win Multiplier!"
                titleDiv.textContent = 'LUCKY HOUR ACTIVE \u2014 ' + multiplier + '\u00D7 Win Multiplier!';
            } else {
                titleDiv.textContent = '\uD83C\uDF40 Lucky Hour starts in\u2026';
            }

            var countdownDiv = document.createElement('div');
            countdownDiv.className = 'lh-countdown';
            countdownDiv.id = 'luckyHourCountdown';
            if (targetTime) {
                countdownDiv.dataset.target = targetTime;
                countdownDiv.dataset.mode = isActive ? 'ends' : 'starts';
            }
            countdownDiv.textContent = isActive ? 'Ends in --:--' : 'Starts in --:--';

            bodyDiv.appendChild(titleDiv);
            bodyDiv.appendChild(countdownDiv);

            banner.appendChild(iconDiv);
            banner.appendChild(bodyDiv);

            if (targetTime) {
                _updateLuckyHourCountdown();
                _luckyHourCountdownInterval = setInterval(_updateLuckyHourCountdown, 1000);
            }
        }

        function _updateLuckyHourCountdown() {
            var el = document.getElementById('luckyHourCountdown');
            if (!el) { clearInterval(_luckyHourCountdownInterval); _luckyHourCountdownInterval = null; return; }
            var target = el.dataset.target;
            var mode = el.dataset.mode;
            if (!target) return;
            var diff = Math.max(0, new Date(target).getTime() - Date.now());
            var h = Math.floor(diff / 3600000);
            var m = Math.floor((diff % 3600000) / 60000);
            var s = Math.floor((diff % 60000) / 1000);
            var timeStr = h > 0
                ? String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0')
                : String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0');
            el.textContent = (mode === 'ends' ? 'Ends in ' : 'Starts in ') + timeStr;
            if (diff === 0) {
                clearInterval(_luckyHourCountdownInterval);
                _luckyHourCountdownInterval = null;
                // Refresh after 3s to pick up new state
                setTimeout(_fetchAndRenderLuckyHour, 3000);
            }
        }

        // ── Live Activity Feed ────────────────────────────────────────────────
        let _feedRefreshInterval = null;

        function initLiveFeed() {
            if (document.getElementById('liveFeedWidget')) return;

            const widget = document.createElement('div');
            widget.id = 'liveFeedWidget';
            widget.className = 'live-feed-widget';
            widget.innerHTML = `
                <div class="live-feed-header">
                    <span class="live-feed-dot"></span>
                    <span class="live-feed-title">Live Big Wins</span>
                </div>
                <div class="live-feed-list" id="liveFeedList">
                    <div class="live-feed-loading">Loading…</div>
                </div>`;

            // Insert after tournament banner (or before game grid if banner missing)
            const banner = document.getElementById('tournamentBanner');
            if (banner && banner.parentNode) {
                banner.parentNode.insertBefore(widget, banner.nextSibling);
            } else {
                const grid = document.getElementById('games-section')
                    || document.getElementById('gamesContainer')
                    || document.querySelector('.games-grid')
                    || document.querySelector('.game-grid');
                if (grid && grid.parentNode) grid.parentNode.insertBefore(widget, grid);
            }

            _fetchLiveFeed();
            _feedRefreshInterval = setInterval(_fetchLiveFeed, 45000);
        }

        async function _fetchLiveFeed() {
            const listEl = document.getElementById('liveFeedList');
            if (!listEl) return;
            try {
                const res = await fetch('/api/feed');
                if (!res.ok) throw new Error('HTTP ' + res.status);
                const data = await res.json();
                const feed = data.feed || [];
                _renderLiveFeed(feed);
            } catch (e) {
                // Hide feed widget if server unreachable
                const widget = document.getElementById('liveFeedWidget');
                if (widget) widget.style.display = 'none';
            }
        }

        function _renderLiveFeed(feed) {
            const listEl = document.getElementById('liveFeedList');
            if (!listEl) return;
            if (!feed || feed.length === 0) {
                listEl.innerHTML = '<div class="live-feed-empty">No big wins yet — be the first!</div>';
                return;
            }

            // Find game name from GAMES array if available
            function _gameName(gameId) {
                if (typeof GAMES !== 'undefined') {
                    const g = GAMES.find(function(x) { return x.id === gameId; });
                    if (g) return g.name;
                }
                return gameId;
            }

            function _fmtMoney(n) {
                return '$' + Number(n).toLocaleString('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
            }

            function _timeAgo(isoStr) {
                const diff = Date.now() - new Date(isoStr).getTime();
                const m = Math.floor(diff / 60000);
                if (m < 1)  return 'just now';
                if (m < 60) return m + 'm ago';
                const h = Math.floor(m / 60);
                if (h < 24) return h + 'h ago';
                return Math.floor(h / 24) + 'd ago';
            }

            listEl.innerHTML = feed.slice(0, 8).map(function(entry) {
                return '<div class="live-feed-entry">' +
                    '<span class="lfe-user">' + escapeHtml(entry.username) + '</span>' +
                    ' won ' +
                    '<span class="lfe-win">' + _fmtMoney(entry.win) + '</span>' +
                    ' <span class="lfe-mult">(' + entry.mult + '×)</span>' +
                    ' on <span class="lfe-game">' + _gameName(entry.gameId) + '</span>' +
                    '<span class="lfe-time">' + _timeAgo(entry.ts) + '</span>' +
                    '</div>';
            }).join('');
        }

        // ── Lobby Challenge Widget ────────────────────────────────
        function _getDailyChallengeState() {
            try {
                var raw = localStorage.getItem('matrixChallenges');
                var state = raw ? JSON.parse(raw) : null;
                var today = new Date().toISOString().slice(0, 10);
                if (!state || state.date !== today) return { date: today, progress: {}, completed: [] };
                return state;
            } catch(e) { return { date: new Date().toISOString().slice(0, 10), progress: {}, completed: [] }; }
        }

        function renderLobbyChallengeWidget() {
            var container = document.getElementById('lobbyChallengeWidget');
            if (!container) return;

            var challenges = (typeof DAILY_CHALLENGES !== 'undefined' && DAILY_CHALLENGES) || [
                { id: 'spins_20',   label: 'Spin It Up',   target: 20,  reward: 100, icon: '🎰' },
                { id: 'games_3',    label: 'Game Hopper',  target: 3,   reward: 100, icon: '🎮' },
                { id: 'win_once',   label: 'Lucky Break',  target: 1,   reward: 75,  icon: '🍀' },
                { id: 'big_win_50', label: 'High Roller',  target: 50,  reward: 500, icon: '💥' },
                { id: 'bonus_1',    label: 'Bonus Hunter', target: 1,   reward: 300, icon: '🎁' },
                { id: 'wager_500',  label: 'Whale Watch',  target: 500, reward: 200, icon: '🐋' },
                { id: 'streak_3',   label: 'Hot Streak',   target: 3,   reward: 250, icon: '🔥' },
                { id: 'spins_50',   label: 'Spin Machine', target: 50,  reward: 150, icon: '⚡' },
            ];

            var state = _getDailyChallengeState();
            var doneCount = state.completed.length;
            var total = challenges.length;

            // Show first 3 challenges
            var shown = challenges.slice(0, 3);

            var html = '<div class="lc-header">'
                + '<span class="lc-title">Today\'s Challenges</span>'
                + '<span class="lc-progress">' + doneCount + '/' + total + ' complete</span>'
                + '<button class="lc-view-all" onclick="openStatsModal && openStatsModal()">View All</button>'
                + '</div>'
                + '<div class="lc-items">';

            shown.forEach(function(ch) {
                var prog = Math.min(state.progress[ch.id] || 0, ch.target);
                var done = state.completed.indexOf(ch.id) >= 0;
                var pct = Math.round((prog / ch.target) * 100);
                html += '<div class="lc-item' + (done ? ' lc-done' : '') + '">'
                    + '<span class="lc-icon">' + ch.icon + '</span>'
                    + '<div class="lc-info">'
                    +   '<div class="lc-label">' + ch.label + '</div>'
                    +   '<div class="lc-bar"><div class="lc-bar-fill" style="width:' + pct + '%"></div></div>'
                    + '</div>'
                    + '<span class="lc-reward">' + (done ? '✓' : '+$' + (ch.reward || 0)) + '</span>'
                    + '</div>';
            });

            html += '</div>';
            container.innerHTML = html;
            container.style.display = 'block';
        }

        window.refreshLobbyChallengeWidget = renderLobbyChallengeWidget;

// ══════════════════════════════════════════════════════════
// VIP Cashback Available Banner
// ══════════════════════════════════════════════════════════
function initCashbackBanner() {
    var token = localStorage.getItem('authToken') || sessionStorage.getItem('authToken');
    if (!token) return;
    fetch('/api/vip/status', { headers: { Authorization: 'Bearer ' + token } })
        .then(function(r) { return r.ok ? r.json() : null; })
        .then(function(data) {
            if (!data || !data.cashback || !data.cashback.canClaim || data.cashback.availableAmount <= 0) return;
            if (document.getElementById('cashbackAvailBanner')) return;

            var banner = document.createElement('div');
            banner.id = 'cashbackAvailBanner';
            banner.style.cssText = 'position:fixed;bottom:80px;right:16px;z-index:9000;' +
                'background:linear-gradient(135deg,#1b5e20,#2e7d32);color:#fff;' +
                'border-radius:12px;padding:12px 16px;' +
                'box-shadow:0 4px 20px rgba(0,200,83,0.4);max-width:280px;font-size:13px;line-height:1.4';

            var title = document.createElement('div');
            title.style.cssText = 'font-weight:700;font-size:15px;margin-bottom:4px';
            title.textContent = '💰 Cashback Available!';

            var desc = document.createElement('div');
            desc.textContent = 'You have $' + data.cashback.availableAmount.toFixed(2) +
                ' in ' + (data.tier || '') + ' cashback ready to claim.';

            var actions = document.createElement('div');
            actions.style.cssText = 'margin-top:8px;display:flex;gap:8px';

            var claimBtn = document.createElement('button');
            claimBtn.style.cssText = 'background:#00c853;border:none;color:#000;font-weight:700;' +
                'padding:6px 14px;border-radius:8px;cursor:pointer;font-size:12px';
            claimBtn.textContent = 'CLAIM NOW';
            claimBtn.addEventListener('click', function() { claimVipCashback(); });

            var laterBtn = document.createElement('button');
            laterBtn.style.cssText = 'background:rgba(255,255,255,0.15);border:none;color:#fff;' +
                'padding:6px 10px;border-radius:8px;cursor:pointer;font-size:12px';
            laterBtn.textContent = 'Later';
            laterBtn.addEventListener('click', function() { banner.remove(); });

            actions.appendChild(claimBtn);
            actions.appendChild(laterBtn);
            banner.appendChild(title);
            banner.appendChild(desc);
            banner.appendChild(actions);
            document.body.appendChild(banner);
        })
        .catch(function() {});
}

function claimVipCashback() {
    var token = localStorage.getItem('authToken') || sessionStorage.getItem('authToken');
    if (!token) return;
    var claimBtn = document.querySelector('#cashbackAvailBanner button');
    if (claimBtn) { claimBtn.textContent = 'Claiming…'; claimBtn.disabled = true; }
    fetch('/api/vip/cashback/claim', {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }
    })
        .then(function(r) { return r.json(); })
        .then(function(data) {
            var banner = document.getElementById('cashbackAvailBanner');
            if (data.success) {
                if (banner) {
                    while (banner.firstChild) banner.removeChild(banner.firstChild);
                    var ok = document.createElement('div');
                    ok.style.cssText = 'font-weight:700;font-size:15px';
                    ok.textContent = '✅ Cashback Credited!';
                    var msg = document.createElement('div');
                    msg.style.marginTop = '4px';
                    msg.textContent = '$' + data.amount.toFixed(2) + ' added to your bonus balance.';
                    banner.appendChild(ok);
                    banner.appendChild(msg);
                    setTimeout(function() { if (banner.parentNode) banner.remove(); }, 3500);
                }
                if (typeof updateBalance === 'function') setTimeout(updateBalance, 500);
            } else {
                if (banner) banner.remove();
            }
        })
        .catch(function() { var b = document.getElementById('cashbackAvailBanner'); if (b) b.remove(); });
}

// ══════════════════════════════════════════════════════════
// SPRINT 34 — Hourly Free Bonus
// ══════════════════════════════════════════════════════════
var _HB_KEY = 'matrixHourlyBonus';
var _HB_COOLDOWN = 60 * 60 * 1000; // 1 hour

function _hbGetState() {
    try { return JSON.parse(localStorage.getItem(_HB_KEY) || '{}'); } catch(e) { return {}; }
}

function initHourlyBonus() {
    var fab = document.getElementById('hourlyBonusFab');
    if (!fab) return;
    _hbRefresh();
    setInterval(_hbRefresh, 30000); // refresh every 30s
}

function _hbRefresh() {
    var fab = document.getElementById('hourlyBonusFab');
    var sub = document.getElementById('hourlyBonusSub');
    if (!fab) return;
    var state = _hbGetState();
    var now = Date.now();
    var last = state.lastClaim || 0;
    var elapsed = now - last;
    if (elapsed >= _HB_COOLDOWN) {
        fab.style.display = 'flex';
        fab.classList.add('hbf-ready');
        if (sub) sub.textContent = 'Tap to claim!';
    } else {
        fab.style.display = 'flex';
        fab.classList.remove('hbf-ready');
        var remaining = Math.ceil((_HB_COOLDOWN - elapsed) / 60000);
        if (sub) sub.textContent = remaining + 'm remaining';
    }
}

function claimHourlyBonus() {
    var state = _hbGetState();
    var now = Date.now();
    var last = state.lastClaim || 0;
    if (now - last < _HB_COOLDOWN) return; // on cooldown
    var award = 25 + Math.floor(Math.random() * 76); // $25-$100
    if (typeof balance !== 'undefined') balance += award;
    if (typeof updateBalance === 'function') updateBalance();
    if (typeof saveStats === 'function') saveStats();
    state.lastClaim = now;
    try { localStorage.setItem(_HB_KEY, JSON.stringify(state)); } catch (e) { /* ignore */ }
    _hbRefresh();
    if (typeof showToast === 'function') showToast('🎁 Free Bonus: $' + award + ' added!', 'success');
    else if (typeof showMessage === 'function') showMessage('🎁 Free Bonus: $' + award + '!', 'win');
    // coin burst
    if (typeof createConfetti === 'function') createConfetti();
}

// ══════════════════════════════════════════════════════════
// SPRINT 34 — Challenge Streak Multiplier
// ══════════════════════════════════════════════════════════
var _CS_KEY = 'matrixChallengeStreak';

function getChallengeStreakMultiplier() {
    try {
        var s = JSON.parse(localStorage.getItem(_CS_KEY) || '{}');
        var today = new Date().toISOString().slice(0, 10);
        if (s.lastDay !== today) return 1; // streak not registered today yet
        if (s.streak >= 3) return 2;
        if (s.streak === 2) return 1.5;
        return 1;
    } catch(e) { return 1; }
}

function updateChallengeStreak(completed) {
    // Call when all daily challenges are completed
    try {
        var s = JSON.parse(localStorage.getItem(_CS_KEY) || '{}');
        var today = new Date().toISOString().slice(0, 10);
        var yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
        if (completed) {
            if (s.lastDay === yesterday) {
                s.streak = (s.streak || 0) + 1;
            } else if (s.lastDay !== today) {
                s.streak = 1; // reset if gap
            }
            s.lastDay = today;
        } else {
            if (s.lastDay !== today && s.lastDay !== yesterday) s.streak = 0;
        }
        localStorage.setItem(_CS_KEY, JSON.stringify(s));
    } catch(e) {}
}

// ══════════════════════════════════════════════════════════
// SPRINT 35 — Favorites Quick Bar
// ══════════════════════════════════════════════════════════
function renderFavQuickBar() {
    var bar = document.getElementById('favQuickBar');
    var scroll = document.getElementById('favQuickScroll');
    if (!bar || !scroll) return;
    var favs = [];
    try {
        var raw = localStorage.getItem(typeof STORAGE_KEY_FAVORITES !== 'undefined' ? STORAGE_KEY_FAVORITES : 'casinoFavorites');
        favs = JSON.parse(raw || '[]');
    } catch(e) {}
    if (favs.length === 0) { bar.style.display = 'none'; return; }
    var allGames = typeof GAMES !== 'undefined' ? GAMES : [];
    var tiles = favs.slice(0, 8).map(function(id) {
        var g = allGames.find(function(x) { return x.id === id; });
        if (!g) return '';
        var color = (g.color || '#333').replace('#', '');
        return '<div class="fqb-tile" onclick="if(typeof openSlot===\'function\')openSlot(\'' + g.id + '\')" title="' + g.name + '">'
            + '<div class="fqb-icon" style="background:#' + color + '">' + (g.name || g.id).charAt(0).toUpperCase() + '</div>'
            + '<div class="fqb-name">' + (g.name || g.id) + '</div>'
            + '</div>';
    }).join('');
    scroll.innerHTML = tiles || '<div class="fqb-empty">Heart games to add them here</div>';
    bar.style.display = 'flex';
}

// Hook renderFavQuickBar into renderGames
(function() {
    var _origRG = typeof renderGames === 'function' ? renderGames : null;
    if (_origRG) {
        renderGames = function() {
            _origRG.apply(this, arguments);
            renderFavQuickBar();
            buildProviderStatsPanel();
        };
    }
})();

// ===== Sprint 39: Provider Stats Panel =====
function buildProviderStatsPanel() {
    var panel = document.getElementById('providerStatsPanel');
    var body = document.getElementById('providerStatsBody');
    if (!panel || !body) return;
    if (!Array.isArray(typeof GAMES !== 'undefined' ? GAMES : null)) return;
    var stats = {};
    GAMES.forEach(function(g) {
        var p = g.provider || 'Unknown';
        if (!stats[p]) stats[p] = { count: 0, rtpTotal: 0, rtpCount: 0 };
        stats[p].count++;
        var rtp = (g.payouts && g.payouts.triple) ? g.payouts.triple : 0;
        if (rtp > 0) { stats[p].rtpTotal += rtp; stats[p].rtpCount++; }
    });
    var providers = Object.keys(stats).sort(function(a, b) { return stats[b].count - stats[a].count; });
    body.innerHTML = providers.map(function(p) {
        var s = stats[p];
        var avgRtp = s.rtpCount > 0 ? (s.rtpTotal / s.rtpCount).toFixed(0) + 'x' : '—';
        return '<button class="provider-stat-row" onclick="setProviderFilter(\'' + p.replace(/'/g, "\\'") + '\')" title="Filter by ' + p + '">'
            + '<span class="psr-name">' + p + '</span>'
            + '<span class="psr-count">' + s.count + ' games</span>'
            + '<span class="psr-rtp">Avg max: ' + avgRtp + '</span>'
            + '</button>';
    }).join('');
    panel.style.display = '';
}

// Toggle provider stats panel visibility
function toggleProviderStats() {
    var panel = document.getElementById('providerStatsPanel');
    if (!panel) return;
    panel.style.display = panel.style.display === 'none' ? '' : 'none';
}

// ===== Sprint 40: Game Comparison Tool =====
var _compareMode = false;
var _compareGames = [];

function toggleCompareMode() {
    _compareMode = !_compareMode;
    var btn = document.getElementById('compareToggleBtn');
    if (btn) btn.classList.toggle('compare-active', _compareMode);
    if (!_compareMode) { clearCompareSelection(); }
    if (typeof showToast === 'function') showToast(_compareMode ? '\u2696 Click games to compare (max 3)' : 'Compare mode off', 'info');
}

function _addToCompare(gameId) {
    if (!_compareMode) return false;
    if (_compareGames.indexOf(gameId) >= 0) {
        _compareGames = _compareGames.filter(function(id) { return id !== gameId; });
    } else {
        if (_compareGames.length >= 3) { if (typeof showToast === 'function') showToast('Max 3 games to compare', 'warn'); return true; }
        _compareGames.push(gameId);
    }
    _renderCompareBar();
    return true;
}

function _renderCompareBar() {
    var bar = document.getElementById('compareBar');
    var slotsEl = document.getElementById('compareBarSlots');
    var nowBtn = document.getElementById('compareNowBtn');
    if (!bar) return;
    bar.style.display = _compareGames.length > 0 ? '' : 'none';
    if (!slotsEl) return;
    slotsEl.innerHTML = _compareGames.map(function(id) {
        var g = typeof GAMES !== 'undefined' ? GAMES.find(function(x) { return x.id === id; }) : null;
        if (!g) return '';
        return '<span class="compare-pill">' + (g.emoji || '\uD83C\uDFB0') + ' ' + g.name
            + ' <button onclick="_addToCompare(\'' + id + '\')" title="Remove">\u00d7</button></span>';
    }).join('');
    if (nowBtn) nowBtn.disabled = _compareGames.length < 2;
}

function clearCompareSelection() {
    _compareGames = [];
    _renderCompareBar();
    document.querySelectorAll('.game-card.compare-selected').forEach(function(c) { c.classList.remove('compare-selected'); });
}

function openCompareModal() {
    if (_compareGames.length < 2) { if (typeof showToast === 'function') showToast('Select at least 2 games', 'warn'); return; }
    var modal = document.getElementById('gameCompareModal');
    var wrap = document.getElementById('compareTableWrap');
    if (!modal || !wrap) return;
    var games = _compareGames.map(function(id) { return typeof GAMES !== 'undefined' ? GAMES.find(function(g) { return g.id === id; }) : null; }).filter(Boolean);
    var fields = [
        { label: 'Name', fn: function(g) { return g.name; } },
        { label: 'Provider', fn: function(g) { return g.provider || '—'; } },
        { label: 'Grid', fn: function(g) { return (g.reels || 5) + '\u00d7' + (g.rows || 3); } },
        { label: 'Max Win', fn: function(g) { return (g.payouts && g.payouts.triple ? g.payouts.triple + 'x' : '—'); } },
        { label: 'Mechanics', fn: function(g) { return (g.mechanics || []).join(', ') || '—'; } }
    ];
    var best = {};
    fields.forEach(function(f) {
        var vals = games.map(function(g) { return parseFloat(f.fn(g)); });
        if (!isNaN(vals[0])) {
            var max = Math.max.apply(null, vals);
            best[f.label] = max;
        }
    });
    var html = '<table class="compare-table"><thead><tr><th>Stat</th>' + games.map(function(g) { return '<th>' + (g.emoji || '') + ' ' + g.name + '</th>'; }).join('') + '</tr></thead><tbody>';
    fields.forEach(function(f) {
        html += '<tr><td class="compare-stat-label">' + f.label + '</td>';
        games.forEach(function(g) {
            var val = f.fn(g);
            var isTop = best[f.label] !== undefined && parseFloat(val) === best[f.label];
            html += '<td class="compare-val' + (isTop ? ' compare-best' : '') + '">' + val + '</td>';
        });
        html += '</tr>';
    });
    html += '</tbody></table>';
    wrap.innerHTML = html;
    modal.classList.add('active');
    modal.onclick = function(e) { if (e.target === modal) modal.classList.remove('active'); };
}

// ===== Sprint 43: Game Recommendations =====
var _recommendedHidden = false;

function buildRecommendations() {
    var section = document.getElementById('recommendedSection');
    var grid = document.getElementById('recommendedGames');
    if (!section || !grid) return;
    var recent = [];
    try { recent = JSON.parse(localStorage.getItem(typeof RECENTLY_PLAYED_KEY !== 'undefined' ? RECENTLY_PLAYED_KEY : 'matrixRecentlyPlayed') || '[]'); } catch(e) {}
    if (recent.length < 3) { section.style.display = 'none'; return; }
    var playedSet = new Set(recent);
    // Gather providers and mechanics from recently played
    var providerFreq = {}, mechFreq = {};
    recent.forEach(function(id) {
        var g = typeof GAMES !== 'undefined' ? GAMES.find(function(x) { return x.id === id; }) : null;
        if (!g) return;
        if (g.provider) providerFreq[g.provider] = (providerFreq[g.provider] || 0) + 1;
        (g.mechanics || []).forEach(function(m) { mechFreq[m] = (mechFreq[m] || 0) + 1; });
    });
    // Score unplayed games
    var scored = (typeof GAMES !== 'undefined' ? GAMES : []).filter(function(g) { return !playedSet.has(g.id); }).map(function(g) {
        var score = 0;
        if (g.provider && providerFreq[g.provider]) score += providerFreq[g.provider] * 2;
        (g.mechanics || []).forEach(function(m) { if (mechFreq[m]) score += mechFreq[m]; });
        return { game: g, score: score };
    }).filter(function(x) { return x.score > 0; });
    scored.sort(function(a, b) { return b.score - a.score; });
    var top = scored.slice(0, 6).map(function(x) { return x.game; });
    if (top.length < 2) { section.style.display = 'none'; return; }
    grid.innerHTML = top.map(function(g) { return typeof createGameCard === 'function' ? createGameCard(g) : ''; }).join('');
    section.style.display = _recommendedHidden ? 'none' : '';
}

function toggleRecommended() {
    _recommendedHidden = !_recommendedHidden;
    var section = document.getElementById('recommendedSection');
    var btn = section && section.querySelector('.section-see-all');
    if (section) section.style.display = _recommendedHidden ? 'none' : '';
    if (btn) btn.textContent = _recommendedHidden ? 'Show ▼' : 'Hide ▲';
}

// ===== Sprint 44: Game Collections =====
var _activeCollection = 'all';

var _COLLECTIONS = {
    all: null,
    highroller: function(g) { return (g.payouts && g.payouts.triple && g.payouts.triple >= 200) || (g.maxBet && g.maxBet >= 500); },
    quick: function(g) { return (g.reels || 5) <= 3 || (g.rows || 3) <= 3; },
    jackpot: function(g) { return g.jackpot || (g.tags && g.tags.indexOf('jackpot') >= 0) || (g.mechanics && g.mechanics.indexOf('jackpot') >= 0); },
    newbie: function(g) { return (g.payouts && g.payouts.triple && g.payouts.triple <= 100) && !(g.mechanics && g.mechanics.length > 2); }
};

function setCollection(name) {
    _activeCollection = name || 'all';
    document.querySelectorAll('.collection-tab').forEach(function(btn) {
        btn.classList.toggle('collection-tab-active', btn.dataset.collection === _activeCollection);
    });
    if (typeof renderFilteredGames === 'function') renderFilteredGames();
}

// ===== Sprint 46: Tag Filters =====
var _activeTags = new Set();

function toggleTagFilter(tag) {
    if (_activeTags.has(tag)) _activeTags.delete(tag);
    else _activeTags.add(tag);
    document.querySelectorAll('.tag-pill').forEach(function(btn) {
        btn.classList.toggle('tag-pill-active', _activeTags.has(btn.dataset.tag));
    });
    if (typeof renderFilteredGames === 'function') renderFilteredGames();
}

// ===== Sprint 45: Lobby Layout Toggle =====
var _lobbyLayout = (function() { try { return localStorage.getItem('matrixLobbyLayout') || 'grid'; } catch(e) { return 'grid'; } })();

function setLobbyLayout(layout) {
    _lobbyLayout = layout;
    try { localStorage.setItem('matrixLobbyLayout', layout); } catch(e) {}
    document.getElementById('layoutGridBtn') && document.getElementById('layoutGridBtn').classList.toggle('layout-btn-active', layout === 'grid');
    document.getElementById('layoutListBtn') && document.getElementById('layoutListBtn').classList.toggle('layout-btn-active', layout === 'list');
    var allGamesDiv = document.getElementById('allGames');
    if (allGamesDiv) {
        allGamesDiv.classList.toggle('games-list-view', layout === 'list');
        if (layout === 'list') _renderListView(allGamesDiv);
        else if (typeof renderFilteredGames === 'function') renderFilteredGames();
    }
}

function _renderListView(container) {
    var games = typeof getFilteredGames === 'function' ? getFilteredGames() : [];
    container.innerHTML = games.map(function(g) {
        var rtp = (g.payouts && g.payouts.triple) ? g.payouts.triple + 'x' : '—';
        return '<div class="game-list-row" onclick="if(typeof _compareMode!==\'undefined\'&&_compareMode){_addToCompare(\'' + g.id + '\');}else{openSlot(\'' + g.id + '\');}">'
            + '<span class="glr-emoji">' + (g.emoji || '🎰') + '</span>'
            + '<span class="glr-name">' + g.name + '</span>'
            + '<span class="glr-provider">' + (g.provider || '') + '</span>'
            + '<span class="glr-rtp">Max: ' + rtp + '</span>'
            + '<button class="glr-play btn">Play</button>'
            + '</div>';
    }).join('');
}

// Patch getFilteredGames to apply collection + tag filters
(function() {
    var _origGFG = typeof getFilteredGames === 'function' ? getFilteredGames : null;
    if (!_origGFG) return;
    getFilteredGames = function() {
        var list = _origGFG.apply(this, arguments);
        // Sprint 44: collection filter
        if (_activeCollection && _activeCollection !== 'all' && _COLLECTIONS[_activeCollection]) {
            list = list.filter(_COLLECTIONS[_activeCollection]);
        }
        // Sprint 46: tag filter
        if (typeof _activeTags !== 'undefined' && _activeTags.size > 0) {
            list = list.filter(function(g) {
                return Array.from(_activeTags).every(function(tag) {
                    if (tag === 'hot') return g.hot || (g.tags && g.tags.indexOf('hot') >= 0);
                    if (tag === 'new') return g.new || (g.tags && g.tags.indexOf('new') >= 0);
                    if (tag === 'jackpot') return g.jackpot || (g.mechanics && g.mechanics.indexOf('jackpot') >= 0);
                    if (tag === 'megaways') return g.mechanics && g.mechanics.indexOf('megaways') >= 0;
                    if (tag === 'popular') return g.popular || (g.tags && g.tags.indexOf('popular') >= 0);
                    return true;
                });
            });
        }
        return list;
    };
})();

// ===== Sprint 45: Recent Wins Feed =====
var _recentWinsSession = [];

function recordRecentWin(gameName, gameId, winAmount, betAmount) {
    if (winAmount < betAmount * 2) return;
    _recentWinsSession.unshift({ gameName: gameName, gameId: gameId, winAmount: winAmount, ts: Date.now() });
    if (_recentWinsSession.length > 10) _recentWinsSession.length = 10;
    renderRecentWinsFeed();
}

function renderRecentWinsFeed() {
    var strip = document.getElementById('recentWinsStrip');
    var scroll = document.getElementById('recentWinsScroll');
    if (!strip || !scroll) return;
    if (_recentWinsSession.length === 0) { strip.style.display = 'none'; return; }
    strip.style.display = '';
    scroll.innerHTML = _recentWinsSession.map(function(w) {
        var mins = Math.floor((Date.now() - w.ts) / 60000);
        var ago = mins < 1 ? 'just now' : mins + 'm ago';
        return '<div class="rws-card" onclick="if(typeof openSlot!==\'undefined\')openSlot(\'' + w.gameId + '\')" title="Play ' + w.gameName + '">'
            + '<div class="rws-game">' + w.gameName + '</div>'
            + '<div class="rws-win">$' + w.winAmount.toFixed(0) + '</div>'
            + '<div class="rws-time">' + ago + '</div>'
            + '</div>';
    }).join('');
}

// Hook into renderGames to also update recommendations and recent wins
(function() {
    var _orig = typeof renderGames === 'function' ? renderGames : null;
    if (!_orig) return;
    renderGames = function() {
        _orig.apply(this, arguments);
        buildRecommendations();
        renderRecentWinsFeed();
        buildProviderLeaderboard(); // Sprint 48
        updateSessionPnlBar();     // Sprint 49
        updateGamesExploredBadge(); // Sprint 50
        // Apply saved layout
        if (_lobbyLayout === 'list') {
            var c = document.getElementById('allGames');
            if (c) { c.classList.add('games-list-view'); _renderListView(c); }
            document.getElementById('layoutListBtn') && document.getElementById('layoutListBtn').classList.add('layout-btn-active');
            document.getElementById('layoutGridBtn') && document.getElementById('layoutGridBtn').classList.remove('layout-btn-active');
        }
    };
})();

// ===== Sprint 48: Provider Leaderboard =====
function buildProviderLeaderboard() {
    var wrap = document.getElementById('providerLeaderboard');
    var list = document.getElementById('plbList');
    if (!wrap || !list) return;
    try {
        var raw = localStorage.getItem('casinoRecentlyPlayed');
        var played = raw ? JSON.parse(raw) : [];
        if (!played.length) { wrap.style.display = 'none'; return; }
        // Aggregate by provider
        var counts = {};
        played.forEach(function(g) {
            var prov = g.provider || 'Unknown';
            counts[prov] = (counts[prov] || 0) + 1;
        });
        var sorted = Object.keys(counts).sort(function(a, b) { return counts[b] - counts[a]; }).slice(0, 3);
        if (!sorted.length) { wrap.style.display = 'none'; return; }
        list.innerHTML = sorted.map(function(p, i) {
            var medal = ['🥇','🥈','🥉'][i] || '';
            return '<div class="plb-row"><span class="plb-medal">' + medal + '</span>'
                + '<span class="plb-name">' + p + '</span>'
                + '<span class="plb-count">' + counts[p] + ' plays</span></div>';
        }).join('');
        wrap.style.display = '';
    } catch(e) { wrap.style.display = 'none'; }
}

// ===== Sprint 49: Random Game Picker =====
function pickRandomGame() {
    var btn = document.getElementById('randomGameBtn');
    if (btn) { btn.classList.add('spinning-dice'); setTimeout(function() { btn.classList.remove('spinning-dice'); }, 600); }
    var pool = (typeof GAMES !== 'undefined') ? GAMES.slice() : [];
    // Apply current filter if active
    var cf = (typeof currentFilter !== 'undefined') ? currentFilter : 'all';
    var pf = (typeof currentProviderFilter !== 'undefined') ? currentProviderFilter : 'all';
    if (cf && cf !== 'all') pool = pool.filter(function(g) { return g.category === cf || (g.categories && g.categories.indexOf(cf) !== -1); });
    if (pf && pf !== 'all') pool = pool.filter(function(g) { return (g.provider || '').toLowerCase() === pf.toLowerCase(); });
    if (!pool.length) pool = (typeof GAMES !== 'undefined') ? GAMES.slice() : [];
    if (!pool.length) return;
    var pick = pool[Math.floor(Math.random() * pool.length)];
    if (pick && typeof openSlot === 'function') openSlot(pick.id);
}

// ===== Sprint 49: Session P&L Bar =====
var _sessionOpenBalance = null;

function updateSessionPnlBar() {
    var bar = document.getElementById('sessionPnlBar');
    var val = document.getElementById('sessionPnlVal');
    if (!bar || !val) return;
    if (_sessionOpenBalance === null) {
        _sessionOpenBalance = (typeof balance !== 'undefined') ? balance : null;
    }
    if (_sessionOpenBalance === null) { bar.style.display = 'none'; return; }
    var current = (typeof balance !== 'undefined') ? balance : _sessionOpenBalance;
    var pnl = current - _sessionOpenBalance;
    val.textContent = (pnl >= 0 ? '+' : '') + '$' + Math.abs(pnl).toFixed(2);
    val.className = pnl >= 0 ? 'pnl-positive' : 'pnl-negative';
    bar.style.display = '';
}

// ===== Sprint 50: Games Explored Badge =====
function updateGamesExploredBadge() {
    var badge = document.getElementById('gamesExploredBadge');
    if (!badge) return;
    try {
        var raw = localStorage.getItem('casinoGamesExplored');
        var explored = raw ? JSON.parse(raw) : [];
        var total = (typeof GAMES !== 'undefined') ? GAMES.length : 80;
        if (!explored.length) { badge.style.display = 'none'; return; }
        badge.textContent = '🗺 ' + explored.length + '/' + total + ' explored';
        badge.style.display = '';
    } catch(e) { badge.style.display = 'none'; }
}


// ===== Sprint 51/54/56: Lobby Card Extra Badges =====
(function() {
    function _addLobbyCardBadges() {
        if (typeof GAMES === 'undefined') return;
        var playedMap = {};
        try {
            var raw = localStorage.getItem('casinoSpinHistory');
            if (raw) JSON.parse(raw).forEach(function(h) {
                if (h.gameId) playedMap[h.gameId] = (playedMap[h.gameId] || 0) + 1;
            });
        } catch(e) {}

        document.querySelectorAll('.game-card[data-game-id]').forEach(function(card) {
            var gameId = card.dataset.gameId;
            var game = GAMES.find(function(g) { return (g.id || '').toLowerCase() === gameId; });
            if (!game) return;

            // Remove stale badges from previous renders
            card.querySelectorAll('.lb51-badge,.lb54-badge,.lb56-badge').forEach(function(b) { b.remove(); });

            // Sprint 51: Popularity badge (10+ plays)
            var plays = playedMap[game.id] || 0;
            if (plays >= 10) {
                var pb = document.createElement('span');
                var popCls = plays >= 100 ? 'lb51-mega' : plays >= 50 ? 'lb51-fan' : 'lb51-regular';
                pb.className = 'lobby-badge lb51-badge ' + popCls;
                pb.textContent = plays >= 100 ? '\u2B50 Fave' : plays >= 50 ? '\u2665 Fan' : '\u25B6 ' + plays + 'x';
                card.appendChild(pb);
            }

            // Sprint 54: Difficulty badge
            var volMap = { low: ['Easy','lb54-easy'], medium: ['Med','lb54-med'], 'medium-high': ['Med+','lb54-medhard'], high: ['Hard','lb54-hard'], 'very-high': ['Expert','lb54-expert'] };
            var vd = volMap[game.volatility || 'medium'] || ['Med','lb54-med'];
            var db = document.createElement('span');
            db.className = 'lobby-badge lb54-badge ' + vd[1];
            db.textContent = vd[0];
            card.appendChild(db);

            // Sprint 56: Category badge
            var cat = game.category || game.gameType || '';
            if (cat) {
                var cb = document.createElement('span');
                cb.className = 'lobby-badge lb56-badge';
                cb.textContent = String(cat).charAt(0).toUpperCase() + String(cat).slice(1).replace(/-/g,' ');
                card.appendChild(cb);
            }
        });
    }

    // Hook into renderGames chain (append-only, safe for multiple hooks)
    (function() {
        var _prevRG56 = typeof renderGames === 'function' ? renderGames : null;
        if (!_prevRG56) return;
        renderGames = function() {
            _prevRG56.apply(this, arguments);
            setTimeout(_addLobbyCardBadges, 50);
        };
    })();
})();


/* ═══════════════════════════════════════════════════════════════
   LOBBY VISUAL OVERHAUL — 2026-02-27
   ═══════════════════════════════════════════════════════════════ */

/** Inject game-count badges into filter tabs and provider chips */
function _injectFilterCounts() {
  if (typeof games === 'undefined') return;

  var _favKey = (typeof STORAGE_KEY_FAVORITES !== 'undefined') ? STORAGE_KEY_FAVORITES : 'favorites';
  var _counts = { all: games.length, hot: 0, new: 0, jackpot: 0, popular: 0, megaways: 0, favorites: 0 };
  var _favs = (function() {
    try { return JSON.parse(localStorage.getItem(_favKey) || '[]'); } catch(e) { return []; }
  })();
  games.forEach(function(g) {
    var tag = (g.tag || '').toLowerCase();
    if (tag === 'hot')     _counts.hot++;
    if (tag === 'new')     _counts.new++;
    if (tag === 'jackpot') _counts.jackpot++;
    if (tag === 'popular') _counts.popular++;
    if (g.mechanic === 'megaways') _counts.megaways++;
    if (_favs.indexOf(g.id) >= 0) _counts.favorites++;
  });

  document.querySelectorAll('.tab-count').forEach(function(el){el.remove();});
  document.querySelectorAll('.chip-count').forEach(function(el){el.remove();});
  document.querySelectorAll('.filter-tab').forEach(function(btn) {
    var filter = btn.dataset.filter;
    if (!filter || !(_counts.hasOwnProperty(filter))) return;
    var badge = btn.querySelector('.tab-count');
    if (!badge) {
      badge = document.createElement('span');
      badge.className = 'tab-count';
      btn.appendChild(badge);
    }
    badge.textContent = _counts[filter];
  });

  var _provCounts = {};
  games.forEach(function(g) {
    var p = g.provider || 'Unknown';
    _provCounts[p] = (_provCounts[p] || 0) + 1;
  });
  document.querySelectorAll('.provider-chip').forEach(function(chip) {
    var provider = chip.dataset.provider;
    if (!provider) return;
    var n = (provider === 'all') ? games.length : (_provCounts[provider] || 0);
    if (n === 0) return;
    var badge = chip.querySelector('.chip-count');
    if (!badge) {
      badge = document.createElement('span');
      badge.className = 'chip-count';
      chip.appendChild(badge);
    }
    badge.textContent = n;
  });
}

/** Render the featured spotlight strip above Top Picks */
async function _renderFeaturedSpotlight() {
  var container = document.getElementById('featuredSpotlight');
  if (!container || typeof games === 'undefined') return;
  container.innerHTML = '';

  var serverFeaturedGames = [];

  // --- Tag-based picks (existing logic) ---
  function pickRandom(arr, n) {
    return arr.slice().sort(function() { return Math.random() - 0.5; }).slice(0, n);
  }
  var jackpots = games.filter(function(g) { return (g.tag||'').toLowerCase() === 'jackpot'; });
  var hots     = games.filter(function(g) { return (g.tag||'').toLowerCase() === 'hot'; });
  var news     = games.filter(function(g) { return (g.tag||'').toLowerCase() === 'new'; });
  var pops     = games.filter(function(g) { return (g.tag||'').toLowerCase() === 'popular'; });

  var tagPicks = pickRandom(jackpots, 2)
    .concat(pickRandom(hots, 3))
    .concat(pickRandom(news, 2))
    .concat(pickRandom(pops, 2));

  // --- Merge: server-featured first, then tag picks (deduplicated), cap at 9 ---
  var seenIds = {};
  var featured = [];
  serverFeaturedGames.forEach(function(g) {
    if (!seenIds[g.id] && featured.length < 9) {
      seenIds[g.id] = true;
      featured.push({ game: g, source: 'server' });
    }
  });
  tagPicks.forEach(function(g) {
    if (!seenIds[g.id] && featured.length < 9) {
      seenIds[g.id] = true;
      featured.push({ game: g, source: 'tag' });
    }
  });

  if (!featured.length) return;

  featured.forEach(function(entry) {
    var game = entry.game;
    var tag = (game.tag || '').toLowerCase();
    var badgeClass, badgeLabel;

    if (entry.source === 'server') {
      badgeClass = 'featured-badge-featured';
      badgeLabel = '\u2B50 FEATURED';
    } else if (tag === 'jackpot') {
      badgeClass = 'featured-badge-jackpot';
      badgeLabel = '\uD83D\uDCB0 JACKPOT';
    } else if (tag === 'hot') {
      badgeClass = 'featured-badge-hot';
      badgeLabel = '\uD83D\uDD25 HOT';
    } else if (tag === 'new') {
      badgeClass = 'featured-badge-new';
      badgeLabel = '\u2728 NEW';
    } else {
      badgeClass = 'featured-badge-popular';
      badgeLabel = '\uD83E\uDD1D POPULAR';
    }

    var card = document.createElement('div');
    card.className = 'featured-card';
    card.style.backgroundImage = 'url(\'assets/thumbnails/' + game.id + '.webp\')';
    card.setAttribute('data-game-id', game.id);
    card.title = game.name;

    var overlay = document.createElement('div');
    overlay.className = 'featured-card-overlay';

    var badge = document.createElement('div');
    badge.className = 'featured-card-badge ' + badgeClass;
    badge.textContent = badgeLabel;

    var playDiv = document.createElement('div');
    playDiv.className = 'featured-card-play';
    var circle = document.createElement('div');
    circle.className = 'featured-play-circle';
    var svg = document.createElementNS('http://www.w3.org/2000/svg','svg');
    svg.setAttribute('viewBox','0 0 24 24');
    var poly = document.createElementNS('http://www.w3.org/2000/svg','polygon');
    poly.setAttribute('points','5,3 19,12 5,21');
    svg.appendChild(poly);
    circle.appendChild(svg);
    playDiv.appendChild(circle);

    var nameEl = document.createElement('div');
    nameEl.className = 'featured-card-name';
    nameEl.textContent = game.name;

    var provEl = document.createElement('div');
    provEl.className = 'featured-card-provider';
    provEl.textContent = game.provider || '';

    card.appendChild(overlay);
    card.appendChild(badge);
    card.appendChild(playDiv);
    card.appendChild(nameEl);
    card.appendChild(provEl);
    card.onclick = function() {
      if (typeof openSlot === 'function') openSlot(game.id);
    };
    container.appendChild(card);
  });
}

/* ─ END LOBBY VISUAL OVERHAUL ─ */

/* ═══════════════════════════════════════════════════════════════
   LAZY THUMBNAIL LOADER — 2026-02-27
   Uses IntersectionObserver to defer loading game thumbnails until
   they are about to scroll into view, preventing all ~120 HD images
   (~20 MB WebP / ~150 MB PNG) from being fetched simultaneously.
   ═══════════════════════════════════════════════════════════════ */

(function() {
  'use strict';

  var _thumbObserver = null;

  function _initLazyThumbnails() {
    if (!('IntersectionObserver' in window)) {
      // Fallback: apply all immediately for browsers without IO support.
      document.querySelectorAll('.game-thumbnail[data-bg], .game-card-art[data-bg]').forEach(function(el) {
        _applyBg(el);
      });
      return;
    }
    if (!_thumbObserver) {
      _thumbObserver = new IntersectionObserver(function(entries) {
        entries.forEach(function(entry) {
          if (entry.isIntersecting) {
            _applyBg(entry.target);
            _thumbObserver.unobserve(entry.target);
          }
        });
      }, { rootMargin: '600px 0px', threshold: 0 });
    }
    document.querySelectorAll('.game-thumbnail[data-bg], .game-card-art[data-bg]').forEach(function(el) {
      _thumbObserver.observe(el);
    });
  }

  /** Apply background image, preferring WebP over PNG for smaller file sizes.
   *  Always sets background-image on the container as primary display method.
   *  Also sets img.src when an <img> exists for accessibility / SEO. */
  function _applyBg(el) {
    var src = el.getAttribute('data-bg');
    if (!src) return;
    el.removeAttribute('data-bg');
    var webpSrc = src.replace(/\.png$/, '.webp');
    // Always set background-image on the container — this is the reliable display path
    el.style.backgroundSize     = 'cover';
    el.style.backgroundPosition = 'center';
    if (webpSrc !== src) {
      var probe = new Image();
      probe.onload  = function() { el.style.setProperty('background-image', 'url(\'' + webpSrc + '\')', 'important'); };
      probe.onerror = function() { el.style.setProperty('background-image', 'url(\'' + src + '\')', 'important'); };
      probe.src = webpSrc;
    } else {
      el.style.setProperty('background-image', 'url(\'' + src + '\')', 'important');
    }
  }

  window._initLazyThumbnails = _initLazyThumbnails;
})();

/* ── Sprint 82: Daily Win Goal bar ── */
(function() {
    var _DG_KEY = typeof STORAGE_KEY_DAILY_GOAL !== 'undefined' ? STORAGE_KEY_DAILY_GOAL : 'royalSlotsDailyGoal';
    var _DG_DEFAULT = 100;

    function _today() { return new Date().toISOString().slice(0, 10); }

    function _loadDG() {
        try {
            var raw = localStorage.getItem(_DG_KEY);
            var s = raw ? JSON.parse(raw) : null;
            if (!s || s.date !== _today()) return { date: _today(), goal: _DG_DEFAULT, won: 0 };
            return s;
        } catch(e) { return { date: _today(), goal: _DG_DEFAULT, won: 0 }; }
    }

    function _saveDG(s) {
        try { localStorage.setItem(_DG_KEY, JSON.stringify(s)); } catch(e) {}
    }

    function renderDailyGoalBar() {
        var bar = document.getElementById('dailyGoalBar');
        var fill = document.getElementById('dgbFill');
        var prog = document.getElementById('dgbProgress');
        if (!bar || !fill || !prog) return;
        var s = _loadDG();
        if (!s.goal) { bar.style.display = 'none'; return; }
        bar.style.display = 'flex';
        var pct = Math.min(100, (s.won / s.goal) * 100);
        fill.style.width = pct + '%';
        var reached = s.won >= s.goal;
        fill.classList.toggle('dgb-done', reached);
        if (reached) {
            prog.textContent = '🎉 Goal!';
            prog.className = 'dgb-progress dgb-reached';
        } else {
            prog.textContent = '$' + Math.round(s.won) + ' / $' + Math.round(s.goal);
            prog.className = 'dgb-progress';
        }
    }

    function openDailyGoalEdit() {
        var s = _loadDG();
        var input = prompt('Set your daily win goal ($):', s.goal);
        if (input === null) return;
        var val = parseFloat(input);
        if (!isNaN(val) && val > 0) {
            s.goal = Math.round(val);
            _saveDG(s);
            renderDailyGoalBar();
        }
    }

    function recordGoalWin(amount) {
        if (!amount || amount <= 0) return;
        var s = _loadDG();
        s.won += amount;
        _saveDG(s);
        renderDailyGoalBar();
    }

    window.renderDailyGoalBar = renderDailyGoalBar;
    window.openDailyGoalEdit  = openDailyGoalEdit;
    window.recordGoalWin      = recordGoalWin;

    // Hook into renderGames chain
    (function() {
        var _prevRG82 = typeof renderGames === 'function' ? renderGames : null;
        if (!_prevRG82) return;
        renderGames = function() {
            _prevRG82.apply(this, arguments);
            if (typeof renderDailyGoalBar === 'function') renderDailyGoalBar();
        };
    })();

    // Initial render
    renderDailyGoalBar();
})();


// ── Big Win Feed ─────────────────────────────────
function loadBigWinFeed() {
    fetch('/api/big-wins')
        .then(function(r) { return r.json(); })
        .then(function(data) {
            var feed = document.getElementById('bigWinFeed');
            var scroll = document.getElementById('bigWinScroll');
            if (!feed || !scroll || !data.wins || data.wins.length === 0) return;
            feed.style.display = '';
            scroll.textContent = '';
            data.wins.forEach(function(w) {
                var gameName = w.gameId;
                if (typeof GAMES !== 'undefined') {
                    var g = GAMES.find(function(gg) { return gg.id === w.gameId; });
                    if (g) gameName = g.name;
                }
                var ago = _timeAgo(w.time);
                var item = document.createElement('div');
                item.className = 'bwf-item';
                var playerSpan = document.createElement('span');
                playerSpan.className = 'bwf-player';
                playerSpan.textContent = w.player || '';
                var amountSpan = document.createElement('span');
                amountSpan.className = 'bwf-amount';
                amountSpan.textContent = '$' + Number(w.amount).toFixed(0);
                var gameSpan = document.createElement('span');
                gameSpan.className = 'bwf-game';
                gameSpan.textContent = gameName;
                var timeSpan = document.createElement('span');
                timeSpan.className = 'bwf-time';
                timeSpan.textContent = ago;
                item.appendChild(playerSpan);
                item.appendChild(document.createTextNode(' won '));
                item.appendChild(amountSpan);
                item.appendChild(document.createTextNode(' on '));
                item.appendChild(gameSpan);
                item.appendChild(document.createTextNode(' '));
                item.appendChild(timeSpan);
                scroll.appendChild(item);
            });
        })
        .catch(function() {});
}

function _escHtml(s) {
    var d = document.createElement('div');
    d.textContent = s || '';
    return d.innerHTML;
}

function _timeAgo(dateStr) {
    if (!dateStr) return '';
    var diff = (Date.now() - new Date(dateStr).getTime()) / 1000;
    if (diff < 60) return 'just now';
    if (diff < 3600) return Math.floor(diff / 60) + 'm ago';
    if (diff < 86400) return Math.floor(diff / 3600) + 'h ago';
    return Math.floor(diff / 86400) + 'd ago';
}

// ── Achievement Toast ─────────────────────────────────
function showAchievementToast(achievement) {
    var toast = document.getElementById('achievementToast');
    var icon = document.getElementById('achieveIcon');
    var title = document.getElementById('achieveTitle');
    var desc = document.getElementById('achieveDesc');
    if (!toast) return;
    if (icon) icon.textContent = achievement.icon || '';
    if (title) title.textContent = 'Achievement Unlocked: ' + (achievement.name || '');
    if (desc) desc.textContent = (achievement.desc || '') + (achievement.xp ? ' (+' + achievement.xp + ' XP)' : '');
    toast.style.display = 'flex';
    toast.classList.add('achievement-show');
    setTimeout(function() {
        toast.classList.remove('achievement-show');
        setTimeout(function() { toast.style.display = 'none'; }, 400);
    }, 4000);
}

// ── Personalized Offers ─────────────────────────────────
function loadPersonalizedOffers() {
    var token = localStorage.getItem(typeof STORAGE_KEY_TOKEN !== 'undefined' ? STORAGE_KEY_TOKEN : 'casinoToken');
    if (!token) return;
    fetch('/api/offers', { headers: { 'Authorization': 'Bearer ' + token } })
        .then(function(r) { return r.json(); })
        .then(function(data) {
            var banner = document.getElementById('offersBanner');
            if (!banner || !data.offers || data.offers.length === 0) {
                if (banner) banner.style.display = 'none';
                return;
            }
            banner.style.display = '';
            banner.textContent = '';
            data.offers.forEach(function(o) {
                var card = document.createElement('div');
                card.className = 'offer-card offer-' + (o.type || 'default');
                var titleEl = document.createElement('div');
                titleEl.className = 'offer-title';
                titleEl.textContent = o.title || '';
                var msgEl = document.createElement('div');
                msgEl.className = 'offer-msg';
                msgEl.textContent = o.message || '';
                var ctaEl = document.createElement('button');
                ctaEl.className = 'offer-cta';
                ctaEl.textContent = o.cta || 'Claim';
                ctaEl.addEventListener('click', function() {
                    document.getElementById('offersBanner').style.display = 'none';
                });
                card.appendChild(titleEl);
                card.appendChild(msgEl);
                card.appendChild(ctaEl);
                banner.appendChild(card);
            });
        })
        .catch(function() {});
}

// ── Bundle Shop ─────────────────────────────────
function openBundleShop() {
    var modal = document.getElementById('bundleShopModal');
    if (!modal) return;
    modal.classList.add('active');
    loadBundleList();
}

function closeBundleShop() {
    var modal = document.getElementById('bundleShopModal');
    if (modal) modal.classList.remove('active');
}

function loadBundleList() {
    fetch('/api/bundles')
        .then(function(r) { return r.json(); })
        .then(function(data) {
            var grid = document.getElementById('bundleGrid');
            if (!grid || !data.bundles) return;
            // Clear existing
            while (grid.firstChild) grid.removeChild(grid.firstChild);

            data.bundles.forEach(function(b) {
                var card = document.createElement('div');
                card.className = 'bundle-card' + (b.id === 'whale' ? ' bundle-whale' : b.id === 'diamond' ? ' bundle-diamond' : '');

                var badge = document.createElement('div');
                badge.className = 'bundle-badge';
                badge.textContent = b.badge || '';

                var name = document.createElement('div');
                name.className = 'bundle-name';
                name.textContent = b.name;

                var price = document.createElement('div');
                price.className = 'bundle-price';
                price.textContent = '$' + b.price.toFixed(2);

                var credits = document.createElement('div');
                credits.className = 'bundle-credits';
                credits.textContent = '$' + b.credits + ' + $' + b.bonusCredits + ' bonus';

                var total = document.createElement('div');
                total.className = 'bundle-total';
                total.textContent = '$' + b.totalCredits + ' total value';

                var value = document.createElement('div');
                value.className = 'bundle-value';
                value.textContent = b.valuePerDollar + 'x value per dollar';

                var btn = document.createElement('button');
                btn.className = 'bundle-buy-btn';
                btn.textContent = 'Buy Now';
                btn.setAttribute('data-bundle-id', b.id);
                btn.onclick = function() { purchaseBundle(b.id); };

                card.appendChild(badge);
                card.appendChild(name);
                card.appendChild(price);
                card.appendChild(credits);
                card.appendChild(total);
                card.appendChild(value);
                card.appendChild(btn);
                grid.appendChild(card);
            });
        })
        .catch(function() {});
}

function purchaseBundle(bundleId) {
    var token = localStorage.getItem(typeof STORAGE_KEY_TOKEN !== 'undefined' ? STORAGE_KEY_TOKEN : 'casinoToken');
    if (!token) {
        if (typeof showToast === 'function') showToast('Login required to purchase bundles', 'error');
        return;
    }
    fetch('/api/bundles/purchase', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
        body: JSON.stringify({ bundleId: bundleId })
    })
    .then(function(r) { return r.json(); })
    .then(function(data) {
        if (data.error) {
            if (typeof showToast === 'function') showToast(data.error, 'error');
            return;
        }
        if (typeof showToast === 'function') {
            showToast('Purchased ' + data.bundleName + '! +$' + data.totalAdded + ' credits', 'success');
        }
        if (data.newBalance !== undefined) {
            balance = data.newBalance;
            if (typeof updateBalance === 'function') updateBalance();
        }
        closeBundleShop();
    })
    .catch(function() {
        if (typeof showToast === 'function') showToast('Purchase failed', 'error');
    });
}

// ── Campaign Banners ─────────────────────────────────
function loadCampaignBanners() {
    var token = localStorage.getItem(typeof STORAGE_KEY_TOKEN !== 'undefined' ? STORAGE_KEY_TOKEN : 'casinoToken');
    if (!token) return;
    fetch('/api/campaigns', { headers: { 'Authorization': 'Bearer ' + token } })
        .then(function(r) { return r.json(); })
        .then(function(data) {
            var area = document.getElementById('campaignBannerArea');
            if (!area || !data.campaigns || data.campaigns.length === 0) return;
            area.style.display = '';
            while (area.firstChild) area.removeChild(area.firstChild);

            data.campaigns.forEach(function(c) {
                if (c.claimed) return; // skip already claimed
                var banner = document.createElement('div');
                banner.className = 'campaign-banner';

                var title = document.createElement('div');
                title.className = 'cb-title';
                title.textContent = c.name;

                var detail = document.createElement('div');
                detail.className = 'cb-detail';
                detail.textContent = c.bonusPct + '% deposit match up to $' + c.maxBonus + ' (min $' + c.minDeposit + ')';

                var timer = document.createElement('div');
                timer.className = 'cb-timer';
                var endDate = new Date(c.endAt);
                var hoursLeft = Math.max(0, Math.round((endDate - Date.now()) / 3600000));
                timer.textContent = hoursLeft > 24 ? Math.floor(hoursLeft / 24) + 'd left' : hoursLeft + 'h left';

                var cta = document.createElement('button');
                cta.className = 'cb-cta';
                cta.textContent = 'Deposit Now';
                cta.onclick = function() {
                    if (typeof openWalletModal === 'function') openWalletModal();
                    else if (typeof showToast === 'function') showToast('Open Wallet to deposit', 'info');
                };

                banner.appendChild(title);
                banner.appendChild(detail);
                banner.appendChild(timer);
                banner.appendChild(cta);
                area.appendChild(banner);
            });
        })
        .catch(function() {});
}

// ── Social Gifting ─────────────────────────────────
var _giftActiveTab = 'send';

function openGiftModal() {
    var modal = document.getElementById('giftModal');
    if (!modal) return;
    modal.classList.add('active');
    _giftActiveTab = 'send';
    _renderGiftTabs();
    _renderGiftSendForm();
}

function closeGiftModal() {
    var modal = document.getElementById('giftModal');
    if (modal) modal.classList.remove('active');
}

function _renderGiftTabs() {
    var tabsEl = document.getElementById('giftTabs');
    if (!tabsEl) return;
    while (tabsEl.firstChild) tabsEl.removeChild(tabsEl.firstChild);

    var tabs = [
        { id: 'send', label: 'Send Gift' },
        { id: 'pending', label: 'Pending' },
        { id: 'history', label: 'History' }
    ];

    tabs.forEach(function(tab) {
        var btn = document.createElement('button');
        btn.className = 'gift-tab-btn' + (_giftActiveTab === tab.id ? ' active' : '');
        btn.textContent = tab.label;
        btn.addEventListener('click', function() {
            _giftActiveTab = tab.id;
            _renderGiftTabs();
            if (tab.id === 'send') _renderGiftSendForm();
            else if (tab.id === 'pending') loadPendingGifts();
            else if (tab.id === 'history') loadGiftHistory();
        });
        tabsEl.appendChild(btn);
    });
}

function _renderGiftSendForm() {
    var body = document.getElementById('giftModalBody');
    if (!body) return;
    while (body.firstChild) body.removeChild(body.firstChild);

    var form = document.createElement('div');
    form.className = 'gift-form';

    var recipLabel = document.createElement('label');
    recipLabel.textContent = 'Recipient Username';
    recipLabel.className = 'gift-label';
    var recipInput = document.createElement('input');
    recipInput.type = 'text';
    recipInput.id = 'giftRecipient';
    recipInput.className = 'gift-input';
    recipInput.placeholder = 'Enter username...';

    var amountLabel = document.createElement('label');
    amountLabel.textContent = 'Amount: $50';
    amountLabel.className = 'gift-label';
    amountLabel.id = 'giftAmountLabel';
    var amountSlider = document.createElement('input');
    amountSlider.type = 'range';
    amountSlider.id = 'giftAmount';
    amountSlider.className = 'gift-slider';
    amountSlider.min = '10';
    amountSlider.max = '200';
    amountSlider.value = '50';
    amountSlider.step = '10';
    amountSlider.addEventListener('input', function() {
        var label = document.getElementById('giftAmountLabel');
        if (label) label.textContent = 'Amount: $' + amountSlider.value;
    });

    var msgLabel = document.createElement('label');
    msgLabel.textContent = 'Message (optional)';
    msgLabel.className = 'gift-label';
    var msgInput = document.createElement('textarea');
    msgInput.id = 'giftMessage';
    msgInput.className = 'gift-textarea';
    msgInput.placeholder = 'Add a note...';
    msgInput.rows = 2;

    var sendBtn = document.createElement('button');
    sendBtn.className = 'gift-send-btn';
    sendBtn.textContent = 'Send Gift';
    sendBtn.addEventListener('click', function() { sendGift(); });

    form.appendChild(recipLabel);
    form.appendChild(recipInput);
    form.appendChild(amountLabel);
    form.appendChild(amountSlider);
    form.appendChild(msgLabel);
    form.appendChild(msgInput);
    form.appendChild(sendBtn);
    body.appendChild(form);
}

function sendGift() {
    var token = localStorage.getItem(typeof STORAGE_KEY_TOKEN !== 'undefined' ? STORAGE_KEY_TOKEN : 'casinoToken');
    if (!token) {
        if (typeof showToast === 'function') showToast('Login required to send gifts', 'error');
        return;
    }
    var recipient = (document.getElementById('giftRecipient') || {}).value || '';
    var amount = parseInt((document.getElementById('giftAmount') || {}).value || '50', 10);
    var message = (document.getElementById('giftMessage') || {}).value || '';

    if (!recipient.trim()) {
        if (typeof showToast === 'function') showToast('Enter a recipient username', 'error');
        return;
    }

    fetch('/api/gifts/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
        body: JSON.stringify({ recipientUsername: recipient.trim(), amount: amount, message: message })
    })
    .then(function(r) { return r.json(); })
    .then(function(data) {
        if (data.error) {
            if (typeof showToast === 'function') showToast(data.error, 'error');
            return;
        }
        if (typeof showToast === 'function') showToast('Gift of $' + amount + ' sent to ' + recipient + '!', 'success');
        if (data.newBalance !== undefined) {
            balance = data.newBalance;
            if (typeof updateBalance === 'function') updateBalance();
        }
        var recipEl = document.getElementById('giftRecipient');
        if (recipEl) recipEl.value = '';
        var msgEl = document.getElementById('giftMessage');
        if (msgEl) msgEl.value = '';
    })
    .catch(function() {
        if (typeof showToast === 'function') showToast('Failed to send gift', 'error');
    });
}

function loadPendingGifts() {
    var token = localStorage.getItem(typeof STORAGE_KEY_TOKEN !== 'undefined' ? STORAGE_KEY_TOKEN : 'casinoToken');
    if (!token) return;
    var body = document.getElementById('giftModalBody');
    if (!body) return;
    while (body.firstChild) body.removeChild(body.firstChild);

    var loading = document.createElement('div');
    loading.className = 'gift-loading';
    loading.textContent = 'Loading pending gifts...';
    body.appendChild(loading);

    fetch('/api/gifts/pending', { headers: { 'Authorization': 'Bearer ' + token } })
        .then(function(r) { return r.json(); })
        .then(function(data) {
            while (body.firstChild) body.removeChild(body.firstChild);
            var gifts = data.gifts || [];
            if (gifts.length === 0) {
                var empty = document.createElement('div');
                empty.className = 'gift-empty';
                empty.textContent = 'No pending gifts';
                body.appendChild(empty);
                return;
            }
            gifts.forEach(function(g) {
                var card = document.createElement('div');
                card.className = 'gift-card';

                var from = document.createElement('div');
                from.className = 'gift-card-from';
                from.textContent = 'From: ' + (g.senderUsername || 'Unknown');

                var amt = document.createElement('div');
                amt.className = 'gift-card-amount';
                amt.textContent = '$' + (g.amount || 0);

                var msg = document.createElement('div');
                msg.className = 'gift-card-message';
                msg.textContent = g.message || '';

                var claimBtn = document.createElement('button');
                claimBtn.className = 'gift-claim-btn';
                claimBtn.textContent = 'Claim';
                claimBtn.addEventListener('click', function() { claimGift(g.id); });

                card.appendChild(from);
                card.appendChild(amt);
                if (g.message) card.appendChild(msg);
                card.appendChild(claimBtn);
                body.appendChild(card);
            });
        })
        .catch(function() {
            while (body.firstChild) body.removeChild(body.firstChild);
            var err = document.createElement('div');
            err.className = 'gift-empty';
            err.textContent = 'Failed to load gifts';
            body.appendChild(err);
        });
}

function claimGift(giftId) {
    var token = localStorage.getItem(typeof STORAGE_KEY_TOKEN !== 'undefined' ? STORAGE_KEY_TOKEN : 'casinoToken');
    if (!token) return;
    fetch('/api/gifts/' + giftId + '/claim', {
        method: 'POST',
        headers: { 'Authorization': 'Bearer ' + token }
    })
    .then(function(r) { return r.json(); })
    .then(function(data) {
        if (data.error) {
            if (typeof showToast === 'function') showToast(data.error, 'error');
            return;
        }
        if (typeof showToast === 'function') showToast('Gift claimed! +$' + (data.amount || 0), 'success');
        if (data.newBalance !== undefined) {
            balance = data.newBalance;
            if (typeof updateBalance === 'function') updateBalance();
        }
        loadPendingGifts();
    })
    .catch(function() {
        if (typeof showToast === 'function') showToast('Failed to claim gift', 'error');
    });
}

function loadGiftHistory() {
    var token = localStorage.getItem(typeof STORAGE_KEY_TOKEN !== 'undefined' ? STORAGE_KEY_TOKEN : 'casinoToken');
    if (!token) return;
    var body = document.getElementById('giftModalBody');
    if (!body) return;
    while (body.firstChild) body.removeChild(body.firstChild);

    var loading = document.createElement('div');
    loading.className = 'gift-loading';
    loading.textContent = 'Loading gift history...';
    body.appendChild(loading);

    fetch('/api/gifts/history', { headers: { 'Authorization': 'Bearer ' + token } })
        .then(function(r) { return r.json(); })
        .then(function(data) {
            while (body.firstChild) body.removeChild(body.firstChild);
            var gifts = data.gifts || [];
            if (gifts.length === 0) {
                var empty = document.createElement('div');
                empty.className = 'gift-empty';
                empty.textContent = 'No gift history yet';
                body.appendChild(empty);
                return;
            }
            gifts.forEach(function(g) {
                var row = document.createElement('div');
                row.className = 'gift-history-row';

                var dir = document.createElement('span');
                dir.className = 'gift-dir ' + (g.direction === 'sent' ? 'gift-sent' : 'gift-received');
                dir.textContent = g.direction === 'sent' ? 'Sent' : 'Received';

                var user = document.createElement('span');
                user.className = 'gift-history-user';
                user.textContent = g.direction === 'sent'
                    ? 'to ' + (g.recipientUsername || '?')
                    : 'from ' + (g.senderUsername || '?');

                var amt = document.createElement('span');
                amt.className = 'gift-history-amount';
                amt.textContent = '$' + (g.amount || 0);

                var date = document.createElement('span');
                date.className = 'gift-history-date';
                date.textContent = g.createdAt ? new Date(g.createdAt).toLocaleDateString() : '';

                row.appendChild(dir);
                row.appendChild(user);
                row.appendChild(amt);
                row.appendChild(date);
                body.appendChild(row);
            });
        })
        .catch(function() {
            while (body.firstChild) body.removeChild(body.firstChild);
            var err = document.createElement('div');
            err.className = 'gift-empty';
            err.textContent = 'Failed to load history';
            body.appendChild(err);
        });
}

// ── Contest Leaderboard ─────────────────────────────────
var _contestActiveTab = 'leaderboard';
var _contestMetric = 'spins';

function openContestModal() {
    var modal = document.getElementById('contestModal');
    if (!modal) return;
    modal.classList.add('active');
    _contestActiveTab = 'leaderboard';
    _contestMetric = 'spins';
    _renderContestTabs();
    loadContestLeaderboard('spins');
}

function closeContestModal() {
    var modal = document.getElementById('contestModal');
    if (modal) modal.classList.remove('active');
}

function _renderContestTabs() {
    var tabsEl = document.getElementById('contestTabs');
    if (!tabsEl) return;
    while (tabsEl.firstChild) tabsEl.removeChild(tabsEl.firstChild);

    var tabs = [
        { id: 'leaderboard', label: 'Leaderboard' },
        { id: 'prizes', label: 'My Prizes' }
    ];

    tabs.forEach(function(tab) {
        var btn = document.createElement('button');
        btn.className = 'contest-tab-btn' + (_contestActiveTab === tab.id ? ' active' : '');
        btn.textContent = tab.label;
        btn.addEventListener('click', function() {
            _contestActiveTab = tab.id;
            _renderContestTabs();
            if (tab.id === 'leaderboard') loadContestLeaderboard(_contestMetric);
            else if (tab.id === 'prizes') loadContestPrizes();
        });
        tabsEl.appendChild(btn);
    });
}

function loadContestLeaderboard(metric) {
    _contestMetric = metric || 'spins';
    var token = localStorage.getItem(typeof STORAGE_KEY_TOKEN !== 'undefined' ? STORAGE_KEY_TOKEN : 'casinoToken');
    var body = document.getElementById('contestModalBody');
    if (!body) return;
    while (body.firstChild) body.removeChild(body.firstChild);

    // Metric filter buttons
    var filterRow = document.createElement('div');
    filterRow.className = 'contest-metric-row';
    var metrics = [
        { id: 'spins', label: 'Spins' },
        { id: 'biggest_win', label: 'Biggest Win' },
        { id: 'total_wagered', label: 'Total Wagered' }
    ];
    metrics.forEach(function(m) {
        var btn = document.createElement('button');
        btn.className = 'contest-metric-btn' + (_contestMetric === m.id ? ' active' : '');
        btn.textContent = m.label;
        btn.addEventListener('click', function() { loadContestLeaderboard(m.id); });
        filterRow.appendChild(btn);
    });
    body.appendChild(filterRow);

    var loading = document.createElement('div');
    loading.className = 'contest-loading';
    loading.textContent = 'Loading leaderboard...';
    body.appendChild(loading);

    var headers = { };
    if (token) headers['Authorization'] = 'Bearer ' + token;
    fetch('/api/contests/leaderboard?metric=' + _contestMetric, { headers: headers })
        .then(function(r) { return r.json(); })
        .then(function(data) {
            // Remove loading indicator
            if (loading.parentNode) loading.parentNode.removeChild(loading);

            var entries = data.leaderboard || [];
            var currentUsername = (typeof currentUser !== 'undefined' && currentUser) ? currentUser.username : null;

            if (entries.length === 0) {
                var empty = document.createElement('div');
                empty.className = 'contest-empty';
                empty.textContent = 'No contest data yet. Start playing!';
                body.appendChild(empty);
                return;
            }

            var table = document.createElement('table');
            table.className = 'leaderboard-table';

            var thead = document.createElement('thead');
            var headRow = document.createElement('tr');
            var thRank = document.createElement('th');
            thRank.textContent = '#';
            var thPlayer = document.createElement('th');
            thPlayer.textContent = 'Player';
            var thValue = document.createElement('th');
            thValue.textContent = _contestMetric === 'spins' ? 'Spins' :
                _contestMetric === 'biggest_win' ? 'Biggest Win' : 'Total Wagered';
            headRow.appendChild(thRank);
            headRow.appendChild(thPlayer);
            headRow.appendChild(thValue);
            thead.appendChild(headRow);
            table.appendChild(thead);

            var tbody = document.createElement('tbody');
            entries.forEach(function(entry, idx) {
                var tr = document.createElement('tr');
                var isMe = currentUsername && entry.username === currentUsername;
                if (isMe) tr.className = 'leaderboard-me';

                var tdRank = document.createElement('td');
                var rank = idx + 1;
                if (rank === 1) tdRank.textContent = '\uD83E\uDD47';
                else if (rank === 2) tdRank.textContent = '\uD83E\uDD48';
                else if (rank === 3) tdRank.textContent = '\uD83E\uDD49';
                else tdRank.textContent = String(rank);
                tdRank.className = 'lb-rank';

                var tdName = document.createElement('td');
                tdName.textContent = entry.username || 'Anonymous';
                if (isMe) tdName.textContent += ' (You)';

                var tdVal = document.createElement('td');
                var val = entry.value || 0;
                if (_contestMetric === 'spins') {
                    tdVal.textContent = val.toLocaleString();
                } else {
                    tdVal.textContent = '$' + val.toLocaleString();
                }

                tr.appendChild(tdRank);
                tr.appendChild(tdName);
                tr.appendChild(tdVal);
                tbody.appendChild(tr);
            });
            table.appendChild(tbody);
            body.appendChild(table);
        })
        .catch(function() {
            if (loading.parentNode) loading.parentNode.removeChild(loading);
            var err = document.createElement('div');
            err.className = 'contest-empty';
            err.textContent = 'Failed to load leaderboard';
            body.appendChild(err);
        });
}

function loadContestPrizes() {
    var token = localStorage.getItem(typeof STORAGE_KEY_TOKEN !== 'undefined' ? STORAGE_KEY_TOKEN : 'casinoToken');
    if (!token) {
        if (typeof showToast === 'function') showToast('Login required', 'error');
        return;
    }
    var body = document.getElementById('contestModalBody');
    if (!body) return;
    while (body.firstChild) body.removeChild(body.firstChild);

    var loading = document.createElement('div');
    loading.className = 'contest-loading';
    loading.textContent = 'Loading prizes...';
    body.appendChild(loading);

    fetch('/api/contests/prizes', { headers: { 'Authorization': 'Bearer ' + token } })
        .then(function(r) { return r.json(); })
        .then(function(data) {
            while (body.firstChild) body.removeChild(body.firstChild);
            var prizes = data.prizes || [];
            if (prizes.length === 0) {
                var empty = document.createElement('div');
                empty.className = 'contest-empty';
                empty.textContent = 'No prizes to claim. Keep playing to win!';
                body.appendChild(empty);
                return;
            }
            prizes.forEach(function(p) {
                var card = document.createElement('div');
                card.className = 'prize-card' + (p.claimed ? ' prize-claimed' : '');

                var title = document.createElement('div');
                title.className = 'prize-title';
                title.textContent = p.title || ('Rank #' + (p.rank || '?'));

                var amount = document.createElement('div');
                amount.className = 'prize-amount';
                amount.textContent = '$' + (p.amount || 0);

                var contest = document.createElement('div');
                contest.className = 'prize-contest';
                contest.textContent = p.contestName || '';

                card.appendChild(title);
                card.appendChild(amount);
                card.appendChild(contest);

                if (!p.claimed) {
                    var claimBtn = document.createElement('button');
                    claimBtn.className = 'prize-claim-btn';
                    claimBtn.textContent = 'Claim Prize';
                    claimBtn.addEventListener('click', function() { claimContestPrize(p.id); });
                    card.appendChild(claimBtn);
                } else {
                    var badge = document.createElement('div');
                    badge.className = 'prize-claimed-badge';
                    badge.textContent = 'Claimed';
                    card.appendChild(badge);
                }
                body.appendChild(card);
            });
        })
        .catch(function() {
            while (body.firstChild) body.removeChild(body.firstChild);
            var err = document.createElement('div');
            err.className = 'contest-empty';
            err.textContent = 'Failed to load prizes';
            body.appendChild(err);
        });
}

function claimContestPrize(prizeId) {
    var token = localStorage.getItem(typeof STORAGE_KEY_TOKEN !== 'undefined' ? STORAGE_KEY_TOKEN : 'casinoToken');
    if (!token) return;
    fetch('/api/contests/prizes/' + prizeId + '/claim', {
        method: 'POST',
        headers: { 'Authorization': 'Bearer ' + token }
    })
    .then(function(r) { return r.json(); })
    .then(function(data) {
        if (data.error) {
            if (typeof showToast === 'function') showToast(data.error, 'error');
            return;
        }
        if (typeof showToast === 'function') showToast('Prize claimed! +$' + (data.amount || 0), 'success');
        if (data.newBalance !== undefined) {
            balance = data.newBalance;
            if (typeof updateBalance === 'function') updateBalance();
        }
        loadContestPrizes();
    })
    .catch(function() {
        if (typeof showToast === 'function') showToast('Failed to claim prize', 'error');
    });
}

// ── Active Events / Bonus Events ─────────────────────────────────
var _eventTimers = [];

function loadActiveEvents() {
    var token = localStorage.getItem(typeof STORAGE_KEY_TOKEN !== 'undefined' ? STORAGE_KEY_TOKEN : 'casinoToken');
    var headers = {};
    if (token) headers['Authorization'] = 'Bearer ' + token;

    // Clear any running countdown timers
    _eventTimers.forEach(function(t) { clearInterval(t); });
    _eventTimers = [];

    fetch('/api/events/active', { headers: headers })
        .then(function(r) { return r.json(); })
        .then(function(data) {
            var area = document.getElementById('campaignBannerArea');
            if (!area) return;
            var events = data.events || [];
            if (events.length === 0) return;
            area.style.display = '';

            events.forEach(function(ev) {
                var banner = document.createElement('div');
                banner.className = 'event-banner';

                var nameEl = document.createElement('div');
                nameEl.className = 'event-name';
                nameEl.textContent = ev.name || 'Bonus Event';

                var multiplierBadge = document.createElement('span');
                multiplierBadge.className = 'event-multiplier';
                multiplierBadge.textContent = (ev.multiplier || 1) + 'x';

                var timerEl = document.createElement('div');
                timerEl.className = 'event-timer';
                var endTime = new Date(ev.endAt).getTime();
                function updateTimer() {
                    var diff = Math.max(0, endTime - Date.now());
                    var h = Math.floor(diff / 3600000);
                    var m = Math.floor((diff % 3600000) / 60000);
                    var s = Math.floor((diff % 60000) / 1000);
                    timerEl.textContent = h + 'h ' + m + 'm ' + s + 's';
                    if (diff <= 0) timerEl.textContent = 'Ended';
                }
                updateTimer();
                var timer = setInterval(updateTimer, 1000);
                _eventTimers.push(timer);

                var gamesEl = document.createElement('div');
                gamesEl.className = 'event-games';
                if (ev.affectedGames && ev.affectedGames.length > 0) {
                    gamesEl.textContent = 'Games: ' + ev.affectedGames.join(', ');
                } else {
                    gamesEl.textContent = 'All games';
                }

                banner.appendChild(nameEl);
                banner.appendChild(multiplierBadge);
                banner.appendChild(timerEl);
                banner.appendChild(gamesEl);
                area.appendChild(banner);
            });
        })
        .catch(function() {});
}

// ── Challenges Bar (injected into lobby above game grid) ──────
//
// Creates a slim banner with id="challengesBar" that shows the
// current daily challenge completion count and a "View" button that
// opens openChallengesModal() from ui-challenges.js.
//
// The bar is injected once (idempotent) above #allGames.
// refreshChallengesWidget() (defined in ui-challenges.js) populates
// the count after the API responds; we call it here on first render.

function renderChallengesBar() {
    if (document.getElementById('challengesBar')) {
        // Already injected — just refresh the counts
        if (typeof window.refreshChallengesWidget === 'function') {
            window.refreshChallengesWidget();
        }
        return;
    }

    var allGames = document.getElementById('allGames');
    if (!allGames || !allGames.parentNode) return;

    var bar = document.createElement('div');
    bar.id                   = 'challengesBar';
    bar.style.background     = 'linear-gradient(135deg, #1a1a2e, #16213e)';
    bar.style.border         = '1px solid #334155';
    bar.style.borderRadius   = '8px';
    bar.style.padding        = '10px 16px';
    bar.style.marginBottom   = '12px';
    bar.style.cursor         = 'pointer';
    bar.style.display        = 'flex';
    bar.style.justifyContent = 'space-between';
    bar.style.alignItems     = 'center';
    bar.style.userSelect     = 'none';
    bar.style.transition     = 'border-color 0.2s, background 0.2s';
    bar.addEventListener('mouseover', function() {
        bar.style.borderColor = '#fbbf24';
        bar.style.background  = 'linear-gradient(135deg, #1f1f35, #1a2540)';
    });
    bar.addEventListener('mouseout', function() {
        bar.style.borderColor = '#334155';
        bar.style.background  = 'linear-gradient(135deg, #1a1a2e, #16213e)';
    });
    bar.addEventListener('click', function() {
        if (typeof window.openChallengesModal === 'function') {
            window.openChallengesModal();
        }
    });

    // Left side: icon + label + dot badge
    var left = document.createElement('div');
    left.style.display    = 'flex';
    left.style.alignItems = 'center';
    left.style.gap        = '8px';

    var icon = document.createElement('span');
    icon.style.fontSize = '16px';
    icon.textContent    = '\uD83C\uDFAF';

    var label = document.createElement('span');
    label.style.fontSize   = '13px';
    label.style.fontWeight = '600';
    label.style.color      = '#e2e8f0';
    label.textContent      = 'Daily Challenges';

    var dot = document.createElement('span');
    dot.id                  = 'challengesBarDot';
    dot.style.display       = 'none';
    dot.style.width         = '8px';
    dot.style.height        = '8px';
    dot.style.background    = '#10b981';
    dot.style.borderRadius  = '50%';
    dot.style.flexShrink    = '0';

    left.appendChild(icon);
    left.appendChild(label);
    left.appendChild(dot);

    // Right side: count + view button
    var right = document.createElement('div');
    right.style.display    = 'flex';
    right.style.alignItems = 'center';
    right.style.gap        = '12px';

    var countEl = document.createElement('span');
    countEl.id             = 'challengesBarCount';
    countEl.style.fontSize = '12px';
    countEl.style.color    = '#64748b';
    countEl.textContent    = '\u2014';   // placeholder until widget refreshes

    var viewBtn = document.createElement('span');
    viewBtn.style.fontSize      = '12px';
    viewBtn.style.fontWeight    = '700';
    viewBtn.style.color         = '#fbbf24';
    viewBtn.style.padding       = '3px 10px';
    viewBtn.style.border        = '1px solid rgba(251,191,36,0.4)';
    viewBtn.style.borderRadius  = '4px';
    viewBtn.style.whiteSpace    = 'nowrap';
    viewBtn.textContent         = 'View';

    right.appendChild(countEl);
    right.appendChild(viewBtn);

    bar.appendChild(left);
    bar.appendChild(right);

    allGames.parentNode.insertBefore(bar, allGames);

    // Populate count from API
    if (typeof window.refreshChallengesWidget === 'function') {
        window.refreshChallengesWidget();
    }
}

// Hook renderChallengesBar into the renderGames chain (idempotent)
(function() {
    var _prevRGChall = typeof renderGames === 'function' ? renderGames : null;
    if (!_prevRGChall) return;
    renderGames = function() {
        _prevRGChall.apply(this, arguments);
        renderChallengesBar();
    };
})();

// Expose for external callers
window.renderChallengesBar = renderChallengesBar;

// ── Loss Limit Display ─────────────────────────────────
function updateLossLimitDisplay(lossStatus) {
    var bar = document.getElementById('lossLimitBar');
    if (!bar) return;
    if (!lossStatus || !lossStatus.limit || lossStatus.limit <= 0) {
        bar.style.display = 'none';
        return;
    }
    bar.style.display = '';
    var remaining = document.getElementById('llRemaining');
    var fill = document.getElementById('llFill');
    if (remaining) remaining.textContent = '$' + Math.max(0, lossStatus.remaining || 0).toFixed(0) + ' left';
    if (fill) {
        var pct = lossStatus.limit > 0 ? Math.min(100, (lossStatus.dailyLoss / lossStatus.limit) * 100) : 0;
        fill.style.width = pct + '%';
        fill.className = 'll-fill' + (pct >= 90 ? ' ll-danger' : pct >= 70 ? ' ll-warn' : '');
    }
}


// ── Hot Game Highlight ──────────────────────────────────────────────────────
function _applyHotGameBadge(gameId) {
    if (!gameId) return;

    // Inject CSS once
    if (!document.getElementById('hot-game-css')) {
        var styleEl = document.createElement('style');
        styleEl.id = 'hot-game-css';
        styleEl.textContent = '.hot-game-badge { position:absolute; top:8px; right:8px; padding:3px 7px; border-radius:10px; background:linear-gradient(135deg,#ff5500,#ff9500); color:#fff; font-size:11px; font-weight:700; letter-spacing:.5px; z-index:10; pointer-events:none; } .game-card-hot-highlight { box-shadow:0 0 16px 4px rgba(255,80,0,0.6) !important; }';
        document.head.appendChild(styleEl);
    }

    // Remove any previous hot badge and glow from other cards
    var prevBadges = document.querySelectorAll('.hot-game-badge');
    for (var i = 0; i < prevBadges.length; i++) { prevBadges[i].parentNode && prevBadges[i].parentNode.removeChild(prevBadges[i]); }
    var prevGlow = document.querySelectorAll('.game-card-hot-highlight');
    for (var j = 0; j < prevGlow.length; j++) { prevGlow[j].classList.remove('game-card-hot-highlight'); }

    // Find the matching card
    var card = document.querySelector('[data-game-id="' + gameId.toLowerCase() + '"]');
    if (!card) return;

    // Add glow border
    card.classList.add('game-card-hot-highlight');

    // Add badge
    var badge = document.createElement('span');
    badge.className = 'hot-game-badge';
    badge.textContent = '\uD83D\uDD25 HOT';
    card.appendChild(badge);
}

function _startHotGameCountdown(gameId, expiresAt) {
    // Clear any previous countdown interval
    if (window._hotGameCountdownInterval) {
        clearInterval(window._hotGameCountdownInterval);
        window._hotGameCountdownInterval = null;
    }

    function _updateCountdown() {
        var card = document.querySelector('[data-game-id="' + gameId.toLowerCase() + '"]');
        if (!card) return;
        var countdownEl = card.querySelector('.hot-game-countdown');
        if (!countdownEl) return;
        var msLeft = new Date(expiresAt).getTime() - Date.now();
        if (msLeft <= 0) {
            countdownEl.textContent = '\uD83D\uDD25 Changes soon';
            clearInterval(window._hotGameCountdownInterval);
            window._hotGameCountdownInterval = null;
            return;
        }
        var totalSec = Math.floor(msLeft / 1000);
        var mm = Math.floor(totalSec / 60);
        var ss = totalSec % 60;
        var ssStr = ss < 10 ? '0' + ss : '' + ss;
        countdownEl.textContent = '\uD83D\uDD25 Changes in ' + mm + ':' + ssStr;
    }

    _updateCountdown();
    window._hotGameCountdownInterval = setInterval(_updateCountdown, 1000);
}

function _applyHotGameEnhancedBadge(gameId, expiresAt) {
    if (!gameId) return;

    // Remove previous enhanced badges and countdowns
    var prevBadges = document.querySelectorAll('.hot-game-enhanced-badge');
    for (var i = 0; i < prevBadges.length; i++) {
        prevBadges[i].parentNode && prevBadges[i].parentNode.removeChild(prevBadges[i]);
    }
    var prevCountdowns = document.querySelectorAll('.hot-game-countdown');
    for (var j = 0; j < prevCountdowns.length; j++) {
        prevCountdowns[j].parentNode && prevCountdowns[j].parentNode.removeChild(prevCountdowns[j]);
    }

    var card = document.querySelector('[data-game-id="' + gameId.toLowerCase() + '"]');
    if (!card) return;

    // Add enhanced RTP badge
    var rtpBadge = document.createElement('span');
    rtpBadge.className = 'hot-game-enhanced-badge';
    rtpBadge.textContent = '\uD83D\uDD25 HOT +20% RTP';
    card.appendChild(rtpBadge);

    // Add countdown element
    if (expiresAt) {
        var countdown = document.createElement('span');
        countdown.className = 'hot-game-countdown';
        countdown.textContent = '\uD83D\uDD25 Changes in ...';
        card.appendChild(countdown);
        _startHotGameCountdown(gameId, expiresAt);
    }
}

function initHotGameHighlight() {
    // Inject CSS once (covers both basic badge and enhanced badge/countdown)
    if (!document.getElementById('hot-game-css')) {
        var styleEl = document.createElement('style');
        styleEl.id = 'hot-game-css';
        styleEl.textContent = [
            '.hot-game-badge { position:absolute; top:8px; right:8px; padding:3px 7px;',
            '  border-radius:10px; background:linear-gradient(135deg,#ff5500,#ff9500);',
            '  color:#fff; font-size:11px; font-weight:700; letter-spacing:.5px;',
            '  z-index:10; pointer-events:none; }',
            '.game-card-hot-highlight { box-shadow:0 0 16px 4px rgba(255,80,0,0.6) !important; }',
            '.hot-game-enhanced-badge { position:absolute; top:8px; left:8px; padding:3px 8px;',
            '  border-radius:10px; background:linear-gradient(135deg,#ff2200,#ff7700);',
            '  color:#fff; font-size:11px; font-weight:800; letter-spacing:.4px;',
            '  z-index:11; pointer-events:none; white-space:nowrap; }',
            '.hot-game-countdown { position:absolute; bottom:8px; left:8px; padding:2px 7px;',
            '  border-radius:8px; background:rgba(0,0,0,0.65); color:#ffcc00;',
            '  font-size:10px; font-weight:700; letter-spacing:.3px;',
            '  z-index:11; pointer-events:none; white-space:nowrap; }'
        ].join(' ');
        document.head.appendChild(styleEl);
    }

    // If we already have cached data, just re-apply the badge (cards may have re-rendered)
    if (window._hotGameData && window._hotGameData.gameId) {
        _applyHotGameBadge(window._hotGameData.gameId);
        _applyHotGameEnhancedBadge(window._hotGameData.gameId, window._hotGameData.expiresAt);
        return;
    }

    // Fetch hot game from server (public, no auth)
    fetch('/api/hotgame/current')
        .then(function(res) { return res.ok ? res.json() : null; })
        .then(function(data) {
            if (!data || !data.gameId) return;
            window._hotGameData = data;
            _applyHotGameBadge(data.gameId);
            _applyHotGameEnhancedBadge(data.gameId, data.expiresAt);

            // Re-fetch when the hot game expires
            if (data.expiresAt) {
                var msUntilExpiry = new Date(data.expiresAt).getTime() - Date.now();
                var refetchDelay = msUntilExpiry > 0 ? msUntilExpiry + 1000 : 3600000;
                setTimeout(function() {
                    window._hotGameData = null;
                    initHotGameHighlight();
                }, refetchDelay);
            }
        })
        .catch(function() { /* silently ignore — endpoint may not exist */ });
}


// ── Game Stats HOT/COLD RTP Labels ──────────────────────────────────────────
function fetchAndApplyGameStats() {
    if (window._gameStatsApplied) return;

    // Inject CSS once
    if (!document.getElementById('game-stats-rtp-css')) {
        var style = document.createElement('style');
        style.id = 'game-stats-rtp-css';
        style.textContent = [
            '.rtp-hot-badge { position:absolute; bottom:8px; right:8px; padding:2px 7px;',
            '  border-radius:8px; background:linear-gradient(135deg,#00c853,#69f0ae);',
            '  color:#003300; font-size:10px; font-weight:800; letter-spacing:.3px;',
            '  z-index:10; pointer-events:none; white-space:nowrap; }',
            '.rtp-cold-badge { position:absolute; bottom:8px; right:8px; padding:2px 7px;',
            '  border-radius:8px; background:linear-gradient(135deg,#0288d1,#4fc3f7);',
            '  color:#001a33; font-size:10px; font-weight:800; letter-spacing:.3px;',
            '  z-index:10; pointer-events:none; white-space:nowrap; }'
        ].join(' ');
        document.head.appendChild(style);
    }

    fetch('/api/game-stats')
        .then(function(res) { return res.ok ? res.json() : null; })
        .then(function(data) {
            if (!data || !Array.isArray(data.stats)) return;

            // Build lookup map: gameId (lowercase) → { actualRtp, totalSpins }
            var rtpMap = {};
            for (var i = 0; i < data.stats.length; i++) {
                var entry = data.stats[i];
                if (entry && entry.gameId) {
                    rtpMap[entry.gameId.toLowerCase()] = { actualRtp: entry.actualRtp, totalSpins: entry.totalSpins };
                }
            }

            // Apply badges to all game cards in the DOM
            var cards = document.querySelectorAll('.game-card[data-game-id]');
            for (var k = 0; k < cards.length; k++) {
                var card = cards[k];
                var gid = card.getAttribute('data-game-id');
                if (!gid) continue;
                var stat = rtpMap[gid.toLowerCase()];
                if (!stat) continue;

                var rtp = stat.actualRtp;
                var spins = stat.totalSpins;

                // Remove any previous RTP badge on this card
                var prev = card.querySelector('.rtp-hot-badge, .rtp-cold-badge');
                if (prev) prev.parentNode && prev.parentNode.removeChild(prev);

                if (rtp >= 0.90) {
                    var hotBadge = document.createElement('span');
                    hotBadge.className = 'rtp-hot-badge';
                    hotBadge.textContent = '\uD83D\uDD25 HOT';
                    card.appendChild(hotBadge);
                } else if (rtp < 0.80 && spins >= 50) {
                    var coldBadge = document.createElement('span');
                    coldBadge.className = 'rtp-cold-badge';
                    coldBadge.textContent = '\u2744\uFE0F COLD';
                    card.appendChild(coldBadge);
                }
            }

            window._gameStatsApplied = true;
        })
        .catch(function() { /* silently ignore — endpoint may not have data yet */ });
}


// ── Loyalty Points Earn-per-spin Hook ──────────────────────────────────────
function initLoyaltyEarnHook() {
    window.addEventListener('spin:complete', function() {
        var token = localStorage.getItem(typeof STORAGE_KEY_TOKEN !== 'undefined' ? STORAGE_KEY_TOKEN : 'casinoToken');
        if (!token) return;
        if (typeof isServerAuthToken === 'function' && !isServerAuthToken()) return;

        fetch('/api/loyaltyshop/earn', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
            body: JSON.stringify({ spinsCount: 1 })
        }).catch(function() { /* fire and forget */ });
    });
}


// ── Social Proof Stats Ticker ───────────────────────────────────────────────
function initSocialProofTicker() {
    // Inject CSS once
    if (!document.getElementById('social-proof-css')) {
        var style = document.createElement('style');
        style.id = 'social-proof-css';
        style.textContent = [
            '#social-proof-bar {',
            '  display: flex;',
            '  align-items: center;',
            '  justify-content: center;',
            '  gap: 20px;',
            '  padding: 8px 16px;',
            '  margin: 0 0 10px 0;',
            '  background: rgba(0,0,0,0.45);',
            '  border: 1px solid rgba(255,200,60,0.18);',
            '  border-radius: 10px;',
            '  font-size: 13px;',
            '  color: rgba(255,255,255,0.85);',
            '  letter-spacing: 0.02em;',
            '  backdrop-filter: blur(6px);',
            '  -webkit-backdrop-filter: blur(6px);',
            '  overflow: hidden;',
            '  flex-wrap: wrap;',
            '}',
            '#social-proof-bar .sp-stat {',
            '  display: flex;',
            '  align-items: center;',
            '  gap: 5px;',
            '  white-space: nowrap;',
            '}',
            '#social-proof-bar .sp-num {',
            '  font-weight: 700;',
            '  font-size: 14px;',
            '  color: #ffd700;',
            '  transition: opacity 0.4s ease;',
            '  min-width: 30px;',
            '  text-align: right;',
            '}',
            '#social-proof-bar .sp-num.sp-fade {',
            '  opacity: 0;',
            '}',
            '#social-proof-bar .sp-dot {',
            '  color: rgba(255,255,255,0.25);',
            '  font-size: 10px;',
            '  align-self: center;',
            '}',
            '@media (max-width: 480px) {',
            '  #social-proof-bar { gap: 10px; font-size: 11px; }',
            '  #social-proof-bar .sp-num { font-size: 12px; }',
            '}'
        ].join('\n');
        document.head.appendChild(style);
    }

    // Create bar DOM if not already present
    if (!document.getElementById('social-proof-bar')) {
        var bar = document.createElement('div');
        bar.id = 'social-proof-bar';

        // Stat: online now
        var statOnline = document.createElement('div');
        statOnline.className = 'sp-stat';
        var iconOnline = document.createElement('span');
        iconOnline.textContent = '\uD83D\uDD25';
        var numOnline = document.createElement('span');
        numOnline.className = 'sp-num';
        numOnline.id = 'sp-online';
        numOnline.textContent = '...';
        var labelOnline = document.createElement('span');
        labelOnline.textContent = 'online now';
        statOnline.appendChild(iconOnline);
        statOnline.appendChild(numOnline);
        statOnline.appendChild(labelOnline);

        var dot1 = document.createElement('span');
        dot1.className = 'sp-dot';
        dot1.textContent = '\u00B7';

        // Stat: spins today
        var statSpins = document.createElement('div');
        statSpins.className = 'sp-stat';
        var iconSpins = document.createElement('span');
        iconSpins.textContent = '\uD83C\uDFB0';
        var numSpins = document.createElement('span');
        numSpins.className = 'sp-num';
        numSpins.id = 'sp-spins';
        numSpins.textContent = '...';
        var labelSpins = document.createElement('span');
        labelSpins.textContent = 'spins today';
        statSpins.appendChild(iconSpins);
        statSpins.appendChild(numSpins);
        statSpins.appendChild(labelSpins);

        var dot2 = document.createElement('span');
        dot2.className = 'sp-dot';
        dot2.textContent = '\u00B7';

        // Stat: members
        var statMembers = document.createElement('div');
        statMembers.className = 'sp-stat';
        var iconMembers = document.createElement('span');
        iconMembers.textContent = '\uD83D\uDC65';
        var numMembers = document.createElement('span');
        numMembers.className = 'sp-num';
        numMembers.id = 'sp-members';
        numMembers.textContent = '...';
        var labelMembers = document.createElement('span');
        labelMembers.textContent = 'members';
        statMembers.appendChild(iconMembers);
        statMembers.appendChild(numMembers);
        statMembers.appendChild(labelMembers);

        var dot3 = document.createElement('span');
        dot3.className = 'sp-dot';
        dot3.textContent = '\u00B7';

        // Stat: platform RTP
        var statRtp = document.createElement('div');
        statRtp.className = 'sp-stat';
        var iconRtp = document.createElement('span');
        iconRtp.textContent = '\uD83D\uDCC8';
        var numRtp = document.createElement('span');
        numRtp.className = 'sp-num';
        numRtp.id = 'sp-rtp';
        numRtp.textContent = '95.4%';
        numRtp.style.color = '#4ade80';
        var labelRtp = document.createElement('span');
        labelRtp.textContent = 'avg RTP';
        statRtp.appendChild(iconRtp);
        statRtp.appendChild(numRtp);
        statRtp.appendChild(labelRtp);

        bar.appendChild(statOnline);
        bar.appendChild(dot1);
        bar.appendChild(statSpins);
        bar.appendChild(dot2);
        bar.appendChild(statMembers);
        bar.appendChild(dot3);
        bar.appendChild(statRtp);

        // Insert before #filterTabs
        var filterTabs = document.getElementById('filterTabs');
        if (filterTabs && filterTabs.parentNode) {
            filterTabs.parentNode.insertBefore(bar, filterTabs);
        }
    }

    // Fetch and update stats, with fade animation on number change
    function _updateSocialProof() {
        fetch('/api/socialproof')
            .then(function(res) { return res.ok ? res.json() : null; })
            .then(function(data) {
                if (!data) return;
                var elOnline  = document.getElementById('sp-online');
                var elSpins   = document.getElementById('sp-spins');
                var elMembers = document.getElementById('sp-members');
                if (!elOnline || !elSpins || !elMembers) return;

                // Fade out, update value, fade in
                function _fadeUpdate(el, newVal) {
                    el.classList.add('sp-fade');
                    setTimeout(function() {
                        el.textContent = newVal.toLocaleString();
                        el.classList.remove('sp-fade');
                    }, 420);
                }

                _fadeUpdate(elOnline,  data.onlineNow       || 0);
                _fadeUpdate(elSpins,   data.spinsToday      || 0);
                _fadeUpdate(elMembers, data.registeredUsers || 0);

                // Update platform RTP if available
                var elRtp = document.getElementById('sp-rtp');
                if (elRtp && data.platformRtp) {
                    _fadeUpdate(elRtp, data.platformRtp.toFixed(1) + '%');
                }
            })
            .catch(function() { /* silently ignore — endpoint may not exist yet */ });
    }

    // Initial fetch
    _updateSocialProof();

    // Auto-refresh every 30 seconds
    if (!window._socialProofInterval) {
        window._socialProofInterval = setInterval(_updateSocialProof, 30000);
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// LOBBY FEATURE WIDGETS — Game of Day Banner, Jackpot Ticker Bar, Lucky Hours
// ═══════════════════════════════════════════════════════════════════════════

// ── 1. Game of Day Highlight Banner ─────────────────────────────────────────
function initGameOfDayHighlight() {
    if (window._gameOfDayInit) return; window._gameOfDayInit = true;

    // Inject CSS once
    if (!document.getElementById('game-of-day-css')) {
        var style = document.createElement('style');
        style.id = 'game-of-day-css';
        style.textContent = [
            '#game-of-day-banner{background:linear-gradient(135deg,#1a0a00 0%,#2d1a00 50%,#1a0a00 100%);',
            'border:1px solid rgba(251,191,36,0.5);border-radius:12px;padding:14px 18px;margin:0 0 14px 0;',
            'display:flex;align-items:center;gap:14px;font-family:inherit;position:relative;overflow:hidden;}',
            '#game-of-day-banner::before{content:"";position:absolute;top:0;left:0;right:0;height:2px;',
            'background:linear-gradient(90deg,#f59e0b,#fde68a,#f59e0b);background-size:200%;',
            'animation:godShimmer 3s linear infinite;}',
            '@keyframes godShimmer{0%{background-position:0%}100%{background-position:200%}}',
            '.god-icon{font-size:28px;flex-shrink:0;line-height:1;}',
            '.god-body{flex:1;min-width:0;}',
            '.god-label{font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:1.5px;',
            'color:#fbbf24;margin-bottom:3px;}',
            '.god-name{font-size:17px;font-weight:800;color:#fff;white-space:nowrap;',
            'overflow:hidden;text-overflow:ellipsis;margin-bottom:4px;}',
            '.god-countdown{font-size:11px;color:rgba(255,255,255,0.5);}',
            '.god-play-btn{flex-shrink:0;background:linear-gradient(135deg,#f59e0b,#d97706);',
            'border:none;border-radius:8px;color:#1a0a00;font-size:12px;font-weight:800;',
            'letter-spacing:.5px;padding:9px 16px;cursor:pointer;transition:transform 0.15s,box-shadow 0.15s;}',
            '.god-play-btn:hover{transform:translateY(-1px);box-shadow:0 4px 12px rgba(245,158,11,0.4);}'
        ].join('');
        document.head.appendChild(style);
    }

    if (!document.getElementById('game-of-day-banner')) {
        var banner = document.createElement('div');
        banner.id = 'game-of-day-banner';
        banner.style.display = 'none';

        var gamesSection = document.getElementById('games-section')
            || document.getElementById('gamesContainer')
            || document.querySelector('.games-grid')
            || document.querySelector('.game-grid');
        if (gamesSection && gamesSection.parentNode) {
            gamesSection.parentNode.insertBefore(banner, gamesSection);
        } else {
            var main = document.getElementById('main-content')
                || document.getElementById('lobby')
                || document.querySelector('.lobby-content');
            if (main) main.appendChild(banner);
        }
    }

    _fetchGameOfDayHighlight();
    setInterval(_fetchGameOfDayHighlight, 60000);
}

function _fetchGameOfDayHighlight() {
    fetch('/api/game-of-day')
        .then(function(res) { return res.ok ? res.json() : null; })
        .then(function(data) {
            if (!data || !data.gameId) return;
            _renderGameOfDayHighlight(data);
        })
        .catch(function() { /* silently ignore */ });
}

function _renderGameOfDayHighlight(data) {
    var banner = document.getElementById('game-of-day-banner');
    if (!banner) return;

    // Clear existing content
    while (banner.firstChild) banner.removeChild(banner.firstChild);

    var iconDiv = document.createElement('div');
    iconDiv.className = 'god-icon';
    iconDiv.textContent = '\u2B50'; // ⭐

    var bodyDiv = document.createElement('div');
    bodyDiv.className = 'god-body';

    var labelDiv = document.createElement('div');
    labelDiv.className = 'god-label';
    labelDiv.textContent = '\u2B50 GAME OF THE DAY';

    var nameDiv = document.createElement('div');
    nameDiv.className = 'god-name';
    nameDiv.textContent = data.gameName || data.gameId;

    var countdownDiv = document.createElement('div');
    countdownDiv.className = 'god-countdown';
    if (data.secondsUntilNext > 0) {
        var h = Math.floor(data.secondsUntilNext / 3600);
        var m = Math.floor((data.secondsUntilNext % 3600) / 60);
        countdownDiv.textContent = 'Refreshes in ' + h + 'h ' + m + 'm';
    } else {
        countdownDiv.textContent = 'Refreshes at midnight';
    }

    bodyDiv.appendChild(labelDiv);
    bodyDiv.appendChild(nameDiv);
    bodyDiv.appendChild(countdownDiv);

    var playBtn = document.createElement('button');
    playBtn.className = 'god-play-btn';
    playBtn.textContent = 'PLAY NOW';
    var gameId = data.gameId;
    playBtn.addEventListener('click', function() {
        if (typeof openSlot !== 'undefined') {
            openSlot(gameId);
        }
    });

    banner.appendChild(iconDiv);
    banner.appendChild(bodyDiv);
    banner.appendChild(playBtn);
    banner.style.display = '';
}

// ── 2. Jackpot Ticker Bar ────────────────────────────────────────────────────
// Separate from the pre-existing initJackpotTicker() (#jackpotTicker).
// Uses #jackpot-ticker-bar and window._jackpotTickerBarInit to avoid collision.
function initJackpotTickerBar() {
    if (window._jackpotTickerBarInit) return; window._jackpotTickerBarInit = true;

    // Inject CSS once
    if (!document.getElementById('jackpot-ticker-bar-css')) {
        var style = document.createElement('style');
        style.id = 'jackpot-ticker-bar-css';
        style.textContent = [
            '#jackpot-ticker-bar{background:linear-gradient(90deg,#0f0718 0%,#1a0a2e 50%,#0f0718 100%);',
            'border:1px solid rgba(139,92,246,0.4);border-radius:10px;padding:10px 16px;margin:0 0 12px 0;',
            'display:flex;align-items:center;gap:12px;font-family:inherit;flex-wrap:wrap;}',
            '.jtb-label{font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:1px;',
            'color:rgba(255,255,255,0.55);white-space:nowrap;flex-shrink:0;}',
            '.jtb-pools{display:flex;gap:8px;flex:1;flex-wrap:wrap;}',
            '.jtb-pool{display:flex;flex-direction:column;align-items:center;',
            'background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.1);',
            'border-radius:8px;padding:6px 12px;min-width:80px;flex:1;}',
            '.jtb-pool--grand{background:linear-gradient(135deg,rgba(245,158,11,0.15),rgba(180,83,9,0.1));',
            'border-color:rgba(245,158,11,0.5);}',
            '.jtb-pool-name{font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:1px;',
            'color:rgba(255,255,255,0.45);margin-bottom:3px;}',
            '.jtb-pool--grand .jtb-pool-name{color:#fbbf24;}',
            '.jtb-pool-amount{font-size:14px;font-weight:800;color:#fff;font-variant-numeric:tabular-nums;}',
            '.jtb-pool--grand .jtb-pool-amount{color:#f59e0b;text-shadow:0 0 6px rgba(245,158,11,0.4);}',
            '@keyframes jtbPulse{0%,100%{opacity:1}50%{opacity:0.5}}',
            '.jtb-pulse{animation:jtbPulse 0.6s ease-in-out;}'
        ].join('');
        document.head.appendChild(style);
    }

    if (!document.getElementById('jackpot-ticker-bar')) {
        var bar = document.createElement('div');
        bar.id = 'jackpot-ticker-bar';
        bar.style.display = 'none';

        var labelEl = document.createElement('span');
        labelEl.className = 'jtb-label';
        labelEl.textContent = '\uD83C\uDFB0 LIVE JACKPOTS:';
        bar.appendChild(labelEl);

        var poolsEl = document.createElement('div');
        poolsEl.id = 'jackpot-ticker-bar-pools';
        poolsEl.className = 'jtb-pools';
        bar.appendChild(poolsEl);

        var gamesSection = document.getElementById('games-section')
            || document.getElementById('gamesContainer')
            || document.querySelector('.games-grid')
            || document.querySelector('.game-grid');
        if (gamesSection && gamesSection.parentNode) {
            gamesSection.parentNode.insertBefore(bar, gamesSection);
        } else {
            var main = document.getElementById('main-content')
                || document.getElementById('lobby')
                || document.querySelector('.lobby-content');
            if (main) main.insertBefore(bar, main.firstChild);
        }
    }

    _fetchJackpotTickerBar();
    setInterval(_fetchJackpotTickerBar, 45000);
}

var _jtbPrevAmounts = {};

function _fetchJackpotTickerBar() {
    fetch('/api/jackpot/status')
        .then(function(res) { return res.ok ? res.json() : null; })
        .then(function(data) {
            if (!data || !data.pools) return;
            _renderJackpotTickerBar(data.pools);
        })
        .catch(function() { /* silently ignore */ });
}

function _renderJackpotTickerBar(pools) {
    var bar = document.getElementById('jackpot-ticker-bar');
    var poolsEl = document.getElementById('jackpot-ticker-bar-pools');
    if (!bar || !poolsEl || !pools || pools.length === 0) {
        if (bar) bar.style.display = 'none';
        return;
    }

    var order = ['mini', 'minor', 'major', 'grand'];
    var sorted = order.map(function(t) { return pools.find(function(p) { return p.tier === t; }); }).filter(Boolean);
    pools.forEach(function(p) { if (order.indexOf(p.tier) === -1) sorted.push(p); });

    // Clear and rebuild pool cards
    while (poolsEl.firstChild) poolsEl.removeChild(poolsEl.firstChild);

    sorted.forEach(function(pool) {
        var isGrand = pool.tier === 'grand';
        var amount = parseFloat(pool.currentAmount || 0);
        var amountStr = '$' + amount.toFixed(2);
        var prevAmount = _jtbPrevAmounts[pool.tier];
        _jtbPrevAmounts[pool.tier] = amount;

        var card = document.createElement('div');
        card.className = 'jtb-pool' + (isGrand ? ' jtb-pool--grand' : '');

        var nameEl = document.createElement('div');
        nameEl.className = 'jtb-pool-name';
        nameEl.textContent = pool.tier.toUpperCase();

        var amountEl = document.createElement('div');
        amountEl.className = 'jtb-pool-amount';
        amountEl.textContent = amountStr;

        // Pulse if amount changed
        if (prevAmount !== undefined && prevAmount !== amount) {
            amountEl.classList.add('jtb-pulse');
            setTimeout(function() { amountEl.classList.remove('jtb-pulse'); }, 700);
        }

        card.appendChild(nameEl);
        card.appendChild(amountEl);
        poolsEl.appendChild(card);
    });

    bar.style.display = '';
}

// ── 3. Lucky Hours Banner ────────────────────────────────────────────────────
// Distinct from initLuckyHourBanner() which hits /api/lucky-hour.
// This widget hits /api/luckyhours/status and uses element #lucky-hours-banner.
function initLuckyHoursBanner() {
    if (window._luckyHoursBannerInit) return; window._luckyHoursBannerInit = true;

    // Inject CSS once
    if (!document.getElementById('lucky-hours-banner-css')) {
        var style = document.createElement('style');
        style.id = 'lucky-hours-banner-css';
        style.textContent = [
            '#lucky-hours-banner{border-radius:10px;padding:10px 16px;margin:0 0 14px 0;',
            'font-family:inherit;display:flex;align-items:center;gap:12px;transition:all 0.3s;}',
            '#lucky-hours-banner.lhb-active{background:linear-gradient(135deg,#064e3b 0%,#065f46 50%,#047857 100%);',
            'border:1px solid #10b981;box-shadow:0 0 16px rgba(16,185,129,0.3);',
            'animation:lhbPulse 2.5s ease-in-out infinite;}',
            '#lucky-hours-banner.lhb-inactive{background:rgba(255,255,255,0.04);',
            'border:1px solid rgba(255,255,255,0.1);}',
            '@keyframes lhbPulse{0%,100%{box-shadow:0 0 16px rgba(16,185,129,0.3)}',
            '50%{box-shadow:0 0 28px rgba(16,185,129,0.5)}}',
            '.lhb-icon{font-size:22px;flex-shrink:0;line-height:1;}',
            '.lhb-body{flex:1;min-width:0;}',
            '.lhb-title{font-size:13px;font-weight:700;color:#fff;',
            'white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}',
            '#lucky-hours-banner.lhb-active .lhb-title{color:#6ee7b7;}',
            '#lucky-hours-banner.lhb-inactive .lhb-title{color:rgba(255,255,255,0.55);font-size:12px;}',
            '.lhb-countdown{font-size:11px;font-variant-numeric:tabular-nums;margin-top:2px;}',
            '#lucky-hours-banner.lhb-active .lhb-countdown{color:#a7f3d0;}',
            '#lucky-hours-banner.lhb-inactive .lhb-countdown{color:rgba(255,255,255,0.35);}'
        ].join('');
        document.head.appendChild(style);
    }

    if (!document.getElementById('lucky-hours-banner')) {
        var banner = document.createElement('div');
        banner.id = 'lucky-hours-banner';
        banner.style.display = 'none';

        var gamesSection = document.getElementById('games-section')
            || document.getElementById('gamesContainer')
            || document.querySelector('.games-grid')
            || document.querySelector('.game-grid');
        if (gamesSection && gamesSection.parentNode) {
            gamesSection.parentNode.insertBefore(banner, gamesSection);
        } else {
            var main = document.getElementById('main-content')
                || document.getElementById('lobby')
                || document.querySelector('.lobby-content');
            if (main) main.appendChild(banner);
        }
    }

    _fetchLuckyHoursBanner();
    setInterval(_fetchLuckyHoursBanner, 60000);
}

var _luckyHoursBannerCountdownInterval = null;

function _fetchLuckyHoursBanner() {
    fetch('/api/luckyhours/status')
        .then(function(res) { return res.ok ? res.json() : null; })
        .then(function(data) {
            if (!data) return;
            _renderLuckyHoursBanner(data);
        })
        .catch(function() {
            var banner = document.getElementById('lucky-hours-banner');
            if (banner) banner.style.display = 'none';
        });
}

function _renderLuckyHoursBanner(data) {
    var banner = document.getElementById('lucky-hours-banner');
    if (!banner) return;

    // Clear existing content
    while (banner.firstChild) banner.removeChild(banner.firstChild);

    // Clear any existing countdown
    if (_luckyHoursBannerCountdownInterval) {
        clearInterval(_luckyHoursBannerCountdownInterval);
        _luckyHoursBannerCountdownInterval = null;
    }

    var isActive = !!data.active;
    var multiplier = data.multiplier || 2;
    var label = data.label || (multiplier + '\u00D7 Gems');
    var targetTime = isActive ? data.endsAt : data.nextWindowAt;

    banner.className = isActive ? 'lhb-active' : 'lhb-inactive';
    banner.style.display = '';

    var iconDiv = document.createElement('div');
    iconDiv.className = 'lhb-icon';
    iconDiv.textContent = '\uD83C\uDF40'; // 🍀

    var bodyDiv = document.createElement('div');
    bodyDiv.className = 'lhb-body';

    var titleDiv = document.createElement('div');
    titleDiv.className = 'lhb-title';
    if (isActive) {
        titleDiv.textContent = '\uD83C\uDF40 LUCKY HOUR ACTIVE \u2014 ' + label + '!';
    } else {
        titleDiv.textContent = '\uD83C\uDF40 Next Lucky Hour in\u2026';
    }

    var countdownDiv = document.createElement('div');
    countdownDiv.className = 'lhb-countdown';
    countdownDiv.id = 'lucky-hours-banner-countdown';
    if (targetTime) {
        countdownDiv.dataset.target = targetTime;
        countdownDiv.dataset.mode = isActive ? 'ends' : 'starts';
    }
    countdownDiv.textContent = isActive ? 'Ends in --:--' : 'Starts in --:--';

    bodyDiv.appendChild(titleDiv);
    bodyDiv.appendChild(countdownDiv);

    banner.appendChild(iconDiv);
    banner.appendChild(bodyDiv);

    if (targetTime) {
        _updateLuckyHoursBannerCountdown();
        _luckyHoursBannerCountdownInterval = setInterval(_updateLuckyHoursBannerCountdown, 1000);
    }
}

function _updateLuckyHoursBannerCountdown() {
    var el = document.getElementById('lucky-hours-banner-countdown');
    if (!el) {
        clearInterval(_luckyHoursBannerCountdownInterval);
        _luckyHoursBannerCountdownInterval = null;
        return;
    }
    var target = el.dataset.target;
    var mode = el.dataset.mode;
    if (!target) return;
    var diff = Math.max(0, new Date(target).getTime() - Date.now());
    var secs = Math.floor(diff / 1000);
    var h = Math.floor(secs / 3600);
    var m = Math.floor((secs % 3600) / 60);
    var s = secs % 60;
    var timeStr = h > 0
        ? h + 'h ' + m + 'm'
        : String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0');
    el.textContent = (mode === 'ends' ? 'Ends in ' : 'Starts in ') + timeStr;
    if (diff === 0) {
        clearInterval(_luckyHoursBannerCountdownInterval);
        _luckyHoursBannerCountdownInterval = null;
        setTimeout(_fetchLuckyHoursBanner, 3000);
    }
}

// ── 4. Leaderboard Widget ────────────────────────────────────────────────────
function initLeaderboardWidget() {
    if (window._leaderboardWidgetInit) return; window._leaderboardWidgetInit = true;

    // Inject CSS once
    if (!document.getElementById('leaderboard-widget-css')) {
        var style = document.createElement('style');
        style.id = 'leaderboard-widget-css';
        style.textContent = [
            '#leaderboard-widget{background:linear-gradient(135deg,#0a0f1e 0%,#111827 100%);',
            'border:1px solid rgba(99,102,241,0.35);border-radius:12px;padding:14px 16px;',
            'margin:0 0 14px 0;font-family:inherit;}',
            '.lbw-header{display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;}',
            '.lbw-title{font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:1px;',
            'color:rgba(255,255,255,0.55);}',
            '.lbw-refresh{background:none;border:none;color:rgba(255,255,255,0.35);',
            'font-size:14px;cursor:pointer;padding:0;line-height:1;transition:color 0.15s;}',
            '.lbw-refresh:hover{color:rgba(255,255,255,0.7);}',
            '.lbw-tabs{display:flex;gap:4px;margin-bottom:10px;}',
            '.lbw-tab{flex:1;padding:6px 4px;border-radius:7px;border:1px solid rgba(255,255,255,0.1);',
            'background:rgba(255,255,255,0.04);color:rgba(255,255,255,0.5);',
            'font-size:11px;font-weight:600;cursor:pointer;transition:all 0.15s;text-align:center;}',
            '.lbw-tab.active{background:rgba(99,102,241,0.25);border-color:rgba(99,102,241,0.5);',
            'color:#a5b4fc;}',
            '.lbw-tab:hover:not(.active){background:rgba(255,255,255,0.07);color:rgba(255,255,255,0.75);}',
            '.lbw-body{min-height:80px;}',
            '.lbw-loading{text-align:center;padding:20px 0;color:rgba(255,255,255,0.3);font-size:12px;}',
            '.lbw-row{display:flex;align-items:center;gap:8px;padding:5px 0;',
            'border-bottom:1px solid rgba(255,255,255,0.05);}',
            '.lbw-row:last-child{border-bottom:none;}',
            '.lbw-rank{font-size:12px;font-weight:800;color:rgba(255,255,255,0.35);',
            'min-width:22px;text-align:center;flex-shrink:0;}',
            '.lbw-rank-1{color:#f59e0b;}.lbw-rank-2{color:#94a3b8;}.lbw-rank-3{color:#b45309;}',
            '.lbw-user{flex:1;font-size:12px;color:rgba(255,255,255,0.7);',
            'white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0;}',
            '.lbw-value{font-size:11px;color:rgba(255,255,255,0.45);',
            'white-space:nowrap;flex-shrink:0;text-align:right;}'
        ].join('');
        document.head.appendChild(style);
    }

    if (!document.getElementById('leaderboard-widget')) {
        var widget = document.createElement('div');
        widget.id = 'leaderboard-widget';

        var header = document.createElement('div');
        header.className = 'lbw-header';

        var titleEl = document.createElement('div');
        titleEl.className = 'lbw-title';
        titleEl.textContent = '\uD83C\uDFC6 Leaderboards';

        var refreshBtn = document.createElement('button');
        refreshBtn.className = 'lbw-refresh';
        refreshBtn.title = 'Refresh';
        refreshBtn.textContent = '\u21BB';
        refreshBtn.addEventListener('click', function() { _fetchLeaderboard(_lbwActiveTab); });

        header.appendChild(titleEl);
        header.appendChild(refreshBtn);

        var tabsEl = document.createElement('div');
        tabsEl.className = 'lbw-tabs';
        tabsEl.id = 'lbw-tabs';

        var tabDefs = [
            { key: 'weekly', label: '\uD83C\uDFC6 Weekly' },
            { key: 'bigwins', label: '\uD83D\uDCB0 Big Wins' },
            { key: 'richlist', label: '\uD83D\uDC51 Rich List' }
        ];
        tabDefs.forEach(function(td) {
            var btn = document.createElement('button');
            btn.className = 'lbw-tab' + (td.key === 'weekly' ? ' active' : '');
            btn.dataset.tab = td.key;
            btn.textContent = td.label;
            btn.addEventListener('click', function() {
                var tabs = document.querySelectorAll('.lbw-tab');
                for (var i = 0; i < tabs.length; i++) tabs[i].classList.remove('active');
                btn.classList.add('active');
                _lbwActiveTab = td.key;
                _fetchLeaderboard(td.key);
            });
            tabsEl.appendChild(btn);
        });

        var bodyEl = document.createElement('div');
        bodyEl.className = 'lbw-body';
        bodyEl.id = 'lbw-body';

        widget.appendChild(header);
        widget.appendChild(tabsEl);
        widget.appendChild(bodyEl);

        var anchor = document.getElementById('jackpot-ticker-bar')
            || document.getElementById('jackpot-ticker-bar')
            || document.getElementById('games-section')
            || document.getElementById('gamesContainer')
            || document.querySelector('.games-grid')
            || document.querySelector('.game-grid');
        if (anchor && anchor.parentNode) {
            anchor.parentNode.insertBefore(widget, anchor.nextSibling);
        } else {
            var main = document.getElementById('main-content')
                || document.getElementById('lobby')
                || document.querySelector('.lobby-content');
            if (main) main.insertBefore(widget, main.firstChild);
        }
    }

    _fetchLeaderboard('weekly');
    setInterval(function() { _fetchLeaderboard(_lbwActiveTab); }, 300000);
}

var _lbwActiveTab = 'weekly';

function _fetchLeaderboard(tab) {
    var body = document.getElementById('lbw-body');
    if (!body) return;

    var loadingEl = document.createElement('div');
    loadingEl.className = 'lbw-loading';
    loadingEl.textContent = 'Loading\u2026';
    while (body.firstChild) body.removeChild(body.firstChild);
    body.appendChild(loadingEl);

    var url = '/api/leaderboard/' + (tab || 'weekly');
    fetch(url)
        .then(function(res) { return res.ok ? res.json() : null; })
        .then(function(data) { _renderLeaderboard(tab, data); })
        .catch(function() { _renderLeaderboard(tab, null); });
}

function _renderLeaderboard(tab, data) {
    var body = document.getElementById('lbw-body');
    if (!body) return;
    while (body.firstChild) body.removeChild(body.firstChild);

    var entries = data && data.entries ? data.entries.slice(0, 5) : [];
    if (entries.length === 0) {
        var emptyEl = document.createElement('div');
        emptyEl.className = 'lbw-loading';
        emptyEl.textContent = 'No data yet';
        body.appendChild(emptyEl);
        return;
    }

    entries.forEach(function(entry) {
        var row = document.createElement('div');
        row.className = 'lbw-row';

        var rankEl = document.createElement('div');
        rankEl.className = 'lbw-rank' + (entry.rank <= 3 ? ' lbw-rank-' + entry.rank : '');
        rankEl.textContent = '#' + entry.rank;

        var userEl = document.createElement('div');
        userEl.className = 'lbw-user';
        userEl.textContent = entry.maskedUser || 'Player';

        var valueEl = document.createElement('div');
        valueEl.className = 'lbw-value';

        if (tab === 'weekly') {
            var wagered = parseFloat(entry.totalWagered || 0);
            var spins = entry.spinCount || 0;
            valueEl.textContent = '$' + wagered.toFixed(2) + ' (' + spins + ' spins)';
        } else if (tab === 'bigwins') {
            var win = parseFloat(entry.winAmount || 0);
            var mult = parseFloat(entry.multiplier || 0);
            var gameLabel = entry.gameId || '';
            userEl.textContent = (entry.maskedUser || 'Player') + ' \u2014 ' + gameLabel;
            valueEl.textContent = '$' + win.toFixed(2) + ' (' + mult.toFixed(0) + 'x)';
        } else if (tab === 'richlist') {
            var bal = parseFloat(entry.balance || 0);
            valueEl.textContent = '$' + bal.toFixed(2);
        }

        row.appendChild(rankEl);
        row.appendChild(userEl);
        row.appendChild(valueEl);
        body.appendChild(row);
    });
}

// ── 5. Big Wins Feed ─────────────────────────────────────────────────────────
function initBigWinsFeed() {
    if (window._bigWinsFeedInit) return; window._bigWinsFeedInit = true;

    // Inject CSS once
    if (!document.getElementById('big-wins-feed-css')) {
        var style = document.createElement('style');
        style.id = 'big-wins-feed-css';
        style.textContent = [
            '#big-wins-feed{background:linear-gradient(135deg,#0c1a0a 0%,#111a0d 100%);',
            'border:1px solid rgba(34,197,94,0.3);border-radius:12px;padding:12px 16px;',
            'margin:0 0 14px 0;font-family:inherit;}',
            '.bwf-header{font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:1px;',
            'color:rgba(255,255,255,0.55);margin-bottom:8px;}',
            '.bwf-list{display:flex;flex-direction:column;gap:4px;}',
            '@keyframes bwfSlideIn{from{opacity:0;transform:translateY(-6px)}to{opacity:1;transform:none}}',
            '.bwf-entry{display:flex;align-items:center;gap:8px;padding:5px 0;',
            'border-bottom:1px solid rgba(255,255,255,0.05);',
            'animation:bwfSlideIn 0.25s ease both;}',
            '.bwf-entry:last-child{border-bottom:none;}',
            '.bwf-icon{font-size:14px;flex-shrink:0;}',
            '.bwf-text{flex:1;font-size:12px;color:rgba(255,255,255,0.7);',
            'white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0;}',
            '.bwf-text strong{color:#4ade80;}',
            '.bwf-mult{font-size:11px;color:rgba(255,255,255,0.35);flex-shrink:0;}'
        ].join('');
        document.head.appendChild(style);
    }

    if (!document.getElementById('big-wins-feed')) {
        var widget = document.createElement('div');
        widget.id = 'big-wins-feed';
        widget.style.display = 'none';

        var headerEl = document.createElement('div');
        headerEl.className = 'bwf-header';
        headerEl.textContent = '\uD83D\uDD25 Recent Big Wins';

        var listEl = document.createElement('div');
        listEl.className = 'bwf-list';
        listEl.id = 'bwf-list';

        widget.appendChild(headerEl);
        widget.appendChild(listEl);

        var lbWidget = document.getElementById('leaderboard-widget');
        var anchor = lbWidget
            || document.getElementById('jackpot-ticker-bar')
            || document.getElementById('games-section')
            || document.getElementById('gamesContainer')
            || document.querySelector('.games-grid')
            || document.querySelector('.game-grid');
        if (anchor && anchor.parentNode) {
            anchor.parentNode.insertBefore(widget, anchor.nextSibling);
        } else {
            var main = document.getElementById('main-content')
                || document.getElementById('lobby')
                || document.querySelector('.lobby-content');
            if (main) main.insertBefore(widget, main.firstChild);
        }
    }

    _fetchBigWinsFeed();
    setInterval(_fetchBigWinsFeed, 60000);
}

function _fetchBigWinsFeed() {
    fetch('/api/feed')
        .then(function(res) { return res.ok ? res.json() : null; })
        .then(function(data) { _renderBigWinsFeed(data); })
        .catch(function() { /* silently ignore */ });
}

function _renderBigWinsFeed(data) {
    var widget = document.getElementById('big-wins-feed');
    var list = document.getElementById('bwf-list');
    if (!widget || !list) return;

    var feed = data && data.feed ? data.feed.slice(0, 5) : [];
    if (feed.length === 0) {
        widget.style.display = 'none';
        return;
    }

    while (list.firstChild) list.removeChild(list.firstChild);

    feed.forEach(function(item) {
        var entry = document.createElement('div');
        entry.className = 'bwf-entry';

        var iconEl = document.createElement('div');
        iconEl.className = 'bwf-icon';
        iconEl.textContent = '\uD83D\uDCB0';

        var textEl = document.createElement('div');
        textEl.className = 'bwf-text';

        var userSpan = document.createElement('span');
        userSpan.textContent = '[' + (item.username || 'Player') + '] won ';

        var winSpan = document.createElement('strong');
        winSpan.textContent = '$' + parseFloat(item.win || 0).toFixed(2);

        var gameSpan = document.createElement('span');
        gameSpan.textContent = ' on ' + (item.gameId || 'slots');

        textEl.appendChild(userSpan);
        textEl.appendChild(winSpan);
        textEl.appendChild(gameSpan);

        var multEl = document.createElement('div');
        multEl.className = 'bwf-mult';
        multEl.textContent = '(' + parseFloat(item.mult || 0).toFixed(0) + 'x)';

        entry.appendChild(iconEl);
        entry.appendChild(textEl);
        entry.appendChild(multEl);
        list.appendChild(entry);
    });

    widget.style.display = '';
}

// ── 6. Promo Code Widget ─────────────────────────────────────────────────────
function initPromoCodeWidget() {
    if (window._promoCodeWidgetInit) return; window._promoCodeWidgetInit = true;

    // Only show when user is authenticated
    var token = localStorage.getItem(typeof STORAGE_KEY_TOKEN !== 'undefined' ? STORAGE_KEY_TOKEN : 'casinoToken');
    if (!token) return;

    // Inject CSS once
    if (!document.getElementById('promo-code-widget-css')) {
        var style = document.createElement('style');
        style.id = 'promo-code-widget-css';
        style.textContent = [
            '#promo-code-widget{background:rgba(255,255,255,0.04);',
            'border:1px solid rgba(255,255,255,0.12);border-radius:10px;',
            'padding:10px 14px;margin:0 0 14px 0;font-family:inherit;',
            'display:flex;align-items:center;flex-wrap:wrap;gap:8px;}',
            '.pcw-label{font-size:12px;color:rgba(255,255,255,0.5);flex-shrink:0;}',
            '.pcw-input{flex:1;min-width:100px;padding:7px 10px;',
            'background:rgba(255,255,255,0.07);border:1px solid rgba(255,255,255,0.15);',
            'border-radius:7px;color:#fff;font-size:12px;font-family:inherit;',
            'letter-spacing:0.5px;outline:none;transition:border-color 0.15s;}',
            '.pcw-input:focus{border-color:rgba(99,102,241,0.5);}',
            '.pcw-btn{padding:7px 14px;background:linear-gradient(135deg,#6366f1,#4f46e5);',
            'border:none;border-radius:7px;color:#fff;font-size:12px;font-weight:700;',
            'cursor:pointer;transition:opacity 0.15s;flex-shrink:0;}',
            '.pcw-btn:hover{opacity:0.85;}',
            '.pcw-btn:disabled{opacity:0.45;cursor:not-allowed;}',
            '.pcw-msg{width:100%;font-size:12px;font-weight:600;',
            'padding:4px 0 0;display:none;}',
            '.pcw-msg.success{color:#4ade80;display:block;}',
            '.pcw-msg.error{color:#f87171;display:block;}'
        ].join('');
        document.head.appendChild(style);
    }

    if (!document.getElementById('promo-code-widget')) {
        var widget = document.createElement('div');
        widget.id = 'promo-code-widget';

        var labelEl = document.createElement('span');
        labelEl.className = 'pcw-label';
        labelEl.textContent = '\uD83C\uDF9F\uFE0F Have a promo code?';

        var inputEl = document.createElement('input');
        inputEl.type = 'text';
        inputEl.className = 'pcw-input';
        inputEl.id = 'pcw-input';
        inputEl.placeholder = 'ENTER CODE';
        inputEl.maxLength = 32;
        inputEl.addEventListener('input', function() {
            this.value = this.value.toUpperCase();
        });

        var redeemBtn = document.createElement('button');
        redeemBtn.className = 'pcw-btn';
        redeemBtn.id = 'pcw-btn';
        redeemBtn.textContent = 'Redeem';
        redeemBtn.addEventListener('click', _redeemPromoCode);

        inputEl.addEventListener('keydown', function(e) {
            if (e.key === 'Enter') _redeemPromoCode();
        });

        var msgEl = document.createElement('div');
        msgEl.className = 'pcw-msg';
        msgEl.id = 'pcw-msg';

        widget.appendChild(labelEl);
        widget.appendChild(inputEl);
        widget.appendChild(redeemBtn);
        widget.appendChild(msgEl);

        var filterTabs = document.getElementById('filterTabs');
        if (filterTabs && filterTabs.parentNode) {
            filterTabs.parentNode.insertBefore(widget, filterTabs);
        } else {
            var main = document.getElementById('main-content')
                || document.getElementById('lobby')
                || document.querySelector('.lobby-content');
            if (main) main.appendChild(widget);
        }
    }
}

function _redeemPromoCode() {
    var inputEl = document.getElementById('pcw-input');
    var btn = document.getElementById('pcw-btn');
    var msgEl = document.getElementById('pcw-msg');
    if (!inputEl || !btn || !msgEl) return;

    var code = inputEl.value.trim().toUpperCase();
    if (!code) return;

    var token = localStorage.getItem(typeof STORAGE_KEY_TOKEN !== 'undefined' ? STORAGE_KEY_TOKEN : 'casinoToken');
    if (!token) {
        _showPromoMsg('Please log in to redeem a promo code.', 'error');
        return;
    }

    btn.disabled = true;
    btn.textContent = 'Redeeming\u2026';
    msgEl.className = 'pcw-msg';
    msgEl.textContent = '';

    fetch('/api/promocode/redeem', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer ' + token
        },
        body: JSON.stringify({ code: code })
    })
        .then(function(res) { return res.json().then(function(d) { return { ok: res.ok, data: d }; }); })
        .then(function(result) {
            btn.disabled = false;
            btn.textContent = 'Redeem';
            if (result.ok && result.data.success) {
                var reward = result.data.reward || {};
                var parts = [];
                if (reward.gems) parts.push(reward.gems + ' gems');
                if (reward.credits) parts.push('$' + parseFloat(reward.credits).toFixed(2) + ' credited');
                if (reward.spins) parts.push(reward.spins + ' free spins');
                var successMsg = '\u2705 ' + (parts.length ? parts.join(' + ') + '!' : 'Code redeemed!');
                _showPromoMsg(successMsg, 'success');
                if (inputEl) inputEl.value = '';
                if (result.data.newBalance !== undefined && typeof updateBalance === 'function') {
                    balance = parseFloat(result.data.newBalance);
                    updateBalance();
                }
            } else {
                var errMsg = (result.data && result.data.error) ? result.data.error : 'Invalid code';
                _showPromoMsg('\u274C ' + errMsg, 'error');
                if (inputEl) inputEl.value = '';
            }
        })
        .catch(function() {
            btn.disabled = false;
            btn.textContent = 'Redeem';
            _showPromoMsg('\u274C Network error. Please try again.', 'error');
        });
}

function _showPromoMsg(text, type) {
    var msgEl = document.getElementById('pcw-msg');
    if (!msgEl) return;
    msgEl.textContent = text;
    msgEl.className = 'pcw-msg ' + type;
    setTimeout(function() {
        if (msgEl) {
            msgEl.className = 'pcw-msg';
            msgEl.textContent = '';
        }
    }, 3000);
}


// ── Rental System ─────────────────────────────────────────────────────────────
// Locked game cards with rent/unlock support.
// API:
//   GET  /api/rentals/locked-games  (public)  → { lockedGames: [...], tiers: [...] }
//   GET  /api/rentals/status/:gameId (auth)   → { gameId, locked, unlocked, rental }
//   POST /api/rentals/rent           (auth)   → { gameId, tierId, payWith } → { success, rental, newBalance }

(function() {
    // Inject CSS once
    if (!document.getElementById('rentalCss')) {
        var s = document.createElement('style');
        s.id = 'rentalCss';
        s.textContent = '.game-card--locked { position: relative; } .game-card--locked .rental-overlay { position: absolute; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0,0,0,0.7); display: flex; flex-direction: column; align-items: center; justify-content: center; color: #fff; z-index: 2; border-radius: 8px; cursor: pointer; } .rental-lock-icon { font-size: 2rem; } .rental-label { font-size: 0.7rem; color: #ffd700; font-weight: bold; margin: 4px 0; } .rental-btn { background: #ffd700; color: #000; border: none; padding: 6px 12px; border-radius: 4px; cursor: pointer; font-weight: bold; font-size: 0.75rem; margin-top: 4px; } #rental-modal-backdrop { position: fixed; inset: 0; background: rgba(0,0,0,0.75); z-index: 9000; display: flex; align-items: center; justify-content: center; } #rental-modal { background: #1a1f2e; border: 1px solid rgba(255,215,0,0.3); border-radius: 12px; padding: 24px; max-width: 380px; width: 90%; color: #fff; } #rental-modal h2 { margin: 0 0 16px; font-size: 1.1rem; color: #ffd700; } .rental-tier-row { display: flex; align-items: center; justify-content: space-between; padding: 10px 0; border-bottom: 1px solid rgba(255,255,255,0.08); } .rental-tier-row:last-of-type { border-bottom: none; } .rental-tier-info { font-size: 0.82rem; color: rgba(255,255,255,0.75); } .rental-tier-price { font-size: 0.78rem; color: #ffd700; margin-top: 2px; } .rental-tier-btn { background: #ffd700; color: #000; border: none; padding: 6px 14px; border-radius: 6px; cursor: pointer; font-weight: bold; font-size: 0.75rem; } .rental-tier-btn:disabled { background: rgba(255,215,0,0.35); cursor: default; } .rental-modal-close { float: right; background: none; border: none; color: rgba(255,255,255,0.5); font-size: 1.2rem; cursor: pointer; margin-top: -4px; } .rental-auth-msg { text-align: center; color: rgba(255,255,255,0.55); font-size: 0.85rem; padding: 12px 0; }';
        document.head.appendChild(s);
    }
})();

function initRentalSystem() {
    fetch('/api/rentals/locked-games')
        .then(function(res) { return res.ok ? res.json() : null; })
        .then(function(data) {
            if (!data) return;
            window._lockedGameIds = new Set((data.lockedGames || []).map(function(id) { return String(id).toLowerCase(); }));
            window._rentalTiers = data.tiers || [];
            applyRentalOverlays();
        })
        .catch(function() { /* server may not have rentals endpoint yet — silently skip */ });
}

function applyRentalOverlays() {
    var locked = window._lockedGameIds;
    if (!locked || locked.size === 0) return;

    document.querySelectorAll('.game-card').forEach(function(card) {
        var gameId = (card.getAttribute('data-game-id') || '').toLowerCase();
        if (!gameId) return;

        // Already processed
        if (card.classList.contains('game-card--locked') || card.classList.contains('game-card--rental-checked')) return;
        card.classList.add('game-card--rental-checked');

        if (!locked.has(gameId)) return;

        // Mark as locked
        card.classList.add('game-card--locked');

        // Build overlay via createElement (no innerHTML with dynamic values)
        var overlay = document.createElement('div');
        overlay.className = 'rental-overlay';

        var lockIcon = document.createElement('div');
        lockIcon.className = 'rental-lock-icon';
        lockIcon.textContent = '\uD83D\uDD12'; // 🔒

        var label = document.createElement('div');
        label.className = 'rental-label';
        label.textContent = 'PREMIUM';

        var rentBtn = document.createElement('button');
        rentBtn.className = 'rental-btn';
        rentBtn.textContent = 'Rent to Play';

        overlay.appendChild(lockIcon);
        overlay.appendChild(label);
        overlay.appendChild(rentBtn);
        card.appendChild(overlay);

        // Intercept card clicks — show rent modal instead of openSlot
        card.addEventListener('click', function(e) {
            if (window._lockedGameIds && window._lockedGameIds.has(gameId)) {
                e.stopImmediatePropagation();
                showRentModal(gameId);
            }
        }, true); // capture phase so we run before the onclick
    });
}

function showRentModal(gameId) {
    // Remove any existing modal
    var existing = document.getElementById('rental-modal-backdrop');
    if (existing) existing.parentNode.removeChild(existing);

    // Look up game name from global GAMES array
    var gameName = gameId;
    if (typeof GAMES !== 'undefined') {
        for (var i = 0; i < GAMES.length; i++) {
            if ((GAMES[i].id || '').toLowerCase() === gameId.toLowerCase()) {
                gameName = GAMES[i].name || gameId;
                break;
            }
        }
    } else if (typeof games !== 'undefined') {
        for (var j = 0; j < games.length; j++) {
            if ((games[j].id || '').toLowerCase() === gameId.toLowerCase()) {
                gameName = games[j].name || gameId;
                break;
            }
        }
    }

    var tiers = window._rentalTiers || [];

    // Determine auth state
    var token = localStorage.getItem(typeof STORAGE_KEY_TOKEN !== 'undefined' ? STORAGE_KEY_TOKEN : 'casinoToken');
    var isAuthed = !!(token && (typeof isServerAuthToken !== 'function' || isServerAuthToken()));

    // Build backdrop
    var backdrop = document.createElement('div');
    backdrop.id = 'rental-modal-backdrop';
    backdrop.addEventListener('click', function(e) {
        if (e.target === backdrop) {
            backdrop.parentNode.removeChild(backdrop);
        }
    });

    // Build modal box
    var modal = document.createElement('div');
    modal.id = 'rental-modal';
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');

    // Close button
    var closeBtn = document.createElement('button');
    closeBtn.className = 'rental-modal-close';
    closeBtn.textContent = '\u00D7'; // ×
    closeBtn.title = 'Close';
    closeBtn.addEventListener('click', function() {
        backdrop.parentNode.removeChild(backdrop);
    });

    // Title
    var title = document.createElement('h2');
    var titleText = document.createTextNode('Unlock ');
    title.appendChild(closeBtn);
    title.appendChild(titleText);
    var nameSpan = document.createElement('span');
    nameSpan.textContent = gameName;
    title.appendChild(nameSpan);

    modal.appendChild(title);

    if (!isAuthed) {
        // Not logged in
        var authMsg = document.createElement('div');
        authMsg.className = 'rental-auth-msg';
        authMsg.textContent = 'Please log in to rent this game.';
        modal.appendChild(authMsg);
    } else if (tiers.length === 0) {
        var noTiers = document.createElement('div');
        noTiers.className = 'rental-auth-msg';
        noTiers.textContent = 'No rental options available right now.';
        modal.appendChild(noTiers);
    } else {
        // Render tier rows
        tiers.forEach(function(tier) {
            var row = document.createElement('div');
            row.className = 'rental-tier-row';

            var info = document.createElement('div');

            var tierName = document.createElement('div');
            tierName.className = 'rental-tier-info';
            var hours = typeof tier.durationHours === 'number' ? tier.durationHours : parseInt(tier.durationHours, 10) || 0;
            tierName.textContent = (tier.name || 'Tier') + ' — ' + hours + (hours === 1 ? ' hour' : ' hours');

            var price = document.createElement('div');
            price.className = 'rental-tier-price';
            var priceCredits = tier.priceCredits != null ? tier.priceCredits : null;
            var priceGems = tier.priceGems != null ? tier.priceGems : null;
            var priceParts = [];
            if (priceCredits != null) priceParts.push('$' + parseFloat(priceCredits).toFixed(2) + ' credits');
            if (priceGems != null) priceParts.push(parseFloat(priceGems).toFixed(0) + ' gems');
            price.textContent = priceParts.join(' or ');

            info.appendChild(tierName);
            info.appendChild(price);

            var actions = document.createElement('div');
            actions.style.cssText = 'display:flex;flex-direction:column;gap:4px;align-items:flex-end;';

            function makeRentBtn(payWith, label) {
                var btn = document.createElement('button');
                btn.className = 'rental-tier-btn';
                btn.textContent = label;
                btn.addEventListener('click', function() {
                    btn.disabled = true;
                    btn.textContent = '...';
                    _doRent(gameId, tier.id, payWith, backdrop, btn);
                });
                return btn;
            }

            if (priceCredits != null) {
                actions.appendChild(makeRentBtn('credits', 'Rent ($' + parseFloat(priceCredits).toFixed(2) + ')'));
            }
            if (priceGems != null) {
                actions.appendChild(makeRentBtn('gems', 'Rent (' + parseFloat(priceGems).toFixed(0) + ' gems)'));
            }

            row.appendChild(info);
            row.appendChild(actions);
            modal.appendChild(row);
        });
    }

    backdrop.appendChild(modal);
    document.body.appendChild(backdrop);
}

function _doRent(gameId, tierId, payWith, backdrop, btn) {
    var token = localStorage.getItem(typeof STORAGE_KEY_TOKEN !== 'undefined' ? STORAGE_KEY_TOKEN : 'casinoToken');
    if (!token) {
        if (btn) { btn.disabled = false; btn.textContent = 'Rent Now'; }
        return;
    }

    fetch('/api/rentals/rent', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer ' + token
        },
        body: JSON.stringify({ gameId: gameId, tierId: tierId, payWith: payWith })
    })
    .then(function(res) { return res.json().then(function(d) { return { ok: res.ok, data: d }; }); })
    .then(function(result) {
        if (result.ok && result.data.success) {
            // Unlock the game in memory
            if (window._lockedGameIds) window._lockedGameIds.delete(gameId.toLowerCase());

            // Remove lock overlay from the card
            var card = document.querySelector('[data-game-id="' + gameId.toLowerCase() + '"]');
            if (card) {
                card.classList.remove('game-card--locked', 'game-card--rental-checked');
                var overlay = card.querySelector('.rental-overlay');
                if (overlay) card.removeChild(overlay);
            }

            // Update balance if returned
            if (result.data.newBalance !== undefined && typeof updateBalance === 'function') {
                balance = parseFloat(result.data.newBalance);
                updateBalance();
            }

            // Close modal and open the game
            if (backdrop && backdrop.parentNode) backdrop.parentNode.removeChild(backdrop);
            if (typeof openSlot === 'function') openSlot(gameId);
        } else {
            var errText = (result.data && result.data.error) ? result.data.error : 'Rental failed. Please try again.';
            if (btn) {
                btn.disabled = false;
                btn.textContent = 'Retry';
            }
            // Show error inline below the button
            var errEl = document.getElementById('rental-err-' + tierId);
            if (!errEl) {
                errEl = document.createElement('div');
                errEl.id = 'rental-err-' + tierId;
                errEl.style.cssText = 'font-size:0.72rem;color:#f87171;margin-top:4px;text-align:right;';
                if (btn && btn.parentNode) btn.parentNode.appendChild(errEl);
            }
            errEl.textContent = errText;
        }
    })
    .catch(function() {
        if (btn) { btn.disabled = false; btn.textContent = 'Retry'; }
    });
}

// Hook initRentalSystem into the renderGames chain (idempotent)
(function() {
    var _prevRGRental = typeof renderGames === 'function' ? renderGames : null;
    if (!_prevRGRental) return;
    renderGames = function() {
        _prevRGRental.apply(this, arguments);
        if (!window._rentalSystemInit) {
            window._rentalSystemInit = true;
            initRentalSystem();
        } else {
            // Re-apply overlays after each render (new cards may have been injected)
            applyRentalOverlays();
        }
    };
})();

// Expose for external callers
window.initRentalSystem = initRentalSystem;
window.applyRentalOverlays = applyRentalOverlays;
window.showRentModal = showRentModal;


// ── Game of the Day Banner ───────────────────────────────────────────────────
// Fetches /api/game-of-day and renders a banner above the game grid plus a
// badge on the featured game card with a live HH:MM:SS countdown.
function initGameOfDayBanner() {
    if (window._gameOfDayInit) return; window._gameOfDayInit = true;

    // Inject CSS once (guard by id)
    if (!document.getElementById('gotd-css')) {
        var style = document.createElement('style');
        style.id = 'gotd-css';
        style.textContent = [
            '#gameOfDayBanner{background:linear-gradient(135deg,#1a0a00 0%,#2d1a00 50%,#1a0a00 100%);',
            'border:1px solid rgba(251,191,36,0.5);border-radius:12px;padding:14px 18px;margin:0 0 14px 0;',
            'display:flex;align-items:center;gap:14px;font-family:inherit;position:relative;overflow:hidden;}',
            '#gameOfDayBanner::before{content:"";position:absolute;top:0;left:0;right:0;height:2px;',
            'background:linear-gradient(90deg,#f59e0b,#fde68a,#f59e0b);background-size:200%;',
            'animation:gotdShimmer 3s linear infinite;}',
            '@keyframes gotdShimmer{0%{background-position:0%}100%{background-position:200%}}',
            '.gotd-badge{position:absolute;top:6px;left:6px;',
            'background:linear-gradient(135deg,#d97706,#f59e0b);color:#fff;',
            'font-size:10px;font-weight:800;padding:3px 8px;border-radius:20px;z-index:5;}',
            '.gotd-featured{border:1px solid rgba(245,158,11,0.5) !important;',
            'box-shadow:0 0 12px rgba(245,158,11,0.2);}'
        ].join('');
        document.head.appendChild(style);
    }

    // Create banner element once (hidden until data loads)
    if (!document.getElementById('gameOfDayBanner')) {
        var banner = document.createElement('div');
        banner.id = 'gameOfDayBanner';
        banner.style.display = 'none';

        var gamesSection = document.getElementById('games-section')
            || document.getElementById('gamesContainer')
            || document.querySelector('.games-grid')
            || document.querySelector('.game-grid');
        if (gamesSection && gamesSection.parentNode) {
            gamesSection.parentNode.insertBefore(banner, gamesSection);
        } else {
            var main = document.getElementById('main-content')
                || document.getElementById('lobby')
                || document.querySelector('.lobby-content');
            if (main) main.appendChild(banner);
        }
    }

    _fetchGameOfDayBanner();
}

function _fetchGameOfDayBanner() {
    fetch('/api/game-of-day')
        .then(function(res) { return res.ok ? res.json() : null; })
        .then(function(data) {
            if (!data || !data.gameId) return;
            _renderGameOfDayBanner(data);
        })
        .catch(function() { /* silently ignore */ });
}

function _renderGameOfDayBanner(data) {
    var banner = document.getElementById('gameOfDayBanner');
    if (!banner) return;

    // Clear previous content
    while (banner.firstChild) banner.removeChild(banner.firstChild);

    // Icon
    var iconDiv = document.createElement('div');
    iconDiv.style.cssText = 'font-size:28px;flex-shrink:0;line-height:1;';
    iconDiv.textContent = '\u2B50'; // ⭐

    // Body
    var bodyDiv = document.createElement('div');
    bodyDiv.style.cssText = 'flex:1;min-width:0;';

    var labelDiv = document.createElement('div');
    labelDiv.style.cssText = 'font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:1.5px;color:#fbbf24;margin-bottom:3px;';
    labelDiv.textContent = '\u2B50 GAME OF THE DAY';

    var nameDiv = document.createElement('div');
    nameDiv.style.cssText = 'font-size:17px;font-weight:800;color:#fff;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-bottom:4px;';
    nameDiv.textContent = data.gameName || data.gameId;

    var countdownDiv = document.createElement('div');
    countdownDiv.id = 'gotd-countdown';
    countdownDiv.style.cssText = 'font-size:11px;color:rgba(255,255,255,0.5);';
    countdownDiv.textContent = 'Changes in --:--:--';

    bodyDiv.appendChild(labelDiv);
    bodyDiv.appendChild(nameDiv);
    bodyDiv.appendChild(countdownDiv);

    // Play button
    var playBtn = document.createElement('button');
    playBtn.style.cssText = 'flex-shrink:0;background:linear-gradient(135deg,#f59e0b,#d97706);border:none;border-radius:8px;color:#1a0a00;font-size:12px;font-weight:800;letter-spacing:.5px;padding:9px 16px;cursor:pointer;';
    playBtn.textContent = 'PLAY NOW';
    var _gotdGameId = data.gameId;
    playBtn.addEventListener('click', function() {
        if (typeof openSlot !== 'undefined') openSlot(_gotdGameId);
    });

    banner.appendChild(iconDiv);
    banner.appendChild(bodyDiv);
    banner.appendChild(playBtn);
    banner.style.display = 'flex';

    // Badge on the game card
    var prevBadge = document.querySelector('.gotd-badge');
    if (prevBadge) prevBadge.parentNode && prevBadge.parentNode.removeChild(prevBadge);

    var card = document.querySelector('.game-card[data-game-id="' + data.gameId + '"]');
    if (card) {
        if (getComputedStyle(card).position === 'static') card.style.position = 'relative';
        var badge = document.createElement('span');
        badge.className = 'gotd-badge';
        badge.textContent = '\u2B50 GAME OF THE DAY';
        card.appendChild(badge);
    }

    // Live countdown (HH:MM:SS) — clear any previous interval
    if (window._gameOfDayInterval) clearInterval(window._gameOfDayInterval);
    var remaining = Math.max(0, Number(data.secondsUntilNext) || 0);
    var deadline = Date.now() + remaining * 1000;

    function _updateCountdown() {
        var el = document.getElementById('gotd-countdown');
        if (!el) { clearInterval(window._gameOfDayInterval); return; }
        var diff = Math.max(0, Math.floor((deadline - Date.now()) / 1000));
        var hh = Math.floor(diff / 3600);
        var mm = Math.floor((diff % 3600) / 60);
        var ss = diff % 60;
        el.textContent = 'Changes in '
            + (hh < 10 ? '0' : '') + hh + ':'
            + (mm < 10 ? '0' : '') + mm + ':'
            + (ss < 10 ? '0' : '') + ss;
        if (diff === 0) clearInterval(window._gameOfDayInterval);
    }

    _updateCountdown();
    window._gameOfDayInterval = setInterval(_updateCountdown, 1000);
}


// ── Featured Game Highlights ─────────────────────────────────────────────────
// Fetches /api/game-of-day/featured and applies a subtle gold border+glow to
// the top-6 most profitable game cards.
function applyFeaturedGameHighlights() {
    if (window._featuredHighlightsApplied) return; window._featuredHighlightsApplied = true;

    fetch('/api/game-of-day/featured')
        .then(function(res) { return res.ok ? res.json() : null; })
        .then(function(data) {
            if (!Array.isArray(data)) return;
            // Remove stale highlights first
            var prev = document.querySelectorAll('.gotd-featured');
            for (var i = 0; i < prev.length; i++) {
                prev[i].classList.remove('gotd-featured');
            }
            // Apply to returned game IDs
            for (var j = 0; j < data.length; j++) {
                var gid = data[j];
                if (!gid) continue;
                var card = document.querySelector('.game-card[data-game-id="' + gid + '"]');
                if (card) card.classList.add('gotd-featured');
            }
        })
        .catch(function() { /* silently ignore */ });
}


// ── Instant Games Section ─────────────────────────────────────────────────────
// Renders a lobby section with quick-play instant game cards.
// Entirely DOM-built (no dynamic innerHTML) to comply with CSP hook rules.
function renderInstantGamesSection() {
    return;
}

// Show a temporary toast for instant game selection.
function _showInstantGameToast(gameName) {
    if (typeof showToast === 'function') {
        showToast('\uD83C\uDFAE ' + gameName + ' — tap a slot to play!', 'info', 2500);
    }
}

// ── Weekly Leaderboard Widget ──────────────────────────────────────────────────
// Fetches /api/leaderboard/weekly (public, no auth) and renders a top-10 wager
// race table below the instant games section. All DOM built via createElement
// (no dynamic innerHTML) to comply with CSP hook rules.
function renderWeeklyLeaderboard() {
    // Idempotency guard
    if (document.getElementById('weeklyLeaderboardSection')) return;

    // Inject CSS once
    if (!document.getElementById('weekly-lb-css')) {
        var styleEl = document.createElement('style');
        styleEl.id = 'weekly-lb-css';
        styleEl.textContent = [
            '#weeklyLeaderboardSection {',
            '  border-top: 2px solid #f0a500;',
            '  margin: 32px 0 0;',
            '  padding: 24px 0;',
            '}',
            '#weeklyLeaderboardSection .wlb-header {',
            '  color: #f0a500;',
            '  font-size: 1.3rem;',
            '  font-weight: bold;',
            '  margin: 0 0 4px;',
            '}',
            '#weeklyLeaderboardSection .wlb-subheader {',
            '  color: #999;',
            '  font-size: 0.82rem;',
            '  margin: 0 0 14px;',
            '}',
            '#weeklyLeaderboardSection .wlb-row {',
            '  display: flex;',
            '  justify-content: space-between;',
            '  align-items: center;',
            '  padding: 8px 0;',
            '  border-bottom: 1px solid #222;',
            '}',
            '#weeklyLeaderboardSection .wlb-rank {',
            '  font-size: 1.2rem;',
            '  min-width: 32px;',
            '}',
            '#weeklyLeaderboardSection .wlb-user {',
            '  color: #ddd;',
            '  flex: 1;',
            '  padding: 0 8px;',
            '}',
            '#weeklyLeaderboardSection .wlb-wagered {',
            '  color: #f0a500;',
            '  font-weight: bold;',
            '}',
            '#weeklyLeaderboardSection .wlb-spins {',
            '  color: #888;',
            '  font-size: 0.8rem;',
            '  margin-left: 8px;',
            '}',
            '#weeklyLeaderboardSection .wlb-empty {',
            '  color: #666;',
            '  font-size: 0.9rem;',
            '  padding: 16px 0;',
            '}',
            '#weeklyLeaderboardSection .wlb-footer {',
            '  color: #666;',
            '  font-size: 0.75rem;',
            '  margin-top: 12px;',
            '}'
        ].join('\n');
        document.head.appendChild(styleEl);
    }

    fetch('/api/leaderboard/weekly')
        .then(function(res) { return res.json(); })
        .then(function(data) {
            var entries = (data && Array.isArray(data.entries)) ? data.entries : [];

            // Build section wrapper
            var section = document.createElement('div');
            section.id = 'weeklyLeaderboardSection';

            // Header
            var header = document.createElement('h2');
            header.className = 'wlb-header';
            header.textContent = '\uD83C\uDFC6 Weekly Wager Race';
            section.appendChild(header);

            // Sub-header
            var sub = document.createElement('p');
            sub.className = 'wlb-subheader';
            sub.textContent = 'Top players by total wagered this week';
            section.appendChild(sub);

            if (entries.length === 0) {
                // Empty state
                var emptyEl = document.createElement('p');
                emptyEl.className = 'wlb-empty';
                emptyEl.textContent = 'No data yet \u2014 start spinning!';
                section.appendChild(emptyEl);
            } else {
                // Medal map
                var medals = ['\uD83E\uDD47', '\uD83E\uDD48', '\uD83E\uDD49'];

                // Render up to top 10 rows
                var limit = Math.min(entries.length, 10);
                for (var i = 0; i < limit; i++) {
                    var entry = entries[i];

                    var row = document.createElement('div');
                    row.className = 'wlb-row';

                    var rankEl = document.createElement('span');
                    rankEl.className = 'wlb-rank';
                    rankEl.textContent = i < 3 ? medals[i] : String(entry.rank);
                    row.appendChild(rankEl);

                    var userEl = document.createElement('span');
                    userEl.className = 'wlb-user';
                    userEl.textContent = entry.maskedUser;
                    row.appendChild(userEl);

                    var wageredEl = document.createElement('span');
                    wageredEl.className = 'wlb-wagered';
                    wageredEl.textContent = '$' + Number(entry.totalWagered).toFixed(2);
                    row.appendChild(wageredEl);

                    var spinsEl = document.createElement('span');
                    spinsEl.className = 'wlb-spins';
                    spinsEl.textContent = entry.spinCount + ' spins';
                    row.appendChild(spinsEl);

                    section.appendChild(row);
                }
            }

            // Footer note
            var footer = document.createElement('p');
            footer.className = 'wlb-footer';
            footer.textContent = 'Resets every Monday at 00:00 UTC';
            section.appendChild(footer);

            // Inject after instantGamesSection if present, otherwise after allGames parent
            var anchor = document.getElementById('instantGamesSection');
            if (anchor && anchor.parentNode) {
                anchor.parentNode.insertBefore(section, anchor.nextSibling);
            } else {
                var allGamesEl = document.getElementById('allGames');
                var insertParent = allGamesEl
                    ? (allGamesEl.parentNode || document.getElementById('lobby'))
                    : document.getElementById('lobby');
                if (insertParent) {
                    insertParent.appendChild(section);
                }
            }
        })
        .catch(function() {
            // Silently fail — no widget shown on network error
        });
}

function renderBoostsWidget() {
    // Idempotency guard
    if (document.getElementById('boostsWidget')) return;

    // Auth guard
    if (typeof isServerAuthToken !== 'function' || !isServerAuthToken()) return;
    var token = localStorage.getItem(typeof STORAGE_KEY_TOKEN !== 'undefined' ? STORAGE_KEY_TOKEN : 'casinoToken');
    if (!token) return;

    // Inject CSS once (static string only)
    if (!document.getElementById('boosts-widget-css')) {
        var s = document.createElement('style');
        s.id = 'boosts-widget-css';
        s.textContent = '#boostsWidget{margin:24px 0;padding:0 8px}.boosts-header{font-size:1.4rem;font-weight:700;color:#ffe066;margin-bottom:4px}.boosts-subheader{font-size:.85rem;color:#aaa;margin-bottom:16px}.boosts-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:14px}.boost-card{background:linear-gradient(135deg,#1a1a2e 0%,#16213e 100%);border:1px solid #3a3a5c;border-radius:12px;padding:16px;display:flex;flex-direction:column;gap:8px;transition:border-color .2s,transform .15s}.boost-card:hover{border-color:#7c6cf0;transform:translateY(-2px)}.boost-name{font-size:1rem;font-weight:700;color:#e0d7ff}.boost-desc{font-size:.78rem;color:#aaa;flex:1}.boost-duration{font-size:.75rem;color:#7c6cf0;font-weight:600}.boost-buy-btn{margin-top:6px;background:linear-gradient(90deg,#7c6cf0,#a855f7);border:none;border-radius:8px;color:#fff;font-size:.82rem;font-weight:700;padding:8px 10px;cursor:pointer;transition:opacity .15s}.boost-buy-btn:hover{opacity:.85}.boost-buy-btn:disabled{opacity:.4;cursor:not-allowed}.boosts-loading{color:#888;font-size:.9rem;padding:12px 0}';
        document.head.appendChild(s);
    }

    // Build widget skeleton
    var widget = document.createElement('div');
    widget.id = 'boostsWidget';

    var hdr = document.createElement('h2');
    hdr.className = 'boosts-header';
    hdr.textContent = '\u26A1 Boosts Shop';
    widget.appendChild(hdr);

    var sub = document.createElement('p');
    sub.className = 'boosts-subheader';
    sub.textContent = 'Activate temporary power-ups using your gems';
    widget.appendChild(sub);

    var grid = document.createElement('div');
    grid.className = 'boosts-grid';

    var loadingEl = document.createElement('p');
    loadingEl.className = 'boosts-loading';
    loadingEl.textContent = 'Loading boosts\u2026';
    grid.appendChild(loadingEl);
    widget.appendChild(grid);

    // Insert after weeklyLeaderboardSection if present, else after instantGamesSection, else into lobby
    var anchor = document.getElementById('weeklyLeaderboardSection') || document.getElementById('instantGamesSection');
    if (anchor && anchor.parentNode) {
        anchor.parentNode.insertBefore(widget, anchor.nextSibling);
    } else {
        var lobby = document.getElementById('lobby');
        if (lobby) lobby.appendChild(widget);
    }

    // Fetch available boosts
    fetch('/api/boosts/available', {
        headers: { 'Authorization': 'Bearer ' + token }
    })
    .then(function(res) { return res.json(); })
    .then(function(data) {
        // Clear grid children without innerHTML
        while (grid.firstChild) {
            grid.removeChild(grid.firstChild);
        }

        var boosts = (data && Array.isArray(data.boosts)) ? data.boosts : [];

        if (boosts.length === 0) {
            var emptyEl = document.createElement('p');
            emptyEl.className = 'boosts-loading';
            emptyEl.textContent = 'No boosts available right now.';
            grid.appendChild(emptyEl);
            return;
        }

        boosts.forEach(function(boost) {
            var card = document.createElement('div');
            card.className = 'boost-card';

            var nameEl = document.createElement('div');
            nameEl.className = 'boost-name';
            nameEl.textContent = boost.name || boost.type || '';
            card.appendChild(nameEl);

            var descEl = document.createElement('div');
            descEl.className = 'boost-desc';
            descEl.textContent = boost.desc || '';
            card.appendChild(descEl);

            var durEl = document.createElement('div');
            durEl.className = 'boost-duration';
            durEl.textContent = String(boost.duration || 0) + ' min';
            card.appendChild(durEl);

            var btn = document.createElement('button');
            btn.className = 'boost-buy-btn';
            btn.type = 'button';
            // Cost label: gem emoji + cost
            var gemSpan = document.createElement('span');
            gemSpan.textContent = '\uD83D\uDC8E ';
            btn.appendChild(gemSpan);
            var costText = document.createTextNode(String(boost.gemCost || 0) + ' gems');
            btn.appendChild(costText);

            (function(b, button) {
                button.addEventListener('click', function() {
                    button.disabled = true;
                    fetch('/api/boosts/purchase', {
                        method: 'POST',
                        headers: {
                            'Authorization': 'Bearer ' + token,
                            'Content-Type': 'application/json'
                        },
                        body: JSON.stringify({ boostType: b.type })
                    })
                    .then(function(res) { return res.json(); })
                    .then(function(result) {
                        if (result && result.success) {
                            var boostName = (result.boost && result.boost.name) ? result.boost.name : (b.name || b.type || 'Boost');
                            var dur = b.duration || 0;
                            var msg = '\u2705 ' + boostName + ' activated for ' + String(dur) + 'min!';
                            if (typeof showToast === 'function') {
                                showToast(msg);
                            }
                        } else {
                            var errMsg = (result && result.message) ? result.message : 'Purchase failed';
                            if (typeof showToast === 'function') {
                                showToast('\u274C ' + errMsg);
                            }
                        }
                        button.disabled = false;
                    })
                    .catch(function() {
                        if (typeof showToast === 'function') {
                            showToast('\u274C Could not purchase boost');
                        }
                        button.disabled = false;
                    });
                });
            }(boost, btn));

            card.appendChild(btn);
            grid.appendChild(card);
        });
    })
    .catch(function() {
        // Silently fail — remove widget if fetch errors
        if (widget.parentNode) widget.parentNode.removeChild(widget);
    });
}

// ── Mines Mini-Game Widget ──────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════
// ══════════════════════════════════════════════════════════════════════════════
// Roulette widget removed (slots only)\n


// ═══════════════════════════════════════════════════════
// ═══════════════════════════════════════════════════════
// BIG SIX WHEEL WIDGET
// ═══════════════════════════════════════════════════════

function renderBigSixWheelWidget() {
    // Idempotency guard
    if (document.getElementById('bigSixWheelWidget')) return;

    // Auth gate
    if (typeof isServerAuthToken !== 'function' || !isServerAuthToken()) return;
    var token = localStorage.getItem(typeof STORAGE_KEY_TOKEN !== 'undefined' ? STORAGE_KEY_TOKEN : 'casinoToken');
    if (!token) return;

    // CSS injection with ID guard
    if (!document.getElementById('big-six-wheel-css')) {
        var styleEl = document.createElement('style');
        styleEl.id = 'big-six-wheel-css';
        styleEl.textContent = [
            '.bsw-widget { background: linear-gradient(135deg, #1a0a2e 0%, #2d1b4e 40%, #1a0a2e 100%); border: 2px solid #d4a017; border-radius: 16px; padding: 20px; margin-bottom: 24px; position: relative; overflow: hidden; }',
            '.bsw-widget::before { content: ""; position: absolute; top: 0; left: 0; right: 0; bottom: 0; background: radial-gradient(ellipse at 50% 0%, rgba(212,160,23,0.15) 0%, transparent 60%); pointer-events: none; }',
            '.bsw-header { display: flex; align-items: center; justify-content: center; gap: 10px; margin-bottom: 16px; position: relative; z-index: 1; }',
            '.bsw-title { font-size: 22px; font-weight: 800; color: #f5d76e; text-shadow: 0 2px 8px rgba(212,160,23,0.5); letter-spacing: 1px; }',
            '.bsw-subtitle { text-align: center; color: #c9a0dc; font-size: 13px; margin-bottom: 14px; position: relative; z-index: 1; }',
            '.bsw-segments { display: grid; grid-template-columns: repeat(auto-fit, minmax(110px, 1fr)); gap: 10px; margin-bottom: 16px; position: relative; z-index: 1; }',
            '.bsw-seg { background: rgba(255,255,255,0.06); border: 1px solid rgba(212,160,23,0.3); border-radius: 10px; padding: 10px 8px; text-align: center; transition: all 0.3s ease; cursor: default; }',
            '.bsw-seg:hover { border-color: #d4a017; background: rgba(212,160,23,0.12); transform: translateY(-2px); }',
            '.bsw-seg.bsw-winner { border-color: #4caf50; background: rgba(76,175,80,0.2); box-shadow: 0 0 16px rgba(76,175,80,0.4); }',
            '.bsw-seg.bsw-loser { opacity: 0.5; }',
            '.bsw-seg-label { font-size: 18px; font-weight: 700; margin-bottom: 2px; }',
            '.bsw-seg-payout { font-size: 11px; color: #aaa; margin-bottom: 6px; }',
            '.bsw-seg-input { width: 70px; background: rgba(0,0,0,0.4); border: 1px solid rgba(212,160,23,0.4); border-radius: 6px; color: #f5d76e; font-size: 13px; padding: 5px 6px; text-align: center; outline: none; }',
            '.bsw-seg-input:focus { border-color: #f5d76e; box-shadow: 0 0 6px rgba(245,215,110,0.3); }',
            '.bsw-seg-input::placeholder { color: rgba(245,215,110,0.3); }',
            '.bsw-controls { display: flex; align-items: center; justify-content: center; gap: 14px; margin-bottom: 14px; flex-wrap: wrap; position: relative; z-index: 1; }',
            '.bsw-total { color: #c9a0dc; font-size: 13px; }',
            '.bsw-total-val { color: #f5d76e; font-weight: 700; }',
            '.bsw-spin-btn { background: linear-gradient(180deg, #d4a017 0%, #b8860b 100%); color: #1a0a2e; font-weight: 800; font-size: 16px; padding: 10px 36px; border: none; border-radius: 10px; cursor: pointer; text-transform: uppercase; letter-spacing: 1px; transition: all 0.2s ease; box-shadow: 0 4px 12px rgba(212,160,23,0.4); }',
            '.bsw-spin-btn:hover:not(:disabled) { transform: translateY(-2px); box-shadow: 0 6px 16px rgba(212,160,23,0.6); background: linear-gradient(180deg, #e6b422 0%, #d4a017 100%); }',
            '.bsw-spin-btn:disabled { opacity: 0.5; cursor: not-allowed; transform: none; }',
            '.bsw-spin-btn.bsw-spinning { animation: bsw-pulse 0.6s ease-in-out infinite; }',
            '@keyframes bsw-pulse { 0%,100% { transform: scale(1); } 50% { transform: scale(1.05); } }',
            '.bsw-clear-btn { background: rgba(255,255,255,0.08); color: #aaa; border: 1px solid rgba(255,255,255,0.15); border-radius: 8px; padding: 8px 16px; font-size: 12px; cursor: pointer; transition: all 0.2s ease; }',
            '.bsw-clear-btn:hover { background: rgba(255,255,255,0.15); color: #fff; }',
            '.bsw-result { text-align: center; min-height: 80px; position: relative; z-index: 1; }',
            '.bsw-result-wheel { font-size: 48px; margin-bottom: 6px; transition: transform 0.6s ease; }',
            '.bsw-result-wheel.bsw-anim { animation: bsw-wheel-spin 1.2s cubic-bezier(0.2,0.8,0.3,1); }',
            '@keyframes bsw-wheel-spin { 0% { transform: rotate(0deg) scale(0.8); opacity: 0.3; } 60% { transform: rotate(720deg) scale(1.2); } 100% { transform: rotate(1080deg) scale(1); opacity: 1; } }',
            '.bsw-result-label { font-size: 20px; font-weight: 700; margin-bottom: 4px; }',
            '.bsw-result-label.bsw-win { color: #4caf50; text-shadow: 0 0 10px rgba(76,175,80,0.5); }',
            '.bsw-result-label.bsw-lose { color: #e57373; }',
            '.bsw-result-detail { font-size: 13px; color: #aaa; }',
            '.bsw-result-profit { font-size: 15px; font-weight: 700; margin-top: 4px; }',
            '.bsw-result-profit.bsw-pos { color: #4caf50; }',
            '.bsw-result-profit.bsw-neg { color: #e57373; }',
            '.bsw-history { display: flex; gap: 4px; justify-content: center; flex-wrap: wrap; margin-top: 10px; position: relative; z-index: 1; }',
            '.bsw-history-dot { width: 24px; height: 24px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 9px; font-weight: 700; color: #fff; border: 1px solid rgba(255,255,255,0.2); }',
            '.bsw-quick-chips { display: flex; gap: 6px; justify-content: center; margin-bottom: 10px; position: relative; z-index: 1; }',
            '.bsw-chip { background: rgba(212,160,23,0.15); border: 1px solid rgba(212,160,23,0.4); border-radius: 20px; padding: 4px 12px; color: #f5d76e; font-size: 11px; font-weight: 600; cursor: pointer; transition: all 0.2s ease; }',
            '.bsw-chip:hover { background: rgba(212,160,23,0.3); transform: scale(1.05); }'
        ].join('\n');
        document.head.appendChild(styleEl);
    }

    // Segment configuration
    var segments = [
        { id: '1', label: '$1', payout: '1:1', color: '#e74c3c', count: 24 },
        { id: '2', label: '$2', payout: '2:1', color: '#3498db', count: 15 },
        { id: '5', label: '$5', payout: '5:1', color: '#2ecc71', count: 7 },
        { id: '10', label: '$10', payout: '10:1', color: '#9b59b6', count: 4 },
        { id: '20', label: '$20', payout: '20:1', color: '#f39c12', count: 2 },
        { id: 'joker', label: 'JOKER', payout: '45:1', color: '#e91e63', count: 1 },
        { id: 'logo', label: 'LOGO', payout: '45:1', color: '#00bcd4', count: 1 }
    ];

    var _bswSpinning = false;
    var _bswHistory = [];

    // Build widget container
    var widget = document.createElement('div');
    widget.className = 'bsw-widget';
    widget.id = 'bigSixWheelWidget';

    // Header
    var header = document.createElement('div');
    header.className = 'bsw-header';
    var titleEl = document.createElement('span');
    titleEl.className = 'bsw-title';
    titleEl.textContent = '\uD83C\uDFA1 Big Six Wheel';
    header.appendChild(titleEl);
    widget.appendChild(header);

    // Subtitle
    var subtitle = document.createElement('div');
    subtitle.className = 'bsw-subtitle';
    subtitle.textContent = 'Place bets on segments \u2022 54 slots \u2022 Min $0.25 \u2022 Max $500';
    widget.appendChild(subtitle);

    // Quick chip buttons
    var quickChips = document.createElement('div');
    quickChips.className = 'bsw-quick-chips';
    var chipValues = [0.25, 1, 5, 10, 25];
    var inputEls = {};

    chipValues.forEach(function(val) {
        var chip = document.createElement('button');
        chip.className = 'bsw-chip';
        chip.textContent = typeof formatMoney === 'function' ? formatMoney(val) : '$' + val.toFixed(2);
        chip.addEventListener('click', function() {
            segments.forEach(function(seg) {
                var inp = inputEls[seg.id];
                if (inp) {
                    var cur = parseFloat(inp.value) || 0;
                    var next = Math.min(500, cur + val);
                    inp.value = next > 0 ? next.toFixed(2) : '';
                }
            });
            updateTotalBet();
        });
        quickChips.appendChild(chip);
    });
    widget.appendChild(quickChips);

    // Segments grid
    var segGrid = document.createElement('div');
    segGrid.className = 'bsw-segments';

    segments.forEach(function(seg) {
        var segEl = document.createElement('div');
        segEl.className = 'bsw-seg';
        segEl.setAttribute('data-seg', seg.id);

        var lbl = document.createElement('div');
        lbl.className = 'bsw-seg-label';
        lbl.style.color = seg.color;
        lbl.textContent = seg.label;
        segEl.appendChild(lbl);

        var payoutInfo = document.createElement('div');
        payoutInfo.className = 'bsw-seg-payout';
        payoutInfo.textContent = seg.payout + ' (' + seg.count + ' slots)';
        segEl.appendChild(payoutInfo);

        var inp = document.createElement('input');
        inp.type = 'number';
        inp.className = 'bsw-seg-input';
        inp.placeholder = '$0.00';
        inp.min = '0';
        inp.max = '500';
        inp.step = '0.25';
        inp.addEventListener('input', function() { updateTotalBet(); });
        segEl.appendChild(inp);
        inputEls[seg.id] = inp;

        segGrid.appendChild(segEl);
    });
    widget.appendChild(segGrid);

    // Controls row
    var controls = document.createElement('div');
    controls.className = 'bsw-controls';

    var totalDisplay = document.createElement('span');
    totalDisplay.className = 'bsw-total';
    totalDisplay.textContent = 'Total Bet: ';
    var totalVal = document.createElement('span');
    totalVal.className = 'bsw-total-val';
    totalVal.textContent = '$0.00';
    totalDisplay.appendChild(totalVal);
    controls.appendChild(totalDisplay);

    var spinBtn = document.createElement('button');
    spinBtn.className = 'bsw-spin-btn';
    spinBtn.textContent = 'SPIN';
    spinBtn.disabled = true;
    controls.appendChild(spinBtn);

    var clearBtn = document.createElement('button');
    clearBtn.className = 'bsw-clear-btn';
    clearBtn.textContent = 'Clear Bets';
    controls.appendChild(clearBtn);

    widget.appendChild(controls);

    // Result area
    var resultArea = document.createElement('div');
    resultArea.className = 'bsw-result';

    var resultWheel = document.createElement('div');
    resultWheel.className = 'bsw-result-wheel';
    resultWheel.textContent = '\uD83C\uDFA1';
    resultArea.appendChild(resultWheel);

    var resultLabel = document.createElement('div');
    resultLabel.className = 'bsw-result-label';
    resultArea.appendChild(resultLabel);

    var resultDetail = document.createElement('div');
    resultDetail.className = 'bsw-result-detail';
    resultArea.appendChild(resultDetail);

    var resultProfit = document.createElement('div');
    resultProfit.className = 'bsw-result-profit';
    resultArea.appendChild(resultProfit);

    widget.appendChild(resultArea);

    // History row
    var historyRow = document.createElement('div');
    historyRow.className = 'bsw-history';
    widget.appendChild(historyRow);

    // --- Helper functions ---

    function updateTotalBet() {
        var total = 0;
        segments.forEach(function(seg) {
            var val = parseFloat(inputEls[seg.id].value) || 0;
            total += val;
        });
        totalVal.textContent = typeof formatMoney === 'function' ? formatMoney(total) : '$' + total.toFixed(2);
        spinBtn.disabled = total <= 0 || _bswSpinning;
    }

    function getBets() {
        var bets = {};
        var hasBet = false;
        segments.forEach(function(seg) {
            var val = parseFloat(inputEls[seg.id].value) || 0;
            if (val > 0) {
                bets[seg.id] = val;
                hasBet = true;
            }
        });
        return hasBet ? bets : null;
    }

    function highlightResult(winnerId) {
        var segEls = segGrid.querySelectorAll('.bsw-seg');
        for (var i = 0; i < segEls.length; i++) {
            var sid = segEls[i].getAttribute('data-seg');
            if (sid === winnerId) {
                segEls[i].classList.add('bsw-winner');
                segEls[i].classList.remove('bsw-loser');
            } else {
                segEls[i].classList.remove('bsw-winner');
                segEls[i].classList.add('bsw-loser');
            }
        }
    }

    function clearHighlights() {
        var segEls = segGrid.querySelectorAll('.bsw-seg');
        for (var i = 0; i < segEls.length; i++) {
            segEls[i].classList.remove('bsw-winner', 'bsw-loser');
        }
    }

    function getSegmentConfig(id) {
        for (var i = 0; i < segments.length; i++) {
            if (segments[i].id === id) return segments[i];
        }
        return null;
    }

    function addToHistory(segId) {
        _bswHistory.push(segId);
        if (_bswHistory.length > 20) _bswHistory.shift();
        renderHistory();
    }

    function renderHistory() {
        while (historyRow.firstChild) historyRow.removeChild(historyRow.firstChild);
        _bswHistory.forEach(function(sid) {
            var cfg = getSegmentConfig(sid);
            if (!cfg) return;
            var dot = document.createElement('div');
            dot.className = 'bsw-history-dot';
            dot.style.background = cfg.color;
            dot.textContent = cfg.label.replace('$', '');
            dot.title = cfg.label + ' (' + cfg.payout + ')';
            historyRow.appendChild(dot);
        });
    }

    function fmtMoney(x) {
        return typeof formatMoney === 'function' ? formatMoney(x) : '$' + x.toFixed(2);
    }

    // --- Event handlers ---

    clearBtn.addEventListener('click', function() {
        segments.forEach(function(seg) {
            inputEls[seg.id].value = '';
        });
        updateTotalBet();
        clearHighlights();
        resultLabel.textContent = '';
        resultDetail.textContent = '';
        resultProfit.textContent = '';
        resultLabel.className = 'bsw-result-label';
        resultProfit.className = 'bsw-result-profit';
    });

    spinBtn.addEventListener('click', function() {
        if (_bswSpinning) return;
        var bets = getBets();
        if (!bets) return;

        // Validate individual bets
        var invalid = false;
        Object.keys(bets).forEach(function(key) {
            if (bets[key] < 0.25) { invalid = true; }
            if (bets[key] > 500) { invalid = true; }
        });
        if (invalid) {
            resultLabel.textContent = 'Bet must be $0.25 \u2013 $500 per segment';
            resultLabel.className = 'bsw-result-label bsw-lose';
            return;
        }

        _bswSpinning = true;
        spinBtn.disabled = true;
        spinBtn.classList.add('bsw-spinning');
        spinBtn.textContent = 'SPINNING...';
        clearHighlights();

        // Animate wheel icon
        resultWheel.classList.remove('bsw-anim');
        void resultWheel.offsetWidth; // reflow
        resultWheel.classList.add('bsw-anim');
        resultLabel.textContent = '';
        resultDetail.textContent = '';
        resultProfit.textContent = '';
        resultLabel.className = 'bsw-result-label';
        resultProfit.className = 'bsw-result-profit';

        var currentToken = localStorage.getItem(typeof STORAGE_KEY_TOKEN !== 'undefined' ? STORAGE_KEY_TOKEN : 'casinoToken');

        fetch('/api/bigsixwheel/spin', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': 'Bearer ' + currentToken
            },
            body: JSON.stringify({ bets: bets })
        })
        .then(function(res) {
            if (!res.ok) {
                return res.json().then(function(errData) {
                    throw new Error(errData.error || 'Spin failed');
                });
            }
            return res.json();
        })
        .then(function(data) {
            _bswSpinning = false;
            spinBtn.disabled = false;
            spinBtn.classList.remove('bsw-spinning');
            spinBtn.textContent = 'SPIN';

            // Delay result display for animation
            setTimeout(function() {
                var segCfg = getSegmentConfig(data.result);
                var segLabel = segCfg ? segCfg.label : data.label || data.result;
                var segColor = segCfg ? segCfg.color : '#f5d76e';

                // Highlight winning segment
                highlightResult(data.result);

                // Add to history
                addToHistory(data.result);

                // Show result
                var isWin = data.winAmount > 0;
                resultLabel.textContent = 'Landed on: ' + segLabel;
                resultLabel.className = 'bsw-result-label ' + (isWin ? 'bsw-win' : 'bsw-lose');
                resultLabel.style.color = segColor;

                var totalBet = data.totalBet || 0;
                resultDetail.textContent = 'Bet: ' + fmtMoney(totalBet) + ' \u2022 Win: ' + fmtMoney(data.winAmount || 0);

                var profit = (data.profit !== undefined) ? data.profit : ((data.winAmount || 0) - totalBet);
                if (profit > 0) {
                    resultProfit.textContent = '+' + fmtMoney(profit);
                    resultProfit.className = 'bsw-result-profit bsw-pos';
                } else if (profit < 0) {
                    resultProfit.textContent = '-' + fmtMoney(Math.abs(profit));
                    resultProfit.className = 'bsw-result-profit bsw-neg';
                } else {
                    resultProfit.textContent = 'Push';
                    resultProfit.className = 'bsw-result-profit';
                }

                // Update balance
                if (data.newBalance !== undefined && typeof updateBalanceDisplay === 'function') {
                    updateBalanceDisplay(data.newBalance);
                }

                // Sound feedback
                if (isWin && typeof SoundManager !== 'undefined' && typeof SoundManager.playSoundEvent === 'function') {
                    SoundManager.playSoundEvent('win');
                }

                // Re-enable spin based on current bets
                updateTotalBet();
            }, 1300);
        })
        .catch(function(err) {
            _bswSpinning = false;
            spinBtn.disabled = false;
            spinBtn.classList.remove('bsw-spinning');
            spinBtn.textContent = 'SPIN';
            resultLabel.textContent = err.message || 'Network error';
            resultLabel.className = 'bsw-result-label bsw-lose';
            updateTotalBet();
        });
    });

    // Insert into lobby
    var gamesGrid = document.querySelector('.games-grid');
    if (!gamesGrid || !gamesGrid.parentNode) return;
    gamesGrid.parentNode.insertBefore(widget, gamesGrid);
}


// ═══════════════════════════════════════════════════════
/**
 * renderGameStatsWidget — Hot & Cold Games widget
 * Fetches server-side game stats (RTP, spin counts) and displays
 * the top 5 hottest (highest RTP) and top 5 coldest (lowest RTP) games
 * in a compact lobby widget with play buttons.
 */
function renderGameStatsWidget() {
    // Auth gate
    if (typeof isServerAuthToken !== 'function' || !isServerAuthToken()) return;
    var token = localStorage.getItem(typeof STORAGE_KEY_TOKEN !== 'undefined' ? STORAGE_KEY_TOKEN : 'casinoToken');
    if (!token) return;

    // Idempotency
    if (document.getElementById('gameStatsWidget')) return;

    // Inject styles (once)
    if (!document.getElementById('gameStatsWidgetStyles')) {
        var styleEl = document.createElement('style');
        styleEl.id = 'gameStatsWidgetStyles';
        styleEl.textContent = [
            '.gsw-container {',
            '  background: linear-gradient(135deg, #1a1a2e 0%, #16213e 50%, #1a1a2e 100%);',
            '  border: 1px solid rgba(255, 255, 255, 0.08);',
            '  border-radius: 16px;',
            '  padding: 20px;',
            '  margin-bottom: 20px;',
            '  box-shadow: 0 8px 32px rgba(0,0,0,0.4);',
            '  position: relative;',
            '  overflow: hidden;',
            '}',
            '.gsw-container::before {',
            '  content: "";',
            '  position: absolute;',
            '  top: 0; left: 0; right: 0;',
            '  height: 3px;',
            '  background: linear-gradient(90deg, #ff4500, #ff8c00, #00bfff, #1e90ff);',
            '}',
            '.gsw-title {',
            '  font-size: 20px;',
            '  font-weight: 700;',
            '  color: #fff;',
            '  margin: 0 0 16px 0;',
            '  text-align: center;',
            '  letter-spacing: 0.5px;',
            '}',
            '.gsw-sections {',
            '  display: flex;',
            '  gap: 16px;',
            '}',
            '@media (max-width: 700px) {',
            '  .gsw-sections { flex-direction: column; }',
            '}',
            '.gsw-section {',
            '  flex: 1;',
            '  border-radius: 12px;',
            '  padding: 14px;',
            '  min-width: 0;',
            '}',
            '.gsw-section--hot {',
            '  background: linear-gradient(180deg, rgba(255,69,0,0.12) 0%, rgba(255,140,0,0.06) 100%);',
            '  border: 1px solid rgba(255,69,0,0.25);',
            '}',
            '.gsw-section--cold {',
            '  background: linear-gradient(180deg, rgba(0,191,255,0.12) 0%, rgba(30,144,255,0.06) 100%);',
            '  border: 1px solid rgba(0,191,255,0.25);',
            '}',
            '.gsw-section-title {',
            '  font-size: 15px;',
            '  font-weight: 700;',
            '  margin: 0 0 10px 0;',
            '  padding-bottom: 8px;',
            '  border-bottom: 1px solid rgba(255,255,255,0.08);',
            '}',
            '.gsw-section--hot .gsw-section-title { color: #ff8c00; }',
            '.gsw-section--cold .gsw-section-title { color: #00bfff; }',
            '.gsw-entry {',
            '  display: flex;',
            '  align-items: center;',
            '  gap: 8px;',
            '  padding: 6px 0;',
            '  border-bottom: 1px solid rgba(255,255,255,0.04);',
            '}',
            '.gsw-entry:last-child { border-bottom: none; }',
            '.gsw-rank {',
            '  font-size: 12px;',
            '  font-weight: 700;',
            '  color: rgba(255,255,255,0.35);',
            '  width: 18px;',
            '  text-align: center;',
            '  flex-shrink: 0;',
            '}',
            '.gsw-name {',
            '  flex: 1;',
            '  min-width: 0;',
            '  overflow: hidden;',
            '  text-overflow: ellipsis;',
            '  white-space: nowrap;',
            '  font-size: 13px;',
            '  font-weight: 500;',
            '  color: #e0e0e0;',
            '  cursor: pointer;',
            '  transition: color 0.2s;',
            '}',
            '.gsw-name:hover { color: #fff; text-decoration: underline; }',
            '.gsw-rtp-bar-wrap {',
            '  width: 60px;',
            '  height: 8px;',
            '  background: rgba(255,255,255,0.08);',
            '  border-radius: 4px;',
            '  overflow: hidden;',
            '  flex-shrink: 0;',
            '}',
            '.gsw-rtp-bar {',
            '  height: 100%;',
            '  border-radius: 4px;',
            '  transition: width 0.6s ease;',
            '}',
            '.gsw-rtp-bar--green { background: linear-gradient(90deg, #4caf50, #66bb6a); }',
            '.gsw-rtp-bar--yellow { background: linear-gradient(90deg, #ff9800, #ffc107); }',
            '.gsw-rtp-bar--red { background: linear-gradient(90deg, #f44336, #e57373); }',
            '.gsw-rtp-pct {',
            '  font-size: 12px;',
            '  font-weight: 700;',
            '  width: 48px;',
            '  text-align: right;',
            '  flex-shrink: 0;',
            '}',
            '.gsw-rtp-pct--green { color: #66bb6a; }',
            '.gsw-rtp-pct--yellow { color: #ffc107; }',
            '.gsw-rtp-pct--red { color: #e57373; }',
            '.gsw-spins {',
            '  font-size: 11px;',
            '  color: rgba(255,255,255,0.4);',
            '  width: 52px;',
            '  text-align: right;',
            '  flex-shrink: 0;',
            '}',
            '.gsw-play-btn {',
            '  padding: 3px 10px;',
            '  font-size: 11px;',
            '  font-weight: 700;',
            '  border: none;',
            '  border-radius: 6px;',
            '  cursor: pointer;',
            '  transition: transform 0.15s, box-shadow 0.15s;',
            '  flex-shrink: 0;',
            '  letter-spacing: 0.5px;',
            '}',
            '.gsw-play-btn:hover {',
            '  transform: scale(1.08);',
            '  box-shadow: 0 2px 8px rgba(0,0,0,0.3);',
            '}',
            '.gsw-play-btn:active { transform: scale(0.96); }',
            '.gsw-section--hot .gsw-play-btn {',
            '  background: linear-gradient(135deg, #ff4500, #ff8c00);',
            '  color: #fff;',
            '}',
            '.gsw-section--cold .gsw-play-btn {',
            '  background: linear-gradient(135deg, #0077b6, #00bfff);',
            '  color: #fff;',
            '}',
            '.gsw-loading {',
            '  text-align: center;',
            '  color: rgba(255,255,255,0.4);',
            '  font-size: 13px;',
            '  padding: 30px 0;',
            '}',
            '.gsw-error {',
            '  text-align: center;',
            '  color: #ff8a80;',
            '  font-size: 13px;',
            '  padding: 20px 0;',
            '}',
            '.gsw-empty {',
            '  text-align: center;',
            '  color: rgba(255,255,255,0.35);',
            '  font-size: 13px;',
            '  padding: 20px 0;',
            '}',
            '.gsw-footer {',
            '  text-align: center;',
            '  margin-top: 12px;',
            '  font-size: 11px;',
            '  color: rgba(255,255,255,0.25);',
            '  font-style: italic;',
            '}',
            '.gsw-pulse {',
            '  animation: gswPulse 2s infinite;',
            '}',
            '@keyframes gswPulse {',
            '  0%, 100% { opacity: 1; }',
            '  50% { opacity: 0.5; }',
            '}'
        ].join('\n');
        document.head.appendChild(styleEl);
    }

    // Build container
    var widget = document.createElement('div');
    widget.id = 'gameStatsWidget';
    widget.className = 'gsw-container';

    // Title
    var title = document.createElement('h3');
    title.className = 'gsw-title';
    title.textContent = '\uD83D\uDD25 Hot & Cold Games';
    widget.appendChild(title);

    // Loading indicator
    var loadingDiv = document.createElement('div');
    loadingDiv.className = 'gsw-loading gsw-pulse';
    loadingDiv.textContent = 'Loading game stats\u2026';
    widget.appendChild(loadingDiv);

    // Insert before gamesGrid
    var gamesGrid = document.querySelector('.games-grid');
    if (!gamesGrid || !gamesGrid.parentNode) return;
    gamesGrid.parentNode.insertBefore(widget, gamesGrid);

    // Fetch stats
    fetch('/api/game-stats', {
        method: 'GET',
        headers: {
            'Authorization': 'Bearer ' + token,
            'Content-Type': 'application/json'
        }
    })
    .then(function(response) {
        if (!response.ok) throw new Error('HTTP ' + response.status);
        return response.json();
    })
    .then(function(data) {
        // Remove loading
        if (loadingDiv.parentNode) loadingDiv.parentNode.removeChild(loadingDiv);

        var allStats = data && data.stats ? data.stats : [];

        if (allStats.length === 0) {
            var emptyDiv = document.createElement('div');
            emptyDiv.className = 'gsw-empty';
            emptyDiv.textContent = 'Not enough spin data yet. Play some games to see stats!';
            widget.appendChild(emptyDiv);
            return;
        }

        // Sort by RTP descending (should already be, but ensure)
        allStats.sort(function(a, b) { return (b.actualRtp || 0) - (a.actualRtp || 0); });

        // Hot = top 5 highest RTP, Cold = bottom 5 lowest RTP
        var hotGames = allStats.slice(0, 5);
        var coldGames = allStats.length > 5
            ? allStats.slice(allStats.length - 5).reverse()
            : [];

        // If we have fewer than 10 total, cold section gets whatever is left
        if (allStats.length <= 10 && allStats.length > 5) {
            coldGames = allStats.slice(5).reverse();
        }

        // Sections wrapper
        var sectionsDiv = document.createElement('div');
        sectionsDiv.className = 'gsw-sections';
        widget.appendChild(sectionsDiv);

        // Helper: get RTP color class
        function getRtpColorClass(rtp) {
            var pct = (rtp || 0) * 100;
            if (pct >= 90) return 'green';
            if (pct >= 85) return 'yellow';
            return 'red';
        }

        // Helper: format spin count compactly
        function formatSpins(count) {
            if (count >= 10000) return (count / 1000).toFixed(1) + 'k';
            if (count >= 1000) return (count / 1000).toFixed(1) + 'k';
            return String(count);
        }

        // Helper: build a single game entry row
        function buildEntry(stat, rank, sectionType) {
            var game = typeof GAMES !== 'undefined' ? GAMES.find(function(g) { return g.id === stat.gameId; }) : null;
            var name = game ? game.name : stat.gameId;

            var entryDiv = document.createElement('div');
            entryDiv.className = 'gsw-entry';

            // Rank number
            var rankSpan = document.createElement('span');
            rankSpan.className = 'gsw-rank';
            rankSpan.textContent = '#' + rank;
            entryDiv.appendChild(rankSpan);

            // Game name (clickable)
            var nameSpan = document.createElement('span');
            nameSpan.className = 'gsw-name';
            nameSpan.textContent = name;
            nameSpan.title = name + ' \u2014 Click to play';
            nameSpan.setAttribute('role', 'button');
            nameSpan.setAttribute('tabindex', '0');
            var gameId = stat.gameId;
            nameSpan.addEventListener('click', function() {
                if (typeof openSlot === 'function') openSlot(gameId);
            });
            nameSpan.addEventListener('keydown', function(e) {
                if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    if (typeof openSlot === 'function') openSlot(gameId);
                }
            });
            entryDiv.appendChild(nameSpan);

            // RTP bar
            var barWrap = document.createElement('div');
            barWrap.className = 'gsw-rtp-bar-wrap';
            barWrap.title = 'RTP: ' + ((stat.actualRtp || 0) * 100).toFixed(1) + '%';

            var bar = document.createElement('div');
            bar.className = 'gsw-rtp-bar gsw-rtp-bar--' + getRtpColorClass(stat.actualRtp);
            // Scale bar width: 70% maps to 0 width, 100%+ maps to full width
            var rtpPct = (stat.actualRtp || 0) * 100;
            var barWidth = Math.max(0, Math.min(100, ((rtpPct - 70) / 30) * 100));
            bar.style.width = barWidth + '%';
            barWrap.appendChild(bar);
            entryDiv.appendChild(barWrap);

            // RTP percentage text
            var rtpSpan = document.createElement('span');
            var colorClass = getRtpColorClass(stat.actualRtp);
            rtpSpan.className = 'gsw-rtp-pct gsw-rtp-pct--' + colorClass;
            rtpSpan.textContent = rtpPct.toFixed(1) + '%';
            entryDiv.appendChild(rtpSpan);

            // Spin count
            var spinsSpan = document.createElement('span');
            spinsSpan.className = 'gsw-spins';
            spinsSpan.textContent = formatSpins(stat.totalSpins || 0) + ' spins';
            spinsSpan.title = (stat.totalSpins || 0) + ' total spins';
            entryDiv.appendChild(spinsSpan);

            // Play button
            var playBtn = document.createElement('button');
            playBtn.className = 'gsw-play-btn';
            playBtn.textContent = 'PLAY';
            playBtn.title = 'Play ' + name;
            playBtn.addEventListener('click', function(e) {
                e.stopPropagation();
                if (typeof openSlot === 'function') openSlot(gameId);
            });
            entryDiv.appendChild(playBtn);

            return entryDiv;
        }

        // Helper: build a section (hot or cold)
        function buildSection(titleText, games, sectionClass) {
            var section = document.createElement('div');
            section.className = 'gsw-section ' + sectionClass;

            var sTitle = document.createElement('div');
            sTitle.className = 'gsw-section-title';
            sTitle.textContent = titleText;
            section.appendChild(sTitle);

            if (games.length === 0) {
                var emptyMsg = document.createElement('div');
                emptyMsg.className = 'gsw-empty';
                emptyMsg.textContent = 'Not enough data yet';
                section.appendChild(emptyMsg);
            } else {
                for (var i = 0; i < games.length; i++) {
                    var entry = buildEntry(games[i], i + 1, sectionClass);
                    section.appendChild(entry);
                }
            }

            return section;
        }

        // Build hot section
        var hotSection = buildSection('\uD83D\uDD25 HOT', hotGames, 'gsw-section--hot');
        sectionsDiv.appendChild(hotSection);

        // Build cold section
        var coldSection = buildSection('\u2744\uFE0F COLD', coldGames, 'gsw-section--cold');
        sectionsDiv.appendChild(coldSection);

        // Footer disclaimer
        var footer = document.createElement('div');
        footer.className = 'gsw-footer';
        footer.textContent = 'Based on recent play data \u2022 RTP updates in real-time';
        widget.appendChild(footer);
    })
    .catch(function(err) {
        // Remove loading
        if (loadingDiv.parentNode) loadingDiv.parentNode.removeChild(loadingDiv);

        var errDiv = document.createElement('div');
        errDiv.className = 'gsw-error';
        errDiv.textContent = 'Could not load game stats';
        widget.appendChild(errDiv);

        if (typeof console !== 'undefined' && console.warn) {
            console.warn('[GameStatsWidget] Fetch failed:', err.message || err);
        }
    });
}

// --- Accessibility: keyboard navigation for game cards ---
// Delegated handler so it works with dynamically rendered cards
document.addEventListener('keydown', function(e) {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    var card = e.target.closest('.game-card');
    if (!card) return;
    e.preventDefault();
    card.click();
});
