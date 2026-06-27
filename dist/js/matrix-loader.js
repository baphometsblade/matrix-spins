/**
 * Matrix-rain loading overlay (window.MatrixLoader).
 *
 * A richer, themed boot screen for the slot engine: a classic Matrix
 * digital-rain canvas (falling green katakana / 0-1 glyphs, brighter head,
 * trailing fade) behind a centered card showing the game name, an animated
 * progress bar, and a rotating tip.
 *
 * Public surface:
 *   MatrixLoader.show({ name, rtp })  — mount the overlay + start the rain
 *   MatrixLoader.hide()               — fade out, remove, cancel the rAF loop
 *
 * Design constraints (kept deliberately self-contained — pure vanilla JS,
 * no deps, injects its own CSS):
 *   • z-index 2147483000 — very high, but BELOW the legal age-gate overlay
 *     (which sits at 2147483647 and must always win).
 *   • prefers-reduced-motion → skip the canvas animation; show a static dark
 *     overlay with the card only.
 *   • Minimum display window (~1.2s) so a fast boot doesn't flash the overlay.
 *   • Max-lifetime auto-hide (~6s) so a boot error can never leave it stuck.
 *   • hide() is idempotent (safe to call twice) and tears down every listener,
 *     timer, and the rAF loop.
 */
