/**
 * ============================================================
 * Casino App — Canvas Particle Engine
 * ============================================================
 *
 * GPU-composited canvas overlay for provider-themed particle effects.
 * Supports burst (win celebration), ambient (idle background), and
 * win-scaled modes with object pooling for zero GC pressure.
 *
 * Loaded via <script> after constants.js and globals.js.
 * All exports are plain global functions (no ES modules).
 *
 * Constants referenced (from constants.js, with graceful fallbacks):
 *   PARTICLES_MAX_ULTRA (300), PARTICLES_MAX_HIGH (100),
 *   PARTICLES_MAX_MEDIUM (50), PARTICLES_MAX_LOW (0)
 *   AMBIENT_PARTICLES_ULTRA (5), AMBIENT_PARTICLES_HIGH (3),
 *   AMBIENT_PARTICLES_MEDIUM (0)
 *   QUALITY_ULTRA, QUALITY_HIGH, QUALITY_MEDIUM, QUALITY_LOW, QUALITY_OFF
 *   WIN_DRAMATIC_THRESHOLD (10), WIN_EPIC_THRESHOLD (25),
 *   WIN_MEGA_THRESHOLD (50), WIN_JACKPOT_THRESHOLD (100)
 */

// ─────────────────────────────────────────────────────────────
// Safe constant accessors (graceful if loaded out of order)
// ─────────────────────────────────────────────────────────────

var _PE_MAX_ULTRA   = (typeof PARTICLES_MAX_ULTRA   !== 'undefined') ? PARTICLES_MAX_ULTRA   : 300;
var _PE_MAX_HIGH    = (typeof PARTICLES_MAX_HIGH    !== 'undefined') ? PARTICLES_MAX_HIGH    : 100;
var _PE_MAX_MEDIUM  = (typeof PARTICLES_MAX_MEDIUM  !== 'undefined') ? PARTICLES_MAX_MEDIUM  : 50;
var _PE_MAX_LOW     = (typeof PARTICLES_MAX_LOW     !== 'undefined') ? PARTICLES_MAX_LOW     : 0;

var _PE_AMB_ULTRA   = (typeof AMBIENT_PARTICLES_ULTRA  !== 'undefined') ? AMBIENT_PARTICLES_ULTRA  : 5;
var _PE_AMB_HIGH    = (typeof AMBIENT_PARTICLES_HIGH   !== 'undefined') ? AMBIENT_PARTICLES_HIGH   : 3;
var _PE_AMB_MEDIUM  = (typeof AMBIENT_PARTICLES_MEDIUM !== 'undefined') ? AMBIENT_PARTICLES_MEDIUM : 0;

var _PE_Q_ULTRA     = (typeof QUALITY_ULTRA  !== 'undefined') ? QUALITY_ULTRA  : 'ultra';
var _PE_Q_HIGH      = (typeof QUALITY_HIGH   !== 'undefined') ? QUALITY_HIGH   : 'high';
var _PE_Q_MEDIUM    = (typeof QUALITY_MEDIUM !== 'undefined') ? QUALITY_MEDIUM : 'medium';
var _PE_Q_LOW       = (typeof QUALITY_LOW    !== 'undefined') ? QUALITY_LOW    : 'low';
var _PE_Q_OFF       = (typeof QUALITY_OFF    !== 'undefined') ? QUALITY_OFF    : 'off';

var _PE_WIN_DRAMATIC = (typeof WIN_DRAMATIC_THRESHOLD !== 'undefined') ? WIN_DRAMATIC_THRESHOLD : 10;
var _PE_WIN_EPIC     = (typeof WIN_EPIC_THRESHOLD     !== 'undefined') ? WIN_EPIC_THRESHOLD     : 25;
var _PE_WIN_MEGA     = (typeof WIN_MEGA_THRESHOLD     !== 'undefined') ? WIN_MEGA_THRESHOLD     : 50;
var _PE_WIN_JACKPOT  = (typeof WIN_JACKPOT_THRESHOLD  !== 'undefined') ? WIN_JACKPOT_THRESHOLD  : 100;


// ─────────────────────────────────────────────────────────────
// Particle type enum
// ─────────────────────────────────────────────────────────────

var PE_TYPE_POINT = 'point';
var PE_TYPE_TRAIL = 'trail';
var PE_TYPE_GLOW  = 'glow';


// ─────────────────────────────────────────────────────────────
// Provider-themed particle configurations
// ─────────────────────────────────────────────────────────────
// Each provider has:
//   colors    — array of hex colors for particles
//   types     — weighted particle types to choose from
//   gravity   — base gravity multiplier
//   drag      — velocity damping per frame
//   turbulence— amplitude of sine-wave sideways drift
//   sizeRange — [min, max] particle radius
//   speedRange— [min, max] initial velocity magnitude
//   lifeRange — [min, max] lifetime in seconds
//   glowSize  — additive glow circle radius multiplier
//   ambient   — config overrides for ambient mode particles

