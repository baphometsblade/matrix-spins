#!/usr/bin/env node
/**
 * Sweep every top-level HTML page and ensure:
 *   1. The footer "Information" column links to the full set of legal pages
 *      (Terms, Privacy, Cookie Policy, AML, Provably Fair, Responsible Gambling, FAQ)
 *   2. age-gate.js, cookie-consent.js are loaded
 *   3. search.js + search.css are loaded
 *
 * Idempotent — safe to re-run. No external dependencies.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

// Pages we DON'T touch (admin tooling, error page, partial fragments)
const SKIP = new Set([
    '404.html',
    'admin.html',
    'launch.html',
    'email-sequence.html'
]);

// Canonical "Information" footer block — replaces any existing one
const NEW_FOOTER_LINKS = `<a href="promotions.html" class="footer-link">Promotions</a>
                    <a href="vip.html" class="footer-link">VIP Rewards</a>
                    <a href="leaderboard.html" class="footer-link">Tournaments</a>
                    <a href="referral.html" class="footer-link">Refer & Earn</a>
                    <a href="faq.html" class="footer-link">FAQ</a>
                    <a href="terms.html" class="footer-link">Terms & Conditions</a>
                    <a href="privacy.html" class="footer-link">Privacy Policy</a>
                    <a href="cookie-policy.html" class="footer-link">Cookie Policy</a>
                    <a href="aml.html" class="footer-link">AML Policy</a>
                    <a href="responsible-gambling.html" class="footer-link">Responsible Gambling</a>
                    <a href="provably-fair.html" class="footer-link">Provably Fair</a>`;

// Regex matching existing footer-links inner block
const FOOTER_LINKS_RE = /(<div\s+class="footer-links"\s*>)([\s\S]*?)(<\/div>)/i;

const SCRIPT_TAGS_TO_ENSURE = [
    { src: 'js/age-gate.js', defer: true },
    { src: 'js/cookie-consent.js', defer: true },
    { src: 'js/search.js', defer: true }
];

const STYLESHEETS_TO_ENSURE = [
    'css/search.css'
];

function patchHtml(file) {
    const fp = path.join(ROOT, file);
    let html = fs.readFileSync(fp, 'utf8');
    const orig = html;

    // 1. Footer Information column — replace inner content of <div class="footer-links">
    if (FOOTER_LINKS_RE.test(html)) {
        html = html.replace(FOOTER_LINKS_RE, (_m, open, _inner, close) => {
            return `${open}\n                    ${NEW_FOOTER_LINKS}\n                ${close}`;
        });
    }

    // 2. Inject scripts before </body> if not already present
    SCRIPT_TAGS_TO_ENSURE.forEach(({ src, defer }) => {
        if (!html.includes(src)) {
            const tag = `    <script src="${src}"${defer ? ' defer' : ''}></script>\n`;
            html = html.replace(/<\/body>/i, tag + '</body>');
        }
    });

    // 3. Inject stylesheets before </head> if not already present
    STYLESHEETS_TO_ENSURE.forEach((href) => {
        if (!html.includes(href)) {
            const tag = `    <link rel="stylesheet" href="${href}">\n`;
            html = html.replace(/<\/head>/i, tag + '</head>');
        }
    });

    if (html !== orig) {
        fs.writeFileSync(fp, html);
        return true;
    }
    return false;
}

function main() {
    const pages = fs.readdirSync(ROOT)
        .filter(f => f.endsWith('.html') && !SKIP.has(f));

    let changed = 0;
    pages.forEach(p => {
        try {
            if (patchHtml(p)) {
                console.log(`patched: ${p}`);
                changed++;
            } else {
                console.log(`unchanged: ${p}`);
            }
        } catch (e) {
            console.error(`failed: ${p} -- ${e.message}`);
        }
    });

    console.log(`\nDone. ${changed}/${pages.length} pages patched.`);
}

if (require.main === module) main();
