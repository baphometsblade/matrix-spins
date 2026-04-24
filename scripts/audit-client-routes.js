#!/usr/bin/env node
'use strict';

/**
 * Scan every client JS/HTML file for `/api/<route>` URLs and verify
 * each route is mounted in server/index.js. Catches the "route file
 * exists but was never required" class of bug that hit stripe-checkout
 * and fair.routes this session.
 *
 * Exits non-zero when any client-called route has no server mount.
 */

const fs = require('fs');
const path = require('path');

const files = [];
function walk(dir) {
    if (!fs.existsSync(dir)) return;
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, ent.name);
        if (ent.isDirectory() && !ent.name.startsWith('.') && ent.name !== 'node_modules') walk(full);
        else if (ent.isFile() && (ent.name.endsWith('.js') || ent.name.endsWith('.html'))) files.push(full);
    }
}
walk(path.join(__dirname, '..', 'js'));
walk(path.join(__dirname, '..', 'admin'));
['index.html', 'privacy.html', 'terms.html', 'responsible-gambling.html', 'provably-fair.html', '404.html']
    .forEach(f => {
        const p = path.join(__dirname, '..', f);
        if (fs.existsSync(p)) files.push(p);
    });

const routes = new Set();
const re = new RegExp('["\'`]/api/([a-z0-9_-]+)', 'gi');
for (const f of files) {
    const src = fs.readFileSync(f, 'utf8');
    for (const m of src.matchAll(re)) {
        routes.add(m[1]);
    }
}

const indexSrc = fs.readFileSync(path.join(__dirname, '..', 'server', 'index.js'), 'utf8');
const missing = [];
for (const name of [...routes].sort()) {
    const p = '/api/' + name;
    const quoted = [`'${p}'`, `"${p}"`, `\`${p}\``, `'${p}/`, `"${p}/`, `\`${p}/`];
    const mounted = quoted.some(q => indexSrc.includes(q));
    if (!mounted) missing.push(name);
}

console.log(`\n=== Client → Server Route Audit ===\n`);
console.log(`Scanned ${files.length} client files, found ${routes.size} distinct /api/ route roots.\n`);

if (missing.length === 0) {
    console.log('✅ Every client-called route root has a server mount.');
    process.exit(0);
} else {
    console.log(`🔴 ${missing.length} client-called route(s) with NO server mount:\n`);
    missing.forEach(p => console.log('  /api/' + p));
    console.log('\nThese endpoints will 404 in production.');
    process.exit(1);
}
