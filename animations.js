// ═══════════════════════════════════════════════════════
// ANIMATIONS & VISUAL EFFECTS MODULE
// Extracted from app.js — loaded via <script> tag
// All functions remain globally accessible for backward compatibility
// Respects appSettings for particles, confetti, animations toggles
// ═══════════════════════════════════════════════════════

// ───────────────────────────────────────────────────────
// Settings-aware helper
// ───────────────────────────────────────────────────────
function _animSettingEnabled(key) {
    if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return false;
    return !(window.appSettings && window.appSettings[key] === false);
}

// ───────────────────────────────────────────────────────
// Provider Animation Themes
// ───────────────────────────────────────────────────────
var PROVIDER_ANIM_THEMES = {
    novaspin:     { particles: ['⚡','🌌','💫','🔬','🚀'], color: '#00e5ff', glow: '#00e5ff44' },
    mythic-forge:    { particles: ['🏛️','⚡','👑','🌟','💎'], color: '#ffd700', glow: '#ffd70044' },
    ironclad:     { particles: ['🌿','🍀','🌲','🍃','🌱'], color: '#22c55e', glow: '#22c55e44' },
    golden-reels:   { particles: ['🍭','💎','🌸','🍬','✨'], color: '#f472b6', glow: '#f472b644' },
    vaultx:       { particles: ['💰','🔑','💣','🤠','⚙️'], color: '#d97706', glow: '#d9770644' },
    solstice:     { particles: ['🏮','🎋','🔱','🌸','🐉'], color: '#ef4444', glow: '#ef444444' },
    shadow-works: { particles: ['💀','🕷️','🌑','🦇','💜'], color: '#a855f7', glow: '#a855f744' },
    wild-frontier:  { particles: ['👾','🕹️','⭐','🎮','🔴'], color: '#06b6d4', glow: '#06b6d444' },
    neoncore:     { particles: ['💻','🔋','📡','⚡','🟢'], color: '#00ff80', glow: '#00ff8044' },
    frostbyte:    { particles: ['❄️','🧊','💎','🌨️','✨'], color: '#8cd2ff', glow: '#8cd2ff44' },
    desertgold:   { particles: ['🏜️','🌅','💰','🐪','⭐'], color: '#daa63c', glow: '#daa63c44' },
    orientreels:  { particles: ['🏮','🐉','🎋','🧧','✨'], color: '#e63228', glow: '#e6322844' },
};

function getProviderAnimTheme(game) {
    var key = (typeof getGameChromeStyle === 'function') ? getGameChromeStyle(game) : '';
    return PROVIDER_ANIM_THEMES[key] || { particles: ['✨','⭐','💫','✦','💰'], color: '#fbbf24', glow: '#fbbf2444' };
}

// ───────────────────────────────────────────────────────
// Confetti Effect
// ───────────────────────────────────────────────────────

// Track live confetti DOM count to prevent excessive elements during rapid wins
var _liveConfettiCount = 0;
var _MAX_CONFETTI_ELEMENTS = 150; // hard cap across all concurrent confetti bursts

function createConfetti() {
    if (!_animSettingEnabled('confetti')) return;
    if (_liveConfettiCount >= _MAX_CONFETTI_ELEMENTS) return; // prevent DOM flooding

    const colors = ['confetti-1', 'confetti-2', 'confetti-3', 'confetti-4', 'confetti-5'];
    const budget = Math.min(50, _MAX_CONFETTI_ELEMENTS - _liveConfettiCount);

    for (let i = 0; i < budget; i++) {
        const confetti = document.createElement('div');
        confetti.className = `confetti ${colors[Math.floor(Math.random() * colors.length)]}`;
        confetti.style.left = Math.random() * 100 + '%';
        confetti.style.animationDelay = Math.random() * 0.5 + 's';
        confetti.style.width = (Math.random() * 10 + 5) + 'px';
        confetti.style.height = (Math.random() * 10 + 5) + 'px';
        confetti.style.willChange = 'transform, opacity';
        document.body.appendChild(confetti);
        _liveConfettiCount++;

        setTimeout(() => {
            confetti.remove();
            _liveConfettiCount--;
        }, 4000);
    }
}

