#!/usr/bin/env node
'use strict';

/**
 * generate-adult-slots-2.js — a SECOND mature (18+) collection:
 * "Crimson Velvet Studios". Romance / seduction themes rendered in an
 * ornate Art Nouveau (Mucha / Klimt) aesthetic — deliberately distinct
 * from the Art-Deco "After Dark" collection so the two read as separate
 * curated houses. Tasteful, NOT explicit (the art generator's negative
 * prompt bars nudity/nsfw; the site is already an age-gated 18+ casino).
 *
 * Same proven, idempotent wiring as generate-adult-slots.js:
 *   1. js/game-registry.js  — new 'crimson-velvet' studio + 10 games
 *      (lobby + server slugIndex → immediately playable).
 *   2. games/<id>.html      — live CasinoEngine.init pages.
 *   3. js/casino-engine.js  — +emoji glyphs for new themed symbols.
 *   4. data/game-lore.json  — a lore paragraph per game.
 *   5. data/game-thumbnails.json — id -> ai/<id>.webp.
 *
 * Run:  node scripts/generate-adult-slots-2.js
 * Then: node scripts/generate-slot-art.js --only <id>  (per game)
 *       npm run build
 */

const fs = require('fs');
const path = require('path');
const { writeAtomicFsync, assertSourceShape } = require('./lib/symbol-art-manifest');

const ROOT = path.resolve(__dirname, '..');
const REGISTRY = path.join(ROOT, 'js', 'game-registry.js');
const ENGINE = path.join(ROOT, 'js', 'casino-engine.js');
const GAMES_DIR = path.join(ROOT, 'games');
const LORE = path.join(ROOT, 'data', 'game-lore.json');
const THUMBS = path.join(ROOT, 'data', 'game-thumbnails.json');

const STUDIO = {
    key: 'crimson-velvet',
    name: 'Crimson Velvet Studios',
    specialty: 'Romance & Seduction — Art Nouveau (18+)',
    primary: '#BE123C',
    secondary: '#2A0A1E',
    accent: '#F9A8C4',
    fontFamily: 'Cormorant Garamond, serif',
    description: 'Ornate Art Nouveau romance — candlelit boudoirs, tango fire and moonlit trysts, gilded for adult players.'
};

// Only ids NOT already in SYMBOL_GLYPHS. blossom/fan/lantern/silk already
// exist in the engine's base map (silk → 🎀), so we deliberately omit them
// to avoid duplicate-key shadowing; those symbols render via the originals.
const NEW_GLYPHS = {
    flame: '🔥', gondola: '🛶', letter: '💌', ribbon: '🎀', bouquet: '💐', spade: '♠️'
};

