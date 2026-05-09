#!/usr/bin/env node
/**
 * One-shot: inject manifest link + pwa-install.js into all public HTML pages
 * that don't already reference them. Idempotent.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SKIP = new Set([
  '404.html',         // standalone error page (already has minimal head)
  'offline.html',     // offline fallback — must work without SW
  'launch.html',      // landing page archive
  'email-sequence.html',
  'admin.html',       // admin dashboard, separate
]);

const PAGES = fs.readdirSync(ROOT)
  .filter(f => f.endsWith('.html') && !SKIP.has(f));

const MANIFEST_LINK = '<link rel="manifest" href="/manifest.json">';
const PWA_SCRIPT = '<script src="/js/pwa-install.js" defer></script>';

let modified = 0;
for (const file of PAGES) {
  const filePath = path.join(ROOT, file);
  let html = fs.readFileSync(filePath, 'utf8');
  let changed = false;

  // Inject manifest link if missing
  if (!/<link[^>]+rel=["']manifest["']/i.test(html)) {
    html = html.replace(
      /(<meta[^>]+name=["']viewport["'][^>]*>)/i,
      `$1\n    ${MANIFEST_LINK}`
    );
    changed = true;
  }

  // Inject pwa-install.js script before </body> if missing
  if (!/pwa-install\.js/.test(html) && /<\/body>/i.test(html)) {
    html = html.replace(
      /(<\/body>)/i,
      `    ${PWA_SCRIPT}\n$1`
    );
    changed = true;
  }

  // Strip any old inline serviceWorker.register('/sw.js') blocks
  html = html.replace(
    /<script>\s*if\s*\(\s*['"]serviceWorker['"]\s+in\s+navigator\s*\)\s*\{[\s\S]*?navigator\.serviceWorker\.register\([^)]*\)[\s\S]*?<\/script>/g,
    () => { changed = true; return ''; }
  );

  if (changed) {
    fs.writeFileSync(filePath, html);
    modified++;
    console.log('  +', file);
  }
}
console.log(`\nInjected PWA tags into ${modified}/${PAGES.length} files`);
