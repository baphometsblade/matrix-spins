'use strict';

/**
 * responsible-gambling.js — Client-side responsible gambling enforcement
 * Spec §12: Session timer, 60-min reminder, reality check (every 100 spins),
 * deposit/loss/wager limit enforcement, cool-off lockout, self-exclusion check.
 *
 * This file must be loaded AFTER ui-slot.js but BEFORE gameplay begins.
 * Exports: window.RG { onSpinComplete, checkDepositAllowed, checkExclusionGate, ... }
 */

(function() {
    var RG_KEY = 'royalslots_rg_';

    function rgGet(key, fallback) {
        try { var v = localStorage.getItem(RG_KEY + key); return v !== null ? JSON.parse(v) : fallback; }
        catch(e) { return fallback; }
    }
    function rgSet(key, val) {
        try { localStorage.setItem(RG_KEY + key, JSON.stringify(val)); } catch(e) {}
    }

    /* ────────────────────────────────────────────────────
       1. Self-Exclusion / Cool-Off Gate
       ──────────────────────────────────────────────────── */
    function checkExclusionGate() {
        var ex = rgGet('self_exclusion', null);
        if (ex && (ex.days === -1 || ex.until > Date.now())) {
            showExclusionOverlay(ex);
            return true;
        }
        var co = rgGet('cooloff', null);
        if (co && co.until > Date.now()) {
            showCooloffOverlay(co);
            return true;
        }
        return false;
    }

    function showExclusionOverlay(ex) {
        var msg = ex.days === -1
            ? 'Your account has been permanently self-excluded.'
            : 'You are self-excluded until ' + new Date(ex.until).toLocaleDateString() + '.';
        _showBlockOverlay('Self-Exclusion Active', msg, true);
    }

    function showCooloffOverlay(co) {
        var remaining = Math.ceil((co.until - Date.now()) / 3600000);
        var msg = 'Cool-off period active. You can resume play in approximately ' + remaining + ' hour' + (remaining !== 1 ? 's' : '') + '.';
        _showBlockOverlay('Cool-Off Period', msg, false);
    }

    function _showBlockOverlay(title, message, isPermanent) {
        var existing = document.getElementById('rg-block-overlay');
        if (existing) existing.remove();

        var ov = document.createElement('div');
        ov.id = 'rg-block-overlay';
        ov.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.95);z-index:999999;display:flex;align-items:center;justify-content:center;';
        ov.innerHTML =
            '<div style="background:#0f1f0f;border:1px solid #ff444444;border-radius:16px;padding:40px;max-width:480px;width:90%;text-align:center;">' +
            '<div style="font-size:48px;margin-bottom:16px;">' + (isPermanent ? '\uD83D\uDEAB' : '\u2744\uFE0F') + '</div>' +
            '<h2 style="color:#ff4444;font-size:22px;margin-bottom:12px;">' + title + '</h2>' +
            '<p style="color:#ccc;font-size:15px;line-height:1.6;margin-bottom:24px;">' + message + '</p>' +
            '<p style="color:#888;font-size:13px;margin-bottom:20px;">You can still access your account to withdraw funds.</p>' +
            '<a href="/responsible-gambling.html" style="display:inline-block;background:#00ff41;color:#000;padding:10px 24px;border-radius:8px;font-weight:600;text-decoration:none;">Responsible Gambling Settings</a>' +
            '</div>';
        document.body.appendChild(ov);

        // Disable all game UI
        document.querySelectorAll('.spin-btn, .bet-btn, [data-action="spin"]').forEach(function(btn) {
            btn.disabled = true;
            btn.style.pointerEvents = 'none';
            btn.style.opacity = '0.3';
        });
    }

    /* ────────────────────────────────────────────────────
       2. Session Timer + Periodic Reminder
       ──────────────────────────────────────────────────── */
    var sessionStart = rgGet('session_start', null);
    if (!sessionStart) {
        sessionStart = Date.now();
        rgSet('session_start', sessionStart);
    }
    var reminderInterval = rgGet('reminder_interval', 60); // minutes
    var lastReminderTime = Date.now();

    // Persistent mini-timer in corner
    var timerWidget = document.createElement('div');
    timerWidget.id = 'rg-session-timer';
    timerWidget.style.cssText = 'position:fixed;bottom:12px;left:12px;background:rgba(0,20,0,0.9);border:1px solid #00ff4133;border-radius:8px;padding:6px 12px;z-index:9000;font-size:12px;color:#00ff41;font-family:monospace;cursor:pointer;opacity:0.7;transition:opacity 0.2s;';
    timerWidget.title = 'Session timer \u2014 click for responsible gambling settings';
    timerWidget.onclick = function() { window.open('/responsible-gambling.html', '_blank'); };
    timerWidget.onmouseenter = function() { this.style.opacity = '1'; };
    timerWidget.onmouseleave = function() { this.style.opacity = '0.7'; };
    document.body.appendChild(timerWidget);

    function updateTimer() {
        var elapsed = Date.now() - sessionStart;
        var h = Math.floor(elapsed / 3600000);
        var m = Math.floor((elapsed % 3600000) / 60000);
        var s = Math.floor((elapsed % 60000) / 1000);
        timerWidget.textContent = '\u23F1 ' +
            String(h).padStart(2,'0') + ':' + String(m).padStart(2,'0') + ':' + String(s).padStart(2,'0');

        // Check reminder
        var sinceReminder = Date.now() - lastReminderTime;
        if (sinceReminder >= reminderInterval * 60000) {
            lastReminderTime = Date.now();
            showSessionReminder(h, m);
        }
    }

    function showSessionReminder(hours, mins) {
        var existing = document.getElementById('rg-session-reminder');
        if (existing) existing.remove();
        var existingBd = document.getElementById('rg-reminder-backdrop');
        if (existingBd) existingBd.remove();

        var popup = document.createElement('div');
        popup.id = 'rg-session-reminder';
        popup.style.cssText = 'position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);background:#0f1f0f;border:2px solid #ffaa00;border-radius:16px;padding:32px;max-width:400px;width:90%;text-align:center;z-index:99999;box-shadow:0 0 60px rgba(0,0,0,0.8);';
        popup.innerHTML =
            '<div style="font-size:36px;margin-bottom:12px;">\u23F1</div>' +
            '<h3 style="color:#ffaa00;font-size:18px;margin-bottom:8px;">Session Reminder</h3>' +
            '<p style="color:#ccc;font-size:14px;margin-bottom:20px;">You have been playing for <strong style="color:#fff;">' + hours + 'h ' + mins + 'm</strong>. Remember to take regular breaks and play responsibly.</p>' +
            '<div style="display:flex;gap:10px;justify-content:center;">' +
            '<button onclick="document.getElementById(\'rg-session-reminder\').remove();document.getElementById(\'rg-reminder-backdrop\').remove();" style="background:#00ff41;color:#000;border:none;padding:10px 20px;border-radius:8px;font-weight:600;cursor:pointer;font-size:14px;">Continue Playing</button>' +
            '<button onclick="window.location.href=\'/responsible-gambling.html\';" style="background:rgba(255,255,255,0.1);color:#ccc;border:1px solid #333;padding:10px 20px;border-radius:8px;font-weight:600;cursor:pointer;font-size:14px;">Take a Break</button>' +
            '</div>';

        var backdrop = document.createElement('div');
        backdrop.id = 'rg-reminder-backdrop';
        backdrop.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.6);z-index:99998;';
        backdrop.onclick = function() { popup.remove(); backdrop.remove(); };

        document.body.appendChild(backdrop);
        document.body.appendChild(popup);
    }

    setInterval(updateTimer, 1000);
    updateTimer();

    /* ────────────────────────────────────────────────────
       3. Reality Check (every N spins)
       ──────────────────────────────────────────────────── */
    var realityFreq = rgGet('reality_freq', 100);
    var sessionSpins = 0;
    var sessionNetResult = 0;

    function onSpinComplete(betAmount, winAmount) {
        sessionSpins++;
        sessionNetResult += (winAmount - betAmount);

        // Persist for the RG settings page
        try {
            localStorage.setItem('ms_session_spins', String(sessionSpins));
            localStorage.setItem('ms_session_net', String(sessionNetResult.toFixed(2)));
        } catch(e) {}

        // Check limits
        checkWagerLimit(betAmount);
        checkLossLimit(betAmount - winAmount);

        // Reality check
        if (sessionSpins > 0 && sessionSpins % realityFreq === 0) {
            showRealityCheck();
        }
    }

    function showRealityCheck() {
        var existing = document.getElementById('rg-reality-check');
        if (existing) existing.remove();
        var existingBd = document.getElementById('rg-rc-backdrop');
        if (existingBd) existingBd.remove();

        var elapsed = Date.now() - sessionStart;
        var h = Math.floor(elapsed / 3600000);
        var m = Math.floor((elapsed % 3600000) / 60000);

        var netStr = (sessionNetResult >= 0 ? '+' : '-') + '$' + Math.abs(sessionNetResult).toFixed(2);
        var netColor = sessionNetResult >= 0 ? '#00ff41' : '#ff4444';

        var popup = document.createElement('div');
        popup.id = 'rg-reality-check';
        popup.style.cssText = 'position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);background:#0f1f0f;border:2px solid #00bcd4;border-radius:16px;padding:32px;max-width:440px;width:90%;text-align:center;z-index:99999;box-shadow:0 0 60px rgba(0,0,0,0.8);';
        popup.innerHTML =
            '<div style="font-size:36px;margin-bottom:12px;">\uD83D\uDCA1</div>' +
            '<h3 style="color:#00bcd4;font-size:18px;margin-bottom:16px;">Reality Check</h3>' +
            '<div style="display:flex;gap:16px;justify-content:center;margin-bottom:20px;flex-wrap:wrap;">' +
            '<div style="background:rgba(0,0,0,0.3);border:1px solid #333;border-radius:10px;padding:12px 16px;min-width:100px;">' +
            '<div style="font-size:11px;color:#888;">Time Played</div>' +
            '<div style="font-size:18px;font-weight:700;color:#fff;">' + h + 'h ' + m + 'm</div></div>' +
            '<div style="background:rgba(0,0,0,0.3);border:1px solid #333;border-radius:10px;padding:12px 16px;min-width:100px;">' +
            '<div style="font-size:11px;color:#888;">Spins</div>' +
            '<div style="font-size:18px;font-weight:700;color:#fff;">' + sessionSpins + '</div></div>' +
            '<div style="background:rgba(0,0,0,0.3);border:1px solid #333;border-radius:10px;padding:12px 16px;min-width:100px;">' +
            '<div style="font-size:11px;color:#888;">Net Result</div>' +
            '<div style="font-size:18px;font-weight:700;color:' + netColor + ';">' + netStr + '</div></div>' +
            '</div>' +
            '<p style="color:#888;font-size:13px;margin-bottom:20px;">This is an automated check to help you stay in control of your play.</p>' +
            '<div style="display:flex;gap:10px;justify-content:center;">' +
            '<button onclick="document.getElementById(\'rg-reality-check\').remove();document.getElementById(\'rg-rc-backdrop\').remove();" style="background:#00bcd4;color:#000;border:none;padding:10px 20px;border-radius:8px;font-weight:600;cursor:pointer;font-size:14px;">Continue Playing</button>' +
            '<button onclick="window.location.href=\'/responsible-gambling.html\';" style="background:rgba(255,255,255,0.1);color:#ccc;border:1px solid #333;padding:10px 20px;border-radius:8px;font-weight:600;cursor:pointer;font-size:14px;">View Limits</button>' +
            '</div>';

        var backdrop = document.createElement('div');
        backdrop.id = 'rg-rc-backdrop';
        backdrop.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.6);z-index:99998;';

        document.body.appendChild(backdrop);
        document.body.appendChild(popup);
    }

    /* ────────────────────────────────────────────────────
       4. Wager / Loss Limit Enforcement
       ──────────────────────────────────────────────────── */
    var dailyWagerTotal = rgGet('daily_wager_total', { date: new Date().toDateString(), amount: 0 });
    var dailyLossTotal = rgGet('daily_loss_total', { date: new Date().toDateString(), amount: 0 });

    if (dailyWagerTotal.date !== new Date().toDateString()) {
        dailyWagerTotal = { date: new Date().toDateString(), amount: 0 };
        rgSet('daily_wager_total', dailyWagerTotal);
    }
    if (dailyLossTotal.date !== new Date().toDateString()) {
        dailyLossTotal = { date: new Date().toDateString(), amount: 0 };
        rgSet('daily_loss_total', dailyLossTotal);
    }

    function checkWagerLimit(betAmount) {
        var limits = rgGet('wager_limits', {});
        if (!limits.daily) return;
        dailyWagerTotal.amount += betAmount;
        rgSet('daily_wager_total', dailyWagerTotal);
        if (dailyWagerTotal.amount >= limits.daily) {
            _showBlockOverlay('Wager Limit Reached', 'You have reached your daily wager limit of $' + limits.daily + '. You cannot place further bets until tomorrow.', false);
        }
    }

    function checkLossLimit(lossAmount) {
        if (lossAmount <= 0) return;
        var limits = rgGet('loss_limits', {});
        if (!limits.daily) return;
        dailyLossTotal.amount += lossAmount;
        rgSet('daily_loss_total', dailyLossTotal);
        if (dailyLossTotal.amount >= limits.daily) {
            _showBlockOverlay('Loss Limit Reached', 'You have reached your daily loss limit of $' + limits.daily + '. Further play is restricted until tomorrow.', false);
        }
    }

    /* ────────────────────────────────────────────────────
       5. Deposit Limit Check (for cashier)
       ──────────────────────────────────────────────────── */
    function checkDepositAllowed(amount) {
        var limits = rgGet('deposit_limits', {});
        if (!limits.daily) return true;
        var dailyDeposits = rgGet('daily_deposit_total', { date: new Date().toDateString(), amount: 0 });
        if (dailyDeposits.date !== new Date().toDateString()) {
            dailyDeposits = { date: new Date().toDateString(), amount: 0 };
        }
        if (dailyDeposits.amount + amount > limits.daily) {
            _showToast('Deposit exceeds your daily limit of $' + limits.daily);
            return false;
        }
        dailyDeposits.amount += amount;
        rgSet('daily_deposit_total', dailyDeposits);
        return true;
    }

    function _showToast(msg) {
        var t = document.createElement('div');
        t.style.cssText = 'position:fixed;bottom:80px;left:50%;transform:translateX(-50%);background:#1a2a1a;border:1px solid #ffaa00;color:#ffaa00;padding:12px 24px;border-radius:10px;font-size:14px;font-weight:500;z-index:99999;box-shadow:0 4px 20px rgba(0,0,0,0.5);';
        t.textContent = msg;
        document.body.appendChild(t);
        setTimeout(function() { t.remove(); }, 4000);
    }

    /* ────────────────────────────────────────────────────
       6. Global Exports
       ──────────────────────────────────────────────────── */
    window.RG = {
        onSpinComplete: onSpinComplete,
        checkDepositAllowed: checkDepositAllowed,
        checkExclusionGate: checkExclusionGate,
        getSessionTime: function() { return Date.now() - sessionStart; },
        getSessionSpins: function() { return sessionSpins; },
        getSessionNet: function() { return sessionNetResult; },
        resetSession: function() {
            sessionStart = Date.now();
            rgSet('session_start', sessionStart);
            sessionSpins = 0;
            sessionNetResult = 0;
        }
    };

    // Run exclusion gate on load
    checkExclusionGate();

    // Net position tracking (legacy compat)
    window.getNetPosition = function() {
        var deposits = parseFloat(localStorage.getItem('ms_total_deposits') || '0');
        var withdrawals = parseFloat(localStorage.getItem('ms_total_withdrawals') || '0');
        return withdrawals - deposits;
    };

    console.log('[RG] Responsible gambling module loaded \u2014 session timer active, reality check every ' + realityFreq + ' spins');
})();
