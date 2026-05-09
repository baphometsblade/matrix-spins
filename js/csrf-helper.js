/**
 * CSRF Token Helper
 * Manages CSRF tokens and automatically injects them into fetch requests
 */
(function() {
    'use strict';

    let csrfToken = null;
    let lastTokenFetchTime = null;
    const TOKEN_REFRESH_INTERVAL = 30 * 60 * 1000; // 30 minutes

    // Store original fetch for wrapping
    const originalFetch = window.fetch;

    /**
     * Initialize CSRF protection (call after login or on page load if session exists)
     */
    async function init() {
        try {
            // Must include auth header — /api/csrf-token requires authentication
            var authToken = localStorage.getItem('casinoToken');
            if (!authToken) {
                // Not logged in — skip CSRF init, will retry after login
                return;
            }

            var headers = { 'Authorization': 'Bearer ' + authToken };
            var response = await originalFetch('/api/csrf-token', { headers: headers });
            if (!response.ok) {
                console.warn('[CSRF] Failed to fetch initial token:', response.status);
                return;
            }

            var data = await response.json();
            csrfToken = data.csrfToken;
            lastTokenFetchTime = Date.now();

            console.warn('[CSRF] Token initialized');
        } catch (err) {
            console.warn('[CSRF] Failed to initialize token:', err.message);
        }
    }

    /**
     * Get current token (fetch new one if expired)
     */
    async function getToken() {
        // If no token or refresh interval exceeded, fetch new one
        if (
            !csrfToken ||
            !lastTokenFetchTime ||
            Date.now() - lastTokenFetchTime > TOKEN_REFRESH_INTERVAL
        ) {
            try {
                var authToken = localStorage.getItem('casinoToken');
                if (!authToken) return csrfToken; // Not logged in
                var headers = { 'Authorization': 'Bearer ' + authToken };
                var response = await originalFetch('/api/csrf-token', { headers: headers });
                if (!response.ok) {
                    console.warn('[CSRF] Failed to refresh token:', response.status);
                    return csrfToken; // Return stale token as fallback
                }

                var data = await response.json();
                csrfToken = data.csrfToken;
                lastTokenFetchTime = Date.now();
            } catch (err) {
                console.warn('[CSRF] Failed to refresh token:', err.message);
                // Return stale token as fallback
            }
        }

        return csrfToken;
    }

    /**
     * Wrap window.fetch to add CSRF token to mutation requests
     */
    window.fetch = function(url, options) {
        options = options || {};
        const method = (options.method || 'GET').toUpperCase();

        // ROUND 66: Include PATCH in the mutation list (was POST/PUT/DELETE).
        // No PATCH endpoints exist today, but if any are added the client
        // would have silently bypassed CSRF without this fix.
        if (['POST', 'PUT', 'DELETE', 'PATCH'].includes(method) && url.includes('/api/')) {
            // Add CSRF token header if we have one
            if (csrfToken) {
                options.headers = options.headers || {};
                options.headers['X-CSRF-Token'] = csrfToken;
            }
        }

        return originalFetch.apply(this, [url, options]);
    };

    // Expose public API
    window.CsrfHelper = {
        init,
        getToken,
    };

    // Auto-initialize if user is already logged in (page refresh / SPA nav)
    if (localStorage.getItem('casinoToken')) {
        setTimeout(init, 100);
    }

    console.log('[CSRF] Helper loaded');
})();
