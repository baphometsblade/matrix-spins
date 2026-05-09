// One-shot scanner: find asset references in source that don't exist on disk.
// Run with: node tools/asset-audit.js
'use strict';
const fs = require('fs');
const path = require('path');

function walk(dir) {
  let files = [];
  try {
    for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
      if (f.name.startsWith('.') || f.name === 'node_modules' || f.name === 'dist') continue;
      const p = path.join(dir, f.name);
      if (f.isDirectory()) files = files.concat(walk(p));
      else if (/\.(js|css|html)$/.test(f.name)) files.push(p);
    }
  } catch (e) { /* skip */ }
  return files;
}

function findAll(haystack, regex) {
  const out = [];
  let m;
  while ((m = regex.exec(haystack)) !== null) out.push(m);
  return out;
}

const all = walk('.');
const refs = new Map();
const RE = /["'`]((?:assets|images|img|games)\/[^"'`?#\s)]+\.(?:png|jpg|jpeg|svg|webp|gif|ico|mp3|wav))["'`]/gi;
for (const h of all) {
  let c;
  try { c = fs.readFileSync(h, 'utf8'); } catch (e) { continue; }
  for (const m of findAll(c, new RegExp(RE.source, 'gi'))) {
    const url = m[1];
    if (!refs.has(url)) refs.set(url, h);
  }
}
const missing = [];
for (const [r, src] of refs) {
  if (!fs.existsSync(r)) missing.push({ ref: r, src: path.relative('.', src) });
}
console.log('Files scanned:', all.length);
console.log('Total asset refs:', refs.size);
console.log('Missing on disk:', missing.length);
for (const m of missing.slice(0, 60)) console.log('  -', m.ref, '<-', m.src);
if (missing.length > 60) console.log('  ...', missing.length - 60, 'more');
