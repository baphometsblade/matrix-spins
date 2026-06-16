// ═══════════════════════════════════════════════════════
// UI-MODALS MODULE
// ═══════════════════════════════════════════════════════

        // ── Session tracking (reset on each page load) ──────────────
        const sessionStartTime = Date.now();
        let sessionSpins = 0;
        let sessionWon = 0;
        let sessionStartBalance = null; // set on first spin or modal open

        function _getSessionStartBalance() {
            if (sessionStartBalance === null) {
                sessionStartBalance = typeof balance !== 'undefined' ? balance : 0;
            }
            return sessionStartBalance;
        }

        // ── Daily Challenges ──────────────────────────────────────
        const DAILY_CHALLENGES = [
            { id: 'spins_20',   label: 'Spin It Up',    desc: 'Complete 20 spins today',              target: 20,  xp: 50,  reward: 60,  icon: '🎰', type: 'spins'   },
            { id: 'spins_50',   label: 'Spin Machine',  desc: 'Complete 50 spins today',              target: 50,  xp: 100, reward: 90,  icon: '⚡', type: 'spins'   },
            { id: 'games_3',    label: 'Game Hopper',   desc: 'Play 3 different games today',         target: 3,   xp: 75,  reward: 60,  icon: '🎮', type: 'games'   },
            { id: 'win_once',   label: 'Lucky Break',   desc: 'Win at least once today',              target: 1,   xp: 40,  reward: 45,  icon: '🍀', type: 'wins'    },
            { id: 'big_win_50', label: 'High Roller',   desc: 'Land a win worth 50x your bet',        target: 50,  xp: 150, reward: 300, icon: '💥', type: 'winMult' },
            { id: 'bonus_1',    label: 'Bonus Hunter',  desc: 'Trigger a bonus or free spins round',  target: 1,   xp: 125, reward: 180, icon: '🎁', type: 'bonuses' },
            { id: 'wager_500',  label: 'Whale Watch',   desc: 'Wager $500 total today',               target: 500, xp: 100, reward: 120, icon: '🐋', type: 'wager'   },
            { id: 'streak_3',   label: 'Hot Streak',    desc: 'Win 3 spins in a row',                 target: 3,   xp: 120, reward: 150, icon: '🔥', type: 'streak'  },
        ];
        const CHALLENGE_STORAGE_KEY = 'matrixChallenges';

        // ── Weekly Missions ──────────────────────────────────
        const WEEKLY_MISSIONS = [
            { id: 'weekly_spins_200', label: 'Marathon Spinner', desc: 'Complete 200 spins this week',        target: 200,  xp: 300, icon: '🏃', type: 'spins'   },
            { id: 'weekly_games_10',  label: 'World Tour',       desc: 'Play 10 different games this week',   target: 10,   xp: 250, icon: '🌍', type: 'games'   },
            { id: 'weekly_big_win',   label: 'Century Club',     desc: 'Land a win worth 100× your bet',      target: 1,    xp: 500, icon: '💯', type: 'winMult' },
            { id: 'weekly_wager_2k',  label: 'High Roller Week', desc: 'Wager $2,000 total this week',        target: 2000, xp: 400, icon: '🐳', type: 'wager'   },
        ];
        const WEEKLY_STORAGE_KEY = typeof STORAGE_KEY_WEEKLY_MISSIONS !== 'undefined'
            ? STORAGE_KEY_WEEKLY_MISSIONS : 'matrixWeeklyMissions';

        function _getMondayIso() {
            const d = new Date();
            const day = d.getDay();
            const diff = (day === 0 ? -6 : 1 - day);
            d.setDate(d.getDate() + diff);
            d.setHours(0, 0, 0, 0);
            return d.toISOString().slice(0, 10);
        }

        function _loadWeeklyState() {
            try {
                const raw = localStorage.getItem(WEEKLY_STORAGE_KEY);
                const state = raw ? JSON.parse(raw) : null;
                const monday = _getMondayIso();
                if (!state || state.weekStart !== monday) {
                    return { weekStart: monday, progress: {}, completed: [] };
                }
                return state;
            } catch (e) {
                return { weekStart: _getMondayIso(), progress: {}, completed: [] };
            }
        }

        function _saveWeeklyState(state) {
            try { localStorage.setItem(WEEKLY_STORAGE_KEY, JSON.stringify(state)); } catch (e) {}
        }

        function _renderWeeklyPanel() {
            const container = document.getElementById('weeklyChallengesPanel');
            if (!container) return;
            const state = _loadWeeklyState();
            const monday = _getMondayIso();
            const nextMonday = new Date(monday);
            nextMonday.setDate(nextMonday.getDate() + 7);
            const msLeft = nextMonday - Date.now();
            const dLeft = Math.floor(msLeft / 86400000);
            const hLeft = Math.floor((msLeft % 86400000) / 3600000);
            container.innerHTML = '<div class="challenge-reset-info">Resets in ' + dLeft + 'd ' + hLeft + 'h</div>' +
                WEEKLY_MISSIONS.map(m => {
                    const prog = Math.min(state.progress[m.id] || 0, m.target);
                    const done = state.completed.includes(m.id);
                    const pct  = Math.round((prog / m.target) * 100);
                    return '<div class="challenge-item' + (done ? ' challenge-done' : '') + '">' +
                        '<div class="challenge-icon">' + m.icon + '</div>' +
                        '<div class="challenge-info">' +
                            '<div class="challenge-label">' + m.label + '</div>' +
                            '<div class="challenge-desc">' + m.desc + '</div>' +
                            '<div class="challenge-progress-bar">' +
                                '<div class="challenge-progress-fill" style="width:' + pct + '%"></div>' +
                            '</div>' +
                            '<div class="challenge-progress-text">' + prog + ' / ' + m.target + (done ? ' ✓' : '') + '</div>' +
                        '</div>' +
                        '<div class="challenge-xp">+' + m.xp + ' XP</div>' +
                    '</div>';
                }).join('');
        }

        // Called from the same event pipeline as daily challenges
        window.onWeeklyMissionEvent = function(eventType, payload) {
            const state = _loadWeeklyState();
            let changed = false;

            if (eventType === 'spin') {
                state.progress['weekly_spins_200'] = (state.progress['weekly_spins_200'] || 0) + 1;
                if (payload && payload.gameId) {
                    if (!state._games) state._games = {};
                    state._games[payload.gameId] = true;
                    state.progress['weekly_games_10'] = Object.keys(state._games).length;
                }
                if ((payload && payload.wager || 0) > 0) {
                    state.progress['weekly_wager_2k'] = (state.progress['weekly_wager_2k'] || 0) + (payload.wager || 0);
                }
                if ((payload && payload.winMult || 0) >= 100) {
                    state.progress['weekly_big_win'] = 1;
                }
                changed = true;
            }

            if (changed) {
                WEEKLY_MISSIONS.forEach(m => {
                    const prog = state.progress[m.id] || 0;
                    if (prog >= m.target && !state.completed.includes(m.id)) {
                        state.completed.push(m.id);
                        if (typeof gainXP === 'function') gainXP(m.xp);
                        _showChallengeCompleteToast({ ...m, label: '📋 Weekly: ' + m.label });
                        if (typeof addNotification === 'function') {
                            addNotification('weekly', 'Weekly Mission Complete!', m.label + ' — +' + m.xp + ' XP earned');
                        }
                    }
                });
                _saveWeeklyState(state);
                _renderWeeklyPanel();
            }
        };


        // ── Achievements ──────────────────────────────────────────
        const ACH_STORAGE_KEY = 'matrixAchievements';

        const ACH_DEFS = [
            // Spin milestones
            { id: 'first_spin',    icon: '🎰', name: 'First Spin',       desc: 'Play your first spin',               req: { type: 'spins',   target: 1      } },
            { id: 'spin_10',       icon: '🔄', name: 'Getting Started',  desc: 'Complete 10 spins',                  req: { type: 'spins',   target: 10     } },
            { id: 'spin_100',      icon: '💫', name: 'Spin Master',      desc: 'Complete 100 spins',                 req: { type: 'spins',   target: 100    } },
            { id: 'spin_500',      icon: '⚡', name: 'Centurion',        desc: 'Complete 500 spins',                 req: { type: 'spins',   target: 500    } },
            { id: 'spin_1000',     icon: '🌀', name: 'Reel Veteran',     desc: 'Complete 1,000 spins',               req: { type: 'spins',   target: 1000   } },
            // Win milestones
            { id: 'first_win',     icon: '🏆', name: 'First Win',        desc: 'Win your first spin',                req: { type: 'wins',    target: 1      } },
            { id: 'win_10',        icon: '💰', name: 'On a Roll',        desc: 'Win 10 times',                       req: { type: 'wins',    target: 10     } },
            { id: 'win_50',        icon: '🤑', name: 'Lucky Streak',     desc: 'Win 50 times',                       req: { type: 'wins',    target: 50     } },
            { id: 'win_200',       icon: '🥇', name: 'Win Connoisseur',  desc: 'Win 200 times',                      req: { type: 'wins',    target: 200    } },
            // Big win multipliers
            { id: 'big_win',       icon: '💥', name: 'Big Winner',       desc: 'Win over 100x your bet',             req: { type: 'bigWin',  target: 100    } },
            { id: 'mega_win',      icon: '🌟', name: 'Mega Winner',      desc: 'Win over 500x your bet',             req: { type: 'bigWin',  target: 500    } },
            { id: 'epic_win',      icon: '🔥', name: 'Epic Winner',      desc: 'Win over 1,000x your bet',           req: { type: 'bigWin',  target: 1000   } },
            // Game variety
            { id: 'games_5',       icon: '🎮', name: 'Explorer',         desc: 'Try 5 different games',              req: { type: 'games',   target: 5      } },
            { id: 'games_20',      icon: '🗺️', name: 'Adventurer',      desc: 'Try 20 different games',             req: { type: 'games',   target: 20     } },
            { id: 'games_50',      icon: '🌍', name: 'Globe Trotter',    desc: 'Try 50 different games',             req: { type: 'games',   target: 50     } },
            { id: 'games_all',     icon: '👑', name: 'Master of All',    desc: 'Try all 150 games',                  req: { type: 'games',   target: 150    } },
            // Balance milestones
            { id: 'balance_500',   icon: '💎', name: 'Getting Rich',     desc: 'Reach a balance of $500',            req: { type: 'balance', target: 500    } },
            { id: 'balance_1000',  icon: '💰', name: 'High Balance',     desc: 'Reach a balance of $1,000',          req: { type: 'balance', target: 1000   } },
            { id: 'balance_5000',  icon: '🏦', name: 'Bank Breaker',     desc: 'Reach a balance of $5,000',          req: { type: 'balance', target: 5000   } },
            // Wager milestones
            { id: 'wager_1k',      icon: '📊', name: 'Regular',          desc: 'Wager $1,000 total',                 req: { type: 'wager',   target: 1000   } },
            { id: 'wager_10k',     icon: '📈', name: 'Whale',            desc: 'Wager $10,000 total',                req: { type: 'wager',   target: 10000  } },
            // Bonus triggers
            { id: 'bonus_5',       icon: '🎁', name: 'Bonus Seeker',     desc: 'Trigger 5 bonus rounds',             req: { type: 'bonuses', target: 5      } },
            { id: 'bonus_25',      icon: '🎯', name: 'Bonus Hunter',     desc: 'Trigger 25 bonus rounds',            req: { type: 'bonuses', target: 25     } },
            // Win streak
            { id: 'streak_5',      icon: '🔥', name: 'Hot Hand',         desc: 'Win 5 spins in a row',               req: { type: 'streak',  target: 5      } },
            { id: 'streak_10',     icon: '💠', name: 'Unstoppable',      desc: 'Win 10 spins in a row',              req: { type: 'streak',  target: 10     } },
        ];

        function _loadChallengeState() {
            try {
                const raw = JSON.parse(localStorage.getItem(CHALLENGE_STORAGE_KEY) || '{}');
                const today = new Date().toDateString();
                if (raw.date !== today) {
                    return { date: today, progress: {}, completed: [] };
                }
                return raw;
            } catch(e) {
                return { date: new Date().toDateString(), progress: {}, completed: [] };
            }
        }

        function _saveChallengeState(state) {
            try { localStorage.setItem(CHALLENGE_STORAGE_KEY, JSON.stringify(state)); } catch (e) { /* ignore */ }
        }

        function _loadAchState() {
            try {
                const d = JSON.parse(localStorage.getItem(ACH_STORAGE_KEY) || '{}');
                return {
                    spins: d.spins || 0, wins: d.wins || 0,
                    games: Array.isArray(d.games) ? d.games : [],
                    maxWinMult: d.maxWinMult || 0, maxBalance: d.maxBalance || 0,
                    totalWagered: d.totalWagered || 0,
                    bonusesTriggered: d.bonusesTriggered || 0,
                    maxStreak: d.maxStreak || 0,
                    unlocked: Array.isArray(d.unlocked) ? d.unlocked : [],
                };
            } catch(e) { return { spins:0, wins:0, games:[], maxWinMult:0, maxBalance:0, unlocked:[] }; }
        }
        function _saveAchState(s) {
            try { localStorage.setItem(ACH_STORAGE_KEY, JSON.stringify(s)); } catch(e) {}
        }

        // ── Login Streak ──────────────────────────────────────────
        const LOGIN_STREAK_KEY = 'matrixLoginStreak';

        function _loadStreakState() {
            try {
                const d = JSON.parse(localStorage.getItem(LOGIN_STREAK_KEY) || '{}');
                return {
                    lastDate: d.lastDate || null,
                    streak: d.streak || 0,
                    longestStreak: d.longestStreak || 0,
                    totalLogins: d.totalLogins || 0,
                };
            } catch(e) { return { lastDate: null, streak: 0, longestStreak: 0, totalLogins: 0 }; }
        }

        function _saveStreakState(s) {
            try { localStorage.setItem(LOGIN_STREAK_KEY, JSON.stringify(s)); } catch(e) {}
        }

        function _checkLoginStreak() {
            const s = _loadStreakState();
            const today = new Date().toISOString().slice(0, 10); // 'YYYY-MM-DD'
            if (s.lastDate === today) return s; // already checked today

            const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
            const isConsecutive = s.lastDate === yesterday;

            s.streak = isConsecutive ? s.streak + 1 : 1;
            s.longestStreak = Math.max(s.longestStreak, s.streak);
            s.totalLogins++;
            s.lastDate = today;
            _saveStreakState(s);

            // Award XP for streak milestones
            const milestones = [3, 7, 14, 30];
            if (milestones.includes(s.streak) && typeof gainXP === 'function') {
                const xpBonus = s.streak * 10;
                gainXP(xpBonus);
                _showStreakToast(s.streak, xpBonus);
            } else if (s.streak > 1) {
                _showStreakToast(s.streak, 0);
            }
            return s;
        }

        function _showStreakToast(streak, xpBonus) {
            const prev = document.getElementById('streakToast');
            if (prev) prev.remove();
            const t = document.createElement('div');
            t.id = 'streakToast';
            const emoji = streak >= 30 ? '🔥🔥🔥' : streak >= 7 ? '🔥🔥' : '🔥';
            t.style.cssText = 'position:fixed;top:70px;right:16px;transform:translateX(120%);'
                + 'background:linear-gradient(135deg,#1a1a2e,#16213e);border:1px solid #ff6d00;'
                + 'color:#fff;border-radius:12px;padding:10px 16px;font-size:13px;z-index:10400;'
                + 'box-shadow:0 4px 20px rgba(255,109,0,0.3);transition:transform 0.4s ease;'
                + 'max-width:220px;pointer-events:none;';
            t.innerHTML = `<div style="font-weight:700;margin-bottom:2px">${emoji} ${streak}-Day Streak!</div>`
                + (xpBonus > 0 ? `<div style="font-size:11px;color:#ffb74d">+${xpBonus} XP Milestone Bonus</div>` :
                   `<div style="font-size:11px;color:rgba(255,255,255,0.5)">Keep it up!</div>`);
            document.body.appendChild(t);
            requestAnimationFrame(() => requestAnimationFrame(() => {
                t.style.transform = 'translateX(0)';
            }));
            setTimeout(() => {
                t.style.transform = 'translateX(120%)';
                setTimeout(() => t.remove(), 450);
            }, 3500);
        }

        function _nextStreakMilestone(streak) {
            const milestones = [3, 7, 14, 30, 60, 100];
            return milestones.find(m => m > streak) || streak + 10;
        }

        function _renderStreakPanel() {
            const el = document.getElementById('streakPanelContainer');
            if (!el) return;
            const s = _checkLoginStreak(); // will only update once per day
            const flames = Math.min(s.streak, 5);

            el.innerHTML = `
                <div style="display:flex;align-items:center;gap:16px;flex-wrap:wrap;">
                  <div style="text-align:center;">
                    <div style="font-size:32px;line-height:1">${'🔥'.repeat(flames)}</div>
                    <div style="font-size:28px;font-weight:900;color:#ff6d00;line-height:1.1">${s.streak}</div>
                    <div style="font-size:10px;color:rgba(255,255,255,0.5);text-transform:uppercase;letter-spacing:1px">Day Streak</div>
                  </div>
                  <div style="flex:1;min-width:120px;">
                    <div class="streak-stat-row"><span>🏆 Longest Streak</span><strong>${s.longestStreak} days</strong></div>
                    <div class="streak-stat-row"><span>📅 Total Logins</span><strong>${s.totalLogins}</strong></div>
                    <div class="streak-stat-row"><span>📆 Next Milestone</span><strong>${_nextStreakMilestone(s.streak)} days</strong></div>
                  </div>
                </div>`;
        }

        function _ensureStreakPanel() {
            if (document.getElementById('streakPanelContainer')) return;
            const wrap = document.createElement('div');
            wrap.id = 'streakPanelContainer';
            wrap.style.cssText = 'margin-top:14px;padding:12px;background:rgba(255,109,0,0.06);'
                + 'border-radius:10px;border:1px solid rgba(255,109,0,0.2);';
            // Inject before achievements panel or append to statsContent
            const achPanel = document.getElementById('achPanelContainer');
            if (achPanel && achPanel.parentNode) {
                achPanel.parentNode.insertBefore(wrap, achPanel);
            } else {
                const sc = document.getElementById('statsContent') || document.querySelector('[id*="stats"]');
                if (sc) sc.appendChild(wrap);
            }
        }

        // Global hook called by spin/win code in ui-slot.js
        window.onChallengeEvent = function(eventType, payload) {
            const state = _loadChallengeState();
            let changed = false;

            if (eventType === 'spin') {
                // spin counts
                state.progress['spins_20'] = (state.progress['spins_20'] || 0) + 1;
                state.progress['spins_50'] = (state.progress['spins_50'] || 0) + 1;
                // wager
                state.progress['wager_500'] = (state.progress['wager_500'] || 0) + (payload.bet || 0);
                // game variety
                if (payload.gameId) {
                    if (!state.gamesPlayedToday) state.gamesPlayedToday = [];
                    if (!state.gamesPlayedToday.includes(payload.gameId)) {
                        state.gamesPlayedToday.push(payload.gameId);
                    }
                    state.progress['games_3'] = state.gamesPlayedToday.length;
                }
                // win
                if (payload.win && payload.win > 0) {
                    state.progress['win_once'] = Math.max(state.progress['win_once'] || 0, 1);
                }
                // win multiplier
                if ((payload.winMult || 0) >= 50) {
                    state.progress['big_win_50'] = Math.max(state.progress['big_win_50'] || 0, 1);
                }
                // win streak
                if ((payload.streak || 0) >= 3) {
                    state.progress['streak_3'] = Math.max(state.progress['streak_3'] || 0, 1);
                }
                changed = true;
            }

            if (eventType === 'bonus') {
                state.progress['bonus_1'] = Math.max(state.progress['bonus_1'] || 0, 1);
                changed = true;
            }

            if (changed) {
                DAILY_CHALLENGES.forEach(ch => {
                    const prog = state.progress[ch.id] || 0;
                    if (prog >= ch.target && !state.completed.includes(ch.id)) {
                        state.completed.push(ch.id);
                        awardXP(ch.xp);
                        // Cash reward — server-side only (bonus_balance + wagering)
                        if ((ch.reward || 0) > 0) {
                            var _chToken = typeof localStorage !== 'undefined' ? localStorage.getItem('casinoAuthToken') : null;
                            if (_chToken && !_chToken.startsWith('local_')) {
                                fetch('/api/daily-login/claim', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + _chToken }, body: JSON.stringify({ type: 'challenge', challengeId: ch.id }) }).then(function(r) { return r.json(); }).then(function(d) { if (d.newBalance !== undefined) { balance = d.newBalance; if (typeof updateBalance === 'function') updateBalance(); } }).catch(function() {});
                            }
                        }
                        _showChallengeCompleteToast(ch);
                        if (typeof window.refreshLobbyChallengeWidget === 'function') window.refreshLobbyChallengeWidget();
                    }
                });
                _saveChallengeState(state);
                _renderChallengesPanel();
            }
            _checkAchievements(eventType, payload);
        };

        function _formatDuration(ms) {
            const totalSeconds = Math.floor(ms / 1000);
            const minutes = Math.floor(totalSeconds / 60);
            const seconds = totalSeconds % 60;
            if (minutes === 0) return seconds + 's';
            return minutes + 'm ' + seconds + 's';
        }


        function updateStatsSummary() {
            const biggestWinEl = document.getElementById('biggestWin');
            if (biggestWinEl) {
                biggestWinEl.textContent = Math.round(stats.biggestWin).toLocaleString();
            }
            updateStatsModal();
        }


        function updateStatsModal() {
            const totalSpinsEl = document.getElementById('statsTotalSpins');
            if (!totalSpinsEl) return;

            const totalWageredEl = document.getElementById('statsTotalWagered');
            const totalWonEl = document.getElementById('statsTotalWon');
            const biggestWinEl = document.getElementById('statsBiggestWin');
            const netEl = document.getElementById('statsNet');
            const gamesListEl = document.getElementById('statsGamesList');
            const net = stats.totalWon - stats.totalWagered;

            totalSpinsEl.textContent = Math.round(stats.totalSpins).toLocaleString();
            totalWageredEl.textContent = `$${formatMoney(stats.totalWagered)}`;
            totalWonEl.textContent = `$${formatMoney(stats.totalWon)}`;
            biggestWinEl.textContent = `$${formatMoney(stats.biggestWin)}`;
            netEl.textContent = `${net >= 0 ? '+' : '-'}$${formatMoney(Math.abs(net))}`;
            netEl.style.color = net >= 0 ? '#34d399' : '#fca5a5';

            const playedGames = Object.entries(stats.gamesPlayed || {})
                .sort((a, b) => b[1] - a[1])
                .slice(0, 8);

            if (playedGames.length === 0) {
                gamesListEl.innerHTML = '<li class="stats-empty">No games played yet.</li>';
            } else {
                gamesListEl.innerHTML = playedGames
                    .map(([gameId, plays]) => {
                        const game = games.find((item) => item.id === gameId);
                        const gameName = game ? game.name : gameId;
                        return `<li><span>${escapeHtml(gameName)}</span><strong>${plays} ${plays === 1 ? 'play' : 'plays'}</strong></li>`;
                    })
                    .join('');
            }

            // ── Session info section ──────────────────────────────────
            _renderSessionSection();

            // ── Top games by spins with RTP section ──────────────────
            _renderTopGamesSection();

            // ── Daily Challenges section ──────────────────────────────
            _ensureDailyChallengesPanel();
            _ensureHoFPanel();
            _renderChallengesPanel();
            _initChallengesTabs();

            // Update achievements
            updateAchievements();

            // ── Achievements panel (localStorage-tracked) ─────────────
            _ensureAchievementsPanel();
            _renderAchievementsPanel();

            // ── Login Streak panel ────────────────────────────────────
            _ensureStreakPanel();
            _renderStreakPanel();

        }


        function _renderSessionSection() {
            const containerId = 'statsSessionSection';
            let container = document.getElementById(containerId);
            if (!container) {
                // Inject after the stats-grid, before "Top Played Games" heading
                const gamesListEl = document.getElementById('statsGamesList');
                if (!gamesListEl) return;
                // Find the h4 heading immediately before the games list
                let insertBefore = gamesListEl.previousElementSibling;
                while (insertBefore && insertBefore.tagName !== 'H4') {
                    insertBefore = insertBefore.previousElementSibling;
                }
                container = document.createElement('div');
                container.id = containerId;
                if (insertBefore) {
                    insertBefore.parentNode.insertBefore(container, insertBefore);
                } else {
                    gamesListEl.parentNode.insertBefore(container, gamesListEl);
                }
            }

            const startBal = _getSessionStartBalance();
            const currentBal = typeof balance !== 'undefined' ? balance : startBal;
            const netSession = currentBal - startBal;
            const durationMs = Date.now() - sessionStartTime;
            const netColor = netSession >= 0 ? '#00ff41' : '#fca5a5';
            const netPrefix = netSession >= 0 ? '+' : '-';

            container.innerHTML = `
                <h4 style="margin-bottom:10px;margin-top:20px;color:#00ff41;font-size:13px;text-transform:uppercase;letter-spacing:1px;">This Session</h4>
                <div style="display:grid;grid-template-columns:repeat(2,1fr);gap:8px;margin-bottom:16px;">
                    <div style="background:rgba(0,255,65,0.06);border:1px solid rgba(0,255,65,0.2);border-radius:8px;padding:10px 12px;">
                        <div style="font-size:10px;color:#94a3b8;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:4px;">Duration</div>
                        <div style="font-size:16px;font-weight:700;color:#e2e8f0;">${_formatDuration(durationMs)}</div>
                    </div>
                    <div style="background:rgba(0,255,65,0.06);border:1px solid rgba(0,255,65,0.2);border-radius:8px;padding:10px 12px;">
                        <div style="font-size:10px;color:#94a3b8;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:4px;">Spins</div>
                        <div style="font-size:16px;font-weight:700;color:#e2e8f0;">${sessionSpins.toLocaleString()}</div>
                    </div>
                    <div style="background:rgba(0,255,65,0.06);border:1px solid rgba(0,255,65,0.2);border-radius:8px;padding:10px 12px;">
                        <div style="font-size:10px;color:#94a3b8;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:4px;">Won This Session</div>
                        <div style="font-size:16px;font-weight:700;color:#e2e8f0;">$${formatMoney(sessionWon)}</div>
                    </div>
                    <div style="background:rgba(0,255,65,0.06);border:1px solid rgba(0,255,65,0.2);border-radius:8px;padding:10px 12px;">
                        <div style="font-size:10px;color:#94a3b8;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:4px;">Net This Session</div>
                        <div style="font-size:16px;font-weight:700;color:${netColor};">${netPrefix}$${formatMoney(Math.abs(netSession))}</div>
                    </div>
                </div>
            `;
        }


        function _renderTopGamesSection() {
            const containerId = 'statsTopGamesSection';
            let container = document.getElementById(containerId);
            if (!container) {
                const achievementsEl = document.getElementById('achievementsList');
                if (!achievementsEl) return;
                // Find the h4 before achievementsList
                let insertBefore = achievementsEl.previousElementSibling;
                while (insertBefore && insertBefore.tagName !== 'H4') {
                    insertBefore = insertBefore.previousElementSibling;
                }
                container = document.createElement('div');
                container.id = containerId;
                if (insertBefore) {
                    insertBefore.parentNode.insertBefore(container, insertBefore);
                } else {
                    achievementsEl.parentNode.insertBefore(container, achievementsEl);
                }
            }

            const gameStats = stats.gameStats || {};
            const topGames = Object.entries(gameStats)
                .filter(([, gs]) => gs.spins > 0)
                .sort((a, b) => b[1].spins - a[1].spins)
                .slice(0, 3);

            if (topGames.length === 0) {
                container.innerHTML = '';
                return;
            }

            const rows = topGames.map(([gameId, gs]) => {
                const rtp = gs.bet > 0 ? ((gs.won / gs.bet) * 100).toFixed(1) : '—';
                const rtpColor = gs.bet > 0 && gs.won / gs.bet >= 1 ? '#00ff41' : '#fca5a5';
                const name = gs.name || gameId;
                const shortName = name.length > 18 ? name.slice(0, 17) + '…' : name;
                return `
                    <div style="display:flex;align-items:center;justify-content:space-between;padding:8px 10px;background:rgba(0,0,0,0.3);border-radius:6px;margin-bottom:6px;">
                        <span style="font-size:12px;color:#e2e8f0;flex:1;min-width:0;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;" title="${escapeHtml(name)}">${escapeHtml(shortName)}</span>
                        <span style="font-size:11px;color:#94a3b8;margin:0 12px;white-space:nowrap;">${gs.spins.toLocaleString()} spins</span>
                        <span style="font-size:12px;font-weight:700;color:${rtpColor};white-space:nowrap;">${rtp === '—' ? '—' : rtp + '% RTP'}</span>
                    </div>
                `;
            }).join('');

            container.innerHTML = `
                <h4 style="margin-bottom:10px;margin-top:20px;color:#00ff41;font-size:13px;text-transform:uppercase;letter-spacing:1px;">Top Games This Account</h4>
                ${rows}
            `;
        }


        function _showChallengeCompleteToast(ch) {
            const el = document.createElement('div');
            el.style.cssText = `
                position:fixed; bottom:100px; left:50%; transform:translateX(-50%) translateY(20px);
                background:linear-gradient(135deg,#065f46,#047857); color:#d1fae5;
                padding:14px 24px; border-radius:12px; z-index:10400; font-weight:800;
                box-shadow:0 8px 24px rgba(0,200,100,0.4); text-align:center;
                animation:challengeToastIn 0.4s ease-out forwards;
                border:1px solid rgba(52,211,153,0.4); min-width:260px;
            `;
            el.innerHTML = `
                <div style="font-size:28px;margin-bottom:4px;">${ch.icon}</div>
                <div style="font-size:13px;letter-spacing:1px;margin-bottom:2px;">✅ CHALLENGE COMPLETE!</div>
                <div style="font-size:15px;">${escapeHtml(ch.label)}</div>
                <div style="font-size:12px;color:#6ee7b7;margin-top:4px;">+${ch.xp} XP${ch.reward ? ' · +$' + ch.reward : ''} awarded!</div>
            `;
            document.body.appendChild(el);
            setTimeout(() => {
                el.style.animation = 'challengeToastOut 0.4s ease-in forwards';
                setTimeout(() => el.remove(), 400);
            }, 3500);
        }


        function _renderChallengesPanel() {
            const container = document.getElementById('dailyChallengesPanel');
            if (!container) return;
            const state = _loadChallengeState();
            container.innerHTML = DAILY_CHALLENGES.map(ch => {
                const prog = Math.min(state.progress[ch.id] || 0, ch.target);
                const pct = Math.round((prog / ch.target) * 100);
                const done = state.completed.includes(ch.id);
                const barColor = done ? '#34d399' : '#3b82f6';
                return `
                <div style="margin-bottom:14px;">
                    <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;">
                        <span style="font-size:20px;">${ch.icon}</span>
                        <div style="flex:1;min-width:0;">
                            <div style="font-size:12px;font-weight:700;color:${done ? '#34d399' : '#e2e8f0'};">${escapeHtml(ch.label)}${done ? ' ✓' : ''}</div>
                            <div style="font-size:10px;color:#64748b;">${escapeHtml(ch.desc)}</div>
                        </div>
                        <div style="font-size:11px;font-weight:700;color:#fbbf24;white-space:nowrap;">+${ch.xp} XP</div>
                    </div>
                    <div style="background:rgba(255,255,255,0.07);border-radius:4px;height:6px;overflow:hidden;">
                        <div style="height:100%;width:${pct}%;background:${barColor};border-radius:4px;transition:width 0.4s ease;"></div>
                    </div>
                    <div style="font-size:10px;color:#475569;margin-top:3px;text-align:right;">${prog}/${ch.target}</div>
                </div>`;
            }).join('');
        }


        function _initChallengesTabs() {
            const tabContainer = document.getElementById('challengesTabs');
            if (!tabContainer || tabContainer.dataset.init) return;
            tabContainer.dataset.init = '1';
            tabContainer.addEventListener('click', function(e) {
                const btn = e.target.closest('[data-tab]');
                if (!btn) return;
                tabContainer.querySelectorAll('[data-tab]').forEach(b => b.classList.remove('ch-tab-active'));
                btn.classList.add('ch-tab-active');
                const tab = btn.dataset.tab;
                const daily  = document.getElementById('dailyChallengesPanel');
                const weekly = document.getElementById('weeklyChallengesPanel');
                if (daily)  daily.style.display  = tab === 'daily'  ? '' : 'none';
                if (weekly) weekly.style.display  = tab === 'weekly' ? '' : 'none';
                if (tab === 'weekly') _renderWeeklyPanel();
            });
        }

        function _ensureDailyChallengesPanel() {
            if (document.getElementById('dailyChallengesPanel')) return;
            const achievementsEl = document.getElementById('achievementsList');
            if (!achievementsEl) return;
            let insertBefore = achievementsEl.previousElementSibling;
            while (insertBefore && insertBefore.tagName !== 'H4') {
                insertBefore = insertBefore.previousElementSibling;
            }
            const wrapper = document.createElement('div');
            wrapper.innerHTML = `
                <h4 style="margin-bottom:10px;margin-top:20px;color:#3b82f6;font-size:13px;text-transform:uppercase;letter-spacing:1px;">⚡ Daily Challenges</h4>
                <div id="dailyChallengesPanel"></div>
            `;
            if (insertBefore) {
                insertBefore.parentNode.insertBefore(wrapper, insertBefore);
            } else {
                achievementsEl.parentNode.insertBefore(wrapper, achievementsEl);
            }
        }


        function updateAchievements() {
            const achievementsListEl = document.getElementById('achievementsList');
            if (!achievementsListEl) return;

            if (!stats.achievements) {
                stats.achievements = [];
            }

            const html = ACHIEVEMENTS.map(achievement => {
                const isUnlocked = stats.achievements.includes(achievement.id);
                const canUnlock = !isUnlocked && achievement.requirement(stats);

                if (canUnlock) {
                    stats.achievements.push(achievement.id);
                    saveStats();
                    showAchievementNotification(achievement);
                }

                const unlocked = stats.achievements.includes(achievement.id);

                return `
                    <div style="
                        background: ${unlocked ? 'linear-gradient(135deg, rgba(251,191,36,0.2), rgba(245,158,11,0.2))' : 'rgba(15, 23, 42, 0.8)'};
                        border: 2px solid ${unlocked ? '#fbbf24' : '#475569'};
                        border-radius: 12px;
                        padding: 12px;
                        text-align: center;
                        opacity: ${unlocked ? '1' : '0.5'};
                        transition: all 0.3s;
                    ">
                        <div style="font-size: 32px; margin-bottom: 6px;">${achievement.icon}</div>
                        <div style="font-size: 11px; font-weight: 700; color: ${unlocked ? '#fbbf24' : '#94a3b8'}; margin-bottom: 4px;">${escapeHtml(achievement.name)}</div>
                        <div style="font-size: 9px; color: #64748b;">${escapeHtml(achievement.desc)}</div>
                        ${unlocked ? '<div style="font-size: 10px; color: #10b981; margin-top: 4px; font-weight: 700;">\u2705 UNLOCKED</div>' : ''}
                    </div>
                `;
            }).join('');

            achievementsListEl.innerHTML = html;
        }


        function showAchievementNotification(achievement) {
            // Also persist in notification center
            if (typeof addNotification === "function") {
                addNotification("achievement", "🏆" + achievement.name, achievement.desc);
            }
            playSound('bigwin');

            const notification = document.createElement('div');
            notification.style.cssText = `
                position: fixed;
                top: 100px;
                right: 20px;
                background: linear-gradient(135deg, #fbbf24, #f59e0b);
                color: #000;
                padding: 20px;
                border-radius: 16px;
                box-shadow: 0 8px 32px rgba(251,191,36,0.6);
                z-index:10400;
                font-weight: 900;
                animation: slideInRight 0.5s ease-out;
                max-width: 300px;
            `;
            notification.innerHTML = `
                <div style="font-size: 48px; text-align: center; margin-bottom: 8px;">${achievement.icon}</div>
                <div style="font-size: 14px; margin-bottom: 4px;">\u{1F3C6} ACHIEVEMENT UNLOCKED!</div>
                <div style="font-size: 18px; margin-bottom: 4px;">${escapeHtml(achievement.name)}</div>
                <div style="font-size: 12px; opacity: 0.8;">${escapeHtml(achievement.desc)}</div>
            `;

            document.body.appendChild(notification);

            createConfetti();

            setTimeout(() => {
                notification.style.animation = 'slideOutRight 0.5s ease-out';
                setTimeout(() => notification.remove(), 500);
            }, 4000);
        }


        // ── Achievement System (localStorage-tracked) ─────────────────

        function _checkAchievements(eventType, payload) {
            const s = _loadAchState();
            let changed = false;
            if (eventType === 'spin') {
                s.spins++;
                if (payload.win > 0) s.wins++;
                const mult = payload.bet > 0 ? payload.win / payload.bet : 0;
                if (mult > s.maxWinMult) s.maxWinMult = mult;
                if (payload.gameId && !s.games.includes(payload.gameId)) s.games.push(payload.gameId);
                s.totalWagered = (s.totalWagered || 0) + (payload.bet || 0);
                const streak = payload.streak || 0;
                if (streak > (s.maxStreak || 0)) s.maxStreak = streak;
                changed = true;
            }
            if (eventType === 'bonus') {
                s.bonusesTriggered = (s.bonusesTriggered || 0) + 1;
                changed = true;
            }
            // Update max balance on any event
            try {
                if (typeof balance !== 'undefined' && balance > s.maxBalance) {
                    s.maxBalance = balance; changed = true;
                }
            } catch(e) {}

            const newUnlocks = [];
            for (const ach of ACH_DEFS) {
                if (s.unlocked.includes(ach.id)) continue;
                const r = ach.req;
                const unlocked =
                    (r.type === 'spins'   && s.spins >= r.target)                 ||
                    (r.type === 'wins'    && s.wins  >= r.target)                 ||
                    (r.type === 'bigWin'  && s.maxWinMult >= r.target)            ||
                    (r.type === 'games'   && s.games.length >= r.target)          ||
                    (r.type === 'balance' && s.maxBalance >= r.target)            ||
                    (r.type === 'wager'   && (s.totalWagered||0) >= r.target)     ||
                    (r.type === 'bonuses' && (s.bonusesTriggered||0) >= r.target) ||
                    (r.type === 'streak'  && (s.maxStreak||0) >= r.target);
                if (unlocked) { s.unlocked.push(ach.id); newUnlocks.push(ach); changed = true; }
            }
            if (changed) _saveAchState(s);
            newUnlocks.forEach(_showAchUnlockToast);
        }


        function _showAchUnlockToast(ach) {
            const prev = document.getElementById('achUnlockToast');
            if (prev) prev.remove();
            const t = document.createElement('div');
            t.id = 'achUnlockToast';
            t.style.cssText = 'position:fixed;bottom:24px;left:50%;transform:translateX(-50%) translateY(20px);opacity:0;'
                + 'background:linear-gradient(135deg,#1a1a2e,#16213e);border:1px solid #7b61ff;color:#fff;'
                + 'border-radius:12px;padding:12px 20px;display:flex;align-items:center;gap:12px;font-size:14px;'
                + 'z-index:10400;box-shadow:0 4px 24px rgba(123,97,255,0.4);transition:all 0.4s ease;'
                + 'pointer-events:none;max-width:320px;';
            t.innerHTML = `<span style="font-size:28px">${ach.icon}</span><div>`
                + `<div style="font-size:10px;color:#7b61ff;font-weight:700;letter-spacing:1px;text-transform:uppercase">Achievement Unlocked!</div>`
                + `<div style="font-weight:700;margin:2px 0">${escapeHtml(ach.name)}</div>`
                + `<div style="font-size:11px;color:rgba(255,255,255,0.6)">${escapeHtml(ach.desc)}</div></div>`;
            document.body.appendChild(t);
            requestAnimationFrame(() => requestAnimationFrame(() => {
                t.style.transform = 'translateX(-50%) translateY(0)';
                t.style.opacity = '1';
            }));
            setTimeout(() => {
                t.style.transform = 'translateX(-50%) translateY(20px)';
                t.style.opacity = '0';
                setTimeout(() => t.remove(), 450);
            }, 4000);
        }

        // ── Hall of Fame — cross-session best wins ────────────────
        const HOF_KEY = typeof STORAGE_KEY_HALL_OF_FAME !== 'undefined' ? STORAGE_KEY_HALL_OF_FAME : 'matrixHallOfFame';
        const HOF_MAX = 10;

        function _loadHoF() {
            try { return JSON.parse(localStorage.getItem(HOF_KEY) || '[]'); } catch(e) { return []; }
        }
        function _saveHoF(list) {
            try { localStorage.setItem(HOF_KEY, JSON.stringify(list)); } catch(e) {}
        }

        window.recordHallOfFameWin = function(winAmount, bet, gameName, gameId, bonusType) {
            if (!winAmount || winAmount <= 0) return;
            const mult = bet > 0 ? winAmount / bet : 0;
            if (mult < 5) return;
            const list = _loadHoF();
            list.push({
                amount: winAmount,
                mult: parseFloat(mult.toFixed(1)),
                game: gameName || 'Unknown',
                gameId: gameId || '',
                bonusType: bonusType || '',
                date: new Date().toLocaleDateString('en-AU', { day:'numeric', month:'short', year:'2-digit' })
            });
            list.sort((a, b) => b.mult - a.mult);
            if (list.length > HOF_MAX) list.length = HOF_MAX;
            _saveHoF(list);
        };

        function _renderHoFPanel(container) {
            const list = _loadHoF();
            if (list.length === 0) {
                container.innerHTML = '<div style="color:rgba(255,255,255,0.4);font-size:12px;text-align:center;padding:12px 0">No big wins yet \u2014 spin to make history!</div>';
                return;
            }
            const medals = ['\uD83E\uDD47','\uD83E\uDD48','\uD83E\uDD49'];
            container.innerHTML = list.map((e, i) => `
                <div class="hof-row">
                    <span class="hof-rank">${medals[i] || (i+1)}</span>
                    <span class="hof-game">${escapeHtml(e.game)}</span>
                    <span class="hof-mult">${escapeHtml(String(e.mult))}\xD7</span>
                    <span class="hof-amount">$${Number(e.amount).toLocaleString('en-AU',{minimumFractionDigits:2,maximumFractionDigits:2})}</span>
                    <span class="hof-date">${e.date}</span>
                </div>`).join('');
        }

        function _ensureHoFPanel() {
            if (document.getElementById('hofPanel')) return;
            // Append after the achievements panel, or after dailyChallengesPanel, or after achievementsList
            const parent = (document.getElementById('achPanelContainer') || document.getElementById('dailyChallengesPanel') || document.getElementById('achievementsList') || {}).parentNode;
            if (!parent) return;
            const wrap = document.createElement('div');
            wrap.id = 'hofPanel';
            wrap.style.cssText = 'margin-top:16px';
            wrap.innerHTML = `
                <div class="hof-header" id="hofToggle" role="button" tabindex="0" style="cursor:pointer;display:flex;align-items:center;justify-content:space-between;padding:8px 12px;background:rgba(255,215,0,0.08);border:1px solid rgba(255,215,0,0.25);border-radius:8px;margin-bottom:0">
                    <span style="font-size:13px;font-weight:700;color:#ffd700">\uD83C\uDFC6 Hall of Fame</span>
                    <span id="hofChevron" style="color:rgba(255,255,255,0.4);font-size:12px">\u25BC</span>
                </div>
                <div id="hofBody" style="border:1px solid rgba(255,215,0,0.15);border-top:none;border-radius:0 0 8px 8px;padding:8px 12px;background:rgba(0,0,0,0.3)">
                    <div id="hofList"></div>
                </div>`;
            parent.appendChild(wrap);
            _renderHoFPanel(document.getElementById('hofList'));

            let collapsed = false;
            const body = document.getElementById('hofBody');
            const chev = document.getElementById('hofChevron');
            document.getElementById('hofToggle').addEventListener('click', () => {
                collapsed = !collapsed;
                body.style.display = collapsed ? 'none' : '';
                chev.textContent = collapsed ? '\u25B6' : '\u25BC';
            });
        }


        function _renderAchievementsPanel() {
            const container = document.getElementById('achPanelContainer');
            if (!container) return;
            const s = _loadAchState();
            container.innerHTML = `
                <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;">
                  <span style="font-weight:700;font-size:13px">🏅 Achievements</span>
                  <span class="ach-count-badge">${s.unlocked.length} / ${ACH_DEFS.length}</span>
                </div>
                <div class="ach-grid">
                  ${ACH_DEFS.map(a => `<div class="ach-card ${s.unlocked.includes(a.id)?'ach-unlocked':'ach-locked'}">
                    <div class="ach-icon">${a.icon}</div>
                    <div class="ach-name">${escapeHtml(a.name)}</div>
                    <div class="ach-desc">${escapeHtml(a.desc)}</div>
                  </div>`).join('')}
                </div>`;
        }


        function _ensureAchievementsPanel() {
            if (document.getElementById('achPanelContainer')) return;
            const wrap = document.createElement('div');
            wrap.id = 'achPanelContainer';
            wrap.style.cssText = 'margin-top:14px;padding:12px;background:rgba(255,255,255,0.02);border-radius:10px;border:1px solid rgba(255,255,255,0.06);';
            // Insert after challengesPanelContainer if it exists, else append to statsContent
            const chal = document.getElementById('challengesPanelContainer') || document.getElementById('dailyChallengesPanel');
            if (chal && chal.parentNode) {
                chal.parentNode.insertBefore(wrap, chal.nextSibling);
            } else {
                const sc = document.getElementById('statsContent') || document.querySelector('[id*="stats"]');
                if (sc) sc.appendChild(wrap);
            }
        }


        function openStatsModal() {
            updateStatsModal();
            refreshQaStateDisplay();
            document.getElementById('statsModal').classList.add('active');
        }


        function closeStatsModal() {
            document.getElementById('statsModal').classList.remove('active');
        }


        function loadSettings() {
            const saved = localStorage.getItem(STORAGE_KEY_SETTINGS);
            if (saved) {
                try { return Object.assign({}, settingsDefaults, JSON.parse(saved)); }
                catch (e) { return { ...settingsDefaults }; }
            }
            return { ...settingsDefaults };
        }


        function saveSettings() {
            try { localStorage.setItem(STORAGE_KEY_SETTINGS, JSON.stringify(appSettings)); } catch (e) { /* ignore */ }
        }


        function openSettingsModal() {
            // Sync UI with current settings
            const modal = document.getElementById('settingsModal');
            document.getElementById('settingSoundEnabled').checked = typeof SoundManager !== 'undefined' ? SoundManager.soundEnabled : appSettings.soundEnabled;
            document.getElementById('settingVolume').value = typeof SoundManager !== 'undefined' ? Math.round(SoundManager.soundVolume * 100) : appSettings.volume;
            document.getElementById('settingVolumeLabel').textContent = (typeof SoundManager !== 'undefined' ? Math.round(SoundManager.soundVolume * 100) : appSettings.volume) + '%';
            document.getElementById('settingParticles').checked = appSettings.particles;
            document.getElementById('settingAnimations').checked = appSettings.animations;
            document.getElementById('settingConfetti').checked = appSettings.confetti;
            document.getElementById('settingTurbo').checked = appSettings.turboDefault;
            document.getElementById('settingAutoSpeed').value = appSettings.autoSpinSpeed;
            document.getElementById('settingAutoSpeedLabel').textContent = (appSettings.autoSpinSpeed / 1000).toFixed(1) + 's';
            const qualitySelect = document.getElementById('settingAnimationQuality');
            if (qualitySelect) qualitySelect.value = appSettings.animationQuality || 'ultra';
            const ambientCheck = document.getElementById('settingAmbientMusic');
            if (ambientCheck) ambientCheck.checked = appSettings.ambientMusic !== false;
            const winSoundsCheck = document.getElementById('settingWinSounds');
            if (winSoundsCheck) winSoundsCheck.checked = appSettings.winSounds !== false;
            const uiSoundsCheck = document.getElementById('settingUiSounds');
            if (uiSoundsCheck) uiSoundsCheck.checked = appSettings.uiSounds !== false;
            const soundThemeSelect = document.getElementById('settingSoundTheme');
            if (soundThemeSelect) soundThemeSelect.value = appSettings.soundTheme || 'auto';

            // Responsible Gambling — load current session limit and wire timer init
            (function() {
                var token = (function() {
                    try {
                        return localStorage.getItem(
                            typeof STORAGE_KEY_TOKEN !== 'undefined' ? STORAGE_KEY_TOKEN : 'casinoToken'
                        );
                    } catch (e) { return null; }
                })();
                var limitSel = document.getElementById('settingSessionLimit');
                var statusEl = document.getElementById('settingSessionStatus');
                if (limitSel && token && typeof isServerAuthToken === 'function' && isServerAuthToken()) {
                    fetch('/api/session/limits', {
                        headers: { 'Authorization': 'Bearer ' + token }
                    })
                    .then(function(r) { return r.ok ? r.json() : null; })
                    .then(function(data) {
                        if (!data) return;
                        var lim = data.session_time_limit;
                        limitSel.value = (lim && lim > 0) ? String(lim) : '0';
                        if (statusEl) {
                            if (lim && lim > 0) {
                                statusEl.textContent = 'Limit active: session ends after ' + lim + ' minutes.';
                            } else {
                                statusEl.textContent = 'No session time limit set.';
                            }
                        }
                    })
                    .catch(function() { /* silent */ });
                } else if (limitSel) {
                    limitSel.value = '0';
                }
            })();

            // Wager Limit — load current wager limit status
            (function() {
                var token = (function() {
                    try {
                        return localStorage.getItem(
                            typeof STORAGE_KEY_TOKEN !== 'undefined' ? STORAGE_KEY_TOKEN : 'casinoToken'
                        );
                    } catch (e) { return null; }
                })();
                var wagerSel = document.getElementById('settingWagerLimit');
                var wagerStatus = document.getElementById('settingWagerStatus');
                if (wagerSel && token && typeof isServerAuthToken === 'function' && isServerAuthToken()) {
                    fetch('/api/session/wager-limit', {
                        headers: { 'Authorization': 'Bearer ' + token }
                    })
                    .then(function(r) { return r.ok ? r.json() : null; })
                    .then(function(data) {
                        if (!data) return;
                        var lim = data.limit;
                        wagerSel.value = (lim && lim > 0) ? String(lim) : '0';
                        if (wagerStatus) {
                            if (lim && lim > 0) {
                                wagerStatus.textContent = 'Limit: $' + lim + '/day — Wagered today: $' + (data.todayWagered || 0).toFixed(2);
                            } else {
                                wagerStatus.textContent = 'No daily wager limit set.';
                            }
                        }
                    })
                    .catch(function() { /* silent */ });
                } else if (wagerSel) {
                    wagerSel.value = '0';
                }
            })();

            // Wire session timer on first settings open (deferred init)
            if (!window._sessionTimerInit) {
                window._sessionTimerInit = true;
                if (typeof initSessionTimer === 'function') {
                    initSessionTimer();
                }
            }

            modal.classList.add('active');
            playSound('click');
        }


        function closeSettingsModal() {
            document.getElementById('settingsModal').classList.remove('active');
        }


        function settingsToggleSound(enabled) {
            appSettings.soundEnabled = enabled;
            if (typeof SoundManager !== 'undefined') {
                SoundManager.setSoundEnabled(enabled);
            }
            saveSettings();
        }


        function settingsSetVolume(val) {
            const v = parseInt(val, 10);
            appSettings.volume = v;
            document.getElementById('settingVolumeLabel').textContent = v + '%';
            if (typeof setSoundVolume === 'function') {
                setSoundVolume(v / 100);
            }
            saveSettings();
        }


        function settingsToggleParticles(enabled) {
            appSettings.particles = enabled;
            saveSettings();
        }


        function settingsToggleAnimations(enabled) {
            appSettings.animations = enabled;
            saveSettings();
        }


        function settingsToggleConfetti(enabled) {
            appSettings.confetti = enabled;
            saveSettings();
        }


        function settingsToggleTurbo(enabled) {
            appSettings.turboDefault = enabled;
            saveSettings();
        }


        function settingsSetAutoSpeed(val) {
            const v = parseInt(val, 10);
            appSettings.autoSpinSpeed = v;
            document.getElementById('settingAutoSpeedLabel').textContent = (v / 1000).toFixed(1) + 's';
            saveSettings();
        }


        function settingsResetAll() {
            appSettings = { ...settingsDefaults };
            window.appSettings = appSettings;
            saveSettings();
            if (typeof SoundManager !== 'undefined') {
                SoundManager.setSoundEnabled(true);
                setSoundVolume(0.5);
            }
            // Refresh the panel UI
            openSettingsModal();
            if (typeof showToast === 'function') showToast('Settings reset to defaults', 'info');
        }


        function settingsSetAnimationQuality(val) {
            appSettings.animationQuality = val;
            saveSettings();
        }
        function settingsToggleAmbientMusic(enabled) {
            appSettings.ambientMusic = enabled;
            saveSettings();
        }
        function settingsToggleWinSounds(enabled) {
            appSettings.winSounds = enabled;
            saveSettings();
        }
        function settingsToggleUiSounds(enabled) {
            appSettings.uiSounds = enabled;
            saveSettings();
        }

        // Sprint 35 — Sound Theme
        function settingsSetSoundTheme(theme) {
            appSettings.soundTheme = theme;
            saveSettings();
        }

        function addFunds() {
            if (typeof showWalletModal === 'function' && currentUser) {
                showWalletModal();
            } else {
                // Fallback to old deposit modal if wallet not loaded or not logged in
                const dm = document.getElementById('depositModal');
                if (dm) dm.classList.add('active');
            }
        }


        async function confirmDeposit(amount) {
            // Production: All deposits must go through the server payment system.
            // No client-side balance manipulation allowed.
            var _depToken = typeof localStorage !== 'undefined' ? localStorage.getItem('casinoAuthToken') : null;
            if (_depToken && !_depToken.startsWith('local_')) {
                closeDepositModal();
                showToast('Please use the payment system to deposit.', 'error');
            } else {
                closeDepositModal();
                showToast('Please register or log in to make a deposit.', 'error');
            }
        }


        function closeDepositModal() {
            document.getElementById('depositModal').classList.remove('active');
        }


        function getXPForLevel(level) {
            return Math.floor(BASE_XP_PER_LEVEL * Math.pow(XP_LEVEL_GROWTH_RATE, level - 1));
        }


        function getTier(level) {
            let tier = XP_TIERS[0];
            for (const t of XP_TIERS) {
                if (level >= t.minLevel) tier = t;
            }
            return tier;
        }


        function loadXP() {
            const saved = localStorage.getItem(XP_STORAGE_KEY);
            if (saved) {
                try {
                    const data = JSON.parse(saved);
                    playerXP = parseStoredNumber(data.xp, 0);
                    playerLevel = parseStoredNumber(data.level, 1);
                    if (playerLevel < 1) playerLevel = 1;
                } catch { playerXP = 0; playerLevel = 1; }
            }
        }


        function saveXP() {
            try { localStorage.setItem(XP_STORAGE_KEY, JSON.stringify({ xp: playerXP, level: playerLevel })); } catch (e) { /* ignore */ }
        }


        function awardXP(amount) {
            // 2× XP Boost check (Sprint 27)
            try {
                var _boost = JSON.parse(localStorage.getItem('matrixXpBoost') || 'null');
                if (_boost && _boost.remaining > 0) {
                    amount *= 2;
                    _boost.remaining -= 1;
                    localStorage.setItem('matrixXpBoost', JSON.stringify(_boost));
                }
            } catch(e) {}
            // Session streak XP multiplier: 2x after 30 spins, 3x after 60
            if (typeof _sessionSpinCount !== 'undefined') {
                if (_sessionSpinCount >= 60) {
                    amount = Math.round(amount * 3);
                    if (_sessionSpinCount === 60) showToast('3x XP STREAK! Keep the momentum going!', 'success', 4000);
                } else if (_sessionSpinCount >= 30) {
                    amount = Math.round(amount * 2);
                    if (_sessionSpinCount === 30) showToast('2x XP STREAK! 30 spins in a row!', 'success', 4000);
                }
            }
            playerXP += amount;
            let levelledUp = false;
            let needed = getXPForLevel(playerLevel);
            while (playerXP >= needed) {
                playerXP -= needed;
                playerLevel++;
                levelledUp = true;
                needed = getXPForLevel(playerLevel);
            }
            saveXP();
            updateXPDisplay();
            // Check milestone BEFORE generic levelledUp toast
            const _MILESTONE_LEVELS = [5, 10, 15, 20, 25, 30, 40, 50, 75, 100];
            const _MILESTONE_PERKS = {
                5: 'Lucky Charm Unlocked', 10: 'High Roller Status',
                15: 'Fortune Seeker', 20: 'Gold Member',
                25: 'Platinum Insider', 30: 'Diamond Hand',
                40: 'Elite Spinner', 50: 'Casino Legend',
                75: 'Master of the Reels', 100: 'Hall of Fame'
            };
            if (levelledUp && _MILESTONE_LEVELS.includes(playerLevel)) {
                try {
                    const _claimed = JSON.parse(localStorage.getItem('matrixLevelMilestones') || '[]');
                    if (!_claimed.includes(playerLevel)) {
                        _claimed.push(playerLevel);
                        localStorage.setItem('matrixLevelMilestones', JSON.stringify(_claimed));
                        const _bonus = playerLevel * 20;
                        // Milestone bonus — display only; actual credit is server-side
                        _openLevelMilestoneModal(playerLevel, _bonus, _MILESTONE_PERKS[playerLevel] || 'New Milestone');
                        levelledUp = false; // suppress generic toast when modal is shown
                    }
                } catch(e) {}
            }
            if (levelledUp) {
                // Award free spins on level up — scales slightly with level
                const freeSpinsCount = 5 + Math.floor((playerLevel - 1) / 5); // 5 base, +1 every 5 levels
                if (currentGame && !freeSpinsActive) {
                    // Slot is open and idle — start free spins immediately
                    triggerFreeSpins(currentGame, freeSpinsCount);
                    showToast(`🎉 Level Up! Level ${playerLevel}! ${freeSpinsCount} FREE SPINS!`, 'levelup');
                } else if (currentGame && freeSpinsActive) {
                    // Already in free spins — top them up
                    freeSpinsRemaining += freeSpinsCount;
                    updateFreeSpinsDisplay();
                    showToast(`🎉 Level Up! Level ${playerLevel}! +${freeSpinsCount} FREE SPINS added!`, 'levelup');
                } else {
                    // Not in a slot — show level-up toast (bonus credited server-side)
                    showToast(`🎉 Level Up! Level ${playerLevel}!`, 'levelup');
                }
            }
        }
        function _openLevelMilestoneModal(level, bonus, perk) {
            const modal = document.getElementById('levelMilestoneModal');
            if (!modal) return;
            const badge = document.getElementById('lmBadge');
            const title = document.getElementById('lmTitle');
            const perkEl = document.getElementById('lmPerk');
            const rewardEl = document.getElementById('lmRewardAmount');
            const btn = document.getElementById('lmClaimBtn');
            if (badge) badge.textContent = level;
            if (title) title.textContent = 'Level ' + level + ' Reached!';
            if (perkEl) perkEl.textContent = perk;
            if (rewardEl) rewardEl.textContent = '$0';
            modal.style.display = 'flex';
            // Animate reward counter
            if (rewardEl) {
                let current = 0;
                const step = Math.ceil(bonus / 40);
                const ticker = setInterval(function() {
                    current = Math.min(current + step, bonus);
                    rewardEl.textContent = '$' + current.toLocaleString();
                    if (current >= bonus) clearInterval(ticker);
                }, 25);
            }
            // Confetti burst
            if (typeof triggerConfetti === 'function') {
                triggerConfetti(80);
            } else if (typeof burstParticles === 'function') {
                burstParticles(80, window.innerWidth / 2, window.innerHeight / 2);
            }
            if (btn) {
                btn.onclick = function() {
                    modal.style.display = 'none';
                    showToast('🏆 Level ' + level + ' Milestone! +$' + bonus.toLocaleString() + ' credited!', 'levelup');
                };
            }
            modal.onclick = function(e) { if (e.target === modal) modal.style.display = 'none'; };
        }


        function updateXPDisplay() {
            const tier = getTier(playerLevel);
            const needed = getXPForLevel(playerLevel);
            const pct = Math.min(100, (playerXP / needed) * 100);

            const badge = document.getElementById('levelBadge');
            const tierLabel = document.getElementById('tierLabel');
            const fill = document.getElementById('xpBarFill');
            const text = document.getElementById('xpBarText');

            if (badge) {
                badge.textContent = playerLevel;
                badge.style.borderColor = tier.color;
            }
            if (tierLabel) {
                tierLabel.textContent = tier.name;
                tierLabel.style.color = tier.color;
            }
            if (fill) fill.style.width = pct + '%';
            if (text) text.textContent = `${playerXP} / ${needed} XP`;

            // Update VIP mini progress bar in header
            if (typeof getVipProgress === 'function' && typeof getVipTier === 'function') {
                const vipFill = document.getElementById('vipMiniFill');
                const vipText = document.getElementById('vipMiniText');
                const vipBar = document.getElementById('vipMiniBar');
                if (vipFill && vipText) {
                    const vipPct = getVipProgress();
                    const vipTier = getVipTier();
                    const nextTier = typeof getNextVipTier === 'function' ? getNextVipTier() : null;
                    vipFill.style.width = vipPct.toFixed(1) + '%';
                    vipFill.style.background = 'linear-gradient(90deg, ' + (vipTier.colorDark || vipTier.color) + ', ' + (nextTier ? nextTier.color : vipTier.color) + ')';
                    vipText.textContent = nextTier ? (vipPct.toFixed(0) + '% to ' + nextTier.name) : ('VIP ' + vipTier.name);
                }
                if (vipBar) {
                    vipBar.onclick = function() { if (typeof openVipModal === 'function') openVipModal(); };
                }
            }
        }


        // ===== Toast System =====
        function showToast(message, type = 'info', duration = 3500) {
            const container = document.getElementById('toastContainer');
            if (!container) return;

            const toast = document.createElement('div');
            toast.className = `toast toast-${type}`;
            toast.textContent = message;
            container.appendChild(toast);

            setTimeout(() => {
                toast.classList.add('toast-exit');
                setTimeout(() => toast.remove(), 400);
            }, duration);
        }


        // ===== Inline FAQ Modal =====
        function showHelpFaqInline() {
            var overlay = document.createElement('div');
            overlay.id = 'faqOverlay';
            overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.75);z-index:100000;display:flex;align-items:center;justify-content:center;';
            var box = document.createElement('div');
            box.style.cssText = 'background:#1a1a2e;border:1px solid #f0a500;border-radius:16px;max-width:560px;width:92%;max-height:80vh;overflow-y:auto;padding:28px 24px;color:#fff;font-size:0.92rem;line-height:1.6;';
            var faqs = [
                ['How do I play slots?', 'Select any game from the lobby, set your bet amount, and tap SPIN. Matching symbols on paylines award payouts based on the paytable.'],
                ['What are gems?', 'Gems are our premium currency. Use them to unlock VIP perks, special slot themes, and exclusive bonuses in the Gem Store.'],
                ['How do I deposit?', 'Tap your balance or visit Wallet from the menu. We support multiple payment methods with instant crediting.'],
                ['What is the daily bonus?', 'Log in each day and claim your daily bonus. Consecutive days build a streak with increasing rewards up to 7x.'],
                ['How do free spins work?', 'Free spins are awarded through bonuses, promotions, and in-game scatter symbols. Winnings from free spins are credited to your balance.'],
                ['Is my account secure?', 'Yes. We use industry-standard encryption, secure JWT authentication, and never store plaintext passwords.'],
                ['How do I set deposit limits?', 'Go to My Account > Responsible Gambling to set daily, weekly, or monthly deposit limits and self-exclusion periods.'],
                ['How do I contact support?', 'Email us at support@msaart.online or use the Live Chat feature when logged in.']
            ];
            var html = '<h2 style="margin:0 0 18px;color:#f0a500;font-size:1.3rem;">Frequently Asked Questions</h2>';
            for (var i = 0; i < faqs.length; i++) {
                html += '<div style="margin-bottom:16px;"><strong style="color:#f0a500;">' + faqs[i][0] + '</strong><p style="margin:4px 0 0;color:#ccc;">' + faqs[i][1] + '</p></div>';
            }
            html += '<button id="faqCloseBtn" style="margin-top:12px;background:#f0a500;color:#1a1a2e;border:none;padding:10px 28px;border-radius:8px;font-weight:700;cursor:pointer;font-size:0.95rem;">Close</button>';
            box.innerHTML = html;
            overlay.appendChild(box);
            document.body.appendChild(overlay);
            overlay.addEventListener('click', function(e) { if (e.target === overlay || e.target.id === 'faqCloseBtn') overlay.remove(); });
        }
        window.showHelpFaqInline = showHelpFaqInline;


        function loadDailyBonus() {
            const saved = localStorage.getItem(DAILY_BONUS_KEY);
            if (saved) {
                try {
                    dailyBonusState = JSON.parse(saved);
                } catch { dailyBonusState = { streak: 0, lastClaim: null, claimedToday: false }; }
            }
            checkDailyBonusReset();
        }


        function saveDailyBonus() {
            try { localStorage.setItem(DAILY_BONUS_KEY, JSON.stringify(dailyBonusState)); } catch (e) { /* ignore */ }
        }


        function getTodayStr() {
            return new Date().toISOString().slice(0, 10);
        }


        function checkDailyBonusReset() {
            const today = getTodayStr();
            if (dailyBonusState.lastClaim === today) {
                dailyBonusState.claimedToday = true;
                return;
            }

            dailyBonusState.claimedToday = false;

            if (dailyBonusState.lastClaim) {
                const last = new Date(dailyBonusState.lastClaim);
                const now = new Date(today);
                const diffDays = Math.floor((now - last) / (1000 * 60 * 60 * 24));
                if (diffDays > 1) {
                    dailyBonusState.streak = 0;
                }
            }
        }


        function showDailyBonusModal() {
            checkDailyBonusReset();
            renderDailyCalendar();
            var modal = document.getElementById('dailyBonusModal');
            modal.classList.add('active');
            // Attach programmatic close handlers (backup for inline onclick)
            _attachDailyBonusCloseHandlers(modal);
        }


        function closeDailyBonusModal() {
            var modal = document.getElementById('dailyBonusModal');
            if (modal) modal.classList.remove('active');
        }

        function _attachDailyBonusCloseHandlers(modal) {
            if (!modal || modal._closeHandlersAttached) return;
            modal._closeHandlersAttached = true;
            // Backdrop click
            modal.addEventListener('click', function(e) {
                if (e.target === modal) closeDailyBonusModal();
            });
            // SKIP button (programmatic, doesn't rely on inline onclick)
            var skipBtns = modal.querySelectorAll('.daily-skip-btn');
            for (var i = 0; i < skipBtns.length; i++) {
                skipBtns[i].addEventListener('click', function(e) {
                    e.stopPropagation();
                    closeDailyBonusModal();
                });
            }
            // X close button
            var closeBtns = modal.querySelectorAll('[aria-label="Close"]');
            for (var j = 0; j < closeBtns.length; j++) {
                closeBtns[j].addEventListener('click', function(e) {
                    e.stopPropagation();
                    closeDailyBonusModal();
                });
            }
        }


        function renderDailyCalendar() {
            const cal = document.getElementById('dailyCalendar');
            const streakEl = document.getElementById('streakCount');
            const claimBtn = document.getElementById('dailyClaimBtn');
            if (!cal) return;

            streakEl.textContent = dailyBonusState.streak;
            claimBtn.disabled = dailyBonusState.claimedToday;
            claimBtn.textContent = dailyBonusState.claimedToday ? 'CLAIMED TODAY' : 'CLAIM BONUS';

            let html = '';
            for (let i = 0; i < 7; i++) {
                const reward = DAILY_REWARDS[i];
                const isClaimed = i < dailyBonusState.streak;
                const isToday = i === dailyBonusState.streak && !dailyBonusState.claimedToday;
                const isLocked = i > dailyBonusState.streak;
                const isTodayClaimed = i === dailyBonusState.streak - 1 && dailyBonusState.claimedToday;

                let cls = 'daily-day';
                if (isClaimed || isTodayClaimed) cls += ' day-claimed';
                else if (isToday) cls += ' day-today';
                else if (isLocked) cls += ' day-locked';

                html += `
                    <div class="${cls}">
                        <div class="day-number">DAY ${i + 1}</div>
                        <div class="day-reward">$${reward.amount.toLocaleString()}</div>
                        <div class="day-xp">+${reward.xp} XP</div>
                    </div>
                `;
            }
            cal.innerHTML = html;
        }


        async function claimDailyBonus() {
            if (dailyBonusState.claimedToday) return;

            // Server-validated claim for authenticated users
            if (typeof isServerAuthToken === 'function' && isServerAuthToken()) {
                try {
                    const res = await apiRequest('/api/user/claim-daily-bonus', {
                        method: 'POST',
                        requireAuth: true
                    });
                    if (!res.awarded) return;
                    balance = res.newBalance;
                    updateBalance();
                    saveBalance();
                    awardXP(res.xp);
                    dailyBonusState.streak = res.streak;
                    dailyBonusState.lastClaim = getTodayStr();
                    dailyBonusState.claimedToday = true;
                    saveDailyBonus();
                } catch (err) {
                    if (err.status === 400) {
                        dailyBonusState.claimedToday = true;
                        saveDailyBonus();
                        renderDailyCalendar();
                    }
                    return;
                }
            } else {
                // Guest/offline — no free credits, prompt registration
                if (typeof showToast === 'function') showToast('Please log in to claim daily rewards!', 'info');
                return;
            }

            playSound('bigwin');
            const dayIndex = Math.min(Math.max(dailyBonusState.streak - 1, 0), DAILY_REWARDS.length - 1);
            const reward = DAILY_REWARDS[dayIndex];
            showToast(`Daily Bonus: +$${reward.amount.toLocaleString()} and +${reward.xp} XP!`, 'win');
            createConfetti();

            renderDailyCalendar();

            setTimeout(() => closeDailyBonusModal(), 2000);
        }


        function loadWheelState() {
            const saved = localStorage.getItem(WHEEL_STORAGE_KEY);
            if (saved) {
                try { wheelState = JSON.parse(saved); } catch { wheelState = { lastSpin: null }; }
            }
        }


        function saveWheelState() {
            try { localStorage.setItem(WHEEL_STORAGE_KEY, JSON.stringify(wheelState)); } catch (e) { /* ignore */ }
        }


        function canSpinWheel() {
            if (!wheelState.lastSpin) return true;
            const last = new Date(wheelState.lastSpin);
            const now = new Date();
            const diffHours = (now - last) / (1000 * 60 * 60);
            return diffHours >= BONUS_WHEEL_COOLDOWN_HOURS;
        }


        function drawWheel(highlightIndex = -1) {
            const canvas = document.getElementById('wheelCanvas');
            if (!canvas) return;
            const ctx = canvas.getContext('2d');
            const cx = canvas.width / 2;
            const cy = canvas.height / 2;
            const r = cx - 4;
            const segAngle = (2 * Math.PI) / WHEEL_SEGMENTS.length;

            ctx.clearRect(0, 0, canvas.width, canvas.height);

            WHEEL_SEGMENTS.forEach((seg, i) => {
                const startAngle = wheelAngle + i * segAngle;
                const endAngle = startAngle + segAngle;

                ctx.beginPath();
                ctx.moveTo(cx, cy);
                ctx.arc(cx, cy, r, startAngle, endAngle);
                ctx.closePath();
                ctx.fillStyle = i === highlightIndex ? '#fff' : seg.color;
                ctx.fill();
                ctx.strokeStyle = 'rgba(255,255,255,0.3)';
                ctx.lineWidth = 2;
                ctx.stroke();

                // Label
                ctx.save();
                ctx.translate(cx, cy);
                ctx.rotate(startAngle + segAngle / 2);
                ctx.textAlign = 'right';
                ctx.fillStyle = i === highlightIndex ? '#000' : '#fff';
                ctx.font = 'bold 14px sans-serif';
                ctx.fillText(seg.label, r - 12, 5);
                ctx.restore();
            });

            // Center circle
            ctx.beginPath();
            ctx.arc(cx, cy, 18, 0, 2 * Math.PI);
            ctx.fillStyle = '#1e293b';
            ctx.fill();
            ctx.strokeStyle = '#ffd700';
            ctx.lineWidth = 3;
            ctx.stroke();
        }


        function _wheelCooldownLabel() {
            if (!wheelState.lastSpin) return null;
            const msLeft = (new Date(wheelState.lastSpin).getTime() + BONUS_WHEEL_COOLDOWN_HOURS * 3600000) - Date.now();
            if (msLeft <= 0) return null;
            const h = Math.floor(msLeft / 3600000);
            const m = Math.floor((msLeft % 3600000) / 60000);
            return h > 0 ? `NEXT SPIN IN ${h}h ${m}m` : `NEXT SPIN IN ${m}m`;
        }

        function showBonusWheelModal() {
            loadWheelState();
            const spinBtn = document.getElementById('wheelSpinBtn');
            const label = _wheelCooldownLabel();
            if (label) {
                spinBtn.disabled = true;
                spinBtn.textContent = label;
            } else {
                spinBtn.disabled = false;
                spinBtn.textContent = 'SPIN THE WHEEL';
            }
            drawWheel();
            document.getElementById('bonusWheelModal').classList.add('active');
        }


        function closeBonusWheelModal() {
            document.getElementById('bonusWheelModal').classList.remove('active');
        }


        async function spinBonusWheel() {
            if (wheelSpinning || !canSpinWheel()) return;
            wheelSpinning = true;

            const spinBtn = document.getElementById('wheelSpinBtn');
            spinBtn.disabled = true;
            spinBtn.textContent = 'SPINNING...';

            playSound('spin');

            let winIndex;
            let serverBalance = null;
            let serverXP = null;

            // Server-validated spin for authenticated users
            if (typeof isServerAuthToken === 'function' && isServerAuthToken()) {
                try {
                    const res = await apiRequest('/api/user/spin-wheel', {
                        method: 'POST',
                        requireAuth: true,
                    });
                    winIndex = res.winIndex;
                    serverBalance = res.newBalance;
                    serverXP = res.xp;
                } catch (err) {
                    wheelSpinning = false;
                    if (err.status === 400) {
                        // Cooldown enforced server-side — sync local state
                        wheelState.lastSpin = new Date().toISOString();
                        saveWheelState();
                        spinBtn.textContent = _wheelCooldownLabel() || 'NEXT SPIN IN A FEW HOURS';
                        showToast('Wheel cooldown still active!', 'info');
                    } else {
                        spinBtn.disabled = false;
                        spinBtn.textContent = 'SPIN THE WHEEL';
                        showToast('Wheel spin failed — try again.', 'info');
                    }
                    return;
                }
            } else {
                // Guest / offline — client-side RNG
                winIndex = Math.floor(Math.random() * WHEEL_SEGMENTS.length);
            }

            const segAngle = (2 * Math.PI) / WHEEL_SEGMENTS.length;
            // We want the winning segment at the top (270deg / -PI/2)
            // The pointer is at top, reading from angle -PI/2
            const targetAngle = -(winIndex * segAngle + segAngle / 2) - Math.PI / 2;
            // Normalize to [0, 2π) so the final wheelAngle is exact.
            // Extra rotations MUST be whole integers — a fractional multiplier causes
            // totalRotation % 2π to land off-target, awarding the wrong segment.
            const targetNorm = ((targetAngle % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
            const extraRotations = 5 + Math.floor(Math.random() * 4); // 5–8 whole rotations
            const totalRotation = targetNorm + Math.PI * 2 * extraRotations;

            const startAngle = wheelAngle;
            const duration = 4000;
            const startTime = performance.now();

            // --- Enhancement 1: canvas glow on spin start ---
            const _wCanvas = document.getElementById('wheelCanvas');
            if (_wCanvas) {
                _wCanvas.style.filter = 'drop-shadow(0 0 20px #ffd700) drop-shadow(0 0 40px rgba(255,215,0,0.4))';
            }

            // --- Enhancement 5: pointer shimmer CSS (injected once) ---
            if (!document.getElementById('_bonusPointerGlowStyle')) {
                const _pStyle = document.createElement('style');
                _pStyle.id = '_bonusPointerGlowStyle';
                _pStyle.textContent = '@keyframes bonusPointerGlow { 0%,100% { filter: drop-shadow(0 0 6px #ffd700); } 50% { filter: drop-shadow(0 0 20px #ffd700) drop-shadow(0 0 40px #ffb300); } }';
                document.head.appendChild(_pStyle);
            }
            const _wPointer = document.querySelector('#bonusWheelModal .wheel-pointer');
            if (_wPointer) {
                _wPointer.style.animation = 'bonusPointerGlow 0.8s ease-in-out infinite';
            }

            function animateWheel(now) {
                const elapsed = now - startTime;
                const t = Math.min(elapsed / duration, 1);
                // Ease out cubic
                const ease = 1 - Math.pow(1 - t, 3);
                wheelAngle = startAngle + (totalRotation - startAngle) * ease;

                // --- Enhancement 2: highlight winning segment during deceleration (last 15% of animation) ---
                const highlightDuring = t >= 0.85 ? winIndex : -1;
                drawWheel(highlightDuring);

                if (t < 1) {
                    requestAnimationFrame(animateWheel);
                } else {
                    // Landed — use targetNorm directly to avoid float drift from modulo
                    wheelAngle = targetNorm;
                    const seg = WHEEL_SEGMENTS[winIndex];

                    // --- Enhancement 1: remove canvas glow on spin end ---
                    if (_wCanvas) {
                        _wCanvas.style.filter = '';
                    }
                    // --- Enhancement 5: remove pointer shimmer ---
                    if (_wPointer) {
                        _wPointer.style.animation = '';
                    }

                    if (seg.type === 'freespins') {
                        // Award free spins
                        const fsCount = seg.value;
                        if (currentGame && !freeSpinsActive) {
                            triggerFreeSpins(currentGame, fsCount);
                        } else if (currentGame && freeSpinsActive) {
                            freeSpinsRemaining += fsCount;
                            if (typeof updateFreeSpinsDisplay === 'function') updateFreeSpinsDisplay();
                        } else {
                            freeSpinsActive = true;
                            freeSpinsRemaining = fsCount;
                            freeSpinsTotalWin = 0;
                            freeSpinsMultiplier = 1;
                        }
                        awardXP(serverXP != null ? serverXP : seg.xp);
                        const gameLabel = (currentGame && currentGame.name) ? currentGame.name : 'your next slot';
                        showToast(`\uD83C\uDFB0 ${fsCount} Free Spins awarded on ${gameLabel}!`, 'win');
                    } else {
                        // Cash prize — use server balance if available
                        if (serverBalance != null) {
                            balance = serverBalance;
                        } else {
                            balance += seg.value;
                        }
                        updateBalance();
                        awardXP(serverXP != null ? serverXP : seg.xp);
                        showToast(`\uD83C\uDF89 Bonus Wheel: +$${seg.value.toLocaleString()} and +${(serverXP != null ? serverXP : seg.xp)} XP!`, 'win');
                    }

                    wheelState.lastSpin = new Date().toISOString();
                    saveWheelState();

                    playSound('bigwin');
                    createConfetti();

                    drawWheel(winIndex);

                    // --- Enhancement 3: particle burst at canvas center on result reveal ---
                    if (typeof burstParticles === 'function' && _wCanvas) {
                        const _rect = _wCanvas.getBoundingClientRect();
                        const _cx = _rect.left + _rect.width / 2;
                        const _cy = _rect.top + _rect.height / 2;
                        burstParticles(_cx, _cy, 50, ['#ffd700', '#ffb300', '#ff8c00', '#fffacd', '#ffa500']);
                    }

                    // --- Enhancement 4: heavy confetti for prizes >= $1000 ---
                    if (seg.type !== 'freespins' && seg.value >= 1000 && typeof triggerWinParticles === 'function') {
                        triggerWinParticles(seg.value);
                    }

                    wheelSpinning = false;
                    spinBtn.textContent = _wheelCooldownLabel() || 'NEXT SPIN IN A FEW HOURS';

                    setTimeout(() => closeBonusWheelModal(), 3000);
                }
            }

            requestAnimationFrame(animateWheel);
        }


        // ══════════════════════════════════════════════════════════
        // NOTIFICATION CENTER
        // ══════════════════════════════════════════════════════════

        const _NOTIF_KEY = typeof STORAGE_KEY_NOTIFICATIONS !== 'undefined'
            ? STORAGE_KEY_NOTIFICATIONS : 'matrixNotifications';
        const _NOTIF_MAX = 30;
        const _NOTIF_EXPIRE_MS = 7 * 24 * 3600 * 1000;

        function _loadNotifications() {
            try {
                const raw = localStorage.getItem(_NOTIF_KEY);
                if (!raw) return [];
                const all = JSON.parse(raw);
                const cutoff = Date.now() - _NOTIF_EXPIRE_MS;
                return all.filter(n => new Date(n.ts).getTime() > cutoff);
            } catch (e) { return []; }
        }

        function _saveNotifications(list) {
            try { localStorage.setItem(_NOTIF_KEY, JSON.stringify(list.slice(0, _NOTIF_MAX))); } catch (e) {}
        }

        function _updateNotifBadge() {
            const badge = document.getElementById('notifBadge');
            if (!badge) return;
            const unread = _loadNotifications().filter(n => !n.read).length;
            badge.textContent = unread;
            badge.style.display = unread > 0 ? '' : 'none';
        }

        window.addNotification = function(type, title, body) {
            const icons = { achievement: '🏆', tournament: '⚡', weekly: '📋', daily: '🎯', daily_bonus: '🎁', system: '📣' };
            const list = _loadNotifications();
            list.unshift({
                id:    Date.now() + Math.random(),
                type:  type,
                icon:  icons[type] || '📣',
                title: title,
                body:  body || '',
                ts:    new Date().toISOString(),
                read:  false,
            });
            _saveNotifications(list);
            _updateNotifBadge();
        };

        window.openNotificationPanel = function() {
            let panel = document.getElementById('notifPanel');
            if (!panel) {
                panel = document.createElement('div');
                panel.id = 'notifPanel';
                panel.className = 'notif-panel';
                panel.innerHTML = '<div class="notif-panel-header">'
                    + '<span class="notif-panel-title">Notifications</span>'
                    + '<button class="notif-mark-read" onclick="markAllNotificationsRead()">Mark all read</button>'
                    + '<button class="notif-panel-close" onclick="closeNotificationPanel()">✕</button>'
                    + '</div>'
                    + '<div class="notif-panel-list" id="notifPanelList"></div>';
                document.body.appendChild(panel);
            }
            _renderNotifPanel();
            panel.classList.add('active');
            // backdrop
            let bd = document.getElementById('notifBackdrop');
            if (!bd) {
                bd = document.createElement('div');
                bd.id = 'notifBackdrop';
                bd.className = 'notif-backdrop';
                bd.onclick = closeNotificationPanel;
                document.body.appendChild(bd);
            }
            bd.classList.add('active');
        };

        window.closeNotificationPanel = function() {
            const panel = document.getElementById('notifPanel');
            const bd    = document.getElementById('notifBackdrop');
            if (panel) panel.classList.remove('active');
            if (bd)    bd.classList.remove('active');
        };

        window.markAllNotificationsRead = function() {
            const list = _loadNotifications().map(n => ({ ...n, read: true }));
            _saveNotifications(list);
            _updateNotifBadge();
            _renderNotifPanel();
        };

        function _timeAgo(isoStr) {
            const diff = Date.now() - new Date(isoStr).getTime();
            const m = Math.floor(diff / 60000);
            if (m < 1)  return 'just now';
            if (m < 60) return m + 'm ago';
            const h = Math.floor(m / 60);
            if (h < 24) return h + 'h ago';
            return Math.floor(h / 24) + 'd ago';
        }

        function _renderNotifPanel() {
            const list = document.getElementById('notifPanelList');
            if (!list) return;
            const notifs = _loadNotifications();
            if (notifs.length === 0) {
                list.innerHTML = '<div class="notif-empty">No notifications yet</div>';
                return;
            }
            list.innerHTML = notifs.map(n =>
                '<div class="notif-item' + (n.read ? '' : ' notif-unread') + '">' +
                '<div class="notif-item-icon">' + n.icon + '</div>' +
                '<div class="notif-item-body">' +
                '<div class="notif-item-title">' + n.title + '</div>' +
                (n.body ? '<div class="notif-item-text">' + n.body + '</div>' : '') +
                '<div class="notif-item-time">' + _timeAgo(n.ts) + '</div>' +
                '</div>' +
                '</div>'
            ).join('');
        }

        // Patch showAchievementNotification to also persist in notification center
        const _origShowAchNotif = typeof showAchievementNotification === 'function' ? showAchievementNotification : null;
        // Override happens at call site: see below

        // Initialise badge on load
        document.addEventListener('DOMContentLoaded', function() {
            _updateNotifBadge();
        });
        // Also update now in case DOMContentLoaded already fired
        if (document.readyState !== 'loading') {
            setTimeout(_updateNotifBadge, 200);
        }

        // ── Login streak: check once on page load (toast fires even if stats modal is never opened)
        setTimeout(function() { _checkLoginStreak(); }, 800);


        // ═══════════════════════════════════════════════════════════════
        // DAILY SCRATCH CARD
        // ═══════════════════════════════════════════════════════════════

        const SCRATCH_STORAGE_KEY = 'matrix_scratch_card';
        const SCRATCH_COOLDOWN_MS = 24 * 60 * 60 * 1000; // 24 hours
        const SCRATCH_PRIZES = [10, 25, 25, 50, 50, 75, 75, 100, 250];
        const SCRATCH_SYMBOLS = { 10: '🍋', 25: '🍊', 50: '🍇', 75: '💎', 100: '⭐', 250: '7️⃣' };
// openScratchCard removed (slots only)


// ═══════════════════════════════════════════════════════
// SPRINT 27 — THE FORGE: XP SHOP + MYSTERY BOX
// ═══════════════════════════════════════════════════════

// ── XP Shop ─────────────────────────────────────────────────────────────────
var XP_SHOP_ITEMS = [
    { id: 'freespins5',  label: '5 Free Spins',       icon: '🎰', cost: 100,  desc: 'Get 5 free spins on any open game' },
    { id: 'balance5',    label: '$5 Balance Boost',   icon: '💵', cost: 250,  desc: 'Add $5 to your balance' },
    { id: 'xpboost50',   label: '2× XP Boost (50)',   icon: '⚡', cost: 500,  desc: 'Double XP on your next 50 spins' },
    { id: 'balance20',   label: '$20 Balance Boost',  icon: '💰', cost: 1000, desc: 'Add $20 to your balance' },
];

function openXpShop() {
    var modal = document.getElementById('xpShopModal');
    if (!modal) return;
    var grid = document.getElementById('xpShopGrid');
    var balEl = document.getElementById('xpShopBalance');
    if (balEl) balEl.textContent = (typeof playerXP !== 'undefined' ? Math.floor(playerXP) : 0).toLocaleString();
    if (grid) {
        grid.innerHTML = '';
        XP_SHOP_ITEMS.forEach(function(item) {
            var canAfford = (typeof playerXP !== 'undefined') && playerXP >= item.cost;
            var card = document.createElement('div');
            card.className = 'xp-shop-card' + (canAfford ? '' : ' xp-shop-card--disabled');
            card.innerHTML =
                '<div class="xp-shop-icon">' + item.icon + '</div>' +
                '<div class="xp-shop-label">' + item.label + '</div>' +
                '<div class="xp-shop-desc">' + item.desc + '</div>' +
                '<div class="xp-shop-cost">' + item.cost.toLocaleString() + ' XP</div>' +
                '<button class="xp-shop-buy-btn"' + (canAfford ? '' : ' disabled') + '>BUY</button>';
            card.querySelector('.xp-shop-buy-btn').addEventListener('click', function() {
                // _buyXpShopItem is async — it calls openXpShop() internally after
                // the server responds. Do NOT call openXpShop() here as it would
                // re-render the grid immediately and undo the button-disabled guard.
                _buyXpShopItem(item);
            });
            grid.appendChild(card);
        });
    }
    modal.classList.add('active');
    modal.onclick = function(e) { if (e.target === modal) modal.classList.remove('active'); };
}

function _buyXpShopItem(item) {
    // Client-side pre-check (UX only — server re-validates authoritatively)
    if (typeof playerXP === 'undefined' || playerXP < item.cost) {
        if (typeof showToast === 'function') showToast('Not enough XP!', 'error');
        return;
    }

    // Retrieve auth token for server call
    var token = '';
    try { token = localStorage.getItem('casinoToken') || ''; } catch (e) {}

    // Disable all buy buttons while the request is in flight
    var btns = document.querySelectorAll('.xp-shop-buy-btn');
    btns.forEach(function (b) { b.disabled = true; });

    fetch('/api/xpshop/purchase', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer ' + token,
        },
        body: JSON.stringify({ itemId: item.id }),
    })
    .then(function (r) { return r.json(); })
    .then(function (res) {
        btns.forEach(function (b) { b.disabled = false; });

        if (res.error) {
            if (typeof showToast === 'function') showToast(res.error, 'error', 3000);
            return;
        }

        // Server confirmed purchase — sync local XP to authoritative server value
        if (typeof playerXP !== 'undefined') {
            playerXP = res.newXp;
            if (typeof saveXP === 'function') saveXP();
            if (typeof updateXPDisplay === 'function') updateXPDisplay();
        }

        // Apply the granted reward
        if (res.granted) {
            if (res.granted.type === 'balance') {
                if (typeof balance !== 'undefined') {
                    balance = res.newBalance;
                    if (typeof saveBalance === 'function') saveBalance();
                    if (typeof updateBalance === 'function') updateBalance();
                }
                if (typeof showToast === 'function') {
                    showToast('+$' + res.granted.amount.toLocaleString() + ' added to your balance!', 'win', 4000);
                }
            } else if (res.granted.type === 'freespins') {
                if (typeof currentGame !== 'undefined' && currentGame && typeof triggerFreeSpins === 'function') {
                    triggerFreeSpins(currentGame, res.granted.amount);
                    if (typeof showToast === 'function') showToast(res.granted.amount + ' Free Spins activated!', 'win', 4000);
                } else if (typeof showToast === 'function') {
                    showToast('Open a slot first to use your Free Spins!', 'info', 4000);
                }
            } else if (res.granted.type === 'xpboost') {
                try {
                    var existing = JSON.parse(localStorage.getItem('matrixXpBoost') || 'null');
                    var remaining = (existing && existing.remaining > 0) ? existing.remaining + res.granted.amount : res.granted.amount;
                    localStorage.setItem('matrixXpBoost', JSON.stringify({ remaining: remaining }));
                    if (typeof showToast === 'function') showToast('2× XP Boost active for ' + remaining + ' spins!', 'win', 4000);
                } catch (e) {}
            }
        }

        // Refresh the shop UI to reflect updated XP balance
        if (typeof openXpShop === 'function') openXpShop();
    })
    .catch(function (err) {
        btns.forEach(function (b) { b.disabled = false; });

        // Server is unreachable — only allow non-balance items client-side.
        // Balance grants MUST go through the server to prevent exploitation.
        if (item.type === 'balance' || item.id === 'balance5' || item.id === 'balance20') {
            if (typeof showToast === 'function') {
                showToast('Server unavailable — balance rewards require a server connection.', 'error', 5000);
            }
            return;
        }

        // Fallback for freespins / xpboost when server is offline
        if (typeof playerXP !== 'undefined' && playerXP >= item.cost) {
            playerXP -= item.cost;
            if (typeof saveXP === 'function') saveXP();
            if (typeof updateXPDisplay === 'function') updateXPDisplay();

            if (item.id === 'freespins5') {
                if (typeof currentGame !== 'undefined' && currentGame && typeof triggerFreeSpins === 'function') {
                    triggerFreeSpins(currentGame, 5);
                    if (typeof showToast === 'function') showToast('5 Free Spins activated! (offline)', 'win');
                } else if (typeof showToast === 'function') {
                    showToast('Open a slot first to use your Free Spins!', 'info');
                }
            } else if (item.id === 'xpboost50') {
                try {
                    var existingBoost = JSON.parse(localStorage.getItem('matrixXpBoost') || 'null');
                    var boostRem = (existingBoost && existingBoost.remaining > 0) ? existingBoost.remaining + 50 : 50;
                    localStorage.setItem('matrixXpBoost', JSON.stringify({ remaining: boostRem }));
                    if (typeof showToast === 'function') showToast('2× XP Boost active for ' + boostRem + ' spins! (offline)', 'win');
                } catch (e) {}
            }

            if (typeof openXpShop === 'function') openXpShop();
        }
    });
}

