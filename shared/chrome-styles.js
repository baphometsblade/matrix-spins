// ═══════════════════════════════════════════════════════════════════
// Chrome Styles — maps every game ID to its provider chrome key
// ═══════════════════════════════════════════════════════════════════
//
// 8 fictional provider brands, each with a distinct visual identity:
//
//  goldenreels   — Golden Reels Studio       (warm gold, art deco, brass frames)
//  nebula        — Nebula Gaming             (cyan/magenta, sleek dark, glowing edges)
//  mythicforge   — Mythic Forge              (gold/lapis, carved stone, hieroglyphs)
//  wildfrontier  — Wild Frontier Games       (burnt orange, eucalyptus, bark/hand-drawn)
//  shadowworks   — Shadow Works              (blood red, toxic green, gothic/distressed)
//  dragonpearl   — Dragon Pearl Studios      (imperial red, gold, jade, lacquer/clouds)
//  ironclad      — Ironclad Entertainment    (bronze, leather, riveted metal, gears)
//  cascadelabs   — Cascade Labs              (electric blue, white, minimal/geometric)
//
// ═══════════════════════════════════════════════════════════════════

const GAME_CHROME_STYLES = {
    // ── GOLDEN REELS STUDIO  (art deco, brass, warm gold) ───────────
    'sugar_rush':         'goldenreels',
    'starlight_princess': 'nebula',
    'lucky_dragon':       'dragonpearl',
    'sphinx_riddle':      'mythicforge',
    'sacred_ibis':        'goldenreels',
    'melon_feast':        'goldenreels',
    'ancient_tombs':      'mythicforge',
    'temple_bells':       'dragonpearl',
    'warp_station':       'nebula',
    'tiger_temple':       'dragonpearl',
    'jade_emperor':       'dragonpearl',
    'uluru_gold':         'ironclad',

    // ── NEBULA GAMING  (sleek dark, glowing edges, sci-fi) ──────────
    'starburst_xxl':      'nebula',
    'outback_king':       'wildfrontier',
    'boomerang_luck':     'wildfrontier',
    'cherry_bombs':       'goldenreels',
    'fairy_tales':        'mythicforge',
    'avalon_castle':      'mythicforge',
    'ticket_to_fortune':  'cascadelabs',
    'cleopatra_moon':     'mythicforge',
    'neon_nebula':        'nebula',
    'eagle_summit':       'wildfrontier',
    'eldritch_depths':    'shadowworks',
    'great_barrier':      'ironclad',

    // ── MYTHIC FORGE  (carved stone, hieroglyphs, mythology) ────────
    'gates_olympus':      'mythicforge',
    'pyramid_king':       'mythicforge',
    'cursed_night':       'shadowworks',
    'wild_rooster':       'wildfrontier',
    'midnight_phantom':   'shadowworks',
    'tiger_strike':       'wildfrontier',
    'solar_system':       'nebula',
    'circus_thrills':     'cascadelabs',
    'tangerine_tango':    'goldenreels',
    'lemon_drop':         'goldenreels',
    'isis_blessing':      'mythicforge',
    'fae_forest':         'mythicforge',
    'koi_cascade':        'dragonpearl',
    'deep_dive':          'cascadelabs',

    // ── WILD FRONTIER GAMES  (bark, hand-drawn, nature/fire) ────────
    'cosmic_nova':        'nebula',
    'rainbow_fortune':    'mythicforge',
    'emerald_dragon':     'dragonpearl',
    'witches_brew':       'shadowworks',
    'harvest_megaways':   'wildfrontier',
    'stellar_drift':      'nebula',
    'arcane_tower':       'cascadelabs',
    'panda_paradise':     'dragonpearl',
    'flamingo_fiesta':    'cascadelabs',
    'moon_rabbit':        'ironclad',
    'banshee_wail':       'shadowworks',
    'platypus_fortune':   'cascadelabs',

    // ── SHADOW WORKS  (gothic, distressed, dark horror) ─────────────
    'book_dead':          'mythicforge',
    'leopard_prowl':      'wildfrontier',
    'peach_paradise':     'goldenreels',
    'infinity_mirror':    'mythicforge',
    'jade_fortune':       'dragonpearl',
    'mystic_grail':       'mythicforge',
    'oriental_silk':      'dragonpearl',
    'pyramid_power':      'mythicforge',
    'haunted_mansion':    'shadowworks',
    'grape_vine':         'goldenreels',
    'dragon_temple':      'dragonpearl',
    'moon_madness':       'nebula',
    'tomb_anubis':        'mythicforge',
    'crystal_cavern':     'ironclad',
    'crimson_fang':       'shadowworks',
    'plague_doctor':      'shadowworks',
    'pirate_plunder':     'ironclad',

    // ── DRAGON PEARL STUDIOS  (lacquer, clouds, brush) ──────────────
    'fruit_bonanza':      'goldenreels',
    'spice_fortune':      'goldenreels',
    'zombie_carnival':    'shadowworks',
    'desert_dynasty':     'ironclad',
    'gravity_well':       'cascadelabs',
    'dragonfire_forge':   'dragonpearl',
    'dragon_gate':        'ironclad',
    'puppet_master':      'shadowworks',
    'steampunk_fortune':  'ironclad',

    // ── IRONCLAD ENTERTAINMENT  (riveted metal, gears, steampunk) ───
    'wolf_gold':          'wildfrontier',
    'dragon_realm':       'dragonpearl',
    'nile_jewels':        'mythicforge',
    'warrior_princess':   'ironclad',
    'eclipse_mystery':    'nebula',
    'carnival_crown':     'cascadelabs',
    'supernova_slots':    'nebula',
    'platypus_paradise':  'wildfrontier',
    'runeblade':          'ironclad',
    'wolf_canyon':        'wildfrontier',
    'samurai_honor':      'ironclad',
    'crocodile_dundee':   'wildfrontier',

    // ── CASCADE LABS  (minimal, geometric, modern/tech) ─────────────
    'hot_chillies':       'goldenreels',
    'space_odyssey':      'nebula',
    'joker_frenzy':       'cascadelabs',
    'galaxy_rush':        'nebula',
    'berry_bliss':        'goldenreels',
    'crocodile_gold':     'wildfrontier',
    'opal_outback':       'wildfrontier',
    'rhino_rampage':      'wildfrontier',
    'shark_reef':         'wildfrontier',
    'lucky_tanuki':       'cascadelabs',
    'kookaburra_cash':    'wildfrontier',
    'wild_west_bounty':   'ironclad',
};

