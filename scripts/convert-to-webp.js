#!/usr/bin/env node
'use strict';

/**
 * Converts large PNG files (>100KB) in assets/ to WebP format.
 * Keeps original PNGs as fallback. Creates .webp alongside each .png.
 *
 * Idempotent: skips files that already have a .webp counterpart.
 */

const fs = require('fs');
const path = require('path');

const MIN_SIZE = 100 * 1024; // 100KB threshold
const QUALITY = 80;

async function findLargePngs(dir) {
    const results = [];
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            results.push(...await findLargePngs(fullPath));
        } else if (entry.isFile() && entry.name.endsWith('.png')) {
            const stats = fs.statSync(fullPath);
            if (stats.size >= MIN_SIZE) {
                results.push({ path: fullPath, size: stats.size });
            }
        }
    }
    return results;
}

async function main() {
    let sharp;
    try {
        sharp = require('sharp');
    } catch (e) {
        console.error('sharp not available. Install with: npm install sharp');
        console.error('Trying to install...');
        const { execSync } = require('child_process');
        try {
            execSync('npm install sharp --save-dev', { cwd: path.join(__dirname, '..'), stdio: 'inherit' });
            sharp = require('sharp');
        } catch (e2) {
            console.error('Could not install sharp:', e2.message);
            process.exit(1);
        }
    }

    const assetsDir = path.join(__dirname, '..', 'assets');
    const imgDir = path.join(__dirname, '..', 'img');

    console.log('Scanning for large PNGs...');
    const pngs = [
        ...(fs.existsSync(assetsDir) ? await findLargePngs(assetsDir) : []),
        ...(fs.existsSync(imgDir) ? await findLargePngs(imgDir) : []),
    ];

    console.log(`Found ${pngs.length} PNG files over 100KB`);

    let converted = 0, skipped = 0, totalSaved = 0;

    for (const png of pngs) {
        const webpPath = png.path.replace(/\.png$/i, '.webp');

        // Skip if WebP already exists and is non-empty
        if (fs.existsSync(webpPath) && fs.statSync(webpPath).size > 0) {
            skipped++;
            continue;
        }

        try {
            await sharp(png.path)
                .webp({ quality: QUALITY })
                .toFile(webpPath);

            const webpSize = fs.statSync(webpPath).size;
            const saved = png.size - webpSize;
            totalSaved += saved;
            converted++;

            const pctSaved = ((saved / png.size) * 100).toFixed(0);
            const relPath = path.relative(path.join(__dirname, '..'), png.path);
            console.log(`[${converted}] ${relPath}: ${(png.size/1024).toFixed(0)}KB -> ${(webpSize/1024).toFixed(0)}KB (${pctSaved}% saved)`);
        } catch (err) {
            console.warn(`Failed to convert ${png.path}: ${err.message}`);
        }
    }

    console.log(`\nDone!`);
    console.log(`Converted: ${converted}`);
    console.log(`Skipped (already had WebP): ${skipped}`);
    console.log(`Total savings: ${(totalSaved / 1024 / 1024).toFixed(1)} MB`);
}

main().catch(err => {
    console.error('Fatal:', err.message);
    process.exit(1);
});
