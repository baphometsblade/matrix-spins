'use strict';

/**
 * Batch slot-art generator — drives the local Fooocus-API (Stable Diffusion
 * XL) to produce photo-real key art for every game, then rewires
 * data/game-thumbnails.json to point at the new assets.
 *
 * Source of truth: js/game-registry.js (id, name, theme, volatility,
 * bonusType, symbols). For each game we build a theme-directed photo-real
 * prompt and request a portrait slot-tile image.
 *
 * Usage:
 *   node scripts/generate-slot-art.js --only golden-cherry-cascade   # one (validate)
 *   node scripts/generate-slot-art.js --limit 10                      # first N
 *   node scripts/generate-slot-art.js                                 # all 100
 *   FOOOCUS_URL=http://127.0.0.1:8888 node scripts/generate-slot-art.js
 *
 * Output: assets/thumbnails/ai/<id>.png. Re-run is idempotent unless
 * --force: games whose target file already exists are skipped.
 */

const fs = require('fs');
const path = require('path');
const http = require('http');
const { writeAtomicFsync } = require('./lib/symbol-art-manifest');

const ROOT = path.resolve(__dirname, '..');
const OUT_DIR = path.join(ROOT, 'assets', 'thumbnails', 'ai');
const REGISTRY = path.join(ROOT, 'js', 'game-registry.js');
const THUMB_MAP = path.join(ROOT, 'data', 'game-thumbnails.json');
const FOOOCUS = (process.env.FOOOCUS_URL || 'http://127.0.0.1:8888').replace(/\/$/, '');

const args = process.argv.slice(2);
function argVal(name) { const i = args.indexOf('--' + name); return i >= 0 ? args[i + 1] : null; }
const ONLY = argVal('only');
const LIMIT = argVal('limit') ? parseInt(argVal('limit'), 10) : null;
const FORCE = args.includes('--force');

// ── Load the 100-game registry. The browser file does
// `window.GAME_REGISTRY = [...]`; we shim a global `window` and require it
// (plain require, no eval/new Function). ──
function loadRegistry() {
    global.window = global.window || {};
    global.window.STUDIO_CONFIG = global.window.STUDIO_CONFIG || {};
    global.window.GAME_REGISTRY = [];
    delete require.cache[require.resolve(REGISTRY)];
    require(REGISTRY);
    return global.window.GAME_REGISTRY || [];
}

// ── Theme → art direction + DISTINCT visual style per theme. Keyed off
// the registry `theme` field. Each entry baking in its own medium
// (oil paint / ukiyo-e / synthwave / engraving / photo) so the lobby
// reads like a curated art gallery rather than 100 photo-real tiles.
// IMPORTANT: describe a SCENE/SUBJECT + STYLE only. Never use the words
// "slot", "reels", "poster", "cover", "title" — SDXL treats them as a
// cue to render (garbled) title text and UI frames, which the negative
// prompt cannot reliably suppress. ──
const THEME_ART = {
    'Fruit Classics':            'in the glossy commercial style of premium 1990s food advertising photography — a luscious overflowing still life of glistening ripe fruit (red cherries, lemons, watermelon slices, juicy plums and grapes) with sparkling water droplets, ultra-saturated colors, sun-drenched studio lighting, ultra-sharp macro detail',
    'Space / Sci-Fi':            'in the bold style of synthwave / vaporwave retrofuturist digital illustration — a deep-space vista with a glowing nebula, ringed planets and a sleek chrome starship, magenta and electric-cyan neon gradients, geometric grid horizon, vector-clean sci-fi concept art',
    'Ancient Egypt / Mythology': 'in the rich painterly style of a 19th-century orientalist oil painting (Jean-Léon Gérôme, Lawrence Alma-Tadema) — an opulent ancient-Egyptian tomb interior with a solid-gold pharaoh death mask, carved hieroglyph walls, golden scarabs and the Eye of Horus, warm earth pigments, classical chiaroscuro torchlight, visible oil brushwork',
    'Asian / Lucky':             'in the bold flat style of a traditional Japanese ukiyo-e woodblock print (Hokusai, Hiroshige) — a majestic golden Chinese dragon coiling around a glowing pearl amid red silk lanterns, koi fish and cherry blossom petals, limited palette of crimson, gold and indigo, strong black ink outlines, decorative stylised wave patterns',
    'Australian / Outback':      'in the earthy painterly style of indigenous Australian dot-art watercolor — the sun-baked outback at golden hour with towering red desert mesas, a powerful kangaroo, eucalyptus trees and glowing opal gemstones, ochre, burnt sienna and amber palette, dreamtime dot motifs woven through the composition',
    'Fantasy / Magic':           'in the painterly oil-on-canvas style of an epic high-fantasy book-cover illustration (Frank Frazetta, Magali Villeneuve, Donato Giancola) — a glowing arcane spellbook with floating runes, crystals and a mystical wizard tower in a misty emerald forest, magical glowing particles, dramatic painted clouds, sweeping god-rays',
    'Horror / Dark':             'in the eerie style of a Gustave Doré ink engraving — a gothic fog-shrouded haunted mansion beneath a blood-red moon, flickering candles, perched ravens and an ornate skull, intricate cross-hatching, deep velvet blacks, monochrome composition with a subtle crimson accent',
    'Animals / Wildlife':        'in the editorial style of professional National Geographic wildlife photography — a powerful apex predator in dramatic wilderness, intense direct eye contact, richly detailed fur and feathers, golden-hour rim light, telephoto compression, ultra-sharp focus on the eyes',
    'Wildcard / Experimental':   'in the bold graphic style of a contemporary modernist propaganda-poster pop art print — a striking abstract composition with vivid flat color blocks, floating geometric prisms and gold accents, dynamic asymmetric layout, clean vector-illustrated edges',
    'Wildcard':                  'in the lavish style of a 1920s Art Deco luxury illustration (Erté, Tamara de Lempicka) — cascading gold coins, glittering diamonds and jewels on deep velvet beneath a dramatic spotlight, gold-leaf accents, geometric Egyptian-revival patterns, gilded-age aesthetic',
    // After-Dark collection (18+): TASTEFUL, ELEGANT glamour only — Art Deco
    // glamour poster / luxury perfume-ad aesthetic. Explicitly classy and
    // fully-clothed; the negative prompt further bars any explicit content.
    'After Dark / Glamour':      'in the elegant style of a vintage 1920s Art Deco glamour poster and a luxury perfume advertisement (Erté, Tamara de Lempicka) — a sophisticated, tasteful after-dark nightlife scene: deep velvet and gold filigree, champagne coupes, red roses, a masquerade mask and distant neon city lights, sensual mysterious mood conveyed through lighting and shadow, refined and classy, rich jewel tones, dramatic single-spotlight, gold-leaf accents, fully-clothed elegant silhouettes only',
    // Crimson Velvet collection (18+): ornate Art Nouveau ROMANCE — Mucha
    // decorative panel. FIGURE-FREE still life of romantic OBJECTS only —
    // this guarantees a tasteful result (the SDXL base model renders
    // undraped figures from "sensual figure" prompts even with strong
    // negatives, so we simply do not request a figure at all). On-theme
    // for the slot symbols regardless.
    'After Dark / Romance':      'in the ornate decorative style of an Alphonse Mucha Art Nouveau panel — a lavish romantic STILL LIFE with NO people and NO human figures: a lush bouquet of red and pink roses, a lit golden candelabra, an ornate lace hand-fan, a jewelled masquerade mask and flowing silk ribbons, framed by swirling gold-leaf floral arabesques and a stained-glass halo, warm crimson, plum and gold palette, intricate organic linework, an ornamental still-life panel, absolutely no people, no human figures, no portrait',
};
const DEFAULT_ART = 'in the lavish style of a 1920s Art Deco luxury illustration with cascading gold and jewels on velvet, gold-leaf accents, geometric patterns, gilded-age aesthetic';

// Glyph-ish hints from a game's own symbols sharpen the subject.
function symbolHints(symbols) {
    if (!Array.isArray(symbols) || !symbols.length) return '';
    const pick = symbols
        .filter(s => !/^(wild|scatter|bonus|bar|sevens?|gold-?bell|s\d)$/i.test(s))
        .slice(0, 3)
        .map(s => String(s).replace(/[-_]/g, ' '));
    return pick.length ? (', featuring ' + pick.join(', ')) : '';
}

function nameSubject(name) {
    return String(name || '').replace(/[-_]/g, ' ').trim();
}

function buildPrompt(game) {
    const art = THEME_ART[game.theme] || DEFAULT_ART;
    const subj = nameSubject(game.name);
    const hints = symbolHints(game.symbols);
    // No "slot"/"poster"/"title" framing — keep it a clean themed hero
    // composition so SDXL renders the subject, not garbled UI text.
    // The STYLE comes from THEME_ART (oil painting / ukiyo-e / synthwave
    // / engraving / photo) — DO NOT add "photorealistic" or "8k" here:
    // those generic descriptors would flatten every theme back into a
    // single photo look and erase the per-theme variety.
    return (
        `${art}${hints}. Inspired by the theme "${subj}". ` +
        'Vertical composition, single centred focal subject, rich and detailed, ' +
        'high quality, clean uncluttered background, absolutely no text or letters anywhere in the image.'
    );
}

