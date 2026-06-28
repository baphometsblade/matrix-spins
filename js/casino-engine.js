/**
 * Matrix Spins — Casino Engine (server-authoritative).
 *
 * All spin outcomes come from the backend. The client's responsibility is:
 *   • Auth gate — redirect to login if no session
 *   • Render the reels the server returned
 *   • Animate, celebrate wins, update balance
 *   • Expose fairness data (server seed hash, client seed, nonce)
 *
 * The previous version had client-side Math.random() reel logic. That was
 * fundamentally unshippable for real money. This rewrite removes it.
 *
 * Public surface (backward-compatible with existing game HTML files):
 *
 *   CasinoEngine.init('game-container', gameConfig)
 *
 * gameConfig needs an `id` property that matches the server game id.
 * Every other field (name, themes, rtp, min/max bet) is used only for display
 * and is OVERRIDDEN by authoritative values fetched from the backend.
 */

// ── Global escapeHtml utility (XSS prevention) ──────────────────
// Accessible from all scripts via window.escapeHtml.
// Individual files may still have their own local copy for safety,
// but this guarantees availability before any module loads.
if (!window.escapeHtml) {
  window.escapeHtml = function(str) {
    if (str == null) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
  };
}

(function () {
  'use strict';

  const HAS_API = typeof window !== 'undefined' && window.MatrixSpinsAPI;

  // Capture THIS script's own URL at load time so we can derive sibling-script
  // paths (e.g. js/matrix-loader.js) regardless of where the page lives
  // (/index.html vs /games/foo.html). document.currentScript is only valid
  // during top-level execution, so it must be read here, not inside a method.
  const ENGINE_SCRIPT_SRC = (function () {
    try {
      if (document.currentScript && document.currentScript.src) return document.currentScript.src;
      const scripts = document.getElementsByTagName('script');
      for (let i = scripts.length - 1; i >= 0; i--) {
        const src = scripts[i].src || '';
        if (/casino-engine\.js(\?|$)/.test(src)) return src;
      }
    } catch (_) { /* noop */ }
    return '';
  })();

  function $el(tag, props = {}, ...children) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(props)) {
      if (k === 'style') Object.assign(el.style, v);
      else if (k === 'class') el.className = v;
      else if (k.startsWith('on')) el.addEventListener(k.slice(2).toLowerCase(), v);
      else el.setAttribute(k, v);
    }
    for (const c of children) {
      if (c == null) continue;
      el.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    }
    return el;
  }

  function fmt(cents) {
    return window.MatrixSpinsAPI ? window.MatrixSpinsAPI.formatCents(cents) : `$${(cents/100).toFixed(2)}`;
  }

  const SYMBOL_PALETTE = [
    ['#E74C3C','#F39C12'],['#3498DB','#1ABC9C'],['#2ECC71','#16A085'],
    ['#F39C12','#E67E22'],['#9B59B6','#8E44AD'],['#1ABC9C','#2ECC71'],
    ['#E67E22','#D35400'],['#E91E63','#C2185B'],['#F1C40F','#D4AC0D'],
    ['#FFD700','#B8860B'],
  ];

  function symbolColors(symbol, index) {
    const i = Math.abs(hashStr(symbol)) % SYMBOL_PALETTE.length;
    return SYMBOL_PALETTE[i] || SYMBOL_PALETTE[index % SYMBOL_PALETTE.length];
  }
  function hashStr(s) {
    let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
    return h;
  }

  // ──────────────────────────────────────────────────────────────────
  // Symbol → emoji glyph map. Covers the 424 unique symbol IDs across
  // the 100 games (extracted from js/game-registry.js). Grouped by
  // theme for readability. Symbols use lower-case canonical ID keys.
  // Multi-word IDs are hyphenated to match the registry's shape.
  // ──────────────────────────────────────────────────────────────────
  const SYMBOL_GLYPHS = {
    // ── Crimson Velvet collection (18+) — only keys NOT already defined
    // below (blossom/fan/lantern/silk pre-exist; the original entries win,
    // so we don't re-declare them and avoid duplicate-key shadowing). ──
    flame: '🔥', gondola: '🛶', letter: '💌', ribbon: '🎀', bouquet: '💐', spade: '♠️',
    // ── After Dark collection (18+) ──
    martini: '🍸', sax: '🎷', lips: '💋', shell: '🐚', trident: '🔱', siren: '🧜‍♀️', rose: '🌹', cocktail: '🍹', stiletto: '👠', champagne: '🍾', candle: '🕯️', wine: '🍷', heart: '❤️', vinyl: '💿', disco: '🪩', serpent: '🐍', goblet: '🥃', raven: '🐦‍⬛', ace: '🅰️', queen: '👸', dice: '🎲', cigar: '🚬', lipstick: '💄',
    // Generic slot specials
    wild: '🃏', scatter: '⭐', bonus: '🎁', mystery: '❓', prize: '🎁',
    bell: '🔔', 'gold-bell': '🔔', bar: '📊', 'triple-bar': '📊',
    sevens: '7️⃣', 'lucky-seven': '7️⃣', 'gold-seven': '7️⃣', seven: '7️⃣',

    // Fruit
    cherry: '🍒', lemon: '🍋', orange: '🍊', grape: '🍇', plum: '🟣',
    strawberry: '🍓', banana: '🍌', watermelon: '🍉', melon: '🍈',
    peach: '🍑', apple: '🍎', 'lucky-fruit': '🍇', olive: '🫒',

    // Treasure / gems / coins
    diamond: '💎', emerald: '💚', ruby: '❤️', sapphire: '💙',
    gem: '💎', jewel: '💎', jewels: '💎', gold: '💰', 'gold-bar': '🏆',
    'gold-coin': '🪙', 'gold-ring': '💍', 'gold-nugget': '💰',
    'gold-mask': '🎭', nugget: '💰', coin: '🪙', silver: '🥈', copper: '🟤',
    brass: '🟫', treasure: '💰', 'treasure-chest': '🪙', vault: '🏦',
    safe: '🔐', jade: '💚', moonstone: '🌙', opal: '💎', pearl: '🦪',
    crystal: '💠', 'crystal-ball': '🔮', amulet: '🧿', riches: '💰',
    fortune: '💰', bounty: '💰',

    // Animals
    wolf: '🐺', bear: '🐻', tiger: '🐅', lion: '🦁', eagle: '🦅',
    owl: '🦉', cat: '🐱', elephant: '🐘', dragon: '🐉', koi: '🐟',
    fish: '🐟', shark: '🦈', jellyfish: '🪼', panther: '🐾',
    kangaroo: '🦘', koala: '🐨', crocodile: '🐊', dingo: '🐺',
    platypus: '🦫', camel: '🐪', horse: '🐴', heron: '🪿',
    zebra: '🦓', mermaid: '🧜‍♀️', seahorse: '🐢', turtle: '🐢',
    salmon: '🐟', clownfish: '🐠', wildebeest: '🐃', joey: '🦘', dove: '🕊️',
    bastet: '🐈', sphinx: '🦁', falcon: '🦅', hawk: '🦅',
    paw: '🐾', pack: '🐺', mane: '🦁', fang: '🦷', fangs: '🦷',
    claw: '🐾', tusks: '🐘', stripes: '🐅', wing: '🪶', wings: '🪶',
    feather: '🪶', horn: '🐐', nest: '🪺', honey: '🍯', prey: '🦌',
    herd: '🐃', wattle: '🦃',

    // Mystical / fantasy
    wizard: '🧙', witch: '🧙‍♀️', mage: '🧙', fairy: '🧚', elf: '🧝',
    druid: '🧙', sorcerer: '🧙', paladin: '🛡️', enchantress: '🧙‍♀️',
    necromancer: '🧙‍♂️', archer: '🏹', merlin: '🧙', golem: '🪨',
    bard: '🎶', dryad: '🌳', minotaur: '🐂', reaper: '💀', wand: '🪄',
    spell: '✨', spellbook: '📖', scroll: '📜', potion: '🧪',
    cauldron: '🍯', dagger: '🗡️', sword: '⚔️', magic: '✨',
    arcane: '✨', enchanted: '✨', enchantment: '✨', rune: '🪨',
    relic: '⚱️', staff: '🪄', amulets: '🧿', alchemist: '⚗️',
    transmutation: '⚗️', labyrinth: '🌀',

    // Egyptian / mythology
    pharaoh: '🤴', anubis: '🐺', ra: '☀️', isis: '👸', osiris: '👑',
    set: '🌑', horus: '🦅', thoth: '🦩', ankh: '☥', scarab: '🪲',
    pyramid: '🔺', tomb: '⚰️', 'eye-of-horus': '👁️', eye: '👁️',
    'sacred-disk': '☀️', 'sacred-bird': '🦅', 'sacred-lotus': '🪷',
    'sacred-animal': '🐈', sacred: '☥', cleopatra: '👸', afterlife: '⚱️',
    blessing: '🙏', rebirth: '🌅', ceremony: '🛕',

    // Cosmic / space / sci-fi
    star: '⭐', planet: '🪐', comet: '☄️', asteroid: '🪨', meteor: '☄️',
    nebula: '🌌', 'black-hole': '🕳️', satellite: '🛰️',
    spacecraft: '🚀', spaceship: '🚀', 'space-station': '🛰️',
    shuttle: '🚀', alien: '👽', robot: '🤖', wormhole: '🌀',
    warp: '🌀', 'warp-gate': '🌀', portal: '🌀', pulsar: '✨',
    quasar: '✨', supernova: '✨', photon: '💡', proton: '⚛️',
    neutron: '⚛️', particle: '⚛️', ion: '⚛️', plasma: '🔥',
    reactor: '⚛️', quantum: '⚛️', singularity: '🌀', collapse: '💥',
    flux: '💫', circuit: '🔌', gadget: '⚙️', tech: '🛠️', future: '🚀',
    void: '🕳️', galaxy: '🌌', cosmos: '🌌', sky: '☁️', light: '💡',
    'light-beam': '💡', mega: '💥',

    // Cards / royalty
    king: '👑', emperor: '👑', crown: '👑', throne: '🪑',
    royal: '👑', master: '🧑‍🎓',

    // Horror / dark
    darkness: '🌑', midnight: '🌑', evil: '😈', mansion: '🏚️',
    coffin: '⚰️', grave: '🪦', bones: '🦴', skull: '💀', ghost: '👻',
    spirit: '👻', haunted: '🏚️', haunting: '👻', shadow: '🌑',
    demon: '😈', vampire: '🧛', banshee: '👻', zombie: '🧟',
    skeleton: '💀', undead: '🧟', apocalypse: '☣️', apparition: '👻',
    phantom: '👻', curse: '🔮', 'dark-magic': '🌑', dark: '🌑',
    decay: '🦴', blood: '🩸', inferno: '🔥', hex: '🔮',

    // Asian / lucky
    bamboo: '🎋', lotus: '🪷', pagoda: '🏯', lantern: '🏮',
    fan: '🪭', silk: '🎀', incense: '🪔', 'jade-seal': '🟩',
    'imperial-dragon': '🐉', 'lucky-cat': '🐈', 'lucky-bar': '🥢',
    bonsai: '🎋', prosperity: '💰', abundance: '🌾', luck: '🍀',
    festival: '🎊', celebration: '🎉', fireworks: '🎆', joy: '😊',
    peace: '☮️',

    // Australian / outback
    boomerang: '🪃', didgeridoo: '🪈', outback: '🌵', eucalyptus: '🌿',
    billy: '🍵', aboriginal: '🪃', 'aboriginal-art': '🪃',
    'aboriginal-culture': '🪃', 'dot-painting': '🟠', dreamtime: '🌌',
    'desert-rose': '🌸', tribal: '🪃', survival: '🌵', freedom: '🦅',

    // Nature
    tree: '🌳', forest: '🌲', mountain: '🏔️', river: '🏞️',
    canyon: '🏞️', cloud: '☁️', lightning: '⚡', flower: '🌸',
    blossom: '🌸', lily: '🪷', mushroom: '🍄', fire: '🔥',
    water: '💧', mist: '🌫️', storm: '⛈️', thunder: '⛈️',
    wave: '🌊', sea: '🌊', sun: '☀️', sunset: '🌅', moon: '🌙',
    night: '🌙', earth: '🌍', stone: '🪨', sand: '🏜️',
    desert: '🏜️', savanna: '🌾', jungle: '🌴', swamp: '🐊',
    island: '🏝️', coral: '🪸', underwater: '🌊', pond: '🏞️',
    'water-hole': '💧', nature: '🌿', moss: '🌿', grassland: '🌾',
    bush: '🌳', acorn: '🌰', spice: '🌶️', cactus: '🌵',
    rock: '🪨',

    // Tools / weapons
    axe: '🪓', bow: '🏹', arrow: '🏹', shield: '🛡️', helmet: '⛑️',
    spear: '🔱', trident: '🔱', pickaxe: '⛏️', revolver: '🔫',
    gun: '🔫', blaster: '🔫', cannon: '💣', cannonball: '💣',
    dynamite: '🧨', chain: '⛓️',

    // Buildings / places
    castle: '🏰', palace: '🏯', tower: '🗼', temple: '⛩️',
    sanctuary: '🛕', library: '📚', bridge: '🌉', pillar: '🏛️',

    // Pirate / nautical
    ship: '🚢', anchor: '⚓', pirate: '🏴‍☠️', 'pirate-flag': '🏴‍☠️',
    compass: '🧭', map: '🗺️', rum: '🍾',

    // Western / cowboy
    cowboy: '🤠', sheriff: '⭐', outlaw: '🦹', saloon: '🍺',
    wanted: '📜', west: '🌄', adventure: '🗺️', raider: '🦹',

    // Circus
    clown: '🤡', acrobat: '🤸', ringmaster: '🎩', tent: '🎪',
    popcorn: '🍿', balloon: '🎈', ferris: '🎡', carousel: '🎠',
    carnival: '🎪', circus: '🎪', performance: '🎭', mask: '🎭',
    portrait: '🖼️', ticket: '🎟️',

    // Steampunk / industrial
    gear: '⚙️', machine: '⚙️', engine: '⚙️', mechanical: '⚙️',
    steam: '💨', blueprint: '📐', innovation: '💡', speed: '💨',

    // Mystic / spiritual
    holy: '🙏', knowledge: '📚', wisdom: '🦉', power: '⚡',
    strength: '💪', mystical: '🔮', supernatural: '👻',
    secret: '🤫', legend: '📜', myth: '📜', quest: '🗺️',
    guardian: '🛡️', game: '🎮', fun: '🎉',

    // Mythical creatures
    phoenix: '🔥', hunter: '🏹', warrior: '⚔️',

    // Music
    music: '🎵', melody: '🎵', song: '🎵', lyre: '🎵',
    thread: '🧵',

    // Misc
    key: '🔑', clock: '⏰', mirror: '🪞', torch: '🔥',
    book: '📖', red: '🔴', beauty: '🌹', danger: '⚠️',
    rising: '📈', explosion: '💥', wheel: '🎡', athena: '🏛️',
    cyborg: '🤖', balance: '⚖️', mining: '⛏️',

    // Custom additions found in registry
    'desert-dynasty': '🏜️', kraken: '🐙', ocean: '🌊',
    crown_dynasty: '👑',

    // Final coverage pass — 100% of the 424 registry symbol IDs
    ancient: '🏛️', artifact: '🏺', aura: '✨', bonanza: '💰',
    campfire: '🔥', caravan: '🐪', chaos: '🌀', death: '💀',
    golden: '🌟', grizzly: '🐻', horror: '😱', howl: '🐺',
    immortal: '☠️', ninja: '🥷', pan: '🐐', prowl: '🐆',
    road: '🛣️', safari: '🦁', scythe: '☠️', wail: '👻',
  };

  // ──────────────────────────────────────────────────────────────────
  // VISUAL-THEME PARTICLE ENGINE
  //
  // A single lightweight <canvas> layer renders one of ~15 ambient
  // particle types per game, giving every slot its own atmosphere
  // (embers, snow, blossom, coins, bubbles, stars, leaves, fireflies,
  // fog, aurora, caustics, rain, matrix, dust, sparkles). The engine is
  // GC-conscious: 8–44 pre-allocated particles, recycled in place (never
  // re-allocated mid-flight), animated with requestAnimationFrame and
  // paused via the Page Visibility API. All motion is transform/opacity
  // on a single canvas (GPU-friendly). Skipped entirely under
  // prefers-reduced-motion. See SlotGame._initAmbientParticles().
  //
  // Each spec is STATELESS (shared across games) — all per-game state
  // lives in the particle objects (the `P` array) or is derived from the
  // monotonic timestamp `ts`, so specs can be const at module scope.
  // ──────────────────────────────────────────────────────────────────
  function _vtRnd(a, b) { return a + Math.random() * (b - a); }
  function _vtPick(arr) { return arr[(Math.random() * arr.length) | 0] || arr[0]; }
  function _vtRgba(hex, a) {
    let c = (hex || '#ffffff').replace('#', '');
    if (c.length === 3) c = c.split('').map((x) => x + x).join('');
    const n = parseInt(c, 16) || 0xffffff;
    return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
  }
  const _vtKatakana = 'ｱｲｳｴｵｶｷｸｹｺｻｼｽｾｿﾀﾁﾂﾃﾄﾅﾆﾇﾈﾉﾊﾋﾌﾍﾎ0123456789';

  const PARTICLE_SPECS = {
    // Rising embers — flicker + upward drift. Fire / demon / inferno.
    embers: {
      spawn(W, H, D, col) { return { x: Math.random() * W, y: H + Math.random() * H * 0.4, vx: _vtRnd(-0.2, 0.2) * D, vy: -_vtRnd(0.3, 0.9) * D, s: _vtRnd(1, 3) * D, a: _vtRnd(0.3, 0.9), ph: _vtRnd(0, 6.28), c: _vtPick(col) }; },
      step(p, W, H, D, dt) { const f = dt / 16; p.ph += 0.05 * f; p.x += (p.vx + Math.sin(p.ph) * 0.4 * D) * f; p.y += p.vy * f; if (p.y < -p.s * 4) { p.y = H + p.s; p.x = Math.random() * W; } },
      draw(ctx, p) { ctx.globalAlpha = Math.max(0, p.a * (0.55 + 0.45 * Math.sin(p.ph))); ctx.fillStyle = p.c; ctx.shadowColor = p.c; ctx.shadowBlur = p.s * 4; ctx.beginPath(); ctx.arc(p.x, p.y, p.s, 0, 6.283); ctx.fill(); },
    },
    // Falling snow — gentle horizontal sway. Norse / ice / winter.
    snow: {
      spawn(W, H, D, col) { return { x: Math.random() * W, y: Math.random() * H, vy: _vtRnd(0.3, 0.9) * D, s: _vtRnd(1, 3.2) * D, a: _vtRnd(0.4, 0.9), ph: _vtRnd(0, 6.28), c: _vtPick(col) }; },
      step(p, W, H, D, dt) { const f = dt / 16; p.ph += 0.02 * f; p.y += p.vy * f; p.x += Math.sin(p.ph) * 0.6 * D * f; if (p.y > H + p.s) { p.y = -p.s; p.x = Math.random() * W; } },
      draw(ctx, p) { ctx.globalAlpha = p.a; ctx.fillStyle = p.c; ctx.shadowColor = p.c; ctx.shadowBlur = p.s * 2; ctx.beginPath(); ctx.arc(p.x, p.y, p.s, 0, 6.283); ctx.fill(); },
    },
    // Cherry-blossom / leaf petals — rotate while drifting down diagonally.
    blossom: {
      spawn(W, H, D, col) { return { x: Math.random() * W, y: Math.random() * H, vx: _vtRnd(-0.5, -0.1) * D, vy: _vtRnd(0.3, 0.8) * D, s: _vtRnd(4, 9) * D, a: _vtRnd(0.5, 0.95), rot: _vtRnd(0, 6.28), vr: _vtRnd(-0.04, 0.04), ph: _vtRnd(0, 6.28), c: _vtPick(col) }; },
      step(p, W, H, D, dt) { const f = dt / 16; p.ph += 0.03 * f; p.rot += p.vr * f; p.x += (p.vx + Math.sin(p.ph) * 0.5 * D) * f; p.y += p.vy * f; if (p.y > H + p.s || p.x < -p.s) { p.y = -p.s; p.x = Math.random() * W; } },
      draw(ctx, p) { ctx.globalAlpha = p.a; ctx.fillStyle = p.c; ctx.shadowColor = p.c; ctx.shadowBlur = p.s; ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.rot); ctx.beginPath(); ctx.ellipse(0, 0, p.s, p.s * 0.5, 0, 0, 6.283); ctx.fill(); ctx.restore(); },
    },
    // Falling spinning coins — gold shimmer. Egyptian / fortune / wealth.
    coins: {
      spawn(W, H, D, col) { return { x: Math.random() * W, y: Math.random() * H, vy: _vtRnd(0.6, 1.4) * D, s: _vtRnd(4, 8) * D, a: _vtRnd(0.55, 0.95), ph: _vtRnd(0, 6.28), vp: _vtRnd(0.08, 0.16), c: _vtPick(col) }; },
      step(p, W, H, D, dt) { const f = dt / 16; p.ph += p.vp * f; p.y += p.vy * f; p.x += Math.sin(p.ph * 0.5) * 0.3 * D * f; if (p.y > H + p.s) { p.y = -p.s; p.x = Math.random() * W; } },
      draw(ctx, p) { const sx = Math.abs(Math.cos(p.ph)); ctx.globalAlpha = p.a; ctx.fillStyle = p.c; ctx.shadowColor = p.c; ctx.shadowBlur = p.s * 1.5; ctx.save(); ctx.translate(p.x, p.y); ctx.scale(sx < 0.12 ? 0.12 : sx, 1); ctx.beginPath(); ctx.arc(0, 0, p.s, 0, 6.283); ctx.fill(); ctx.restore(); },
    },
    // Rising bubbles — wobble upward. Ocean / underwater / koi.
    bubbles: {
      spawn(W, H, D, col) { return { x: Math.random() * W, y: H + Math.random() * H, vy: -_vtRnd(0.4, 1.1) * D, s: _vtRnd(3, 9) * D, a: _vtRnd(0.25, 0.6), ph: _vtRnd(0, 6.28), c: _vtPick(col) }; },
      step(p, W, H, D, dt) { const f = dt / 16; p.ph += 0.04 * f; p.y += p.vy * f; p.x += Math.sin(p.ph) * 0.7 * D * f; if (p.y < -p.s) { p.y = H + p.s; p.x = Math.random() * W; } },
      draw(ctx, p) { ctx.globalAlpha = p.a; ctx.strokeStyle = p.c; ctx.lineWidth = Math.max(1, p.s * 0.18); ctx.shadowColor = p.c; ctx.shadowBlur = p.s; ctx.beginPath(); ctx.arc(p.x, p.y, p.s, 0, 6.283); ctx.stroke(); ctx.globalAlpha = p.a * 0.5; ctx.beginPath(); ctx.arc(p.x - p.s * 0.3, p.y - p.s * 0.3, p.s * 0.22, 0, 6.283); ctx.fillStyle = p.c; ctx.fill(); },
    },
    // Twinkling stars — slow drift + opacity pulse. Space / cosmic / night.
    stars: {
      spawn(W, H, D, col) { return { x: Math.random() * W, y: Math.random() * H, vx: _vtRnd(-0.05, 0.05) * D, vy: _vtRnd(0.01, 0.08) * D, s: _vtRnd(0.6, 2.4) * D, a: _vtRnd(0.3, 1), ph: _vtRnd(0, 6.28), vp: _vtRnd(0.02, 0.06), c: _vtPick(col) }; },
      step(p, W, H, D, dt) { const f = dt / 16; p.ph += p.vp * f; p.x += p.vx * f; p.y += p.vy * f; if (p.y > H + p.s) { p.y = -p.s; p.x = Math.random() * W; } if (p.x < -p.s) p.x = W; else if (p.x > W + p.s) p.x = 0; },
      draw(ctx, p) { ctx.globalAlpha = p.a * (0.4 + 0.6 * Math.abs(Math.sin(p.ph))); ctx.fillStyle = p.c; ctx.shadowColor = p.c; ctx.shadowBlur = p.s * 3; ctx.beginPath(); ctx.arc(p.x, p.y, p.s, 0, 6.283); ctx.fill(); },
    },
    // Falling leaves — tumble + sway. Nature / forest / druid / autumn.
    leaves: {
      spawn(W, H, D, col) { return { x: Math.random() * W, y: Math.random() * H, vx: _vtRnd(-0.4, 0.4) * D, vy: _vtRnd(0.3, 0.7) * D, s: _vtRnd(5, 11) * D, a: _vtRnd(0.5, 0.9), rot: _vtRnd(0, 6.28), vr: _vtRnd(-0.05, 0.05), ph: _vtRnd(0, 6.28), c: _vtPick(col) }; },
      step(p, W, H, D, dt) { const f = dt / 16; p.ph += 0.035 * f; p.rot += p.vr * f; p.x += (p.vx + Math.sin(p.ph) * 0.8 * D) * f; p.y += p.vy * f; if (p.y > H + p.s) { p.y = -p.s; p.x = Math.random() * W; } },
      draw(ctx, p) { ctx.globalAlpha = p.a; ctx.fillStyle = p.c; ctx.shadowColor = p.c; ctx.shadowBlur = p.s * 0.6; ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.rot); ctx.beginPath(); ctx.moveTo(0, -p.s); ctx.quadraticCurveTo(p.s * 0.7, 0, 0, p.s); ctx.quadraticCurveTo(-p.s * 0.7, 0, 0, -p.s); ctx.fill(); ctx.restore(); },
    },
    // Wandering fireflies — random walk + glow pulse. Fantasy / enchanted.
    fireflies: {
      spawn(W, H, D, col) { return { x: Math.random() * W, y: Math.random() * H, vx: _vtRnd(-0.3, 0.3) * D, vy: _vtRnd(-0.3, 0.3) * D, s: _vtRnd(1.5, 3.5) * D, a: _vtRnd(0.4, 1), ph: _vtRnd(0, 6.28), vp: _vtRnd(0.03, 0.08), c: _vtPick(col) }; },
      step(p, W, H, D, dt) { const f = dt / 16; p.ph += p.vp * f; p.vx += _vtRnd(-0.04, 0.04) * D * f; p.vy += _vtRnd(-0.04, 0.04) * D * f; p.vx = Math.max(-0.5 * D, Math.min(0.5 * D, p.vx)); p.vy = Math.max(-0.5 * D, Math.min(0.5 * D, p.vy)); p.x += p.vx * f; p.y += p.vy * f; if (p.x < 0) p.x = W; else if (p.x > W) p.x = 0; if (p.y < 0) p.y = H; else if (p.y > H) p.y = 0; },
      draw(ctx, p) { ctx.globalAlpha = p.a * (0.25 + 0.75 * Math.abs(Math.sin(p.ph))); ctx.fillStyle = p.c; ctx.shadowColor = p.c; ctx.shadowBlur = p.s * 5; ctx.beginPath(); ctx.arc(p.x, p.y, p.s, 0, 6.283); ctx.fill(); },
    },
    // Drifting fog — large soft translucent blobs. Haunted / mystery / swamp.
    fog: {
      spawn(W, H, D, col) { return { x: Math.random() * W, y: _vtRnd(0.3, 1) * H, vx: _vtRnd(0.05, 0.25) * D * (Math.random() < 0.5 ? -1 : 1), s: _vtRnd(60, 160) * D, a: _vtRnd(0.04, 0.12), c: _vtPick(col) }; },
      step(p, W, H, D, dt) { const f = dt / 16; p.x += p.vx * f; if (p.x < -p.s) p.x = W + p.s; else if (p.x > W + p.s) p.x = -p.s; },
      draw(ctx, p) { const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.s); g.addColorStop(0, _vtRgba(p.c, p.a)); g.addColorStop(1, _vtRgba(p.c, 0)); ctx.globalAlpha = 1; ctx.fillStyle = g; ctx.beginPath(); ctx.arc(p.x, p.y, p.s, 0, 6.283); ctx.fill(); },
    },
    // Northern lights — slow wavy luminous bands. Norse / arctic / mystic.
    aurora: {
      count: 0,
      frame(ctx, W, H, D, ts, col) { ctx.globalCompositeOperation = 'lighter'; for (let b = 0; b < 3; b++) { const c = col[b % col.length]; const yBase = H * (0.18 + b * 0.16); const amp = H * 0.07; const g = ctx.createLinearGradient(0, yBase - H * 0.18, 0, yBase + H * 0.18); g.addColorStop(0, _vtRgba(c, 0)); g.addColorStop(0.5, _vtRgba(c, 0.13)); g.addColorStop(1, _vtRgba(c, 0)); ctx.fillStyle = g; ctx.beginPath(); ctx.moveTo(0, H); for (let x = 0; x <= W; x += 24 * D) { const y = yBase + Math.sin(x * 0.004 / D + ts * 0.0006 + b) * amp + Math.sin(x * 0.011 / D - ts * 0.0009) * amp * 0.4; ctx.lineTo(x, y); } ctx.lineTo(W, H); ctx.closePath(); ctx.fill(); } ctx.globalCompositeOperation = 'source-over'; },
      spawn() { return {}; }, step() {}, draw() {},
    },
    // Underwater caustics — shifting light ripples. Ocean / reef / atlantis.
    caustics: {
      count: 0,
      frame(ctx, W, H, D, ts, col) { ctx.globalCompositeOperation = 'lighter'; const c = col[0]; for (let i = 0; i < 6; i++) { const x = (Math.sin(ts * 0.0004 + i * 1.7) * 0.5 + 0.5) * W; const y = (Math.cos(ts * 0.0005 + i * 2.3) * 0.5 + 0.5) * H; const r = (50 + 40 * Math.sin(ts * 0.001 + i)) * D; const g = ctx.createRadialGradient(x, y, 0, x, y, r); g.addColorStop(0, _vtRgba(c, 0.09)); g.addColorStop(1, _vtRgba(c, 0)); ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, r, 0, 6.283); ctx.fill(); } ctx.globalCompositeOperation = 'source-over'; },
      spawn() { return {}; }, step() {}, draw() {},
    },
    // Rain — fast vertical streaks. Storm / noir / city / jungle.
    rain: {
      spawn(W, H, D, col) { return { x: Math.random() * W, y: Math.random() * H, vy: _vtRnd(6, 11) * D, len: _vtRnd(8, 20) * D, a: _vtRnd(0.15, 0.4), c: _vtPick(col) }; },
      step(p, W, H, D, dt) { const f = dt / 16; p.y += p.vy * f; p.x -= 0.6 * D * f; if (p.y > H) { p.y = -p.len; p.x = Math.random() * W; } },
      draw(ctx, p) { ctx.globalAlpha = p.a; ctx.strokeStyle = p.c; ctx.lineWidth = Math.max(1, 1.2); ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p.x - p.len * 0.12, p.y + p.len); ctx.stroke(); },
    },
    // Matrix code rain — falling katakana columns. Cyber / tech / quantum.
    matrix: {
      spawn(W, H, D, col, i, n) { const cell = 16 * D; return { x: (i / n) * W + _vtRnd(0, cell), y: _vtRnd(-H, 0), vy: _vtRnd(2, 5) * D, len: (6 + (Math.random() * 10 | 0)), cell, c: _vtPick(col) }; },
      step(p, W, H, D, dt) { const f = dt / 16; p.y += p.vy * f; if (p.y - p.len * p.cell > H) { p.y = _vtRnd(-H * 0.5, 0); } },
      draw(ctx, p) { ctx.font = `${p.cell}px monospace`; ctx.textAlign = 'center'; for (let k = 0; k < p.len; k++) { const yy = p.y - k * p.cell; if (yy < 0 || yy > 100000) continue; ctx.globalAlpha = k === 0 ? 0.95 : Math.max(0, 0.5 - k / p.len * 0.5); ctx.fillStyle = k === 0 ? '#d7ffd9' : p.c; ctx.shadowColor = p.c; ctx.shadowBlur = k === 0 ? 8 : 0; ctx.fillText(_vtKatakana[(Math.random() * _vtKatakana.length) | 0], p.x, yy); } },
    },
    // Floating dust / sand motes — slow lazy drift. Desert / ancient / tomb.
    dust: {
      spawn(W, H, D, col) { return { x: Math.random() * W, y: Math.random() * H, vx: _vtRnd(-0.12, 0.12) * D, vy: _vtRnd(-0.06, 0.06) * D, s: _vtRnd(0.6, 2.2) * D, a: _vtRnd(0.12, 0.4), ph: _vtRnd(0, 6.28), c: _vtPick(col) }; },
      step(p, W, H, D, dt) { const f = dt / 16; p.ph += 0.01 * f; p.x += (p.vx + Math.sin(p.ph) * 0.1 * D) * f; p.y += p.vy * f; if (p.x < 0) p.x = W; else if (p.x > W) p.x = 0; if (p.y < 0) p.y = H; else if (p.y > H) p.y = 0; },
      draw(ctx, p) { ctx.globalAlpha = p.a; ctx.fillStyle = p.c; ctx.beginPath(); ctx.arc(p.x, p.y, p.s, 0, 6.283); ctx.fill(); },
    },
    // Sparkles — star-bursts that twinkle in and out. Magic / crystal / glam.
    sparkles: {
      spawn(W, H, D, col) { return { x: Math.random() * W, y: Math.random() * H, s: _vtRnd(2, 6) * D, ph: _vtRnd(0, 6.28), vp: _vtRnd(0.03, 0.07), c: _vtPick(col) }; },
      step(p, W, H, D, dt) { const f = dt / 16; p.ph += p.vp * f; if (p.ph > 6.283) { p.ph -= 6.283; p.x = Math.random() * W; p.y = Math.random() * H; } },
      draw(ctx, p) { const t = Math.sin(p.ph); if (t <= 0) return; const a = t, r = p.s * t; ctx.globalAlpha = a; ctx.strokeStyle = p.c; ctx.lineWidth = Math.max(1, p.s * 0.18); ctx.shadowColor = p.c; ctx.shadowBlur = p.s * 2; ctx.beginPath(); ctx.moveTo(p.x - r, p.y); ctx.lineTo(p.x + r, p.y); ctx.moveTo(p.x, p.y - r); ctx.lineTo(p.x, p.y + r); ctx.moveTo(p.x - r * 0.45, p.y - r * 0.45); ctx.lineTo(p.x + r * 0.45, p.y + r * 0.45); ctx.moveTo(p.x - r * 0.45, p.y + r * 0.45); ctx.lineTo(p.x + r * 0.45, p.y - r * 0.45); ctx.stroke(); },
    },
  };

  class SlotGame {
    constructor(containerId, gameConfig) {
      this.container = document.getElementById(containerId);
      if (!this.container) throw new Error(`CasinoEngine: #${containerId} not found`);
      this.gameId = gameConfig.id || gameConfig.gameId;
      if (!this.gameId) throw new Error('CasinoEngine: gameConfig.id is required');
      this.theme = gameConfig.studioTheme || {};
      // Per-game visual identity (palette / frame / spin button / symbol
      // animation / win-line / ambient particles). Drives _applyVisualTheme()
      // so every slot looks completely distinct. Optional — games without it
      // fall back to the studioTheme skin. See scripts/inject-visual-themes.js.
      this.visualTheme = gameConfig.visualTheme || null;
      this.displayName = gameConfig.name || 'Slot Game';
      // Page-supplied RTP (display-only; authoritative value comes from the
      // server later). Captured for the matrix-loader splash, which shows
      // before the server config is fetched.
      this._initialRtp = (gameConfig.rtp != null) ? gameConfig.rtp : gameConfig.rtpPercent;

      this.state = {
        balanceCents: 0,
        currency: 'USD',
        betCents: 100,
        spinning: false,
        game: null,
        lastSpin: null,
        freeSpinsAvailable: 0,
        seeds: null,
        // Autoplay state. null when not auto-spinning; otherwise:
        //   { remaining: N, startCount: N }
        // Stop conditions are checked at the end of each spin in _spin().
        // SPIN button doubles as the stop control when this is non-null.
        autoplay: null,
        // Free-spins bonus-run state. Tracks the cumulative used count
        // and total-won during a continuous run so the banner shows
        // "FREE SPIN 3 of 10 — won $24.50 so far". null when no run is
        // active. Activated when freeSpinsAwarded > 0 + freeSpinsAvailable
        // was 0; retriggers add to total. Cleared when run ends.
        bonusRun: null,
        // Client-side current-session accumulators (presentation only —
        // surfaced in the info modal's "This session" block). These reset
        // on page load and never touch money/server-authority logic; they
        // only sum the cents the UI already displays per spin.
        sessionWinCents: 0,
        sessionWageredCents: 0,
        sessionSpins: 0,
        // Rolling last-N spin log (newest first), surfaced in the collapsible
        // win-history sidebar. Capped at HISTORY_MAX. Presentation only — each
        // entry mirrors numbers the UI already showed for that spin.
        spinHistory: [],
      };

      this._buildShell();
      // Inject the live-jackpot pill in the top-right corner. Public
      // endpoint (no auth), 30s poll. See _initJackpotPill for shape
      // resilience to server response variants.
      try { this._initJackpotPill(); } catch (_) { /* jackpot ticker is optional polish — never block game boot */ }
      // Recover any spin that was in-flight on a previous page-load.
      // Fire-and-forget — if the server replies with a recovered
      // outcome, the toast surfaces it; otherwise silent.
      try { this._reconcilePendingSpin(); } catch (_) {}
      this._boot();
    }

    async _boot() {
      if (!HAS_API) {
        this._fatal('Matrix Spins API client not loaded. Include js/api-client.js before casino-engine.js.');
        return;
      }
      // Matrix-rain boot splash. Best-effort + fully guarded: ensure the module
      // is present (dynamically injected from this script's own folder if the
      // page didn't include it), then show. If anything is missing, boot
      // proceeds normally — the loader is pure polish, never a gate.
      try {
        await this._ensureMatrixLoader();
        if (typeof window.MatrixLoader !== 'undefined') {
          window.MatrixLoader.show({ name: this.displayName || 'Loading', rtp: this._initialRtp });
        }
      } catch (_) { /* loader is optional — never block boot */ }
      const user = await window.MatrixSpinsAPI.loadSession();
      if (!user) {
        try { if (typeof window.MatrixLoader !== 'undefined') window.MatrixLoader.hide(); } catch (_) {}
        const next = encodeURIComponent(location.pathname + location.search);
        window.location.href = `../login.html?next=${next}`;
        return;
      }
      try {
        // ONLY the game config is required to render the reels. Balance,
        // seeds, and free-spins are enhancements — if any fail (e.g. the
        // DB is briefly degraded and /api/balance 503s), the game must
        // STILL load with the reels visible + a reconnect notice, NOT a
        // blank fatal page. Previously all four were in one Promise.all,
        // so a balance 503 blanked the whole game ("games don't load").
        const game = await window.MatrixSpinsAPI.getGame(this.gameId).then(r => r.game);
        if (!game) throw new Error('Game configuration not found.');
        this.state.game = game;
        this.state.betCents = Math.max(game.minBetCents, Math.min(game.betStepCents * 5, game.maxBetCents));

        // Non-fatal enhancements — settle independently.
        const [balanceR, seedsR, freeSpinsR] = await Promise.allSettled([
          window.MatrixSpinsAPI.getBalance(),
          window.MatrixSpinsAPI.getSeeds(),
          window.MatrixSpinsAPI.getFreeSpins(this.gameId),
        ]);
        if (balanceR.status === 'fulfilled' && balanceR.value) {
          this.state.balanceCents = balanceR.value.availableCents;
          this.state.currency = balanceR.value.currency || this.state.currency;
        } else {
          // Balance unavailable (degraded DB / network). Render anyway and
          // flag it — spins will surface the real error if attempted.
          this.state.balanceCents = 0;
          this._balanceUnavailable = true;
        }
        if (seedsR.status === 'fulfilled') this.state.seeds = seedsR.value;
        if (freeSpinsR.status === 'fulfilled' && freeSpinsR.value) {
          this.state.freeSpinsAvailable = (freeSpinsR.value.grants || []).reduce((a, g) => a + g.remaining, 0);
        }
        // Load the per-game symbol-art manifest before first paint so reels
        // render bitmap tiles directly (no emoji→image flash). Tolerant:
        // never throws, so a missing/!ok manifest just yields emoji reels.
        await this._loadSymbolArt();
        this._render();
        // Reels are painted — tear down the boot splash. MatrixLoader enforces
        // its own minimum-display window, so this won't flash on fast boots.
        try { if (typeof window.MatrixLoader !== 'undefined') window.MatrixLoader.hide(); } catch (_) {}
        if (this._balanceUnavailable) {
          this.winStrip && (this.winStrip.textContent = 'Reconnecting to your balance…');
        }
        // First-visit-this-session game briefing (RTP / volatility / bet range /
        // features). Shows once per game per browser session; never gates play.
        try { this._maybeShowPreSpinInfo(); } catch (_) { /* briefing is polish — never block boot */ }
      } catch (err) {
        // Always dismiss the splash on the error path so a boot failure can
        // never leave the overlay stuck over the fatal message.
        try { if (typeof window.MatrixLoader !== 'undefined') window.MatrixLoader.hide(); } catch (_) {}
        this._fatal(err.message || 'Failed to load game.');
      }
    }

    // Ensure window.MatrixLoader is available, dynamically injecting
    // js/matrix-loader.js if the page didn't include it. The path is derived
    // from THIS script's own src (ENGINE_SCRIPT_SRC) so it resolves correctly
    // whether the page is /index.html or /games/<slug>.html — both load the
    // engine as a sibling of matrix-loader.js. Resolves quietly (never
    // rejects): if injection fails, boot proceeds without the loader.
    _ensureMatrixLoader() {
      return new Promise((resolve) => {
        try {
          if (typeof window.MatrixLoader !== 'undefined') { resolve(); return; }
          if (!ENGINE_SCRIPT_SRC) { resolve(); return; }
          // If a prior boot already kicked off the inject, reuse that load.
          const existing = document.getElementById('ce-matrix-loader-js');
          if (existing) {
            existing.addEventListener('load', () => resolve(), { once: true });
            existing.addEventListener('error', () => resolve(), { once: true });
            // It may already be loaded; resolve on next tick as a fallback.
            setTimeout(resolve, 0);
            return;
          }
          const url = ENGINE_SCRIPT_SRC.replace(/casino-engine\.js(\?.*)?$/, 'matrix-loader.js');
          const tag = document.createElement('script');
          tag.id = 'ce-matrix-loader-js';
          tag.src = url;
          tag.async = false;
          tag.addEventListener('load', () => resolve(), { once: true });
          tag.addEventListener('error', () => resolve(), { once: true });
          (document.head || document.documentElement).appendChild(tag);
          // Hard safety: never let a hung script request stall boot.
          setTimeout(resolve, 2500);
        } catch (_) {
          resolve();
        }
      });
    }

    // Inject the studio display/body fonts (Cinzel, Orbitron, Black Ops One,
    // Playfair, …) once per page. The game HTML only loads Inter + Plus Jakarta
    // Sans, so each studio's themed font silently fell back to a generic
    // serif/sans — the per-game GUIs all looked the same. Loading the full set
    // lets each studio render in its real typeface.
    _injectThemeFonts() {
      if (document.getElementById('ce-theme-fonts')) return;
      const link = document.createElement('link');
      link.id = 'ce-theme-fonts';
      link.rel = 'stylesheet';
      link.href = 'https://fonts.googleapis.com/css2?' + [
        'Cinzel:wght@500;700;900', 'Crimson+Text:wght@600;700', 'Orbitron:wght@600;700;900',
        'Black+Ops+One', 'Playfair+Display:wght@600;700;900', 'Fredoka+One', 'Righteous',
        'Poppins:wght@600;700;800', 'Lora:wght@500;600;700', 'Space+Mono:wght@700', 'Caveat:wght@600;700',
      ].map((f) => 'family=' + f).join('&') + '&display=swap';
      document.head.appendChild(link);
    }

    // Translate the full per-game studioTheme into CSS custom properties on the
    // engine root. The stylesheet (below) reads ONLY these vars, so every game
    // is skinned by its own palette / fonts / frame / glow — the engine used to
    // apply just primaryColor and throw the rest away.
    _applyThemeVars() {
      const t = this.theme || {};
      const root = this.container;
      const primary = t.primaryColor || '#D4A853';
      const secondary = t.secondaryColor || shade(primary, 18);
      const accent = t.accentColor || secondary;
      const win = t.winHighlight || '#FFD700';
      const reelBorder = t.reelBorder || primary;
      const vars = {
        '--ce-primary': primary,
        '--ce-primary-d': shade(primary, -26),
        '--ce-secondary': secondary,
        '--ce-secondary-d': shade(secondary, -26),
        '--ce-accent': accent,
        '--ce-win': win,
        '--ce-reel-bg': t.reelBg || '#0a0a15',
        '--ce-reel-border': reelBorder,
        '--ce-font-display': t.fontFamily || "'Plus Jakarta Sans', Inter, sans-serif",
        '--ce-font-body': t.fontFamilyBody || "'Inter', system-ui, sans-serif",
        '--ce-frame-border': t.borderStyle || ('2px solid ' + reelBorder),
        '--ce-frame-shadow': t.boxShadow || ('0 10px 40px ' + primary + '22, inset 0 0 30px ' + primary + '12'),
        '--ce-spin-glow': t.spinButtonGlow || ('0 0 26px ' + primary + '88'),
      };
      for (const [k, v] of Object.entries(vars)) root.style.setProperty(k, v);
      if (t.id) root.dataset.ceStudio = t.id;
      this._primary = primary;
    }

    // ──────────────────────────────────────────────────────────────────
    // COMPREHENSIVE PER-GAME VISUAL THEME
    //
    // Reads gameConfig.visualTheme and gives THIS game a completely unique
    // look that no other slot shares: its own palette, reel-frame material,
    // spin-button shape/glow, symbol-landing animation, win-line style, and
    // an animated ambient particle background. Layers (bottom→top):
    //   body art  <  #ce-vt-scrim (legibility + color glow)  <
    //   #ce-vt-particles canvas  <  game UI (.ce-root, z-index 2)
    // CSS variant rules are keyed off data-vt-* attributes on .ce-root.
    // Fully guarded — any failure leaves the studioTheme skin intact.
    // ──────────────────────────────────────────────────────────────────
    _applyVisualTheme() {
      const vt = this.visualTheme;
      if (!vt || typeof vt !== 'object') return;
      const root = this.container;
      const setVar = (k, v) => { if (v) root.style.setProperty(k, v); };
      // 1) Palette — override the studioTheme vars with the game's own hues.
      if (vt.primary) { setVar('--ce-primary', vt.primary); setVar('--ce-primary-d', shade(vt.primary, -26)); this._primary = vt.primary; }
      if (vt.secondary) { setVar('--ce-secondary', vt.secondary); setVar('--ce-secondary-d', shade(vt.secondary, -26)); }
      if (vt.accent) setVar('--ce-accent', vt.accent);
      if (vt.win) setVar('--ce-win', vt.win);
      // 2) Data hooks the variant stylesheet keys off.
      root.dataset.vtFrame = vt.frame || 'gold';
      root.dataset.vtSpin = vt.spin || 'round';
      root.dataset.vtSymanim = vt.symAnim || 'bounce';
      root.dataset.vtParticle = vt.particle || 'none';
      // 3) Variant stylesheet (frames / spin shapes / symbol anims / win lines).
      this._injectVisualThemeStyle();
      // 4) Layered ambient background (scrim + particle canvas).
      try { this._buildAmbientLayers(vt); } catch (_) { /* atmosphere is polish */ }
      // 5) Win-line config consumed by _drawPaylines().
      this._winLineCfg = vt.winLine || null;
      // 6) Tell the sound engine which procedural soundscape fits this game.
      // No-op unless the player has opted into ambient audio in settings.
      try {
        const cat = this._ambientCategory(vt);
        if (window.MatrixSound && window.MatrixSound.startAmbient) window.MatrixSound.startAmbient(cat);
      } catch (_) { /* ambience is optional polish */ }
    }

    // Pick the ambient soundscape category (egyptian / ocean / forest /
    // space / fire / neon / default) that best matches this game. Game
    // name + id keywords are the strongest signal; the visualTheme particle
    // type is the fallback. Pure presentation — drives only which looping
    // procedural bed MatrixSound plays when ambient audio is enabled.
    _ambientCategory(vt) {
      const hay = `${this.gameId || ''} ${this.displayName || ''}`.toLowerCase();
      const has = (words) => words.some(w => hay.indexOf(w) !== -1);
      if (has(['egypt', 'pharaoh', 'anubis', 'horus', 'isis', 'osiris', 'sphinx', 'pyramid', 'cleopatra', 'scarab', 'thoth', 'bastet', 'ra-', 'sun-god', 'nile', 'desert', 'dune', 'sahara', 'mummy'])) return 'egyptian';
      if (has(['ocean', 'sea-', 'coral', 'reef', 'shark', 'fish', 'koi', 'mermaid', 'siren', 'underwater', 'pearl', 'wave', 'atlantis', 'poseidon', 'nautical', 'aqua', 'tide', 'abyss'])) return 'ocean';
      if (has(['forest', 'grove', 'fairy', 'druid', 'enchant', 'woodland', 'nature', 'jungle', 'safari', 'elven', 'garden', 'blossom', 'bloom', 'spirit', 'leaf', 'tree'])) return 'forest';
      if (has(['space', 'cosmic', 'galaxy', 'nebula', 'stellar', 'star', 'astro', 'alien', 'quantum', 'pulsar', 'void', 'singularity', 'meteor', 'asteroid', 'planet', 'orbit', 'nexus', 'cosmos', 'lunar', 'moon'])) return 'space';
      if (has(['fire', 'inferno', 'flame', 'demon', 'phoenix', 'dragon', 'lava', 'volcano', 'ember', 'hell', 'blaze', 'scorch', 'magma', 'heat', 'burning'])) return 'fire';
      if (has(['neon', 'cyber', 'robot', 'machine', 'circuit', 'electric', 'digital', 'tech', 'clockwork', 'steampunk', 'turbo', 'flux', 'pulse', 'singular', 'matrix', 'chrome'])) return 'neon';
      // Particle fallback.
      const p = (vt && vt.particle) || '';
      if (/(bubble|drop|water)/.test(p)) return 'ocean';
      if (/(ember|spark|ash|fire|flame)/.test(p)) return 'fire';
      if (/(star|cosmic|nebula|orbit)/.test(p)) return 'space';
      if (/(leaf|leaves|petal|pollen|firefly|fireflies)/.test(p)) return 'forest';
      if (/(sand|dust)/.test(p)) return 'egyptian';
      if (/(neon|glitch|data|grid|circuit)/.test(p)) return 'neon';
      return 'default';
    }

    // Build the fixed scrim + particle canvas behind the game UI. The
    // container itself is made transparent and lifted to z-index 2 so the
    // particles read between the body art and the reels.
    _buildAmbientLayers(vt) {
      const root = this.container;
      root.style.background = 'transparent';
      root.style.position = 'relative';
      root.style.zIndex = '2';
      const tint = vt.primary || this._primary || '#D4A853';
      let scrim = document.getElementById('ce-vt-scrim');
      if (!scrim) { scrim = document.createElement('div'); scrim.id = 'ce-vt-scrim'; scrim.setAttribute('aria-hidden', 'true'); document.body.appendChild(scrim); }
      const base = vt.bgGradient || 'linear-gradient(180deg, rgba(7,9,13,.55) 0%, rgba(7,9,13,.72) 52%, rgba(7,9,13,.9) 100%)';
      scrim.style.cssText = `position:fixed;inset:0;z-index:0;pointer-events:none;background:radial-gradient(120% 80% at 50% -10%, ${_vtRgba(tint, 0.18)} 0%, rgba(0,0,0,0) 55%), ${base};`;
      this._initAmbientParticles(vt);
    }

    // Single-canvas ambient particle layer. ~15 selectable types; 8–44
    // recycled particles; rAF with Page-Visibility pause; skipped under
    // prefers-reduced-motion. Idempotent (tears down a prior layer first).
    _initAmbientParticles(vt) {
      if (this._vtRaf) { cancelAnimationFrame(this._vtRaf); this._vtRaf = null; }
      if (this._vtCanvas) { try { this._vtCanvas.remove(); } catch (_) {} this._vtCanvas = null; }
      if (this._vtCleanup) { try { this._vtCleanup(); } catch (_) {} this._vtCleanup = null; }
      const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      const type = vt.particle;
      const spec = type && PARTICLE_SPECS[type];
      if (!spec || reduce) return;
      const canvas = document.createElement('canvas');
      canvas.id = 'ce-vt-particles';
      canvas.setAttribute('aria-hidden', 'true');
      canvas.style.cssText = 'position:fixed;inset:0;z-index:1;pointer-events:none;';
      document.body.appendChild(canvas);
      this._vtCanvas = canvas;
      const ctx = canvas.getContext('2d');
      if (!ctx) { canvas.remove(); this._vtCanvas = null; return; }
      const D = Math.min(window.devicePixelRatio || 1, 1.5);
      let W = 0, H = 0;
      const resize = () => {
        W = canvas.width = Math.max(1, Math.floor(window.innerWidth * D));
        H = canvas.height = Math.max(1, Math.floor(window.innerHeight * D));
        canvas.style.width = window.innerWidth + 'px';
        canvas.style.height = window.innerHeight + 'px';
      };
      resize();
      const colors = Array.isArray(vt.particleColor) ? vt.particleColor.slice()
        : [vt.particleColor || vt.accent || vt.primary || '#ffffff'];
      const n = spec.count != null ? spec.count : Math.max(8, Math.min(44, vt.density || 28));
      const P = [];
      for (let i = 0; i < n; i++) P.push(spec.spawn(W, H, D, colors, i, n));
      let last = 0, running = true;
      const tick = (ts) => {
        if (!running) return;
        const dt = last ? Math.min(50, ts - last) : 16; last = ts;
        ctx.clearRect(0, 0, W, H);
        if (spec.frame) spec.frame(ctx, W, H, D, ts, colors);
        for (let i = 0; i < P.length; i++) { spec.step(P[i], W, H, D, dt, colors); spec.draw(ctx, P[i], D); }
        ctx.globalAlpha = 1; ctx.shadowBlur = 0;
        this._vtRaf = requestAnimationFrame(tick);
      };
      this._vtRaf = requestAnimationFrame(tick);
      const onVis = () => {
        if (document.hidden) { running = false; if (this._vtRaf) { cancelAnimationFrame(this._vtRaf); this._vtRaf = null; } }
        else if (!running) { running = true; last = 0; this._vtRaf = requestAnimationFrame(tick); }
      };
      let rt = null;
      const onResize = () => { clearTimeout(rt); rt = setTimeout(resize, 200); };
      document.addEventListener('visibilitychange', onVis);
      window.addEventListener('resize', onResize);
      this._vtCleanup = () => {
        document.removeEventListener('visibilitychange', onVis);
        window.removeEventListener('resize', onResize);
        clearTimeout(rt);
      };
    }

    // Inject the visual-theme variant stylesheet once per page. Every rule is
    // keyed off a data-vt-* attribute on .ce-root and reads the live theme
    // CSS vars, so it composes with the studioTheme skin. The reduced-motion
    // guard MUST stay LAST in this block so it wins the cascade.
    _injectVisualThemeStyle() {
      if (document.getElementById('ce-vt-style')) return;
      const s = document.createElement('style');
      s.id = 'ce-vt-style';
      s.textContent = `
        /* ── Reel-frame materials (data-vt-frame) ── */
        .ce-root[data-vt-frame] .ce-reelbox { transition: box-shadow .4s ease; }
        .ce-root[data-vt-frame="silver"] .ce-reelbox { border: 4px solid #c9d2dc; border-image: linear-gradient(135deg,#f5f7fa,#9aa6b4 45%,#e8edf2 55%,#7d8896) 1; box-shadow: 0 0 28px rgba(201,210,220,.32), inset 0 0 22px rgba(201,210,220,.12); }
        .ce-root[data-vt-frame="wood"] .ce-reelbox { border: 7px solid #6b4423; border-image: repeating-linear-gradient(115deg,#7a4a26,#7a4a26 7px,#5c361b 7px,#5c361b 14px) 7; box-shadow: 0 0 24px rgba(90,54,27,.5), inset 0 0 26px rgba(0,0,0,.45); }
        .ce-root[data-vt-frame="crystal"] .ce-reelbox { border: 3px solid color-mix(in srgb, var(--ce-accent) 70%, #fff); box-shadow: 0 0 34px color-mix(in srgb, var(--ce-accent) 55%, transparent), inset 0 0 30px color-mix(in srgb, var(--ce-accent) 22%, transparent); background: linear-gradient(160deg, color-mix(in srgb, var(--ce-accent) 10%, transparent), rgba(0,0,0,.45)); }
        .ce-root[data-vt-frame="neon"] .ce-reelbox { border: 2px solid var(--ce-primary); box-shadow: 0 0 8px var(--ce-primary), 0 0 26px color-mix(in srgb, var(--ce-primary) 70%, transparent), inset 0 0 18px color-mix(in srgb, var(--ce-primary) 45%, transparent); }
        .ce-root[data-vt-frame="neon"] .ce-reelbox::before { box-shadow: inset 0 0 0 1px var(--ce-accent), 0 0 12px color-mix(in srgb, var(--ce-accent) 60%, transparent); }
        .ce-root[data-vt-frame="stone"] .ce-reelbox { border: 8px solid #59606b; border-image: linear-gradient(135deg,#7c8390,#3f444c 50%,#6a7079) 8; box-shadow: 0 0 20px rgba(0,0,0,.55), inset 0 0 24px rgba(0,0,0,.5); }
        .ce-root[data-vt-frame="jade"] .ce-reelbox { border: 4px solid #2fb98a; border-image: linear-gradient(135deg,#7ff0c4,#149c6e 50%,#3fd6a0) 1; box-shadow: 0 0 30px rgba(47,185,138,.4), inset 0 0 22px rgba(47,185,138,.16); }
        .ce-root[data-vt-frame="obsidian"] .ce-reelbox { border: 3px solid #14161c; box-shadow: 0 0 22px rgba(0,0,0,.7), inset 0 0 0 1px color-mix(in srgb, var(--ce-primary) 55%, transparent), inset 0 0 26px rgba(0,0,0,.6); background: linear-gradient(160deg,#0b0c10,#1a1d25); }
        .ce-root[data-vt-frame="bamboo"] .ce-reelbox { border: 6px solid #6a994e; border-image: repeating-linear-gradient(0deg,#a7c957,#a7c957 12px,#6a994e 12px,#6a994e 16px) 6; box-shadow: 0 0 20px rgba(106,153,78,.4), inset 0 0 22px rgba(0,0,0,.4); }
        .ce-root[data-vt-frame="copper"] .ce-reelbox { border: 5px solid #b87333; border-image: linear-gradient(135deg,#e8a76b,#8a4f1e 50%,#c9803f) 1; box-shadow: 0 0 26px rgba(184,115,51,.42), inset 0 0 22px rgba(120,70,30,.3); }
        .ce-root[data-vt-frame="ice"] .ce-reelbox { border: 3px solid #bfe9ff; border-image: linear-gradient(135deg,#eaf8ff,#7fc3e8 50%,#cdeeff) 1; box-shadow: 0 0 32px rgba(150,210,240,.4), inset 0 0 26px rgba(190,230,255,.18); }
        .ce-root[data-vt-frame="bone"] .ce-reelbox { border: 5px solid #d9cfb8; border-image: linear-gradient(135deg,#efe7d2,#b3a888 50%,#ddd3bb) 1; box-shadow: 0 0 18px rgba(0,0,0,.5), inset 0 0 22px rgba(0,0,0,.4); }
        .ce-root[data-vt-frame="coral"] .ce-reelbox { border: 4px solid #ff7e6b; border-image: linear-gradient(135deg,#ffb199,#ff5e7e 55%,#ff8f70) 1; box-shadow: 0 0 28px rgba(255,126,107,.38), inset 0 0 22px rgba(255,126,107,.14); }
        .ce-root[data-vt-frame="velvet"] .ce-reelbox { border: 5px solid #7a1330; box-shadow: 0 0 30px rgba(120,20,48,.45), inset 0 0 34px rgba(0,0,0,.55); background: radial-gradient(120% 100% at 50% 0%, rgba(120,20,48,.28), rgba(0,0,0,.5)); }

        /* ── Spin-button shapes (data-vt-spin) ── */
        .ce-root[data-vt-spin="hex"] .ce-btn.primary.ce-spin { border-radius: 14px; clip-path: polygon(25% 4%,75% 4%,100% 50%,75% 96%,25% 96%,0% 50%); }
        .ce-root[data-vt-spin="gem"] .ce-btn.primary.ce-spin { border-radius: 12px; clip-path: polygon(50% 0,85% 18%,100% 50%,85% 82%,50% 100%,15% 82%,0 50%,15% 18%); }
        .ce-root[data-vt-spin="shield"] .ce-btn.primary.ce-spin { border-radius: 12px; clip-path: polygon(50% 0,100% 14%,100% 60%,50% 100%,0 60%,0 14%); }
        .ce-root[data-vt-spin="diamond"] .ce-btn.primary.ce-spin { clip-path: polygon(50% 0,100% 50%,50% 100%,0 50%); }
        .ce-root[data-vt-spin="hex"] .ce-btn.primary.ce-spin::before,
        .ce-root[data-vt-spin="gem"] .ce-btn.primary.ce-spin::before,
        .ce-root[data-vt-spin="shield"] .ce-btn.primary.ce-spin::before,
        .ce-root[data-vt-spin="diamond"] .ce-btn.primary.ce-spin::before { display: none; }
        .ce-root[data-vt-spin="ring"] .ce-btn.primary.ce-spin { box-shadow: var(--ce-spin-glow), 0 0 0 4px color-mix(in srgb, var(--ce-win) 70%, transparent), 0 0 0 7px color-mix(in srgb, var(--ce-primary) 40%, transparent), 0 6px 18px rgba(0,0,0,.5); }
        .ce-root[data-vt-spin="pulsar"] .ce-btn.primary.ce-spin::before { animation-duration: 1.6s; opacity: 1; }

        /* ── Symbol landing animations (data-vt-symanim) ── */
        .ce-root[data-vt-symanim="spin"] .ce-cell.just-landed { animation: ceVtSpin 360ms cubic-bezier(.2,.9,.3,1) both; }
        .ce-root[data-vt-symanim="flip"] .ce-cell.just-landed { animation: ceVtFlip 420ms cubic-bezier(.3,.8,.3,1) both; }
        .ce-root[data-vt-symanim="pulse"] .ce-cell.just-landed { animation: ceVtPulse 360ms ease both; }
        .ce-root[data-vt-symanim="shimmer"] .ce-cell.just-landed { animation: ceVtShimmer 520ms ease both; }
        .ce-root[data-vt-symanim="grow"] .ce-cell.just-landed { animation: ceVtGrow 320ms cubic-bezier(.2,1.4,.5,1) both; }
        .ce-root[data-vt-symanim="wobble"] .ce-cell.just-landed { animation: ceVtWobble 480ms ease both; }
        @keyframes ceVtSpin { 0% { transform: rotate(-180deg) scale(.5); opacity: .3; } 100% { transform: rotate(0) scale(1); opacity: 1; } }
        @keyframes ceVtFlip { 0% { transform: perspective(320px) rotateY(90deg); opacity: .2; } 100% { transform: perspective(320px) rotateY(0); opacity: 1; } }
        @keyframes ceVtPulse { 0% { transform: scale(.6); filter: brightness(1.6); } 55% { transform: scale(1.14); } 100% { transform: scale(1); filter: brightness(1); } }
        @keyframes ceVtShimmer { 0% { filter: brightness(2.2) saturate(1.6); transform: scale(.92); } 100% { filter: brightness(1) saturate(1); transform: scale(1); } }
        @keyframes ceVtGrow { 0% { transform: scale(0); } 100% { transform: scale(1); } }
        @keyframes ceVtWobble { 0% { transform: rotate(0); } 20% { transform: rotate(-9deg) scale(1.05); } 45% { transform: rotate(7deg); } 70% { transform: rotate(-4deg); } 100% { transform: rotate(0) scale(1); } }

        /* Highlight glow follows the live primary var (overrides the baked literal). */
        .ce-root .ce-cell.highlight { box-shadow: 0 0 12px var(--ce-primary), 0 0 24px color-mix(in srgb, var(--ce-primary) 42%, transparent); }

        /* Marching win-line dash for dashed/dotted styles (see _drawPaylines). */
        @keyframes ceVtMarch { to { stroke-dashoffset: -40; } }

        /* ── Reduced-motion guard (MUST be last so it wins the cascade) ── */
        @media (prefers-reduced-motion: reduce) {
          .ce-root[data-vt-symanim] .ce-cell.just-landed { animation: ceLand 240ms ease both; }
          .ce-root[data-vt-spin] .ce-btn.primary.ce-spin::before { animation: none; }
          .ce-payline-svg path { animation: none !important; }
        }
      `;
      document.head.appendChild(s);
    }

    _buildShell() {
      const theme = this.theme;
      const primary = theme.primaryColor || '#D4A853';
      const container = this.container;
      this._injectThemeFonts();
      this._applyThemeVars();
      // Translucent scrim instead of an opaque fill, so the per-game background
      // art set on <body> (scripts/map-and-generate-assets.js — one .webp per
      // game) reads through as atmosphere while keeping the topbar/reels legible.
      // If the art ever fails to load, <body>'s flat #0D0F14 shows through.
      container.style.background = 'linear-gradient(180deg, rgba(7,9,13,0.52) 0%, rgba(7,9,13,0.72) 55%, rgba(7,9,13,0.86) 100%)';
      container.style.minHeight = '100vh';
      container.style.color = '#F0F0F5';
      container.style.fontFamily = 'var(--ce-font-body)';
      container.style.position = 'relative';
      container.style.paddingBottom = '2rem';
      container.classList.add('ce-root');
      container.replaceChildren();

      // ── Game header ── home · provider logo · styled game name | balance ·
      // sound toggle · info — all in the Matrix-green brand. Replaces the old
      // "← Lobby / Wallet / Account" bar with a premium slot-machine header.
      this.topbar = $el('div', { style: {
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        padding: '.7rem 1.1rem', gap: '.6rem', background: 'rgba(0,0,0,.42)',
        borderBottom: `1px solid color-mix(in srgb, #00ff41 30%, transparent)`,
        backdropFilter: 'blur(8px)',
      }});

      const home = $el('a', { class: 'ce-hdr-home', href: '../index.html', 'aria-label': 'Back to lobby', title: 'Lobby' },
        $el('span', {}, 'Lobby'));
      // ⌂ home glyph node prepended (kept out of the label span so the label
      // hides on mobile while the glyph stays).
      home.insertBefore(document.createTextNode('⌂'), home.firstChild);

      const left = $el('div', { class: 'ce-hdr-left' }, home);
      // Provider logo (per-studio SVG). Path is relative to the game page
      // (/games/<slug>.html → ../assets/...). Hidden if it fails to load.
      const logoUrl = this.theme && this.theme.logoUrl;
      if (logoUrl) {
        const src = /^(https?:|\/)/.test(logoUrl) ? logoUrl : '../' + logoUrl;
        const logo = $el('img', { class: 'ce-prov-logo', alt: (this.theme.name || 'Studio') + ' logo', src });
        logo.addEventListener('error', () => { logo.style.display = 'none'; }, { once: true });
        left.appendChild(logo);
      }
      left.appendChild($el('div', { class: 'ce-hdr-name' }, this.displayName));

      // Balance chip doubles as the wallet/deposit shortcut (keeps the revenue
      // path one tap away now that the explicit Wallet link is gone).
      this.balanceChip = $el('a', { class: 'ce-bal-chip', href: '../wallet.html', title: 'Wallet & deposits' }, '—');

      const soundBtn = $el('button', {
        class: 'ce-iconbtn', type: 'button', 'aria-label': 'Sound settings', title: 'Sound settings',
        onclick: () => {
          try {
            // Prefer the full settings panel (master volume + SFX/Music/
            // Ambient toggles); fall back to a plain mute toggle on an
            // older sound-manager build.
            if (window.MatrixSound && window.MatrixSound.openSettings) {
              window.MatrixSound.openSettings();
            } else if (window.MatrixSound && window.MatrixSound.toggleMute) {
              window.MatrixSound.toggleMute();
              soundBtn.textContent = window.MatrixSound.isMuted() ? '🔇' : '🔊';
            }
          } catch (_) { /* sound is optional polish */ }
        },
      }, '🔊');
      try { if (window.MatrixSound && window.MatrixSound.isMuted && window.MatrixSound.isMuted()) soundBtn.textContent = '🔇'; } catch (_) {}

      const infoTop = $el('button', {
        class: 'ce-iconbtn', type: 'button', 'aria-label': 'Game information and paytable',
        title: 'Paytable & info', style: { fontStyle: 'italic', fontFamily: 'var(--ce-font-display)' },
        onclick: () => this._showInfoModal(),
      }, 'i');

      const right = $el('div', { class: 'ce-hdr-right' }, this.balanceChip, soundBtn, infoTop);
      this.topbar.append(left, right);
      container.appendChild(this.topbar);

      this.main = $el('div', { style: { maxWidth: '1100px', margin: '1.5rem auto 0', padding: '0 1rem' } });
      container.appendChild(this.main);

      this.loading = $el('div', { style: { textAlign: 'center', padding: '3rem 0', opacity: .7 } }, 'Loading game…');
      this.main.appendChild(this.loading);

      this._bindKeyboard();
      // Apply the comprehensive per-game visual theme LAST so its scrim +
      // particle layers and transparent-container override win over the
      // default background set above. Guarded — never blocks boot.
      try { this._applyVisualTheme(); } catch (_) { /* visual theme is polish */ }
    }

    // Keyboard controls (premium desktop UX): Space or Enter spins. While a
    // spin is animating, the same key fast-forwards the reveal (tap-to-skip);
    // during autoplay it stops the run. Ignored when the user is typing in a
    // field, when a button/link/summary already owns the key (so the native
    // click isn't doubled), or when a modal/picker is open. Bound once.
    _bindKeyboard() {
      if (this._keyBound) return;
      this._keyBound = true;
      document.addEventListener('keydown', (e) => {
        if (e.code !== 'Space' && e.key !== ' ' && e.key !== 'Enter') return;
        const t = e.target;
        if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable ||
                  t.tagName === 'BUTTON' || t.tagName === 'A' || t.tagName === 'SUMMARY' || t.tagName === 'SELECT')) return;
        if (document.getElementById('ce-info-overlay') || document.getElementById('ce-autoplay-picker')) return;
        if (!this.state.game || !this.spinBtn) return; // not loaded yet
        e.preventDefault();
        if (this.state.spinning) { this._skipAnim = true; return; }
        if (this.state.autoplay) { this._stopAutoplay(); return; }
        this._spin(false);
      });
    }

    _fatal(msg) {
      this.main.innerHTML = '';
      this.main.appendChild(
        $el('div', { style: { background: '#3a1212', border: '1px solid #ef4444', color: '#ffb3b3', padding: '1.2rem', borderRadius: '10px', textAlign: 'center', margin: '2rem auto', maxWidth: 520 } },
          $el('strong', {}, 'Unable to load this game. '),
          document.createTextNode(msg),
        ),
      );
    }

    _render() {
      const game = this.state.game;
      const primary = this._primary;
      this.main.innerHTML = '';
      this._updateBalanceChip();

      this.main.appendChild(
        $el('div', { style: { textAlign: 'center', padding: '.6rem 0 1.2rem' } },
          $el('h1', { class: 'ce-title' }, game.name || this.displayName),
          $el('p', { class: 'ce-subtitle', style: { marginTop: '.3rem' } },
            // RTP number deliberately omitted from this header per the
            // operator policy that removed per-game RTP claims from the
            // player-facing UI (commit b2eec40d). RTP disclosure lives
            // in T&Cs / help; the in-game paytable modal (i button) also
            // shows it for players who explicitly request the detail.
            `${game.volatility || ''} volatility  •  ${game.paylines} lines`
          ),
        )
      );

      this.reelBox = $el('div', { class: 'ce-reelbox', style: {
        margin: '0 auto', maxWidth: '860px',
      }});
      this.reelGrid = $el('div', { class: 'ce-reelgrid', style: {
        display: 'grid', gridTemplateColumns: `repeat(${game.reels}, 1fr)`, gap: '.4rem',
      }});
      // Seed the idle grid with the game's REAL symbols (random per cell)
      // so the reels look like a slot at rest. Previously every cell was
      // built with the literal '?' placeholder — which _symbolGlyph maps
      // to "?" — so before the first spin the whole grid showed question
      // marks ("reels don't display properly"). Math.random is fine here:
      // this is purely cosmetic idle decoration, not an outcome (the
      // server decides every real spin; the roll animation already uses
      // Math.random the same way).
      const idleSymbols = (game.symbols && game.symbols.length)
        ? game.symbols
        : ['cherry', 'lemon', 'orange', 'plum', 'bar', 'sevens', 'wild'];
      for (let r = 0; r < game.reels; r++) {
        const col = $el('div', { class: 'ce-col', style: {
          display: 'flex', flexDirection: 'column', gap: '.3rem',
        }});
        for (let y = 0; y < game.rows; y++) {
          const sym = idleSymbols[(Math.random() * idleSymbols.length) | 0];
          col.appendChild(this._makeCell(sym, r, y));
        }
        this.reelGrid.appendChild(col);
      }
      this.reelBox.appendChild(this.reelGrid);
      this.main.appendChild(this.reelBox);

      // Tap / click the reels mid-spin to skip the reveal animation and slam
      // the reels straight to their (already server-decided) final symbols.
      // Purely presentational fast-forward \u2014 the outcome is fixed before the
      // reveal loop runs, so this never affects money/server-authority.
      this.reelBox.addEventListener('click', () => { if (this.state.spinning) this._skipAnim = true; });

      this.winStrip = $el('div', { class: 'ce-winstrip' }, '\u00A0');
      this.main.appendChild(this.winStrip);

      // Visually-hidden polite live region: announces each spin's outcome to
      // assistive tech. The visual .ce-winstrip is NOT a live region, so without
      // this a screen-reader player gets zero feedback after a spin (WCAG 4.1.3
      // Status Messages). Written once per spin, after the balance is finalized.
      this.srAnnounce = $el('div', {
        class: 'ce-sr-announce', role: 'status', 'aria-live': 'polite', 'aria-atomic': 'true',
      });
      this.main.appendChild(this.srAnnounce);

      // Persistent BET / WIN / BALANCE meter — premium-slot standard. The
      // top-bar balance chip + control-row bet label still exist; this strip
      // consolidates the three numbers that matter into one always-visible
      // surface. The WIN cell counts up after each win and resets at spin
      // start. Presentation only — reads state the engine already maintains.
      const meter = $el('div', { class: 'ce-meter' });
      const meterCell = (label, ref) => {
        const cell = $el('div', { class: 'ce-meter-cell' });
        cell.appendChild($el('div', { class: 'ce-meter-label' }, label));
        const v = $el('div', { class: 'ce-meter-val' }, fmt(0));
        cell.appendChild(v);
        this[ref] = v;
        return cell;
      };
      meter.append(
        meterCell('Bet', 'meterBet'),
        meterCell('Win', 'meterWin'),
        meterCell('Balance', 'meterBalance'),
      );
      this.meter = meter;
      this.main.appendChild(meter);
      this._updateMeter();

      const controlBar = $el('div', { class: 'ce-panel', style: {
        display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '.8rem',
        marginTop: '1rem', flexWrap: 'wrap',
      }});

      // Bet steppers — hold-to-repeat: pointerdown starts a repeating
      // interval (150 ms cadence after a 350 ms initial delay) so a long
      // press auto-increments. pointerup/leave/cancel/blur all stop it.
      // Falls back to a single click when the user just taps.
      const makeStepper = (dir, label) => {
        const btn = $el('button', { class: 'ce-btn ce-btn-stepper', 'aria-label': dir > 0 ? 'Increase bet' : 'Decrease bet' }, label);
        let initialTimer = null;
        let repeatTimer = null;
        const start = (e) => {
          if (e && e.cancelable) e.preventDefault();
          this._changeBet(dir);
          initialTimer = setTimeout(() => {
            repeatTimer = setInterval(() => this._changeBet(dir), 150);
          }, 350);
        };
        const stop = () => {
          if (initialTimer) { clearTimeout(initialTimer); initialTimer = null; }
          if (repeatTimer)  { clearInterval(repeatTimer); repeatTimer = null; }
        };
        btn.addEventListener('pointerdown', start);
        btn.addEventListener('pointerup', stop);
        btn.addEventListener('pointerleave', stop);
        btn.addEventListener('pointercancel', stop);
        btn.addEventListener('blur', stop);
        return btn;
      };

      const betMinus = makeStepper(-1, '−');
      const betPlus  = makeStepper(+1, '+');
      this.betLabel  = $el('div', { class: 'ce-betlabel' }, fmt(this.state.betCents));
      // Max Bet shortcut — single click jumps to game.maxBetCents.
      // Previously the player had to press + repeatedly to reach the max,
      // which is an industry-standard premium UX gap.
      const betMax = $el('button', {
        class: 'ce-btn ce-btn-maxbet',
        'aria-label': 'Set bet to maximum',
        onclick: () => this._maxBet(),
      }, 'MAX');
      // Paytable / game-info button. Reads from this.state.game.paytable
      // which the API already includes. Closes a premium UX gap — the
      // previous build never surfaced symbol payouts mid-game even
      // though the data was loaded.
      const infoBtn = $el('button', {
        class: 'ce-btn ce-btn-info',
        'aria-label': 'Game information and paytable',
        title: 'Paytable',
        onclick: () => this._showInfoModal(),
      }, 'i');
      // Turbo speed toggle — cycles normal → fast → turbo. Industry-
      // standard premium feature. Gates two timing constants in _spin:
      // the rolling-symbol cadence (80→50→25ms) and the per-reel stop
      // delay (240→140→70ms). Near-miss anticipation slowdown still
      // applies on top — turbo affects the BASE speed, not the
      // tension beat. Persisted in localStorage per-game.
      const turboBtn = $el('button', {
        class: 'ce-btn ce-btn-turbo',
        'aria-label': 'Reel speed',
        title: 'Reel speed (Normal / Fast / Turbo)',
        onclick: () => this._cycleSpinSpeed(),
      }, '⚡');
      this.turboBtn = turboBtn;
      // Hydrate from localStorage. Default 0 = normal.
      try {
        const stored = parseInt(localStorage.getItem('ceSpinSpeed_' + this.gameId), 10);
        this.state.spinSpeed = (stored === 1 || stored === 2) ? stored : 0;
      } catch (_) { this.state.spinSpeed = 0; }
      this._updateTurboBtnLabel();

      // Autoplay button — opens the run-length picker. Hidden when an
      // autoplay run is already active; the SPIN button doubles as STOP
      // in that case. Industry-standard premium feature the audit
      // flagged as absent.
      const autoBtn = $el('button', {
        class: 'ce-btn ce-btn-auto',
        'aria-label': 'Start autoplay',
        title: 'Autoplay',
        onclick: (e) => this._showAutoplayPicker(e.currentTarget),
      }, 'AUTO');
      this.autoBtn = autoBtn;
      // Win-history toggle — opens the collapsible last-20-spins sidebar.
      // Lives in the control bar (the engine owns the whole game UI; there is
      // no separate page header on a game page). Presentation only.
      const histBtn = $el('button', {
        class: 'ce-btn ce-btn-history',
        'aria-label': 'Spin history',
        'aria-expanded': 'false',
        title: 'Spin history',
        onclick: () => this._toggleHistory(),
      }, '🕑');
      this.histBtn = histBtn;
      // SPIN button doubles as STOP during autoplay — the onclick
      // checks this.state.autoplay to decide which mode is active.
      // _updateSpinBtnLabel keeps the visible text + aria-label in
      // sync with the current state.
      this.spinBtn = $el('button', {
        class: 'ce-btn primary ce-spin',
        'aria-label': 'Spin',
        onclick: () => {
          this._spinPress();
          if (this.state.autoplay) this._stopAutoplay();
          else this._spin(false);
        },
      }, 'SPIN');

      [betMinus, this.betLabel, betPlus, betMax, infoBtn, turboBtn, autoBtn, histBtn, this.spinBtn].forEach(b => controlBar.appendChild(b));
      this.main.appendChild(controlBar);

      // ── Bet presets (Min / Low / Med / High / Max) ──
      // Quick-jump chips computed from the game's bet bounds. Clicking a chip
      // sets the bet via _setBet (same state + UI sync the steppers use); the
      // chip matching the current bet is highlighted .active. Presentation
      // only — never touches spin/balance logic.
      const presetRow = $el('div', { class: 'ce-presets', role: 'group', 'aria-label': 'Bet presets' });
      this._betPresetBtns = [];
      this._betPresets().forEach(({ label, cents }) => {
        const btn = $el('button', {
          class: 'ce-btn ce-btn-preset',
          'aria-label': `Set bet to ${label} (${fmt(cents)})`,
          'aria-pressed': 'false',
          title: fmt(cents),
          onclick: () => this._setBet(cents),
        }, label);
        btn.dataset.cents = String(cents);
        this._betPresetBtns.push(btn);
        presetRow.appendChild(btn);
      });
      this.main.appendChild(presetRow);
      this._syncBetPresets();

      this.freeSpinsRow = $el('div', { style: { textAlign: 'center', marginTop: '.8rem', fontSize: '.9rem', opacity: .85 } });
      this.main.appendChild(this.freeSpinsRow);
      this._renderFreeSpins();

      this.main.appendChild(this._renderFairnessPanel());

      // Collapsible win-history sidebar (built once per render; the spin log in
      // this.state.spinHistory survives re-renders). Appended to the engine
      // container so it overlays the game UI as a fixed slide-in panel.
      this._buildHistorySidebar();

      if (!document.getElementById('ce-style')) {
        const s = document.createElement('style');
        s.id = 'ce-style';
        s.textContent = `
          /* ───────────────────────────────────────────────────────────────
             PER-GAME SKIN. Every rule below reads the CSS custom properties
             set by _applyThemeVars() from the game's full studioTheme, so each
             game renders in its own palette / fonts / frame / glow — the engine
             used to apply just primaryColor and discard the rest. This is what
             gives each slot a distinct "custom GUI" (NetEnt / Yggdrasil style:
             one premium engine, per-game skin). color-mix() derives translucent
             tints from the solid theme hexes.
             ─────────────────────────────────────────────────────────────── */
          .ce-title { margin: 0; font-family: var(--ce-font-display); font-size: clamp(1.5rem, 4.6vw, 2.4rem); font-weight: 900; letter-spacing: 2px; text-transform: uppercase; line-height: 1.1; color: var(--ce-primary); text-shadow: 0 0 20px color-mix(in srgb, var(--ce-primary) 45%, transparent), 0 2px 4px rgba(0,0,0,.6); }
          .ce-subtitle { margin: 0; opacity: .72; font-size: .8rem; letter-spacing: 1.5px; text-transform: uppercase; font-family: var(--ce-font-body); color: #d2d5dd; }

          /* Ornate themed reel frame (themed border + glow + corner brackets) */
          .ce-reelbox { position: relative; background: rgba(0,0,0,.4); border-radius: 16px; padding: 1.1rem; border: var(--ce-frame-border); box-shadow: var(--ce-frame-shadow); }
          .ce-reelbox::before { content: ''; position: absolute; inset: 6px; border-radius: 11px; pointer-events: none; box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--ce-accent) 38%, transparent); }
          .ce-reelbox::after { content: ''; position: absolute; inset: 0; border-radius: 16px; pointer-events: none; opacity: .8; filter: drop-shadow(0 0 4px var(--ce-win));
            background:
              linear-gradient(var(--ce-win),var(--ce-win)) 0 0/20px 3px no-repeat,
              linear-gradient(var(--ce-win),var(--ce-win)) 0 0/3px 20px no-repeat,
              linear-gradient(var(--ce-win),var(--ce-win)) 100% 0/20px 3px no-repeat,
              linear-gradient(var(--ce-win),var(--ce-win)) 100% 0/3px 20px no-repeat,
              linear-gradient(var(--ce-win),var(--ce-win)) 0 100%/20px 3px no-repeat,
              linear-gradient(var(--ce-win),var(--ce-win)) 0 100%/3px 20px no-repeat,
              linear-gradient(var(--ce-win),var(--ce-win)) 100% 100%/20px 3px no-repeat,
              linear-gradient(var(--ce-win),var(--ce-win)) 100% 100%/3px 20px no-repeat; }
          .ce-col { background: var(--ce-reel-bg, #0a0a15); border-radius: 10px; border: 1px solid color-mix(in srgb, var(--ce-reel-border) 32%, transparent); padding: .3rem; }
          .ce-winstrip { text-align: center; min-height: 2.4rem; margin-top: .8rem; font-size: 1.25rem; font-weight: 800; font-family: var(--ce-font-display); color: var(--ce-win); text-shadow: 0 0 14px color-mix(in srgb, var(--ce-win) 40%, transparent); transition: opacity .3s; }
          .ce-sr-announce { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0 0 0 0); clip-path: inset(50%); white-space: nowrap; border: 0; }

          /* Glassy themed control panel */
          .ce-panel { background: linear-gradient(180deg, rgba(10,12,18,.55), rgba(8,10,15,.78)); border: 1px solid color-mix(in srgb, var(--ce-primary) 38%, transparent); border-radius: 16px; padding: .85rem 1rem; box-shadow: inset 0 1px 0 rgba(255,255,255,.07), 0 8px 26px rgba(0,0,0,.4); -webkit-backdrop-filter: blur(7px); backdrop-filter: blur(7px); }
          .ce-betlabel { padding: .5rem 1rem; min-width: 130px; text-align: center; border: 1px solid color-mix(in srgb, var(--ce-primary) 50%, transparent); border-radius: 10px; color: var(--ce-primary); font-weight: 800; font-family: var(--ce-font-display); letter-spacing: 1px; background: rgba(0,0,0,.25); }

          /* Persistent BET / WIN / BALANCE meter */
          .ce-meter { display: grid; grid-template-columns: repeat(3, 1fr); gap: .5rem; max-width: 860px; margin: .7rem auto 0; }
          .ce-meter-cell { background: linear-gradient(180deg, rgba(10,12,18,.5), rgba(8,10,15,.74)); border: 1px solid color-mix(in srgb, var(--ce-primary) 26%, transparent); border-radius: 12px; padding: .5rem .4rem; text-align: center; }
          .ce-meter-cell:nth-child(2) { border-color: color-mix(in srgb, var(--ce-win) 38%, transparent); }
          .ce-meter-label { font-size: .62rem; letter-spacing: .14em; text-transform: uppercase; color: #9aa3b2; font-family: var(--ce-font-body); font-weight: 700; }
          .ce-meter-val { margin-top: .15rem; font-size: 1.12rem; font-weight: 800; font-family: var(--ce-font-display); color: #F0F0F5; font-variant-numeric: tabular-nums; }
          .ce-meter-cell:nth-child(2) .ce-meter-val { color: var(--ce-win); text-shadow: 0 0 12px color-mix(in srgb, var(--ce-win) 35%, transparent); }
          .ce-meter-cell:nth-child(3) .ce-meter-val { color: var(--ce-primary); }
          @media (max-width: 640px) { .ce-meter-val { font-size: .98rem; } .ce-meter-label { font-size: .56rem; } .ce-meter { gap: .35rem; } }

          /* Buttons */
          .ce-btn { padding: .6rem 1rem; background: transparent; color: #fff; border: 1px solid color-mix(in srgb, var(--ce-primary) 45%, transparent); border-radius: 10px; font: inherit; font-family: var(--ce-font-body); cursor: pointer; font-weight: 700; transition: transform 120ms ease, border-color 160ms ease, box-shadow 160ms ease; touch-action: manipulation; }
          .ce-btn:hover { border-color: var(--ce-primary); box-shadow: 0 0 12px color-mix(in srgb, var(--ce-primary) 32%, transparent); }
          .ce-btn:active { transform: scale(0.96); }
          .ce-btn:focus-visible { outline: 2px solid var(--ce-primary); outline-offset: 2px; }
          .ce-btn:disabled { opacity: .4; cursor: not-allowed; }
          .ce-btn-stepper { min-width: 46px; font-size: 1.2rem; color: var(--ce-primary); font-weight: 800; }
          .ce-btn-maxbet, .ce-btn-auto { background: linear-gradient(135deg, color-mix(in srgb, var(--ce-primary) 22%, transparent), transparent); border-color: color-mix(in srgb, var(--ce-primary) 55%, transparent); color: var(--ce-primary); letter-spacing: 1px; font-weight: 800; }
          .ce-btn-info, .ce-btn-turbo { min-width: 40px; min-height: 40px; padding: .4rem; border-radius: 50%; font-weight: 800; color: var(--ce-primary); background: linear-gradient(135deg, color-mix(in srgb, var(--ce-primary) 20%, transparent), transparent); border-color: color-mix(in srgb, var(--ce-primary) 50%, transparent); }
          .ce-btn-info { font-style: italic; font-family: var(--ce-font-display); font-size: 1.05rem; }

          /* ── Bet presets (Min / Low / Med / High / Max) ── */
          .ce-presets { display: flex; flex-wrap: wrap; justify-content: center; gap: .4rem; max-width: 860px; margin: .7rem auto 0; }
          .ce-btn-preset { padding: .42rem .9rem; font-size: .76rem; letter-spacing: .06em; text-transform: uppercase; font-weight: 800; color: color-mix(in srgb, var(--ce-primary) 82%, #fff); background: linear-gradient(180deg, color-mix(in srgb, var(--ce-primary) 14%, transparent), transparent); border: 1px solid color-mix(in srgb, var(--ce-primary) 38%, transparent); border-radius: 999px; }
          .ce-btn-preset:hover { border-color: var(--ce-primary); box-shadow: 0 0 10px color-mix(in srgb, var(--ce-primary) 28%, transparent); }
          .ce-btn-preset.active { color: #160f02; background: radial-gradient(circle at 50% 30%, var(--ce-secondary) 0%, var(--ce-primary) 70%); border-color: var(--ce-primary); box-shadow: 0 0 14px color-mix(in srgb, var(--ce-primary) 42%, transparent); }
          @media (max-width: 640px) { .ce-btn-preset { padding: .5rem .85rem; font-size: .72rem; min-height: 40px; flex: 1 1 auto; } .ce-presets { gap: .35rem; } }
          .ce-btn-autoplay { background: linear-gradient(180deg, #ef4444, #b91c1c) !important; color: #fff !important; border: none !important; box-shadow: 0 4px 14px rgba(239,68,68,0.45) !important; }
          /* During autoplay the spin button turns into a red STOP — hide the
             gold themed arrow-ring so it doesn't orbit the red button. */
          .ce-btn.primary.ce-spin.ce-btn-autoplay::before { opacity: 0; }

          /* ── Signature circular spin button (the NetEnt/Yggdrasil tell) ── */
          .ce-btn.primary.ce-spin { flex: 0 0 auto; width: 92px; height: 92px; min-width: 92px; padding: 0; border-radius: 50%; border: none; color: #160f02; font-family: var(--ce-font-display); font-weight: 900; letter-spacing: 1px; text-transform: uppercase; font-size: .95rem; background: radial-gradient(circle at 50% 32%, var(--ce-secondary) 0%, var(--ce-primary) 46%, var(--ce-primary-d) 100%); box-shadow: var(--ce-spin-glow), 0 6px 18px rgba(0,0,0,.5), inset 0 2px 6px rgba(255,255,255,.35), inset 0 -6px 12px rgba(0,0,0,.35); position: relative; display: flex; align-items: center; justify-content: center; text-shadow: 0 1px 1px rgba(255,255,255,.3); }
          .ce-btn.primary.ce-spin::before { content: ''; position: absolute; inset: -6px; border-radius: 50%; background: conic-gradient(from 0deg, transparent 0deg, var(--ce-win) 55deg, transparent 130deg, transparent 180deg, var(--ce-win) 235deg, transparent 310deg); -webkit-mask: radial-gradient(farthest-side, transparent calc(100% - 5px), #000 calc(100% - 4px)); mask: radial-gradient(farthest-side, transparent calc(100% - 5px), #000 calc(100% - 4px)); animation: ceSpinRing 4s linear infinite; opacity: .9; }
          .ce-btn.primary.ce-spin:hover:not(:disabled) { filter: brightness(1.07); box-shadow: var(--ce-spin-glow), 0 8px 26px rgba(0,0,0,.6), inset 0 2px 6px rgba(255,255,255,.4); }
          .ce-btn.primary.ce-spin:active:not(:disabled) { transform: scale(0.94); }
          .ce-btn.primary.ce-spin:disabled::before { animation-play-state: paused; }
          @keyframes ceSpinRing { to { transform: rotate(360deg); } }
          @media (prefers-reduced-motion: reduce) { .ce-btn.primary.ce-spin::before { animation: none; } }
          @media (max-width: 640px) { .ce-btn.primary.ce-spin { width: 78px; height: 78px; min-width: 78px; font-size: .82rem; } .ce-panel { gap: .5rem; padding: .7rem .6rem; } .ce-betlabel { min-width: 92px; padding: .45rem .6rem; } .ce-btn { padding: .5rem .7rem; } }
          .ce-cell { aspect-ratio: 1; border-radius: 8px; display: flex; align-items: center; justify-content: center; font-weight: 800; font-size: 1.4rem; color: white; text-shadow: 0 2px 4px rgba(0,0,0,.5); transition: transform .25s, filter .25s; user-select: none; overflow: hidden; }
          /* Bitmap symbol tile (per-game custom art). Fills the cell — the
             tile already includes an integrated themed background, so the
             cell gradient shows only if the image fails to decode. */
          .ce-cell-img { width: 100%; height: 100%; display: block; border-radius: inherit; object-fit: cover; object-position: center; pointer-events: none; -webkit-user-drag: none; user-select: none; }
          /* Motion blur while a cell is still rolling. Cleared the instant the
             reel lands (the just-landed bounce takes over). Blurring the cell
             also blurs the inner .ce-cell-img since filter cascades to children,
             so both emoji-glyph and bitmap-tile reels get the spin smear. */
          .ce-cell.ce-rolling { filter: blur(2.6px) brightness(1.05); will-change: filter, transform; transform: translateZ(0); }
          .ce-cell.just-landed { animation: ceLand 240ms cubic-bezier(.34,1.4,.64,1) both; }
          .ce-cell.highlight { animation: ceWinGlow 0.8s ease-in-out infinite alternate; box-shadow: 0 0 12px ${primary}, 0 0 24px ${primary}66; z-index: 1; position: relative; }
          @keyframes ceLand { 0% { transform: translateY(-14px) scale(0.94); filter: brightness(0.7); } 60% { transform: translateY(2px) scale(1.04); filter: brightness(1.1); } 100% { transform: translateY(0) scale(1); filter: brightness(1); } }
          @keyframes ceWinGlow { from { transform: scale(1); filter: brightness(1); } to { transform: scale(1.10); filter: brightness(1.45) saturate(1.3); } }
          @keyframes ceCelebrateFade { 0% { opacity: 0; } 10% { opacity: 1; } 80% { opacity: 1; } 100% { opacity: 0; } }
          @keyframes ceCelebratePop { 0% { transform: scale(0.4) rotate(-3deg); opacity: 0; } 70% { transform: scale(1.08) rotate(0.5deg); opacity: 1; } 100% { transform: scale(1) rotate(0); opacity: 1; } }
          /* Jackpot celebration — longer, more dramatic than ceCelebrateFade.
             Rainbow border sweep + extended fade window (5s vs 1.8s) so the
             moment lands. Used by _celebrateJackpot. */
          @keyframes ceJackpotFade { 0% { opacity: 0; } 4% { opacity: 1; } 90% { opacity: 1; } 100% { opacity: 0; } }
          @keyframes ceJackpotPulse { 0%, 100% { transform: scale(1); filter: brightness(1); } 50% { transform: scale(1.06); filter: brightness(1.3); } }
          @keyframes ceJackpotShimmer { 0% { background-position: 0% 50%; } 100% { background-position: 200% 50%; } }
          /* Jackpot ticker pill in the game-page corner. */
          .ce-jackpot-pill { position: fixed; top: 12px; right: 12px; z-index: 10300; pointer-events: none; background: linear-gradient(120deg, #1a1205 0%, #3e2a08 100%); border: 1px solid #F0C66E; border-radius: 999px; padding: 6px 14px 6px 12px; color: #FFD700; font-size: 0.78rem; font-weight: 700; letter-spacing: 0.04em; box-shadow: 0 0 18px rgba(240,198,110,0.35); display: flex; align-items: center; gap: 8px; font-family: "Plus Jakarta Sans", Inter, sans-serif; }
          .ce-jackpot-pill .ce-jp-dot { width: 8px; height: 8px; border-radius: 50%; background: #FFD700; box-shadow: 0 0 8px #FFD700; animation: ceJackpotPulse 1.4s ease-in-out infinite; }
          .ce-jackpot-pill .ce-jp-label { opacity: 0.85; font-weight: 600; font-size: 0.7rem; text-transform: uppercase; }
          /* On phones the topbar (LOBBY + balance + Wallet + Account) fills the
             top row, so a fixed top-right pill SAT ON TOP of the Wallet/Account
             links (they were visually covered even though the pill is
             pointer-events:none). Drop it into the empty band BELOW the topbar,
             horizontally centred, so nothing overlaps. */
          @media (max-width: 640px) { .ce-jackpot-pill { top: 62px; right: auto; left: 50%; transform: translateX(-50%); padding: 3px 12px 3px 10px; font-size: 0.7rem; line-height: 1.15; white-space: nowrap; max-width: calc(100vw - 24px); } .ce-jackpot-pill .ce-jp-label { font-size: 0.62rem; } }
          @media (prefers-reduced-motion: reduce) { .ce-jackpot-pill .ce-jp-dot { animation: none; } }
          /* Free-spins bonus-run banner. Sticky above the reels for the
             duration of a free-spins run. Premium operators universally
             surface this — it's the centrepiece UX moment of the bonus. */
          .ce-bonus-banner {
            margin: 0 0 .8rem 0; padding: .6rem .9rem;
            background: linear-gradient(135deg, #F0C66E 0%, #FFD700 100%);
            color: #1a1205; border-radius: 10px;
            display: flex; align-items: center; justify-content: space-between; gap: .6rem;
            font-family: "Plus Jakarta Sans", Inter, sans-serif; font-weight: 700;
            box-shadow: 0 4px 14px rgba(240, 198, 110, 0.45);
            animation: ceBonusPulse 1.6s ease-in-out infinite alternate;
          }
          .ce-bonus-banner .ce-bb-count { font-size: 1.05rem; letter-spacing: .04em; }
          .ce-bonus-banner .ce-bb-total { font-size: 1.15rem; font-weight: 800; }
          .ce-bonus-banner .ce-bb-label { font-size: .72rem; opacity: .8; text-transform: uppercase; font-weight: 600; }
          @keyframes ceBonusPulse {
            0%   { box-shadow: 0 4px 14px rgba(240, 198, 110, 0.45); transform: scale(1); }
            100% { box-shadow: 0 6px 22px rgba(255, 215, 0, 0.70); transform: scale(1.01); }
          }
          @media (prefers-reduced-motion: reduce) { .ce-bonus-banner { animation: none; } }
          @media (max-width: 640px) {
            .ce-bonus-banner { padding: .5rem .7rem; }
            .ce-bonus-banner .ce-bb-count, .ce-bonus-banner .ce-bb-total { font-size: 0.9rem; }
          }
          /* Mobile touch targets — industry-standard 64px high spin button.
             Buttons stack vertically when the control bar overflows. */
          @media (max-width: 640px) {
            .ce-btn.primary { min-height: 64px; font-size: 1.15rem; padding: 1rem 1.4rem; flex: 1 1 100%; order: 99; }
            .ce-btn-stepper { min-height: 48px; min-width: 48px; }
            .ce-btn-maxbet { min-height: 48px; }
            /* WCAG 2.5.5 — info + turbo + auto were 36px circular which is
               below the 44px touch-target recommendation. Bump on mobile so
               they're equally reachable as the bet steppers. */
            .ce-btn-info, .ce-btn-turbo, .ce-btn-auto { min-height: 48px; min-width: 48px; }
          }
          /* Mobile readability lift (2026-05-30) — bigger reel glyphs + a 16px
             body floor so in-game labels/text stay legible on phones. Tile art
             (.ce-cell-img) fills the cell and is unaffected; this only enlarges
             the emoji-fallback glyph and inherited rem-based text. */
          @media (max-width: 640px) {
            .ce-cell { font-size: 1.7rem; }
            body { font-size: 16px; }
            .ce-btn { font-size: 1rem; }
          }
          /* Short landscape phones — cap the reel box height so the bet/spin
             controls stay above the fold. Without this the square-cell grid at
             near-full width is taller than the viewport and pushes the panel
             off-screen. svh tracks the actual visible viewport on mobile. */
          @media (orientation: landscape) and (max-height: 560px) {
            .ce-reelbox { max-width: min(680px, 150svh); padding: .6rem; margin-top: .4rem; }
            .ce-cell { font-size: 1.15rem; }
            .ce-meter { margin-top: .4rem; }
            .ce-meter-val { font-size: .92rem; }
            .ce-panel { margin-top: .5rem !important; }
          }
          /* ── Free-spin mode: distinct GREEN glow border on the reel frame ──
             While a free-spins bonus run is active the reel box gets a vivid
             emerald frame + pulsing glow so the player can tell at a glance
             they're spinning on the house's dime. Overrides the per-game themed
             frame for the duration of the run only. */
          .ce-reelbox.ce-freespin {
            border: 2px solid #2BE07A !important;
            box-shadow: 0 0 26px rgba(43,224,122,.55), 0 0 60px rgba(43,224,122,.30), inset 0 0 34px rgba(43,224,122,.16) !important;
            animation: ceFreeSpinGlow 1.5s ease-in-out infinite alternate;
          }
          .ce-reelbox.ce-freespin::before { box-shadow: inset 0 0 0 1px rgba(43,224,122,.5) !important; }
          .ce-reelbox.ce-freespin::after { filter: drop-shadow(0 0 5px #2BE07A); }
          @keyframes ceFreeSpinGlow {
            0%   { box-shadow: 0 0 22px rgba(43,224,122,.45), 0 0 50px rgba(43,224,122,.22), inset 0 0 30px rgba(43,224,122,.14); }
            100% { box-shadow: 0 0 34px rgba(43,224,122,.70), 0 0 78px rgba(43,224,122,.38), inset 0 0 40px rgba(43,224,122,.20); }
          }

          /* ── Mega-win screen pulse (≥50x). A brief full-frame flash + zoom on
             the reel box so a mega win physically shakes the screen, distinct
             from the overlay text. Added/removed by _celebrateWin. ── */
          @keyframes ceScreenPulse {
            0%   { transform: scale(1);    filter: brightness(1); }
            18%  { transform: scale(1.035); filter: brightness(1.5) saturate(1.3); }
            40%  { transform: scale(0.992); filter: brightness(1.05); }
            62%  { transform: scale(1.018); filter: brightness(1.28) saturate(1.18); }
            100% { transform: scale(1);    filter: brightness(1); }
          }
          .ce-reelbox.ce-screen-pulse { animation: ceScreenPulse 900ms cubic-bezier(.36,.07,.19,.97) both; }

          /* ── Game-info panel: slide-up sheet on mobile, centered modal on
             desktop. The overlay flexes its panel to the bottom on phones and
             to center on wider screens; the panel animates in accordingly. ── */
          #ce-info-overlay { align-items: flex-end; }
          #ce-info-overlay .ce-info-panel { animation: ceInfoSlideUp 280ms cubic-bezier(.16,.84,.44,1) both; width: 100%; max-width: 560px; border-bottom-left-radius: 0; border-bottom-right-radius: 0; }
          @keyframes ceInfoSlideUp { from { transform: translateY(100%); opacity: .4; } to { transform: translateY(0); opacity: 1; } }
          @keyframes ceInfoPop { from { transform: scale(.94); opacity: 0; } to { transform: scale(1); opacity: 1; } }
          @media (min-width: 641px) {
            #ce-info-overlay { align-items: center; }
            #ce-info-overlay .ce-info-panel { animation-name: ceInfoPop; border-radius: 14px; }
          }
          @media (prefers-reduced-motion: reduce) {
            #ce-info-overlay .ce-info-panel { animation: none !important; }
          }

          /* Reduced-motion honour — cells just snap, no landing/winglow/blur loop. */
          @media (prefers-reduced-motion: reduce) {
            .ce-cell, .ce-cell.just-landed, .ce-cell.highlight,
            .ce-btn, .ce-btn.primary { animation: none !important; transition: none !important; }
            .ce-cell.ce-rolling { filter: none !important; }
            .ce-reelbox.ce-freespin, .ce-reelbox.ce-screen-pulse { animation: none !important; }
          }

          /* ── Win-history toggle + sidebar ── */
          .ce-btn-history { min-width: 40px; min-height: 40px; padding: .4rem; border-radius: 50%; font-weight: 800; color: var(--ce-primary); background: linear-gradient(135deg, color-mix(in srgb, var(--ce-primary) 20%, transparent), transparent); border-color: color-mix(in srgb, var(--ce-primary) 50%, transparent); }
          .ce-history { position: fixed; top: 0; right: 0; height: 100%; width: min(340px, 86vw); transform: translateX(105%); transition: transform .32s cubic-bezier(.16,.84,.44,1); background: linear-gradient(180deg, #11151d, #0b0e14); border-left: 1px solid color-mix(in srgb, var(--ce-primary) 40%, transparent); box-shadow: -12px 0 40px rgba(0,0,0,.5); z-index: 10500; display: flex; flex-direction: column; }
          .ce-history.open { transform: translateX(0); }
          .ce-history-head { display: flex; align-items: center; justify-content: space-between; padding: 1rem 1.1rem; border-bottom: 1px solid color-mix(in srgb, var(--ce-primary) 24%, transparent); }
          .ce-history-title { font-family: var(--ce-font-display); font-weight: 800; letter-spacing: .04em; color: var(--ce-primary); font-size: 1rem; }
          .ce-history-close { background: transparent; border: 0; color: #9aa3b2; font-size: 1.5rem; line-height: 1; cursor: pointer; padding: 0 .3rem; }
          .ce-history-close:hover { color: #fff; }
          .ce-history-list { flex: 1; overflow-y: auto; padding: .4rem .6rem 1rem; }
          .ce-history-empty { color: #8b95a8; font-size: .85rem; padding: 1.2rem .6rem; line-height: 1.5; text-align: center; }
          .ce-history-row { display: grid; grid-template-columns: 1fr 1fr auto; gap: .4rem .6rem; align-items: center; padding: .5rem; border-bottom: 1px solid rgba(255,255,255,.05); font-variant-numeric: tabular-nums; font-size: .86rem; }
          .ce-history-hdr { color: #8b95a8; text-transform: uppercase; letter-spacing: .06em; font-size: .66rem; font-weight: 700; border-bottom: 1px solid color-mix(in srgb, var(--ce-primary) 22%, transparent); }
          .ce-history-bet { color: #cdd3de; }
          .ce-history-win { color: #6b7280; }
          .ce-history-row.win .ce-history-win { color: var(--ce-win); font-weight: 700; }
          .ce-history-mult { color: #9aa3b2; text-align: right; font-weight: 700; min-width: 48px; }
          .ce-history-row.win .ce-history-mult { color: var(--ce-win); }
          @media (prefers-reduced-motion: reduce) { .ce-history { transition: none; } }

          /* ── Pre-spin game briefing (slide-up sheet / centered modal) ── */
          #ce-prespin-overlay { position: fixed; inset: 0; z-index: 10650; background: rgba(0,0,0,.66); display: flex; align-items: flex-end; justify-content: center; }
          .ce-prespin-panel { width: 100%; max-width: 480px; background: linear-gradient(180deg, #161b23, #0f1218); border: 1px solid color-mix(in srgb, var(--ce-primary) 45%, transparent); border-radius: 18px 18px 0 0; box-shadow: 0 -16px 50px rgba(0,0,0,.55); padding: 1.4rem 1.4rem 1.5rem; color: #f0f0f5; animation: ceInfoSlideUp 300ms cubic-bezier(.16,.84,.44,1) both; }
          .ce-prespin-eyebrow { font-size: .68rem; letter-spacing: .16em; text-transform: uppercase; color: var(--ce-primary); font-weight: 800; font-family: var(--ce-font-body); }
          .ce-prespin-name { margin: .25rem 0 1rem; font-family: var(--ce-font-display); font-size: 1.5rem; font-weight: 900; color: #fff; line-height: 1.1; }
          .ce-prespin-stats { display: grid; grid-template-columns: repeat(3, 1fr); gap: .6rem; margin-bottom: 1.2rem; }
          .ce-prespin-stat { background: rgba(255,255,255,.04); border: 1px solid color-mix(in srgb, var(--ce-primary) 22%, transparent); border-radius: 12px; padding: .7rem .5rem; text-align: center; }
          .ce-prespin-stat-label { font-size: .62rem; letter-spacing: .1em; text-transform: uppercase; color: #9aa3b2; font-weight: 700; }
          .ce-prespin-stat-val { margin-top: .25rem; font-family: var(--ce-font-display); font-size: 1.05rem; font-weight: 800; color: var(--ce-primary); font-variant-numeric: tabular-nums; }
          .ce-prespin-feat-label { font-size: .7rem; letter-spacing: .08em; text-transform: uppercase; color: #9aa3b2; font-weight: 700; margin-bottom: .55rem; }
          .ce-prespin-feats { display: flex; flex-wrap: wrap; gap: .45rem; margin-bottom: 1.5rem; }
          .ce-prespin-chip { padding: .4rem .8rem; border-radius: 999px; font-size: .8rem; font-weight: 600; color: color-mix(in srgb, var(--ce-primary) 86%, #fff); background: linear-gradient(180deg, color-mix(in srgb, var(--ce-primary) 16%, transparent), transparent); border: 1px solid color-mix(in srgb, var(--ce-primary) 36%, transparent); }
          .ce-prespin-gotit { width: 100%; padding: .9rem; border: none; border-radius: 12px; cursor: pointer; font-family: var(--ce-font-display); font-weight: 800; letter-spacing: .04em; text-transform: uppercase; font-size: .95rem; color: #160f02; background: radial-gradient(circle at 50% 30%, var(--ce-secondary) 0%, var(--ce-primary) 70%); box-shadow: var(--ce-spin-glow); }
          .ce-prespin-gotit:hover { filter: brightness(1.06); }
          .ce-prespin-gotit:active { transform: scale(.98); }
          @media (min-width: 641px) {
            #ce-prespin-overlay { align-items: center; padding: 24px; }
            .ce-prespin-panel { border-radius: 18px; animation-name: ceInfoPop; }
          }
          @media (prefers-reduced-motion: reduce) { .ce-prespin-panel { animation: none !important; } }

          /* ════════════════════════════════════════════════════════════════
             AAA UPGRADE LAYER (2026-06-28). Additive polish on top of the
             per-game skin: a physical-machine bezel with green LED trim,
             animated paylines, an LED control read-out, tiered win takeovers
             (coin shower / Matrix code rain / MEGA banner) and a dramatic
             free-spins reveal. The Matrix brand green (#00ff41) is the
             through-line accent layered over each studio palette.
             ════════════════════════════════════════════════════════════════ */
          .ce-root { --ce-matrix: #00ff41; }

          /* ── Physical reel bezel + green LED trim ── */
          .ce-root .ce-reelbox {
            background: linear-gradient(180deg, #0c0f13 0%, #06080b 100%);
            border: 2px solid color-mix(in srgb, var(--ce-reel-border) 65%, #000);
            box-shadow:
              var(--ce-frame-shadow),
              inset 0 2px 0 rgba(255,255,255,.07),
              inset 0 -4px 10px rgba(0,0,0,.65),
              inset 0 0 0 2px color-mix(in srgb, var(--ce-matrix) 14%, transparent),
              0 0 0 5px #0a0d11,
              0 0 0 6px color-mix(in srgb, var(--ce-matrix) 42%, transparent),
              0 0 24px color-mix(in srgb, var(--ce-matrix) 26%, transparent),
              0 14px 44px rgba(0,0,0,.55);
          }
          /* Reel window inner shading so the columns sit in a recessed slot. */
          .ce-reelgrid { position: relative; }
          .ce-col {
            background:
              linear-gradient(180deg, rgba(255,255,255,.04), rgba(0,0,0,0) 14%, rgba(0,0,0,0) 86%, rgba(0,0,0,.45)),
              var(--ce-reel-bg, #0a0a15);
            box-shadow: inset 0 0 14px rgba(0,0,0,.6);
            overflow: hidden;
          }
          /* Vertical scrolling-light streak while a reel is spinning — sells the
             "physical reel in motion" read on top of the per-cell symbol swap. */
          .ce-col.ce-col-spin { position: relative; }
          .ce-col.ce-col-spin::after {
            content:''; position:absolute; inset:0; pointer-events:none; border-radius:inherit; z-index:2;
            background: repeating-linear-gradient(180deg,
              rgba(255,255,255,0) 0, rgba(255,255,255,0) 14px,
              color-mix(in srgb, var(--ce-matrix) 10%, transparent) 16px,
              rgba(255,255,255,.05) 18px, rgba(255,255,255,0) 30px);
            background-size: 100% 64px;
            animation: ceReelStreak .28s linear infinite;
            mix-blend-mode: screen; opacity:.8;
          }
          @keyframes ceReelStreak { from { background-position-y: 0; } to { background-position-y: 64px; } }
          /* Per-column settle when a reel lands — a weighty vertical overshoot. */
          .ce-col.ce-col-land { animation: ceReelLand 420ms cubic-bezier(.18,1.3,.5,1) both; }
          @keyframes ceReelLand {
            0%   { transform: translateY(-10px); }
            55%  { transform: translateY(4px); }
            78%  { transform: translateY(-2px); }
            100% { transform: translateY(0); }
          }

          /* ── Winning symbol: pulsing GREEN border glow ── */
          .ce-cell.highlight {
            animation: ceWinGlowG .7s ease-in-out infinite alternate;
            box-shadow: 0 0 0 2px var(--ce-matrix), 0 0 14px var(--ce-matrix),
                        0 0 28px color-mix(in srgb, var(--ce-matrix) 55%, transparent);
            z-index: 2; position: relative; border-radius: 8px;
          }
          @keyframes ceWinGlowG {
            from { box-shadow: 0 0 0 2px var(--ce-matrix), 0 0 10px var(--ce-matrix); transform: scale(1.02); filter: brightness(1.05); }
            to   { box-shadow: 0 0 0 3px var(--ce-matrix), 0 0 22px var(--ce-matrix), 0 0 42px color-mix(in srgb, var(--ce-matrix) 60%, transparent); transform: scale(1.09); filter: brightness(1.4) saturate(1.25); }
          }

          /* ── Animated paylines (SVG overlay) ── */
          .ce-payline-svg { position: absolute; pointer-events: none; z-index: 3; overflow: visible; }
          @keyframes cePaylineDraw { to { stroke-dashoffset: 0; } }

          /* ── LED control read-out ── */
          .ce-meter-cell {
            background: linear-gradient(180deg, rgba(4,8,5,.86), rgba(2,5,3,.94));
            border-color: color-mix(in srgb, var(--ce-matrix) 28%, transparent);
            box-shadow: inset 0 0 12px rgba(0,0,0,.7), inset 0 0 0 1px rgba(255,255,255,.02);
          }
          .ce-meter-val, .ce-betlabel {
            font-family: 'Orbitron', var(--ce-font-display); letter-spacing: .06em;
            font-variant-numeric: tabular-nums; text-shadow: 0 0 9px color-mix(in srgb, currentColor 55%, transparent);
          }
          .ce-meter-cell:nth-child(1) .ce-meter-val { color: #e8edf5; }
          .ce-betlabel { background: linear-gradient(180deg, rgba(4,8,5,.7), rgba(2,5,3,.85)); box-shadow: inset 0 0 12px rgba(0,0,0,.6); }

          /* ── Signature SPIN press: scale-down → glow pulse → spring back ── */
          .ce-btn.primary.ce-spin.ce-spin-press { animation: ceSpinPress 460ms cubic-bezier(.34,1.56,.64,1) both; }
          @keyframes ceSpinPress {
            0%   { transform: scale(1); }
            20%  { transform: scale(.86); box-shadow: var(--ce-spin-glow), 0 0 34px var(--ce-matrix), inset 0 2px 6px rgba(255,255,255,.4); }
            55%  { transform: scale(1.07); }
            78%  { transform: scale(.97); }
            100% { transform: scale(1); }
          }

          /* ── Small-win number popup ── */
          .ce-winpop {
            position: absolute; left: 50%; top: 42%; z-index: 4; pointer-events: none;
            font-family: 'Orbitron', var(--ce-font-display); font-weight: 900;
            font-size: clamp(1.4rem, 5.5vw, 2.3rem); color: var(--ce-matrix);
            text-shadow: 0 0 14px var(--ce-matrix), 0 2px 6px rgba(0,0,0,.75);
            animation: ceWinPop 1150ms cubic-bezier(.2,.9,.4,1.2) forwards;
          }
          @keyframes ceWinPop {
            0%   { opacity: 0; transform: translate(-50%,-30%) scale(.5); }
            22%  { opacity: 1; transform: translate(-50%,-58%) scale(1.12); }
            70%  { opacity: 1; transform: translate(-50%,-62%) scale(1); }
            100% { opacity: 0; transform: translate(-50%,-98%) scale(.95); }
          }

          /* ── MEGA banner (gold text on green ribbon) ── */
          .ce-mega-banner {
            margin-bottom: 1.1rem; padding: .5rem 2.4rem;
            background: linear-gradient(180deg, #00ff41 0%, #00b32d 100%);
            border-radius: 8px; border: 2px solid #063a14;
            box-shadow: 0 0 26px rgba(0,255,65,.6), inset 0 2px 4px rgba(255,255,255,.5), inset 0 -4px 8px rgba(0,0,0,.3);
            transform: skewX(-7deg);
          }
          .ce-mega-banner span {
            display: block; transform: skewX(7deg);
            font-family: 'Orbitron','Plus Jakarta Sans',sans-serif; font-weight: 900;
            letter-spacing: .14em; font-size: clamp(1rem,4.4vw,1.6rem);
            color: #1a1205; text-shadow: 0 1px 0 #FFE89A, 0 2px 4px rgba(0,0,0,.35);
            background: linear-gradient(180deg,#FFF1B8,#E5A800); -webkit-background-clip: text; background-clip: text; -webkit-text-fill-color: transparent;
          }

          /* ── Dramatic free-spins reveal ── */
          .ce-fsreveal {
            position: fixed; inset: 0; z-index: 10520; display: flex; flex-direction: column;
            align-items: center; justify-content: center; pointer-events: none;
            background: radial-gradient(circle at center, rgba(0,40,12,.78) 0%, rgba(0,0,0,.55) 60%, rgba(0,0,0,0) 100%);
            animation: ceFSFade 2.6s ease-out forwards;
          }
          .ce-fsreveal .ce-fs-eyebrow { font-family:'Orbitron',sans-serif; font-weight:700; letter-spacing:.4em; text-transform:uppercase; font-size:clamp(.8rem,3vw,1.1rem); color:#aaffcc; opacity:.9; }
          .ce-fsreveal .ce-fs-count { font-family:'Orbitron',sans-serif; font-weight:900; font-size:clamp(4rem,22vw,9rem); line-height:1; color:#00ff41; text-shadow:0 0 30px #00ff41,0 0 70px rgba(0,255,65,.6); animation: ceFSPop 700ms cubic-bezier(.2,.9,.4,1.4) both; }
          .ce-fsreveal .ce-fs-label { margin-top:.4rem; font-family:'Orbitron','Plus Jakarta Sans',sans-serif; font-weight:800; letter-spacing:.22em; text-transform:uppercase; font-size:clamp(1.2rem,6vw,2.4rem); color:#fff; text-shadow:0 0 18px rgba(0,255,65,.7); animation: ceFSPop 700ms 120ms cubic-bezier(.2,.9,.4,1.4) both; }
          @keyframes ceFSFade { 0%{opacity:0;} 8%{opacity:1;} 82%{opacity:1;} 100%{opacity:0;} }
          @keyframes ceFSPop { 0%{opacity:0; transform:scale(.3) rotate(-4deg);} 70%{opacity:1; transform:scale(1.12);} 100%{opacity:1; transform:scale(1) rotate(0);} }

          /* ── Premium paytable symbol tiles ── */
          .ce-pt-row { display:flex; align-items:center; gap:10px; padding:7px 8px; border-radius:9px; background:rgba(255,255,255,.02); border:1px solid rgba(0,255,65,.08); }
          .ce-pt-row:nth-child(odd) { background:rgba(0,255,65,.035); }
          .ce-pt-tile { width:38px; height:38px; flex:0 0 38px; border-radius:8px; display:flex; align-items:center; justify-content:center; font-size:1.3rem; overflow:hidden; box-shadow:inset 0 0 0 1px rgba(0,255,65,.18), 0 2px 6px rgba(0,0,0,.4); }
          .ce-pt-tile img { width:100%; height:100%; object-fit:cover; display:block; }
          .ce-pt-name { flex:1; min-width:0; font-weight:600; color:#dfe5ef; text-transform:capitalize; font-size:.86rem; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
          .ce-pt-pay { color:#FFD700; font-weight:700; text-align:right; font-variant-numeric:tabular-nums; font-size:.82rem; white-space:nowrap; }

          /* ── Game header (game-page top bar) ── */
          .ce-hdr-left, .ce-hdr-right { display:flex; align-items:center; gap:.7rem; min-width:0; }
          .ce-hdr-home, .ce-iconbtn {
            display:inline-flex; align-items:center; justify-content:center; gap:.4rem;
            height:38px; min-width:38px; padding:0 .7rem; border-radius:10px; cursor:pointer;
            background:rgba(0,255,65,.06); border:1px solid color-mix(in srgb, var(--ce-matrix) 38%, transparent);
            color:var(--ce-matrix); font-weight:800; font-size:.95rem; text-decoration:none; line-height:1;
            font-family:var(--ce-font-body); transition:border-color .16s, box-shadow .16s, background .16s;
          }
          .ce-hdr-home span { font-size:.72rem; letter-spacing:.12em; text-transform:uppercase; }
          .ce-hdr-home:hover, .ce-iconbtn:hover { border-color:var(--ce-matrix); box-shadow:0 0 12px color-mix(in srgb, var(--ce-matrix) 35%, transparent); background:rgba(0,255,65,.12); }
          .ce-prov-logo { height:30px; width:auto; max-width:120px; object-fit:contain; opacity:.92; filter:drop-shadow(0 0 6px rgba(0,255,65,.25)); }
          .ce-hdr-name { font-family:var(--ce-font-display); font-weight:900; letter-spacing:.04em; text-transform:uppercase; font-size:clamp(.9rem,2.4vw,1.15rem); color:#fff; text-shadow:0 0 14px color-mix(in srgb, var(--ce-matrix) 40%, transparent); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; max-width:min(38vw,320px); }
          .ce-bal-chip { display:inline-flex; align-items:center; gap:.4rem; padding:.42rem .85rem; border-radius:999px; text-decoration:none; font-family:'Orbitron',var(--ce-font-display); font-weight:800; font-variant-numeric:tabular-nums; color:var(--ce-matrix); background:linear-gradient(180deg,rgba(4,8,5,.85),rgba(2,5,3,.92)); border:1px solid color-mix(in srgb, var(--ce-matrix) 45%, transparent); box-shadow:inset 0 0 10px rgba(0,0,0,.6),0 0 10px color-mix(in srgb, var(--ce-matrix) 18%, transparent); text-shadow:0 0 8px color-mix(in srgb, var(--ce-matrix) 55%, transparent); }
          .ce-bal-chip::before { content:'◈'; font-size:.8em; opacity:.85; }
          @media (max-width:560px) {
            .ce-hdr-home span { display:none; }
            .ce-prov-logo { display:none; }
            .ce-hdr-name { max-width:42vw; }
            .ce-bal-chip { padding:.4rem .6rem; font-size:.82rem; }
          }

          /* ── Reduced-motion: this layer's animations off (must come AFTER the
             rules above so it wins the cascade for reduced-motion users). ── */
          @media (prefers-reduced-motion: reduce) {
            .ce-cell.highlight { animation: none !important; }
            .ce-col.ce-col-spin::after, .ce-col.ce-col-land { animation: none !important; }
            .ce-btn.primary.ce-spin.ce-spin-press { animation: none !important; }
            .ce-winpop, .ce-fsreveal, .ce-fsreveal .ce-fs-count, .ce-fsreveal .ce-fs-label { animation: none !important; }
            .ce-payline-svg path { animation: none !important; stroke-dashoffset: 0 !important; }
          }
        `;
        document.head.appendChild(s);
      }
    }

    // ── Custom symbol art (per-game bitmap tiles) ──────────────────────
    // Loads /data/symbol-art-shipped.json ONCE (cached on window, shared across
    // every engine instance/page). Fire-and-forget tolerant: any failure
    // (404, parse error, offline) leaves the manifest empty and every cell
    // falls back to the emoji glyph — so games without art are unaffected.
    //
    // NOTE: this is the *curated* manifest, NOT data/symbol-art.json. The latter
    // is the generator's full "what exists" list (rewritten continuously by the
    // resumable tile generator) and includes tiles that FAILED visual QA
    // (gibberish text, empty frames, off-theme, crypto coinage). Shipping that
    // raw would put broken/non-compliant tiles on live reels. symbol-art-shipped
    // .json is built by scripts/build-shipped-symbol-art.js, which subtracts
    // data/qa-flagged.json + data/qa-unreviewed.json. Excluded symbols fall back
    // to the themed emoji glyph. Rebuild + redeploy after each regen+reQA pass.
    async _loadSymbolArt() {
      if (window.CE_SYMBOL_ART) { this._symbolArt = window.CE_SYMBOL_ART; return; }
      if (!window.__CE_SYMBOL_ART_PROMISE) {
        // cache:'no-cache' → always revalidate with the server (cheap 304 when
        // unchanged) so newly-approved symbol art appears for returning users.
        // 'force-cache' would pin a stale manifest forever (e.g. an early
        // 1-game manifest), hiding all later art — the same trap that froze
        // sw.js. The tiles themselves are immutable per-id, so they stay cached.
        window.__CE_SYMBOL_ART_PROMISE = fetch('/data/symbol-art-shipped.json', { credentials: 'omit', cache: 'no-cache' })
          .then(r => (r.ok ? r.json() : {}))
          .catch(() => ({}))
          .then(m => { window.CE_SYMBOL_ART = m || {}; return window.CE_SYMBOL_ART; });
      }
      try { this._symbolArt = await window.__CE_SYMBOL_ART_PROMISE; }
      catch (_) { this._symbolArt = {}; }
    }

    // Resolve the bitmap-tile URL for (this game, symbol), or null.
    _symbolArtURL(sym) {
      const m = this._symbolArt || window.CE_SYMBOL_ART;
      if (!m || !this.gameId) return null;
      const g = m[this.gameId];
      if (!g) return null;
      const rel = g[String(sym || '').toLowerCase()];
      return rel ? ('/assets/symbols/' + rel) : null;
    }

    // Fill a reel cell with a bitmap tile when art exists, else the emoji
    // glyph. A decode/404 error on the <img> falls straight back to glyph,
    // so a single missing tile never blanks a cell.
    _fillCell(cell, sym) {
      const url = this._symbolArtURL(sym);
      if (url) {
        const img = document.createElement('img');
        img.className = 'ce-cell-img';
        img.alt = '';
        img.loading = 'lazy';
        img.decoding = 'async';
        img.addEventListener('error', () => { cell.textContent = this._symbolGlyph(sym); }, { once: true });
        img.src = url;
        cell.appendChild(img);
      } else {
        cell.textContent = this._symbolGlyph(sym);
      }
    }

    _makeCell(sym, r, y) {
      const [a, b] = symbolColors(sym, r * 3 + y);
      const cell = $el('div', { class: 'ce-cell', style: { background: `linear-gradient(135deg, ${a}, ${b})` } });
      this._fillCell(cell, sym);
      return cell;
    }

    _symbolGlyph(sym) {
      // Comprehensive symbol → emoji map covering the 424 unique symbol
      // IDs used across all 100 games (extracted via the game-registry).
      // Before this expansion, only ~14 IDs hit the map and ~95% of cells
      // rendered as 2-letter text codes ("WO", "PA", "MO", "PH") — making
      // every game visually indistinguishable. With this map ~95% of
      // cells now render with a theme-appropriate emoji.
      //
      // The map uses lowercase string keys; multi-word IDs use either
      // hyphenated form (the canonical registry shape) OR a fallback
      // substring match for compound IDs the engine doesn't recognise
      // directly (e.g. 'lucky-seven' → matches 'seven' substring).
      const s = String(sym || '').toLowerCase();
      if (SYMBOL_GLYPHS[s]) return SYMBOL_GLYPHS[s];
      // Substring fallback: try matching the first hyphen-segment.
      const head = s.split('-')[0];
      if (head !== s && SYMBOL_GLYPHS[head]) return SYMBOL_GLYPHS[head];
      // Last-resort: 2-letter text chip (legacy behaviour).
      return s.slice(0, 2).toUpperCase();
    }

    _renderCell(cell, sym, r, y) {
      cell.innerHTML = '';
      const [a, b] = symbolColors(sym, r * 3 + y);
      cell.style.background = `linear-gradient(135deg, ${a}, ${b})`;
      this._fillCell(cell, sym);
    }

    _updateBalanceChip(prevCents) {
      // Coin count-up animation when balance moves. Caller passes the
      // previous value (e.g. before the spin) so we animate prev → state.
      // Falls back to a hard snap if no previous value or if the user
      // has prefers-reduced-motion: reduce set.
      const target = this.state.balanceCents;
      const reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      if (prevCents == null || reduceMotion || prevCents === target) {
        this.balanceChip.textContent = fmt(target);
        if (this.meterBalance) this.meterBalance.textContent = fmt(target);
        return;
      }
      this._countUp(this.balanceChip, prevCents, target, 700);
      if (this.meterBalance) this._countUp(this.meterBalance, prevCents, target, 700);
      // Money landed in the wallet — a metallic coin clink + a soft
      // cash-register ding to settle it. Only on an increase (a winning
      // spin / deposit), never when the bet is deducted.
      if (target > prevCents) {
        this._fx('coin');
        setTimeout(() => this._fx('ding'), 320);
      }
    }

    _countUp(el, fromCents, toCents, durationMs) {
      // Animate a money display from `fromCents` to `toCents` over
      // `durationMs`. Uses requestAnimationFrame with an ease-out cubic so
      // the count slows as it approaches the final amount — feels weighty.
      // Caller is responsible for the element having a money format.
      if (!el || fromCents === toCents) return;
      const start = performance.now();
      const delta = toCents - fromCents;
      const step = (now) => {
        const elapsed = now - start;
        const t = Math.min(1, elapsed / durationMs);
        // ease-out cubic
        const eased = 1 - Math.pow(1 - t, 3);
        const v = Math.round(fromCents + delta * eased);
        el.textContent = fmt(v);
        if (t < 1) requestAnimationFrame(step);
        else el.textContent = fmt(toCents);
      };
      requestAnimationFrame(step);
    }

    _fx(kind, opts) {
      // Centralised sound + haptic dispatcher. Sound names map to the
      // premium synthesis library in js/sound-manager.js
      // (window.MatrixSound.play). `opts` is forwarded verbatim — e.g.
      // { reel } so each reel-stop thud descends in pitch. Haptics honour
      // prefers-reduced-motion: reduce per WCAG 2.3.3 (motion can trigger
      // vestibular issues).
      try {
        const snd = window.MatrixSound && window.MatrixSound.play;
        if (snd) {
          if      (kind === 'spin')      snd('spin-start');
          else if (kind === 'stop')      snd('reel-stop', opts);
          else if (kind === 'heartbeat') snd('jackpot-tick');
          else if (kind === 'small')     snd('win-small');
          else if (kind === 'medium')    snd('win-medium');
          else if (kind === 'big')       snd('win-big');
          else if (kind === 'mega')      snd('win-mega');
          else if (kind === 'jackpot')   snd('jackpot');
          else if (kind === 'bonus')     snd('freespins');
          else if (kind === 'scatter')   snd('scatter');
          else if (kind === 'wild')      snd('wild');
          else if (kind === 'coin')      snd('coin');
          else if (kind === 'ding')      snd('balance-ding');
          else if (kind === 'bet-up')    snd('bet-up');
          else if (kind === 'bet-down')  snd('bet-down');
          else if (kind === 'toggle')    snd('toggle');
          else if (kind === 'click')     snd('button-click');
          else if (kind === 'error')     snd('error');
        }
      } catch (_) { /* never let audio crash the spin */ }

      // Haptics — disabled under prefers-reduced-motion.
      const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      if (reduce || !navigator.vibrate) return;
      try {
        if      (kind === 'spin')      navigator.vibrate(20);
        else if (kind === 'stop')      navigator.vibrate(10);
        else if (kind === 'heartbeat') navigator.vibrate(14);
        else if (kind === 'small')     navigator.vibrate(60);
        else if (kind === 'medium')    navigator.vibrate([60, 40, 60]);
        else if (kind === 'big')       navigator.vibrate([80, 60, 80]);
        else if (kind === 'mega')      navigator.vibrate([100, 60, 100, 60, 200]);
        else if (kind === 'jackpot')   navigator.vibrate([300, 100, 300, 100, 300, 100, 600]);
        else if (kind === 'bonus')     navigator.vibrate([40, 30, 40]);
        else if (kind === 'scatter')   navigator.vibrate([30, 20, 30]);
        else if (kind === 'wild')      navigator.vibrate(25);
        else if (kind === 'error')     navigator.vibrate([30, 30, 30]);
      } catch (_) { /* some browsers throw on vibrate */ }
    }

    _celebrateWin(payoutCents, betCents) {
      // Win-tier overlay for premium feel. Tiers chosen to align with the
      // server-side payout cap structure (max win is 200x bet) and the
      // industry-standard "Big/Mega/Epic" naming.
      //
      //   ≥  15x bet → Big Win
      //   ≥  50x bet → Mega Win
      //   ≥ 100x bet → Epic Win
      //   ≥ 150x bet → Super Mega Win (the max-win cap is 200x, so the
      //                top quarter of the range earns its own tier — a
      //                150x+ hit should NOT look the same as a 100x hit)
      //
      // Built entirely with createElement + textContent (no innerHTML),
      // so it stays safe even when payoutCents is large.
      if (!betCents || betCents <= 0) return;
      const ratio = payoutCents / betCents;
      // Sub-medium wins are handled by the small-win flash + number popup in
      // _spin — the named-tier takeover starts at the MEDIUM band (5x).
      if (ratio < 5) return;

      // MEDIUM+ (≥5x): coin shower of gold/green particles.
      this._winConfetti(ratio);
      // BIG+ (≥20x): full-screen Matrix code-rain takeover + screen shake.
      if (ratio >= 20) { this._matrixRain(2600); this._screenPulse(); }

      // Tier ladder. `mega` flags the gold-on-green banner treatment (≥50x).
      // Sizes are viewport-clamped so wide-tracked labels never overflow on
      // <=360px phones (overlay is inline cssText, beyond the stylesheet's
      // mobile media queries).
      let tier;
      if      (ratio >= 150) tier = { label: 'SUPER MEGA WIN', fx: 'mega', mega: true,  color: '#FF5DA2', size: 'clamp(2.2rem,11vw,4.6rem)' };
      else if (ratio >= 100) tier = { label: 'EPIC WIN',  fx: 'mega', mega: true,  color: '#F0C66E', size: 'clamp(2.1rem,10vw,4.2rem)' };
      else if (ratio >=  50) tier = { label: 'MEGA WIN',  fx: 'mega', mega: true,  color: '#F0C66E', size: 'clamp(1.9rem,9vw,3.6rem)' };
      else if (ratio >=  20) tier = { label: 'BIG WIN',   fx: 'big',    mega: false, color: '#FFD700', size: 'clamp(1.7rem,8vw,3.0rem)' };
      else                   tier = { label: 'NICE WIN',  fx: 'medium', mega: false, color: '#00ff41', size: 'clamp(1.5rem,7vw,2.6rem)' };

      this._fx(tier.fx);

      const overlay = document.createElement('div');
      overlay.setAttribute('role', 'status');
      overlay.setAttribute('aria-live', 'polite');
      const bg = tier.mega
        ? 'radial-gradient(circle at center,rgba(0,60,18,0.62) 0%,rgba(0,0,0,0.35) 55%,rgba(0,0,0,0) 78%)'
        : 'radial-gradient(circle at center,rgba(0,0,0,0.55) 0%,rgba(0,0,0,0) 70%)';
      overlay.style.cssText =
        'position:fixed;inset:0;z-index:10500;display:flex;flex-direction:column;' +
        'align-items:center;justify-content:center;pointer-events:none;' +
        'background:' + bg + ';animation:ceCelebrateFade ' + (tier.mega ? '2.6s' : '1.8s') + ' ease-out forwards;';

      let label;
      if (tier.mega) {
        // Gold text on a green ribbon banner.
        label = document.createElement('div');
        label.className = 'ce-mega-banner';
        const span = document.createElement('span');
        span.textContent = tier.label;
        span.style.fontSize = tier.size;
        label.appendChild(span);
        label.style.animation = 'ceCelebratePop 600ms cubic-bezier(.2,.9,.4,1.2) both';
      } else {
        label = document.createElement('div');
        label.textContent = tier.label;
        label.style.cssText =
          'font-family:"Orbitron","Plus Jakarta Sans",sans-serif;font-weight:900;' +
          'letter-spacing:clamp(.12rem,1vw,.3rem);font-size:' + tier.size + ';color:' + tier.color + ';' +
          'max-width:96vw;text-align:center;' +
          'text-shadow:0 0 24px ' + tier.color + ',0 0 8px ' + tier.color + ';' +
          'animation:ceCelebratePop 600ms cubic-bezier(.2,.9,.4,1.2) both;';
      }

      const amount = document.createElement('div');
      amount.textContent = fmt(0);
      amount.style.cssText =
        'margin-top:1rem;font-size:clamp(1.8rem,7vw,2.8rem);font-weight:800;color:#fff;' +
        'font-family:"Orbitron",sans-serif;font-variant-numeric:tabular-nums;' +
        'text-shadow:0 2px 12px rgba(0,0,0,0.7),0 0 20px rgba(0,255,65,0.4);' +
        'animation:ceCelebratePop 700ms 120ms cubic-bezier(.2,.9,.4,1.2) both;';
      overlay.appendChild(label);
      overlay.appendChild(amount);
      document.body.appendChild(overlay);
      // Watch the win amount climb instead of popping in.
      const reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      if (reduceMotion) amount.textContent = fmt(payoutCents);
      else this._countUp(amount, 0, payoutCents, tier.mega ? 1400 : 900);
      // Self-clean (matches the fade keyframe duration).
      setTimeout(() => overlay.remove(), tier.mega ? 2700 : 2000);
    }

    // Lazy-load confetti.min.js (not preloaded on the 100 game pages — saves
    // ~8KB for the sessions that never hit a big win) and fire a burst sized to
    // the win. Skipped under reduced-motion. Shared shape with the jackpot
    // confetti but tuned lighter for regular big wins. Never throws.
    _ensureConfetti(cb) {
      if (typeof window.confetti === 'function') { cb(); return; }
      if (this._confettiLoading) {
        // Already loading — queue this callback for when it lands.
        (this._confettiQueue || (this._confettiQueue = [])).push(cb);
        return;
      }
      this._confettiLoading = true;
      this._confettiQueue = [cb];
      const src = location.pathname.includes('/games/') ? '../js/confetti.min.js' : 'js/confetti.min.js';
      const tag = document.createElement('script');
      tag.src = src;
      tag.async = true;
      tag.onload = () => {
        this._confettiLoading = false;
        (this._confettiQueue || []).forEach(fn => { try { fn(); } catch (_) {} });
        this._confettiQueue = [];
      };
      // On load failure: reset the loading flag (so a later win can retry) and
      // drop queued callbacks. Without this, a single failed load would wedge
      // _confettiLoading=true forever and orphan every queued burst.
      tag.onerror = () => {
        this._confettiLoading = false;
        this._confettiQueue = [];
      };
      document.head.appendChild(tag);
    }

    _winConfetti(ratio) {
      const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      if (reduce) return;
      // Coin shower — scale particle count with the win (a 5x sprinkle, a 100x
      // downpour). Gold + Matrix-green palette, round shapes read as coins.
      const count = Math.min(180, 40 + Math.round(ratio * 1.4));
      const coins = { colors: ['#FFD700', '#F0C66E', '#FFE89A', '#00ff41', '#9CFFB3'], shapes: ['circle'] };
      this._ensureConfetti(() => {
        if (typeof window.confetti !== 'function') return;
        const opts = Object.assign({ spread: 72, startVelocity: 45, ticks: 240, scalar: 1.05, particleCount: count }, coins);
        try {
          window.confetti(Object.assign({}, opts, { origin: { x: 0.5, y: 0.6 } }));
          if (ratio >= 25) {
            setTimeout(() => { try { window.confetti(Object.assign({}, opts, { particleCount: Math.round(count * 0.6), origin: { x: 0.2, y: 0.7 } })); } catch (_) {} }, 220);
            setTimeout(() => { try { window.confetti(Object.assign({}, opts, { particleCount: Math.round(count * 0.6), origin: { x: 0.8, y: 0.7 } })); } catch (_) {} }, 420);
          }
        } catch (_) { /* silent */ }
      });
    }

    _screenPulse() {
      const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      if (reduce || !this.reelBox) return;
      this.reelBox.classList.remove('ce-screen-pulse');
      // eslint-disable-next-line no-unused-expressions
      this.reelBox.offsetWidth; // reflow so the animation re-fires on repeat megas
      this.reelBox.classList.add('ce-screen-pulse');
      setTimeout(() => { if (this.reelBox) this.reelBox.classList.remove('ce-screen-pulse'); }, 950);
    }

    // Replay the SPIN button press keyframe (scale-down → glow pulse → spring
    // back). Class re-add + reflow so consecutive presses re-fire it.
    _spinPress() {
      const b = this.spinBtn;
      if (!b) return;
      const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      if (reduce) return;
      b.classList.remove('ce-spin-press');
      // eslint-disable-next-line no-unused-expressions
      b.offsetWidth; // reflow
      b.classList.add('ce-spin-press');
      setTimeout(() => { if (b) b.classList.remove('ce-spin-press'); }, 480);
    }

    // Full-screen Matrix code-rain takeover for big wins. A self-terminating
    // canvas of falling green katakana over the page. Pure polish — guarded so
    // it can never throw into the spin flow, and skipped under reduced-motion.
    _matrixRain(durationMs) {
      const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      if (reduce) return;
      try {
        const canvas = document.createElement('canvas');
        canvas.className = 'ce-matrix-rain';
        canvas.setAttribute('aria-hidden', 'true');
        canvas.style.cssText = 'position:fixed;inset:0;z-index:10450;pointer-events:none;opacity:0;transition:opacity .3s;';
        document.body.appendChild(canvas);
        const ctx = canvas.getContext('2d');
        if (!ctx) { canvas.remove(); return; }
        const dpr = Math.min(2, window.devicePixelRatio || 1);
        const glyphs = 'ｱｲｳｴｵｶｷｸｹｺｻｼｽｾｿﾀﾁﾂﾃﾄﾅﾆﾇﾈ0123456789ABCDEF$¥€';
        let W = 0, H = 0, cols = 0, drops = [], fontSize = 16 * dpr;
        const resize = () => {
          W = canvas.width = Math.floor(window.innerWidth * dpr);
          H = canvas.height = Math.floor(window.innerHeight * dpr);
          canvas.style.width = window.innerWidth + 'px';
          canvas.style.height = window.innerHeight + 'px';
          fontSize = 16 * dpr;
          cols = Math.max(1, Math.floor(W / fontSize));
          drops = new Array(cols).fill(0).map(() => Math.floor(Math.random() * -50));
          ctx.font = fontSize + 'px monospace';
        };
        resize();
        requestAnimationFrame(() => { canvas.style.opacity = '1'; });
        const start = performance.now();
        const draw = (now) => {
          ctx.fillStyle = 'rgba(0,0,0,0.10)';
          ctx.fillRect(0, 0, W, H);
          ctx.font = fontSize + 'px monospace';
          ctx.fillStyle = '#00ff41';
          ctx.shadowColor = '#00ff41';
          ctx.shadowBlur = 6;
          for (let i = 0; i < cols; i++) {
            const ch = glyphs[(Math.random() * glyphs.length) | 0];
            ctx.fillText(ch, i * fontSize, drops[i] * fontSize);
            if (drops[i] * fontSize > H && Math.random() > 0.975) drops[i] = 0;
            drops[i]++;
          }
          ctx.shadowBlur = 0;
          if (now - start < durationMs) {
            requestAnimationFrame(draw);
          } else {
            canvas.style.opacity = '0';
            window.removeEventListener('resize', resize);
            setTimeout(() => { try { canvas.remove(); } catch (_) {} }, 350);
          }
        };
        window.addEventListener('resize', resize);
        requestAnimationFrame(draw);
      } catch (_) { /* rain is pure polish — never block a spin */ }
    }

    // Quick floating "+$X" popup over the reels for small wins. Self-cleaning.
    _smallWinPopup(cents) {
      if (!this.reelBox) return;
      try {
        const pop = document.createElement('div');
        pop.className = 'ce-winpop';
        pop.textContent = '+' + fmt(cents);
        this.reelBox.appendChild(pop);
        setTimeout(() => { try { pop.remove(); } catch (_) {} }, 1250);
      } catch (_) { /* popup is polish */ }
    }

    // Dramatic free-spins trigger reveal — big green count + "FREE SPINS".
    _freeSpinsReveal(count) {
      try {
        const overlay = document.createElement('div');
        overlay.className = 'ce-fsreveal';
        overlay.setAttribute('role', 'status');
        overlay.setAttribute('aria-live', 'polite');
        overlay.setAttribute('aria-label', count + ' free spins awarded');
        overlay.appendChild($el('div', { class: 'ce-fs-eyebrow' }, 'You triggered'));
        overlay.appendChild($el('div', { class: 'ce-fs-count' }, String(count)));
        overlay.appendChild($el('div', { class: 'ce-fs-label' }, 'Free Spins'));
        document.body.appendChild(overlay);
        setTimeout(() => { try { overlay.remove(); } catch (_) {} }, 2700);
      } catch (_) { /* reveal is polish */ }
    }

    // Remove any drawn paylines + cancel their auto-clear timer.
    _clearPaylines() {
      if (this._paylineSvg) { try { this._paylineSvg.remove(); } catch (_) {} this._paylineSvg = null; }
      if (this._paylineTimer) { clearTimeout(this._paylineTimer); this._paylineTimer = null; }
    }

    // Draw animated SVG paylines connecting each winning line's cells. Each
    // line gets a glow underlay + bright stroke that "draws on" via
    // stroke-dashoffset, plus node rings on every winning cell. Coordinates are
    // measured live from the rendered cells so it tracks any responsive size.
    _drawPaylines(lineWins) {
      this._clearPaylines();
      const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      if (!this.reelBox || !this.reelGrid) return;
      if (!Array.isArray(lineWins) || !lineWins.length) return;
      try {
        const g = this.state.game;
        const grid = this.reelGrid;
        const cells = Array.from(grid.querySelectorAll('.ce-cell'));
        const gridRect = grid.getBoundingClientRect();
        const W = grid.offsetWidth, H = grid.offsetHeight;
        if (!W || !H) return;
        const NS = 'http://www.w3.org/2000/svg';
        const svg = document.createElementNS(NS, 'svg');
        svg.setAttribute('class', 'ce-payline-svg');
        svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
        svg.setAttribute('aria-hidden', 'true');
        svg.style.left = grid.offsetLeft + 'px';
        svg.style.top = grid.offsetTop + 'px';
        svg.style.width = W + 'px';
        svg.style.height = H + 'px';
        // Per-game win-line styling (set by the visual theme). `colors`
        // overrides the default rainbow; `pattern` switches solid → dashed /
        // dotted (marching ants); `glow` scales the underlay blur.
        const wl = this._winLineCfg || {};
        const wlColors = Array.isArray(wl.colors) && wl.colors.length ? wl.colors
          : (wl.color ? [wl.color] : null);
        const palette = wlColors || ['#00ff41', '#FFD700', '#00e5ff', '#ff5da2', '#b06bff', '#ff8c00'];
        const wlPattern = wl.style || wl.pattern || 'solid';
        const wlGlow = wl.glow != null ? wl.glow : 6;
        const center = (r, y) => {
          const cell = cells[r * g.rows + y];
          if (!cell) return null;
          const cr = cell.getBoundingClientRect();
          return [cr.left - gridRect.left + cr.width / 2, cr.top - gridRect.top + cr.height / 2];
        };
        let colorIdx = 0;
        lineWins.forEach((w) => {
          const pts = (w.positions || []).map((p) => center(p[0], p[1])).filter(Boolean);
          if (pts.length < 2) return;
          const color = palette[colorIdx % palette.length];
          colorIdx++;
          const d = pts.map((p, i) => (i === 0 ? 'M' : 'L') + p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join(' ');
          const mkPath = (width, opacity, glow) => {
            const path = document.createElementNS(NS, 'path');
            path.setAttribute('d', d);
            path.setAttribute('fill', 'none');
            path.setAttribute('stroke', color);
            path.setAttribute('stroke-width', width);
            path.setAttribute('stroke-linejoin', 'round');
            path.setAttribute('stroke-linecap', 'round');
            path.setAttribute('opacity', opacity);
            if (glow) path.style.filter = 'drop-shadow(0 0 ' + wlGlow + 'px ' + color + ')';
            const dashed = wlPattern === 'dashed' || wlPattern === 'dotted';
            if (dashed && !glow) {
              // Bright stroke renders as marching dashes/dots instead of a
              // solid draw-on — a distinct per-game win-line signature.
              const dash = wlPattern === 'dotted' ? '1 9' : '12 8';
              path.style.strokeDasharray = dash;
              if (!reduce) path.style.animation = 'ceVtMarch 1s linear infinite';
            } else if (!reduce) {
              let len = 0;
              try { len = path.getTotalLength ? path.getTotalLength() : 0; } catch (_) { len = 0; }
              if (len) {
                path.style.strokeDasharray = String(len);
                path.style.strokeDashoffset = String(len);
                path.style.animation = 'cePaylineDraw .55s ease forwards';
              }
            }
            return path;
          };
          svg.appendChild(mkPath(7, 0.32, true));
          svg.appendChild(mkPath(3, 0.95, false));
          pts.forEach((p) => {
            const c = document.createElementNS(NS, 'circle');
            c.setAttribute('cx', p[0].toFixed(1));
            c.setAttribute('cy', p[1].toFixed(1));
            c.setAttribute('r', '7');
            c.setAttribute('fill', 'none');
            c.setAttribute('stroke', color);
            c.setAttribute('stroke-width', '2.5');
            c.style.filter = 'drop-shadow(0 0 5px ' + color + ')';
            svg.appendChild(c);
          });
        });
        if (!svg.childNodes.length) return;
        this.reelBox.appendChild(svg);
        this._paylineSvg = svg;
        this._paylineTimer = setTimeout(() => this._clearPaylines(), 4200);
      } catch (_) { /* paylines are polish — never block a spin */ }
    }

    _celebrateJackpot(amountCents, tier) {
      // Distinct jackpot celebration — separate path from _celebrateWin so
      // a jackpot doesn't look like a regular MEGA win. Five-second window
      // (vs 2s for regular wins), tier-themed color, count-up animation,
      // and confetti (lazy-loaded — see below).
      //
      // Tier colors mirror the four-tier jackpot pool:
      //   mini  → silver
      //   minor → bronze
      //   major → gold
      //   grand → rainbow (animated shimmer)
      const TIER_THEMES = {
        mini:  { label: 'MINI JACKPOT',  color: '#C0C0C0', glow: '192,192,192' },
        minor: { label: 'MINOR JACKPOT', color: '#CD7F32', glow: '205,127,50'  },
        major: { label: 'MAJOR JACKPOT', color: '#F0C66E', glow: '240,198,110' },
        grand: { label: 'GRAND JACKPOT', color: '#FFD700', glow: '255,215,0'   },
      };
      const tierKey = String(tier || 'grand').toLowerCase();
      const theme = TIER_THEMES[tierKey] || TIER_THEMES.grand;
      const isGrand = tierKey === 'grand';

      this._fx('jackpot');

      const overlay = document.createElement('div');
      overlay.setAttribute('role', 'status');
      overlay.setAttribute('aria-live', 'assertive');
      overlay.setAttribute('aria-label', theme.label + ' won — ' + fmt(amountCents));
      overlay.style.cssText =
        'position:fixed;inset:0;z-index:10600;display:flex;flex-direction:column;' +
        'align-items:center;justify-content:center;pointer-events:none;' +
        'background:radial-gradient(circle at center,rgba(0,0,0,0.78) 0%,rgba(0,0,0,0.2) 75%);' +
        'animation:ceJackpotFade 5s ease-out forwards;';

      const label = document.createElement('div');
      label.textContent = theme.label;
      if (isGrand) {
        // Rainbow shimmer for the top tier.
        label.style.cssText =
          'font-family:"Plus Jakarta Sans",Inter,sans-serif;font-weight:900;' +
          'letter-spacing:clamp(.16rem,1.2vw,.4rem);font-size:clamp(2.4rem,12vw,4.6rem);color:transparent;' +
          'max-width:96vw;text-align:center;' +
          'background:linear-gradient(90deg,#FF1744,#FFD700,#00E676,#00B0FF,#D500F9,#FF1744);' +
          'background-size:200% auto;-webkit-background-clip:text;background-clip:text;' +
          '-webkit-text-fill-color:transparent;' +
          'animation:ceCelebratePop 600ms cubic-bezier(.2,.9,.4,1.2) both,' +
          'ceJackpotShimmer 2.4s linear infinite;' +
          'filter:drop-shadow(0 0 18px rgba(255,215,0,0.7));';
      } else {
        label.style.cssText =
          'font-family:"Plus Jakarta Sans",Inter,sans-serif;font-weight:900;' +
          'letter-spacing:clamp(.14rem,1.1vw,.35rem);font-size:clamp(2.1rem,11vw,4.0rem);color:' + theme.color + ';' +
          'max-width:96vw;text-align:center;' +
          'text-shadow:0 0 32px rgba(' + theme.glow + ',0.9),0 0 12px ' + theme.color + ';' +
          'animation:ceCelebratePop 600ms cubic-bezier(.2,.9,.4,1.2) both;';
      }

      const amount = document.createElement('div');
      amount.textContent = fmt(0);
      amount.style.cssText =
        'margin-top:1.4rem;font-size:3.2rem;font-weight:800;color:#fff;' +
        'text-shadow:0 2px 16px rgba(0,0,0,0.8),0 0 24px rgba(' + theme.glow + ',0.5);' +
        'animation:ceCelebratePop 700ms 120ms cubic-bezier(.2,.9,.4,1.2) both;';

      overlay.appendChild(label);
      overlay.appendChild(amount);
      document.body.appendChild(overlay);

      // Animate the won amount from 0 → final using the same easing as the
      // balance chip. Industry-standard premium move — the player watches
      // the number climb instead of seeing it pop in.
      this._countUp(amount, 0, amountCents, 1800);

      // Confetti burst — three staggered bursts so it doesn't feel like
      // a single flat poof. Skip under reduced-motion. The 100 game pages
      // don't preload confetti.min.js (saves ~8KB on the 99% of sessions
      // that never hit a jackpot), so we lazy-load it on demand here.
      // If the script tag fails the overlay still works — we just skip
      // the particle effect.
      const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      if (!reduce) {
        const fireBursts = () => {
          if (typeof window.confetti !== 'function') return;
          const baseOpts = { particleCount: isGrand ? 180 : 110, spread: 75, startVelocity: 50, ticks: 280, scalar: 1.1 };
          const fire = (origin, delayMs) => setTimeout(() => {
            try { window.confetti(Object.assign({}, baseOpts, { origin })); } catch (_) { /* silent */ }
          }, delayMs);
          fire({ x: 0.5, y: 0.55 }, 0);
          fire({ x: 0.2, y: 0.65 }, 350);
          fire({ x: 0.8, y: 0.65 }, 700);
          if (isGrand) fire({ x: 0.5, y: 0.4 }, 1100);
        };
        if (typeof window.confetti === 'function') {
          fireBursts();
        } else {
          // Game pages live at /games/<slug>.html → ../js/ ; lobby lives
          // at / → js/. Pick the right path up front instead of chained
          // error-fallback that does a wasted round-trip.
          const confettiSrc = location.pathname.includes('/games/')
            ? '../js/confetti.min.js'
            : 'js/confetti.min.js';
          const tag = document.createElement('script');
          tag.src = confettiSrc;
          tag.async = true;
          tag.onload = fireBursts;
          // onerror left unbound — particles silently skipped on load failure.
          document.head.appendChild(tag);
        }
      }

      // Self-clean — 5s to match the keyframe fade-out.
      setTimeout(() => overlay.remove(), 5000);
    }

    _initJackpotPill() {
      // Inject the small live-jackpot pill in the top-right corner of the
      // game page. Polls /api/jackpot/status every 30s. The pill shows the
      // grand-tier pool amount (the most aspirational number) by default,
      // falling back to the largest available tier if `grand` is missing.
      //
      // No DOM change needed on the 100 game pages — the engine boots
      // them all via games/<slug>.html → casino-engine.js init, so this
      // single injection covers every game.
      if (document.querySelector('.ce-jackpot-pill')) return;
      const pill = document.createElement('div');
      pill.className = 'ce-jackpot-pill';
      pill.setAttribute('role', 'status');
      pill.setAttribute('aria-live', 'off'); // changes are visual; don't spam screen readers
      const dot = document.createElement('span');
      dot.className = 'ce-jp-dot';
      const lab = document.createElement('span');
      lab.className = 'ce-jp-label';
      lab.textContent = 'Jackpot';
      const amt = document.createElement('span');
      amt.className = 'ce-jp-amt';
      amt.textContent = '—';
      pill.appendChild(dot);
      pill.appendChild(lab);
      pill.appendChild(amt);
      document.body.appendChild(pill);

      const refresh = () => {
        fetch('/api/jackpot/status', { credentials: 'same-origin' })
          .then(r => r.ok ? r.json() : null)
          .then(j => {
            if (!j || !Array.isArray(j.pools)) return;
            // Server shape: { pools: [{ tier, currentAmount, lastWinner }, ...] }
            // currentAmount is dollars (not cents). Pick the largest-tier
            // available — grand first, falling through to lower tiers if
            // the table hasn't been seeded yet.
            const order = ['grand', 'major', 'minor', 'mini'];
            const map = {};
            for (const p of j.pools) {
              if (p && p.tier) map[p.tier] = p;
            }
            let chosen = null;
            for (const k of order) {
              if (map[k] && map[k].currentAmount > 0) { chosen = map[k]; break; }
            }
            if (!chosen) { amt.textContent = '—'; return; }
            const cents = Math.round(chosen.currentAmount * 100);
            const prev = parseInt(amt.dataset.cents || '0', 10);
            amt.dataset.cents = String(cents);
            // Reflect tier in the label so the player knows which pool is
            // visible (matters when the grand row hasn't seeded yet).
            lab.textContent = (chosen.tier.charAt(0).toUpperCase() + chosen.tier.slice(1)) + ' Jackpot';
            if (prev > 0 && prev !== cents) {
              this._countUp(amt, prev, cents, 800);
            } else {
              amt.textContent = fmt(cents);
            }
          })
          .catch(() => { /* silent — pill stays at last known value */ });
      };
      refresh();
      // Poll cadence chosen to match the lobby widget (30s in ui-lobby.js)
      // for a consistent live feel without server load.
      this._jackpotPollId = setInterval(refresh, 30000);
    }

    _changeBet(dir) {
      const g = this.state.game;
      if (!g) return;
      const step = g.betStepCents;
      let next = this.state.betCents + dir * step;
      if (next < g.minBetCents) next = g.minBetCents;
      if (next > g.maxBetCents) next = g.maxBetCents;
      this.state.betCents = next;
      this.betLabel.textContent = fmt(next);
      if (this.meterBet) this.meterBet.textContent = fmt(next);
      this._fx(dir > 0 ? 'bet-up' : 'bet-down');
      this._syncBetPresets();
    }

    _maxBet() {
      const g = this.state.game;
      if (!g) return;
      this.state.betCents = g.maxBetCents;
      this.betLabel.textContent = fmt(g.maxBetCents);
      if (this.meterBet) this.meterBet.textContent = fmt(g.maxBetCents);
      this._fx('bet-up');
      this._syncBetPresets();
    }

    // Compute the five bet presets (Min / Low / Med / High / Max) from the
    // game's bet bounds. Each interior preset is snapped to a betStep multiple
    // and clamped into [min, max]; duplicates (tiny ranges) are de-duped while
    // preserving order, so a near-flat range may yield fewer than 5 chips.
    // Returns [{ label, cents }, …]. Presentation only — no money logic.
    _betPresets() {
      const g = this.state.game;
      if (!g) return [];
      const min = g.minBetCents;
      const max = g.maxBetCents;
      const step = g.betStepCents || 1;
      const range = max - min;
      const snap = (cents) => {
        // Snap to the nearest step multiple ABOVE min, then clamp.
        let v = min + Math.round((cents - min) / step) * step;
        if (v < min) v = min;
        if (v > max) v = max;
        return v;
      };
      const defs = [
        ['Min', min],
        ['Low', snap(min + range * 0.25)],
        ['Med', snap(min + range * 0.50)],
        ['High', snap(min + range * 0.75)],
        ['Max', max],
      ];
      const seen = new Set();
      const out = [];
      for (const [label, cents] of defs) {
        if (seen.has(cents)) continue;
        seen.add(cents);
        out.push({ label, cents });
      }
      return out;
    }

    // Set the bet to an exact cents value (clamped) and mirror every UI surface
    // the steppers/max touch: bet label + BET meter cell + active-preset
    // highlight. Does NOT invent new state — writes the same this.state.betCents
    // the spin path reads, identical to _changeBet/_maxBet.
    _setBet(cents) {
      const g = this.state.game;
      if (!g) return;
      let next = cents;
      if (next < g.minBetCents) next = g.minBetCents;
      if (next > g.maxBetCents) next = g.maxBetCents;
      this.state.betCents = next;
      this.betLabel.textContent = fmt(next);
      if (this.meterBet) this.meterBet.textContent = fmt(next);
      this._syncBetPresets();
      this._fx('bet-up');
    }

    // Toggle the .active class on whichever preset chip matches the current bet.
    _syncBetPresets() {
      if (!this._betPresetBtns) return;
      const cur = this.state.betCents;
      for (const btn of this._betPresetBtns) {
        const on = Number(btn.dataset.cents) === cur;
        btn.classList.toggle('active', on);
        btn.setAttribute('aria-pressed', on ? 'true' : 'false');
      }
    }

    // Refresh the static cells of the BET/WIN/BALANCE meter from state. The WIN
    // cell is driven separately by _spin (count-up + per-spin reset) so it isn't
    // clobbered here.
    _updateMeter() {
      if (this.meterBet) this.meterBet.textContent = fmt(this.state.betCents);
      if (this.meterBalance) this.meterBalance.textContent = fmt(this.state.balanceCents);
    }

    _showAutoplayPicker(anchorEl) {
      // Popover anchored to the AUTO button. Player picks a run length
      // (10/25/50/100) and, optionally, advanced stop limits (single-win /
      // loss / profit). Choosing a preset starts autoplay immediately with
      // whatever limits were entered; SPIN morphs into a STOP control showing
      // the remaining count. Built with createElement/textContent (XSS-safe).
      // Close any prior instance.
      const prev = document.getElementById('ce-autoplay-picker');
      if (prev) { prev.remove(); return; }

      this._fx('stop');

      const rect = anchorEl.getBoundingClientRect();
      const picker = document.createElement('div');
      picker.id = 'ce-autoplay-picker';
      picker.setAttribute('role', 'menu');
      picker.setAttribute('aria-label', 'Autoplay settings');
      picker.style.cssText =
        'position:fixed;z-index:10550;background:#161B23;' +
        'border:1px solid ' + this._primary + '55;border-radius:10px;' +
        'box-shadow:0 12px 32px rgba(0,0,0,0.6);' +
        'padding:10px;display:flex;gap:8px;flex-direction:column;' +
        'width:230px;max-width:calc(100vw - 16px);' +
        'top:' + Math.round(rect.bottom + 6) + 'px;' +
        'left:' + Math.round(rect.left) + 'px;';

      // ── Optional stop-limit inputs (responsible-gambling + premium) ──
      const limitInputs = {};
      const addLimit = (key, label) => {
        const row = document.createElement('label');
        row.style.cssText = 'display:flex;align-items:center;justify-content:space-between;gap:8px;font-size:0.76rem;color:#C7CDD9;';
        const span = document.createElement('span');
        span.textContent = label;
        const wrap = document.createElement('span');
        wrap.style.cssText = 'display:inline-flex;align-items:center;gap:2px;';
        const dollar = document.createElement('span');
        dollar.textContent = '$';
        dollar.style.cssText = 'color:#8B95A8;font-size:0.76rem;';
        const input = document.createElement('input');
        input.type = 'number';
        input.min = '0';
        input.step = '1';
        input.placeholder = '—';
        input.setAttribute('aria-label', label);
        input.style.cssText =
          'width:64px;background:rgba(0,0,0,0.35);border:1px solid ' + this._primary + '33;' +
          'border-radius:6px;color:#F0F0F5;padding:4px 6px;font:inherit;font-size:0.8rem;text-align:right;';
        // Stop key events bubbling to the global Space/Enter spin handler.
        input.addEventListener('keydown', (e) => e.stopPropagation());
        wrap.appendChild(dollar); wrap.appendChild(input);
        row.appendChild(span); row.appendChild(wrap);
        limitInputs[key] = input;
        picker.appendChild(row);
      };
      const advTitle = document.createElement('div');
      advTitle.textContent = 'Stop autoplay if…';
      advTitle.style.cssText = 'font-size:0.66rem;letter-spacing:.1em;text-transform:uppercase;color:#8B95A8;font-weight:700;';
      picker.appendChild(advTitle);
      addLimit('singleWin', 'Single win ≥');
      addLimit('loss', 'Cash drops by');
      addLimit('profit', 'Cash rises by');

      const dollarsToCents = (el) => {
        const v = parseFloat(el && el.value);
        return (isFinite(v) && v > 0) ? Math.round(v * 100) : null;
      };

      const presetTitle = document.createElement('div');
      presetTitle.textContent = 'Number of spins';
      presetTitle.style.cssText = 'font-size:0.66rem;letter-spacing:.1em;text-transform:uppercase;color:#8B95A8;font-weight:700;margin-top:2px;';
      picker.appendChild(presetTitle);

      const presetRow = document.createElement('div');
      presetRow.style.cssText = 'display:grid;grid-template-columns:1fr 1fr;gap:6px;';
      const presets = [10, 25, 50, 100];
      presets.forEach(n => {
        const item = document.createElement('button');
        item.type = 'button';
        item.setAttribute('role', 'menuitem');
        item.textContent = n + ' spins';
        item.style.cssText =
          'background:rgba(255,255,255,0.04);border:1px solid ' + this._primary + '33;color:#F0F0F5;' +
          'padding:8px 10px;border-radius:6px;cursor:pointer;font:inherit;font-size:0.9rem;font-weight:600;';
        item.addEventListener('mouseenter', () => item.style.background = this._primary + '22');
        item.addEventListener('mouseleave', () => item.style.background = 'rgba(255,255,255,0.04)');
        item.addEventListener('click', () => {
          const limits = {
            singleWinLimitCents: dollarsToCents(limitInputs.singleWin),
            lossLimitCents: dollarsToCents(limitInputs.loss),
            profitLimitCents: dollarsToCents(limitInputs.profit),
          };
          picker.remove();
          this._startAutoplay(n, limits);
        });
        presetRow.appendChild(item);
      });
      picker.appendChild(presetRow);

      document.body.appendChild(picker);

      // Clamp horizontally so the popover never overflows off a narrow phone
      // (the AUTO button can wrap to the right edge of the control bar).
      const pw = picker.getBoundingClientRect().width || 230;
      picker.style.left = Math.max(8, Math.min(Math.round(rect.left), window.innerWidth - pw - 8)) + 'px';

      // Close on outside click or Escape.
      const onDocClick = (e) => {
        if (e.target === anchorEl) return;
        if (picker.contains(e.target)) return;
        picker.remove();
        document.removeEventListener('click', onDocClick, true);
        document.removeEventListener('keydown', onKey, true);
      };
      const onKey = (e) => {
        if (e.key === 'Escape') {
          picker.remove();
          document.removeEventListener('click', onDocClick, true);
          document.removeEventListener('keydown', onKey, true);
        }
      };
      setTimeout(() => {
        document.addEventListener('click', onDocClick, true);
        document.addEventListener('keydown', onKey, true);
      }, 0);
    }

    _setAutoBtnEnabled(enabled) {
      if (!this.autoBtn) return;
      this.autoBtn.disabled = !enabled;
      this.autoBtn.style.opacity = enabled ? '1' : '0.5';
    }

    // ──────────────────────────────────────────────────────────────
    // Spin speed (Normal / Fast / Turbo)
    // ──────────────────────────────────────────────────────────────
    // 3 modes — cycled by the ⚡ button. Drives `rollMs` (the per-tick
    // rolling-symbol cadence) and `reelStopMs` (the per-reel landing
    // delay) read by _spin(). Near-miss anticipation slowdown is layered
    // on top — turbo doesn't suppress the tension beat, it just speeds
    // the base spin.
    _spinSpeedConfig() {
      const modes = [
        { label: '⚡',   title: 'Normal speed',     rollMs: 80, reelStopMs: 240 },
        { label: '⚡⚡', title: 'Fast speed',       rollMs: 50, reelStopMs: 140 },
        { label: '⚡⚡⚡', title: 'Turbo speed',      rollMs: 25, reelStopMs:  70 },
      ];
      return modes[this.state.spinSpeed || 0] || modes[0];
    }
    _cycleSpinSpeed() {
      this.state.spinSpeed = ((this.state.spinSpeed || 0) + 1) % 3;
      try { localStorage.setItem('ceSpinSpeed_' + this.gameId, String(this.state.spinSpeed)); } catch (_) {}
      this._updateTurboBtnLabel();
      this._fx('stop'); // tactile confirmation
    }
    _updateTurboBtnLabel() {
      if (!this.turboBtn) return;
      const cfg = this._spinSpeedConfig();
      this.turboBtn.textContent = cfg.label;
      this.turboBtn.title = cfg.title;
      this.turboBtn.setAttribute('aria-label', cfg.title);
    }

    // ──────────────────────────────────────────────────────────────
    // Connection-loss recovery
    // ──────────────────────────────────────────────────────────────
    // Real-money slot UX requirement: if /api/spin's response is lost
    // (mobile drops signal, Render proxy returns 503, etc.) the player
    // should NOT lose $5 to an ambiguous failure. We attach a client-
    // generated nonce to every spin so the server can replay the prior
    // result, and we retry-with-backoff before giving up.
    //
    // Flow:
    //   1. Engine generates nonce + persists to localStorage BEFORE fetch
    //   2. Spin fetch; if it succeeds, clear the nonce and continue
    //   3. If it fails (network / 5xx / timeout), retry up to 3× with
    //      exponential backoff (500ms / 1.5s / 4s). The server treats
    //      a same-nonce retry as a replay — at-most-once semantics.
    //   4. If all retries fail, hit GET /api/spin/by-nonce/:nonce to
    //      ask "did my spin actually complete?". If yes (the server
    //      did process it and only the response was lost), return the
    //      stored outcome. If 404, the bet was never charged — safe
    //      to retry fresh.
    //   5. On engine boot, check localStorage for an orphan nonce from
    //      a previous session and reconcile via the same /by-nonce call.

    _generateNonce() {
      // crypto.randomUUID is widely supported (Chrome 92+, Safari 15.4+, FF 95+).
      // Fallback uses crypto.getRandomValues for older browsers + an entropy
      // string. Never falls back to Math.random — that violates CLAUDE.md
      // Rule #7 (no Math.random anywhere a security primitive belongs).
      try {
        if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
          return crypto.randomUUID();
        }
      } catch (_) {}
      try {
        if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
          const bytes = new Uint8Array(16);
          crypto.getRandomValues(bytes);
          // Hex-encode → 32 chars, fits NONCE_RE on the server.
          return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
        }
      } catch (_) {}
      // Last-resort fallback — combines Date.now() and a counter to stay
      // unique enough that two spins back-to-back never collide. This
      // path should be unreachable in any modern browser.
      this._fallbackNonceCounter = (this._fallbackNonceCounter || 0) + 1;
      return 'fb_' + Date.now().toString(36) + '_' + this._fallbackNonceCounter.toString(36).padStart(8, '0');
    }

    _persistPendingNonce(nonce, useFreeSpin) {
      // Stored per (userId × gameId) so multiple tabs on different
      // games don't collide. The userId is in the JWT but we don't
      // unpack it here — gameId scoping is sufficient because a user
      // can only have one in-flight spin per game (enforced by the
      // server's `activeSpins` mutex).
      try {
        const key = 'ceSpinNonce_' + this.gameId;
        localStorage.setItem(key, JSON.stringify({
          nonce: nonce,
          useFreeSpin: !!useFreeSpin,
          startedAt: Date.now(),
        }));
      } catch (_) { /* private mode — recovery just won't work this session */ }
    }

    _clearPendingNonce() {
      try { localStorage.removeItem('ceSpinNonce_' + this.gameId); } catch (_) {}
    }

    _readPendingNonce() {
      try {
        const raw = localStorage.getItem('ceSpinNonce_' + this.gameId);
        if (!raw) return null;
        const data = JSON.parse(raw);
        // Discard records older than 6 hours — very unlikely the server
        // still has them and a stale "recovered" message would confuse
        // the player.
        if (!data || !data.nonce || Date.now() - (data.startedAt || 0) > 6 * 60 * 60 * 1000) {
          this._clearPendingNonce();
          return null;
        }
        return data;
      } catch (_) { return null; }
    }

    async _spinWithRetry(opts) {
      // 3 retries on transient errors (network, 5xx, timeout). Same
      // nonce each attempt so the server can dedupe.
      const api = window.MatrixSpinsAPI; // method-local — `api` is NOT module-scoped
      const BACKOFFS = [0, 500, 1500, 4000];
      let lastErr = null;
      for (let attempt = 0; attempt < BACKOFFS.length; attempt++) {
        if (BACKOFFS[attempt] > 0) {
          this._showReconnectingBanner(attempt);
          await new Promise(r => setTimeout(r, BACKOFFS[attempt]));
        }
        try {
          const result = await api.spin(opts.gameId, opts.betCents, { useFreeSpin: opts.useFreeSpin, nonce: opts.nonce });
          this._hideReconnectingBanner();
          return result;
        } catch (err) {
          lastErr = err;
          // Don't retry on hard client errors — 4xx (auth, validation,
          // limit) won't succeed on retry and they aren't safety risks.
          // The api-client surfaces .status when it parses error bodies.
          const status = err && (err.status || err.code);
          if (status && status >= 400 && status < 500 && status !== 408 && status !== 429) {
            break;
          }
          // Continue to next retry.
        }
      }
      // All retries exhausted — ask the server "did my spin commit?"
      // If yes (recovered: true), surface it as a successful outcome.
      try {
        const recovered = await api.spinByNonce(opts.nonce);
        if (recovered && recovered.recovered) {
          this._hideReconnectingBanner();
          this._showRecoveredToast(recovered);
          return recovered;
        }
      } catch (_) { /* 404 or network — fall through to thrown error */ }
      this._hideReconnectingBanner();
      throw lastErr || new Error('Spin could not be completed.');
    }

    _showReconnectingBanner(attempt) {
      let banner = document.getElementById('ce-reconnect-banner');
      if (!banner) {
        banner = document.createElement('div');
        banner.id = 'ce-reconnect-banner';
        banner.setAttribute('role', 'status');
        banner.setAttribute('aria-live', 'polite');
        banner.style.cssText =
          'position:fixed;left:50%;top:18px;transform:translateX(-50%);z-index:10580;' +
          'padding:.6rem 1.1rem;border-radius:999px;color:#1a1205;' +
          'background:linear-gradient(135deg,#FCD34D 0%,#F0C66E 100%);' +
          'box-shadow:0 6px 18px rgba(0,0,0,0.4);' +
          'font-family:"Plus Jakarta Sans",Inter,sans-serif;font-weight:700;font-size:.85rem;' +
          'display:flex;align-items:center;gap:.6rem;';
        document.body.appendChild(banner);
      }
      while (banner.firstChild) banner.removeChild(banner.firstChild);
      const dot = document.createElement('span');
      dot.style.cssText = 'width:.55rem;height:.55rem;border-radius:50%;background:#1a1205;animation:ceJackpotPulse 1s ease-in-out infinite;';
      banner.appendChild(dot);
      const txt = document.createElement('span');
      txt.textContent = 'Reconnecting… recovering your spin (attempt ' + (attempt + 1) + ')';
      banner.appendChild(txt);
    }

    _hideReconnectingBanner() {
      const banner = document.getElementById('ce-reconnect-banner');
      if (banner) banner.remove();
    }

    _showRecoveredToast(result) {
      // Brief toast confirming a prior spin was recovered. Distinct from
      // the regular win celebration so the player understands what
      // happened — "your previous spin DID complete, here's the outcome".
      const toast = document.createElement('div');
      toast.setAttribute('role', 'status');
      toast.setAttribute('aria-live', 'assertive');
      toast.style.cssText =
        'position:fixed;left:50%;top:30%;transform:translate(-50%,-50%);z-index:10570;' +
        'padding:1.1rem 1.6rem;border-radius:14px;color:#fff;' +
        'background:linear-gradient(135deg,#0F172A 0%,#1E40AF 100%);' +
        'border:1px solid #60A5FA;box-shadow:0 12px 36px rgba(0,0,0,0.55);' +
        'text-align:center;font-family:"Plus Jakarta Sans",Inter,sans-serif;' +
        'animation:ceCelebratePop 600ms cubic-bezier(.2,.9,.4,1.2) both;';
      const lbl = document.createElement('div');
      lbl.style.cssText = 'font-size:.8rem;letter-spacing:.18em;opacity:.75;margin-bottom:.4rem;text-transform:uppercase;font-weight:700;';
      lbl.textContent = 'Spin recovered';
      const amt = document.createElement('div');
      amt.style.cssText = 'font-size:1.8rem;font-weight:900;color:#FCD34D;';
      const cents = result.payoutCents || 0;
      amt.textContent = cents > 0 ? 'Won ' + fmt(cents) : 'No win';
      const sub = document.createElement('div');
      sub.style.cssText = 'font-size:.8rem;margin-top:.5rem;opacity:.8;';
      sub.textContent = 'Your previous spin completed — outcome recovered from the server.';
      toast.appendChild(lbl); toast.appendChild(amt); toast.appendChild(sub);
      document.body.appendChild(toast);
      setTimeout(() => toast.remove(), 4000);
    }

    async _reconcilePendingSpin() {
      // Called on engine boot: if there's an orphan nonce from a
      // previous session (page reload mid-spin, browser crash, etc.),
      // reconcile it. If the server has the result, surface it. If
      // not, just clear the stale entry — the bet was never charged.
      const pending = this._readPendingNonce();
      if (!pending) return;
      const api = window.MatrixSpinsAPI; // method-local — `api` is NOT module-scoped
      try {
        const recovered = await api.spinByNonce(pending.nonce);
        if (recovered && recovered.recovered) {
          // Apply the recovered outcome to state so the balance chip
          // is right + the player sees the message.
          if (typeof recovered.balanceAfterCents === 'number') {
            const prev = this.state.balanceCents;
            this.state.balanceCents = recovered.balanceAfterCents;
            this._updateBalanceChip(prev);
          }
          this._showRecoveredToast(recovered);
        }
      } catch (_) {
        // 404 — no record. Bet wasn't charged. Silent.
      }
      this._clearPendingNonce();
    }

    _startAutoplay(count, limits) {
      // Begin the autoplay run. Guard against starting on top of an
      // already-running run (a programmatic call could collide).
      if (this.state.autoplay) return;
      const n = Math.max(1, Math.min(500, parseInt(count, 10) || 0));
      const lim = limits || {};
      this.state.autoplay = {
        remaining: n,
        startCount: n,
        // Optional player-set stop limits (cents) + the balance baseline for
        // loss/profit deltas. null = limit not set. Evaluated in
        // _shouldStopAutoplay against the server results already in hand.
        singleWinLimitCents: lim.singleWinLimitCents || null,
        lossLimitCents: lim.lossLimitCents || null,
        profitLimitCents: lim.profitLimitCents || null,
        startBalanceCents: this.state.balanceCents,
      };
      // Disable the AUTO button during the run so the player can't open
      // the picker mid-flight. SPIN morphs into STOP (see
      // _updateSpinBtnLabel) which is the correct in-run control.
      this._setAutoBtnEnabled(false);
      this._updateSpinBtnLabel();
      this._fx('toggle');
      // Kick off the first spin. _spin will schedule the next one.
      this._spin(false);
    }

    _stopAutoplay() {
      if (!this.state.autoplay) return;
      this.state.autoplay = null;
      this._setAutoBtnEnabled(true);
      this._updateSpinBtnLabel();
      this._fx('toggle');
    }

    // Brief non-blocking toast explaining why autoplay stopped. Especially
    // important for player-set limits (win/loss/profit) so the stop doesn't
    // feel arbitrary. role=status so assistive tech announces it.
    _autoplayStoppedToast(reason) {
      const MAP = {
        big_win: 'Autoplay stopped — big win!',
        bonus: 'Autoplay paused for the bonus',
        low_balance: 'Autoplay stopped — low balance',
        win_limit: 'Autoplay stopped — single-win limit reached',
        loss_limit: 'Autoplay stopped — loss limit reached',
        profit_limit: 'Autoplay stopped — profit target reached',
        error: 'Autoplay stopped',
      };
      const msg = MAP[reason];
      if (!msg) return;
      const toast = document.createElement('div');
      toast.setAttribute('role', 'status');
      toast.setAttribute('aria-live', 'polite');
      toast.style.cssText =
        'position:fixed;left:50%;bottom:24px;transform:translateX(-50%);z-index:10540;' +
        'padding:.6rem 1.1rem;border-radius:999px;color:#F0F0F5;' +
        'background:rgba(16,20,28,.94);border:1px solid ' + this._primary + '66;' +
        'box-shadow:0 8px 24px rgba(0,0,0,0.5);font-family:"Plus Jakarta Sans",Inter,sans-serif;' +
        'font-weight:600;font-size:.84rem;max-width:calc(100vw - 24px);text-align:center;';
      toast.textContent = msg;
      document.body.appendChild(toast);
      setTimeout(() => toast.remove(), 2600);
    }

    _updateSpinBtnLabel() {
      const ap = this.state.autoplay;
      if (!this.spinBtn) return;
      if (ap) {
        this.spinBtn.textContent = 'STOP (' + ap.remaining + ')';
        this.spinBtn.classList.add('ce-btn-autoplay');
        this.spinBtn.setAttribute('aria-label', 'Stop autoplay (' + ap.remaining + ' spins remaining)');
      } else {
        this.spinBtn.textContent = 'SPIN';
        this.spinBtn.classList.remove('ce-btn-autoplay');
        this.spinBtn.setAttribute('aria-label', 'Spin');
      }
    }

    _shouldStopAutoplay(result, betCents) {
      // Industry-standard stop-on conditions. Any one triggers the stop.
      //
      //   - Big win or larger (>=15x bet) — let the player savour the
      //     win and decide whether to continue. Spamming through a $50
      //     win on autopilot feels wrong.
      //   - Free-spins / bonus trigger — the bonus is its own event;
      //     pause autoplay so the player can engage with it consciously.
      //   - Balance dipped under 5× minBet — running out of money on
      //     autoplay is a worse player experience than stopping early.
      //     Matches the existing per-spin "Insufficient balance" guard
      //     and aligns with responsible-gambling expectations.
      if (!result) return 'error';
      const win = result.payoutCents || 0;
      const bet = betCents || 1;
      const ap = this.state.autoplay || {};
      // Player-configured stop limits (any one triggers). Evaluated against the
      // server-returned payout + the live balance vs the run's start baseline.
      if (ap.singleWinLimitCents && win >= ap.singleWinLimitCents) return 'win_limit';
      if (ap.startBalanceCents != null) {
        const delta = this.state.balanceCents - ap.startBalanceCents;
        if (ap.lossLimitCents && (-delta) >= ap.lossLimitCents) return 'loss_limit';
        if (ap.profitLimitCents && delta >= ap.profitLimitCents) return 'profit_limit';
      }
      if (win / bet >= 15) return 'big_win';
      if ((result.freeSpinsAwarded || 0) > 0) return 'bonus';
      const g = this.state.game;
      const floor = g ? g.minBetCents * 5 : 0;
      if (this.state.balanceCents < floor) return 'low_balance';
      return null;
    }

    _detectNearMiss(reelIdx, g, result) {
      // Return true when the upcoming reel is the FINAL reel AND the
      // already-landed reels share 2+ matching symbols on some row.
      // The 2-on-a-row signal is the canonical trigger for slot
      // anticipation — a player sees two matching symbols and feels
      // the "is it going to land?" tension before the third reel
      // commits. We only trigger on the final reel so the slowdown
      // is the climax, not a mid-spin distraction.
      if (!g || !result || !result.reels) return false;
      if (reelIdx !== g.reels - 1) return false;
      if (reelIdx < 2) return false;
      try {
        for (let y = 0; y < g.rows; y++) {
          const counts = Object.create(null);
          for (let r = 0; r < reelIdx; r++) {
            const sym = result.reels[r] && result.reels[r][y];
            if (sym == null) continue;
            counts[sym] = (counts[sym] || 0) + 1;
            if (counts[sym] >= 2) return true;
          }
        }
      } catch (_) {
        // never let a near-miss detection bug crash the spin
        return false;
      }
      return false;
    }

    // Map a bonus mechanic name/description to a representative emoji icon for
    // the paytable feature card. Keyword match against the 28 bonusType values.
    _featureIcon(text) {
      const t = String(text || '').toLowerCase();
      const map = [
        [/free.?spin|respin|spin/, '🔄'],
        [/wild/, '🃏'],
        [/multiplier|mult|zeus/, '✖️'],
        [/jackpot/, '💰'],
        [/wheel|prize/, '🎡'],
        [/hold|collect|coin|money/, '🪙'],
        [/cascad|tumble|avalanche/, '🌊'],
        [/expand|colossal|stack|mystery/, '🔲'],
        [/scatter/, '⭐'],
        [/chamber|vault|buy.?feature/, '🔓'],
      ];
      for (const [re, icon] of map) { if (re.test(t)) return icon; }
      return '🎁';
    }

    _showInfoModal() {
      // Paytable / game-info modal. Reads from this.state.game and
      // builds a quick-glance reference for the player mid-session.
      // Built entirely with createElement + textContent — no innerHTML,
      // no template interpolation, so game.name (which IS player-
      // facing user content via the server registry) can't ever
      // inject HTML even if some adversarial value got through.
      const g = this.state.game;
      if (!g) return;

      this._fx('stop');

      // Close any prior instance so a double-click doesn't stack overlays.
      const prev = document.getElementById('ce-info-overlay');
      if (prev) prev.remove();

      const opener = document.activeElement;
      const overlay = document.createElement('div');
      overlay.id = 'ce-info-overlay';
      overlay.setAttribute('role', 'dialog');
      overlay.setAttribute('aria-modal', 'true');
      overlay.setAttribute('aria-labelledby', 'ce-info-title');
      overlay.style.cssText =
        'position:fixed;inset:0;z-index:10600;background:rgba(0,0,0,0.65);' +
        'display:flex;align-items:center;justify-content:center;padding:24px;';

      const panel = document.createElement('div');
      panel.className = 'ce-info-panel';
      panel.style.cssText =
        'background:linear-gradient(180deg,#161B23,#0F1218);' +
        'border:1px solid ' + this._primary + '55;border-radius:14px;' +
        'box-shadow:0 24px 60px rgba(0,0,0,0.55);' +
        'width:min(440px,calc(100vw - 32px));' +
        'max-height:calc(100vh - 48px);overflow-y:auto;' +
        'color:#F0F0F5;font-family:Inter,system-ui,sans-serif;';

      const header = document.createElement('div');
      header.style.cssText =
        'padding:18px 22px 6px;display:flex;align-items:center;gap:10px;';
      const title = document.createElement('h2');
      title.id = 'ce-info-title';
      title.textContent = g.name || 'Game info';
      title.style.cssText = 'margin:0;font-size:1.15rem;color:' + this._primary + ';flex:1;';
      const closeBtn = document.createElement('button');
      closeBtn.type = 'button';
      closeBtn.setAttribute('aria-label', 'Close info');
      closeBtn.textContent = '×';
      closeBtn.style.cssText =
        'background:transparent;border:0;color:#9CA3AF;font-size:24px;' +
        'cursor:pointer;padding:4px 10px;line-height:1;';
      header.appendChild(title);
      header.appendChild(closeBtn);

      const meta = document.createElement('div');
      meta.style.cssText =
        'padding:0 22px 12px;display:flex;flex-wrap:wrap;gap:8px;font-size:0.85rem;';
      const metaTags = [];
      // RTP is intentionally omitted from the in-game HEADER (operator policy,
      // commit b2eec40d) but the paytable modal is the sanctioned place to
      // disclose it for players who open the info panel. Accepts a number
      // (96.4) or a pre-formatted string ("96.4%").
      const rtpRaw = (g.rtp != null ? g.rtp : g.rtpPercent);
      let rtpStr = null;
      if (typeof rtpRaw === 'number') {
        if (isFinite(rtpRaw) && rtpRaw > 0) rtpStr = rtpRaw.toFixed(1) + '% RTP';
      } else if (typeof rtpRaw === 'string') {
        const n = parseFloat(rtpRaw); // tolerant of "96.4", "96.4%", "96.4% RTP"
        if (isFinite(n) && n > 0) rtpStr = n.toFixed(1) + '% RTP';
      }
      if (rtpStr) metaTags.push(rtpStr);
      if (g.volatility) metaTags.push(g.volatility + ' volatility');
      if (g.paylines)   metaTags.push(g.paylines + ' lines');
      const maxMult = (g.maxWinMultiplier || g.maxBetMultiplier);
      if (maxMult)      metaTags.push('up to ' + maxMult + '× bet');
      if (g.minBetCents && g.maxBetCents) {
          metaTags.push(fmt(g.minBetCents) + ' – ' + fmt(g.maxBetCents) + ' bet');
      }
      metaTags.forEach(t => {
        const chip = document.createElement('span');
        chip.textContent = t;
        chip.style.cssText =
          'padding:4px 10px;border-radius:999px;border:1px solid ' + this._primary + '44;' +
          'color:' + this._primary + ';background:rgba(255,255,255,0.03);';
        meta.appendChild(chip);
      });

      // ── Lore / "About this game" ──
      // 40-80 word theme story attached by the server from
      // data/game-lore.json. Every premium slot has one; it's what
      // makes a game feel like a place rather than a math model.
      const loreSection = document.createElement('div');
      if (g.lore) {
        loreSection.style.cssText = 'padding:2px 22px 14px;';
        const p = document.createElement('p');
        p.textContent = g.lore;
        p.style.cssText = 'margin:0;font-size:0.9rem;line-height:1.55;color:#C7CDD9;font-style:italic;';
        loreSection.appendChild(p);
      }

      // ── Symbol payouts ──
      // Now shows the cash value at the CURRENT bet alongside the raw
      // multiplier ("5×  →  $5.00"). Players think in money, not
      // multipliers — this is the interactive payout legend the audit
      // flagged as missing. Handles both flat (sym→mult) and nested
      // (sym→{5x,4x,3x}) paytable shapes.
      const paytableSection = document.createElement('div');
      paytableSection.style.cssText = 'padding:8px 22px 14px;';
      if (g.paytable && typeof g.paytable === 'object') {
        const h3 = document.createElement('h3');
        h3.textContent = 'Symbol payouts (at ' + fmt(this.state.betCents) + ' bet)';
        h3.style.cssText = 'margin:6px 0 8px;font-size:0.85rem;color:#9CA3AF;text-transform:uppercase;letter-spacing:0.06em;font-weight:600;';
        paytableSection.appendChild(h3);
        const table = document.createElement('div');
        table.style.cssText = 'display:flex;flex-direction:column;gap:5px;';
        const betCents = this.state.betCents;
        const cashFor = (mult) => {
          const n = parseFloat(mult);
          if (!isFinite(n)) return null;
          return fmt(Math.round(betCents * n));
        };
        Object.keys(g.paytable).forEach(sym => {
          const val = g.paytable[sym];
          const row = document.createElement('div');
          row.className = 'ce-pt-row';
          // Symbol tile — real per-game bitmap art when available, else the
          // themed emoji glyph (falls back on decode error, like the reels).
          const tile = document.createElement('div');
          tile.className = 'ce-pt-tile';
          const [ca, cb] = symbolColors(String(sym), 0);
          tile.style.background = `linear-gradient(135deg, ${ca}, ${cb})`;
          const url = this._symbolArtURL(String(sym).toLowerCase());
          if (url) {
            const img = document.createElement('img');
            img.alt = ''; img.loading = 'lazy'; img.decoding = 'async';
            img.addEventListener('error', () => { tile.textContent = this._symbolGlyph(String(sym)); }, { once: true });
            img.src = url;
            tile.appendChild(img);
          } else {
            tile.textContent = this._symbolGlyph(String(sym));
          }
          const name = document.createElement('span');
          name.className = 'ce-pt-name';
          name.textContent = String(sym).replace(/-/g, ' ');
          const pay = document.createElement('span');
          pay.className = 'ce-pt-pay';
          if (val && typeof val === 'object') {
            const parts = Object.keys(val).map(k => {
              const cash = cashFor(val[k]);
              return k + '× ' + (cash ? cash : (val[k] + '×'));
            });
            pay.textContent = parts.join('  ·  ');
          } else {
            const cash = cashFor(val);
            pay.textContent = cash ? (val + '×  →  ' + cash) : String(val);
          }
          row.appendChild(tile);
          row.appendChild(name);
          row.appendChild(pay);
          table.appendChild(row);
        });
        paytableSection.appendChild(table);
      }

      const bonusSection = document.createElement('div');
      bonusSection.style.cssText = 'padding:0 22px 14px;font-size:0.86rem;color:#CDD3DE;line-height:1.5;';
      if (g.bonusType || g.bonusDesc) {
        const h3 = document.createElement('h3');
        h3.textContent = 'Bonus feature';
        h3.style.cssText = 'margin:6px 0 6px;font-size:0.85rem;color:#9CA3AF;text-transform:uppercase;letter-spacing:0.06em;font-weight:600;';
        bonusSection.appendChild(h3);
        // Feature card with an icon keyed to the bonus mechanic.
        const card = document.createElement('div');
        card.style.cssText = 'display:flex;gap:11px;align-items:flex-start;padding:11px 12px;border-radius:11px;background:rgba(0,255,65,0.05);border:1px solid rgba(0,255,65,0.18);';
        const icon = document.createElement('div');
        icon.textContent = this._featureIcon(g.bonusType || g.bonusDesc || '');
        icon.style.cssText = 'flex:0 0 auto;font-size:1.5rem;line-height:1;filter:drop-shadow(0 0 6px rgba(0,255,65,0.4));';
        const p = document.createElement('p');
        p.textContent = g.bonusDesc || g.bonusType || '';
        p.style.cssText = 'margin:0;';
        card.appendChild(icon);
        card.appendChild(p);
        bonusSection.appendChild(card);
      }

      // ── Your stats on this game ──
      // Async card filled from /api/games/:id/my-stats. Renders a
      // placeholder synchronously so the modal doesn't block on the
      // network, then populates when the fetch resolves. Retention
      // signal — "your biggest win here was $X" makes the player feel
      // known by the casino.
      const statsSection = document.createElement('div');
      statsSection.style.cssText = 'padding:4px 22px 14px;';
      const statsH3 = document.createElement('h3');
      statsH3.textContent = 'Your stats on this game';
      statsH3.style.cssText = 'margin:6px 0 8px;font-size:0.85rem;color:#9CA3AF;text-transform:uppercase;letter-spacing:0.06em;font-weight:600;';
      const statsBody = document.createElement('div');
      statsBody.style.cssText = 'font-size:0.85rem;color:#9CA3AF;';
      statsBody.textContent = 'Loading…';
      statsSection.appendChild(statsH3);
      statsSection.appendChild(statsBody);
      this._fillPersonalStats(statsBody);

      // ── This session ──
      // Client-side running totals for the current sitting (reset on page
      // load). Distinct from the lifetime server aggregates above — labelled so
      // it reads as live continuity, not a duplicate. Presentation only.
      const sessionSection = document.createElement('div');
      if (this.state.sessionSpins > 0) {
        sessionSection.style.cssText = 'padding:4px 22px 14px;';
        const sH3 = document.createElement('h3');
        sH3.textContent = 'This session';
        sH3.style.cssText = 'margin:6px 0 8px;font-size:0.85rem;color:#9CA3AF;text-transform:uppercase;letter-spacing:0.06em;font-weight:600;';
        const sGrid = document.createElement('div');
        sGrid.style.cssText = 'display:grid;grid-template-columns:1fr 1fr;gap:8px 16px;';
        const net = this.state.sessionWinCents - this.state.sessionWageredCents;
        const sRows = [
          ['Spins', String(this.state.sessionSpins)],
          ['Won', fmt(this.state.sessionWinCents)],
          ['Wagered', fmt(this.state.sessionWageredCents)],
          ['Net', (net >= 0 ? '+' : '−') + fmt(Math.abs(net))],
        ];
        sRows.forEach(([label, value]) => {
          const cell = document.createElement('div');
          cell.style.cssText = 'display:flex;flex-direction:column;gap:2px;';
          const l = document.createElement('span');
          l.textContent = label;
          l.style.cssText = 'font-size:0.7rem;color:#8B95A8;text-transform:uppercase;letter-spacing:0.04em;';
          const v = document.createElement('span');
          v.textContent = value;
          let colour = '#F0F0F5';
          if (label === 'Won') colour = '#F0C66E';
          else if (label === 'Net') colour = net >= 0 ? '#4ade80' : '#f87171';
          v.style.cssText = 'font-size:1.0rem;font-weight:700;color:' + colour + ';font-variant-numeric:tabular-nums;';
          cell.appendChild(l); cell.appendChild(v);
          sGrid.appendChild(cell);
        });
        sessionSection.appendChild(sH3);
        sessionSection.appendChild(sGrid);
      }

      const foot = document.createElement('p');
      foot.style.cssText =
        'margin:0;padding:10px 22px 18px;font-size:0.72rem;color:#8B95A8;line-height:1.5;';
      foot.textContent =
        'All outcomes are computed by the casino server using a HMAC-SHA256 ' +
        'commit-reveal scheme. The fairness panel below the reel grid lets you ' +
        'verify each spin against the server seed hash.';

      panel.appendChild(header);
      panel.appendChild(meta);
      if (loreSection.children.length)     panel.appendChild(loreSection);
      if (paytableSection.children.length) panel.appendChild(paytableSection);
      if (bonusSection.children.length)    panel.appendChild(bonusSection);
      if (sessionSection.children.length)  panel.appendChild(sessionSection);
      panel.appendChild(statsSection);
      panel.appendChild(foot);
      overlay.appendChild(panel);
      document.body.appendChild(overlay);

      function close() {
        document.removeEventListener('keydown', onKey, true);
        overlay.remove();
        try { if (opener && opener.focus) opener.focus(); } catch (_) { /* noop */ }
      }
      function onKey(e) {
        if (e.key === 'Escape') { e.preventDefault(); close(); }
      }
      closeBtn.addEventListener('click', close);
      overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
      document.addEventListener('keydown', onKey, true);
      setTimeout(() => closeBtn.focus(), 0);
    }

    // ── Pre-spin game briefing (Item: game info panel) ─────────────────
    // A slide-up sheet shown ONCE per game per browser session before the
    // player's first spin: RTP, volatility, bet range, and the special-feature
    // list. Dismissed with "Got it". Presentation only — never gates play.
    _maybeShowPreSpinInfo() {
      const g = this.state.game;
      if (!g) return;
      const key = 'ce_briefing_' + this.gameId;
      try { if (sessionStorage.getItem(key) === '1') return; } catch (_) { /* private mode — show anyway */ }
      this._showPreSpinPanel();
      try { sessionStorage.setItem(key, '1'); } catch (_) { /* noop */ }
    }

    _showPreSpinPanel() {
      const g = this.state.game;
      if (!g) return;
      if (document.getElementById('ce-prespin-overlay')) return;
      const opener = document.activeElement;

      // RTP — accepts a number (96.4) or a pre-formatted string ("96.4%").
      const rtpRaw = (g.rtp != null ? g.rtp : g.rtpPercent);
      let rtpStr = '—';
      if (typeof rtpRaw === 'number') {
        if (isFinite(rtpRaw) && rtpRaw > 0) rtpStr = rtpRaw.toFixed(1) + '%';
      } else if (typeof rtpRaw === 'string') {
        const n = parseFloat(rtpRaw);
        if (isFinite(n) && n > 0) rtpStr = n.toFixed(1) + '%';
      }
      const volStr = g.volatility
        ? String(g.volatility).charAt(0).toUpperCase() + String(g.volatility).slice(1)
        : '—';
      const betStr = (g.minBetCents != null && g.maxBetCents != null)
        ? fmt(g.minBetCents) + ' – ' + fmt(g.maxBetCents)
        : '—';

      // Special features — built generously from whatever the server game
      // object exposes (mechanic, bonus, wilds/scatters, free spins, max win).
      const features = [];
      const pushF = (s) => { if (s && features.indexOf(s) === -1) features.push(s); };
      if (g.mechanic) pushF(g.mechanic);
      if (g.bonusType) pushF(g.bonusType);
      else if (g.bonusDesc) pushF(g.bonusDesc);
      const syms = g.symbols || [];
      if ((g.wilds && g.wilds.length) || syms.indexOf('wild') !== -1) pushF('Wild symbols');
      if ((g.scatters && g.scatters.length) || syms.indexOf('scatter') !== -1) pushF('Scatter pays');
      if (g.freeSpinCount) pushF(g.freeSpinCount + ' Free Spins');
      const maxMult = g.maxWinMultiplier || g.maxBetMultiplier;
      if (maxMult) pushF('Win up to ' + maxMult + '× your bet');
      if (g.paylines) pushF(g.paylines + ' paylines');
      if (!features.length) pushF('Classic reel play');

      const overlay = $el('div', {
        id: 'ce-prespin-overlay', role: 'dialog', 'aria-modal': 'true',
        'aria-labelledby': 'ce-prespin-title',
      });
      const panel = $el('div', { class: 'ce-prespin-panel' });
      panel.appendChild($el('div', { class: 'ce-prespin-eyebrow' }, 'Game briefing'));
      panel.appendChild($el('h2', { id: 'ce-prespin-title', class: 'ce-prespin-name' }, g.name || this.displayName));

      const stats = $el('div', { class: 'ce-prespin-stats' });
      const stat = (label, value) => $el('div', { class: 'ce-prespin-stat' },
        $el('div', { class: 'ce-prespin-stat-label' }, label),
        $el('div', { class: 'ce-prespin-stat-val' }, value));
      stats.append(stat('RTP', rtpStr), stat('Volatility', volStr), stat('Bet range', betStr));
      panel.appendChild(stats);

      panel.appendChild($el('div', { class: 'ce-prespin-feat-label' }, 'Special features'));
      const featWrap = $el('div', { class: 'ce-prespin-feats' });
      features.forEach((f) => featWrap.appendChild($el('span', { class: 'ce-prespin-chip' }, f)));
      panel.appendChild(featWrap);

      const gotIt = $el('button', { class: 'ce-prespin-gotit', onclick: () => close() }, 'Got it');
      panel.appendChild(gotIt);

      overlay.appendChild(panel);
      document.body.appendChild(overlay);

      function close() {
        document.removeEventListener('keydown', onKey, true);
        overlay.remove();
        try { if (opener && opener.focus) opener.focus(); } catch (_) { /* noop */ }
      }
      function onKey(e) { if (e.key === 'Escape') { e.preventDefault(); close(); } }
      overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
      document.addEventListener('keydown', onKey, true);
      setTimeout(() => { try { gotIt.focus(); } catch (_) { /* noop */ } }, 0);
    }

    // ── Win-history sidebar (Item: collapsible last-20-spins log) ───────
    // Fixed slide-in panel on the right edge. Built once per render; the spin
    // log lives in this.state.spinHistory and survives re-renders.
    _buildHistorySidebar() {
      const panel = $el('aside', {
        class: 'ce-history' + (this._historyOpen ? ' open' : ''),
        role: 'complementary', 'aria-label': 'Spin history',
        'aria-hidden': this._historyOpen ? 'false' : 'true',
      });
      const head = $el('div', { class: 'ce-history-head' },
        $el('span', { class: 'ce-history-title' }, 'Last 20 spins'),
        $el('button', {
          class: 'ce-history-close', 'aria-label': 'Close spin history',
          onclick: () => this._toggleHistory(false),
        }, '×'),
      );
      const list = $el('div', { class: 'ce-history-list' });
      this.historyListEl = list;
      panel.appendChild(head);
      panel.appendChild(list);
      this.historyPanel = panel;
      this.main.appendChild(panel);
      this._renderHistoryList();
    }

    _renderHistoryList() {
      const list = this.historyListEl;
      if (!list) return;
      list.replaceChildren();
      const hist = this.state.spinHistory || [];
      if (!hist.length) {
        list.appendChild($el('div', { class: 'ce-history-empty' },
          'No spins yet — your last 20 results will appear here.'));
        return;
      }
      list.appendChild($el('div', { class: 'ce-history-row ce-history-hdr' },
        $el('span', {}, 'Bet'), $el('span', {}, 'Win'), $el('span', {}, '×')));
      hist.forEach((h) => {
        const win = h.winCents > 0;
        const multStr = h.betCents > 0
          ? (h.winCents / h.betCents).toFixed(2) + '×'
          : (win ? '—' : '0×');
        list.appendChild($el('div', { class: 'ce-history-row' + (win ? ' win' : '') },
          $el('span', { class: 'ce-history-bet' }, (h.free ? 'FS ' : '') + fmt(h.betCents)),
          $el('span', { class: 'ce-history-win' }, win ? '+' + fmt(h.winCents) : '—'),
          $el('span', { class: 'ce-history-mult' }, multStr)));
      });
    }

    _recordSpinHistory(betCents, winCents, free) {
      const HISTORY_MAX = 20;
      if (!this.state.spinHistory) this.state.spinHistory = [];
      this.state.spinHistory.unshift({ betCents, winCents, free: !!free });
      if (this.state.spinHistory.length > HISTORY_MAX) {
        this.state.spinHistory.length = HISTORY_MAX;
      }
      this._renderHistoryList();
    }

    _toggleHistory(force) {
      const open = (typeof force === 'boolean') ? force : !this._historyOpen;
      this._historyOpen = open;
      if (this.historyPanel) {
        this.historyPanel.classList.toggle('open', open);
        this.historyPanel.setAttribute('aria-hidden', open ? 'false' : 'true');
      }
      if (this.histBtn) this.histBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
    }

    async _fillPersonalStats(container) {
      // Fetch per-game aggregates and render a compact stat grid. Failures
      // are swallowed — the stats card is decorative, never gating. The
      // server returns a zeroed shape on its own errors so we still get
      // a clean "no history yet" render.
      let stats = null;
      try {
        if (window.MatrixSpinsAPI && typeof window.MatrixSpinsAPI.myGameStats === 'function') {
          stats = await window.MatrixSpinsAPI.myGameStats(this.gameId);
        }
      } catch (_) { /* network — fall through to unavailable */ }
      if (!container || !container.isConnected) return; // modal closed while fetching
      while (container.firstChild) container.removeChild(container.firstChild);

      if (!stats || stats.unavailable) {
        container.textContent = 'Stats unavailable right now.';
        return;
      }
      if (!stats.spinCount) {
        container.textContent = 'No spins yet — your stats will appear here after you play.';
        return;
      }

      const grid = document.createElement('div');
      grid.style.cssText = 'display:grid;grid-template-columns:1fr 1fr;gap:8px 16px;';
      const fmtMoney = (v) => fmt(Math.round((v || 0) * 100));
      const net = stats.netResult || 0;
      const rows = [
        ['Spins played', String(stats.spinCount)],
        ['Sessions', String(stats.sessionsPlayed || 1)],
        ['Biggest win', fmtMoney(stats.biggestWin)],
        ['Total wagered', fmtMoney(stats.totalWagered)],
        ['Average bet', fmtMoney(stats.averageBet)],
        ['Net result', (net >= 0 ? '+' : '−') + fmtMoney(Math.abs(net))],
      ];
      rows.forEach(([label, value], i) => {
        const cell = document.createElement('div');
        cell.style.cssText = 'display:flex;flex-direction:column;gap:2px;';
        const l = document.createElement('span');
        l.textContent = label;
        l.style.cssText = 'font-size:0.7rem;color:#8B95A8;text-transform:uppercase;letter-spacing:0.04em;';
        const v = document.createElement('span');
        v.textContent = value;
        // Highlight biggest-win gold; colour net result green/red.
        let colour = '#F0F0F5';
        if (label === 'Biggest win') colour = '#F0C66E';
        else if (label === 'Net result') colour = net >= 0 ? '#4ade80' : '#f87171';
        v.style.cssText = 'font-size:1.0rem;font-weight:700;color:' + colour + ';font-variant-numeric:tabular-nums;';
        cell.appendChild(l);
        cell.appendChild(v);
        grid.appendChild(cell);
      });
      container.appendChild(grid);
    }

    _renderFreeSpins() {
      const n = this.state.freeSpinsAvailable;
      // Clear children safely (no innerHTML — keeps the row XSS-clean).
      while (this.freeSpinsRow.firstChild) this.freeSpinsRow.removeChild(this.freeSpinsRow.firstChild);
      if (n > 0) {
        // GRANTED free spins (bonus). These are consumed via POST /freespins/use
        // (fixed bonus_balance credit), NOT a reel spin — routing them through
        // _spin(true) posted bet:0 which the spin route rejected (400), so the
        // button was dead. Wire it to the correct endpoint.
        const btn = $el('button', { class: 'ce-btn ce-btn-maxbet', onclick: () => this._useGrantedFreeSpin() }, `Use free spin (${n} left)`);
        this.freeSpinsRow.appendChild(btn);
      }
    }

    // Consume one granted free spin via the bonus endpoint. The server credits a
    // fixed FREE_SPIN_VALUE to bonus_balance (with wagering) and decrements the
    // count; it is not a reel outcome, so we surface a clear confirmation.
    async _useGrantedFreeSpin() {
      if (this.state.spinning || this._claimingFreeSpin) return;
      this._claimingFreeSpin = true;
      const btn = this.freeSpinsRow.querySelector('button');
      if (btn) btn.disabled = true;
      try {
        const r = await window.MatrixSpinsAPI.useGrantedFreeSpin();
        this._fx('bonus');
        this.state.freeSpinsAvailable = (typeof r.remaining === 'number')
          ? r.remaining
          : Math.max(0, this.state.freeSpinsAvailable - 1);
        // Free spins credit bonus_balance (not withdrawable) — refresh the chip
        // (it tracks withdrawable balance, which is unchanged) and tell the player.
        try {
          const b = await window.MatrixSpinsAPI.getBalance();
          if (typeof b.availableCents === 'number') this.state.balanceCents = b.availableCents;
          this._updateBalanceChip();
        } catch (_) { /* non-fatal */ }
        this.winStrip.style.color = this._primary;
        this.winStrip.textContent = `Free spin claimed — bonus credited! (${this.state.freeSpinsAvailable} left)`;
        this._renderFreeSpins();
      } catch (err) {
        if (btn) btn.disabled = false;
        this.winStrip.style.color = '#ffb3b3';
        this.winStrip.textContent = 'Free spin failed' + (err && err.message ? ' — ' + err.message : '') + '.';
        setTimeout(() => { this.winStrip.style.color = this._primary; }, 3000);
      } finally {
        this._claimingFreeSpin = false;
      }
    }

    _renderBonusRunBanner() {
      // Sticky banner above the reels during a free-spins run. The
      // centrepiece UX moment of every premium slot — players watch the
      // count climb and the total grow. Created/torn down by state.bonusRun
      // transitions tracked in _spin().
      const existing = document.getElementById('ce-bonus-banner');
      const run = this.state.bonusRun;
      // Distinct green glow border on the reel frame for the duration of the run.
      if (this.reelBox) this.reelBox.classList.toggle('ce-freespin', !!run);
      if (!run) {
        if (existing) existing.remove();
        return;
      }
      const remaining = Math.max(0, (run.total || 0) - (run.used || 0));
      const banner = existing || document.createElement('div');
      if (!existing) {
        banner.id = 'ce-bonus-banner';
        banner.className = 'ce-bonus-banner';
        banner.setAttribute('role', 'status');
        banner.setAttribute('aria-live', 'polite');
      }
      while (banner.firstChild) banner.removeChild(banner.firstChild);
      const left = document.createElement('div');
      const lbl = document.createElement('div'); lbl.className = 'ce-bb-label'; lbl.textContent = 'Free Spins';
      const cnt = document.createElement('div'); cnt.className = 'ce-bb-count';
      cnt.textContent = '🎁 ' + (run.used || 0) + ' / ' + (run.total || 0) + (remaining > 0 ? '  ·  ' + remaining + ' left' : '  ·  bonus ending');
      left.appendChild(lbl); left.appendChild(cnt);
      const right = document.createElement('div');
      const tLbl = document.createElement('div'); tLbl.className = 'ce-bb-label'; tLbl.textContent = 'Bonus won';
      const tAmt = document.createElement('div'); tAmt.className = 'ce-bb-total';
      tAmt.textContent = fmt(run.runTotalCents || 0);
      right.appendChild(tLbl); right.appendChild(tAmt);
      banner.appendChild(left);
      banner.appendChild(right);
      if (!existing) {
        if (this.reelBox && this.reelBox.parentNode) {
          this.reelBox.parentNode.insertBefore(banner, this.reelBox);
        } else if (this.main) {
          this.main.insertBefore(banner, this.main.firstChild);
        }
      }
    }

    _showBonusSummary(run) {
      // Fired when a bonus run ends — quick toast summarising the haul.
      const toast = document.createElement('div');
      toast.setAttribute('role', 'status');
      toast.setAttribute('aria-live', 'assertive');
      toast.style.cssText =
        'position:fixed;left:50%;top:30%;transform:translate(-50%,-50%);z-index:10520;' +
        'padding:1.2rem 1.8rem;border-radius:14px;color:#1a1205;' +
        'background:linear-gradient(135deg,#F0C66E 0%,#FFD700 100%);' +
        'box-shadow:0 12px 36px rgba(0,0,0,0.55);text-align:center;' +
        'font-family:"Plus Jakarta Sans",Inter,sans-serif;font-weight:800;' +
        'animation:ceCelebratePop 600ms cubic-bezier(.2,.9,.4,1.2) both;';
      const lbl = document.createElement('div');
      lbl.style.cssText = 'font-size:.85rem;letter-spacing:.18em;opacity:.7;margin-bottom:.4rem;text-transform:uppercase;';
      lbl.textContent = 'Bonus complete';
      const amt = document.createElement('div');
      amt.style.cssText = 'font-size:2.2rem;font-weight:900;';
      amt.textContent = fmt(run.runTotalCents || 0);
      const sub = document.createElement('div');
      sub.style.cssText = 'font-size:.85rem;margin-top:.4rem;opacity:.75;';
      sub.textContent = 'across ' + (run.used || 0) + ' free spin' + ((run.used === 1) ? '' : 's');
      toast.appendChild(lbl); toast.appendChild(amt); toast.appendChild(sub);
      document.body.appendChild(toast);
      setTimeout(() => toast.remove(), 3500);
    }

    // Bridge the server's spin-response vocabulary to the field names this
    // engine's animation + win-display code expects. The two evolved
    // separately: the server returns { grid, winAmount (dollars), balance
    // (dollars), winDetails, ... } while the engine reads { reels,
    // payoutCents, balanceAfterCents, lineWins, multiplier, ... }. Without
    // this bridge, result.reels is undefined and the reel-stop loop throws
    // (result.reels[r]) — aborting EVERY spin (button stuck disabled, no win
    // shown). Combined with the earlier `bet`/`betAmount` mismatch, the
    // browser slot UI could never complete a spin. Idempotent: only fills a
    // field when the engine-native one is absent, so a future server that
    // already speaks cents keeps working.
    _normalizeSpinResult(r) {
      if (!r || typeof r !== 'object') return r;
      if (!r.reels && Array.isArray(r.grid)) r.reels = r.grid;
      if (r.payoutCents == null && typeof r.winAmount === 'number') r.payoutCents = Math.round(r.winAmount * 100);
      if (r.balanceAfterCents == null && typeof r.balance === 'number') r.balanceAfterCents = Math.round(r.balance * 100);
      if (r.multiplier == null) {
        const m = r.winDetails && (r.winDetails.multiplier || r.winDetails.totalMultiplier);
        r.multiplier = (typeof m === 'number' && m > 0) ? m : 1;
      }
      if (!Array.isArray(r.lineWins)) {
        // Server win positions, if present, let us highlight winning cells.
        // game-engine surfaces winDetails.cells as [[col,row],...] which is
        // exactly the engine's [reel,row] highlight format → one synthetic
        // line carrying every winning cell.
        const wd = r.winDetails || {};
        r.lineWins = Array.isArray(wd.cells) && wd.cells.length ? [{ positions: wd.cells }]
          : Array.isArray(wd.lines) ? wd.lines
          : Array.isArray(wd.lineWins) ? wd.lineWins
          : [];
      }
      if (r.scatterWin === undefined) r.scatterWin = null;
      if (r.freeSpinsAwarded == null) r.freeSpinsAwarded = 0;
      return r;
    }

    async _spin(useFreeSpin) {
      if (this.state.spinning) return;
      this.state.spinning = true;
      this._skipAnim = false; // reset tap-to-skip for this spin
      this._sawScatter = false; this._sawWild = false; // reset per-spin landing stingers
      this.spinBtn.disabled = true;
      this.winStrip.textContent = '\u00A0';
      // Reset the WIN meter cell at the start of each spin (premium pattern \u2014
      // the cell shows the CURRENT spin's win, counting up from zero).
      if (this.meterWin) this.meterWin.textContent = fmt(0);

      // Capture pre-spin balance for the count-up animation after the
      // result lands. Lets the chip animate from prev \u2192 new value rather
      // than snapping.
      const prevBalanceCents = this.state.balanceCents;

      // Spin start \u2014 sound + light haptic. The AudioContext lazy-inits on
      // the first user gesture (this click), so the very first spin may
      // be silent in browsers that defer audio until interaction.
      this._fx('spin');

      const api = window.MatrixSpinsAPI;
      const g = this.state.game;
      const symbols = g.symbols;
      const cells = Array.from(this.reelGrid.querySelectorAll('.ce-cell'));
      cells.forEach(c => c.classList.remove('highlight'));
      cells.forEach(c => c.classList.remove('just-landed'));
      // Motion blur — every cell rolls blurred; the blur is cleared per-reel
      // the moment that reel lands (see the stop loop below).
      cells.forEach(c => c.classList.add('ce-rolling'));
      // Clear any paylines from the previous spin + mark every reel column as
      // spinning (drives the vertical scrolling-light streak overlay).
      this._clearPaylines();
      const cols = Array.from(this.reelGrid.querySelectorAll('.ce-col'));
      cols.forEach(c => { c.classList.remove('ce-col-land'); c.classList.add('ce-col-spin'); });

      // Reel-speed config drives the base rolling cadence + per-reel
      // landing delay. Near-miss anticipation slowdown (below) layers
      // on top — speed mode affects the BASE pace, not the tension beat.
      const speedCfg = this._spinSpeedConfig();
      let rollInterval = setInterval(() => {
        cells.forEach((c, i) => {
          const s = symbols[(Math.random() * symbols.length) | 0];
          this._renderCell(c, s, (i / g.rows) | 0, i % g.rows);
        });
      }, speedCfg.rollMs);

      // Generate a per-spin idempotency nonce + persist it BEFORE the
      // fetch so a hard page-reload after a dropped response can still
      // recover the result via _reconcilePendingSpin() on next boot.
      // Server uses the nonce as a replay key — same nonce returns the
      // prior outcome instead of charging again.
      const nonce = this._generateNonce();
      this._persistPendingNonce(nonce, useFreeSpin);

      let result;
      try {
        result = await this._spinWithRetry({
          gameId: this.gameId,
          betCents: useFreeSpin ? 0 : this.state.betCents,
          useFreeSpin: useFreeSpin,
          nonce: nonce,
        });
      } catch (err) {
        clearInterval(rollInterval);
        cells.forEach(c => c.classList.remove('ce-rolling')); // never leave reels blurred on failure
        this.state.spinning = false;
        this.spinBtn.disabled = false;
        this._fx('error');
        this.winStrip.style.color = '#ffb3b3';
        // The retry helper already attempted /by-nonce recovery before
        // throwing. If we got here, the bet was either NOT charged
        // (player can retry) or charged with no record (rare). Surface
        // a clear message so support can investigate if needed.
        this.winStrip.textContent = err && err.message
          ? 'Spin failed — please retry. (' + err.message + ')'
          : 'Spin failed — please retry.';
        setTimeout(() => { this.winStrip.style.color = this._primary; }, 3000);
        return;
      }
      // Spin completed (fresh or recovered) — clear the pending nonce.
      this._clearPendingNonce();

      // Bridge server response → engine field names (grid→reels, winAmount→
      // payoutCents, balance→balanceAfterCents, …). MUST run before the reel-
      // stop loop, which reads result.reels[r].
      result = this._normalizeSpinResult(result);

      // Reel stop sequence with near-miss anticipation.
      //
      // Standard premium slots stretch the last reel's stop when the
      // already-landed reels suggest a big win is possible (matching
      // high-value symbols on a single row). That moment of "is it
      // going to land?" is the most engaging beat in slot UX \u2014 the
      // audit explicitly called it the single most addictive feature
      // and flagged it as 100% missing. We add it here.
      //
      // Detection: as each reel lands, scan rows 0..N-1 across the
      // already-landed reels for 2+ matching symbols. If found on the
      // FINAL reel (so we have anticipation, not premature reveal),
      // we slow that reel from 240ms to ~1500ms with a slower visual
      // roll cadence and a haptic heartbeat. The slowdown reveals the
      // outcome regardless \u2014 the server already decided. The tension
      // is the part the player remembers.
      for (let r = 0; r < g.reels; r++) {
        // Tap-to-skip: once the player taps the reels mid-spin, slam every
        // remaining reel to its final symbols with no delay or anticipation.
        const nearMiss = !this._skipAnim && this._detectNearMiss(r, g, result);
        const delay = nearMiss ? 1500 : speedCfg.reelStopMs;

        if (this._skipAnim) {
          // No await — render this reel's final column immediately (below).
        } else if (nearMiss) {
          // Slow the rolling visual so the eye can register tension.
          // 80ms \u2192 200ms cadence makes the symbols appear to crawl.
          clearInterval(rollInterval);
          rollInterval = setInterval(() => {
            cells.forEach((c, i) => {
              const reelCol = (i / g.rows) | 0;
              // Only roll cells in the still-unlanded reel(s).
              if (reelCol < r) return;
              const s = symbols[(Math.random() * symbols.length) | 0];
              this._renderCell(c, s, reelCol, i % g.rows);
            });
          }, 200);
          // Heartbeat pulse \u2014 quiet lub-dub + haptic for rising tension.
          // Honoured by _fx for reduced-motion users (no buzz).
          this._fx('heartbeat');
          await new Promise((resolve) => setTimeout(resolve, delay * 0.4));
          this._fx('heartbeat');
          await new Promise((resolve) => setTimeout(resolve, delay * 0.4));
          this._fx('heartbeat');
          await new Promise((resolve) => setTimeout(resolve, delay * 0.2));
        } else {
          await new Promise((resolve) => setTimeout(resolve, delay));
        }

        const column = result.reels[r];
        for (let y = 0; y < g.rows; y++) {
          const cellIdx = r * g.rows + y;
          const cell = cells[cellIdx];
          this._renderCell(cell, column[y], r, y);
          if (cell) {
            cell.classList.remove('ce-rolling'); // reel landed — drop the blur
            cell.classList.remove('just-landed');
            // eslint-disable-next-line no-unused-expressions
            cell.offsetWidth; // reflow so re-adding the class re-fires the keyframe
            cell.classList.add('just-landed');
          }
        }
        // Premium landing stingers — an ethereal bell when a scatter drops,
        // an electric zap for a wild. Fired at most once per spin per type
        // so a screen full of wilds doesn't become a wall of noise.
        if (!this._sawScatter && g.scatters && column.some(s => g.scatters.indexOf(s) !== -1)) {
          this._sawScatter = true; this._fx('scatter');
        }
        if (!this._sawWild && g.wilds && column.some(s => g.wilds.indexOf(s) !== -1)) {
          this._sawWild = true; this._fx('wild');
        }
        // Reel landed — stop the spinning streak on this column + play the
        // weighty vertical settle.
        const landedCol = cols[r];
        if (landedCol) {
          landedCol.classList.remove('ce-col-spin');
          landedCol.classList.remove('ce-col-land');
          // eslint-disable-next-line no-unused-expressions
          landedCol.offsetWidth; // reflow so the settle re-fires
          landedCol.classList.add('ce-col-land');
        }
        // Per-reel pitch: each successive reel thuds a little lower, giving
        // a 5-reel stop a satisfying descending staircase.
        this._fx('stop', { reel: r, total: g.reels });
      }
      clearInterval(rollInterval);
      // Safety: ensure no column is left in the spinning state (e.g. tap-to-skip).
      cols.forEach(c => c.classList.remove('ce-col-spin'));

      const winPositions = new Set();
      (result.lineWins || []).forEach(w => w.positions.forEach(([r, y]) => winPositions.add(`${r}-${y}`)));
      if (result.scatterWin) result.scatterWin.positions.forEach(([r, y]) => winPositions.add(`${r}-${y}`));
      winPositions.forEach((k) => {
        const [r, y] = k.split('-').map(Number);
        const cell = cells[r * g.rows + y];
        if (cell) cell.classList.add('highlight');
      });
      // Draw animated paylines connecting the winning cells. Measured live from
      // the just-rendered grid; auto-clears after a few seconds (or next spin).
      if ((result.payoutCents || 0) > 0) this._drawPaylines(result.lineWins);

      const bet = this.state.betCents;
      const win = result.payoutCents || 0;
      // Jackpot branch — server-side jackpot service may flag a spin as
      // a jackpot winner via `result.jackpotWon` (preferred) or
      // `result.jackpot` (legacy alias). Surface a distinct celebration
      // BEFORE the regular win path so a jackpot doesn't look like a
      // normal MEGA win.
      const jackpotInfo = result.jackpotWon || result.jackpot || null;
      const jpCents = jackpotInfo
        ? (jackpotInfo.amountCents != null ? jackpotInfo.amountCents : Math.round((jackpotInfo.amount || 0) * 100))
        : 0;
      if (jpCents > 0) {
        const jpTier = jackpotInfo.tier || 'grand';
        this.winStrip.textContent = `${jpTier.toUpperCase()} JACKPOT! ${fmt(jpCents)}`;
        this._celebrateJackpot(jpCents, jpTier);
      } else if (win > 0) {
        this.winStrip.textContent = `Win ${fmt(win)}${result.multiplier !== 1 ? `  ×${result.multiplier}` : ''}`;
        // Sub-medium wins (<5x) get a quick flash + floating number popup +
        // light sound here; MEDIUM/BIG/MEGA tiers are handled by _celebrateWin
        // (coin shower / Matrix rain / banner + the bigger sound).
        if (win / Math.max(bet, 1) < 5) { this._fx('small'); this._smallWinPopup(win); }
        this._celebrateWin(win, bet);
      } else {
        this.winStrip.textContent = 'No win — try again';
        this.winStrip.style.opacity = .6;
        setTimeout(() => { this.winStrip.style.opacity = 1; }, 400);
      }

      // WIN meter — count the cell up from 0 to the amount won this spin
      // (jackpot amount if a jackpot landed, else the base payout). Snaps
      // instantly under reduced-motion.
      const meterWinCents = jpCents > 0 ? jpCents : win;
      if (this.meterWin) {
        const reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        if (meterWinCents > 0 && !reduceMotion) this._countUp(this.meterWin, 0, meterWinCents, 800);
        else this.meterWin.textContent = fmt(meterWinCents);
      }
      // Current-session accumulators (presentation only — shown in the info
      // modal). Sum the cents the UI already shows; never recompute outcomes.
      this.state.sessionWinCents += meterWinCents;
      if (!useFreeSpin) this.state.sessionWageredCents += bet;
      this.state.sessionSpins += 1;

      // Log this spin for the win-history sidebar (bet, win, payout multiple).
      // Free spins cost 0 — recorded as such so the multiple isn't divide-by-zero.
      this._recordSpinHistory(useFreeSpin ? 0 : bet, meterWinCents, !!useFreeSpin);

      if (result.freeSpinsAwarded > 0) {
        this.winStrip.textContent += `  •  +${result.freeSpinsAwarded} free spins!`;
        this._fx('bonus');
        // Dramatic full-screen reveal of the free-spins count.
        this._freeSpinsReveal(result.freeSpinsAwarded);
      }

      if (typeof result.balanceAfterCents === 'number') {
        this.state.balanceCents = result.balanceAfterCents;
      } else {
        const b = await api.getBalance();
        this.state.balanceCents = b.availableCents;
      }
      this._updateBalanceChip(prevBalanceCents);

      // Announce the spin outcome to assistive tech. Reuses the human-readable
      // text already composed on the (non-live) visual winStrip + the final
      // balance, so a screen-reader player hears e.g. "Win $6.46. Balance
      // $1,006.46." instead of silence.
      if (this.srAnnounce) {
        const outcome = (this.winStrip.textContent || '').replace(/\s+/g, ' ').trim();
        this.srAnnounce.textContent = `${outcome}. Balance ${fmt(this.state.balanceCents)}.`;
      }

      // Bonus-run state machine — drives the free-spins banner.
      // Start: any spin that awards free spins and we don't have a run.
      // Retrigger: spin during an active run that awards more spins.
      // Tick: a free-spin use (useFreeSpin === true) increments used + total.
      const awarded = result.freeSpinsAwarded || 0;
      if (awarded > 0) {
        if (this.state.bonusRun) {
          // Retrigger — extend an existing run.
          this.state.bonusRun.total += awarded;
        } else {
          // Fresh run kicking off.
          this.state.bonusRun = { used: 0, total: awarded, runTotalCents: 0 };
        }
      }
      if (useFreeSpin && this.state.bonusRun) {
        this.state.bonusRun.used += 1;
        this.state.bonusRun.runTotalCents += win;
      }

      try {
        const fs = await api.getFreeSpins(this.gameId);
        this.state.freeSpinsAvailable = (fs.grants || []).reduce((a, gr) => a + gr.remaining, 0);
        this._renderFreeSpins();
      } catch {}

      // Run-end detection: a free-spin just got used AND no more free
      // spins remain. Surface the bonus-complete toast then clear the
      // banner. Premium operators close out the bonus with a summary
      // moment — it's the punctuation on the dopamine peak.
      if (useFreeSpin && this.state.freeSpinsAvailable === 0 && this.state.bonusRun) {
        const finished = this.state.bonusRun;
        this.state.bonusRun = null;
        this._renderBonusRunBanner();
        // Don't show summary if the run had only 1 spin and won nothing —
        // that's a degenerate case (server quirk or test fixture).
        if (finished.used > 0 || finished.runTotalCents > 0) {
          this._showBonusSummary(finished);
        }
      } else {
        this._renderBonusRunBanner();
      }

      // Refresh the provably-fair panel after every spin. The server sends a
      // per-spin `spinIntegrity` HMAC (not a full seed reveal), so we keep the
      // session seeds visible and append the spin signature. Falls back to
      // `result.fairness` if a future server sends per-spin seeds.
      if (result.spinIntegrity || result.fairness) {
        this.state.lastSpin = result;
        const seeds = result.fairness || {
          serverSeedHash: this.state.seeds?.serverSeedHash || '',
          clientSeed: this.state.seeds?.clientSeed || '',
          nonce: this.state.seeds?.nonce || 0,
        };
        this._updateFairnessPanel(seeds, result.spinId, result.spinIntegrity);
      }

      this.state.spinning = false;
      this.spinBtn.disabled = false;

      // Autoplay — schedule the next spin if a run is active and no
      // stop condition fired this turn. The 900ms gap lets the win
      // celebrate-overlay (if any) settle before the next spin starts,
      // and gives the player a chance to hit STOP between spins.
      if (this.state.autoplay && !useFreeSpin) {
        this.state.autoplay.remaining--;
        const stopReason = this._shouldStopAutoplay(result, bet);
        if (stopReason || this.state.autoplay.remaining <= 0) {
          this._stopAutoplay();
          // Tell the player WHY autoplay stopped (esp. for player-set limits).
          if (stopReason) this._autoplayStoppedToast(stopReason);
        } else {
          this._updateSpinBtnLabel();
          setTimeout(() => {
            if (this.state.autoplay && !this.state.spinning) this._spin(false);
          }, 900);
        }
      }
    }

    _renderFairnessPanel() {
      const primary = this._primary;
      const box = $el('details', { style: {
        marginTop: '1.6rem', maxWidth: 860, marginLeft: 'auto', marginRight: 'auto',
        background: 'rgba(0,0,0,.25)', border: `1px solid ${primary}33`,
        borderRadius: '10px', padding: '.7rem 1rem', fontSize: '.85rem',
      }});
      box.appendChild($el('summary', { style: { cursor: 'pointer', color: primary, fontWeight: 600 } }, 'Provably fair — verify this spin'));
      this.fairnessBody = $el('div', { style: { marginTop: '.6rem', display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '.3rem .8rem', fontFamily: 'monospace', opacity: .9 } });
      box.appendChild(this.fairnessBody);
      this._updateFairnessPanel({
        serverSeedHash: this.state.seeds?.serverSeedHash || '',
        clientSeed: this.state.seeds?.clientSeed || '',
        nonce: this.state.seeds?.nonce || 0,
      }, null);
      box.appendChild($el('p', { style: { marginTop: '.6rem', fontSize: '.78rem', opacity: .7 } },
        'When you rotate the server seed, the old seed is revealed. Combine (revealed seed, client seed, nonce) with HMAC-SHA256 to reproduce any past spin and verify fairness.'));
      return box;
    }

    _updateFairnessPanel(fairness, spinId, signature) {
      if (!this.fairnessBody) return;
      this.fairnessBody.replaceChildren();
      fairness = fairness || {};
      const rows = [
        ['Server seed hash', fairness.serverSeedHash || '—'],
        ['Client seed', fairness.clientSeed || '—'],
        ['Nonce', String(fairness.nonce ?? '—')],
      ];
      if (spinId) rows.push(['Spin id', spinId]);
      // Per-spin integrity signature (server HMAC over grid+win+balance). Lets
      // a player confirm the exact spin they saw was the one the server
      // resolved — the server sends this as `spinIntegrity`.
      if (signature) rows.push(['Spin signature', signature]);
      for (const [k, v] of rows) {
        this.fairnessBody.appendChild($el('div', { style: { opacity: .6 } }, k));
        this.fairnessBody.appendChild($el('div', { style: { wordBreak: 'break-all' } }, v));
      }
    }
  }

  function shade(hex, pct) {
    const c = (hex || '#D4A853').replace('#','');
    const expanded = c.length === 3 ? c.split('').map(ch => ch + ch).join('') : c;
    const n = parseInt(expanded, 16) || 0;
    let r = (n >> 16) & 0xff, g = (n >> 8) & 0xff, b = n & 0xff;
    const t = pct > 0 ? 255 : 0;
    const f = Math.abs(pct) / 100;
    r = Math.round((t - r) * f) + r;
    g = Math.round((t - g) * f) + g;
    b = Math.round((t - b) * f) + b;
    return `#${((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1)}`;
  }

  window.CasinoEngine = {
    init(containerId, gameConfig) { return new SlotGame(containerId, gameConfig); },
  };
})();
