'use strict';
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
let content = fs.readFileSync(path.join(root, 'shared/chrome-styles.js'), 'utf8');

// Clear require cache
const gdPath = path.join(root, 'shared/game-definitions.js');
delete require.cache[require.resolve(gdPath)];
const g = require(gdPath);
const games = g.GAMES || g.default || g;

const providerToTheme = {
  'Golden Reels Studio': 'goldenreels',
  'Nebula Gaming': 'nebula',
  'Mythic Forge': 'mythicforge',
  'Wild Frontier Games': 'wildfrontier',
  'Shadow Works': 'shadowworks',
  'Dragon Pearl Studios': 'dragonpearl',
  'Ironclad Entertainment': 'ironclad',
  'Cascade Labs': 'cascadelabs'
};

let notFound = [];
let updated = 0;

games.forEach(function(game) {
  const theme = providerToTheme[game.provider];
  if (!theme) {
    console.log('No theme mapping for provider: ' + game.provider);
    return;
  }

  // Look for 'game_id': 'anything' pattern
  const searchStr = "'" + game.id + "':";
  const idx = content.indexOf(searchStr);
  if (idx === -1) {
    notFound.push(game.id);
    return;
  }

  // Find the value part after the colon
  const afterColon = content.substring(idx + searchStr.length);
  const quoteStart = afterColon.indexOf("'");
  const quoteEnd = afterColon.indexOf("'", quoteStart + 1);
  if (quoteStart === -1 || quoteEnd === -1) {
    notFound.push(game.id + ' (parse error)');
    return;
  }

  const oldValue = afterColon.substring(quoteStart + 1, quoteEnd);
  if (oldValue === theme) {
    // Already correct
    updated++;
    return;
  }

  // Replace: find exact position and splice
  const replaceStart = idx + searchStr.length + quoteStart + 1;
  const replaceEnd = idx + searchStr.length + quoteEnd;
  content = content.substring(0, replaceStart) + theme + content.substring(replaceEnd);
  updated++;
});

fs.writeFileSync(path.join(root, 'shared/chrome-styles.js'), content);
console.log('Updated ' + updated + ' mappings');
if (notFound.length > 0) {
  console.log('Not found (' + notFound.length + '): ' + notFound.join(', '));
}

// Verify
delete require.cache[require.resolve(path.join(root, 'shared/chrome-styles.js'))];
const cs = require(path.join(root, 'shared/chrome-styles.js'));
const themeCount = {};
games.forEach(function(game) {
  const style = cs.GAME_CHROME_STYLES[game.id];
  if (!themeCount[style]) themeCount[style] = 0;
  themeCount[style]++;
});
console.log('\nVerification:');
Object.entries(themeCount).sort(function(a, b) { return b[1] - a[1]; }).forEach(function(e) {
  console.log('  ' + e[0] + ': ' + e[1]);
});
console.log('PROVIDER_FULL_THEMES keys:', Object.keys(cs.PROVIDER_FULL_THEMES).join(', '));