// ── Mystery Box ──────────────────────────────────────────────────────────────
var MYSTERY_BOX_COOLDOWN_MS = 4 * 60 * 60 * 1000; // 4 hours
var MYSTERY_BOX_KEY = 'matrixMysteryBox';

var MYSTERY_BOX_PRIZES = [
    { label: 'Common',     weight: 60, cash: [10, 25],   spins: 0,  emoji: '📦' },
    { label: 'Uncommon',   weight: 25, cash: [30, 60],   spins: 0,  emoji: '🎁' },
    { label: 'Rare',       weight: 10, cash: [75, 100],  spins: 0,  emoji: '💎' },
    { label: 'Legendary',  weight: 5,  cash: [100, 100], spins: 5,  emoji: '👑' },
];

function _pickMysteryPrize() {
    var roll = Math.random() * 100;
    var cumulative = 0;
    for (var i = 0; i < MYSTERY_BOX_PRIZES.length; i++) {
        cumulative += MYSTERY_BOX_PRIZES[i].weight;
        if (roll < cumulative) return MYSTERY_BOX_PRIZES[i];
    }
    return MYSTERY_BOX_PRIZES[0];
}

function _getMysteryBoxState() {
    try { return JSON.parse(localStorage.getItem(MYSTERY_BOX_KEY) || 'null'); } catch(e) { return null; }
}

