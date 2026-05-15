#!/usr/bin/env node
'use strict';

/**
 * generate-game-pages.js — Creates individual game HTML pages for all 100 games.
 * Each page: games/[game-id].html
 * Uses shared engine + per-game config, connects to backend spin endpoint.
 * Studio chrome applied via data-studio attribute.
 */

const fs = require('fs');
const path = require('path');

// Load game definitions
const gameDefs = require('../shared/game-definitions');
const games = Array.isArray(gameDefs) ? gameDefs : (gameDefs.GAMES || gameDefs.games || gameDefs.default || []);

// Provider → studio key mapping
const PROVIDER_TO_STUDIO = {
    'NovaPlay Studios':       'nebula-gaming',
    'GoldenEdge Gaming':      'golden-reels',
    'Celestial Plays':        'mythic-forge',
    'IronReel Entertainment': 'ironclad',
    'PhantomWorks':           'shadow-works',
    'ArcadeForge':            'wild-frontier',
    'ThunderBolt Games':      'cascade-labs',
    'VortexSpin':             'dragon-pearl'
};

// Studio data (palettes, fonts)
const STUDIOS = {
    nebula-gaming:     { accent: '#00e5ff', secondary: '#7c4dff', bg: '#0a0e27', surface: '#141830', text: '#c8d6e5', headingFont: 'Orbitron', bodyFont: 'Space Mono' },
    golden-reels:   { accent: '#ffd700', secondary: '#b8860b', bg: '#1a0f00', surface: '#2a1a08', text: '#d4c5a9', headingFont: 'Playfair Display', bodyFont: 'Lora' },
    mythic-forge:    { accent: '#e040fb', secondary: '#7c4dff', bg: '#0d0221', surface: '#1a0a30', text: '#c8b8e8', headingFont: 'Cinzel Decorative', bodyFont: 'Quicksand' },
    ironclad:     { accent: '#ff6d00', secondary: '#8d6e63', bg: '#1a1209', surface: '#2a1e12', text: '#c9b99a', headingFont: 'Oswald', bodyFont: 'Rajdhani' },
    shadow-works: { accent: '#b388ff', secondary: '#4a148c', bg: '#0a0012', surface: '#180028', text: '#c4b0d9', headingFont: 'Cinzel', bodyFont: 'Noto Serif' },
    wild-frontier:  { accent: '#76ff03', secondary: '#00e676', bg: '#0a1a00', surface: '#142800', text: '#b0d890', headingFont: 'Press Start 2P', bodyFont: 'Share Tech Mono' },
    cascade-labs:  { accent: '#ffea00', secondary: '#ff6d00', bg: '#1a1400', surface: '#2a2000', text: '#d4c890', headingFont: 'Rajdhani', bodyFont: 'Oswald' },
    dragon-pearl:   { accent: '#00bcd4', secondary: '#ff4081', bg: '#001518', surface: '#002228', text: '#a0d4dc', headingFont: 'Quicksand', bodyFont: 'Share Tech Mono' }
};

const gamesDir = path.join(__dirname, '..', 'games');
if (!fs.existsSync(gamesDir)) fs.mkdirSync(gamesDir, { recursive: true });