// ───────────────────────────────────────────────────────
// Particle Effects & Symbol Cascade System
// ───────────────────────────────────────────────────────

function createParticles(x, y, count, type, symbolOverride) {
    count = (count === undefined) ? 8 : count;
    type  = type  || 'gold';
    if (!_animSettingEnabled('particles')) return;

    var defaultSymbols = ['✨', '⭐', '💫', '✦', '💰'];
    var pool = symbolOverride || defaultSymbols;
    for (var i = 0; i < count; i++) {
        var particle = document.createElement('div');
        particle.className = 'particle ' + type;
        particle.textContent = pool[Math.floor(Math.random() * pool.length)];
        particle.style.left  = x + 'px';
        particle.style.top   = y + 'px';
        particle.style.setProperty('--tx', (Math.random() - 0.5) * 100 + 'px');
        particle.style.willChange = 'transform, opacity';
        particle.style.color = type === 'gold'   ? '#fbbf24'
                             : type === 'green'  ? '#10b981'
                             : type === 'purple' ? '#a855f7'
                             : '#fbbf24';
        document.body.appendChild(particle);
        setTimeout(function(p){ return function(){ p.remove(); }; }(particle), 1500);
    }
}

function applySymbolCascade(cells, highlightColor = 'gold') {
    if (!_animSettingEnabled('animations')) return;

    cells.forEach((cell, index) => {
        if (cell) {
            cell.classList.add(`symbol-cascade`, `symbol-cascade-${Math.min(index + 1, 6)}`);
            cell.classList.add(`highlight-${highlightColor}`);
            // Trigger sparkle effect
            setTimeout(() => {
                cell.classList.add('symbol-sparkle');
                const rect = cell.getBoundingClientRect();
                createParticles(rect.left + rect.width / 2, rect.top + rect.height / 2, 5, 'gold');
            }, 100 * index);
        }
    });
}

function triggerWinCascade(game) {
    if (!_animSettingEnabled('animations')) return;

    var winCells = document.querySelectorAll('.reel-win-glow');
    var cells    = Array.from(winCells);
    var theme    = getProviderAnimTheme(game);

    // Apply themed glow colour to winning cells
    cells.forEach(function(cell) {
        cell.style.boxShadow   = '0 0 18px 4px ' + theme.glow + ', 0 0 6px 2px ' + theme.color + '88';
        cell.style.borderColor = theme.color;
    });

    applySymbolCascade(cells, 'gold');

    var centerX = window.innerWidth  / 2;
    var centerY = window.innerHeight / 2;
    createParticles(centerX, centerY, 15, 'sparkle', theme.particles);
}

// ───────────────────────────────────────────────────────
// Symbol Hit Animation — CSS keyframes (injected once at load)
// ───────────────────────────────────────────────────────

