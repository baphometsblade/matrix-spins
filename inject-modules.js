const fs = require('fs');
const path = require('path');

const gamesDir = path.join(__dirname, 'games');

const cssLinks = [
  '<link rel="stylesheet" href="../css/chat-widget.css">',
  '<link rel="stylesheet" href="../css/notifications.css">',
  '<link rel="stylesheet" href="../css/age-gate.css">',
  '<link rel="stylesheet" href="../css/search.css">',
  '<link rel="stylesheet" href="../css/favorites.css">',
  '<link rel="stylesheet" href="../css/session-monitor.css">',
  '<link rel="stylesheet" href="../css/conversion.css">'
];

const jsScripts = [
  '<script src="../js/chat-widget.js" defer></script>',
  '<script src="../js/notifications.js" defer></script>',
  '<script src="../js/age-gate.js" defer></script>',
  '<script src="../js/cookie-consent.js" defer></script>',
  '<script src="../js/search.js" defer></script>',
  '<script src="../js/favorites.js" defer></script>',
  '<script src="../js/session-monitor.js" defer></script>',
  '<script src="../js/sound-manager.js" defer></script>',
  '<script src="../js/analytics.js" defer></script>',
  '<script src="../js/email-capture.js" defer></script>',
  '<script src="../js/conversion.js" defer></script>'
];

const cssBlock = cssLinks.join('\n  ');
const jsBlock = jsScripts.join('\n  ');

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

const files = getAllHtmlFiles(gamesDir);
let processed = 0;
let updated = 0;
let skipped = 0;

for (const filePath of files) {
  processed++;
  let html = fs.readFileSync(filePath, 'utf8');
  let changed = false;

  // Check CSS — use first link as sentinel
  if (!html.includes('chat-widget.css')) {
    html = html.replace('</head>', `  ${cssBlock}\n</head>`);
    changed = true;
  }

  // Check JS — use first script as sentinel
  if (!html.includes('chat-widget.js')) {
    html = html.replace('</body>', `  ${jsBlock}\n</body>`);
    changed = true;
  }

  if (changed) {
    fs.writeFileSync(filePath, html, 'utf8');
    updated++;
    console.log(`  UPDATED: ${path.relative(__dirname, filePath)}`);
  } else {
    skipped++;
    console.log(`  SKIPPED: ${path.relative(__dirname, filePath)}`);
  }
}

console.log(`\n=== Summary ===`);
console.log(`Files processed: ${processed}`);
console.log(`Files updated:   ${updated}`);
console.log(`Files skipped:   ${skipped}`);
