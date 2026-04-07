/**
 * Matrix Spins Casino — Lazy Thumbnail Loader Fix
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
  function initLazy() {
    var els = document.querySelectorAll('[data-bg]');
    if (!els.length) return;
    if ('IntersectionObserver' in window) {
      var obs = new IntersectionObserver(function(entries) {
        entries.forEach(function(entry) {
          if (entry.isIntersecting) { loadThumb(entry.target); obs.unobserve(entry.target); }
        });
      }, { rootMargin: '200px' });
      els.forEach(function(el) { obs.observe(el); });
    } else { els.forEach(loadThumb); }
    if ('MutationObserver' in window) {
      var mo = new MutationObserver(function(mutations) {
        mutations.forEach(function(m) {
          m.addedNodes.forEach(function(node) {
            if (node.nodeType !== 1) return;
            if (node.hasAttribute && node.hasAttribute('data-bg')) loadThumb(node);
            var ch = node.querySelectorAll ? node.querySelectorAll('[data-bg]') : [];
            ch.forEach(loadThumb);
          });
        });
      });
      mo.observe(document.body, { childList: true, subtree: true });
    }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initLazy);
  else initLazy();
})();
