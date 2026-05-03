/* ============================================================
   Matrix Spins Casino — Deposit Urgency & Retention Popups
   Auto-injecting IIFE — multi-trigger conversion system
   Self-contained: no dependencies, paste <script> tag anywhere
   ============================================================ */
(function () {
  'use strict';

  /* ------------------------------------------------------------------ */
  /* CONFIG                                                               */
  /* ------------------------------------------------------------------ */
  var WALLET_URL            = '/wallet.html';
  var PROMO_URL             = '/promotions.html';
  var WELCOME_DELAY_MS      = 8000;
  var WELCOME_AUTODISMISS   = 30000;
  var LOW_BALANCE_DELAY_MS  = 180000;   // 3 minutes
  var FLASH_OFFER_DELAY_MS  = 300000;   // 5 minutes
  var FLASH_COUNTDOWN_S     = 900;      // 15 minutes
  var Z_INDEX               = 9500;

  /* localStorage / sessionStorage keys */
  var LS_FIRST_VISIT        = 'ms_urgency_first_visit';
  var LS_WELCOME_SHOWN      = 'ms_urgency_welcome_shown';
  var SS_EXIT_SHOWN         = 'ms_urgency_exit_shown';
  var SS_LOW_BAL_SHOWN      = 'ms_urgency_lowbal_shown';
  var SS_FLASH_SHOWN        = 'ms_urgency_flash_shown';
  var SS_WIN_SHOWN          = 'ms_urgency_win_shown';
  var SS_PAGE_ENTER         = 'ms_urgency_page_enter';

  /* ------------------------------------------------------------------ */
  /* STATE                                                                */
  /* ------------------------------------------------------------------ */
  var _paused   = false;
  var _disabled = false;
  var _timers   = [];
  var _activePopups = [];
  var _styleInjected = false;

  /* ------------------------------------------------------------------ */
  /* HELPERS                                                              */
  /* ------------------------------------------------------------------ */
  function now() { return Date.now(); }

  function isGamePage() {
    return window.location.pathname.indexOf('/games/') !== -1;
  }

  function safeSetItem(store, key, val) {
    try { store.setItem(key, val); } catch (e) { /* quota */ }
  }

  function safeGetItem(store, key) {
    try { return store.getItem(key); } catch (e) { return null; }
  }

  function addTimer(id) {
    _timers.push(id);
    return id;
  }

  function clearAllTimers() {
    _timers.forEach(function (id) { clearTimeout(id); clearInterval(id); });
    _timers = [];
  }

  function removePopup(el) {
    if (!el || !el.parentNode) return;
    el.classList.add('mdu-exit');
    var idx = _activePopups.indexOf(el);
    if (idx > -1) _activePopups.splice(idx, 1);
    setTimeout(function () {
      if (el.parentNode) el.parentNode.removeChild(el);
    }, 400);
  }

  function removeAllPopups() {
    _activePopups.slice().forEach(removePopup);
  }

  /* ------------------------------------------------------------------ */
  /* CSS INJECTION                                                        */
  /* ------------------------------------------------------------------ */
  function injectStyles() {
    if (_styleInjected) return;
    _styleInjected = true;

    var css = [
      /* ── Reset scope ─────────────────────────────────────── */
      '.mdu-popup, .mdu-popup * {',
      '  box-sizing: border-box;',
      '  margin: 0; padding: 0;',
      '  font-family: "Segoe UI", system-ui, -apple-system, sans-serif;',
      '  line-height: 1.4;',
      '}',

      /* ── Overlay ─────────────────────────────────────────── */
      '.mdu-overlay {',
      '  position: fixed; inset: 0;',
      '  background: rgba(0,0,0,0.65);',
      '  z-index: ' + Z_INDEX + ';',
      '  animation: mduFadeIn .3s ease;',
      '}',

      /* ── Base popup card ─────────────────────────────────── */
      '.mdu-popup {',
      '  position: fixed;',
      '  z-index: ' + (Z_INDEX + 1) + ';',
      '  background: rgba(10,10,20,0.95);',
      '  backdrop-filter: blur(20px);',
      '  -webkit-backdrop-filter: blur(20px);',
      '  border: 1px solid rgba(255,215,0,0.35);',
      '  border-radius: 16px;',
      '  color: #fff;',
      '  padding: 28px 24px;',
      '  max-width: 420px;',
      '  width: calc(100% - 32px);',
      '  box-shadow: 0 8px 40px rgba(0,0,0,0.6), 0 0 30px rgba(255,215,0,0.08);',
      '}',

      /* ── Positions ───────────────────────────────────────── */
      '.mdu-popup--center {',
      '  top: 50%; left: 50%;',
      '  transform: translate(-50%,-50%);',
      '  animation: mduScaleIn .35s cubic-bezier(.22,1,.36,1);',
      '}',
      '.mdu-popup--bottom {',
      '  bottom: 20px; left: 50%;',
      '  transform: translateX(-50%);',
      '  animation: mduSlideUp .4s cubic-bezier(.22,1,.36,1);',
      '}',
      '.mdu-popup--bar {',
      '  bottom: 0; left: 0; right: 0;',
      '  max-width: 100%; width: 100%;',
      '  border-radius: 0;',
      '  padding: 16px 24px;',
      '  display: flex; align-items: center; justify-content: center;',
      '  gap: 16px; flex-wrap: wrap;',
      '  animation: mduSlideUp .4s cubic-bezier(.22,1,.36,1);',
      '}',

      /* ── Exit animation ──────────────────────────────────── */
      '.mdu-exit.mdu-popup--center { animation: mduScaleOut .3s ease forwards; }',
      '.mdu-exit.mdu-popup--bottom,',
      '.mdu-exit.mdu-popup--bar { animation: mduSlideDown .3s ease forwards; }',
      '.mdu-exit.mdu-overlay { animation: mduFadeOut .3s ease forwards; }',

      /* ── Close button ────────────────────────────────────── */
      '.mdu-close {',
      '  position: absolute; top: 12px; right: 14px;',
      '  background: none; border: none; color: #888;',
      '  font-size: 22px; cursor: pointer;',
      '  width: 32px; height: 32px;',
      '  display: flex; align-items: center; justify-content: center;',
      '  border-radius: 50%;',
      '  transition: background .2s, color .2s;',
      '}',
      '.mdu-close:hover { background: rgba(255,255,255,0.1); color: #FFD700; }',

      /* ── Typography ──────────────────────────────────────── */
      '.mdu-title {',
      '  font-size: 20px; font-weight: 700;',
      '  color: #FFD700;',
      '  margin-bottom: 10px;',
      '  text-align: center;',
      '}',
      '.mdu-text {',
      '  font-size: 15px; color: #ccc;',
      '  margin-bottom: 18px;',
      '  text-align: center;',
      '}',
      '.mdu-bar-text {',
      '  font-size: 14px; color: #ddd;',
      '}',

      /* ── CTA button ──────────────────────────────────────── */
      '.mdu-cta {',
      '  display: inline-block;',
      '  background: linear-gradient(135deg, #FFD700, #FFA500);',
      '  color: #000; font-weight: 700; font-size: 15px;',
      '  padding: 12px 32px;',
      '  border: none; border-radius: 8px;',
      '  cursor: pointer;',
      '  text-decoration: none;',
      '  text-align: center;',
      '  transition: transform .15s, box-shadow .2s;',
      '  box-shadow: 0 4px 15px rgba(255,215,0,0.25);',
      '}',
      '.mdu-cta:hover {',
      '  transform: translateY(-2px);',
      '  box-shadow: 0 6px 25px rgba(255,215,0,0.4);',
      '}',
      '.mdu-cta:active { transform: translateY(0); }',
      '.mdu-cta--small {',
      '  padding: 8px 20px; font-size: 13px;',
      '}',

      /* ── Countdown ───────────────────────────────────────── */
      '.mdu-countdown {',
      '  font-size: 28px; font-weight: 700;',
      '  color: #FFD700; text-align: center;',
      '  font-variant-numeric: tabular-nums;',
      '  margin: 10px 0 16px;',
      '}',
      '.mdu-expired { color: #ff4444; font-size: 16px; }',

      /* ── Link ────────────────────────────────────────────── */
      '.mdu-link {',
      '  display: inline-block; margin-top: 10px;',
      '  color: #FFD700; font-size: 13px;',
      '  text-decoration: underline;',
      '  cursor: pointer;',
      '}',
      '.mdu-link:hover { color: #fff; }',

      /* ── Confetti container ──────────────────────────────── */
      '.mdu-confetti-box { position: relative; overflow: hidden; }',
      '.mdu-confetti {',
      '  position: absolute; width: 8px; height: 8px;',
      '  border-radius: 2px;',
      '  animation: mduConfettiFall 1.8s ease-in forwards;',
      '}',

      /* ── Center action wrapper ───────────────────────────── */
      '.mdu-actions { text-align: center; }',

      /* ── Highlight ───────────────────────────────────────── */
      '.mdu-highlight {',
      '  color: #FFD700; font-weight: 700;',
      '}',

      /* ── Keyframes ───────────────────────────────────────── */
      '@keyframes mduFadeIn { from { opacity:0 } to { opacity:1 } }',
      '@keyframes mduFadeOut { from { opacity:1 } to { opacity:0 } }',
      '@keyframes mduScaleIn { from { opacity:0; transform: translate(-50%,-50%) scale(.85) } to { opacity:1; transform: translate(-50%,-50%) scale(1) } }',
      '@keyframes mduScaleOut { from { opacity:1; transform: translate(-50%,-50%) scale(1) } to { opacity:0; transform: translate(-50%,-50%) scale(.85) } }',
      '@keyframes mduSlideUp { from { opacity:0; transform: translateY(40px) } to { opacity:1; transform: translateY(0) } }',
      '.mdu-popup--center + .mdu-exit { }',
      '.mdu-popup--bottom.mdu-exit { animation-name: mduSlideDown; }',
      '@keyframes mduSlideDown { from { opacity:1; transform: translateX(-50%) translateY(0) } to { opacity:0; transform: translateX(-50%) translateY(40px) } }',
      '@keyframes mduConfettiFall {',
      '  0% { transform: translateY(-20px) rotate(0deg); opacity:1 }',
      '  100% { transform: translateY(350px) rotate(720deg); opacity:0 }',
      '}',

      /* ── Mobile ──────────────────────────────────────────── */
      '@media (max-width: 480px) {',
      '  .mdu-popup { width: 100%; max-width: 100%; border-radius: 12px 12px 0 0; }',
      '  .mdu-popup--center { top: auto; bottom: 0; left: 0;',
      '    transform: none;',
      '    animation: mduSlideUp .4s cubic-bezier(.22,1,.36,1);',
      '    border-radius: 16px 16px 0 0;',
      '  }',
      '  .mdu-popup--bottom { left: 0; transform: none; width: 100%; border-radius: 12px 12px 0 0; }',
      '  .mdu-exit.mdu-popup--center { animation: mduSlideDownMobile .3s ease forwards; }',
      '  @keyframes mduSlideDownMobile { from { transform: translateY(0) } to { transform: translateY(100%) } }',
      '  .mdu-title { font-size: 18px; }',
      '  .mdu-countdown { font-size: 24px; }',
      '}',
    ].join('\n');

    var style = document.createElement('style');
    style.setAttribute('data-mdu', '1');
    style.textContent = css;
    document.head.appendChild(style);
  }

  /* ------------------------------------------------------------------ */
  /* POPUP FACTORY                                                        */
  /* ------------------------------------------------------------------ */

  /**
   * Creates a popup element.
   * @param {Object} opts
   * @param {string} opts.position  - 'center' | 'bottom' | 'bar'
   * @param {boolean} opts.overlay  - show dark overlay behind
   * @param {string} opts.html      - inner HTML content
   * @param {Function} opts.onClose - callback after close
   * @param {number} [opts.autoDismiss] - ms before auto-close
   * @returns {{ el: HTMLElement, overlay: HTMLElement|null, close: Function }}
   */
  function createPopup(opts) {
    if (_paused || _disabled) return null;

    injectStyles();

    var overlay = null;
    if (opts.overlay) {
      overlay = document.createElement('div');
      overlay.className = 'mdu-overlay';
      overlay.addEventListener('click', close);
      document.body.appendChild(overlay);
    }

    var popup = document.createElement('div');
    popup.className = 'mdu-popup mdu-popup--' + opts.position;
    popup.innerHTML =
      '<button class="mdu-close" aria-label="Close">&times;</button>' +
      opts.html;
    document.body.appendChild(popup);

    _activePopups.push(popup);
    if (overlay) _activePopups.push(overlay);

    /* Close button */
    popup.querySelector('.mdu-close').addEventListener('click', close);

    /* Auto-dismiss */
    if (opts.autoDismiss) {
      addTimer(setTimeout(close, opts.autoDismiss));
    }

    function close() {
      if (overlay) removePopup(overlay);
      removePopup(popup);
      if (typeof opts.onClose === 'function') opts.onClose();
    }

    return { el: popup, overlay: overlay, close: close };
  }

  /* ------------------------------------------------------------------ */
  /* 1. FIRST-VISIT WELCOME BONUS BANNER                                  */
  /* ------------------------------------------------------------------ */
  function initWelcomeBanner() {
    /* Only for first-time visitors who haven't seen it */
    if (safeGetItem(localStorage, LS_WELCOME_SHOWN)) return;
    if (safeGetItem(localStorage, LS_FIRST_VISIT)) return;

    /* Mark this as their first visit */
    safeSetItem(localStorage, LS_FIRST_VISIT, '1');

    addTimer(setTimeout(function () {
      if (_paused || _disabled) return;

      safeSetItem(localStorage, LS_WELCOME_SHOWN, '1');

      createPopup({
        position: 'bottom',
        overlay: false,
        autoDismiss: WELCOME_AUTODISMISS,
        html:
          '<div class="mdu-title">🎰 WELCOME BONUS</div>' +
          '<div class="mdu-text">' +
            '<span class="mdu-highlight">100% up to $500 + 50 Free Spins!</span><br>' +
            'Exclusive offer for new players — claim it now before it\'s gone.' +
          '</div>' +
          '<div class="mdu-actions">' +
            '<a href="' + WALLET_URL + '" class="mdu-cta">Claim Welcome Bonus</a>' +
          '</div>'
      });
    }, WELCOME_DELAY_MS));
  }

  /* ------------------------------------------------------------------ */
  /* 2. EXIT-INTENT POPUP                                                 */
  /* ------------------------------------------------------------------ */
  function initExitIntent() {
    if (safeGetItem(sessionStorage, SS_EXIT_SHOWN)) return;

    var shown = false;

    function showExitPopup() {
      if (shown || _paused || _disabled) return;
      if (safeGetItem(sessionStorage, SS_EXIT_SHOWN)) return;
      shown = true;
      safeSetItem(sessionStorage, SS_EXIT_SHOWN, '1');

      createPopup({
        position: 'center',
        overlay: true,
        html:
          '<div class="mdu-title">WAIT! Don\'t leave empty-handed!</div>' +
          '<div class="mdu-text">' +
            'Special offer just for you:<br>' +
            'Deposit <span class="mdu-highlight">$10</span> and play with ' +
            '<span class="mdu-highlight">$20</span> — that\'s a ' +
            '<span class="mdu-highlight">100% bonus!</span>' +
          '</div>' +
          '<div class="mdu-actions">' +
            '<a href="' + WALLET_URL + '" class="mdu-cta">Deposit $10, Get $20</a><br>' +
            '<span class="mdu-link" data-mdu-dismiss="exit">No thanks, I\'ll pass</span>' +
          '</div>',
        onClose: function () { /* already stored in session */ }
      });

      /* Bind the dismiss link */
      setTimeout(function () {
        var link = document.querySelector('[data-mdu-dismiss="exit"]');
        if (link) {
          link.addEventListener('click', function () {
            var p = link.closest('.mdu-popup');
            if (p) removePopup(p);
            var o = document.querySelector('.mdu-overlay');
            if (o) removePopup(o);
          });
        }
      }, 50);
    }

    /* Desktop: mouse leaves viewport from top */
    document.addEventListener('mouseout', function (e) {
      if (e.clientY <= 0 && e.relatedTarget === null) {
        showExitPopup();
      }
    });

    /* Mobile: visibilitychange as back-button proxy */
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'hidden') {
        showExitPopup();
      }
    });
  }

  /* ------------------------------------------------------------------ */
  /* 3. LOW-BALANCE NUDGE (game pages only)                               */
  /* ------------------------------------------------------------------ */
  function initLowBalanceNudge() {
    if (!isGamePage()) return;
    if (safeGetItem(sessionStorage, SS_LOW_BAL_SHOWN)) return;

    addTimer(setTimeout(function () {
      if (_paused || _disabled) return;
      if (safeGetItem(sessionStorage, SS_LOW_BAL_SHOWN)) return;
      safeSetItem(sessionStorage, SS_LOW_BAL_SHOWN, '1');

      createPopup({
        position: 'bar',
        overlay: false,
        html:
          '<span class="mdu-bar-text">' +
            'Running low? Reload with a quick <span class="mdu-highlight">$10 deposit</span> and keep the wins coming!' +
          '</span>' +
          '<a href="' + WALLET_URL + '" class="mdu-cta mdu-cta--small">Deposit Now</a>'
      });
    }, LOW_BALANCE_DELAY_MS));
  }

  /* ------------------------------------------------------------------ */
  /* 4. TIME-LIMITED FLASH OFFER                                          */
  /* ------------------------------------------------------------------ */
  function initFlashOffer() {
    if (safeGetItem(sessionStorage, SS_FLASH_SHOWN)) return;

    /* Record page-enter time for cross-page continuity */
    if (!safeGetItem(sessionStorage, SS_PAGE_ENTER)) {
      safeSetItem(sessionStorage, SS_PAGE_ENTER, String(now()));
    }

    var enterTime = parseInt(safeGetItem(sessionStorage, SS_PAGE_ENTER), 10);

    function checkAndShow() {
      if (_paused || _disabled) return;
      if (safeGetItem(sessionStorage, SS_FLASH_SHOWN)) return;

      var elapsed = now() - enterTime;
      if (elapsed >= FLASH_OFFER_DELAY_MS) {
        showFlashOffer();
      } else {
        addTimer(setTimeout(showFlashOffer, FLASH_OFFER_DELAY_MS - elapsed));
      }
    }

    function showFlashOffer() {
      if (_paused || _disabled) return;
      if (safeGetItem(sessionStorage, SS_FLASH_SHOWN)) return;
      safeSetItem(sessionStorage, SS_FLASH_SHOWN, '1');

      var remaining = FLASH_COUNTDOWN_S;

      var result = createPopup({
        position: 'bottom',
        overlay: false,
        html:
          '<div class="mdu-title">⚡ FLASH OFFER</div>' +
          '<div class="mdu-text">Double your next deposit — limited time!</div>' +
          '<div class="mdu-countdown" id="mdu-flash-timer">' + formatTime(remaining) + '</div>' +
          '<div class="mdu-actions">' +
            '<a href="' + WALLET_URL + '" class="mdu-cta">Double My Deposit</a>' +
          '</div>'
      });

      if (!result) return;

      var timerEl = result.el.querySelector('#mdu-flash-timer');
      var actionsEl = result.el.querySelector('.mdu-actions');

      var interval = setInterval(function () {
        remaining--;
        if (remaining <= 0) {
          clearInterval(interval);
          timerEl.innerHTML = '<span class="mdu-expired">Offer expired</span>';
          actionsEl.innerHTML =
            '<a href="' + PROMO_URL + '" class="mdu-cta mdu-cta--small">See Other Promotions</a>';
          return;
        }
        timerEl.textContent = formatTime(remaining);
      }, 1000);

      addTimer(interval);
    }

    function formatTime(s) {
      var m = Math.floor(s / 60);
      var sec = s % 60;
      return (m < 10 ? '0' : '') + m + ':' + (sec < 10 ? '0' : '') + sec;
    }

    checkAndShow();
  }

  /* ------------------------------------------------------------------ */
  /* 5. WIN CELEBRATION UPSELL                                            */
  /* ------------------------------------------------------------------ */
  function initWinCelebration() {
    window.addEventListener('matrix:win', function () {
      if (_paused || _disabled) return;
      /* Allow one per session */
      if (safeGetItem(sessionStorage, SS_WIN_SHOWN)) return;
      safeSetItem(sessionStorage, SS_WIN_SHOWN, '1');

      var result = createPopup({
        position: 'center',
        overlay: true,
        html:
          '<div class="mdu-confetti-box" id="mdu-confetti-zone">' +
            '<div class="mdu-title">🎉 NICE WIN!</div>' +
            '<div class="mdu-text">' +
              'You\'re on a roll! Deposit now to play with house money and keep the streak alive.' +
            '</div>' +
            '<div class="mdu-actions">' +
              '<a href="' + WALLET_URL + '" class="mdu-cta">Deposit & Play</a>' +
            '</div>' +
          '</div>'
      });

      if (!result) return;

      /* Spawn confetti */
      spawnConfetti(result.el.querySelector('#mdu-confetti-zone'));
    });
  }

  function spawnConfetti(container) {
    if (!container) return;
    var colors = ['#FFD700', '#FF6347', '#00CED1', '#FF69B4', '#7CFC00', '#FF4500', '#1E90FF', '#FFA500'];
    for (var i = 0; i < 40; i++) {
      var piece = document.createElement('div');
      piece.className = 'mdu-confetti';
      piece.style.left = Math.random() * 100 + '%';
      piece.style.top = '-10px';
      piece.style.background = colors[Math.floor(Math.random() * colors.length)];
      piece.style.animationDelay = (Math.random() * 0.8).toFixed(2) + 's';
      piece.style.animationDuration = (1.2 + Math.random() * 1).toFixed(2) + 's';
      piece.style.width = (5 + Math.random() * 6) + 'px';
      piece.style.height = (5 + Math.random() * 6) + 'px';
      container.appendChild(piece);
    }
  }

  /* ------------------------------------------------------------------ */
  /* PUBLIC API                                                            */
  /* ------------------------------------------------------------------ */
  window.MatrixDepositUrgency = {
    /**
     * Pause all popup display — existing popups stay visible but
     * no new ones will fire until resumed.
     */
    pause: function () {
      _paused = true;
    },

    /**
     * Resume popup display after a pause.
     */
    resume: function () {
      _paused = false;
    },

    /**
     * Permanently disable the system for this page load.
     * Clears all pending timers and removes active popups.
     */
    disable: function () {
      _disabled = true;
      _paused = true;
      clearAllTimers();
      removeAllPopups();
    }
  };

  /* ------------------------------------------------------------------ */
  /* BOOT                                                                 */
  /* ------------------------------------------------------------------ */
  function boot() {
    injectStyles();
    initWelcomeBanner();
    initExitIntent();
    initLowBalanceNudge();
    initFlashOffer();
    initWinCelebration();
  }

  /* Start when DOM is ready */
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

})();
