#!/usr/bin/env node

/**
 * Matrix Spins Casino - JavaScript & CSS Bundler
 * Concatenates 97+ JS files and 4 CSS files into optimized bundles
 * Generates cache-busted filenames with content-based versioning
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// --- Configuration ---
const ROOT_DIR = path.join(__dirname, '..');
const DIST_DIR = path.join(ROOT_DIR, 'dist');
const INDEX_HTML = path.join(ROOT_DIR, 'index.html');

// Scripts that must remain in <head> (load before everything)
const EARLY_SCRIPTS = [
    'js/maintenance-check.js',
    'js/error-handler.js',
    'js/onclick-polyfill.js',
    'js/eager-thumbs.js',
    'js/confetti.min.js',
    'js/jackpot-celebration.js'
];

// Standalone-page scripts referenced directly by login/signup/account/etc HTML.
// NOT bundled — copied to dist/js/ so the <script src="js/X.js"> tags resolve.
const STANDALONE_SCRIPTS = [
    'js/api-client.js',
    'js/countries.js',
    'js/social-proof.js',
    'js/deposit-urgency.js',
    'js/onboarding.js',
    'js/referral-page.js',
    'js/responsible-gambling-page.js',
    'js/unified-ux.js',
    'js/pwa-install.js',
    // Site-wide compliance + search scripts — referenced by every HTML page
    'js/age-gate.js',
    'js/cookie-consent.js',
    'js/search.js'
];

// Standalone CSS files referenced directly by static HTML pages
// (achievements.html, wallet.html, history.html, etc.) — copied to dist/
const STANDALONE_CSS = [
    'unified-ux.css',
    'css/search.css',
    'css/cookie-consent.css',
    'css/age-gate.css'
];

// CSS files to bundle (in specificity order — premium overrides MUST be last).
// `css/*` files were previously left as standalone <link> tags in
// dist/index.html (12 extra HTTP requests on cold load). They're inserted
// at the component-level position so the existing premium-override
// cascade is preserved. age-gate.css and search.css are also referenced
// directly by login.html and other non-index pages — those keep working
// because both files remain in STANDALONE_CSS above and are still
// copied verbatim to dist/.
const CSS_FILES = [
    'design-tokens.css',
    'styles.css',
    'layout-shell.css',
    'game-cards.css',
    'social-proof.css',
    'slot-layout-fix.css',
    'visual-overhaul.css',
    'bonus-games.css',
    'mobile-fixes.css',
    // Page-level CSS that index.html used to load as separate <link>s.
    // Placed before component theming so they can be overridden.
    'css/performance-mobile.css',
    'css/landing-redesign.css',
    'css/jackpot.css',
    'css/chat-widget.css',
    'css/notifications.css',
    'css/age-gate.css',
    'css/skeleton.css',
    'css/search.css',
    'css/favorites.css',
    'css/session-monitor.css',
    'css/conversion.css',
    'provider-chrome.css',
    'studio-chrome.css',
    'promo-styles.css',
    'phase5-lobby.css',
    'popup-nuke.css',
    'premium-redesign.css',
    'premium-polish.css',
    'premium-animations.css',
    'modals-v2.css',
    'premium-v2-fixes.css',
    'premium-v3-upgrades.css',
    'unified-ux.css'
];

// --- Helper Functions ---

function log(msg) {
    console.log(`[BUNDLE] ${msg}`);
}

function warn(msg) {
    console.warn(`[BUNDLE] WARNING: ${msg}`);
}

function contentHash(content) {
    return crypto.createHash('sha256')
        .update(content)
        .digest('hex')
        .substring(0, 8);
}

function ensureDir(dir) {
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
}

function readFile(filePath) {
    try {
        return fs.readFileSync(filePath, 'utf8');
    } catch (err) {
        warn(`Could not read file: ${filePath}`);
        return '';
    }
}

/**
 * Parse index.html and extract script/CSS references
 * Returns { scripts: [paths], cssLinks: [paths], inlineScripts: [{content, line}] }
 */
