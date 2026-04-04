const fs = require('fs');
let code = fs.readFileSync('C:/created games/Casino/js/ultra-premium-slot.js', 'utf8');

// Find the CSS array: s.textContent = [...].join('\n');
const startMarker = "s.textContent = [";
const startIdx = code.indexOf(startMarker);
if (startIdx === -1) { console.log("ERROR: CSS array not found"); process.exit(1); }

// Find matching ].join
let depth = 0;
let endIdx = -1;
for (let i = startIdx + startMarker.length - 1; i < code.length; i++) {
  if (code[i] === '[') depth++;
  if (code[i] === ']') { depth--; if (depth === 0) { endIdx = i; break; } }
}

const arrayStr = code.substring(startIdx + startMarker.length, endIdx);
console.log("Found CSS array, " + arrayStr.length + " chars");

// Split into individual entries, clean each one
const lines = arrayStr.split('\n');
const cleaned = [];
let currentEntry = '';

for (const line of lines) {
  const trimmed = line.trim();
  if (!trimmed) continue;
  
  // Accumulate the line
  currentEntry += (currentEntry ? '\n' : '') + trimmed;
  
  // Check if the entry is complete (balanced quotes)
  let inStr = false;
  let quoteCount = 0;
  for (const ch of currentEntry) {
    if (ch === "'" && (quoteCount === 0 || inStr)) { 
      inStr = !inStr; 
      quoteCount++;
    }
  }
  
  if (!inStr && quoteCount >= 2) {
    // Extract just the string content between first and last quotes
    const firstQ = currentEntry.indexOf("'");
    const lastQ = currentEntry.lastIndexOf("'");
    if (firstQ !== -1 && lastQ > firstQ) {
      const content = currentEntry.substring(firstQ + 1, lastQ);
      cleaned.push("      '" + content + "'");
    }
    currentEntry = '';
  }
}

console.log("Extracted " + cleaned.length + " CSS entries");

// Rebuild the array
const newArray = cleaned.join(',\n');
const before = code.substring(0, startIdx + startMarker.length) + '\n';
const after = '\n    ' + code.substring(endIdx);
const newCode = before + newArray + after;

fs.writeFileSync('C:/created games/Casino/js/ultra-premium-slot.js', newCode, 'utf8');
console.log("Written fixed file");
