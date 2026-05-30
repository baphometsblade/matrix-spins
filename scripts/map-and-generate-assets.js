#!/usr/bin/env node
/**
 * map-and-generate-assets.js
 *
 * Bridges the naming gap between game pages and art assets.
 *   - Game pages use hyphen slugs:        games/banshee-wailing-spirits.html
 *   - Backgrounds use underscore + _bg:   assets/backgrounds/slots/banshee_wail_bg.webp
 *   - Symbol sets use underscore dirs:    assets/game_symbols/banshee_wail/
 *
 * The two asset taxonomies are NOT derived from the game slugs, so we fuzzy-map
 * with IDF-weighted token overlap. A game is matched to an existing background
 * only when an *anchor* token (a theme-specific, rare word) is shared; otherwise
 * a thematically-correct background is generated via the local Fooocus-API.
 *
 * Outputs:
 *   - assets/backgrounds/slots/<slug>.webp   (one per game: copied or generated)
 *   - shared/asset-map.json                  (slug -> background + symbol dir)
 *
 * Modes:
 *   node scripts/map-and-generate-assets.js --dry-run     print decisions, touch nothing
 *   node scripts/map-and-generate-assets.js               copy/generate images + write map
 *   node scripts/map-and-generate-assets.js --inject-css  also inject <body> bg CSS into HTML
 *   node scripts/map-and-generate-assets.js --force        regenerate even if <slug>.webp exists
 */

'use strict';

const fs = require('fs');
const path = require('path');
const http = require('http');

let sharp = null;
try { sharp = require('sharp'); } catch (_) { /* validated at startup */ }

// ----------------------------------------------------------------------------
// Paths & config
// ----------------------------------------------------------------------------
const ROOT = path.resolve(__dirname, '..');
const GAMES_DIR = path.join(ROOT, 'games');
const BG_DIR = path.join(ROOT, 'assets', 'backgrounds', 'slots');
const SYMBOLS_DIR = path.join(ROOT, 'assets', 'game_symbols');
const MAP_OUT = path.join(ROOT, 'shared', 'asset-map.json');

const FOOOCUS_HOST = '127.0.0.1';
const FOOOCUS_PORT = 8888; // Fooocus-API default (NOT the 7865 web-UI port)
const FOOOCUS_PATH = '/v1/generation/text-to-image';

const ARGS = new Set(process.argv.slice(2));
const DRY_RUN = ARGS.has('--dry-run');
const INJECT_CSS = ARGS.has('--inject-css');
const FORCE = ARGS.has('--force');

// Tokens too generic to anchor a match (casino filler / colours / outcomes).
const STOPWORDS = new Set([
  'the', 'of', 'and', 'a', 'an', 'in', 'on', 'to',
  'gold', 'golden', 'fortune', 'fortunes', 'riches', 'rich', 'wealth',
  'vault', 'quest', 'wild', 'wilds', 'lucky', 'luck', 'royale', 'royal',
  'deluxe', 'mega', 'ultra', 'bonus', 'spins', 'spin', 'strike', 'rush',
  'run', 'magic', 'mystical', 'secret', 'secrets', 'treasure', 'treasures',
  'prosperity', 'cash', 'coins', 'coin', 'win', 'wins', 'big', 'super',
  'power', 'paradise', 'kingdom', 'legends', 'legend', 'rising', 'glory',
  'master', 'masters', 'frenzy', 'madness', 'mania', 'bound', 'call',
  'challenger', 'keeper', 'keepers', 'collect', 'collector', 'hunt',
  'hunter', 'night', 'nights', 'club', 'after', 'dark',
]);

// Rare-but-semantically-weak tokens: they appear in few background names yet
// describe a mood/outcome rather than a subject, so they mislead matching
// (e.g. "carnival-HEAT" must not copy "chilli_HEAT"; "ra-sun-GOD" must not copy
// "olympian_GODs"). They are allowed to add score but never to *justify* a match
// on their own. A match needs at least one "contentful" shared token = a token
// that is neither a stopword nor ambiguous.
const AMBIGUOUS = new Set([
  'heat', 'nexus', 'riche', 'fiesta', 'bonanza', 'storm', 'dynasty',
  'ascent', 'midnight', 'god', 'cherry', 'feast', 'crew', 'falls',
  'eternal', 'romance', 'desire', 'temptation',
]);

// Minimum cumulative IDF score for a match to be accepted at all (a contentful
// shared token always clears this; it is just a floor).
const MIN_SCORE = 2.5;

// ----------------------------------------------------------------------------
// Tokenisation helpers
// ----------------------------------------------------------------------------
function singularize(tok) {
  if (tok.length > 4 && tok.endsWith('ies')) return tok.slice(0, -3) + 'y';
  if (tok.length > 3 && tok.endsWith('s') && !tok.endsWith('ss')) return tok.slice(0, -1);
  return tok;
}

