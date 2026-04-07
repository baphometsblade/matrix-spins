// ═══════════════════════════════════════════════════════
// PHASE 5 — LOBBY ENHANCEMENTS
// Hero Carousel, Featured Studio Banner, Standalone Game Navigation
// ═══════════════════════════════════════════════════════

(function() {
    'use strict';

    // Helper: create element with optional class, text, style
    function _el(tag, className, textContent, style) {
        var el = document.createElement(tag);
        if (className) el.className = className;
        if (textContent) el.textContent = textContent;
        if (style) el.setAttribute('style', style);
        return el;
    }

    // Helper: create button with onclick
    function _btn(className, textContent, onclick, style) {
        var btn = _el('button', className, textContent, style);
        btn.addEventListener('click', onclick);
        return btn;
    }

    // ─── HERO CAROUSEL ───────────────────────────────────
    var CAROUSEL_INTERVAL = 4000;
    var FEATURED_GAME_IDS = [
        'sugar_rush', 'gates_olympus', 'starlight_princess', 'wolf_gold', 'dragon_realm'
    ];

    var STUDIO_COLORS = {
        'Golden Reels Studio':    { accent: '#ffd700', bg: 'linear-gradient(135deg, #3d2e00 0%, #1a1400 100%)' },
        'Mythic Forge':           { accent: '#b388ff', bg: 'linear-gradient(135deg, #2a1a4d 0%, #0f0a1e 100%)' },
        'Nebula Gaming':          { accent: '#00e5ff', bg: 'linear-gradient(135deg, #002a33 0%, #001219 100%)' },
        'Wild Frontier Games':    { accent: '#ff4081', bg: 'linear-gradient(135deg, #3d0a1e 0%, #1a050d 100%)' },
        'Dragon Pearl Studios':   { accent: '#40c4ff', bg: 'linear-gradient(135deg, #0a2a3d 0%, #051219 100%)' },
        'Ironclad Entertainment': { accent: '#ff6d00', bg: 'linear-gradient(135deg, #3d1a00 0%, #1a0d00 100%)' },
        'Shadow Works':           { accent: '#69f0ae', bg: 'linear-gradient(135deg, #0a3d1e 0%, #051a0d 100%)' },
        'Cascade Labs':           { accent: '#ffd740', bg: 'linear-gradient(135deg, #3d2e00 0%, #1a1400 100%)' }
    };

    var carouselIndex = 0;
    var carouselTimer = null;
    var carouselPaused = false;

    function getFeaturedGames() {
        if (typeof games === 'undefined' || !Array.isArray(games)) return [];
        return FEATURED_GAME_IDS.map(function(id) { return games.find(function(g) { return g.id === id; }); }).filter(Boolean);
    }

    function buildSlide(g, idx) {
        var studio = STUDIO_COLORS[g.provider] || { accent: '#888', bg: '#111' };
        var slide = _el('div', 'hc-slide' + (idx === 0 ? ' hc-slide-active' : ''));
        slide.dataset.index = idx;
        slide.setAttribute('style', 'background:' + (g.bgGradient || studio.bg));

        var inner = _el('div', 'hc-slide-inner');

        // Left content
        var left = _el('div', 'hc-left');

        var badge = _el('div', 'hc-studio-badge', g.provider, 'border-color:' + studio.accent + ';color:' + studio.accent);
        left.appendChild(badge);

        if (g.tag) {
            var tag = _el('span', 'hc-tag ' + (g.tagClass || ''), g.tag);
            left.appendChild(tag);
        }

        var title = _el('h2', 'hc-title', g.name);
        left.appendChild(title);

        var meta = _el('div', 'hc-meta');
        if (g.gridCols && g.gridRows) {
            meta.appendChild(_el('span', 'hc-pill', g.gridCols + '\u00d7' + g.gridRows));
        }
        if (g.rtp) {
            meta.appendChild(_el('span', 'hc-pill', 'RTP ' + g.rtp.toFixed(1) + '%'));
        }
        if (g.volatility) {
            meta.appendChild(_el('span', 'hc-pill hc-pill-vol', g.volatility));
        }
        left.appendChild(meta);

        if (g.bonusDesc) {
            var descText = g.bonusDesc.split(':').pop().trim();
            if (descText.length > 90) descText = descText.slice(0, 87) + '...';
            var desc = _el('p', 'hc-desc', descText);
            left.appendChild(desc);
        }

        var btns = _el('div', 'hc-buttons');
        var gameId = g.id;
        btns.appendChild(_btn('hc-play-btn', 'PLAY NOW', function() { window.phase5PlayGame(gameId); }));
        btns.appendChild(_btn('hc-demo-btn', 'TRY DEMO', function() { window.phase5PlayGame(gameId, true); }));
        left.appendChild(btns);

        // Right thumbnail
        var right = _el('div', 'hc-right');
        var thumb = _el('div', 'hc-thumbnail', null, 'background:' + (g.bgGradient || '#222'));
        var icon = _el('div', 'hc-thumb-icon', g.gridCols >= 6 ? '\u{1F3B0}' : '\u{1F3B2}');
        thumb.appendChild(icon);
        right.appendChild(thumb);

        inner.appendChild(left);
        inner.appendChild(right);
        slide.appendChild(inner);
        return slide;
    }

    function buildHeroCarousel() {
        var container = document.getElementById('heroCarousel');
        if (!container) return;
        var featured = getFeaturedGames();
        if (featured.length === 0) return;

        // Clear
        while (container.firstChild) container.removeChild(container.firstChild);

        var track = _el('div', 'hc-track');
        for (var i = 0; i < featured.length; i++) {
            track.appendChild(buildSlide(featured[i], i));
        }
        container.appendChild(track);

        // Dots
        var dotsWrap = _el('div', 'hc-dots');
        for (var j = 0; j < featured.length; j++) {
            (function(idx) {
                var dot = _btn('hc-dot' + (idx === 0 ? ' hc-dot-active' : ''), '', function() {
                    window.phase5CarouselGoTo(idx);
                });
                dot.dataset.index = idx;
                dot.setAttribute('aria-label', 'Slide ' + (idx + 1));
                dotsWrap.appendChild(dot);
            })(j);
        }
        container.appendChild(dotsWrap);

        // Arrows
        var arrowLeft = _btn('hc-arrow hc-arrow-left', '\u276E', function() { window.phase5CarouselPrev(); });
        arrowLeft.setAttribute('aria-label', 'Previous');
        container.appendChild(arrowLeft);

        var arrowRight = _btn('hc-arrow hc-arrow-right', '\u276F', function() { window.phase5CarouselNext(); });
        arrowRight.setAttribute('aria-label', 'Next');
        container.appendChild(arrowRight);

        // Pause on hover
        container.addEventListener('mouseenter', function() { carouselPaused = true; });
        container.addEventListener('mouseleave', function() { carouselPaused = false; });

        startCarouselTimer();
    }

    function goToSlide(idx) {
        var slides = document.querySelectorAll('.hc-slide');
        var dots = document.querySelectorAll('.hc-dot');
        if (!slides.length) return;
        idx = ((idx % slides.length) + slides.length) % slides.length;
        carouselIndex = idx;
        for (var i = 0; i < slides.length; i++) {
            slides[i].classList.toggle('hc-slide-active', i === idx);
        }
        for (var j = 0; j < dots.length; j++) {
            dots[j].classList.toggle('hc-dot-active', j === idx);
        }
    }

    function startCarouselTimer() {
        if (carouselTimer) clearInterval(carouselTimer);
        carouselTimer = setInterval(function() {
            if (!carouselPaused) goToSlide(carouselIndex + 1);
        }, CAROUSEL_INTERVAL);
    }

    window.phase5CarouselGoTo = function(idx) { goToSlide(idx); startCarouselTimer(); };
    window.phase5CarouselNext = function() { goToSlide(carouselIndex + 1); startCarouselTimer(); };
    window.phase5CarouselPrev = function() { goToSlide(carouselIndex - 1); startCarouselTimer(); };


    // ─── FEATURED STUDIO BANNER ──────────────────────────
    var STUDIOS_LIST = [
        { name: 'Nebula Gaming', slug: 'nebula-gaming', icon: '\u{1F31F}', accent: '#00e5ff', tagline: 'Explore the cosmos of wins' },
        { name: 'Golden Reels Studio', slug: 'golden-reels', icon: '\u{1F451}', accent: '#ffd700', tagline: 'Where every spin turns to gold' },
        { name: 'Mythic Forge', slug: 'mythic-forge', icon: '\u26A1', accent: '#b388ff', tagline: 'Legendary wins await' },
        { name: 'Ironclad Entertainment', slug: 'ironclad', icon: '\u{1F525}', accent: '#ff6d00', tagline: 'Forged in fire, built for thrills' },
        { name: 'Shadow Works', slug: 'shadow-works', icon: '\u{1F47B}', accent: '#69f0ae', tagline: 'Dare to play in the dark' },
        { name: 'Wild Frontier Games', slug: 'wild-frontier', icon: '\u{1F3AE}', accent: '#ff4081', tagline: 'Untamed excitement on every spin' },
        { name: 'Cascade Labs', slug: 'cascade-labs', icon: '\u26A1', accent: '#ffd740', tagline: 'Innovation meets jackpots' },
        { name: 'Dragon Pearl Studios', slug: 'dragon-pearl', icon: '\u{1F300}', accent: '#40c4ff', tagline: 'Awaken the dragon within' }
    ];

    function getDailyStudio() {
        var now = new Date();
        var dayOfYear = Math.floor((now - new Date(now.getFullYear(), 0, 0)) / 86400000);
        return STUDIOS_LIST[dayOfYear % STUDIOS_LIST.length];
    }

    function buildFeaturedStudioBanner() {
        var container = document.getElementById('featuredStudioBanner');
        if (!container) return;
        var studio = getDailyStudio();
        var studioGames = (typeof games !== 'undefined' && Array.isArray(games))
            ? games.filter(function(g) { return g.provider === studio.name; })
            : [];

        while (container.firstChild) container.removeChild(container.firstChild);

        var inner = _el('div', 'fsb-inner', null, 'border-color:' + studio.accent);
        var icon = _el('div', 'fsb-icon', studio.icon, 'color:' + studio.accent);
        inner.appendChild(icon);

        var content = _el('div', 'fsb-content');
        content.appendChild(_el('div', 'fsb-label', 'FEATURED STUDIO TODAY'));
        content.appendChild(_el('div', 'fsb-name', studio.name, 'color:' + studio.accent));
        content.appendChild(_el('div', 'fsb-tagline', studio.tagline));
        content.appendChild(_el('div', 'fsb-count', studioGames.length + ' games available'));
        inner.appendChild(content);

        var studioName = studio.name;
        var exploreBtn = _btn('fsb-explore-btn', 'EXPLORE GAMES', function() {
            if (typeof setProviderFilter === 'function') setProviderFilter(studioName);
        }, 'background:' + studio.accent);
        inner.appendChild(exploreBtn);

        container.appendChild(inner);
    }


    // ─── STANDALONE GAME NAVIGATION ──────────────────────
    window.phase5PlayGame = function(gameId, demo) {
        if (!gameId) return;
        var url = '/games/' + gameId + '/index.html';
        if (demo) url += '?demo=1';
        window.location.href = url;
    };

    // Recently-played tracking only — openSlot modal is handled by ui-slot.js
    (function() {
        var _origOpenSlot = window.openSlot;
        window.openSlot = function(gameIdOrObj) {
            var gameId = typeof gameIdOrObj === 'string' ? gameIdOrObj : (gameIdOrObj && gameIdOrObj.id ? gameIdOrObj.id : null);
            if (gameId) {
                try {
                    var recent = JSON.parse(localStorage.getItem('royalslots_recent') || '[]');
                    recent = recent.filter(function(id) { return id !== gameId; });
                    recent.unshift(gameId);
                    if (recent.length > 20) recent = recent.slice(0, 20);
                    localStorage.setItem('royalslots_recent', JSON.stringify(recent));
                } catch(e) { /* storage full or unavailable */ }
            }
            if (typeof _origOpenSlot === 'function') _origOpenSlot(gameIdOrObj);
        };
    })();


    // ─── HEADER AUTH STATE ENHANCEMENT ─────────────────────
    // Shows Login/Create Account when logged out
    // Shows player name, $ balance, Deposit, Withdraw when logged in
    function enhanceHeader() {
        var headerActions = document.querySelector('.header-actions');
        if (!headerActions) return;

        // Check if already enhanced
        if (document.getElementById('p5HeaderDeposit')) return;

        var balDisplay = headerActions.querySelector('.balance-display');
        var authBtn = document.getElementById('authBtn');

        // Add Deposit + Withdraw buttons (visible when logged in)
        var depositBtn = _btn('btn btn-deposit p5-header-deposit', '\u{1F4B3} DEPOSIT', function() {
            if (typeof showWalletModal === 'function') showWalletModal();
            else if (typeof phase5ShowDeposit === 'function') phase5ShowDeposit();
        });
        depositBtn.id = 'p5HeaderDeposit';
        depositBtn.setAttribute('style', 'display:none');

        var withdrawBtn = _btn('btn btn-user p5-header-withdraw', 'WITHDRAW', function() {
            if (typeof showWalletWithdraw === 'function') showWalletWithdraw();
            else if (typeof phase5ShowWithdraw === 'function') phase5ShowWithdraw();
        });
        withdrawBtn.id = 'p5HeaderWithdraw';
        withdrawBtn.setAttribute('style', 'display:none;background:rgba(255,255,255,0.08);border:1px solid rgba(255,255,255,0.15);color:#fff;padding:6px 14px;border-radius:6px;font-size:11px;font-weight:700;cursor:pointer;');

        // Insert after balance display
        if (balDisplay && balDisplay.nextSibling) {
            headerActions.insertBefore(withdrawBtn, balDisplay.nextSibling);
            headerActions.insertBefore(depositBtn, balDisplay.nextSibling);
        }

        // Update visibility based on auth state
        function updateHeaderAuth() {
            var isLoggedIn = (typeof currentUser !== 'undefined' && currentUser);
            var depEl = document.getElementById('p5HeaderDeposit');
            var wdEl = document.getElementById('p5HeaderWithdraw');
            var balEl = headerActions.querySelector('.balance-display');
            var lblEl = document.getElementById('authBtnLabel');

            if (depEl) depEl.style.display = isLoggedIn ? '' : 'none';
            if (wdEl) wdEl.style.display = isLoggedIn ? '' : 'none';
            if (balEl) balEl.style.display = isLoggedIn ? '' : 'none';

            if (lblEl) {
                if (isLoggedIn && currentUser.username) {
                    lblEl.textContent = currentUser.username;
                } else {
                    lblEl.textContent = 'LOGIN';
                }
            }
        }

        updateHeaderAuth();
        // Re-check periodically (auth state can change)
        setInterval(updateHeaderAuth, 2000);
    }


    // ─── UPDATE GAME COUNTS ──────────────────────────────
    function updateGameCounts() {
        var gameCount = (typeof games !== 'undefined' && Array.isArray(games)) ? games.length : 100;
        var countEls = document.querySelectorAll('#allGamesCount');
        for (var i = 0; i < countEls.length; i++) {
            if (countEls[i].textContent.match(/\d+\s*games/)) {
                countEls[i].textContent = gameCount + ' games';
            }
        }
        var searchInputs = document.querySelectorAll('#gameSearchInput, #headerSearchInput');
        for (var j = 0; j < searchInputs.length; j++) {
            if (searchInputs[j].placeholder.match(/\d+/)) {
                searchInputs[j].placeholder = searchInputs[j].placeholder.replace(/\d+/, gameCount);
            }
        }
    }


    // ─── INIT ────────────────────────────────────────────
    function initPhase5Lobby() {
        buildHeroCarousel();
        buildFeaturedStudioBanner();
        updateGameCounts();
        enhanceHeader();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', function() { setTimeout(initPhase5Lobby, 150); });
    } else {
        setTimeout(initPhase5Lobby, 150);
    }

})();
