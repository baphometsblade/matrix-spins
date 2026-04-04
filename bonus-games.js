/* ═══════════════════════════════════════════════════════════════
   BONUS GAMES ENGINE — Interactive GUI for Every Bonus Type
   Hooks into triggerFreeSpins() to show rich bonus game overlays
   with per-game accent theming and unique mechanics per type
   ═══════════════════════════════════════════════════════════════ */
function _bgEsc(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
(function() {
    'use strict';

    // ── BONUS TYPE METADATA ──
    const BONUS_META = {
        tumble:               { icon: '💎', title: 'CASCADE BONUS',       desc: 'Match clusters tumble away for multiplier chains!' },
        avalanche:            { icon: '🏔️', title: 'AVALANCHE BONUS',     desc: 'Avalanche cascades with rising multipliers!' },
        hold_and_win:         { icon: '🔒', title: 'HOLD & WIN',          desc: 'Lock coins and respin for jackpots!' },
        random_multiplier:    { icon: '✨', title: 'MULTIPLIER RAIN',     desc: 'Catch falling multiplier orbs!' },
        wheel_multiplier:     { icon: '🎡', title: 'WHEEL OF FORTUNE',    desc: 'Spin the wheel for massive multipliers!' },
        expanding_symbol:     { icon: '📖', title: 'EXPANDING SYMBOL',    desc: 'One symbol expands to fill entire reels!' },
        expanding_wild_respin:{ icon: '🌟', title: 'EXPANDING WILDS',     desc: 'Wild columns expand with free respins!' },
        zeus_multiplier:      { icon: '⚡', title: 'DIVINE MULTIPLIER',   desc: 'Lightning strikes deliver god-tier multipliers!' },
        money_collect:        { icon: '💰', title: 'MONEY COLLECT',       desc: 'Wild collects all coin values on screen!' },
        stacked_wilds:        { icon: '🃏', title: 'STACKED WILDS',       desc: 'Wild symbols stack to fill entire reels!' },
        sticky_wilds:         { icon: '🕸️', title: 'STICKY WILDS',        desc: 'Wilds stick in place for multiple spins!' },
        walking_wilds:        { icon: '🚶', title: 'WALKING WILDS',       desc: 'Wilds walk across the reels each spin!' },
        mystery_stacks:       { icon: '❓', title: 'MYSTERY STACKS',      desc: 'Mystery symbols reveal matching icons!' },
        multiplier_wilds:     { icon: '🎴', title: 'MULTIPLIER WILDS',    desc: 'Each wild carries a random multiplier!' },
        coin_respin:          { icon: '🪙', title: 'COIN RESPIN',         desc: 'Coins land and lock with respins!' },
        chamber_spins:        { icon: '🏛️', title: 'CHAMBER SPINS',       desc: 'Open the vault for hidden treasures!' },
        fisherman_collect:    { icon: '🎣', title: 'FISHING BONUS',       desc: 'Cast your line and reel in prizes!' },
        wild_collect:         { icon: '🧲', title: 'WILD COLLECT',        desc: 'Collect wilds to fill the bonus meter!' },
        respin:               { icon: '🔄', title: 'LUCKY RESPIN',        desc: 'Matching pairs lock and reels respin!' }
    };

    // ── THEME-SPECIFIC EMOJI SETS for game symbols in bonus displays ──
    const THEME_SYMBOLS = {
        egyptian:  ['🏺', '🐍', '👁️', '🪲', '☀️', '🔺', '🐫'],
        ocean:     ['🐟', '🐚', '🦈', '🐙', '🪸', '⚓', '🌊'],
        norse:     ['⚔️', '🛡️', '🪓', '🐺', '🦅', '⛰️', '❄️'],
        fire:      ['🔥', '🌋', '💥', '🌶️', '🎆', '☄️', '🧨'],
        space:     ['🌟', '🪐', '🚀', '💫', '🌌', '⭐', '🛸'],
        candy:     ['🍭', '🍬', '🧁', '🍩', '🎂', '🍪', '🍫'],
        gothic:    ['🦇', '⚰️', '🌙', '💀', '🕯️', '🗡️', '🩸'],
        western:   ['🤠', '🐎', '🌵', '💎', '🔫', '🎯', '🏜️'],
        nature:    ['🌿', '🦁', '🐘', '🦒', '🌺', '🦜', '🌳'],
        asian:     ['🐉', '🏮', '🎎', '🀄', '🎋', '🧧', '🐼'],
        olympus:   ['⚡', '🏛️', '🏺', '🎭', '🦅', '🌿', '👑'],
        circus:    ['🎪', '🤡', '🎈', '🎠', '🎯', '🎩', '🐒'],
        neon:      ['💜', '💙', '💚', '💛', '❤️', '🔮', '💎'],
        fruit:     ['🍒', '🍋', '🍊', '🍇', '🍉', '⭐', '7️⃣'],
        money:     ['💰', '💎', '🪙', '💵', '🏦', '👑', '🎰'],
        default:   ['💎', '⭐', '🔮', '👑', '🎰', '7️⃣', '🍀']
    };

    // Map game IDs to theme categories
    const GAME_THEME_MAP = {
        book_dead: 'egyptian', pharaoh_legacy: 'egyptian', golden_pharaoh: 'egyptian',
        pharaoh_march: 'egyptian', cleopatra_gold: 'egyptian', rome_eternal: 'egyptian',
        big_bass: 'ocean', bass_splash: 'ocean', wild_deep: 'ocean', razor_shark: 'ocean',
        lightning_pearl: 'ocean',
        viking_voyage: 'norse', loki_loot: 'norse', norse_vaults: 'norse',
        sugar_rush: 'candy', sweet_bonanza: 'candy', jammin_fruits: 'candy', fat_rabbit: 'candy',
        crimson_fang: 'gothic', immortal_blood: 'gothic', eternal_romance: 'gothic',
        demon_chambers: 'gothic',
        gates_olympus: 'olympus', olympus_rising: 'olympus', olympian_gods: 'olympus',
        pots_olympus: 'olympus', olympus_dream: 'olympus',
        starburst_xxl: 'space', quantum_burst: 'space', nova_blackhole: 'space',
        galactic_raiders: 'space',
        hot_chillies: 'fire', crown_fire: 'fire', wildfire_gold: 'fire',
        dragon_megafire: 'fire', fire_hole: 'fire',
        wolf_gold: 'western', buffalo_stampede: 'western', buffalo_extreme: 'western',
        buffalo_mega: 'western', wanted_dead: 'western', wild_west_rush: 'western',
        tombstone_reload: 'western', iron_stampede: 'western',
        lucky_dragon: 'asian', five_lions: 'asian', sakura_princess: 'asian',
        jade_temple: 'asian', golden_jaguar: 'asian',
        big_top_bonanza: 'circus', pixel_rewind: 'circus',
        neon_nights: 'neon', twin_helix: 'neon', neon_viper: 'neon',
        midnight_drifter: 'neon',
        super_hot: 'fruit', fire_joker: 'fruit', mega_joker: 'fruit',
        lucky_777: 'fruit', fruit_party: 'fruit',
        black_bull: 'money', diamond_vault: 'money', coin_strike: 'money',
        gold_rush_frog: 'money', coin_volcano: 'money', vault_coins: 'money',
        mine_coins: 'money', dragon_coins: 'money',
        puppy_palace: 'nature', great_rhino: 'nature', mega_safari: 'nature',
        wild_safari: 'nature', arctic_foxes: 'nature', jungle_fury: 'nature',
        golden_fortune: 'money', island_tiki: 'nature'
    };

    function getGameTheme(game) {
        return GAME_THEME_MAP[game.id] || 'default';
    }
    function getThemeSymbols(game) {
        return THEME_SYMBOLS[getGameTheme(game)] || THEME_SYMBOLS.default;
    }

    // ── Utility: set CSS custom properties on an element ──
    function applyBonusTheme(el, game) {
        const accent = game.accentColor || '#fbbf24';
        const r = parseInt(accent.slice(1,3),16)||0;
        const g = parseInt(accent.slice(3,5),16)||0;
        const b = parseInt(accent.slice(5,7),16)||0;
        el.style.setProperty('--bonus-accent', accent);
        el.style.setProperty('--bonus-accent-rgb', `${r},${g},${b}`);
        el.style.setProperty('--bonus-accent-glow', `rgba(${r},${g},${b},0.35)`);
        // Darker variant
        const dr = Math.max(0, r - 40), dg = Math.max(0, g - 40), db = Math.max(0, b - 40);
        el.style.setProperty('--bonus-accent-dark', `rgb(${dr},${dg},${db})`);
    }

    // ── Create particles in background scene ──
    function spawnBgParticles(sceneEl, count, colorClass) {
        for (let i = 0; i < count; i++) {
            const p = document.createElement('div');
            p.className = `bonus-particle ${colorClass}`;
            const size = 4 + Math.random() * 8;
            p.style.width = size + 'px';
            p.style.height = size + 'px';
            p.style.left = (Math.random() * 100) + '%';
            p.style.bottom = (Math.random() * 30) + '%';
            p.style.animationDelay = (Math.random() * 4) + 's';
            p.style.animationDuration = (3 + Math.random() * 3) + 's';
            sceneEl.appendChild(p);
        }
    }

    // ── RNG helper ──
    function rng() {
        return typeof getRandomNumber === 'function' ? getRandomNumber() : Math.random();
    }

    // ═══════════════════════════════════════════
    // MASTER: Show Bonus Game Overlay
    // Called from the patched triggerFreeSpins
    // ═══════════════════════════════════════════
    function showBonusGameOverlay(game, spinsCount) {
        // Remove any existing overlay
        const existing = document.getElementById('bonusGameOverlay');
        if (existing) existing.remove();

        const overlay = document.createElement('div');
        overlay.id = 'bonusGameOverlay';
        overlay.className = `bonus-game-overlay bonus-type-${game.bonusType || 'tumble'}`;
        applyBonusTheme(overlay, game);

        const meta = BONUS_META[game.bonusType] || BONUS_META.tumble;
        const symbols = getThemeSymbols(game);

        // Background scene with particles
        const bgScene = document.createElement('div');
        bgScene.className = 'bg-scene';
        spawnBgParticles(bgScene, 25, 'gold');
        spawnBgParticles(bgScene, 15, 'purple');
        overlay.appendChild(bgScene);

        // Container
        const container = document.createElement('div');
        container.className = 'bonus-game-container';

        // Header
        container.innerHTML = `
            <div class="bonus-header">
                <span class="bonus-header-icon">${meta.icon}</span>
                <div>
                    <div class="bonus-header-title">${meta.title}</div>
                    <div class="bonus-header-game">${_bgEsc(game.name)}</div>
                </div>
                <span class="bonus-header-icon">${meta.icon}</span>
            </div>
            <div class="bonus-body" id="bonusGameBody"></div>
            <div class="bonus-footer">
                <div class="bonus-spins-display">${spinsCount} FREE SPINS</div>
                <div class="bonus-win-display" id="bonusWinDisplay">$0</div>
            </div>
        `;
        overlay.appendChild(container);
        document.body.appendChild(overlay);

        // Build bonus-type-specific body content
        const body = document.getElementById('bonusGameBody');
        buildBonusBody(game, body, spinsCount, symbols);

        // Animate in
        requestAnimationFrame(() => {
            requestAnimationFrame(() => {
                overlay.classList.add('active');
            });
        });

        // Add start button to body
        const startBtn = document.createElement('button');
        startBtn.className = 'bonus-start-btn';
        startBtn.textContent = '▶  START BONUS';
        body.appendChild(startBtn);

        // Dismiss overlay on start
        startBtn.addEventListener('click', function(e) {
            e.stopPropagation();
            dismissBonusOverlay();
        });

        // Also auto-dismiss after 8s
        const autoTimer = setTimeout(dismissBonusOverlay, 8000);

        function dismissBonusOverlay() {
            clearTimeout(autoTimer);
            overlay.style.opacity = '0';
            setTimeout(() => {
                if (overlay.parentNode) overlay.remove();
            }, 500);
            // Show the standard HUD
            if (typeof showFreeSpinsHUD === 'function' && game) {
                showFreeSpinsHUD(game);
            }
        }
    }

    // ═══════════════════════════════════════════
    // BUILD BONUS BODY — per type
    // ═══════════════════════════════════════════
    function buildBonusBody(game, body, spins, symbols) {
        const type = game.bonusType || 'tumble';

        switch(type) {
            case 'tumble':
            case 'avalanche':
                buildTumbleBonus(game, body, symbols, type);
                break;
            case 'hold_and_win':
                buildHoldAndWin(game, body, symbols);
                break;
            case 'random_multiplier':
                buildRandomMultiplier(game, body, symbols);
                break;
            case 'wheel_multiplier':
                buildWheelMultiplier(game, body);
                break;
            case 'expanding_symbol':
                buildExpandingSymbol(game, body, symbols);
                break;
            case 'expanding_wild_respin':
                buildExpandingWildRespin(game, body, symbols);
                break;
            case 'zeus_multiplier':
                buildZeusMultiplier(game, body);
                break;
            case 'money_collect':
                buildMoneyCollect(game, body, symbols);
                break;
            case 'stacked_wilds':
                buildStackedWilds(game, body, symbols);
                break;
            case 'sticky_wilds':
                buildStickyWilds(game, body, symbols);
                break;
            case 'walking_wilds':
                buildWalkingWilds(game, body, symbols);
                break;
            case 'mystery_stacks':
                buildMysteryStacks(game, body, symbols);
                break;
            case 'multiplier_wilds':
                buildMultiplierWilds(game, body, symbols);
                break;
            case 'coin_respin':
                buildCoinRespin(game, body);
                break;
            case 'chamber_spins':
                buildChamberSpins(game, body);
                break;
            case 'fisherman_collect':
                buildFishermanCollect(game, body);
                break;
            case 'wild_collect':
                buildWildCollect(game, body, symbols);
                break;
            case 'respin':
                buildRespin(game, body, symbols);
                break;
            default:
                buildTumbleBonus(game, body, symbols, 'tumble');
        }
    }

    // ═══════════════════════════════════════════
    // 1. TUMBLE / AVALANCHE
    // ═══════════════════════════════════════════
    function buildTumbleBonus(game, body, symbols, subtype) {
        const cols = game.gridCols || 5;
        const rows = game.gridRows || 5;
        const mults = game.tumbleMultipliers || game.avalancheMultipliers || [1,2,3,5,8,15];

        // Multiplier ladder
        const ladder = document.createElement('div');
        ladder.className = 'tumble-multiplier-ladder';
        mults.forEach((m, i) => {
            const step = document.createElement('div');
            step.className = 'tumble-mult-step' + (i === 0 ? ' active' : '');
            step.textContent = m + 'x';
            ladder.appendChild(step);
        });
        body.appendChild(ladder);

        // Grid
        const grid = document.createElement('div');
        grid.className = 'tumble-grid';
        grid.style.gridTemplateColumns = `repeat(${Math.min(cols, 7)}, 1fr)`;
        const displayRows = Math.min(rows, 7);
        const displayCols = Math.min(cols, 7);

        for (let r = 0; r < displayRows; r++) {
            for (let c = 0; c < displayCols; c++) {
                const cell = document.createElement('div');
                cell.className = 'tumble-cell';
                cell.textContent = symbols[Math.floor(rng() * symbols.length)];
                cell.style.animationDelay = (r * 0.05 + c * 0.03) + 's';
                grid.appendChild(cell);
            }
        }
        body.appendChild(grid);

        // Animate a demo cascade
        animateDemoCascade(grid, mults, ladder, symbols);
    }

    function animateDemoCascade(grid, mults, ladder, symbols) {
        const cells = Array.from(grid.children);
        let cascadeLevel = 0;

        function doCascade() {
            if (cascadeLevel >= Math.min(3, mults.length - 1)) return;

            // Pick random cluster
            const clusterSize = 3 + Math.floor(rng() * 4);
            const picked = new Set();
            while (picked.size < clusterSize && picked.size < cells.length) {
                picked.add(Math.floor(rng() * cells.length));
            }

            // Mark matched
            picked.forEach(idx => {
                if (cells[idx]) cells[idx].classList.add('matched');
            });

            setTimeout(() => {
                // Remove matched and fill
                picked.forEach(idx => {
                    if (cells[idx]) {
                        cells[idx].classList.remove('matched');
                        cells[idx].classList.add('falling');
                        cells[idx].textContent = symbols[Math.floor(rng() * symbols.length)];
                        setTimeout(() => cells[idx].classList.remove('falling'), 400);
                    }
                });

                // Advance multiplier
                cascadeLevel++;
                const steps = ladder.querySelectorAll('.tumble-mult-step');
                steps.forEach((s, i) => s.classList.toggle('active', i === cascadeLevel));
            }, 500);

            setTimeout(doCascade, 1200);
        }

        setTimeout(doCascade, 800);
    }

    // ═══════════════════════════════════════════
    // 2. HOLD & WIN
    // ═══════════════════════════════════════════
    function buildHoldAndWin(game, body, symbols) {
        const jackpots = game.jackpots || { mini: 25, minor: 75, major: 500, grand: 2500 };

        // Jackpot meters
        const jpRow = document.createElement('div');
        jpRow.className = 'hw-jackpot-row';
        ['mini','minor','major','grand'].forEach(jp => {
            const el = document.createElement('div');
            el.className = `hw-jackpot hw-jackpot-${jp}`;
            el.textContent = `${jp.toUpperCase()}\n$${(jackpots[jp]||0).toLocaleString()}`;
            jpRow.appendChild(el);
        });
        body.appendChild(jpRow);

        // Grid
        const grid = document.createElement('div');
        grid.className = 'hold-win-grid';
        const cols = Math.min(game.gridCols || 5, 5);
        const rows = Math.min(game.gridRows || 3, 4);
        grid.style.gridTemplateColumns = `repeat(${cols}, 1fr)`;

        const values = [5,10,15,20,25,50,75,100,200,500];
        for (let i = 0; i < cols * rows; i++) {
            const cell = document.createElement('div');
            cell.className = 'hw-cell';
            cell.dataset.value = values[Math.floor(rng() * values.length)];
            grid.appendChild(cell);
        }
        body.appendChild(grid);

        // Respins display
        const respins = document.createElement('div');
        respins.className = 'hw-respins';
        respins.innerHTML = 'RESPINS: <span class="hw-respins-count">3</span>';
        body.appendChild(respins);

        // Demo animation
        animateHoldAndWin(grid, respins, jpRow);
    }

    function animateHoldAndWin(grid, respins, jpRow) {
        const cells = Array.from(grid.children);
        let locked = 0;
        let respinCount = 3;

        function lockRandom() {
            if (locked >= 6 || respinCount <= 0) return;

            const unlocked = cells.filter(c => !c.classList.contains('locked'));
            if (unlocked.length === 0) return;

            const pick = unlocked[Math.floor(rng() * unlocked.length)];
            pick.classList.add('locked');
            pick.textContent = '$' + pick.dataset.value;
            locked++;
            respinCount--;
            respins.querySelector('.hw-respins-count').textContent = respinCount;

            // Reset respins on new lock
            if (rng() > 0.4) respinCount = 3;

            setTimeout(lockRandom, 800);
        }

        setTimeout(lockRandom, 600);
    }

    // ═══════════════════════════════════════════
    // 3. RANDOM MULTIPLIER
    // ═══════════════════════════════════════════
    function buildRandomMultiplier(game, body, symbols) {
        const range = game.randomMultiplierRange || [2,3,5,10,25,50,100];

        // Current multiplier display
        const multDisplay = document.createElement('div');
        multDisplay.className = 'rm-current-mult';
        multDisplay.textContent = '1x';
        body.appendChild(multDisplay);

        // Orb field
        const field = document.createElement('div');
        field.className = 'rm-orb-field';
        body.appendChild(field);

        // Spawn falling orbs
        let totalMult = 1;
        function spawnOrb() {
            const mult = range[Math.floor(rng() * range.length)];
            const orb = document.createElement('div');
            const clampMult = Math.min(mult, 100);
            orb.className = `rm-orb orb-${clampMult}x falling`;
            orb.textContent = mult + 'x';
            orb.style.left = (10 + rng() * 80) + '%';
            orb.style.animationDuration = (2 + rng() * 2) + 's';
            field.appendChild(orb);

            // Auto-catch some orbs
            if (rng() > 0.4) {
                setTimeout(() => {
                    orb.classList.remove('falling');
                    orb.classList.add('caught');
                    totalMult += mult;
                    multDisplay.textContent = totalMult + 'x';
                    setTimeout(() => orb.remove(), 500);
                }, (1 + rng()) * 1000);
            } else {
                setTimeout(() => orb.remove(), 4000);
            }
        }

        let orbCount = 0;
        const orbInterval = setInterval(() => {
            spawnOrb();
            orbCount++;
            if (orbCount > 8) clearInterval(orbInterval);
        }, 500);
    }

    // ═══════════════════════════════════════════
    // 4. WHEEL MULTIPLIER
    // ═══════════════════════════════════════════
    function buildWheelMultiplier(game, body) {
        const multipliers = game.wheelMultipliers || [2,2,3,3,5,5,7,10];
        const segments = multipliers.length;
        const anglePerSeg = 360 / segments;
        const colors = ['#ef4444','#3b82f6','#10b981','#f59e0b','#8b5cf6','#ec4899','#06b6d4','#f97316'];

        const container = document.createElement('div');
        container.className = 'wheel-container';

        // SVG wheel
        const svgNS = 'http://www.w3.org/2000/svg';
        const svg = document.createElementNS(svgNS, 'svg');
        svg.setAttribute('viewBox', '0 0 300 300');
        svg.classList.add('wheel-svg');
        const cx = 150, cy = 150, radius = 140;

        multipliers.forEach((mult, i) => {
            const startAngle = (i * anglePerSeg - 90) * Math.PI / 180;
            const endAngle = ((i + 1) * anglePerSeg - 90) * Math.PI / 180;
            const x1 = cx + radius * Math.cos(startAngle);
            const y1 = cy + radius * Math.sin(startAngle);
            const x2 = cx + radius * Math.cos(endAngle);
            const y2 = cy + radius * Math.sin(endAngle);
            const largeArc = anglePerSeg > 180 ? 1 : 0;

            const path = document.createElementNS(svgNS, 'path');
            path.setAttribute('d', `M${cx},${cy} L${x1},${y1} A${radius},${radius} 0 ${largeArc},1 ${x2},${y2} Z`);
            path.setAttribute('fill', colors[i % colors.length]);
            path.setAttribute('stroke', '#1a1a2e');
            path.setAttribute('stroke-width', '2');
            svg.appendChild(path);

            // Label
            const labelAngle = ((i + 0.5) * anglePerSeg - 90) * Math.PI / 180;
            const lx = cx + (radius * 0.65) * Math.cos(labelAngle);
            const ly = cy + (radius * 0.65) * Math.sin(labelAngle);
            const text = document.createElementNS(svgNS, 'text');
            text.setAttribute('x', lx);
            text.setAttribute('y', ly);
            text.setAttribute('text-anchor', 'middle');
            text.setAttribute('dominant-baseline', 'middle');
            text.setAttribute('fill', '#fff');
            text.setAttribute('font-weight', '900');
            text.setAttribute('font-size', '18');
            text.textContent = mult + 'x';
            svg.appendChild(text);
        });

        container.appendChild(svg);

        // Pointer
        const pointer = document.createElement('div');
        pointer.className = 'wheel-pointer';
        container.appendChild(pointer);

        // Center hub
        const hub = document.createElement('div');
        hub.className = 'wheel-center-hub';
        hub.textContent = 'SPIN';
        container.appendChild(hub);

        body.appendChild(container);

        // Result display
        const result = document.createElement('div');
        result.className = 'wheel-result';
        result.textContent = '';
        body.appendChild(result);

        // Auto-spin demo
        setTimeout(() => {
            const winIdx = Math.floor(rng() * segments);
            const targetAngle = 360 * 4 + (360 - winIdx * anglePerSeg - anglePerSeg / 2);
            svg.style.transform = `rotate(${targetAngle}deg)`;
            svg.classList.add('spinning');

            setTimeout(() => {
                result.textContent = multipliers[winIdx] + 'x MULTIPLIER!';
                result.classList.add('visible');
            }, 4200);
        }, 500);
    }

    // ═══════════════════════════════════════════
    // 5. EXPANDING SYMBOL
    // ═══════════════════════════════════════════
    function buildExpandingSymbol(game, body, symbols) {
        const chosenSymbol = symbols[Math.floor(rng() * (symbols.length - 1))];

        // Reveal circle
        const reveal = document.createElement('div');
        reveal.className = 'es-reveal-stage';
        reveal.innerHTML = `<div class="es-symbol-preview">${chosenSymbol}</div>`;
        body.appendChild(reveal);

        const label = document.createElement('div');
        label.style.cssText = 'text-align:center;font-weight:700;color:rgba(255,255,255,0.7);font-size:0.9rem;letter-spacing:2px;';
        label.textContent = 'EXPANDING SYMBOL SELECTED';
        body.appendChild(label);

        // Reel preview
        const reelPrev = document.createElement('div');
        reelPrev.className = 'es-reel-preview';
        const cols = Math.min(game.gridCols || 5, 5);
        const rows = Math.min(game.gridRows || 3, 3);

        for (let c = 0; c < cols; c++) {
            const col = document.createElement('div');
            col.className = 'es-reel-col';
            for (let r = 0; r < rows; r++) {
                const cell = document.createElement('div');
                cell.className = 'es-reel-cell';
                cell.textContent = symbols[Math.floor(rng() * symbols.length)];
                col.appendChild(cell);
            }
            reelPrev.appendChild(col);
        }
        body.appendChild(reelPrev);

        // Animate expansion demo
        setTimeout(() => {
            const expandCol = Math.floor(rng() * cols);
            const col = reelPrev.children[expandCol];
            Array.from(col.children).forEach((cell, i) => {
                setTimeout(() => {
                    cell.textContent = chosenSymbol;
                    cell.classList.add('expanded');
                }, i * 200);
            });
        }, 1200);
    }

    // ═══════════════════════════════════════════
    // 6. EXPANDING WILD RESPIN
    // ═══════════════════════════════════════════
    function buildExpandingWildRespin(game, body, symbols) {
        const display = document.createElement('div');
        display.className = 'ewr-reel-display';
        const cols = Math.min(game.gridCols || 5, 5);
        const rows = Math.min(game.gridRows || 3, 3);

        for (let c = 0; c < cols; c++) {
            const col = document.createElement('div');
            col.className = 'ewr-col';
            for (let r = 0; r < rows; r++) {
                const cell = document.createElement('div');
                cell.className = 'ewr-cell';
                cell.textContent = symbols[Math.floor(rng() * symbols.length)];
                col.appendChild(cell);
            }
            display.appendChild(col);
        }
        body.appendChild(display);

        const counter = document.createElement('div');
        counter.className = 'ewr-respin-counter';
        counter.innerHTML = 'RESPINS: <span>3</span>';
        body.appendChild(counter);

        // Demo: expand a wild column
        setTimeout(() => {
            const expandIdx = Math.floor(rng() * cols);
            const col = display.children[expandIdx];
            col.classList.add('wild-expanded');
            Array.from(col.children).forEach(cell => cell.textContent = '🌟');
        }, 1000);
    }

    // ═══════════════════════════════════════════
    // 7. ZEUS MULTIPLIER
    // ═══════════════════════════════════════════
    function buildZeusMultiplier(game, body) {
        const mults = game.zeusMultipliers || [2,3,5,10,25,500];

        const stage = document.createElement('div');
        stage.className = 'zeus-stage';

        // Mult orb display
        const multDisplay = document.createElement('div');
        multDisplay.className = 'zeus-mult-display';
        mults.forEach(m => {
            const orb = document.createElement('div');
            orb.className = 'zeus-mult-orb';
            orb.textContent = m + 'x';
            orb.dataset.value = m;
            multDisplay.appendChild(orb);
        });
        stage.appendChild(multDisplay);
        body.appendChild(stage);

        const total = document.createElement('div');
        total.className = 'zeus-total-mult';
        total.textContent = 'TOTAL: 1x';
        body.appendChild(total);

        // Animate lightning strikes
        let runningTotal = 0;
        let strikes = 0;
        function strike() {
            if (strikes >= 4) return;
            const orbEls = Array.from(multDisplay.children);
            const pick = orbEls[Math.floor(rng() * orbEls.length)];
            pick.classList.add('active');
            runningTotal += parseInt(pick.dataset.value);
            total.textContent = `TOTAL: ${runningTotal}x`;

            // Create bolt SVG
            const bolt = document.createElement('div');
            bolt.className = 'zeus-bolt strike';
            bolt.style.left = (20 + rng() * 60) + '%';
            bolt.innerHTML = `<svg viewBox="0 0 40 120"><path d="M20 0 L12 50 L22 48 L8 120 L28 55 L18 57 Z" fill="#fbbf24" opacity="0.9"/></svg>`;
            stage.appendChild(bolt);
            setTimeout(() => bolt.remove(), 800);

            strikes++;
            setTimeout(strike, 900);
        }
        setTimeout(strike, 700);
    }

    // ═══════════════════════════════════════════
    // 8. MONEY COLLECT
    // ═══════════════════════════════════════════
    function buildMoneyCollect(game, body, symbols) {
        const collector = document.createElement('div');
        collector.className = 'mc-wild-collector';
        collector.textContent = symbols[0] || '💰';
        body.appendChild(collector);

        const grid = document.createElement('div');
        grid.className = 'mc-coin-grid';
        const values = [5,10,15,20,25,50,75,100];
        for (let i = 0; i < 15; i++) {
            const coin = document.createElement('div');
            coin.className = 'mc-coin empty';
            coin.dataset.value = values[Math.floor(rng() * values.length)];
            grid.appendChild(coin);
        }
        body.appendChild(grid);

        const totalEl = document.createElement('div');
        totalEl.className = 'mc-total';
        totalEl.textContent = '$0';
        body.appendChild(totalEl);

        // Demo
        let total = 0;
        const coins = Array.from(grid.children);
        let filled = 0;
        function fillCoin() {
            if (filled >= 8) {
                // Collect phase
                setTimeout(() => {
                    coins.filter(c => c.classList.contains('filled')).forEach((c, i) => {
                        setTimeout(() => {
                            c.classList.add('collected');
                            total += parseInt(c.dataset.value);
                            totalEl.textContent = '$' + total;
                        }, i * 150);
                    });
                }, 500);
                return;
            }
            const empty = coins.filter(c => c.classList.contains('empty'));
            if (empty.length === 0) return;
            const pick = empty[Math.floor(rng() * empty.length)];
            pick.classList.remove('empty');
            pick.classList.add('filled');
            pick.textContent = '$' + pick.dataset.value;
            filled++;
            setTimeout(fillCoin, 400);
        }
        setTimeout(fillCoin, 600);
    }

    // ═══════════════════════════════════════════
    // 9. STACKED WILDS
    // ═══════════════════════════════════════════
    function buildStackedWilds(game, body, symbols) {
        const display = document.createElement('div');
        display.className = 'sw-reel-display';
        const cols = Math.min(game.gridCols || 5, 5);
        const rows = Math.min(game.gridRows || 3, 3);

        for (let c = 0; c < cols; c++) {
            const col = document.createElement('div');
            col.className = 'sw-col';
            for (let r = 0; r < rows; r++) {
                const cell = document.createElement('div');
                cell.className = 'sw-cell';
                cell.textContent = symbols[Math.floor(rng() * symbols.length)];
                col.appendChild(cell);
            }
            display.appendChild(col);
        }
        body.appendChild(display);

        // Wild meter
        const meter = document.createElement('div');
        meter.className = 'sw-meter';
        meter.innerHTML = '<div class="sw-meter-fill" style="width:0%"></div>';
        body.appendChild(meter);

        // Demo: stack 2 columns
        let stackCount = 0;
        function stackCol() {
            if (stackCount >= 2) return;
            const idx = Math.floor(rng() * cols);
            const col = display.children[idx];
            if (col.classList.contains('stacked')) { stackCount++; stackCol(); return; }
            col.classList.add('stacked');
            Array.from(col.children).forEach((cell, i) => {
                setTimeout(() => {
                    cell.classList.add('wild');
                    cell.textContent = '🃏';
                }, i * 200);
            });
            stackCount++;
            const fill = meter.querySelector('.sw-meter-fill');
            fill.style.width = (stackCount / 3 * 100) + '%';
            setTimeout(stackCol, 1000);
        }
        setTimeout(stackCol, 800);
    }

    // ═══════════════════════════════════════════
    // 10. STICKY WILDS
    // ═══════════════════════════════════════════
    function buildStickyWilds(game, body, symbols) {
        const grid = document.createElement('div');
        grid.className = 'sticky-grid';
        const cols = Math.min(game.gridCols || 5, 5);
        const rows = Math.min(game.gridRows || 3, 3);

        for (let i = 0; i < cols * rows; i++) {
            const cell = document.createElement('div');
            cell.className = 'sticky-cell';
            cell.textContent = symbols[Math.floor(rng() * symbols.length)];
            grid.appendChild(cell);
        }
        body.appendChild(grid);

        // Demo: stick some wilds
        const cells = Array.from(grid.children);
        let stuck = 0;
        function stickWild() {
            if (stuck >= 5) return;
            const free = cells.filter(c => !c.classList.contains('stuck'));
            if (free.length === 0) return;
            const pick = free[Math.floor(rng() * free.length)];
            pick.classList.add('stuck');
            pick.textContent = '🕸️';
            stuck++;
            setTimeout(stickWild, 600);
        }
        setTimeout(stickWild, 700);
    }

    // ═══════════════════════════════════════════
    // 11. WALKING WILDS
    // ═══════════════════════════════════════════
    function buildWalkingWilds(game, body, symbols) {
        const stage = document.createElement('div');
        stage.className = 'ww-stage';

        const walker = document.createElement('div');
        walker.className = 'ww-walker';
        walker.textContent = symbols[0] || '🚶';
        walker.style.left = '10%';
        stage.appendChild(walker);
        body.appendChild(stage);

        const desc = document.createElement('div');
        desc.style.cssText = 'text-align:center;color:rgba(255,255,255,0.6);font-size:0.85rem;';
        desc.textContent = 'Wild walks left one position each spin';
        body.appendChild(desc);

        // Demo walk
        let pos = 10;
        function walk() {
            if (pos >= 80) return;
            // Leave trail
            const mark = document.createElement('div');
            mark.className = 'ww-trail-mark';
            mark.style.left = pos + '%';
            stage.appendChild(mark);
            setTimeout(() => mark.remove(), 2000);

            pos += 15;
            walker.style.left = pos + '%';
            setTimeout(walk, 800);
        }
        setTimeout(walk, 600);
    }

    // ═══════════════════════════════════════════
    // 12. MYSTERY STACKS
    // ═══════════════════════════════════════════
    function buildMysteryStacks(game, body, symbols) {
        const grid = document.createElement('div');
        grid.className = 'ms-box-grid';

        for (let i = 0; i < 15; i++) {
            const box = document.createElement('div');
            box.className = 'ms-box';
            box.dataset.symbol = symbols[Math.floor(rng() * symbols.length)];
            grid.appendChild(box);
        }
        body.appendChild(grid);

        // Demo reveal
        const boxes = Array.from(grid.children);
        // Pick one symbol to reveal as "mystery"
        const mysterySymbol = symbols[Math.floor(rng() * symbols.length)];
        let revCount = 0;
        function revealBox() {
            if (revCount >= 8) return;
            const unrevealed = boxes.filter(b => !b.classList.contains('revealed'));
            if (unrevealed.length === 0) return;
            const pick = unrevealed[Math.floor(rng() * unrevealed.length)];
            pick.classList.add('revealed');
            pick.textContent = mysterySymbol;
            revCount++;
            setTimeout(revealBox, 350);
        }
        setTimeout(revealBox, 700);
    }

    // ═══════════════════════════════════════════
    // 13. MULTIPLIER WILDS
    // ═══════════════════════════════════════════
    function buildMultiplierWilds(game, body, symbols) {
        const cardRow = document.createElement('div');
        cardRow.className = 'mw-card-row';
        const mults = [2,3,5,2,3,10,2,5];

        mults.forEach((m, i) => {
            const card = document.createElement('div');
            card.className = 'mw-card';
            card.innerHTML = `<div class="mw-card-symbol">${symbols[i % symbols.length]}</div><div class="mw-card-mult">${m}x</div>`;
            cardRow.appendChild(card);
        });
        body.appendChild(cardRow);

        // Demo flip
        const cards = Array.from(cardRow.children);
        let flipped = 0;
        function flipCard() {
            if (flipped >= 5) return;
            const pick = cards[Math.floor(rng() * cards.length)];
            if (!pick.classList.contains('active')) {
                pick.classList.add('active');
                flipped++;
            }
            setTimeout(flipCard, 500);
        }
        setTimeout(flipCard, 600);
    }

    // ═══════════════════════════════════════════
    // 14. COIN RESPIN
    // ═══════════════════════════════════════════
    function buildCoinRespin(game, body) {
        const grid = document.createElement('div');
        grid.className = 'cr-coin-grid';
        const values = [10,15,20,25,50,75,100,200];

        for (let i = 0; i < 15; i++) {
            const coin = document.createElement('div');
            coin.className = 'cr-coin';
            coin.dataset.value = values[Math.floor(rng() * values.length)];
            grid.appendChild(coin);
        }
        body.appendChild(grid);

        const respinEl = document.createElement('div');
        respinEl.className = 'cr-respins-left';
        respinEl.innerHTML = 'RESPINS: <span>3</span>';
        body.appendChild(respinEl);

        // Demo
        const coins = Array.from(grid.children);
        let landed = 0;
        function landCoin() {
            if (landed >= 7) return;
            const free = coins.filter(c => !c.classList.contains('landed'));
            if (free.length === 0) return;
            const pick = free[Math.floor(rng() * free.length)];
            pick.classList.add('landed');
            pick.textContent = '$' + pick.dataset.value;
            landed++;
            setTimeout(landCoin, 500);
        }
        setTimeout(landCoin, 500);
    }

    // ═══════════════════════════════════════════
    // 15. CHAMBER SPINS
    // ═══════════════════════════════════════════
    function buildChamberSpins(game, body) {
        const door = document.createElement('div');
        door.className = 'chamber-door';
        door.innerHTML = '<div class="chamber-handle"></div>';
        body.appendChild(door);

        const prizes = document.createElement('div');
        prizes.className = 'chamber-prizes';
        const prizeValues = ['5 FREE SPINS', '3x MULTIPLIER', '$500', '10 FREE SPINS', '5x MULTIPLIER', '$1000'];
        prizeValues.forEach(v => {
            const p = document.createElement('div');
            p.className = 'chamber-prize';
            p.textContent = v;
            prizes.appendChild(p);
        });
        body.appendChild(prizes);

        // Demo
        setTimeout(() => {
            door.classList.add('opening');
            // Reveal prizes
            setTimeout(() => {
                Array.from(prizes.children).forEach((p, i) => {
                    setTimeout(() => p.classList.add('revealed'), i * 300);
                });
            }, 1500);
        }, 600);
    }

    // ═══════════════════════════════════════════
    // 16. FISHERMAN COLLECT
    // ═══════════════════════════════════════════
    function buildFishermanCollect(game, body) {
        const pond = document.createElement('div');
        pond.className = 'fish-pond';

        // Rod
        const rod = document.createElement('div');
        rod.className = 'fish-rod';
        rod.textContent = '🎣';
        pond.appendChild(rod);

        // Fish
        const fishValues = [10,25,50,75,100,200,500];
        for (let i = 0; i < 6; i++) {
            const fish = document.createElement('div');
            fish.className = 'fish-sprite';
            fish.textContent = ['🐟','🐠','🐡','🦈','🐙','🐚'][i % 6];
            fish.dataset.value = fishValues[Math.floor(rng() * fishValues.length)];
            fish.style.left = (10 + rng() * 75) + '%';
            fish.style.top = (30 + rng() * 50) + '%';
            fish.style.animationDelay = (rng() * 2) + 's';
            pond.appendChild(fish);
        }
        body.appendChild(pond);

        const totalEl = document.createElement('div');
        totalEl.className = 'fish-catch-total';
        totalEl.textContent = 'CATCH: $0';
        body.appendChild(totalEl);

        // Demo catches
        const fishes = Array.from(pond.querySelectorAll('.fish-sprite'));
        let total = 0;
        let caught = 0;
        function catchFish() {
            if (caught >= 4 || fishes.length === 0) return;
            const pick = fishes[Math.floor(rng() * fishes.length)];
            if (pick.classList.contains('caught')) { caught++; catchFish(); return; }
            pick.classList.add('caught');
            total += parseInt(pick.dataset.value);
            totalEl.textContent = 'CATCH: $' + total;
            caught++;
            setTimeout(catchFish, 800);
        }
        setTimeout(catchFish, 700);
    }

    // ═══════════════════════════════════════════
    // 17. WILD COLLECT
    // ═══════════════════════════════════════════
    function buildWildCollect(game, body, symbols) {
        const countEl = document.createElement('div');
        countEl.className = 'wc-wild-count';
        countEl.textContent = '0 / 10 WILDS';
        body.appendChild(countEl);

        const meterContainer = document.createElement('div');
        meterContainer.className = 'wc-meter-container';
        meterContainer.innerHTML = '<div class="wc-meter-track"><div class="wc-meter-fill" style="width:0%"></div></div>';
        body.appendChild(meterContainer);

        const symRow = document.createElement('div');
        symRow.className = 'wc-wild-symbols';
        body.appendChild(symRow);

        // Demo
        let count = 0;
        function addWild() {
            if (count >= 7) return;
            count++;
            countEl.textContent = count + ' / 10 WILDS';
            meterContainer.querySelector('.wc-meter-fill').style.width = (count / 10 * 100) + '%';

            const sym = document.createElement('div');
            sym.className = 'wc-wild-sym';
            sym.textContent = '🌟';
            symRow.appendChild(sym);
            setTimeout(addWild, 500);
        }
        setTimeout(addWild, 600);
    }

    // ═══════════════════════════════════════════
    // 18. RESPIN
    // ═══════════════════════════════════════════
    function buildRespin(game, body, symbols) {
        const reels = document.createElement('div');
        reels.className = 'respin-reels';

        for (let i = 0; i < 3; i++) {
            const reel = document.createElement('div');
            reel.className = 'respin-reel';
            reel.textContent = symbols[Math.floor(rng() * symbols.length)];
            reels.appendChild(reel);
        }
        body.appendChild(reels);

        const counter = document.createElement('div');
        counter.className = 'respin-count';
        counter.innerHTML = 'RESPINS: <span>3</span>';
        body.appendChild(counter);

        // Demo: lock first 2, respin 3rd
        setTimeout(() => {
            const matchSymbol = symbols[0];
            reels.children[0].textContent = matchSymbol;
            reels.children[0].classList.add('locked');
            setTimeout(() => {
                reels.children[1].textContent = matchSymbol;
                reels.children[1].classList.add('locked');
                setTimeout(() => {
                    reels.children[2].classList.add('spinning');
                    setTimeout(() => {
                        reels.children[2].classList.remove('spinning');
                        reels.children[2].textContent = matchSymbol;
                        reels.children[2].classList.add('locked');
                    }, 800);
                }, 500);
            }, 500);
        }, 600);
    }


    // ═══════════════════════════════════════════
    // HOOK: Patch showFreeSpinsOverlay
    // ═══════════════════════════════════════════
    const _origShowFreeSpinsOverlay = window.showFreeSpinsOverlay || null;

    // We override the overlay display, injecting before the standard one
    // The patching happens on DOMContentLoaded since ui-slot.js may load later
    function patchBonusOverlay() {
        // Check if showFreeSpinsOverlay exists in scope
        // It's inside an IIFE, so we need to intercept via the trigger point
        // Instead, we listen for the freeSpinsOverlay to appear and enhance it

        // Watch for the free spins overlay to become active
        const observer = new MutationObserver(function(mutations) {
            mutations.forEach(function(m) {
                if (m.type === 'childList') {
                    m.addedNodes.forEach(function(node) {
                        if (node.id === 'freeSpinsOverlay' || (node.classList && node.classList.contains('free-spins-overlay'))) {
                            interceptFreeSpinsOverlay(node);
                        }
                    });
                }
                if (m.type === 'attributes' && m.attributeName === 'class') {
                    const target = m.target;
                    if (target.id === 'freeSpinsOverlay' && target.classList.contains('active')) {
                        interceptFreeSpinsOverlay(target);
                    }
                }
            });
        });

        observer.observe(document.body, {
            childList: true,
            subtree: true,
            attributes: true,
            attributeFilter: ['class']
        });
    }

    let _lastBonusGameId = null;

    function interceptFreeSpinsOverlay(overlayEl) {
        // Get current game from global scope
        const game = window.currentGame;
        if (!game || !game.bonusType) return;

        // Prevent duplicate triggers for same game
        if (_lastBonusGameId === game.id + '_' + Date.now().toString().slice(0,-3)) return;
        _lastBonusGameId = game.id + '_' + Date.now().toString().slice(0,-3);

        // Show our custom bonus game overlay
        const spins = game.freeSpinsCount || 10;
        showBonusGameOverlay(game, spins);
    }

    // ═══════════════════════════════════════════
    // INIT
    // ═══════════════════════════════════════════
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', patchBonusOverlay);
    } else {
        patchBonusOverlay();
    }

    // Expose for external use
    window.showBonusGameOverlay = showBonusGameOverlay;
    window.BONUS_META = BONUS_META;

})();
