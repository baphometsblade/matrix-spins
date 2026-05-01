/* ============================================================
   Matrix Spins Casino — Progressive Onboarding System
   Self-contained IIFE · Gold/Dark Theme · Auto-injecting CSS
   ============================================================ */
(function () {
  'use strict';

  /* ── Constants ─────────────────────────────────────────── */
  var LS = {
    TOUR_DONE:    'mx_onboarding_tour_done',
    VISIT_COUNT:  'mx_onboarding_visits',
    PROGRESS:     'mx_onboarding_progress',   // JSON array of completed step ids
    BAR_HIDDEN:   'mx_onboarding_bar_hidden',
    TOOLTIPS:     'mx_onboarding_tooltips'     // JSON array of dismissed tooltip keys
  };

  var GOLD       = '#d4af37';
  var GOLD_LIGHT = '#f5d76e';
  var GOLD_DIM   = 'rgba(212,175,55,.25)';
  var DARK_BG    = 'rgba(15,15,20,.96)';
  var GLASS      = 'rgba(22,22,30,.92)';
  var GLASS_BORDER = 'rgba(212,175,55,.35)';
  var OVERLAY_BG = 'rgba(0,0,0,.85)';
  var WHITE      = '#f0f0f0';
  var MUTED      = '#999';
  var Z_TOUR     = 9800;
  var Z_TOOLTIP  = 8200;
  var Z_BAR      = 7000;

  /* ── Helpers ───────────────────────────────────────────── */
  function lsGet(k, fallback) {
    try { var v = localStorage.getItem(k); return v === null ? fallback : v; }
    catch (e) { return fallback; }
  }
  function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
  function lsJSON(k, fb) { try { return JSON.parse(lsGet(k, null)) || fb; } catch (e) { return fb; } }

  function el(tag, attrs, children) {
    var node = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      if (k === 'className') node.className = attrs[k];
      else if (k === 'innerHTML') node.innerHTML = attrs[k];
      else if (k === 'textContent') node.textContent = attrs[k];
      else if (k.slice(0, 2) === 'on') node.addEventListener(k.slice(2).toLowerCase(), attrs[k]);
      else node.setAttribute(k, attrs[k]);
    });
    if (children) children.forEach(function (c) {
      if (typeof c === 'string') node.appendChild(document.createTextNode(c));
      else if (c) node.appendChild(c);
    });
    return node;
  }

  /* ── Inject CSS (once) ─────────────────────────────────── */
  function injectCSS() {
    if (document.getElementById('mx-onboarding-css')) return;
    var style = document.createElement('style');
    style.id = 'mx-onboarding-css';
    style.textContent = [
      /* ---- Tour Overlay ---- */
      '.mx-tour-overlay{position:fixed;inset:0;z-index:' + Z_TOUR + ';background:' + OVERLAY_BG + ';display:flex;align-items:center;justify-content:center;opacity:0;transition:opacity .4s ease;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif}',
      '.mx-tour-overlay.mx-show{opacity:1}',
      '.mx-tour-card{position:relative;width:92vw;max-width:520px;background:' + GLASS + ';border:1.5px solid ' + GLASS_BORDER + ';border-radius:16px;overflow:hidden;box-shadow:0 24px 80px rgba(0,0,0,.6),0 0 40px ' + GOLD_DIM + '}',
      '.mx-tour-inner{position:relative;overflow:hidden}',
      '.mx-tour-slides{display:flex;transition:transform .45s cubic-bezier(.4,0,.2,1)}',
      '.mx-tour-slide{flex:0 0 100%;padding:36px 32px 28px;box-sizing:border-box;min-height:340px;display:flex;flex-direction:column;align-items:center;text-align:center}',
      '.mx-tour-slide h2{color:' + GOLD + ';font-size:22px;margin:0 0 14px;font-weight:700;line-height:1.3}',
      '.mx-tour-slide p{color:' + WHITE + ';font-size:14.5px;line-height:1.55;margin:0 0 18px;max-width:420px}',
      '.mx-tour-slide .mx-sub{color:' + MUTED + ';font-size:13px}',

      /* Chips animation */
      '.mx-chips{display:flex;gap:10px;margin-bottom:18px}',
      '.mx-chip{width:40px;height:40px;border-radius:50%;border:3px solid ' + GOLD + ';display:flex;align-items:center;justify-content:center;font-size:18px;animation:mx-chip-bounce 1.8s ease infinite}',
      '.mx-chip:nth-child(2){animation-delay:.2s}',
      '.mx-chip:nth-child(3){animation-delay:.4s}',
      '@keyframes mx-chip-bounce{0%,100%{transform:translateY(0)}50%{transform:translateY(-8px)}}',

      /* Features list */
      '.mx-features{list-style:none;padding:0;margin:0 0 8px;width:100%;text-align:left}',
      '.mx-features li{display:flex;align-items:center;gap:10px;padding:10px 0;color:' + WHITE + ';font-size:14px;border-bottom:1px solid rgba(255,255,255,.06)}',
      '.mx-features li:last-child{border:none}',
      '.mx-features .mx-fi{font-size:20px;flex-shrink:0;width:28px;text-align:center}',

      /* Deposit tiers */
      '.mx-tiers{display:grid;grid-template-columns:1fr 1fr;gap:10px;width:100%;margin-bottom:10px}',
      '.mx-tier{background:rgba(212,175,55,.08);border:1px solid ' + GLASS_BORDER + ';border-radius:10px;padding:14px 10px;cursor:pointer;text-decoration:none;transition:background .2s,border-color .2s,transform .15s}',
      '.mx-tier:hover{background:rgba(212,175,55,.18);border-color:' + GOLD + ';transform:translateY(-2px)}',
      '.mx-tier .mx-amt{color:' + GOLD + ';font-size:22px;font-weight:700;display:block}',
      '.mx-tier .mx-bonus{color:' + GOLD_LIGHT + ';font-size:13px;margin-top:4px;display:block}',
      '.mx-tier .mx-total{color:' + MUTED + ';font-size:12px;margin-top:2px;display:block}',

      /* Unlocked list */
      '.mx-unlocked{list-style:none;padding:0;margin:0;width:100%;text-align:left}',
      '.mx-unlocked li{display:flex;align-items:center;gap:10px;padding:9px 0;color:' + WHITE + ';font-size:14px}',
      '.mx-unlocked .mx-ui{font-size:18px;flex-shrink:0;width:26px;text-align:center}',

      /* Progress dots */
      '.mx-dots{display:flex;gap:8px;margin:20px 0 0}',
      '.mx-dot{width:10px;height:10px;border-radius:50%;border:2px solid ' + GOLD + ';background:transparent;transition:background .3s}',
      '.mx-dot.mx-active{background:' + GOLD + '}',

      /* Buttons */
      '.mx-tour-btns{display:flex;gap:10px;margin-top:auto;padding-top:16px;width:100%;justify-content:center}',
      '.mx-btn{padding:10px 22px;border-radius:8px;font-size:14px;font-weight:600;cursor:pointer;border:none;transition:background .2s,transform .12s}',
      '.mx-btn:active{transform:scale(.97)}',
      '.mx-btn-primary{background:' + GOLD + ';color:#111}',
      '.mx-btn-primary:hover{background:' + GOLD_LIGHT + '}',
      '.mx-btn-secondary{background:rgba(255,255,255,.08);color:' + WHITE + ';border:1px solid rgba(255,255,255,.15)}',
      '.mx-btn-secondary:hover{background:rgba(255,255,255,.14)}',
      '.mx-tour-skip{position:absolute;top:14px;right:16px;background:none;border:none;color:' + MUTED + ';font-size:13px;cursor:pointer;z-index:2;padding:4px 8px}',
      '.mx-tour-skip:hover{color:' + WHITE + '}',

      /* ---- Floating Progress Bar ---- */
      '.mx-bar{position:fixed;bottom:0;left:0;right:0;z-index:' + Z_BAR + ';font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;transition:transform .35s ease}',
      '.mx-bar.mx-collapsed{transform:translateY(calc(100% - 32px))}',
      '.mx-bar-toggle{position:absolute;top:-32px;right:20px;width:36px;height:32px;background:' + GLASS + ';border:1px solid ' + GLASS_BORDER + ';border-bottom:none;border-radius:8px 8px 0 0;display:flex;align-items:center;justify-content:center;cursor:pointer;color:' + GOLD + ';font-size:16px;transition:transform .3s}',
      '.mx-collapsed .mx-bar-toggle{transform:rotate(180deg)}',
      '.mx-bar-body{background:' + GLASS + ';border-top:1px solid ' + GLASS_BORDER + ';backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);padding:10px 20px;display:flex;align-items:center;gap:18px;overflow-x:auto;min-height:48px}',
      '.mx-bar-title{color:' + GOLD + ';font-size:13px;font-weight:600;white-space:nowrap;flex-shrink:0}',
      '.mx-bar-steps{display:flex;gap:14px;flex-shrink:0}',
      '.mx-bar-step{display:flex;align-items:center;gap:6px;font-size:13px;color:' + WHITE + ';text-decoration:none;white-space:nowrap;transition:color .2s}',
      '.mx-bar-step:hover{color:' + GOLD + '}',
      '.mx-bar-step.mx-done{color:' + MUTED + ';text-decoration:line-through}',
      '.mx-bar-step .mx-check{font-size:14px;flex-shrink:0}',
      '.mx-bar-bonus{color:' + GOLD_LIGHT + ';font-size:11px;margin-left:2px}',

      /* ---- Contextual Tooltips ---- */
      '.mx-tooltip{position:fixed;z-index:' + Z_TOOLTIP + ';max-width:320px;background:' + GLASS + ';border:1px solid ' + GOLD + ';border-radius:10px;padding:14px 18px;color:' + WHITE + ';font-size:13.5px;line-height:1.5;box-shadow:0 8px 32px rgba(0,0,0,.5);opacity:0;transform:translateY(8px);transition:opacity .35s,transform .35s;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif}',
      '.mx-tooltip.mx-show{opacity:1;transform:translateY(0)}',
      '.mx-tooltip::after{content:"";position:absolute;bottom:-8px;left:24px;width:14px;height:14px;background:' + GLASS + ';border-right:1px solid ' + GOLD + ';border-bottom:1px solid ' + GOLD + ';transform:rotate(45deg)}',
      '.mx-tooltip-close{position:absolute;top:6px;right:10px;background:none;border:none;color:' + MUTED + ';cursor:pointer;font-size:16px;line-height:1;padding:2px 4px}',
      '.mx-tooltip-close:hover{color:' + WHITE + '}',
      '.mx-tooltip-icon{color:' + GOLD + ';font-weight:700;margin-right:4px}',

      /* ---- Responsive ---- */
      '@media(max-width:560px){',
        '.mx-tour-slide{padding:28px 18px 22px}',
        '.mx-tour-slide h2{font-size:19px}',
        '.mx-tiers{grid-template-columns:1fr 1fr;gap:8px}',
        '.mx-tier .mx-amt{font-size:18px}',
        '.mx-bar-body{padding:8px 12px;gap:10px}',
        '.mx-bar-steps{gap:10px}',
        '.mx-tooltip{max-width:280px;font-size:13px;padding:12px 14px}',
      '}',
      '@media(max-width:380px){',
        '.mx-tiers{grid-template-columns:1fr;gap:6px}',
        '.mx-tour-card{border-radius:12px}',
      '}'
    ].join('\n');
    document.head.appendChild(style);
  }

  /* ================================================================
     1. WELCOME TOUR
     ================================================================ */
  function buildTourOverlay() {
    /* --- Step 1: Welcome --- */
    var step1 = el('div', { className: 'mx-tour-slide' }, [
      el('div', { className: 'mx-chips' }, [
        el('span', { className: 'mx-chip', textContent: '🎰' }),
        el('span', { className: 'mx-chip', textContent: '💰' }),
        el('span', { className: 'mx-chip', textContent: '⭐' })
      ]),
      el('h2', { innerHTML: 'Welcome to Matrix Spins! 🎰' }),
      el('p', { textContent: 'You\'ve just stepped into the ultimate online casino experience. Over 100 premium games, lightning-fast payouts, and a welcome bonus that will supercharge your bankroll.' }),
      el('p', { className: 'mx-sub', textContent: 'Let us show you around — it only takes 30 seconds.' })
    ]);

    /* --- Step 2: Welcome Bonus --- */
    var featureData = [
      ['🎯', '200% match on your first deposit — up to $1,000'],
      ['🔒', 'Provably fair games verified on-chain'],
      ['⚡',        'Instant withdrawals, no waiting period']
    ];
    var featureList = el('ul', { className: 'mx-features' });
    featureData.forEach(function (f) {
      featureList.appendChild(el('li', null, [
        el('span', { className: 'mx-fi', textContent: f[0] }),
        el('span', { textContent: f[1] })
      ]));
    });
    var step2 = el('div', { className: 'mx-tour-slide' }, [
      el('h2', { textContent: 'Claim Your Welcome Bonus' }),
      el('p', { textContent: 'Start strong with a massive 200% deposit match. Every dollar you deposit is tripled — giving you 3x the playtime and 3x the chances to win big.' }),
      featureList
    ]);

    /* --- Step 3: Deposit Tiers --- */
    var tiers = [
      { amount: 10,  bonus: 20 },
      { amount: 25,  bonus: 50 },
      { amount: 50,  bonus: 100 },
      { amount: 100, bonus: 200 }
    ];
    var tierGrid = el('div', { className: 'mx-tiers' });
    tiers.forEach(function (t) {
      tierGrid.appendChild(
        el('a', { className: 'mx-tier', href: '/wallet.html?amount=' + t.amount }, [
          el('span', { className: 'mx-amt', textContent: '$' + t.amount }),
          el('span', { className: 'mx-bonus', textContent: '+$' + t.bonus + ' bonus' }),
          el('span', { className: 'mx-total', textContent: 'Play with $' + (t.amount + t.bonus) })
        ])
      );
    });
    var step3 = el('div', { className: 'mx-tour-slide' }, [
      el('h2', { textContent: 'Make Your First Deposit' }),
      el('p', { textContent: 'Choose a deposit amount and your 200% bonus is applied instantly. Pick the tier that fits your style.' }),
      tierGrid
    ]);

    /* --- Step 4: All Set --- */
    var unlockData = [
      ['🎰', 'Daily free spins — every 24 hours'],
      ['🏆', 'VIP points on every wager'],
      ['💵', '$50 for every friend you refer'],
      ['🎁', 'Exclusive weekly promotions']
    ];
    var unlockList = el('ul', { className: 'mx-unlocked' });
    unlockData.forEach(function (u) {
      unlockList.appendChild(el('li', null, [
        el('span', { className: 'mx-ui', textContent: u[0] }),
        el('span', { textContent: u[1] })
      ]));
    });
    var step4 = el('div', { className: 'mx-tour-slide' }, [
      el('h2', { textContent: 'You\'re All Set! 🎉' }),
      el('p', { textContent: 'Here\'s what you\'ve unlocked as a Matrix Spins player:' }),
      unlockList
    ]);

    /* --- Assemble slides container --- */
    var slides = el('div', { className: 'mx-tour-slides' }, [step1, step2, step3, step4]);
    var totalSteps = 4;
    var currentStep = 0;

    /* --- Progress dots --- */
    var dotsWrap = el('div', { className: 'mx-dots' });
    var dots = [];
    for (var i = 0; i < totalSteps; i++) {
      var d = el('span', { className: 'mx-dot' + (i === 0 ? ' mx-active' : '') });
      dots.push(d);
      dotsWrap.appendChild(d);
    }

    /* --- Navigation buttons --- */
    var btnBack = el('button', { className: 'mx-btn mx-btn-secondary', textContent: 'Back' });
    var btnNext = el('button', { className: 'mx-btn mx-btn-primary', textContent: 'Get Started' });
    var btnRow  = el('div', { className: 'mx-tour-btns' }, [btnBack, btnNext, dotsWrap]);
    var btnSkip = el('button', { className: 'mx-tour-skip', textContent: 'Skip' });

    function goTo(idx) {
      if (idx < 0 || idx >= totalSteps) return;
      currentStep = idx;
      slides.style.transform = 'translateX(-' + (idx * 100) + '%)';
      dots.forEach(function (d, di) {
        d.className = 'mx-dot' + (di <= idx ? ' mx-active' : '');
      });
      btnBack.style.display = idx === 0 ? 'none' : '';
      if (idx === totalSteps - 1) {
        btnNext.textContent = 'Start Playing';
      } else if (idx === 0) {
        btnNext.textContent = 'Get Started';
      } else {
        btnNext.textContent = 'Next';
      }
    }

    function closeTour() {
      overlay.classList.remove('mx-show');
      setTimeout(function () { if (overlay.parentNode) overlay.parentNode.removeChild(overlay); }, 450);
      lsSet(LS.TOUR_DONE, '1');
      showProgressBar();
    }

    btnNext.addEventListener('click', function () {
      if (currentStep < totalSteps - 1) goTo(currentStep + 1);
      else closeTour();
    });
    btnBack.addEventListener('click', function () { goTo(currentStep - 1); });
    btnSkip.addEventListener('click', closeTour);

    /* --- Build card --- */
    var card = el('div', { className: 'mx-tour-card' }, [
      btnSkip,
      el('div', { className: 'mx-tour-inner' }, [slides]),
      btnRow
    ]);

    var overlay = el('div', { className: 'mx-tour-overlay' }, [card]);

    /* Prevent background scroll */
    overlay.addEventListener('click', function (e) {
      if (e.target === overlay) closeTour();
    });

    goTo(0);
    return overlay;
  }

  function launchTour() {
    injectCSS();
    var overlay = buildTourOverlay();
    document.body.appendChild(overlay);
    // Force reflow then show
    overlay.offsetHeight; // eslint-disable-line no-unused-expressions
    requestAnimationFrame(function () { overlay.classList.add('mx-show'); });
    // Disable body scroll
    document.body.style.overflow = 'hidden';
    var obs = new MutationObserver(function () {
      if (!document.querySelector('.mx-tour-overlay')) {
        document.body.style.overflow = '';
        obs.disconnect();
      }
    });
    obs.observe(document.body, { childList: true });
  }

  /* ================================================================
     2. FLOATING PROGRESS BAR
     ================================================================ */
  var progressSteps = [
    { id: 'visit',    label: 'Visit site',     link: null,                           bonus: 10 },
    { id: 'signup',   label: 'Create account',  link: '/signup.html',                 bonus: 25 },
    { id: 'verify',   label: 'Verify email',    link: '/account.html',                bonus: 15 },
    { id: 'deposit',  label: 'First deposit',   link: '/wallet.html',                 bonus: 50 },
    { id: 'play',     label: 'Play first game', link: '/games/pharaohs-fortune.html', bonus: 20 }
  ];

  function getCompleted() { return lsJSON(LS.PROGRESS, ['visit']); }
  function markCompleted(id) {
    var arr = getCompleted();
    if (arr.indexOf(id) === -1) { arr.push(id); lsSet(LS.PROGRESS, JSON.stringify(arr)); }
  }

  function showProgressBar() {
    if (document.querySelector('.mx-bar')) return;
    var visits = parseInt(lsGet(LS.VISIT_COUNT, '0'), 10);
    if (visits > 5) return;
    injectCSS();

    var completed = getCompleted();
    var collapsed = lsGet(LS.BAR_HIDDEN, '0') === '1';

    var stepsWrap = el('div', { className: 'mx-bar-steps' });
    progressSteps.forEach(function (s) {
      var done = completed.indexOf(s.id) !== -1;
      var icon = done ? '✅' : '⬜';
      var stepEl;
      if (s.link && !done) {
        stepEl = el('a', { className: 'mx-bar-step', href: s.link }, [
          el('span', { className: 'mx-check', textContent: icon }),
          el('span', { textContent: s.label }),
          el('span', { className: 'mx-bar-bonus', textContent: '+' + s.bonus + ' credits' })
        ]);
      } else {
        stepEl = el('span', { className: 'mx-bar-step' + (done ? ' mx-done' : '') }, [
          el('span', { className: 'mx-check', textContent: icon }),
          el('span', { textContent: s.label }),
          done ? null : el('span', { className: 'mx-bar-bonus', textContent: '+' + s.bonus + ' credits' })
        ]);
      }
      stepsWrap.appendChild(stepEl);
    });

    var totalDone = completed.length;
    var pct = Math.round((totalDone / progressSteps.length) * 100);

    var toggle = el('div', { className: 'mx-bar-toggle', innerHTML: '▲' });
    var body = el('div', { className: 'mx-bar-body' }, [
      el('span', { className: 'mx-bar-title', textContent: 'Profile ' + pct + '% complete' }),
      stepsWrap
    ]);

    var bar = el('div', { className: 'mx-bar' + (collapsed ? ' mx-collapsed' : '') }, [toggle, body]);

    toggle.addEventListener('click', function () {
      var isCollapsed = bar.classList.toggle('mx-collapsed');
      lsSet(LS.BAR_HIDDEN, isCollapsed ? '1' : '0');
    });

    document.body.appendChild(bar);
  }

  /* ================================================================
     3. CONTEXTUAL TOOLTIPS
     ================================================================ */
  var tooltipDefs = [
    {
      key: 'wallet',
      pathMatch: /\/wallet\.html/i,
      text: 'Pro tip: Start with $25 — it\'s the most popular tier with the best bonus ratio!',
      top: 120,
      left: 40
    },
    {
      key: 'games',
      pathMatch: /\/games\/?$/i,
      altMatch: /\/games\.html/i,
      text: 'Try our most popular game — Pharaoh\'s Fortune! 96.5% RTP',
      top: 120,
      left: 40
    },
    {
      key: 'vip',
      pathMatch: /\/vip/i,
      text: 'Every $1 you wager earns VIP points. Gold tier unlocks 2% cashback!',
      top: 120,
      left: 40
    }
  ];

  function showTooltips() {
    injectCSS();
    var dismissed = lsJSON(LS.TOOLTIPS, []);
    var path = window.location.pathname;

    tooltipDefs.forEach(function (def) {
      if (dismissed.indexOf(def.key) !== -1) return;
      var match = def.pathMatch.test(path) || (def.altMatch && def.altMatch.test(path));
      if (!match) return;

      var closeBtn = el('button', { className: 'mx-tooltip-close', innerHTML: '&times;' });
      var tip = el('div', { className: 'mx-tooltip' }, [
        closeBtn,
        el('span', { className: 'mx-tooltip-icon', textContent: '💡' }),
        el('span', { textContent: ' ' + def.text })
      ]);
      tip.style.top  = def.top + 'px';
      tip.style.left = def.left + 'px';
      document.body.appendChild(tip);

      // Force reflow
      tip.offsetHeight; // eslint-disable-line
      requestAnimationFrame(function () { tip.classList.add('mx-show'); });

      function dismiss() {
        tip.classList.remove('mx-show');
        setTimeout(function () { if (tip.parentNode) tip.parentNode.removeChild(tip); }, 400);
        var arr = lsJSON(LS.TOOLTIPS, []);
        if (arr.indexOf(def.key) === -1) { arr.push(def.key); lsSet(LS.TOOLTIPS, JSON.stringify(arr)); }
      }
      closeBtn.addEventListener('click', dismiss);
      setTimeout(dismiss, 8000);
    });
  }

  /* ================================================================
     4. PUBLIC API
     ================================================================ */
  window.MatrixOnboarding = {
    startTour: function () {
      // Remove existing tour if any
      var existing = document.querySelector('.mx-tour-overlay');
      if (existing) existing.parentNode.removeChild(existing);
      launchTour();
    },
    skipAll: function () {
      lsSet(LS.TOUR_DONE, '1');
      var overlay = document.querySelector('.mx-tour-overlay');
      if (overlay) {
        overlay.classList.remove('mx-show');
        setTimeout(function () { if (overlay.parentNode) overlay.parentNode.removeChild(overlay); }, 450);
      }
      var bar = document.querySelector('.mx-bar');
      if (bar) bar.parentNode.removeChild(bar);
      lsSet(LS.BAR_HIDDEN, '1');
      document.body.style.overflow = '';
    },
    resetProgress: function () {
      Object.keys(LS).forEach(function (k) {
        try { localStorage.removeItem(LS[k]); } catch (e) {}
      });
      var overlay = document.querySelector('.mx-tour-overlay');
      if (overlay) overlay.parentNode.removeChild(overlay);
      var bar = document.querySelector('.mx-bar');
      if (bar) bar.parentNode.removeChild(bar);
      var tips = document.querySelectorAll('.mx-tooltip');
      tips.forEach(function (t) { t.parentNode.removeChild(t); });
      document.body.style.overflow = '';
    }
  };

  /* ================================================================
     5. AUTO-INIT
     ================================================================ */
  function init() {
    // Track visits
    var visits = parseInt(lsGet(LS.VISIT_COUNT, '0'), 10) + 1;
    lsSet(LS.VISIT_COUNT, String(visits));

    // Mark "visit" as completed
    markCompleted('visit');

    var tourDone = lsGet(LS.TOUR_DONE, null);

    if (!tourDone) {
      // First-time visitor: launch tour after 3s
      setTimeout(launchTour, 3000);
    } else {
      // Returning visitor: show progress bar (first 5 visits only)
      showProgressBar();
    }

    // Contextual tooltips on first visit to specific pages
    // Small delay so page content settles
    setTimeout(showTooltips, 1500);
  }

  // Wait for page fully loaded + run init
  if (document.readyState === 'complete') {
    init();
  } else {
    window.addEventListener('load', init);
  }
})();
