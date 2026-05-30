'use strict';

/**
 * Batch symbol-art generator — drives the local Fooocus-API (Stable Diffusion
 * XL) to produce a square photo-real CELL TILE for every (game, symbol) pair,
 * then writes/updates data/symbol-art.json so the slot engine can swap in
 * <img> tiles in place of the emoji-glyph fallback.
 *
 * ARCHITECTURE — locked in before this script was written:
 *   - Output tiles are COMPLETE CELL BITMAPS (square, integrated theme bg,
 *     centred subject). NOT transparent icons — SDXL has no native alpha.
 *   - Per-game subdir: assets/symbols/<game-id>/<symbol-id>.png so that
 *     universal symbols (wild, scatter, bonus, …) can be themed per game.
 *   - This script writes 768x768 PNGs. The optimizer (optimize-symbol-art.js)
 *     converts each to a 224x224 q82 WebP for serving.
 *
 * Source of truth: js/game-registry.js — same registry the thumbnail
 * generator uses. For each game.symbols[i] we build a prompt that fuses
 * the game's THEME art direction with the symbol's SEMANTIC meaning,
 * augmented by symbol-pattern hints (low-pay vs high-pay vs wild/scatter).
 *
 * Usage:
 *   node scripts/generate-symbol-art.js --only sugar_rush               # one game
 *   node scripts/generate-symbol-art.js --only sugar_rush --sym wild    # one tile
 *   node scripts/generate-symbol-art.js --limit 10                      # first N games
 *   node scripts/generate-symbol-art.js                                 # all 100
 *   node scripts/generate-symbol-art.js --force                         # re-render
 *   FOOOCUS_URL=http://127.0.0.1:8888 node scripts/generate-symbol-art.js
 *
 * Output: assets/symbols/<game-id>/<symbol-id>.png
 * Manifest: data/symbol-art.json — updated atomically after every successful tile.
 *
 * Resumable: a tile whose target PNG already exists is skipped unless --force.
 * Atomic: every write stages to a .tmp on the same volume and renames.
 * Validated: every payload is PNG-signature-checked before being persisted.
 *
 * Estimated runtime: ~1000 tiles × ~12s = ~3.5h of GPU time. Robustness
 * against interruption is essential — the manifest is rewritten after EACH
 * successful tile so a kill -9 mid-run loses at most one tile of progress.
 */

const fs = require('fs');
const path = require('path');
const http = require('http');

const ROOT = path.resolve(__dirname, '..');
const OUT_ROOT = path.join(ROOT, 'assets', 'symbols');
const REGISTRY = path.join(ROOT, 'js', 'game-registry.js');
const MANIFEST = path.join(ROOT, 'data', 'symbol-art.json');
const FOOOCUS = (process.env.FOOOCUS_URL || 'http://127.0.0.1:8888').replace(/\/$/, '');

const args = process.argv.slice(2);
function argVal(name) { const i = args.indexOf('--' + name); return i >= 0 ? args[i + 1] : null; }
const ONLY = argVal('only');
const ONLY_SYM = argVal('sym');
const LIMIT = argVal('limit') ? parseInt(argVal('limit'), 10) : null;
const FORCE = args.includes('--force');

// ── Load the 100-game registry. The browser file does
// `window.GAME_REGISTRY = [...]`; we shim a global `window` and require it
// (plain require — no dynamic evaluation). Same approach as generate-slot-art. ──
function loadRegistry() {
    global.window = global.window || {};
    global.window.STUDIO_CONFIG = global.window.STUDIO_CONFIG || {};
    global.window.GAME_REGISTRY = [];
    delete require.cache[require.resolve(REGISTRY)];
    require(REGISTRY);
    return global.window.GAME_REGISTRY || [];
}

