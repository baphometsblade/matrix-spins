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
     1. TYPEWRITER TAGLINE — types "120+ PREMIUM SLOTS" above the hero headline.
        Adds a dedicated tagline element (leaves the real subtitle untouched).
     ───────────────────────────────────────────────────────────────────────── */
  function initTypewriter() {
    var heroContent = document.querySelector('.hero-content');
    if (!heroContent) return;
    if (heroContent.querySelector('.gui-hero-tagline')) return;

    var TAGLINE = '120+ PREMIUM SLOTS';

    var tagline = document.createElement('div');
    tagline.className = 'gui-hero-tagline';

    /* Place it right after the eyebrow (or as the first hero element). */
    var eyebrow = heroContent.querySelector('.hero-eyebrow');
    if (eyebrow && eyebrow.nextSibling) {
      heroContent.insertBefore(tagline, eyebrow.nextSibling);
    } else {
      heroContent.insertBefore(tagline, heroContent.firstChild);
    }

    /* Reduced motion → show the full tagline immediately, no caret. */
    if (prefersReduced) {
      tagline.textContent = TAGLINE;
      return;
    }

    var cursor = document.createElement('span');
    cursor.className = 'gui-typewriter-cursor';
    tagline.appendChild(cursor);

    var i = 0;
    var speed = 55; /* ms per character */

    function type() {
      if (i < TAGLINE.length) {
        tagline.insertBefore(document.createTextNode(TAGLINE.charAt(i)), cursor);
        i++;
        setTimeout(type, speed);
      } else {
        setTimeout(function () {
          if (cursor.parentNode) cursor.parentNode.removeChild(cursor);
        }, 1800);
      }
    }

    setTimeout(type, 500);
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
     5. GLOWING "PLAY NOW" CTA — prepended to the hero CTAs; scrolls to the grid
     ───────────────────────────────────────────────────────────────────────── */
  function initPlayNow() {
    var ctas = document.querySelector('.hero .hero-ctas');
    if (!ctas || ctas.querySelector('.gui-playnow')) return;

    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'gui-playnow';
    btn.textContent = 'Play Now';
    btn.addEventListener('click', function () {
      var grid = document.getElementById('gameGrid') || document.querySelector('.games-grid');
      if (grid) {
        grid.scrollIntoView({ behavior: prefersReduced ? 'auto' : 'smooth', block: 'start' });
      }
    });
    ctas.insertBefore(btn, ctas.firstChild);
  }

  /* ─────────────────────────────────────────────────────────────────────────
     6. FLOATING PREVIEW CARDS — 3 gently bobbing cards in the hero showcase.
        If the live showcase stack is already populated, just bob its cards;
        otherwise build 3 cards from the first real game thumbnails.
     ───────────────────────────────────────────────────────────────────────── */
  function initFloatingCards() {
    var showcase = document.querySelector('.hero .hero-showcase');
    if (!showcase) return;
    if (showcase.querySelector('.gui-float-cards')) return;

    function build() {
      var stack = showcase.querySelector('#showcaseStack, .showcase-stack');

      /* Path A — live showcase already has cards: bob the first three. */
      if (stack && stack.children.length) {
        for (var n = 0; n < Math.min(3, stack.children.length); n++) {
          stack.children[n].classList.add('gui-bob');
          stack.children[n].style.animationDelay = (n * 0.6) + 's';
        }
        return;
      }

      /* Path B — build our own from real game thumbnails (fallback to gradients). */
      var thumbs = [];
      var imgs = document.querySelectorAll('#gameGrid .game-thumb');
      for (var j = 0; j < imgs.length && thumbs.length < 3; j++) {
        if (imgs[j].src) thumbs.push(imgs[j].src);
      }

      var wrap = document.createElement('div');
      wrap.className = 'gui-float-cards';
      wrap.setAttribute('aria-hidden', 'true');

      var labels = ['JACKPOT', 'MEGA WIN', 'FREE SPINS'];
      for (var k = 0; k < 3; k++) {
        var card = document.createElement('div');
        card.className = 'gui-float-card gui-bob';
        card.style.animationDelay = (k * 0.6) + 's';
        if (thumbs[k]) card.style.backgroundImage = 'url("' + thumbs[k] + '")';

        var badge = document.createElement('span');
        badge.className = 'gui-float-badge';
        badge.textContent = labels[k];
        card.appendChild(badge);
        wrap.appendChild(card);
      }
      showcase.appendChild(wrap);
    }

    /* Give the live populators (jackpot.js / lobby-live.js) a moment first. */
    setTimeout(build, 1200);
  }

  /* ─────────────────────────────────────────────────────────────────────────
     7. AUTH PAGES — social proof + animated tracing border on the form card
     ───────────────────────────────────────────────────────────────────────── */
  function initAuth() {
    var card = document.querySelector('.rs-card');
    if (!card) return;

    document.body.classList.add('gui-auth');
    card.classList.add('gui-trace');

    if (!card.querySelector('.gui-social-proof')) {
      var sp = document.createElement('div');
      sp.className = 'gui-social-proof';

      var dots = document.createElement('span');
      dots.className = 'gui-sp-dots';
      for (var d = 0; d < 4; d++) dots.appendChild(document.createElement('i'));

      var text = document.createElement('span');
      var strong = document.createElement('strong');
      strong.textContent = '10,000+';
      text.appendChild(document.createTextNode('Join '));
      text.appendChild(strong);
      text.appendChild(document.createTextNode(' players winning daily'));

      sp.appendChild(dots);
      sp.appendChild(text);
      card.appendChild(sp);
    }
  }

  /* ─────────────────────────────────────────────────────────────────────────
     8. DEPOSIT (wallet) — glowing balance, step indicator, pill presets
     ───────────────────────────────────────────────────────────────────────── */
  function initDeposit() {
    var balance = document.getElementById('mainBalance');
    var presets = document.querySelector('.amount-presets');
    if (!balance && !presets) return;

    document.body.classList.add('gui-deposit');
    if (balance) balance.classList.add('gui-balance-glow');

    if (presets && !document.querySelector('.gui-steps')) {
      var steps = document.createElement('div');
      steps.className = 'gui-steps';
      steps.setAttribute('aria-hidden', 'true');

      var labels = ['Amount', 'Method', 'Confirm'];
      var nodes = [];
      for (var s = 0; s < labels.length; s++) {
        var step = document.createElement('div');
        step.className = 'gui-step' + (s === 0 ? ' gui-step-active' : '');
        var num = document.createElement('span');
        num.className = 'gui-step-n';
        num.textContent = String(s + 1);
        step.appendChild(num);
        step.appendChild(document.createTextNode(' ' + labels[s]));
        steps.appendChild(step);
        nodes.push(step);
      }

      /* Insert above the "Choose amount" label that precedes the presets. */
      var prev = presets.previousElementSibling;
      var ref = (prev && prev.tagName === 'LABEL') ? prev : presets;
      ref.parentNode.insertBefore(steps, ref);

      /* Light progress feedback: picking an amount advances to step 2. */
      presets.addEventListener('click', function () {
        nodes[0].classList.remove('gui-step-active');
        nodes[1].classList.add('gui-step-active');
      });
    }
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
    initPlayNow();
    initFloatingCards();
    initAuth();
    initDeposit();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
