const fs = require('fs');
const path = require('path');

const GAMES_DIR = path.join(__dirname, 'games');
const BASE_URL = 'https://msaart.online/games/';
const OG_IMAGE = 'https://msaart.online/img/og-banner.png';

function filenameToGameName(filename) {
  return filename
    .replace(/\.html$/, '')
    .replace(/-/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase());
}

function buildMetaDescription(gameName) {
  return 'Play ' + gameName + ' slot at Matrix Spins Casino. Free demo with $1,000 credits. Provably fair, instant play, no download required.';
}

// Safe insert-after helper that avoids String.replace $ issues
function insertAfter(html, anchorRegex, newContent) {
  const match = html.match(anchorRegex);
  if (!match) return html;
  const idx = match.index + match[0].length;
  return html.slice(0, idx) + '\n' + newContent + html.slice(idx);
}

function stripOldSeo(html) {
  // Remove full lines containing previously injected (possibly corrupted) SEO tags
  var lines = html.split('\n');
  lines = lines.filter(function(line) {
    var trimmed = line.trim();
    if (/^<meta\s+name=["']description["']/i.test(trimmed)) return false;
    if (/^<link\s+rel=["']canonical["']/i.test(trimmed)) return false;
    if (/^<meta\s+property=["']og:/i.test(trimmed)) return false;
    if (/^<meta\s+name=["']twitter:card["']/i.test(trimmed)) return false;
    if (/^<h1\s+style="position:absolute/.test(trimmed)) return false;
    // Also catch corrupted lines that are just leftover junk like ",000 credits..."
    if (/^,000 credits/.test(trimmed)) return false;
    return true;
  });
  return lines.join('\n');
}

function processFile(filepath) {
  const filename = path.basename(filepath);
  const gameName = filenameToGameName(filename);
  const description = buildMetaDescription(gameName);
  const canonicalUrl = BASE_URL + filename;

  let html = fs.readFileSync(filepath, 'utf8');

  // First strip any old/corrupted injections so we can cleanly re-inject
  const cleanHtml = stripOldSeo(html);
  // Check if the original file (before stripping) already had correct SEO
  const hadDescription = /<meta\s+name=["']description["']/i.test(html);
  const hadCanonical = /<link\s+rel=["']canonical["']/i.test(html);
  const hadOg = /<meta\s+property=["']og:title["']/i.test(html);
  const hadH1 = /<h1[\s>]/i.test(html);

  // Check if any injected content was corrupted or game-container div is missing
  const corrupted = /theme-color.*credits\. Provably/i.test(html) || /summary_large_image">,000/i.test(html);
  const missingGameContainer = !/<div\s+id=["']game-container["']/i.test(html);

  // If all SEO is present, not corrupted, and game-container exists, skip
  if (hadDescription && hadCanonical && hadOg && hadH1 && !corrupted && !missingGameContainer) {
    return false;
  }

  // Work from clean HTML
  html = cleanHtml;
  const themeColorRegex = /(<meta\s+name=["']theme-color["'][^>]*>)/i;

  // Build all SEO tags
  const ogTitle = gameName + ' — Play Free at Matrix Spins Casino';
  const seoBlock = [
    '  <meta name="description" content="' + description + '">',
    '  <link rel="canonical" href="' + canonicalUrl + '">',
    '  <meta property="og:title" content="' + ogTitle + '">',
    '  <meta property="og:description" content="' + description + '">',
    '  <meta property="og:type" content="website">',
    '  <meta property="og:url" content="' + canonicalUrl + '">',
    '  <meta property="og:image" content="' + OG_IMAGE + '">',
    '  <meta name="twitter:card" content="summary_large_image">',
  ].join('\n');

  html = insertAfter(html, themeColorRegex, seoBlock);

  // H1 tag
  if (!/<h1[\s>]/i.test(html)) {
    const h1 = '  <h1 style="position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);border:0">' + gameName + ' — Matrix Spins Casino</h1>';
    html = insertAfter(html, /(<body[^>]*>)/i, h1);
  }

  // Restore game-container div if missing (may have been lost during cleanup)
  if (!/<div\s+id=["']game-container["']/i.test(html)) {
    const gameContainerDiv = '  <div id="game-container" style="width:100%;min-height:100vh;"></div>';
    // Insert after H1 if present, otherwise after body
    if (/<h1[\s>]/i.test(html)) {
      html = insertAfter(html, /(<h1[^>]*>[^<]*<\/h1>)/i, gameContainerDiv);
    } else {
      html = insertAfter(html, /(<body[^>]*>)/i, gameContainerDiv);
    }
  }

  fs.writeFileSync(filepath, html, 'utf8');
  return true;
}

// Main
const files = fs.readdirSync(GAMES_DIR).filter(f => f.endsWith('.html'));
let updated = 0;
let skipped = 0;

for (const file of files) {
  const filepath = path.join(GAMES_DIR, file);
  const wasChanged = processFile(filepath);
  if (wasChanged) {
    updated++;
    console.log('  UPDATED: ' + file);
  } else {
    skipped++;
    console.log('  SKIPPED: ' + file);
  }
}

console.log('\n=== SEO Injection Summary ===');
console.log('  Total files processed: ' + files.length);
console.log('  Updated: ' + updated);
console.log('  Skipped (already had SEO): ' + skipped);
