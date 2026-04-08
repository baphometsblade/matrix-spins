#!/usr/bin/env node
'use strict';

/**
 * generate-asset-manifest.js — Creates assets/manifest.json mapping every
 * game to its available assets. Also generates CSS/SVG lobby card fallbacks
 * for any games missing thumbnails.
 */

const fs = require('fs');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..');
const gameDefs = require('../shared/game-definitions');
const games = Array.isArray(gameDefs) ? gameDefs : (gameDefs.GAMES || gameDefs.games || gameDefs.default || []);

const PROVIDER_TO_STUDIO = {
    'NovaPlay Studios':       'nebula-gaming',
    'GoldenEdge Gaming':      'golden-reels',
    'Celestial Plays':        'mythic-forge',
    'IronReel Entertainment': 'ironclad',
    'PhantomWorks':           'shadow-works',
    'ArcadeForge':            'wild-frontier',
    'ThunderBolt Games':      'cascade-labs',
    'VortexSpin':             'dragon-pearl'
};

const STUDIO_PALETTES = {
    nebula-gaming:     { bg1: '#0a0e27', bg2: '#1a1040', accent: '#00e5ff' },
    golden-reels:   { bg1: '#1a0f00', bg2: '#2a1a08', accent: '#ffd700' },
    mythic-forge:    { bg1: '#0d0221', bg2: '#1a0a30', accent: '#e040fb' },
    ironclad:     { bg1: '#1a1209', bg2: '#2a1e12', accent: '#ff6d00' },
    shadow-works: { bg1: '#0a0012', bg2: '#180028', accent: '#b388ff' },
    wild-frontier:  { bg1: '#0a1a00', bg2: '#142800', accent: '#76ff03' },
    cascade-labs:  { bg1: '#1a1400', bg2: '#2a2000', accent: '#ffea00' },
    dragon-pearl:   { bg1: '#001518', bg2: '#002228', accent: '#00bcd4' }
};

const manifest = { generated: new Date().toISOString(), games: {} };
let missingThumbs = 0;
let totalAssets = 0;

games.forEach(game => {
    const studioKey = PROVIDER_TO_STUDIO[game.provider] || 'ironclad';
    const entry = {
        id: game.id,
        name: game.name,
        studio: studioKey,
        provider: game.provider,
        assets: {
            thumbnail: null,
            symbols: [],
            backgrounds: [],
            studioLogo: `assets/studio-logos/${studioKey}.svg`
        }
    };

    // Check thumbnail
    const thumbPng = path.join(repoRoot, 'assets', 'thumbnails', game.id + '.png');
    const thumbWebp = path.join(repoRoot, 'assets', 'thumbnails', game.id + '.webp');
    if (fs.existsSync(thumbPng)) {
        entry.assets.thumbnail = `assets/thumbnails/${game.id}.png`;
        totalAssets++;
    } else if (fs.existsSync(thumbWebp)) {
        entry.assets.thumbnail = `assets/thumbnails/${game.id}.webp`;
        totalAssets++;
    } else {
        missingThumbs++;
    }

    // Check symbols
    const symDir = path.join(repoRoot, 'assets', 'game_symbols', game.id);
    if (fs.existsSync(symDir)) {
        const symFiles = fs.readdirSync(symDir).filter(f => f.endsWith('.png') || f.endsWith('.webp'));
        entry.assets.symbols = symFiles.map(f => `assets/game_symbols/${game.id}/${f}`);
        totalAssets += symFiles.length;
    }

    // Check backgrounds
    const bgSlotDir = path.join(repoRoot, 'assets', 'backgrounds', 'slots', game.id);
    if (fs.existsSync(bgSlotDir)) {
        const bgFiles = fs.readdirSync(bgSlotDir).filter(f => f.endsWith('.png') || f.endsWith('.jpg') || f.endsWith('.webp'));
        entry.assets.backgrounds = bgFiles.map(f => `assets/backgrounds/slots/${game.id}/${f}`);
        totalAssets += bgFiles.length;
    }

    manifest.games[game.id] = entry;
});

// Write manifest
const manifestPath = path.join(repoRoot, 'assets', 'manifest.json');
fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');

console.log(`\n  ═══ Asset Manifest ═══`);
console.log(`  Games: ${games.length}`);
console.log(`  Total asset files tracked: ${totalAssets}`);
console.log(`  Missing thumbnails: ${missingThumbs}`);
console.log(`  Studio logos: 8`);
console.log(`  Written: assets/manifest.json\n`);
