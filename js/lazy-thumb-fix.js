/**
 * Matrix Spins Casino — Lazy Thumbnail Loader Fix v2
 *
 * The bundled lobby code creates game cards with data-bg attributes
 * but then sets el.style.background = '...' which overrides any
 * background-image set by the original IntersectionObserver.
 *
 * This fix uses a periodic check + MutationObserver to reliably
 * apply thumbnails AFTER the lobby code finishes styling cards.
 */
(function() {
  'use strict';

  function loadThumb(el) {
    var bg = el.getAttribute('data-bg');
    if (!bg) return;
    el.style.setProperty('background-image', 'url(' + bg + ')', 'important');
    el.style.setProperty('background-size', 'cover', 'important');
    el.style.setProperty('background-position', 'center', 'important');
    el.removeAttribute('data-bg');
    el.classList.add('thumb-loaded');
  }

  function applyAll() {
    var els = document.querySelectorAll('[data-bg]');
    if (els.length) {
      els.forEach(loadThumb);
    }
    return els.length;
  }

  function init() {
    // Immediate pass
    applyAll();

    // Periodic check — catches cards styled by lobby code after DOM insertion
    // Runs every 500ms for 30 seconds, then every 2s indefinitely for dynamic content
    var passes = 0;
    var interval = setInterval(function() {
      var applied = applyAll();
      passes++;
      // After 30s (60 passes at 500ms), slow down to every 2s
      if (passes === 60) {
        clearInterval(interval);
        setInterval(applyAll, 2000);
      }
    }, 500);

    // MutationObserver for dynamically added elements (filter changes, etc.)
    if ('MutationObserver' in window) {
      var mo = new MutationObserver(function() {
        // Debounce: wait 100ms for lobby code to finish styling
        clearTimeout(mo._timer);
        mo._timer = setTimeout(applyAll, 100);
      });
      mo.observe(document.body, { childList: true, subtree: true });
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