(function _injectSymbolHitStyles() {
    if (document.getElementById('sym-hit-styles')) return; // already injected
    var style = document.createElement('style');
    style.id = 'sym-hit-styles';
    style.textContent = [
        /* electric — quick white flash for lightning / sci-fi / gothic themes */
        '@keyframes symHitElectric {',
        '  0%   { box-shadow: 0 0 0px #fff; filter: brightness(1); }',
        '  20%  { box-shadow: 0 0 24px 8px #fff, 0 0 40px 16px #7c4dff88; filter: brightness(2.5); }',
        '  60%  { box-shadow: 0 0 12px 4px #b0bec5; filter: brightness(1.4); }',
        '  100% { box-shadow: none; filter: brightness(1); }',
        '}',
        '.sym-hit-electric {',
        '  animation: symHitElectric 0.4s ease-out forwards;',
        '}',

        /* rainbow — hue-rotate shimmer for candy / sweet themes */
        '@keyframes symHitRainbow {',
        '  0%   { box-shadow: 0 0 0px #f06292; filter: hue-rotate(0deg) brightness(1); }',
        '  25%  { box-shadow: 0 0 18px 6px #ba68c8; filter: hue-rotate(90deg) brightness(1.6); }',
        '  50%  { box-shadow: 0 0 22px 8px #ff80ab; filter: hue-rotate(180deg) brightness(1.8); }',
        '  75%  { box-shadow: 0 0 18px 6px #ea80fc; filter: hue-rotate(270deg) brightness(1.6); }',
        '  100% { box-shadow: none; filter: hue-rotate(360deg) brightness(1); }',
        '}',
        '.sym-hit-rainbow {',
        '  animation: symHitRainbow 0.4s ease-out forwards;',
        '}',

        /* golden — warm gold box-shadow pulse for coin / nature / wealth themes */
        '@keyframes symHitGolden {',
        '  0%   { box-shadow: 0 0 0px #fbbf24; filter: brightness(1); }',
        '  30%  { box-shadow: 0 0 20px 8px #fbbf24, 0 0 36px 12px #f59e0b88; filter: brightness(1.7); }',
        '  70%  { box-shadow: 0 0 10px 4px #fbbf2488; filter: brightness(1.2); }',
        '  100% { box-shadow: none; filter: brightness(1); }',
        '}',
        '.sym-hit-golden {',
        '  animation: symHitGolden 0.4s ease-out forwards;',
        '}',

        /* accent — CSS variable driven pulse for game accentColor fallback */
        '@keyframes symHitAccent {',
        '  0%   { box-shadow: 0 0 0px var(--sym-hit-color, #fbbf24); filter: brightness(1); }',
        '  30%  { box-shadow: 0 0 20px 8px var(--sym-hit-color, #fbbf24); filter: brightness(1.7); }',
        '  70%  { box-shadow: 0 0 10px 4px var(--sym-hit-color, #fbbf24); filter: brightness(1.2); }',
        '  100% { box-shadow: none; filter: brightness(1); }',
        '}',
        '.sym-hit-accent {',
        '  animation: symHitAccent 0.4s ease-out forwards;',
        '}'
    ].join('\n');
    document.head.appendChild(style);
}());

// ───────────────────────────────────────────────────────
// Game-Specific Symbol Hit Animation
// ───────────────────────────────────────────────────────

/**
 * Play a brief (0.4 s) CSS animation on a winning symbol cell,
 * styled to match the provider/game theme.
 *
 * Hit styles (resolved from PROVIDER_FULL_THEMES.symbolHitStyle or game.accentColor):
 *   'electric'  — quick white flash (lightning / sci-fi / gothic themes)
 *   'rainbow'   — pastel hue-rotate shimmer (candy / sweet themes)
 *   'golden'    — warm gold box-shadow pulse (coin / nature / wealth themes)
 *   default     — accentColor box-shadow pulse when no provider style matches
 *
 * Safe to call with null/undefined cellElement.
 *
 * @param {Element|null} cellElement  - winning reel cell DOM element
 * @param {object|null}  game         - current game definition object
 */
function triggerSymbolHitAnimation(cellElement, game) {
    if (!cellElement) return;
    if (!_animSettingEnabled('animations')) return;

    // Resolve provider theme for hit style
    var hitStyle = 'golden'; // safe default
    var accentColor = (game && game.accentColor) ? game.accentColor : null;

    if (game && typeof getProviderFullTheme === 'function') {
        var fullTheme = getProviderFullTheme(game);
        if (fullTheme && fullTheme.symbolHitStyle) {
            hitStyle = fullTheme.symbolHitStyle;
        }
    }

    // Choose animation class by hit style
    var cssClass;
    if (hitStyle === 'electric') {
        cssClass = 'sym-hit-electric';
    } else if (hitStyle === 'rainbow') {
        cssClass = 'sym-hit-rainbow';
    } else if (hitStyle === 'golden') {
        cssClass = 'sym-hit-golden';
    } else if (accentColor) {
        // Fallback: inline box-shadow pulse in the game's accentColor
        cssClass = 'sym-hit-accent';
        cellElement.style.setProperty('--sym-hit-color', accentColor);
    } else {
        cssClass = 'sym-hit-golden';
    }

    // Apply and auto-remove after animation duration (400 ms)
    cellElement.classList.add(cssClass);
    setTimeout(function() {
        cellElement.classList.remove(cssClass);
        if (cssClass === 'sym-hit-accent') {
            cellElement.style.removeProperty('--sym-hit-color');
        }
    }, 400);
}