var PROVIDER_PARTICLE_CONFIGS = {
    // NovaSpin — Electric sparks, blue lightning arcs
    novaspin: {
        colors: ['#00e5ff', '#40c4ff', '#80d8ff', '#00b8d4', '#ffffff'],
        types: [PE_TYPE_TRAIL, PE_TYPE_TRAIL, PE_TYPE_GLOW, PE_TYPE_POINT],
        gravity: 0.5,
        drag: 0.96,
        turbulence: 3.0,
        sizeRange: [1.5, 4],
        speedRange: [120, 320],
        lifeRange: [0.4, 1.2],
        glowSize: 2.5,
        ambient: {
            types: [PE_TYPE_TRAIL],
            gravity: 0.1,
            turbulence: 5.0,
            speedRange: [15, 40],
            lifeRange: [2.0, 4.0],
            sizeRange: [1, 2.5]
        }
    },

    // Celestial — Golden falling feathers, divine rays
    'mythic-forge': {
        colors: ['#ffd700', '#ffec8b', '#fff8dc', '#daa520', '#fffacd'],
        types: [PE_TYPE_GLOW, PE_TYPE_GLOW, PE_TYPE_TRAIL, PE_TYPE_POINT],
        gravity: 0.8,
        drag: 0.94,
        turbulence: 2.0,
        sizeRange: [2, 6],
        speedRange: [80, 250],
        lifeRange: [0.6, 1.8],
        glowSize: 3.0,
        ambient: {
            types: [PE_TYPE_GLOW],
            gravity: 0.3,
            turbulence: 1.5,
            speedRange: [8, 25],
            lifeRange: [3.0, 5.0],
            sizeRange: [2, 5]
        }
    },

    // Ironclad — Metal sparks, grinding embers
    ironclad: {
        colors: ['#cd853f', '#d2691e', '#ff8c00', '#ffa500', '#ffe4b5'],
        types: [PE_TYPE_POINT, PE_TYPE_POINT, PE_TYPE_TRAIL, PE_TYPE_GLOW],
        gravity: 2.5,
        drag: 0.92,
        turbulence: 0.8,
        sizeRange: [1, 3],
        speedRange: [150, 400],
        lifeRange: [0.3, 0.9],
        glowSize: 1.8,
        ambient: {
            types: [PE_TYPE_POINT],
            gravity: 1.5,
            turbulence: 0.5,
            speedRange: [20, 50],
            lifeRange: [1.5, 3.0],
            sizeRange: [1, 2]
        }
    },

    // Golden Reels — Liquid gold droplets, coin shower
    'golden-reels': {
        colors: ['#ffb74d', '#ffd54f', '#ffe082', '#ffcc02', '#ffffff'],
        types: [PE_TYPE_GLOW, PE_TYPE_POINT, PE_TYPE_GLOW, PE_TYPE_TRAIL],
        gravity: 1.8,
        drag: 0.93,
        turbulence: 1.2,
        sizeRange: [2, 5],
        speedRange: [100, 300],
        lifeRange: [0.5, 1.5],
        glowSize: 2.8,
        ambient: {
            types: [PE_TYPE_GLOW],
            gravity: 0.6,
            turbulence: 1.0,
            speedRange: [10, 30],
            lifeRange: [2.5, 4.5],
            sizeRange: [1.5, 4]
        }
    },

    // VaultX — Green matrix-style data rain
    vaultx: {
        colors: ['#00ff41', '#00cc33', '#33ff77', '#00ff88', '#aaffcc'],
        types: [PE_TYPE_TRAIL, PE_TYPE_TRAIL, PE_TYPE_POINT, PE_TYPE_GLOW],
        gravity: 1.2,
        drag: 0.97,
        turbulence: 0.4,
        sizeRange: [1, 3],
        speedRange: [80, 280],
        lifeRange: [0.5, 1.6],
        glowSize: 2.0,
        ambient: {
            types: [PE_TYPE_TRAIL],
            gravity: 1.0,
            turbulence: 0.2,
            speedRange: [30, 60],
            lifeRange: [2.0, 4.0],
            sizeRange: [0.8, 2]
        }
    },

    // Solstice — Aurora wisps, crystalline shards
    solstice: {
        colors: ['#dc2626', '#ffd700', '#ff4444', '#ffaa00', '#ff6b6b'],
        types: [PE_TYPE_GLOW, PE_TYPE_TRAIL, PE_TYPE_GLOW, PE_TYPE_POINT],
        gravity: 0.6,
        drag: 0.95,
        turbulence: 2.8,
        sizeRange: [1.5, 5],
        speedRange: [90, 260],
        lifeRange: [0.5, 1.4],
        glowSize: 3.2,
        ambient: {
            types: [PE_TYPE_GLOW, PE_TYPE_TRAIL],
            gravity: 0.2,
            turbulence: 3.5,
            speedRange: [10, 35],
            lifeRange: [3.0, 5.5],
            sizeRange: [2, 4.5]
        }
    },

    // Shadow Works — Purple mist, ghostly tendrils
    'shadow-works': {
        colors: ['#8000ff', '#a855f7', '#c084fc', '#9333ea', '#e9d5ff'],
        types: [PE_TYPE_GLOW, PE_TYPE_GLOW, PE_TYPE_TRAIL, PE_TYPE_POINT],
        gravity: 0.3,
        drag: 0.98,
        turbulence: 3.5,
        sizeRange: [2, 6],
        speedRange: [60, 200],
        lifeRange: [0.8, 2.2],
        glowSize: 3.5,
        ambient: {
            types: [PE_TYPE_GLOW],
            gravity: -0.1, // floats upward slightly
            turbulence: 4.0,
            speedRange: [5, 20],
            lifeRange: [3.5, 6.0],
            sizeRange: [2.5, 5]
        }
    },

    // Wild Frontier — Pixel explosions, retro confetti
    'wild-frontier': {
        colors: ['#00ffff', '#ff00ff', '#ffff00', '#00ff00', '#ff4444'],
        types: [PE_TYPE_POINT, PE_TYPE_POINT, PE_TYPE_GLOW, PE_TYPE_TRAIL],
        gravity: 1.6,
        drag: 0.91,
        turbulence: 1.0,
        sizeRange: [2, 4],
        speedRange: [140, 380],
        lifeRange: [0.4, 1.0],
        glowSize: 1.5,
        ambient: {
            types: [PE_TYPE_POINT],
            gravity: 0.8,
            turbulence: 0.8,
            speedRange: [15, 40],
            lifeRange: [1.5, 3.0],
            sizeRange: [1.5, 3]
        }
    }
};

