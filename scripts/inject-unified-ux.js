#!/usr/bin/env node
/**
 * Injects unified-ux.css <link> and unified-ux.js <script> into every static HTML
 * page that has a topbar but doesn't already reference unified-ux. Idempotent —
 * safe to run multiple times.
 *
 * Also injects a "History" link into existing topbar nav rows on key pages.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');

const PAGES = [
  'index.html',
  'account.html', 'achievements.html', 'leaderboard.html', 'promotions.html',
  'referral.html', 'tournaments.html', 'vip.html', 'wallet.html',
  'login.html', 'signup.html', 'faq.html', 'affiliates.html', 'launch.html',
  'spin-wheel.html'
];

const CSS_LINK = '<link rel="stylesheet" href="unified-ux.css">';
const JS_SCRIPT = '<script src="js/unified-ux.js" defer></script>';

let updated = 0;
let skipped = 0;

PAGES.forEach(file => {
  const fp = path.join(ROOT, file);
  if (!fs.existsSync(fp)) {
    console.log('  [skip] missing: ' + file);
    skipped++;
    return;
  }
  let html = fs.readFileSync(fp, 'utf8');

  if (html.includes('unified-ux.js')) {
    console.log('  [skip] already wired: ' + file);
    skipped++;
    return;
  }

  // Inject right before </head>
  const headClose = html.lastIndexOf('</head>');
  if (headClose === -1) {
    console.log('  [skip] no </head>: ' + file);
    skipped++;
    return;
  }
  const inject = `${CSS_LINK}\n${JS_SCRIPT}\n`;
  html = html.slice(0, headClose) + inject + html.slice(headClose);

  fs.writeFileSync(fp, html, 'utf8');
  console.log('  [done] ' + file);
  updated++;
});

console.log(`\nUpdated ${updated} files, skipped ${skipped}.`);
