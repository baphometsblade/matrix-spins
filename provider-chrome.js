// ═══════════════════════════════════════════════════════════════════
// PROVIDER CHROME v2 — Runtime DOM enhancements for studio identity
// 8 canonical studios with unique fonts, palettes, chrome frames
// ═══════════════════════════════════════════════════════════════════

(function() {
    'use strict';

    // ── Studio registry (8 canonical studios) ────────────────────────
    var STUDIOS = {
        'golden-reels': {
            name: 'Golden Reels Studio',
            short: 'GOLDEN REELS',
            key: 'golden-reels',
            accent: '#FFD700',
            secondary: '#B8860B',
            headingFont: 'Playfair Display',
            bodyFont: 'Lora',
            style: 'Warm gold, art deco, ornate brass frames, serif fonts'
        },
        'nebula-gaming': {
            name: 'Nebula Gaming',
            short: 'NEBULA',
            key: 'nebula-gaming',
            accent: '#00E5FF',
            secondary: '#7C4DFF',
            headingFont: 'Orbitron',
            bodyFont: 'Space Mono',
            style: 'Deep purple, neon cyan, sleek dark UI, glowing elements'
        },
        'mythic-forge': {
            name: 'Mythic Forge',
            short: 'MYTHIC FORGE',
            key: 'mythic-forge',
            accent: '#E040FB',
            secondary: '#4A148C',
            headingFont: 'Cinzel Decorative',
            bodyFont: 'Noto Serif',
            style: 'Jewel tones, stone textures, carved stone borders, runic fonts'
        },
        'wild-frontier': {
            name: 'Wild Frontier Games',
            short: 'WILD FRONTIER',
            key: 'wild-frontier',
            accent: '#8BC34A',
            secondary: '#FF6D00',
            headingFont: 'Oswald',
            bodyFont: 'Rajdhani',
            style: 'Earthy oranges, greens, natural textures, bold fonts'
        },
        'shadow-works': {
            name: 'Shadow Works',
            short: 'SHADOW WORKS',
            key: 'shadow-works',
            accent: '#B388FF',
            secondary: '#1B5E20',
            headingFont: 'Cinzel',
            bodyFont: 'Noto Serif',
            style: 'Blacks, deep reds, sickly greens, gothic frames, distressed fonts'
        },
        'dragon-pearl': {
            name: 'Dragon Pearl Studios',
            short: 'DRAGON PEARL',
            key: 'dragon-pearl',
            accent: '#F44336',
            secondary: '#FFD700',
            headingFont: 'Noto Serif SC',
            bodyFont: 'Noto Sans SC',
            style: 'Reds, golds, jade, lacquered panels, brush-style fonts'
        },
        'ironclad': {
            name: 'Ironclad Entertainment',
            short: 'IRONCLAD',
            key: 'ironclad',
            accent: '#FF6D00',
            secondary: '#8D6E63',
            headingFont: 'Oswald',
            bodyFont: 'Rajdhani',
            style: 'Brass, leather, sepia, riveted metal, weathered wood'
        },
        'cascade-labs': {
            name: 'Cascade Labs',
            short: 'CASCADE',
            key: 'cascade-labs',
            accent: '#00BCD4',
            secondary: '#FF4081',
            headingFont: 'Quicksand',
            bodyFont: 'Share Tech Mono',
            style: 'Clean modern gradients, minimal flat UI, geometric fonts'
        }
    };

    // ── Provider name → studio key mapping ───────────────────────────
    var PROVIDER_TO_STUDIO = {
        'Golden Reels Studio':       'golden-reels',
        'Nebula Gaming':             'nebula-gaming',
        'Mythic Forge':              'mythic-forge',
        'Wild Frontier Games':       'wild-frontier',
        'Shadow Works':              'shadow-works',
        'Dragon Pearl Studios':      'dragon-pearl',
        'Ironclad Entertainment':    'ironclad',
        'Cascade Labs':              'cascade-labs'
    };

    // ── Legacy chrome key mapping (for backward compat) ──────────────
    var LEGACY_MAP = {
        // Old canonical keys → new canonical keys
        novaplay:     'nebula-gaming',
        goldenedge:   'golden-reels',
        celestial:    'mythic-forge',
        ironreel:     'ironclad',
        phantomworks: 'shadow-works',
        arcadeforge:  'wild-frontier',
        thunderbolt:  'cascade-labs',
        vortexspin:   'dragon-pearl',
        // Older legacy keys remapped
        novaspin:     'nebula-gaming',
        vaultx:       'ironclad',
        solstice:     'mythic-forge',
        neoncore:     'nebula-gaming',
        frostbyte:    'cascade-labs',
        desertgold:   'golden-reels',
        orientreels:  'mythic-forge'
    };

    // ── All chrome keys (legacy + new) ───────────────────────────────
    var ALL_STUDIO_KEYS = Object.keys(STUDIOS);
    var ALL_CHROME_KEYS = ALL_STUDIO_KEYS.concat(Object.keys(LEGACY_MAP));

    // Resolve any chrome key (legacy or new) to a canonical studio key
    function resolveStudioKey(key) {
        if (STUDIOS[key]) return key;
        if (LEGACY_MAP[key]) return LEGACY_MAP[key];
        return null;
    }

    // Get studio from provider display name
    function getStudioFromProvider(providerName) {
        return PROVIDER_TO_STUDIO[providerName] || null;
    }

    // ── Provider display names (backward compat) ─────────────────────
    var PROVIDER_NAMES = {};
    var PROVIDER_SHORT = {};
    Object.keys(STUDIOS).forEach(function(k) {
        PROVIDER_NAMES[k] = STUDIOS[k].name;
        PROVIDER_SHORT[k] = STUDIOS[k].short;
    });

    // ── Corner decoration builders per studio ────────────────────────
    var CHROME_DECORATIONS = {
        'golden-reels': function(frame) {
            // Art deco ornate corner frames
            ['tl','tr','bl','br'].forEach(function(pos) {
                var d = document.createElement('div');
                d.className = 'corner-deco ' + pos;
                frame.appendChild(d);
            });
        },
        'nebula-gaming': function(frame) {
            // Glowing neon corner accents
            ['tl','tr','bl','br'].forEach(function(pos) {
                var d = document.createElement('div');
                d.className = 'glow-deco ' + pos;
                frame.appendChild(d);
            });
        },
        'mythic-forge': function(frame) {
            // Carved stone corner runes
            ['tl','tr','bl','br'].forEach(function(pos) {
                var d = document.createElement('div');
                d.className = 'rune-deco ' + pos;
                frame.appendChild(d);
            });
        },
        'ironclad': function(frame) {
            // Riveted bolt corners
            ['tl','tr','bl','br'].forEach(function(pos) {
                var d = document.createElement('div');
                d.className = 'bolt-deco ' + pos;
                frame.appendChild(d);
            });
        },
        'shadow-works': function(frame) {
            // Gothic frame corners
            ['tl','tr','bl','br'].forEach(function(pos) {
                var d = document.createElement('div');
                d.className = 'gothic-deco ' + pos;
                frame.appendChild(d);
            });
        },
        'wild-frontier': function(frame) {
            // Rustic rope / natural corner accents
            ['tl','tr','bl','br'].forEach(function(pos) {
                var d = document.createElement('div');
                d.className = 'rustic-deco ' + pos;
                frame.appendChild(d);
            });
        },
        'dragon-pearl': function(frame) {
            // Lacquered panel dragon motif
            var dragon = document.createElement('div');
            dragon.className = 'dragon-deco';
            frame.appendChild(dragon);
        },
        'cascade-labs': function(frame) {
            // Minimal geometric line accents
            ['tl','tr','bl','br'].forEach(function(pos) {
                var d = document.createElement('div');
                d.className = 'geo-deco ' + pos;
                frame.appendChild(d);
            });
        }
    };

    // ── Async font loader ────────────────────────────────────────────
    var _fontsLoaded = false;
    function loadStudioFonts() {
        if (_fontsLoaded) return;
        _fontsLoaded = true;

        var families = [
            'Playfair+Display:wght@400;700',
            'Lora:wght@400;700',
            'Orbitron:wght@400;700',
            'Space+Mono:wght@400;700',
            'Cinzel+Decorative:wght@700',
            'Cinzel:wght@400;700',
            'Noto+Serif:wght@400;700',
            'Oswald:wght@400;700',
            'Rajdhani:wght@400;700',
            'Quicksand:wght@400;700',
            'Share+Tech+Mono',
            'Noto+Serif+SC:wght@400;700',
            'Noto+Sans+SC:wght@400;700'
        ];

        var link = document.createElement('link');
        link.rel = 'stylesheet';
        link.href = 'https://fonts.googleapis.com/css2?family=' + families.join('&family=') + '&display=swap';
        document.head.appendChild(link);
    }

    // ── Extract chrome key from modal class list ─────────────────────
    function getChromeKeyFromModal(modal) {
        for (var i = 0; i < ALL_CHROME_KEYS.length; i++) {
            if (modal.classList.contains('slot-chrome-' + ALL_CHROME_KEYS[i])) {
                return resolveStudioKey(ALL_CHROME_KEYS[i]);
            }
        }
        return null;
    }

    // ── Apply studio chrome to the slot modal ────────────────────────
    function applyStudioChrome(modal) {
        if (!modal) return;

        var studioKey = getChromeKeyFromModal(modal);
        if (!studioKey) return;
        var studio = STUDIOS[studioKey];
        if (!studio) return;

        // Already applied?
        if (modal.querySelector('.studio-frame')) return;

        // Load fonts on first slot open
        loadStudioFonts();

        // Set data-studio attribute for CSS
        modal.setAttribute('data-studio', studioKey);

        // Ensure position context
        var pos = window.getComputedStyle(modal).position;
        if (pos === 'static') modal.style.position = 'relative';

        // ── Studio frame overlay ─────────────────────────────────
        var frame = document.createElement('div');
        frame.className = 'studio-frame';

        var decoFn = CHROME_DECORATIONS[studioKey];
        if (decoFn) decoFn(frame);
        modal.appendChild(frame);

        // ── Studio badge ─────────────────────────────────────────
        var badge = document.createElement('div');
        badge.className = 'studio-badge';
        badge.textContent = studio.short;
        modal.appendChild(badge);

        // ── Studio watermark ─────────────────────────────────────
        var watermark = document.createElement('div');
        watermark.className = 'studio-watermark';
        watermark.textContent = studio.short.charAt(0);
        modal.appendChild(watermark);

        // ── Entrance animation ───────────────────────────────────
        modal.style.opacity = '0';
        modal.style.transform = 'scale(0.98)';
        requestAnimationFrame(function() {
            modal.style.transition = 'opacity 0.4s ease, transform 0.4s ease';
            modal.style.opacity = '1';
            modal.style.transform = 'scale(1)';
        });
    }

    // ── Remove studio chrome on slot close ───────────────────────────
    function removeStudioChrome(modal) {
        if (!modal) return;
        ['studio-frame', 'studio-badge', 'studio-watermark'].forEach(function(cls) {
            var el = modal.querySelector('.' + cls);
            if (el) el.remove();
        });
        // Also remove legacy elements
        ['provider-chrome-frame', 'provider-logo-badge', 'provider-watermark'].forEach(function(cls) {
            var el = modal.querySelector('.' + cls);
            if (el) el.remove();
        });
    }

    // ── Enhance lobby game cards with studio identity ────────────────
    function enhanceLobbyCards() {
        var gameList = typeof GAMES !== 'undefined' ? GAMES : (typeof games !== 'undefined' ? games : null);
        if (!gameList) return;

        var cards = document.querySelectorAll('.game-card, .featured-card');
        cards.forEach(function(card) {
            if (card.getAttribute('data-studio')) return;

            var gameId = card.getAttribute('data-game-id') ||
                         card.getAttribute('data-game') ||
                         card.getAttribute('data-id');

            if (!gameId) {
                var onclick = card.getAttribute('onclick') || '';
                var match = onclick.match(/openSlot\(['"]([^'"]+)['"]\)/);
                if (match) gameId = match[1];
            }

            if (!gameId) {
                var nameEl = card.querySelector('.game-name, .featured-card-name, .card-title');
                if (nameEl) {
                    var name = nameEl.textContent.trim();
                    for (var i = 0; i < gameList.length; i++) {
                        if (gameList[i].name === name) {
                            gameId = gameList[i].id;
                            break;
                        }
                    }
                }
            }

            if (!gameId) return;

            // Find the game and its studio
            var game = null;
            for (var j = 0; j < gameList.length; j++) {
                if (gameList[j].id === gameId) { game = gameList[j]; break; }
            }
            if (!game) return;

            var studioKey = getStudioFromProvider(game.provider);
            if (!studioKey) return;

            var studio = STUDIOS[studioKey];
            card.setAttribute('data-studio', studioKey);
            card.setAttribute('data-provider', studioKey); // backward compat

            if (!card.querySelector('.provider-card-badge')) {
                var badge = document.createElement('div');
                badge.className = 'provider-card-badge';
                badge.textContent = studio.short;
                badge.style.cssText = 'position:absolute;top:6px;right:6px;font-size:8px;font-weight:700;padding:2px 6px;border-radius:3px;pointer-events:none;' +
                    'background:' + studio.accent + ';color:#000;font-family:' + studio.headingFont + ',sans-serif;letter-spacing:0.5px;';
                if (window.getComputedStyle(card).position === 'static') {
                    card.style.position = 'relative';
                }
                card.appendChild(badge);
            }
        });
    }

    // ── MutationObserver ─────────────────────────────────────────────
    function setupSlotObserver() {
        var observer = new MutationObserver(function(mutations) {
            mutations.forEach(function(mutation) {
                if (mutation.type === 'attributes' && mutation.attributeName === 'class') {
                    var el = mutation.target;
                    if (el.classList && el.classList.contains('modal')) {
                        if (el.classList.contains('active') && getChromeKeyFromModal(el)) {
                            setTimeout(function() { applyStudioChrome(el); }, 50);
                        } else if (!el.classList.contains('active')) {
                            removeStudioChrome(el);
                        }
                    }
                }
                if (mutation.type === 'childList') {
                    mutation.addedNodes.forEach(function(node) {
                        if (node.nodeType === 1) {
                            if (node.classList && node.classList.contains('modal') && getChromeKeyFromModal(node)) {
                                setTimeout(function() {
                                    if (node.classList.contains('active')) applyStudioChrome(node);
                                }, 100);
                            }
                            if (node.querySelectorAll) {
                                var childModals = node.querySelectorAll('.modal[class*="slot-chrome"]');
                                childModals.forEach(function(m) {
                                    if (m.classList.contains('active')) {
                                        setTimeout(function() { applyStudioChrome(m); }, 100);
                                    }
                                });
                            }
                            if ((node.classList && (node.classList.contains('game-card') || node.classList.contains('featured-card'))) ||
                                (node.querySelector && node.querySelector('.game-card, .featured-card'))) {
                                clearTimeout(observer._lobbyDebounce);
                                observer._lobbyDebounce = setTimeout(enhanceLobbyCards, 150);
                            }
                        }
                    });
                }
            });
        });

        observer.observe(document.body, {
            childList: true,
            subtree: true,
            attributes: true,
            attributeFilter: ['class']
        });
        return observer;
    }

    function checkExistingSlot() {
        var existing = document.querySelector('.modal.active[class*="slot-chrome"]');
        if (existing) applyStudioChrome(existing);
    }

    function init() {
        setupSlotObserver();
        checkExistingSlot();
        setTimeout(checkExistingSlot, 1000);
        setTimeout(checkExistingSlot, 2000);

        if (document.readyState === 'complete') {
            setTimeout(enhanceLobbyCards, 500);
        } else {
            window.addEventListener('load', function() {
                setTimeout(enhanceLobbyCards, 500);
            });
        }
    }

    // ── Expose for external use ──────────────────────────────────────
    window.ProviderChrome = {
        apply: applyStudioChrome,
        remove: removeStudioChrome,
        enhanceLobby: enhanceLobbyCards,
        STUDIOS: STUDIOS,
        PROVIDER_NAMES: PROVIDER_NAMES,
        PROVIDER_SHORT: PROVIDER_SHORT,
        PROVIDER_TO_STUDIO: PROVIDER_TO_STUDIO,
        getStudioFromProvider: getStudioFromProvider,
        resolveStudioKey: resolveStudioKey,
        loadFonts: loadStudioFonts
    };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

})();
