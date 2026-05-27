/**
 * Matrix Spins Casino - Live Player Activity Feed
 * Social proof widget showing simulated real-time player activity
 * as toast-style notifications (bottom-left).
 * Auto-injecting IIFE — just include the script tag.
 */
(function () {
  'use strict';

  // ── Only run on index / homepage ───────────────────────────
  var path = window.location.pathname;
  if (path !== '/' && path !== '/index.html' && !path.endsWith('/Casino/') && !path.endsWith('/Casino/index.html') && path.indexOf('index.html') === -1) return;

  var STORAGE_KEY = 'ms_activity_feed_hidden';
  var MIN_INTERVAL = 15000;
  var MAX_INTERVAL = 25000;
  var DISPLAY_TIME = 5000;
  var MAX_TOASTS = 3;

  var container = null;
  var timer = null;
  var paused = false;
  var toasts = [];

  // ── Data pools ────────────────────────────────────

  var adjectives = ['Lucky', 'Golden', 'Neon', 'Shadow', 'Crypto', 'Mystic', 'Blazing', 'Turbo', 'Swift', 'Stealth'];
  var nouns = ['Star', 'Tiger', 'Ace', 'Wolf', 'Phoenix', 'King', 'Rider', 'Dragon', 'Cobra', 'Hawk'];
  var vipPrefixes = ['VIP_', 'Diamond_', 'Platinum_', 'Elite_'];

  var games = [
    'Imperial Dragon Ascent', 'Pharaoh Eternal Dynasty', 'Golden Phoenix Rising',
    'Nebula Space Odyssey', 'Tiger Treasures Strike', 'Cleopatra Treasure Vault',
    'Moonlit Koi Garden', 'Steampunk Gears Fortune', 'Vampire Midnight Hunt',
    'Cherry Blossom Temple', 'Roaring Lion Kingdom', 'Jade Emperor Blessing',
    'Quantum Leap Vault', 'Pirate Treasure Map', 'Merlin Arcane Wonders',
    'Ra Sun God Royale', 'Crystal Cavern', 'Silk Road Treasures',
    'Druid Forest Magic', 'Cosmic Raider Mission'
  ];

  // ── Helpers ─────────────────────────────────────

  function rand(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }
  function pick(arr) { return arr[rand(0, arr.length - 1)]; }

  function genName() {
    if (Math.random() < 0.2) return pick(vipPrefixes) + pick(nouns) + rand(1, 99);
    return pick(adjectives) + '_' + pick(nouns) + rand(10, 999);
  }

  function genAmount() {
    var r = Math.random();
    if (r < 0.65) return rand(50, 500);
    if (r < 0.88) return rand(501, 2000);
    if (r < 0.97) return rand(2001, 5000);
    return rand(5001, 15000);
  }

  function fmtMoney(n) { return '$' + n.toLocaleString('en-US'); }

  // Real-win cache, populated from /api/feed (last 20 big wins, usernames
  // already masked to "AB***" server-side). We pop from this queue first
  // and only fall back to synthetic data — explicitly labelled "Demo" —
  // if the API is unreachable or returns no wins. The previous version
  // was 100% synthetic which the audit flagged as a regulator concern
  // (fabricated social proof) and an immersion-breaker (player notices
  // repeating names and impossible-looking $15k wins on every visit).
  var realWins = [];
  var realWinsExhaustedAt = 0;
  var feedFetching = false;

  function fetchRealWins() {
    if (feedFetching) return;
    feedFetching = true;
    fetch('/api/feed')
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (data) {
        if (data && Array.isArray(data.feed) && data.feed.length) {
          realWins = data.feed.slice();
          realWinsExhaustedAt = 0;
        }
      })
      .catch(function () { /* silent; we'll fall back to synthetic */ })
      .then(function () { feedFetching = false; });
  }

  function lookupGameName(gameId) {
    try {
      var reg = window.GAME_REGISTRY;
      if (reg && Array.isArray(reg)) {
        for (var i = 0; i < reg.length; i++) {
          if (reg[i].id === gameId) return reg[i].name || gameId;
        }
      }
    } catch (_) { /* noop */ }
    // Fallback: prettify the id (sugar_rush → Sugar Rush).
    return String(gameId || '').replace(/_/g, ' ').replace(/\b\w/g, function (c) { return c.toUpperCase(); });
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function genActivity() {
    // Prefer real wins when we have them. Each toast pops one entry so
    // we cycle through the most recent 20 real wins before refilling.
    // When the queue drains we kick off a refill but return synthetic
    // for this turn — the audit explicitly approved "synthetic with a
    // Demo label" as the fallback shape.
    if (realWins.length > 0) {
      var win = realWins.shift();
      var name = (win.username || 'Player');
      var gameName = lookupGameName(win.gameId);
      var amount = fmtMoney(Math.round(win.win || 0));
      var icon = (win.mult && win.mult >= 50) ? '🔥' : '🎰';
      var phrase = (win.mult && win.mult >= 50) ? 'hit a' : 'just won';
      return {
        icon: icon,
        text: '<b class="af-name">' + escapeHtml(name) + '</b> ' + phrase + ' <span class="af-amount">' + amount + '</span> on <span class="af-game">' + escapeHtml(gameName) + '</span>',
        name: name,
      };
    }
    // Real-wins queue drained — kick off a refill (rate-limited).
    var now = Date.now();
    if (now - realWinsExhaustedAt > 8000) {
      realWinsExhaustedAt = now;
      fetchRealWins();
    }
    // Synthetic fallback. Marked with [Demo] so we never silently
    // misrepresent fabricated activity as authenticated wins.
    var type = Math.random();
    var sName = genName();
    var demo = ' <span class="af-demo" aria-label="(demonstration data)">[Demo]</span>';
    if (type < 0.45) {
      return { icon: '🎰', text: '<b class="af-name">' + sName + '</b>' + demo + ' just won <span class="af-amount">' + fmtMoney(genAmount()) + '</span> on <span class="af-game">' + pick(games) + '</span>', name: sName };
    } else if (type < 0.65) {
      return { icon: '💰', text: '<b class="af-name">' + sName + '</b>' + demo + ' deposited <span class="af-amount">' + fmtMoney(rand(100, 2000)) + '</span>', name: sName };
    } else if (type < 0.80) {
      return { icon: '🔥', text: '<b class="af-name">' + sName + '</b>' + demo + ' hit a <span class="af-amount">' + fmtMoney(genAmount() + 1000) + '</span> jackpot on <span class="af-game">' + pick(games) + '</span>!', name: sName };
    } else if (type < 0.92) {
      return { icon: '🎲', text: '<b class="af-name">' + sName + '</b>' + demo + ' just signed up and got <span class="af-amount">$1,000</span> in demo credits', name: sName };
    } else {
      return { icon: '👑', text: '<b class="af-name">' + sName + '</b>' + demo + ' won the <span class="af-amount">' + fmtMoney(rand(5000, 25000)) + '</span> Progressive Jackpot!', name: sName };
    }
  }

  // ── CSS injection ──────────────────────────────────

  function injectCSS() {
    if (document.querySelector('link[data-ms-activity-css]')) return;
    var link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = '/css/activity-feed.css';
    link.setAttribute('data-ms-activity-css', '');
    document.head.appendChild(link);
  }

  // ── DOM ─────────────────────────────────────────

  function buildContainer() {
    container = document.createElement('div');
    container.id = 'ms-activity-feed';
    document.body.appendChild(container);
  }

  function showToast() {
    if (paused || !container) return;
    if (localStorage.getItem(STORAGE_KEY) === '1') return;

    while (toasts.length >= MAX_TOASTS) removeToast(toasts[0]);

    var data = genActivity();
    var el = document.createElement('div');
    el.className = 'af-toast af-enter';
    el.innerHTML =
      '<div class="af-avatar">' + data.name.charAt(0).toUpperCase() + '</div>' +
      '<div class="af-body"><span class="af-icon">' + data.icon + '</span> ' + data.text + '</div>' +
      '<button class="af-close" aria-label="Dismiss">&times;</button>';

    el.querySelector('.af-close').addEventListener('click', function (e) {
      e.stopPropagation();
      removeToast(el);
    });

    container.appendChild(el);
    toasts.push(el);

    // trigger reflow then add visible class
    void el.offsetWidth;
    el.classList.remove('af-enter');
    el.classList.add('af-visible');

    setTimeout(function () { removeToast(el); }, DISPLAY_TIME);
  }

  function removeToast(el) {
    if (!el || !el.parentNode) return;
    var idx = toasts.indexOf(el);
    if (idx > -1) toasts.splice(idx, 1);
    el.classList.add('af-exit');
    setTimeout(function () {
      if (el.parentNode) el.parentNode.removeChild(el);
    }, 400);
  }

  // ── Scheduling ────────────────────────────────────

  function scheduleNext() {
    timer = setTimeout(function () {
      showToast();
      scheduleNext();
    }, rand(MIN_INTERVAL, MAX_INTERVAL));
  }

  function start() {
    if (localStorage.getItem(STORAGE_KEY) === '1') return;
    injectCSS();
    buildContainer();
    // Prime the real-wins queue from /api/feed so the first toast
    // can use authenticated data rather than synthetic fallback.
    // Refresh every 30 seconds while the lobby is open — the toast
    // cadence is ~15-25s so we refill in time.
    fetchRealWins();
    setInterval(fetchRealWins, 30000);
    // Show first toast after short delay (gives /api/feed a moment
    // to return before we'd otherwise fall back to synthetic).
    setTimeout(showToast, rand(3000, 6000));
    scheduleNext();
  }

  function pause() { paused = true; clearTimeout(timer); }
  function resume() { paused = false; scheduleNext(); }

  function hide() {
    pause();
    localStorage.setItem(STORAGE_KEY, '1');
    if (container && container.parentNode) container.parentNode.removeChild(container);
  }

  function show() {
    localStorage.removeItem(STORAGE_KEY);
    paused = false;
    if (!container || !container.parentNode) buildContainer();
    scheduleNext();
  }

  // ── Public API ────────────────────────────────────

  window.MatrixActivityFeed = {
    pause: pause,
    resume: resume,
    hide: hide,
    show: show
  };

  // ── Init ────────────────────────────────────────

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }
})();
