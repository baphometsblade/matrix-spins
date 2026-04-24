#!/usr/bin/env node
'use strict';

/**
 * SDXL HD Asset Generator via local Fooocus API.
 *
 * Generates real AI artwork (SDXL / juggernautXL) for every game in the
 * catalog:
 *   - 1 thumbnail  (1152×896 → downscaled to 400×300 WebP)
 *   - 1 background (1408×704 → downscaled to 1920×1080 WebP)
 *
 * Usage:
 *   node scripts/generate-sdxl-assets.js                 # all games, thumb+bg
 *   node scripts/generate-sdxl-assets.js --thumbs        # only thumbnails
 *   node scripts/generate-sdxl-assets.js --backgrounds   # only backgrounds
 *   node scripts/generate-sdxl-assets.js --only=sugar_rush,wolf_gold
 *   node scripts/generate-sdxl-assets.js --force         # regenerate existing
 *   node scripts/generate-sdxl-assets.js --perf=Speed    # Lightning|Speed|Quality
 *
 * Requires Fooocus-API running locally on http://localhost:7865.
 * Skips any game whose target file already exists unless --force.
 */

const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const games = require('../shared/game-definitions');

const API_URL = process.env.FOOOCUS_API || 'http://localhost:7865';
const REPO_ROOT = path.join(__dirname, '..');
const THUMB_DIR = path.join(REPO_ROOT, 'assets', 'thumbnails');
const BG_DIR    = path.join(REPO_ROOT, 'assets', 'backgrounds', 'slots');

// Args
const args = process.argv.slice(2);
const onlyArg = args.find(a => a.startsWith('--only='));
const onlyIds = onlyArg ? new Set(onlyArg.slice(7).split(',')) : null;
const perfArg = args.find(a => a.startsWith('--perf='));
const perf = perfArg ? perfArg.slice(7) : 'Speed'; // Lightning | Speed | Quality
const FORCE = args.includes('--force');
const DO_THUMBS = !args.includes('--backgrounds') || args.includes('--thumbs');
const DO_BACKGROUNDS = !args.includes('--thumbs')  || args.includes('--backgrounds');

if (!fs.existsSync(THUMB_DIR)) fs.mkdirSync(THUMB_DIR, { recursive: true });
if (!fs.existsSync(BG_DIR))    fs.mkdirSync(BG_DIR,    { recursive: true });

// ───────────────────────── Theme keywords ─────────────────────────
const THEME_KEYWORDS = {
    egypt:      'ancient Egyptian, golden treasures, pyramids, hieroglyphs, pharaoh, sand desert, warm gold tones',
    fruit:      'vibrant fresh fruit, glossy cherries, oranges, grapes, watermelons, sweet treats, bright colorful',
    space:      'cosmic nebula, starfield, space stations, galaxies, cyan and purple glow, sci-fi futurist',
    fantasy:    'magical enchanted realm, mystical crystals, sparkles, fairy tale, purple magic aura, ethereal glow',
    animals:    'wild jungle animals, predatory gaze, lush jungle, safari, National Geographic photography',
    asian:      'oriental dragon, asian temple, cherry blossoms, red gold tones, martial arts elegance',
    horror:     'gothic horror, haunted, dark moody, blood red, eerie moonlight, mysterious fog',
    australian: 'australian outback, kangaroo, aboriginal art, red dust, golden sunset, eucalyptus',
    wildcard:   'generic casino luxury, premium glamour, gold and neon accents',
    halloween:  'halloween spooky, pumpkins, bats, witches, orange purple, haunted graveyard',
};

// ───────────────────────── Prompt builders ─────────────────────────
function themeKW(game) {
    return THEME_KEYWORDS[game.themeCategory] || THEME_KEYWORDS[game.theme] || THEME_KEYWORDS.wildcard;
}

function thumbnailPrompt(game) {
    const kw = themeKW(game);
    // Fooocus handles promotional art style well for slot games.
    return `masterpiece, ${game.name} casino slot machine promotional key art, ` +
           `${kw}, centered hero composition, glowing rim lighting, ` +
           `ornate golden frame, rich vibrant colors, ultra-detailed, 8k, ` +
           `dramatic cinematic lighting, no text, no words, no letters, no signature`;
}

function backgroundPrompt(game) {
    const kw = themeKW(game);
    // Backgrounds sit behind the reels — dark edges, negative-space center.
    return `cinematic ${game.name} ambient background landscape, ${kw}, ` +
           `wide panoramic view, dark vignette edges, empty blurred center ` +
           `for game reels to sit on top, atmospheric depth of field, ` +
           `moody lighting, rich colors, no text, no words, no letters`;
}

const NEGATIVE_PROMPT = 'text, letters, words, numbers, watermark, signature, logo, low quality, blurry, deformed, ugly, amateur, nsfw, nudity';

// ───────────────────────── API ─────────────────────────
async function postJson(urlPath, body) {
    const res = await fetch(API_URL + urlPath, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
        body: JSON.stringify(body),
    });
    if (!res.ok) {
        const txt = await res.text();
        throw new Error(`API ${res.status}: ${txt.slice(0, 200)}`);
    }
    return res.json();
}