// ───────────────────────────────────────────────────────
// Bonus Overlay Effect
// ───────────────────────────────────────────────────────

function showBonusEffect(text, color) {
    if (!_animSettingEnabled('animations')) return;

    const container = document.getElementById('winAnimation');
    if (!container) return;
    const effect = document.createElement('div');
    effect.className = 'bonus-effect';
    effect.style.color = color || '#fbbf24';
    effect.style.willChange = 'transform, opacity';
    effect.textContent = text;
    container.appendChild(effect);
    setTimeout(() => effect.remove(), 2500);
}

// ───────────────────────────────────────────────────────
// Page Transition Animation
// ───────────────────────────────────────────────────────

function showPageTransition(callback) {
    const transition = document.getElementById('pageTransition');
    if (!transition || !_animSettingEnabled('animations')) {
        // Skip animation but still execute callback
        if (callback) callback();
        return;
    }
    transition.classList.add('active');
    setTimeout(() => {
        if (callback) callback();
        setTimeout(() => {
            transition.classList.remove('active');
        }, 300);
    }, 300);
}

// ───────────────────────────────────────────────────────
// Screen Shake Effect
// ───────────────────────────────────────────────────────

/**
 * Trigger screen shake effect on the slot modal
 * @param {'epic'|'mega'|'jackpot'} intensity
 */
function triggerScreenShake(intensity) {
    if (!_animSettingEnabled('animations')) return;
    const quality = (window.appSettings && window.appSettings.animationQuality) || 'ultra';
    if (quality !== 'ultra' && quality !== 'high') return;
    if (quality === 'high' && intensity === 'epic') return; // only mega+ on high

    const modal = document.getElementById('slotMachineModal');
    if (!modal) return;

    const cls = 'screen-shake-' + intensity;
    modal.classList.remove('screen-shake-epic', 'screen-shake-mega', 'screen-shake-jackpot');
    void modal.offsetWidth; // force reflow
    modal.classList.add(cls);

    const durations = { epic: 1500, mega: 2000, jackpot: 3000 };
    setTimeout(() => modal.classList.remove(cls), durations[intensity] || 2000);

    // Screen flash for mega+
    if (intensity === 'mega' || intensity === 'jackpot') {
        const flash = document.createElement('div');
        flash.className = 'screen-flash';
        flash.style.willChange = 'opacity';
        document.body.appendChild(flash);
        setTimeout(() => flash.remove(), 400);
    }
}

// ───────────────────────────────────────────────────────
// Cinematic Vignette Overlay
// ───────────────────────────────────────────────────────

/** Show cinematic vignette overlay */
function showCinematicVignette() {
    let vignette = document.querySelector('.cinematic-vignette');
    if (!vignette) {
        vignette = document.createElement('div');
        vignette.className = 'cinematic-vignette';
        vignette.style.willChange = 'opacity';
        document.body.appendChild(vignette);
    }
    requestAnimationFrame(() => {
        requestAnimationFrame(() => {
            vignette.classList.add('active');
        });
    });
    return vignette;
}

/** Hide cinematic vignette overlay */
function hideCinematicVignette() {
    const vignette = document.querySelector('.cinematic-vignette');
    if (vignette) {
        vignette.classList.remove('active');
        setTimeout(() => vignette.remove(), 400);
    }
}

// ───────────────────────────────────────────────────────
// Win Text Slam
// ───────────────────────────────────────────────────────

/**
 * Show dramatic win text that slams into view
 * @param {string} text - e.g. "MEGA WIN!" or "$5,000"
 * @param {'epic'|'mega'|'jackpot'} tier
 */