function _updateMysteryBoxNavBtn() {
    var btn = document.getElementById('mysteryBoxNavBtn');
    if (!btn) return;
    var state = _getMysteryBoxState();
    var elapsed = state ? Date.now() - state.lastOpen : Infinity;
    if (elapsed >= MYSTERY_BOX_COOLDOWN_MS) {
        btn.classList.add('mystery-box-ready');
        btn.title = 'Mystery Box ready!';
    } else {
        btn.classList.remove('mystery-box-ready');
        var remaining = Math.ceil((MYSTERY_BOX_COOLDOWN_MS - elapsed) / 1000);
        var h = Math.floor(remaining / 3600), m = Math.floor((remaining % 3600) / 60);
        btn.title = 'Ready in ' + h + 'h ' + m + 'm';
    }
}

function openMysteryBox() {
    var modal = document.getElementById('mysteryBoxModal');
    if (!modal) return;
    _refreshMysteryBoxModal();
    modal.classList.add('active');
    modal.onclick = function(e) { if (e.target === modal) modal.classList.remove('active'); };
    // Tick countdown every second while open
    if (window._mysteryBoxTick) clearInterval(window._mysteryBoxTick);
    window._mysteryBoxTick = setInterval(function() {
        if (!modal.classList.contains('active')) { clearInterval(window._mysteryBoxTick); return; }
        _refreshMysteryBoxModal();
    }, 1000);
}

function _refreshMysteryBoxModal() {
    var icon    = document.getElementById('mysteryBoxIcon');
    var status  = document.getElementById('mysteryBoxStatus');
    var cd      = document.getElementById('mysteryBoxCountdown');
    var openBtn = document.getElementById('mysteryBoxOpenBtn');
    if (!icon) return;
    var state = _getMysteryBoxState();
    var elapsed = state ? Date.now() - state.lastOpen : Infinity;
    if (elapsed >= MYSTERY_BOX_COOLDOWN_MS) {
        icon.textContent = '📦';
        icon.className = 'mystery-box-icon mystery-box-icon--ready';
        status.textContent = 'Your mystery box is ready!';
        if (cd) cd.style.display = 'none';
        if (openBtn) { openBtn.disabled = false; openBtn.textContent = 'OPEN BOX'; }
    } else {
        var remaining = Math.ceil((MYSTERY_BOX_COOLDOWN_MS - elapsed) / 1000);
        var h = Math.floor(remaining / 3600);
        var m = Math.floor((remaining % 3600) / 60);
        var s = remaining % 60;
        icon.textContent = '🔒';
        icon.className = 'mystery-box-icon mystery-box-icon--locked';
        status.textContent = 'Next box available in:';
        if (cd) { cd.style.display = ''; cd.textContent = h + 'h ' + m + 'm ' + s + 's'; }
        if (openBtn) { openBtn.disabled = true; openBtn.textContent = 'LOCKED'; }
    }
}

function doOpenMysteryBox() {
    var state = _getMysteryBoxState();
    var elapsed = state ? Date.now() - state.lastOpen : Infinity;
    if (elapsed < MYSTERY_BOX_COOLDOWN_MS) return;

    var icon    = document.getElementById('mysteryBoxIcon');
    var status  = document.getElementById('mysteryBoxStatus');
    var openBtn = document.getElementById('mysteryBoxOpenBtn');

    if (openBtn) { openBtn.disabled = true; openBtn.textContent = 'OPENING…'; }
    if (icon) {
        icon.className = 'mystery-box-icon mystery-box-icon--opening';
        icon.textContent = '✨';
    }

    // Call the server — it chooses the reward, credits bonus_balance with
    // wagering where applicable, and returns the actual reward granted. Never
    // fabricate cash amounts on the client.
    var token = (typeof getAuthToken === 'function') ? getAuthToken() : null;
    fetch('/api/mystery/claim', {
        method: 'POST',
        headers: Object.assign({ 'Content-Type': 'application/json' }, token ? { 'Authorization': 'Bearer ' + token } : {}),
        credentials: 'include'
    })
    .then(function (r) { return r.json().then(function (body) { return { ok: r.ok, body: body }; }); })
    .then(function (resp) {
        try { localStorage.setItem(MYSTERY_BOX_KEY, JSON.stringify({ lastOpen: Date.now() })); } catch (_) {}
        _updateMysteryBoxNavBtn();

        if (!resp.ok || !resp.body || !resp.body.reward) {
            var err = (resp.body && resp.body.error) || 'Not ready yet — keep spinning to unlock your next box.';
            if (icon) { icon.textContent = '📦'; icon.className = 'mystery-box-icon'; }
            if (status) status.textContent = err;
            if (openBtn) { openBtn.disabled = false; openBtn.textContent = 'OPEN BOX'; }
            return;
        }

        var reward = resp.body.reward;
        var label, emoji;
        if (reward.type === 'credits')     { label = '+$' + (reward.amount || 0) + ' bonus credits (wagering applies)'; emoji = '💰'; }
        else if (reward.type === 'gems')   { label = '+' + (reward.amount || 0) + ' gems'; emoji = '💎'; }
        else if (reward.type === 'wheel_spins') { label = '+' + (reward.amount || 0) + ' wheel spins'; emoji = '🎡'; }
        else if (reward.type === 'promo')  { label = 'Promo code: ' + (reward.code || ''); emoji = '🎟️'; }
        else                                { label = 'Reward granted'; emoji = '🎁'; }

        setTimeout(function () {
            if (icon)   { icon.textContent = emoji; icon.className = 'mystery-box-icon mystery-box-icon--revealed'; }
            if (status) status.textContent = label;
            if (typeof showToast === 'function') showToast(emoji + ' Mystery Box: ' + label, 'win');
            if (openBtn) { openBtn.disabled = true; openBtn.textContent = 'OPENED'; }
        }, 600);
    })
    .catch(function (err) {
        if (status) status.textContent = 'Network error — please try again.';
        if (openBtn) { openBtn.disabled = false; openBtn.textContent = 'OPEN BOX'; }
        if (icon) { icon.textContent = '📦'; icon.className = 'mystery-box-icon'; }
        console.warn('[MysteryBox] claim failed:', err && err.message);
    });
}

