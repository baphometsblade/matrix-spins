#!/usr/bin/env node
'use strict';

/**
 * audit-crypto-terms.js — CI/CD language audit.
 * Scans all player-facing files for prohibited crypto/NFT terminology.
 * Per spec §3: Zero crypto/NFT terminology in player-facing code.
 *
 * Usage: node scripts/audit-crypto-terms.js [--fix]
 * Exit code 0 = clean, 1 = violations found.
 */

const fs = require('fs');
const path = require('path');

// ── Prohibited terms (case-insensitive) ──────────────────────────────
const PROHIBITED = [
    'nft', 'nfts', 'non-fungible', 'non fungible',
    'mint token', 'minting token', 'mint nft',
    'blockchain', 'block chain', 'block-chain',
    'cryptocurrency', 'cryptographic token',
    'web3', 'web 3', 'dapp', 'defi',
    'metamask', 'phantom wallet',
    'ethereum', 'solana', 'mumbai testnet',
    'erc-1155', 'erc1155', 'erc-721', 'erc721', 'erc-20', 'erc20',
    'smart contract', 'smart-contract',
    'token id', 'tokenid', 'token_id',
    'wallet address', 'wallet_address',
    'thirdweb',
    'opensea', 'rarible',
    'gas fee', 'gas fees', 'gas price',
    'on-chain', 'on chain', 'onchain',
    'off-chain', 'off chain', 'offchain',
    'seed phrase', 'mnemonic'
];

// ── False positive patterns (allowed uses) ───────────────────────────
// These regex patterns are ALLOWED even if they contain prohibited terms.
const FALSE_POSITIVE_PATTERNS = [
    /crypto\.subtle/i,           // Web Crypto API
    /crypto\.getRandomValues/i,  // Web Crypto API
    /window\.crypto/i,           // Web Crypto API
    /createElementNS.*polygon/i, // SVG polygon element
    /svg.*polygon/i,             // SVG polygon element
    /viewBox.*polygon/i,         // SVG polygon element
    /<polygon/i,                 // SVG polygon tag
    /polygon\s*points/i,         // SVG polygon points attr
    /_dangerousPatterns/i,       // Security filter definitions
];

// ── Allowed exceptions ───────────────────────────────────────────────
// Files/dirs that are NOT player-facing (backend-only, build scripts, etc.)
const EXCLUDED_DIRS = [
    'node_modules', '.git', 'blockchain', 'server', 'scripts',
    'dist', '.env', 'push', 'package'
];

const EXCLUDED_FILES = [
    'audit-crypto-terms.js',  // this file
    'package.json', 'package-lock.json',
    'push.js', 'push2.js', 'push3.js', 'push4.js', 'push5.js',
    'push6.js', 'push7.js', 'push8.js', 'push9.js', 'push10.js',
    'push11.js', 'push12.js', 'push13.js', 'push14.js', 'push15.js',
    'push16.js', 'push17.js', 'push18.js', 'push18b.js', 'push18c.js',
    'push19.js', 'push22.js', 'push-phase4.js', 'push-phase5.js',
    'casino.db'
];

// Allowed in specific contexts (e.g., terms.html blockchain disclosure is OK per spec §4.3)
const CONTEXT_EXCEPTIONS = {
    'terms.html': ['blockchain', 'on-chain', 'ledger technology']
};

// ── Scanner ──────────────────────────────────────────────────────────
const EXTENSIONS = ['.html', '.js', '.css', '.json', '.md', '.txt'];

function shouldScan(filePath) {
    const rel = path.relative(process.cwd(), filePath);
    const parts = rel.split(path.sep);

    // Skip excluded directories
    for (const dir of EXCLUDED_DIRS) {
        if (parts.some(p => p === dir || p.startsWith(dir + '.'))) return false;
    }

    // Skip excluded files
    const basename = path.basename(filePath);
    if (EXCLUDED_FILES.includes(basename)) return false;

    // Only scan known extensions
    const ext = path.extname(filePath).toLowerCase();
    return EXTENSIONS.includes(ext);
}

function scanFile(filePath) {
    const content = fs.readFileSync(filePath, 'utf8');
    const lines = content.split('\n');
    const basename = path.basename(filePath);
    const exceptions = CONTEXT_EXCEPTIONS[basename] || [];
    const violations = [];

    lines.forEach((line, idx) => {
        const lower = line.toLowerCase();

        for (const term of PROHIBITED) {
            // Skip if this term is allowed in this file's context
            if (exceptions.some(ex => term.includes(ex) || ex.includes(term))) continue;

            // Word-boundary check
            const regex = new RegExp('\\b' + term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'i');
            if (regex.test(line)) {
                // Check against false positive patterns
                if (FALSE_POSITIVE_PATTERNS.some(fp => fp.test(line))) continue;

                violations.push({
                    file: filePath,
                    line: idx + 1,
                    term: term,
                    context: line.trim().substring(0, 120)
                });
            }
        }
    });

    return violations;
}

function walkDir(dir) {
    let files = [];
    try {
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) {
                if (!EXCLUDED_DIRS.includes(entry.name)) {
                    files = files.concat(walkDir(full));
                }
            } else if (entry.isFile()) {
                files.push(full);
            }
        }
    } catch (e) { /* skip unreadable dirs */ }
    return files;
}

// ── Main ─────────────────────────────────────────────────────────────
console.log('\n  ═══ Crypto Term Audit ═══');
console.log(`  Scanning player-facing files for prohibited terminology...\n`);

const rootDir = path.resolve(__dirname, '..');
const allFiles = walkDir(rootDir).filter(shouldScan);
let totalViolations = [];

allFiles.forEach(f => {
    const v = scanFile(f);
    if (v.length) totalViolations = totalViolations.concat(v);
});

if (totalViolations.length === 0) {
    console.log(`  ✅ CLEAN — No prohibited crypto/NFT terms found.`);
    console.log(`  Scanned ${allFiles.length} player-facing files.\n`);
    process.exit(0);
} else {
    console.log(`  ❌ VIOLATIONS FOUND: ${totalViolations.length}\n`);
    totalViolations.forEach(v => {
        const rel = path.relative(rootDir, v.file);
        console.log(`  ${rel}:${v.line} — "${v.term}"`);
        console.log(`    ${v.context}\n`);
    });
    console.log(`  Scanned ${allFiles.length} files, found ${totalViolations.length} violations.`);
    console.log(`  Fix all violations before deploying to production.\n`);
    process.exit(1);
}
