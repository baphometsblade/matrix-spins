/* ═══════════════════════════════════════════════════════════════════════════
   Matrix Spins — DEEP POLISH behaviours
   Pairs with css/deep-polish.css. Progressive enhancement only: every feature
   is wrapped so a single throw is isolated and the base lobby / auth flows keep
   working. Honours prefers-reduced-motion. CSP-safe (self-hosted, no eval).

   Features
     1.  Lobby cards: parallax tilt, glass shine, live-jackpot dot
     2.  Auth: floating labels, password strength, eye toggle, real-time tick,
         error shake, "Creating your account…" submit loading state
     3.  Animations: staggered page reveal, count-up bump helper
     4.  Micro-interactions: copy-to-clipboard tooltip, scroll progress bar
     5.  window.DPToast  — namespaced slide-in toast with progress bar
   ═══════════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  if (window.__deepPolishStarted) return;
  window.__deepPolishStarted = true;

  var REDUCE = !!(window.matchMedia &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches);

  function ready(fn) {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', fn);
    } else {
      fn();
    }
  }

  /* run a feature in isolation so one failure never blocks the rest */
  function safe(name, fn) {
    try { fn(); }
    catch (e) { if (window.console && console.warn) console.warn('[deep-polish] ' + name + ' failed:', e); }
  }

  /* ═════════════════════════════════════════════════════════════════════════
     1. LOBBY GAME CARDS
     ═════════════════════════════════════════════════════════════════════════ */
  function enhanceCards(scope) {
    var grid = scope || document.getElementById('gameGrid') || document;
    var cards = grid.querySelectorAll
      ? grid.querySelectorAll('.game-card:not([data-dp-card])')
      : [];

    Array.prototype.forEach.call(cards, function (card) {
      card.setAttribute('data-dp-card', '1');

      // Glass shine overlay (inside the visual so it clips to the rounded img)
      var visual = card.querySelector('.game-visual');
      if (visual && !visual.querySelector('.dp-shine')) {
        var shine = document.createElement('div');
        shine.className = 'dp-shine';
        shine.setAttribute('aria-hidden', 'true');
        visual.appendChild(shine);
      }

      // Live-jackpot pulsing dot
      if (visual && card.classList.contains('jackpot-eligible') &&
          !visual.querySelector('.dp-jackpot-dot')) {
        var dot = document.createElement('span');
        dot.className = 'dp-jackpot-dot';
        dot.setAttribute('aria-hidden', 'true');
        visual.appendChild(dot);
      }

      // Parallax tilt (pointer only, skip on reduced-motion / coarse pointers)
      if (REDUCE) return;
      card.classList.add('dp-tilt');

      var raf = 0;
      function onMove(e) {
        if (raf) return;
        raf = window.requestAnimationFrame(function () {
          raf = 0;
          var r = card.getBoundingClientRect();
          if (!r.width || !r.height) return;
          var px = (e.clientX - r.left) / r.width;   // 0..1
          var py = (e.clientY - r.top) / r.height;   // 0..1
          var max = 6; // degrees
          var ry = (px - 0.5) * (max * 2);           // left/right
          var rx = (0.5 - py) * (max * 2);           // up/down
          card.style.setProperty('--dp-ry', ry.toFixed(2) + 'deg');
          card.style.setProperty('--dp-rx', rx.toFixed(2) + 'deg');
        });
      }
      function onEnter() { card.classList.add('dp-tilting'); }
      function onLeave() {
        card.classList.remove('dp-tilting');
        card.style.setProperty('--dp-rx', '0deg');
        card.style.setProperty('--dp-ry', '0deg');
      }
      card.addEventListener('pointerenter', onEnter);
      card.addEventListener('pointermove', onMove);
      card.addEventListener('pointerleave', onLeave);
    });
  }

  function watchGrid() {
    var grid = document.getElementById('gameGrid');
    if (!grid) return;
    enhanceCards(grid);
    // The lobby re-renders the grid (filters, search) — re-enhance new cards.
    if ('MutationObserver' in window) {
      var mo = new MutationObserver(function () { safe('enhanceCards', function () { enhanceCards(grid); }); });
      mo.observe(grid, { childList: true });
    }
  }

  /* ═════════════════════════════════════════════════════════════════════════
     2. AUTH POLISH
     Works across the two field conventions:
       login/signup pages : .field  > label + input
       index signup modal : .signup-field > label + input
     ═════════════════════════════════════════════════════════════════════════ */
  var FIELD_SELECTOR = '.field, .signup-field';

  function eyeSVG(open) {
    if (open) {
      return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7z"/><circle cx="12" cy="12" r="3"/></svg>';
    }
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>';
  }

  function tickSVG() {
    return '<svg class="dp-tick" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12"/></svg>';
  }

  function isFilled(input) {
    return !!(input && String(input.value || '').length);
  }

  function passwordScore(v) {
    var s = 0;
    if (!v) return 0;
    if (v.length >= 10) s++;
    if (/[a-z]/.test(v) && /[A-Z]/.test(v)) s++;
    if (/\d/.test(v)) s++;
    if (/[^A-Za-z0-9]/.test(v)) s++;
    // long passphrases that miss a class still deserve credit
    if (v.length >= 16 && s < 4) s++;
    return Math.min(s, 4);
  }
  var STRENGTH_LABELS = ['', 'Weak', 'Fair', 'Good', 'Strong'];

  function enhanceField(field) {
    if (field.getAttribute('data-dp-field')) return;
    var input = field.querySelector('input');
    var label = field.querySelector('label');
    if (!input) return;
    var type = (input.getAttribute('type') || 'text').toLowerCase();

    // Skip controls where a floating label makes no sense.
    var floatable = (type === 'text' || type === 'email' || type === 'password' ||
                     type === 'tel' || type === 'number' || type === 'search');

    field.setAttribute('data-dp-field', '1');

    // ── Password eye toggle + strength meter ──────────────────────────────
    if (type === 'password') {
      field.classList.add('dp-pw-wrap');
      if (!field.querySelector('.dp-eye')) {
        var eye = document.createElement('button');
        eye.type = 'button';
        eye.className = 'dp-eye';
        eye.setAttribute('aria-label', 'Show password');
        eye.innerHTML = eyeSVG(false);
        eye.addEventListener('click', function () {
          var show = input.type === 'password';
          input.type = show ? 'text' : 'password';
          eye.innerHTML = eyeSVG(show);
          eye.setAttribute('aria-label', show ? 'Hide password' : 'Show password');
          input.focus();
        });
        field.appendChild(eye);
      }

      // Strength meter only for new-password (signup), not "current-password".
      var ac = (input.getAttribute('autocomplete') || '').toLowerCase();
      if (ac.indexOf('new-password') !== -1 && !field.querySelector('.dp-strength')) {
        var meter = document.createElement('div');
        meter.className = 'dp-strength';
        meter.setAttribute('data-score', '0');
        meter.innerHTML =
          '<div class="dp-strength-track"><div class="dp-strength-fill"></div></div>' +
          '<div class="dp-strength-label" aria-live="polite"></div>';
        field.appendChild(meter);
        var lbl = meter.querySelector('.dp-strength-label');
        input.addEventListener('input', function () {
          var sc = passwordScore(input.value);
          meter.setAttribute('data-score', String(sc));
          lbl.textContent = input.value ? STRENGTH_LABELS[sc] : '';
        });
      }
    }

    // ── Floating label ────────────────────────────────────────────────────
    if (floatable && label) {
      field.classList.add('dp-ff');
      // The floating label replaces the native placeholder to avoid overlap.
      if (input.getAttribute('placeholder')) {
        input.setAttribute('data-dp-ph', input.getAttribute('placeholder'));
        input.removeAttribute('placeholder');
      }
      var sync = function () {
        if (isFilled(input) || document.activeElement === input) {
          field.classList.add('dp-ff--active');
        } else {
          field.classList.remove('dp-ff--active');
        }
      };
      input.addEventListener('focus', sync);
      input.addEventListener('blur', sync);
      input.addEventListener('input', sync);
      // autofill can populate without events — re-check shortly after load
      setTimeout(sync, 250);
      sync();
    }

    // ── Real-time valid tick ──────────────────────────────────────────────
    if (floatable) {
      field.insertAdjacentHTML('beforeend', tickSVG());
      var validate = function () {
        var ok;
        try { ok = input.value.length > 0 && input.checkValidity(); }
        catch (_) { ok = input.value.length > 0; }
        // password: require a non-trivial score rather than just minlength
        if (type === 'password' &&
            (input.getAttribute('autocomplete') || '').indexOf('new-password') !== -1) {
          ok = ok && passwordScore(input.value) >= 3;
        }
        field.classList.toggle('dp-valid', !!ok);
      };
      input.addEventListener('input', validate);
      input.addEventListener('blur', validate);
    }
  }

  function enhanceAuth() {
    var fields = document.querySelectorAll(FIELD_SELECTOR);
    Array.prototype.forEach.call(fields, function (f) {
      safe('enhanceField', function () { enhanceField(f); });
    });
    wireAuthForms();
  }

  // Attach error-shake + submit-loading to known auth forms.
  function wireAuthForms() {
    var forms = document.querySelectorAll('#signupForm, .rs-card form#f, form#f');
    Array.prototype.forEach.call(forms, function (form) {
      if (form.getAttribute('data-dp-form')) return;
      form.setAttribute('data-dp-form', '1');

      var card = form.closest('.signup-modal') || form.closest('.rs-card') || form;
      var btn = form.querySelector('button[type="submit"], button.signup-submit, button.btn, #submit, #signupSubmitBtn');

      function shake() {
        if (REDUCE || !card) return;
        card.classList.remove('dp-shake');
        // reflow to restart the animation
        void card.offsetWidth;
        card.classList.add('dp-shake');
      }

      // HTML5-invalid submit → shake.
      form.addEventListener('submit', function () {
        if (typeof form.checkValidity === 'function' && !form.checkValidity()) {
          shake();
          return;
        }
        // Valid submit → loading state on the button (the page's own handler
        // does the fetch + re-enables on error; we just decorate + revert).
        if (btn) startBtnLoading(btn);
      }, false);

      // If the page re-enables the button (error path), revert our loading UI.
      if (btn && 'MutationObserver' in window) {
        var mo = new MutationObserver(function () {
          if (!btn.disabled && btn.classList.contains('dp-btn-loading')) {
            stopBtnLoading(btn);
            shake(); // re-enable almost always means the submit errored
          }
        });
        mo.observe(btn, { attributes: true, attributeFilter: ['disabled'] });
      }

      // The shared alert element turning visible is the other error signal.
      var alertEl = card && card.querySelector ? card.querySelector('#alert, .alert') : null;
      if (alertEl && 'MutationObserver' in window) {
        var amo = new MutationObserver(function () {
          if (alertEl.classList.contains('visible') &&
              !alertEl.classList.contains('success')) {
            shake();
          }
        });
        amo.observe(alertEl, { attributes: true, attributeFilter: ['class'] });
      }
    });
  }

  function loadingTextFor(btn) {
    var t = (btn.textContent || '').toLowerCase();
    if (t.indexOf('sign in') !== -1 || t.indexOf('log in') !== -1) return 'Signing in…';
    if (t.indexOf('reset') !== -1 || t.indexOf('send') !== -1) return 'Sending…';
    return 'Creating your account…';
  }

  function startBtnLoading(btn) {
    if (btn.classList.contains('dp-btn-loading')) return;
    btn.setAttribute('data-dp-label', btn.innerHTML);
    var msg = loadingTextFor(btn);
    btn.classList.add('dp-btn-loading');
    var span = document.createElement('span');
    span.className = 'dp-btn-loading-text';
    span.textContent = msg;
    btn.appendChild(span);
  }

  function stopBtnLoading(btn) {
    btn.classList.remove('dp-btn-loading');
    var saved = btn.getAttribute('data-dp-label');
    if (saved != null) { btn.innerHTML = saved; btn.removeAttribute('data-dp-label'); }
    else {
      var span = btn.querySelector('.dp-btn-loading-text');
      if (span) span.remove();
    }
  }

  /* ═════════════════════════════════════════════════════════════════════════
     3. PAGE REVEAL (staggered fade-up per section)
     ═════════════════════════════════════════════════════════════════════════ */
  function pageReveal() {
    if (REDUCE) return;
    // Top-level content blocks, excluding fixed chrome and the lobby grid
    // (cards already animate via their own entrance + tilt enhancement).
    var candidates = document.querySelectorAll(
      'main > section, main > .section, .page-section, [data-dp-reveal], ' +
      '.lobby-section, .home-section'
    );
    var list = Array.prototype.filter.call(candidates, function (el) {
      return el.offsetParent !== null && !el.closest('.header') && el.id !== 'gameGrid';
    });
    if (!list.length) return;

    list.forEach(function (el, i) {
      el.classList.add('dp-reveal');
      el.style.setProperty('--dp-delay', Math.min(i, 8) * 70 + 'ms');
    });

    if (!('IntersectionObserver' in window)) {
      // No IO: just reveal everything so nothing stays hidden.
      list.forEach(function (el) { el.classList.add('dp-revealed'); });
      return;
    }
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (e.isIntersecting) { e.target.classList.add('dp-revealed'); io.unobserve(e.target); }
      });
    }, { rootMargin: '0px 0px -6% 0px', threshold: 0.04 });
    list.forEach(function (el) { io.observe(el); });

    // Safety net: anything still hidden after 1.6s gets revealed (mirrors the
    // aaa-polish 0×0-viewport / IO-never-fires gotcha in MEMORY.md).
    setTimeout(function () {
      list.forEach(function (el) {
        if (!el.classList.contains('dp-revealed')) el.classList.add('dp-revealed');
      });
    }, 1600);
  }

  /* ═════════════════════════════════════════════════════════════════════════
     4. MICRO-INTERACTIONS
     ═════════════════════════════════════════════════════════════════════════ */

  // Scroll progress bar
  function scrollBar() {
    if (REDUCE) return;
    var bar = document.createElement('div');
    bar.className = 'dp-scrollbar';
    bar.setAttribute('aria-hidden', 'true');
    document.body.appendChild(bar);
    var ticking = false;
    function update() {
      ticking = false;
      var doc = document.documentElement;
      var max = (doc.scrollHeight - doc.clientHeight) || 1;
      var p = Math.min(1, Math.max(0, (window.scrollY || doc.scrollTop || 0) / max));
      bar.style.transform = 'scaleX(' + p.toFixed(4) + ')';
    }
    window.addEventListener('scroll', function () {
      if (!ticking) { ticking = true; window.requestAnimationFrame(update); }
    }, { passive: true });
    window.addEventListener('resize', update, { passive: true });
    update();
  }

  // Copy-to-clipboard: any [data-copy] element. Value = attribute or own text.
  function copyToClipboard() {
    function showTip(el, text) {
      var tip = document.createElement('span');
      tip.className = 'dp-copy-tip';
      tip.textContent = text || 'Copied!';
      if (getComputedStyle(el).position === 'static') el.style.position = 'relative';
      el.appendChild(tip);
      // force layout then animate in
      void tip.offsetWidth;
      tip.classList.add('dp-copy-tip--show');
      setTimeout(function () {
        tip.classList.remove('dp-copy-tip--show');
        setTimeout(function () { if (tip.parentNode) tip.remove(); }, 250);
      }, 1100);
    }
    document.addEventListener('click', function (e) {
      var el = e.target.closest && e.target.closest('[data-copy]');
      if (!el) return;
      var val = el.getAttribute('data-copy') || el.textContent || '';
      val = val.trim();
      if (!val) return;
      var done = function () { showTip(el, el.getAttribute('data-copy-msg') || 'Copied!'); };
      try {
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(val).then(done, function () { fallback(val, done); });
        } else { fallback(val, done); }
      } catch (_) { fallback(val, done); }
    });
    function fallback(val, done) {
      try {
        var ta = document.createElement('textarea');
        ta.value = val;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        ta.remove();
        done();
      } catch (_) { /* clipboard truly unavailable — no-op */ }
    }
  }

  /* ═════════════════════════════════════════════════════════════════════════
     5. TOASTS  — window.DPToast.show(message, { type, title, ttl })
     ═════════════════════════════════════════════════════════════════════════ */
  function initToasts() {
    var stack = null;
    function getStack() {
      if (stack && document.body.contains(stack)) return stack;
      stack = document.createElement('div');
      stack.className = 'dp-notify-stack';
      stack.setAttribute('aria-live', 'polite');
      document.body.appendChild(stack);
      return stack;
    }
    window.DPToast = {
      show: function (message, opts) {
        opts = opts || {};
        var ttl = Math.max(1500, opts.ttl || 4000);
        var n = document.createElement('div');
        n.className = 'dp-notify' + (opts.type === 'error' ? ' dp-notify--error' : '');
        n.style.setProperty('--dp-notify-ttl', ttl + 'ms');
        n.setAttribute('role', 'status');
        var html = '';
        if (opts.title) html += '<div class="dp-notify-title"></div>';
        html += '<div class="dp-notify-body"></div>';
        n.innerHTML = html;
        if (opts.title) n.querySelector('.dp-notify-title').textContent = opts.title;
        n.querySelector('.dp-notify-body').textContent = String(message == null ? '' : message);
        getStack().appendChild(n);
        var killed = false;
        function dismiss() {
          if (killed) return; killed = true;
          n.classList.add('dp-notify--out');
          setTimeout(function () { if (n.parentNode) n.remove(); }, 360);
        }
        var timer = setTimeout(dismiss, ttl);
        n.addEventListener('click', function () { clearTimeout(timer); dismiss(); });
        return dismiss;
      }
    };
  }

  /* ═════════════════════════════════════════════════════════════════════════
     count-up bump helper (exposed for other modules)
     ═════════════════════════════════════════════════════════════════════════ */
  window.DPBump = function (el) {
    if (REDUCE || !el) return;
    el.classList.remove('dp-count-bump');
    void el.offsetWidth;
    el.classList.add('dp-count-bump');
  };

  /* ═════════════════════════════════════════════════════════════════════════
     BOOT
     ═════════════════════════════════════════════════════════════════════════ */
  ready(function () {
    safe('toasts', initToasts);
    safe('cards', watchGrid);
    safe('auth', enhanceAuth);
    safe('pageReveal', pageReveal);
    safe('scrollBar', scrollBar);
    safe('copy', copyToClipboard);
  });
})();