// ── Aliases: map new studio theme keys to closest particle configs ──
PROVIDER_PARTICLE_CONFIGS.goldenreels  = PROVIDER_PARTICLE_CONFIGS['golden-reels'];
PROVIDER_PARTICLE_CONFIGS.nebula       = PROVIDER_PARTICLE_CONFIGS['mythic-forge'];
PROVIDER_PARTICLE_CONFIGS.mythicforge  = PROVIDER_PARTICLE_CONFIGS.solstice;
PROVIDER_PARTICLE_CONFIGS.wildfrontier = PROVIDER_PARTICLE_CONFIGS['golden-reels'];
PROVIDER_PARTICLE_CONFIGS.shadowworks  = PROVIDER_PARTICLE_CONFIGS['shadow-works'];
PROVIDER_PARTICLE_CONFIGS.dragonpearl  = PROVIDER_PARTICLE_CONFIGS.vaultx;
PROVIDER_PARTICLE_CONFIGS.ironclad     = PROVIDER_PARTICLE_CONFIGS.ironclad;
PROVIDER_PARTICLE_CONFIGS.cascadelabs  = PROVIDER_PARTICLE_CONFIGS.novaspin;


// ─────────────────────────────────────────────────────────────
// ParticleEngine class
// ─────────────────────────────────────────────────────────────

/**
 * Core particle engine with canvas overlay, object pooling,
 * auto-pause, and quality-tier awareness.
 *
 * @constructor
 */
function ParticleEngine() {
    // Canvas and rendering context
    this.canvas = null;
    this.ctx = null;
    this.container = null;

    // Dimensions (kept in sync with container via ResizeObserver)
    this.width = 0;
    this.height = 0;
    this.dpr = window.devicePixelRatio || 1;

    // Object pool — pre-allocated particle array
    this.pool = [];
    this.poolSize = 0;
    this.activeCount = 0;

    // Animation loop control
    this.rafId = null;
    this.running = false;
    this.lastTime = 0;

    // Ambient state
    this.ambientActive = false;
    this.ambientProvider = null;
    this.ambientTimer = 0;         // seconds until next ambient spawn
    this.ambientSpawnInterval = 1.5; // seconds between ambient spawns

    // Resize observer for responsive canvas
    this._resizeObserver = null;

    // Trail history buffer (shared across trail-type particles)
    // Each trail particle stores up to TRAIL_MAX_LENGTH positions
    this._trailMaxLength = 8;
}


// ─────────────────────────────────────────────────────────────
// Quality-tier helpers
// ─────────────────────────────────────────────────────────────

