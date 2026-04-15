/**
 * Frontend Maintenance Mode Check
 *
 * This IIFE intercepts fetch calls and shows a full-screen maintenance overlay
 * when the API returns a 503 with maintenance: true
 */

(function() {
    'use strict';

    const OVERLAY_ID = 'maintenance-overlay';
    const MAINTENANCE_CHECK_TIMEOUT = 5000; // Check every 5 seconds if online

    /**
     * Creates and displays the maintenance overlay
     */
    function showMaintenanceOverlay(message) {
        // Prevent duplicate overlays
        if (document.getElementById(OVERLAY_ID)) {
            return;
        }

        const overlay = document.createElement('div');
        overlay.id = OVERLAY_ID;
        overlay.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
            display: flex;
            align-items: center;
            justify-content: center;
            z-index: 9999;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
        `;

        const content = document.createElement('div');
        content.style.cssText = `
            text-align: center;
            color: white;
            padding: 40px;
            max-width: 500px;
            animation: slideUp 0.5s ease-out;
        `;

        const title = document.createElement('h1');
        title.textContent = 'Maintenance in Progress';
        title.style.cssText = `
            font-size: 32px;
            margin: 0 0 20px 0;
            color: #ffd700;
            text-shadow: 0 2px 4px rgba(0,0,0,0.5);
        `;

        const messageEl = document.createElement('p');
        messageEl.textContent = message || 'Matrix Spins is undergoing scheduled maintenance. We\'ll be back shortly!';
        messageEl.style.cssText = `
            font-size: 16px;
            margin: 0 0 30px 0;
            line-height: 1.6;
            color: #e0e0e0;
        `;

        const spinner = document.createElement('div');
        spinner.style.cssText = `
            width: 60px;
            height: 60px;
            margin: 20px auto;
            border: 4px solid rgba(255, 215, 0, 0.3);
            border-top: 4px solid #ffd700;
            border-radius: 50%;
            animation: spin 1s linear infinite;
        `;

        const subtext = document.createElement('p');
        subtext.textContent = 'We\'re working hard to get back online. Thanks for your patience!';
        subtext.style.cssText = `
            font-size: 12px;
            margin: 30px 0 0 0;
            color: #a0a0a0;
            font-style: italic;
        `;

        content.appendChild(title);
        content.appendChild(messageEl);
        content.appendChild(spinner);
        content.appendChild(subtext);
        overlay.appendChild(content);

        // Add animation keyframes
        if (!document.getElementById('maintenance-styles')) {
            const style = document.createElement('style');
            style.id = 'maintenance-styles';
            style.textContent = `
                @keyframes slideUp {
                    from {
                        opacity: 0;
                        transform: translateY(30px);
                    }
                    to {
                        opacity: 1;
                        transform: translateY(0);
                    }
                }
                @keyframes spin {
                    to {
                        transform: rotate(360deg);
                    }
                }
            `;
            document.head.appendChild(style);
        }

        document.body.appendChild(overlay);
        console.log('[Maintenance] Overlay displayed to user');
    }

    /**
     * Removes the maintenance overlay
     */
    function hideMaintenanceOverlay() {
        const overlay = document.getElementById(OVERLAY_ID);
        if (overlay) {
            overlay.style.opacity = '0';
            overlay.style.transition = 'opacity 0.3s ease-out';
            setTimeout(() => {
                if (overlay.parentNode) {
                    overlay.parentNode.removeChild(overlay);
                }
                console.log('[Maintenance] Overlay removed');
            }, 300);
        }
    }

    /**
     * Checks if maintenance is still active by polling the status endpoint
     */
    function checkMaintenanceStatus() {
        const originalFetch = window.fetch;
        fetch('/api/maintenance/status')
            .then(res => res.json())
            .catch(() => ({ enabled: false }))
            .then(data => {
                if (!data.enabled) {
                    hideMaintenanceOverlay();
                    console.log('[Maintenance] System is back online');
                } else {
                    // Check again in 5 seconds
                    setTimeout(checkMaintenanceStatus, MAINTENANCE_CHECK_TIMEOUT);
                }
            });
    }

    /**
     * Wraps the native fetch to intercept maintenance responses
     */
    function wrapFetch() {
        const originalFetch = window.fetch;

        window.fetch = function(...args) {
            return originalFetch.apply(this, args)
                .then(response => {
                    // Check for 503 with maintenance flag or degraded-mode error
                    if (response.status === 503) {
                        response.clone().json()
                            .then(data => {
                                if (data.maintenance === true) {
                                    showMaintenanceOverlay(data.message);
                                    setTimeout(checkMaintenanceStatus, MAINTENANCE_CHECK_TIMEOUT);
                                } else if (data.error && typeof showToast === 'function') {
                                    // Degraded mode — show a user-friendly toast instead of silent failure
                                    showToast('Service temporarily limited. Please try again later.', 'warning');
                                }
                            })
                            .catch(() => {});
                    }
                    return response;
                })
                .catch(err => {
                    console.log('[Maintenance] Fetch error:', err);
                    throw err;
                });
        };
    }

    // ── Degraded Mode Banner ──────────────────────────────────────
    var _degradedBannerId = 'degraded-mode-banner';

    function showDegradedBanner() {
        if (document.getElementById(_degradedBannerId)) return;
        var banner = document.createElement('div');
        banner.id = _degradedBannerId;
        banner.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:99999;background:linear-gradient(90deg,#b45309,#d97706);color:#fff;text-align:center;padding:8px 16px;font-size:13px;font-weight:600;letter-spacing:0.5px;box-shadow:0 2px 8px rgba(0,0,0,0.3);';
        banner.textContent = '\u26A0 Limited Mode \u2014 Deposits, withdrawals & real-money play temporarily unavailable. Free play is active.';
        document.body.prepend(banner);
    }

    function hideDegradedBanner() {
        var el = document.getElementById(_degradedBannerId);
        if (el) el.remove();
    }

    function checkDegradedStatus() {
        fetch('/api/health').then(function(r) { return r.json(); }).then(function(data) {
            if (data.status === 'degraded') {
                showDegradedBanner();
                setTimeout(checkDegradedStatus, 5 * 60 * 1000);
            } else {
                hideDegradedBanner();
            }
        }).catch(function() { /* server might be fully down */ });
    }

    /**
     * Public initialization function
     */
    function init() {
        console.log('[Maintenance] Initializing maintenance check');
        wrapFetch();

        // Also do an initial check on page load
        checkMaintenanceStatus();

        // Check for degraded mode (PG unavailable but server running)
        setTimeout(checkDegradedStatus, 2000);
    }

    // Expose to window
    window.MaintenanceCheck = {
        init: init
    };

    // Auto-initialize if DOM is ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