// ── Theme → background/scene art direction. Keyed off the registry `theme`
// field. Mirrors THEME_ART in generate-slot-art.js but tuned for a SINGLE
// centred subject on an INTEGRATED themed background (not a vertical poster).
// Never use "slot", "reels", "poster", "cover", "title", "icon", "sticker"
// — SDXL renders garbled UI text/frames from those cues. ──
const THEME_BG = {
    'Fruit Classics':            'a luscious vibrant sun-drenched fruit-still-life background, glistening red, yellow and green tones, sweet glossy macro food photography palette',
    'Space / Sci-Fi':            'a deep-space nebula background with glowing cyan and violet stardust, drifting cosmic particles and distant ringed planets, sleek sci-fi concept art palette',
    'Ancient Egypt / Mythology': 'a warm golden ancient-Egyptian tomb-wall background, carved hieroglyphs and floating dust motes lit by torchlight, deep amber and gold palette',
    'Asian / Lucky':             'a lacquered red-and-gold oriental silk background with delicate cherry-blossom petals and faint dragon-scale gilding, ornate auspicious palette',
    'Australian / Outback':      'a sun-baked Australian outback background, red desert mesas at golden hour with eucalyptus silhouettes, warm amber and ochre palette',
    'Fantasy / Magic':           'a misty enchanted fantasy background with floating arcane runes, glowing magical particles and emerald-forest haze, ethereal mystical palette',
    'Horror / Dark':             'a gothic horror background — fog-shrouded mansion silhouette beneath a blood-red moon, cold blue rim light and drifting mist, eerie cinematic darkness',
    'Animals / Wildlife':        'a richly detailed wilderness background — sunlit savanna grass and golden-hour atmospheric haze, epic nature photography palette',
    'Wildcard / Experimental':   'a bold abstract neon-gradient background with floating geometric prisms and jewel accents, striking modern digital art palette',
    'Wildcard':                  'an opulent deep-velvet luxury background with cascading gold-coin glints and jewelled bokeh, decadent cinematic product-photography palette',
};
const DEFAULT_BG = 'an opulent luxury background with cascading gold glints and jewelled bokeh on deep velvet, dramatic cinematic spotlight';

// ── Symbol-pattern hints. Augment the per-symbol subject when the registry
// id matches a well-known role. Order matters — most-specific first. Keys
// are tested against the lowercased symbol id with substring matching for
// compound ids ("wild_zeus", "scatter_pearl"). ──
const SYMBOL_HINTS = [
    // Wild family — magical/glowing
    { test: /\bwild\b|^wild[-_]/, hint: 'glowing magical aura, radiant iridescent rim-light, ornate enchanted frame, the word "WILD" is NOT shown' },
    // Scatter family — starburst/burst
    { test: /\bscatter\b|^scatter[-_]/, hint: 'radiant starburst halo, cosmic energy rays, dramatic glow, the word "SCATTER" is NOT shown' },
    // Bonus / free-spins — gift/treasure/trophy
    { test: /\bbonus\b|^bonus[-_]|free[-_]?spin/, hint: 'wrapped gift or treasure chest, ribbons of light, trophy-grade highlights, the word "BONUS" is NOT shown' },
    // Jackpot — overflowing riches
    { test: /\bjackpot\b/, hint: 'overflowing pile of gold coins and gems, blinding cinematic glow, opulent riches' },
    // Bar family — classic gold bullion bar
    { test: /^(triple-?bar|double-?bar|bar|lucky-?bar)$/, hint: 'a polished solid-gold bullion bar with the "BAR" mark engraved, mirror-finish, deep shadow' },
    // Sevens — lucky red/gold seven
    { test: /^(sevens?|lucky-?seven|gold-?seven)$/, hint: 'a glossy chrome lucky number-seven, deep crimson or gold finish, dramatic spotlight reflections' },
    // Bell — gold bell
    { test: /^(bell|gold-?bell)$/, hint: 'a polished gold dinner bell with red ribbon, jewelled studs, mirror highlights' },
    // High-pay / premium (s5_ family or gem/crown words) — golden, jewelled
    { test: /^s5[-_]|^(crown|king|queen|emperor|diamond|ruby|sapphire|emerald|jewel|gold|treasure|relic|sacred|imperial|royal|pharaoh|cleopatra|throne|chalice|grail)/, hint: 'premium golden jewelled hero subject, ornate filigree, mirror-finish reflections, cinematic key light, trophy-grade' },
    // Mid-pay (s3/s4 or common subjects)
    { test: /^s[34][-_]/, hint: 'a richly detailed thematic prop, polished surfaces, dramatic studio lighting' },
    // Low-pay (s1/s2 or simple fruit/letter/card)
    { test: /^s[12][-_]|^(cherry|lemon|orange|plum|banana|apple|melon|watermelon|grape|peach|strawberry|acorn)$/, hint: 'a fresh glossy macro hero subject, water droplets, vibrant saturated colour, simple uncluttered composition' },
];

