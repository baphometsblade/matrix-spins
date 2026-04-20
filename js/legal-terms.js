/**
 * Legal Terms & Conditions Module
 * Matrix Spins Casino - msaart.online
 *
 * Thin redirects to canonical HTML pages so the site has a single source of
 * truth for Terms, Privacy, and Responsible Gambling. Previous inline modals
 * contained contradictory "virtual currency" framing that created legal
 * exposure against the real-money T&C at /terms.html; they were replaced
 * with direct links to the canonical pages.
 */

(function () {
    'use strict';

    function openPage(path) {
        try {
            window.open(path, '_blank', 'noopener');
        } catch (_) {
            window.location.href = path;
        }
    }

    window.showTermsOfService = function () { openPage('/terms.html'); };
    window.showPrivacyPolicy  = function () { openPage('/privacy.html'); };
    // Matrix Money is a real-money balance, not virtual currency. Any existing
    // UI calling this sends users to the canonical terms page.
    window.showMatrixMoneyInfo = function () { openPage('/terms.html'); };

    // First-visit acceptance gate — real-money framing, 18+ confirmation.
    (function firstVisitConsent() {
        var CONSENT_KEY = 'matrixSpins_termsAccepted_v2';
        if (localStorage.getItem(CONSENT_KEY)) return;

        function makeLink(href, text) {
            var a = document.createElement('a');
            a.href = href;
            a.target = '_blank';
            a.rel = 'noopener';
            a.style.cssText = 'color:#f9ca24;text-decoration:underline;';
            a.textContent = text;
            return a;
        }

        function show() {
            if (document.getElementById('first-visit-consent')) return;

            var overlay = document.createElement('div');
            overlay.id = 'first-visit-consent';
            overlay.style.cssText = 'position:fixed;inset:0;z-index:99999;background:rgba(0,0,0,0.92);display:flex;align-items:center;justify-content:center;padding:20px;backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);';

            var box = document.createElement('div');
            box.style.cssText = 'max-width:540px;width:100%;background:linear-gradient(135deg,#0f172a 0%,#1e293b 100%);border:1px solid rgba(249,202,36,0.3);border-radius:16px;padding:32px;color:#e0e0e0;text-align:center;';

            var emoji = document.createElement('div');
            emoji.style.cssText = 'font-size:48px;margin-bottom:12px;';
            emoji.textContent = '\uD83C\uDFB0';

            var heading = document.createElement('h2');
            heading.style.cssText = 'color:#f9ca24;font-size:22px;margin-bottom:12px;';
            heading.textContent = 'Welcome to Matrix Spins Casino';

            var lead = document.createElement('p');
            lead.style.cssText = 'font-size:13px;color:#cbd5e1;margin-bottom:16px;';
            var leadStrong = document.createElement('strong');
            leadStrong.style.color = '#f9ca24';
            leadStrong.textContent = '18 years or older';
            lead.append(
                'Real-money online slots. You must be ',
                leadStrong,
                ' and legally permitted to gamble in your jurisdiction. Gambling involves risk — only wager what you can afford to lose.'
            );

            var accept = document.createElement('p');
            accept.style.cssText = 'font-size:13px;color:#94a3b8;margin-bottom:16px;';
            accept.append(
                'By continuing you agree to our ',
                makeLink('/terms.html', 'Terms of Service'),
                ', ',
                makeLink('/privacy.html', 'Privacy Policy'),
                ', and ',
                makeLink('/responsible-gambling.html', 'Responsible Gambling'),
                ' policy.'
            );

            var btn = document.createElement('button');
            btn.id = 'acceptTermsBtn';
            btn.style.cssText = 'background:linear-gradient(135deg,#f59e0b,#d97706);color:#000;font-weight:700;font-size:15px;padding:12px 40px;border:none;border-radius:8px;cursor:pointer;width:100%;transition:opacity 0.2s;';
            btn.textContent = 'I am 18+ and I Accept';
            btn.addEventListener('click', function () {
                try { localStorage.setItem(CONSENT_KEY, '1'); } catch (_) {}
                overlay.remove();
            });

            var disclaimer = document.createElement('p');
            disclaimer.style.cssText = 'font-size:11px;color:#64748b;margin-top:10px;';
            disclaimer.textContent = 'Gambling can be addictive. Please play responsibly.';

            box.append(emoji, heading, lead, accept, btn, disclaimer);
            overlay.append(box);
            document.body.appendChild(overlay);
        }

        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', show);
        } else {
            show();
        }
    })();
})();