function parseIndexHtml(htmlContent) {
    const scripts = [];
    const cssLinks = [];
    const inlineScripts = [];

    const lines = htmlContent.split('\n');

    lines.forEach((line, idx) => {
        // Extract <script src="..."> (strip cache-busting query strings like ?v=2.0.0)
        const scriptMatch = line.match(/<script\s+src=["']([^"']+)["']/i);
        if (scriptMatch) {
            const src = scriptMatch[1].split('?')[0];
            if (!src.startsWith('http://') && !src.startsWith('https://')) {
                scripts.push(src);
            }
            return;
        }

        // Extract <link rel="stylesheet" href="...">
        const linkMatch = line.match(/<link\s+rel=["']stylesheet["']\s+href=["']([^"']+)["']/i);
        if (linkMatch && !linkMatch[1].includes('fonts.googleapis')) {
            cssLinks.push(linkMatch[1]);
            return;
        }

        // Track inline scripts (preserve as-is)
        if (line.trim().startsWith('<script>')) {
            inlineScripts.push({
                line: idx + 1,
                startIndex: htmlContent.indexOf('<script>', htmlContent.lastIndexOf(lines.slice(0, idx).join('\n')))
            });
        }
    });

    return { scripts, cssLinks, inlineScripts };
}

/**
 * Generate optimized bundle: keep early scripts separate,
 * concatenate others (except CSS which bundles separately)
 */
function bundleJavaScript() {
    log('Reading index.html...');
    const htmlContent = readFile(INDEX_HTML);
    const { scripts } = parseIndexHtml(htmlContent);

    const earlyScripts = [];
    const bundledScripts = [];

    scripts.forEach(script => {
        if (EARLY_SCRIPTS.some(es => script.endsWith(es))) {
            earlyScripts.push(script);
        } else {
            bundledScripts.push(script);
        }
    });

    log(`Found ${scripts.length} script tags (${earlyScripts.length} early, ${bundledScripts.length} for bundling)`);

    // Read and concatenate bundled scripts
    // NOTE: No timestamp in bundle content — it makes the hash non-deterministic
    // which causes hash mismatches between build and start on platforms like Render
    let bundleContent = '/* Matrix Spins Casino - Bundled JavaScript */\n\n';

    bundledScripts.forEach((script, idx) => {
        const filePath = path.join(ROOT_DIR, script);
        const content = readFile(filePath);

        if (content) {
            bundleContent += `\n/* --- ${script} (${idx + 1}/${bundledScripts.length}) --- */\n`;
            bundleContent += content;

            // Ensure scripts end with newline
            if (!bundleContent.endsWith('\n')) {
                bundleContent += '\n';
            }
        }
    });

    // Calculate hash and create filename
    const hash = contentHash(bundleContent);
    const bundleFileName = `bundle.${hash}.js`;
    const bundlePath = path.join(DIST_DIR, bundleFileName);

    // Write bundled JavaScript
    ensureDir(DIST_DIR);
    fs.writeFileSync(bundlePath, bundleContent, 'utf8');
    log(`Created bundle: ${bundleFileName} (${(bundleContent.length / 1024).toFixed(2)} KB)`);

    // Write early scripts (keep in original location references)
    const earlyScriptRefs = earlyScripts.map(script => ({
        script,
        content: readFile(path.join(ROOT_DIR, script))
    }));

    return {
        earlyScripts: earlyScriptRefs,
        bundleFile: bundleFileName,
        bundleContent: bundleContent.length
    };
}

/**
 * Bundle CSS files
 */
function bundleCSS() {
    log('Bundling CSS files...');

    // NOTE: No timestamp — keeps hash deterministic across builds
    let cssContent = '/* Matrix Spins Casino - Bundled Styles */\n\n';

    CSS_FILES.forEach((cssFile, idx) => {
        const filePath = path.join(ROOT_DIR, cssFile);
        const content = readFile(filePath);

        if (content) {
            cssContent += `\n/* --- ${cssFile} (${idx + 1}/${CSS_FILES.length}) --- */\n`;
            cssContent += content;

            if (!cssContent.endsWith('\n')) {
                cssContent += '\n';
            }
        }
    });

    // Calculate hash and create filename
    const hash = contentHash(cssContent);
    const cssFileName = `styles.${hash}.css`;
    const cssPath = path.join(DIST_DIR, cssFileName);

    ensureDir(DIST_DIR);
    fs.writeFileSync(cssPath, cssContent, 'utf8');
    log(`Created CSS bundle: ${cssFileName} (${(cssContent.length / 1024).toFixed(2)} KB)`);

    return {
        cssFile: cssFileName,
        cssContent: cssContent.length
    };
}

/**
 * Generate new index.html that references bundles
 */
function generateDistIndex(jsInfo, cssInfo, originalHtml) {
    log('Generating dist/index.html...');

    const { scripts, cssLinks, inlineScripts } = parseIndexHtml(originalHtml);

    let distHtml = originalHtml;

    // Replace CSS links with bundled CSS (handles both normal and lazy-load link formats)
    CSS_FILES.forEach(cssFile => {
        const regex = new RegExp(`<link[^>]*href=["']${cssFile.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}["'][^>]*>`, 'i');
        distHtml = distHtml.replace(regex, '');
    });

    // All CSS is now in one bundle — insert at the foundation tokens position
    const cssLink = `    <link rel="stylesheet" href="${cssInfo.cssFile}">`;
    const foundationMarker = distHtml.indexOf('<!-- 1. Foundation tokens');
    if (foundationMarker !== -1) {
        distHtml = distHtml.slice(0, foundationMarker) + cssLink + '\n' + distHtml.slice(foundationMarker);
    } else {
        // Fallback: insert before </head>
        const headClosingIndex = distHtml.indexOf('</head>');
        if (headClosingIndex !== -1) {
            distHtml = distHtml.slice(0, headClosingIndex) + cssLink + '\n' + distHtml.slice(headClosingIndex);
        }
    }

    // Replace all script src tags with bundle reference (keep early scripts with cache-busting)
    // Regex accounts for optional cache-busting query strings like ?v=2.0.0
    scripts.forEach(script => {
        const escaped = script.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const scriptTagRegex = new RegExp(`<script\\s+src=["']${escaped}(?:\\?[^"']*)?["']`, 'i');
        const isEarly = EARLY_SCRIPTS.some(es => script.endsWith(es));

        if (!isEarly) {
            // Remove non-early script tags entirely (they're in the bundle)
            // Handle optional attributes like defer, async, type, etc. between src and closing tag
            const fullTagRegex = new RegExp(`<script\\s+src=["']${escaped}(?:\\?[^"']*)?["'][^>]*><\\/script>`, 'i');
            distHtml = distHtml.replace(fullTagRegex, '');
        } else {
            // Add content-hash query string to early scripts for cache busting
            const earlyPath = path.join(ROOT_DIR, script);
            if (fs.existsSync(earlyPath)) {
                const earlyHash = contentHash(fs.readFileSync(earlyPath, 'utf8'));
                const hashedSrc = `${script}?v=${earlyHash}`;
                distHtml = distHtml.replace(scriptTagRegex, (match) => {
                    return match.replace(new RegExp(`${escaped}(?:\\?[^"']*)?`), hashedSrc);
                });
            }
        }
    });
    // Add bundle script reference before body close
    const bodyClosingIndex = distHtml.lastIndexOf('</body>');
    if (bodyClosingIndex !== -1) {
        const bundleScript = `    <script src="${jsInfo.bundleFile}"></script>`;
        distHtml = distHtml.slice(0, bodyClosingIndex) + bundleScript + '\n' + distHtml.slice(bodyClosingIndex);
    }

    // Write dist/index.html
    ensureDir(DIST_DIR);
    // Fix encoding corruption: Render build env can double-encode UTF-8
    distHtml = distHtml.replace(/ï¿½/g, '•');
    distHtml = distHtml.replace(/�/g, '•');
    fs.writeFileSync(path.join(DIST_DIR, 'index.html'), distHtml, 'utf8');
    log('Created dist/index.html');

    return distHtml;
}

/**
 * Copy static assets (manifest.json, favicon.svg, etc.)
 */
function copyStaticAssets() {
    log('Copying static assets...');

    const staticFiles = ['manifest.json', 'favicon.svg', 'sw.js', 'robots.txt', 'sitemap.xml', 'offline.html', 'premium-v3-upgrades.js', 'premium-v2-fixes.js', 'provably-fair.html', 'responsible-gambling.html', 'terms.html', 'privacy.html', 'cookie-policy.html', 'aml.html', 'faq.html', '404.html', 'launch.html', 'affiliates.html', 'referral.html', 'promotions.html', 'wallet.html', 'login.html', 'signup.html', 'leaderboard.html', 'account.html', 'achievements.html', 'vip.html', 'tournaments.html', 'bonus-history.html', 'jackpot-history.html', 'history.html', 'spin-wheel.html', 'unified-ux.css'];

    staticFiles.forEach(file => {
        const src = path.join(ROOT_DIR, file);
        const dst = path.join(DIST_DIR, file);

        if (fs.existsSync(src)) {
            if (file === 'sw.js') {
                // Auto-stamp the SW version with the build time so the activate
                // handler purges stale caches on every deploy. The SW was
                // refactored from `const CACHE_VERSION = <ts>` to
                // `const VERSION = 'vX.Y.Z'`, so we rewrite whichever form is
                // present (the old regex silently no-op'd → caches never bumped).
                let swContent = fs.readFileSync(src, 'utf8');
                const buildVersion = Date.now();
                swContent = swContent
                    .replace(/^const CACHE_VERSION = \d+;/m, 'const CACHE_VERSION = ' + buildVersion + ';')
                    .replace(/^const VERSION = '[^']*';/m, "const VERSION = 'b" + buildVersion + "';");
                fs.writeFileSync(dst, swContent);
                log(`Copied ${file} (VERSION → b${buildVersion})`);
            } else {
                fs.copyFileSync(src, dst);
                log(`Copied ${file}`);
            }
        }
    });

    // Copy early scripts to dist/ so they're served from the hashed dist dir
    EARLY_SCRIPTS.forEach(scriptPath => {
        const src = path.join(ROOT_DIR, scriptPath);
        const dst = path.join(DIST_DIR, scriptPath);
        const dir = path.dirname(dst);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        if (fs.existsSync(src)) {
            fs.copyFileSync(src, dst);
            log(`Copied ${scriptPath}`);
        }
    });

    // Mirror EVERY js/*.js from root → dist/js/.
    //
    // History: this used to only copy STANDALONE_SCRIPTS (a manual whitelist).
    // The non-whitelisted files were assumed to live only inside the bundled
    // bundle.<hash>.min.js, so their dist/js/<name>.js copies could stay stale.
    // But the per-page HTML (promotions, leaderboard, wallet, etc.) loads many
    // of them with explicit <script src="js/X.js"> tags — bypassing the bundle
    // entirely. Edits to root js/notifications.js, js/chat-widget.js,
    // js/analytics.js etc. never reached production for that reason; the live
    // notification panel kept showing 6 hardcoded DEMO_NOTIFICATIONS (with the
    // false "$25,000 prize pool" tournament line) because dist/js/notifications.js
    // was a frozen orphan from a much earlier build.
    //
    // Source of truth is now root js/*.js; dist/js/ is a pure mirror.
    const jsRootDir = path.join(ROOT_DIR, 'js');
    const jsDistDir = path.join(DIST_DIR, 'js');
    if (fs.existsSync(jsRootDir)) {
        if (!fs.existsSync(jsDistDir)) fs.mkdirSync(jsDistDir, { recursive: true });
        const jsFiles = fs.readdirSync(jsRootDir).filter(f => f.endsWith('.js'));
        let copied = 0;
        jsFiles.forEach(file => {
            fs.copyFileSync(path.join(jsRootDir, file), path.join(jsDistDir, file));
            copied++;
        });
        log(`Mirrored ${copied} files: js/ → dist/js/`);
    }

    // Copy standalone CSS files (search.css, cookie-consent.css, age-gate.css, ...)
    // referenced directly by every HTML page via <link rel="stylesheet" href="css/X.css">
    STANDALONE_CSS.forEach(cssPath => {
        const src = path.join(ROOT_DIR, cssPath);
        const dst = path.join(DIST_DIR, cssPath);
        const dir = path.dirname(dst);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        if (fs.existsSync(src)) {
            fs.copyFileSync(src, dst);
            log(`Copied ${cssPath}`);
        } else {
            log(`WARN: standalone CSS missing: ${cssPath}`);
        }
    });

    // Copy HTML directories (games/, categories/) to dist/
    ['games', 'categories', 'images', 'img'].forEach(dir => {
        const srcDir = path.join(ROOT_DIR, dir);
        const dstDir = path.join(DIST_DIR, dir);
        if (fs.existsSync(srcDir)) {
            if (!fs.existsSync(dstDir)) fs.mkdirSync(dstDir, { recursive: true });
            const files = fs.readdirSync(srcDir).filter(f => f.endsWith('.html') || f.endsWith('.png') || f.endsWith('.svg') || f.endsWith('.jpg'));
            files.forEach(file => {
                fs.copyFileSync(path.join(srcDir, file), path.join(dstDir, file));
            });
            log(`Copied ${files.length} files from ${dir}/`);
        }
    });

    // Copy games/_shared/ runtime assets (JS/CSS needed by individual game pages)
    const sharedSrc = path.join(ROOT_DIR, 'games', '_shared');
    const sharedDst = path.join(DIST_DIR, 'games', '_shared');
    if (fs.existsSync(sharedSrc)) {
        if (!fs.existsSync(sharedDst)) fs.mkdirSync(sharedDst, { recursive: true });
        const sharedFiles = fs.readdirSync(sharedSrc);
        sharedFiles.forEach(file => {
            fs.copyFileSync(path.join(sharedSrc, file), path.join(sharedDst, file));
        });
        log(`Copied ${sharedFiles.length} files from games/_shared/`);
    }

    // Copy arcade/ — self-contained HTML mini-games (Snake, Tetris, 2048, etc.)
    const arcadeSrc = path.join(ROOT_DIR, 'arcade');
    const arcadeDst = path.join(DIST_DIR, 'arcade');
    if (fs.existsSync(arcadeSrc)) {
        if (!fs.existsSync(arcadeDst)) fs.mkdirSync(arcadeDst, { recursive: true });
        const arcadeFiles = fs.readdirSync(arcadeSrc).filter(f => /\.(html|css|js|png|svg|webp)$/.test(f));
        arcadeFiles.forEach(file => {
            fs.copyFileSync(path.join(arcadeSrc, file), path.join(arcadeDst, file));
        });
        log(`Copied ${arcadeFiles.length} files from arcade/`);
    }
}

/**
 * Minify a CSS bundle using clean-css
 * Creates styles.<hash>.min.css alongside the unminified version
 */
async function minifyCSS(cssFileName) {
    try {
        const CleanCSS = require('clean-css');
        const cssPath = path.join(DIST_DIR, cssFileName);
        const source = fs.readFileSync(cssPath, 'utf8');

        log(`Minifying ${cssFileName}...`);

        const result = new CleanCSS({
            level: 2,
            compatibility: '*'
        }).minify(source);

        if (result.errors.length > 0) {
            warn(`CSS minification errors: ${result.errors.join(', ')}`);
            return null;
        }

        const minContent = result.styles;
        const minHash = contentHash(minContent);
        const minFileName = `styles.${minHash}.min.css`;
        const minPath = path.join(DIST_DIR, minFileName);

        fs.writeFileSync(minPath, minContent, 'utf8');

        const originalSize = source.length;
        const minSize = minContent.length;
        const savings = ((1 - minSize / originalSize) * 100).toFixed(1);

        log(`Created minified CSS: ${minFileName} (${(minSize / 1024).toFixed(2)} KB, ${savings}% smaller)`);

        return { minFile: minFileName, originalSize, minSize, savings };
    } catch (err) {
        console.error(`[BUNDLE] FATAL: CSS minification failed (clean-css missing or broken): ${err.message}`);
        console.error('[BUNDLE]   Fix: npm install --save-dev clean-css');
        process.exit(1);
    }
}

/**
 * Minify a JavaScript bundle using terser
 * Creates bundle.<hash>.min.js alongside the unminified version
 */
async function minifyBundle(bundleFileName) {
    try {
        const { minify } = require('terser');
        const bundlePath = path.join(DIST_DIR, bundleFileName);
        const source = fs.readFileSync(bundlePath, 'utf8');

        log(`Minifying ${bundleFileName}...`);

        const result = await minify(source, {
            compress: {
                dead_code: true,
                drop_console: false, // Keep console for debugging
                passes: 2
            },
            mangle: {
                reserved: ['$', 'jQuery', 'window', 'document']
            },
            output: {
                comments: false
            }
        });

        if (result.error) {
            warn(`Minification failed: ${result.error}`);
            return null;
        }

        const minContent = result.code;
        const minHash = contentHash(minContent);
        const minFileName = `bundle.${minHash}.min.js`;
        const minPath = path.join(DIST_DIR, minFileName);

        fs.writeFileSync(minPath, minContent, 'utf8');

        const originalSize = source.length;
        const minSize = minContent.length;
        const savings = ((1 - minSize / originalSize) * 100).toFixed(1);

        log(`Created minified bundle: ${minFileName} (${(minSize / 1024).toFixed(2)} KB, ${savings}% smaller)`);

        return {
            minFile: minFileName,
            originalSize,
            minSize,
            savings
        };
    } catch (err) {
        console.error(`[BUNDLE] FATAL: JS minification failed (terser missing or broken): ${err.message}`);
        console.error('[BUNDLE]   Fix: npm install --save-dev terser');
        process.exit(1);
    }
}

/**
 * Clean stale bundle files from dist/ before building new ones
 */
function cleanStaleBundles() {
    if (!fs.existsSync(DIST_DIR)) return;
    // Clean old hashed bundles
    const stale = fs.readdirSync(DIST_DIR).filter(f =>
        /^bundle\.[a-f0-9]+(?:\.min)?\.js$/.test(f) ||
        /^styles\.[a-f0-9]+(?:\.min)?\.css$/.test(f)
    );
    // Clean legacy unbundled CSS (now consolidated into the main bundle)
    const legacyCss = ['premium-redesign.css', 'premium-polish.css', 'premium-animations.css',
        'premium-v2-fixes.css', 'premium-v3-upgrades.css', 'studio-chrome.css'];
    legacyCss.forEach(f => {
        const fp = path.join(DIST_DIR, f);
        if (fs.existsSync(fp)) stale.push(f);
    });
    stale.forEach(f => {
        const fp = path.join(DIST_DIR, f);
        if (fs.existsSync(fp)) fs.unlinkSync(fp);
        log(`Cleaned stale: ${f}`);
    });
    if (stale.length > 0) log(`Removed ${stale.length} stale files`);
}

/**
 * Main bundling pipeline
 */
async function main() {
    try {
        log('Starting bundling process...');
        console.log('');

        // Step 0: Clean old bundles to prevent hash collisions
        cleanStaleBundles();

        // Step 1: Bundle JavaScript
        const jsInfo = bundleJavaScript();

        // Step 2: Bundle CSS
        const cssInfo = bundleCSS();

        // Step 3: Read original HTML
        const originalHtml = readFile(INDEX_HTML);

        // Step 4: Generate dist/index.html
        generateDistIndex(jsInfo, cssInfo, originalHtml);

        // Step 5: Copy static assets
        copyStaticAssets();

        // Step 6: Minify JavaScript bundle
        const minInfo = await minifyBundle(jsInfo.bundleFile);

        // Step 7: Minify CSS bundle
        const cssMinInfo = await minifyCSS(cssInfo.cssFile);

        // Step 8: Swap dist/index.html refs to minified versions (smaller payloads)
        if (minInfo || cssMinInfo) {
            const distIndexPath = path.join(DIST_DIR, 'index.html');
            let html = fs.readFileSync(distIndexPath, 'utf8');
            if (minInfo) {
                html = html.replace(jsInfo.bundleFile, minInfo.minFile);
                log(`Swapped JS ref: ${jsInfo.bundleFile} → ${minInfo.minFile}`);
            }
            if (cssMinInfo) {
                html = html.replace(cssInfo.cssFile, cssMinInfo.minFile);
                log(`Swapped CSS ref: ${cssInfo.cssFile} → ${cssMinInfo.minFile}`);
            }
            fs.writeFileSync(distIndexPath, html, 'utf8');
        }

        // Remove unminified bundles from dist/ (saves ~5MB deploy size)
        if (minInfo) {
            const unminJs = path.join(DIST_DIR, jsInfo.bundleFile);
            if (fs.existsSync(unminJs)) { fs.unlinkSync(unminJs); log(`Removed unminified: ${jsInfo.bundleFile}`); }
        }
        if (cssMinInfo) {
            const unminCss = path.join(DIST_DIR, cssInfo.cssFile);
            if (fs.existsSync(unminCss)) { fs.unlinkSync(unminCss); log(`Removed unminified: ${cssInfo.cssFile}`); }
        }

        console.log('');
        log('Bundling complete!');
        log(`JavaScript: ${jsInfo.bundleFile} (${(jsInfo.bundleContent / 1024).toFixed(2)} KB)`);
        if (minInfo) {
            log(`Minified:   ${minInfo.minFile} (${(minInfo.minSize / 1024).toFixed(2)} KB, ${minInfo.savings}% savings)`);
        }
        log(`CSS: ${cssInfo.cssFile} (${(cssInfo.cssContent / 1024).toFixed(2)} KB)`);
        if (cssMinInfo) {
            log(`CSS Min:    ${cssMinInfo.minFile} (${(cssMinInfo.minSize / 1024).toFixed(2)} KB, ${cssMinInfo.savings}% savings)`);
        }
        log(`Output: ${DIST_DIR}/`);

        // Remove unminified bundles from dist/ (saves ~5MB deploy size)
        if (minInfo) {
            const unminJs = path.join(DIST_DIR, jsInfo.bundleFile);
            if (fs.existsSync(unminJs)) { fs.unlinkSync(unminJs); log(`Removed unminified: ${jsInfo.bundleFile}`); }
        }
        if (cssMinInfo) {
            const unminCss = path.join(DIST_DIR, cssInfo.cssFile);
            if (fs.existsSync(unminCss)) { fs.unlinkSync(unminCss); log(`Removed unminified: ${cssInfo.cssFile}`); }
        }

        // Validate — ensure dist/index.html references files that actually exist
        const distIndex = readFile(path.join(DIST_DIR, 'index.html'));
        const jsRef = distIndex.match(/bundle\.[a-f0-9]+(?:\.min)?\.js/);
        const cssRef = distIndex.match(/styles\.[a-f0-9]+(?:\.min)?\.css/);
        const distFiles = fs.readdirSync(DIST_DIR);
        log(`dist/ contains: ${distFiles.filter(f => /\.(js|css)$/.test(f)).join(', ')}`);
        if (jsRef) {
            const jsExists = fs.existsSync(path.join(DIST_DIR, jsRef[0]));
            log(`index.html → ${jsRef[0]} (${jsExists ? 'EXISTS ✓' : 'MISSING ✗'})`);
            if (!jsExists) {
                console.error('[BUNDLE] FATAL: dist/index.html references a JS bundle that does not exist!');
                process.exit(1);
            }
        }
        if (cssRef) {
            const cssExists = fs.existsSync(path.join(DIST_DIR, cssRef[0]));
            log(`index.html → ${cssRef[0]} (${cssExists ? 'EXISTS ✓' : 'MISSING ✗'})`);
            if (!cssExists) {
                console.error('[BUNDLE] FATAL: dist/index.html references a CSS bundle that does not exist!');
                process.exit(1);
            }
        }

        // Post-build hygiene: catch the "unminified slipped through" failure mode.
        // If any minified bundle exists, index.html must reference a minified file
        // and no unminified peer may remain in dist/.
        const hasMinJs  = distFiles.some(f => /^bundle\.[a-f0-9]+\.min\.js$/.test(f));
        const hasMinCss = distFiles.some(f => /^styles\.[a-f0-9]+\.min\.css$/.test(f));
        const unminJsInDist  = distFiles.filter(f => /^bundle\.[a-f0-9]+\.js$/.test(f)  && !/\.min\.js$/.test(f));
        const unminCssInDist = distFiles.filter(f => /^styles\.[a-f0-9]+\.css$/.test(f) && !/\.min\.css$/.test(f));
        if (hasMinJs && unminJsInDist.length > 0) {
            console.error('[BUNDLE] FATAL: unminified JS bundle(s) present alongside minified:', unminJsInDist.join(', '));
            process.exit(1);
        }
        if (hasMinCss && unminCssInDist.length > 0) {
            console.error('[BUNDLE] FATAL: unminified CSS bundle(s) present alongside minified:', unminCssInDist.join(', '));
            process.exit(1);
        }
        if (hasMinJs && jsRef && !/\.min\.js$/.test(jsRef[0])) {
            console.error('[BUNDLE] FATAL: index.html references unminified JS', jsRef[0], 'but .min.js exists');
            process.exit(1);
        }
        if (hasMinCss && cssRef && !/\.min\.css$/.test(cssRef[0])) {
            console.error('[BUNDLE] FATAL: index.html references unminified CSS', cssRef[0], 'but .min.css exists');
            process.exit(1);
        }
        console.log('');

    } catch (err) {
        console.warn('[BUNDLE] Bundling failed:', err.message);
        process.exit(1);
    }
}

main();
