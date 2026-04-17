/**
 * Session Clock
 * Continuous elapsed-session display — companion to session-timeout.js
 * which only shows a countdown near the inactivity cutoff.
 *
 * Premium RG standard (UKGC LCCP 3.4.3): players should be able to see
 * at a glance how long they've been playing.
 *
 * Reuses the existing #rgTimerBadge DOM node when available; otherwise
 * creates a floating badge in the bottom-right.
 */

window.SessionClock = (function () {
  const STORAGE_KEY = 'matrixSpins_sessionStart';
  const TOKEN_KEY = 'casinoToken';
  const UPDATE_MS = 30 * 1000;
  const AMBER_MS = 2 * 60 * 60 * 1000;
  const RED_MS = 4 * 60 * 60 * 1000;

  let startTime = 0;
  let tickHandle = null;

  function loggedIn() {
    try { return !!localStorage.getItem(TOKEN_KEY); } catch (err) { return false; }
  }

  function loadStart() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const n = parseInt(raw, 10);
        if (isFinite(n) && n > 0 && Date.now() - n < 24 * 60 * 60 * 1000) {
          startTime = n;
          return;
        }
      }
    } catch (err) {}
    startTime = Date.now();
    try { localStorage.setItem(STORAGE_KEY, String(startTime)); } catch (err) {}
  }

  function clearStart() {
    try { localStorage.removeItem(STORAGE_KEY); } catch (err) {}
    startTime = 0;
  }

  function format(ms) {
    const s = Math.floor(ms / 1000);
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    if (h > 0) return h + 'h ' + (m < 10 ? '0' : '') + m + 'm';
    return m + 'm';
  }

  function ensureBadge() {
    let el = document.getElementById('sessionClockBadge');
    if (el) return el;
    // Prefer reusing existing rgTimerBadge slot if present
    const host = document.getElementById('rgTimerBadge');
    if (host) {
      host.id = 'sessionClockBadge';
      host.className = 'session-clock-badge';
      host.style.display = '';
      return host;
    }
    el = document.createElement('span');
    el.id = 'sessionClockBadge';
    el.className = 'session-clock-badge';
    document.body.appendChild(el);
    return el;
  }

  function update() {
    if (!loggedIn()) {
      const el = document.getElementById('sessionClockBadge');
      if (el) el.style.display = 'none';
      return;
    }
    if (!startTime) loadStart();
    const elapsed = Date.now() - startTime;
    const el = ensureBadge();
    el.style.display = '';
    el.textContent = 'Session ' + format(elapsed);
    el.classList.remove('sc-amber', 'sc-red');
    if (elapsed >= RED_MS) el.classList.add('sc-red');
    else if (elapsed >= AMBER_MS) el.classList.add('sc-amber');
    el.title = 'You have been playing for ' + format(elapsed) + '. Consider taking a break.';
  }

  function init() {
    if (tickHandle) return;
    loadStart();
    update();
    tickHandle = setInterval(update, UPDATE_MS);
    document.addEventListener('click', function (e) {
      const el = document.getElementById('sessionClockBadge');
      if (el && e.target === el) {
        alert('You have been playing for ' + format(Date.now() - startTime) + '.\n\nTake a break, drink some water, stretch. The games will be here when you return.');
      }
    });
  }

  function reset() {
    startTime = Date.now();
    try { localStorage.setItem(STORAGE_KEY, String(startTime)); } catch (err) {}
    update();
  }

  function stop() {
    if (tickHandle) { clearInterval(tickHandle); tickHandle = null; }
    clearStart();
    const el = document.getElementById('sessionClockBadge');
    if (el) el.style.display = 'none';
  }

  function getElapsedMs() {
    if (!startTime) return 0;
    return Date.now() - startTime;
  }

  return {
    init: init,
    reset: reset,
    stop: stop,
    getElapsedMs: getElapsedMs,
  };
})();

(function injectSessionClockStyles() {
  if (document.getElementById('sessionClockStyles')) return;
  const css =
    '.session-clock-badge{position:fixed;bottom:16px;right:16px;z-index:9998;background:rgba(26,26,46,.92);color:#b8d4e0;border:1px solid #00d4ff;border-radius:20px;padding:6px 14px;font-size:12px;font-weight:600;letter-spacing:.3px;box-shadow:0 4px 14px rgba(0,0,0,.4);cursor:pointer;user-select:none;backdrop-filter:blur(6px)}' +
    '.session-clock-badge:hover{background:rgba(0,212,255,.15);transform:translateY(-1px)}' +
    '.session-clock-badge.sc-amber{color:#ffcd71;border-color:#e67e22;background:rgba(46,35,26,.92)}' +
    '.session-clock-badge.sc-red{color:#ff9b9b;border-color:#e74c3c;background:rgba(46,26,26,.92);animation:scPulse 2.5s ease-in-out infinite}' +
    '@keyframes scPulse{0%,100%{box-shadow:0 4px 14px rgba(231,76,60,.4)}50%{box-shadow:0 4px 22px rgba(231,76,60,.8)}}' +
    '@media (prefers-reduced-motion:reduce){.session-clock-badge.sc-red{animation:none}}' +
    '@media (max-width:600px){.session-clock-badge{bottom:80px;right:10px;font-size:11px;padding:5px 10px}}';
  const el = document.createElement('style');
  el.id = 'sessionClockStyles';
  el.textContent = css;
  document.head.appendChild(el);
})();