// Fallback chrome style by template type (used when no explicit mapping)
const TEMPLATE_CHROME_FALLBACK = {
    'classic':  'goldenreels',
    'standard': 'mythicforge',
    'extended': 'ironclad',
    'scatter':  'mythicforge',
    'grid':     'nebula',
};

/**
 * Returns the chrome style key for a given game definition object.
 * Falls back to the template-based default if no explicit entry.
 * @param {object} game
 * @returns {string} chrome style key
 */
function getGameChromeStyle(game) {
    if (!game) return 'mythicforge';
    var style = GAME_CHROME_STYLES[game.id];
    if (typeof style === 'string') return style;
    var tmpl = TEMPLATE_CHROME_FALLBACK[game.template];
    if (typeof tmpl === 'string') return tmpl;
    return 'mythicforge';
}

// ═══════════════════════════════════════════════════════════════════
// Provider Full Themes — unified visual + particle + sound config
// ═══════════════════════════════════════════════════════════════════

const PROVIDER_FULL_THEMES = {
    // ── Golden Reels Studio: art deco, brass frames, warm gold ──────────────
    goldenreels: {
        visual: { primary: '#D4A017', secondary: '#FFF8E7', glow: '#D4A017', accent: 'linear-gradient(135deg,#D4A017,#5C3317)' },
        particles: { colors: ['#D4A017','#FFF8E7','#5C3317','#FFD700','#ffffff'], style: 'droplet', gravity: 0.05, drag: 0.97, turbulence: 0.08 },
        sound: { waveform: 'sine', baseFreq: 392, scale: [392,440,494,523,587,659], filterFreq: 2200, reverb: 0.4, attack: 0.02, decay: 0.35 },
        ambient: { waveform: 'triangle', freq: 98, filterFreq: 500, volume: 0.03 },
        animation: { chrome: 'goldenReelsFrame', idle: 'shimmer', win: 'goldenShower' },
        particleColors: ['#D4A017','#FFF8E7','#5C3317','#FFD700','#ffffff'],
        ambientStyle: 'golden',
        winTextStyle: 'linear-gradient(135deg, #D4A017 0%, #FFF8E7 50%, #D4A017 100%)',
        symbolHitStyle: 'golden'
    },
    // ── Nebula Gaming: sleek dark panels, glowing edges, scanline ───────────
    nebula: {
        visual: { primary: '#00F0FF', secondary: '#1A0A2E', glow: '#00F0FF', accent: 'linear-gradient(135deg,#00F0FF,#FF00AA)' },
        particles: { colors: ['#00F0FF','#FF00AA','#1A0A2E','#7c4dff','#ffffff'], style: 'electric', gravity: 0.02, drag: 0.98, turbulence: 0.3 },
        sound: { waveform: 'sawtooth', baseFreq: 440, scale: [440,523,587,659,784,880], filterFreq: 3200, reverb: 0.35, attack: 0.01, decay: 0.3 },
        ambient: { waveform: 'sine', freq: 110, filterFreq: 800, volume: 0.035 },
        animation: { chrome: 'nebulaFrameGlow', idle: 'pulse', win: 'cosmicBurst' },
        particleColors: ['#00F0FF','#FF00AA','#7c4dff','#ffffff','#00b8d4'],
        ambientStyle: 'cosmic',
        winTextStyle: 'linear-gradient(135deg, #00F0FF 0%, #FF00AA 50%, #00F0FF 100%)',
        symbolHitStyle: 'electric'
    },
    // ── Mythic Forge: carved stone borders, hieroglyphic patterns, lapis ────
    mythicforge: {
        visual: { primary: '#C8A415', secondary: '#1A1A2E', glow: '#C8A415', accent: 'linear-gradient(135deg,#1F3A8C,#C8A415)' },
        particles: { colors: ['#C8A415','#1F3A8C','#FFD700','#1A1A2E','#ffffff'], style: 'feather', gravity: 0.03, drag: 0.97, turbulence: 0.15 },
        sound: { waveform: 'sine', baseFreq: 523, scale: [523,587,659,698,784,880], filterFreq: 2000, reverb: 0.6, attack: 0.05, decay: 0.5 },
        ambient: { waveform: 'triangle', freq: 130, filterFreq: 600, volume: 0.03 },
        animation: { chrome: 'mythicForgeFrame', idle: 'shimmer', win: 'mysticalRays' },
        particleColors: ['#C8A415','#1F3A8C','#FFD700','#ffffff','#1A1A2E'],
        ambientStyle: 'mystical',
        winTextStyle: 'linear-gradient(135deg, #1F3A8C 0%, #C8A415 50%, #1F3A8C 100%)',
        symbolHitStyle: 'golden'
    },
    // ── Wild Frontier Games: natural bark textures, hand-drawn borders ──────
    wildfrontier: {
        visual: { primary: '#CC5500', secondary: '#E8D5A3', glow: '#CC5500', accent: 'linear-gradient(135deg,#CC5500,#4A7C59)' },
        particles: { colors: ['#CC5500','#4A7C59','#E8D5A3','#ff6d00','#ffffff'], style: 'ember', gravity: 0.06, drag: 0.96, turbulence: 0.12 },
        sound: { waveform: 'square', baseFreq: 261, scale: [261,293,330,349,392,440], filterFreq: 1800, reverb: 0.25, attack: 0.01, decay: 0.25 },
        ambient: { waveform: 'sawtooth', freq: 73, filterFreq: 420, volume: 0.025 },
        animation: { chrome: 'wildFrontierFrame', idle: 'grain', win: 'natureLeaves' },
        particleColors: ['#CC5500','#4A7C59','#E8D5A3','#ffffff','#ff6d00'],
        ambientStyle: 'nature',
        winTextStyle: 'linear-gradient(135deg, #CC5500 0%, #4A7C59 50%, #E8D5A3 100%)',
        symbolHitStyle: 'golden'
    },
    // ── Shadow Works: gothic arched frames, distressed textures ─────────────
    shadowworks: {
        visual: { primary: '#8B0000', secondary: '#1A1A1A', glow: '#39FF14', accent: 'linear-gradient(135deg,#8B0000,#39FF14)' },
        particles: { colors: ['#8B0000','#39FF14','#1A1A1A','#ff0000','#ffffff'], style: 'smoke', gravity: -0.02, drag: 0.98, turbulence: 0.35 },
        sound: { waveform: 'sawtooth', baseFreq: 220, scale: [220,261,293,311,349,415], filterFreq: 1200, reverb: 0.7, attack: 0.08, decay: 0.6 },
        ambient: { waveform: 'sawtooth', freq: 65, filterFreq: 280, volume: 0.02 },
        animation: { chrome: 'shadowWorksFrame', idle: 'mist', win: 'spectralSmoke' },
        particleColors: ['#8B0000','#39FF14','#1A1A1A','#ffffff','#ff0000'],
        ambientStyle: 'mystical',
        winTextStyle: 'linear-gradient(135deg, #8B0000 0%, #39FF14 50%, #8B0000 100%)',
        symbolHitStyle: 'electric'
    },
    // ── Dragon Pearl Studios: lacquered panels, cloud motifs, brushstroke ───
    dragonpearl: {
        visual: { primary: '#CC0000', secondary: '#FFD700', glow: '#FFD700', accent: 'linear-gradient(135deg,#CC0000,#FFD700)' },
        particles: { colors: ['#CC0000','#FFD700','#00A86B','#ff4040','#ffffff'], style: 'wisp', gravity: -0.02, drag: 0.97, turbulence: 0.08 },
        sound: { waveform: 'triangle', baseFreq: 523, scale: [523,587,659,784,880,1046], filterFreq: 3000, reverb: 0.45, attack: 0.02, decay: 0.35 },
        ambient: { waveform: 'sine', freq: 131, filterFreq: 550, volume: 0.02 },
        animation: { chrome: 'dragonPearlFrame', idle: 'lanternFloat', win: 'fireworks' },
        particleColors: ['#CC0000','#FFD700','#00A86B','#ffffff','#ff4040'],
        ambientStyle: 'oriental',
        winTextStyle: 'linear-gradient(135deg, #CC0000 0%, #FFD700 50%, #00A86B 100%)',
        symbolHitStyle: 'golden'
    },
    // ── Ironclad Entertainment: riveted metal panels, gear motifs ───────────
    ironclad: {
        visual: { primary: '#B5651D', secondary: '#654321', glow: '#B5651D', accent: 'linear-gradient(135deg,#B5651D,#2A3439)' },
        particles: { colors: ['#B5651D','#654321','#2A3439','#ff6d00','#ffffff'], style: 'pixel', gravity: 0.07, drag: 0.96, turbulence: 0.12 },
        sound: { waveform: 'square', baseFreq: 247, scale: [247,293,330,370,415,494], filterFreq: 1600, reverb: 0.25, attack: 0.008, decay: 0.22 },
        ambient: { waveform: 'sawtooth', freq: 73, filterFreq: 380, volume: 0.025 },
        animation: { chrome: 'ironcladFrame', idle: 'grain', win: 'metallicSparks' },
        particleColors: ['#B5651D','#654321','#2A3439','#ffffff','#ff6d00'],
        ambientStyle: 'nature',
        winTextStyle: 'linear-gradient(135deg, #B5651D 0%, #654321 50%, #2A3439 100%)',
        symbolHitStyle: 'golden'
    },
    // ── Cascade Labs: minimal flat panels, geometric patterns ───────────────
    cascadelabs: {
        visual: { primary: '#0066FF', secondary: '#333333', glow: '#0066FF', accent: 'linear-gradient(135deg,#0066FF,#FFFFFF)' },
        particles: { colors: ['#0066FF','#FFFFFF','#333333','#448aff','#82b1ff'], style: 'digital', gravity: 0.03, drag: 0.97, turbulence: 0.1 },
        sound: { waveform: 'square', baseFreq: 523, scale: [523,587,659,698,784,880], filterFreq: 4000, reverb: 0.15, attack: 0.005, decay: 0.18 },
        ambient: { waveform: 'square', freq: 131, filterFreq: 650, volume: 0.02 },
        animation: { chrome: 'cascadeLabsFrame', idle: 'pulse', win: 'digitalPixels' },
        particleColors: ['#0066FF','#FFFFFF','#333333','#448aff','#82b1ff'],
        ambientStyle: 'digital',
        winTextStyle: 'linear-gradient(135deg, #0066FF 0%, #FFFFFF 50%, #0066FF 100%)',
        symbolHitStyle: 'electric'
    }
};

/** Get the full theme config for a game. */
function getProviderFullTheme(game) {
    const key = getGameChromeStyle(game);
    return PROVIDER_FULL_THEMES[key] || PROVIDER_FULL_THEMES.mythicforge;
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { GAME_CHROME_STYLES, TEMPLATE_CHROME_FALLBACK, getGameChromeStyle, PROVIDER_FULL_THEMES, getProviderFullTheme };
}