// Symbols LOW→HIGH pay; last two are wild+scatter.
const GAMES = [
    {
        id: 'crimson-boudoir', name: 'Crimson Boudoir', accent: '#E11D48',
        bg: 'linear-gradient(135deg, #2A0A1E 0%, #160512 55%, #E11D48 150%)',
        mechanic: 'Sticky Respins', vol: 'medium', paylines: 20,
        mechanicDesc: 'Candlelit Wilds hold their place for a run of respins behind the boudoir door.',
        symbols: ['candle', 'ribbon', 'pearl', 'rose', 'lips', 'diamond', 'wild', 'scatter'],
        features: ['sticky-wilds', 'respins', 'free-spins'],
        lore: 'Up the narrow stair, behind a door of deep red velvet, the candles never quite go out. Silk pools on the floor and the Wilds settle in to stay — respin after respin, no one is in any hurry to leave.'
    },
    {
        id: 'tango-inferno', name: 'Tango Inferno', accent: '#DC2626',
        bg: 'linear-gradient(135deg, #2A0810 0%, #160408 55%, #DC2626 150%)',
        mechanic: 'Multiplier Wilds', vol: 'high', paylines: 25,
        mechanicDesc: 'Every Wild that joins the dance carries a multiplier — the tango only burns hotter.',
        symbols: ['flame', 'rose', 'wine', 'heart', 'lips', 'gold', 'wild', 'scatter'],
        features: ['multiplier-wilds', 'free-spins', 'wild'],
        lore: 'One rose between the teeth, one breathless step, and the floor catches fire. In the tango there is no holding back — each Wild that cuts in raises the stakes, and the music dares you to keep up.'
    },
    {
        id: 'geishas-secret', name: "Geisha's Secret", accent: '#F472B6',
        bg: 'linear-gradient(135deg, #2A0A22 0%, #160512 55%, #F472B6 150%)',
        mechanic: 'Cascading Wins', vol: 'medium', paylines: 20,
        mechanicDesc: 'Falling blossoms clear winning symbols and cascade fresh ones into the tea house.',
        symbols: ['blossom', 'fan', 'lantern', 'pearl', 'moon', 'gold', 'wild', 'scatter'],
        features: ['cascading-wins', 'free-spins', 'multiplier'],
        lore: 'Behind a paper screen, the most accomplished geisha keeps one secret she has never told. Cherry blossoms drift across the reels, clearing the old to make room for the new, and her smile gives nothing away.'
    },
    {
        id: 'casanovas-venice', name: "Casanova's Venice", accent: '#B8860B',
        bg: 'linear-gradient(135deg, #1A0A22 0%, #0E0512 55%, #B8860B 150%)',
        mechanic: 'Prize Wheel', vol: 'medium', paylines: 30,
        mechanicDesc: 'Collect love letters to spin the Carnival Wheel for romantic riches.',
        symbols: ['gondola', 'mask', 'letter', 'rose', 'wine', 'heart', 'wild', 'scatter'],
        features: ['prize-wheel', 'pick-bonus', 'free-spins'],
        lore: 'In a city built on water and secrets, the greatest seducer of the age leaves a trail of perfumed letters. Collect enough and the carnival wheel turns — every Venetian knows the house of love always pays.'
    },
    {
        id: 'phoenix-passion', name: 'Phoenix Passion', accent: '#F97316',
        bg: 'linear-gradient(135deg, #2A0E08 0%, #160704 55%, #F97316 150%)',
        mechanic: 'Expanding Wilds', vol: 'high', paylines: 25,
        mechanicDesc: 'The Phoenix Wild bursts to fill a reel in flame, reborn richer with every free spin.',
        symbols: ['flame', 'feather', 'heart', 'rose', 'gold', 'crown', 'wild', 'scatter'],
        features: ['expanding-wilds', 'free-spins', 'multiplier'],
        lore: 'Passion, the old stories say, is the only fire that burns hotter for being spent. The phoenix throws herself into the flame and rises gold — her Wild expanding across the reel, reborn more dazzling than before.'
    },
    {
        id: 'diamonds-and-lace', name: 'Diamonds & Lace', accent: '#E5E4E2',
        bg: 'linear-gradient(135deg, #1A1018 0%, #0E080E 55%, #E5E4E2 150%)',
        mechanic: 'Hold & Win', vol: 'medium', paylines: 30,
        mechanicDesc: 'Collect diamonds to trigger Hold & Win — fill the boudoir vault for the grand prize.',
        symbols: ['ribbon', 'pearl', 'champagne', 'diamond', 'gold', 'heart', 'wild', 'scatter'],
        features: ['hold-and-win', 'jackpot', 'free-spins'],
        lore: 'She wears diamonds the way other women wear perfume — carelessly, and to devastating effect. Lock the gems in place and the velvet vault holds its breath, one held symbol at a time, until the safe swings open.'
    },
    {
        id: 'moonlit-tryst', name: 'Moonlit Tryst', accent: '#818CF8',
        bg: 'linear-gradient(135deg, #0E1030 0%, #08081A 55%, #818CF8 150%)',
        mechanic: 'Walking Wilds', vol: 'high', paylines: 25,
        mechanicDesc: 'A Moon Wild steals one reel left each spin, trailing respins through the secret garden.',
        symbols: ['moon', 'rose', 'candle', 'key', 'heart', 'pearl', 'wild', 'scatter'],
        features: ['walking-wilds', 'respins', 'free-spins'],
        lore: 'They meet where the hedges are tallest, only ever by moonlight, only ever in whispers. The Wild slips one reel at a time across the garden — a stolen kiss, a respin, gone before the dawn can tell.'
    },
    {
        id: 'vixen-noir', name: 'Vixen Noir', accent: '#9333EA',
        bg: 'linear-gradient(135deg, #18081E 0%, #0C0410 55%, #9333EA 150%)',
        mechanic: 'Mystery Symbols', vol: 'high', paylines: 20,
        mechanicDesc: 'Smoke-veiled Mystery symbols reveal as one matching icon — who is the lady at the table?',
        symbols: ['spade', 'ace', 'queen', 'cigar', 'goblet', 'diamond', 'wild', 'scatter'],
        features: ['mystery-symbols', 'free-spins', 'multiplier'],
        lore: 'She arrives alone, plays like she has nothing to lose, and leaves with everything. Behind the curl of cigarette smoke the Mystery symbols turn together — by the time you read her hand, the femme fatale is already gone.'
    },
    {
        id: 'carnival-heat', name: 'Carnival Heat', accent: '#EAB308',
        bg: 'linear-gradient(135deg, #2A0A1A 0%, #16050E 55%, #EAB308 150%)',
        mechanic: 'Free Spins Multiplier', vol: 'high', paylines: 30,
        mechanicDesc: 'Each samba encore lifts the multiplier as the carnival parade heats up.',
        symbols: ['feather', 'mask', 'heart', 'lips', 'gold', 'crown', 'wild', 'scatter'],
        features: ['free-spins', 'increasing-multiplier', 'wild'],
        lore: 'Rio after dark: sequins, drums, and a parade that does not sleep. Every samba encore turns the multiplier higher and the feathers fly faster — by midnight the whole avenue is dancing and no one wants the music to stop.'
    },
    {
        id: 'whisper-and-silk', name: 'Whisper & Silk', accent: '#EC4899',
        bg: 'linear-gradient(135deg, #220A1E 0%, #120510 55%, #EC4899 150%)',
        mechanic: 'Increasing Multiplier', vol: 'medium', paylines: 20,
        mechanicDesc: 'Each consecutive win adds to a rising multiplier — desire spoken softly compounds.',
        symbols: ['silk', 'bouquet', 'rose', 'pearl', 'candle', 'heart', 'wild', 'scatter'],
        features: ['increasing-multiplier', 'free-spins', 'wild'],
        lore: 'The most dangerous things are always said quietly. On a bed of silk, with a bouquet wilting sweetly on the nightstand, each win whispers to the next — and the multiplier rises with every secret kept.'
    }
];