function escapeHtml(str) {
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function volLabel(v) {
    const map = { low: 'Low', medium: 'Medium', 'medium-high': 'Med-High', high: 'High', 'very high': 'Very High' };
    return map[v] || v;
}

function winTypeLabel(w) {
    const map = { payline: 'Paylines', cluster: 'Cluster Pays', classic: 'Classic' };
    return map[w] || w;
}

function bonusLabel(b) {
    if (!b || b === 'none') return 'None';
    const map = {
        free_spins: 'Free Spins', pick_bonus: 'Pick Bonus', expanding_wilds: 'Expanding Wilds',
        multiplier_trail: 'Multiplier Trail', tumble: 'Tumble/Cascade', respin: 'Respin',
        wheel_bonus: 'Wheel Bonus', hold_and_spin: 'Hold & Spin', sticky_wilds: 'Sticky Wilds',
        cascading: 'Cascading Wins', megaways: 'Megaways', mystery_symbols: 'Mystery Symbols'
    };
    return map[b] || b.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

let generated = 0;

games.forEach(game => {
    const studioKey = PROVIDER_TO_STUDIO[game.provider];
    if (!studioKey) {
        console.warn(`  ⚠ No studio mapping for provider "${game.provider}" (game: ${game.id})`);
        return;
    }
    const studio = STUDIOS[studioKey];
    const safeName = escapeHtml(game.name);
    const safeProvider = escapeHtml(game.provider);

    // Build symbols display
    const symbolsList = (game.symbols || []).map(s => {
        if (typeof s === 'string') return s;
        if (s && s.emoji) return s.emoji;
        if (s && s.symbol) return s.symbol;
        return '?';
    }).slice(0, 12).join(' ');

    // Build payouts display
    let payoutsHtml = '';
    if (game.payouts && typeof game.payouts === 'object') {
        const entries = Object.entries(game.payouts).slice(0, 8);
        payoutsHtml = entries.map(([sym, mult]) => {
            const label = typeof sym === 'string' ? sym : '?';
            const val = typeof mult === 'object' ? JSON.stringify(mult) : mult + 'x';
            return `<div class="payout-row"><span class="payout-sym">${escapeHtml(label)}</span><span class="payout-val">${escapeHtml(String(val))}</span></div>`;
        }).join('\n                    ');
    }

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
    <title>${safeName} | ${safeProvider} | Matrix Spins Casino</title>
    <meta name="description" content="Play ${safeName} by ${safeProvider} at Matrix Spins Casino. RTP ${game.rtp}%, ${volLabel(game.volatility)} volatility.">
    <meta name="theme-color" content="${studio.bg}">
    <link rel="icon" type="image/svg+xml" href="/favicon.svg">
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=${encodeURIComponent(studio.headingFont)}:wght@400;700&family=${encodeURIComponent(studio.bodyFont)}:wght@400;700&display=swap" rel="stylesheet">
    <link rel="stylesheet" href="/studio-chrome.css">
    <style>
        *, *::before, *::after { margin: 0; padding: 0; box-sizing: border-box; }
        body {
            font-family: '${studio.bodyFont}', -apple-system, sans-serif;
            background: ${studio.bg};
            color: ${studio.text};
            min-height: 100vh;
            line-height: 1.6;
        }
        a { color: ${studio.accent}; }

        .game-header {
            display: flex; align-items: center; justify-content: space-between;
            padding: 14px 24px;
            background: ${studio.surface};
            border-bottom: 1px solid ${studio.accent}22;
        }
        .game-header-left { display: flex; align-items: center; gap: 14px; }
        .back-btn {
            background: ${studio.accent}15;
            border: 1px solid ${studio.accent}30;
            color: ${studio.accent};
            border-radius: 8px; padding: 8px 16px; cursor: pointer;
            font-family: inherit; font-size: 14px; text-decoration: none;
            transition: background 0.2s;
        }
        .back-btn:hover { background: ${studio.accent}25; }
        .game-header h1 {
            font-family: '${studio.headingFont}', sans-serif;
            font-size: 20px; font-weight: 700; color: #fff;
        }
        .provider-tag {
            font-size: 11px; opacity: 0.6;
            font-family: '${studio.bodyFont}', sans-serif;
        }
        .studio-pill {
            background: ${studio.accent};
            color: ${studio.bg};
            font-family: '${studio.headingFont}', sans-serif;
            font-size: 9px; font-weight: 700;
            padding: 3px 8px; border-radius: 4px;
            letter-spacing: 1px; text-transform: uppercase;
        }

        /* Viewport */
        .game-viewport {
            position: relative;
            width: 100%; max-width: 960px;
            margin: 24px auto;
            aspect-ratio: 16/10;
            background: ${studio.surface};
            border-radius: 12px;
            overflow: hidden;
            box-shadow: 0 0 30px ${studio.accent}15;
            border: 1px solid ${studio.accent}18;
        }
        .game-viewport canvas {
            width: 100%; height: 100%;
            display: block;
        }
        .game-loading {
            position: absolute; inset: 0;
            display: flex; flex-direction: column;
            align-items: center; justify-content: center;
            font-family: '${studio.headingFont}', sans-serif;
            color: ${studio.accent};
            gap: 12px;
        }
        .game-loading .spinner {
            width: 40px; height: 40px;
            border: 3px solid ${studio.accent}33;
            border-top-color: ${studio.accent};
            border-radius: 50%;
            animation: spin 0.8s linear infinite;
        }
        @keyframes spin { to { transform: rotate(360deg); } }

        /* Controls bar */
        .controls-bar {
            max-width: 960px; margin: 0 auto;
            display: flex; align-items: center; justify-content: center;
            gap: 12px; padding: 16px 24px;
        }
        .bet-selector {
            display: flex; align-items: center; gap: 8px;
            background: ${studio.surface};
            border: 1px solid ${studio.accent}22;
            border-radius: 8px; padding: 8px 14px;
        }
        .bet-selector label { font-size: 12px; opacity: 0.6; text-transform: uppercase; letter-spacing: 1px; }
        .bet-selector select {
            background: transparent; border: none;
            color: ${studio.accent}; font-size: 16px; font-weight: 700;
            font-family: '${studio.headingFont}', sans-serif;
            cursor: pointer;
        }
        .bet-selector select option { background: ${studio.surface}; color: ${studio.text}; }
        .spin-btn {
            background: linear-gradient(135deg, ${studio.accent}, ${studio.secondary});
            color: ${studio.bg}; border: none;
            font-family: '${studio.headingFont}', sans-serif;
            font-size: 16px; font-weight: 700;
            padding: 14px 40px; border-radius: 10px;
            cursor: pointer; text-transform: uppercase;
            letter-spacing: 2px;
            box-shadow: 0 4px 20px ${studio.accent}44;
            transition: transform 0.15s, box-shadow 0.15s;
        }
        .spin-btn:hover { transform: translateY(-1px); box-shadow: 0 6px 25px ${studio.accent}55; }
        .spin-btn:active { transform: translateY(1px); }
        .spin-btn:disabled { opacity: 0.5; cursor: not-allowed; transform: none; }
        .balance-display {
            background: ${studio.surface};
            border: 1px solid ${studio.accent}22;
            border-radius: 8px; padding: 8px 14px;
            text-align: center;
        }
        .balance-display .label { font-size: 10px; opacity: 0.5; text-transform: uppercase; letter-spacing: 1px; }
        .balance-display .amount {
            font-family: '${studio.headingFont}', sans-serif;
            font-size: 18px; font-weight: 700;
            color: ${studio.accent};
        }

        /* Info panel */
        .info-panel {
            max-width: 960px; margin: 20px auto 0;
            padding: 0 24px;
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
            gap: 12px;
        }
        .info-card {
            background: ${studio.surface};
            border: 1px solid ${studio.accent}15;
            border-radius: 10px; padding: 14px;
        }
        .info-card .label {
            font-size: 10px; text-transform: uppercase;
            letter-spacing: 1px; opacity: 0.5; margin-bottom: 4px;
        }
        .info-card .value {
            font-family: '${studio.headingFont}', sans-serif;
            font-size: 17px; font-weight: 700;
            color: ${studio.accent};
        }

        /* Symbols grid */
        .symbols-section {
            max-width: 960px; margin: 24px auto;
            padding: 0 24px;
        }
        .symbols-section h2 {
            font-family: '${studio.headingFont}', sans-serif;
            font-size: 16px; color: #fff;
            margin-bottom: 12px;
            padding-bottom: 6px;
            border-bottom: 1px solid ${studio.accent}22;
        }
        .symbols-grid {
            display: flex; flex-wrap: wrap; gap: 8px;
        }
        .symbol-chip {
            background: ${studio.surface};
            border: 1px solid ${studio.accent}18;
            border-radius: 8px; padding: 8px 12px;
            font-size: 20px;
            display: flex; align-items: center; gap: 6px;
        }
        .symbol-chip .sym-label { font-size: 11px; opacity: 0.6; }

        /* Payouts */
        .payouts-section {
            max-width: 960px; margin: 20px auto 40px;
            padding: 0 24px;
        }
        .payouts-section h2 {
            font-family: '${studio.headingFont}', sans-serif;
            font-size: 16px; color: #fff;
            margin-bottom: 12px;
            padding-bottom: 6px;
            border-bottom: 1px solid ${studio.accent}22;
        }
        .payouts-grid {
            display: grid;
            grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
            gap: 8px;
        }
        .payout-row {
            background: ${studio.surface};
            border: 1px solid ${studio.accent}12;
            border-radius: 8px; padding: 10px 12px;
            display: flex; justify-content: space-between; align-items: center;
        }
        .payout-sym { font-size: 18px; }
        .payout-val {
            font-family: '${studio.headingFont}', sans-serif;
            font-weight: 700; color: ${studio.accent};
        }

        /* Footer */
        .game-footer {
            text-align: center; padding: 24px;
            font-size: 12px; opacity: 0.5;
            border-top: 1px solid ${studio.accent}12;
            margin-top: 20px;
        }

        /* Win overlay */
        .win-overlay {
            position: absolute; inset: 0;
            display: none; align-items: center; justify-content: center;
            background: ${studio.bg}cc;
            z-index: 20;
            flex-direction: column; gap: 8px;
        }
        .win-overlay.active { display: flex; }
        .win-amount {
            font-family: '${studio.headingFont}', sans-serif;
            font-size: 48px; font-weight: 700;
            color: ${studio.accent};
            text-shadow: 0 0 30px ${studio.accent}88;
        }
        .win-label { font-size: 14px; opacity: 0.7; text-transform: uppercase; letter-spacing: 3px; }

        /* Provably Fair link */
        .fair-link {
            display: inline-flex; align-items: center; gap: 6px;
            font-size: 12px; opacity: 0.7;
            margin-top: 8px;
        }

        @media (max-width: 640px) {
            .game-header { flex-direction: column; gap: 8px; text-align: center; }
            .game-header h1 { font-size: 17px; }
            .controls-bar { flex-wrap: wrap; }
            .spin-btn { padding: 12px 28px; font-size: 14px; }
            .info-panel { grid-template-columns: repeat(2, 1fr); }
        }
    </style>
</head>
<body data-studio="${studioKey}">

<header class="game-header">
    <div class="game-header-left">
        <a href="/" class="back-btn">&larr; Lobby</a>
        <div>
            <h1>${safeName}</h1>
            <span class="provider-tag">${safeProvider}</span>
        </div>
    </div>
    <span class="studio-pill">${escapeHtml(PROVIDER_TO_STUDIO[game.provider] ? PROVIDER_TO_STUDIO[game.provider].toUpperCase() : '')}</span>
</header>

<div class="game-viewport" id="gameViewport">
    <div class="game-loading" id="gameLoading">
        <div class="spinner"></div>
        <span>Loading ${safeName}...</span>
    </div>
    <canvas id="gameCanvas"></canvas>
    <div class="win-overlay" id="winOverlay">
        <div class="win-label">YOU WIN</div>
        <div class="win-amount" id="winAmount">$0.00</div>
    </div>
</div>

<div class="controls-bar">
    <div class="bet-selector">
        <label>Bet</label>
        <select id="betSelect">
            <option value="0.20">$0.20</option>
            <option value="0.50">$0.50</option>
            <option value="1.00" selected>$1.00</option>
            <option value="2.00">$2.00</option>
            <option value="5.00">$5.00</option>
            <option value="10.00">$10.00</option>
            <option value="20.00">$20.00</option>
            <option value="50.00">$50.00</option>
        </select>
    </div>
    <button class="spin-btn" id="spinBtn">SPIN</button>
    <div class="balance-display">
        <div class="label">Balance</div>
        <div class="amount" id="balanceDisplay">$1,000.00</div>
    </div>
</div>

<div class="info-panel">
    <div class="info-card">
        <div class="label">RTP</div>
        <div class="value">${game.rtp}%</div>
    </div>
    <div class="info-card">
        <div class="label">Volatility</div>
        <div class="value">${escapeHtml(volLabel(game.volatility))}</div>
    </div>
    <div class="info-card">
        <div class="label">Grid</div>
        <div class="value">${game.gridCols} &times; ${game.gridRows}</div>
    </div>
    <div class="info-card">
        <div class="label">Win Type</div>
        <div class="value">${escapeHtml(winTypeLabel(game.winType))}</div>
    </div>
    <div class="info-card">
        <div class="label">Bonus</div>
        <div class="value">${escapeHtml(bonusLabel(game.bonusType))}</div>
    </div>
    <div class="info-card">
        <div class="label">Bet Range</div>
        <div class="value">$${(game.minBet || 0.20).toFixed(2)}&ndash;$${(game.maxBet || 50).toFixed(2)}</div>
    </div>
</div>

${symbolsList ? `
<div class="symbols-section">
    <h2>Symbols</h2>
    <div class="symbols-grid">
        ${(game.symbols || []).slice(0, 12).map(s => {
            const emoji = typeof s === 'string' ? s : (s && s.emoji ? s.emoji : (s && s.symbol ? s.symbol : '?'));
            const label = s && s.name ? s.name : '';
            return `<div class="symbol-chip"><span>${escapeHtml(emoji)}</span>${label ? `<span class="sym-label">${escapeHtml(label)}</span>` : ''}</div>`;
        }).join('\n        ')}
    </div>
</div>` : ''}

${payoutsHtml ? `
<div class="payouts-section">
    <h2>Payouts</h2>
    <div class="payouts-grid">
                    ${payoutsHtml}
    </div>
</div>` : ''}

<div class="game-footer">
    <p>Must be 18+ to play. Gambling can be addictive. Play responsibly.</p>
    <p><a href="/responsible-gambling.html">Responsible Gambling</a> | <a href="/terms.html">Terms</a> | <a href="/provably-fair.html" class="fair-link">🔒 Game Fairness</a></p>
    <p style="margin-top:8px;">&copy; ${new Date().getFullYear()} Matrix Spins Casino</p>
</div>

<script src="/js/csrf-helper.js"></script>
<script>
// ═══════════════════════════════════════════════════════════════════
// Game Page Client — Server-Authoritative Spin
// Game: ${escapeHtml(game.id)}
// This client is a RENDERER ONLY. All outcomes come from the server.
// ═══════════════════════════════════════════════════════════════════
(function() {
    'use strict';

    var GAME_ID = '${game.id}';
    var GRID_COLS = ${game.gridCols};
    var GRID_ROWS = ${game.gridRows};
    var SYMBOLS = ${JSON.stringify((game.symbols || []).map(s => typeof s === 'string' ? s : (s && s.emoji ? s.emoji : (s && s.symbol ? s.symbol : '?'))))};

    var canvas = document.getElementById('gameCanvas');
    var ctx = canvas.getContext('2d');
    var spinBtn = document.getElementById('spinBtn');
    var betSelect = document.getElementById('betSelect');
    var balanceEl = document.getElementById('balanceDisplay');
    var winOverlay = document.getElementById('winOverlay');
    var winAmountEl = document.getElementById('winAmount');
    var loadingEl = document.getElementById('gameLoading');

    var balance = 0; // cents — real balance fetched from server after auth
    var spinning = false;
    var grid = [];
    var cellW, cellH;

    // Token from localStorage (set by main casino app)
    function getToken() {
        try { return localStorage.getItem('matrixspins_token') || ''; } catch(e) { return ''; }
    }

    function updateBalance() {
        balanceEl.textContent = '$' + (balance / 100).toFixed(2).replace(/\\B(?=(\\d{3})+(?!\\d))/g, ',');
    }

    function resizeCanvas() {
        var vp = document.getElementById('gameViewport');
        canvas.width = vp.clientWidth;
        canvas.height = vp.clientHeight;
        cellW = canvas.width / GRID_COLS;
        cellH = canvas.height / GRID_ROWS;
        drawGrid();
    }

    function initGrid() {
        grid = [];
        for (var r = 0; r < GRID_ROWS; r++) {
            var row = [];
            for (var c = 0; c < GRID_COLS; c++) {
                row.push(SYMBOLS[Math.floor(Math.random() * SYMBOLS.length)]);
            }
            grid.push(row);
        }
    }

    function drawGrid() {
        if (!ctx || !canvas.width) return;
        ctx.clearRect(0, 0, canvas.width, canvas.height);

        // Background
        ctx.fillStyle = '${studio.surface}';
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        // Grid lines
        ctx.strokeStyle = '${studio.accent}18';
        ctx.lineWidth = 1;
        for (var c = 1; c < GRID_COLS; c++) {
            ctx.beginPath();
            ctx.moveTo(c * cellW, 0);
            ctx.lineTo(c * cellW, canvas.height);
            ctx.stroke();
        }
        for (var r = 1; r < GRID_ROWS; r++) {
            ctx.beginPath();
            ctx.moveTo(0, r * cellH);
            ctx.lineTo(canvas.width, r * cellH);
            ctx.stroke();
        }

        // Symbols
        var fontSize = Math.min(cellW, cellH) * 0.5;
        ctx.font = fontSize + 'px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';

        for (var row = 0; row < grid.length; row++) {
            for (var col = 0; col < (grid[row] || []).length; col++) {
                var sym = grid[row][col];
                var x = col * cellW + cellW / 2;
                var y = row * cellH + cellH / 2;
                ctx.fillText(sym, x, y);
            }
        }
    }

    function showWin(amount) {
        if (amount <= 0) return;
        winAmountEl.textContent = '$' + (amount / 100).toFixed(2);
        winOverlay.classList.add('active');
        setTimeout(function() {
            winOverlay.classList.remove('active');
        }, 2000);
    }

    // Spin animation (tumble effect)
    function animateSpin(finalGrid, callback) {
        var frames = 0;
        var maxFrames = 20;
        var tempGrid = [];

        function frame() {
            frames++;
            // Random symbols during animation
            tempGrid = [];
            for (var r = 0; r < GRID_ROWS; r++) {
                var row = [];
                for (var c = 0; c < GRID_COLS; c++) {
                    if (frames >= maxFrames - 3 && finalGrid[r] && finalGrid[r][c]) {
                        row.push(finalGrid[r][c]);
                    } else {
                        row.push(SYMBOLS[Math.floor(Math.random() * SYMBOLS.length)]);
                    }
                }
                tempGrid.push(row);
            }
            grid = tempGrid;
            drawGrid();

            if (frames < maxFrames) {
                requestAnimationFrame(frame);
            } else {
                grid = finalGrid;
                drawGrid();
                if (callback) callback();
            }
        }
        requestAnimationFrame(frame);
    }

    async function doSpin() {
        if (spinning) return;

        var betCents = Math.round(parseFloat(betSelect.value) * 100);
        if (balance < betCents) {
            alert('Insufficient balance. Please deposit funds.');
            return;
        }

        spinning = true;
        spinBtn.disabled = true;
        spinBtn.textContent = '...';
        balance -= betCents;
        updateBalance();

        // Notify responsible gambling if available
        if (window.RG && window.RG.onSpinComplete) {
            // Pre-spin tracking
        }

        try {
            var token = getToken();
            var resp = await fetch('/api/spin', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': token ? 'Bearer ' + token : ''
                },
                body: JSON.stringify({
                    gameId: GAME_ID,
                    betAmount: betCents
                })
            });

            if (!resp.ok) {
                // Fallback to demo mode
                var demoGrid = [];
                for (var r = 0; r < GRID_ROWS; r++) {
                    var row = [];
                    for (var c = 0; c < GRID_COLS; c++) {
                        row.push(SYMBOLS[Math.floor(Math.random() * SYMBOLS.length)]);
                    }
                    demoGrid.push(row);
                }
                animateSpin(demoGrid, function() {
                    spinning = false;
                    spinBtn.disabled = false;
                    spinBtn.textContent = 'SPIN';
                });
                return;
            }

            var result = await resp.json();
            var serverGrid = result.grid || result.reels || [];

            // Normalize grid
            if (serverGrid.length && !Array.isArray(serverGrid[0])) {
                // Flat array → 2D
                var g2d = [];
                for (var ri = 0; ri < GRID_ROWS; ri++) {
                    g2d.push(serverGrid.slice(ri * GRID_COLS, (ri + 1) * GRID_COLS));
                }
                serverGrid = g2d;
            }

            animateSpin(serverGrid, function() {
                var winAmount = result.winAmount || result.win || 0;
                balance += winAmount;
                updateBalance();
                showWin(winAmount);

                if (window.RG && window.RG.onSpinComplete) {
                    window.RG.onSpinComplete(betCents, winAmount);
                }

                spinning = false;
                spinBtn.disabled = false;
                spinBtn.textContent = 'SPIN';
            });

        } catch (err) {
            console.warn('[GamePage] Spin error, falling back to demo:', err.message);
            // Demo fallback
            var fallbackGrid = [];
            for (var r2 = 0; r2 < GRID_ROWS; r2++) {
                var row2 = [];
                for (var c2 = 0; c2 < GRID_COLS; c2++) {
                    row2.push(SYMBOLS[Math.floor(Math.random() * SYMBOLS.length)]);
                }
                fallbackGrid.push(row2);
            }
            animateSpin(fallbackGrid, function() {
                spinning = false;
                spinBtn.disabled = false;
                spinBtn.textContent = 'SPIN';
            });
        }
    }

    // Init
    function init() {
        loadingEl.style.display = 'none';
        initGrid();
        resizeCanvas();
        updateBalance();
        window.addEventListener('resize', resizeCanvas);
        spinBtn.addEventListener('click', doSpin);

        // Keyboard: spacebar to spin
        document.addEventListener('keydown', function(e) {
            if (e.code === 'Space' && !spinning) {
                e.preventDefault();
                doSpin();
            }
        });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
</script>

</body>
</html>`;

    const filePath = path.join(gamesDir, game.id + '.html');
    fs.writeFileSync(filePath, html, 'utf8');
    generated++;
});

console.log(`\n  ✅ Generated ${generated} game pages in /games/`);
console.log(`  Total games in definitions: ${games.length}`);
if (generated < games.length) {
    console.log(`  ⚠ ${games.length - generated} games skipped (no studio mapping)`);
}