function tokenize(name) {
  return name
    .toLowerCase()
    .replace(/_bg$/, '')
    .replace(/\.(webp|html)$/, '')
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map(singularize);
}

// Normalise the curated sets through the same singularizer the tokens use, so
// that e.g. STOPWORDS 'riches' also blocks the singularized token 'riche'.
const STOP_N = new Set([...STOPWORDS].map(singularize));
const AMBIG_N = new Set([...AMBIGUOUS].map(singularize));

function meaningful(tokens) {
  return tokens.filter((t) => !STOP_N.has(t) && t.length > 1);
}

function isContentful(tok) {
  return !STOP_N.has(tok) && !AMBIG_N.has(tok) && tok.length > 1;
}

// ----------------------------------------------------------------------------
// Load inputs
// ----------------------------------------------------------------------------
function listGameSlugs() {
  return fs
    .readdirSync(GAMES_DIR)
    .filter((f) => f.endsWith('.html'))
    .map((f) => f.replace(/\.html$/, ''))
    .sort();
}

// Source backgrounds are the curated *_bg.webp files. Slug-named files we may
// have written on a previous run are intentionally excluded from the corpus.
function listSourceBackgrounds() {
  return fs
    .readdirSync(BG_DIR)
    .filter((f) => f.endsWith('_bg.webp'))
    .sort();
}