/**
 * Returns the current animation quality setting.
 * @returns {string} One of 'ultra', 'high', 'medium', 'low', 'off'
 */
ParticleEngine.prototype._getQuality = function () {
    if (window.appSettings && window.appSettings.animationQuality) {
        return window.appSettings.animationQuality;
    }
    return _PE_Q_ULTRA; // default to full quality
};

/**
 * Returns the maximum particle budget for the current quality tier.
 * @returns {number}
 */
ParticleEngine.prototype._getMaxParticles = function () {
    var q = this._getQuality();
    if (q === _PE_Q_ULTRA)  return _PE_MAX_ULTRA;
    if (q === _PE_Q_HIGH)   return _PE_MAX_HIGH;
    if (q === _PE_Q_MEDIUM) return _PE_MAX_MEDIUM;
    return _PE_MAX_LOW; // 'low' or 'off'
};

/**
 * Returns the ambient particle count for the current quality tier.
 * @returns {number}
 */
ParticleEngine.prototype._getAmbientCount = function () {
    var q = this._getQuality();
    if (q === _PE_Q_ULTRA)  return _PE_AMB_ULTRA;
    if (q === _PE_Q_HIGH)   return _PE_AMB_HIGH;
    if (q === _PE_Q_MEDIUM) return _PE_AMB_MEDIUM;
    return 0;
};

/**
 * Returns true if particles are completely disabled.
 * @returns {boolean}
 */
ParticleEngine.prototype._isDisabled = function () {
    var q = this._getQuality();
    return (q === _PE_Q_LOW || q === _PE_Q_OFF);
};


// ─────────────────────────────────────────────────────────────
// Initialization and canvas setup
// ─────────────────────────────────────────────────────────────

/**
 * Create canvas element, attach to DOM, pre-allocate particle pool.
 * @param {string} containerSelector  CSS selector for the overlay container
 */
ParticleEngine.prototype.init = function (containerSelector) {
    this.container = document.querySelector(containerSelector);
    if (!this.container) {
        console.warn('[ParticleEngine] Container not found: ' + containerSelector);
        return;
    }

    // Create the canvas element
    this.canvas = document.createElement('canvas');
    this.canvas.style.cssText =
        'position:absolute;top:0;left:0;width:100%;height:100%;' +
        'pointer-events:none;z-index:10;will-change:transform;';
    this.canvas.setAttribute('aria-hidden', 'true');
    this.container.appendChild(this.canvas);

    this.ctx = this.canvas.getContext('2d');

    // Initial sizing
    this._syncSize();

    // Pre-allocate particle pool at the max budget (ultra tier)
    this._ensurePoolCapacity(_PE_MAX_ULTRA);

    // Watch for container resizes
    if (typeof ResizeObserver !== 'undefined') {
        var self = this;
        this._resizeObserver = new ResizeObserver(function () {
            self._syncSize();
        });
        this._resizeObserver.observe(this.container);
    }
};

/**
 * Sync canvas pixel dimensions with its container.
 * Accounts for devicePixelRatio for crisp rendering on HiDPI screens.
 */
ParticleEngine.prototype._syncSize = function () {
    if (!this.container || !this.canvas) return;

    var rect = this.container.getBoundingClientRect();
    this.width = rect.width;
    this.height = rect.height;
    this.dpr = window.devicePixelRatio || 1;

    // Set the canvas buffer size for crisp rendering
    this.canvas.width = Math.round(this.width * this.dpr);
    this.canvas.height = Math.round(this.height * this.dpr);
};


// ─────────────────────────────────────────────────────────────
// Object pool management
// ─────────────────────────────────────────────────────────────

/**
 * Ensure the pool has at least `capacity` particle objects.
 * New particles are created in an inactive state.
 * @param {number} capacity
 */
ParticleEngine.prototype._ensurePoolCapacity = function (capacity) {
    while (this.pool.length < capacity) {
        this.pool.push(this._createParticleObject());
    }
    this.poolSize = this.pool.length;
};

/**
 * Create a single blank particle object with all fields initialized.
 * @returns {object}
 */
ParticleEngine.prototype._createParticleObject = function () {
    return {
        active: false,
        x: 0,
        y: 0,
        vx: 0,
        vy: 0,
        life: 0,
        maxLife: 0,
        size: 0,
        color: '#ffffff',
        colorR: 255,
        colorG: 255,
        colorB: 255,
        type: PE_TYPE_POINT,
        alpha: 1,
        gravity: 0,
        drag: 0.95,
        turbulence: 0,
        turbulencePhase: 0,
        glowSize: 2,
        // Trail history (only used for PE_TYPE_TRAIL)
        trail: null,
        trailIdx: 0
    };
};

/**
 * Acquire an inactive particle from the pool.
 * Returns null if pool is exhausted or budget exceeded.
 * @returns {object|null}
 */
