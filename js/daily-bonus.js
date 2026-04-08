// ═══════════════════════════════════════════════════════════════════
// DAILY LOGIN BONUS & WIN STREAK REWARDS
// Spec §11 — Monetisation & Retention
// ═══════════════════════════════════════════════════════════════════

(function() {
    'use strict';

    var PREFIX = 'royalslots_';

    // ── Daily Login Bonus Schedule ───────────────────────────────────
    // Day → bonus in cents
    var DAILY_BONUSES = {
        1: 200,   // $2.00
        2: 200,   // $2.00
        3: 300,   // $3.00
        4: 300,   // $3.00
        5: 500,   // $5.00
        6: 500,   // $5.00
        7: 1000,  // $10.00
        8: 500,
        9: 500,
        10: 500,
        11: 500,
        12: 500,
        13: 500,
        14: 2000, // $20.00
        15: 500,
        16: 500,
        17: 500,
        18: 500,
        19: 500,
        20: 500,
        21: 1000,
        22: 500,
        23: 500,
        24: 500,
        25: 500,
        26: 500,
        27: 500,
        28: 1500,
        29: 1500,
        30: 5000  // $50.00
    };

    // ── Win Streak Multipliers ───────────────────────────────────────
    var STREAK_REWARDS = {
        3:  { bonus: 0.10, label: '+10% Bonus!' },
        5:  { bonus: 0.25, label: '+25% Bonus!' },
        10: { bonus: 0.50, label: '+50% Bonus! 🔥 Hot Streak!' }
    };

    // ── localStorage helpers ─────────────────────────────────────────
    function getItem(key) {
        try { return localStorage.getItem(PREFIX + key); } catch(e) { return null; }
    }
    function setItem(key, val) {
        try { localStorage.setItem(PREFIX + key, val); } catch(e) {}
    }

    function todayStr() {
        return new Date().toISOString().split('T')[0]; // YYYY-MM-DD
    }

    // ── Daily Bonus Logic ────────────────────────────────────────────
    function getDailyState() {
        var raw = getItem('daily_bonus');
        if (!raw) return { streak: 0, lastClaim: null, totalClaimed: 0 };
        try { return JSON.parse(raw); } catch(e) { return { streak: 0, lastClaim: null, totalClaimed: 0 }; }
    }

    function saveDailyState(state) {
        setItem('daily_bonus', JSON.stringify(state));
    }

    function checkDailyBonus() {
        var state = getDailyState();
        var today = todayStr();

        // Already claimed today
        if (state.lastClaim === today) return null;

        // Check if streak continues (claimed yesterday) or resets
        var yesterday = new Date();
        yesterday.setDate(yesterday.getDate() - 1);
        var yStr = yesterday.toISOString().split('T')[0];

        var newStreak;
        if (state.lastClaim === yStr) {
            newStreak = state.streak + 1;
        } else {
            newStreak = 1; // Reset
        }

        // Cap at 30
        var day = Math.min(newStreak, 30);
        var bonusCents = DAILY_BONUSES[day] || 200;

        return {
            day: day,
            streak: newStreak,
            bonusCents: bonusCents,
            bonusAUD: (bonusCents / 100).toFixed(2)
        };
    }

    function claimDailyBonus() {
        var bonus = checkDailyBonus();
        if (!bonus) return null;

        var state = getDailyState();
        state.streak = bonus.streak;
        state.lastClaim = todayStr();
        state.totalClaimed = (state.totalClaimed || 0) + bonus.bonusCents;
        saveDailyState(state);

        return bonus;
    }

    // ── Show Daily Bonus Modal ───────────────────────────────────────
    function showDailyBonusModal() {
        var bonus = checkDailyBonus();
        if (!bonus) return;

        var existing = document.getElementById('dailyBonusModal');
        if (existing) existing.remove();

        var modal = document.createElement('div');
        modal.id = 'dailyBonusModal';
        modal.style.cssText = 'position:fixed;inset:0;z-index:1050;background:rgba(0,0,0,0.85);display:flex;align-items:center;justify-content:center;animation:fadeIn 0.3s ease';

        // Build streak day indicators
        var daysHtml = '';
        for (var d = 1; d <= 7; d++) {
            var claimed = d < bonus.day || (d === bonus.day);
            var isToday = d === ((bonus.day - 1) % 7) + 1;
            var dayBonus = DAILY_BONUSES[d] || 200;
            daysHtml += '<div class="db-day' + (claimed ? ' db-day-claimed' : '') + (isToday ? ' db-day-today' : '') + '">' +
                '<div class="db-day-num">Day ' + d + '</div>' +
                '<div class="db-day-amount">$' + (dayBonus / 100).toFixed(2) + '</div>' +
                (claimed ? '<div class="db-day-check">✓</div>' : '') +
                '</div>';
        }

        modal.innerHTML = '<div class="db-card" style="position:relative">' +
            '<button class="db-close-btn" id="dbCloseBtn" style="position:absolute;top:12px;right:12px;background:none;border:none;color:#888;font-size:24px;cursor:pointer;padding:4px 8px;z-index:2;transition:color 0.15s" aria-label="Close">&times;</button>' +
            '<div class="db-header">' +
            '<div class="db-icon">🎁</div>' +
            '<h2 class="db-title">Daily Bonus!</h2>' +
            '<p class="db-subtitle">Day ' + bonus.day + ' streak — Keep it going!</p>' +
            '</div>' +
            '<div class="db-amount-wrap">' +
            '<span class="db-amount">+$' + bonus.bonusAUD + '</span>' +
            '</div>' +
            '<div class="db-days">' + daysHtml + '</div>' +
            (bonus.day >= 7 ? '<div class="db-milestone">🎉 Weekly milestone reached!</div>' : '') +
            (bonus.day >= 30 ? '<div class="db-milestone db-milestone-mega">🏆 30-Day Grand Bonus: $50.00!</div>' : '') +
            '<button class="db-claim-btn" id="dbClaimBtn">Claim $' + bonus.bonusAUD + '</button>' +
            '</div>';

        document.body.appendChild(modal);

        document.getElementById('dbClaimBtn').addEventListener('click', function() {
            var claimed = claimDailyBonus();
            if (claimed) {
                // Credit demo balance
                var bal = parseInt(getItem('demo_balance') || '100000', 10);
                bal += claimed.bonusCents;
                setItem('demo_balance', String(bal));

                this.textContent = '✓ Claimed!';
                this.disabled = true;
                this.style.background = '#4CAF50';

                // Notify balance display
                if (window.updateBalanceDisplay) window.updateBalanceDisplay();

                setTimeout(function() { modal.remove(); }, 1200);
            }
        });

        // Close button
        document.getElementById('dbCloseBtn').addEventListener('click', function() { modal.remove(); });
        // Escape key
        var escHandler = function(e) { if (e.key === 'Escape') { modal.remove(); document.removeEventListener('keydown', escHandler); } };
        document.addEventListener('keydown', escHandler);

        // Close on backdrop click
        modal.addEventListener('click', function(e) {
            if (e.target === modal) modal.remove();
        });
    }

    // ── Win Streak Tracking ──────────────────────────────────────────
    function getWinStreak() {
        return parseInt(getItem('win_streak') || '0', 10);
    }

    function onSpinResult(isWin) {
        var streak;
        if (isWin) {
            streak = getWinStreak() + 1;
            setItem('win_streak', String(streak));

            // Check for streak reward
            var reward = STREAK_REWARDS[streak];
            if (reward) {
                showStreakNotification(streak, reward);
            }
            return { streak: streak, reward: reward || null };
        } else {
            setItem('win_streak', '0');
            return { streak: 0, reward: null };
        }
    }

    function showStreakNotification(streak, reward) {
        var existing = document.getElementById('streakNotify');
        if (existing) existing.remove();

        var notif = document.createElement('div');
        notif.id = 'streakNotify';
        notif.style.cssText = 'position:fixed;top:20px;right:20px;z-index:1049;' +
            'background:linear-gradient(135deg, #ffd700, #ff8c00);color:#000;' +
            'padding:16px 24px;border-radius:12px;font-weight:700;font-size:14px;' +
            'box-shadow:0 4px 20px rgba(255,215,0,0.4);' +
            'animation:slideInRight 0.3s ease;max-width:300px;';
        notif.innerHTML = '<div style="font-size:20px;margin-bottom:4px">🔥 ' + streak + '-Win Streak!</div>' +
            '<div>' + reward.label + '</div>';

        document.body.appendChild(notif);
        setTimeout(function() {
            notif.style.transition = 'opacity 0.5s, transform 0.5s';
            notif.style.opacity = '0';
            notif.style.transform = 'translateX(100px)';
            setTimeout(function() { notif.remove(); }, 500);
        }, 3000);
    }

    // ── Low Balance Prompt ───────────────────────────────────────────
    function checkLowBalance(balanceCents) {
        if (balanceCents >= 500) {
            var existing = document.getElementById('lowBalBanner');
            if (existing) existing.remove();
            return;
        }

        if (document.getElementById('lowBalBanner')) return;

        var banner = document.createElement('div');
        banner.id = 'lowBalBanner';
        banner.style.cssText = 'position:fixed;bottom:60px;left:50%;transform:translateX(-50%);z-index:9998;' +
            'background:linear-gradient(135deg, #1a1a2e, #16213e);' +
            'border:1px solid rgba(0,255,65,0.2);border-radius:12px;' +
            'padding:12px 24px;display:flex;align-items:center;gap:12px;' +
            'box-shadow:0 4px 20px rgba(0,0,0,0.4);max-width:400px;';
        banner.innerHTML = '<span style="font-size:13px;color:#a0a0a0">Running low?</span>' +
            '<button onclick="if(typeof showCashier===\'function\')showCashier(\'deposit\');this.parentNode.remove()" ' +
            'style="background:#00ff41;color:#000;border:none;padding:8px 16px;border-radius:8px;font-weight:700;font-size:12px;cursor:pointer">Top Up</button>' +
            '<button onclick="this.parentNode.remove()" style="background:none;border:none;color:#666;cursor:pointer;font-size:16px">✕</button>';

        document.body.appendChild(banner);
    }

    // ── Initialize ───────────────────────────────────────────────────
    function init() {
        // If age gate is currently visible, wait until it's dismissed before
        // showing the daily bonus (prevents popup stacking on first visit).
        var ageOverlay = document.getElementById('ageVerifyOverlay');
        var ageGateOpen = ageOverlay && ageOverlay.style.display !== 'none' && ageOverlay.style.display !== '';

        if (ageGateOpen) {
            // Listen for the custom event fired by _confirmAge()
            window.addEventListener('ageGateDismissed', function _onAgeGateDone() {
                window.removeEventListener('ageGateDismissed', _onAgeGateDone);
                setTimeout(function() {
                    if (checkDailyBonus()) {
                        showDailyBonusModal();
                    }
                }, 3000); // 3-second delay after age gate dismissed
            });
        } else {
            // Age already verified — show after a brief page-load delay
            setTimeout(function() {
                if (checkDailyBonus()) {
                    showDailyBonusModal();
                }
            }, 1500);
        }
    }

    // ── Inject CSS ───────────────────────────────────────────────────
    var style = document.createElement('style');
    style.textContent = [
        '.db-card{background:#1a1a2e;border:2px solid #ffd700;border-radius:20px;padding:32px;max-width:420px;width:90%;text-align:center}',
        '.db-header{margin-bottom:16px}',
        '.db-icon{font-size:48px;margin-bottom:8px}',
        '.db-title{color:#ffd700;font-size:24px;margin:0 0 4px}',
        '.db-subtitle{color:#aaa;font-size:13px;margin:0}',
        '.db-amount-wrap{margin:16px 0}',
        '.db-amount{font-size:40px;font-weight:900;color:#00ff41;text-shadow:0 0 20px rgba(0,255,65,0.4)}',
        '.db-days{display:flex;gap:6px;justify-content:center;margin:16px 0;flex-wrap:wrap}',
        '.db-day{background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.1);border-radius:8px;padding:8px 6px;min-width:48px;text-align:center}',
        '.db-day-num{font-size:9px;color:#888;text-transform:uppercase}',
        '.db-day-amount{font-size:12px;color:#ddd;font-weight:700;margin-top:2px}',
        '.db-day-check{color:#00ff41;font-size:14px;margin-top:2px}',
        '.db-day-claimed{border-color:#00ff41;background:rgba(0,255,65,0.08)}',
        '.db-day-today{border-color:#ffd700;background:rgba(255,215,0,0.1);box-shadow:0 0 10px rgba(255,215,0,0.2)}',
        '.db-milestone{color:#ffd700;font-size:13px;margin:8px 0}',
        '.db-milestone-mega{font-size:16px;color:#ff8c00}',
        '.db-claim-btn{background:linear-gradient(135deg,#ffd700,#ff8c00);color:#000;border:none;padding:14px 32px;border-radius:10px;font-size:16px;font-weight:800;cursor:pointer;width:100%;margin-top:16px;text-transform:uppercase;letter-spacing:1px;transition:transform 0.15s}',
        '.db-claim-btn:hover{transform:translateY(-2px)}',
        '@keyframes slideInRight{from{opacity:0;transform:translateX(100px)}to{opacity:1;transform:translateX(0)}}',
        '@keyframes fadeIn{from{opacity:0}to{opacity:1}}'
    ].join('\n');
    document.head.appendChild(style);

    // ── Global close function (referenced by HTML modal)
    window.closeDailyBonusModal = function() {
        var m = document.getElementById('dailyBonusModal');
        if (m) m.remove();
        var m2 = document.getElementById('dailyLoginModal');
        if (m2) { m2.style.display = 'none'; m2.classList.remove('p5-modal-visible'); }
    };

    // ── Expose API ───────────────────────────────────────────────────
    window.DailyBonus = {
        check: checkDailyBonus,
        claim: claimDailyBonus,
        show: showDailyBonusModal,
        onSpinResult: onSpinResult,
        getWinStreak: getWinStreak,
        checkLowBalance: checkLowBalance,
        DAILY_BONUSES: DAILY_BONUSES,
        STREAK_REWARDS: STREAK_REWARDS
    };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

})();
