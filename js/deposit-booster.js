/* ============================================================
   Matrix Spins Casino — Deposit Booster Modal
   Auto-injecting IIFE — converts demo players into depositors
   Self-contained: no dependencies, paste <script> tag anywhere
   ============================================================ */
(function () {
  'use strict';

  /* ------------------------------------------------------------------ */
  /* CONFIG                                                               */
  /* ------------------------------------------------------------------ */
  var DEMO_SPIN_THRESHOLD  = 5;
  var TIME_ON_PAGE_MS      = 90000;   // 90 s
  var LOW_DEMO_BALANCE     = 200;     // $200
  var POLL_INTERVAL_MS     = 2000;
  var DISMISS_COOLDOWN_MS  = 4 * 60 * 60 * 1000; // 4 hours
  var COUNTDOWN_TOTAL_S    = 600;     // 10 minutes
  var PULSE_DELAY_MS       = 30000;   // 30 s after show
  var WALLET_URL           = 'wallet.html';
  var PROMO_CODE           = 'booster100';
  var BONUS_MULTIPLIER     = 2.0;     // 100% match

  var LS_AUTH_TOKEN        = 'ms_auth_token';
  var LS_DISMISSED         = 'ms_booster_dismissed';
  var LS_HAS_DEPOSITED     = 'ms_has_deposited';
  var LS_DEMO_SPINS        = 'ms_demo_spins';
  var SS_SHOWN             = 'ms_booster_shown';
  var SS_TIMER_START       = 'ms_booster_timer_start';

  /* ------------------------------------------------------------------ */
  /* SUPPRESSION GUARD                                                    */
  /* ------------------------------------------------------------------ */
  function isSuppressed() {
    // Already deposited
    if (localStorage.getItem(LS_HAS_DEPOSITED)) return true;
    // Already shown this session
    if (sessionStorage.getItem(SS_SHOWN)) return true;
    // Dismissed within 4 hours
    var dismissed = localStorage.getItem(LS_DISMISSED);
    if (dismissed && (Date.now() - parseInt(dismissed, 10)) < DISMISS_COOLDOWN_MS) return true;
    // Logged-in user with real balance
    var token = localStorage.getItem(LS_AUTH_TOKEN);
    if (token) {
      var bal = window.MSPlayer && typeof window.MSPlayer.balance === 'number'
        ? window.MSPlayer.balance : 0;
      if (bal > 0) return true;
    }
    return false;
  }

  /* ------------------------------------------------------------------ */
  /* CSS INJECTION                                                        */
  /* ------------------------------------------------------------------ */
  function injectCSS() {
    if (document.getElementById('ms-booster-style')) return;
    var style = document.createElement('style');
    style.id = 'ms-booster-style';
    style.textContent = [
      /* Overlay */
      '#ms-booster-overlay{',
        'position:fixed;inset:0;z-index:99999;',
        'background:rgba(0,0,0,0.85);',
        'display:flex;align-items:center;justify-content:center;',
        'padding:16px;box-sizing:border-box;',
        'animation:ms-fadein 0.25s ease;',
      '}',

      '@keyframes ms-fadein{from{opacity:0}to{opacity:1}}',

      /* Card */
      '#ms-booster-card{',
        'background:#13151C;',
        'border:2px solid #D4A853;',
        'border-radius:16px;',
        'width:100%;max-width:480px;',
        'position:relative;',
        'overflow:hidden;',
        'box-shadow:0 8px 48px rgba(0,0,0,0.8),0 0 0 1px rgba(212,168,83,0.2);',
        'animation:ms-slidein 0.3s cubic-bezier(0.34,1.56,0.64,1);',
      '}',

      '@keyframes ms-slidein{',
        'from{transform:translateY(24px) scale(0.96);opacity:0}',
        'to{transform:translateY(0) scale(1);opacity:1}',
      '}',

      /* Pulsing gold border (added after 30 s) */
      '#ms-booster-card.ms-pulse{',
        'animation:ms-slidein 0s,ms-border-pulse 1.6s ease-in-out infinite;',
      '}',

      '@keyframes ms-border-pulse{',
        '0%,100%{box-shadow:0 8px 48px rgba(0,0,0,0.8),0 0 0 1px rgba(212,168,83,0.2),0 0 12px 2px rgba(212,168,83,0.25)}',
        '50%{box-shadow:0 8px 48px rgba(0,0,0,0.8),0 0 0 3px rgba(212,168,83,0.9),0 0 32px 8px rgba(212,168,83,0.45)}',
      '}',

      /* Gold header bar */
      '#ms-booster-header{',
        'background:linear-gradient(135deg,#B8860B 0%,#D4A853 40%,#FFD700 60%,#D4A853 80%,#B8860B 100%);',
        'padding:18px 48px 18px 24px;',
        'display:flex;align-items:center;gap:12px;',
      '}',

      /* Slot reel spin emoji */
      '#ms-booster-reel{',
        'font-size:32px;',
        'display:inline-block;',
        'animation:ms-spin-reel 1.2s cubic-bezier(0.4,0,0.2,1) infinite;',
      '}',

      '@keyframes ms-spin-reel{',
        '0%{transform:rotateY(0deg)}',
        '50%{transform:rotateY(180deg)}',
        '100%{transform:rotateY(360deg)}',
      '}',

      '#ms-booster-header-text{',
        'color:#13151C;font-weight:800;font-size:13px;letter-spacing:1px;text-transform:uppercase;',
      '}',

      /* Close button */
      '#ms-booster-close{',
        'position:absolute;top:12px;right:14px;',
        'background:none;border:none;',
        'color:#13151C;font-size:22px;font-weight:700;',
        'cursor:pointer;line-height:1;',
        'width:32px;height:32px;',
        'display:flex;align-items:center;justify-content:center;',
        'border-radius:50%;',
        'transition:background 0.15s;',
        'z-index:2;',
      '}',

      '#ms-booster-close:hover{background:rgba(0,0,0,0.15)}',
      '#ms-booster-close:focus-visible{outline:2px solid #13151C;outline-offset:2px}',

      /* Body */
      '#ms-booster-body{padding:24px 28px 20px;}',

      /* Headline */
      '#ms-booster-headline{',
        'text-align:center;margin:0 0 4px;',
        'font-size:22px;font-weight:900;',
        'color:#FFFFFF;letter-spacing:0.5px;',
      '}',

      '#ms-booster-sub{',
        'text-align:center;margin:0 0 20px;',
        'font-size:14px;color:#9AA0B2;',
      '}',

      /* Offer box */
      '#ms-booster-offer{',
        'border:1px solid #D4A853;',
        'border-radius:10px;',
        'padding:14px 16px;',
        'text-align:center;',
        'margin-bottom:20px;',
        'background:rgba(212,168,83,0.07);',
      '}',

      '#ms-booster-offer-title{',
        'font-size:17px;font-weight:800;',
        'color:#D4A853;letter-spacing:0.5px;',
        'text-transform:uppercase;margin-bottom:4px;',
      '}',

      '#ms-booster-offer-detail{',
        'font-size:13px;color:#C8D0E0;',
      '}',

      /* Countdown */
      '#ms-booster-timer-wrap{',
        'text-align:center;margin-bottom:18px;',
        'font-size:13px;color:#9AA0B2;',
      '}',

      '#ms-booster-timer{',
        'font-size:20px;font-weight:700;',
        'color:#FFD700;font-variant-numeric:tabular-nums;',
        'letter-spacing:1px;',
      '}',

      '#ms-booster-timer-label{font-size:12px;color:#9AA0B2;margin-top:4px;}',

      /* Last chance */
      '#ms-booster-last-chance{',
        'display:none;text-align:center;margin-bottom:18px;',
        'font-size:14px;font-weight:700;color:#FFD700;',
        'animation:ms-flash 1s ease infinite alternate;',
      '}',

      '@keyframes ms-flash{from{opacity:0.6}to{opacity:1}}',

      /* Quick-select buttons */
      '#ms-booster-amounts{',
        'display:flex;gap:10px;margin-bottom:12px;',
      '}',

      '.ms-amount-btn{',
        'flex:1;padding:10px 4px;',
        'background:rgba(212,168,83,0.1);',
        'border:1.5px solid #D4A853;',
        'border-radius:8px;',
        'color:#D4A853;font-weight:700;font-size:15px;',
        'cursor:pointer;transition:background 0.15s,color 0.15s;',
      '}',

      '.ms-amount-btn:hover,.ms-amount-btn.ms-selected{',
        'background:#D4A853;color:#13151C;',
      '}',

      '.ms-amount-btn:focus-visible{outline:2px solid #FFD700;outline-offset:2px}',

      /* Play-with label */
      '#ms-booster-play-with{',
        'text-align:center;font-size:13px;color:#9AA0B2;',
        'margin-bottom:20px;min-height:18px;',
      '}',

      '#ms-booster-play-amount{color:#FFD700;font-weight:700;}',

      /* CTA */
      '#ms-booster-cta{',
        'display:block;width:100%;',
        'padding:15px;',
        'background:linear-gradient(135deg,#B8860B,#D4A853,#FFD700,#D4A853,#B8860B);',
        'background-size:200% auto;',
        'border:none;border-radius:10px;',
        'color:#13151C;font-weight:900;font-size:16px;',
        'letter-spacing:0.5px;text-transform:uppercase;',
        'cursor:pointer;text-decoration:none;',
        'text-align:center;',
        'transition:background-position 0.4s,box-shadow 0.2s;',
        'box-shadow:0 4px 20px rgba(212,168,83,0.4);',
        'margin-bottom:16px;',
      '}',

      '#ms-booster-cta:hover{',
        'background-position:right center;',
        'box-shadow:0 6px 28px rgba(212,168,83,0.65);',
      '}',

      '#ms-booster-cta:focus-visible{outline:3px solid #FFD700;outline-offset:3px}',

      /* Sign-in row */
      '#ms-booster-signin{',
        'text-align:center;font-size:12px;color:#9AA0B2;margin-bottom:14px;',
      '}',

      '#ms-booster-signin a{color:#D4A853;text-decoration:none;}',
      '#ms-booster-signin a:hover{text-decoration:underline;}',

      /* Responsible gambling */
      '#ms-booster-rg{',
        'text-align:center;font-size:11px;color:#5A6070;',
        'padding-bottom:4px;',
      '}',

      /* Mobile: full screen below 520px */
      '@media(max-width:519px){',
        '#ms-booster-overlay{padding:0;align-items:flex-end;}',
        '#ms-booster-card{max-width:100%;border-radius:20px 20px 0 0;border-bottom:none;}',
        '#ms-booster-body{padding:20px 20px 24px;}',
      '}',
    ].join('');
    document.head.appendChild(style);
  }

  /* ------------------------------------------------------------------ */
  /* HTML INJECTION                                                       */
  /* ------------------------------------------------------------------ */
  function buildModal() {
    var overlay = document.createElement('div');
    overlay.id = 'ms-booster-overlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-labelledby', 'ms-booster-headline');
    overlay.setAttribute('aria-describedby', 'ms-booster-sub');

    overlay.innerHTML = [
      '<div id="ms-booster-card">',

        /* Header */
        '<div id="ms-booster-header">',
          '<span id="ms-booster-reel" aria-hidden="true">&#127920;</span>',
          '<div id="ms-booster-header-text">Matrix Spins &mdash; Exclusive Offer</div>',
        '</div>',

        /* Close */
        '<button id="ms-booster-close" aria-label="Close this offer">&#10005;</button>',

        /* Body */
        '<div id="ms-booster-body">',

          '<h2 id="ms-booster-headline">YOU\'RE ON A ROLL!</h2>',
          '<p id="ms-booster-sub">Turn your hot streak into real cash</p>',

          /* Offer box */
          '<div id="ms-booster-offer" role="region" aria-label="Current offer">',
            '<div id="ms-booster-offer-title">100% Match on First Deposit</div>',
            '<div id="ms-booster-offer-detail">Deposit $100 &rarr; Play with $200</div>',
          '</div>',

          /* Countdown */
          '<div id="ms-booster-timer-wrap" aria-live="polite" aria-atomic="true">',
            '<div id="ms-booster-timer">10:00</div>',
            '<div id="ms-booster-timer-label">This offer expires in</div>',
          '</div>',

          /* Last-chance message (shown when timer = 0) */
          '<div id="ms-booster-last-chance" aria-live="assertive">⚡ LAST CHANCE &mdash; Bonus still active!</div>',

          /* Quick-select amounts */
          '<div id="ms-booster-amounts" role="group" aria-label="Select deposit amount">',
            '<button class="ms-amount-btn" data-amount="25" aria-pressed="false">$25</button>',
            '<button class="ms-amount-btn" data-amount="50" aria-pressed="false">$50</button>',
            '<button class="ms-amount-btn ms-selected" data-amount="100" aria-pressed="true">$100</button>',
          '</div>',

          /* Play-with label */
          '<div id="ms-booster-play-with">',
            'You\'ll play with: <span id="ms-booster-play-amount">$200.00</span>',
          '</div>',

          /* CTA */
          '<a id="ms-booster-cta" href="wallet.html?amount=100&promo=booster100" role="button" aria-label="Claim 100% bonus now with $100 deposit">',
            '&rarr; CLAIM MY BONUS NOW',
          '</a>',

          /* Sign-in */
          '<div id="ms-booster-signin">',
            'Already have an account? <a href="login.html" id="ms-booster-signin-link">Sign In</a>',
          '</div>',

          /* Responsible gambling */
          '<div id="ms-booster-rg">18+ | Gamble Responsibly | T&amp;Cs Apply</div>',

        '</div>', // /body
      '</div>', // /card
    ].join('');

    return overlay;
  }

  /* ------------------------------------------------------------------ */
  /* FOCUS TRAP                                                           */
  /* ------------------------------------------------------------------ */
  function getFocusable(container) {
    return Array.prototype.slice.call(
      container.querySelectorAll(
        'a[href],button:not([disabled]),input:not([disabled]),[tabindex]:not([tabindex="-1"])'
      )
    );
  }

  function trapFocus(e, container) {
    var nodes = getFocusable(container);
    if (!nodes.length) return;
    var first = nodes[0];
    var last  = nodes[nodes.length - 1];
    if (e.key === 'Tab') {
      if (e.shiftKey) {
        if (document.activeElement === first) { e.preventDefault(); last.focus(); }
      } else {
        if (document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    }
  }

  /* ------------------------------------------------------------------ */
  /* ANALYTICS HELPER                                                     */
  /* ------------------------------------------------------------------ */
  function fireEvent(detail) {
    try {
      window.dispatchEvent(new CustomEvent('ms-booster-event', { detail: detail }));
    } catch (_) {}
  }

  /* ------------------------------------------------------------------ */
  /* COUNTDOWN TIMER                                                      */
  /* ------------------------------------------------------------------ */
  var countdownInterval = null;

  function startCountdown(timerEl, timerWrapEl, lastChanceEl) {
    var storedStart = sessionStorage.getItem(SS_TIMER_START);
    if (!storedStart) {
      storedStart = String(Date.now());
      sessionStorage.setItem(SS_TIMER_START, storedStart);
    }
    var startTime = parseInt(storedStart, 10);

    function tick() {
      var elapsed = Math.floor((Date.now() - startTime) / 1000);
      var remaining = COUNTDOWN_TOTAL_S - elapsed;

      if (remaining <= 0) {
        timerEl.textContent = '00:00';
        timerWrapEl.style.display = 'none';
        lastChanceEl.style.display = 'block';
        clearInterval(countdownInterval);
        countdownInterval = null;
        return;
      }

      var mins = Math.floor(remaining / 60);
      var secs = remaining % 60;
      timerEl.textContent =
        (mins < 10 ? '0' : '') + mins + ':' + (secs < 10 ? '0' : '') + secs;
    }

    tick();
    countdownInterval = setInterval(tick, 1000);
  }

  /* ------------------------------------------------------------------ */
  /* SHOW MODAL                                                           */
  /* ------------------------------------------------------------------ */
  var selectedAmount = 100;
  var modalEl        = null;
  var previousFocus  = null;
  var keyHandler     = null;
  var pulseTimeout   = null;

  function showModal(triggerName) {
    if (isSuppressed()) return;
    if (document.getElementById('ms-booster-overlay')) return;

    injectCSS();

    previousFocus = document.activeElement;
    modalEl = buildModal();
    document.body.appendChild(modalEl);

    sessionStorage.setItem(SS_SHOWN, '1');
    fireEvent({ action: 'shown', trigger: triggerName });
    console.debug('[ms-booster] shown — trigger:', triggerName);

    /* Wire up elements */
    var card       = document.getElementById('ms-booster-card');
    var closeBtn   = document.getElementById('ms-booster-close');
    var amountBtns = modalEl.querySelectorAll('.ms-amount-btn');
    var ctaLink    = document.getElementById('ms-booster-cta');
    var playAmt    = document.getElementById('ms-booster-play-amount');
    var timerEl    = document.getElementById('ms-booster-timer');
    var timerWrap  = document.getElementById('ms-booster-timer-wrap');
    var lastChance = document.getElementById('ms-booster-last-chance');

    /* Set initial state */
    updateCTA();

    /* Amount selection */
    function updateCTA() {
      var play = (selectedAmount * BONUS_MULTIPLIER).toFixed(2);
      playAmt.textContent = '$' + play;
      ctaLink.href = WALLET_URL + '?amount=' + selectedAmount + '&promo=' + PROMO_CODE;
      ctaLink.setAttribute('aria-label', 'Claim 100% bonus now with $' + selectedAmount + ' deposit');
    }

    amountBtns.forEach(function (btn) {
      btn.addEventListener('click', function () {
        amountBtns.forEach(function (b) {
          b.classList.remove('ms-selected');
          b.setAttribute('aria-pressed', 'false');
        });
        btn.classList.add('ms-selected');
        btn.setAttribute('aria-pressed', 'true');
        selectedAmount = parseInt(btn.getAttribute('data-amount'), 10);
        updateCTA();
      });
    });

    /* CTA click analytics */
    ctaLink.addEventListener('click', function () {
      fireEvent({ action: 'clicked', amount: selectedAmount });
    });

    /* Close */
    function dismiss() {
      localStorage.setItem(LS_DISMISSED, String(Date.now()));
      cleanup();
      fireEvent({ action: 'dismissed' });
      console.debug('[ms-booster] dismissed');
    }

    closeBtn.addEventListener('click', dismiss);

    /* ESC key */
    keyHandler = function (e) {
      if (e.key === 'Escape') { dismiss(); return; }
      trapFocus(e, modalEl);
    };
    document.addEventListener('keydown', keyHandler);

    /* Click outside card */
    modalEl.addEventListener('click', function (e) {
      if (e.target === modalEl) dismiss();
    });

    /* Initial focus on close button for accessibility */
    closeBtn.focus();

    /* Start countdown */
    startCountdown(timerEl, timerWrap, lastChance);

    /* Add pulsing border after 30 s */
    pulseTimeout = setTimeout(function () {
      if (card) card.classList.add('ms-pulse');
    }, PULSE_DELAY_MS);
  }

  /* ------------------------------------------------------------------ */
  /* CLEANUP                                                              */
  /* ------------------------------------------------------------------ */
  function cleanup() {
    if (countdownInterval) { clearInterval(countdownInterval); countdownInterval = null; }
    if (pulseTimeout)      { clearTimeout(pulseTimeout);       pulseTimeout = null; }
    if (keyHandler)        { document.removeEventListener('keydown', keyHandler); keyHandler = null; }
    if (modalEl && modalEl.parentNode) { modalEl.parentNode.removeChild(modalEl); }
    modalEl = null;
    if (previousFocus && previousFocus.focus) { try { previousFocus.focus(); } catch (_) {} }
    previousFocus = null;
    clearAllTriggers();
  }

  /* ------------------------------------------------------------------ */
  /* TRIGGER MANAGEMENT                                                   */
  /* ------------------------------------------------------------------ */
  var pollingInterval = null;
  var timeTrigger     = null;
  var spinListener    = null;
  var exitListener    = null;

  function clearAllTriggers() {
    if (pollingInterval) { clearInterval(pollingInterval);             pollingInterval = null; }
    if (timeTrigger)     { clearTimeout(timeTrigger);                  timeTrigger     = null; }
    if (spinListener)    { window.removeEventListener('matrix-spin-complete', spinListener); spinListener = null; }
    if (exitListener)    { document.removeEventListener('mouseleave', exitListener);          exitListener = null; }
  }

  function trigger(name) {
    if (isSuppressed()) { clearAllTriggers(); return; }
    clearAllTriggers();
    showModal(name);
  }

  /* ------------------------------------------------------------------ */
  /* TRIGGER 1 — DEMO SPIN COUNT                                         */
  /* ------------------------------------------------------------------ */
  function setupSpinTrigger() {
    // Via custom event
    spinListener = function () {
      if (isSuppressed()) return;
      var spins = parseInt(localStorage.getItem(LS_DEMO_SPINS) || '0', 10);
      if (spins >= DEMO_SPIN_THRESHOLD) trigger('demo_spins');
    };
    window.addEventListener('matrix-spin-complete', spinListener);
  }

  /* ------------------------------------------------------------------ */
  /* TRIGGER 2 — TIME ON PAGE (first visit only)                        */
  /* ------------------------------------------------------------------ */
  function setupTimeTrigger() {
    // Only fire for first visit (no session shown yet covered by isSuppressed,
    // but also only if this is first page visit — check referrer is same site)
    var isReturn = document.referrer &&
      document.referrer.indexOf(window.location.hostname) !== -1;
    if (isReturn) return;

    timeTrigger = setTimeout(function () {
      trigger('time_on_page');
    }, TIME_ON_PAGE_MS);
  }

  /* ------------------------------------------------------------------ */
  /* TRIGGER 3 — EXIT INTENT (desktop only)                             */
  /* ------------------------------------------------------------------ */
  function setupExitIntent() {
    var isMobile = window.matchMedia && window.matchMedia('(max-width:768px)').matches;
    if (isMobile) return;
    if ('ontouchstart' in window) return;

    exitListener = function (e) {
      if (e.clientY > 20) return; // cursor above top 20px
      if (isSuppressed()) return;
      trigger('exit_intent');
    };
    document.addEventListener('mouseleave', exitListener);
  }

  /* ------------------------------------------------------------------ */
  /* TRIGGER 4 — LOW DEMO BALANCE (polling)                             */
  /* ------------------------------------------------------------------ */
  function setupBalancePoll() {
    pollingInterval = setInterval(function () {
      if (isSuppressed()) { clearInterval(pollingInterval); return; }

      // Check localStorage spins (catches spin count even without events)
      var spins = parseInt(localStorage.getItem(LS_DEMO_SPINS) || '0', 10);
      if (spins >= DEMO_SPIN_THRESHOLD) { trigger('demo_spins'); return; }

      // Check demo balance
      if (window.MSPlayer && typeof window.MSPlayer.demoBalance === 'number') {
        if (window.MSPlayer.demoBalance < LOW_DEMO_BALANCE) {
          trigger('low_demo_balance');
          return;
        }
      }
    }, POLL_INTERVAL_MS);
  }

  /* ------------------------------------------------------------------ */
  /* BOOT                                                                 */
  /* ------------------------------------------------------------------ */
  function boot() {
    if (isSuppressed()) {
      console.debug('[ms-booster] suppressed — skipping all triggers');
      return;
    }

    setupSpinTrigger();
    setupTimeTrigger();
    setupExitIntent();
    setupBalancePoll();

    console.debug('[ms-booster] active — watching for triggers');
  }

  /* Run after DOM is ready */
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

})();
