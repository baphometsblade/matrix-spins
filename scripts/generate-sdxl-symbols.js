#!/usr/bin/env node
'use strict';

/**
 * SDXL HD Symbol Generator via local Fooocus API.
 *
 * Generates a 256×256 WebP for every symbol of every game — all tiers
 * s1..s5 plus wild and scatter. Uses the per-game symbol name as the
 * subject (e.g. "crystal heart icon", "tomb door icon") so symbols look
 * thematically consistent inside each game's reel.
 *
 * At Lightning performance (~5 s/image) 600 symbols takes ~50 minutes.
 *
 * Usage:
 *   node scripts/generate-sdxl-symbols.js                   # all games
 *   node scripts/generate-sdxl-symbols.js --only=sugar_rush
 *   node scripts/generate-sdxl-symbols.js --force           # overwrite
 *   node scripts/generate-sdxl-symbols.js --perf=Speed
 */

const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const games = require('../shared/game-definitions');

const API_URL = process.env.FOOOCUS_API || 'http://localhost:7865';
const OUT_ROOT = path.join(__dirname, '..', 'assets', 'game_symbols');

const args = process.argv.slice(2);
const onlyArg = args.find(a => a.startsWith('--only='));
const onlyIds = onlyArg ? new Set(onlyArg.slice(7).split(',')) : null;
const perfArg = args.find(a => a.startsWith('--perf='));
const perf = perfArg ? perfArg.slice(7) : 'Lightning';
const FORCE = args.includes('--force');

const NEGATIVE = 'text, letters, words, numbers, watermark, signature, blurry, low quality, deformed, ugly';

const THEME_COLOR = {
    egypt: 'gold and turquoise', fruit: 'bright rainbow', space: 'cyan and purple',
    fantasy: 'magical purple and pink', animals: 'earthy gold and orange',
    asian: 'red and gold', horror: 'blood red and black', australian: 'ochre and green',
    wildcard: 'vibrant colors', halloween: 'orange and purple'
};

function humanize(symbolName) {
    return symbolName
        .replace(/^s\d+_/, '')
        .replace(/^wild_/, '')
        .replace(/^scatter_/, '')
        .replace(/_/g, ' ');
}

function symbolPrompt(game, symName) {
    const subject = humanize(symName);
    const theme = THEME_COLOR[game.themeCategory] || THEME_COLOR.wildcard;
    const isWild = symName.startsWith('wild');
    const isScatter = symName === game.scatterSymbol && !isWild;
    const tierTag = isWild ? 'bright glowing wild, rainbow shimmer, W shield emblem, golden border, '
                  : isScatter ? 'brilliant scatter symbol, radial energy burst, gold frame, star pattern, '
                  : 'polished game icon, glossy 3D rendered, deep bevel, gold rim, ';
    return `masterpiece, hyper-detailed ${subject} ${tierTag}` +
           `${game.name} casino slot symbol, ${theme} color scheme, ` +
           `centered on transparent dark background, strong rim light, 8k, ` +
           `no text, no words, no letters, no signature`;
}

async function postJson(urlPath, body) {
    const res = await fetch(API_URL + urlPath, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
        body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`API ${res.status}: ${(await res.text()).slice(0, 200)}`);
    return res.json();
}

async function fetchBuffer(url) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`fetch ${url}: ${res.status}`);
    return Buffer.from(await res.arrayBuffer());
}

async function generate(prompt) {
    const results = await postJson('/v1/generation/text-to-image', {
        prompt,
        negative_prompt: NEGATIVE,
        aspect_ratios_selection: '896*1152',  // ~4:5 square-ish tall, good for icons
        performance_selection: perf,
        image_number: 1,
        async_process: false,
        style_selections: ['Fooocus V2', 'Fooocus Sharp', 'SAI Enhance'],
    });
    if (!results.length) throw new Error('no result');
    const r = results[0];
    if (r.url)    return fetchBuffer(r.url);
    if (r.base64) return Buffer.from(r.base64, 'base64');
    throw new Error('no url/base64');
}

async function genOne(game, symName) {
    const dir = path.join(OUT_ROOT, game.id);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const outPath = path.join(dir, symName + '.webp');
    if (!FORCE && fs.existsSync(outPath) && fs.statSync(outPath).size > 40000) {
        return { skipped: true };
    }
    const png = await generate(symbolPrompt(game, symName));
    await sharp(png).resize(256, 256, { fit: 'cover' }).webp({ quality: 90 }).toFile(outPath);
    return { ok: true, size: fs.statSync(outPath).size };
}

async function main() {
    console.log(`SDXL Symbol Generator — perf=${perf}, force=${FORCE}`);
    // Ping
    try {
        const r = await fetch(API_URL + '/ping');
        if (!r.ok) throw new Error('ping failed');
    } catch (e) {
        console.error('FATAL: Fooocus API not reachable at ' + API_URL);
        process.exit(1);
    }

    const target = onlyIds ? games.filter(g => onlyIds.has(g.id)) : games;
    // Flatten per-game symbols
    const tasks = [];
    target.forEach(g => {
        const syms = [...(g.symbols || [])];
        if (g.wildSymbol && !syms.includes(g.wildSymbol))       syms.push(g.wildSymbol);
        if (g.scatterSymbol && !syms.includes(g.scatterSymbol)) syms.push(g.scatterSymbol);
        syms.forEach(s => tasks.push({ game: g, symName: s }));
    });
    console.log(`Generating ${tasks.length} symbols across ${target.length} games...`);

    let ok = 0, skip = 0, fail = 0;
    const t0 = Date.now();
    for (let i = 0; i < tasks.length; i++) {
        const { game, symName } = tasks[i];
        const lbl = `[${i+1}/${tasks.length}] ${game.id}/${symName}`.padEnd(48);
        try {
            const r = await genOne(game, symName);
            if (r.skipped) { skip++; process.stdout.write(`${lbl} skip\n`); }
            else { ok++; process.stdout.write(`${lbl} ok (${(r.size/1024).toFixed(0)}KB)\n`); }
        } catch (e) {
            fail++; console.warn(`${lbl} FAIL — ${e.message}`);
        }
    }
    const elapsed = Math.round((Date.now() - t0) / 1000);
    console.log(`\n===== DONE =====\nok=${ok} skip=${skip} fail=${fail} — ${Math.floor(elapsed/60)}m ${elapsed%60}s`);
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });
