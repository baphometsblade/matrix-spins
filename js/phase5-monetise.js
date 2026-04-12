// ═══════════════════════════════════════════════════════
// PHASE 5+6 — MONETISATION SYSTEM
// Daily Login Bonus, Win Streak, Low Balance, Session Stats, Leaderboard
// All balance displays in $ only — zero crypto/token language
// ═══════════════════════════════════════════════════════

(function() {
    'use strict';

    function _el(tag, className, text, style) {
        var el = document.createElement(tag);
        if (className) el.className = className;
        if (text) el.textContent = text;
        if (style) el.setAttribute('style', style);
        return el;
    }
    function _btn(className, text, onclick, style) {
        var b = _el('button', className, text, style);
        b.addEventListener('click', onclick);
        return b;
    }

    // ═══════════════════════════════════════════════════════
    // 1. DAILY LOGIN BONUS
    // Day 1: $5, Day 7: $50, Day 30: $500
    // ═══════════════════════════════════════════════════════
    var DAILY_REWARDS = {
        1: 5, 2: 5, 3: 10, 4: 10, 5: 15, 6: 20, 7: 50,
        8: 5, 9: 5, 10: 10, 11: 10, 12: 15, 13: 20, 14: 50,
        15: 10, 16: 10, 17: 15, 18: 15, 19: 20, 20: 25, 21: 75,
        22: 10, 23: 15, 24: 15, 25: 20, 26: 25, 27: 30, 28: 100,
        29: 50, 30: 500
    };

    function getDailyLoginState() {
        try {
            var data = JSON.parse(localStorage.getItem('royalslots_daily_login') || '{}');
            return data;
        } catch(e) { return {}; }
    }

    function saveDailyLoginState(state) {
        try { localStorage.setItem('royalslots_daily_login', JSON.stringify(state)); } catch(e) {}
    }

    function checkDailyLogin() {
        if (typeof currentUser === 'undefined' || !currentUser) return;
        var state = getDailyLoginState();
        var today = new Date().toISOString().slice(0, 10);

        if (state.lastClaim === today) return; // Already claimed today

        var yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
        var streak = (state.lastClaim === yesterday && state.streak) ? state.streak : 0;
        var day = Math.min(streak + 1, 30);
        var reward = DAILY_REWARDS[day] || 5;

        showDailyLoginModal(day, reward, streak + 1);
    }

    function showDailyLoginModal(day, reward, streak) {
        // Remove existing
        var old = document.getElementById('dailyLoginModal');
        if (old) old.parentNode.removeChild(old);

        var overlay = _el('div', 'p5-modal-overlay');
        overlay.id = 'dailyLoginModal';

        var modal = _el('div', 'p5-modal p5-daily-modal');
        var header = _el('div', 'p5-modal-header');
        header.appendChild(_el('div', 'p5-modal-icon', '\u{1F381}'));
        header.appendChild(_el('h3', 'p5-modal-title', 'Daily Login Bonus'));
        modal.appendChild(header);

        var body = _el('div', 'p5-modal-body');
        body.appendChild(_el('div', 'p5-daily-streak', 'Day ' + day + ' of 30'));
        body.appendChild(_el('div', 'p5-daily-reward', '$' + reward.toFixed(2)));
        body.appendChild(_el('p', 'p5-daily-desc', 'Welcome back! Claim your daily bonus. Log in every day for bigger rewards!'));

        // Preview grid (show 7 days)
        var grid = _el('div', 'p5-daily-grid');
        var startDay = Math.max(1, day - 3);
        for (var d = startDay; d < startDay + 7 && d <= 30; d++) {
            var cell = _el('div', 'p5-daily-cell' + (d === day ? ' p5-daily-cell-today' : '') + (d < day ? ' p5-daily-cell-claimed' : ''));
            cell.appendChild(_el('div', 'p5-daily-cell-day', 'Day ' + d));
            cell.appendChild(_el('div', 'p5-daily-cell-amt', '$' + (DAILY_REWARDS[d] || 5)));
            if (d < day) {
                cell.appendChild(_el('div', 'p5-daily-cell-check', '\u2713'));
            }
            grid.appendChild(cell);
        }
        body.appendChild(grid);

        if (day === 7) body.appendChild(_el('div', 'p5-daily-milestone', '\u{1F389} Week 1 Milestone!'));
        if (day === 30) body.appendChild(_el('div', 'p5-daily-milestone', '\u{1F3C6} Month Milestone!'));

        modal.appendChild(body);

        var footer = _el('div', 'p5-modal-footer');
        footer.appendChild(_btn('p5-btn p5-btn-primary', 'CLAIM $' + reward.toFixed(2), function() {
            claimDailyBonus(day, reward);
            overlay.parentNode.removeChild(overlay);
        }));
        modal.appendChild(footer);

        overlay.appendChild(modal);
        document.body.appendChild(overlay);

        // Close button (X) in header
        var closeBtn = _el('button', 'p5-modal-close');
        closeBtn.innerHTML = '&times;';
        closeBtn.setAttribute('aria-label', 'Close');
        closeBtn.style.cssText = 'position:absolute;top:10px;right:12px;background:none;border:none;color:#888;font-size:26px;cursor:pointer;padding:4px 10px;z-index:2;transition:color 0.15s;line-height:1';
        closeBtn.addEventListener('mouseenter', function() { this.style.color = '#fff'; });
        closeBtn.addEventListener('mouseleave', function() { this.style.color = '#888'; });
        closeBtn.addEventListener('click', function() {
            overlay.classList.remove('p5-modal-visible');
            setTimeout(function() { if (overlay.parentNode) overlay.parentNode.removeChild(overlay); }, 300);
        });
        modal.style.position = 'relative';
        modal.insertBefore(closeBtn, modal.firstChild);

        // Backdrop click to dismiss
        overlay.addEventListener('click', function(e) {
            if (e.target === overlay) {
                overlay.classList.remove('p5-modal-visible');
                setTimeout(function() { if (overlay.parentNode) overlay.parentNode.removeChild(overlay); }, 300);
            }
        });

        // Escape key to dismiss
        var escHandler = function(e) {
            if (e.key === 'Escape') {
                overlay.classList.remove('p5-modal-visible');
                setTimeout(function() { if (overlay.parentNode) overlay.parentNode.removeChild(overlay); }, 300);
                document.removeEventListener('keydown', escHandler);
            }
        };
        document.addEventListener('keydown', escHandler);

        // Global close function
        window.closeDailyBonusModal = function() {
            var m = document.getElementById('dailyLoginModal');
            if (m) {
                m.classList.remove('p5-modal-visible');
                setTimeout(function() { if (m.parentNode) m.parentNode.removeChild(m); }, 300);
            }
        };

        // Animate in
        requestAnimationFrame(function() { overlay.classList.add('p5-modal-visible'); });
    }

    function claimDailyBonus(day, reward) {
        var today = new Date().toISOString().slice(0, 10);
        saveDailyLoginState({ lastClaim: today, streak: day });

        // Credit via server API if available, otherwise localStorage
        if (typeof currentUser !== 'undefined' && currentUser) {
            fetch('/api/daily-login/claim', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': 'Bearer ' + (localStorage.getItem('casinoToken') || '')
                },
                body: JSON.stringify({ day: day })
            }).then(function(r) { return r.json(); }).then(function(data) {
                if (data.newBalance !== undefined && typeof balance !== 'undefined') {
                    balance = data.newBalance;
                    var balEl = document.getElementById('balance');
                    if (balEl) balEl.textContent = parseFloat(balance).toFixed(2);
                }
            }).catch(function() {
                // No fallback — server is authoritative for balance
                if (typeof showToast === 'function') showToast('Connection error. Please try again.', 'error');
            });
        }
        if (typeof showToast === 'function') showToast('Daily bonus claimed: $' + reward.toFixed(2) + '!', 'success');
    }


    // ═══════════════════════════════════════════════════════
    // 2. WIN STREAK REWARDS
    // 3 consecutive wins: $2 bonus, 5 wins: $10, 10 wins: $50
    // ═══════════════════════════════════════════════════════
    var WIN_STREAK_REWARDS = { 3: 2, 5: 10, 10: 50 };
    var _winStreak = parseInt(localStorage.getItem('royalslots_win_streak') || '0', 10);
    var _streakRewardsClaimed = {};
    try { _streakRewardsClaimed = JSON.parse(localStorage.getItem('royalslots_streak_claimed') || '{}'); } catch(e) {}

    window.phase5RecordWin = function() {
        _winStreak++;
        localStorage.setItem('royalslots_win_streak', String(_winStreak));
        var reward = WIN_STREAK_REWARDS[_winStreak];
        if (reward && !_streakRewardsClaimed[_winStreak]) {
            _streakRewardsClaimed[_winStreak] = true;
            localStorage.setItem('royalslots_streak_claimed', JSON.stringify(_streakRewardsClaimed));
            showWinStreakReward(_winStreak, reward);
        }
    };

    window.phase5RecordLoss = function() {
        _winStreak = 0;
        _streakRewardsClaimed = {};
        localStorage.setItem('royalslots_win_streak', '0');
        localStorage.setItem('royalslots_streak_claimed', '{}');
    };

    function showWinStreakReward(streak, reward) {
        var old = document.getElementById('winStreakModal');
        if (old) old.parentNode.removeChild(old);

        var overlay = _el('div', 'p5-modal-overlay');
        overlay.id = 'winStreakModal';

        var modal = _el('div', 'p5-modal p5-streak-modal');
        var header = _el('div', 'p5-modal-header');
        header.appendChild(_el('div', 'p5-modal-icon', '\u{1F525}'));
        header.appendChild(_el('h3', 'p5-modal-title', 'Win Streak Bonus!'));
        modal.appendChild(header);

        var body = _el('div', 'p5-modal-body');
        body.appendChild(_el('div', 'p5-streak-count', streak + ' Wins in a Row!'));
        body.appendChild(_el('div', 'p5-streak-reward', '$' + reward.toFixed(2)));
        body.appendChild(_el('p', 'p5-streak-desc', 'Amazing streak! Keep winning for even bigger rewards!'));

        // Show next milestone
        var nextMilestones = [3, 5, 10].filter(function(m) { return m > streak; });
        if (nextMilestones.length > 0) {
            var next = nextMilestones[0];
            body.appendChild(_el('div', 'p5-streak-next', 'Next reward at ' + next + ' wins: $' + WIN_STREAK_REWARDS[next].toFixed(2)));
        }
        modal.appendChild(body);

        var footer = _el('div', 'p5-modal-footer');
        footer.appendChild(_btn('p5-btn p5-btn-primary', 'COLLECT $' + reward.toFixed(2), function() {
            // Win streak bonus — server-side credit only (no client-side balance manipulation)
            var _wsToken = typeof localStorage !== 'undefined' ? localStorage.getItem('casinoAuthToken') : null;
            if (_wsToken && !_wsToken.startsWith('local_')) {
                fetch('/api/daily-login/claim', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + _wsToken }, body: JSON.stringify({ type: 'streak', streak: streak }) }).then(function(r) { return r.json(); }).then(function(d) { if (d.newBalance !== undefined) { balance = d.newBalance; if (typeof updateBalance === 'function') updateBalance(); } }).catch(function() {});
            }
            if (typeof showToast === 'function') showToast('Win streak bonus: $' + reward.toFixed(2) + '!', 'success');
            overlay.parentNode.removeChild(overlay);
        }));
        modal.appendChild(footer);
        overlay.appendChild(modal);
        document.body.appendChild(overlay);
        requestAnimationFrame(function() { overlay.classList.add('p5-modal-visible'); });
    }


    // ═══════════════════════════════════════════════════════
    // 3. LOW BALANCE PROMPT (< $5.00)
    // ═══════════════════════════════════════════════════════
    var _lowBalanceShown = false;

    window.phase5CheckLowBalance = function() {
        if (_lowBalanceShown) return;
        if (typeof balance === 'undefined' || balance >= 5) return;
        if (typeof currentUser === 'undefined' || !currentUser) return;
        _lowBalanceShown = true;

        var old = document.getElementById('lowBalancePrompt');
        if (old) old.parentNode.removeChild(old);

        var banner = _el('div', 'p5-low-balance');
        banner.id = 'lowBalancePrompt';
        banner.appendChild(_el('span', 'p5-lb-icon', '\u26A0\uFE0F'));
        banner.appendChild(_el('span', 'p5-lb-text', 'Your balance is low ($' + parseFloat(balance).toFixed(2) + '). Deposit to keep playing!'));
        banner.appendChild(_btn('p5-lb-btn', 'DEPOSIT NOW', function() {
            if (typeof showWalletModal === 'function') showWalletModal();
        }));
        banner.appendChild(_btn('p5-lb-dismiss', '\u2715', function() {
            banner.parentNode.removeChild(banner);
        }));

        var main = document.querySelector('.casino-main-wrap') || document.body;
        main.insertBefore(banner, main.firstChild);
    };

    // Check every 30 seconds
    setInterval(function() {
        if (typeof balance !== 'undefined' && balance < 5 && !_lowBalanceShown) {
            window.phase5CheckLowBalance();
        }
    }, 30000);


    // ═══════════════════════════════════════════════════════
    // 4. SESSION STATS OVERLAY
    // Time played, biggest win, total spins, net result
    // ═══════════════════════════════════════════════════════
    var _sessionStart = Date.now();
    var _sessionSpins = 0;
    var _sessionBiggestWin = 0;
    var _sessionTotalWon = 0;
    var _sessionTotalBet = 0;

    window.phase5RecordSpin = function(betAmount, winAmount) {
        _sessionSpins++;
        _sessionTotalBet += (betAmount || 0);
        _sessionTotalWon += (winAmount || 0);
        if (winAmount > _sessionBiggestWin) _sessionBiggestWin = winAmount;

        // Persist for leaderboard
        if (winAmount > 0) {
            addToLeaderboard(winAmount);
        }
    };

    window.phase5ShowSessionStats = function() {
        var old = document.getElementById('sessionStatsModal');
        if (old) old.parentNode.removeChild(old);

        var elapsed = Date.now() - _sessionStart;
        var mins = Math.floor(elapsed / 60000);
        var hrs = Math.floor(mins / 60);
        var timeStr = hrs > 0 ? hrs + 'h ' + (mins % 60) + 'm' : mins + 'm';
        var netResult = _sessionTotalWon - _sessionTotalBet;
        var netClass = netResult >= 0 ? 'p5-stat-positive' : 'p5-stat-negative';

        var overlay = _el('div', 'p5-modal-overlay');
        overlay.id = 'sessionStatsModal';

        var modal = _el('div', 'p5-modal p5-stats-modal');
        var header = _el('div', 'p5-modal-header');
        header.appendChild(_el('div', 'p5-modal-icon', '\u{1F4CA}'));
        header.appendChild(_el('h3', 'p5-modal-title', 'Session Stats'));
        header.appendChild(_btn('p5-modal-close', '\u2715', function() {
            overlay.parentNode.removeChild(overlay);
        }));
        modal.appendChild(header);

        var body = _el('div', 'p5-modal-body');

        var statsGrid = _el('div', 'p5-stats-grid');

        function addStat(label, value, extraClass) {
            var item = _el('div', 'p5-stat-item');
            item.appendChild(_el('div', 'p5-stat-label', label));
            item.appendChild(_el('div', 'p5-stat-value' + (extraClass ? ' ' + extraClass : ''), value));
            statsGrid.appendChild(item);
        }

        addStat('Time Played', timeStr);
        addStat('Total Spins', String(_sessionSpins));
        addStat('Biggest Win', '$' + _sessionBiggestWin.toFixed(2));
        addStat('Total Won', '$' + _sessionTotalWon.toFixed(2));
        addStat('Total Bet', '$' + _sessionTotalBet.toFixed(2));
        addStat('Net Result', (netResult >= 0 ? '+' : '') + '$' + netResult.toFixed(2), netClass);

        body.appendChild(statsGrid);

        // Responsible gambling reminder
        if (mins >= 30) {
            body.appendChild(_el('div', 'p5-stats-reminder', '\u23F0 You\'ve been playing for ' + timeStr + '. Consider taking a break.'));
        }

        modal.appendChild(body);

        var footer = _el('div', 'p5-modal-footer');
        footer.appendChild(_btn('p5-btn p5-btn-secondary', 'CLOSE', function() {
            overlay.parentNode.removeChild(overlay);
        }));
        modal.appendChild(footer);

        overlay.appendChild(modal);
        document.body.appendChild(overlay);
        requestAnimationFrame(function() { overlay.classList.add('p5-modal-visible'); });
    };


    // ═══════════════════════════════════════════════════════
    // 5. LEADERBOARD (localStorage now, REST API-ready)
    // Top 10 biggest wins
    // ═══════════════════════════════════════════════════════
    function getLeaderboard() {
        try { return JSON.parse(localStorage.getItem('royalslots_leaderboard') || '[]'); }
        catch(e) { return []; }
    }

    function saveLeaderboard(lb) {
        try { localStorage.setItem('royalslots_leaderboard', JSON.stringify(lb)); } catch(e) {}
    }

    function addToLeaderboard(winAmount) {
        var lb = getLeaderboard();
        var entry = {
            player: (typeof currentUser !== 'undefined' && currentUser && currentUser.username) ? currentUser.username : 'Anonymous',
            amount: winAmount,
            date: new Date().toISOString().slice(0, 10),
            game: (typeof currentGame !== 'undefined' && currentGame) ? (currentGame.name || currentGame.id) : 'Unknown'
        };
        lb.push(entry);
        lb.sort(function(a, b) { return b.amount - a.amount; });
        if (lb.length > 10) lb = lb.slice(0, 10);
        saveLeaderboard(lb);
    }

    window.phase5ShowLeaderboard = function() {
        var old = document.getElementById('leaderboardModal');
        if (old) old.parentNode.removeChild(old);

        var overlay = _el('div', 'p5-modal-overlay');
        overlay.id = 'leaderboardModal';

        var modal = _el('div', 'p5-modal p5-leaderboard-modal');
        var header = _el('div', 'p5-modal-header');
        header.appendChild(_el('div', 'p5-modal-icon', '\u{1F3C6}'));
        header.appendChild(_el('h3', 'p5-modal-title', 'Leaderboard — Top 10 Biggest Wins'));
        header.appendChild(_btn('p5-modal-close', '\u2715', function() {
            overlay.parentNode.removeChild(overlay);
        }));
        modal.appendChild(header);

        var body = _el('div', 'p5-modal-body');
        var lb = getLeaderboard();

        if (lb.length === 0) {
            body.appendChild(_el('p', 'p5-lb-empty', 'No wins recorded yet. Start spinning to claim a spot!'));
        } else {
            var table = _el('div', 'p5-lb-table');
            // Header row
            var hRow = _el('div', 'p5-lb-row p5-lb-header');
            hRow.appendChild(_el('span', 'p5-lb-rank', '#'));
            hRow.appendChild(_el('span', 'p5-lb-player', 'Player'));
            hRow.appendChild(_el('span', 'p5-lb-game', 'Game'));
            hRow.appendChild(_el('span', 'p5-lb-amount', 'Win'));
            table.appendChild(hRow);

            for (var i = 0; i < lb.length; i++) {
                var e = lb[i];
                var row = _el('div', 'p5-lb-row' + (i < 3 ? ' p5-lb-top3' : ''));
                var medals = ['\u{1F947}', '\u{1F948}', '\u{1F949}'];
                row.appendChild(_el('span', 'p5-lb-rank', i < 3 ? medals[i] : String(i + 1)));
                row.appendChild(_el('span', 'p5-lb-player', e.player));
                row.appendChild(_el('span', 'p5-lb-game', e.game));
                row.appendChild(_el('span', 'p5-lb-amount', '$' + parseFloat(e.amount).toFixed(2)));
                table.appendChild(row);
            }
            body.appendChild(table);
        }

        // REST API-ready hook
        var apiNote = _el('div', 'p5-lb-api-note', 'Leaderboard syncs with server when connected.');
        apiNote.setAttribute('style', 'font-size:10px;color:#475569;text-align:center;margin-top:12px;');
        body.appendChild(apiNote);

        modal.appendChild(body);

        var footer = _el('div', 'p5-modal-footer');
        footer.appendChild(_btn('p5-btn p5-btn-secondary', 'CLOSE', function() {
            overlay.parentNode.removeChild(overlay);
        }));
        modal.appendChild(footer);

        overlay.appendChild(modal);
        document.body.appendChild(overlay);
        requestAnimationFrame(function() { overlay.classList.add('p5-modal-visible'); });
    };

    // Try to sync leaderboard from server
    function syncLeaderboardFromServer() {
        var token = localStorage.getItem('casinoToken');
        if (!token) return;
        fetch('/api/leaderboard/top', {
            headers: { 'Authorization': 'Bearer ' + token }
        }).then(function(r) { return r.json(); }).then(function(data) {
            if (data && Array.isArray(data.leaderboard) && data.leaderboard.length > 0) {
                var serverLb = data.leaderboard.map(function(e) {
                    return { player: e.username || e.player || 'Player', amount: e.amount || e.win || 0, date: e.date || '', game: e.game || '' };
                });
                var localLb = getLeaderboard();
                var merged = serverLb.concat(localLb);
                merged.sort(function(a, b) { return b.amount - a.amount; });
                var unique = [];
                var seen = {};
                for (var i = 0; i < merged.length && unique.length < 10; i++) {
                    var key = merged[i].player + '_' + merged[i].amount + '_' + merged[i].date;
                    if (!seen[key]) { seen[key] = true; unique.push(merged[i]); }
                }
                saveLeaderboard(unique);
            }
        }).catch(function() { /* Server unavailable, use local */ });
    }


    // ═══════════════════════════════════════════════════════
    // 6. STRIPE-READY DEPOSIT FLOW
    // Shows $ amounts only � no technical implementation details exposed
    // ═══════════════════════════════════════════════════════
    var DEPOSIT_AMOUNTS = [10, 25, 50, 100, 250, 500];

    window.phase5ShowDeposit = function() {
        // Use existing wallet modal if available
        if (typeof showWalletModal === 'function') {
            showWalletModal();
            return;
        }
        // Fallback: simple deposit modal
        var old = document.getElementById('p5DepositModal');
        if (old) old.parentNode.removeChild(old);

        var overlay = _el('div', 'p5-modal-overlay');
        overlay.id = 'p5DepositModal';

        var modal = _el('div', 'p5-modal');
        var header = _el('div', 'p5-modal-header');
        header.appendChild(_el('div', 'p5-modal-icon', '\u{1F4B3}'));
        header.appendChild(_el('h3', 'p5-modal-title', 'Deposit Funds'));
        header.appendChild(_btn('p5-modal-close', '\u2715', function() {
            overlay.parentNode.removeChild(overlay);
        }));
        modal.appendChild(header);

        var body = _el('div', 'p5-modal-body');
        body.appendChild(_el('p', null, 'Select deposit amount:', 'color:#94a3b8;margin-bottom:12px'));

        var grid = _el('div', 'p5-deposit-grid');
        DEPOSIT_AMOUNTS.forEach(function(amt) {
            grid.appendChild(_btn('p5-deposit-amt-btn', '$' + amt, function() {
                processDeposit(amt);
                overlay.parentNode.removeChild(overlay);
            }));
        });
        body.appendChild(grid);

        // Custom amount
        var customWrap = _el('div', 'p5-deposit-custom');
        var customLabel = _el('label', null, 'Custom amount:');
        customWrap.appendChild(customLabel);
        var customInput = document.createElement('input');
        customInput.type = 'number';
        customInput.min = '5';
        customInput.max = '10000';
        customInput.placeholder = 'Enter amount';
        customInput.className = 'p5-input';
        customWrap.appendChild(customInput);
        customWrap.appendChild(_btn('p5-btn p5-btn-primary', 'DEPOSIT', function() {
            var amt = parseFloat(customInput.value);
            if (isNaN(amt) || amt < 5) {
                if (typeof showToast === 'function') showToast('Minimum deposit is $5.00', 'error');
                return;
            }
            processDeposit(amt);
            overlay.parentNode.removeChild(overlay);
        }));
        body.appendChild(customWrap);
        modal.appendChild(body);
        overlay.appendChild(modal);
        document.body.appendChild(overlay);
        requestAnimationFrame(function() { overlay.classList.add('p5-modal-visible'); });
    };

    function processDeposit(amount) {
        var token = localStorage.getItem('casinoToken');
        if (token) {
            // Stripe-ready: POST to server which handles Stripe checkout + silent token minting
            fetch('/api/stripe-checkout/create-session', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
                body: JSON.stringify({ amount: amount })
            }).then(function(r) { return r.json(); }).then(function(data) {
                if (data.url) {
                    window.location.href = data.url; // Redirect to Stripe
                } else if (data.success) {
                    // Use server-returned balance (authoritative), not client-side addition
                    if (data.newBalance !== undefined && typeof balance !== 'undefined') {
                        balance = data.newBalance;
                        if (typeof updateBalance === 'function') updateBalance();
                    }
                    if (typeof showToast === 'function') showToast('Deposit successful: $' + amount.toFixed(2), 'success');
                } else {
                    if (typeof showToast === 'function') showToast(data.error || 'Deposit failed', 'error');
                }
            }).catch(function() {
                if (typeof showToast === 'function') showToast('Connection error. Please try again.', 'error');
            });
        } else {
            // Production: No demo deposits. Must be authenticated.
            if (typeof showToast === 'function') showToast('Please register or log in to make a deposit.', 'error');
        }
    }


    // ═══════════════════════════════════════════════════════
    // 7. STRIPE-READY WITHDRAWAL FLOW
    // $ amounts, silent token burning, reference number
    // ═══════════════════════════════════════════════════════
    window.phase5ShowWithdraw = function() {
        if (typeof showWalletWithdraw === 'function') {
            showWalletWithdraw();
            return;
        }
        var old = document.getElementById('p5WithdrawModal');
        if (old) old.parentNode.removeChild(old);

        var overlay = _el('div', 'p5-modal-overlay');
        overlay.id = 'p5WithdrawModal';

        var modal = _el('div', 'p5-modal');
        var header = _el('div', 'p5-modal-header');
        header.appendChild(_el('div', 'p5-modal-icon', '\u{1F4B0}'));
        header.appendChild(_el('h3', 'p5-modal-title', 'Withdraw Funds'));
        header.appendChild(_btn('p5-modal-close', '\u2715', function() {
            overlay.parentNode.removeChild(overlay);
        }));
        modal.appendChild(header);

        var body = _el('div', 'p5-modal-body');
        var currentBal = (typeof balance !== 'undefined') ? parseFloat(balance).toFixed(2) : '0.00';
        body.appendChild(_el('div', 'p5-withdraw-balance', 'Available Balance: $' + currentBal));

        var amtWrap = _el('div', 'p5-withdraw-input-wrap');
        var amtInput = document.createElement('input');
        amtInput.type = 'number';
        amtInput.min = '10';
        amtInput.max = currentBal;
        amtInput.placeholder = 'Enter withdrawal amount';
        amtInput.className = 'p5-input';
        amtWrap.appendChild(amtInput);
        body.appendChild(amtWrap);

        body.appendChild(_el('p', 'p5-withdraw-note', 'Minimum withdrawal: $10.00. Processed within 24 hours.'));

        modal.appendChild(body);

        var footer = _el('div', 'p5-modal-footer');
        footer.appendChild(_btn('p5-btn p5-btn-primary', 'REQUEST WITHDRAWAL', function() {
            var amt = parseFloat(amtInput.value);
            if (isNaN(amt) || amt < 10) {
                if (typeof showToast === 'function') showToast('Minimum withdrawal is $10.00', 'error');
                return;
            }
            if (amt > parseFloat(currentBal)) {
                if (typeof showToast === 'function') showToast('Insufficient balance', 'error');
                return;
            }
            processWithdrawal(amt);
            overlay.parentNode.removeChild(overlay);
        }));
        footer.appendChild(_btn('p5-btn p5-btn-secondary', 'CANCEL', function() {
            overlay.parentNode.removeChild(overlay);
        }));
        modal.appendChild(footer);

        overlay.appendChild(modal);
        document.body.appendChild(overlay);
        requestAnimationFrame(function() { overlay.classList.add('p5-modal-visible'); });
    };

    function processWithdrawal(amount) {
        var token = localStorage.getItem('casinoToken');
        // Generate reference number
        var ref = 'WD-' + Date.now().toString(36).toUpperCase() + '-' + Math.floor(Math.random() * 9000 + 1000);

        if (token) {
            fetch('/api/payment/withdraw', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
                body: JSON.stringify({ amount: amount })
            }).then(function(r) { return r.json(); }).then(function(data) {
                if (data.success || data.referenceNumber) {
                    var serverRef = data.referenceNumber || ref;
                    if (typeof balance !== 'undefined') {
                        balance -= amount;
                        var balEl = document.getElementById('balance');
                        if (balEl) balEl.textContent = parseFloat(balance).toFixed(2);
                    }
                    if (typeof showToast === 'function') showToast('Withdrawal requested: $' + amount.toFixed(2) + ' (Ref: ' + serverRef + ')', 'success');
                } else {
                    if (typeof showToast === 'function') showToast(data.error || 'Withdrawal failed', 'error');
                }
            }).catch(function() {
                if (typeof showToast === 'function') showToast('Connection error. Please try again.', 'error');
            });
        } else {
            // Production: No demo withdrawals. Must be authenticated.
            if (typeof showToast === 'function') showToast('Please register or log in to request a withdrawal.', 'error');
        }
    }


    // ═══════════════════════════════════════════════════════
    // INIT
    // ═══════════════════════════════════════════════════════
    function initPhase5Monetise() {
        // Daily login check (slight delay to let auth restore)
        setTimeout(checkDailyLogin, 2000);
        // Sync leaderboard
        syncLeaderboardFromServer();
        // Low balance check
        setTimeout(function() { window.phase5CheckLowBalance(); }, 5000);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', function() { setTimeout(initPhase5Monetise, 500); });
    } else {
        setTimeout(initPhase5Monetise, 500);
    }

})();