ParticleEngine.prototype._acquireParticle = function () {
    var max = this._getMaxParticles();
    if (this.activeCount >= max) return null;

    for (var i = 0; i < this.poolSize; i++) {
        if (!this.pool[i].active) {
            return this.pool[i];
        }
    }

    // Pool exhausted — try to grow if under budget
    if (this.poolSize < max) {
        this._ensurePoolCapacity(Math.min(max, this.poolSize + 50));
        // Return the first newly created particle
        for (var j = this.activeCount; j < this.poolSize; j++) {
            if (!this.pool[j].active) {
                return this.pool[j];
            }
        }
    }

    return null;
};


// ─────────────────────────────────────────────────────────────
// Particle spawning
// ─────────────────────────────────────────────────────────────

/**
 * Parse a hex color string to RGB components.
 * @param {string} hex
 * @returns {{r: number, g: number, b: number}}
 */
ParticleEngine.prototype._hexToRgb = function (hex) {
    var clean = String(hex || '#ffffff').replace('#', '');
    if (clean.length !== 6) return { r: 255, g: 255, b: 255 };
    return {
        r: parseInt(clean.slice(0, 2), 16) || 0,
        g: parseInt(clean.slice(2, 4), 16) || 0,
        b: parseInt(clean.slice(4, 6), 16) || 0
    };
};

/**
 * Resolve the provider config. Falls back to a neutral gold theme.
 * @param {string} providerKey
 * @returns {object}
 */
ParticleEngine.prototype._getConfig = function (providerKey) {
    return PROVIDER_PARTICLE_CONFIGS[providerKey] || PROVIDER_PARTICLE_CONFIGS.mythic-forge;
};

/**
 * Random float in [min, max].
 * @param {number} min
 * @param {number} max
 * @returns {number}
 */
ParticleEngine.prototype._rand = function (min, max) {
    return min + Math.random() * (max - min);
};

/**
 * Pick a random element from an array.
 * @param {Array} arr
 * @returns {*}
 */
ParticleEngine.prototype._pick = function (arr) {
    return arr[Math.floor(Math.random() * arr.length)];
};

/**
 * Spawn a single particle at (x, y) with the given provider config.
 * Coordinates are in CSS pixels relative to the container.
 *
 * @param {number} x         Horizontal position (px)
 * @param {number} y         Vertical position (px)
 * @param {object} cfg       Provider particle config
 * @param {boolean} isAmbient  If true, use ambient overrides
 */
ParticleEngine.prototype._spawnOne = function (x, y, cfg, isAmbient) {
    var p = this._acquireParticle();
    if (!p) return;

    var ambCfg = isAmbient ? (cfg.ambient || {}) : {};
    var types = ambCfg.types || cfg.types;
    var sizeRange = ambCfg.sizeRange || cfg.sizeRange;
    var speedRange = ambCfg.speedRange || cfg.speedRange;
    var lifeRange = ambCfg.lifeRange || cfg.lifeRange;
    var grav = (ambCfg.gravity !== undefined) ? ambCfg.gravity : cfg.gravity;
    var turb = (ambCfg.turbulence !== undefined) ? ambCfg.turbulence : cfg.turbulence;

    var color = this._pick(cfg.colors);
    var rgb = this._hexToRgb(color);
    var angle = Math.random() * Math.PI * 2;
    var speed = this._rand(speedRange[0], speedRange[1]);

    p.active = true;
    p.x = x;
    p.y = y;
    p.vx = Math.cos(angle) * speed;
    p.vy = Math.sin(angle) * speed;
    p.life = this._rand(lifeRange[0], lifeRange[1]);
    p.maxLife = p.life;
    p.size = this._rand(sizeRange[0], sizeRange[1]);
    p.color = color;
    p.colorR = rgb.r;
    p.colorG = rgb.g;
    p.colorB = rgb.b;
    p.type = this._pick(types);
    p.alpha = 1;
    p.gravity = grav;
    p.drag = cfg.drag;
    p.turbulence = turb;
    p.turbulencePhase = Math.random() * Math.PI * 2;
    p.glowSize = cfg.glowSize || 2;

    // Initialize trail buffer for trail-type particles
    if (p.type === PE_TYPE_TRAIL) {
        if (!p.trail || p.trail.length < this._trailMaxLength) {
            p.trail = new Array(this._trailMaxLength);
            for (var i = 0; i < this._trailMaxLength; i++) {
                p.trail[i] = { x: x, y: y };
            }
        } else {
            for (var j = 0; j < this._trailMaxLength; j++) {
                p.trail[j].x = x;
                p.trail[j].y = y;
            }
        }
        p.trailIdx = 0;
    }

    this.activeCount++;
};


