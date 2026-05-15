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

  function genActivity() {
    var type = Math.random();
    var name = genName();
    if (type < 0.45) {
      return { icon: '🎰', text: '<b class="af-name">' + name + '</b> just won <span class="af-amount">' + fmtMoney(genAmount()) + '</span> on <span class="af-game">' + pick(games) + '</span>', name: name };
    } else if (type < 0.65) {
      return { icon: '💰', text: '<b class="af-name">' + name + '</b> deposited <span class="af-amount">' + fmtMoney(rand(100, 2000)) + '</span>', name: name };
    } else if (type < 0.80) {
      return { icon: '🔥', text: '<b class="af-name">' + name + '</b> hit a <span class="af-amount">' + fmtMoney(genAmount() + 1000) + '</span> jackpot on <span class="af-game">' + pick(games) + '</span>!', name: name };
    } else if (type < 0.92) {
      return { icon: '🎲', text: '<b class="af-name">' + name + '</b> just signed up and got <span class="af-amount">$1,000</span> in demo credits', name: name };
    } else {
      return { icon: '👑', text: '<b class="af-name">' + name + '</b> won the <span class="af-amount">' + fmtMoney(rand(5000, 25000)) + '</span> Progressive Jackpot!', name: name };
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
    // Show first toast after short delay
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
