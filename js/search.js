/* ============================================
   Matrix Spins Casino - Global Game Search
   Auto-injecting IIFE  |  Exposes window.MatrixSearch
   ============================================ */
(function () {
  'use strict';

  /* ---------- Real catalog fetched from /api/games ---------- */
  var API_BASE = '';
  var DEBOUNCE_MS = 180;

  /* ---------- Helpers ---------- */
  function slugify(str) {
    return str.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
  }

  function escapeHTML(s) {
    var d = document.createElement('div');
    d.appendChild(document.createTextNode(s));
    return d.innerHTML;
  }

  /* ---------- Server search (live API) ---------- */
  var searchAbort = null;
  function serverSearch(query) {
    if (searchAbort) try { searchAbort.abort(); } catch (_) {}
    searchAbort = (typeof AbortController !== 'undefined') ? new AbortController() : null;
    var url = API_BASE + '/api/games/search?q=' + encodeURIComponent(query) + '&limit=12';
    return fetch(url, {
      credentials: 'same-origin',
      signal: searchAbort ? searchAbort.signal : undefined
    }).then(function (r) {
      if (!r.ok) throw new Error('search_failed');
      return r.json();
    }).then(function (d) { return (d && d.results) || []; });
  }

  function trackClick(query, gameId) {
    try {
      fetch(API_BASE + '/api/games/search/track', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: query, gameId: gameId }),
        keepalive: true
      });
    } catch (_) {}
  }

  function debounce(fn, ms) {
    var t;
    return function () {
      var ctx = this, args = arguments;
      clearTimeout(t);
      t = setTimeout(function () { fn.apply(ctx, args); }, ms);
    };
  }

  /* ---------- Popular searches ---------- */
  var popularCache = null;
  function fetchPopular() {
    if (popularCache) return Promise.resolve(popularCache);
    return fetch(API_BASE + '/api/games/popular', { credentials: 'same-origin' })
      .then(function (r) { return r.ok ? r.json() : { popular: [] }; })
      .then(function (d) { popularCache = (d && d.popular) || []; return popularCache; })
      .catch(function () { return []; });
  }

  function highlightMatch(text, query) {
    if (!query.trim()) return escapeHTML(text);
    var esc = escapeHTML(text);
    var re = new RegExp('(' + query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').split(/\s+/).join('|') + ')', 'gi');
    return esc.replace(re, '<mark>$1</mark>');
  }

  /* ---------- Recent Searches (persistent) ---------- */
  var STORAGE_KEY = 'ms_recent_searches';

  function getRecent() {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEY)) || [];
    } catch (e) { return []; }
  }

  function addRecent(term) {
    if (!term) return;
    var list = getRecent().filter(function (t) { return t !== term; });
    list.unshift(term);
    if (list.length > 6) list = list.slice(0, 6);
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(list)); } catch (e) {}
  }

  function removeRecent(term) {
    var list = getRecent().filter(function (t) { return t !== term; });
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(list)); } catch (e) {}
  }

  /* ---------- DOM Creation ---------- */
  var magnifyingSVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>';

  var overlay, input, resultsContainer, focusedIdx = -1;
  var FALLBACK_THUMB = 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" fill="%231a1a1a"/><text x="50%" y="55%" font-size="32" text-anchor="middle" fill="%23DAA520">🎰</text></svg>';

  function createOverlay() {
    overlay = document.createElement('div');
    overlay.className = 'ms-search-overlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-label', 'Game Search');
    overlay.innerHTML =
      '<div class="ms-search-card">' +
        '<div class="ms-search-input-wrap">' +
          magnifyingSVG +
          '<input class="ms-search-input" type="text" placeholder="Search games..." autocomplete="off" />' +
          '<span class="ms-search-kbd">⌘K</span>' +
        '</div>' +
        '<div class="ms-search-results"></div>' +
        '<div class="ms-search-footer">' +
          '<span><kbd>↑</kbd><kbd>↓</kbd> Navigate</span>' +
          '<span><kbd>Enter</kbd> Open &nbsp; <kbd>Esc</kbd> Close</span>' +
        '</div>' +
      '</div>';

    document.body.appendChild(overlay);

    input = overlay.querySelector('.ms-search-input');
    resultsContainer = overlay.querySelector('.ms-search-results');

    // Close on backdrop click
    overlay.addEventListener('click', function (e) {
      if (e.target === overlay) closeSearch();
    });

    // Input handling — debounced server search
    var debouncedSearch = debounce(function () {
      var q = input.value.trim();
      if (!q) { renderRecent(); return; }
      serverSearch(q).then(function (results) {
        if (input.value.trim() !== q) return; // stale response
        renderResults(q, results);
      }).catch(function (err) {
        if (err && err.name === 'AbortError') return;
        renderError();
      });
    }, DEBOUNCE_MS);

    input.addEventListener('input', function () {
      focusedIdx = -1;
      debouncedSearch();
    });

    input.addEventListener('keydown', function (e) {
      var items = resultsContainer.querySelectorAll('.ms-search-item');
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        focusedIdx = Math.min(focusedIdx + 1, items.length - 1);
        updateFocus(items);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        focusedIdx = Math.max(focusedIdx - 1, -1);
        updateFocus(items);
      } else if (e.key === 'Enter' && focusedIdx >= 0 && items[focusedIdx]) {
        e.preventDefault();
        items[focusedIdx].click();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        closeSearch();
      }
    });
  }

  function updateFocus(items) {
    items.forEach(function (el, i) {
      el.classList.toggle('focused', i === focusedIdx);
      if (i === focusedIdx) {
        el.scrollIntoView({ block: 'nearest' });
      }
    });
  }

  /* ---------- Render ---------- */
  function renderResults(query, results) {
    if (!results.length) {
      resultsContainer.innerHTML =
        '<div class="ms-search-empty">' +
          '<div class="ms-search-empty-icon">🔍</div>' +
          '<div class="ms-search-empty-title">No games found for &ldquo;' + escapeHTML(query) + '&rdquo;</div>' +
          '<div class="ms-search-empty-hint">Try a shorter keyword or browse our categories</div>' +
        '</div>';
      return;
    }

    var html = '<div class="ms-search-label">Results · ' + results.length + '</div>';
    results.forEach(function (g) {
      var thumb = g.thumbnail || FALLBACK_THUMB;
      var url = g.url || ('games/' + encodeURIComponent(g.slug || g.id) + '.html');
      var rtpStr = (typeof g.rtp === 'number')
        ? '<span class="ms-search-item-rtp">' + g.rtp.toFixed(1) + '% RTP</span>'
        : '';
      var theme = g.themeCategory ? ' · <span class="ms-search-cat">' + escapeHTML(g.themeCategory) + '</span>' : '';
      html +=
        '<a class="ms-search-item" href="' + escapeHTML(url) +
          '" data-name="' + escapeHTML(g.name || '') + '" data-id="' + escapeHTML(g.id || '') + '">' +
          '<img class="ms-search-item-thumb" src="' + escapeHTML(thumb) + '" alt="" loading="lazy" onerror="this.src=\'' + FALLBACK_THUMB + '\'" />' +
          '<div class="ms-search-item-info">' +
            '<div class="ms-search-item-name">' + highlightMatch(g.name || '', query) + '</div>' +
            '<div class="ms-search-item-studio">' + highlightMatch(g.provider || '', query) + theme + '</div>' +
          '</div>' +
          rtpStr +
        '</a>';
    });
    resultsContainer.innerHTML = html;

    resultsContainer.querySelectorAll('.ms-search-item').forEach(function (el) {
      el.addEventListener('click', function () {
        var name = el.getAttribute('data-name');
        var id = el.getAttribute('data-id');
        addRecent(name);
        trackClick(query, id);
      });
    });
  }

  function renderError() {
    resultsContainer.innerHTML =
      '<div class="ms-search-empty">' +
        '<div class="ms-search-empty-icon">⚠️</div>' +
        '<div class="ms-search-empty-title">Search temporarily unavailable</div>' +
        '<div class="ms-search-empty-hint">Please try again in a moment</div>' +
      '</div>';
  }

  function renderRecent() {
    var recent = getRecent();
    var html = '';

    if (recent.length) {
      html += '<div class="ms-search-label">Recent</div>';
      recent.forEach(function (term) {
        html +=
          '<div class="ms-search-item ms-search-recent" data-recent="' + escapeHTML(term) + '">' +
            '<div class="ms-search-item-icon">🕒</div>' +
            '<div class="ms-search-item-info">' +
              '<div class="ms-search-item-name">' + escapeHTML(term) + '</div>' +
            '</div>' +
            '<button class="ms-search-item-remove" title="Remove" aria-label="Remove recent search" data-remove="' + escapeHTML(term) + '">&times;</button>' +
          '</div>';
      });
    }

    resultsContainer.innerHTML = html ||
      '<div class="ms-search-empty">' +
        '<div class="ms-search-empty-icon">🎰</div>' +
        '<div class="ms-search-empty-title">Search 100+ Games</div>' +
        '<div class="ms-search-empty-hint">Find slots by name, studio, or theme</div>' +
      '</div>';

    fetchPopular().then(function (popular) {
      if (input.value.trim()) return;
      if (!popular || !popular.length) return;
      var ph = '<div class="ms-search-label" style="margin-top:14px">Popular searches</div>';
      ph += '<div class="ms-search-popular">';
      popular.slice(0, 8).forEach(function (p) {
        ph += '<button class="ms-search-chip" data-pop="' + escapeHTML(p.query) + '">' + escapeHTML(p.query) + '</button>';
      });
      ph += '</div>';
      resultsContainer.insertAdjacentHTML('beforeend', ph);
      resultsContainer.querySelectorAll('[data-pop]').forEach(function (btn) {
        btn.addEventListener('click', function () {
          input.value = btn.getAttribute('data-pop');
          input.dispatchEvent(new Event('input'));
        });
      });
    });

    resultsContainer.querySelectorAll('[data-recent]').forEach(function (el) {
      el.addEventListener('click', function (e) {
        if (e.target.closest('.ms-search-item-remove')) return;
        input.value = el.getAttribute('data-recent');
        input.dispatchEvent(new Event('input'));
      });
    });

    resultsContainer.querySelectorAll('[data-remove]').forEach(function (btn) {
      btn.addEventListener('click', function (e) {
        e.stopPropagation();
        removeRecent(btn.getAttribute('data-remove'));
        renderRecent();
      });
    });
  }

  /* ---------- Open / Close ---------- */
  function openSearch() {
    if (!overlay) createOverlay();
    overlay.classList.add('active');
    document.body.style.overflow = 'hidden';
    input.value = '';
    focusedIdx = -1;
    renderRecent();
    requestAnimationFrame(function () { input.focus(); });
  }

  function closeSearch() {
    if (!overlay) return;
    overlay.classList.remove('active');
    document.body.style.overflow = '';
  }

  /* ---------- Keyboard Shortcuts: Ctrl/Cmd+K + "/" ---------- */
  document.addEventListener('keydown', function (e) {
    var isOpen = overlay && overlay.classList.contains('active');
    var key = e.key && e.key.toLowerCase();

    if ((e.metaKey || e.ctrlKey) && key === 'k') {
      e.preventDefault();
      isOpen ? closeSearch() : openSearch();
      return;
    }

    if (e.key === '/' && !isOpen) {
      var t = e.target;
      var tag = t && t.tagName;
      var typing = tag === 'INPUT' || tag === 'TEXTAREA' || (t && t.isContentEditable);
      if (!typing) {
        e.preventDefault();
        openSearch();
      }
    }

    if (e.key === 'Escape' && isOpen) closeSearch();
  });

  /* ---------- Inject Trigger Button ---------- */
  function injectTrigger() {
    if (document.querySelector('.ms-search-trigger')) return;

    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'ms-search-trigger';
    btn.setAttribute('aria-label', 'Search games (Ctrl+K)');
    btn.setAttribute('title', 'Search (Ctrl+K)');
    btn.innerHTML = magnifyingSVG +
      '<span class="ms-search-trigger-label">Search</span>' +
      '<span class="ms-search-trigger-kbd">Ctrl+K</span>';
    btn.addEventListener('click', function (e) {
      e.preventDefault();
      openSearch();
    });

    var target =
      document.querySelector('.header-right') ||
      document.querySelector('.nav-right') ||
      document.querySelector('.actions') ||
      document.querySelector('.user-menu') ||
      document.querySelector('header nav') ||
      document.querySelector('.top-nav');
    if (target) {
      target.prepend(btn);
    } else {
      btn.classList.add('ms-search-trigger-floating');
      document.body.appendChild(btn);
    }
  }

  /* ---------- Init on DOM Ready ---------- */
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', injectTrigger);
  } else {
    injectTrigger();
  }

  /* ---------- Public API ---------- */
  window.MatrixSearch = {
    open: openSearch,
    close: closeSearch
  };
})();
