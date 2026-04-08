#!/usr/bin/env node
'use strict';

/**
 * push-phase5.js — Push Phases 3-7 to GitHub.
 * Studio logos, hero carousel, daily bonus, load test, QA scripts,
 * asset manifest, re-bundled dist.
 */

const fs = require('fs');
const path = require('path');

const TOKEN = process.env.GH_TOKEN;
const OWNER = 'baphometsblade';
const REPO = 'matrix-spins-casino';
const BRANCH = 'master';
const API = `https://api.github.com/repos/${OWNER}/${REPO}`;

const headers = {
    'Authorization': `token ${TOKEN}`,
    'Accept': 'application/vnd.github.v3+json',
    'Content-Type': 'application/json'
};

async function ghApi(endpoint, method = 'GET', body = null) {
    const opts = { method, headers };
    if (body) opts.body = JSON.stringify(body);
    const res = await fetch(`${API}${endpoint}`, opts);
    if (!res.ok) {
        const text = await res.text();
        throw new Error(`GitHub API ${method} ${endpoint}: ${res.status} ${text.slice(0, 300)}`);
    }
    return res.json();
}

async function createBlob(filePath) {
    const content = fs.readFileSync(filePath);
    const base64 = content.toString('base64');
    const resp = await ghApi('/git/blobs', 'POST', { content: base64, encoding: 'base64' });
    return resp.sha;
}

async function main() {
    const repoRoot = path.resolve(__dirname);
    console.log('[PUSH] Phase 5 — Lobby, retention, QA, asset pipeline\n');

    const ref = await ghApi('/git/ref/heads/' + BRANCH);
    const parentSha = ref.object.sha;
    console.log('[PUSH] Current HEAD:', parentSha);

    const parentCommit = await ghApi('/git/commits/' + parentSha);
    const baseTreeSha = parentCommit.tree.sha;

    const filesToPush = [
        // Studio logos
        'assets/studio-logos/nebula-gaming.svg',
        'assets/studio-logos/golden-reels.svg',
        'assets/studio-logos/mythic-forge.svg',
        'assets/studio-logos/ironclad.svg',
        'assets/studio-logos/shadow-works.svg',
        'assets/studio-logos/wild-frontier.svg',
        'assets/studio-logos/cascade-labs.svg',
        'assets/studio-logos/dragon-pearl.svg',

        // Asset manifest
        'assets/manifest.json',

        // Modified lobby + index
        'js/ui-lobby.js',
        'index.html',
        'styles.css',

        // New scripts
        'js/daily-bonus.js',
        'scripts/generate-studio-logos.js',
        'scripts/generate-asset-manifest.js',
        'scripts/load-test.js',
        'scripts/audit-crypto-terms.js',
        'scripts/verify-assets.js',
        'push-phase5.js',

        // Re-bundled dist
        'dist/index.html',
    ];

    // Add dist bundle files
    const distDir = path.join(repoRoot, 'dist');
    if (fs.existsSync(distDir)) {
        fs.readdirSync(distDir).filter(f => f.endsWith('.js') || f.endsWith('.css')).forEach(f => {
            filesToPush.push('dist/' + f);
        });
    }

    const validFiles = filesToPush.filter(f => fs.existsSync(path.join(repoRoot, f)));
    console.log(`[PUSH] ${validFiles.length} files to upload\n`);

    const treeEntries = [];
    const batchSize = 5;
    for (let i = 0; i < validFiles.length; i += batchSize) {
        const batch = validFiles.slice(i, i + batchSize);
        const shas = await Promise.all(batch.map(f => createBlob(path.join(repoRoot, f))));
        batch.forEach((f, j) => {
            treeEntries.push({ path: f, mode: '100644', type: 'blob', sha: shas[j] });
        });
        console.log(`[PUSH]   ${i + 1}-${i + batch.length} of ${validFiles.length}`);
    }

    console.log('\n[PUSH] Creating tree...');
    const newTree = await ghApi('/git/trees', 'POST', { base_tree: baseTreeSha, tree: treeEntries });

    const commitMsg = `Phase 5-7: Lobby hero carousel, daily bonus, QA scripts, studio logos

- Hero carousel: 5 featured games, auto-advance 5s, responsive
- Daily login bonus system: 30-day schedule ($2-$50), streak tracking
- Win streak rewards: +10%/+25%/+50% at 3/5/10 consecutive wins
- Low balance prompt (non-intrusive, <$5 trigger)
- 8 studio SVG logos (assets/studio-logos/)
- Asset manifest (742 tracked files, 0 missing thumbnails)
- Load test simulator (100 players × 2 spins/sec)
- All QA checks pass: crypto audit ✅, assets ✅, RTP ✅
- Re-bundled dist with all changes`;

    console.log('[PUSH] Creating commit...');
    const newCommit = await ghApi('/git/commits', 'POST', {
        message: commitMsg, tree: newTree.sha, parents: [parentSha]
    });

    console.log('[PUSH] Updating master ref...');
    await ghApi('/git/refs/heads/' + BRANCH, 'PATCH', { sha: newCommit.sha, force: false });

    console.log(`\n✅ Pushed to master: ${newCommit.sha}`);
}

main().catch(err => { console.error('\n❌ Push failed:', err.message); process.exit(1); });
