const fs = require('fs');
const raw = fs.readFileSync('C:/created games/Casino/shared/game-definitions-github.js', 'utf8');

// Find all complete game objects using brace matching
const lines = raw.split('\n');
let result = [];
let current = '';
let braceDepth = 0;
let inGame = false;

for (let line of lines) {
  // Check if line starts a new game object
  if (line.match(/\{\s*id:\s*'/) && !inGame) {
    inGame = true;
    current = line;
    // Count braces
    for (let ch of line) {
      if (ch === '{') braceDepth++;
      if (ch === '}') braceDepth--;
    }
    if (braceDepth === 0) {
      result.push(current);
      current = '';
      inGame = false;
    }
    continue;
  }
  
  if (inGame) {
    current += '\n' + line;
    for (let ch of line) {
      if (ch === '{') braceDepth++;
      if (ch === '}') braceDepth--;
    }
    if (braceDepth === 0) {
      result.push(current);
      current = '';
      inGame = false;
    }
    continue;
  }
}

console.log('Found ' + result.length + ' complete game objects');

// Write clean file
let out = '// Shared Game Definitions - used by both server and client\nconst games = [\n';
for (let i = 0; i < result.length; i++) {
  let g = result[i].trim();
  // Ensure trailing comma
  if (!g.endsWith(',')) g += ',';
  out += '    ' + g + '\n';
}
out += '];\n\nif (typeof module !== "undefined") module.exports = games;\n';

fs.writeFileSync('C:/created games/Casino/shared/game-definitions.js', out, 'utf8');
console.log('Written clean file');

// Verify
try {
  delete require.cache[require.resolve('C:/created games/Casino/shared/game-definitions')];
  const games = require('C:/created games/Casino/shared/game-definitions');
  console.log('Loaded: ' + games.length + ' games');
  console.log('First: ' + games[0].id);
  console.log('Last: ' + games[games.length-1].id);
  // Check all have required fields
  let ok = 0, bad = 0;
  for (let g of games) {
    if (g.id && g.name && g.provider && g.symbols) ok++;
    else { bad++; console.log('Bad game:', g); }
  }
  console.log('Valid: ' + ok + ', Invalid: ' + bad);
} catch(e) {
  console.log('PARSE ERROR: ' + e.message);
}
