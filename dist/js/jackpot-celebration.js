/* Matrix Spins — Site-wide Jackpot Win Celebration
 * Listens to socket.io 'jackpot:win' events and shows a full-screen overlay
 * with confetti + sound + winner announcement on every page that includes it.
 * Also feeds live jackpot ticker amounts to anything listening for
 * window dispatchEvent 'jackpot:pools'.
 */
(function() {
  'use strict';

  if (window.__jackpotCelebrationLoaded) return;
  window.__jackpotCelebrationLoaded = true;

  function injectStyles() {
    if (document.getElementById('jp-celebration-css')) return;
    var s = document.createElement('style');
    s.id = 'jp-celebration-css';
    s.textContent = [
      '#jpCelebrationOverlay{position:fixed;inset:0;background:rgba(0,0,0,0.85);display:none;align-items:center;justify-content:center;flex-direction:column;z-index:99999;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif}',
      '#jpCelebrationOverlay.active{display:flex}',
      '#jpCelebrationOverlay .jp-card{background:linear-gradient(135deg,#2a1a0f,#5c3a1a);border:3px solid #ffd700;border-radius:24px;padding:40px 56px;text-align:center;box-shadow:0 0 80px rgba(255,215,0,0.6);animation:jpZoomIn 0.6s ease-out}',
      '@keyframes jpZoomIn{from{transform:scale(0.3);opacity:0}to{transform:scale(1);opacity:1}}',
      '#jpCelebrationOverlay .jp-title{font-size:22px;color:#fff;margin-bottom:10px;text-transform:uppercase;letter-spacing:0.2em;font-weight:800}',
      '#jpCelebrationOverlay .jp-amount{font-size:72px;font-weight:800;color:#ffd700;text-shadow:0 0 40px rgba(255,215,0,0.8);line-height:1;margin:8px 0}',
      '#jpCelebrationOverlay .jp-tier{font-size:16px;color:rgba(255,255,255,0.9);margin:14px 0 18px}',
      '#jpCelebrationOverlay .jp-user{font-size:13px;color:rgba(255,255,255,0.6);margin-bottom:24px}',
      '#jpCelebrationOverlay .jp-close{padding:10px 28px;background:rgba(255,215,0,0.2);border:1px solid #ffd700;color:#ffd700;border-radius:8px;cursor:pointer;font-size:14px;font-weight:600}',
      '#jpCelebrationOverlay .jp-close:hover{background:rgba(255,215,0,0.35)}',
    ].join('\n');
    document.head.appendChild(s);
  }

  function buildOverlay() {
    if (document.getElementById('jpCelebrationOverlay')) return;
    var wrap = document.createElement('div');
    wrap.id = 'jpCelebrationOverlay';
    wrap.setAttribute('role', 'dialog');
    wrap.setAttribute('aria-modal', 'true');
    var card = document.createElement('div');
    card.className = 'jp-card';
    var title = document.createElement('div'); title.className = 'jp-title'; title.textContent = 'JACKPOT WIN!';
    var amt = document.createElement('div'); amt.className = 'jp-amount'; amt.id = 'jpCelebrationAmount';
    var tier = document.createElement('div'); tier.className = 'jp-tier'; tier.id = 'jpCelebrationTier';
    var user = document.createElement('div'); user.className = 'jp-user'; user.id = 'jpCelebrationUser';
    var close = document.createElement('button'); close.className = 'jp-close'; close.textContent = 'Close';
    close.addEventListener('click', hide);
    card.appendChild(title); card.appendChild(amt); card.appendChild(tier);
    card.appendChild(user); card.appendChild(close);
    wrap.appendChild(card);
    document.body.appendChild(wrap);
  }

  function fmt(n) { return '$' + Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }

  function show(win) {
    if (!win) return;
    buildOverlay();
    var displayTier = win.tier === 'grand' ? 'mega' : (win.tier || 'jackpot');
    document.getElementById('jpCelebrationAmount').textContent = fmt(win.amount);
    document.getElementById('jpCelebrationTier').textContent = displayTier.toUpperCase() + ' JACKPOT';
    document.getElementById('jpCelebrationUser').textContent = 'Won by ' + (win.username || 'Anonymous');
    document.getElementById('jpCelebrationOverlay').classList.add('active');
    shower(); playWinSound();
    setTimeout(hide, 8000);
  }
  function hide() {
    var el = document.getElementById('jpCelebrationOverlay');
    if (el) el.classList.remove('active');
  }

  function shower() {
    if (typeof confetti !== 'function') return;
    var defaults = { startVelocity: 30, spread: 360, ticks: 60, zIndex: 100000 };
    function rand(a, b) { return Math.random() * (b - a) + a; }
    var end = Date.now() + 3500;
    (function frame() {
      confetti(Object.assign({}, defaults, { particleCount: 40, origin: { x: rand(0.1, 0.3), y: Math.random() - 0.2 } }));
      confetti(Object.assign({}, defaults, { particleCount: 40, origin: { x: rand(0.7, 0.9), y: Math.random() - 0.2 } }));
      if (Date.now() < end) requestAnimationFrame(frame);
    })();
  }

  function playWinSound() {
    try {
      var ctx = new (window.AudioContext || window.webkitAudioContext)();
      var notes = [523, 659, 784, 1047];
      notes.forEach(function(freq, i) {
        var osc = ctx.createOscillator();
        var gain = ctx.createGain();
        osc.connect(gain); gain.connect(ctx.destination);
        osc.type = 'square';
        osc.frequency.setValueAtTime(freq, ctx.currentTime + i * 0.15);
        gain.gain.setValueAtTime(0.001, ctx.currentTime + i * 0.15);
        gain.gain.exponentialRampToValueAtTime(0.15, ctx.currentTime + i * 0.15 + 0.03);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + i * 0.15 + 0.3);
        osc.start(ctx.currentTime + i * 0.15);
        osc.stop(ctx.currentTime + i * 0.15 + 0.3);
      });
    } catch (e) { /* audio unavailable */ }
  }

  function ensureSocket(cb) {
    if (typeof io === 'function') return cb();
    var s = document.createElement('script');
    s.src = '/socket.io/socket.io.js';
    s.onload = cb;
    s.onerror = function() { console.warn('[jackpot] socket.io unavailable'); };
    document.head.appendChild(s);
  }

  function init() {
    injectStyles();
    ensureSocket(function() {
      if (typeof io !== 'function') return;
      try {
        var socket = io({ transports: ['websocket', 'polling'], reconnection: true });
        socket.on('connect', function() { socket.emit('subscribe:jackpots'); });
        socket.on('jackpot:win', function(win) { show(win); });
        socket.on('jackpot:pools', function(msg) {
          if (msg && msg.pools) {
            try { window.dispatchEvent(new CustomEvent('jackpot:pools', { detail: msg.pools })); } catch (e) {}
          }
        });
        window.__jackpotSocket = socket;
      } catch (e) { console.warn('[jackpot] socket init failed:', e.message); }
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
