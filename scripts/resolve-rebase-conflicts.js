#!/usr/bin/env node
/* Resolve rebase conflicts where both sides simply ADDED script tags.
   We want to keep ALL added scripts from both sides — never drop them. */
'use strict';
const fs = require('fs');
const path = require('path');

const FILES = [
    'achievements.html', 'affiliates.html', 'bonus-history.html',
    'history.html', 'jackpot-history.html', 'login.html',
    'signup.html', 'tournaments.html', 'vip.html'
];

const ROOT = path.resolve(__dirname, '..');
const RE = /<<<<<<< HEAD\r?\n([\s\S]*?)\r?\n=======\r?\n([\s\S]*?)\r?\n>>>>>>> [^\n]*\r?\n/g;

let total = 0;
for (const f of FILES) {
    const fp = path.join(ROOT, f);
    let html = fs.readFileSync(fp, 'utf8');
    const orig = html;
    html = html.replace(RE, (_m, head, ours) => head + '\n' + ours + '\n');
    if (html !== orig) {
        fs.writeFileSync(fp, html);
        console.log('resolved:', f);
        total++;
    }
}
console.log(`\nResolved ${total}/${FILES.length} files.`);
