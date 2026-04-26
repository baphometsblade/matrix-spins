/* ============================================
   Matrix Spins Casino - Global Game Search
   Auto-injecting IIFE  |  Exposes window.MatrixSearch
   ============================================ */
(function () {
  'use strict';

  /* ---------- Default Game Catalog ---------- */
  var DEFAULT_GAMES = [
    { name: 'Golden Cherry Cascade',   studio: 'Matrix Originals', rtp: 96.5, volatility: 'Medium', icon: '🍒' },
    { name: 'Retro Fruit Fiesta',      studio: 'ClassicPlay',      rtp: 95.8, volatility: 'Low',    icon: '🍋' },
    { name: 'Nebula Space Odyssey',    studio: 'CosmicBet',        rtp: 96.2, volatility: 'High',   icon: '🚀' },
    { name: 'Pharaoh Eternal Dynasty', studio: 'NileGames',        rtp: 95.4, volatility: 'High',   icon: '🏛️' },
    { name: 'Dragon Pearl Deluxe',     studio: 'EastForge',        rtp: 96.8, volatility: 'Medium', icon: '🐉' },
    { name: 'Neon Blitz',             studio: 'VoltSlots',         rtp: 97.0, volatility: 'High',   icon: '⚡' },
    { name: 'Crystal Caves',          studio: 'GemStudio',         rtp: 95.6, volatility: 'Low',    icon: '💎' },
    { name: 'Samurai Fortune',        studio: 'EastForge',         rtp: 96.1, volatility: 'Medium', icon: '⚔️' },
    { name: 'Viking Thunder',         studio: 'NordicPlay',        rtp: 96.3, volatility: 'High',   icon: '🪓' },
    { name: 'Aztec Gold Temple',      studio: 'NileGames',         rtp: 95.9, volatility: 'Medium', icon: '🏛️' },
    { name: 'Lucky Sevens Infinity',   studio: 'ClassicPlay',      rtp: 96.7, volatility: 'Low',    icon: '🎰' },
    { name: 'Cosmic Raider Mission',   studio: 'CosmicBet',        rtp: 95.3, volatility: 'High',   icon: '👾' },
    { name: 'Cherry Blossom Bonus',    studio: 'EastForge',        rtp: 96.0, volatility: 'Low',    icon: '🌸' },
    { name: 'Midnight Wolf Run',       studio: 'WildEdge',         rtp: 96.4, volatility: 'High',   icon: '🐺' },
    { name: 'Diamond Dash Express',    studio: 'GemStudio',        rtp: 97.0, volatility: 'Medium', icon: '💎' },
    { name: 'Ocean Treasure Hunter',   studio: 'AquaBet',          rtp: 95.7, volatility: 'Medium', icon: '🌊' },
    { name: 'Fire Phoenix Rising',     studio: 'Matrix Originals', rtp: 96.6, volatility: 'High',   icon: '🔥' },
    { name: 'Jungle Jackpot Safari',   studio: 'WildEdge',         rtp: 95.5, volatility: 'Medium', icon: '🦁' },
    { name: 'Mystic Moonlight',        studio: 'Matrix Originals', rtp: 96.9, volatility: 'Low',    icon: '🌙' },
    { name: 'Royal Flush Fortune',     studio: 'ClassicPlay',      rtp: 96.2, volatility: 'Medium', icon: '🂠' }
  ];

  /* ---------- Helpers ---------- */
  function slugify(str) {
    return str.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
  }

  function escapeHTML(s) {
    var d = document.createElement('div');
    d.appendChild(document.createTextNode(s));
    return d.innerHTML;
  }

  /* ---------- Build Catalog ---------- */
  function buildCatalog() {
    // Priority 1: window.GAME_CATALOG
    if (window.GAME_CATALOG && Array.isArray(window.GAME_CATALOG) && window.GAME_CATALOG.length) {
      return window.GAME_CATALOG.map(function (g) {
        return {
          name: g.name || 'Unknown',
          studio: g.studio || g.provider || '',
          rtp: parseFloat(g.rtp) || 96.0,
          volatility: g.volatility || 'Medium',
          icon: g.icon || g.emoji || '🎰',
          slug: g.slug || slugify(g.name || 'game')
        };
      });
    }

    // Priority 2: DOM game-cards
    var cards = document.querySelectorAll('.game-card');
    if (cards.length > 0) {
      var games = [];
      cards.forEach(function (card) {
        var nameEl = card.querySelector('.game-name, .game-title, h3, h4');
        var name = nameEl ? nameEl.textContent.trim() : '';
        if (!name) return;
        var studioEl = card.querySelector('.game-studio, .game-provider, .studio');
        var rtpEl = card.querySelector('.game-rtp, .rtp');
        games.push({
          name: name,
          studio: studioEl ? studioEl.textContent.trim() : '',
          rtp: rtpEl ? parseFloat(rtpEl.textContent) || 96.0 : 96.0,
          volatility: card.getAttribute('data-volatility') || 'Medium',
          icon: card.getAttribute('data-icon') || '🎰',
          slug: card.getAttribute('data-slug') || slugify(name)
        });
      });
      if (games.length) return games;
    }

    // Priority 3: Built-in defaults
    return DEFAULT_GAMES.map(function (g) {
      return Object.assign({}, g, { slug: slugify(g.name) });
    });
  }

  /* ---------- Fuzzy Scoring ---------- */
  function fuzzyScore(query, text) {
    var q = query.toLowerCase();
    var t = text.toLowerCase();

    // Exact substring match gets highest score
    var idx = t.indexOf(q);
    if (idx === 0) return 100;
    if (idx > 0) return 80;

    // Word-start matching
    var words = t.split(/\s+/);
    var qWords = q.split(/\s+/);
    var matched = 0;
    qWords.forEach(function (qw) {
      for (var i = 0; i < words.length; i++) {
        if (words[i].indexOf(qw) === 0) { matched++; break; }
        if (words[i].indexOf(qw) !== -1) { matched += 0.5; break; }
      }
    });
    if (matched > 0) return (matched / qWords.length) * 60;

    // Character-sequence match
    var qi = 0;
    var score = 0;
    for (var ti = 0; ti < t.length && qi < q.length; ti++) {
      if (t[ti] === q[qi]) { score += 1; qi++; }
    }
    if (qi === q.length) return (score / t.length) * 40;

    return 0;
  }

  function searchGames(query, catalog) {
    if (!query.trim()) return [];
    var results = [];
    catalog.forEach(function (game) {
      var nameScore = fuzzyScore(query, game.name);
      var studioScore = fuzzyScore(query, game.studio) * 0.5;
      var best = Math.max(nameScore, studioScore);
      if (best > 10) {
        results.push({ game: game, score: best });
      }
    });
    results.sort(function (a, b) { return b.score - a.score; });
    return results.slice(0, 8);
  }

  function highlightMatch(text, query) {
    if (!query.trim()) return escapeHTML(text);
    var esc = escapeHTML(text);
    var re = new RegExp('(' + query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').split(/\s+/).join('|') + ')', 'gi');
    return esc.replace(re, '<mark>$1</mark>');
  }

  /* ---------- Recent Searches ---------- */
  var STORAGE_KEY = 'ms_recent_searches';

  function getRecent() {
    try {
      return JSON.parse(sessionStorage.getItem(STORAGE_KEY)) || [];
    } catch (e) { return []; }
  }

  function addRecent(term) {
    var list = getRecent().filter(function (t) { return t !== term; });
    list.unshift(term);
    if (list.length > 5) list = list.slice(0, 5);
    try { sessionStorage.setItem(STORAGE_KEY, JSON.stringify(list)); } catch (e) {}
  }

  function removeRecent(term) {
    var list = getRecent().filter(function (t) { return t !== term; });
    try { sessionStorage.setItem(STORAGE_KEY, JSON.stringify(list)); } catch (e) {}
  }

  /* ---------- DOM Creation ---------- */
  var magnifyingSVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>';

  var overlay, input, resultsContainer, catalog, focusedIdx = -1;

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

    // Input handling
    input.addEventListener('input', function () {
      focusedIdx = -1;
      renderResults(input.value.trim());
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
  function renderResults(query) {
    if (!query) {
      renderRecent();
      return;
    }

    var results = searchGames(query, catalog);
    if (!results.length) {
      resultsContainer.innerHTML =
        '<div class="ms-search-empty">' +
          '<div class="ms-search-empty-icon">🔍</div>' +
          '<div class="ms-search-empty-title">No games found</div>' +
          '<div class="ms-search-empty-hint">Try a shorter keyword or browse our categories</div>' +
        '</div>';
      return;
    }

    var html = '<div class="ms-search-label">Results</div>';
    results.forEach(function (r) {
      html +=
        '<a class="ms-search-item" href="games/' + encodeURIComponent(r.game.slug) + '.html" data-name="' + escapeHTML(r.game.name) + '">' +
          '<div class="ms-search-item-icon">' + r.game.icon + '</div>' +
          '<div class="ms-search-item-info">' +
            '<div class="ms-search-item-name">' + highlightMatch(r.game.name, query) + '</div>' +
            '<div class="ms-search-item-studio">' + escapeHTML(r.game.studio) + '</div>' +
          '</div>' +
          '<span class="ms-search-item-rtp">' + r.game.rtp.toFixed(1) + '% RTP</span>' +
        '</a>';
    });
    resultsContainer.innerHTML = html;

    // Track click for recent searches
    resultsContainer.querySelectorAll('.ms-search-item').forEach(function (el) {
      el.addEventListener('click', function () {
        addRecent(el.getAttribute('data-name'));
      });
    });
  }

  function renderRecent() {
    var recent = getRecent();
    if (!recent.length) {
      resultsContainer.innerHTML =
        '<div class="ms-search-empty">' +
          '<div class="ms-search-empty-icon">🎰</div>' +
          '<div class="ms-search-empty-title">Search 100+ Games</div>' +
          '<div class="ms-search-empty-hint">Find slots, table games, and more by name or studio</div>' +
        '</div>';
      return;
    }

    var html = '<div class="ms-search-label">Recent Searches</div>';
    recent.forEach(function (term) {
      html +=
        '<div class="ms-search-item" data-recent="' + escapeHTML(term) + '">' +
          '<div class="ms-search-item-icon">🕒</div>' +
          '<div class="ms-search-item-info">' +
            '<div class="ms-search-item-name">' + escapeHTML(term) + '</div>' +
          '</div>' +
          '<button class="ms-search-item-remove" title="Remove" data-remove="' + escapeHTML(term) + '">&times;</button>' +
        '</div>';
    });
    resultsContainer.innerHTML = html;

    // Click recent to search again
    resultsContainer.querySelectorAll('[data-recent]').forEach(function (el) {
      el.addEventListener('click', function (e) {
        if (e.target.closest('.ms-search-item-remove')) return;
        input.value = el.getAttribute('data-recent');
        input.dispatchEvent(new Event('input'));
      });
    });

    // Remove recent
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
    if (!catalog) catalog = buildCatalog();
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

  /* ---------- Keyboard Shortcut ---------- */
  document.addEventListener('keydown', function (e) {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      if (overlay && overlay.classList.contains('active')) {
        closeSearch();
      } else {
        openSearch();
      }
    }
    if (e.key === 'Escape' && overlay && overlay.classList.contains('active')) {
      closeSearch();
    }
  });

  /* ---------- Inject Trigger Button ---------- */
  function injectTrigger() {
    var btn = document.createElement('button');
    btn.className = 'ms-search-trigger';
    btn.setAttribute('aria-label', 'Search games');
    btn.setAttribute('title', 'Search games (Ctrl+K)');
    btn.innerHTML = magnifyingSVG;
    btn.addEventListener('click', function (e) {
      e.preventDefault();
      openSearch();
    });

    var target = document.querySelector('.header-right') || document.querySelector('.actions');
    if (target) {
      target.prepend(btn);
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
