/* ============================================================
   Matrix Spins - Conversion Funnel Optimization
   Auto-injecting IIFE — guides new users from signup to deposit
   ============================================================ */
(function () {
  'use strict';

  /* ---------- Config ---------- */
  var WALLET_URL = 'wallet.html';
  var DEMO_SPIN_THRESHOLD = 5;
  var LOW_BAL_DEMO = 100;
  var LOW_BAL_REAL = 5;
  var HIGH_BAL_HIDE_PILL = 500;
  var BIG_WIN_CENTS = 500;
  var RETURN_GAP_MS = 86400000; // 24 h
  var TOAST_DURATION = 8000;

  /* ---------- CSS injection ---------- */
  (function injectCSS() {
    if (document.querySelector('link[data-ms-conversion]')) return;
    var link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = 'css/conversion.css';
    link.dataset.msConversion = '1';
    document.head.appendChild(link);
  })();

  /* ---------- Helpers ---------- */
  function ss(k, v) { if (v === undefined) return sessionStorage.getItem(k); sessionStorage.setItem(k, v); }
  function ls(k, v) { if (v === undefined) return localStorage.getItem(k); localStorage.setItem(k, v); }
  function lsJson(k, v) {
    if (v === undefined) { try { return JSON.parse(localStorage.getItem(k)); } catch (_) { return null; } }
    localStorage.setItem(k, JSON.stringify(v));
  }

  function el(tag, cls, html) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html) e.innerHTML = html;
    return e;
  }

  function remove(node) { if (node && node.parentNode) node.parentNode.removeChild(node); }

  function fireFunnel(stage) {
    window.dispatchEvent(new CustomEvent('matrix-funnel-progress', { detail: { stage: stage } }));
  }

  /* ---------- Funnel State Machine ---------- */
  var STAGES = ['visitor', 'signed_up', 'first_game', 'depositor', 'active_player'];

  function getFunnelStage() { return ls('ms_funnel_stage') || 'visitor'; }

  function advanceFunnel(target) {
    var current = STAGES.indexOf(getFunnelStage());
    var next = STAGES.indexOf(target);
    if (next > current) {
      ls('ms_funnel_stage', target);
      fireFunnel(target);
    }
  }

  /* ---------- Confetti (lightweight canvas) ---------- */
  function spawnConfetti(container) {
    var canvas = el('canvas', 'ms-confetti-canvas');
    container.insertBefore(canvas, container.firstChild);
    var ctx = canvas.getContext('2d');
    var W, H;
    function resize() { W = canvas.width = container.offsetWidth; H = canvas.height = container.offsetHeight; }
    resize();

    var particles = [];
    var colors = ['#d4af37', '#f5d76e', '#fff', '#b8962e', '#e8c84a'];
    for (var i = 0; i < 80; i++) {
      particles.push({
        x: Math.random() * W, y: Math.random() * H - H,
        r: Math.random() * 4 + 2,
        dx: (Math.random() - 0.5) * 3,
        dy: Math.random() * 3 + 1.5,
        color: colors[Math.floor(Math.random() * colors.length)],
        rot: Math.random() * 360,
        dr: (Math.random() - 0.5) * 6
      });
    }

    var frame;
    function draw() {
      ctx.clearRect(0, 0, W, H);
      var alive = false;
      particles.forEach(function (p) {
        p.x += p.dx; p.y += p.dy; p.rot += p.dr;
        if (p.y < H + 10) alive = true;
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot * Math.PI / 180);
        ctx.fillStyle = p.color;
        ctx.fillRect(-p.r, -p.r / 2, p.r * 2, p.r);
        ctx.restore();
      });
      if (alive) frame = requestAnimationFrame(draw);
    }
    draw();

    setTimeout(function () { cancelAnimationFrame(frame); remove(canvas); }, 4000);
  }

  /* ========== 1. Welcome Flow ========== */
  function runWelcomeFlow() {
    if (ss('ms_welcome_done')) return;

    function showStep(step) {
      ss('ms_welcome_step', step);
      remove(document.querySelector('.ms-welcome-overlay'));

      if (step === 1) {
        var overlay = el('div', 'ms-welcome-overlay');
        var card = el('div', 'ms-welcome-card');
        card.innerHTML =
          '<h2>Welcome to Matrix Spins!</h2>' +
          '<p>Your account is ready. Huge wins await inside the matrix.</p>';
        var btnNext = el('button', 'ms-btn-gold', 'Let\'s Go!');
        btnNext.addEventListener('click', function () { showStep(2); });
        card.appendChild(btnNext);
        overlay.appendChild(card);
        document.body.appendChild(overlay);
        spawnConfetti(card);
      }

      if (step === 2) {
        var overlay2 = el('div', 'ms-welcome-overlay');
        var card2 = el('div', 'ms-welcome-card');
        card2.innerHTML =
          '<h2>$1,000 Demo Credits Loaded!</h2>' +
          '<p>Want to play with <strong>REAL money</strong> and win real prizes?</p>';

        var btnDeposit = el('a', 'ms-btn-gold', 'Deposit Now &mdash; Get 100% Match!');
        btnDeposit.href = WALLET_URL;
        card2.appendChild(btnDeposit);

        var btnDemo = el('button', 'ms-btn-outline', 'Play Demo First');
        btnDemo.addEventListener('click', function () {
          ss('ms_welcome_done', '1');
          ss('ms_chose_demo', '1');
          ss('ms_spin_count', '0');
          remove(overlay2);
          advanceFunnel('first_game');
        });
        card2.appendChild(btnDemo);
        overlay2.appendChild(card2);
        document.body.appendChild(overlay2);
      }
    }

    showStep(1);
    advanceFunnel('signed_up');
  }

  /* Step 3: After 5 demo spins, show deposit nudge */
  function trackDemoSpins() {
    if (ss('ms_chose_demo') !== '1') return;
    if (ss('ms_spin_banner_shown')) return;

    window.addEventListener('matrix-spin', function () {
      var count = parseInt(ss('ms_spin_count') || '0', 10) + 1;
      ss('ms_spin_count', String(count));

      if (count >= DEMO_SPIN_THRESHOLD && !ss('ms_spin_banner_shown')) {
        ss('ms_spin_banner_shown', '1');
        showSpinBanner();
      }
    });
  }

  function showSpinBanner() {
    if (document.querySelector('.ms-spin-banner')) return;
    var banner = el('div', 'ms-spin-banner');
    banner.innerHTML =
      '<span class="ms-spin-banner__text">Ready for real wins? Deposit $10+ and we\'ll match it 100%</span>' +
      '<a class="ms-spin-banner__cta" href="' + WALLET_URL + '">Deposit Now</a>';
    document.body.appendChild(banner);

    setTimeout(function () {
      banner.style.animation = 'none';
      banner.style.transform = 'translateY(100%)';
      banner.style.transition = 'transform 0.4s ease';
      setTimeout(function () { remove(banner); }, 500);
    }, 12000);
  }

  /* ========== 2. Low Balance Nudge ========== */
  function watchBalance() {
    if (ss('ms_low_bal_shown')) return;
    var balEl = document.querySelector('.balance-amount') || document.getElementById('balanceDisplay');
    if (!balEl) return;

    var observer = new MutationObserver(function () {
      var raw = (balEl.textContent || '').replace(/[^0-9.]/g, '');
      var val = parseFloat(raw);
      if (isNaN(val)) return;

      var isReal = document.body.classList.contains('real-mode') || ls('ms_funnel_stage') === 'depositor' || ls('ms_funnel_stage') === 'active_player';
      var threshold = isReal ? LOW_BAL_REAL : LOW_BAL_DEMO;

      if (val < threshold && !ss('ms_low_bal_shown')) {
        ss('ms_low_bal_shown', '1');
        observer.disconnect();
        showLowBalBanner();
      }
    });

    observer.observe(balEl, { childList: true, characterData: true, subtree: true });
  }

  function showLowBalBanner() {
    if (document.querySelector('.ms-low-balance')) return;
    var banner = el('div', 'ms-low-balance');
    banner.innerHTML =
      '<span class="ms-low-balance__text">Running low? Deposit now and get a <strong>50% reload bonus!</strong></span>' +
      '<a class="ms-low-balance__cta" href="' + WALLET_URL + '">Deposit</a>' +
      '<button class="ms-low-balance__close" aria-label="Close">&times;</button>';
    banner.querySelector('.ms-low-balance__close').addEventListener('click', function () { remove(banner); });
    document.body.appendChild(banner);
  }

  /* ========== 3. Sticky Deposit CTA ========== */
  function stickyDepositPill() {
    var isGamePage = document.querySelector('.game-container') ||
                     document.querySelector('[data-game-id]') ||
                     /\bgame\b/i.test(document.body.className);
    if (!isGamePage) return;

    // Hide for high-balance users
    var balEl = document.querySelector('.balance-amount') || document.getElementById('balanceDisplay');
    if (balEl) {
      var val = parseFloat((balEl.textContent || '').replace(/[^0-9.]/g, ''));
      if (!isNaN(val) && val > HIGH_BAL_HIDE_PILL) return;
    }

    if (document.querySelector('.ms-deposit-pill')) return;
    var pill = el('a', 'ms-deposit-pill', '&#x1F4B0; Deposit');
    pill.href = WALLET_URL;
    pill.setAttribute('aria-label', 'Deposit funds');
    document.body.appendChild(pill);
  }

  /* ========== 4. Win Celebration Upsell ========== */
  function listenForWins() {
    window.addEventListener('matrix-win', function (e) {
      var amount = (e.detail && e.detail.amount) || 0;
      if (amount < BIG_WIN_CENTS) return;
      showWinToast(amount);
    });
  }

  function showWinToast(amount) {
    remove(document.querySelector('.ms-win-toast'));
    var display = (amount / 100).toFixed(2);
    var toast = el('div', 'ms-win-toast');
    toast.innerHTML =
      '<button class="ms-win-toast__close" aria-label="Close">&times;</button>' +
      '<div class="ms-win-toast__title">&#127881; Amazing Win &mdash; $' + display + '!</div>' +
      '<p class="ms-win-toast__text">Keep the streak going! Deposit more to unlock bigger bets and jackpots.</p>' +
      '<a class="ms-win-toast__cta" href="' + WALLET_URL + '">Deposit Now</a>';
    toast.querySelector('.ms-win-toast__close').addEventListener('click', function () { dismissToast(toast); });
    document.body.appendChild(toast);

    setTimeout(function () { dismissToast(toast); }, TOAST_DURATION);
  }

  function dismissToast(toast) {
    if (!toast || !toast.parentNode) return;
    toast.style.animation = 'msSlideOutRight 0.4s ease forwards';
    setTimeout(function () { remove(toast); }, 450);
  }

  /* ========== 5. Return Visitor Re-engagement ========== */
  function returnVisitor() {
    var now = Date.now();
    var last = parseInt(ls('ms_last_visit') || '0', 10);
    ls('ms_last_visit', String(now));

    if (!last || (now - last) < RETURN_GAP_MS) return;
    if (ss('ms_return_shown')) return;
    ss('ms_return_shown', '1');

    var code = 'WELCOME' + String(Math.floor(Math.random() * 9000) + 1000);

    var banner = el('div', 'ms-return-banner');
    banner.innerHTML =
      '<span class="ms-return-banner__text">Welcome back! Use code <strong>' + code + '</strong> for a special bonus on your next deposit.</span>' +
      '<a class="ms-return-banner__cta" href="' + WALLET_URL + '">Claim Bonus</a>' +
      '<button class="ms-return-banner__close" aria-label="Close">&times;</button>';
    banner.querySelector('.ms-return-banner__close').addEventListener('click', function () { remove(banner); });
    document.body.appendChild(banner);
  }

  /* ========== 6. Funnel listeners (external events) ========== */
  function bindFunnelListeners() {
    // Signup detection
    window.addEventListener('matrix-signup', function () {
      advanceFunnel('signed_up');
      runWelcomeFlow();
    });

    // Spin = first_game
    window.addEventListener('matrix-spin', function () {
      if (getFunnelStage() === 'signed_up') advanceFunnel('first_game');
    });

    // Deposit detection (custom event or wallet page referrer)
    window.addEventListener('matrix-deposit', function () {
      advanceFunnel('depositor');
    });

    // After multiple deposits → active
    window.addEventListener('matrix-deposit', function () {
      var count = parseInt(ls('ms_deposit_count') || '0', 10) + 1;
      ls('ms_deposit_count', String(count));
      if (count >= 2) advanceFunnel('active_player');
    });
  }

  /* ========== Init ========== */
  function init() {
    bindFunnelListeners();

    // Check for new signup via sessionStorage flag
    var isNew = ss('ms_new_user');
    if (isNew && !ss('ms_welcome_done')) {
      runWelcomeFlow();
    }

    trackDemoSpins();
    watchBalance();
    stickyDepositPill();
    listenForWins();
    returnVisitor();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