// Refresh nav btn state on load and every minute
(function() {
    function _init() { _updateMysteryBoxNavBtn(); }
    if (document.readyState === 'loading') { document.addEventListener('DOMContentLoaded', _init); }
    else { _init(); }
    setInterval(_updateMysteryBoxNavBtn, 60000);
})();

// ═══════════════════════════════════════════════════════
// SPRINT 30 — THE CALENDAR: LOGIN CALENDAR + COMMUNITY JACKPOT
// ═══════════════════════════════════════════════════════

// ── Login Calendar ───────────────────────────────────────────────────────────
var LC_KEY       = 'matrixLoginCalendar';
var LC_MILES_KEY = 'matrixCalendarMilestones';
var LC_MILESTONES = [
    { days: 7,  cash: 200,  xp: 0,   spins: 0,  label: '7 Days' },
    { days: 14, cash: 500,  xp: 50,  spins: 0,  label: '14 Days' },
    { days: 21, cash: 1000, xp: 100, spins: 0,  label: '21 Days' },
    { days: 28, cash: 2500, xp: 250, spins: 5,  label: '28 Days' },
];

function _lcGetState() {
    try { return JSON.parse(localStorage.getItem(LC_KEY) || 'null'); } catch(e) { return null; }
}

function _lcSaveState(state) {
    try { localStorage.setItem(LC_KEY, JSON.stringify(state)); } catch (e) { /* ignore */ }
}