// ─────────────────────────────────────────────────────────────
// Burst spawning (win celebrations)
// ─────────────────────────────────────────────────────────────

/**
 * Emit a burst of particles at (x, y).
 *
 * @param {number} x            Container-relative X (CSS px)
 * @param {number} y            Container-relative Y (CSS px)
 * @param {number} count        Number of particles to emit
 * @param {string} providerKey  Provider theme key
 */
ParticleEngine.prototype.burst = function (x, y, count, providerKey) {
    if (this._isDisabled()) return;

    var cfg = this._getConfig(providerKey);
    var max = this._getMaxParticles();
    var toSpawn = Math.min(count, max - this.activeCount);

    for (var i = 0; i < toSpawn; i++) {
        // Slight position jitter for natural spread
        var jx = x + this._rand(-8, 8);
        var jy = y + this._rand(-8, 8);
        this._spawnOne(jx, jy, cfg, false);
    }

    this._ensureRunning();
};


// ─────────────────────────────────────────────────────────────
// Win-scaled burst
// ─────────────────────────────────────────────────────────────

/**
 * Emit a burst scaled by win multiplier.
 * Small wins get a modest burst; jackpots get the full fireworks.
 *
 * @param {number} x              Container-relative X (CSS px)
 * @param {number} y              Container-relative Y (CSS px)
 * @param {number} winMultiplier  Win amount / bet ratio
 * @param {string} providerKey    Provider theme key
 */
ParticleEngine.prototype.winBurst = function (x, y, winMultiplier, providerKey) {
    if (this._isDisabled()) return;

    var count;
    if (winMultiplier >= _PE_WIN_JACKPOT) {
        // Jackpot: massive explosion
        count = Math.min(200, this._getMaxParticles());
    } else if (winMultiplier >= _PE_WIN_MEGA) {
        count = Math.min(120, this._getMaxParticles());
    } else if (winMultiplier >= _PE_WIN_EPIC) {
        count = Math.min(80, this._getMaxParticles());
    } else if (winMultiplier >= _PE_WIN_DRAMATIC) {
        count = Math.min(50, this._getMaxParticles());
    } else if (winMultiplier >= 3) {
        count = Math.min(25, this._getMaxParticles());
    } else {
        count = Math.min(12, this._getMaxParticles());
    }

    this.burst(x, y, count, providerKey);
};


// ─────────────────────────────────────────────────────────────
// Ambient mode
// ─────────────────────────────────────────────────────────────

/**
 * Start subtle always-on background particles for the given provider.
 * Spawns 3-5 particles at random positions on a gentle timer.
 *
 * @param {string} providerKey  Provider theme key
 */
ParticleEngine.prototype.startAmbient = function (providerKey) {
    this.ambientActive = true;
    this.ambientProvider = providerKey;
    this.ambientTimer = 0; // spawn immediately on next tick
    this._ensureRunning();
};

/**
 * Stop ambient particle spawning. Existing particles fade out naturally.
 */
ParticleEngine.prototype.stopAmbient = function () {
    this.ambientActive = false;
    this.ambientProvider = null;
};

/**
 * Internal: spawn ambient particles if the timer has elapsed.
 * @param {number} dt  Delta time in seconds
 */
ParticleEngine.prototype._tickAmbient = function (dt) {
    if (!this.ambientActive || !this.ambientProvider) return;

    var maxAmbient = this._getAmbientCount();
    if (maxAmbient <= 0) return;

    this.ambientTimer -= dt;
    if (this.ambientTimer > 0) return;

    // Reset timer with slight randomness
    this.ambientTimer = this.ambientSpawnInterval + this._rand(-0.3, 0.3);

    var cfg = this._getConfig(this.ambientProvider);

    // Count current ambient-ish particles (approximate via low speed)
    // Simply spawn up to the ambient count limit in random positions
    for (var i = 0; i < maxAmbient; i++) {
        var ax = this._rand(this.width * 0.1, this.width * 0.9);
        var ay = this._rand(this.height * 0.1, this.height * 0.9);
        this._spawnOne(ax, ay, cfg, true);
    }
};


// ─────────────────────────────────────────────────────────────
// Physics update
// ─────────────────────────────────────────────────────────────

/**
 * Update all active particles by one time step.
 * @param {number} dt  Delta time in seconds
 */
