/**
 * Matrix Spins Casino — Social Proof (REAL DATA ONLY)
 *
 * Renders a small live-player widget driven by /api/socialproof.
 * No fake names, no fake deposits, no fake jackpots, no fabricated activity.
 *
 * If the API returns 0 active players, the widget is hidden (clean empty state).
 * Re-polls every 60s while the page is visible.
 *
 * Public API (preserved for backward compat with existing callers):
 *   window.MatrixSocialProof.pause()   — stop polling + hide
 *   window.MatrixSocialProof.resume()  — resume polling
 *   window.MatrixSocialProof.hide()    — hide widget without stopping polling
 *   window.MatrixSocialProof.refresh() — force an immediate poll
 */
(function () {
  'use strict';

  if (window.MatrixSocialProof && window.MatrixSocialProof._loaded) return;

  var POLL_INTERVAL_MS = 60000;
  var WIDGET_Z = 8000;
  var ENDPOINT = '/api/socialproof';

  var _paused = false;
  var _hidden = false;
  var _timer = null;
  var _widget = null;

  function injectStyles() {
    if (document.getElementById('msp-real-styles')) return;
    var s = document.createElement('style');
    s.id = 'msp-real-styles';
    s.textContent = [
      '.msp-live-widget{position:fixed;left:1rem;bottom:1rem;background:rgba(6,8,8,0.92);',
      '  border:1px solid rgba(0,255,65,0.3);border-radius:999px;padding:0.5rem 0.95rem;',
      '  display:flex;align-items:center;gap:0.55rem;color:#e8f5ed;font-size:0.78rem;',
      '  font-family:Inter,system-ui,sans-serif;font-weight:600;',
      '  backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);',
      '  box-shadow:0 4px 14px rgba(0,0,0,0.4);z-index:' + WIDGET_Z + ';',
      '  transform:translateY(0);transition:transform 240ms ease, opacity 240ms ease;}',
      '.msp-live-widget.msp-hidden{transform:translateY(120%);opacity:0;pointer-events:none;}',
      '.msp-live-dot{width:8px;height:8px;border-radius:50%;background:#00ff41;',
      '  box-shadow:0 0 8px #00ff41;animation:msp-pulse 1.6s ease-in-out infinite;}',
      '@keyframes msp-pulse{0%,100%{opacity:1}50%{opacity:0.5}}',
      '@media (max-width:640px){.msp-live-widget{left:0.5rem;bottom:calc(72px + env(safe-area-inset-bottom));font-size:0.72rem;padding:0.4rem 0.8rem;}}',
      '@media print{.msp-live-widget{display:none !important;}}',
      '@media (prefers-reduced-motion: reduce){.msp-live-dot{animation:none;}}'
    ].join('\n');
    document.head.appendChild(s);
  }

  function ensureWidget() {
    if (_widget) return _widget;
    injectStyles();
    var div = document.createElement('div');
    div.className = 'msp-live-widget msp-hidden';
    div.setAttribute('role', 'status');
    div.setAttribute('aria-live', 'polite');
    div.setAttribute('aria-label', 'Live player count');
    var dot = document.createElement('span');
    dot.className = 'msp-live-dot';
    dot.setAttribute('aria-hidden', 'true');
    var text = document.createElement('span');
    text.className = 'msp-live-text';
    text.textContent = '';
    div.appendChild(dot);
    div.appendChild(text);
    document.body.appendChild(div);
    _widget = div;
    return div;
  }

  function show(text) {
    if (_hidden) return;
    var w = ensureWidget();
    var t = w.querySelector('.msp-live-text');
    if (t) t.textContent = text;
    w.classList.remove('msp-hidden');
  }

  function hide() {
    if (_widget) _widget.classList.add('msp-hidden');
  }

  function fmtNum(n) {
    var v = parseInt(n, 10);
    if (!v || v < 1) return '0';
    return v.toLocaleString();
  }

  async function poll() {
    if (_paused) return;
    try {
      var res = await fetch(ENDPOINT, { credentials: 'omit' });
      if (!res.ok) { hide(); return; }
      var data = await res.json();
      var online = parseInt(data.onlineNow, 10) || 0;
      var spinsToday = parseInt(data.spinsToday, 10) || 0;

      if (online <= 0 && spinsToday <= 0) {
        // No real activity yet — show clean empty state by hiding the widget
        hide();
        return;
      }

      var label = online > 0
        ? fmtNum(online) + ' playing now'
        : fmtNum(spinsToday) + ' spins today';
      show(label);
    } catch (_) {
      // Quiet fail — never inject fake data
      hide();
    }
  }

  function startTimer() {
    stopTimer();
    _timer = setInterval(poll, POLL_INTERVAL_MS);
  }
  function stopTimer() {
    if (_timer) { clearInterval(_timer); _timer = null; }
  }

  function init() {
    poll();
    startTimer();
    // Pause polling when tab hidden — saves bandwidth + keeps numbers fresh on focus
    document.addEventListener('visibilitychange', function () {
      if (document.hidden) { stopTimer(); }
      else { poll(); startTimer(); }
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }

  window.MatrixSocialProof = {
    _loaded: true,
    pause: function () { _paused = true; stopTimer(); hide(); },
    resume: function () { _paused = false; poll(); startTimer(); },
    hide: function () { _hidden = true; hide(); },
    show: function () { _hidden = false; poll(); },
    refresh: poll
  };
})();