function _lcNow() {
    var d = new Date();
    return { month: d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0'), day: d.getDate() };
}

function _lcMarkToday() {
    var now = _lcNow();
    var state = _lcGetState();
    if (!state || state.month !== now.month) {
        state = { month: now.month, days: [] };
    }
    if (!state.days.includes(now.day)) {
        state.days.push(now.day);
        _lcSaveState(state);
        _lcCheckMilestones(state);
    }
    return state;
}

function _lcCheckMilestones(state) {
    var milesKey = LC_MILES_KEY;
    var claimed = {};
    try { claimed = JSON.parse(localStorage.getItem(milesKey) || '{}'); } catch(e) {}
    if (!claimed.month || claimed.month !== state.month) claimed = { month: state.month, days: [] };
    var count = state.days.length;
    LC_MILESTONES.forEach(function(m) {
        if (count >= m.days && !claimed.days.includes(m.days)) {
            claimed.days.push(m.days);
            try { localStorage.setItem(milesKey, JSON.stringify(claimed)); } catch (e) { /* ignore */ }
            // Award
            if (typeof balance !== 'undefined') {
                balance += m.cash;
                if (typeof saveBalance === 'function') saveBalance();
                if (typeof updateBalance === 'function') updateBalance();
            }
            if (m.xp > 0 && typeof awardXP === 'function') awardXP(m.xp);
            if (m.spins > 0 && typeof currentGame !== 'undefined' && currentGame && typeof triggerFreeSpins === 'function') {
                triggerFreeSpins(currentGame, m.spins);
            }
            if (typeof showToast === 'function') {
                var msg = '🏆 ' + m.label + ' Login Streak! +$' + m.cash.toLocaleString();
                if (m.xp > 0) msg += ' + ' + m.xp + ' XP';
                if (m.spins > 0) msg += ' + ' + m.spins + ' Free Spins';
                showToast(msg, 'bigwin');
            }
        }
    });
}

function openLoginCalendar() {
    var modal = document.getElementById('loginCalendarModal');
    if (!modal) return;
    var state = _lcMarkToday();
    _lcRender(state);
    modal.classList.add('active');
    modal.onclick = function(e) { if (e.target === modal) modal.classList.remove('active'); };
}

function _lcRender(state) {
    var now = _lcNow();
    var titleEl = document.getElementById('lcMonthTitle');
    var gridEl  = document.getElementById('lcGrid');
    var milesEl = document.getElementById('lcMilestones');
    if (!gridEl) return;

    // Title
    var monthNames = ['January','February','March','April','May','June','July','August','September','October','November','December'];
    var d = new Date();
    if (titleEl) titleEl.textContent = monthNames[d.getMonth()] + ' ' + d.getFullYear() + '  —  ' + state.days.length + ' / 30 days logged';

    // Grid
    var daysInMonth = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
    var html = '';
    for (var i = 1; i <= daysInMonth; i++) {
        var isPast = i < now.day;
        var isToday = i === now.day;
        var isLogged = state.days.includes(i);
        var cls = 'lc-day';
        var icon = '';
        if (isToday && isLogged)  { cls += ' lc-day-today'; icon = '✓'; }
        else if (isPast && isLogged) { cls += ' lc-day-done'; icon = '✓'; }
        else if (isPast && !isLogged) { cls += ' lc-day-missed'; icon = '✗'; }
        else if (isToday) { cls += ' lc-day-today'; icon = '●'; }
        else { cls += ' lc-day-future'; icon = ''; }
        html += '<div class="' + cls + '"><span class="lc-num">' + i + '</span><span class="lc-icon">' + icon + '</span></div>';
    }
    gridEl.innerHTML = html;

    // Milestones bar
    var claimed = {};
    try { claimed = JSON.parse(localStorage.getItem(LC_MILES_KEY) || '{}'); } catch(e) {}
    var count = state.days.length;
    if (milesEl) {
        milesEl.innerHTML = LC_MILESTONES.map(function(m) {
            var done = (claimed.days || []).includes(m.days);
            var cls = 'lc-mile' + (done ? ' lc-mile-done' : count >= m.days ? ' lc-mile-ready' : '');
            return '<div class="' + cls + '"><span class="lc-mile-days">' + m.days + 'd</span><span class="lc-mile-reward">$' + m.cash.toLocaleString() + (m.xp ? ' +' + m.xp + 'XP' : '') + '</span>' + (done ? '<span class="lc-mile-check">✓</span>' : '') + '</div>';
        }).join('');
    }
}

// ── Community Jackpot Pool ────────────────────────────────────────────────────
var CJ_KEY  = 'matrixCommunityJackpot';
var CJ_SEED = 1000;
var CJ_MAX  = 50000;
var CJ_CONTRIBUTION = 0.50;
var CJ_WIN_ODDS = 10000; // 1 in N

function _cjGetPool() {
    try {
        var s = JSON.parse(localStorage.getItem(CJ_KEY) || 'null');
        if (!s) { s = { pool: CJ_SEED, lastReset: Date.now() }; _cjSave(s); }
        return s;
    } catch(e) { return { pool: CJ_SEED }; }
}

function _cjSave(s) { try { localStorage.setItem(CJ_KEY, JSON.stringify(s)); } catch (e) { /* ignore */ } }

function _cjUpdateTicker() {
    var ticker = document.getElementById('communityJackpotTicker');
    var amtEl  = document.getElementById('communityJackpotAmount');
    if (!ticker || !amtEl) return;
    var s = _cjGetPool();
    ticker.style.display = '';
    var amount = s.pool;
    amtEl.textContent = '$' + Math.floor(amount).toLocaleString();
    ticker.classList.toggle('cjt-large', amount > 10000);
}

// Called by spin flow to contribute to pool and check for win
function communityJackpotSpin(bet) {
    // DISABLED: Was using Math.random() client-side to determine jackpot wins
    // and showing misleading "You won $X!" celebrations without actual credit.
    // Community jackpot would need server-side implementation to be legitimate.
}

// Init ticker on load
(function() {
    function _cjInit() { _cjUpdateTicker(); }
    if (document.readyState === 'loading') { document.addEventListener('DOMContentLoaded', _cjInit); }
    else { _cjInit(); }
    setInterval(_cjUpdateTicker, 30000);
})();

// ═══════════════════════════════════════════════════════
// SPRINT 31 — PROMO CODES + AUTOMATIC CASHBACK
// ═══════════════════════════════════════════════════════

var PROMO_CODES = {
    WELCOME10:  { type: 'one-time', reward: { cash: 10 },               desc: '+$10 Balance!' },
    MATRIX100:  { type: 'one-time', reward: { xp: 100 },                desc: '+100 XP!' },
    FREESPIN10: { type: 'one-time', reward: { spins: 10 },              desc: '10 Free Spins!' },
    DAILY2:     { type: 'daily',    reward: { cash: 2 },                desc: '+$2 Balance!' },
    XPBOOST:    { type: 'daily',    reward: { xpboost: 20 },            desc: '2× XP Boost (20 spins)!' },
};
var PROMO_STORAGE_KEY = 'matrixPromoCodes';

function openPromoCode() {
    var modal = document.getElementById('promoCodeModal');
    if (!modal) return;
    var inp = document.getElementById('promoCodeInput');
    var res = document.getElementById('promoResult');
    if (inp) inp.value = '';
    if (res) res.textContent = '';
    modal.classList.add('active');
    modal.onclick = function(e) { if (e.target === modal) modal.classList.remove('active'); };
    if (inp) setTimeout(function() { inp.focus(); }, 80);
    inp && inp.addEventListener('keydown', function(e) { if (e.key === 'Enter') redeemPromoCode(); }, { once: true });
}

async function redeemPromoCode() {
    var inp = document.getElementById('promoCodeInput');
    var res = document.getElementById('promoResult');
    if (!inp) return;
    var code = inp.value.trim().toUpperCase();
    var def = PROMO_CODES[code];

    if (!def) {
        if (res) { res.textContent = '\u274C Unknown code'; res.className = 'promo-result promo-fail'; }
        return;
    }

    // Server-validated redemption for authenticated users
    if (typeof isServerAuthToken === 'function' && isServerAuthToken()) {
        try {
            var serverRes = await apiRequest('/api/user/redeem-promo', {
                method: 'POST',
                body: { code: code },
                requireAuth: true,
            });
            if (serverRes.redeemed) {
                if (serverRes.cash > 0) {
                    balance = serverRes.newBalance;
                    if (typeof updateBalance === 'function') updateBalance();
                    if (typeof saveBalance === 'function') saveBalance();
                }
                if (serverRes.xp > 0 && typeof awardXP === 'function') awardXP(serverRes.xp);
                if (serverRes.spins > 0 && typeof currentGame !== 'undefined' && currentGame && typeof triggerFreeSpins === 'function') {
                    triggerFreeSpins(currentGame, serverRes.spins);
                }
                // Also sync localStorage for display consistency
                var storage;
                try { storage = JSON.parse(localStorage.getItem(PROMO_STORAGE_KEY) || '{}'); } catch(e) { storage = {}; }
                if (!storage.used) storage.used = {};
                storage.used[code] = def.type === 'daily' ? new Date().toISOString().slice(0, 10) : true;
                try { localStorage.setItem(PROMO_STORAGE_KEY, JSON.stringify(storage)); } catch (e) { /* ignore */ }

                if (res) { res.textContent = '\u2705 ' + serverRes.desc; res.className = 'promo-result promo-ok'; }
                if (typeof showToast === 'function') showToast('\uD83C\uDF9F\uFE0F Code redeemed: ' + serverRes.desc, 'win');
            }
        } catch (err) {
            if (err.status === 400) {
                if (res) { res.textContent = '\u26A0\uFE0F Already redeemed'; res.className = 'promo-result promo-fail'; }
            } else {
                if (res) { res.textContent = '\u274C Redemption failed'; res.className = 'promo-result promo-fail'; }
            }
        }
        inp.value = '';
        return;
    }

    // Guest / offline fallback — client-side only (guests can't cash out)
    var storage;
    try { storage = JSON.parse(localStorage.getItem(PROMO_STORAGE_KEY) || '{}'); } catch(e) { storage = {}; }
    var today = new Date().toISOString().slice(0, 10);
    var used = storage.used || {};
    if (def.type === 'one-time' && used[code]) {
        if (res) { res.textContent = '\u26A0\uFE0F Already redeemed'; res.className = 'promo-result promo-fail'; }
        return;
    }
    if (def.type === 'daily' && used[code] === today) {
        if (res) { res.textContent = '\u26A0\uFE0F Already used today'; res.className = 'promo-result promo-fail'; }
        return;
    }
    var r = def.reward;
    // Promo code cash rewards — display only; server handles actual credit
    // No client-side balance manipulation
    if (r.xp && typeof awardXP === 'function') awardXP(r.xp);
    if (r.spins && typeof currentGame !== 'undefined' && currentGame && typeof triggerFreeSpins === 'function') {
        triggerFreeSpins(currentGame, r.spins);
    }
    if (r.xpboost) {
        try {
            var boost = JSON.parse(localStorage.getItem('matrixXpBoost') || 'null');
            var rem = (boost && boost.remaining > 0) ? boost.remaining + r.xpboost : r.xpboost;
            localStorage.setItem('matrixXpBoost', JSON.stringify({ remaining: rem }));
        } catch(e) {}
    }
    if (!storage.used) storage.used = {};
    storage.used[code] = def.type === 'daily' ? today : true;
    try { localStorage.setItem(PROMO_STORAGE_KEY, JSON.stringify(storage)); } catch (e) { /* ignore */ }
    if (res) { res.textContent = '\u2705 ' + def.desc; res.className = 'promo-result promo-ok'; }
    if (typeof showToast === 'function') showToast('\uD83C\uDF9F\uFE0F Code redeemed: ' + def.desc, 'win');
    inp.value = '';
}

// ── Automatic Cashback ───────────────────────────────────────────────────────
var CASHBACK_KEY  = 'matrixCashback';
var CASHBACK_RATE = 0.05; // 5%
var CASHBACK_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24h

function checkCashback() {
    if (typeof balance === 'undefined') return;
    var s;
    try { s = JSON.parse(localStorage.getItem(CASHBACK_KEY) || 'null'); } catch(e) { s = null; }
    var now = Date.now();
    if (!s) {
        try { localStorage.setItem(CASHBACK_KEY, JSON.stringify({ lastCheck: now, lastBalance: balance })); } catch (e) { /* ignore */ }
        return;
    }
    if (now - s.lastCheck < CASHBACK_INTERVAL_MS) return;
    var loss = s.lastBalance - balance;
    if (loss > 0) {
        var cashback = Math.round(loss * CASHBACK_RATE * 100) / 100;
        // Cashback is processed server-side to bonus_balance with wagering
        // Display notification only — no client-side balance manipulation
        if (typeof showToast === 'function') showToast('💰 5% Daily Cashback: $' + cashback.toFixed(2) + ' credited to bonus balance!', 'win');
    }
    try { localStorage.setItem(CASHBACK_KEY, JSON.stringify({ lastCheck: now, lastBalance: balance })); } catch (e) { /* ignore */ }
}

(function() {
    function _cbInit() { if (typeof checkCashback === 'function') checkCashback(); }
    if (document.readyState === 'loading') { document.addEventListener('DOMContentLoaded', _cbInit); }
    else { setTimeout(_cbInit, 1000); } // Delay so balance is loaded first
})();

// ═══════════════════════════════════════════════════════
// SPRINT 32 — SPIN HISTORY + PLAYER CARD
// ═══════════════════════════════════════════════════════

// ── Spin History ─────────────────────────────────────────────────────────────
var SH_KEY     = 'matrixSpinHistory';
var SH_MAX     = 100;
var _shFilter  = 'all';

function recordSpinHistory(entry) {
    // entry: { game, gameId, bet, win }
    try {
        var hist = JSON.parse(localStorage.getItem(SH_KEY) || '[]');
        hist.unshift({ ts: Date.now(), game: entry.game || '', gameId: entry.gameId || '', bet: entry.bet || 0, win: entry.win || 0, mult: entry.bet > 0 ? Math.round((entry.win / entry.bet) * 10) / 10 : 0 });
        if (hist.length > SH_MAX) hist = hist.slice(0, SH_MAX);
        localStorage.setItem(SH_KEY, JSON.stringify(hist));
    } catch(e) {}
}

function _shRelTime(ts) {
    var diff = Math.floor((Date.now() - ts) / 1000);
    if (diff < 60) return diff + 's ago';
    if (diff < 3600) return Math.floor(diff / 60) + 'm ago';
    if (diff < 86400) return Math.floor(diff / 3600) + 'h ago';
    return Math.floor(diff / 86400) + 'd ago';
}

function shSetFilter(f, btn) {
    _shFilter = f;
    document.querySelectorAll('.sh-filter-btn').forEach(function(b) { b.classList.toggle('sh-filter-active', b === btn); });
    _shRenderList();
}

function _shRenderList() {
    var listEl = document.getElementById('shList');
    if (!listEl) return;
    var hist = [];
    try { hist = JSON.parse(localStorage.getItem(SH_KEY) || '[]'); } catch(e) {}
    var filtered = hist.filter(function(e) {
        if (_shFilter === 'wins')   return e.win > e.bet;
        if (_shFilter === 'losses') return e.win <= e.bet;
        return true;
    });
    if (filtered.length === 0) {
        listEl.innerHTML = '<div class="sh-empty">No spins recorded yet.</div>';
        return;
    }
    listEl.innerHTML = filtered.map(function(e) {
        var isWin = e.win > e.bet;
        var net = e.win - e.bet;
        var netStr = (net >= 0 ? '+$' : '-$') + Math.abs(net).toFixed(2);
        var multBadge = e.mult >= 2 ? '<span class="sh-mult">' + e.mult + 'x</span>' : '';
        return '<div class="sh-entry' + (isWin ? ' sh-win' : ' sh-loss') + '">' +
            '<div class="sh-game">' + (e.game || e.gameId || 'Unknown') + '</div>' +
            '<div class="sh-amounts"><span class="sh-bet">$' + (e.bet || 0).toFixed(2) + '</span>' + multBadge + '<span class="sh-net ' + (isWin ? 'sh-net-win' : 'sh-net-loss') + '">' + netStr + '</span></div>' +
            '<div class="sh-time">' + _shRelTime(e.ts) + '</div></div>';
    }).join('');
}

function openSpinHistory() {
    var modal = document.getElementById('spinHistoryModal');
    if (!modal) return;
    _shFilter = 'all';
    document.querySelectorAll('.sh-filter-btn').forEach(function(b) { b.classList.toggle('sh-filter-active', b.dataset.f === 'all'); });
    _shRenderList();
    modal.classList.add('active');
    modal.onclick = function(e) { if (e.target === modal) modal.classList.remove('active'); };
}

// ── Player Stats Card ─────────────────────────────────────────────────────────
function openPlayerCard() {
    var modal = document.getElementById('playerCardModal');
    var inner = document.getElementById('playerCardInner');
    if (!modal || !inner) return;

    var username = (typeof currentUser !== 'undefined' && currentUser && currentUser.username) ? currentUser.username : 'Guest';
    var level    = (typeof playerLevel !== 'undefined') ? playerLevel : 1;
    var xp       = (typeof playerXP !== 'undefined') ? Math.floor(playerXP) : 0;
    var totalSpins = (typeof stats !== 'undefined' && stats.totalSpins) ? stats.totalSpins : 0;
    var biggestWin = (typeof stats !== 'undefined' && stats.biggestWin) ? stats.biggestWin : 0;
    var totalWon   = (typeof stats !== 'undefined' && stats.totalWon) ? stats.totalWon : 0;

    // VIP tier
    var vipTier = 'Bronze';
    if (typeof currentUser !== 'undefined' && currentUser && currentUser.vipTier) vipTier = currentUser.vipTier;
    else if (totalSpins >= 5000) vipTier = 'Platinum';
    else if (totalSpins >= 1000) vipTier = 'Gold';
    else if (totalSpins >= 200) vipTier = 'Silver';

    // Favorite game
    var favGame = 'None yet';
    try {
        var recent = JSON.parse(localStorage.getItem(typeof RECENTLY_PLAYED_KEY !== 'undefined' ? RECENTLY_PLAYED_KEY : 'recentlyPlayed') || '[]');
        if (recent.length > 0) {
            var allGames = typeof GAMES !== 'undefined' ? GAMES : [];
            var g = allGames.find(function(x) { return x.id === recent[0]; });
            if (g) favGame = g.name || g.id;
        }
    } catch(e) {}

    // Achievement count
    var achCount = 0;
    try { var achData = JSON.parse(localStorage.getItem('matrixAchievements') || '{}'); achCount = (achData.unlocked || []).length; } catch(e) {}

    // XP needed for next level
    var xpNeeded = (typeof getXPForLevel === 'function') ? getXPForLevel(level) : (level * 100);
    var xpPct = Math.min(100, Math.round((xp / xpNeeded) * 100));

    var vipColors = { Bronze: '#cd7f32', Silver: '#c0c0c0', Gold: '#ffd700', Platinum: '#e5e4e2' };
    var vipColor = vipColors[vipTier] || '#ffd700';

    inner.innerHTML =
        '<div class="pc-header">' +
            '<div class="pc-avatar">' + username.charAt(0).toUpperCase() + '</div>' +
            '<div class="pc-identity">' +
                '<div class="pc-username">' + username + '</div>' +
                '<div class="pc-vip" style="color:' + vipColor + '">' + vipTier + ' Member</div>' +
            '</div>' +
        '</div>' +
        '<div class="pc-level-wrap">' +
            '<div class="pc-level-label">Level ' + level + '</div>' +
            '<div class="pc-xp-bar"><div class="pc-xp-fill" style="width:' + xpPct + '%"></div></div>' +
            '<div class="pc-xp-text">' + xp.toLocaleString() + ' / ' + xpNeeded.toLocaleString() + ' XP</div>' +
        '</div>' +
        '<div class="pc-stats-grid">' +
            '<div class="pc-stat"><div class="pc-stat-val">' + totalSpins.toLocaleString() + '</div><div class="pc-stat-label">Spins</div></div>' +
            '<div class="pc-stat"><div class="pc-stat-val">$' + (biggestWin >= 1000 ? (biggestWin / 1000).toFixed(1) + 'K' : biggestWin.toFixed(0)) + '</div><div class="pc-stat-label">Best Win</div></div>' +
            '<div class="pc-stat"><div class="pc-stat-val">$' + (totalWon >= 1000 ? (totalWon / 1000).toFixed(1) + 'K' : totalWon.toFixed(0)) + '</div><div class="pc-stat-label">Total Won</div></div>' +
            '<div class="pc-stat"><div class="pc-stat-val">' + achCount + '</div><div class="pc-stat-label">Badges</div></div>' +
        '</div>' +
        '<div class="pc-footer-row"><span class="pc-fav-label">Favorite:</span><span class="pc-fav-game">' + favGame + '</span></div>';

    modal.classList.add('active');
    modal.onclick = function(e) { if (e.target === modal) modal.classList.remove('active'); };
}

// ══════════════════════════════════════════════════════════
// SPRINT 36 — Lucky Spin Mini-Game
// ══════════════════════════════════════════════════════════
var _LS_KEY = 'matrixLuckySpin';
// XP-only segments until this mini-game has a server-side endpoint. Cash
// segments previously listed here displayed "credited to your account"
// messages for dollar amounts that were never actually credited — deceptive
// advertising. Real-money daily spin is handled by /api/dailywheel.
var _LS_SEGMENTS = [
    { label: '50 XP',   type: 'xp', value: 50  },
    { label: '100 XP',  type: 'xp', value: 100 },
    { label: '150 XP',  type: 'xp', value: 150 },
    { label: '75 XP',   type: 'xp', value: 75  },
    { label: '500 XP',  type: 'xp', value: 500 },
    { label: '100 XP',  type: 'xp', value: 100 },
    { label: '250 XP',  type: 'xp', value: 250 },
    { label: '50 XP',   type: 'xp', value: 50  }
];
var _lsSpinning = false;

function _lsGetState() { try { return JSON.parse(localStorage.getItem(_LS_KEY) || '{}'); } catch(e) { return {}; } }

function openLuckySpin() {
    var modal = document.getElementById('luckySpinModal');
    if (!modal) return;
    _lsRefreshStatus();
    modal.classList.add('active');
    modal.onclick = function(e) { if (e.target === modal) modal.classList.remove('active'); };
}

function _lsRefreshStatus() {
    var state = _lsGetState();
    var today = new Date().toDateString();
    var statusEl = document.getElementById('lsStatus');
    var btnEl = document.getElementById('lsSpinBtn');
    var freeAvail = state.lastFreeDay !== today;
    if (statusEl) statusEl.textContent = freeAvail ? '1 free spin available today!' : 'Free spin used — Extra spins cost $50';
    if (btnEl) {
        if (freeAvail) {
            btnEl.textContent = '🎡 SPIN (Free!)';
            btnEl.disabled = false;
        } else {
            var canAfford = typeof balance !== 'undefined' && balance >= 50;
            btnEl.textContent = '🎡 SPIN ($50)';
            btnEl.disabled = !canAfford;
        }
    }
}

function doLuckySpin() {
    if (_lsSpinning) return;
    var state = _lsGetState();
    var today = new Date().toDateString();
    var freeAvail = state.lastFreeDay !== today;
    if (!freeAvail) {
        // Paid spins disabled — would need server-side deduction
        if (typeof showToast === 'function') showToast('Free spin already used today! Come back tomorrow.', 'info');
        return;
    }
    _lsSpinning = true;
    var btnEl = document.getElementById('lsSpinBtn');
    var resultEl = document.getElementById('lsResult');
    if (btnEl) btnEl.disabled = true;
    if (resultEl) resultEl.textContent = '';
    var segIdx = Math.floor(Math.random() * _LS_SEGMENTS.length);
    var seg = _LS_SEGMENTS[segIdx];
    var wheel = document.getElementById('lsWheel');
    var segDeg = 360 / _LS_SEGMENTS.length;
    var landAngle = 360 - (segIdx * segDeg) - segDeg / 2;
    var totalRotation = 1440 + landAngle;
    if (wheel) {
        wheel.style.transition = 'transform 3s cubic-bezier(0.17,0.67,0.12,0.99)';
        wheel.style.transform = 'rotate(' + totalRotation + 'deg)';
    }
    setTimeout(function() {
        _lsSpinning = false;
        // Only XP segments exist; awardXP posts to the server and updates the
        // user's experience points.
        if (seg.type === 'xp' && typeof awardXP === 'function') awardXP(seg.value);
        if (resultEl) resultEl.textContent = '🎉 You won ' + seg.label + '!';
        if (freeAvail) state.lastFreeDay = today;
        state.totalSpins = (state.totalSpins || 0) + 1;
        try { localStorage.setItem(_LS_KEY, JSON.stringify(state)); } catch (e) { /* ignore */ }
        _lsRefreshStatus();
    }, 3100);
}

// ══════════════════════════════════════════════════════════
// SPRINT 36 — Game Rating System
// ══════════════════════════════════════════════════════════
var _GR_KEY = 'matrixGameRatings';
var _MY_RATINGS_KEY = 'matrixMyRatings';
var _ratingGameId = null;

function showRatingPrompt(gameId, gameName) {
    _ratingGameId = gameId;
    var prompt = document.getElementById('ratingPrompt');
    var nameEl = document.getElementById('ratingGameName');
    if (!prompt) return;
    try {
        var myRatings = JSON.parse(localStorage.getItem(_MY_RATINGS_KEY) || '{}');
        if (myRatings[gameId]) return;
    } catch(e) {}
    if (nameEl) nameEl.textContent = gameName || 'this game';
    document.querySelectorAll('.rp-star').forEach(function(s) { s.classList.remove('rp-active'); });
    prompt.style.display = 'flex';
    setTimeout(function() { dismissRating(); }, 10000);
}

function submitRating(val) {
    if (!_ratingGameId) return;
    try {
        var ratings = JSON.parse(localStorage.getItem(_GR_KEY) || '{}');
        var myRatings = JSON.parse(localStorage.getItem(_MY_RATINGS_KEY) || '{}');
        if (!ratings[_ratingGameId]) ratings[_ratingGameId] = { rating: 0, count: 0 };
        var r = ratings[_ratingGameId];
        r.rating = ((r.rating * r.count) + val) / (r.count + 1);
        r.count += 1;
        myRatings[_ratingGameId] = val;
        localStorage.setItem(_GR_KEY, JSON.stringify(ratings));
        localStorage.setItem(_MY_RATINGS_KEY, JSON.stringify(myRatings));
    } catch(e) {}
    dismissRating();
}

function dismissRating() {
    var prompt = document.getElementById('ratingPrompt');
    if (prompt) prompt.style.display = 'none';
}

// ══════════════════════════════════════════════════════════
// SPRINT 38 — Win Replay Gallery
// ══════════════════════════════════════════════════════════
var _WR_KEY = 'matrixWinReplays';
var _WR_MAX = 20;

function saveWinReplay(entry) {
    try {
        var replays = JSON.parse(localStorage.getItem(_WR_KEY) || '[]');
        replays.unshift(entry);
        if (replays.length > _WR_MAX) replays = replays.slice(0, _WR_MAX);
        localStorage.setItem(_WR_KEY, JSON.stringify(replays));
    } catch(e) {}
}

function openWinReplays() {
    var modal = document.getElementById('winReplayModal');
    var list = document.getElementById('wrList');
    if (!modal || !list) return;
    var replays = [];
    try { replays = JSON.parse(localStorage.getItem(_WR_KEY) || '[]'); } catch(e) {}
    if (replays.length === 0) {
        list.innerHTML = '<div class="wr-empty">No replays yet. Wins of 10x+ bet are auto-saved.</div>';
    } else {
        list.innerHTML = replays.map(function(r) {
            var mult = r.bet > 0 ? (r.win / r.bet).toFixed(1) : '?';
            return '<div class="wr-entry">' +
                '<div class="wr-game">' + (r.game || r.gameId || 'Unknown') + '</div>' +
                '<div class="wr-win">$' + (r.win || 0).toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2}) + ' <span class="wr-mult">' + mult + 'x</span></div>' +
                '<div class="wr-time">' + _wrRelTime(r.ts) + '</div>' +
                '</div>';
        }).join('');
    }
    modal.classList.add('active');
    modal.onclick = function(e) { if (e.target === modal) modal.classList.remove('active'); };
}

