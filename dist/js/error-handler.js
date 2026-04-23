/**
 * Global Frontend Error Handler for Matrix Spins Casino
 * Catches unhandled errors and promise rejections, shows user-friendly
 * messages and prevents silent failures.
 */
(function() {
    'use strict';

    // Track recent errors to avoid spamming the user
    var _recentErrors = [];
    var _MAX_VISIBLE_ERRORS = 3;
    var _ERROR_COOLDOWN_MS = 10000; // 10 seconds between same-source errors

    function _isDuplicate(message) {
        var now = Date.now();
        // Clean stale entries
        _recentErrors = _recentErrors.filter(function(e) { return now - e.time < _ERROR_COOLDOWN_MS; });
        // Check for duplicate
        var key = (message || '').substring(0, 80);
        for (var i = 0; i < _recentErrors.length; i++) {
            if (_recentErrors[i].key === key) return true;
        }
        _recentErrors.push({ key: key, time: now });
        return false;
    }

    function _shouldSuppress(message) {
        if (!message) return true;
        var msg = String(message).toLowerCase();
        // Suppress known benign errors
        var suppress = [
            'resizeobserver loop',         // Chrome resize observer warning
            'script error',                // Cross-origin script errors
            'load failed',                 // Asset load failures (non-critical)
            'network error',               // Transient network issues
            'failed to fetch',             // Service worker offline
            'the operation was aborted',   // Navigation aborted
            'cancelled',                   // User-cancelled operations
            'aborted',                     // AbortController signals
            'could not fetch notifications', // Notification bell (non-critical)
            'could not check',             // Non-critical background checks
        ];
        for (var i = 0; i < suppress.length; i++) {
            if (msg.indexOf(suppress[i]) !== -1) return true;
        }
        return false;
    }

    function _notifyUser(source, message) {
        if (_isDuplicate(message)) return;
        if (_recentErrors.length > _MAX_VISIBLE_ERRORS) return;

        // Use the casino's existing toast system if available
        if (typeof showToast === 'function') {
            showToast('Something went wrong. Please try again.', 'error');
        }
    }

    // Catch synchronous errors
    window.addEventListener('error', function(event) {
        var msg = event.message || (event.error && event.error.message) || 'Unknown error';
        if (_shouldSuppress(msg)) return;
        console.warn('[ErrorHandler] Caught error:', msg);
        _notifyUser('error', msg);
    });

    // Catch unhandled promise rejections
    window.addEventListener('unhandledrejection', function(event) {
        var reason = event.reason;
        var msg = reason instanceof Error ? reason.message : String(reason || 'Promise rejected');
        if (_shouldSuppress(msg)) return;
        console.warn('[ErrorHandler] Unhandled rejection:', msg);
        _notifyUser('rejection', msg);
        // Prevent console noise
        event.preventDefault();
    });

    // Monitor fetch failures for API calls (wrap fetch if desired)
    var _originalFetch = window.fetch;
    window.fetch = function() {
        return _originalFetch.apply(this, arguments).catch(function(err) {
            var url = arguments[0] && typeof arguments[0] === 'string' ? arguments[0] : '';
            // Only warn for API calls, not assets
            if (url.indexOf('/api/') !== -1) {
                console.warn('[ErrorHandler] API fetch failed:', url, err.message);
            }
            throw err; // Re-throw so callers can handle it
        });
    };
})();