ParticleEngine.prototype._update = function (dt) {
    // Clamp dt to prevent spiral of death on tab switch
    if (dt > 0.1) dt = 0.1;

    this.activeCount = 0;
    var gravity_px = 100; // base gravity in px/s^2

    for (var i = 0; i < this.poolSize; i++) {
        var p = this.pool[i];
        if (!p.active) continue;

        // Age the particle
        p.life -= dt;
        if (p.life <= 0) {
            p.active = false;
            continue;
        }

        this.activeCount++;

        // Compute normalized age (0 = born, 1 = dead)
        var age = 1 - (p.life / p.maxLife);

        // Alpha fade-out in the last 30% of life
        if (age > 0.7) {
            p.alpha = (1 - age) / 0.3;
        } else {
            p.alpha = 1;
        }

        // Apply gravity (positive = downward)
        p.vy += p.gravity * gravity_px * dt;

        // Apply turbulence (sideways sine drift)
        if (p.turbulence > 0) {
            var turbForce = Math.sin(p.turbulencePhase + p.life * 6) * p.turbulence * 30 * dt;
            p.vx += turbForce;
        }

        // Apply drag
        var dragFactor = Math.pow(p.drag, dt * 60); // normalize to ~60fps
        p.vx *= dragFactor;
        p.vy *= dragFactor;

        // Update position
        p.x += p.vx * dt;
        p.y += p.vy * dt;

        // Update trail history for trail-type particles
        if (p.type === PE_TYPE_TRAIL && p.trail) {
            // Shift trail positions: move every entry one slot forward,
            // oldest at index 0, newest at the end
            p.trailIdx = (p.trailIdx + 1) % this._trailMaxLength;
            p.trail[p.trailIdx].x = p.x;
            p.trail[p.trailIdx].y = p.y;
        }
    }
};


// ─────────────────────────────────────────────────────────────
// Rendering
// ─────────────────────────────────────────────────────────────

/**
 * Clear the canvas and render all active particles.
 */
ParticleEngine.prototype._render = function () {
    var ctx = this.ctx;
    var dpr = this.dpr;

    // Clear the full canvas buffer
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

    // Scale context for HiDPI
    ctx.save();
    ctx.scale(dpr, dpr);

    for (var i = 0; i < this.poolSize; i++) {
        var p = this.pool[i];
        if (!p.active) continue;

        var alpha = Math.max(0, Math.min(1, p.alpha));
        if (alpha < 0.01) continue;

        if (p.type === PE_TYPE_GLOW) {
            this._renderGlow(ctx, p, alpha);
        } else if (p.type === PE_TYPE_TRAIL) {
            this._renderTrail(ctx, p, alpha);
        } else {
            this._renderPoint(ctx, p, alpha);
        }
    }

    ctx.restore();
};

/**
 * Render a simple point particle (filled circle).
 */
ParticleEngine.prototype._renderPoint = function (ctx, p, alpha) {
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = alpha;
    ctx.fillStyle = p.color;
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
};

/**
 * Render a glow particle (additive blending, radial gradient circle).
 */
ParticleEngine.prototype._renderGlow = function (ctx, p, alpha) {
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = alpha;

    var r = p.size * p.glowSize;
    var gradient = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, r);
    gradient.addColorStop(0, 'rgba(' + p.colorR + ',' + p.colorG + ',' + p.colorB + ',0.8)');
    gradient.addColorStop(0.4, 'rgba(' + p.colorR + ',' + p.colorG + ',' + p.colorB + ',0.3)');
    gradient.addColorStop(1, 'rgba(' + p.colorR + ',' + p.colorG + ',' + p.colorB + ',0)');

    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
};

/**
 * Render a trail particle (fading polyline of historical positions).
 */
ParticleEngine.prototype._renderTrail = function (ctx, p, alpha) {
    if (!p.trail) {
        // Fallback: render as a point
        this._renderPoint(ctx, p, alpha);
        return;
    }

    ctx.globalCompositeOperation = 'lighter';

    var len = this._trailMaxLength;
    var idx = p.trailIdx;

    // Draw the trail segments from oldest to newest
    ctx.lineWidth = p.size;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    for (var s = 0; s < len - 1; s++) {
        var fromIdx = (idx + 1 + s) % len;  // oldest first
        var toIdx = (idx + 2 + s) % len;

        var segAlpha = alpha * (s / (len - 1)) * 0.8;
        if (segAlpha < 0.01) continue;

        ctx.globalAlpha = segAlpha;
        ctx.strokeStyle = p.color;
        ctx.beginPath();
        ctx.moveTo(p.trail[fromIdx].x, p.trail[fromIdx].y);
        ctx.lineTo(p.trail[toIdx].x, p.trail[toIdx].y);
        ctx.stroke();
    }

    // Draw the head as a bright point
    ctx.globalAlpha = alpha;
    ctx.fillStyle = p.color;
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.size * 1.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
};


// ─────────────────────────────────────────────────────────────
// Animation loop (auto-pause when idle)
// ─────────────────────────────────────────────────────────────

/**
 * Ensure the render loop is running.
 */