function symbolHint(symId) {
    const s = String(symId || '').toLowerCase();
    for (const h of SYMBOL_HINTS) if (h.test.test(s)) return h.hint;
    return 'a richly detailed thematic hero subject, dramatic cinematic key light, polished glossy highlights';
}

// Humanise the registry id into a noun phrase the model can render.
// "s3_candy_cane" → "candy cane"; "wild_zeus" → "zeus wild";
// "gold-bell" → "gold bell"; "eye-of-horus" → "eye of horus".
function symbolSubject(symId) {
    let s = String(symId || '').toLowerCase();
    // Strip the s1_/s2_/s3_/s4_/s5_ tier prefix.
    s = s.replace(/^s[1-5][-_]/, '');
    // Normalise separators.
    s = s.replace(/[-_]+/g, ' ').trim();
    return s || 'mystery icon';
}

function nameSubject(name) {
    return String(name || '').replace(/[-_]/g, ' ').trim();
}

function buildPrompt(game, symId) {
    const subj = symbolSubject(symId);
    const hint = symbolHint(symId);
    // Tight ISOLATED PRODUCT SHOT of the symbol object — the object must be
    // the subject and fill the frame. We deliberately use a SIMPLE velvet
    // backdrop rather than the full theme scene (THEME_BG), because the rich
    // scene made SDXL render figures/empty frames instead of the object
    // (e.g. "pearl" → a woman, "feather" → an empty picture frame). No people.
    return (
        `A luxury product macro photograph of ${subj} — ${hint} — ` +
        'as the single isolated subject, centred and filling most of the square frame, ' +
        'resting on a simple deep-velvet backdrop with soft warm-gold bokeh, ' +
        'ultra-detailed, dramatic studio lighting, rich glossy highlights, high contrast, ' +
        'photorealistic, 8k, premium casino game-symbol tile, clean uncluttered background, ' +
        'no people, no human figure, no picture frame, no border, no text.'
    );
}

const NEGATIVE = 'text, words, letters, numbers, digits, typography, caption, label, title, ' +
    'watermark, signature, logo, brand, UI, HUD, buttons, score, menu, frame, border, ' +
    'multiple subjects, collage, grid, split screen, tiny details, busy background, ' +
    'deformed, blurry, low quality, jpeg artifacts, extra limbs, mutated, ugly, flat, dull, ' +
    // Symbols are OBJECTS — bar people entirely (also fixes "pearl"→woman),
    // and bar any explicit output as belt-and-suspenders.
    'person, people, human, human figure, portrait, face, man, woman, body, ' +
    'nudity, nude, naked, nsfw, explicit, pornographic, sexual content, ' +
    'lingerie, underwear, exposed skin, cleavage, fetish';

