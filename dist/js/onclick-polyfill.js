'use strict';

/**
 * onclick-polyfill.js
 *
 * Workaround for CSP script-src-attr 'none' which blocks inline onclick=
 * attributes. This script converts all existing onclick attributes to
 * addEventListener calls using new Function() (allowed by unsafe-eval).
 *
 * Also observes DOM mutations to handle dynamically created elements.
 */

(function() {
    'use strict';

    /**
     * Convert an element's onclick attribute to an event listener.
     */
    function patchElement(el) {
        var code = el.getAttribute('onclick');
        if (!code) return;
        // Only patch if the browser's CSP blocked the native handler
        // (onclick prop will be null when CSP blocks it)
        if (el.onclick !== null) return;
        try {
            var handler = new Function('event', code);
            el.addEventListener('click', handler);
        } catch (e) {
            console.warn('[onclick-polyfill] Failed to patch:', code, e.message);
        }
    }

    /**
     * Patch all elements with onclick attributes in the given root.
     */
    function patchAll(root) {
        var elements = (root || document).querySelectorAll('[onclick]');
        for (var i = 0; i < elements.length; i++) {
            patchElement(elements[i]);
        }
    }

    // Patch existing elements once DOM is ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', function() { patchAll(); });
    } else {
        patchAll();
    }

    // Watch for dynamically added elements with onclick attributes
    if (typeof MutationObserver !== 'undefined') {
        var observer = new MutationObserver(function(mutations) {
            for (var i = 0; i < mutations.length; i++) {
                var added = mutations[i].addedNodes;
                for (var j = 0; j < added.length; j++) {
                    var node = added[j];
                    if (node.nodeType !== 1) continue; // Element nodes only
                    if (node.hasAttribute && node.hasAttribute('onclick')) {
                        patchElement(node);
                    }
                    // Also check descendants
                    if (node.querySelectorAll) {
                        var descendants = node.querySelectorAll('[onclick]');
                        for (var k = 0; k < descendants.length; k++) {
                            patchElement(descendants[k]);
                        }
                    }
                }
            }
        });
        observer.observe(document.documentElement, { childList: true, subtree: true });
    }
})();