function showWinTextSlam(text, tier) {
    const el = document.createElement('div');
    el.className = 'win-text-slam ' + (tier || '');
    el.style.willChange = 'transform, opacity';
    el.textContent = text;
    document.body.appendChild(el);

    const duration = tier === 'jackpot' ? 800 : 500;
    // Auto-remove after animation + display time
    setTimeout(() => {
        el.style.transition = 'opacity 0.5s ease';
        el.style.opacity = '0';
        setTimeout(() => el.remove(), 600);
    }, duration + 2000);

    return el;
}

// ───────────────────────────────────────────────────────
// 3D Win Depth Effects
// ───────────────────────────────────────────────────────

/**
 * Apply 3D depth to winning vs non-winning cells
 * @param {Element[]} winningCells - cells that won
 * @param {Element[]} allCells - all reel cells
 */
function apply3DWinDepth(winningCells, allCells) {
    const quality = (window.appSettings && window.appSettings.animationQuality) || 'ultra';
    if (quality !== 'ultra' && quality !== 'high') return;

    const winSet = new Set(winningCells);
    allCells.forEach(cell => {
        if (winSet.has(cell)) {
            cell.classList.add('reel-3d-pop');
            cell.classList.remove('reel-3d-recede');
        } else {
            cell.classList.add('reel-3d-recede');
            cell.classList.remove('reel-3d-pop');
        }
    });

    // Add 3D perspective to container
    const container = document.querySelector('.reel-grid');
    if (container) container.classList.add('reel-container-3d');
}

/**
 * Remove 3D depth effects from all cells
 * @param {Element[]} allCells
 */
function remove3DWinDepth(allCells) {
    allCells.forEach(cell => {
        cell.classList.remove('reel-3d-pop', 'reel-3d-recede');
    });
    const container = document.querySelector('.reel-grid');
    if (container) container.classList.remove('reel-container-3d');
}

// ───────────────────────────────────────────────────────
// Win Counter Roll Animation
// ───────────────────────────────────────────────────────

/**
 * Animate a win amount counting up
 * @param {Element} element - the DOM element to animate
 * @param {number} fromAmount
 * @param {number} toAmount
 * @param {number} duration - ms
 * @param {function} formatFn - format function (e.g., amount => '$' + amount.toFixed(2))
 */
function animateWinCounter(element, fromAmount, toAmount, duration, formatFn) {
    if (!element) return;
    const startTime = performance.now();
    formatFn = formatFn || function(v) { return '$' + v.toFixed(2); };

    element.classList.add('win-counter-roll', 'counting');

    function update(now) {
        // Stop if element was removed from DOM during animation
        if (!element.isConnected) return;

        const elapsed = now - startTime;
        const progress = Math.min(elapsed / duration, 1);
        // Ease-out cubic for satisfying deceleration
        const eased = 1 - Math.pow(1 - progress, 3);
        const current = fromAmount + (toAmount - fromAmount) * eased;
        element.textContent = formatFn(current);

        // Play counter tick sound
        if (typeof SoundManager !== 'undefined' && SoundManager.playCounterTick) {
            if (Math.random() < 0.3) SoundManager.playCounterTick(1 - progress);
        }

        if (progress < 1) {
            requestAnimationFrame(update);
        } else {
            element.classList.remove('counting');
            element.textContent = formatFn(toAmount);
        }
    }
    requestAnimationFrame(update);
}

// ───────────────────────────────────────────────────────
// Full Cinematic Win Sequence Orchestrator
// ───────────────────────────────────────────────────────

/**
 * Orchestrate a full cinematic win sequence
 * @param {number} winMultiplier - e.g., 50 for 50x bet
 * @param {number} winAmount - dollar amount won
 * @param {object} game - current game object
 * @param {Element[]} winningCells - DOM elements that won
 * @param {Element[]} allCells - all reel DOM cells
 */
