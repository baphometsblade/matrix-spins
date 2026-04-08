// ═══════════════════════════════════════════════════════════════════
// VISUAL OVERHAUL — Game Cards & Slot Play Screen Enhancements
// ═══════════════════════════════════════════════════════════════════
// Adds data attributes, 3D tilt effects, particle systems, and
// theme-specific ambient visuals to the casino experience
// ═══════════════════════════════════════════════════════════════════

(function() {
    'use strict';

    // ─────────────────────────────────────────────────────────────
    // REDUCED MOTION CHECK
    // ─────────────────────────────────────────────────────────────

    const _prefersReducedMotion = window.matchMedia
        ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
        : false;

    // ─────────────────────────────────────────────────────────────
    // CONFIGURATION & CONSTANTS
    // ─────────────────────────────────────────────────────────────

    const THEME_CATEGORY_MAP = {
        egyptian: [
            'book_dead', 'pharaoh_legacy', 'golden_pharaoh', 'pharaoh_march',
            'cleopatra_gold', 'golden_pharaoh', 'pharaoh_collect', 'midnight_oasis'
        ],
        ocean: [
            'big_bass', 'bass_splash', 'wild_deep', 'razor_shark', 'lightning_pearl',
            'neptune_storm'
        ],
        norse: [
            'viking_voyage', 'norse_vaults', 'gemhalla', 'loki_loot'
        ],
        fire: [
            'dragon_megafire', 'dragon_forge', 'crown_fire', 'fire_hole', 'fire_joker',
            'dragon_coins', 'wildfire_gold', 'hot_chillies', 'super_hot'
        ],
        space: [
            'starburst_xxl', 'quantum_burst', 'neon_nights', 'nova_blackhole', 'neon_viper',
            'galactic_raiders', 'comet_rush', 'solar_fist'
        ],
        candy: [
            'sugar_rush', 'fruit_party', 'jammin_fruits', 'sweet_bonanza', 'fat_rabbit',
            'extra_chilli', 'aztec_ascent'
        ],
        gothic: [
            'immortal_blood', 'crimson_fang', 'demon_chambers', 'dead_alive',
            'tombstone_reload', 'san_quentin', 'dragon_tumble', 'crystal_veil',
            'rome_eternal', 'thunder_hero', 'castle_siege', 'dragon_forge'
        ],
        western: [
            'wanted_dead', 'black_ops_heist', 'money_train', 'le_bandit', 'coin_strike',
            'black_bull'
        ],
        nature: [
            'wolf_gold', 'buffalo_stampede', 'great_rhino', 'wild_toro', 'mega_safari',
            'buffalo_extreme', 'buffalo_mega', 'wild_safari', 'arctic_foxes', 'golden_jaguar',
            'puppy_palace', 'wolf_rise', 'jungle_fury', 'snow_queen_riches', 'island_tiki'
        ],
        asian: [
            'jade_temple', 'five_lions', 'sakura_princess', 'lucky_dragon', 'big_bamboo',
            'lucky_777', 'solar_fist', 'samurai_blade', 'koi_ascension'
        ],
        olympus: [
            'gates_olympus', 'olympus_rising', 'olympian_gods', 'olympus_dream', 'pots_olympus',
            'ares_blade', 'crystal_shrine', 'crystal_chambers', 'cleopatra_gold'
        ],
        circus: [
            'big_top_bonanza', 'esqueleto_fiesta', 'lucha_mania'
        ]
    };

    const PARTICLE_CONFIGS = {
        egyptian: {
            colors: ['#d4af37', '#c9a961', '#f4d03f', '#c8a882', '#a89968'],
            style: 'sand',
            speed: 0.5,
            size: { min: 2, max: 8 }
        },
        ocean: {
            colors: ['#1e90ff', '#4169e1', '#6495ed', '#87ceeb', '#b0e0e6'],
            style: 'bubble',
            speed: 0.3,
            size: { min: 3, max: 12 }
        },
        fire: {
            colors: ['#ff6b35', '#f7931e', '#ff4500', '#ff8c00', '#ffd700'],
            style: 'ember',
            speed: 1.2,
            size: { min: 2, max: 6 }
        },
        space: {
            colors: ['#ffffff', '#87ceeb', '#1e90ff', '#0000ff', '#4169e1'],
            style: 'star',
            speed: 0.2,
            size: { min: 1, max: 3 }
        },
        candy: {
            colors: ['#ff1493', '#ff69b4', '#ffd700', '#00ff00', '#00bfff', '#ff00ff'],
            style: 'sparkle',
            speed: 0.7,
            size: { min: 3, max: 10 }
        },
        gothic: {
            colors: ['#660066', '#9932cc', '#8b008b', '#4b0082', '#2f1d52'],
            style: 'mist',
            speed: 0.4,
            size: { min: 4, max: 16 }
        },
        nature: {
            colors: ['#228b22', '#32cd32', '#90ee90', '#7cfc00', '#adff2f'],
            style: 'leaf',
            speed: 0.6,
            size: { min: 2, max: 8 }
        },
        asian: {
            colors: ['#ff1744', '#ffd700', '#ff6d00', '#4caf50', '#2196f3'],
            style: 'wisp',
            speed: 0.5,
            size: { min: 2, max: 6 }
        },
        default: {
            colors: ['#fbbf24', '#f59e0b', '#ffffff'],
            style: 'float',
            speed: 0.3,
            size: { min: 2, max: 5 }
        }
    };

    // ─────────────────────────────────────────────────────────────
    // UTILITY FUNCTIONS
    // ─────────────────────────────────────────────────────────────

    function getThemeCategory(gameId) {
        for (const [category, gameIds] of Object.entries(THEME_CATEGORY_MAP)) {
            if (gameIds.includes(gameId)) return category;
        }
        return 'classic';
    }

    function getProviderFromChromeStyles(gameId) {
        if (typeof GAME_CHROME_STYLES !== 'undefined' && GAME_CHROME_STYLES[gameId]) {
            return GAME_CHROME_STYLES[gameId];
        }
        return 'ironclad';
    }

    function lerpColor(color1, color2, t) {
        const c1 = parseInt(color1.slice(1), 16);
        const c2 = parseInt(color2.slice(1), 16);
        const r = Math.round((c1 >> 16 & 255) * (1 - t) + (c2 >> 16 & 255) * t);
        const g = Math.round((c1 >> 8 & 255) * (1 - t) + (c2 >> 8 & 255) * t);
        const b = Math.round((c1 & 255) * (1 - t) + (c2 & 255) * t);
        return `rgb(${r},${g},${b})`;
    }

    // ─────────────────────────────────────────────────────────────
    // 1. ADD DATA ATTRIBUTES TO GAME CARDS
    // ─────────────────────────────────────────────────────────────

    function attachDataAttributes(card) {
        if (card.dataset.enhanced) return;

        const gameId = card.dataset.gameId || card.getAttribute('data-game-id');
        if (!gameId) return;

        const provider = getProviderFromChromeStyles(gameId);
        const themeCategory = getThemeCategory(gameId);

        card.setAttribute('data-provider', provider);
        card.setAttribute('data-theme-category', themeCategory);
        card.classList.add(`provider-${provider}`);
        card.dataset.enhanced = 'true';
    }

    // ─────────────────────────────────────────────────────────────
    // 2. CARD 3D TILT EFFECT
    // ─────────────────────────────────────────────────────────────

    function addTiltEffect(card) {
        if (_prefersReducedMotion) return;
        if (card.dataset.tiltAttached) return;

        const tiltOptions = {
            maxTilt: 6,
            scale: 1.02,
            speed: 300
        };

        let tiltX = 0;
        let tiltY = 0;
        let targetTiltX = 0;
        let targetTiltY = 0;
        let isAnimating = false;

        card.addEventListener('mousemove', (e) => {
            const rect = card.getBoundingClientRect();
            const centerX = rect.width / 2;
            const centerY = rect.height / 2;
            const mouseX = e.clientX - rect.left;
            const mouseY = e.clientY - rect.top;

            const percentX = (mouseX - centerX) / centerX;
            const percentY = (mouseY - centerY) / centerY;

            targetTiltX = -percentY * tiltOptions.maxTilt;
            targetTiltY = percentX * tiltOptions.maxTilt;

            if (!isAnimating) {
                isAnimating = true;
                animateTilt();
            }
        });

        card.addEventListener('mouseleave', () => {
            targetTiltX = 0;
            targetTiltY = 0;
        });

        function animateTilt() {
            // Stop if card was removed from DOM (e.g., lobby re-rendered)
            if (!card.isConnected) { isAnimating = false; return; }

            tiltX += (targetTiltX - tiltX) * 0.15;
            tiltY += (targetTiltY - tiltY) * 0.15;

            const scale = 1 + (Math.abs(tiltX) + Math.abs(tiltY)) / (tiltOptions.maxTilt * 2) * 0.02;
            card.style.transform = `perspective(1000px) rotateX(${tiltX}deg) rotateY(${tiltY}deg) scale(${scale})`;

            const lightX = ((tiltY / tiltOptions.maxTilt) + 1) / 2 * 100;
            const lightY = ((-tiltX / tiltOptions.maxTilt) + 1) / 2 * 100;

            if (!card.querySelector('.card-light-reflection')) {
                const light = document.createElement('div');
                light.className = 'card-light-reflection';
                light.style.cssText = `
                    position: absolute;
                    top: 0;
                    left: 0;
                    width: 100%;
                    height: 100%;
                    pointer-events: none;
                    background: radial-gradient(circle at ${lightX}% ${lightY}%, rgba(255,255,255,0.3) 0%, transparent 60%);
                    border-radius: inherit;
                `;
                card.appendChild(light);
            } else {
                const light = card.querySelector('.card-light-reflection');
                light.style.background = `radial-gradient(circle at ${lightX}% ${lightY}%, rgba(255,255,255,0.3) 0%, transparent 60%)`;
            }

            if (Math.abs(targetTiltX - tiltX) > 0.1 || Math.abs(targetTiltY - tiltY) > 0.1) {
                requestAnimationFrame(animateTilt);
            } else {
                isAnimating = false;
                if (targetTiltX === 0 && targetTiltY === 0) {
                    card.style.transform = 'perspective(1000px) rotateX(0) rotateY(0) scale(1)';
                    const light = card.querySelector('.card-light-reflection');
                    if (light) light.remove();
                }
            }
        }

        card.dataset.tiltAttached = 'true';
    }

    // ─────────────────────────────────────────────────────────────
    // 3. FLOATING PARTICLE SYSTEM FOR LOBBY
    // ─────────────────────────────────────────────────────────────

    let lobbyParticleCanvas = null;
    let particleAnimationId = null;
    const particles = [];

    function createLobbyParticles() {
        if (_prefersReducedMotion) return;
        if (lobbyParticleCanvas) return;

        const lobbySection = document.querySelector('.lobby-section, .game-grid-container, [data-section="lobby"]');
        if (!lobbySection) return;

        const canvas = document.createElement('canvas');
        canvas.className = 'lobby-particle-canvas';
        canvas.width = window.innerWidth;
        canvas.height = window.innerHeight;
        canvas.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            pointer-events: none;
            z-index: 1;
            opacity: 0.6;
        `;

        document.body.insertBefore(canvas, document.body.firstChild);
        lobbyParticleCanvas = canvas;

        const ctx = canvas.getContext('2d');

        // Initialize particles
        for (let i = 0; i < 30; i++) {
            particles.push({
                x: Math.random() * canvas.width,
                y: Math.random() * canvas.height,
                vx: (Math.random() - 0.5) * 0.5,
                vy: -Math.random() * 0.3 - 0.1,
                radius: Math.random() * 2 + 1,
                color: ['#fbbf24', '#f59e0b', '#fcd34d', '#fbbf24'][Math.floor(Math.random() * 4)],
                life: Math.random() * 0.5 + 0.5
            });
        }

        function animateParticles() {
            // Stop loop if canvas was removed (navigation away from lobby)
            if (!lobbyParticleCanvas || !canvas.isConnected) {
                particleAnimationId = null;
                return;
            }
            // Pause rendering when tab is hidden (rAF already throttles, but skip work)
            if (document.hidden) {
                particleAnimationId = requestAnimationFrame(animateParticles);
                return;
            }

            ctx.clearRect(0, 0, canvas.width, canvas.height);

            particles.forEach((p, i) => {
                p.x += p.vx;
                p.y += p.vy;
                p.life -= 0.002;

                if (p.life <= 0 || p.y < -10) {
                    particles[i] = {
                        x: Math.random() * canvas.width,
                        y: canvas.height + 10,
                        vx: (Math.random() - 0.5) * 0.5,
                        vy: -Math.random() * 0.3 - 0.1,
                        radius: Math.random() * 2 + 1,
                        color: ['#fbbf24', '#f59e0b', '#fcd34d', '#fbbf24'][Math.floor(Math.random() * 4)],
                        life: 1
                    };
                }

                ctx.globalAlpha = p.life;
                ctx.fillStyle = p.color;
                ctx.beginPath();
                ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
                ctx.fill();
            });

            ctx.globalAlpha = 1;
            particleAnimationId = requestAnimationFrame(animateParticles);
        }

        animateParticles();

        // Handle window resize — store handler for cleanup
        lobbyParticleCanvas._resizeHandler = () => {
            canvas.width = window.innerWidth;
            canvas.height = window.innerHeight;
        };
        window.addEventListener('resize', lobbyParticleCanvas._resizeHandler);
    }

    function destroyLobbyParticles() {
        if (!lobbyParticleCanvas) return;
        if (lobbyParticleCanvas._resizeHandler) {
            window.removeEventListener('resize', lobbyParticleCanvas._resizeHandler);
        }
        if (particleAnimationId) {
            cancelAnimationFrame(particleAnimationId);
            particleAnimationId = null;
        }
        lobbyParticleCanvas.remove();
        lobbyParticleCanvas = null;
        particles.length = 0;
    }

    // ─────────────────────────────────────────────────────────────
    // 4. GAME CARD MICRO-ANIMATIONS
    // ─────────────────────────────────────────────────────────────

    function addMicroAnimations(card) {
        if (_prefersReducedMotion) return;
        if (card.dataset.microAnimationsAttached) return;

        const tag = card.getAttribute('data-tag') || card.dataset.tag || '';
        const gameId = card.dataset.gameId || '';

        // HOT games: flame particles at bottom
        if (tag === 'HOT' || tag.includes('hot')) {
            addFlameEffect(card);
        }

        // JACKPOT games: golden ring
        if (tag === 'JACKPOT' || tag === 'MEGA') {
            addGoldenRingEffect(card);
        }

        // NEW games: green aurora
        if (tag === 'NEW' || tag.includes('new')) {
            addAuroraEffect(card);
        }

        card.dataset.microAnimationsAttached = 'true';
    }

    function addFlameEffect(card) {
        const flame = document.createElement('div');
        flame.className = 'flame-effect';
        flame.style.cssText = `
            position: absolute;
            bottom: 0;
            left: 50%;
            transform: translateX(-50%);
            width: 40px;
            height: 60px;
            pointer-events: none;
            background: radial-gradient(ellipse at center bottom, #ff6b35 0%, #f7931e 30%, transparent 70%);
            filter: blur(2px);
            animation: flameFlicker 0.6s ease-in-out infinite;
        `;
        card.appendChild(flame);

        if (!document.querySelector('style[data-flame-animation]')) {
            const style = document.createElement('style');
            style.setAttribute('data-flame-animation', 'true');
            style.textContent = `
                @keyframes flameFlicker {
                    0%, 100% { opacity: 0.6; transform: translateX(-50%) scaleY(1); }
                    50% { opacity: 0.8; transform: translateX(-50%) scaleY(1.2); }
                }
            `;
            document.head.appendChild(style);
        }
    }

    function addGoldenRingEffect(card) {
        const ring = document.createElement('div');
        ring.className = 'golden-ring-effect';
        ring.style.cssText = `
            position: absolute;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            width: 120%;
            height: 120%;
            pointer-events: none;
            border: 3px solid #ffd700;
            border-radius: 50%;
            animation: spinRing 8s linear infinite;
            opacity: 0.5;
        `;
        card.appendChild(ring);

        if (!document.querySelector('style[data-ring-animation]')) {
            const style = document.createElement('style');
            style.setAttribute('data-ring-animation', 'true');
            style.textContent = `
                @keyframes spinRing {
                    0% { transform: translate(-50%, -50%) rotate(0deg); }
                    100% { transform: translate(-50%, -50%) rotate(360deg); }
                }
            `;
            document.head.appendChild(style);
        }
    }

    function addAuroraEffect(card) {
        const aurora = document.createElement('div');
        aurora.className = 'aurora-effect';
        aurora.style.cssText = `
            position: absolute;
            top: 0;
            left: 0;
            width: 100%;
            height: 40%;
            pointer-events: none;
            background: linear-gradient(90deg, transparent, #00ff88 20%, transparent 40%);
            filter: blur(3px);
            animation: auroraWave 3s ease-in-out infinite;
        `;
        card.appendChild(aurora);

        if (!document.querySelector('style[data-aurora-animation]')) {
            const style = document.createElement('style');
            style.setAttribute('data-aurora-animation', 'true');
            style.textContent = `
                @keyframes auroraWave {
                    0%, 100% { opacity: 0.3; transform: translateX(-100%); }
                    50% { opacity: 0.6; transform: translateX(100%); }
                }
            `;
            document.head.appendChild(style);
        }
    }

    // ─────────────────────────────────────────────────────────────
    // 5. SLOT PLAY SCREEN ENHANCEMENTS
    // ─────────────────────────────────────────────────────────────

    let slotParticleCanvas = null;
    let slotParticles = [];
    let slotAnimationId = null;

    function injectSlotThemeParticles(gameId) {
        if (_prefersReducedMotion) return;

        if (slotParticleCanvas) {
            slotParticleCanvas.remove();
            if (slotAnimationId) cancelAnimationFrame(slotAnimationId);
            slotAnimationId = null;
            slotParticles = [];
        }

        const modal = document.querySelector('.slot-modal, [data-modal="slot"], .game-modal');
        if (!modal) return;

        const canvas = document.createElement('canvas');
        canvas.className = 'slot-theme-particle-canvas';
        canvas.width = window.innerWidth;
        canvas.height = window.innerHeight;
        canvas.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            pointer-events: none;
            z-index: 5;
            opacity: 0.5;
        `;

        modal.insertBefore(canvas, modal.firstChild);
        slotParticleCanvas = canvas;

        const theme = getThemeCategory(gameId);
        const config = PARTICLE_CONFIGS[theme] || PARTICLE_CONFIGS.default;
        const ctx = canvas.getContext('2d');

        // Initialize particles based on theme
        const particleCount = theme === 'space' ? 50 : theme === 'candy' ? 80 : 40;
        for (let i = 0; i < particleCount; i++) {
            slotParticles.push({
                x: Math.random() * canvas.width,
                y: Math.random() * canvas.height,
                vx: (Math.random() - 0.5) * 1.5,
                vy: -Math.random() * config.speed - 0.2,
                radius: Math.random() * (config.size.max - config.size.min) + config.size.min,
                color: config.colors[Math.floor(Math.random() * config.colors.length)],
                life: Math.random() * 0.7 + 0.3,
                rotation: Math.random() * Math.PI * 2,
                rotationSpeed: (Math.random() - 0.5) * 0.1
            });
        }

        function animateSlotParticles() {
            // Stop loop if canvas was removed (modal closed) or tab hidden
            if (!slotParticleCanvas || !canvas.isConnected) {
                slotAnimationId = null;
                return;
            }
            if (document.hidden) {
                slotAnimationId = requestAnimationFrame(animateSlotParticles);
                return;
            }

            ctx.clearRect(0, 0, canvas.width, canvas.height);

            slotParticles.forEach((p, i) => {
                p.x += p.vx;
                p.y += p.vy;
                p.rotation += p.rotationSpeed;
                p.life -= 0.003;

                if (p.life <= 0 || p.y < -20) {
                    slotParticles[i] = {
                        x: Math.random() * canvas.width,
                        y: canvas.height + 20,
                        vx: (Math.random() - 0.5) * 1.5,
                        vy: -Math.random() * config.speed - 0.2,
                        radius: Math.random() * (config.size.max - config.size.min) + config.size.min,
                        color: config.colors[Math.floor(Math.random() * config.colors.length)],
                        life: 1,
                        rotation: Math.random() * Math.PI * 2,
                        rotationSpeed: (Math.random() - 0.5) * 0.1
                    };
                }

                ctx.globalAlpha = p.life;
                ctx.fillStyle = p.color;
                ctx.save();
                ctx.translate(p.x, p.y);
                ctx.rotate(p.rotation);
                ctx.beginPath();
                ctx.arc(0, 0, p.radius, 0, Math.PI * 2);
                ctx.fill();
                ctx.restore();
            });

            ctx.globalAlpha = 1;
            slotAnimationId = requestAnimationFrame(animateSlotParticles);
        }

        animateSlotParticles();
    }

    /** Clean up slot theme particles when the slot modal is closed/hidden */
    function destroySlotParticles() {
        if (slotParticleCanvas) {
            slotParticleCanvas.remove();
            slotParticleCanvas = null;
        }
        if (slotAnimationId) {
            cancelAnimationFrame(slotAnimationId);
            slotAnimationId = null;
        }
        slotParticles = [];
    }

    function setupSlotModalListener() {
        document.addEventListener('slotModalOpened', (e) => {
            const gameId = e.detail?.gameId || e.detail?.id;
            if (gameId) {
                // Destroy lobby particles while in-game to save resources
                destroyLobbyParticles();
                injectSlotThemeParticles(gameId);
            }
        });

        // Clean up slot particles when returning to lobby
        document.addEventListener('slotModalClosed', () => {
            destroySlotParticles();
            // Re-create lobby particles when returning to lobby
            createLobbyParticles();
        });

        // Fallback: observe modal visibility
        const observer = new MutationObserver((mutations) => {
            mutations.forEach((mutation) => {
                if (mutation.target.classList &&
                    (mutation.target.classList.contains('slot-modal') ||
                     mutation.target.classList.contains('game-modal') ||
                     mutation.target.dataset.modal === 'slot')) {

                    const isVisible = mutation.target.style.display !== 'none' && mutation.target.offsetParent !== null;
                    if (isVisible) {
                        const gameId = mutation.target.dataset.gameId || '';
                        if (gameId) {
                            destroyLobbyParticles();
                            injectSlotThemeParticles(gameId);
                        }
                    } else {
                        // Modal hidden — clean up slot particles
                        destroySlotParticles();
                        createLobbyParticles();
                    }
                }
            });
        });

        observer.observe(document.body, {
            subtree: true,
            attributes: true,
            attributeFilter: ['style', 'data-game-id'],
            childList: false
        });
    }

    // ─────────────────────────────────────────────────────────────
    // 6. ENHANCED WIN CELEBRATION
    // ─────────────────────────────────────────────────────────────

    function enhanceWinDisplay(winAmount, provider) {
        if (_prefersReducedMotion) return;
        const winDisplay = document.querySelector('.win-display, .win-popup, [data-win]');
        if (!winDisplay) return;

        // Provider-colored confetti
        confettiBurst(provider);

        // Screen-edge glow pulse
        createEdgeGlowPulse(provider);

        // Coin/gem shower for big wins
        if (winAmount > 1000) {
            createCoinShower();
        }
    }

    function confettiBurst(provider) {
        const confetti = [];
        const canvas = document.createElement('canvas');
        canvas.className = 'confetti-canvas';
        canvas.width = window.innerWidth;
        canvas.height = window.innerHeight;
        canvas.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            pointer-events: none;
            z-index: 100;
        `;
        document.body.appendChild(canvas);

        const ctx = canvas.getContext('2d');
        const providerColors = getProviderColors(provider);

        for (let i = 0; i < 80; i++) {
            confetti.push({
                x: Math.random() * canvas.width,
                y: -10,
                vx: (Math.random() - 0.5) * 12,
                vy: Math.random() * 8 + 4,
                rotation: Math.random() * Math.PI * 2,
                rotationSpeed: (Math.random() - 0.5) * 0.2,
                size: Math.random() * 6 + 3,
                color: providerColors[Math.floor(Math.random() * providerColors.length)],
                life: 1
            });
        }

        function animate() {
            // Stop if canvas was removed from DOM
            if (!canvas.isConnected) return;

            ctx.clearRect(0, 0, canvas.width, canvas.height);

            confetti.forEach((p) => {
                p.x += p.vx;
                p.y += p.vy;
                p.vy += 0.2; // gravity
                p.rotation += p.rotationSpeed;
                p.life -= 0.01;

                ctx.globalAlpha = p.life;
                ctx.fillStyle = p.color;
                ctx.save();
                ctx.translate(p.x, p.y);
                ctx.rotate(p.rotation);
                ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size);
                ctx.restore();
            });

            if (confetti.some(p => p.life > 0)) {
                requestAnimationFrame(animate);
            } else {
                canvas.remove();
            }
        }

        animate();
    }

    function getProviderColors(provider) {
        const colors = {
            novaspin: ['#00e5ff', '#7c4dff', '#448aff'],
            'mythic-forge': ['#ffd700', '#ff8f00', '#4fc3f7'],
            ironclad: ['#ff6d00', '#ffab00', '#26a69a'],
            'golden-reels': ['#ffab00', '#ffd54f', '#f06292'],
            vaultx: ['#00e676', '#69f0ae', '#ffd700'],
            solstice: ['#ff1744', '#ffd700', '#ff6d00'],
            'shadow-works': ['#aa00ff', '#ea80fc', '#d500f9'],
            'wild-frontier': ['#ff4081', '#536dfe', '#ffff00']
        };
        return colors[provider] || colors.ironclad;
    }

    function createEdgeGlowPulse(provider) {
        const colors = getProviderColors(provider);
        const primaryColor = colors[0];

        const glow = document.createElement('div');
        glow.className = 'edge-glow-pulse';
        glow.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            pointer-events: none;
            z-index: 50;
            box-shadow: inset 0 0 60px ${primaryColor};
            animation: edgeGlowPulse 1s ease-out;
        `;
        document.body.appendChild(glow);

        if (!document.querySelector('style[data-glow-animation]')) {
            const style = document.createElement('style');
            style.setAttribute('data-glow-animation', 'true');
            style.textContent = `
                @keyframes edgeGlowPulse {
                    0% { opacity: 1; }
                    100% { opacity: 0; }
                }
            `;
            document.head.appendChild(style);
        }

        setTimeout(() => glow.remove(), 1000);
    }

    function createCoinShower() {
        const coins = [];
        const canvas = document.createElement('canvas');
        canvas.className = 'coin-shower-canvas';
        canvas.width = window.innerWidth;
        canvas.height = window.innerHeight;
        canvas.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            pointer-events: none;
            z-index: 99;
        `;
        document.body.appendChild(canvas);

        const ctx = canvas.getContext('2d');
        const centerX = canvas.width / 2;

        for (let i = 0; i < 30; i++) {
            coins.push({
                x: centerX + (Math.random() - 0.5) * 400,
                y: canvas.height / 2,
                vx: (Math.random() - 0.5) * 8,
                vy: -Math.random() * 10 - 5,
                rotation: Math.random() * Math.PI * 2,
                rotationSpeed: (Math.random() - 0.5) * 0.3,
                radius: Math.random() * 8 + 4,
                life: 1
            });
        }

        function animate() {
            // Stop if canvas was removed from DOM
            if (!canvas.isConnected) return;

            ctx.clearRect(0, 0, canvas.width, canvas.height);

            coins.forEach((coin) => {
                coin.x += coin.vx;
                coin.y += coin.vy;
                coin.vy += 0.3; // gravity
                coin.rotation += coin.rotationSpeed;
                coin.life -= 0.01;

                ctx.globalAlpha = coin.life;
                ctx.save();
                ctx.translate(coin.x, coin.y);
                ctx.rotate(coin.rotation);
                ctx.fillStyle = '#ffd700';
                ctx.beginPath();
                ctx.arc(0, 0, coin.radius, 0, Math.PI * 2);
                ctx.fill();
                ctx.strokeStyle = '#ffed4e';
                ctx.lineWidth = 1;
                ctx.stroke();
                ctx.restore();
            });

            if (coins.some(c => c.life > 0)) {
                requestAnimationFrame(animate);
            } else {
                canvas.remove();
            }
        }

        animate();
    }

    // ─────────────────────────────────────────────────────────────
    // INITIALIZATION & OBSERVATION
    // ─────────────────────────────────────────────────────────────

    function processGameCard(card) {
        attachDataAttributes(card);
        addTiltEffect(card);
        addMicroAnimations(card);
    }

    function initializeVisualOverhaul() {
        // Process existing cards
        document.querySelectorAll('.game-card').forEach(processGameCard);

        // Create lobby particle system
        createLobbyParticles();

        // Setup slot modal listener
        setupSlotModalListener();

        // Setup MutationObserver for dynamically added cards
        const observer = new MutationObserver((mutations) => {
            mutations.forEach((mutation) => {
                mutation.addedNodes.forEach((node) => {
                    if (node.nodeType === 1) { // Element node
                        if (node.classList && node.classList.contains('game-card')) {
                            processGameCard(node);
                        } else if (node.querySelectorAll) {
                            node.querySelectorAll('.game-card').forEach(processGameCard);
                        }
                    }
                });
            });
        });

        observer.observe(document.body, {
            childList: true,
            subtree: true
        });

        // Listen for win events
        document.addEventListener('winCelebration', (e) => {
            const winAmount = e.detail?.amount || 0;
            const provider = e.detail?.provider || 'ironclad';
            enhanceWinDisplay(winAmount, provider);
        });
    }

    // Wait for DOM to be ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initializeVisualOverhaul);
    } else {
        initializeVisualOverhaul();
    }

    // Cleanup on page unload
    window.addEventListener('unload', () => {
        destroyLobbyParticles();
        destroySlotParticles();
    });

})();
