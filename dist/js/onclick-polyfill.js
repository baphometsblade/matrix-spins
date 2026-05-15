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
    // SECURITY (ROUND 66): The previous DENYLIST was bypassable
    // (`\u0066etch`, `'fet'+'ch'`, `globalThis['fetch']`,
    // `String.fromCharCode(...)`, `parent`, `top`, `Reflect`, `Proxy`, etc.).
    // Replaced with a strict ALLOWLIST: the polyfill only compiles onclick
    // code that matches one of three safe shapes used by our static HTML:
    //   1. funcName(literalArgs?)   — bare function call with literals only
    //   2. this.<tail>(literalArgs?) — dotted method chain rooted at `this`
    //   3. this.<tail> = literal     — simple property reset
    // Anything else (template literals, bracket access, string concat,
    // unicode escapes, char codes) fails every regex and is refused.
    var _allowedShapes = [
        /^\s*[A-Za-z_$][\w$]*\s*\(\s*([\d.,'"\s]|true|false|null|this|event|-)*\s*\)\s*;?\s*$/,
        /^\s*this(?:\.[A-Za-z_$][\w$]*)+\s*\(\s*([\d.,'"\s]|true|false|null)*\s*\)\s*;?\s*$/,
        /^\s*this(?:\.[A-Za-z_$][\w$]*)+\s*=\s*(?:["'][^"'<>]*["']|\d+|true|false|null)\s*;?\s*$/,
    ];
    function _isAllowedOnclickShape(code) {
        for (var i = 0; i < _allowedShapes.length; i++) {
            if (_allowedShapes[i].test(code)) return true;
        }
        return false;
    }

    function patchElement(el) {
        if (el._onclickPolyfilled) return;
        var code = el.getAttribute('onclick');
        if (!code) return;
        el._onclickPolyfilled = true;
        // Note: Removed el.onclick check — accessing .onclick throws SyntaxError
        // when the attribute contains certain JS patterns (e.g., template literals)
        // SECURITY: refuse anything that doesn't match a known-safe shape.
        if (!_isAllowedOnclickShape(code)) {
            console.warn('[onclick-polyfill] Refused onclick (not in safe shape):', code.slice(0, 80));
            return;
        }
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
