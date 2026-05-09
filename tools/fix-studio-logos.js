// Fix broken studio-logo refs across all games/*.html pages.
// 'assets/studios/<slug>-logo.png' -> 'assets/studio-logos/<slug>.svg'
// Adjusts mismatched slugs (e.g. ironclad-entertainment-logo -> ironclad).
'use strict';
const fs = require('fs');
const path = require('path');

const MAP = {
  'cascade-labs-logo.png':            'cascade-labs.svg',
  'dragon-pearl-logo.png':            'dragon-pearl.svg',
  'golden-reels-logo.png':            'golden-reels.svg',
  'ironclad-entertainment-logo.png':  'ironclad.svg',
  'mythic-forge-logo.png':            'mythic-forge.svg',
  'nebula-gaming-logo.png':           'nebula-gaming.svg',
  'shadow-works-logo.png':            'shadow-works.svg',
  'wild-frontier-logo.png':           'wild-frontier.svg',
};

const dir = 'games';
let touched = 0;
for (const f of fs.readdirSync(dir)) {
  if (!f.endsWith('.html')) continue;
  const p = path.join(dir, f);
  let c = fs.readFileSync(p, 'utf8');
  let dirty = false;
  for (const [bad, good] of Object.entries(MAP)) {
    const before = c;
    c = c.split('assets/studios/' + bad).join('assets/studio-logos/' + good);
    if (c !== before) dirty = true;
  }
  if (dirty) {
    fs.writeFileSync(p, c);
    touched++;
  }
}
console.log('Updated', touched, 'game pages.');