ParticleEngine.prototype._ensureRunning = function () {
    if (this.running) return;
    this.running = true;
    this.lastTime = performance.now();
    var self = this;
    this.rafId = requestAnimationFrame(function (t) { self._loop(t); });
};

/**
 * Main requestAnimationFrame loop.
 * Auto-pauses when no particles are active and ambient is off.
 * @param {number} timestamp
 */
ParticleEngine.prototype._loop = function (timestamp) {
    if (!this.running) return;

    var dt = (timestamp - this.lastTime) / 1000;
    this.lastTime = timestamp;

    // Handle ambient spawning
    this._tickAmbient(dt);

    // Update physics
    this._update(dt);

    // Render
    this._render();

    // Auto-pause: stop the loop if nothing is alive and ambient is off
    if (this.activeCount === 0 && !this.ambientActive) {
        this.running = false;
        this.rafId = null;
        return;
    }

    // Continue loop
    var self = this;
    this.rafId = requestAnimationFrame(function (t) { self._loop(t); });
};


// ─────────────────────────────────────────────────────────────
// Cleanup
// ─────────────────────────────────────────────────────────────

/**
 * Destroy the engine: remove canvas, stop loop, disconnect observer.
 */
ParticleEngine.prototype.destroy = function () {
    // Stop animation loop
    this.running = false;
    if (this.rafId) {
        cancelAnimationFrame(this.rafId);
        this.rafId = null;
    }

    // Stop ambient
    this.ambientActive = false;
    this.ambientProvider = null;

    // Disconnect resize observer
    if (this._resizeObserver) {
        this._resizeObserver.disconnect();
        this._resizeObserver = null;
    }

    // Remove canvas from DOM
    if (this.canvas && this.canvas.parentNode) {
        this.canvas.parentNode.removeChild(this.canvas);
    }
    this.canvas = null;
    this.ctx = null;
    this.container = null;

    // Clear pool references
    this.pool = [];
    this.poolSize = 0;
    this.activeCount = 0;
};


// ─────────────────────────────────────────────────────────────
// Singleton instance
// ─────────────────────────────────────────────────────────────

/** @type {ParticleEngine|null} */
var _particleEngineInstance = null;


// ─────────────────────────────────────────────────────────────
// Global API functions
// ─────────────────────────────────────────────────────────────

/**
 * Initialize the particle engine and attach a canvas overlay to the
 * container matched by the given CSS selector.
 *
 * Safe to call multiple times — re-initializes if the container changes.
 *
 * @param {string} containerSelector  CSS selector for the overlay container
 */
function initParticleEngine(containerSelector) {
    // Tear down any existing instance
    if (_particleEngineInstance) {
        _particleEngineInstance.destroy();
        _particleEngineInstance = null;
    }

    _particleEngineInstance = new ParticleEngine();
    _particleEngineInstance.init(containerSelector);
}

/**
 * Emit a burst of particles at the given position.
 *
 * @param {number} x            X position in CSS px relative to the container
 * @param {number} y            Y position in CSS px relative to the container
 * @param {number} count        Number of particles to emit
 * @param {string} providerKey  Provider theme key (e.g. 'novaspin', 'mythic-forge')
 */
function burstParticles(x, y, count, providerKey) {
    if (!_particleEngineInstance) return;
    _particleEngineInstance.burst(x, y, count, providerKey);
}

/**
 * Start ambient (idle, always-on) background particles for a provider theme.
 * Call when a slot game opens.
 *
 * @param {string} providerKey  Provider theme key
 */
function startAmbientParticles(providerKey) {
    if (!_particleEngineInstance) return;
    _particleEngineInstance.startAmbient(providerKey);
}

/**
 * Stop ambient background particles. Call when leaving a slot game.
 * Existing particles fade out naturally.
 */
function stopAmbientParticles() {
    if (!_particleEngineInstance) return;
    _particleEngineInstance.stopAmbient();
}

/**
 * Emit a win-celebration burst scaled automatically by the win multiplier.
 * Small wins get a modest effect; jackpots trigger a massive explosion.
 *
 * @param {number} x              X position in CSS px relative to the container
 * @param {number} y              Y position in CSS px relative to the container
 * @param {number} winMultiplier  Win amount divided by bet (e.g. 50 for 50x)
 * @param {string} providerKey    Provider theme key
 */
function triggerWinParticles(x, y, winMultiplier, providerKey) {
    if (!_particleEngineInstance) return;
    _particleEngineInstance.winBurst(x, y, winMultiplier, providerKey);
}

/**
 * Tear down the particle engine, remove its canvas, and release resources.
 * Safe to call even if the engine was never initialized.
 */
function destroyParticleEngine() {
    if (!_particleEngineInstance) return;
    _particleEngineInstance.destroy();
    _particleEngineInstance = null;
}
