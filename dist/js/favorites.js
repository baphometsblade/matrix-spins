/* ============================================================
   Matrix Spins — Favorites & Recently Played  (auto-inject IIFE)
   Injects heart buttons on every .game-card and builds
   "Your Favorites" / "Recently Played" rows on index.html.
   ============================================================ */
(function () {
  'use strict';

  var LS_FAV = 'ms_favorites';
  var LS_RECENT = 'ms_recently_played';
  var MAX_RECENT = 12;
  var DISPLAY_RECENT = 6;

  var HEART_SVG =
    '<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">' +
    '<path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 ' +
    '2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 ' +
    '14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 ' +
    '11.54L12 21.35z"/></svg>';

  /* ---------- LocalStorage helpers ---------- */

  function getFavorites() {
    try { return JSON.parse(localStorage.getItem(LS_FAV)) || []; }
    catch (e) { return []; }
  }

  function saveFavorites(arr) {
    try { localStorage.setItem(LS_FAV, JSON.stringify(arr)); } catch (e) {}
  }

  function getRecent() {
    try { return JSON.parse(localStorage.getItem(LS_RECENT)) || []; }
    catch (e) { return []; }
  }

  function saveRecent(arr) {
    try { localStorage.setItem(LS_RECENT, JSON.stringify(arr)); } catch (e) {}
  }

  function isFavorite(slug) {
    return getFavorites().indexOf(slug) !== -1;
  }

  function toggleFavorite(slug) {
    var favs = getFavorites();
    var idx = favs.indexOf(slug);
    if (idx === -1) { favs.push(slug); } else { favs.splice(idx, 1); }
    saveFavorites(favs);
    return idx === -1; // true = added
  }

  function recordRecentPlay(slug) {
    var list = getRecent();
    // Remove existing entry for this slug (dedup)
    list = list.filter(function (e) { return e.slug !== slug; });
    list.unshift({ slug: slug, ts: Date.now() });
    if (list.length > MAX_RECENT) list = list.slice(0, MAX_RECENT);
    saveRecent(list);
  }

  /* ---------- Slug extraction ---------- */

  function slugFromCard(card) {
    // data-slug attribute
    var ds = card.getAttribute('data-slug');
    if (ds) return ds;
    // data-game-id
    var gid = card.getAttribute('data-game-id') || card.getAttribute('data-id');
    if (gid) return gid;
    // Try to extract from onclick href pattern  games/{id}.html
    var link = card.querySelector('a[href]');
    if (link) {
      var m = link.getAttribute('href').match(/games\/([^/.]+)/);
      if (m) return m[1];
    }
    // Fallback: parse the game name into a slug
    var nameEl = card.querySelector('.game-name, .game-card-name, .game-title, h3, h4');
    if (nameEl) return nameEl.textContent.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
    return '';
  }

  /* ---------- Build catalog lookup ---------- */

  function buildLookup() {
    var map = {};
    // From GAME_CATALOG
    if (window.GAME_CATALOG && Array.isArray(window.GAME_CATALOG)) {
      window.GAME_CATALOG.forEach(function (g) {
        var s = g.slug || g.id || (g.name || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
        if (s) {
          map[s] = {
            name: g.name || s,
            studio: g.studio || g.provider || '',
            icon: g.icon || g.emoji || '🎰',
            slug: s
          };
        }
      });
    }
    // Supplement from DOM cards
    document.querySelectorAll('.game-card').forEach(function (card) {
      var slug = slugFromCard(card);
      if (!slug || map[slug]) return;
      var nameEl = card.querySelector('.game-name, .game-card-name, .game-title, h3, h4');
      var studioEl = card.querySelector('.game-studio, .game-studio-badge, .game-provider, .studio, .game-card-studio');
      map[slug] = {
        name: nameEl ? nameEl.textContent.trim() : slug,
        studio: studioEl ? studioEl.textContent.trim() : '',
        icon: card.getAttribute('data-icon') || '🎰',
        slug: slug
      };
    });
    // Also stash metadata when we see it
    return map;
  }

  /* ---------- Inject heart buttons ---------- */

  function injectHearts() {
    document.querySelectorAll('.game-card').forEach(function (card) {
      if (card.querySelector('.fav-heart')) return; // already injected
      var slug = slugFromCard(card);
      if (!slug) return;

      // Store slug on the card for easy access
      card.setAttribute('data-slug', slug);

      var btn = document.createElement('button');
      btn.className = 'fav-heart' + (isFavorite(slug) ? ' active' : '');
      btn.setAttribute('aria-label', 'Toggle favorite');
      btn.innerHTML = HEART_SVG;

      btn.addEventListener('click', function (e) {
        e.preventDefault();
        e.stopPropagation();
        var added = toggleFavorite(slug);
        btn.classList.toggle('active', added);
        // Pulse animation
        btn.classList.remove('pulse');
        void btn.offsetWidth; // reflow
        btn.classList.add('pulse');
        // Refresh sections if on index
        refreshSections();
      });

      card.appendChild(btn);

      // Intercept card click to record recently played
      var origClick = card.onclick;
      card.onclick = function (e) {
        // If the heart was clicked, do nothing (already handled)
        if (e.target.closest && e.target.closest('.fav-heart')) return;
        recordRecentPlay(slug);
        // Store metadata for offline lookup
        storeMetadata(slug, card);
        if (typeof origClick === 'function') origClick.call(card, e);
      };
    });
  }

  function storeMetadata(slug, card) {
    try {
      var meta = JSON.parse(localStorage.getItem('ms_meta') || '{}');
      if (meta[slug]) return;
      var nameEl = card.querySelector('.game-name, .game-card-name, .game-title, h3, h4');
      var studioEl = card.querySelector('.game-studio, .game-studio-badge, .game-provider, .studio, .game-card-studio');
      meta[slug] = {
        name: nameEl ? nameEl.textContent.trim() : slug,
        studio: studioEl ? studioEl.textContent.trim() : '',
        icon: card.getAttribute('data-icon') || '🎰'
      };
      localStorage.setItem('ms_meta', JSON.stringify(meta));
    } catch (e) {}
  }

  /* ---------- Section injection (index page) ---------- */

  var favSectionEl = null;
  var recentSectionEl = null;
  var sectionsAnchor = null;

  function isIndexPage() {
    return !!(document.querySelector('.game-grid, #gameGrid'));
  }

  function ensureSections() {
    if (!isIndexPage()) return false;
    if (!sectionsAnchor) {
      sectionsAnchor = document.querySelector('.game-grid, #gameGrid');
    }
    if (!sectionsAnchor) return false;

    if (!favSectionEl) {
      favSectionEl = document.createElement('section');
      favSectionEl.className = 'fav-section fav-section--favorites';
      sectionsAnchor.parentNode.insertBefore(favSectionEl, sectionsAnchor);
    }
    if (!recentSectionEl) {
      recentSectionEl = document.createElement('section');
      recentSectionEl.className = 'fav-section fav-section--recent';
      sectionsAnchor.parentNode.insertBefore(recentSectionEl, sectionsAnchor);
    }
    return true;
  }

  function buildMiniCard(info) {
    var el = document.createElement('a');
    el.className = 'fav-mini-card';
    el.href = 'games/' + info.slug + '.html';
    el.setAttribute('aria-label', 'Play ' + info.name);
    el.innerHTML =
      '<div class="fav-mini-icon">' + info.icon + '</div>' +
      '<div class="fav-mini-body">' +
        '<div class="fav-mini-name">' + escapeHtml(info.name) + '</div>' +
        '<div class="fav-mini-studio">' + escapeHtml(info.studio || '') + '</div>' +
        '<div class="fav-mini-play">▶ Play</div>' +
      '</div>';
    el.addEventListener('click', function () {
      recordRecentPlay(info.slug);
    });
    return el;
  }

  function refreshSections() {
    if (!ensureSections()) return;

    var lookup = buildLookup();

    // Also load stored metadata as fallback
    var meta = {};
    try { meta = JSON.parse(localStorage.getItem('ms_meta') || '{}'); } catch (e) {}

    function resolve(slug) {
      return lookup[slug] || meta[slug] || { name: slug, studio: '', icon: '🎰', slug: slug };
    }

    // ---- Favorites ----
    var favs = getFavorites();
    var favTitle =
      '<div class="fav-section-title">' +
        '<svg viewBox="0 0 24 24" fill="#d4af37" xmlns="http://www.w3.org/2000/svg">' +
          '<path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 ' +
          '2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 ' +
          '14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 ' +
          '11.54L12 21.35z"/></svg>' +
        'Your Favorites' +
      '</div>';

    if (favs.length === 0) {
      favSectionEl.innerHTML = favTitle +
        '<div class="fav-empty">♡ No favorites yet — click the heart on any game to save it</div>';
    } else {
      favSectionEl.innerHTML = favTitle + '<div class="fav-scroll"></div>';
      var scroll = favSectionEl.querySelector('.fav-scroll');
      favs.forEach(function (slug) {
        scroll.appendChild(buildMiniCard(resolve(slug)));
      });
    }

    // ---- Recently Played ----
    var recent = getRecent().slice(0, DISPLAY_RECENT);
    if (recent.length === 0) {
      recentSectionEl.innerHTML = '';
      recentSectionEl.style.display = 'none';
    } else {
      recentSectionEl.style.display = '';
      var recentTitle =
        '<div class="fav-section-title">' +
          '<svg viewBox="0 0 24 24" fill="none" stroke="#d4af37" stroke-width="2" xmlns="http://www.w3.org/2000/svg">' +
            '<circle cx="12" cy="12" r="10"/>' +
            '<polyline points="12 6 12 12 16 14"/>' +
          '</svg>' +
          'Recently Played' +
        '</div>';
      recentSectionEl.innerHTML = recentTitle + '<div class="fav-scroll"></div>';
      var rScroll = recentSectionEl.querySelector('.fav-scroll');
      recent.forEach(function (entry) {
        rScroll.appendChild(buildMiniCard(resolve(entry.slug)));
      });
    }
  }

  /* ---------- Public API ---------- */

  window.MatrixFavorites = {
    toggle: function (slug) { return toggleFavorite(slug); },
    isFavorite: function (slug) { return isFavorite(slug); },
    getAll: function () { return getFavorites(); },
    getRecent: function () { return getRecent(); }
  };

  /* ---------- Init on DOM ready ---------- */

  function init() {
    injectHearts();
    refreshSections();

    // Re-inject if the game grid re-renders (e.g. after filter/search)
    var grid = document.querySelector('#gameGrid, .game-grid');
    if (grid && typeof MutationObserver !== 'undefined') {
      new MutationObserver(function () {
        injectHearts();
      }).observe(grid, { childList: true, subtree: true });
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
