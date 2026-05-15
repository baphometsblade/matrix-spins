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
     * Wrap window.fetch to add CSRF token to mutation requests.
     * For /api/ mutation calls we AWAIT the token if it's not yet cached —
     * eliminating the race window between page load (when this script's
     * setTimeout(init, 100) is scheduled) and the user clicking SPIN/DEPOSIT
     * a few hundred ms later. On 403 we transparently refetch + retry once.
     */
    window.fetch = async function(url, options) {
        options = options || {};
        const method = (options.method || 'GET').toUpperCase();
        const isMutation = ['POST', 'PUT', 'DELETE', 'PATCH'].includes(method);
        const isApi = typeof url === 'string' && url.indexOf('/api/') !== -1;
        const isCsrfEndpoint = typeof url === 'string' && url.indexOf('/api/csrf-token') !== -1;

        if (isMutation && isApi && !isCsrfEndpoint) {
            // Ensure we have a token before firing the request.
            if (!csrfToken && localStorage.getItem('casinoToken')) {
                try { await getToken(); } catch (_) {}
            }
            if (csrfToken) {
                options.headers = options.headers || {};
                options.headers['X-CSRF-Token'] = csrfToken;
            }
        }

        let res = await originalFetch.apply(this, [url, options]);

        // Stale-token recovery: server says 403, refetch and retry once.
        if (res.status === 403 && isMutation && isApi && !isCsrfEndpoint && !options.__csrfRetried) {
            csrfToken = null;
            lastTokenFetchTime = null;
            try { await getToken(); } catch (_) {}
            if (csrfToken) {
                options.headers = options.headers || {};
                options.headers['X-CSRF-Token'] = csrfToken;
                options.__csrfRetried = true;
                res = await originalFetch.apply(this, [url, options]);
            }
        }
        return res;
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
