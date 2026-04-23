'use strict';
// Scan the built bundle for any asset-like path references.
const fs = require('fs');
const dist = fs.readdirSync('dist');
const bundle = dist.find(f => /^bundle\..*\.js$/.test(f));
if (!bundle) { console.error('no bundle found in dist/'); process.exit(1); }
const src = fs.readFileSync('dist/' + bundle, 'utf8');
const re = /["'`]((?:\/|\.\.?\/)?(?:assets|images|img|icons|thumbnails|symbols|backgrounds|audio|sound|fonts)\/[A-Za-z0-9_./{}-]+\.(?:png|webp|jpe?g|gif|svg|mp3|wav|ogg|woff2?|ttf|otf))["'`]/g;
const urls = new Set();
let m;
while ((m = re.exec(src)) != null) urls.add(m[1]);
const list = [...urls].sort();
console.log('total unique runtime asset paths referenced from the bundle:', list.length);
list.forEach(u => console.log('  ' + u));
