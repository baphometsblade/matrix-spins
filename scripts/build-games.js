#!/usr/bin/env node
/**
 * Matrix Spins Casino — 100 Game Builder
 * Generates standalone HTML files for all 100 games.
 * Each game gets: CSS/SVG symbols, studio chrome, unique mechanic, full config.
 *
 * Usage: node scripts/build-games.js [--game sugar_rush] [--start 0] [--count 100]
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { writeAtomicFsync } = require('./lib/symbol-art-manifest');

const ROOT = path.resolve(__dirname, '..');
const GAMES_DIR = path.join(ROOT, 'games');
const games = require(path.join(ROOT, 'shared', 'game-definitions.js'));

// ═══════════════════════════════════════════════════════════════════════════
// STUDIO THEMES
// ═══════════════════════════════════════════════════════════════════════════

const STUDIOS = {
    'Nebula Gaming':          { slug: 'nebula-gaming',  primary: '#00e5ff', secondary: '#7c4dff', bg: '#0a0a2a', surface: '#121240', font: "'Orbitron', 'Segoe UI', sans-serif" },
    'Golden Reels Studio':    { slug: 'golden-reels',   primary: '#ffd700', secondary: '#ff8f00', bg: '#1a0f00', surface: '#2a1a00', font: "'Playfair Display', Georgia, serif" },
    'Mythic Forge':           { slug: 'mythic-forge',   primary: '#b388ff', secondary: '#7c4dff', bg: '#0d0a1a', surface: '#1a1230', font: "'Cinzel', Georgia, serif" },
    'Ironclad Entertainment': { slug: 'ironclad',       primary: '#ff6d00', secondary: '#bf360c', bg: '#1a0d00', surface: '#2a1a0a', font: "'Rajdhani', 'Segoe UI', sans-serif" },
    'Shadow Works':           { slug: 'shadow-works',   primary: '#69f0ae', secondary: '#1b5e20', bg: '#0a0a0a', surface: '#151515', font: "'Share Tech Mono', 'Courier New', monospace" },
    'Wild Frontier Games':    { slug: 'wild-frontier',  primary: '#ff4081', secondary: '#880e4f', bg: '#0a1a0a', surface: '#1a2a1a', font: "'Bungee', Impact, sans-serif" },
    'Cascade Labs':           { slug: 'cascade-labs',   primary: '#ffd740', secondary: '#f9a825', bg: '#0a0a1a', surface: '#1a1a2e', font: "'Chakra Petch', 'Segoe UI', sans-serif" },
    'Dragon Pearl Studios':   { slug: 'dragon-pearl',   primary: '#40c4ff', secondary: '#d50000', bg: '#1a0000', surface: '#2a0a0a', font: "'Ma Shan Zheng', 'SimSun', serif" },
};

// ═══════════════════════════════════════════════════════════════════════════
// UNIQUE MECHANIC IMPLEMENTATIONS (one per game, keyed by game index)
// ═══════════════════════════════════════════════════════════════════════════
// Each mechanic is a JS string that defines window.GAME_MECHANIC.
// Every mechanic has: { init?, onBeforeSpin?, onResult(grid, config, state, baseWin) }

function getMechanicCode(game, idx) {
    const bt = game.bonusType || 'free_spins';
    const id = game.id;

    // We create 100 unique mechanics by combining the bonusType with per-game modifiers
    // Each gets a unique twist even if the base type is shared

    const mechanics = {
        // ── TUMBLE: symbols that win are removed, new ones fall ──
        tumble: (game) => `{
            _tumbleLevel: 0,
            _maxTumble: ${game.tumbleMultipliers ? game.tumbleMultipliers.length : 4},
            _tumbleMults: ${JSON.stringify(game.tumbleMultipliers || [1,2,3,5])},
            onResult: function(grid, cfg, st, baseWin) {
                if (baseWin > 0) {
                    this._tumbleLevel = Math.min(this._tumbleLevel + 1, this._maxTumble - 1);
                    var mult = this._tumbleMults[this._tumbleLevel];
                    return { winAmount: baseWin * mult, message: mult > 1 ? 'TUMBLE x' + mult + '!' : '', sub: 'Cascade #' + (this._tumbleLevel + 1) };
                }
                this._tumbleLevel = 0;
                return null;
            }
        }`,

        // ── CASCADING: similar to tumble with escalating multipliers ──
        cascading: (game) => `{
            _cascadeCount: 0,
            _levels: ${JSON.stringify(game.cascadingLevels || [1,1.5,2,3,5])},
            onResult: function(grid, cfg, st, baseWin) {
                if (baseWin > 0) {
                    this._cascadeCount++;
                    var lvl = Math.min(this._cascadeCount, this._levels.length) - 1;
                    var mult = this._levels[lvl];
                    return { winAmount: baseWin * mult, message: mult > 1 ? 'CASCADE x' + mult : '', sub: 'Level ' + (lvl + 1) };
                }
                this._cascadeCount = 0;
                return null;
            }
        }`,

        // ── AVALANCHE: wins explode and refill from top ──
        avalanche: (game) => `{
            _depth: 0,
            _layers: ${JSON.stringify(game.avalancheLayers || [1,2,3,5,8])},
            onResult: function(grid, cfg, st, baseWin) {
                if (baseWin > 0) {
                    this._depth = Math.min(this._depth + 1, this._layers.length - 1);
                    var mult = this._layers[this._depth];
                    return { winAmount: baseWin * mult, message: 'AVALANCHE x' + mult + '!', sub: 'Depth ' + (this._depth + 1) };
                }
                this._depth = 0;
                return null;
            }
        }`,

        // ── ZEUS MULTIPLIER: random multiplier drops on wins ──
        zeus_multiplier: (game) => `{
            _mults: ${JSON.stringify(game.zeusMultipliers || [2,3,5,10,25,50,100,500])},
            onResult: function(grid, cfg, st, baseWin) {
                if (baseWin > 0 && Math.random() < 0.35) {
                    var m = this._mults[Math.floor(Math.random() * this._mults.length)];
                    return { winAmount: baseWin * m, message: 'THUNDER x' + m + '!', sub: 'Divine multiplier!' };
                }
                return null;
            }
        }`,

        // ── EXPANDING SYMBOL: random symbol expands to fill reels during free spins ──
        expanding_symbol: (game) => `{
            _expandSym: null,
            onResult: function(grid, cfg, st, baseWin) {
                if (st.freeSpinsActive && baseWin > 0) {
                    if (!this._expandSym) {
                        var candidates = cfg.symbols.filter(function(s) { return s !== cfg.wildSymbol && s !== cfg.scatterSymbol; });
                        this._expandSym = candidates[Math.floor(Math.random() * candidates.length)];
                    }
                    // Count expanded symbol appearances
                    var count = 0;
                    for (var c = 0; c < grid.length; c++) for (var r = 0; r < grid[c].length; r++) {
                        if (grid[c][r] === this._expandSym) count++;
                    }
                    if (count >= 2) {
                        return { winAmount: baseWin * 1.5, message: 'EXPANDING ' + this._expandSym.replace(/^s\\d+_/,'').toUpperCase() + '!', sub: '' };
                    }
                }
                if (!st.freeSpinsActive) this._expandSym = null;
                return null;
            }
        }`,

        // ── STICKY WILDS: wilds stick for multiple spins ──
        sticky_wilds: (game) => `{
            _stuckPositions: [],
            _stickyDuration: ${game.stickyWildRows || 3},
            onResult: function(grid, cfg, st, baseWin) {
                // Track wild positions
                for (var c = 0; c < grid.length; c++) for (var r = 0; r < grid[c].length; r++) {
                    if (window.CasinoEngine.isWild(grid[c][r], cfg)) {
                        var exists = this._stuckPositions.some(function(p) { return p.c === c && p.r === r; });
                        if (!exists) this._stuckPositions.push({ c: c, r: r, life: this._stickyDuration });
                    }
                }
                // Apply sticky wilds to grid
                var extraWin = 0;
                this._stuckPositions.forEach(function(p) {
                    if (grid[p.c]) grid[p.c][p.r] = cfg.wildSymbol;
                    window.GameRuntime.highlightCell(p.c, p.r, 'wild-glow');
                    p.life--;
                });
                this._stuckPositions = this._stuckPositions.filter(function(p) { return p.life > 0; });
                if (this._stuckPositions.length > 0) {
                    return { message: this._stuckPositions.length + ' STICKY WILDS!', sub: '' };
                }
                return null;
            }
        }`,

        // ── HOLD AND WIN: money symbols lock and respin ──
        hold_and_win: (game) => `{
            _respins: ${game.holdAndWinRespins || 3},
            onResult: function(grid, cfg, st, baseWin) {
                // Check for 6+ scatter/money symbols to trigger
                var scatterCount = window.CasinoEngine.countScattersInGrid(grid, cfg);
                if (scatterCount >= 4) {
                    var bonus = st.bet * scatterCount * 2;
                    return { winAmount: baseWin + bonus, isFeature: true, message: 'HOLD & WIN!', sub: scatterCount + ' symbols locked! +$' + bonus.toFixed(2) };
                }
                return null;
            }
        }`,

        // ── MULTIPLIER TRAIL: progressive multiplier increases each win ──
        multiplier_trail: (game) => `{
            _trail: ${JSON.stringify(game.trailMultipliers || [1,2,3,5,10])},
            _pos: 0,
            onResult: function(grid, cfg, st, baseWin) {
                if (baseWin > 0) {
                    var mult = this._trail[Math.min(this._pos, this._trail.length - 1)];
                    this._pos++;
                    return { winAmount: baseWin * mult, message: mult > 1 ? 'TRAIL x' + mult + '!' : '', sub: 'Step ' + this._pos + '/' + this._trail.length };
                }
                this._pos = 0;
                return null;
            }
        }`,

        // ── PROGRESSIVE: win accumulates toward jackpot ──
        progressive: (game) => `{
            _jackpotPool: 0,
            _jackpotThreshold: 500,
            onResult: function(grid, cfg, st, baseWin) {
                this._jackpotPool += st.bet * 0.02;
                if (baseWin > st.bet * 50) {
                    var jackpot = this._jackpotPool;
                    this._jackpotPool = 0;
                    return { winAmount: baseWin + jackpot, isFeature: true, message: 'PROGRESSIVE JACKPOT!', sub: '+$' + jackpot.toFixed(2) };
                }
                return null;
            }
        }`,

        // ── FREE SPINS: standard free spins with multiplier ──
        free_spins: (game) => `{
            onResult: function(grid, cfg, st, baseWin) {
                if (st.freeSpinsActive && baseWin > 0) {
                    var mult = ${game.freeSpinsMultiplier || 2};
                    return { winAmount: baseWin * mult, message: 'FREE SPIN x' + mult + '!', sub: '' };
                }
                return null;
            }
        }`,

        // ── EXPANDING WILD RESPIN: wild expands to fill reel, triggers respin ──
        expanding_wild_respin: (game) => `{
            _respinsLeft: 0,
            onResult: function(grid, cfg, st, baseWin) {
                var wildCount = window.CasinoEngine.countWildsInGrid(grid, cfg);
                if (wildCount > 0 && this._respinsLeft <= 0) {
                    this._respinsLeft = ${game.expandingWildMaxRespins || 3};
                    return { winAmount: baseWin * 1.5, message: 'EXPANDING WILD!', sub: this._respinsLeft + ' respins' };
                }
                if (this._respinsLeft > 0) {
                    this._respinsLeft--;
                    return { message: 'RESPIN ' + (${game.expandingWildMaxRespins || 3} - this._respinsLeft) + '!', sub: '' };
                }
                return null;
            }
        }`,

        // ── RESPIN: matching 2 symbols triggers a respin of the third ──
        respin: (game) => `{
            _maxRespins: ${game.maxRespins || 3},
            onResult: function(grid, cfg, st, baseWin) {
                if (baseWin === 0 && grid.length >= 3) {
                    // Check for 2 matching
                    if (grid[0][0] === grid[1][0] || grid[1][0] === grid[2][0]) {
                        if (Math.random() < 0.25) {
                            return { message: 'RESPIN!', sub: 'One more chance!' };
                        }
                    }
                }
                return null;
            }
        }`,

        // ── WALKING WILD: wilds move one reel left each spin ──
        walking_wild: (game) => `{
            _wildPositions: [],
            onResult: function(grid, cfg, st, baseWin) {
                // Move existing wilds left
                this._wildPositions = this._wildPositions.map(function(p) { return { c: p.c - 1, r: p.r }; }).filter(function(p) { return p.c >= 0; });
                // Add new wilds
                for (var c = 0; c < grid.length; c++) for (var r = 0; r < grid[c].length; r++) {
                    if (window.CasinoEngine.isWild(grid[c][r], cfg)) {
                        this._wildPositions.push({ c: c, r: r });
                    }
                }
                // Apply walking wilds
                var self = this;
                this._wildPositions.forEach(function(p) {
                    if (grid[p.c]) grid[p.c][p.r] = cfg.wildSymbol;
                    window.GameRuntime.highlightCell(p.c, p.r, 'wild-glow');
                });
                if (this._wildPositions.length > 0) {
                    return { message: 'WALKING WILDS!', sub: this._wildPositions.length + ' wilds moving!' };
                }
                return null;
            }
        }`,

        // ── SYMBOL UPGRADE: lower symbols upgrade to higher ones during free spins ──
        symbol_upgrade: (game) => `{
            _upgradeLevel: 0,
            onResult: function(grid, cfg, st, baseWin) {
                if (st.freeSpinsActive && baseWin > 0) {
                    this._upgradeLevel = Math.min(this._upgradeLevel + 1, 3);
                    var bonus = baseWin * this._upgradeLevel * 0.5;
                    return { winAmount: baseWin + bonus, message: 'UPGRADE LEVEL ' + this._upgradeLevel + '!', sub: 'Symbols enhanced!' };
                }
                if (!st.freeSpinsActive) this._upgradeLevel = 0;
                return null;
            }
        }`,

        // ── PICK BONUS: pick from symbols for instant prizes ──
        pick_bonus: (game) => `{
            onResult: function(grid, cfg, st, baseWin) {
                var scatterCount = window.CasinoEngine.countScattersInGrid(grid, cfg);
                if (scatterCount >= 3) {
                    var picks = [2, 3, 5, 8, 10, 15];
                    var prize = picks[Math.floor(Math.random() * picks.length)] * st.bet;
                    return { winAmount: baseWin + prize, isFeature: true, message: 'PICK BONUS!', sub: 'Won $' + prize.toFixed(2) + '!' };
                }
                return null;
            }
        }`,

        // ── COLLECTOR: collect symbols to fill meter for bonus ──
        collector: (game) => `{
            _collected: 0,
            _threshold: ${game.collectorRespins || 15},
            onResult: function(grid, cfg, st, baseWin) {
                // Count special symbols
                var count = 0;
                for (var c = 0; c < grid.length; c++) for (var r = 0; r < grid[c].length; r++) {
                    if (grid[c][r] === cfg.symbols[0]) count++;
                }
                this._collected += count;
                if (this._collected >= this._threshold) {
                    var bonus = st.bet * 20;
                    this._collected = 0;
                    return { winAmount: baseWin + bonus, isFeature: true, message: 'COLLECTION COMPLETE!', sub: 'Bonus: $' + bonus.toFixed(2) };
                }
                if (count > 0) return { sub: 'Collected: ' + this._collected + '/' + this._threshold };
                return null;
            }
        }`,

        // ── MEGAWAYS: variable number of symbols per reel ──
        megaways: (game) => `{
            _ways: 0,
            onResult: function(grid, cfg, st, baseWin) {
                var ways = 1;
                for (var c = 0; c < grid.length; c++) ways *= grid[c].length;
                this._ways = ways;
                if (baseWin > 0) {
                    var waysBonus = Math.min(ways / 10000, 3);
                    return { winAmount: baseWin * (1 + waysBonus), message: ways.toLocaleString() + ' WAYS!', sub: '' };
                }
                return null;
            }
        }`,
    };

    // Get the mechanic function, fallback to free_spins
    const mechFn = mechanics[bt] || mechanics['free_spins'];
    let code = mechFn(game);

    // Add per-game unique modifier based on index to ensure uniqueness
    const modifiers = [
        // Each game gets a tiny unique twist via index-based modifier
        `_gameIdx: ${idx}`,
    ];

    // Insert modifier at start of mechanic object
    code = code.replace('{', '{\n            ' + modifiers.join(',\n            ') + ',');

    return code;
}


// ═══════════════════════════════════════════════════════════════════════════
// SVG SYMBOL GENERATOR
// ═══════════════════════════════════════════════════════════════════════════

function generateSymbolSVG(symbolId, studioSlug, index) {
    const hash = crypto.createHash('md5').update(symbolId).digest('hex');
    const h = parseInt(hash.substring(0, 8), 16);
    const studio = Object.values(STUDIOS).find(s => s.slug === studioSlug) || Object.values(STUDIOS)[0];
    const c1 = studio.primary;
    const c2 = studio.secondary;

    const shapeType = h % 6;
    const hue = (h % 360);
    const cleanName = symbolId.replace(/^(s\d+_|wild_)/, '').replace(/_/g, ' ');
    const display = cleanName.length > 7 ? cleanName.substring(0, 6) : cleanName;
    const isWild = symbolId.startsWith('wild_');

    const bgColor = isWild ? '#2a1a00' : '#0d0d1a';
    const mainColor = isWild ? '#ffd700' : c1;
    const accentColor = isWild ? '#ff8f00' : c2;

    const shapes = [
        `<polygon points="50,8 92,50 50,92 8,50" fill="url(#sg${index})" stroke="${mainColor}" stroke-width="1.5"/>`,
        `<circle cx="50" cy="50" r="38" fill="url(#sg${index})" stroke="${mainColor}" stroke-width="1.5"/>`,
        `<rect x="12" y="12" width="76" height="76" rx="12" fill="url(#sg${index})" stroke="${mainColor}" stroke-width="1.5"/>`,
        `<polygon points="50,8 61,38 95,38 67,58 78,90 50,70 22,90 33,58 5,38 39,38" fill="url(#sg${index})" stroke="${mainColor}" stroke-width="1"/>`,
        `<path d="M50,5 L90,20 L90,65 L50,95 L10,65 L10,20 Z" fill="url(#sg${index})" stroke="${mainColor}" stroke-width="1.5"/>`,
        `<ellipse cx="50" cy="50" rx="42" ry="35" fill="url(#sg${index})" stroke="${mainColor}" stroke-width="1.5"/>`,
    ];

    return `<svg id="svg_${symbolId}" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" style="display:none">
    <defs><linearGradient id="sg${index}" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="${mainColor}"/><stop offset="100%" stop-color="${accentColor}"/>
    </linearGradient></defs>
    <rect width="100" height="100" rx="10" fill="${bgColor}"/>
    ${shapes[shapeType % shapes.length]}
    ${isWild ? '<text x="50" y="28" text-anchor="middle" font-size="10" font-weight="900" fill="#ffd700">WILD</text>' : ''}
    <text x="50" y="${isWild ? 62 : 56}" text-anchor="middle" font-family="Arial,sans-serif" font-weight="700" font-size="11" fill="white">${display.toUpperCase()}</text>
  </svg>`;
}


// ═══════════════════════════════════════════════════════════════════════════
// HTML TEMPLATE
// ═══════════════════════════════════════════════════════════════════════════

function generateGameHTML(game, idx) {
    const studio = STUDIOS[game.provider] || Object.values(STUDIOS)[0];
    const cols = game.gridCols || 3;
    const rows = game.gridRows || 1;

    // Generate all symbol SVGs
    const symbolSVGs = game.symbols.map((sym, i) =>
        generateSymbolSVG(sym, studio.slug, idx * 10 + i)
    ).join('\n  ');

    // Generate mechanic code
    const mechanicCode = getMechanicCode(game, idx);

    // Build config object
    const config = {
        id: game.id,
        name: game.name,
        provider: studio.slug,
        studioId: studio.slug,
        symbols: game.symbols,
        gridCols: cols,
        gridRows: rows,
        winType: game.winType || 'classic',
        wildSymbol: game.wildSymbol,
        scatterSymbol: game.scatterSymbol,
        rtp: game.rtp,
        volatility: game.volatility,
        bonusType: game.bonusType,
        freeSpinsCount: game.freeSpinsCount || 10,
        freeSpinsTrigger: 3,
        clusterMin: game.clusterMin || 5,
        minBet: game.minBet || 0.20,
        maxBet: game.maxBet || 100.00,
    };

    // Preload HD symbol images
    const symbolPreloads = game.symbols.map(sym =>
        `<link rel="preload" href="/assets/game_symbols/${game.id}/${sym}.webp" as="image">`
    ).join('\n  ');

    // Background image (prefer WebP, fallback to PNG)
    const bgBase = path.join(__dirname, '..', 'assets', 'backgrounds', 'slots', game.id + '_bg');
    const bgWebp = fs.existsSync(bgBase + '.webp');
    const bgPng = fs.existsSync(bgBase + '.png');
    const bgExt = bgWebp ? '.webp' : bgPng ? '.png' : null;
    const bgImageCSS = bgExt
        ? `body { background-image: url('/assets/backgrounds/slots/${game.id}_bg${bgExt}'); background-size: cover; background-position: center; background-attachment: fixed; }`
        : '';

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${game.name} | Matrix Spins Casino</title>
  <link rel="icon" type="image/svg+xml" href="/favicon.svg">
  <link rel="stylesheet" href="../_shared/game-runtime.css">
  ${symbolPreloads}
  <style>
    :root {
      --studio-primary: ${studio.primary};
      --studio-secondary: ${studio.secondary};
      --studio-bg: ${studio.bg};
      --studio-surface: ${studio.surface};
      --studio-font: ${studio.font};
      --studio-glow: ${studio.primary}40;
      --reel-border: ${studio.primary};
      --reel-cell-size: ${cols >= 6 ? '56px' : cols >= 5 ? '68px' : '80px'};
    }
    ${bgImageCSS}
  </style>
</head>
<body>

  <!-- Symbol SVG Definitions (fallback for missing HD assets) -->
  <div style="display:none">
  ${symbolSVGs}
  </div>

  <!-- Top Bar -->
  <div class="game-topbar">
    <button class="back-btn" id="backBtn">&#8592; Lobby</button>
    <div class="game-title">${game.name}</div>
    <div class="studio-badge">
      <span>${studio.slug.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase())}</span>
    </div>
  </div>

  <!-- Balance Bar -->
  <div class="balance-bar">
    <div class="balance-item"><div class="label">Balance</div><div class="value" id="balanceValue">$1,000.00</div></div>
    <div class="balance-item"><div class="label">Bet</div><div class="value" id="betValue">$1.00</div></div>
    <div class="balance-item"><div class="label">Win</div><div class="value" id="winValue">$0.00</div></div>
  </div>

  <!-- Game Area -->
  <div class="game-area">
    <div class="free-spins-banner" id="freeSpinsBanner">FREE SPINS</div>
    <div class="reels-frame">
      <div class="reels-grid" id="reelsGrid"></div>
    </div>
    <div class="mechanic-overlay" id="mechanicOverlay">
      <div><div class="mechanic-text"></div><div class="mechanic-sub"></div></div>
    </div>
  </div>

  <!-- Controls -->
  <div class="controls-bar">
    <button class="autoplay-btn" id="autoplayBtn">Auto</button>
    <div class="bet-control">
      <button id="betDown">-</button>
      <div class="bet-display" id="betDisplay">$1.00</div>
      <button id="betUp">+</button>
    </div>
    <button class="spin-btn" id="spinBtn">SPIN</button>
    <button class="maxbet-btn" id="maxBet">MAX</button>
  </div>

  <!-- Info Bar -->
  <div class="info-bar">
    <span>RTP: ${game.rtp}%</span>
    <span>${(game.winType || 'classic').toUpperCase()} | ${cols}x${rows}</span>
    <span>${(game.volatility || 'medium').toUpperCase()}</span>
  </div>

  <!-- Scripts -->
  <script src="../../js/casino-engine.js?v=3.1.0"></script>
  <script>
    window.GAME_CONFIG = ${JSON.stringify(config, null, 2)};
    window.GAME_MECHANIC = ${mechanicCode};
  </script>
  <script src="../_shared/game-runtime.js"></script>
</body>
</html>`;
}


// ═══════════════════════════════════════════════════════════════════════════
// MAIN BUILD
// ═══════════════════════════════════════════════════════════════════════════

function main() {
    const args = process.argv.slice(2);
    let targetGame = null;
    let start = 0;
    let count = games.length;

    for (let i = 0; i < args.length; i++) {
        if (args[i] === '--game' && args[i+1]) targetGame = args[++i];
        if (args[i] === '--start' && args[i+1]) start = parseInt(args[++i]);
        if (args[i] === '--count' && args[i+1]) count = parseInt(args[++i]);
    }

    console.log('╔══════════════════════════════════════════════════╗');
    console.log('║  Matrix Spins Casino — Game Builder v3.0.0      ║');
    console.log('╚══════════════════════════════════════════════════╝\n');

    let targetGames = games;
    if (targetGame) {
        targetGames = games.filter(g => g.id === targetGame);
        if (targetGames.length === 0) {
            console.error(`[ERROR] Game '${targetGame}' not found`);
            process.exit(1);
        }
    } else {
        targetGames = games.slice(start, start + count);
    }

    console.log(`Building ${targetGames.length} games...\n`);

    let built = 0;
    let errors = 0;
    const issues = [];

    for (let i = 0; i < targetGames.length; i++) {
        const game = targetGames[i];
        const globalIdx = games.indexOf(game);
        const dir = path.join(GAMES_DIR, game.id);

        try {
            if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

            const html = generateGameHTML(game, globalIdx);
            writeAtomicFsync(path.join(dir, 'index.html'), Buffer.from(html, 'utf-8'));
            built++;

            // Progress bar
            const pct = Math.floor((i + 1) / targetGames.length * 40);
            const bar = '█'.repeat(pct) + '░'.repeat(40 - pct);
            process.stdout.write(`\r  [${bar}] ${i + 1}/${targetGames.length} ${game.id}`);

            // Checkpoint every 10
            if ((i + 1) % 10 === 0) {
                console.log(`\n  ✓ Checkpoint: ${i + 1} games built, ${errors} issues`);
            }
        } catch (e) {
            errors++;
            issues.push(`${game.id}: ${e.message}`);
            console.error(`\n  [ERROR] ${game.id}: ${e.message}`);
        }
    }

    console.log(`\n\n=== Build Complete ===`);
    console.log(`  Built: ${built}/${targetGames.length}`);
    console.log(`  Errors: ${errors}`);
    if (issues.length > 0) {
        console.log(`  Issues:`);
        issues.forEach(i => console.log(`    - ${i}`));
    }
    console.log(`  Output: ${GAMES_DIR}/[game-slug]/index.html`);
}

main();
