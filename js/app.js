// ═══════════════════════════════════════════════════════
// APP MODULE
// ═══════════════════════════════════════════════════════

        // Asset manifest — lists files actually present in dist/assets/
        // so the lobby can render real thumbnails/symbols when they ship
        // and procedural fallbacks otherwise, with zero 404s either way.
        // Populated asynchronously on boot; until it resolves the client
        // behaves as if no real assets exist.
        window.__assetManifest = { thumbnails: new Set(), symbols: new Set(), gameSymbols: new Map(), loaded: false };
        (function loadAssetManifest() {
            fetch('/asset-manifest.json', { cache: 'no-store' })
                .then(function (r) { return r.ok ? r.json() : null; })
                .then(function (m) {
                    if (!m) return;
                    window.__assetManifest.thumbnails = new Set(m.thumbnails || []);
                    window.__assetManifest.symbols = new Set(m.symbols || []);
                    // gameSymbols: { '<gameId>': ['s1_lollipop.webp', 's1_lollipop.png', ...] }
                    // Normalise to Map<gameId, Set<filename>> for O(1) lookup.
                    var gs = new Map();
                    Object.keys(m.gameSymbols || {}).forEach(function (gid) {
                        gs.set(gid, new Set(m.gameSymbols[gid] || []));
                    });
                    window.__assetManifest.gameSymbols = gs;
                    window.__assetManifest.loaded = true;
                    // Nudge the lobby to re-render so any already-rendered
                    // cards pick up their newly-available real art.
                    try {
                        if (typeof renderGames === 'function' && typeof currentFilter !== 'undefined') renderGames();
                    } catch (err) { /* non-fatal */ }
                })
                .catch(function () { /* 404 = no manifest yet; fallbacks stay */ });
        })();

        // Short-circuit every /api/ call that isn't backed by a real
        // endpoint on this server. The legacy client pings dozens of
        // feature endpoints on boot; without this every deployed page
        // would paint the Network tab red. We allowlist real paths and
        // synth a 404 locally (no network round-trip) for the rest.
        (function installGhostEndpointSink() {
            if (typeof window === 'undefined' || !window.fetch) return;
            if (window._ghostEndpointSinkInstalled) return;
            window._ghostEndpointSinkInstalled = true;
            // Allowlist of endpoints that actually exist on the server.
            // Every other /api/* request is sunk with a synthetic 404
            // (no network trip). Entries ending with '/' are prefix
            // matches (e.g. '/api/auth/' allows '/api/auth/login');
            // entries without a trailing '/' are exact matches (e.g.
            // '/api/balance' allows '/api/balance' but NOT
            // '/api/balance/anything') so unimplemented sub-paths stay
            // sunk locally instead of reaching the server.
            var REAL = [
                '/api/health',
                '/api/public/',
                '/api/csrf-token',
                '/api/csp-report',
                '/api/stripe/config',
                '/api/auth/',
                '/api/balance',
                '/api/deposit',
                '/api/deposit/',
                '/api/payment/stripe/webhook',
                '/api/nfts',
                '/api/nfts/',
                '/api/user',                  // DELETE /api/user (account deletion)
                '/api/user/me',
                '/api/user/deposits',
                '/api/user/deposits.csv',
                '/api/user/slot-stats',
                '/api/user/slot-history.csv',
                '/api/user/login-history',
                '/api/user/export.json',
                '/api/user/stats',
                '/api/user/return-status',
                '/api/user/loss-streak-offer',
                '/api/user/self-exclude',
                '/api/user/self-exclusion',
                '/api/user/loss-limit',
                '/api/slot/',                 // server-authoritative slot engine
                '/api/withdrawal',             // user-side cash-out
                '/api/withdrawal/',
                '/api/admin/',
            ];
            var origFetch = window.fetch.bind(window);
            window.fetch = function (url, opts) {
                var path = null;
                try {
                    if (typeof url === 'string') path = url;
                    else if (url && url.url) path = url.url;
                } catch (err) { /* ignore */ }
                if (path) {
                    var bare = path.replace(/^https?:\/\/[^/]+/, '').split('?')[0];
                    if (bare.indexOf('/api/') === 0) {
                        var hit = false;
                        for (var i = 0; i < REAL.length; i++) {
                            var entry = REAL[i];
                            var isPrefix = entry.charAt(entry.length - 1) === '/';
                            if (isPrefix ? bare.indexOf(entry) === 0 : bare === entry) { hit = true; break; }
                        }
                        if (!hit) {
                            return Promise.resolve(new Response(
                                JSON.stringify({ error: 'Endpoint not implemented.' }),
                                { status: 404, headers: { 'Content-Type': 'application/json' } }
                            ));
                        }
                    }
                }
                return origFetch(url, opts);
            };
        })();

        // Initialize (base — called by initAllSystems)
        function initBase() {
            appSettings = loadSettings();
            loadState();
            renderGames();
            updateBalance();
            updateStatsSummary();
            wireGameHooks();
            updateSoundButton();
            initQaTools();
            applyUrlDebugConfig();
        }


        function _statsStorageKey() {
            const uid = currentUser ? (currentUser.id || currentUser.username) : null;
            return uid ? STORAGE_KEY_STATS + '_' + uid : STORAGE_KEY_STATS;
        }

        function loadState() {
            const savedBalance = localStorage.getItem(STORAGE_KEY_BALANCE);
            if (savedBalance !== null) balance = parseFloat(savedBalance);

            // Per-user stats key — try user-specific first, then legacy global
            const perUserKey = _statsStorageKey();
            let savedStats = localStorage.getItem(perUserKey);

            if (!savedStats && perUserKey !== STORAGE_KEY_STATS) {
                // Migrate from legacy global key on first per-user load
                savedStats = localStorage.getItem(STORAGE_KEY_STATS);
                if (savedStats) {
                    localStorage.setItem(perUserKey, savedStats);
                }
            }

            if (savedStats) {
                try {
                    const parsed = JSON.parse(savedStats);
                    stats = { ...createDefaultStats(), ...parsed };
                } catch (e) {
                    stats = createDefaultStats();
                }
            } else {
                stats = createDefaultStats();
            }
        }


        function saveBalance() {
            localStorage.setItem(STORAGE_KEY_BALANCE, balance.toString());
        }


        function saveStats() {
            localStorage.setItem(_statsStorageKey(), JSON.stringify(stats));
            // Debounced server sync for server-authenticated users
            if (typeof isServerAuthToken === 'function' && isServerAuthToken()) {
                _debouncedStatsSync();
            }
        }

        // ── Server Stats Sync ──────────────────────────────
        let _statsSyncTimer = null;
        function _debouncedStatsSync() {
            if (_statsSyncTimer) clearTimeout(_statsSyncTimer);
            _statsSyncTimer = setTimeout(function () {
                _statsSyncTimer = null;
                _pushStatsToServer();
            }, 10000); // batch at most once per 10 seconds
        }

        async function _pushStatsToServer() {
            if (typeof isServerAuthToken !== 'function' || !isServerAuthToken()) return;
            try {
                await apiRequest('/api/user/stats', {
                    method: 'PUT',
                    body: { stats: stats },
                    requireAuth: true
                });
            } catch (err) {
                // Silently fail — localStorage is the fallback
                console.warn('Stats server sync failed:', err.message);
            }
        }

        async function _loadServerStats() {
            if (typeof isServerAuthToken !== 'function' || !isServerAuthToken()) return;
            try {
                const res = await apiRequest('/api/user/stats', { requireAuth: true });
                if (res && res.stats) {
                    // Server stats take precedence — merge with defaults for any new fields
                    stats = { ...createDefaultStats(), ...res.stats };
                    localStorage.setItem(_statsStorageKey(), JSON.stringify(stats));
                    if (typeof updateStatsSummary === 'function') updateStatsSummary();
                } else {
                    // No server stats yet — push current local stats to server
                    _pushStatsToServer();
                }
            } catch (err) {
                console.warn('Unable to load server stats:', err.message);
            }
        }


        // ═══════════════════════════════════════════════════════
        // SCREEN SHAKE ON BIG WINS
        // ═══════════════════════════════════════════════════════

        function triggerScreenShake(intensity) {
            const reelArea = document.querySelector('.slot-reel-area');
            if (!reelArea || !_animSettingEnabled('animations')) return;

            if (intensity === 'mega') {
                reelArea.classList.add('big-win-pulse');
                document.querySelector('.slot-modal-fullscreen').classList.add('screen-shake');
                setTimeout(() => {
                    reelArea.classList.remove('big-win-pulse');
                    document.querySelector('.slot-modal-fullscreen').classList.remove('screen-shake');
                }, 1200);
            } else if (intensity === 'big') {
                reelArea.classList.add('big-win-pulse');
                setTimeout(() => reelArea.classList.remove('big-win-pulse'), 600);
            }
        }


        function wireGameHooks() {
            window.render_game_to_text = renderGameToText;
            window.advanceTime = (ms) => new Promise((resolve) => {
                setTimeout(resolve, Math.max(0, ms));
            });
            window.casinoDebug = {
                setSpinSeed: (seedValue) => {
                    const applied = setDeterministicSeed(seedValue);
                    refreshQaStateDisplay();
                    return applied;
                },
                clearSpinSeed: () => {
                    const cleared = setDeterministicSeed(null);
                    refreshQaStateDisplay();
                    return cleared;
                },
                queueForcedSpin: (symbolsInput) => {
                    const queued = queueForcedSpin(symbolsInput);
                    refreshQaStateDisplay();
                    return queued;
                },
                queueOutcome: (type, preferredSymbol) => {
                    const queued = queueForcedOutcome(type, preferredSymbol);
                    refreshQaStateDisplay();
                    return queued;
                },
                forceNextSpinAndPlay: (symbolsOrMode, preferredSymbol) => {
                    const queued = queueAndSpin(symbolsOrMode, preferredSymbol);
                    refreshQaStateDisplay();
                    return queued;
                },
                clearForcedSpins: () => {
                    forcedSpinQueue = [];
                    refreshQaStateDisplay();
                },
                resetSessionState: (clearDeterministic = false) => resetSessionState({ clearDeterministic: Boolean(clearDeterministic), clearQueue: true }),
                getState: () => getDebugState()
            };
        }


        async function toggleFullscreen() {
            try {
                if (document.fullscreenElement) {
                    await document.exitFullscreen();
                } else {
                    await document.documentElement.requestFullscreen();
                }
            } catch (error) {
                console.warn('Fullscreen toggle failed.', error);
            }
        }


        // Post-auth initialization — runs after login or on page load if already authenticated
        function onPostAuthInit() {
            checkDailyBonusReset();
            // Refresh balance from the server immediately on auth —
            // server is the source of truth for deposited funds.
            if (typeof _refreshBalanceFromServer === 'function') {
                _refreshBalanceFromServer(authToken).catch(function () { /* ignore */ });
            }
            // Load stats from server (overrides localStorage if server has data)
            _loadServerStats();
            // Popups and engagement features only for verified (registered) users — not guests
            if (!currentUser || currentUser.isGuest) return;
            const urlParams = new URLSearchParams(window.location.search);
            const suppressBonus = urlParams.get('qaTools') === '1' || urlParams.get('qaTools') === 'true'
                || urlParams.get('noBonus') === '1' || urlParams.get('autoSpin') === '1';

            // Post-auth engagement fetches. Only the two endpoints below
            // exist in server/routes/ — the rest of the historical list
            // (daily-bonus, birthday, achievements, level-up, milestones,
            // weekend-cashback, comeback, subscription, XP sync,
            // tournament, spinstreak, mystery, gifts, notifications)
            // hits routes that have never been implemented. They 404'd
            // silently and the modals they would have spawned promised
            // coin / gem / cash rewards that were never credited
            // server-side. Disabled here; the helper functions stay in
            // the file dead until matching routes ship.
            if (!suppressBonus) {
                _checkReturnStatus();
                _checkLossStreakOffer();
            }
            // Initialize onboarding funnel (early, before other systems)
            if (typeof OnboardingFunnel !== 'undefined' && OnboardingFunnel.init) {
                OnboardingFunnel.init();
            }
            // Initialize notification manager (must happen before any notifications)
            if (typeof NotificationManager !== 'undefined') {
                NotificationManager.init();
                NotificationManager.onLogin();
            }
            // Initialize notification bell and check daily login reward
            if (typeof NotificationBell !== 'undefined' && NotificationBell.init) {
                NotificationBell.init();
            }
            // checkDailyLoginReward, _initSpinStreakTicker, _initMysteryDropChecker,
            // _initLossStreakMonitor, _initNotificationBell all reach for endpoints
            // that don't exist on the server (/api/daily-login/, /api/spinstreak/tick,
            // /api/mystery, /api/notifications, /api/streak). They're disabled for the
            // same reason as the post-auth bonus block above — fetches 404 silently
            // and any UI they would have rendered promised value the engine never
            // credits. Re-enable each individually once a matching server route lands.
            startSessionDurationWatch();
            // Initialize session idle timeout (responsible gambling)
            if (typeof SessionTimeout !== 'undefined' && SessionTimeout.init) {
                SessionTimeout.init();
            }
            // Initialize support chat widget
            if (typeof SupportChat !== 'undefined' && SupportChat.init) {
                SupportChat.init();
            }
            // Initialize social sharing for big wins
            if (typeof SocialShare !== 'undefined' && SocialShare.init) {
                SocialShare.init();
            }
            // Initialize win limit (responsible gambling)
            if (typeof WinLimit !== 'undefined' && WinLimit.init) {
                WinLimit.init();
            }
            // Initialize loss limit (rolling daily/weekly/monthly net-loss caps)
            if (typeof LossLimit !== 'undefined' && LossLimit.init) {
                LossLimit.init();
            }
            // Initialize wager cap (single-bet maximum, soft warning)
            if (typeof WagerCap !== 'undefined' && WagerCap.init) {
                WagerCap.init();
            }
            // Initialize continuous session clock (elapsed-play badge)
            if (typeof SessionClock !== 'undefined' && SessionClock.init) {
                SessionClock.init();
            }
            // Render personalized game recommendations
            if (typeof GameRecommendations !== 'undefined' && GameRecommendations.init) {
                setTimeout(function() { GameRecommendations.init(); GameRecommendations.renderWidget(); }, 2000);
            }
            // Initialize game search autocomplete
            if (typeof SearchAutocomplete !== 'undefined' && SearchAutocomplete.init) {
                SearchAutocomplete.init();
            }
            // Initialize tournament/leaderboard system
            if (typeof Tournament !== 'undefined' && Tournament.init) {
                setTimeout(function() { Tournament.init(); }, 4000);
            }
            // Initialize comeback offers (personalized retention)
            if (typeof ComebackOffers !== 'undefined' && ComebackOffers.init) {
                ComebackOffers.init();
                if (typeof NotificationManager !== 'undefined') {
                    NotificationManager.enqueue('comeback-offers', 7, function() {
                        // The offer will display; ComebackOffers already created the overlay
                    }, function() {
                        // Dismiss handler if needed
                    });
                }
            }
            // Initialize daily login calendar with 1.5s delay, show popup if unclaimed
            if (typeof DailyLoginCalendar !== 'undefined' && DailyLoginCalendar.init) {
                DailyLoginCalendar.init();
                if (!(window.location.search || '').includes('noBonus')) {
                    if (typeof NotificationManager !== 'undefined') {
                        NotificationManager.enqueue('daily-login', 7, function() {
                            DailyLoginCalendar.showCalendar();
                        }, function() {
                            DailyLoginCalendar.closeCalendar();
                        });
                    } else {
                        setTimeout(function() { DailyLoginCalendar.showCalendar(); }, 1500);
                    }
                }
            }
            // Initialize push notifications (ask permission after engagement)
            if (typeof PushNotifications !== 'undefined' && PushNotifications.init) {
                setTimeout(function() { PushNotifications.init(); }, 10000);
            }
            // Initialize social proof live win feed (FOMO/urgency system)
            if (typeof SocialProofFeed !== 'undefined' && SocialProofFeed.init) {
                setTimeout(function() { SocialProofFeed.init(); }, 10000);
            }
            // Initialize A/B testing and i18n
            if (typeof ABTesting !== 'undefined' && ABTesting.init) {
                ABTesting.init();
            }
            if (typeof I18n !== 'undefined' && I18n.init) {
                I18n.init();
            }
            // Initialize bonus countdown and keyboard shortcuts
            if (typeof BonusCountdown !== 'undefined' && BonusCountdown.init) {
                BonusCountdown.init();
            }
            if (typeof KeyboardShortcuts !== 'undefined' && KeyboardShortcuts.init && !suppressBonus) {
                KeyboardShortcuts.init();
            }
            if (typeof SoundSettings !== 'undefined' && SoundSettings.init) {
                SoundSettings.init();
            }
            // Initialize game rating system
            if (typeof GameRating !== 'undefined' && GameRating.init) {
                GameRating.init();
            }
            // Initialize CSRF protection and reality check
            if (typeof CsrfHelper !== 'undefined' && CsrfHelper.init) {
                CsrfHelper.init();
            }
            if (typeof RealityCheck !== 'undefined' && RealityCheck.init) {
                RealityCheck.init();
            }
            // PWA install prompt (after engagement)
            if (typeof PwaInstall !== 'undefined' && PwaInstall.init) {
                PwaInstall.init();
            }
            // VIP milestone progress widget
            if (typeof MilestoneProgress !== 'undefined' && MilestoneProgress.init) {
                setTimeout(function() { MilestoneProgress.init(); }, 2000);
            }
            // Initialize referral system (viral player acquisition)
            if (typeof Referral !== 'undefined' && Referral.init) {
                setTimeout(function() { Referral.init(); }, 3000);
            }
            // Active campaign deposit banners
            if (typeof CampaignBanner !== 'undefined' && CampaignBanner.init) {
                setTimeout(function() { CampaignBanner.init(); }, 4000);
            }
            // Loss-driven cashback escalation
            if (typeof LossCashback !== 'undefined' && LossCashback.init) {
                LossCashback.init();
            }
            // Referral widget — invite friends
            if (typeof ReferralWidget !== 'undefined' && ReferralWidget.init) {
                setTimeout(function() { ReferralWidget.init(); }, 3000);
            }
            // Daily bonus wheel
            if (typeof DailyWheel !== 'undefined' && DailyWheel.init) {
                setTimeout(function() { DailyWheel.init(); }, 2500);
            }
            // VIP tier progress dashboard
            if (typeof VipDashboard !== 'undefined' && VipDashboard.init) {
                setTimeout(function() { VipDashboard.init(); }, 3500);
            }
            // Live wins social proof ticker
            if (typeof LiveWinsTicker !== 'undefined' && LiveWinsTicker.init) {
                setTimeout(function() { LiveWinsTicker.init(); }, 1000);
            }
            // First-deposit conversion nudges
            if (typeof DepositNudge !== 'undefined' && DepositNudge.init) {
                setTimeout(function() { DepositNudge.init(); }, 5000);
            }
            // Withdrawal retention enhancement
            if (typeof WithdrawalEnhance !== 'undefined' && WithdrawalEnhance.init) {
                setTimeout(function() { WithdrawalEnhance.init(); }, 2000);
            }
            // Newsletter signup banner
            if (typeof NewsletterSignup !== 'undefined' && NewsletterSignup.init) {
                setTimeout(function() { NewsletterSignup.init(); }, 6000);
            }
            // Premium tournaments
            if (typeof PremiumTournaments !== 'undefined' && PremiumTournaments.init) {
                setTimeout(function() { PremiumTournaments.init(); }, 3000);
            }
            // Happy hour bonus system
            if (typeof HappyHour !== 'undefined' && HappyHour.init) {
                setTimeout(function() { HappyHour.init(); }, 1500);
            }
            // Session re-engagement for idle players
            if (typeof SessionReengage !== 'undefined' && SessionReengage.init) {
                setTimeout(function() { SessionReengage.init(); }, 4000);
            }
            // Smart game recommendations
            if (typeof GameRecommend !== 'undefined' && GameRecommend.init) {
                setTimeout(function() { GameRecommend.init(); }, 2000);
            }
            // FOMO limited-time slot events
            if (typeof SlotEvents !== 'undefined' && SlotEvents.init) {
                setTimeout(function() { SlotEvents.init(); }, 1500);
            }
            // Push notification opt-in
            if (typeof PushNotify !== 'undefined' && PushNotify.init) {
                setTimeout(function() { PushNotify.init(); }, 8000);
            }
            // Deposit urgency and social proof
            if (typeof DepositUrgency !== 'undefined' && DepositUrgency.init) {
                setTimeout(function() { DepositUrgency.init(); }, 3000);
            }
            // Deposit bonus matcher system
            if (typeof DepositBonus !== 'undefined' && DepositBonus.init) {
                DepositBonus.init();
                if (typeof NotificationManager !== 'undefined') {
                    // Check if first-time deposit for priority
                    var isFirstDeposit = localStorage.getItem('_firstDepositBonusShown') === null;
                    var priority = isFirstDeposit ? 10 : 5;
                    NotificationManager.enqueue('deposit-bonus', priority, function() {
                        // Deposit bonus will show via deposit events
                    }, function() {
                        localStorage.setItem('_depositBonusDismissed', Date.now().toString());
                    });
                }
            }
            // Automatic daily cashback rewards
            // Loyalty points store
            if (typeof LoyaltyStore !== 'undefined' && LoyaltyStore.init) {
                setTimeout(function() { LoyaltyStore.init(); }, 6000);
            }
            if (typeof CashbackWidget !== 'undefined' && CashbackWidget.init) {
                setTimeout(function() { CashbackWidget.init(); }, 5000);
            }
            // Achievement unlock popups
            if (typeof AchievementPopup !== 'undefined' && AchievementPopup.init) {
                setTimeout(function() { AchievementPopup.init(); }, 2000);
            }
            // Hero section for non-logged-in visitors
            if (typeof HeroEnhance !== 'undefined' && HeroEnhance.init) {
                HeroEnhance.init();
            }
            // Cosmetic shop widget
            if (typeof CosmeticShop !== 'undefined' && CosmeticShop.init) {
                setTimeout(function() { CosmeticShop.init(); }, 3500);
            }
            // Loss streak insurance
            if (typeof LossInsurance !== 'undefined' && LossInsurance.init) {
                setTimeout(function() { LossInsurance.init(); }, 4000);
            }
            // Seasonal event (St. Patrick's Day etc.)
            if (typeof SeasonalEvent !== 'undefined' && SeasonalEvent.init) {
                setTimeout(function() { SeasonalEvent.init(); }, 1500);
            }
            // Gem purchase store
            if (typeof GemStore !== 'undefined' && GemStore.init) {
                setTimeout(function() { GemStore.init(); }, 3000);
            }
            // Slot Race time-limited competitive sprints
            if (typeof SlotRace !== 'undefined' && SlotRace.init) {
                setTimeout(function() { SlotRace.init(); }, 3500);
            }
            // Battle Pass system
            if (typeof BattlePass !== 'undefined' && BattlePass.init) {
                setTimeout(function() { BattlePass.init(); }, 2000);
            }
            // Bet Escalator — streak-based bet increase suggestions
            if (typeof BetEscalator !== 'undefined' && BetEscalator.init) {
                BetEscalator.init();
            }
            // Near-Miss Amplifier — excitement amplification on near-wins
            if (typeof NearMissAmplifier !== 'undefined' && NearMissAmplifier.init) {
                NearMissAmplifier.init();
            }
            // Smart Game Recommendations — behavioral game suggestions
            if (typeof SmartRecommend !== 'undefined' && SmartRecommend.init) {
                setTimeout(function() { SmartRecommend.init(); }, 2000);
            }
            // Exit Intent Saver — anti-churn retention offers
            if (typeof ExitIntentSaver !== 'undefined' && ExitIntentSaver.init) {
                setTimeout(function() { ExitIntentSaver.init(); }, 5000);
            }
            // Auto Promo Engine — time-based and event-based promotions
            if (typeof AutoPromoEngine !== 'undefined' && AutoPromoEngine.init) {
                setTimeout(function() { AutoPromoEngine.init(); }, 3000);
            }
            // Funnel Tracker — conversion analytics
            if (typeof FunnelTracker !== 'undefined' && FunnelTracker.init) {
                FunnelTracker.init();
            }
            // Re-Engagement Handler — show comeback campaigns
            if (typeof ReEngagementHandler !== 'undefined' && ReEngagementHandler.init) {
                setTimeout(function() { ReEngagementHandler.init(); }, 7000);
            }
            // A/B Testing — revenue optimization experiments
            if (typeof ABTesting !== 'undefined' && ABTesting.init) {
                ABTesting.init();
            }
            // Session RTP Client — dynamic difficulty tracking (invisible)
            if (typeof SessionRTPClient !== 'undefined' && SessionRTPClient.init) {
                var _rtpUserId = currentUser ? currentUser.id : null;
                var _rtpSession = 'ses_' + Date.now();
                var _rtpBalance = typeof balance !== 'undefined' ? balance : 5000;
                SessionRTPClient.init(_rtpUserId, _rtpSession, _rtpBalance);
            }
            // LTV Personalization — tier-based UI customization
            if (typeof LTVPersonalization !== 'undefined' && LTVPersonalization.init) {
                setTimeout(function() { LTVPersonalization.init(); }, 4000);
            }
            // Loss Streak Intervention — churn prevention with deposit nudges
            if (typeof LossStreakIntervention !== 'undefined' && LossStreakIntervention.init) {
                LossStreakIntervention.init();
            }
            // Social Jackpot Widget — shared community jackpot pools
            if (typeof SocialJackpotWidget !== 'undefined' && SocialJackpotWidget.init) {
                setTimeout(function() { SocialJackpotWidget.init(); }, 3000);
            }
            // Deposit Timing Optimizer — behavioral deposit moment detection
            if (typeof DepositTimingOptimizer !== 'undefined' && DepositTimingOptimizer.init) {
                DepositTimingOptimizer.init();
            }
            // Smart Deposit Nudge — behavioral deposit triggers
            if (typeof SmartDepositNudge !== 'undefined' && SmartDepositNudge.init) {
                SmartDepositNudge.init();
            }
            // Flash Bonus — time-limited deposit multipliers
            if (typeof FlashBonus !== 'undefined' && FlashBonus.init) {
                FlashBonus.init();
                if (typeof NotificationManager !== 'undefined') {
                    NotificationManager.enqueue('flash-bonus', 5, function() {
                        // Flash bonus will show itself via events
                    }, function() {
                        // Dismiss handler
                    });
                }
            }
            // Whale VIP detection + upsell nudge
            if (typeof WhaleVipNudge !== 'undefined' && WhaleVipNudge.init) {
                WhaleVipNudge.init();
                if (typeof NotificationManager !== 'undefined') {
                    NotificationManager.enqueue('whale-vip-invite', 5, function() {
                        // Whale VIP nudge will show itself
                    }, function() {
                        // Dismiss handler
                    });
                }
            }
            // Periodic loss-streak check — fires every 3 minutes during active play
            if (!window._lossStreakCheckTimer) {
                window._lossStreakCheckTimer = setInterval(function() {
                    _checkLossStreakOffer();
                }, 180000);
            }

        }

        // Responsible gambling: remind player every 60 minutes of continuous play
        function startSessionDurationWatch() {
            if (window._sessionDurationTimer) return; // already running
            window._sessionStartTime = window._sessionStartTime || Date.now();
            window._sessionDurationTimer = setInterval(function () {
                const mins = Math.round((Date.now() - window._sessionStartTime) / 60000);
                if (mins > 0 && mins % 60 === 0) {
                    const hrs = mins / 60;
                    if (typeof showMessage === 'function') {
                        showMessage(
                            '⏱ You\'ve been playing for ' + hrs + ' hour' + (hrs > 1 ? 's' : '') +
                            '. Remember to take breaks and play responsibly.',
                            'near-miss'
                        );
                    }
                }
            }, 60000);
        }

        // ── Return-status: welcome-back overlay for lapsed players ─────────
        function _checkReturnStatus() {
            if (sessionStorage.getItem('_returnStatusChecked')) return; // once per session
            sessionStorage.setItem('_returnStatusChecked', '1');
            if (typeof isServerAuthToken !== 'function' || !isServerAuthToken()) return;
            const token = localStorage.getItem(typeof STORAGE_KEY_TOKEN !== 'undefined' ? STORAGE_KEY_TOKEN : 'casinoToken');
            if (!token) return;
            fetch('/api/user/return-status', { headers: { Authorization: 'Bearer ' + token } })
                .then(function(r) { return r.ok ? r.json() : null; })
                .then(function(data) {
                    if (data && data.isReturn) {
                        setTimeout(function() { _showWelcomeBackOverlay(data); }, 3500);
                    }
                })
                .catch(function() {});
        }

        function _showWelcomeBackOverlay(data) {
            if (document.getElementById('welcomeBackOverlay')) return;
            var TIER_STYLES = {
                platinum: '#94a3b8',
                gold:     '#f59e0b',
                silver:   '#64748b',
                bronze:   '#c2733a'
            };
            var accent = TIER_STYLES[data.offerTier] || TIER_STYLES.bronze;
            var tierLabel = (data.offerTier || 'bronze').toUpperCase();

            var overlay = document.createElement('div');
            overlay.id = 'welcomeBackOverlay';
            overlay.style.cssText = [
                'position:fixed', 'top:0', 'left:0', 'right:0', 'bottom:0',
                'background:rgba(0,0,0,0.78)', 'display:flex', 'align-items:center',
                'justify-content:center', 'z-index:9998', 'padding:20px'
            ].join(';');

            var card = document.createElement('div');
            card.style.cssText = [
                'background:linear-gradient(135deg,#1a1040,#0f0920)',
                'border:2px solid ' + accent,
                'border-radius:16px',
                'padding:32px',
                'max-width:440px',
                'width:100%',
                'text-align:center',
                'position:relative',
                'box-shadow:0 20px 60px rgba(0,0,0,0.6)'
            ].join(';');

            var closeBtn = document.createElement('button');
            closeBtn.textContent = '\u00D7';
            closeBtn.style.cssText = 'position:absolute;top:12px;right:16px;background:none;border:none;color:#6b7280;font-size:1.4rem;cursor:pointer;line-height:1;';
            closeBtn.addEventListener('click', function() { overlay.remove(); });

            var tierBadge = document.createElement('div');
            tierBadge.style.cssText = 'font-size:0.72rem;font-weight:800;letter-spacing:2px;color:' + accent + ';margin-bottom:10px;text-transform:uppercase;';
            tierBadge.textContent = tierLabel + ' RETURN OFFER';

            var title = document.createElement('h2');
            title.style.cssText = 'font-size:1.75rem;font-weight:900;color:#fff;margin:0 0 6px;';
            title.textContent = '\uD83D\uDC4B Welcome Back!';

            var daysEl = document.createElement('p');
            daysEl.style.cssText = 'font-size:0.9rem;color:#9ca3af;margin:0 0 14px;';
            daysEl.textContent = "You've been away " + (data.daysAway || 0) + " day" + (data.daysAway !== 1 ? 's' : '') + " \u2014 we missed you!";

            var msgEl = document.createElement('p');
            msgEl.style.cssText = 'font-size:0.88rem;color:#d1d5db;margin:0 0 18px;line-height:1.5;';
            msgEl.textContent = data.message || 'We have a special offer waiting for you!';

            var offerBox = document.createElement('div');
            offerBox.style.cssText = [
                'background:rgba(255,255,255,0.05)',
                'border:1px solid rgba(255,255,255,0.1)',
                'border-radius:10px',
                'padding:14px 16px',
                'margin-bottom:18px'
            ].join(';');

            var line1 = document.createElement('div');
            line1.style.cssText = 'font-size:1.3rem;font-weight:900;color:' + accent + ';margin-bottom:' + (data.freeSpins > 0 ? '4px' : '0') + ';';
            line1.textContent = '+' + (data.bonusPercent || 25) + '% BONUS ON NEXT DEPOSIT';
            offerBox.appendChild(line1);

            if (data.freeSpins > 0) {
                var line2 = document.createElement('div');
                line2.style.cssText = 'font-size:0.9rem;color:#a78bfa;font-weight:700;';
                line2.textContent = '+ ' + data.freeSpins + ' FREE SPINS';
                offerBox.appendChild(line2);
            }

            var depositBtn = document.createElement('button');
            depositBtn.style.cssText = [
                'background:linear-gradient(135deg,' + accent + ',#7c3aed)',
                'color:#fff', 'border:none', 'border-radius:8px',
                'padding:13px 40px', 'font-size:0.95rem', 'font-weight:800',
                'cursor:pointer', 'width:100%', 'margin-bottom:10px',
                'letter-spacing:0.4px'
            ].join(';');
            depositBtn.textContent = '\uD83D\uDCB0 Claim Offer & Deposit';
            depositBtn.addEventListener('click', function() {
                overlay.remove();
                if (typeof showWalletModal === 'function') showWalletModal();
            });

            var skipBtn = document.createElement('button');
            skipBtn.style.cssText = 'background:none;border:none;color:#6b7280;font-size:0.78rem;cursor:pointer;padding:4px;';
            skipBtn.textContent = 'Maybe later';
            skipBtn.addEventListener('click', function() { overlay.remove(); });

            card.appendChild(closeBtn);
            card.appendChild(tierBadge);
            card.appendChild(title);
            card.appendChild(daysEl);
            card.appendChild(msgEl);
            card.appendChild(offerBox);
            card.appendChild(depositBtn);
            card.appendChild(skipBtn);
            overlay.appendChild(card);
            document.body.appendChild(overlay);
        }

        // ── Birthday bonus ─────────────────────────────────────────────────────
        function _checkBirthday() {
            if (sessionStorage.getItem('_birthdayChecked')) return;
            sessionStorage.setItem('_birthdayChecked', '1');
            if (typeof isServerAuthToken !== 'function' || !isServerAuthToken()) return;
            var token = localStorage.getItem(typeof STORAGE_KEY_TOKEN !== 'undefined' ? STORAGE_KEY_TOKEN : 'casinoToken');
            if (!token) return;
            fetch('/api/birthday/status', { headers: { Authorization: 'Bearer ' + token } })
                .then(function(r) { return r.ok ? r.json() : null; })
                .then(function(data) {
                    if (data && data.isBirthday && !data.alreadyClaimed) {
                        setTimeout(function() { _showBirthdayModal(data); }, 5500);
                    }
                })
                .catch(function() {});
        }

        function _showBirthdayModal(data) {
            if (document.getElementById('birthdayModal')) return;
            var overlay = document.createElement('div');
            overlay.id = 'birthdayModal';
            overlay.style.cssText = [
                'position:fixed', 'top:0', 'left:0', 'right:0', 'bottom:0',
                'background:rgba(0,0,0,0.85)', 'display:flex', 'align-items:center',
                'justify-content:center', 'z-index:9998', 'padding:16px'
            ].join(';');
            var card = document.createElement('div');
            card.style.cssText = [
                'background:linear-gradient(135deg,#1e1b4b,#312e81)',
                'border:2px solid #f59e0b', 'border-radius:20px',
                'padding:36px 32px', 'max-width:380px', 'width:100%',
                'text-align:center', 'position:relative'
            ].join(';');
            var closeBtn = document.createElement('button');
            closeBtn.style.cssText = 'position:absolute;top:12px;right:14px;background:none;border:none;color:#9ca3af;font-size:1.4rem;cursor:pointer;line-height:1;';
            closeBtn.textContent = '\u00D7';
            closeBtn.addEventListener('click', function() { overlay.remove(); });
            var emoji = document.createElement('div');
            emoji.style.cssText = 'font-size:3.5rem;margin-bottom:12px;';
            emoji.textContent = '\uD83C\uDF82';
            var title = document.createElement('div');
            title.style.cssText = 'font-size:1.6rem;font-weight:900;color:#fbbf24;margin-bottom:8px;';
            title.textContent = 'Happy Birthday!';
            var sub = document.createElement('div');
            sub.style.cssText = 'color:#c4b5fd;font-size:0.95rem;margin-bottom:20px;line-height:1.5;';
            sub.textContent = 'A special gift awaits you on your special day!';
            var rewardBox = document.createElement('div');
            rewardBox.style.cssText = [
                'background:rgba(251,191,36,0.1)', 'border:1px solid rgba(251,191,36,0.3)',
                'border-radius:12px', 'padding:16px', 'margin-bottom:22px'
            ].join(';');
            if (data.bonusCredits > 0) {
                var credLine = document.createElement('div');
                credLine.style.cssText = 'font-size:1.2rem;font-weight:800;color:#fbbf24;';
                credLine.textContent = '$' + data.bonusCredits.toFixed(2) + ' Birthday Bonus';
                rewardBox.appendChild(credLine);
            }
            if (data.bonusGems > 0) {
                var gemsLine = document.createElement('div');
                gemsLine.style.cssText = 'font-size:0.9rem;color:#a78bfa;font-weight:700;margin-top:4px;';
                gemsLine.textContent = '+ ' + data.bonusGems + ' Gems';
                rewardBox.appendChild(gemsLine);
            }
            if (data.bonusFreeSpins > 0) {
                var spinsLine = document.createElement('div');
                spinsLine.style.cssText = 'font-size:0.9rem;color:#34d399;font-weight:700;margin-top:4px;';
                spinsLine.textContent = '+ ' + data.bonusFreeSpins + ' Free Spins';
                rewardBox.appendChild(spinsLine);
            }
            var claimBtn = document.createElement('button');
            claimBtn.style.cssText = [
                'background:linear-gradient(135deg,#f59e0b,#d97706)',
                'color:#fff', 'border:none', 'border-radius:10px',
                'padding:13px 40px', 'font-size:1rem', 'font-weight:800',
                'cursor:pointer', 'width:100%', 'margin-bottom:10px'
            ].join(';');
            claimBtn.textContent = '\uD83C\uDF81 Claim Birthday Gift';
            claimBtn.addEventListener('click', function() {
                claimBtn.disabled = true;
                claimBtn.textContent = 'Claiming...';
                var tok = localStorage.getItem(typeof STORAGE_KEY_TOKEN !== 'undefined' ? STORAGE_KEY_TOKEN : 'casinoToken');
                fetch('/api/birthday/claim', {
                    method: 'POST',
                    headers: { Authorization: 'Bearer ' + tok, 'Content-Type': 'application/json' }
                })
                    .then(function(r) { return r.json(); })
                    .then(function(res) {
                        if (res.success) {
                            if (res.newBalance !== undefined) {
                                balance = res.newBalance;
                                if (typeof updateBalance === 'function') updateBalance();
                                if (typeof saveBalance === 'function') saveBalance();
                            }
                            if (typeof showMessage === 'function') {
                                showMessage('\uD83C\uDF82 Birthday gift claimed! Enjoy your bonus!', 'big-win');
                            }
                            overlay.remove();
                        } else {
                            claimBtn.disabled = false;
                            claimBtn.textContent = '\uD83C\uDF81 Claim Birthday Gift';
                        }
                    })
                    .catch(function() {
                        claimBtn.disabled = false;
                        claimBtn.textContent = '\uD83C\uDF81 Claim Birthday Gift';
                    });
            });
            var skipLink = document.createElement('button');
            skipLink.style.cssText = 'background:none;border:none;color:#6b7280;font-size:0.78rem;cursor:pointer;';
            skipLink.textContent = 'Maybe later';
            skipLink.addEventListener('click', function() { overlay.remove(); });
            card.appendChild(closeBtn);
            card.appendChild(emoji);
            card.appendChild(title);
            card.appendChild(sub);
            card.appendChild(rewardBox);
            card.appendChild(claimBtn);
            card.appendChild(skipLink);
            overlay.appendChild(card);
            document.body.appendChild(overlay);
        }

        // ── Loss Streak Offer ──────────────────────────────────────────────────
        function _checkLossStreakOffer() {
            if (sessionStorage.getItem('_lossStreakOfferShown')) return;
            if (typeof isServerAuthToken !== 'function' || !isServerAuthToken()) return;
            var token = localStorage.getItem(typeof STORAGE_KEY_TOKEN !== 'undefined' ? STORAGE_KEY_TOKEN : 'casinoToken');
            if (!token) return;
            fetch('/api/user/loss-streak-offer', { headers: { Authorization: 'Bearer ' + token } })
                .then(function(r) { return r.ok ? r.json() : null; })
                .then(function(data) {
                    if (data && data.eligible && data.offer) {
                        sessionStorage.setItem('_lossStreakOfferShown', '1');
                        setTimeout(function() { _showLossStreakModal(data.offer); }, 1500);
                    }
                })
                .catch(function() {});
        }

        function _showLossStreakModal(offer) {
            if (document.getElementById('lossStreakModal')) return;
            var overlay = document.createElement('div');
            overlay.id = 'lossStreakModal';
            overlay.style.cssText = [
                'position:fixed', 'top:0', 'left:0', 'right:0', 'bottom:0',
                'background:rgba(0,0,0,0.85)', 'display:flex', 'align-items:center',
                'justify-content:center', 'z-index:9998', 'padding:16px'
            ].join(';');

            var card = document.createElement('div');
            card.style.cssText = [
                'background:linear-gradient(135deg,#1a0a00,#2d0f00)',
                'border:2px solid #ef4444',
                'border-radius:20px',
                'padding:36px 32px',
                'max-width:400px',
                'width:100%',
                'text-align:center',
                'position:relative',
                'box-shadow:0 20px 60px rgba(239,68,68,0.3)'
            ].join(';');

            var closeBtn = document.createElement('button');
            closeBtn.textContent = '\u00D7';
            closeBtn.style.cssText = 'position:absolute;top:12px;right:14px;background:none;border:none;color:#9ca3af;font-size:1.4rem;cursor:pointer;line-height:1;';
            closeBtn.addEventListener('click', function() { overlay.remove(); });

            var title = document.createElement('h2');
            title.style.cssText = 'font-size:1.55rem;font-weight:900;color:#fff;margin:0 0 8px;';
            title.textContent = '\u26A1 Bad Luck Protection Activated';

            var subtitle = document.createElement('p');
            subtitle.style.cssText = 'font-size:0.9rem;color:#fca5a5;margin:0 0 20px;line-height:1.5;';
            subtitle.textContent = "We see you've had a rough streak \u2014 here's a boost!";

            var offerBox = document.createElement('div');
            offerBox.style.cssText = [
                'background:rgba(239,68,68,0.1)',
                'border:1px solid rgba(239,68,68,0.35)',
                'border-radius:12px',
                'padding:18px 16px',
                'margin-bottom:20px'
            ].join(';');

            var matchLine = document.createElement('div');
            matchLine.style.cssText = 'font-size:1.4rem;font-weight:900;color:#f97316;margin-bottom:6px;';
            var matchPct = document.createElement('span');
            matchPct.textContent = String(offer.matchPct || 50);
            matchLine.textContent = '';
            matchLine.appendChild(matchPct);
            var matchSuffix = document.createElement('span');
            matchSuffix.textContent = '% MATCH ON YOUR NEXT DEPOSIT';
            matchLine.appendChild(matchSuffix);

            var maxLine = document.createElement('div');
            maxLine.style.cssText = 'font-size:1rem;font-weight:700;color:#fdba74;margin-bottom:4px;';
            var upTo = document.createElement('span');
            upTo.textContent = 'Up to $';
            var maxAmt = document.createElement('span');
            maxAmt.textContent = String(offer.maxMatch || 25);
            maxLine.appendChild(upTo);
            maxLine.appendChild(maxAmt);

            var minNote = document.createElement('div');
            minNote.style.cssText = 'font-size:0.8rem;color:#9ca3af;margin-top:6px;';
            var minLabel = document.createElement('span');
            minLabel.textContent = 'Min deposit $';
            var minAmt = document.createElement('span');
            minAmt.textContent = String(offer.minDeposit || 10);
            minNote.appendChild(minLabel);
            minNote.appendChild(minAmt);

            offerBox.appendChild(matchLine);
            offerBox.appendChild(maxLine);
            offerBox.appendChild(minNote);

            var depositBtn = document.createElement('button');
            depositBtn.style.cssText = [
                'background:linear-gradient(135deg,#ef4444,#f97316)',
                'color:#fff', 'border:none', 'border-radius:10px',
                'padding:13px 40px', 'font-size:0.95rem', 'font-weight:800',
                'cursor:pointer', 'width:100%', 'margin-bottom:10px',
                'letter-spacing:0.4px'
            ].join(';');
            depositBtn.textContent = '\uD83D\uDCB0 Deposit & Claim';
            depositBtn.addEventListener('click', function() {
                overlay.remove();
                if (typeof showWalletModal === 'function') showWalletModal();
            });

            var skipBtn = document.createElement('button');
            skipBtn.style.cssText = 'background:none;border:none;color:#6b7280;font-size:0.78rem;cursor:pointer;padding:4px;';
            skipBtn.textContent = 'Maybe later';
            skipBtn.addEventListener('click', function() { overlay.remove(); });

            card.appendChild(closeBtn);
            card.appendChild(title);
            card.appendChild(subtitle);
            card.appendChild(offerBox);
            card.appendChild(depositBtn);
            card.appendChild(skipBtn);
            overlay.appendChild(card);
            document.body.appendChild(overlay);
        }

        // ── Level-Up Bonus ─────────────────────────────────────────────────────
        function _checkLevelUpBonus() {
            if (sessionStorage.getItem('_levelUpBonusChecked')) return;
            sessionStorage.setItem('_levelUpBonusChecked', '1');
            if (typeof isServerAuthToken !== 'function' || !isServerAuthToken()) return;
            var token = localStorage.getItem(typeof STORAGE_KEY_TOKEN !== 'undefined' ? STORAGE_KEY_TOKEN : 'casinoToken');
            if (!token) return;
            fetch('/api/levelupbonus/status', { headers: { Authorization: 'Bearer ' + token } })
                .then(function(resp) { if (!resp.ok) throw new Error('not ok'); return resp.json(); })
                .then(function(data) {
                    if (data && data.claimable === true) {
                        _showLevelUpBonusModal(data);
                    }
                })
                .catch(function() { /* network / parse errors are non-fatal */ });
        }

        function _showLevelUpBonusModal(data) {
            // CSS injection with ID guard
            if (!document.getElementById('levelup-bonus-css')) {
                var s = document.createElement('style');
                s.id = 'levelup-bonus-css';
                s.textContent = [
                    '.levelup-bonus-overlay{position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.75);z-index:9000;display:flex;align-items:center;justify-content:center;animation:levelupFadeIn 0.3s ease}',
                    '@keyframes levelupFadeIn{from{opacity:0}to{opacity:1}}',
                    '@keyframes levelupSlideUp{from{opacity:0;transform:translateY(30px)}to{opacity:1;transform:translateY(0)}}',
                    '@keyframes levelupPulse{0%,100%{transform:scale(1)}50%{transform:scale(1.05)}}',
                    '.levelup-bonus-card{background:linear-gradient(135deg,#1a1a2e 0%,#16213e 50%,#0f3460 100%);border-radius:16px;padding:32px 28px;max-width:380px;width:90%;text-align:center;box-shadow:0 8px 40px rgba(0,0,0,0.6),0 0 60px rgba(255,215,0,0.15);border:1px solid rgba(255,215,0,0.3);animation:levelupSlideUp 0.4s ease}',
                    '.levelup-bonus-title{font-size:1.6rem;font-weight:800;color:#ffd700;margin-bottom:8px}',
                    '.levelup-bonus-level{font-size:1.15rem;color:#e0e0ff;margin-bottom:6px;font-weight:600}',
                    '.levelup-bonus-gained{font-size:0.95rem;color:#9ca3af;margin-bottom:16px}',
                    '.levelup-bonus-amount{font-size:2rem;font-weight:800;color:#22c55e;margin-bottom:24px;animation:levelupPulse 1.5s ease infinite}',
                    '.levelup-bonus-claim{background:linear-gradient(135deg,#f59e0b,#f97316);color:#1a0a00;border:none;border-radius:10px;padding:12px 40px;font-size:1rem;font-weight:700;cursor:pointer;width:100%;margin-bottom:10px;transition:opacity 0.2s}',
                    '.levelup-bonus-claim:hover{opacity:0.9}',
                    '.levelup-bonus-claim:disabled{opacity:0.5;cursor:not-allowed}',
                    '.levelup-bonus-dismiss{background:#2a2a40;color:#9ca3af;border:1px solid #3a3a55;border-radius:10px;padding:10px 40px;font-size:0.88rem;font-weight:600;cursor:pointer;width:100%}',
                    '.levelup-bonus-dismiss:hover{background:#353550}',
                    '.levelup-bonus-success{color:#22c55e;font-size:1rem;font-weight:700;margin-top:12px}'
                ].join('\n');
                document.head.appendChild(s);
            }

            // Build overlay
            var overlay = document.createElement('div');
            overlay.className = 'levelup-bonus-overlay';

            var card = document.createElement('div');
            card.className = 'levelup-bonus-card';

            var title = document.createElement('div');
            title.className = 'levelup-bonus-title';
            title.textContent = '\uD83C\uDF89 Level Up!';

            var levelLine = document.createElement('div');
            levelLine.className = 'levelup-bonus-level';
            levelLine.textContent = "You've reached Level " + data.currentLevel + '!';

            var gainedLine = document.createElement('div');
            gainedLine.className = 'levelup-bonus-gained';
            gainedLine.textContent = "You've gained " + data.levelsGained + ' level' + (data.levelsGained !== 1 ? 's' : '') + '!';

            var amountDisplay = document.createElement('div');
            amountDisplay.className = 'levelup-bonus-amount';
            amountDisplay.textContent = '$' + Number(data.bonusAmount).toFixed(2);

            var claimBtn = document.createElement('button');
            claimBtn.className = 'levelup-bonus-claim';
            claimBtn.textContent = 'Claim Bonus';
            claimBtn.addEventListener('click', function() {
                claimBtn.disabled = true;
                claimBtn.textContent = 'Claiming...';
                var token = localStorage.getItem(typeof STORAGE_KEY_TOKEN !== 'undefined' ? STORAGE_KEY_TOKEN : 'casinoToken');
                fetch('/api/levelupbonus/claim', {
                    method: 'POST',
                    headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }
                })
                .then(function(resp) { return resp.json(); })
                .then(function(result) {
                    if (result && result.success) {
                        if (typeof updateBalanceDisplay === 'function') {
                            updateBalanceDisplay(result.newBalance);
                        } else if (typeof updateBalance === 'function') {
                            updateBalance();
                        }
                        claimBtn.textContent = 'Claimed!';
                        var successMsg = document.createElement('div');
                        successMsg.className = 'levelup-bonus-success';
                        successMsg.textContent = result.message || 'Bonus credited to your balance!';
                        card.appendChild(successMsg);
                        setTimeout(function() { if (overlay.parentNode) overlay.parentNode.removeChild(overlay); }, 2000);
                    } else {
                        claimBtn.textContent = result && result.message ? result.message : 'Error';
                        claimBtn.disabled = false;
                    }
                })
                .catch(function() {
                    claimBtn.textContent = 'Error — try again';
                    claimBtn.disabled = false;
                });
            });

            var noThanksBtn = document.createElement('button');
            noThanksBtn.className = 'levelup-bonus-dismiss';
            noThanksBtn.textContent = 'No Thanks';
            noThanksBtn.addEventListener('click', function() {
                if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
            });

            card.appendChild(title);
            card.appendChild(levelLine);
            card.appendChild(gainedLine);
            card.appendChild(amountDisplay);
            card.appendChild(claimBtn);
            card.appendChild(noThanksBtn);
            overlay.appendChild(card);
            document.body.appendChild(overlay);
        }

        // ── Milestone auto-claim ───────────────────────────────────────────────
        function _checkMilestones(isRecurse) {
            if (typeof isServerAuthToken !== 'function' || !isServerAuthToken()) return;
            var token = localStorage.getItem(typeof STORAGE_KEY_TOKEN !== 'undefined' ? STORAGE_KEY_TOKEN : 'casinoToken');
            if (!token) return;
            fetch('/api/milestones/status', { headers: { Authorization: 'Bearer ' + token } })
                .then(function(r) { return r.ok ? r.json() : null; })
                .then(function(data) {
                    if (!data || !data.pendingClaim) return;
                    return fetch('/api/milestones/claim', {
                        method: 'POST',
                        headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }
                    })
                        .then(function(r) { return r.ok ? r.json() : null; })
                        .then(function(res) {
                            if (!res || !res.success) return;
                            if (res.newBalance !== undefined) {
                                balance = res.newBalance;
                                if (typeof updateBalance === 'function') updateBalance();
                                if (typeof saveBalance === 'function') saveBalance();
                            }
                            var label = res.milestoneName || 'Milestone';
                            var cashAmt = res.cashReward ? '$' + parseFloat(res.cashReward).toFixed(2) : '';
                            var gemsAmt = res.gemReward ? res.gemReward + ' gems' : '';
                            var parts = [];
                            if (cashAmt) parts.push(cashAmt);
                            if (gemsAmt) parts.push(gemsAmt);
                            var rewardStr = parts.length ? ' +' + parts.join(' + ') + ' claimed!' : ' claimed!';
                            var msg = '\uD83C\uDFC6 Milestone: ' + label + '!' + rewardStr;
                            if (typeof showWinToast === 'function') {
                                showWinToast(msg);
                            } else {
                                var t = document.createElement('div');
                                t.textContent = msg;
                                t.style.cssText = 'position:fixed;bottom:24px;left:50%;transform:translateX(-50%);background:rgba(0,0,0,0.85);color:#fff;padding:10px 20px;border-radius:8px;font-size:14px;z-index:99999;pointer-events:none;';
                                document.body.appendChild(t);
                                setTimeout(function() { if (t.parentNode) t.parentNode.removeChild(t); }, 3500);
                            }
                            // Recurse once in case multiple milestones are pending
                            if (!isRecurse) {
                                setTimeout(function() { _checkMilestones(true); }, 500);
                            }
                        });
                })
                .catch(function() {});
        }

        // ── Streak bonus status ────────────────────────────────────────────────
        function _checkStreakBonuses() {
            if (typeof isServerAuthToken !== 'function' || !isServerAuthToken()) return;
            var token = localStorage.getItem(typeof STORAGE_KEY_TOKEN !== 'undefined' ? STORAGE_KEY_TOKEN : 'casinoToken');
            if (!token) return;
            fetch('/api/spinstreak/status', { headers: { Authorization: 'Bearer ' + token } })
                .then(function(r) { return r.ok ? r.json() : null; })
                .then(function(data) {
                    window._spinStreakStatus = data || null;
                    if (data && data.multiplier && parseFloat(data.multiplier) > 1.0) {
                        // Multiplier is active — store for use by spin engine if needed
                        window._spinStreakMultiplier = parseFloat(data.multiplier);
                    }
                })
                .catch(function() {});
            fetch('/api/winstreak/status', { headers: { Authorization: 'Bearer ' + token } })
                .then(function(r) { return r.ok ? r.json() : null; })
                .then(function(data) {
                    window._winStreakStatus = data || null;
                })
                .catch(function() {});
        }

        // ── Daily login streak reward ──────────────────────────────────────────
        function _checkDailyStreak() {
            if (typeof isServerAuthToken !== 'function' || !isServerAuthToken()) return;
            var token = localStorage.getItem(typeof STORAGE_KEY_TOKEN !== 'undefined' ? STORAGE_KEY_TOKEN : 'casinoToken');
            if (!token) return;
            if (sessionStorage.getItem('_dailyStreakChecked')) return;
            sessionStorage.setItem('_dailyStreakChecked', '1');
            setTimeout(function() {
                fetch('/api/streak', {
                    method: 'POST',
                    headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }
                })
                    .then(function(r) { return r.ok ? r.json() : null; })
                    .then(function(data) {
                        if (!data || !data.isNewDay) return;
                        var n = data.streakCount || 1;
                        var reward = data.reward || {};
                        var msg = '';
                        if (reward.type === 'gems') {
                            msg = '\uD83D\uDD25 Day ' + n + ' streak! +' + reward.amount + ' Gems!';
                        } else if (reward.type === 'credits') {
                            msg = '\uD83D\uDD25 Day ' + n + ' streak! +$' + parseFloat(reward.amount).toFixed(2) + ' bonus!';
                        } else if (reward.type === 'weekly') {
                            msg = '\uD83C\uDFC6 7-Day Streak! +$' + parseFloat(reward.credits).toFixed(2) + ' + ' + reward.wheelSpins + ' wheel spins!';
                        } else if (reward.type === 'biweekly') {
                            msg = '\uD83C\uDFC6 14-Day Streak! +$' + parseFloat(reward.credits).toFixed(2) + ' mega bonus!';
                        } else if (reward.type === 'monthly') {
                            msg = '\uD83D\uDC51 30-Day Streak! +$' + parseFloat(reward.credits).toFixed(2) + ' monthly bonus!';
                        } else {
                            msg = '\uD83D\uDD25 Day ' + n + ' streak! Keep it up!';
                        }
                        if (data.newBalance !== undefined) {
                            balance = data.newBalance;
                            if (typeof updateBalance === 'function') updateBalance();
                        }
                        if (typeof showWinToast === 'function') {
                            showWinToast(msg);
                        } else {
                            var toast = document.createElement('div');
                            toast.textContent = msg;
                            toast.style.cssText = 'position:fixed;bottom:80px;left:50%;transform:translateX(-50%);background:rgba(0,0,0,0.85);color:#fff;padding:12px 20px;border-radius:10px;z-index:99999;font-size:1rem;pointer-events:none;';
                            document.body.appendChild(toast);
                            setTimeout(function() { if (toast.parentNode) toast.parentNode.removeChild(toast); }, 3500);
                        }
                    })
                    .catch(function() {});
            }, 3000);
        }

        // ── Weekend cashback notification ─────────────────────────────────────
        function _checkWeekendCashback() {
            // Session guard - only show once per session
            if (sessionStorage.getItem('_weekendCashbackChecked')) return;
            sessionStorage.setItem('_weekendCashbackChecked', '1');

            if (typeof isServerAuthToken !== 'function' || !isServerAuthToken()) return;
            var token = localStorage.getItem(typeof STORAGE_KEY_TOKEN !== 'undefined' ? STORAGE_KEY_TOKEN : 'casinoToken');
            if (!token) return;

            fetch('/api/user/weekend-cashback', {
                headers: { 'Authorization': 'Bearer ' + token }
            })
            .then(function(r) { return r.json(); })
            .then(function(data) {
                if (!data.active) return;
                _showWeekendCashbackToast(data);
            })
            .catch(function(e) { console.warn('[WeekendCashback]', e); });
        }

        function _showWeekendCashbackToast(data) {
            var pct = data.cashbackPercent || 0;
            var msg = '\uD83C\uDF81 Weekend Cashback ACTIVE \u2014 ' + pct + '% cashback on losses this weekend!';
            if (typeof showWinToast === 'function') {
                showWinToast(msg);
            } else {
                var existing = document.getElementById('weekend-cashback-toast');
                if (existing) { existing.remove(); }
                var toast = document.createElement('div');
                toast.id = 'weekend-cashback-toast';
                toast.className = 'weekend-cashback-toast';
                toast.style.cssText = 'position:fixed;bottom:80px;left:50%;transform:translateX(-50%);background:linear-gradient(135deg,#6a0dad,#ffd700);color:#fff;font-weight:700;padding:12px 24px;border-radius:30px;z-index:99999;font-size:1rem;pointer-events:none;box-shadow:0 4px 20px rgba(106,13,173,0.5);';
                toast.textContent = msg;
                document.body.appendChild(toast);
                setTimeout(function() {
                    if (toast.parentNode) toast.parentNode.removeChild(toast);
                }, 6000);
            }
        }

        // ── Subscription daily gem auto-claim ─────────────────────────────────
        function _checkSubscriptionDailyGems() {
            if (typeof isServerAuthToken !== 'function' || !isServerAuthToken()) return;
            var token = localStorage.getItem(typeof STORAGE_KEY_TOKEN !== 'undefined' ? STORAGE_KEY_TOKEN : 'casinoToken');
            if (!token) return;
            fetch('/api/subscription/status', { headers: { Authorization: 'Bearer ' + token } })
                .then(function(r) { return r.ok ? r.json() : null; })
                .then(function(data) {
                    if (!data || !data.active || data.dailyClaimedToday) return;
                    return fetch('/api/subscription/claim-daily', {
                        method: 'POST',
                        headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }
                    })
                        .then(function(r) { return r.ok ? r.json() : null; })
                        .then(function(claim) {
                            if (!claim || !claim.success) return;
                            var msg = '\uD83C\uDF81 Casino Pass: +' + claim.gemsAwarded + ' gems collected!';
                            if (typeof showWinToast === 'function') {
                                showWinToast(msg);
                            } else {
                                var toast = document.createElement('div');
                                toast.textContent = msg;
                                toast.style.cssText = 'position:fixed;bottom:80px;left:50%;transform:translateX(-50%);background:rgba(0,0,0,0.85);color:#fff;padding:12px 20px;border-radius:10px;z-index:99999;font-size:1rem;pointer-events:none;';
                                document.body.appendChild(toast);
                                setTimeout(function() { if (toast.parentNode) toast.parentNode.removeChild(toast); }, 3500);
                            }
                        });
                })
                .catch(function() {});
        }

        // ── Gifts inbox auto-check ─────────────────────────────────────────────
        function _checkGiftsInbox() {
            if (typeof isServerAuthToken !== 'function' || !isServerAuthToken()) return;
            var token = localStorage.getItem(typeof STORAGE_KEY_TOKEN !== 'undefined' ? STORAGE_KEY_TOKEN : 'casinoToken');
            if (!token) return;
            if (sessionStorage.getItem('_giftsInboxChecked')) return;
            fetch('/api/gifts/inbox', { headers: { Authorization: 'Bearer ' + token } })
                .then(function(r) { return r.ok ? r.json() : null; })
                .then(function(data) {
                    if (!data || !data.gifts || !data.gifts.length) return;
                    sessionStorage.setItem('_giftsInboxChecked', '1');
                    var msg = '\uD83C\uDF81 You have ' + data.gifts.length + ' pending gift(s)! Check your notifications.';
                    if (typeof showWinToast === 'function') {
                        showWinToast(msg);
                    } else {
                        var toast = document.createElement('div');
                        toast.textContent = msg;
                        toast.style.cssText = 'position:fixed;bottom:80px;left:50%;transform:translateX(-50%);background:rgba(0,0,0,0.85);color:#fff;padding:12px 20px;border-radius:10px;z-index:99999;font-size:1rem;pointer-events:none;';
                        document.body.appendChild(toast);
                        setTimeout(function() { if (toast.parentNode) toast.parentNode.removeChild(toast); }, 3500);
                    }
                })
                .catch(function() {});
        }

        // ── XP server sync ────────────────────────────────────────────────────
        async function _syncXpWithServer() {
            if (typeof isServerAuthToken !== 'function' || !isServerAuthToken()) return;
            var token = localStorage.getItem(typeof STORAGE_KEY_TOKEN !== 'undefined' ? STORAGE_KEY_TOKEN : 'casinoToken');
            if (!token) return;
            var xpKey = typeof STORAGE_KEY_XP !== 'undefined' ? STORAGE_KEY_XP : 'casinoXP';
            var clientXpData = localStorage.getItem(xpKey);
            if (!clientXpData) return;
            var xp = 0;
            try {
                var parsed = JSON.parse(clientXpData);
                xp = (parsed && typeof parsed === 'object') ? (parsed.totalXP || parsed.xp || 0) : (Number(parsed) || 0);
            } catch (e) { return; }
            if (!xp || xp <= 0) return;
            try {
                var resp = await fetch('/api/xpshop/sync-xp', {
                    method: 'POST',
                    headers: {
                        Authorization: 'Bearer ' + token,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({ xp: Math.floor(xp) })
                });
                if (!resp.ok) return;
                var result = await resp.json();
                if (result && typeof result.xp === 'number' && result.xp > xp) {
                    // Server is authoritative — update localStorage if server has a higher value
                    try {
                        var stored = JSON.parse(localStorage.getItem(xpKey));
                        if (stored && typeof stored === 'object') {
                            stored.xp = result.xp;
                            if (typeof stored.totalXP !== 'undefined') stored.totalXP = result.xp;
                            localStorage.setItem(xpKey, JSON.stringify(stored));
                        } else {
                            localStorage.setItem(xpKey, JSON.stringify({ xp: result.xp }));
                        }
                    } catch (e) { /* ignore storage errors */ }
                }
            } catch (e) { /* network / parse errors are non-fatal */ }
        }

        // ── Tournament score recording ─────────────────────────────────────────
        function _initTournamentRecording() {
            if (window._tournamentRecordingInit) return;
            window._tournamentRecordingInit = true;
            window.addEventListener('spin:complete', function(evt) {
                var detail = evt && evt.detail;
                if (!detail || detail.won !== true || !(detail.winAmount > 0)) return;
                if (typeof isServerAuthToken !== 'function' || !isServerAuthToken()) return;
                var token = localStorage.getItem(typeof STORAGE_KEY_TOKEN !== 'undefined' ? STORAGE_KEY_TOKEN : 'casinoToken');
                if (!token) return;
                var payload = {
                    winAmount: detail.winAmount,
                    betAmount: detail.betAmount,
                    multiplier: detail.winAmount / Math.max(detail.betAmount, 0.01)
                };
                fetch('/api/tournament/record', {
                    method: 'POST',
                    headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload)
                }).catch(function() {});
            });
        }

        // ── Loss Streak Monitor ────────────────────────────────────────────────
        // Watches client-side spin results; shows a 50% deposit-match popup after
        // 8 of 10 consecutive losses without having shown the offer this session.
        function _initLossStreakMonitor() {
            if (window._lossStreakMonitorInit) return;
            window._lossStreakMonitorInit = true;

            if (typeof isServerAuthToken !== 'function' || !isServerAuthToken()) return;

            // Inject CSS for the loss-streak modal (static string, no interpolation)
            if (!document.getElementById('loss-streak-monitor-css')) {
                var styleEl = document.createElement('style');
                styleEl.id = 'loss-streak-monitor-css';
                styleEl.textContent = '#loss-streak-modal-overlay { position:fixed; inset:0; background:rgba(0,0,0,0.7); z-index:9999; display:flex; align-items:center; justify-content:center; }' +
                    '#loss-streak-modal { background:#1a1a2e; border:2px solid #f7931e; border-radius:12px; padding:30px; max-width:380px; width:90%; text-align:center; color:#fff; }' +
                    '#loss-streak-modal h3 { color:#ffd700; font-size:22px; margin:0 0 12px; }' +
                    '#loss-streak-modal p { color:#ccc; font-size:14px; margin:0 0 20px; line-height:1.5; }' +
                    '.loss-streak-btn-primary { background:linear-gradient(135deg,#f7931e,#ffd700); color:#000; font-weight:700; padding:12px 24px; border-radius:8px; border:none; cursor:pointer; font-size:15px; margin-right:10px; }' +
                    '.loss-streak-btn-secondary { background:transparent; color:#888; padding:12px 24px; border-radius:8px; border:1px solid #444; cursor:pointer; font-size:14px; }';
                document.head.appendChild(styleEl);
            }

            window._lossStreakSpinResults = window._lossStreakSpinResults || [];

            window.addEventListener('spin:complete', function(evt) {
                var detail = evt && evt.detail;
                if (!detail) return;

                // Push result (cap array at 10)
                window._lossStreakSpinResults.push({ won: !!detail.won });
                if (window._lossStreakSpinResults.length > 10) {
                    window._lossStreakSpinResults.shift();
                }

                // Only evaluate when we have 10 results
                if (window._lossStreakSpinResults.length < 10) return;
                if (window._lossStreakOfferShown === true) return;

                // Count losses
                var lossCount = 0;
                for (var i = 0; i < window._lossStreakSpinResults.length; i++) {
                    if (!window._lossStreakSpinResults[i].won) lossCount++;
                }
                if (lossCount < 8) return;

                // Check eligibility with server
                var token = localStorage.getItem(typeof STORAGE_KEY_TOKEN !== 'undefined' ? STORAGE_KEY_TOKEN : 'casinoToken');
                if (!token) return;

                fetch('/api/user/loss-streak-offer', { headers: { Authorization: 'Bearer ' + token } })
                    .then(function(r) { return r.ok ? r.json() : null; })
                    .then(function(data) {
                        if (!data || !data.eligible || !data.offer) return;
                        window._lossStreakOfferShown = true;
                        window._lossStreakSpinResults = [];
                        _showLossStreakMonitorModal(data.offer);
                    })
                    .catch(function() {});
            });
        }

        function _showLossStreakMonitorModal(offer) {
            if (document.getElementById('loss-streak-modal-overlay')) return;

            var overlay = document.createElement('div');
            overlay.id = 'loss-streak-modal-overlay';

            var modal = document.createElement('div');
            modal.id = 'loss-streak-modal';

            var title = document.createElement('h3');
            title.textContent = '\uD83C\uDF81 Exclusive Offer!';

            var body = document.createElement('p');
            body.textContent = "You've been unlucky lately. Claim a 50% deposit bonus up to $25 when you deposit $10+";

            var btnRow = document.createElement('div');

            var claimBtn = document.createElement('button');
            claimBtn.className = 'loss-streak-btn-primary';
            claimBtn.textContent = 'Claim Now';
            claimBtn.addEventListener('click', function() {
                overlay.remove();
                if (typeof openWalletModal === 'function') {
                    openWalletModal();
                } else if (typeof showWalletModal === 'function') {
                    showWalletModal();
                }
            });

            var dismissBtn = document.createElement('button');
            dismissBtn.className = 'loss-streak-btn-secondary';
            dismissBtn.textContent = 'No Thanks';
            dismissBtn.addEventListener('click', function() {
                overlay.remove();
            });

            btnRow.appendChild(claimBtn);
            btnRow.appendChild(dismissBtn);
            modal.appendChild(title);
            modal.appendChild(body);
            modal.appendChild(btnRow);
            overlay.appendChild(modal);
            document.body.appendChild(overlay);
        }

        // ── Spin Streak Ticker ─────────────────────────────────────────────────
        // Calls POST /api/spinstreak/tick after every spin and shows a badge
        // next to the spin button indicating the current streak tier.
        function _initSpinStreakTicker() {
            if (window._spinStreakTickerInit) return;
            window._spinStreakTickerInit = true;

            // Inject CSS for the spin streak badge (static string, no interpolation)
            if (!document.getElementById('spin-streak-css')) {
                var styleEl = document.createElement('style');
                styleEl.id = 'spin-streak-css';
                styleEl.textContent = '#spin-streak-badge { display:inline-block; padding:3px 10px; background:linear-gradient(135deg,#ff6b35,#f7931e); color:#fff; font-weight:700; font-size:12px; border-radius:20px; margin-left:8px; transition:transform 0.2s; }' +
                    '#spin-streak-badge.streak-tier-up { transform:scale(1.3); background:linear-gradient(135deg,#f7931e,#ffd700); }' +
                    '#spin-streak-badge.hidden { display:none; }';
                document.head.appendChild(styleEl);
            }

            window.addEventListener('spin:complete', function() {
                var token = localStorage.getItem(typeof STORAGE_KEY_TOKEN !== 'undefined' ? STORAGE_KEY_TOKEN : 'casinoToken');
                if (!token) return;

                fetch('/api/spinstreak/tick', {
                    method: 'POST',
                    headers: {
                        Authorization: 'Bearer ' + token,
                        'Content-Type': 'application/json'
                    }
                })
                    .then(function(r) { return r.ok ? r.json() : null; })
                    .then(function(data) {
                        if (!data) return;
                        _updateSpinStreakBadge(data);
                    })
                    .catch(function() {});
            });
        }

        function _updateSpinStreakBadge(data) {
            // Find or create the badge element
            var badge = document.getElementById('spin-streak-badge');
            if (!badge) {
                badge = document.createElement('div');
                badge.id = 'spin-streak-badge';
                badge.className = 'hidden';
                // Insert after the spin button (try several selector patterns)
                var spinBtn = document.getElementById('spin-btn') ||
                              document.getElementById('spinBtn') ||
                              document.querySelector('.spin-button');
                if (spinBtn && spinBtn.parentNode) {
                    spinBtn.parentNode.insertBefore(badge, spinBtn.nextSibling);
                } else {
                    // Fallback: append to body (won't be visible in slot UI but won't throw)
                    document.body.appendChild(badge);
                }
            }

            var count = data.count || 0;
            var tierLabel = data.tierLabel || 'No Streak';

            if (count === 0 || tierLabel === 'No Streak') {
                badge.className = 'hidden';
                return;
            }

            // Build label text using safe textContent
            var labelText = '\uD83D\uDD25 ' + count + ' \u00B7 ' + tierLabel;
            badge.textContent = labelText;
            badge.className = '';

            // Tooltip for next tier
            if (data.nextTier && data.nextTier.spinsNeeded && data.nextTier.label) {
                badge.title = data.nextTier.spinsNeeded + ' more for ' + data.nextTier.label;
            } else {
                badge.title = '';
            }

            // Animate on tier-up
            if (data.tieredUp) {
                badge.classList.add('streak-tier-up');
                setTimeout(function() {
                    badge.classList.remove('streak-tier-up');
                }, 2000);
            }
        }

        // ── Mystery Drop Checker ───────────────────────────────────────────────
        // Polls /api/mystery every 10 spins (and once at startup after 15s)
        // to detect and auto-claim pending mystery drops.
        function _initMysteryDropChecker() {
            if (window._mysteryDropInit) return;
            window._mysteryDropInit = true;

            window._mysteryDropCheckCount = 0;

            window.addEventListener('spin:complete', function() {
                window._mysteryDropCheckCount = (window._mysteryDropCheckCount || 0) + 1;
                if (window._mysteryDropCheckCount % 10 === 0) {
                    _checkMysteryDropPending();
                }
            });

            // Also check once at startup in case a drop is already pending
            setTimeout(function() {
                _checkMysteryDropPending();
            }, 15000);
        }

        function _checkMysteryDropPending() {
            if (typeof isServerAuthToken !== 'function' || !isServerAuthToken()) return;
            var token = localStorage.getItem(typeof STORAGE_KEY_TOKEN !== 'undefined' ? STORAGE_KEY_TOKEN : 'casinoToken');
            if (!token) return;
            fetch('/api/mystery', { headers: { Authorization: 'Bearer ' + token } })
                .then(function(r) { return r.ok ? r.json() : null; })
                .then(function(data) {
                    if (!data || !data.pending) return;
                    _showMysteryDropToast();
                    setTimeout(function() { _claimMysteryDrop(token); }, 2000);
                })
                .catch(function() {});
        }

        function _showMysteryDropToast() {
            // Inject CSS once
            if (!document.getElementById('mystery-drop-css')) {
                var styleEl = document.createElement('style');
                styleEl.id = 'mystery-drop-css';
                styleEl.textContent = '#mystery-drop-toast { position:fixed; top:20px; left:50%; transform:translateX(-50%); z-index:99999; background:linear-gradient(135deg,#6a0dad,#ffd700); color:#fff; font-weight:700; font-size:15px; padding:12px 28px; border-radius:30px; box-shadow:0 4px 24px rgba(106,13,173,0.5); pointer-events:none; opacity:1; transition:opacity 0.5s; }';
                document.head.appendChild(styleEl);
            }

            // Remove any existing toast first
            var existing = document.getElementById('mystery-drop-toast');
            if (existing) { existing.remove(); }

            var toast = document.createElement('div');
            toast.id = 'mystery-drop-toast';
            toast.textContent = '\uD83C\uDF81 Mystery Drop incoming! Claiming your reward...';
            document.body.appendChild(toast);

            setTimeout(function() {
                toast.style.opacity = '0';
                setTimeout(function() { toast.remove(); }, 500);
            }, 4000);
        }

        function _claimMysteryDrop(token) {
            fetch('/api/mystery/claim', {
                method: 'POST',
                headers: {
                    Authorization: 'Bearer ' + token,
                    'Content-Type': 'application/json'
                }
            })
                .then(function(r) { return r.ok ? r.json() : null; })
                .then(function(data) {
                    if (!data || !data.reward) return;
                    var reward = data.reward;
                    var msg = '';
                    if (reward.type === 'gems') {
                        msg = '\uD83C\uDF81 Mystery Drop: +' + reward.amount + ' Gems!';
                    } else if (reward.type === 'credits') {
                        var amt = typeof data.newBalance !== 'undefined'
                            ? reward.amount
                            : reward.amount;
                        var formatted = (typeof amt === 'number') ? amt.toFixed(2) : amt;
                        msg = '\uD83C\uDF81 Mystery Drop: +$' + formatted + ' Credits!';
                        if (typeof data.newBalance !== 'undefined' && typeof updateBalanceDisplay === 'function') {
                            updateBalanceDisplay(data.newBalance);
                        }
                    } else if (reward.type === 'wheel_spins') {
                        msg = '\uD83C\uDF81 Mystery Drop: +' + reward.amount + ' Bonus Wheel Spins!';
                    } else if (reward.type === 'promo') {
                        msg = '\uD83C\uDF81 Mystery Drop: Promo Code ' + (reward.code || '') + ' saved!';
                    } else {
                        msg = '\uD83C\uDF81 Mystery Drop claimed!';
                    }
                    _showMysteryDropResultToast(msg);
                })
                .catch(function() {});
        }

        function _showMysteryDropResultToast(message) {
            var existing = document.getElementById('mystery-drop-result-toast');
            if (existing) { existing.remove(); }

            var toast = document.createElement('div');
            toast.id = 'mystery-drop-result-toast';
            toast.style.cssText = 'position:fixed;top:20px;left:50%;transform:translateX(-50%);z-index:99999;background:linear-gradient(135deg,#1a0535,#ffd700);color:#fff;font-weight:700;font-size:15px;padding:12px 28px;border-radius:30px;box-shadow:0 4px 24px rgba(255,215,0,0.5);pointer-events:none;transition:opacity 0.5s;';
            toast.textContent = message;
            document.body.appendChild(toast);

            setTimeout(function() {
                toast.style.opacity = '0';
                setTimeout(function() { toast.remove(); }, 500);
            }, 5000);
        }

        // ── Achievements check ─────────────────────────────────────────────────
        function _checkAchievements() {
            if (typeof isServerAuthToken !== 'function' || !isServerAuthToken()) return;
            var token = localStorage.getItem(typeof STORAGE_KEY_TOKEN !== 'undefined' ? STORAGE_KEY_TOKEN : 'casinoToken');
            if (!token) return;
            fetch('/api/achievements/check', {
                method: 'POST',
                headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }
            })
                .then(function(r) { return r.ok ? r.json() : null; })
                .then(function(data) {
                    if (!data || !data.newlyUnlocked || !data.newlyUnlocked.length) return;
                    data.newlyUnlocked.forEach(function(ach, i) {
                        setTimeout(function() {
                            if (typeof showMessage === 'function') {
                                showMessage((ach.icon || '\uD83C\uDFC6') + ' Achievement Unlocked: ' + ach.name, 'big-win');
                            }
                        }, i * 2500);
                    });
                })
                .catch(function() {});
        }

        // ── Notification bell ──────────────────────────────────────────────────
        function _initNotificationBell() {
            if (document.getElementById('notifBellBtn')) return;
            if (typeof isServerAuthToken !== 'function' || !isServerAuthToken()) return;
            var headerActions = document.querySelector('.header-actions');
            if (!headerActions) return;
            var settingsBtn = headerActions.querySelector('.btn-settings');
            var bellBtn = document.createElement('button');
            bellBtn.id = 'notifBellBtn';
            bellBtn.className = 'btn-icon btn-notif';
            bellBtn.title = 'Notifications';
            bellBtn.style.cssText = 'position:relative;background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.1);border-radius:8px;padding:8px 10px;cursor:pointer;color:#e2e8f0;font-size:1rem;line-height:1;';
            bellBtn.textContent = '\uD83D\uDD14';
            bellBtn.addEventListener('click', _toggleNotifPanel);
            var badge = document.createElement('span');
            badge.id = 'notifBadge';
            badge.style.cssText = [
                'position:absolute', 'top:-5px', 'right:-5px',
                'background:#ef4444', 'color:#fff', 'border-radius:999px',
                'font-size:0.65rem', 'font-weight:800', 'min-width:16px',
                'height:16px', 'line-height:16px', 'text-align:center',
                'padding:0 3px', 'display:none'
            ].join(';');
            bellBtn.appendChild(badge);
            if (settingsBtn) {
                headerActions.insertBefore(bellBtn, settingsBtn);
            } else {
                headerActions.appendChild(bellBtn);
            }
            var tok = localStorage.getItem(typeof STORAGE_KEY_TOKEN !== 'undefined' ? STORAGE_KEY_TOKEN : 'casinoToken');
            _refreshNotifications(tok);
            setInterval(function() {
                var t = localStorage.getItem(typeof STORAGE_KEY_TOKEN !== 'undefined' ? STORAGE_KEY_TOKEN : 'casinoToken');
                _refreshNotifications(t);
            }, 60000);
        }

        function _refreshNotifications(token) {
            if (!token) return;
            fetch('/api/notifications', { headers: { Authorization: 'Bearer ' + token } })
                .then(function(r) { return r.ok ? r.json() : null; })
                .then(function(data) {
                    if (!data) return;
                    window._notifCache = data.notifications || [];
                    var badge = document.getElementById('notifBadge');
                    if (badge) {
                        var cnt = data.unreadCount || 0;
                        badge.textContent = cnt > 9 ? '9+' : String(cnt);
                        badge.style.display = cnt > 0 ? 'block' : 'none';
                    }
                })
                .catch(function() {});
        }

        function _toggleNotifPanel() {
            var existing = document.getElementById('notifPanel');
            if (existing) { existing.remove(); return; }
            var panel = document.createElement('div');
            panel.id = 'notifPanel';
            panel.style.cssText = [
                'position:fixed', 'top:72px', 'right:16px', 'width:320px',
                'max-height:420px', 'overflow-y:auto',
                'background:#1e1b4b', 'border:1px solid rgba(139,92,246,0.3)',
                'border-radius:12px', 'box-shadow:0 8px 32px rgba(0,0,0,0.6)',
                'z-index:8000', 'padding:12px 0'
            ].join(';');
            var header = document.createElement('div');
            header.style.cssText = 'padding:8px 16px 12px;font-weight:800;font-size:0.9rem;color:#e2e8f0;border-bottom:1px solid rgba(255,255,255,0.08);display:flex;justify-content:space-between;align-items:center;';
            var headerTitle = document.createElement('span');
            headerTitle.textContent = '\uD83D\uDD14 Notifications';
            var readAllBtn = document.createElement('button');
            readAllBtn.style.cssText = 'background:none;border:none;color:#8b5cf6;font-size:0.75rem;cursor:pointer;font-weight:700;';
            readAllBtn.textContent = 'Mark all read';
            readAllBtn.addEventListener('click', function() {
                var tok = localStorage.getItem(typeof STORAGE_KEY_TOKEN !== 'undefined' ? STORAGE_KEY_TOKEN : 'casinoToken');
                fetch('/api/notifications/read-all', { method: 'POST', headers: { Authorization: 'Bearer ' + tok } })
                    .then(function() { _refreshNotifications(tok); panel.remove(); })
                    .catch(function() {});
            });
            header.appendChild(headerTitle);
            header.appendChild(readAllBtn);
            panel.appendChild(header);
            var notifs = window._notifCache || [];
            if (notifs.length === 0) {
                var empty = document.createElement('div');
                empty.style.cssText = 'padding:24px 16px;text-align:center;color:#6b7280;font-size:0.85rem;';
                empty.textContent = 'No notifications yet';
                panel.appendChild(empty);
            } else {
                notifs.forEach(function(n) {
                    var item = document.createElement('div');
                    item.style.cssText = 'padding:12px 16px;border-bottom:1px solid rgba(255,255,255,0.05);cursor:pointer;' + (n.read_at ? 'opacity:0.6;' : 'background:rgba(139,92,246,0.05);');
                    var nTitle = document.createElement('div');
                    nTitle.style.cssText = 'font-weight:700;font-size:0.85rem;color:#e2e8f0;margin-bottom:3px;';
                    nTitle.textContent = n.title || '';
                    var nBody = document.createElement('div');
                    nBody.style.cssText = 'font-size:0.78rem;color:#9ca3af;line-height:1.4;';
                    nBody.textContent = n.body || n.message || '';
                    item.appendChild(nTitle);
                    item.appendChild(nBody);
                    item.addEventListener('click', function() {
                        var tok = localStorage.getItem(typeof STORAGE_KEY_TOKEN !== 'undefined' ? STORAGE_KEY_TOKEN : 'casinoToken');
                        fetch('/api/notifications/read/' + n.id, { method: 'POST', headers: { Authorization: 'Bearer ' + tok } })
                            .then(function() { _refreshNotifications(tok); })
                            .catch(function() {});
                        if (n.link_action === 'wallet') {
                            panel.remove();
                            if (typeof showWalletModal === 'function') showWalletModal();
                        } else if (n.link_action === 'vip') {
                            panel.remove();
                            if (typeof openVipModal === 'function') openVipModal();
                        } else {
                            panel.remove();
                        }
                    });
                    panel.appendChild(item);
                });
            }
            document.body.appendChild(panel);
            setTimeout(function() {
                document.addEventListener('click', function _closeNotif(ev) {
                    if (!panel.contains(ev.target) && ev.target.id !== 'notifBellBtn') {
                        panel.remove();
                        document.removeEventListener('click', _closeNotif);
                    }
                });
            }, 0);
        }

        window.addEventListener('beforeunload', function () {
            if (window._sessionDurationTimer) {
                clearInterval(window._sessionDurationTimer);
                window._sessionDurationTimer = null;
            }
            // Flush any pending debounced stats sync immediately
            if (_statsSyncTimer) {
                clearTimeout(_statsSyncTimer);
                _statsSyncTimer = null;
                _pushStatsToServer(); // fire-and-forget on unload
            }
        });


        // ===== Update init to include new systems =====
        async function initAllSystems() {
            // Check for password reset token in URL before anything else
            if (typeof checkResetTokenOnLoad === 'function' && checkResetTokenOnLoad()) {
                // Reset flow is active — show auth modal with reset form
                document.body.classList.add('auth-gate');
                loadXP();
                loadDailyBonus();
                loadWheelState();
                initBase();
                updateAuthButton();
                return;
            }

            // Fast-path: if no session exists, show auth immediately.
            // currentUser is already restored from localStorage by globals.js,
            // but authToken may be missing (e.g. cleared/expired). Treat stale
            // user data without a token as unauthenticated.
            if (!currentUser || !authToken) {
                // Clear stale user data if token is gone but user object remains
                if (currentUser && !authToken) {
                    currentUser = null;
                    localStorage.removeItem(STORAGE_KEY_USER);
                }
                document.body.classList.add('auth-gate');
                // Still run essential non-lobby inits so modals work correctly
                loadXP();
                loadDailyBonus();
                loadWheelState();
                initBase();
                updateAuthButton();
                showAuthModal();
                return;
            }

            loadXP();
            loadDailyBonus();
            loadWheelState();
            initBase();

            // New systems
            updateXPDisplay();
            renderVipBadge();
            startWinTicker();
            updateAuthButton();
            await syncServerSession();

            if (!currentUser) {
                // Token was invalidated by server (e.g. 401) — re-gate
                document.body.classList.add('auth-gate');
                showAuthModal();
                return;
            }

            // Guest balance: only grant $1,000 if they have zero or no saved balance
            // (prevents infinite-reload exploit while still giving new guests starter funds)
            if (currentUser.isGuest && (!balance || balance <= 0)) {
                balance = 1000;
                updateBalance();
                saveBalance();
            }

            // Successfully authenticated — ensure auth-gate is removed
            document.body.classList.remove('auth-gate');
            onPostAuthInit();
        }


        // ═══════════════════════════════════════════════════════
        // KEYBOARD SHORTCUTS
        // ═══════════════════════════════════════════════════════

        window.addEventListener('DOMContentLoaded', initAllSystems);

        // Refresh balance when the tab regains focus. Common after
        // a Stripe deposit completes in another tab — without this
        // the credited balance wouldn't show until a manual refresh.
        window.addEventListener('focus', function () {
            if (!authToken) return;
            if (typeof _refreshBalanceFromServer === 'function') {
                _refreshBalanceFromServer(authToken).catch(function () { /* ignore */ });
            }
        });

        document.addEventListener('keydown', function (e) {
            // Don't trigger if typing in an input
            if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

            const slotModal = document.getElementById('slotModal');
            const slotOpen = slotModal && slotModal.classList.contains('active');

            switch (e.code) {
                case 'Space':
                case 'Enter':
                    if (slotOpen && !spinning) {
                        e.preventDefault();
                        spin();
                    }
                    break;
                case 'Escape':
                    // Close topmost modal
                    const paytable = document.getElementById('paytablePanel');
                    if (paytable && paytable.classList.contains('active')) {
                        togglePaytable();
                    } else if (document.getElementById('settingsModal').classList.contains('active')) {
                        closeSettingsModal();
                    } else if (document.getElementById('statsModal').classList.contains('active')) {
                        closeStatsModal();
                    } else if (slotOpen) {
                        closeSlot();
                    }
                    break;
                case 'KeyT':
                    if (slotOpen) {
                        e.preventDefault();
                        toggleTurbo();
                    }
                    break;
                case 'KeyA':
                    if (slotOpen) {
                        e.preventDefault();
                        toggleAutoSpin(10);
                    }
                    break;
                case 'KeyI':
                    if (slotOpen) {
                        e.preventDefault();
                        togglePaytable();
                    }
                    break;
                default:
                    break;
            }
        });

        // ═══════════════════════════════════════════════════════
        // CLICK-OUTSIDE-TO-CLOSE — all modal overlays
        // Clicking the dark backdrop (but NOT the inner content box)
        // closes the topmost modal.  Auth and slot modals are excluded.
        // ═══════════════════════════════════════════════════════
        document.addEventListener('click', function(e) {
            var el = e.target;

            // Must be a modal/overlay element itself (not a child inside it)
            var isModalOverlay = el.classList.contains('modal') ||
                                 el.classList.contains('modal-overlay') ||
                                 el.classList.contains('autoplay-modal-overlay');
            if (!isModalOverlay) return;

            // Never auto-close the auth gate or slot game modal
            var excludedIds = ['authModal', 'slotModal'];
            if (excludedIds.indexOf(el.id) !== -1) return;

            // Only act if the modal is currently visible/active
            var isActive = el.classList.contains('active') ||
                           (el.style.display && el.style.display !== 'none');
            if (!isActive) return;

            // Try dedicated close button first, then named close functions,
            // then fall back to removing the active class / hiding the element.
            var closeBtn = el.querySelector(
                '.modal-close, .close-btn, .auth-close-btn, .modal-close-btn, ' +
                '.daily-skip-btn, .autoplay-modal-close, .back-btn[onclick*="close"]'
            );
            if (closeBtn) {
                closeBtn.click();
                return;
            }

            // Named close functions wired to specific modal IDs
            var closeFnMap = {
                'settingsModal':    function() { if (typeof closeSettingsModal === 'function') closeSettingsModal(); },
                'statsModal':       function() { if (typeof closeStatsModal === 'function') closeStatsModal(); },
                'walletModal':      function() { if (typeof hideWalletModal === 'function') hideWalletModal(); },
                'dailyBonusModal':  function() { if (typeof closeDailyBonusModal === 'function') closeDailyBonusModal(); },
                'bonusWheelModal':  function() { if (typeof closeBonusWheelModal === 'function') closeBonusWheelModal(); },
                'autoplayOverlay':  function() { if (typeof closeAutoplayModal === 'function') closeAutoplayModal(); }
            };
            if (el.id && closeFnMap[el.id]) {
                closeFnMap[el.id]();
                return;
            }

            // Generic fallback: remove active class and hide
            el.classList.remove('active');
            el.style.display = 'none';
        });

        function _checkComebackBonus() {
            if (sessionStorage.getItem('_comebackBonusChecked')) return;
            sessionStorage.setItem('_comebackBonusChecked', '1');
            if (typeof isServerAuthToken !== 'function' || !isServerAuthToken()) return;
            var token = localStorage.getItem(typeof STORAGE_KEY_TOKEN !== 'undefined' ? STORAGE_KEY_TOKEN : 'casinoToken');
            if (!token) return;
            fetch('/api/user/comeback-bonus', { headers: { Authorization: 'Bearer ' + token } })
                .then(function(r) { return r.ok ? r.json() : null; })
                .then(function(data) {
                    if (data && data.eligible === true) {
                        _showComebackBonusModal(data);
                    }
                })
                .catch(function() {});
        }

        function _showComebackBonusModal(data) {
            if (document.getElementById('comebackBonusOverlay')) return;

            var tierColors = {
                gold:   { pill: '#f0a500', text: '#1a1a00', border: '#f0a500' },
                silver: { pill: '#a8a9ad', text: '#111',    border: '#a8a9ad' },
                bronze: { pill: '#cd7f32', text: '#1a0a00', border: '#cd7f32' }
            };
            var tier = (data.tier && tierColors[data.tier]) ? data.tier : 'gold';
            var tc = tierColors[tier];

            var overlay = document.createElement('div');
            overlay.id = 'comebackBonusOverlay';
            overlay.style.cssText = [
                'position:fixed', 'top:0', 'left:0', 'right:0', 'bottom:0',
                'background:rgba(0,0,0,0.82)', 'display:flex', 'align-items:center',
                'justify-content:center', 'z-index:9000', 'padding:16px'
            ].join(';');

            var card = document.createElement('div');
            card.style.cssText = [
                'background:#1a1a2e',
                'border:2px solid #f0a500',
                'border-radius:16px',
                'padding:28px 32px',
                'max-width:380px',
                'width:100%',
                'text-align:center',
                'position:relative',
                'box-shadow:0 16px 48px rgba(240,165,0,0.25)'
            ].join(';');

            var tierBadge = document.createElement('div');
            tierBadge.style.cssText = [
                'display:inline-block',
                'background:' + tc.pill,
                'color:' + tc.text,
                'border-radius:20px',
                'padding:3px 14px',
                'font-size:0.72rem',
                'font-weight:800',
                'letter-spacing:1px',
                'text-transform:uppercase',
                'margin-bottom:14px'
            ].join(';');
            tierBadge.textContent = tier.charAt(0).toUpperCase() + tier.slice(1) + ' Offer';

            var headline = document.createElement('h2');
            headline.style.cssText = 'font-size:1.4rem;font-weight:900;color:#fff;margin:0 0 10px;';
            headline.textContent = "You've Hit a Rough Patch!";

            var subText = document.createElement('p');
            subText.style.cssText = 'font-size:0.88rem;color:#c9b86c;margin:0 0 18px;line-height:1.55;';
            subText.textContent = data.message;

            var amountDisplay = document.createElement('div');
            amountDisplay.style.cssText = [
                'font-size:2rem',
                'font-weight:900',
                'color:#f0a500',
                'margin-bottom:22px',
                'letter-spacing:0.5px'
            ].join(';');
            amountDisplay.textContent = '$' + Number(data.amount).toFixed(2) + ' Bonus';

            var claimBtn = document.createElement('button');
            claimBtn.style.cssText = [
                'background:linear-gradient(135deg,#f0a500,#e67e00)',
                'color:#1a0a00', 'border:none', 'border-radius:10px',
                'padding:13px 40px', 'font-size:0.95rem', 'font-weight:800',
                'cursor:pointer', 'width:100%', 'margin-bottom:10px',
                'letter-spacing:0.4px'
            ].join(';');
            claimBtn.textContent = 'Claim Bonus';
            claimBtn.addEventListener('click', function() {
                claimBtn.disabled = true;
                claimBtn.textContent = 'Claiming...';
                var claimToken = localStorage.getItem(typeof STORAGE_KEY_TOKEN !== 'undefined' ? STORAGE_KEY_TOKEN : 'casinoToken');
                fetch('/api/user/claim-comeback-bonus', {
                    method: 'POST',
                    headers: { Authorization: 'Bearer ' + claimToken, 'Content-Type': 'application/json' }
                })
                    .then(function(r) { return r.ok ? r.json() : null; })
                    .then(function(resp) {
                        overlay.remove();
                        if (resp && resp.success) {
                            if (typeof updateBalanceDisplay === 'function' && resp.bonusBalance != null) {
                                updateBalanceDisplay(resp.bonusBalance);
                            }
                            var msg = resp.message || ('Comeback bonus of $' + Number(data.amount).toFixed(2) + ' credited!');
                            if (typeof showWinToast === 'function') {
                                showWinToast(msg);
                            } else {
                                var toast = document.createElement('div');
                                toast.style.cssText = [
                                    'position:fixed', 'bottom:30px', 'left:50%', 'transform:translateX(-50%)',
                                    'background:#f0a500', 'color:#1a0a00', 'padding:12px 24px',
                                    'border-radius:10px', 'font-weight:800', 'font-size:0.95rem',
                                    'z-index:9100', 'box-shadow:0 4px 20px rgba(0,0,0,0.4)'
                                ].join(';');
                                toast.textContent = msg;
                                document.body.appendChild(toast);
                                setTimeout(function() { if (toast.parentNode) toast.parentNode.removeChild(toast); }, 3500);
                            }
                        }
                    })
                    .catch(function() { overlay.remove(); });
            });

            var noThanksBtn = document.createElement('button');
            noThanksBtn.style.cssText = [
                'background:#2a2a40', 'color:#9ca3af', 'border:1px solid #3a3a55',
                'border-radius:10px', 'padding:10px 40px', 'font-size:0.88rem',
                'font-weight:600', 'cursor:pointer', 'width:100%'
            ].join(';');
            noThanksBtn.textContent = 'No Thanks';
            noThanksBtn.addEventListener('click', function() { overlay.remove(); });

            card.appendChild(tierBadge);
            card.appendChild(headline);
            card.appendChild(subText);
            card.appendChild(amountDisplay);
            card.appendChild(claimBtn);
            card.appendChild(noThanksBtn);
            overlay.appendChild(card);
            document.body.appendChild(overlay);
        }
