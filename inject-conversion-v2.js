/**
 * inject-conversion-v2.js — Add social-proof, deposit-urgency, and onboarding
 * to all game pages AND top-level HTML pages that don't have them yet.
 *
 * Usage: node Casino/inject-conversion-v2.js
 * Idempotent: safe to run multiple times.
 */
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const GAMES_DIR = path.join(ROOT, 'games');

// New conversion scripts to inject (use ../ prefix for games/ subdirectory)
const NEW_SCRIPTS_GAMES = [
  '<script src="../js/social-proof.js" defer></script>',
  '<script src="../js/deposit-urgency.js" defer></script>',
  '<script src="../js/onboarding.js" defer></script>',
];

const NEW_SCRIPTS_ROOT = [
  '<script src="js/social-proof.js" defer></script>',
  '<script src="js/deposit-urgency.js" defer></script>',
  '<script src="js/onboarding.js" defer></script>',
];

// Sentinel: if this exists, scripts are already injected
const SENTINEL = 'social-proof.js';

function getAllHtmlFiles(dir) {
  let results = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results = results.concat(getAllHtmlFiles(full));
    } else if (entry.isFile() && entry.name.endsWith('.html')) {
      results.push(full);
    }
  }
  return results;
}

// Process game pages
const gameFiles = getAllHtmlFiles(GAMES_DIR);
let processed = 0, updated = 0, skipped = 0;

for (const filePath of gameFiles) {
  processed++;
  let html = fs.readFileSync(filePath, 'utf8');

  if (html.includes(SENTINEL)) {
    skipped++;
    continue;
  }

  const block = NEW_SCRIPTS_GAMES.join('\n    ');
  html = html.replace('</body>', `    ${block}\n</body>`);
  fs.writeFileSync(filePath, html, 'utf8');
  updated++;
  console.log(`  UPDATED: ${path.relative(ROOT, filePath)}`);
}

console.log(`\n=== Game Pages ===`);
console.log(`Processed: ${processed} | Updated: ${updated} | Skipped: ${skipped}`);

// Process root-level HTML pages (excluding index.html which is done manually)
const SKIP_ROOT = ['index.html', 'admin.html', '404.html'];
const rootFiles = fs.readdirSync(ROOT)
  .filter(f => f.endsWith('.html') && !SKIP_ROOT.includes(f))
  .map(f => path.join(ROOT, f));

// Also include category and blog pages
const EXTRA_DIRS = ['categories', 'blog', 'deposit'];
for (const dir of EXTRA_DIRS) {
  const dirPath = path.join(ROOT, dir);
  if (fs.existsSync(dirPath)) {
    rootFiles.push(...getAllHtmlFiles(dirPath));
  }
}

let rootUpdated = 0, rootSkipped = 0;
for (const filePath of rootFiles) {
  let html = fs.readFileSync(filePath, 'utf8');
  if (html.includes(SENTINEL)) {
    rootSkipped++;
    continue;
  }

  // Determine prefix based on depth
  const relPath = path.relative(ROOT, filePath);
  const depth = relPath.split(path.sep).length - 1;
  const prefix = depth > 0 ? '../'.repeat(depth) : '';

  const scripts = [
    `<script src="${prefix}js/social-proof.js" defer></script>`,
    `<script src="${prefix}js/deposit-urgency.js" defer></script>`,
    `<script src="${prefix}js/onboarding.js" defer></script>`,
  ];
  const block = scripts.join('\n    ');
  html = html.replace('</body>', `    ${block}\n</body>`);
  fs.writeFileSync(filePath, html, 'utf8');
  rootUpdated++;
  console.log(`  UPDATED: ${relPath}`);
}

console.log(`\n=== Root/Category/Blog Pages ===`);
console.log(`Updated: ${rootUpdated} | Skipped: ${rootSkipped}`);
console.log(`\nTotal files modified: ${updated + rootUpdated}`);
