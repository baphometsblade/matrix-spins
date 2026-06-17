#!/usr/bin/env node
'use strict';

/**
 * Generates a 1200x630 OG banner image for social sharing.
 * Uses the canvas package (optional dependency).
 */

const fs = require('fs');
const path = require('path');

async function createBanner() {
    let createCanvas;
    try {
        ({ createCanvas } = require('canvas'));
    } catch (e) {
        // Fallback: create a minimal valid PNG (1x1 gold pixel, browsers will scale)
        console.log('canvas not available, creating minimal placeholder PNG');
        // Minimal 1200x630 SVG converted to a data approach won't work for og:image
        // Instead create a simple HTML-based approach
        const svgContent = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <defs>
    <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" style="stop-color:#0a0a0a"/>
      <stop offset="100%" style="stop-color:#1a1a2e"/>
    </linearGradient>
    <linearGradient id="gold" x1="0%" y1="0%" x2="100%" y2="0%">
      <stop offset="0%" style="stop-color:#b8860b"/>
      <stop offset="50%" style="stop-color:#ffd700"/>
      <stop offset="100%" style="stop-color:#b8860b"/>
    </linearGradient>
  </defs>
  <rect width="1200" height="630" fill="url(#bg)"/>
  <rect x="40" y="40" width="1120" height="550" rx="20" fill="none" stroke="url(#gold)" stroke-width="3"/>
  <text x="600" y="260" text-anchor="middle" font-family="Georgia,serif" font-size="72" font-weight="bold" fill="url(#gold)">MATRIX SPINS</text>
  <text x="600" y="340" text-anchor="middle" font-family="Arial,sans-serif" font-size="36" fill="#c0c0c0">Premium Online Casino</text>
  <text x="600" y="420" text-anchor="middle" font-family="Arial,sans-serif" font-size="24" fill="#888">100+ Provably Fair Games</text>
  <text x="600" y="560" text-anchor="middle" font-family="Arial,sans-serif" font-size="18" fill="#666">msaart.online</text>
</svg>`;
        // Save SVG version
        const imgDir = path.join(__dirname, '..', 'img');
        if (!fs.existsSync(imgDir)) fs.mkdirSync(imgDir, { recursive: true });
        fs.writeFileSync(path.join(imgDir, 'og-banner.svg'), svgContent);
        console.log('Created img/og-banner.svg (update og:image meta tags to use .svg)');
        return;
    }

    const canvas = createCanvas(1200, 630);
    const ctx = canvas.getContext('2d');

    // Background gradient
    const bgGrad = ctx.createLinearGradient(0, 0, 1200, 630);
    bgGrad.addColorStop(0, '#0a0a0a');
    bgGrad.addColorStop(1, '#1a1a2e');
    ctx.fillStyle = bgGrad;
    ctx.fillRect(0, 0, 1200, 630);

    // Gold border
    const goldGrad = ctx.createLinearGradient(0, 0, 1200, 0);
    goldGrad.addColorStop(0, '#b8860b');
    goldGrad.addColorStop(0.5, '#ffd700');
    goldGrad.addColorStop(1, '#b8860b');
    ctx.strokeStyle = goldGrad;
    ctx.lineWidth = 3;
    ctx.roundRect(40, 40, 1120, 550, 20);
    ctx.stroke();

    // Title
    ctx.textAlign = 'center';
    ctx.fillStyle = '#ffd700';
    ctx.font = 'bold 72px Georgia, serif';
    ctx.fillText('MATRIX SPINS', 600, 260);

    // Subtitle
    ctx.fillStyle = '#c0c0c0';
    ctx.font = '36px Arial, sans-serif';
    ctx.fillText('Premium Online Casino', 600, 340);

    // Tagline
    ctx.fillStyle = '#888888';
    ctx.font = '24px Arial, sans-serif';
    ctx.fillText('100+ Provably Fair Games', 600, 420);

    // URL
    ctx.fillStyle = '#666666';
    ctx.font = '18px Arial, sans-serif';
    ctx.fillText('msaart.online', 600, 560);

    const imgDir = path.join(__dirname, '..', 'img');
    if (!fs.existsSync(imgDir)) fs.mkdirSync(imgDir, { recursive: true });

    const buffer = canvas.toBuffer('image/png');
    fs.writeFileSync(path.join(imgDir, 'og-banner.png'), buffer);
    console.log('Created img/og-banner.png (1200x630)');
}

createBanner().catch(err => {
    console.error('Failed to create OG banner:', err.message);
    process.exit(1);
});
