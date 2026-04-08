/**
 * Slot Background Canvas - Animated ambient backgrounds
 * Industry-standard parallax particles, light rays, floating elements
 */
(function() {
  'use strict';

  var _canvas = null;
  var _ctx = null;
  var _raf = null;
  var _particles = [];
  var _lightRays = [];
  var _floaters = [];
  var _time = 0;
  var _theme = null;
  var _isActive = false;
  var _width = 0;
  var _height = 0;

  // Theme configs per chrome style
  var THEMES = {
    candy:    { particles: '#FF69B4', rays: 'rgba(255,182,193,0.08)', floatEmoji: ['🍬','🍭','🧁','⭐'], bgGlow: 'rgba(255,105,180,0.06)' },
    olympus:  { particles: '#FFD700', rays: 'rgba(255,215,0,0.06)', floatEmoji: ['⚡','🏛️','🌟','👑'], bgGlow: 'rgba(255,215,0,0.05)' },
    wild:     { particles: '#8B4513', rays: 'rgba(139,69,19,0.06)', floatEmoji: ['🍃','🌿','🦁','💎'], bgGlow: 'rgba(34,139,34,0.04)' },
    egyptian: { particles: '#FFD700', rays: 'rgba(255,215,0,0.07)', floatEmoji: ['🏺','👁️','🐍','💎'], bgGlow: 'rgba(218,165,32,0.05)' },
    neon:     { particles: '#00FFFF', rays: 'rgba(0,255,255,0.06)', floatEmoji: ['💠','🔷','⚡','✨'], bgGlow: 'rgba(0,255,255,0.04)' },
    western:  { particles: '#CD853F', rays: 'rgba(205,133,63,0.06)', floatEmoji: ['🌵','⭐','🤠','💰'], bgGlow: 'rgba(139,90,43,0.04)' },
    oriental: { particles: '#FF4500', rays: 'rgba(255,0,0,0.05)', floatEmoji: ['🏮','🐉','🎋','💎'], bgGlow: 'rgba(255,0,0,0.04)' },
    joker:    { particles: '#C0C0C0', rays: 'rgba(192,192,192,0.06)', floatEmoji: ['🃏','💎','7️⃣','🎰'], bgGlow: 'rgba(255,215,0,0.04)' },
    dark:     { particles: '#8B008B', rays: 'rgba(139,0,139,0.06)', floatEmoji: ['🦇','💀','🌙','💎'], bgGlow: 'rgba(75,0,130,0.05)' },
    fishing:  { particles: '#20B2AA', rays: 'rgba(32,178,170,0.06)', floatEmoji: ['🐟','🫧','🌊','💎'], bgGlow: 'rgba(0,128,128,0.04)' },
    _default: { particles: '#FFD700', rays: 'rgba(255,215,0,0.05)', floatEmoji: ['✨','💎','⭐','🌟'], bgGlow: 'rgba(255,215,0,0.04)' }
  };

  function hexToRgb(hex) {
    var r = parseInt(hex.slice(1,3),16), g = parseInt(hex.slice(3,5),16), b = parseInt(hex.slice(5,7),16);
    return {r:r, g:g, b:b};
  }

  function rand(min, max) { return Math.random() * (max - min) + min; }

  // --- Ambient Particles (dust motes, sparkles) ---
  function spawnParticle() {
    var rgb = hexToRgb(_theme.particles);
    _particles.push({
      x: rand(0, _width),
      y: rand(0, _height),
      vx: rand(-0.3, 0.3),
      vy: rand(-0.5, -0.1),
      size: rand(1, 3.5),
      alpha: rand(0.2, 0.6),
      alphaDir: rand(0.003, 0.01),
      maxAlpha: rand(0.4, 0.8),
      r: rgb.r, g: rgb.g, b: rgb.b,
      life: rand(200, 500)
    });
  }

  function updateParticles() {
    for (var i = _particles.length - 1; i >= 0; i--) {
      var p = _particles[i];
      p.x += p.vx + Math.sin(_time * 0.01 + i) * 0.15;
      p.y += p.vy;
      p.alpha += p.alphaDir;
      if (p.alpha >= p.maxAlpha || p.alpha <= 0.05) p.alphaDir *= -1;
      p.life--;
      if (p.life <= 0 || p.y < -10 || p.x < -10 || p.x > _width + 10) {
        _particles.splice(i, 1);
      }
    }
    while (_particles.length < 40) spawnParticle();
  }

  function drawParticles() {
    for (var i = 0; i < _particles.length; i++) {
      var p = _particles[i];
      _ctx.beginPath();
      _ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
      _ctx.fillStyle = 'rgba(' + p.r + ',' + p.g + ',' + p.b + ',' + p.alpha.toFixed(3) + ')';
      _ctx.fill();
      // Tiny glow
      if (p.size > 2) {
        _ctx.beginPath();
        _ctx.arc(p.x, p.y, p.size * 3, 0, Math.PI * 2);
        _ctx.fillStyle = 'rgba(' + p.r + ',' + p.g + ',' + p.b + ',' + (p.alpha * 0.15).toFixed(3) + ')';
        _ctx.fill();
      }
    }
  }

  // --- Light Rays (volumetric god rays from top) ---
  function initLightRays() {
    _lightRays = [];
    for (var i = 0; i < 5; i++) {
      _lightRays.push({
        x: rand(_width * 0.1, _width * 0.9),
        width: rand(40, 120),
        alpha: rand(0.02, 0.06),
        speed: rand(0.1, 0.3),
        phase: rand(0, Math.PI * 2)
      });
    }
  }

  function drawLightRays() {
    for (var i = 0; i < _lightRays.length; i++) {
      var ray = _lightRays[i];
      var shimmer = Math.sin(_time * 0.02 + ray.phase) * 0.5 + 0.5;
      var alpha = ray.alpha * shimmer;
      var grad = _ctx.createLinearGradient(ray.x, 0, ray.x, _height);
      grad.addColorStop(0, _theme.rays.replace(/[\d.]+\)$/, alpha.toFixed(3) + ')'));
      grad.addColorStop(1, 'rgba(0,0,0,0)');
      _ctx.beginPath();
      _ctx.moveTo(ray.x - ray.width/2, 0);
      _ctx.lineTo(ray.x + ray.width/2, 0);
      _ctx.lineTo(ray.x + ray.width * 1.5, _height);
      _ctx.lineTo(ray.x - ray.width, _height);
      _ctx.closePath();
      _ctx.fillStyle = grad;
      _ctx.fill();
      ray.x += Math.sin(_time * 0.005 + ray.phase) * ray.speed;
    }
  }

  // --- Floating Theme Elements ---
  function spawnFloater() {
    var emoji = _theme.floatEmoji[Math.floor(rand(0, _theme.floatEmoji.length))];
    _floaters.push({
      x: rand(-20, _width + 20),
      y: _height + 30,
      vy: rand(-0.4, -0.15),
      vx: rand(-0.2, 0.2),
      size: rand(12, 22),
      rotation: rand(0, 360),
      rotSpeed: rand(-1, 1),
      alpha: 0,
      emoji: emoji,
      maxAlpha: rand(0.15, 0.35),
      fadeIn: true
    });
  }

  function updateFloaters() {
    for (var i = _floaters.length - 1; i >= 0; i--) {
      var f = _floaters[i];
      f.x += f.vx + Math.sin(_time * 0.008 + i * 0.5) * 0.3;
      f.y += f.vy;
      f.rotation += f.rotSpeed;
      if (f.fadeIn) {
        f.alpha = Math.min(f.alpha + 0.005, f.maxAlpha);
        if (f.alpha >= f.maxAlpha) f.fadeIn = false;
      }
      if (f.y < _height * 0.2) f.alpha = Math.max(f.alpha - 0.003, 0);
      if (f.y < -40 || f.alpha <= 0) _floaters.splice(i, 1);
    }
    if (_floaters.length < 8 && Math.random() < 0.02) spawnFloater();
  }

  function drawFloaters() {
    for (var i = 0; i < _floaters.length; i++) {
      var f = _floaters[i];
      _ctx.save();
      _ctx.globalAlpha = f.alpha;
      _ctx.translate(f.x, f.y);
      _ctx.rotate(f.rotation * Math.PI / 180);
      _ctx.font = f.size + 'px serif';
      _ctx.textAlign = 'center';
      _ctx.textBaseline = 'middle';
      _ctx.fillText(f.emoji, 0, 0);
      _ctx.restore();
    }
  }

  // --- Ambient Background Glow Pulse ---
  function drawAmbientGlow() {
    var pulse = Math.sin(_time * 0.015) * 0.5 + 0.5;
    var grad = _ctx.createRadialGradient(_width/2, _height/2, 0, _width/2, _height/2, _width * 0.6);
    var glowColor = _theme.bgGlow;
    grad.addColorStop(0, glowColor.replace(/[\d.]+\)$/, (0.04 + pulse * 0.03).toFixed(3) + ')'));
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    _ctx.fillStyle = grad;
    _ctx.fillRect(0, 0, _width, _height);
  }

  // --- Main Loop ---
  function tick() {
    if (!_isActive) return;
    _time++;
    _ctx.clearRect(0, 0, _width, _height);
    drawAmbientGlow();
    drawLightRays();
    updateParticles();
    drawParticles();
    updateFloaters();
    drawFloaters();
    _raf = requestAnimationFrame(tick);
  }

  // --- Public API ---
  function start(container, chromeStyle) {
    stop();
    _theme = THEMES[chromeStyle] || THEMES._default;
    _canvas = document.createElement('canvas');
    _canvas.className = 'slot-bg-canvas';
    _canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none;z-index:0;opacity:0.85;';
    container.style.position = 'relative';
    container.insertBefore(_canvas, container.firstChild);
    _ctx = _canvas.getContext('2d');
    _width = _canvas.width = container.offsetWidth;
    _height = _canvas.height = container.offsetHeight;
    _particles = [];
    _floaters = [];
    initLightRays();
    _isActive = true;
    _time = 0;
    tick();

    // Handle resize
    _canvas._resizeObs = new ResizeObserver(function(entries) {
      _width = _canvas.width = entries[0].contentRect.width;
      _height = _canvas.height = entries[0].contentRect.height;
      initLightRays();
    });
    _canvas._resizeObs.observe(container);
  }

  function stop() {
    _isActive = false;
    if (_raf) cancelAnimationFrame(_raf);
    if (_canvas) {
      if (_canvas._resizeObs) _canvas._resizeObs.disconnect();
      _canvas.remove();
    }
    _canvas = null; _ctx = null;
    _particles = []; _floaters = []; _lightRays = [];
  }

  function setIntensity(level) {
    // 'idle' = calm, 'active' = during spin, 'win' = celebration
    // Adjusts particle count and speed
  }

  // Hook into slot open/close
  var _origOpen = window.openSlot;
  if (typeof _origOpen === 'function') {
    window.openSlot = function(gameId) {
      var result = _origOpen.apply(this, arguments);
      setTimeout(function() {
        var modalBody = document.querySelector('#slotModal .modal-content');
        if (modalBody) {
          var chrome = 'joker';
          if (typeof getGameChromeStyle === 'function') {
            try { chrome = getGameChromeStyle({id: gameId}) || 'joker'; } catch(e) {}
          }
          start(modalBody, chrome);
        }
      }, 600);
      return result;
    };
  }

  // Clean up on modal close
  var obs = new MutationObserver(function(muts) {
    muts.forEach(function(m) {
      var modal = document.getElementById('slotModal');
      if (modal && (modal.style.display === 'none' || !modal.classList.contains('show'))) stop();
    });
  });
  var sm = document.getElementById('slotModal');
  if (sm) obs.observe(sm, { attributes: true });

  
  // Auto-detect already-open slot
  setTimeout(function() {
    var modal = document.getElementById('slotModal');
    if (modal && modal.style.display !== 'none') {
      var mc = modal.querySelector('.modal-content');
      if (mc && !mc.querySelector('.slot-bg-canvas')) {
        var chrome = 'joker';
        if (typeof getGameChromeStyle === 'function') {
          try { var gid = new URLSearchParams(location.search).get('openSlot'); if(gid) chrome = getGameChromeStyle({id:gid}) || 'joker'; } catch(e) {}
        }
        start(mc, chrome);
      }
    }
  }, 2000);
  window.SlotBgCanvas = { start: start, stop: stop, setIntensity: setIntensity };
})();