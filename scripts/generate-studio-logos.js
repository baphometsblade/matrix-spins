#!/usr/bin/env node
'use strict';

/**
 * generate-studio-logos.js — Creates SVG logos for all 8 fictional studios.
 * Output: assets/studio-logos/[studio-key].svg
 */

const fs = require('fs');
const path = require('path');

const logosDir = path.join(__dirname, '..', 'assets', 'studio-logos');
if (!fs.existsSync(logosDir)) fs.mkdirSync(logosDir, { recursive: true });

const STUDIOS = {
    nebula-gaming: {
        name: 'NovaPlay Studios',
        accent: '#00e5ff',
        secondary: '#7c4dff',
        icon: `<circle cx="24" cy="24" r="16" fill="none" stroke="$A" stroke-width="2"/>
               <circle cx="24" cy="24" r="6" fill="$A"/>
               <line x1="24" y1="4" x2="24" y2="12" stroke="$A" stroke-width="2"/>
               <line x1="24" y1="36" x2="24" y2="44" stroke="$S" stroke-width="2"/>
               <line x1="4" y1="24" x2="12" y2="24" stroke="$A" stroke-width="2"/>
               <line x1="36" y1="24" x2="44" y2="24" stroke="$S" stroke-width="2"/>`,
        font: 'Orbitron'
    },
    golden-reels: {
        name: 'GoldenEdge Gaming',
        accent: '#ffd700',
        secondary: '#b8860b',
        icon: `<polygon points="24,4 30,18 46,18 33,28 38,44 24,34 10,44 15,28 2,18 18,18" fill="$A" opacity="0.9"/>
               <polygon points="24,10 28,20 40,20 31,27 34,38 24,31 14,38 17,27 8,20 20,20" fill="$S"/>`,
        font: 'Playfair Display'
    },
    mythic-forge: {
        name: 'Celestial Plays',
        accent: '#e040fb',
        secondary: '#7c4dff',
        icon: `<circle cx="24" cy="24" r="18" fill="none" stroke="$A" stroke-width="1.5" stroke-dasharray="4 3"/>
               <circle cx="24" cy="24" r="10" fill="none" stroke="$S" stroke-width="1.5"/>
               <circle cx="24" cy="24" r="3" fill="$A"/>
               <circle cx="16" cy="12" r="2" fill="$A" opacity="0.6"/>
               <circle cx="36" cy="16" r="1.5" fill="$S" opacity="0.5"/>
               <circle cx="32" cy="36" r="2" fill="$A" opacity="0.4"/>`,
        font: 'Cinzel Decorative'
    },
    ironclad: {
        name: 'IronReel Ent.',
        accent: '#ff6d00',
        secondary: '#8d6e63',
        icon: `<circle cx="24" cy="24" r="18" fill="none" stroke="$S" stroke-width="3"/>
               <circle cx="24" cy="24" r="12" fill="none" stroke="$A" stroke-width="2"/>
               <rect x="22" y="6" width="4" height="8" rx="1" fill="$A"/>
               <rect x="22" y="34" width="4" height="8" rx="1" fill="$A"/>
               <rect x="6" y="22" width="8" height="4" rx="1" fill="$S"/>
               <rect x="34" y="22" width="8" height="4" rx="1" fill="$S"/>`,
        font: 'Oswald'
    },
    shadow-works: {
        name: 'PhantomWorks',
        accent: '#b388ff',
        secondary: '#4a148c',
        icon: `<path d="M24 6 C12 6 6 16 6 24 C6 36 16 42 24 42 C32 42 42 36 42 24 C42 16 36 6 24 6 Z" fill="$S" opacity="0.5"/>
               <circle cx="18" cy="22" r="3" fill="$A"/>
               <circle cx="30" cy="22" r="3" fill="$A"/>
               <path d="M18 32 Q24 36 30 32" fill="none" stroke="$A" stroke-width="2"/>`,
        font: 'Cinzel'
    },
    wild-frontier: {
        name: 'ArcadeForge',
        accent: '#76ff03',
        secondary: '#00e676',
        icon: `<rect x="8" y="8" width="32" height="32" rx="4" fill="none" stroke="$A" stroke-width="2"/>
               <rect x="14" y="14" width="8" height="8" fill="$A"/>
               <rect x="26" y="14" width="8" height="8" fill="$S"/>
               <rect x="14" y="26" width="8" height="8" fill="$S"/>
               <rect x="26" y="26" width="8" height="8" fill="$A"/>`,
        font: 'Press Start 2P'
    },
    cascade-labs: {
        name: 'ThunderBolt Games',
        accent: '#ffea00',
        secondary: '#ff6d00',
        icon: `<polygon points="28,4 18,22 26,22 20,44 36,20 28,20 32,4" fill="$A"/>
               <polygon points="30,8 22,22 28,22 24,38 34,20 28,20 30,8" fill="$S" opacity="0.6"/>`,
        font: 'Rajdhani'
    },
    dragon-pearl: {
        name: 'VortexSpin',
        accent: '#00bcd4',
        secondary: '#ff4081',
        icon: `<circle cx="24" cy="24" r="18" fill="none" stroke="$A" stroke-width="1.5"/>
               <path d="M24 6 A18 18 0 0 1 42 24" fill="none" stroke="$S" stroke-width="3"/>
               <path d="M42 24 A18 18 0 0 1 24 42" fill="none" stroke="$A" stroke-width="3"/>
               <path d="M24 42 A18 18 0 0 1 6 24" fill="none" stroke="$S" stroke-width="3"/>
               <circle cx="24" cy="24" r="5" fill="$A"/>`,
        font: 'Quicksand'
    }
};

let count = 0;
Object.entries(STUDIOS).forEach(([key, studio]) => {
    const icon = studio.icon
        .replace(/\$A/g, studio.accent)
        .replace(/\$S/g, studio.secondary);

    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 80" width="300" height="80">
  <defs>
    <linearGradient id="grad_${key}" x1="0%" y1="0%" x2="100%" y2="0%">
      <stop offset="0%" style="stop-color:${studio.accent};stop-opacity:1"/>
      <stop offset="100%" style="stop-color:${studio.secondary};stop-opacity:1"/>
    </linearGradient>
  </defs>
  <g transform="translate(8, 16) scale(1)">
    ${icon}
  </g>
  <text x="62" y="48" font-family="${studio.font}, sans-serif" font-size="18" font-weight="700" fill="url(#grad_${key})">${studio.name}</text>
</svg>`;

    fs.writeFileSync(path.join(logosDir, key + '.svg'), svg, 'utf8');
    count++;
});

console.log(`\n  ✅ Generated ${count} studio logo SVGs in assets/studio-logos/\n`);
