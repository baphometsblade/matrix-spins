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
     * Build the fetch init for /api/csrf-token. The server binds the
     * issued token to the current authenticated user (or 'anon'); it
     * identifies the user via the Authorization header, so we MUST
     * forward the bearer token here — otherwise we'd cache an
     * anon-bound token and every authed mutation would 403.
     */
    function csrfFetchInit() {
        const headers = {};
        try {
            const tok = localStorage.getItem('casinoToken');
            if (tok) headers['Authorization'] = 'Bearer ' + tok;
        } catch (e) { /* storage unavailable — fall through */ }
        return { headers: headers, credentials: 'same-origin' };
    }

    /**
     * Initialize CSRF protection (call after login)
     */
    async function init() {
        try {
            const response = await originalFetch('/api/csrf-token', csrfFetchInit());
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
     * Get current token (fetch new one if expired).
     * Fail-closed: if a fresh fetch fails, the cached token is invalidated
     * and the error is propagated. We never return a stale token — that
     * would be a security regression (CSRF tokens must be live).
     */
    async function getToken() {
        // If no token or refresh interval exceeded, fetch new one
        if (
            !csrfToken ||
            !lastTokenFetchTime ||
            Date.now() - lastTokenFetchTime > TOKEN_REFRESH_INTERVAL
        ) {
            const response = await originalFetch('/api/csrf-token', csrfFetchInit());
            if (!response.ok) {
                csrfToken = null;
                lastTokenFetchTime = null;
                throw new Error('[CSRF] Failed to fetch token: HTTP ' + response.status);
            }

            const data = await response.json();
            csrfToken = data.csrfToken;
            lastTokenFetchTime = Date.now();
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