function triggerCinematicWinSequence(winMultiplier, winAmount, game, winningCells, allCells) {
    const quality = (window.appSettings && window.appSettings.animationQuality) || 'ultra';
    if (quality === 'off' || quality === 'low') return;

    // Determine tier
    var tier, shakeType;
    if (winMultiplier >= (typeof WIN_JACKPOT_THRESHOLD !== 'undefined' ? WIN_JACKPOT_THRESHOLD : 100)) {
        tier = 'jackpot'; shakeType = 'jackpot';
    } else if (winMultiplier >= (typeof WIN_MEGA_THRESHOLD !== 'undefined' ? WIN_MEGA_THRESHOLD : 50)) {
        tier = 'mega'; shakeType = 'mega';
    } else if (winMultiplier >= (typeof WIN_EPIC_THRESHOLD !== 'undefined' ? WIN_EPIC_THRESHOLD : 25)) {
        tier = 'epic'; shakeType = 'epic';
    } else if (winMultiplier >= (typeof WIN_DRAMATIC_THRESHOLD !== 'undefined' ? WIN_DRAMATIC_THRESHOLD : 10)) {
        tier = 'big'; shakeType = null;
    } else {
        // Standard win — just particles and glow, no cinematic
        if (game) triggerWinCascade(game);
        return;
    }

    // Determine provider for particles/sound
    var providerKey = 'ironclad';
    if (typeof getGameChromeStyle === 'function') {
        providerKey = getGameChromeStyle(game);
    }

    // ── Resolve game-specific accent color for win text glow ──────────────
    // Prefer game.accentColor, then fall back to provider theme primary, then gold.
    var gameAccentColor = '#fbbf24'; // default gold
    if (game && game.accentColor) {
        gameAccentColor = game.accentColor;
    } else if (typeof getProviderFullTheme === 'function') {
        var _pfTheme = getProviderFullTheme(game);
        if (_pfTheme && _pfTheme.visual && _pfTheme.visual.primary) {
            gameAccentColor = _pfTheme.visual.primary;
        }
    }

    // ── Resolve win text gradient from provider theme ──────────────────────
    var winTextGradient = null;
    if (typeof getProviderFullTheme === 'function') {
        var _pfThemeText = getProviderFullTheme(game);
        if (_pfThemeText && _pfThemeText.winTextStyle) {
            winTextGradient = _pfThemeText.winTextStyle;
        }
    }

    // ── Detect jackpot game for extra intensity ────────────────────────────
    var isJackpotGame = game && game.jackpot && game.jackpot > 0;

    // === CINEMATIC TIMELINE ===
    var timeline = 0;
    var pauseMs = typeof CINEMATIC_PAUSE !== 'undefined' ? CINEMATIC_PAUSE : 500;

    // 0ms: Pause (anticipation)
    setTimeout(function() {
        // Play near-miss or anticipation sound
        if (typeof SoundManager !== 'undefined' && SoundManager.playSoundEvent) {
            SoundManager.playSoundEvent('scatter', providerKey);
        }
    }, timeline);
    timeline += pauseMs;

    // 500ms: Vignette darkens
    if (quality === 'ultra') {
        setTimeout(function() {
            showCinematicVignette();
        }, timeline);
        timeline += (typeof CINEMATIC_VIGNETTE_FADE !== 'undefined' ? CINEMATIC_VIGNETTE_FADE : 300);
    }

    // 800ms: 3D depth pop
    setTimeout(function() {
        apply3DWinDepth(winningCells, allCells);
    }, timeline);
    timeline += (typeof CINEMATIC_SYMBOL_POP !== 'undefined' ? CINEMATIC_SYMBOL_POP : 300);

    // 1100ms: Screen shake
    if (shakeType && (quality === 'ultra' || quality === 'high')) {
        setTimeout(function() {
            triggerScreenShake(shakeType);
        }, timeline);
    }

    // 1200ms: Win text slam — styled with game accent color
    setTimeout(function() {
        var label;
        if (tier === 'jackpot') label = 'JACKPOT!';
        else if (tier === 'mega') label = 'MEGA WIN!';
        else if (tier === 'epic') label = 'EPIC WIN!';
        else label = 'BIG WIN!';
        var winEl = showWinTextSlam(label, tier);

        // Apply game-specific glow color and gradient to win text element
        if (winEl) {
            winEl.style.textShadow = [
                '0 0 40px ' + gameAccentColor,
                '0 0 80px ' + gameAccentColor + '88',
                '0 0 120px ' + gameAccentColor + '44'
            ].join(', ');
            if (winTextGradient) {
                winEl.style.backgroundImage = winTextGradient;
                winEl.style.webkitBackgroundClip = 'text';
                winEl.style.backgroundClip = 'text';
                winEl.style.webkitTextFillColor = 'transparent';
            }
        }

        // Play appropriate win sound
        if (typeof SoundManager !== 'undefined' && SoundManager.playSoundEvent) {
            SoundManager.playSoundEvent(tier === 'big' ? 'bigwin' : tier, providerKey);
        }
        // Jackpot coin shower (fires 300ms after win text slams in)
        if (tier === 'jackpot' && typeof triggerCoinShower === 'function') {
            setTimeout(triggerCoinShower, 300);
        }
    }, timeline);
    timeline += (typeof CINEMATIC_TEXT_SLAM !== 'undefined' ? CINEMATIC_TEXT_SLAM : 300) + 200;

    // 1700ms: Particle explosion
    setTimeout(function() {
        // Canvas particles if available
        if (typeof triggerWinParticles === 'function') {
            var el = winningCells[0] || document.querySelector('.reel-grid');
            var rect = el.getBoundingClientRect();
            // Convert viewport coords to container-relative for particle canvas
            var container = document.querySelector('.reel-grid') || el.parentElement;
            var cRect = container.getBoundingClientRect();
            var cx = (rect.left + rect.width / 2) - cRect.left;
            var cy = (rect.top + rect.height / 2) - cRect.top;
            triggerWinParticles(cx, cy, winMultiplier, providerKey);

            // Extra particle burst for jackpot games — fire a second salvo offset
            if (isJackpotGame && (tier === 'mega' || tier === 'jackpot')) {
                setTimeout(function() {
                    triggerWinParticles(cx - 80, cy, winMultiplier, providerKey);
                    triggerWinParticles(cx + 80, cy, winMultiplier, providerKey);
                }, 300);
                setTimeout(function() {
                    triggerWinParticles(cx, cy - 60, winMultiplier, providerKey);
                }, 600);
            }
        }
        // Also trigger legacy confetti
        if (typeof createConfetti === 'function') createConfetti();
        // Provider cascade
        if (game && typeof triggerWinCascade === 'function') triggerWinCascade(game);
    }, timeline);
    timeline += (typeof CINEMATIC_PARTICLE_BURST !== 'undefined' ? CINEMATIC_PARTICLE_BURST : 500);

    // 2200ms: Win amount counter roll
    setTimeout(function() {
        var winDisplay = document.querySelector('.win-amount-display') || document.querySelector('.slot-win-display');
        if (winDisplay) {
            animateWinCounter(winDisplay, 0, winAmount, typeof CINEMATIC_COUNTER_ROLL !== 'undefined' ? CINEMATIC_COUNTER_ROLL : 2000);
        }
    }, timeline);
    timeline += (typeof CINEMATIC_COUNTER_ROLL !== 'undefined' ? CINEMATIC_COUNTER_ROLL : 2000);

    // 4200ms: Extra confetti rain for mega+
    // Jackpot games get an additional extra wave of confetti
    if (tier === 'mega' || tier === 'jackpot') {
        setTimeout(function() {
            if (typeof createConfetti === 'function') {
                createConfetti();
                setTimeout(function() { createConfetti(); }, 500);
                setTimeout(function() { createConfetti(); }, 1000);
                // Jackpot games: one more burst
                if (isJackpotGame) {
                    setTimeout(function() { createConfetti(); }, 1500);
                    setTimeout(function() { createConfetti(); }, 2000);
                }
            }
        }, timeline);
        timeline += (typeof CINEMATIC_CONFETTI_DURATION !== 'undefined' ? CINEMATIC_CONFETTI_DURATION : 3000);
    }

    // Final: Fade back to normal
    setTimeout(function() {
        hideCinematicVignette();
        remove3DWinDepth(allCells);
    }, timeline + (typeof CINEMATIC_FADE_BACK !== 'undefined' ? CINEMATIC_FADE_BACK : 500));
}

