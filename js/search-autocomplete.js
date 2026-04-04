(function() {
  'use strict';

  // Game search autocomplete module
  window.SearchAutocomplete = {
    init: function() {
      const self = this;

      // Find the game search input
      const searchInput = document.getElementById('gameSearchInput');
      if (!searchInput) {
        console.warn('[SearchAutocomplete] Game search input not found (gameSearchInput)');
        return;
      }

      // Check if GAMES array is available
      if (typeof games === 'undefined' && typeof window.games === 'undefined') {
        console.warn('[SearchAutocomplete] GAMES array not found globally');
        return;
      }

      const GAMES = typeof games !== 'undefined' ? games : window.games;

      // State
      let isOpen = false;
      let selectedIndex = -1;
      let debounceTimer = null;
      let filteredResults = [];

      // Create the autocomplete dropdown
      const dropdownContainer = document.createElement('div');
      dropdownContainer.id = 'gameAutocompleteDropdown';
      dropdownContainer.className = 'game-autocomplete-dropdown';
      dropdownContainer.style.display = 'none';

      // Insert dropdown after search input
      const searchWrap = document.getElementById('gameSearchWrap');
      if (searchWrap) {
        searchWrap.style.position = 'relative';
        searchWrap.appendChild(dropdownContainer);
      } else {
        searchInput.parentNode.insertBefore(dropdownContainer, searchInput.nextSibling);
      }

      // HTML escape helper to prevent XSS
      function _escapeHTML(str) {
        return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
      }

      // Fuzzy match helper: checks if query text appears in target (case-insensitive)
      function fuzzyMatch(query, target) {
        if (!query || !target) return false;
        const q = query.toLowerCase();
        const t = target.toLowerCase();
        return t.includes(q);
      }

      // Filter and rank games based on search query
      function filterGames(query) {
        if (!query || !query.trim()) {
          return [];
        }

        const q = query.trim();
        const results = [];

        for (let i = 0; i < GAMES.length; i++) {
          const game = GAMES[i];
          let score = 0;
          let matchedField = null;

          // Check name (highest priority)
          if (fuzzyMatch(q, game.name)) {
            score = 100;
            matchedField = 'name';
          }
          // Check provider
          else if (fuzzyMatch(q, game.provider)) {
            score = 75;
            matchedField = 'provider';
          }
          // Check tag/category (if exists)
          else if (game.tag && fuzzyMatch(q, game.tag)) {
            score = 50;
            matchedField = 'tag';
          }

          if (score > 0) {
            results.push({
              game: game,
              score: score,
              matchedField: matchedField
            });
          }
        }

        // Sort by score (descending) and limit to top 6
        results.sort((a, b) => b.score - a.score);
        return results.slice(0, 6);
      }

      // Highlight matching text in result display
      function highlightMatch(text, query) {
        if (!query) return _escapeHTML(text);
        const q = query.trim().toLowerCase();
        const t = text.toLowerCase();
        const idx = t.indexOf(q);

        if (idx === -1) return _escapeHTML(text);

        const before = _escapeHTML(text.substring(0, idx));
        const matched = _escapeHTML(text.substring(idx, idx + q.length));
        const after = _escapeHTML(text.substring(idx + q.length));

        return before + '<strong>' + matched + '</strong>' + after;
      }

      // Render dropdown results
      function renderDropdown(results, query) {
        dropdownContainer.innerHTML = '';

        if (results.length === 0) {
          dropdownContainer.style.display = 'none';
          isOpen = false;
          selectedIndex = -1;
          return;
        }

        const ul = document.createElement('ul');
        ul.className = 'game-autocomplete-list';

        results.forEach((result, idx) => {
          const game = result.game;
          const li = document.createElement('li');
          li.className = 'game-autocomplete-item';
          li.setAttribute('data-index', idx);
          li.setAttribute('data-game-id', game.id);

          // Game name with highlighted match
          const nameDiv = document.createElement('div');
          nameDiv.className = 'game-autocomplete-name';
          nameDiv.innerHTML = highlightMatch(game.name, query);

          // Provider and RTP info
          const infoDiv = document.createElement('div');
          infoDiv.className = 'game-autocomplete-info';
          infoDiv.innerHTML = '<span class="provider">' + _escapeHTML(game.provider) + '</span>' +
                               '<span class="rtp">RTP: ' + _escapeHTML(String(game.rtp)) + '%</span>';

          li.appendChild(nameDiv);
          li.appendChild(infoDiv);

          // Click handler
          li.addEventListener('click', function() {
            selectGame(game, idx);
          });

          // Hover handler
          li.addEventListener('mouseenter', function() {
            setSelectedIndex(idx);
          });

          ul.appendChild(li);
        });

        dropdownContainer.appendChild(ul);
        dropdownContainer.style.display = 'block';
        isOpen = true;
        selectedIndex = -1;
        filteredResults = results;
      }

      // Set selected item styling
      function setSelectedIndex(idx) {
        const items = dropdownContainer.querySelectorAll('.game-autocomplete-item');
        items.forEach((item, i) => {
          if (i === idx) {
            item.classList.add('selected');
            selectedIndex = idx;
          } else {
            item.classList.remove('selected');
          }
        });
      }

      // Load/navigate to game
      function selectGame(game, idx) {
        // Try to call the game loading function if available
        if (typeof openSlot === 'function') {
          openSlot(game.id);
        } else if (typeof showGame === 'function') {
          showGame(game.id);
        } else {
          // Dispatch custom event for other handlers
          const event = new CustomEvent('gameSelected', {
            detail: { gameId: game.id, game: game }
          });
          document.dispatchEvent(event);
        }

        // Clear and close
        searchInput.value = '';
        dropdownContainer.style.display = 'none';
        isOpen = false;
        selectedIndex = -1;
      }

      // Input event handler (debounced)
      searchInput.addEventListener('input', function() {
        const query = this.value;

        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(function() {
          const results = filterGames(query);
          renderDropdown(results, query);
        }, 200);
      });

      // Keyboard navigation
      searchInput.addEventListener('keydown', function(e) {
        if (!isOpen || filteredResults.length === 0) {
          // Open dropdown on Ctrl+Alt or just start typing
          return;
        }

        if (e.key === 'ArrowDown') {
          e.preventDefault();
          const nextIdx = selectedIndex + 1;
          if (nextIdx < filteredResults.length) {
            setSelectedIndex(nextIdx);
          } else {
            setSelectedIndex(0);
          }
        } else if (e.key === 'ArrowUp') {
          e.preventDefault();
          const prevIdx = selectedIndex - 1;
          if (prevIdx >= 0) {
            setSelectedIndex(prevIdx);
          } else {
            setSelectedIndex(filteredResults.length - 1);
          }
        } else if (e.key === 'Enter') {
          e.preventDefault();
          if (selectedIndex >= 0 && selectedIndex < filteredResults.length) {
            selectGame(filteredResults[selectedIndex].game, selectedIndex);
          }
        } else if (e.key === 'Escape') {
          e.preventDefault();
          dropdownContainer.style.display = 'none';
          isOpen = false;
          selectedIndex = -1;
        }
      });

      // Close dropdown on blur
      searchInput.addEventListener('blur', function() {
        setTimeout(function() {
          dropdownContainer.style.display = 'none';
          isOpen = false;
          selectedIndex = -1;
        }, 200); // Delay to allow click handlers to fire
      });

      // Focus to show dropdown again (if results exist)
      searchInput.addEventListener('focus', function() {
        const query = this.value;
        if (query.trim()) {
          const results = filterGames(query);
          if (results.length > 0) {
            renderDropdown(results, query);
          }
        }
      });
    }
  };
})();
