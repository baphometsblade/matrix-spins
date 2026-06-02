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
(function () {
  'use strict';

  const HAS_API = typeof window !== 'undefined' && window.MatrixSpinsAPI;

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

  class SlotGame {
    constructor(containerId, gameConfig) {
      this.container = document.getElementById(containerId);
      if (!this.container) throw new Error(`CasinoEngine: #${containerId} not found`);
      this.gameId = gameConfig.id || gameConfig.gameId;
      if (!this.gameId) throw new Error('CasinoEngine: gameConfig.id is required');
      this.theme = gameConfig.studioTheme || {};
      this.displayName = gameConfig.name || 'Slot Game';

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
      const user = await window.MatrixSpinsAPI.loadSession();
      if (!user) {
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
        if (this._balanceUnavailable) {
          this.winStrip && (this.winStrip.textContent = 'Reconnecting to your balance…');
        }
      } catch (err) {
        this._fatal(err.message || 'Failed to load game.');
      }
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

      this.topbar = $el('div', { style: {
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        padding: '.8rem 1.4rem', background: 'rgba(0,0,0,.35)',
        borderBottom: `1px solid ${primary}33`, backdropFilter: 'blur(8px)',
      }});
      this.topbar.append(
        $el('a', { href: '../index.html', style: { color: primary, fontWeight: 700, textDecoration: 'none', letterSpacing: '2px', textTransform: 'uppercase' } }, '← Lobby'),
        $el('div', { style: { display: 'flex', gap: '.8rem', alignItems: 'center' } },
          (this.balanceChip = $el('div', { style: { padding: '.4rem .8rem', border: `1px solid ${primary}55`, borderRadius: '999px', color: primary, fontWeight: 600 } }, '—')),
          $el('a', { href: '../wallet.html', style: { color: '#fff', textDecoration: 'none', fontSize: '.9rem', opacity: .8 } }, 'Wallet'),
          $el('a', { href: '../account.html', style: { color: '#fff', textDecoration: 'none', fontSize: '.9rem', opacity: .8 } }, 'Account'),
        )
      );
      container.appendChild(this.topbar);

      this.main = $el('div', { style: { maxWidth: '1100px', margin: '1.5rem auto 0', padding: '0 1rem' } });
      container.appendChild(this.main);

      this.loading = $el('div', { style: { textAlign: 'center', padding: '3rem 0', opacity: .7 } }, 'Loading game…');
      this.main.appendChild(this.loading);
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

      this.winStrip = $el('div', { class: 'ce-winstrip' }, '\u00A0');
      this.main.appendChild(this.winStrip);

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
      // SPIN button doubles as STOP during autoplay — the onclick
      // checks this.state.autoplay to decide which mode is active.
      // _updateSpinBtnLabel keeps the visible text + aria-label in
      // sync with the current state.
      this.spinBtn = $el('button', {
        class: 'ce-btn primary ce-spin',
        'aria-label': 'Spin',
        onclick: () => {
          if (this.state.autoplay) this._stopAutoplay();
          else this._spin(false);
        },
      }, 'SPIN');

      [betMinus, this.betLabel, betPlus, betMax, infoBtn, turboBtn, autoBtn, this.spinBtn].forEach(b => controlBar.appendChild(b));
      this.main.appendChild(controlBar);

      this.freeSpinsRow = $el('div', { style: { textAlign: 'center', marginTop: '.8rem', fontSize: '.9rem', opacity: .85 } });
      this.main.appendChild(this.freeSpinsRow);
      this._renderFreeSpins();

      this.main.appendChild(this._renderFairnessPanel());

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

          /* Glassy themed control panel */
          .ce-panel { background: linear-gradient(180deg, rgba(10,12,18,.55), rgba(8,10,15,.78)); border: 1px solid color-mix(in srgb, var(--ce-primary) 38%, transparent); border-radius: 16px; padding: .85rem 1rem; box-shadow: inset 0 1px 0 rgba(255,255,255,.07), 0 8px 26px rgba(0,0,0,.4); -webkit-backdrop-filter: blur(7px); backdrop-filter: blur(7px); }
          .ce-betlabel { padding: .5rem 1rem; min-width: 130px; text-align: center; border: 1px solid color-mix(in srgb, var(--ce-primary) 50%, transparent); border-radius: 10px; color: var(--ce-primary); font-weight: 800; font-family: var(--ce-font-display); letter-spacing: 1px; background: rgba(0,0,0,.25); }

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
          .ce-btn-autoplay { background: linear-gradient(180deg, #ef4444, #b91c1c) !important; color: #fff !important; border: none !important; box-shadow: 0 4px 14px rgba(239,68,68,0.45) !important; }
          /* During autoplay the spin button turns into a red STOP — hide the
             gold themed arrow-ring so it doesn't orbit the red button. */
          .ce-btn.primary.ce-spin.ce-btn-autoplay::before { opacity: 0; }

          /* ── Signature circular spin button (the NetEnt/Yggdrasil tell) ── */
          .ce-btn.primary.ce-spin { width: 92px; height: 92px; min-width: 92px; padding: 0; border-radius: 50%; border: none; color: #160f02; font-family: var(--ce-font-display); font-weight: 900; letter-spacing: 1px; text-transform: uppercase; font-size: .95rem; background: radial-gradient(circle at 50% 32%, var(--ce-secondary) 0%, var(--ce-primary) 46%, var(--ce-primary-d) 100%); box-shadow: var(--ce-spin-glow), 0 6px 18px rgba(0,0,0,.5), inset 0 2px 6px rgba(255,255,255,.35), inset 0 -6px 12px rgba(0,0,0,.35); position: relative; display: flex; align-items: center; justify-content: center; text-shadow: 0 1px 1px rgba(255,255,255,.3); }
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
          /* Reduced-motion honour — cells just snap, no landing/winglow loop. */
          @media (prefers-reduced-motion: reduce) {
            .ce-cell, .ce-cell.just-landed, .ce-cell.highlight,
            .ce-btn, .ce-btn.primary { animation: none !important; transition: none !important; }
          }
        `;
        document.head.appendChild(s);
      }
    }

    // ── Custom symbol art (per-game bitmap tiles) ──────────────────────
    // Loads /data/symbol-art.json ONCE (cached on window, shared across
    // every engine instance/page). Fire-and-forget tolerant: any failure
    // (404, parse error, offline) leaves the manifest empty and every cell
    // falls back to the emoji glyph — so games without art are unaffected.
    async _loadSymbolArt() {
      if (window.CE_SYMBOL_ART) { this._symbolArt = window.CE_SYMBOL_ART; return; }
      if (!window.__CE_SYMBOL_ART_PROMISE) {
        // cache:'no-cache' → always revalidate with the server (cheap 304 when
        // unchanged) so newly-generated symbol art appears for returning users.
        // 'force-cache' would pin a stale manifest forever (e.g. an early
        // 1-game manifest), hiding all later art — the same trap that froze
        // sw.js. The tiles themselves are immutable per-id, so they stay cached.
        window.__CE_SYMBOL_ART_PROMISE = fetch('/data/symbol-art.json', { credentials: 'omit', cache: 'no-cache' })
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
        return;
      }
      this._countUp(this.balanceChip, prevCents, target, 700);
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

    _fx(kind) {
      // Centralised sound + haptic dispatcher. Sound names map to the
      // js/sound-manager.js library (window.MatrixSound.play). Haptics
      // honour prefers-reduced-motion: reduce per WCAG 2.3.3 (motion
      // can trigger vestibular issues).
      try {
        const snd = window.MatrixSound && window.MatrixSound.play;
        if (snd) {
          if      (kind === 'spin')     snd('spin');
          else if (kind === 'stop')     snd('tick');
          else if (kind === 'small')    snd('win-small');
          else if (kind === 'big')      snd('win-big');
          else if (kind === 'mega')     snd('jackpot');
          else if (kind === 'jackpot')  snd('jackpot');
          else if (kind === 'bonus')    snd('notification');
          else if (kind === 'error')    snd('error');
        }
      } catch (_) { /* never let audio crash the spin */ }

      // Haptics — disabled under prefers-reduced-motion.
      const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      if (reduce || !navigator.vibrate) return;
      try {
        if      (kind === 'spin')    navigator.vibrate(20);
        else if (kind === 'stop')    navigator.vibrate(10);
        else if (kind === 'small')   navigator.vibrate(60);
        else if (kind === 'big')     navigator.vibrate([80, 60, 80]);
        else if (kind === 'mega')    navigator.vibrate([100, 60, 100, 60, 200]);
        else if (kind === 'jackpot') navigator.vibrate([300, 100, 300, 100, 300, 100, 600]);
        else if (kind === 'bonus')   navigator.vibrate([40, 30, 40]);
        else if (kind === 'error')   navigator.vibrate([30, 30, 30]);
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
      let tier = null;
      if      (ratio >= 150) tier = { label: 'SUPER MEGA WIN', fx: 'mega', color: '#FF5DA2', size: '4.6rem' };
      else if (ratio >= 100) tier = { label: 'EPIC WIN',  fx: 'mega', color: '#F0C66E', size: '4.2rem' };
      else if (ratio >=  50) tier = { label: 'MEGA WIN',  fx: 'mega', color: '#F0C66E', size: '3.6rem' };
      else if (ratio >=  15) tier = { label: 'BIG WIN',   fx: 'big',  color: '#FFD700', size: '3.0rem' };
      if (!tier) return;

      this._fx(tier.fx);

      const overlay = document.createElement('div');
      overlay.setAttribute('role', 'status');
      overlay.setAttribute('aria-live', 'polite');
      overlay.style.cssText =
        'position:fixed;inset:0;z-index:10500;display:flex;flex-direction:column;' +
        'align-items:center;justify-content:center;pointer-events:none;' +
        'background:radial-gradient(circle at center,rgba(0,0,0,0.55) 0%,rgba(0,0,0,0) 70%);' +
        'animation:ceCelebrateFade 1.8s ease-out forwards;';
      const label = document.createElement('div');
      label.textContent = tier.label;
      label.style.cssText =
        'font-family:"Plus Jakarta Sans",Inter,sans-serif;font-weight:900;' +
        'letter-spacing:.3rem;font-size:' + tier.size + ';color:' + tier.color + ';' +
        'text-shadow:0 0 24px ' + tier.color + ',0 0 8px ' + tier.color + ';' +
        'animation:ceCelebratePop 600ms cubic-bezier(.2,.9,.4,1.2) both;';
      const amount = document.createElement('div');
      amount.textContent = fmt(payoutCents);
      amount.style.cssText =
        'margin-top:1rem;font-size:2.4rem;font-weight:800;color:#fff;' +
        'text-shadow:0 2px 12px rgba(0,0,0,0.7);' +
        'animation:ceCelebratePop 700ms 120ms cubic-bezier(.2,.9,.4,1.2) both;';
      overlay.appendChild(label);
      overlay.appendChild(amount);
      document.body.appendChild(overlay);
      // Self-clean
      setTimeout(() => overlay.remove(), 2000);
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
          'letter-spacing:.4rem;font-size:4.6rem;color:transparent;' +
          'background:linear-gradient(90deg,#FF1744,#FFD700,#00E676,#00B0FF,#D500F9,#FF1744);' +
          'background-size:200% auto;-webkit-background-clip:text;background-clip:text;' +
          '-webkit-text-fill-color:transparent;' +
          'animation:ceCelebratePop 600ms cubic-bezier(.2,.9,.4,1.2) both,' +
          'ceJackpotShimmer 2.4s linear infinite;' +
          'filter:drop-shadow(0 0 18px rgba(255,215,0,0.7));';
      } else {
        label.style.cssText =
          'font-family:"Plus Jakarta Sans",Inter,sans-serif;font-weight:900;' +
          'letter-spacing:.35rem;font-size:4.0rem;color:' + theme.color + ';' +
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
    }

    _maxBet() {
      const g = this.state.game;
      if (!g) return;
      this.state.betCents = g.maxBetCents;
      this.betLabel.textContent = fmt(g.maxBetCents);
      this._fx('stop');
    }

    _showAutoplayPicker(anchorEl) {
      // Small choice popover anchored to the AUTO button. Lets the player
      // pick a fixed run length (10/25/50/100 spins). The popover is
      // strictly the picker — once the player chooses, autoplay starts
      // immediately and the SPIN button morphs into a STOP control that
      // shows the remaining count. Industry-standard pattern.
      // Close any prior instance.
      const prev = document.getElementById('ce-autoplay-picker');
      if (prev) { prev.remove(); return; }

      this._fx('stop');

      const rect = anchorEl.getBoundingClientRect();
      const picker = document.createElement('div');
      picker.id = 'ce-autoplay-picker';
      picker.setAttribute('role', 'menu');
      picker.setAttribute('aria-label', 'Choose autoplay length');
      picker.style.cssText =
        'position:fixed;z-index:10550;background:#161B23;' +
        'border:1px solid ' + this._primary + '55;border-radius:10px;' +
        'box-shadow:0 12px 32px rgba(0,0,0,0.6);' +
        'padding:6px;display:flex;gap:4px;flex-direction:column;' +
        'min-width:120px;' +
        'top:' + Math.round(rect.bottom + 6) + 'px;' +
        'left:' + Math.round(rect.left) + 'px;';

      const presets = [10, 25, 50, 100];
      presets.forEach(n => {
        const item = document.createElement('button');
        item.type = 'button';
        item.setAttribute('role', 'menuitem');
        item.textContent = n + ' spins';
        item.style.cssText =
          'background:transparent;border:0;color:#F0F0F5;text-align:left;' +
          'padding:8px 12px;border-radius:6px;cursor:pointer;font:inherit;' +
          'font-size:0.92rem;';
        item.addEventListener('mouseenter', () => item.style.background = this._primary + '22');
        item.addEventListener('mouseleave', () => item.style.background = 'transparent');
        item.addEventListener('click', () => {
          picker.remove();
          this._startAutoplay(n);
        });
        picker.appendChild(item);
      });

      document.body.appendChild(picker);

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

    _startAutoplay(count) {
      // Begin the autoplay run. Guard against starting on top of an
      // already-running run (a programmatic call could collide).
      if (this.state.autoplay) return;
      const n = Math.max(1, Math.min(500, parseInt(count, 10) || 0));
      this.state.autoplay = { remaining: n, startCount: n };
      // Disable the AUTO button during the run so the player can't open
      // the picker mid-flight. SPIN morphs into STOP (see
      // _updateSpinBtnLabel) which is the correct in-run control.
      this._setAutoBtnEnabled(false);
      this._updateSpinBtnLabel();
      // Kick off the first spin. _spin will schedule the next one.
      this._spin(false);
    }

    _stopAutoplay() {
      if (!this.state.autoplay) return;
      this.state.autoplay = null;
      this._setAutoBtnEnabled(true);
      this._updateSpinBtnLabel();
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
        table.style.cssText = 'display:grid;grid-template-columns:1fr auto;gap:6px 14px;font-size:0.88rem;';
        const betCents = this.state.betCents;
        const cashFor = (mult) => {
          const n = parseFloat(mult);
          if (!isFinite(n)) return null;
          return fmt(Math.round(betCents * n));
        };
        Object.keys(g.paytable).forEach(sym => {
          const val = g.paytable[sym];
          const left = document.createElement('span');
          left.textContent = this._symbolGlyph(String(sym)) + '  ' + String(sym);
          left.style.cssText = 'color:#CDD3DE;font-variant-numeric:tabular-nums;';
          const right = document.createElement('span');
          if (val && typeof val === 'object') {
            // Nested: show the top match-count payout in cash + multiplier.
            const parts = Object.keys(val).map(k => {
              const cash = cashFor(val[k]);
              return k + ' ' + (cash ? cash : (val[k] + '×'));
            });
            right.textContent = parts.join('  ·  ');
          } else {
            const cash = cashFor(val);
            right.textContent = cash ? (val + '×  →  ' + cash) : String(val);
          }
          right.style.cssText = 'color:#F0C66E;font-weight:600;text-align:right;font-variant-numeric:tabular-nums;';
          table.appendChild(left);
          table.appendChild(right);
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
        const p = document.createElement('p');
        p.textContent = g.bonusDesc || g.bonusType || '';
        p.style.cssText = 'margin:0;';
        bonusSection.appendChild(p);
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
        const btn = $el('button', { class: 'ce-btn', onclick: () => this._spin(true) }, `Use free spin (${n} left)`);
        this.freeSpinsRow.appendChild(btn);
      }
    }

    _renderBonusRunBanner() {
      // Sticky banner above the reels during a free-spins run. The
      // centrepiece UX moment of every premium slot — players watch the
      // count climb and the total grow. Created/torn down by state.bonusRun
      // transitions tracked in _spin().
      const existing = document.getElementById('ce-bonus-banner');
      const run = this.state.bonusRun;
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
      this.spinBtn.disabled = true;
      this.winStrip.textContent = '\u00A0';

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
        const nearMiss = this._detectNearMiss(r, g, result);
        const delay = nearMiss ? 1500 : speedCfg.reelStopMs;

        if (nearMiss) {
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
          // Heartbeat haptic \u2014 pulsing tension. Honoured by _fx for
          // reduced-motion users (no buzz).
          this._fx('stop');
          await new Promise((resolve) => setTimeout(resolve, delay * 0.4));
          this._fx('stop');
          await new Promise((resolve) => setTimeout(resolve, delay * 0.4));
          this._fx('stop');
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
            cell.classList.remove('just-landed');
            // eslint-disable-next-line no-unused-expressions
            cell.offsetWidth; // reflow so re-adding the class re-fires the keyframe
            cell.classList.add('just-landed');
          }
        }
        this._fx('stop');
      }
      clearInterval(rollInterval);

      const winPositions = new Set();
      (result.lineWins || []).forEach(w => w.positions.forEach(([r, y]) => winPositions.add(`${r}-${y}`)));
      if (result.scatterWin) result.scatterWin.positions.forEach(([r, y]) => winPositions.add(`${r}-${y}`));
      winPositions.forEach((k) => {
        const [r, y] = k.split('-').map(Number);
        const cell = cells[r * g.rows + y];
        if (cell) cell.classList.add('highlight');
      });

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
        // Win tier: small win sound + light haptic. Big/Mega/Epic are
        // handled by _celebrateWin which plays the bigger sound + the
        // full-screen overlay.
        if (win / Math.max(bet, 1) < 15) this._fx('small');
        this._celebrateWin(win, bet);
      } else {
        this.winStrip.textContent = 'No win — try again';
        this.winStrip.style.opacity = .6;
        setTimeout(() => { this.winStrip.style.opacity = 1; }, 400);
      }

      if (result.freeSpinsAwarded > 0) {
        this.winStrip.textContent += `  •  +${result.freeSpinsAwarded} free spins!`;
        this._fx('bonus');
      }

      if (typeof result.balanceAfterCents === 'number') {
        this.state.balanceCents = result.balanceAfterCents;
      } else {
        const b = await api.getBalance();
        this.state.balanceCents = b.availableCents;
      }
      this._updateBalanceChip(prevBalanceCents);

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
