/**
 * Matrix Spins Casino — Social Proof Notification System
 * Auto-injecting IIFE module. No dependencies.
 * Drives urgency via live player count, deposit/jackpot toasts, signup counter.
 * API: window.MatrixSocialProof.pause() / .resume() / .hide()
 */
(function () {
  'use strict';

  /* ─── CONFIG ─── */
  var CFG = {
    playerCountBase: 2847,
    playerFluctuateRange: [1, 15],
    playerFluctuateInterval: [10000, 30000],
    depositInterval: [30000, 45000],
    jackpotInterval: [120000, 240000],
    signupBase: 147,
    signupInterval: [120000, 300000],
    depositDismiss: 5000,
    jackpotDismiss: 8000,
    maxVisibleToasts: 2,
    gamePlayerBase: 23,
    gamePlayerFluctuate: [1, 5],
    gamePlayerInterval: [15000, 40000],
    zPlayerCounter: 8000,
    zSignupCounter: 7500,
    zToast: 8500,
    zJackpot: 9000
  };

  /* ─── NAME POOL ─── */
  var NAMES = [
    'Alex T.', 'Sarah K.', 'David C.', 'Emma R.', 'James M.',
    'Olivia P.', 'Michael B.', 'Sophia L.', 'Daniel W.', 'Ava H.',
    'Chris N.', 'Mia F.', 'Ryan G.', 'Isabella D.', 'Nathan S.',
    'Chloe V.', 'Jake A.', 'Lily J.', 'Ethan Q.', 'Grace Z.',
    'Tyler O.', 'Zoe E.', 'Brandon Y.', 'Hannah U.', 'Kevin I.',
    'Rachel X.', 'Marcus T.', 'Aria W.', 'Jordan P.', 'Victoria L.',
    'Sam R.', 'Luna M.'
  ];

  var GAMES = [
    "Pharaoh's Fortune", "Dragon Pearl Deluxe", "Neon Blitz", "Cosmic Cash",
    "Wild West Gold", "Mystic Forest", "Lucky Sevens", "Ocean King",
    "Thunder Strike", "Crystal Caves", "Shadow Reels", "Fire Phoenix",
    "Outback Riches", "Golden Temple", "Star Burst", "Moon Goddess",
    "Viking Raid", "Fruit Frenzy", "Samurai's Honor", "Jungle Jackpot"
  ];

  /* ─── UTILITIES ─── */
  function rand(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
  }

  function pick(arr) {
    return arr[rand(0, arr.length - 1)];
  }

  function formatNum(n) {
    return n.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  }

  function randInterval(range) {
    return rand(range[0], range[1]);
  }

  function weightedDeposit() {
    var r = Math.random();
    if (r < 0.60) return rand(10, 50);
    if (r < 0.85) return rand(50, 250);
    if (r < 0.95) return rand(250, 500);
    return rand(500, 1000);
  }

  function isGamePage() {
    return window.location.pathname.indexOf('/games/') !== -1;
  }

  /* ─── SESSION STORAGE ─── */
  var STORAGE_KEY = 'msp_session';

  function loadSession() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        var data = JSON.parse(raw);
        var now = Date.now();
        // Reset if older than 24 hours
        if (now - data.ts > 86400000) return newSession();
        return data;
      }
    } catch (e) { /* ignore */ }
    return newSession();
  }

  function newSession() {
    var s = {
      ts: Date.now(),
      playerCount: CFG.playerCountBase + rand(-200, 200),
      signupCount: CFG.signupBase + rand(-20, 20),
      paused: false
    };
    saveSession(s);
    return s;
  }

  function saveSession(s) {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(s)); } catch (e) { /* ignore */ }
  }

  var session = loadSession();

  /* ─── INJECT CSS ─── */
  function injectStyles() {
    var css = [
      /* ── Keyframes ── */
      '@keyframes mspPulse{0%,100%{opacity:1;transform:scale(1)}50%{opacity:.5;transform:scale(1.3)}}',
      '@keyframes mspSlideIn{from{transform:translateX(120%);opacity:0}to{transform:translateX(0);opacity:1}}',
      '@keyframes mspSlideOut{from{transform:translateX(0);opacity:1}to{transform:translateX(120%);opacity:0}}',
      '@keyframes mspSlideInBottom{from{transform:translateY(120%);opacity:0}to{transform:translateY(0);opacity:1}}',
      '@keyframes mspSlideOutBottom{from{transform:translateY(0);opacity:1}to{transform:translateY(120%);opacity:0}}',
      '@keyframes mspFadeIn{from{opacity:0;transform:scale(.92)}to{opacity:1;transform:scale(1)}}',
      '@keyframes mspFadeOut{from{opacity:1;transform:scale(1)}to{opacity:0;transform:scale(.92)}}',
      '@keyframes mspGlow{0%,100%{box-shadow:0 0 15px rgba(255,215,0,.3),0 0 30px rgba(255,215,0,.1)}50%{box-shadow:0 0 25px rgba(255,215,0,.6),0 0 50px rgba(255,215,0,.25)}}',
      '@keyframes mspCountUp{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}',
      '@keyframes mspParticle{0%{background-position:0 0}100%{background-position:200% 0}}',

      /* ── Base ── */
      '.msp-hidden{display:none!important}',

      /* ── Player Counter ── */
      '.msp-player-counter{',
        'position:fixed;top:16px;right:16px;z-index:' + CFG.zPlayerCounter + ';',
        'background:rgba(15,15,25,.92);',
        'border:1px solid rgba(255,215,0,.3);',
        'border-radius:50px;padding:8px 18px;',
        'display:flex;align-items:center;gap:8px;',
        'font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;',
        'font-size:13px;color:#fff;',
        'backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);',
        'box-shadow:0 4px 20px rgba(0,0,0,.4),0 0 10px rgba(255,215,0,.08);',
        'transition:opacity .3s,transform .3s;',
        'cursor:default;user-select:none;',
      '}',
      '.msp-pulse-dot{',
        'width:8px;height:8px;border-radius:50%;',
        'background:#22c55e;',
        'animation:mspPulse 2s ease-in-out infinite;',
        'flex-shrink:0;',
      '}',
      '.msp-player-num{',
        'font-weight:700;color:#FFD700;',
        'transition:all .4s ease;',
      '}',

      /* ── Toast Container ── */
      '.msp-toast-container{',
        'position:fixed;top:70px;right:16px;z-index:' + CFG.zToast + ';',
        'display:flex;flex-direction:column;gap:10px;',
        'pointer-events:none;',
        'max-width:340px;width:100%;',
      '}',

      /* ── Deposit Toast ── */
      '.msp-toast{',
        'background:rgba(15,15,25,.92);',
        'border:1px solid rgba(255,215,0,.3);',
        'border-radius:12px;padding:14px 18px;',
        'font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;',
        'font-size:13px;color:#fff;',
        'backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);',
        'box-shadow:0 8px 32px rgba(0,0,0,.5),0 0 12px rgba(255,215,0,.06);',
        'animation:mspSlideIn .45s cubic-bezier(.23,1,.32,1) forwards;',
        'pointer-events:auto;',
        'display:flex;align-items:center;gap:10px;',
        'cursor:default;',
      '}',
      '.msp-toast.msp-dismiss{animation:mspSlideOut .35s ease-in forwards}',
      '.msp-toast-icon{font-size:20px;flex-shrink:0}',
      '.msp-toast-text{flex:1;line-height:1.4}',
      '.msp-toast-amount{color:#FFD700;font-weight:700}',
      '.msp-toast-name{color:#FFD700;font-weight:600}',
      '.msp-toast-vip{',
        'background:linear-gradient(135deg,#FFD700,#FFA500);',
        '-webkit-background-clip:text;-webkit-text-fill-color:transparent;',
        'font-weight:700;',
      '}',
      '.msp-toast-time{font-size:11px;color:rgba(255,255,255,.4);margin-top:3px}',

      /* ── Jackpot Alert ── */
      '.msp-jackpot-overlay{',
        'position:fixed;top:0;left:0;width:100%;height:100%;',
        'z-index:' + CFG.zJackpot + ';',
        'display:flex;align-items:center;justify-content:center;',
        'background:rgba(0,0,0,.5);',
        'animation:mspFadeIn .3s ease forwards;',
        'pointer-events:auto;',
      '}',
      '.msp-jackpot-overlay.msp-dismiss{animation:mspFadeOut .4s ease forwards}',
      '.msp-jackpot-card{',
        'background:rgba(15,15,25,.96);',
        'border:2px solid rgba(255,215,0,.5);',
        'border-radius:20px;padding:32px 40px;',
        'max-width:440px;width:90%;text-align:center;',
        'font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;',
        'color:#fff;position:relative;overflow:hidden;',
        'backdrop-filter:blur(16px);-webkit-backdrop-filter:blur(16px);',
        'animation:mspGlow 2s ease-in-out infinite;',
        'box-shadow:0 20px 60px rgba(0,0,0,.6),0 0 40px rgba(255,215,0,.15);',
      '}',
      '.msp-jackpot-card::before{',
        'content:"";position:absolute;top:0;left:0;right:0;bottom:0;',
        'border-radius:20px;padding:2px;',
        'background:linear-gradient(90deg,#FFD700,#FFA500,#FFD700,#FFA500,#FFD700);',
        'background-size:200% 100%;',
        'animation:mspParticle 3s linear infinite;',
        '-webkit-mask:linear-gradient(#fff 0 0) content-box,linear-gradient(#fff 0 0);',
        '-webkit-mask-composite:xor;mask-composite:exclude;',
        'pointer-events:none;',
      '}',
      '.msp-jackpot-emoji{font-size:48px;margin-bottom:12px}',
      '.msp-jackpot-title{',
        'font-size:22px;font-weight:800;',
        'background:linear-gradient(135deg,#FFD700,#FFA500);',
        '-webkit-background-clip:text;-webkit-text-fill-color:transparent;',
        'margin-bottom:8px;letter-spacing:1px;',
      '}',
      '.msp-jackpot-detail{font-size:15px;color:rgba(255,255,255,.85);line-height:1.5}',
      '.msp-jackpot-amount{',
        'font-size:32px;font-weight:800;color:#FFD700;',
        'margin:12px 0;text-shadow:0 0 20px rgba(255,215,0,.4);',
      '}',
      '.msp-jackpot-game{color:#FFD700;font-weight:600}',

      /* ── Signup Counter ── */
      '.msp-signup-counter{',
        'position:fixed;bottom:16px;right:16px;z-index:' + CFG.zSignupCounter + ';',
        'background:rgba(15,15,25,.88);',
        'border:1px solid rgba(255,215,0,.2);',
        'border-radius:10px;padding:10px 16px;',
        'font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;',
        'font-size:12px;color:rgba(255,255,255,.75);',
        'backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);',
        'box-shadow:0 4px 16px rgba(0,0,0,.3);',
        'transition:opacity .3s,transform .3s;',
        'cursor:default;user-select:none;',
        'display:flex;align-items:center;gap:6px;',
      '}',
      '.msp-signup-num{color:#FFD700;font-weight:700}',
      '.msp-signup-icon{font-size:14px}',

      /* ── Game Player Indicator ── */
      '.msp-game-players{',
        'background:rgba(15,15,25,.85);',
        'border:1px solid rgba(255,215,0,.25);',
        'border-radius:8px;padding:8px 14px;',
        'font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;',
        'font-size:12px;color:rgba(255,255,255,.8);',
        'display:inline-flex;align-items:center;gap:6px;',
        'margin:8px 0;',
        'backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);',
        'animation:mspFadeIn .4s ease forwards;',
      '}',
      '.msp-game-players .msp-pulse-dot{width:6px;height:6px}',
      '.msp-game-players-num{color:#FFD700;font-weight:700}',

      /* ── Mobile ── */
      '@media(max-width:640px){',
        '.msp-player-counter{',
          'top:10px;left:10px;right:auto;',
          'padding:6px 12px;font-size:11px;',
        '}',
        '.msp-toast-container{',
          'top:auto;bottom:70px;right:0;left:0;',
          'max-width:100%;padding:0 10px;',
        '}',
        '.msp-toast{animation-name:mspSlideInBottom}',
        '.msp-toast.msp-dismiss{animation-name:mspSlideOutBottom}',
        '.msp-signup-counter{',
          'bottom:10px;right:10px;',
          'padding:8px 12px;font-size:11px;',
        '}',
        '.msp-jackpot-card{padding:24px 20px}',
        '.msp-jackpot-emoji{font-size:36px}',
        '.msp-jackpot-title{font-size:18px}',
        '.msp-jackpot-amount{font-size:26px}',
      '}'
    ].join('\n');

    var style = document.createElement('style');
    style.id = 'msp-styles';
    style.textContent = css;
    document.head.appendChild(style);
  }

  /* ─── DOM CREATION ─── */
  var els = {};
  var timers = [];
  var toastQueue = [];
  var paused = false;
  var hidden = false;

  function createPlayerCounter() {
    var el = document.createElement('div');
    el.className = 'msp-player-counter';
    el.innerHTML =
      '<span class="msp-pulse-dot"></span>' +
      '<span><span class="msp-player-num">' + formatNum(session.playerCount) + '</span> players online</span>';
    document.body.appendChild(el);
    els.playerCounter = el;
    els.playerNum = el.querySelector('.msp-player-num');
  }

  function createToastContainer() {
    var el = document.createElement('div');
    el.className = 'msp-toast-container';
    document.body.appendChild(el);
    els.toastContainer = el;
  }

  function createSignupCounter() {
    var el = document.createElement('div');
    el.className = 'msp-signup-counter';
    el.innerHTML =
      '<span class="msp-signup-icon">\u{1F4C8}</span>' +
      '<span><span class="msp-signup-num">' + formatNum(session.signupCount) + '</span> people signed up today</span>';
    document.body.appendChild(el);
    els.signupCounter = el;
    els.signupNum = el.querySelector('.msp-signup-num');
  }

  function createGamePlayers() {
    if (!isGamePage()) return;
    // Try to find a game title area to insert after
    var target = document.querySelector('.game-title, .game-header, h1, .game-info');
    if (!target) return;
    var count = CFG.gamePlayerBase + rand(-5, 10);
    var el = document.createElement('div');
    el.className = 'msp-game-players';
    el.innerHTML =
      '<span class="msp-pulse-dot"></span>' +
      '<span><span class="msp-game-players-num">' + count + '</span> players in this game right now</span>';
    target.parentNode.insertBefore(el, target.nextSibling);
    els.gamePlayers = el;
    els.gamePlayersNum = el.querySelector('.msp-game-players-num');
    els.gamePlayersCount = count;
  }

  /* ─── BEHAVIOURS ─── */

  function schedulePlayerFluctuate() {
    var delay = randInterval(CFG.playerFluctuateInterval);
    var t = setTimeout(function () {
      if (paused) { schedulePlayerFluctuate(); return; }
      var delta = rand(CFG.playerFluctuateRange[0], CFG.playerFluctuateRange[1]);
      if (Math.random() < 0.5) delta = -delta;
      session.playerCount = Math.max(800, session.playerCount + delta);
      if (els.playerNum) els.playerNum.textContent = formatNum(session.playerCount);
      saveSession(session);
      schedulePlayerFluctuate();
    }, delay);
    timers.push(t);
  }

  function showDepositToast() {
    if (paused || hidden) { scheduleDeposit(); return; }

    // Enforce max visible
    var existing = els.toastContainer.querySelectorAll('.msp-toast:not(.msp-dismiss)');
    if (existing.length >= CFG.maxVisibleToasts) {
      // Dismiss oldest
      existing[0].classList.add('msp-dismiss');
      var old = existing[0];
      setTimeout(function () { if (old.parentNode) old.parentNode.removeChild(old); }, 400);
    }

    var name = pick(NAMES);
    var amount = weightedDeposit();
    var isVip = amount >= 500;

    var toast = document.createElement('div');
    toast.className = 'msp-toast';
    toast.innerHTML =
      '<span class="msp-toast-icon">' + (isVip ? '💎' : '💰') + '</span>' +
      '<div class="msp-toast-text">' +
        (isVip ? '<span class="msp-toast-vip">VIP </span>' : '') +
        '<span class="msp-toast-name">' + name + '</span> just deposited ' +
        '<span class="msp-toast-amount">$' + formatNum(amount) + '</span>' +
        '<div class="msp-toast-time">Just now</div>' +
      '</div>';

    els.toastContainer.appendChild(toast);

    // Auto-dismiss
    setTimeout(function () {
      toast.classList.add('msp-dismiss');
      setTimeout(function () { if (toast.parentNode) toast.parentNode.removeChild(toast); }, 400);
    }, CFG.depositDismiss);

    scheduleDeposit();
  }

  function scheduleDeposit() {
    var delay = randInterval(CFG.depositInterval);
    var t = setTimeout(showDepositToast, delay);
    timers.push(t);
  }

  function showJackpotAlert() {
    if (paused || hidden) { scheduleJackpot(); return; }

    var name = pick(NAMES);
    var game = pick(GAMES);
    var amount = rand(1000, 50000);

    var overlay = document.createElement('div');
    overlay.className = 'msp-jackpot-overlay';
    overlay.innerHTML =
      '<div class="msp-jackpot-card">' +
        '<div class="msp-jackpot-emoji">🎰🎉</div>' +
        '<div class="msp-jackpot-title">JACKPOT WINNER!</div>' +
        '<div class="msp-jackpot-amount">$' + formatNum(amount) + '</div>' +
        '<div class="msp-jackpot-detail">' +
          '<span class="msp-toast-name">' + name + '</span> just won big on<br>' +
          '<span class="msp-jackpot-game">' + game + '</span>' +
        '</div>' +
      '</div>';

    // Click to dismiss
    overlay.addEventListener('click', function () {
      dismissJackpot(overlay);
    });

    document.body.appendChild(overlay);

    // Auto-dismiss
    setTimeout(function () {
      dismissJackpot(overlay);
    }, CFG.jackpotDismiss);

    scheduleJackpot();
  }

  function dismissJackpot(overlay) {
    if (overlay.classList.contains('msp-dismiss')) return;
    overlay.classList.add('msp-dismiss');
    setTimeout(function () { if (overlay.parentNode) overlay.parentNode.removeChild(overlay); }, 500);
  }

  function scheduleJackpot() {
    var delay = randInterval(CFG.jackpotInterval);
    var t = setTimeout(showJackpotAlert, delay);
    timers.push(t);
  }

  function scheduleSignupIncrement() {
    var delay = randInterval(CFG.signupInterval);
    var t = setTimeout(function () {
      if (paused) { scheduleSignupIncrement(); return; }
      session.signupCount += 1;
      if (els.signupNum) els.signupNum.textContent = formatNum(session.signupCount);
      saveSession(session);
      scheduleSignupIncrement();
    }, delay);
    timers.push(t);
  }

  function scheduleGamePlayerFluctuate() {
    if (!els.gamePlayers) return;
    var delay = randInterval(CFG.gamePlayerInterval);
    var t = setTimeout(function () {
      if (paused) { scheduleGamePlayerFluctuate(); return; }
      var delta = rand(CFG.gamePlayerFluctuate[0], CFG.gamePlayerFluctuate[1]);
      if (Math.random() < 0.5) delta = -delta;
      els.gamePlayersCount = Math.max(5, (els.gamePlayersCount || CFG.gamePlayerBase) + delta);
      if (els.gamePlayersNum) els.gamePlayersNum.textContent = els.gamePlayersCount;
      scheduleGamePlayerFluctuate();
    }, delay);
    timers.push(t);
  }

  /* ─── PUBLIC API ─── */
  function setVisibility(show) {
    var allEls = [els.playerCounter, els.signupCounter, els.toastContainer, els.gamePlayers];
    for (var i = 0; i < allEls.length; i++) {
      if (allEls[i]) {
        if (show) {
          allEls[i].classList.remove('msp-hidden');
        } else {
          allEls[i].classList.add('msp-hidden');
        }
      }
    }
  }

  window.MatrixSocialProof = {
    pause: function () {
      paused = true;
      session.paused = true;
      saveSession(session);
    },
    resume: function () {
      paused = false;
      session.paused = false;
      saveSession(session);
    },
    hide: function () {
      hidden = true;
      setVisibility(false);
    },
    show: function () {
      hidden = false;
      setVisibility(true);
    },
    getPlayerCount: function () {
      return session.playerCount;
    },
    getSignupCount: function () {
      return session.signupCount;
    }
  };

  /* ─── INIT ─── */
  function init() {
    // Guard against double-init
    if (document.getElementById('msp-styles')) return;

    injectStyles();
    createPlayerCounter();
    createToastContainer();
    createSignupCounter();
    createGamePlayers();

    // Restore paused state
    if (session.paused) {
      paused = true;
    }

    // Start all scheduled behaviours
    schedulePlayerFluctuate();
    scheduleSignupIncrement();
    scheduleGamePlayerFluctuate();

    // First deposit toast after a short initial delay
    var firstDeposit = setTimeout(function () {
      showDepositToast();
    }, rand(8000, 15000));
    timers.push(firstDeposit);

    // First jackpot after longer delay
    var firstJackpot = setTimeout(function () {
      showJackpotAlert();
    }, rand(60000, 120000));
    timers.push(firstJackpot);
  }

  // Boot when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