window.MatrixLoader = (function () {
  'use strict';

  const Z_INDEX = 2147483000;     // below the age-gate (2147483647)
  const MIN_DISPLAY_MS = 1200;    // don't flash for sub-second boots
  const MAX_LIFETIME_MS = 6000;   // safety auto-hide
  const FADE_MS = 300;

  const TIPS = [
    'Set a budget before you play and stick to it.',
    'Slots are random — previous results don\'t affect future spins.',
    'Higher volatility means bigger but less frequent wins.',
    'Take regular breaks — it helps you make better decisions.',
    'Use the responsible-gambling tools any time you need a break.',
    'Every outcome is decided by the server and cryptographically verifiable.',
  ];

  let overlay = null;
  let canvas = null;
  let ctx = null;
  let rafId = null;
  let resizeHandler = null;
  let tipRotationId = null;
  let maxLifetimeId = null;
  let pendingHideId = null;
  let shownAt = 0;
  let tipIndex = 0;
  let hiding = false;
  let columns = [];          // y-position (in rows) of each column's rain head
  let fontSize = 16;
  const GLYPHS = 'アイウエオカキクケコサシスセソタチツテトナニヌネノハヒフヘホ0123456789'.split('');

  function prefersReducedMotion() {
    try {
      return window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    } catch (_) {
      return false;
    }
  }

  function injectStyle() {
    if (document.getElementById('matrix-loader-style')) return;
    const s = document.createElement('style');
    s.id = 'matrix-loader-style';
    s.textContent = `
      #matrix-loader-overlay {
        position: fixed; inset: 0; z-index: ${Z_INDEX};
        background: #05080a;
        display: flex; align-items: center; justify-content: center;
        overflow: hidden;
        opacity: 0; transition: opacity ${FADE_MS}ms ease;
        font-family: 'Plus Jakarta Sans', Inter, system-ui, sans-serif;
      }
      #matrix-loader-overlay.ml-visible { opacity: 1; }
      #matrix-loader-canvas {
        position: absolute; inset: 0; width: 100%; height: 100%;
        display: block;
      }
      #matrix-loader-overlay .ml-card {
        position: relative; z-index: 1; text-align: center;
        max-width: 420px; width: calc(100% - 48px);
        padding: 28px 30px;
        background: rgba(4, 10, 7, 0.72);
        border: 1px solid rgba(0, 255, 102, 0.32);
        border-radius: 14px;
        box-shadow: 0 0 36px rgba(0, 255, 102, 0.18), inset 0 0 24px rgba(0, 255, 102, 0.06);
        -webkit-backdrop-filter: blur(3px); backdrop-filter: blur(3px);
      }
      #matrix-loader-overlay .ml-name {
        margin: 0; font-size: clamp(1.25rem, 4.4vw, 1.9rem); font-weight: 800;
        letter-spacing: 1.5px; text-transform: uppercase; line-height: 1.15;
        color: #43ff8b; text-shadow: 0 0 16px rgba(0, 255, 102, 0.55);
      }
      #matrix-loader-overlay .ml-rtp {
        margin: 6px 0 0; font-size: 0.72rem; letter-spacing: 0.14em;
        text-transform: uppercase; color: #8fe6b0; opacity: 0.8;
      }
      #matrix-loader-overlay .ml-bar-wrap {
        margin: 20px 0 14px; height: 6px; border-radius: 8px;
        background: rgba(0, 255, 102, 0.12); overflow: hidden;
      }
      #matrix-loader-overlay .ml-bar {
        height: 100%; width: 35%; border-radius: 8px;
        background: linear-gradient(90deg, rgba(0,255,102,0) 0%, #00ff66 50%, rgba(0,255,102,0) 100%);
        animation: mlBarSlide 1.1s ease-in-out infinite;
      }
      @keyframes mlBarSlide {
        0%   { transform: translateX(-120%); }
        100% { transform: translateX(320%); }
      }
      #matrix-loader-overlay .ml-status {
        margin: 0; font-size: 0.92rem; font-weight: 700; color: #c8ffd9;
        letter-spacing: 0.04em;
      }
      #matrix-loader-overlay .ml-tip {
        margin: 10px 0 0; font-size: 0.8rem; line-height: 1.55;
        color: #7fb594; min-height: 2.4em;
        transition: opacity 0.4s ease;
      }
      @media (prefers-reduced-motion: reduce) {
        #matrix-loader-overlay { transition: none; }
        #matrix-loader-overlay .ml-bar { animation: none; width: 100%;
          background: linear-gradient(90deg, #00aa44, #00ff66); }
      }
    `;
    document.head.appendChild(s);
  }

  function sizeCanvas() {
    if (!canvas) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = window.innerWidth;
    const h = window.innerHeight;
    canvas.width = Math.max(1, Math.floor(w * dpr));
    canvas.height = Math.max(1, Math.floor(h * dpr));
    canvas.style.width = w + 'px';
    canvas.style.height = h + 'px';
    if (ctx) ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    fontSize = w < 480 ? 14 : 16;
    const colCount = Math.max(1, Math.floor(w / fontSize));
    const next = new Array(colCount);
    for (let i = 0; i < colCount; i++) {
      next[i] = columns[i] != null ? columns[i] : Math.floor(Math.random() * -40);
    }
    columns = next;
  }

  function drawFrame() {
    if (!ctx || !canvas) return;
    const w = window.innerWidth;
    const h = window.innerHeight;
    // Translucent black fade gives the trailing comet-tail effect.
    ctx.fillStyle = 'rgba(5, 8, 10, 0.10)';
    ctx.fillRect(0, 0, w, h);
    ctx.font = fontSize + 'px monospace';
    ctx.textBaseline = 'top';
    for (let i = 0; i < columns.length; i++) {
      const x = i * fontSize;
      const y = columns[i] * fontSize;
      const glyph = GLYPHS[(Math.random() * GLYPHS.length) | 0];
      // Bright head, dimmer trail.
      ctx.fillStyle = '#c6ffd6';
      ctx.fillText(glyph, x, y);
      const trail = GLYPHS[(Math.random() * GLYPHS.length) | 0];
      ctx.fillStyle = 'rgba(0, 255, 102, 0.55)';
      ctx.fillText(trail, x, y - fontSize);
      // Reset the column once it runs off-screen, with a random gap so the
      // streams desynchronise instead of marching in lockstep.
      if (y > h && Math.random() > 0.975) {
        columns[i] = Math.floor(Math.random() * -20);
      } else {
        columns[i] = columns[i] + 1;
      }
    }
    rafId = window.requestAnimationFrame(drawFrame);
  }

  function rotateTip() {
    if (!overlay) return;
    const el = overlay.querySelector('.ml-tip');
    if (!el) return;
    el.style.opacity = '0';
    window.setTimeout(() => {
      if (!overlay) return;
      tipIndex = (tipIndex + 1) % TIPS.length;
      el.textContent = TIPS[tipIndex];
      el.style.opacity = '1';
    }, 380);
  }

  function buildOverlay(opts) {
    const o = document.createElement('div');
    o.id = 'matrix-loader-overlay';
    o.setAttribute('role', 'status');
    o.setAttribute('aria-live', 'polite');

    const reduced = prefersReducedMotion();
    if (!reduced) {
      const cv = document.createElement('canvas');
      cv.id = 'matrix-loader-canvas';
      cv.setAttribute('aria-hidden', 'true');
      o.appendChild(cv);
    }

    const card = document.createElement('div');
    card.className = 'ml-card';

    const name = document.createElement('h2');
    name.className = 'ml-name';
    name.textContent = (opts && opts.name) ? String(opts.name) : 'Loading';
    card.appendChild(name);

    const rtpVal = opts && opts.rtp;
    const rtpNum = typeof rtpVal === 'number' ? rtpVal : parseFloat(rtpVal);
    if (isFinite(rtpNum) && rtpNum > 0) {
      const rtp = document.createElement('p');
      rtp.className = 'ml-rtp';
      rtp.textContent = rtpNum.toFixed(1) + '% RTP';
      card.appendChild(rtp);
    }

    const barWrap = document.createElement('div');
    barWrap.className = 'ml-bar-wrap';
    const bar = document.createElement('div');
    bar.className = 'ml-bar';
    barWrap.appendChild(bar);
    card.appendChild(barWrap);

    const status = document.createElement('p');
    status.className = 'ml-status';
    status.textContent = 'Entering the Matrix…';
    card.appendChild(status);

    const tip = document.createElement('p');
    tip.className = 'ml-tip';
    tip.textContent = TIPS[tipIndex];
    card.appendChild(tip);

    o.appendChild(card);
    return o;
  }

  function clearTimers() {
    if (tipRotationId) { window.clearInterval(tipRotationId); tipRotationId = null; }
    if (maxLifetimeId) { window.clearTimeout(maxLifetimeId); maxLifetimeId = null; }
    if (pendingHideId) { window.clearTimeout(pendingHideId); pendingHideId = null; }
  }

  function teardown() {
    if (rafId) { window.cancelAnimationFrame(rafId); rafId = null; }
    if (resizeHandler) { window.removeEventListener('resize', resizeHandler); resizeHandler = null; }
    clearTimers();
    if (overlay && overlay.parentNode) overlay.parentNode.removeChild(overlay);
    overlay = null; canvas = null; ctx = null; columns = [];
    hiding = false;
  }

  function show(opts) {
    try {
      // Idempotent: a second show() while one is up just refreshes the label.
      if (overlay) {
        if (pendingHideId) { window.clearTimeout(pendingHideId); pendingHideId = null; }
        hiding = false;
        const nameEl = overlay.querySelector('.ml-name');
        if (nameEl && opts && opts.name) nameEl.textContent = String(opts.name);
        return;
      }
      injectStyle();
      tipIndex = 0;
      hiding = false;
      shownAt = Date.now();
      overlay = buildOverlay(opts || {});
      (document.body || document.documentElement).appendChild(overlay);

      // Trigger the fade-in on the next frame.
      window.requestAnimationFrame(() => {
        if (overlay) overlay.classList.add('ml-visible');
      });

      canvas = overlay.querySelector('#matrix-loader-canvas');
      if (canvas) {
        ctx = canvas.getContext('2d');
        sizeCanvas();
        resizeHandler = function () { sizeCanvas(); };
        window.addEventListener('resize', resizeHandler);
        rafId = window.requestAnimationFrame(drawFrame);
      }

      tipRotationId = window.setInterval(rotateTip, 2600);

      // Safety: never let the overlay outlive a stuck boot.
      maxLifetimeId = window.setTimeout(function () { hide(); }, MAX_LIFETIME_MS);
    } catch (err) {
      try { console.warn('MatrixLoader.show() failed:', err && err.message); } catch (_) { /* noop */ }
      try { teardown(); } catch (_) { /* noop */ }
    }
  }

  function hide() {
    try {
      if (!overlay) return;
      if (hiding) return;            // already scheduled / fading

      // Honour the minimum-display window so a fast boot doesn't flash.
      const elapsed = Date.now() - shownAt;
      if (elapsed < MIN_DISPLAY_MS) {
        if (pendingHideId) return;   // a deferred hide is already queued
        pendingHideId = window.setTimeout(function () {
          pendingHideId = null;
          hide();
        }, MIN_DISPLAY_MS - elapsed);
        return;
      }

      hiding = true;
      clearTimers();
      if (overlay) overlay.classList.remove('ml-visible');
      const target = overlay;
      window.setTimeout(function () {
        // Only tear down if this is still the same overlay (a show() may have
        // re-mounted in the interim, though that path resets `hiding`).
        if (overlay === target) teardown();
        else if (target && target.parentNode) target.parentNode.removeChild(target);
      }, FADE_MS);
    } catch (err) {
      try { console.warn('MatrixLoader.hide() failed:', err && err.message); } catch (_) { /* noop */ }
      try { teardown(); } catch (_) { /* noop */ }
    }
  }

  return { show: show, hide: hide };
})();