// ── Minimal HTTP helpers (no deps) — same shape as generate-slot-art ──
function httpJson(method, urlPath, body) {
    return new Promise((resolve, reject) => {
        const url = new URL(FOOOCUS + urlPath);
        const payload = body ? Buffer.from(JSON.stringify(body)) : null;
        const req = http.request({
            hostname: url.hostname, port: url.port, path: url.pathname + url.search, method,
            headers: Object.assign({ 'Accept': 'application/json' },
                payload ? { 'Content-Type': 'application/json', 'Content-Length': payload.length } : {}),
        }, res => {
            let data = '';
            res.on('data', c => { data += c; });
            res.on('end', () => {
                if (res.statusCode < 200 || res.statusCode >= 300) {
                    return reject(new Error(`HTTP ${res.statusCode}: ${data.slice(0, 200)}`));
                }
                try { resolve(JSON.parse(data)); }
                catch (e) { reject(new Error(`non-JSON 2xx from ${urlPath}: ${data.slice(0, 200)}`)); }
            });
        });
        req.on('error', reject);
        if (payload) req.write(payload);
        req.end();
    });
}

// PNG magic bytes — first 8 bytes of every valid PNG.
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);

// Atomic file write: stage to .tmp on the same volume, then rename. Same
// approach as generate-slot-art — prevents a killed run from leaving a
// truncated PNG that the idempotent skip would treat as "done".
function writeAtomic(targetPath, buffer) {
    const tmp = targetPath + '.' + process.pid + '.tmp';
    fs.writeFileSync(tmp, buffer);
    fs.renameSync(tmp, targetPath);
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function waitForApi(timeoutMs) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        try { await httpJson('GET', '/v1/engines/styles'); return true; }
        catch (_) { await sleep(4000); }
    }
    return false;
}

async function generateOne(game, symId) {
    const prompt = buildPrompt(game, symId);
    const reqBody = {
        prompt,
        negative_prompt: NEGATIVE,
        style_selections: ['Fooocus V2', 'Fooocus Enhance', 'Fooocus Sharp', 'SAI Cinematic'],
        performance_selection: 'Speed',
        aspect_ratios_selection: '768*768',   // square cell tile
        image_number: 1,
        image_seed: -1,
        base_model_name: 'juggernautXL_v8Rundiffusion.safetensors',
        require_base64: true,
        async_process: true,
    };
    const job = await httpJson('POST', '/v1/generation/text-to-image', reqBody);

    const jobId = job.job_id || job.jobId;
    if (!jobId) throw new Error('no job_id: ' + JSON.stringify(job).slice(0, 160));

    for (let i = 0; i < 300; i++) {
        await sleep(2000);
        const q = await httpJson('GET', '/v1/generation/query-job?job_id=' + encodeURIComponent(jobId) + '&require_step_preview=false');
        const stage = String(q.job_stage || q.job_status || '').toUpperCase();
        if (stage === 'SUCCESS') {
            const result = (q.job_result && q.job_result[0]) || {};
            const b64 = result.base64 || result.im || result.image;
            if (!b64) throw new Error('SUCCESS but no base64');
            const buf = Buffer.from(String(b64).replace(/^data:image\/\w+;base64,/, ''), 'base64');
            // Validate PNG magic — same belt-and-suspenders as generate-slot-art.
            if (buf.length < 8 || !buf.slice(0, 8).equals(PNG_SIGNATURE)) {
                throw new Error('payload is not a PNG (first bytes: ' + buf.slice(0, 8).toString('hex') + ')');
            }
            return buf;
        }
        if (stage === 'FAILED') throw new Error('job failed: ' + JSON.stringify(q).slice(0, 160));
    }
    throw new Error('job timed out');
}

// Defensive: registry ids must be `a-z0-9_-` only (s1_lollipop, gold-bell …).
// Guards against a future id of `../etc` writing outside OUT_ROOT.
const SAFE_ID = /^[a-z0-9][a-z0-9_-]*$/i;

// Manifest helpers — keep on-disk JSON in lock-step with what's been generated.
function loadManifest() {
    if (!fs.existsSync(MANIFEST)) return {};
    try { return JSON.parse(fs.readFileSync(MANIFEST, 'utf8')) || {}; }
    catch (e) { console.error('[symbol-art] WARN: manifest unreadable, starting fresh:', e.message); return {}; }
}
function persistManifest(map) {
    writeAtomic(MANIFEST, Buffer.from(JSON.stringify(map, null, 2) + '\n', 'utf8'));
}