function _wrRelTime(ts) {
    var diff = Date.now() - ts;
    if (diff < 60000) return 'just now';
    if (diff < 3600000) return Math.floor(diff / 60000) + 'm ago';
    if (diff < 86400000) return Math.floor(diff / 3600000) + 'h ago';
    return Math.floor(diff / 86400000) + 'd ago';
}

// ===== Sprint 41: Avatar Picker =====
var _AVATARS = ['🎰','🃏','🎲','🦁','🐯','🦊','🐺','🦅','🐉','⚡','🔥','💎','👑','🌟','🎯','🏆'];
var _AVATAR_KEY = 'matrixUserAvatar';

function openAvatarPicker() {
    var modal = document.getElementById('avatarPickerModal');
    var grid = document.getElementById('avatarGrid');
    if (!modal || !grid) return;
    var current = localStorage.getItem(_AVATAR_KEY) || '';
    grid.innerHTML = _AVATARS.map(function(emoji) {
        return '<button class="avatar-option' + (emoji === current ? ' av-selected' : '') + '" onclick="setAvatar(\'' + emoji + '\')" title="' + emoji + '">' + emoji + '</button>';
    }).join('');
    modal.classList.add('active');
    modal.onclick = function(e) { if (e.target === modal) modal.classList.remove('active'); };
}

function setAvatar(emoji) {
    try { localStorage.setItem(_AVATAR_KEY, emoji); } catch (e) { /* ignore */ }
    _refreshAvatarDisplay();
    var modal = document.getElementById('avatarPickerModal');
    if (modal) modal.classList.remove('active');
    if (typeof showToast === 'function') showToast('Avatar updated! ' + emoji, 'info');
}

function _refreshAvatarDisplay() {
    var emoji = localStorage.getItem(_AVATAR_KEY) || '';
    var span = document.getElementById('userAvatarDisplay');
    var svg = document.getElementById('authBtnSvg');
    if (!span) return;
    if (emoji) {
        span.textContent = emoji;
        span.style.display = '';
        if (svg) svg.style.display = 'none';
    } else {
        span.style.display = 'none';
        if (svg) svg.style.display = '';
    }
}

// Call on page load to apply saved avatar
(function() {
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', _refreshAvatarDisplay);
    } else {
        _refreshAvatarDisplay();
    }
})();

// ===== Sprint 43: Keyboard Shortcuts Modal =====
function openShortcutsModal() {
    var modal = document.getElementById('shortcutsModal');
    if (!modal) return;
    modal.classList.add('active');
    modal.onclick = function(e) { if (e.target === modal) modal.classList.remove('active'); };
}

function _toggleHotkeySheet() {
    var modal = document.getElementById('shortcutsModal');
    if (!modal) return;
    if (modal.classList.contains('active')) {
        modal.classList.remove('active');
    } else {
        openShortcutsModal();
    }
}

// ===== Responsible Gambling — Session Timer =====

function updateSessionTimerDisplay(elapsed, limit, remaining) {
    var el = document.getElementById('sessionTimerDisplay');
    if (!el) return;

    // Build text content safely — no innerHTML with variables
    var timeText;
    if (limit && limit > 0) {
        timeText = '\u23f1 ' + elapsed + 'm / ' + limit + 'm';
    } else {
        timeText = '\u23f1 ' + elapsed + 'm played';
    }
    el.textContent = timeText;

    // Warning state
    el.classList.remove('session-timer-warning', 'session-timer-danger');
    if (remaining !== null && remaining !== undefined) {
        if (remaining <= 0) {
            el.classList.add('session-timer-danger');
            // Session limit reached — notify and end session
            if (typeof showToast === 'function') {
                showToast('Session time limit reached. Please take a break.', 'info');
            }
            // End session server-side
            (function() {
                try {
                    var token = localStorage.getItem(
                        typeof STORAGE_KEY_TOKEN !== 'undefined' ? STORAGE_KEY_TOKEN : 'casinoToken'
                    );
                    if (!token) return;
                    fetch('/api/session/end', {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            'Authorization': 'Bearer ' + token
                        }
                    }).catch(function() { /* silent */ });
                } catch (e) { /* silent */ }
            })();
            if (window._sessionTimerInterval) {
                clearInterval(window._sessionTimerInterval);
                window._sessionTimerInterval = null;
            }
        } else if (remaining < 10) {
            el.classList.add('session-timer-warning');
        }
    }

    // Show the element
    el.style.display = '';
}

function initSessionTimer() {
    // Auth guard
    if (typeof isServerAuthToken !== 'function' || !isServerAuthToken()) return;
    var token = localStorage.getItem(
        typeof STORAGE_KEY_TOKEN !== 'undefined' ? STORAGE_KEY_TOKEN : 'casinoToken'
    );
    if (!token) return;

    // Clear any previous interval
    if (window._sessionTimerInterval) {
        clearInterval(window._sessionTimerInterval);
        window._sessionTimerInterval = null;
    }

    function _doTick() {
        var tkn = localStorage.getItem(
            typeof STORAGE_KEY_TOKEN !== 'undefined' ? STORAGE_KEY_TOKEN : 'casinoToken'
        );
        if (!tkn) return;
        fetch('/api/session/status', {
            headers: { 'Authorization': 'Bearer ' + tkn }
        })
        .then(function(r) { return r.ok ? r.json() : null; })
        .then(function(data) {
            if (!data) return;
            var elapsed = data.elapsed || 0;
            var limit = data.limit || null;
            var remaining = data.remaining !== undefined ? data.remaining : null;
            updateSessionTimerDisplay(elapsed, limit, remaining);
        })
        .catch(function() { /* silent — network errors don't break the game */ });
    }

    // Fetch status first; start session if none active
    fetch('/api/session/status', {
        headers: { 'Authorization': 'Bearer ' + token }
    })
    .then(function(r) { return r.ok ? r.json() : null; })
    .then(function(data) {
        if (!data || !data.active) {
            // Start a new session
            return fetch('/api/session/start', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': 'Bearer ' + token
                }
            })
            .then(function(r) { return r.ok ? r.json() : null; })
            .then(function() {
                // Initial display — 0 minutes, no limit yet
                updateSessionTimerDisplay(0, null, null);
            })
            .catch(function() { /* silent */ });
        } else {
            // Session already active — render immediately
            var elapsed = data.elapsed || 0;
            var limit = data.limit || null;
            var remaining = data.remaining !== undefined ? data.remaining : null;
            updateSessionTimerDisplay(elapsed, limit, remaining);
        }
    })
    .catch(function() { /* silent */ })
    .finally(function() {
        // Tick every 60 seconds
        window._sessionTimerInterval = setInterval(_doTick, 60000);
    });
}

function settingsSetWagerLimit(val) {
    var amount = parseFloat(val);
    var isNone = isNaN(amount) || amount <= 0;
    var token = localStorage.getItem(
        typeof STORAGE_KEY_TOKEN !== 'undefined' ? STORAGE_KEY_TOKEN : 'casinoToken'
    );
    if (!token) return;
    fetch('/api/session/wager-limit', {
        method: 'PUT',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer ' + token
        },
        body: JSON.stringify({ limit: isNone ? null : amount })
    })
    .then(function(r) { return r.ok ? r.json() : r.json().then(function(d) { throw d; }); })
    .then(function(data) {
        if (typeof showToast === 'function') {
            if (isNone) {
                showToast('Daily wager limit removed', 'info');
            } else {
                showToast('Daily wager limit set to $' + amount, 'success');
            }
        }
        var statusEl = document.getElementById('settingWagerStatus');
        if (statusEl) statusEl.textContent = isNone ? 'No daily wager limit set.' : 'Limit active: $' + amount + '/day.';
    })
    .catch(function(err) {
        if (typeof showToast === 'function') {
            showToast(err.error || 'Could not save wager limit', 'error');
        }
    });
}

function settingsSetSessionLimit(val) {
    var minutes = parseInt(val, 10);
    var isNone = isNaN(minutes) || minutes <= 0;
    var token = localStorage.getItem(
        typeof STORAGE_KEY_TOKEN !== 'undefined' ? STORAGE_KEY_TOKEN : 'casinoToken'
    );
    if (!token) return;
    fetch('/api/session/set-limit', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer ' + token
        },
        body: JSON.stringify({ minutes: isNone ? null : minutes })
    })
    .then(function(r) { return r.ok ? r.json() : null; })
    .then(function(data) {
        if (!data) return;
        if (typeof showToast === 'function') {
            if (isNone) {
                showToast('Session time limit removed', 'info');
            } else {
                showToast('Session limit set to ' + minutes + ' minutes', 'success');
            }
        }
    })
    .catch(function() {
        if (typeof showToast === 'function') {
            showToast('Could not save session limit', 'error');
        }
    });
}
