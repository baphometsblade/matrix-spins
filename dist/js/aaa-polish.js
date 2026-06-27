/* ============================================================
   Matrix Spins — AAA Polish behaviours
   Pairs with css/aaa-polish.css. All progressive enhancement:
   if any single feature throws, the rest keep working and the
   base lobby is unaffected.

   Features
     1.  Scroll-reveal game cards (IntersectionObserver)
     2.  Sticky header that shrinks on scroll
     3.  Smooth jackpot count-up (window.MSCountUp)
     4.  Account quick-access dropdown + header username
     5.  Balance glow bump on change
     6.  Filter-pill ripple + grid cross-fade
     7.  Matrix loaders in empty async regions + retry on failure
     8.  Back-to-top control
     9.  Page fade transitions
   ============================================================ */
(function () {
  'use strict';

  var REDUCE = window.matchMedia &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  function ready(fn) {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', fn);
    } else {
      fn();
    }
  }

  function svgNS(tag, attrs) {
    var el = document.createElementNS('http://www.w3.org/2000/svg', tag);
    for (var k in attrs) { if (attrs.hasOwnProperty(k)) el.setAttribute(k, attrs[k]); }
    return el;
  }

  /* =========================================================
     1. SCROLL-REVEAL GAME CARDS
     The lobby's inline renderer adds `.game-card.entering`
     (an immediate keyframe). We swap that for viewport-driven
     reveals so 100 cards cascade in as the player scrolls.
     ========================================================= */
  (function scrollReveal() {
    var grid = document.getElementById('gameGrid');
    if (!grid || !('IntersectionObserver' in window) || REDUCE) return;

    function reveal(card) {
      card.classList.add('ms-in');
      if (io) io.unobserve(card);
    }

    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (e.isIntersecting) reveal(e.target);
      });
    }, { rootMargin: '0px 0px -8% 0px', threshold: 0.05 });

    function prep(card) {
      if (card.classList.contains('ms-reveal')) return;
      card.classList.remove('entering');
      card.style.animationDelay = '';
      card.classList.add('ms-reveal');
      io.observe(card);
    }

    function scan() {
      var cards = grid.querySelectorAll('.game-card:not(.ms-reveal)');
      for (var i = 0; i < cards.length; i++) prep(cards[i]);
      safetyNet();
    }

    // Safety net — IntersectionObserver can silently no-op (privacy
    // extensions stubbing it, forced-colors, odd embedded webviews). Like
    // the age-gate animationend bug, we never gate visibility solely on an
    // event: a throttled rect check reveals any hidden card that is (or
    // scrolls) into view, so content can never get stranded at opacity:0.
    function vh() {
      return window.innerHeight || document.documentElement.clientHeight || 0;
    }
    function safetyNet() {
      var h = vh();
      // Broken/zero viewport → reveal everything rather than hide content.
      var force = h === 0;
      var hidden = grid.querySelectorAll('.game-card.ms-reveal:not(.ms-in)');
      for (var i = 0; i < hidden.length; i++) {
        if (force || hidden[i].getBoundingClientRect().top < h + 120) reveal(hidden[i]);
      }
    }
    var ticking = false;
    window.addEventListener('scroll', function () {
      if (!ticking) { ticking = true; window.requestAnimationFrame(function () { safetyNet(); ticking = false; }); }
    }, { passive: true });
    // One-shot late sweep covers above-fold cards if IO never fired at all.
    window.setTimeout(safetyNet, 1800);

    // Initial + re-render (filter/search rebuilds the grid)
    scan();
    var mo = new MutationObserver(function () { scan(); });
    mo.observe(grid, { childList: true });
  })();

  /* =========================================================
     2. STICKY HEADER — shrink on scroll
     ========================================================= */
  (function shrinkHeader() {
    var header = document.querySelector('.header');
    if (!header) return;
    var ticking = false;
    function update() {
      header.classList.toggle('ms-scrolled', window.pageYOffset > 40);
      ticking = false;
    }
    window.addEventListener('scroll', function () {
      if (!ticking) { ticking = true; window.requestAnimationFrame(update); }
    }, { passive: true });
    update();
  })();

  /* =========================================================
     3. SMOOTH JACKPOT COUNT-UP
     Exposed globally; js/jackpot.js calls it when present and
     falls back to textContent otherwise. Tweens the displayed
     value toward the target so the ticker counts instead of
     jumping. `fmt` formats cents → display string each frame.
     ========================================================= */
  window.MSCountUp = function (el, targetCents, fmt) {
    if (!el) return;
    if (REDUCE) { el.textContent = fmt(targetCents); el._jpCur = targetCents; return; }
    var from = (typeof el._jpCur === 'number') ? el._jpCur : targetCents;
    var to = targetCents;
    if (from === to) { el.textContent = fmt(to); el._jpCur = to; return; }
    if (el._jpRAF) cancelAnimationFrame(el._jpRAF);
    var dur = 850;
    var t0 = null;
    function step(ts) {
      if (t0 === null) t0 = ts;
      var p = Math.min(1, (ts - t0) / dur);
      // easeOutCubic
      var eased = 1 - Math.pow(1 - p, 3);
      var val = Math.round(from + (to - from) * eased);
      el._jpCur = val;
      el.textContent = fmt(val);
      if (p < 1) {
        el._jpRAF = window.requestAnimationFrame(step);
      } else {
        el._jpCur = to;
        el.textContent = fmt(to);
        el._jpRAF = null;
      }
    }
    el._jpRAF = window.requestAnimationFrame(step);
  };

  /* =========================================================
     4. ACCOUNT QUICK-ACCESS DROPDOWN + USERNAME
     ========================================================= */
  ready(function accountMenu() {
    var token = localStorage.getItem('casinoToken') || localStorage.getItem('token');
    var avatar = document.querySelector('.header-right .avatar');
    if (!avatar) return;

    if (!token) return; // logged-out avatar keeps its "sign in" handler

    // Wrap avatar so the menu can anchor to it
    var wrap = document.createElement('div');
    wrap.className = 'ms-acct-wrap';
    avatar.parentNode.insertBefore(wrap, avatar);
    wrap.appendChild(avatar);

    var menu = document.createElement('div');
    menu.className = 'ms-acct-menu';
    menu.setAttribute('role', 'menu');
    menu.innerHTML =
      '<div class="ms-acct-head"><div class="nm" id="msAcctName">My Account</div>' +
      '<div class="bal" id="msAcctBal"></div></div>' +
      item('account.html', 'Profile', 'M12 12c2.2 0 4-1.8 4-4s-1.8-4-4-4-4 1.8-4 4 1.8 4 4 4zm0 2c-2.7 0-8 1.3-8 4v2h16v-2c0-2.7-5.3-4-8-4z') +
      item('wallet.html', 'Deposit', 'M12 2v9m0 0l3-3m-3 3L9 8M5 21h14a2 2 0 002-2v-7H3v7a2 2 0 002 2z') +
      item('wallet.html#withdraw', 'Withdraw', 'M12 11V2M9 5l3-3 3 3M5 21h14a2 2 0 002-2v-7H3v7a2 2 0 002 2z') +
      item('account.html#settings', 'Settings', 'M12 15a3 3 0 100-6 3 3 0 000 6zm7.4-3a7.5 7.5 0 00-.1-1.3l2-1.6-2-3.4-2.4 1a7.3 7.3 0 00-2.2-1.3L14 1h-4l-.7 2.5a7.3 7.3 0 00-2.2 1.3l-2.4-1-2 3.4 2 1.6A7.5 7.5 0 002.6 12c0 .4 0 .9.1 1.3l-2 1.6 2 3.4 2.4-1c.7.6 1.4 1 2.2 1.3L10 23h4l.7-2.5c.8-.3 1.5-.7 2.2-1.3l2.4 1 2-3.4-2-1.6c.1-.4.1-.9.1-1.3z') +
      '<div class="ms-acct-sep"></div>' +
      itemBtn('msLogoutBtn', 'Log out', 'danger', 'M16 17l5-5-5-5M21 12H9M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4');
    wrap.appendChild(menu);

    function item(href, label, path) {
      return '<a class="ms-acct-item" role="menuitem" href="' + href + '">' +
        ico(path) + '<span>' + label + '</span></a>';
    }
    function itemBtn(id, label, cls, path) {
      return '<button type="button" id="' + id + '" class="ms-acct-item ' + cls +
        '" role="menuitem">' + ico(path) + '<span>' + label + '</span></button>';
    }
    function ico(path) {
      return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
        'stroke-width="2" stroke-linecap="round" stroke-linejoin="round" ' +
        'aria-hidden="true"><path d="' + path + '"/></svg>';
    }

    var open = false;
    function setOpen(v) {
      open = v;
      menu.classList.toggle('open', v);
      avatar.setAttribute('aria-expanded', v ? 'true' : 'false');
    }
    avatar.setAttribute('aria-haspopup', 'menu');
    avatar.setAttribute('aria-expanded', 'false');

    // Capture-phase so we pre-empt the inline `avatar.onclick = account.html`
    avatar.addEventListener('click', function (e) {
      e.preventDefault();
      e.stopImmediatePropagation();
      setOpen(!open);
    }, true);

    document.addEventListener('click', function (e) {
      if (open && !wrap.contains(e.target)) setOpen(false);
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && open) { setOpen(false); avatar.focus(); }
    });

    var logout = menu.querySelector('#msLogoutBtn');
    if (logout) logout.addEventListener('click', function () {
      try {
        localStorage.removeItem('casinoToken');
        localStorage.removeItem('token');
      } catch (_) {}
      window.location.href = 'login.html';
    });

    // Real profile data — username + balance (no mock fallbacks shown)
    fetch('/api/user/profile', {
      headers: { 'Authorization': 'Bearer ' + token },
      credentials: 'include'
    }).then(function (r) { return r.ok ? r.json() : null; })
      .then(function (data) {
        var u = data && data.user;
        if (!u) return;
        var name = u.display_name || u.username;
        if (name) {
          var nm = menu.querySelector('#msAcctName');
          if (nm) nm.textContent = name;
          var chip = document.getElementById('headerUsername');
          if (chip) { chip.textContent = name; chip.classList.add('ms-ready'); }
        }
        var balEl = menu.querySelector('#msAcctBal');
        if (balEl && u.balance != null) {
          balEl.textContent = '$' + Number(u.balance).toFixed(2) + ' available';
        }
      }).catch(function () {});
  });

  /* =========================================================
     5. BALANCE GLOW BUMP — pulse when the header balance changes
     ========================================================= */
  ready(function balanceBump() {
    var bal = document.getElementById('balance');
    if (!bal || REDUCE) return;
    var last = bal.textContent;
    var mo = new MutationObserver(function () {
      if (bal.textContent !== last) {
        last = bal.textContent;
        bal.classList.remove('ms-bump');
        void bal.offsetWidth; // restart animation
        bal.classList.add('ms-bump');
      }
    });
    mo.observe(bal, { childList: true, characterData: true, subtree: true });
  });

  /* =========================================================
     6. FILTER-PILL RIPPLE + GRID CROSS-FADE
     ========================================================= */
  ready(function filterFx() {
    var container = document.getElementById('filterContainer');
    var grid = document.getElementById('gameGrid');
    if (!container) return;

    container.addEventListener('click', function (e) {
      var chip = e.target.closest && e.target.closest('.filter-chip');
      if (!chip) return;
      if (!REDUCE) {
        var rect = chip.getBoundingClientRect();
        var size = Math.max(rect.width, rect.height);
        var rip = document.createElement('span');
        rip.className = 'ms-ripple';
        rip.style.width = rip.style.height = size + 'px';
        rip.style.left = (e.clientX - rect.left - size / 2) + 'px';
        rip.style.top = (e.clientY - rect.top - size / 2) + 'px';
        chip.appendChild(rip);
        setTimeout(function () { rip.remove(); }, 650);
      }
      if (grid && !REDUCE) {
        grid.classList.add('ms-swapping');
        setTimeout(function () { grid.classList.remove('ms-swapping'); }, 170);
      }
    });
  });

  /* =========================================================
     7. MATRIX LOADERS in empty async regions + retry
     window.MSUI.spinner(label) / MSUI.retry(msg, onRetry)
     ========================================================= */
  function spinnerNode(label) {
    var block = document.createElement('div');
    block.className = 'ms-loading-block';
    block.setAttribute('data-ms-loader', '1');
    block.setAttribute('role', 'status');
    block.setAttribute('aria-live', 'polite');
    var dots = document.createElement('div');
    dots.className = 'ms-spinner';
    dots.innerHTML = '<span></span><span></span><span></span><span></span>';
    block.appendChild(dots);
    if (label) {
      var l = document.createElement('div');
      l.className = 'ms-loading-label';
      l.textContent = label;
      block.appendChild(l);
    }
    return block;
  }

  function retryNode(msg, onRetry) {
    var box = document.createElement('div');
    box.className = 'ms-retry';
    box.setAttribute('role', 'alert');
    var ic = svgNS('svg', { viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': '2', 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true' });
    ic.appendChild(svgNS('path', { d: 'M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z' }));
    ic.appendChild(svgNS('line', { x1: '12', y1: '9', x2: '12', y2: '13' }));
    ic.appendChild(svgNS('line', { x1: '12', y1: '17', x2: '12.01', y2: '17' }));
    box.appendChild(ic);
    var m = document.createElement('div');
    m.className = 'ms-retry-msg';
    m.textContent = msg || "Couldn't load this right now.";
    box.appendChild(m);
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.innerHTML = '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M23 4v6h-6M1 20v-6h6"/><path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15"/></svg> Try again';
    btn.addEventListener('click', function () { if (typeof onRetry === 'function') onRetry(); });
    box.appendChild(btn);
    return box;
  }

  window.MSUI = {
    spinner: spinnerNode,
    retry: retryNode,
    /** Show a loader in `el`; auto-clears once real children arrive. */
    load: function (el, label) {
      if (!el) return;
      if (el.querySelector('[data-ms-loader]')) return;
      if (el.children.length > 0) return; // already populated
      var loader = spinnerNode(label);
      el.appendChild(loader);
      var mo = new MutationObserver(function () {
        var added = false;
        for (var i = 0; i < el.children.length; i++) {
          if (!el.children[i].hasAttribute('data-ms-loader')) { added = true; break; }
        }
        if (added) {
          if (loader.parentNode === el) el.removeChild(loader);
          mo.disconnect();
        }
      });
      mo.observe(el, { childList: true });
      return loader;
    }
  };

  // Seed loaders into the regions the lobby fills asynchronously,
  // and watch the jackpot bar — it depends on /api/jackpot, so if it
  // never populates we surface a retry instead of a dead empty strip.
  ready(function seedLoaders() {
    [
      ['jackpotHero', 'Loading jackpot'],
      ['showcaseStack', 'Loading featured'],
      ['fcTrack', 'Loading featured'],
      ['studiosGrid', 'Loading studios']
    ].forEach(function (pair) {
      var el = document.getElementById(pair[0]);
      if (el && el.children.length === 0) window.MSUI.load(el, pair[1]);
    });

    var bar = document.getElementById('jackpotBar');
    if (bar) {
      window.MSUI.load(bar, '');
      // jackpot.js renders the bar on init; if still empty after a grace
      // period the API/script failed — offer a retry (full reload re-runs
      // the jackpot init cleanly).
      setTimeout(function () {
        var hasReal = false;
        for (var i = 0; i < bar.children.length; i++) {
          if (!bar.children[i].hasAttribute('data-ms-loader')) { hasReal = true; break; }
        }
        if (!hasReal) {
          bar.innerHTML = '';
          bar.appendChild(retryNode('Live jackpots are taking a moment.', function () {
            window.location.reload();
          }));
        }
      }, 9000);
    }
  });

  /* =========================================================
     8. BACK-TO-TOP
     ========================================================= */
  ready(function backToTop() {
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'ms-backtotop';
    btn.setAttribute('aria-label', 'Back to top');
    btn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 19V5M5 12l7-7 7 7"/></svg>';
    document.body.appendChild(btn);

    var ticking = false;
    function update() {
      btn.classList.toggle('show', window.pageYOffset > 600);
      ticking = false;
    }
    window.addEventListener('scroll', function () {
      if (!ticking) { ticking = true; window.requestAnimationFrame(update); }
    }, { passive: true });
    btn.addEventListener('click', function () {
      window.scrollTo({ top: 0, behavior: REDUCE ? 'auto' : 'smooth' });
    });
    update();
  });

  /* =========================================================
     9. PAGE FADE TRANSITIONS
     Fade the page in on load; fade out before same-origin
     navigations (real anchor links, not buttons/new-tab).
     ========================================================= */
  (function pageTransitions() {
    if (REDUCE) return;
    var root = document.body;
    root.classList.add('ms-page-fade');
    function fadeIn() {
      window.requestAnimationFrame(function () {
        root.classList.add('ms-page-in');
      });
    }
    ready(fadeIn);
    // Safety: never leave the page invisible if load events are odd
    window.setTimeout(fadeIn, 400);

    document.addEventListener('click', function (e) {
      var a = e.target.closest && e.target.closest('a[href]');
      if (!a) return;
      var href = a.getAttribute('href');
      if (!href || href.charAt(0) === '#') return;
      if (a.target === '_blank' || a.hasAttribute('download')) return;
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
      // same-origin only
      var url;
      try { url = new URL(a.href, window.location.href); } catch (_) { return; }
      if (url.origin !== window.location.origin) return;
      if (url.pathname === window.location.pathname && url.hash) return;
      e.preventDefault();
      root.classList.remove('ms-page-in');
      root.classList.add('ms-page-out');
      window.setTimeout(function () { window.location.href = a.href; }, 240);
    });

    // bfcache restore — ensure visible again
    window.addEventListener('pageshow', function (ev) {
      if (ev.persisted) { root.classList.remove('ms-page-out'); fadeIn(); }
    });
  })();
})();
