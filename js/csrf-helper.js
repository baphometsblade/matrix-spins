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
     * Initialize CSRF protection (call after login)
     */
    async function init() {
        try {
            const response = await originalFetch('/api/csrf-token');
            if (!response.ok) {
                console.warn('[CSRF] Failed to fetch initial token:', response.status);
                return;
            }

            const data = await response.json();
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
                const response = await originalFetch('/api/csrf-token');
                if (!response.ok) {
                    console.warn('[CSRF] Failed to refresh token:', response.status);
                    return csrfToken; // Return stale token as fallback
                }

                const data = await response.json();
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
     * Lazy-fetches a token when one isn't cached yet (pre-login flows
     * like /register and /login need a CSRF token bound to the 'anon'
     * user, and waiting for an explicit init() call was dropping those).
     */
    window.fetch = function(url, options) {
        options = options || {};
        const method = (options.method || 'GET').toUpperCase();
        const isMutation = ['POST', 'PUT', 'DELETE', 'PATCH'].includes(method);
        const isApi = typeof url === 'string' && url.indexOf('/api/') !== -1 && url.indexOf('/api/csrf-token') === -1;

        if (!isMutation || !isApi) {
            return originalFetch.apply(this, [url, options]);
        }

        // Ensure we have a fresh token, then attach it.
        return getToken().then(function (tok) {
            options.headers = Object.assign({}, options.headers || {});
            if (tok) options.headers['X-CSRF-Token'] = tok;
            return originalFetch.call(window, url, options);
        });
    };

    function invalidate() {
        csrfToken = null;
        lastTokenFetchTime = null;
    }

    // Expose public API
    window.CsrfHelper = {
        init,
        getToken,
        invalidate,
    };

    console.warn('[CSRF] Helper loaded');
})();