function listSymbolDirs() {
  if (!fs.existsSync(SYMBOLS_DIR)) return [];
  return fs
    .readdirSync(SYMBOLS_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort();
}

// ----------------------------------------------------------------------------
// IDF model over a corpus of candidate names
// ----------------------------------------------------------------------------
function buildIdf(candidateNames) {
  const df = new Map();
  const tokensByCand = new Map();
  for (const name of candidateNames) {
    const toks = new Set(meaningful(tokenize(name)));
    tokensByCand.set(name, toks);
    for (const t of toks) df.set(t, (df.get(t) || 0) + 1);
  }
  const N = candidateNames.length;
  const weight = (t) => Math.log((N + 1) / ((df.get(t) || 0) + 1)) + 1;
  return { df, tokensByCand, weight, N };
}

// Score a game slug against every candidate. A candidate only qualifies if it
// shares a *contentful* token (a real theme word, not filler/ambiguous). Among
// qualifying candidates the highest IDF score wins; ties break alphabetically
// (deterministic). Returns null when nothing qualifies -> the game is generated.
function bestMatch(slug, candidateNames, idf) {
  const gameToks = new Set(meaningful(tokenize(slug)));
  let best = null;
  for (const name of candidateNames) {
    const candToks = idf.tokensByCand.get(name);
    let score = 0;
    let contentful = false;
    const shared = [];
    for (const t of gameToks) {
      if (candToks.has(t)) {
        score += idf.weight(t);
        shared.push(t);
        if (isContentful(t)) contentful = true;
      }
    }
    if (!contentful || score < MIN_SCORE) continue;
    if (!best || score > best.score) best = { name, score, contentful, shared };
  }
  return best;
}

// ----------------------------------------------------------------------------
// Themed prompt builder for generation
// ----------------------------------------------------------------------------
const THEME_FLAVORS = [
  [/(pharaoh|anubis|isis|osiris|horus|ra-|cleopatra|sphinx|nile|pyramid|thoth|sun-god|tomb|scarab|set-)/, 'ancient egyptian, hieroglyphics, sandstone temple, gold ornaments'],
  [/(dragon|jade|koi|geisha|samurai|ninja|pagoda|silk|lantern|cherry-blossom|red-lantern|emperor|tiger|sakura|oriental)/, 'east asian, ornate, jade and crimson, misty mountains'],
  [/(zombie|vampire|ghost|demon|necromancer|skeleton|haunted|witch|cursed|darkness|reaper|banshee|crypt|grave|inferno|hell)/, 'gothic horror, eerie fog, candlelight, ominous'],
  [/(space|galaxy|cosmic|nebula|stellar|quantum|alien|asteroid|meteor|pulsar|singularity|void|warp|orbit|astro|supernova|black-?hole)/, 'deep space, nebulae, neon starlight, sci-fi'],
  [/(robot|cyber|neon|mecha|android|machine|circuit|pulsar|turbo|flux)/, 'cyberpunk, neon glow, chrome and circuitry, futuristic'],
  [/(wizard|mage|sorcerer|druid|merlin|elven|fairy|enchant|arcane|spell|grove|paladin|golem|minotaur|crystal-ball|grail)/, 'high fantasy, glowing runes, enchanted forest, mystical'],
  [/(wolf|lion|tiger|bear|panther|eagle|elephant|koala|kangaroo|dingo|crocodile|shark|reef|safari|wildlife|leopard)/, 'wild nature, dramatic wildlife, lush environment'],
  [/(outback|aboriginal|billabong|boomerang|uluru|dundee|frontier)/, 'australian outback, red desert, ochre tones, dawn light'],
  [/(cowboy|western|frontier|bounty|cannonball|express|saloon)/, 'wild west, dusty frontier town, golden hour'],
  [/(cherry|melon|fruit|lemon|berry|grape|sunshine|tangerine|peach|forbidden-fruit)/, 'vibrant fruit symbols, juicy, bright candy colours'],
  [/(seduction|boudoir|velvet|burlesque|cabaret|temptation|noir|desire|passion|tryst|masquerade|vixen|siren|lace|whisper|geisha|casanova|tango|vip)/, 'sensual art-deco glamour, deep red velvet, moody lounge lighting'],
  [/(steampunk|clockwork|gears|heist|vintage|deco|artdeco|art-deco)/, 'art-deco steampunk, brass gears, vintage opulence'],
  [/(circus|carnival|masquerade)/, 'dark carnival, vintage circus tent, theatrical lighting'],
  [/(pirate|treasure-map|reef|sunken|coral|underwater)/, 'pirate adventure, ocean depths, weathered treasure'],
  [/(phoenix|fire|flame|volcano|solar|inferno)/, 'blazing fire, molten embers, fiery glow'],
];

function themedPrompt(slug) {
  const words = slug.replace(/-/g, ' ');
  let flavor = '';
  for (const [re, f] of THEME_FLAVORS) {
    if (re.test(slug)) { flavor = ', ' + f; return `${words}${flavor}, dark atmospheric slot machine background, cinematic, 4k, no text`; }
  }
  return `${words}, dark atmospheric slot machine background, cinematic, 4k, no text`;
}

// ----------------------------------------------------------------------------
// Fooocus-API generation
// ----------------------------------------------------------------------------
function generateImage(prompt) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify({
      prompt,
      negative_prompt: 'text watermark blurry words letters signature logo ui frame border',
      width: 1344,
      height: 768,
      seed: -1,
      style_selections: ['Fooocus Cinematic'],
      performance_selection: 'Speed',
      require_base64: true,
    });
    const req = http.request(
      {
        host: FOOOCUS_HOST,
        port: FOOOCUS_PORT,
        path: FOOOCUS_PATH,
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) },
        timeout: 240000,
      },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          if (res.statusCode !== 200) {
            return reject(new Error(`Fooocus HTTP ${res.statusCode}: ${Buffer.concat(chunks).toString('utf8').slice(0, 200)}`));
          }
          try {
            const data = JSON.parse(Buffer.concat(chunks).toString('utf8'));
            const first = Array.isArray(data) ? data[0] : data;
            if (!first || first.finish_reason !== 'SUCCESS' || !first.base64) {
              return reject(new Error(`Generation not successful: ${JSON.stringify(first && first.finish_reason)}`));
            }
            // Fooocus-API returns a data URI ("data:image/png;base64,....").
            const b64 = first.base64.replace(/^data:image\/[a-z]+;base64,/, '');
            resolve(Buffer.from(b64, 'base64'));
          } catch (e) {
            reject(e);
          }
        });
      }
    );
    req.on('error', reject);
    req.on('timeout', () => req.destroy(new Error('Fooocus request timed out')));
    req.write(payload);
    req.end();
  });
}

async function writeWebp(pngBuffer, destPath) {
  const out = await sharp(pngBuffer).webp({ quality: 82 }).toBuffer();
  fs.writeFileSync(destPath, out);
}

// ----------------------------------------------------------------------------
// CSS injection into game HTML
// ----------------------------------------------------------------------------
const CSS_MARKER = 'asset-map bg (auto)';

function injectCss(slug) {
  const file = path.join(GAMES_DIR, `${slug}.html`);
  let html = fs.readFileSync(file, 'utf8');
  if (html.includes(CSS_MARKER)) return 'skip'; // idempotent
  const block = `\n<style>/* ${CSS_MARKER} */\nbody { background-image: url('../assets/backgrounds/slots/${slug}.webp'); background-size: cover; background-position: center; background-attachment: fixed; }\n</style>\n`;
  if (/<\/head>/i.test(html)) {
    html = html.replace(/<\/head>/i, `${block}</head>`);
  } else if (/<body[^>]*>/i.test(html)) {
    html = html.replace(/(<body[^>]*>)/i, `$1${block}`);
  } else {
    html = block + html;
  }
  fs.writeFileSync(file, html);
  return 'done';
}