/**
 * Spawns animated coin-rain particles for jackpot celebrations.
 * CSS class .coin-rain-particle + @keyframes coinFall must exist in styles.css (they do).
 * @param {number} count - Number of coins to spawn (default 30)
 */
// Track live coin-rain particles to prevent DOM flooding during rapid jackpots
var _liveCoinCount = 0;
var _MAX_COIN_ELEMENTS = 80;

function triggerCoinShower(count) {
    var q = (typeof appSettings !== 'undefined' && appSettings.animationQuality) || 'high';
    if (q === 'off' || q === 'low') return;
    var n = count || (q === 'ultra' ? 40 : q === 'high' ? 30 : 18);
    // Cap to budget
    n = Math.min(n, _MAX_COIN_ELEMENTS - _liveCoinCount);
    if (n <= 0) return;
    var coins = ['🪙', '💰', '💎', '⭐', '🌟'];
    for (var i = 0; i < n; i++) {
        (function(idx) {
            setTimeout(function() {
                var el = document.createElement('div');
                el.className = 'coin-rain-particle';
                el.textContent = coins[Math.floor(Math.random() * coins.length)];
                var leftPct = 5 + Math.random() * 90;
                el.style.left = leftPct + 'vw';
                var dur = 1.4 + Math.random() * 1.8;
                el.style.animationDuration = dur + 's';
                el.style.animationDelay = '0s';
                el.style.fontSize = (16 + Math.random() * 14) + 'px';
                el.style.willChange = 'transform, opacity';
                document.body.appendChild(el);
                _liveCoinCount++;
                setTimeout(function() {
                    if (el.parentNode) el.remove();
                    _liveCoinCount--;
                }, (dur + 0.2) * 1000);
            }, idx * 60 + Math.random() * 80);
        })(i);
    }
}

