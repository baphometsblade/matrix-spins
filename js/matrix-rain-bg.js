/* ═══════════════════════════════════════════════════════════════════════════
   Matrix-rain background — green falling glyphs behind the auth (signup/login)
   forms. Self-contained, no dependencies, CSP-safe (self-hosted, no eval).
   Honours prefers-reduced-motion and pauses when the tab is hidden so it never
   burns battery. Styling for .matrix-rain-canvas lives in css/matrix-theme.css.
   ═══════════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  if (window.__matrixRainStarted) return;
  window.__matrixRainStarted = true;

  function start() {
    if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      return; // respect motion preference — CSS hides the canvas too
    }

    document.body.classList.add('matrix-auth');

    var canvas = document.createElement('canvas');
    canvas.className = 'matrix-rain-canvas';
    canvas.setAttribute('aria-hidden', 'true');
    document.body.insertBefore(canvas, document.body.firstChild);

    var ctx = canvas.getContext('2d');
    if (!ctx) return;

    var glyphs = 'アァカサタナハマヤャラワabcdef0123456789$£€¥@#%&MATRIXSPINS'.split('');
    var fontSize = 16;
    var columns = 0;
    var drops = [];

    function resize() {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
      columns = Math.floor(canvas.width / fontSize);
      drops = new Array(columns);
      for (var i = 0; i < columns; i++) {
        drops[i] = Math.floor((Math.random() * canvas.height) / fontSize);
      }
    }
    resize();
    window.addEventListener('resize', resize);

    var FRAME_MS = 55; // ~18fps — plenty for rain, gentle on CPU
    var last = 0;
    var rafId = 0;
    var running = true;

    function draw(ts) {
      if (!running) return;
      rafId = window.requestAnimationFrame(draw);
      if (ts - last < FRAME_MS) return;
      last = ts;

      // translucent black fade leaves comet trails
      ctx.fillStyle = 'rgba(10, 10, 10, 0.08)';
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      ctx.font = fontSize + 'px monospace';
      for (var i = 0; i < drops.length; i++) {
        var text = glyphs[Math.floor(Math.random() * glyphs.length)];
        var x = i * fontSize;
        var y = drops[i] * fontSize;

        // lead glyph is bright, trail is Matrix green
        ctx.fillStyle = Math.random() > 0.975 ? '#aaffbb' : '#00ff41';
        ctx.fillText(text, x, y);

        if (y > canvas.height && Math.random() > 0.975) {
          drops[i] = 0;
        }
        drops[i]++;
      }
    }
    rafId = window.requestAnimationFrame(draw);

    // Pause when tab hidden; resume when visible
    document.addEventListener('visibilitychange', function () {
      if (document.hidden) {
        running = false;
        if (rafId) window.cancelAnimationFrame(rafId);
      } else if (!running) {
        running = true;
        last = 0;
        rafId = window.requestAnimationFrame(draw);
      }
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }
})();
