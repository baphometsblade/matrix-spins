#!/usr/bin/env node

/**
 * Royal Slots Casino - JavaScript & CSS Bundler
 * Concatenates 97+ JS files and 4 CSS files into optimized bundles
 * Generates cache-busted filenames with content-based versioning
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// â”€â”€â”€ Configuration â”€â”€â”€
const ROOT_DIR = path.join(__dirname, '..');
const DIST_DIR = path.join(ROOT_DIR, 'dist');
const INDEX_HTML = path.join(ROOT_DIR, 'index.html');

// Scripts that must remain in <head> (load before everything)
const EARLY_SCRIPTS = [
    'js/maintenance-check.js',
    'js/error-handler.js',
    'js/onclick-polyfill.js'
];

// CSS files to bundle (in order)
const CSS_FILES = [
    'styles.css',
    'visual-overhaul.css',
    'bonus-games.css',
    'mobile-fixes.css',
    'premium-animations.css',
    'slot-layout-fix.css'
];

// â”€â”€â”€ Helper Functions â”€â”€â”€

function log(msg) {
    console.log(`[BUNDLE] ${msg}`);
}

function warn(msg) {
    console.warn(`[BUNDLE] âš ï¸ ${msg}`);
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
        // Extract <script src="...">
        const scriptMatch = line.match(/<script\s+src=["']([^"']+)["']/i);
        if (scriptMatch) {
            scripts.push(scriptMatch[1]);
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
    let bundleContent = '/* Royal Slots Casino - Bundled JavaScript */\n';
    bundleContent += `/* Generated: ${new Date().toISOString()} */\n\n`;

    bundledScripts.forEach((script, idx) => {
        const filePath = path.join(ROOT_DIR, script);
        const content = readFile(filePath);

        if (content) {
            bundleContent += `\n/* â”€â”€â”€ ${script} (${idx + 1}/${bundledScripts.length}) â”€â”€â”€ */\n`;
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
    log(`âœ“ Created bundle: ${bundleFileName} (${(bundleContent.length / 1024).toFixed(2)} KB)`);

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

    let cssContent = '/* Royal Slots Casino - Bundled Styles */\n';
    cssContent += `/* Generated: ${new Date().toISOString()} */\n\n`;

    CSS_FILES.forEach((cssFile, idx) => {
        const filePath = path.join(ROOT_DIR, cssFile);
        const content = readFile(filePath);

        if (content) {
            cssContent += `\n/* â”€â”€â”€ ${cssFile} (${idx + 1}/${CSS_FILES.length}) â”€â”€â”€ */\n`;
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
    log(`âœ“ Created CSS bundle: ${cssFileName} (${(cssContent.length / 1024).toFixed(2)} KB)`);

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

    // Replace CSS links with bundled CSS
    CSS_FILES.forEach(cssFile => {
        const regex = new RegExp(`<link\\s+rel=["']stylesheet["']\\s+href=["']${cssFile.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}["']\\s*>`, 'i');
        distHtml = distHtml.replace(regex, '');
    });

    // Add single CSS link before the last CSS link location (in head)
    const headClosingIndex = distHtml.indexOf('</head>');
    if (headClosingIndex !== -1) {
        const cssLink = `    <link rel="stylesheet" href="${cssInfo.cssFile}">`;
        distHtml = distHtml.slice(0, headClosingIndex) + cssLink + '\n' + distHtml.slice(headClosingIndex);
    }

    // Replace all script src tags with bundle reference (keep early scripts)
    scripts.forEach(script => {
        const scriptTag = `<script src="${script}"></script>`;
        const isEarly = EARLY_SCRIPTS.some(es => script.endsWith(es));

        if (!isEarly) {
            distHtml = distHtml.replace(scriptTag, '');
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
    fs.writeFileSync(path.join(DIST_DIR, 'index.html'), distHtml, 'utf8');
    log(`âœ“ Created dist/index.html`);

    return distHtml;
}

/**
 * Copy static assets (manifest.json, favicon.svg, etc.)
 */
function copyStaticAssets() {
    log('Copying static assets...');

    const staticFiles = ['manifest.json', 'favicon.svg'];

    staticFiles.forEach(file => {
        const src = path.join(ROOT_DIR, file);
        const dst = path.join(DIST_DIR, file);

        if (fs.existsSync(src)) {
            fs.copyFileSync(src, dst);
            log(`âœ“ Copied ${file}`);
        }
    });
}

/**
 * Main bundling pipeline
 */
function main() {
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

        console.log('');
        log('âœ… Bundling complete!');
        log(`JavaScript: ${jsInfo.bundleFile} (${(jsInfo.bundleContent / 1024).toFixed(2)} KB)`);
        log(`CSS: ${cssInfo.cssFile} (${(cssInfo.cssContent / 1024).toFixed(2)} KB)`);
        log(`Output: ${DIST_DIR}/`);
        console.log('');

    } catch (err) {
        console.warn('[BUNDLE] âŒ Bundling failed:', err.message);
        process.exit(1);
    }
}

main();

