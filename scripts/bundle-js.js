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
    'js/eager-thumbs.js'
];

// CSS files to bundle (in order)
const CSS_FILES = [
    'popup-nuke.css',
    'styles.css',
    'visual-overhaul.css',
    'bonus-games.css',
    'mobile-fixes.css',
    'premium-animations.css',
    'slot-layout-fix.css',
    'provider-chrome.css',
    'promo-styles.css'
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
            scripts.push(scriptMatch[1].split('?')[0]);
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
    let bundleContent = '/* Matrix Spins Casino - Bundled JavaScript */\n';
    bundleContent += `/* Generated: ${new Date().toISOString()} */\n\n`;

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

    let cssContent = '/* Matrix Spins Casino - Bundled Styles */\n';
    cssContent += `/* Generated: ${new Date().toISOString()} */\n\n`;

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

    // Add bundled CSS BEFORE premium overrides so premium CSS wins specificity
    const cssLink = `    <link rel="stylesheet" href="${cssInfo.cssFile}">`;
    const premiumMarker = distHtml.indexOf('<!-- 5. Premium overrides');
    if (premiumMarker !== -1) {
        distHtml = distHtml.slice(0, premiumMarker) + cssLink + '\n' + distHtml.slice(premiumMarker);
    } else {
        // Fallback: insert before </head>
        const headClosingIndex = distHtml.indexOf('</head>');
        if (headClosingIndex !== -1) {
            distHtml = distHtml.slice(0, headClosingIndex) + cssLink + '\n' + distHtml.slice(headClosingIndex);
        }
    }

    // Replace all script src tags with bundle reference (keep early scripts)
    // Regex accounts for optional cache-busting query strings like ?v=2.0.0
    scripts.forEach(script => {
        const escaped = script.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const scriptTagRegex = new RegExp(`<script\\s+src=["']${escaped}(?:\\?[^"']*)?["']><\\/script>`, 'i');
        const isEarly = EARLY_SCRIPTS.some(es => script.endsWith(es));

        if (!isEarly) {
            distHtml = distHtml.replace(scriptTagRegex, '');
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
    distHtml = distHtml.replace(/\u00ef\u00bf\u00bd/g, '\u2022');
    distHtml = distHtml.replace(/\ufffd/g, '\u2022');
    fs.writeFileSync(path.join(DIST_DIR, 'index.html'), distHtml, 'utf8');
    log('Created dist/index.html');

    return distHtml;
}

/**
 * Copy static assets (manifest.json, favicon.svg, etc.)
 */
function copyStaticAssets() {
    log('Copying static assets...');

    const staticFiles = ['manifest.json', 'favicon.svg', 'sw.js', 'premium-redesign.css', 'premium-polish.css', 'premium-animations.css', 'premium-v2-fixes.css', 'premium-v3-upgrades.css', 'premium-v3-upgrades.js', 'premium-v2-fixes.js', 'provably-fair.html', 'responsible-gambling.html', 'terms.html', '404.html'];

    staticFiles.forEach(file => {
        const src = path.join(ROOT_DIR, file);
        const dst = path.join(DIST_DIR, file);

        if (fs.existsSync(src)) {
            fs.copyFileSync(src, dst);
            log(`Copied ${file}`);
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
        warn(`CSS minification skipped (clean-css not available): ${err.message}`);
        return null;
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
        warn(`Minification skipped (terser not available): ${err.message}`);
        return null;
    }
}

/**
 * Main bundling pipeline
 */
async function main() {
    try {
        log('Starting bundling process...');
        console.log('');

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
        console.log('');

    } catch (err) {
        console.warn('[BUNDLE] Bundling failed:', err.message);
        process.exit(1);
    }
}

main();