function seeded(seedStr) {
    let h = 2166136261;
    for (let i = 0; i < seedStr.length; i++) { h ^= seedStr.charCodeAt(i); h = Math.imul(h, 16777619); }
    return function () { h += 0x6D2B79F5; let t = h; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

function buildWeights(game) {
    const rnd = seeded(game.id);
    const n = game.symbols.length;
    const w = {};
    game.symbols.forEach((sym, i) => {
        const base = 10 - (i * (8.6 / (n - 1)));
        w[sym] = Array.from({ length: 5 }, () => +(base + (rnd() - 0.5) * 0.4).toFixed(4));
    });
    return w;
}

function buildPaytable(game) {
    const pt = {};
    game.symbols.forEach((sym, i) => {
        const p3 = +(2 + i * 1.9).toFixed(0);
        pt[sym] = { '3': p3, '4': +(p3 * 3).toFixed(0), '5': +(p3 * 9).toFixed(0) };
    });
    pt.SCATTER = { '3': 5, '4': 20, '5': 100 };
    return pt;
}

function studioTheme(game) {
    const a = game.accent;
    return {
        id: STUDIO.key, name: STUDIO.name,
        primaryColor: a, secondaryColor: '#6D0E36', accentColor: STUDIO.accent,
        bgGradient: `linear-gradient(135deg, ${STUDIO.secondary} 0%, #0A0308 55%, ${STUDIO.secondary} 100%)`,
        fontFamily: "'Cormorant Garamond', serif", fontFamilyBody: "'EB Garamond', serif",
        chromeStyle: 'custom', logoUrl: '',
        reelBg: '#100410', reelBorder: a, winHighlight: a,
        borderStyle: `3px solid ${a}`, borderRadius: '16px',
        boxShadow: `0 0 32px ${a}55, inset 0 0 22px rgba(0,0,0,0.45)`,
        buttonStyle: `background: linear-gradient(180deg, ${a}, #6D0E36); border-radius: 12px; border: 1px solid ${a}; text-transform: uppercase; letter-spacing: 2px; font-weight: bold;`,
        spinButtonGlow: `0 0 22px ${a}99`
    };
}

function pageHtml(game) {
    const cfg = {
        name: game.name, id: game.id,
        studioTheme: studioTheme(game),
        rtp: 80, volatility: game.vol, mechanic: game.mechanic, mechanicDesc: game.mechanicDesc,
        minBet: 0.2, maxBet: 100, betStep: 0.2,
        reels: 5, rows: 3, paylines: game.paylines,
        symbols: game.symbols, wilds: ['wild'], scatters: ['scatter'],
        symbolWeights: buildWeights(game), paytable: buildPaytable(game),
        freeSpinCount: 10, freeSpinMultiplier: 2
    };
    const desc = `Play ${game.name} — an Art Nouveau romance slot at Matrix Spins Casino. 18+. ${game.mechanic}. Provably fair, instant play.`;
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${game.name} — Matrix Spins Casino</title>
  <meta name="theme-color" content="${game.accent}">
  <meta name="description" content="${desc}">
  <meta name="rating" content="adult">
  <link rel="canonical" href="https://msaart.online/games/${game.id}.html">
  <meta property="og:title" content="${game.name} — Play at Matrix Spins Casino (18+)">
  <meta property="og:description" content="${desc}">
  <meta property="og:type" content="website">
  <meta property="og:url" content="https://msaart.online/games/${game.id}.html">
  <meta property="og:image" content="https://msaart.online/assets/thumbnails/ai/${game.id}.webp">
  <meta name="twitter:card" content="summary_large_image">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@500;600;700&family=EB+Garamond:wght@400;500;600&display=swap" rel="stylesheet">
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    html, body { height: 100%; }
    body { background: #100410; color: #F4E8EE; font-family: 'EB Garamond', serif; overflow-x: hidden; }
  </style>
  <link rel="stylesheet" href="../css/chat-widget.css">
  <link rel="stylesheet" href="../css/notifications.css">
  <link rel="stylesheet" href="../css/age-gate.css">
  <link rel="stylesheet" href="../css/search.css">
  <link rel="stylesheet" href="../css/favorites.css">
  <link rel="stylesheet" href="../css/session-monitor.css">
  <link rel="stylesheet" href="../css/conversion.css">
</head>
<body>
  <h1 style="position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);border:0">${game.name} — Matrix Spins Casino (18+)</h1>
  <div id="game-container" style="width:100%;min-height:100vh;"></div>

  <script src="../js/csrf-helper.js"></script>
  <script src="../js/api-client.js"></script>
  <script src="../js/casino-engine.js"></script>
  <script>
    const gameConfig = ${JSON.stringify(cfg, null, 6).replace(/\n/g, '\n    ')};
    gameConfig.onSound = function(label) { /* sound hooks ready */ };
    CasinoEngine.init('game-container', gameConfig);
  </script>
  <script src="../js/chat-widget.js" defer></script>
  <script src="../js/notifications.js" defer></script>
  <script src="../js/age-gate.js" defer></script>
  <script src="../js/cookie-consent.js" defer></script>
  <script src="../js/search.js" defer></script>
  <script src="../js/favorites.js" defer></script>
  <script src="../js/session-monitor.js" defer></script>
  <script src="../js/sound-manager.js" defer></script>
  <script src="../js/analytics.js" defer></script>
  <script src="../js/email-capture.js" defer></script>
  <script src="../js/conversion.js" defer></script>
  <script src="../js/social-proof.js" defer></script>
  <script src="../js/deposit-urgency.js" defer></script>
  <script src="../js/onboarding.js" defer></script>
</body>
</html>`;
}

function registryObject(game) {
    return `  {
    id: '${game.id}',
    name: ${JSON.stringify(game.name)},
    studio: ${JSON.stringify(STUDIO.name)},
    studioId: '${STUDIO.key}',
    theme: 'After Dark / Romance',
    mechanic: ${JSON.stringify(game.mechanic)},
    mechanicDesc: ${JSON.stringify(game.mechanicDesc)},
    rtp: 80, volatility: '${game.vol}', minBet: 0.2, maxBet: 100, reels: 5, rows: 3, paylines: ${game.paylines},
    symbols: ${JSON.stringify(game.symbols)},
    features: ${JSON.stringify(game.features)}, badges: ['new', 'adult'],
    bgGradient: '${game.bg}',
    thumbnail: 'assets/thumbnails/ai/${game.id}.webp'
  }`;
}

let changed = [];

function updateRegistry() {
    let src = fs.readFileSync(REGISTRY, 'utf8');
    const hasGames = src.includes(`id: '${GAMES[0].id}'`);

    if (!src.includes(`'${STUDIO.key}':`)) {
        const studioBlock = `\n  '${STUDIO.key}': {
    name: '${STUDIO.name}',
    slug: '${STUDIO.key}',
    specialty: ${JSON.stringify(STUDIO.specialty)},
    gameCount: ${GAMES.length},
    colors: {
      primary: '${STUDIO.primary}',
      secondary: '${STUDIO.secondary}',
      accent: '${STUDIO.accent}'
    },
    fontFamily: '${STUDIO.fontFamily}',
    description: ${JSON.stringify(STUDIO.description)}
  },`;
        src = src.replace(/window\.STUDIO_CONFIG\s*=\s*\{/, m => m + studioBlock);
    }

    if (!hasGames) {
        // Robust to any spacing before the array close ("}];", "}\n];", etc.):
        // find the closing ']' of GAME_REGISTRY (the only '];' in the file —
        // STUDIO_CONFIG closes with '};'), then the last object's '}' before it.
        const closeIdx = src.lastIndexOf('];');
        if (closeIdx === -1) throw new Error('Could not find GAME_REGISTRY closing "];"');
        const head = src.slice(0, closeIdx);
        const lastBrace = head.lastIndexOf('}');
        if (lastBrace === -1) throw new Error('Could not find last game object brace');
        const objs = GAMES.map(registryObject).join(',\n');
        src = head.slice(0, lastBrace + 1) + ',\n' + objs + '\n' + src.slice(closeIdx);
    }

    // Pre-write shape assert + atomic fsync'd persist — see generate-adult-slots.js
    // for the full-site-down impact rationale on game-registry.js.
    assertSourceShape(src, {
        label: 'js/game-registry.js',
        minLength: 5000,
        mustContain: ['GAME_REGISTRY'],
        mustEndWith: '];',
    });
    writeAtomicFsync(REGISTRY, Buffer.from(src, 'utf8'));
    changed.push('js/game-registry.js (' + (hasGames ? 'studio only' : '+studio, +' + GAMES.length + ' games') + ')');
}

function updateGlyphs() {
    let src = fs.readFileSync(ENGINE, 'utf8');
    if (src.includes('gondola:')) { console.log('[crimson] engine glyphs already present — skipping'); return; }
    const m = src.match(/const SYMBOL_GLYPHS\s*=\s*\{/);
    if (!m) throw new Error('SYMBOL_GLYPHS not found in casino-engine.js');
    const ins = '\n    // ── Crimson Velvet collection (18+) ──\n    ' +
        Object.entries(NEW_GLYPHS).map(([k, v]) => `${k}: '${v}'`).join(', ') + ',';
    const at = m.index + m[0].length;
    src = src.slice(0, at) + ins + src.slice(at);
    // casino-engine.js is engine-broken radius — see generate-adult-slots.js.
    assertSourceShape(src, {
        label: 'js/casino-engine.js',
        minLength: 10000,
        mustContain: ['SYMBOL_GLYPHS', 'CasinoEngine'],
    });
    writeAtomicFsync(ENGINE, Buffer.from(src, 'utf8'));
    changed.push('js/casino-engine.js (+' + Object.keys(NEW_GLYPHS).length + ' glyphs)');
}

function updatePages() {
    if (!fs.existsSync(GAMES_DIR)) fs.mkdirSync(GAMES_DIR, { recursive: true });
    let n = 0;
    GAMES.forEach(g => {
        const html = pageHtml(g);
        assertSourceShape(html, {
            label: 'games/' + g.id + '.html',
            minLength: 500,
            mustContain: ['CasinoEngine.init'],
        });
        writeAtomicFsync(path.join(GAMES_DIR, g.id + '.html'), Buffer.from(html, 'utf8'));
        n++;
    });
    changed.push(n + ' game pages');
}

// Merge new entries into a JSON manifest and persist atomically.
// See generate-adult-slots.js mergeJson for full rationale — TL;DR: throw
// loudly on a corrupted file instead of silently overwriting with a
// near-empty {} (the data-loss pattern that compounded the symbol-art
// incident), and fsync the staged write before rename so a Windows
// crash-replay can't land the renamed file pointing at whitespace.
function mergeJson(file, addFn) {
    let obj = {};
    if (fs.existsSync(file)) {
        const raw = fs.readFileSync(file, 'utf8');
        try { obj = JSON.parse(raw); }
        catch (e) {
            throw new Error(
                '[crimson] refusing to overwrite unparseable manifest at ' + file +
                ': ' + e.message + '. Run `git checkout ' + path.relative(ROOT, file) +
                '` (or restore from backup) before re-running this script.'
            );
        }
        if (!obj || typeof obj !== 'object' || Array.isArray(obj)) {
            throw new Error('[crimson] manifest is not a plain object: ' + file);
        }
    }
    addFn(obj);
    writeAtomicFsync(file, Buffer.from(JSON.stringify(obj, null, 2) + '\n', 'utf8'));
}

function main() {
    updateRegistry();
    updateGlyphs();
    updatePages();
    mergeJson(LORE, obj => GAMES.forEach(g => { obj[g.id] = g.lore; })); changed.push('data/game-lore.json');
    mergeJson(THUMBS, obj => GAMES.forEach(g => { obj[g.id] = 'ai/' + g.id + '.webp'; })); changed.push('data/game-thumbnails.json');
    console.log('[crimson] done. Changed:\n  - ' + changed.join('\n  - '));
    console.log('[crimson] next: generate thumbnails (--only per id), then npm run build');
}

if (require.main === module) main();
module.exports = { GAMES, STUDIO, NEW_GLYPHS };