/**
 * Shows a slide-in toast notification for win milestones.
 * CSS (.win-toast, .win-toast-streak/big/epic/jackpot) already exists in styles.css.
 * @param {string} message  - Short message text, e.g. "🔥 5× Streak!"
 * @param {string} tier     - 'streak' | 'big' | 'epic' | 'jackpot'
 * @param {string} [title]  - Optional label above message
 */
function _escHtml(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

function showWinToast(message, tier, title) {
    var q = (typeof appSettings !== 'undefined' && appSettings.animationQuality) || 'high';
    if (q === 'off') return;

    var icons = { streak: '🔥', big: '🏆', epic: '💎', jackpot: '🎰' };
    var icon = icons[tier] || '⭐';
    var tierClass = 'win-toast-' + (tier || 'big');

    // Stack existing toasts downward
    var existing = document.querySelectorAll('.win-toast:not(.toast-out)');
    var offset = 72 + existing.length * 62;

    var el = document.createElement('div');
    el.className = 'win-toast ' + tierClass;
    el.style.top = offset + 'px';

    // XSS-safe: build DOM nodes instead of innerHTML with untrusted content
    var iconSpan = document.createElement('span');
    iconSpan.className = 'win-toast-icon';
    iconSpan.textContent = icon;

    var bodyDiv = document.createElement('div');
    bodyDiv.className = 'win-toast-body';
    if (title) {
        var titleDiv = document.createElement('div');
        titleDiv.className = 'win-toast-title';
        titleDiv.textContent = title;
        bodyDiv.appendChild(titleDiv);
    }
    var msgDiv = document.createElement('div');
    msgDiv.textContent = message;
    bodyDiv.appendChild(msgDiv);

    el.appendChild(iconSpan);
    el.appendChild(bodyDiv);
    document.body.appendChild(el);

    // Auto-dismiss after 3s
    var dismiss = function() {
        el.classList.add('toast-out');
        setTimeout(function() { if (el.parentNode) el.remove(); }, 300);
    };
    setTimeout(dismiss, 3000);
}
