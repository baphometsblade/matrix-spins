#!/usr/bin/env node
'use strict';

/**
 * generate-adult-slots.js — adds a curated 10-game "After Dark" collection:
 * sophisticated, mature (18+) glamour themes — burlesque, VIP nightlife,
 * romance, masquerade, temptation. Tasteful, NOT explicit (the site is
 * already an age-gated 18+ casino; this matches industry "after dark" /
 * showgirl / Playboy-style licensed slots).
 *
 * Wires EVERY surface, idempotently (safe to re-run):
 *   1. js/game-registry.js  — new 'after-dark' studio in STUDIO_CONFIG +
 *      10 game objects appended to GAME_REGISTRY (lobby + server slugIndex,
 *      which makes them immediately PLAYABLE via the spin route).
 *   2. games/<id>.html      — live CasinoEngine.init page per game (same
 *      template the existing 100 pages use), with RTP-tuned symbolWeights
 *      + display paytable.
 *   3. js/casino-engine.js  — adds emoji to SYMBOL_GLYPHS for the new
 *      themed symbol ids so reels render glyphs, not 2-letter codes.
 *   4. data/game-lore.json  — a lore paragraph per game (info modal).
 *   5. data/game-thumbnails.json — id -> ai/<id>.webp (art comes from
 *      generate-slot-art.js, which reads the registry).
 *
 * Run:  node scripts/generate-adult-slots.js
 * Then: node scripts/generate-slot-art.js   (generates the 10 thumbnails)
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

// ── New studio ──────────────────────────────────────────────────────
const STUDIO = {
    key: 'after-dark',
    name: 'After Dark Studios',
    specialty: 'After-Dark Glamour & Romance (18+)',
    primary: '#E11D48',
    secondary: '#1A0A14',
    accent: '#F4C9D6',
    fontFamily: 'Playfair Display, serif',
    description: 'Sophisticated after-dark glamour — burlesque, romance, masquerade and VIP nightlife, crafted for adult players.'
};

// ── New symbol glyphs (only ids not already in SYMBOL_GLYPHS) ────────
const NEW_GLYPHS = {
    martini: '🍸', sax: '🎷', lips: '💋', shell: '🐚', trident: '🔱',
    siren: '🧜‍♀️', rose: '🌹', cocktail: '🍹', stiletto: '👠', champagne: '🍾',
    candle: '🕯️', wine: '🍷', heart: '❤️', vinyl: '💿', disco: '🪩',
    serpent: '🐍', goblet: '🥃', raven: '🐦‍⬛', ace: '🅰️', queen: '👸',
    dice: '🎲', cigar: '🚬', lipstick: '💄'
};

// ── The 10 games. Symbols ordered LOW→HIGH pay; last two are wild+scatter.
// theme 'After Dark / Glamour' drives the lobby gradient grouping and the
// thumbnail art style added to generate-slot-art.js. ───────────────────
const GAMES = [
    {
        id: 'midnight-velvet-club', name: 'Midnight Velvet', accent: '#C9A227',
        bg: 'linear-gradient(135deg, #2A0A3A 0%, #1A0520 55%, #C9A227 140%)',
        mechanic: 'Sticky Wilds', vol: 'medium', paylines: 20,
        mechanicDesc: 'Jazz-club Wilds lock in place for a sultry run of respins, holding through every encore.',
        symbols: ['martini', 'feather', 'pearl', 'sax', 'lips', 'diamond', 'wild', 'scatter'],
        features: ['sticky-wilds', 'free-spins', 'respins'],
        lore: 'Behind an unmarked velvet door, a 1920s speakeasy hums with smoke and saxophone. The house chanteuse holds the room with a single glance — and the reels hold their Wilds just as tightly, locking in place while the band plays one more sultry encore.'
    },
    {
        id: 'siren-song-temptation', name: 'Siren Song', accent: '#2DD4BF',
        bg: 'linear-gradient(135deg, #0A2A3A 0%, #14062A 55%, #2DD4BF 150%)',
        mechanic: 'Expanding Wilds', vol: 'high', paylines: 25,
        mechanicDesc: 'The Siren Wild rises to fill a whole reel, her song pulling every nearby win into the deep.',
        symbols: ['shell', 'trident', 'pearl', 'moon', 'siren', 'rose', 'wild', 'scatter'],
        features: ['expanding-wilds', 'free-spins', 'multiplier'],
        lore: 'Sailors swore the voice came from the moonlit reef — half lullaby, half dare. The Siren never needed force, only temptation: when her Wild surfaces it expands across the reel, and the whole grid leans toward the depths with her.'
    },
    {
        id: 'velvet-rope-vip', name: 'Velvet Rope VIP', accent: '#D4AF37',
        bg: 'linear-gradient(135deg, #14110A 0%, #050403 55%, #D4AF37 150%)',
        mechanic: 'Hold & Win', vol: 'medium', paylines: 30,
        mechanicDesc: 'Collect golden keys to trigger Hold & Win — the more you hold, the deeper into the VIP lounge you go.',
        symbols: ['cocktail', 'key', 'stiletto', 'champagne', 'diamond', 'gold', 'wild', 'scatter'],
        features: ['hold-and-win', 'free-spins', 'jackpot'],
        lore: 'Past the velvet rope, the city falls away and the champagne never stops. A single gold key opens the private lounge; collect enough and the room holds its breath with you, every locked symbol another step toward the top-floor suite.'
    },
    {
        id: 'masquerade-seduction', name: 'Masquerade', accent: '#B8860B',
        bg: 'linear-gradient(135deg, #2A0A14 0%, #14060A 55%, #B8860B 150%)',
        mechanic: 'Mystery Stacks', vol: 'medium', paylines: 20,
        mechanicDesc: 'Masked Mystery symbols reveal as one matching icon across the reels — who is behind the mask?',
        symbols: ['candle', 'feather', 'wine', 'rose', 'mask', 'heart', 'wild', 'scatter'],
        features: ['mystery-symbols', 'free-spins', 'multiplier'],
        lore: 'In a candlelit Venetian palazzo, no one gives their real name. Behind every mask waits a different temptation — and on the reels, masked stacks reveal together, all turning to the same face the moment the music stops.'
    },
    {
        id: 'cherry-lips-cabaret', name: 'Cherry Lips Cabaret', accent: '#E11D48',
        bg: 'linear-gradient(135deg, #2A0510 0%, #140206 55%, #E11D48 150%)',
        mechanic: 'Free Spins Multiplier', vol: 'high', paylines: 25,
        mechanicDesc: 'Every cabaret encore raises the multiplier — the show only gets hotter the longer it runs.',
        symbols: ['cherry', 'feather', 'champagne', 'heart', 'lips', 'crown', 'wild', 'scatter'],
        features: ['free-spins', 'increasing-multiplier', 'wild'],
        lore: 'Red curtains, a kick-line of feathers, and a headliner whose ruby lips could stop traffic. At the Cherry Lips Cabaret each encore lifts the multiplier higher, and the crowd roars for one more number, then one more, then one more.'
    },
    {
        id: 'goddess-of-desire', name: 'Goddess of Desire', accent: '#F472B6',
        bg: 'linear-gradient(135deg, #2A1422 0%, #160A12 55%, #F472B6 150%)',
        mechanic: 'Increasing Multiplier', vol: 'medium', paylines: 20,
        mechanicDesc: 'Aphrodite blesses each consecutive win with a rising multiplier — desire compounds.',
        symbols: ['dove', 'rose', 'pearl', 'apple', 'heart', 'crown', 'wild', 'scatter'],
        features: ['increasing-multiplier', 'free-spins', 'wild'],
        lore: 'Born of sea-foam and longing, the goddess of love rewards the bold. Each win she favours raises the next — a golden apple, a white dove, a rising tide of desire that compounds with every beat of the heart.'
    },
    {
        id: 'neon-temptation', name: 'Neon Temptation', accent: '#22D3EE',
        bg: 'linear-gradient(135deg, #2A0A2A 0%, #120612 55%, #22D3EE 150%)',
        mechanic: 'Walking Wilds', vol: 'high', paylines: 30,
        mechanicDesc: 'Neon Wilds strut one reel left each spin, leaving a trail of respins across the dancefloor.',
        symbols: ['vinyl', 'cocktail', 'disco', 'lips', 'heart', 'diamond', 'wild', 'scatter'],
        features: ['walking-wilds', 'respins', 'free-spins'],
        lore: 'Downtown after midnight, the club is all neon and bass. The Wilds never stand still — they strut one reel at a time across the floor, dropping a respin with every step until the last record spins out.'
    },
    {
        id: 'forbidden-fruit', name: 'Forbidden Fruit', accent: '#DC2626',
        bg: 'linear-gradient(135deg, #0A2A14 0%, #06140A 55%, #DC2626 150%)',
        mechanic: 'Tumble', vol: 'high', paylines: 25,
        mechanicDesc: 'Winning symbols vanish and fresh fruit tumbles in — temptation cascades, win after win.',
        symbols: ['cherry', 'rose', 'apple', 'serpent', 'heart', 'gold', 'wild', 'scatter'],
        features: ['tumble', 'cascading-wins', 'multiplier'],
        lore: 'One bite was all it took. In this garden the fruit is always within reach — winning symbols vanish and more tumble down to take their place, each cascade sweeter and more dangerous than the last.'
    },
    {
        id: 'scarlet-seduction', name: 'Scarlet Seduction', accent: '#B91C1C',
        bg: 'linear-gradient(135deg, #1A0408 0%, #0A0204 55%, #B91C1C 150%)',
        mechanic: 'Expanding Symbol', vol: 'high', paylines: 20,
        mechanicDesc: 'A single chosen symbol expands to cover whole reels in the free-spins moonlight bonus.',
        symbols: ['raven', 'goblet', 'moon', 'rose', 'lips', 'heart', 'wild', 'scatter'],
        features: ['expanding-symbol', 'free-spins', 'multiplier'],
        lore: 'The crimson manor wakes only after dusk. Its host pours a single glass, smiles too long, and the room grows warm — in the moonlit bonus one special symbol swells to fill the reels, an embrace you will not want to leave.'
    },
    {
        id: 'high-roller-after-dark', name: 'High Roller After Dark', accent: '#EAB308',
        bg: 'linear-gradient(135deg, #14110A 0%, #060503 55%, #EAB308 150%)',
        mechanic: 'Coin Respin', vol: 'medium', paylines: 30,
        mechanicDesc: 'Land golden coins to trigger a high-stakes respin — collect the table and the night is yours.',
        symbols: ['ace', 'queen', 'dice', 'champagne', 'diamond', 'cigar', 'wild', 'scatter'],
        features: ['coin-respin', 'hold-and-win', 'jackpot'],
        lore: 'The private salon opens at midnight for those who never ask the price. Cigars, cards and a table that only takes the brave — land the gold coins and the respin holds the whole room until the last chip falls your way.'
    }
];

// ── Deterministic seeded RNG so re-runs produce identical files ──────
function seeded(seedStr) {
    let h = 2166136261;
    for (let i = 0; i < seedStr.length; i++) { h ^= seedStr.charCodeAt(i); h = Math.imul(h, 16777619); }
    return function () { h += 0x6D2B79F5; let t = h; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

// Descending per-reel weights (low-pay symbols common, scatter rare),
// matching the shape of the existing live pages. Display/animation only —
// the server is authoritative for real outcomes.
function buildWeights(game) {
    const rnd = seeded(game.id);
    const n = game.symbols.length;
    const w = {};
    game.symbols.forEach((sym, i) => {
        const base = 10 - (i * (8.6 / (n - 1)));   // 10 → ~1.4 across rank
        w[sym] = Array.from({ length: game.reels || 5 }, () => +(base + (rnd() - 0.5) * 0.4).toFixed(4));
    });
    return w;
}

// Ascending 3/4/5 paytable by symbol rank (display legend).
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
        primaryColor: a, secondaryColor: '#8B0030', accentColor: STUDIO.accent,
        bgGradient: `linear-gradient(135deg, ${STUDIO.secondary} 0%, #0A0308 55%, ${STUDIO.secondary} 100%)`,
        fontFamily: "'Playfair Display', serif", fontFamilyBody: "'Lora', serif",
        chromeStyle: 'custom', logoUrl: '',
        reelBg: '#0D0309', reelBorder: a, winHighlight: a,
        borderStyle: `3px solid ${a}`, borderRadius: '14px',
        boxShadow: `0 0 30px ${a}55, inset 0 0 20px rgba(0,0,0,0.45)`,
        buttonStyle: `background: linear-gradient(180deg, ${a}, #8B0030); border-radius: 10px; border: 1px solid ${a}; text-transform: uppercase; letter-spacing: 2px; font-weight: bold;`,
        spinButtonGlow: `0 0 20px ${a}99`
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
    const desc = `Play ${game.name} — an after-dark glamour slot at Matrix Spins Casino. 18+. ${game.mechanic}. Provably fair, instant play.`;
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
  <meta property="og:image" content="https://msaart.online/${'assets/thumbnails/ai/' + game.id + '.webp'}">
  <meta name="twitter:card" content="summary_large_image">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Lora:wght@400;600;700&family=Playfair+Display:wght@600;700;800&display=swap" rel="stylesheet">
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    html, body { height: 100%; }
    body { background: #0D0309; color: #F0E8EC; font-family: 'Lora', serif; overflow-x: hidden; }
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
    theme: 'After Dark / Glamour',
    mechanic: ${JSON.stringify(game.mechanic)},
    mechanicDesc: ${JSON.stringify(game.mechanicDesc)},
    rtp: 80, volatility: '${game.vol}', minBet: 0.2, maxBet: 100, reels: 5, rows: 3, paylines: ${game.paylines},
    symbols: ${JSON.stringify(game.symbols)},
    features: ${JSON.stringify(game.features)}, badges: ['new', 'adult'],
    bgGradient: '${game.bg}',
    thumbnail: 'assets/thumbnails/ai/${game.id}.webp'
  }`;
}

// ── Mutations ────────────────────────────────────────────────────────
let changed = [];

function updateRegistry() {
    let src = fs.readFileSync(REGISTRY, 'utf8');
    const hasGames = src.includes(`id: '${GAMES[0].id}'`);

    // 1. Insert studio into STUDIO_CONFIG (prepend as first entry).
    // CRLF-tolerant: match the opening brace + any trailing newline.
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

    // 2. Append 10 games before the closing `}];` of GAME_REGISTRY.
    if (!hasGames) {
        const tail = src.lastIndexOf('}];');
        if (tail === -1) throw new Error('Could not find GAME_REGISTRY closing "}];"');
        const objs = GAMES.map(registryObject).join(',\n');
        src = src.slice(0, tail) + '},\n' + objs + '\n];' + src.slice(tail + 3);
    }

    // Pre-write shape assert + atomic fsync'd persist. game-registry.js is a
    // full-site-down target — a half-rewritten file blanks the lobby and
    // breaks every game page on the next boot.
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
    if (src.includes("siren: '")) { console.log('[adult-slots] engine glyphs already present — skipping'); return; }
    const m = src.match(/const SYMBOL_GLYPHS\s*=\s*\{/);
    if (!m) throw new Error('SYMBOL_GLYPHS not found in casino-engine.js');
    const ins = '\n    // ── After Dark collection (18+) ──\n    ' +
        Object.entries(NEW_GLYPHS).map(([k, v]) => `${k}: '${v}'`).join(', ') + ',';
    const at = m.index + m[0].length;
    src = src.slice(0, at) + ins + src.slice(at);
    // casino-engine.js is the engine-broken target — every one of the 120
    // slot pages loads this file. A truncation here = no spin UI anywhere.
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
        // Per-page is single-page-broken radius — still worth fsync'ing for
        // crash-replay safety. No deep shape assert: pageHtml is a template
        // function with deterministic output, so length>500 + a CasinoEngine
        // marker is enough.
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
//
// Two hardenings vs. the previous version:
//   1. If the existing file is unparseable, THROW with a clear message
//      instead of silently catch-and-`obj = {}`. The old silent catch
//      caused the worst-case symbol-art-style data loss — a single
//      corrupted manifest would be overwritten with ONLY the current
//      studio's ~10 entries, silently wiping every other game. Loud
//      failure tells the operator to git-checkout the file and rerun.
//   2. The final write is fsync'd before rename (via writeAtomicFsync)
//      so a Windows crash-replay can't land the renamed file pointing at
//      uncommitted (whitespace) clusters — the failure mode that wiped
//      data/symbol-art.json earlier in this incident.
function mergeJson(file, addFn) {
    let obj = {};
    if (fs.existsSync(file)) {
        const raw = fs.readFileSync(file, 'utf8');
        try { obj = JSON.parse(raw); }
        catch (e) {
            throw new Error(
                '[adult-slots] refusing to overwrite unparseable manifest at ' + file +
                ': ' + e.message + '. Run `git checkout ' + path.relative(ROOT, file) +
                '` (or restore from backup) before re-running this script.'
            );
        }
        if (!obj || typeof obj !== 'object' || Array.isArray(obj)) {
            throw new Error('[adult-slots] manifest is not a plain object: ' + file);
        }
    }
    addFn(obj);
    writeAtomicFsync(file, Buffer.from(JSON.stringify(obj, null, 2) + '\n', 'utf8'));
}

function updateLore() {
    mergeJson(LORE, obj => GAMES.forEach(g => { obj[g.id] = g.lore; }));
    changed.push('data/game-lore.json');
}

function updateThumbsMap() {
    mergeJson(THUMBS, obj => GAMES.forEach(g => { obj[g.id] = 'ai/' + g.id + '.webp'; }));
    changed.push('data/game-thumbnails.json');
}

function main() {
    updateRegistry();
    updateGlyphs();
    updatePages();
    updateLore();
    updateThumbsMap();
    console.log('[adult-slots] done. Changed:\n  - ' + changed.join('\n  - '));
    console.log('[adult-slots] next: node scripts/generate-slot-art.js  (then npm run build)');
}

if (require.main === module) main();
module.exports = { GAMES, STUDIO, NEW_GLYPHS };