async function fetchBuffer(url) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`fetch ${url}: ${res.status}`);
    const ab = await res.arrayBuffer();
    return Buffer.from(ab);
}

async function generate(prompt, aspect) {
    const body = {
        prompt,
        negative_prompt: NEGATIVE_PROMPT,
        aspect_ratios_selection: aspect,
        performance_selection: perf,
        image_number: 1,
        async_process: false,
        style_selections: ['Fooocus V2', 'Fooocus Enhance', 'Fooocus Sharp', 'SAI Enhance'],
    };
    const results = await postJson('/v1/generation/text-to-image', body);
    if (!Array.isArray(results) || results.length === 0) {
        throw new Error('no images returned');
    }
    const r = results[0];
    if (r.url) return fetchBuffer(r.url);
    if (r.base64) return Buffer.from(r.base64, 'base64');
    throw new Error('no url/base64 in result');
}

// ───────────────────────── Pipeline ─────────────────────────
async function genThumbnail(game) {
    const outPath = path.join(THUMB_DIR, game.id + '.webp');
    if (!FORCE && fs.existsSync(outPath) && fs.statSync(outPath).size > 30000) {
        return { skipped: true };  // skip if looks HD (>30KB)
    }
    const png = await generate(thumbnailPrompt(game), '1152*896');
    await sharp(png).resize(400, 300, { fit: 'cover' }).webp({ quality: 88 }).toFile(outPath);
    return { ok: true, size: fs.statSync(outPath).size };
}

async function genBackground(game) {
    const outPath = path.join(BG_DIR, game.id + '_bg.webp');
    if (!FORCE && fs.existsSync(outPath) && fs.statSync(outPath).size > 100000) {
        return { skipped: true };
    }
    const png = await generate(backgroundPrompt(game), '1408*704');
    await sharp(png).resize(1920, 1080, { fit: 'cover' }).webp({ quality: 82 }).toFile(outPath);
    return { ok: true, size: fs.statSync(outPath).size };
}

async function ping() {
    try {
        const res = await fetch(API_URL + '/ping');
        if (res.ok) return true;
    } catch (_) { /* unreachable */ }
    return false;
}

async function main() {
    console.log(`SDXL Asset Generator — perf=${perf}, force=${FORCE}, api=${API_URL}`);
    if (!(await ping())) {
        console.error('FATAL: Fooocus API not reachable at ' + API_URL);
        console.error('Start it first: cd C:/Users/markm/FooocusApp && python main.py');
        process.exit(1);
    }
    console.log('API is up.');

    const targetGames = onlyIds ? games.filter(g => onlyIds.has(g.id)) : games;
    console.log(`Target: ${targetGames.length} games × ${(DO_THUMBS ? 1 : 0) + (DO_BACKGROUNDS ? 1 : 0)} asset(s)`);

    const summary = { thumbOk: 0, thumbSkip: 0, thumbFail: 0, bgOk: 0, bgSkip: 0, bgFail: 0 };
    const startTime = Date.now();

    for (let i = 0; i < targetGames.length; i++) {
        const game = targetGames[i];
        const prefix = `[${i+1}/${targetGames.length}] ${game.id.padEnd(24)}`;

        if (DO_THUMBS) {
            try {
                const r = await genThumbnail(game);
                if (r.skipped) { summary.thumbSkip++; process.stdout.write(`${prefix} thumb: skip `); }
                else { summary.thumbOk++; process.stdout.write(`${prefix} thumb: ok (${(r.size/1024).toFixed(0)}KB) `); }
            } catch (e) {
                summary.thumbFail++;
                console.warn(`\n${prefix} thumb: FAIL — ${e.message}`);
            }
        }
        if (DO_BACKGROUNDS) {
            try {
                const r = await genBackground(game);
                if (r.skipped) { summary.bgSkip++; process.stdout.write(`| bg: skip\n`); }
                else { summary.bgOk++; process.stdout.write(`| bg: ok (${(r.size/1024).toFixed(0)}KB)\n`); }
            } catch (e) {
                summary.bgFail++;
                console.warn(`\n${prefix} bg: FAIL — ${e.message}`);
            }
        } else {
            process.stdout.write('\n');
        }
    }

    const elapsed = Math.round((Date.now() - startTime) / 1000);
    console.log('\n===== SUMMARY =====');
    if (DO_THUMBS)      console.log(`Thumbnails:  ${summary.thumbOk} new, ${summary.thumbSkip} skipped, ${summary.thumbFail} failed`);
    if (DO_BACKGROUNDS) console.log(`Backgrounds: ${summary.bgOk} new, ${summary.bgSkip} skipped, ${summary.bgFail} failed`);
    console.log(`Elapsed: ${Math.floor(elapsed/60)}m ${elapsed%60}s`);
}

main().catch(err => {
    console.error('Fatal:', err);
    process.exit(1);
});
