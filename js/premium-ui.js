/* ═══════════════════════════════════════════════════════════════════════
   Royal Slots — Premium UI Enhancements
   Header scroll shadow, smooth reveal animations, intersection observer
   ═══════════════════════════════════════════════════════════════════════ */

(function() {
    'use strict';

    // ── Header scroll shadow ────────────────────────────
    const header = document.querySelector('header');
    if (header) {
        let ticking = false;
        window.addEventListener('scroll', function() {
            if (!ticking) {
                requestAnimationFrame(function() {
                    if (window.scrollY > 10) {
                        header.classList.add('scrolled');
                    } else {
                        header.classList.remove('scrolled');
                    }
                    ticking = false;
                });
                ticking = true;
            }
        }, { passive: true });
    }

    // ── Fade-in on scroll for game cards ────────────────
    if ('IntersectionObserver' in window) {
        const observer = new IntersectionObserver(function(entries) {
            entries.forEach(function(entry) {
                if (entry.isIntersecting) {
                    entry.target.style.opacity = '1';
                    entry.target.style.transform = 'translateY(0)';
                    observer.unobserve(entry.target);
                }
            });
        }, { threshold: 0.1, rootMargin: '0px 0px -40px 0px' });

        // Observe game cards as they're added to DOM
        const gameGrids = document.querySelectorAll('#allGames, #hotGames');
        if (gameGrids.length) {
            const mutObserver = new MutationObserver(function(mutations) {
                mutations.forEach(function(m) {
                    m.addedNodes.forEach(function(node) {
                        if (node.nodeType === 1 && (node.classList.contains('game-card') || node.classList.contains('slot-card'))) {
                            node.style.opacity = '0';
                            node.style.transform = 'translateY(12px)';
                            node.style.transition = 'opacity 0.4s ease, transform 0.4s ease';
                            observer.observe(node);
                        }
                    });
                });
            });
            gameGrids.forEach(function(grid) {
                mutObserver.observe(grid, { childList: true });
            });
        }
    }

    // ── Smooth active state for mobile bottom nav ───────
    var mobileNav = document.getElementById('mobileBottomNav');
    if (mobileNav) {
        mobileNav.querySelectorAll('button').forEach(function(btn) {
            btn.addEventListener('click', function() {
                mobileNav.querySelectorAll('button').forEach(function(b) {
                    b.classList.remove('active');
                });
                this.classList.add('active');
            });
        });
    }

    // ── Trust bar hide on scroll down, show on scroll up ─
    var trustBar = document.getElementById('trustBar');
    if (trustBar) {
        var lastScroll = 0;
        window.addEventListener('scroll', function() {
            var currentScroll = window.scrollY;
            if (currentScroll > 200 && currentScroll > lastScroll) {
                trustBar.style.transform = 'translateY(-100%)';
                trustBar.style.opacity = '0';
            } else {
                trustBar.style.transform = 'translateY(0)';
                trustBar.style.opacity = '1';
            }
            lastScroll = currentScroll;
        }, { passive: true });
        trustBar.style.transition = 'transform 0.3s ease, opacity 0.3s ease';
    }

    // ── Filter tab smooth scroll to active ──────────────
    var filterTabs = document.getElementById('filterTabs');
    if (filterTabs) {
        filterTabs.addEventListener('click', function(e) {
            var tab = e.target.closest('.filter-tab');
            if (tab) {
                tab.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
            }
        });
    }

    // ── Provider chip smooth scroll ─────────────────────
    var providerRow = document.getElementById('providerFilterRow');
    if (providerRow) {
        providerRow.addEventListener('click', function(e) {
            var chip = e.target.closest('.provider-chip');
            if (chip) {
                chip.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
            }
        });
    }

})();
