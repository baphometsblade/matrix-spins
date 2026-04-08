/**
 * Slot Focus Mode - Suppresses all non-essential UI when opening a slot
 * Activated by URL params: openSlot, noBonus=1, or qaTools=1
 * 
 * This script should load EARLY (before other scripts) to intercept popup creation.
 */
(function() {
    'use strict';
    
    var params = new URLSearchParams(window.location.search);
    var isSlotFocus = params.has('openSlot');
    var isNoBonus = params.get('noBonus') === '1';
    var isQaTools = params.get('qaTools') === '1';
    
    // Always active - suppress all non-essential popups
    // if (!isSlotFocus && !isNoBonus && !isQaTools) return;
    
    console.log('[SlotFocusMode] Activated — suppressing non-essential UI');
    
    // Set global flag so other scripts can check
    window._slotFocusMode = true;
    window._qaMode = true;  // Many scripts already check this
    
    // ====== 1. CSS-BASED SUPPRESSION ======
    // Inject styles that hide all non-slot overlays
    var style = document.createElement('style');
    style.id = 'slot-focus-mode-css';
    style.textContent = [
        '/* === Slot Focus Mode: suppress non-slot overlays === */',
        '',
        '/* Hide all modals except the slot modal */',
        '.modal:not([class*="slot-chrome"]):not([class*="slot-template"]):not(#slotModal):not(#authModal):not(#depositModal):not(#profileModal):not(#settingsModal):not(.active) {',
        '  display: none !important;',
        '}',
        '',
        '/* Hide achievement/referral/deposit panels */',
        '[class*="achievement-panel"], [class*="achievement-toast"],',
        '[class*="referral-panel"], [class*="deposit-streak"],',
        '[class*="daily-challenge"], [class*="welcome-tour"],',
        '[class*="cookie-banner"], [class*="season-leader"],',
        '[class*="country-selector"], [class*="keyboard-shortcut"],',
        '[class*="first-deposit"], [class*="deposit-bonus"],',
        '[class*="comeback-offer"], [class*="promo-bar"],',
        '[class*="happy-hour-banner"], [class*="tos-modal"],',
        '[class*="verification-bar"], [class*="submit-verification"] {',
        '  display: none !important;',
        '}',
        '',
        '/* Hide floating banners and tickers */',
        '.jackpot-ticker, .tournament-banner, [class*="season-banner"],',
        '.lucky-hour-banner, #pageTransition, .midweek-boost-banner,',
        '.social-proof-feed, [class*="win-feed"], [class*="jackpot-feed"],',
        '[class*="promo-carousel"], .bonus-countdown-bar {',
        '  display: none !important;',
        '}',
        '',
        '/* Hide notification toasts */',
        '[class*="toast"]:not(.slot-toast), [class*="notification-popup"],',
        '[class*="snackbar"], .notification-bell-dropdown {',
        '  display: none !important;',
        '}',
        '',
        '/* Boost slot modal above everything */',
        '.modal[class*="slot-chrome"], .modal[class*="slot-template"], #slotModal {',
        '  z-index: 999999 !important;',
        '}',
        '',
        '/* Hide the Game Info panel inside the slot (auto-opens annoyingly) */',
        '.slot-game-info-overlay, .game-info-panel-visible {',
        '  display: none !important;',
        '}'
    ].join('\n');
    
    // Insert ASAP
    if (document.head) {
        document.head.appendChild(style);
    } else {
        document.addEventListener('DOMContentLoaded', function() {
            document.head.appendChild(style);
        });
    }
    
    // ====== 2. MUTATION OBSERVER GUARD ======
    // Watch for any new high-z overlays and suppress them
    function startGuard() {
        var observer = new MutationObserver(function(mutations) {
            // Check if a slot is open
            var slotModal = document.querySelector('.modal[class*="slot-chrome"].active, .modal[class*="slot-template"].active, #slotModal.active');
            if (!slotModal && !isNoBonus) return; // Only guard when slot is open or noBonus mode
            
            mutations.forEach(function(mutation) {
                mutation.addedNodes.forEach(function(node) {
                    if (node.nodeType !== 1) return;
                    // Don't touch the slot modal or its children
                    if (slotModal && (node === slotModal || slotModal.contains(node))) return;
                    // Don't touch provider chrome elements
                    if (node.classList && (node.classList.contains('provider-chrome-frame') || 
                        node.classList.contains('provider-logo-badge') || 
                        node.classList.contains('provider-watermark'))) return;
                    
                    // Check if this is a blocking overlay
                    var cs = window.getComputedStyle ? window.getComputedStyle(node) : node.currentStyle;
                    if (!cs) return;
                    var pos = cs.position;
                    var z = parseInt(cs.zIndex) || 0;
                    
                    if ((pos === 'fixed' || pos === 'absolute') && z > 500) {
                        // Check if it's a modal or overlay
                        var cls = (node.className || '').toString().toLowerCase();
                        var id = (node.id || '').toLowerCase();
                        var isPopup = cls.includes('modal') || cls.includes('overlay') || cls.includes('popup') ||
                                     cls.includes('toast') || cls.includes('banner') || cls.includes('achievement') ||
                                     cls.includes('deposit') || cls.includes('referral') || cls.includes('challenge') ||
                                     cls.includes('shortcut') || cls.includes('verification') || cls.includes('promo') ||
                                     cls.includes('notification') || id.includes('modal') || id.includes('popup');
                        
                        if (isPopup) {
                            console.debug('[SlotFocusMode] Suppressed:', node.id || cls.substring(0, 40));
                            node.style.display = 'none';
                            node.style.visibility = 'hidden';
                        }
                    }
                });
            });
        });
        
        observer.observe(document.documentElement, { childList: true, subtree: true });
    }
    
    if (document.body) {
        startGuard();
    } else {
        document.addEventListener('DOMContentLoaded', startGuard);
    }
    
    // ====== 3. GAME INFO AUTO-CLOSE ======
    // Close the Game Info panel that opens by default when a slot loads
    function closeGameInfo() {
        var slotModal = document.querySelector('.modal[class*="slot-chrome"].active, .modal[class*="slot-template"].active');
        if (!slotModal) return;
        
        // Method 1: Find and click close button on info panel
        var infoCloseBtn = slotModal.querySelector('.game-info-close, .info-close-btn, [class*="info-panel"] .close');
        if (infoCloseBtn) { infoCloseBtn.click(); return; }
        
        // Method 2: Try the ? info toggle button
        var infoToggle = slotModal.querySelector('#gameInfoBtn, .slot-info-toggle, [class*="info-btn"]');
        // Check if info panel is currently visible
        var infoPanel = slotModal.querySelector('.slot-game-info, .game-info-panel, [class*="game-info"]');
        if (infoPanel && infoPanel.offsetParent !== null && infoToggle) {
            infoToggle.click();
            return;
        }
        
        // Method 3: Brute force - find "Game Info" heading and hide its container
        var allH = slotModal.querySelectorAll('h2, h3, strong, b');
        for (var i = 0; i < allH.length; i++) {
            if (allH[i].textContent.trim() === 'Game Info') {
                var container = allH[i].parentElement;
                while (container && container !== slotModal) {
                    if (container.offsetHeight > 200) { // It's the info container
                        container.style.display = 'none';
                        return;
                    }
                    container = container.parentElement;
                }
            }
        }
    }
    
    // Run closeGameInfo after slot opens
    function watchForSlotOpen() {
        var slotObserver = new MutationObserver(function(mutations) {
            mutations.forEach(function(mutation) {
                if (mutation.type === 'attributes' && mutation.attributeName === 'class') {
                    var target = mutation.target;
                    if (target.classList && target.classList.contains('active') && 
                        (target.classList.toString().includes('slot-chrome') || target.classList.toString().includes('slot-template'))) {
                        // Slot just became active — close game info after a short delay
                        setTimeout(closeGameInfo, 500);
                        setTimeout(closeGameInfo, 1500);
                        setTimeout(closeGameInfo, 3000);
                    }
                }
            });
        });
        
        slotObserver.observe(document.documentElement, { attributes: true, subtree: true, attributeFilter: ['class'] });
    }
    
    if (document.body) {
        watchForSlotOpen();
    } else {
        document.addEventListener('DOMContentLoaded', watchForSlotOpen);
    }
    
    // ====== 4. SUPPRESS EXISTING ELEMENTS ON LOAD ======
    document.addEventListener('DOMContentLoaded', function() {
        // Give the page a moment to render, then clean up
        setTimeout(function() {
            // Hide all non-slot modals
            document.querySelectorAll('.modal:not([class*="slot-chrome"]):not([class*="slot-template"]):not(#slotModal):not(#authModal):not(#depositModal):not(#profileModal):not(#settingsModal):not(.active)').forEach(function(el) {
                el.style.display = 'none';
            });
            // Try to close game info
            closeGameInfo();
        }, 2000);
        
        setTimeout(closeGameInfo, 4000);
        setTimeout(closeGameInfo, 6000);
    });
    
})();