// ----------------------------------------------------------------------------
// Main
// ----------------------------------------------------------------------------
async function main() {
  if (!DRY_RUN && !sharp) {
    console.error('sharp is required for image conversion but failed to load.');
    process.exit(1);
  }

  const slugs = listGameSlugs();
  const backgrounds = listSourceBackgrounds();
  const symbolDirs = listSymbolDirs();

  console.log(`Games: ${slugs.length} | Source backgrounds: ${backgrounds.length} | Symbol dirs: ${symbolDirs.length}`);
  console.log(`Mode: ${DRY_RUN ? 'DRY RUN' : INJECT_CSS ? 'INJECT CSS' : 'GENERATE'}${FORCE ? ' (force)' : ''}\n`);

  const bgIdf = buildIdf(backgrounds);
  const symIdf = buildIdf(symbolDirs);

  const decisions = [];
  for (const slug of slugs) {
    const bg = bestMatch(slug, backgrounds, bgIdf);
    const sym = symbolDirs.length ? bestMatch(slug, symbolDirs, symIdf) : null;
    decisions.push({
      slug,
      action: bg ? 'copy' : 'generate',
      sourceBackground: bg ? bg.name : null,
      matchScore: bg ? Number(bg.score.toFixed(2)) : 0,
      matchShared: bg ? bg.shared : [],
      symbolDir: sym ? sym.name : null,
      symbolScore: sym ? Number(sym.score.toFixed(2)) : 0,
    });
  }

  const copies = decisions.filter((d) => d.action === 'copy');
  const gens = decisions.filter((d) => d.action === 'generate');
  const symMatched = decisions.filter((d) => d.symbolDir).length;
  console.log(`Background plan: ${copies.length} copy from existing, ${gens.length} generate.`);
  console.log(`Symbol dirs matched to a game: ${symMatched}/${symbolDirs.length}\n`);

  console.log('--- COPY (reuse existing art) ---');
  for (const d of copies) console.log(`  ${d.slug.padEnd(34)} <- ${d.sourceBackground.padEnd(28)} [${d.matchShared.join(',')}] ${d.matchScore}`);
  console.log('\n--- GENERATE (no confident match) ---');
  for (const d of gens) console.log(`  ${d.slug.padEnd(34)} :: ${themedPrompt(d.slug)}`);
  console.log('');

  // Always (re)write the asset map so reviewers can inspect the plan.
  const mapObj = {
    _generated: 'scripts/map-and-generate-assets.js',
    _note: 'Maps hyphen game slugs to underscore art assets. background = final per-slug webp under assets/backgrounds/slots/.',
    games: {},
  };
  for (const d of decisions) {
    mapObj.games[d.slug] = {
      background: `${d.slug}.webp`,
      sourceBackground: d.sourceBackground,           // null = generated
      backgroundOrigin: d.action,                      // 'copy' | 'generate'
      symbolDir: d.symbolDir,                          // null = no confident symbol set
    };
  }
  fs.writeFileSync(MAP_OUT, JSON.stringify(mapObj, null, 2));
  console.log(`Wrote ${path.relative(ROOT, MAP_OUT)} (${decisions.length} games).`);

  if (DRY_RUN) {
    console.log('\nDRY RUN — no images written, no HTML touched.');
    return;
  }

  if (INJECT_CSS) {
    let done = 0;
    let skip = 0;
    for (const d of decisions) {
      const r = injectCss(d.slug);
      if (r === 'done') done++; else skip++;
    }
    console.log(`CSS injected into ${done} pages (${skip} already had it).`);
    return;
  }

  // Produce the per-slug webp for every game.
  let copied = 0;
  let generated = 0;
  let skipped = 0;
  let failed = 0;
  for (const d of decisions) {
    const dest = path.join(BG_DIR, `${d.slug}.webp`);
    if (!FORCE && fs.existsSync(dest)) { skipped++; continue; }
    try {
      if (d.action === 'copy') {
        fs.copyFileSync(path.join(BG_DIR, d.sourceBackground), dest);
        copied++;
        console.log(`[copy ${copied + generated}/${decisions.length}] ${d.slug} <- ${d.sourceBackground}`);
      } else {
        const png = await generateImage(themedPrompt(d.slug));
        await writeWebp(png, dest);
        generated++;
        console.log(`[gen  ${copied + generated}/${decisions.length}] ${d.slug} (${(png.length / 1024).toFixed(0)}KB png -> webp)`);
      }
    } catch (e) {
      failed++;
      console.error(`  FAILED ${d.slug}: ${e.message}`);
    }
  }
  console.log(`\nDone. copied=${copied} generated=${generated} skipped(existing)=${skipped} failed=${failed}`);
  if (failed) process.exitCode = 1;
}

main().catch((e) => { console.error(e); process.exit(1); });