async function main() {
    if (!fs.existsSync(OUT_ROOT)) fs.mkdirSync(OUT_ROOT, { recursive: true });

    let games = loadRegistry();
    if (ONLY) games = games.filter(g => g.id === ONLY);
    if (LIMIT) games = games.slice(0, LIMIT);
    if (!games.length) { console.error('No games matched.'); process.exit(1); }

    // Flatten to a (game, symbol) work list. Skip empty/invalid ids early.
    const work = [];
    for (const g of games) {
        if (!SAFE_ID.test(g.id)) { console.error(`[symbol-art] SKIP game ${g.id}: unsafe id`); continue; }
        const syms = Array.isArray(g.symbols) ? g.symbols : [];
        for (const s of syms) {
            const symId = String(s || '').toLowerCase();
            if (!SAFE_ID.test(symId)) { console.error(`[symbol-art] SKIP ${g.id}/${symId}: unsafe id`); continue; }
            if (ONLY_SYM && symId !== ONLY_SYM.toLowerCase()) continue;
            work.push({ game: g, symId });
        }
    }
    if (!work.length) { console.error('No (game, symbol) tiles matched filters.'); process.exit(1); }

    console.log(`[symbol-art] Fooocus: ${FOOOCUS} | tiles: ${work.length} across ${games.length} game(s)`);
    console.log('[symbol-art] waiting for Fooocus-API to be ready…');
    if (!await waitForApi(8 * 60 * 1000)) { console.error('[symbol-art] API not reachable — is it loaded?'); process.exit(2); }
    console.log('[symbol-art] API ready. Generating…');

    const map = loadManifest();
    let done = 0, skipped = 0, failed = 0;
    for (const { game, symId } of work) {
        const gameDir = path.join(OUT_ROOT, game.id);
        if (!fs.existsSync(gameDir)) fs.mkdirSync(gameDir, { recursive: true });

        const pngFile = path.join(gameDir, symId + '.png');
        const webpFile = path.join(gameDir, symId + '.webp');
        const relWebp = game.id + '/' + symId + '.webp';
        const relPng  = game.id + '/' + symId + '.png';

        // Idempotent skip: an existing .webp (optimised) OR an existing .png
        // (raw — optimizer hasn't run yet) is enough to skip unless --force.
        if (!FORCE && (fs.existsSync(webpFile) || fs.existsSync(pngFile))) {
            // Record whichever form exists so the manifest reflects on-disk truth.
            if (!map[game.id]) map[game.id] = {};
            if (fs.existsSync(webpFile)) map[game.id][symId] = relWebp;
            else if (!map[game.id][symId]) map[game.id][symId] = relPng;
            skipped++;
            continue;
        }

        const t0 = Date.now();
        try {
            const png = await generateOne(game, symId);
            // Atomic stage→rename. Prevents a killed run from leaving a
            // truncated PNG that the next idempotent rerun would treat as done.
            writeAtomic(pngFile, png);
            if (!map[game.id]) map[game.id] = {};
            map[game.id][symId] = relPng;   // optimizer will rewrite to .webp
            done++;
            console.log(`[symbol-art] OK ${game.id}/${symId} (${((Date.now() - t0) / 1000).toFixed(0)}s) ${done}/${work.length}`);
            // Persist manifest after EVERY successful tile so a kill mid-run
            // never loses progress beyond the tile in flight.
            persistManifest(map);
        } catch (err) {
            failed++;
            console.error(`[symbol-art] FAIL ${game.id}/${symId}: ${err.message}`);
        }
    }
    persistManifest(map);
    console.log(`[symbol-art] done — generated ${done}, skipped ${skipped}, failed ${failed}; manifest has ${Object.keys(map).length} game(s)`);
}

if (require.main === module) main().catch(e => { console.error(e); process.exit(1); });

module.exports = { buildPrompt, loadRegistry, symbolHint, symbolSubject };
