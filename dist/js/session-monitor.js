/**
 * Matrix Spins Casino — Session Monitor
 * Responsible Gambling Compliance Feature
 * Auto-injecting IIFE: session timer, reality checks, spend alerts, break reminders
 */
(function () {
  'use strict';

  var STORAGE_KEY_START = 'ms_session_start';
  var STORAGE_KEY_INTERVAL = 'ms_reality_check_interval';
  var STORAGE_KEY_DEPOSIT_LIMIT = 'ms_deposit_limit';
  var STORAGE_KEY_SESSION_DEPOSITS = 'ms_session_deposits';
  var DEFAULT_INTERVAL_MIN = 60;
  var BREAK_REMINDER_MS = 2 * 60 * 60 * 1000; // 2 hours

  var sessionStart;
  var realityCheckTimer = null;
  var breakReminderTimer = null;
  var tickInterval = null;
  var sessionDeposits = parseFloat(sessionStorage.getItem(STORAGE_KEY_SESSION_DEPOSITS)) || 0;

  // ── Helpers ──────────────────────────────────────────────────────────

  function pad(n) { return n < 10 ? '0' + n : '' + n; }

  function formatDuration(totalSeconds) {
    var h = Math.floor(totalSeconds / 3600);
    var m = Math.floor((totalSeconds % 3600) / 60);
    var s = totalSeconds % 60;
    return pad(h) + ':' + pad(m) + ':' + pad(s);
  }

  function getIntervalMs() {
    var stored = localStorage.getItem(STORAGE_KEY_INTERVAL);
    var mins = stored ? parseInt(stored, 10) : DEFAULT_INTERVAL_MIN;
    if (isNaN(mins) || mins < 1) mins = DEFAULT_INTERVAL_MIN;
    return mins * 60 * 1000;
  }

  function getElapsedSeconds() {
    return Math.floor((Date.now() - sessionStart) / 1000);
  }

  function removeElement(el) {
    if (el && el.parentNode) el.parentNode.removeChild(el);
  }

  // ── Session Timer ────────────────────────────────────────────────────

  function initSessionStart() {
    var stored = sessionStorage.getItem(STORAGE_KEY_START);
    if (stored) {
      sessionStart = parseInt(stored, 10);
    } else {
      sessionStart = Date.now();
      sessionStorage.setItem(STORAGE_KEY_START, sessionStart);
    }
  }

  function ensureTimerElement() {
    var el = document.getElementById('sessionTimer');
    if (el) return el;
    var actions = document.querySelector('.topbar .actions');
    if (actions) {
      el = document.createElement('span');
      el.id = 'sessionTimer';
      el.className = 'session-timer-injected';
      actions.insertBefore(el, actions.firstChild);
    }
    return el;
  }

  function tick() {
    var el = ensureTimerElement();
    if (el) {
      el.textContent = 'Session: ' + formatDuration(getElapsedSeconds());
    }
  }

  // ── Modal Utilities ──────────────────────────────────────────────────

  function createOverlay(id) {
    var overlay = document.createElement('div');
    overlay.id = id;
    overlay.className = 'sm-overlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    document.body.appendChild(overlay);
    return overlay;
  }

  function trapFocus(container) {
    var focusable = container.querySelectorAll('button, a[href], [tabindex]:not([tabindex="-1"])');
    if (!focusable.length) return;
    var first = focusable[0];
    var last = focusable[focusable.length - 1];
    first.focus();
    container.addEventListener('keydown', function (e) {
      if (e.key !== 'Tab') return;
      if (e.shiftKey) {
        if (document.activeElement === first) { e.preventDefault(); last.focus(); }
      } else {
        if (document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    });
  }

  // ── Reality Check Popup ──────────────────────────────────────────────

  function showRealityCheck() {
    if (document.getElementById('smRealityCheck')) return;
    var elapsed = getElapsedSeconds();
    var hours = Math.floor(elapsed / 3600);
    var minutes = Math.floor((elapsed % 3600) / 60);
    var timeStr = '';
    if (hours > 0) timeStr += hours + ' hour' + (hours !== 1 ? 's' : '');
    if (hours > 0 && minutes > 0) timeStr += ' and ';
    if (minutes > 0 || hours === 0) timeStr += minutes + ' minute' + (minutes !== 1 ? 's' : '');

    var overlay = createOverlay('smRealityCheck');
    overlay.setAttribute('aria-label', 'Reality Check');
    overlay.innerHTML =
      '<div class="sm-card sm-reality-card">' +
        '<div class="sm-clock-icon" aria-hidden="true">⏰</div>' +
        '<h2 class="sm-heading">Time for a Reality Check</h2>' +
        '<p class="sm-time">You\'ve been playing for <strong>' + timeStr + '</strong>.</p>' +
        '<div class="sm-stats">' +
          '<div class="sm-stat"><span class="sm-stat-label">Spins Played</span><span class="sm-stat-value" id="smSpinsPlayed">0</span></div>' +
          '<div class="sm-stat"><span class="sm-stat-label">Net Result</span><span class="sm-stat-value" id="smNetResult">£0.00</span></div>' +
        '</div>' +
        '<p class="sm-question">Would you like to continue playing or take a break?</p>' +
        '<div class="sm-actions">' +
          '<button id="smContinue" class="sm-btn sm-btn-continue" aria-label="Continue playing">Continue Playing</button>' +
          '<button id="smBreak" class="sm-btn sm-btn-break" aria-label="Take a break">Take a Break</button>' +
        '</div>' +
        '<a href="responsible-gambling.html" class="sm-limits-link">Set Limits</a>' +
      '</div>';

    trapFocus(overlay.querySelector('.sm-card'));

    document.getElementById('smContinue').addEventListener('click', function () {
      removeElement(overlay);
      scheduleRealityCheck();
    });
    document.getElementById('smBreak').addEventListener('click', function () {
      // End the server-side session before navigating so the timer stops
      // counting and the player's spin-rate / wagered total are flushed
      // for the audit log. Fire-and-forget — even if the call fails we
      // still send the player to the RG page. The .catch() inside
      // handles fetch errors; the `&& typeof ... === 'function'` guard
      // means there's no need for an outer try.
      if (window.MatrixSpinsAPI && typeof window.MatrixSpinsAPI.fetch === 'function') {
        window.MatrixSpinsAPI.fetch('/session/end', { method: 'POST', body: {} }).catch(function () {});
      }
      window.location.href = 'responsible-gambling.html';
    });
  }

  function scheduleRealityCheck() {
    clearTimeout(realityCheckTimer);
    realityCheckTimer = setTimeout(showRealityCheck, getIntervalMs());
  }

  // ── Break Reminder ───────────────────────────────────────────────────

  function showBreakReminder() {
    if (document.getElementById('smBreakReminder')) return;
    var banner = document.createElement('div');
    banner.id = 'smBreakReminder';
    banner.className = 'sm-break-banner';
    banner.setAttribute('role', 'alert');
    banner.innerHTML =
      '<p>You\'ve been active for 2 hours. Consider taking a short break.</p>' +
      '<button id="smBreakOk" class="sm-btn sm-btn-ok" aria-label="Dismiss reminder">OK</button>';
    document.body.appendChild(banner);
    requestAnimationFrame(function () { banner.classList.add('sm-break-visible'); });
    document.getElementById('smBreakOk').addEventListener('click', function () {
      banner.classList.remove('sm-break-visible');
      setTimeout(function () { removeElement(banner); }, 350);
    });
  }

  function scheduleBreakReminder() {
    var alreadyElapsed = Date.now() - sessionStart;
    var remaining = BREAK_REMINDER_MS - alreadyElapsed;
    if (remaining <= 0) { showBreakReminder(); return; }
    clearTimeout(breakReminderTimer);
    breakReminderTimer = setTimeout(showBreakReminder, remaining);
  }

  // ── Spend Alert ──────────────────────────────────────────────────────

  function checkDepositLimit(amount) {
    var limit = parseFloat(localStorage.getItem(STORAGE_KEY_DEPOSIT_LIMIT));
    if (isNaN(limit) || limit <= 0) return;
    sessionDeposits += amount;
    sessionStorage.setItem(STORAGE_KEY_SESSION_DEPOSITS, sessionDeposits);

    var pct = (sessionDeposits / limit) * 100;
    if (pct >= 100) {
      showSpendAlert('You have reached your deposit limit (£' + limit.toFixed(2) + '). Further deposits are blocked for this session.', true);
    } else if (pct >= 80) {
      showSpendAlert('You have used ' + Math.round(pct) + '% of your deposit limit (£' + limit.toFixed(2) + ').', false);
    }
  }

  function showSpendAlert(message, isHardStop) {
    var existing = document.getElementById('smSpendAlert');
    if (existing) removeElement(existing);
    var overlay = createOverlay('smSpendAlert');
    overlay.setAttribute('aria-label', 'Deposit Limit Alert');
    overlay.innerHTML =
      '<div class="sm-card sm-spend-card' + (isHardStop ? ' sm-hard-stop' : '') + '">' +
        '<h2 class="sm-heading">' + (isHardStop ? 'Deposit Limit Reached' : 'Deposit Limit Warning') + '</h2>' +
        '<p>' + message + '</p>' +
        '<div class="sm-actions">' +
          '<button id="smSpendOk" class="sm-btn sm-btn-break" aria-label="OK">' + (isHardStop ? 'OK' : 'Understood') + '</button>' +
        '</div>' +
      '</div>';
    trapFocus(overlay.querySelector('.sm-card'));
    document.getElementById('smSpendOk').addEventListener('click', function () {
      removeElement(overlay);
    });
    if (isHardStop) {
      document.dispatchEvent(new CustomEvent('matrix-deposit-blocked'));
    }
  }

  // ── Init ─────────────────────────────────────────────────────────────

  function init() {
    initSessionStart();
    tick();
    tickInterval = setInterval(tick, 1000);
    scheduleRealityCheck();
    scheduleBreakReminder();
    document.addEventListener('matrix-deposit', function (e) {
      var amount = e && e.detail && e.detail.amount ? parseFloat(e.detail.amount) : 0;
      if (amount > 0) checkDepositLimit(amount);
    });
  }

  // ── Public API ───────────────────────────────────────────────────────

  window.MatrixSessionMonitor = {
    getSessionDuration: function () { return getElapsedSeconds(); },
    setRealityCheckInterval: function (minutes) {
      if (typeof minutes !== 'number' || minutes < 1) return;
      localStorage.setItem(STORAGE_KEY_INTERVAL, minutes);
      scheduleRealityCheck();
    },
    reset: function () {
      sessionStart = Date.now();
      sessionStorage.setItem(STORAGE_KEY_START, sessionStart);
      sessionDeposits = 0;
      sessionStorage.setItem(STORAGE_KEY_SESSION_DEPOSITS, '0');
      scheduleRealityCheck();
      scheduleBreakReminder();
    }
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
