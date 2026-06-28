/* ═══════════════════════════════════════════════════════════════════════════
   GUI UPGRADE — Interactive enhancements  (js/gui-upgrade.js)
   ───────────────────────────────────────────────────────────────────────────
   1. Typewriter effect for hero tagline
   2. Jackpot ticker animation in hero
   3. Play button overlay on game card hover (DOM injection)
   4. Hero Matrix rain mini-canvas (behind hero content only)
   ═══════════════════════════════════════════════════════════════════════════ */

(function () {
  'use strict';

  /* Bail on reduced-motion */
  var prefersReduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ─────────────────────────────────────────────────────────────────────────
     1. TYPEWRITER EFFECT — types out the hero subtitle letter by letter
     ───────────────────────────────────────────────────────────────────────── */
  function initTypewriter() {
    var heroP = document.querySelector('.hero-content > p');
    if (!heroP) return;

    var fullText = heroP.textContent.trim();
    if (!fullText) return;

    /* If reduced motion, just show the text immediately */
    if (prefersReduced) return;

    heroP.textContent = '';
    heroP.style.minHeight = '1.5em';

    var cursor = document.createElement('span');
    cursor.className = 'gui-typewriter-cursor';
    heroP.appendChild(cursor);

    var i = 0;
    var speed = 28; /* ms per character */

    function type() {
      if (i < fullText.length) {
        heroP.insertBefore(document.createTextNode(fullText.charAt(i)), cursor);
        i++;
        setTimeout(type, speed);
      } else {
        /* Remove cursor after 2s */
        setTimeout(function () {
          if (cursor.parentNode) cursor.parentNode.removeChild(cursor);
        }, 2000);
      }
    }

    /* Start after a small delay to let the page settle */
    setTimeout(type, 600);
  }

  /* ─────────────────────────────────────────────────────────────────────────
     2. JACKPOT TICKER — animating jackpot value in the hero section
     ───────────────────────────────────────────────────────────────────────── */
  function initJackpotTicker() {
    var heroContent = document.querySelector('.hero-content');
    if (!heroContent) return;

    /* Don't add if one already exists */
    if (document.querySelector('.gui-jackpot-ticker')) return;

    var ticker = document.createElement('div');
    ticker.className = 'gui-jackpot-ticker';
    ticker.innerHTML =
      '<span class="gui-jackpot-label">Progressive Jackpot</span>' +
      '<span class="gui-jackpot-amount" id="guiJackpotAmount">$1,247,893.42</span>';

    /* Insert after the hero CTAs or at the end of hero-content */
    var ctas = heroContent.querySelector('.hero-ctas');
    if (ctas && ctas.nextSibling) {
      heroContent.insertBefore(ticker, ctas.nextSibling);
    } else {
      heroContent.appendChild(ticker);
    }

    if (prefersReduced) return;

    /* Animate the amount upward over time */
    var amount = 1247893.42;
    var amountEl = document.getElementById('guiJackpotAmount');
    if (!amountEl) return;

    function tick() {
      amount += Math.random() * 2.5 + 0.3;
      amountEl.textContent = '$' + amount.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    }

    setInterval(tick, 3000 + Math.random() * 2000);
  }

  /* ─────────────────────────────────────────────────────────────────────────
     3. PLAY BUTTON OVERLAY — inject a centred play button into each card
     ───────────────────────────────────────────────────────────────────────── */
  function initPlayOverlays() {
    var cards = document.querySelectorAll('.game-card');
    if (!cards.length) return;

    cards.forEach(function (card) {
      var visual = card.querySelector('.game-visual');
      if (!visual || visual.querySelector('.gui-play-overlay')) return;

      var overlay = document.createElement('div');
      overlay.className = 'gui-play-overlay';
      overlay.innerHTML = '<div class="gui-play-btn" aria-hidden="true">▶</div>';
      visual.appendChild(overlay);
    });
  }

  /* Re-run when new cards might appear (e.g. after filter change) */
  function observeNewCards() {
    var grid = document.querySelector('.games-grid');
    if (!grid) return;

    var observer = new MutationObserver(function () {
      initPlayOverlays();
    });
    observer.observe(grid, { childList: true, subtree: false });
  }

  /* ─────────────────────────────────────────────────────────────────────────
     4. HERO MATRIX RAIN MINI-CANVAS — green rain behind hero section only
     ───────────────────────────────────────────────────────────────────────── */
  function initHeroRain() {
    if (prefersReduced) return;

    var hero = document.querySelector('.hero');
    if (!hero) return;
    if (document.getElementById('heroRainCanvas')) return;

    var canvas = document.createElement('canvas');
    canvas.id = 'heroRainCanvas';
    hero.insertBefore(canvas, hero.firstChild);

    var ctx = canvas.getContext('2d');
    if (!ctx) return;

    var fontSize = 14;
    var columns = 0;
    var drops = [];
    var chars = 'アイウエオカキクケコサシスセソタチツテト0123456789ABCDEF';

    function resize() {
      canvas.width = hero.offsetWidth;
      canvas.height = hero.offsetHeight;
      columns = Math.floor(canvas.width / fontSize);
      /* Preserve existing drops, fill new ones */
      while (drops.length < columns) {
        drops.push(Math.random() * -50);
      }
      drops.length = columns;
    }

    function draw() {
      /* Semi-transparent black to create trail effect */
      ctx.fillStyle = 'rgba(10, 10, 10, 0.12)';
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      ctx.fillStyle = 'rgba(0, 255, 65, 0.35)';
      ctx.font = fontSize + 'px monospace';

      for (var i = 0; i < columns; i++) {
        var char = chars.charAt(Math.floor(Math.random() * chars.length));
        var x = i * fontSize;
        var y = drops[i] * fontSize;

        ctx.fillText(char, x, y);

        /* Randomly reset drop to top */
        if (y > canvas.height && Math.random() > 0.975) {
          drops[i] = 0;
        }
        drops[i]++;
      }
    }

    resize();
    window.addEventListener('resize', resize);

    /* Slower interval for a subtle ambient effect */
    setInterval(draw, 80);
  }

  /* ─────────────────────────────────────────────────────────────────────────
     BOOT — wait for DOM ready
     ───────────────────────────────────────────────────────────────────────── */
  function boot() {
    initTypewriter();
    initJackpotTicker();
    initPlayOverlays();
    observeNewCards();
    initHeroRain();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