const NEGATIVE = 'text, words, letters, numbers, digits, typography, caption, label, title, ' +
    'watermark, signature, logo, brand, UI, HUD, buttons, score, menu, frame, border, ' +
    'deformed, blurry, low quality, jpeg artifacts, extra limbs, mutated, ugly, flat, dull, ' +
    // Keep the After-Dark collection strictly tasteful — bar any explicit output.
    'nudity, nude, naked, nsfw, explicit, pornographic, sexual content, suggestive nudity, ' +
    'lingerie, underwear, exposed skin, cleavage, fetish';

// ── Minimal HTTP helpers (no deps) ──
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
                // 2xx must be JSON for any caller in this script; if Fooocus
                // ever returns HTML/plain (proxy error page, auth wall), we
                // surface that instead of letting `.job_id` come back
                // undefined and producing a misleading "no job_id" error.
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

// Atomic, fsync-safe write. Shared with optimize-slot-art.js and the symbol-art
// pipeline so all writers to data/game-thumbnails.json + on-disk tiles use the
// same primitive. The prior in-script writeAtomic skipped fsync between the
// staged write and the rename — the exact failure mode that wiped
// data/symbol-art.json under a Windows crash-replay.
const writeAtomic = writeAtomicFsync;

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function waitForApi(timeoutMs) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        try { await httpJson('GET', '/v1/engines/styles'); return true; }
        catch (_) { await sleep(4000); }
    }
    return false;
}

async function generateOne(game) {
    const prompt = buildPrompt(game);
    const reqBody = {
        prompt,
        negative_prompt: NEGATIVE,
        // Minimal style nudges only — V2 is a general quality booster,
        // Enhance polishes detail. Removed "Fooocus Sharp" + "SAI Cinematic"
        // because they hard-bias the output toward a photoreal look, which
        // would override the per-theme art-style direction in THEME_ART.
        style_selections: ['Fooocus V2', 'Fooocus Enhance'],
        performance_selection: 'Speed',
        aspect_ratios_selection: '896*1152',
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
            // Validate PNG magic before we hand back a buffer that would
            // otherwise be silently written to disk and look "done" on the
            // next idempotent rerun. Catches Fooocus returning HTML/JSON
            // payloads that base64-decode to non-image bytes.
            if (buf.length < 8 || !buf.slice(0, 8).equals(PNG_SIGNATURE)) {
                throw new Error('payload is not a PNG (first bytes: ' + buf.slice(0, 8).toString('hex') + ')');
            }
            return buf;
        }
        if (stage === 'FAILED') throw new Error('job failed: ' + JSON.stringify(q).slice(0, 160));
    }
    throw new Error('job timed out');
}

// Defensive: registry ids must be `a-z0-9-` only (they are today). Guards
// against a future id of `../etc` writing outside OUT_DIR.
const SAFE_ID = /^[a-z0-9][a-z0-9-]*$/i;

async function main() {
    if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });

    let games = loadRegistry();
    if (ONLY) games = games.filter(g => g.id === ONLY);
    if (LIMIT) games = games.slice(0, LIMIT);
    if (!games.length) { console.error('No games matched.'); process.exit(1); }

    console.log(`[slot-art] Fooocus: ${FOOOCUS} | games: ${games.length}`);
    console.log('[slot-art] waiting for Fooocus-API to be ready…');
    if (!await waitForApi(8 * 60 * 1000)) { console.error('[slot-art] API not reachable — is it loaded?'); process.exit(2); }
    console.log('[slot-art] API ready. Generating…');

    const map = fs.existsSync(THUMB_MAP) ? JSON.parse(fs.readFileSync(THUMB_MAP, 'utf8')) : {};
    let done = 0, skipped = 0, failed = 0;
    for (const game of games) {
        if (!SAFE_ID.test(game.id)) {
            console.error(`[slot-art] SKIP ${game.id}: unsafe id`);
            failed++;
            continue;
        }
        const outFile = path.join(OUT_DIR, game.id + '.png');
        if (!FORCE && fs.existsSync(outFile)) { skipped++; map[game.id] = 'ai/' + game.id + '.png'; continue; }
        const t0 = Date.now();
        try {
            const png = await generateOne(game);
            // Atomic: stage to .tmp, then rename. Prevents a killed run
            // from leaving a truncated PNG that the skip check on the
            // next run would treat as "done".
            writeAtomic(outFile, png);
            map[game.id] = 'ai/' + game.id + '.png';
            done++;
            console.log(`[slot-art] OK ${game.id} (${((Date.now() - t0) / 1000).toFixed(0)}s) ${done}/${games.length}`);
            writeAtomic(THUMB_MAP, Buffer.from(JSON.stringify(map, null, 2) + '\n', 'utf8'));
        } catch (err) {
            failed++;
            console.error(`[slot-art] FAIL ${game.id}: ${err.message}`);
        }
    }
    console.log(`[slot-art] done — generated ${done}, skipped ${skipped}, failed ${failed}`);
}

if (require.main === module) main().catch(e => { console.error(e); process.exit(1); });

module.exports = { buildPrompt, loadRegistry };
