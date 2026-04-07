// ═══════════════════════════════════════════════════════════════════════
// MATRIX SPINS — Premium V2 DOM Fixes
// Addresses: footer placement, idle popup styling, layout cleanup
// Load after all other scripts
// ═══════════════════════════════════════════════════════════════════════

(function() {
    'use strict';

    // ── 1. Move responsibleGamblingFooter to proper position ─────────
    // It's a body child that should be inside casinoMainWrap, after the footer
    function fixFooterPlacement() {
        var rgf = document.getElementById('responsibleGamblingFooter');
        var casinoFooter = document.getElementById('casinoFooter');
        if (rgf && casinoFooter && rgf.parentElement === document.body) {
            // Move it inside casinoMainWrap, after casinoFooter
            casinoFooter.parentElement.appendChild(rgf);
        }
    }

    // ── 2. Define global closeDailyBonusModal if not already defined ─
    if (typeof window.closeDailyBonusModal !== 'function') {
        window.closeDailyBonusModal = function() {
            var m = document.getElementById('dailyBonusModal');
            if (m) m.remove();
            var m2 = document.getElementById('dailyLoginModal');
            if (m2) { m2.style.display = 'none'; }
        };
    }

    // ── 3. Style idle/attract popups that are created dynamically ─────
    function styleIdlePopups() {
        var observer = new MutationObserver(function(mutations) {
            mutations.forEach(function(mutation) {
                mutation.addedNodes.forEach(function(node) {
                    if (node.nodeType === 1) {
                        var text = node.textContent || '';
                        // Style "Still spinning?" and similar attract popups
                        if (text.indexOf('Still spinning') !== -1 || 
                            text.indexOf('Keep Playing') !== -1 ||
                            text.indexOf('Come back') !== -1) {
                            node.style.cssText = (node.style.cssText || '') + 
                                ';background:rgba(15,15,23,0.95)!important' +
                                ';backdrop-filter:blur(12px)!important' +
                                ';-webkit-backdrop-filter:blur(12px)!important' +
                                ';border:1px solid rgba(255,255,255,0.08)!important' +
                                ';border-radius:14px!important' +
                                ';box-shadow:0 8px 32px rgba(0,0,0,0.5)!important';
                        }
                    }
                });
            });
        });
        observer.observe(document.body, { childList: true, subtree: false });
    }

    // ── 4. Ensure matrix canvas stays behind content ─────────────────
    function fixCanvasZ() {
        var canvas = document.getElementById('matrixCanvas');
        if (canvas) {
            canvas.style.zIndex = '0';
            canvas.style.opacity = '0.25';
            canvas.style.pointerEvents = 'none';
        }
    }

    // ── 5. Smooth scroll behavior for sidebar navigation ─────────────
    function enhanceSidebarNav() {
        var sidebar = document.getElementById('casinoSidebar');
        if (!sidebar) return;
        sidebar.querySelectorAll('a, [data-section]').forEach(function(link) {
            link.addEventListener('click', function() {
                // Add brief gold flash to active item
                sidebar.querySelectorAll('.active, .sidebar-item-active').forEach(function(el) {
                    el.classList.remove('active', 'sidebar-item-active');
                });
                this.classList.add('active');
            });
        });
    }

    // ── 6. Skeleton loading for game cards ───────────────────────────
    function addSkeletonLoading() {
        var style = document.createElement('style');
        style.textContent = [
            '@keyframes ms-shimmer {',
            '  0% { background-position: -200% 0; }',
            '  100% { background-position: 200% 0; }',
            '}',
            '.ms-skeleton {',
            '  background: linear-gradient(90deg,',
            '    var(--ms-bg-card, #1e1e2e) 25%,',
            '    var(--ms-bg-hover, #2a2a40) 50%,',
            '    var(--ms-bg-card, #1e1e2e) 75%);',
            '  background-size: 200% 100%;',
            '  animation: ms-shimmer 1.5s ease-in-out infinite;',
            '  border-radius: var(--ms-radius-md, 10px);',
            '}'
        ].join('\n');
        document.head.appendChild(style);
    }

    // ── Initialize ───────────────────────────────────────────────────
    function init() {
        fixFooterPlacement();
        fixCanvasZ();
        enhanceSidebarNav();
        addSkeletonLoading();
        styleIdlePopups();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
