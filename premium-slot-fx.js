/**
 * Premium Slot Effects - Industry Standard Animations
 * Ambient sparkles, active backgrounds, idle symbols, win celebrations
 */
(function() {
  'use strict';
  
  var FX_ENABLED = true;
  var MAX_SPARKLES = 12;
  var SPARKLE_INTERVAL = 800;
  var _sparkleTimer = null;
  var _idleTimer = null;
  var _activeContainer = null;

  // --- Ambient Sparkle System ---
  function spawnSparkle(container) {
    if (!FX_ENABLED || !container) return;
    var sparkles = container.querySelectorAll('.slot-ambient-sparkle');
    if (sparkles.length >= MAX_SPARKLES) return;

    var el = document.createElement('div');
    el.className = 'slot-ambient-sparkle';
    el.style.left = (Math.random() * 90 + 5) + '%';
    el.style.top = (Math.random() * 80 + 10) + '%';
    el.style.animationDuration = (2 + Math.random() * 3) + 's';
    el.style.animationDelay = (Math.random() * 0.5) + 's';
    
    var size = 2 + Math.random() * 4;
    el.style.width = size + 'px';
    el.style.height = size + 'px';
    
    var colors = ['rgba(255,215,0,0.8)', 'rgba(255,255,255,0.6)', 'rgba(0,212,255,0.5)'];
    el.style.background = 'radial-gradient(circle, ' + colors[Math.floor(Math.random() * colors.length)] + ', transparent)';
    
    container.appendChild(el);
    setTimeout(function() { if (el.parentNode) el.remove(); }, 5000);
  }

  function startAmbientSparkles(container) {
    stopAmbientSparkles();
    _activeContainer = container;
    _sparkleTimer = setInterval(function() { spawnSparkle(container); }, SPARKLE_INTERVAL);
  }

  function stopAmbientSparkles() {
    if (_sparkleTimer) { clearInterval(_sparkleTimer); _sparkleTimer = null; }
    if (_activeContainer) {
      _activeContainer.querySelectorAll('.slot-ambient-sparkle').forEach(function(el) { el.remove(); });
    }
    _activeContainer = null;
  }

  // --- Floating Coin Particles (for big wins) ---
  function spawnFloatingCoins(container, count) {
    if (!container) return;
    count = count || 8;
    for (var i = 0; i < count; i++) {
      var coin = document.createElement('div');
      coin.className = 'floating-coin-particle';
      coin.innerHTML = '<svg width="16" height="16" viewBox="0 0 16 16"><circle cx="8" cy="8" r="7" fill="#FFD700" stroke="#B8860B" stroke-width="1"/><text x="8" y="11" text-anchor="middle" font-size="9" fill="#B8860B" font-weight="bold">$</text></svg>';
      coin.style.cssText = 'position:absolute;bottom:0;left:' + (Math.random()*80+10) + '%;pointer-events:none;z-index:10;animation:coin-float ' + (3+Math.random()*4) + 's ease-out ' + (i*0.2) + 's forwards;opacity:0;';
      container.appendChild(coin);
      setTimeout(function(el) { return function() { if (el.parentNode) el.remove(); }; }(coin), 8000);
    }
  }

  // --- Win Amount Counter Animation ---
  function animateWinCounter(element, targetAmount) {
    if (!element) return;
    var current = 0;
    var duration = Math.min(2000, Math.max(500, targetAmount * 2));
    var steps = 30;
    var increment = targetAmount / steps;
    var stepTime = duration / steps;
    
    element.classList.add('win-update');
    var counter = setInterval(function() {
      current += increment;
      if (current >= targetAmount) {
        current = targetAmount;
        clearInterval(counter);
        setTimeout(function() { element.classList.remove('win-update'); }, 500);
      }
      element.textContent = Math.floor(current).toLocaleString();
    }, stepTime);
  }

  // --- Active Spin Background Effects ---
  function onSpinStart() {
    var modal = document.getElementById('slotModal');
    if (modal) modal.classList.add('spinning');
  }

  function onSpinEnd() {
    var modal = document.getElementById('slotModal');
    if (modal) modal.classList.remove('spinning');
  }

  // --- Idle Animation Controller ---
  function startIdleAnimations() {
    if (_idleTimer) clearTimeout(_idleTimer);
    // After 5 seconds of no interaction, boost ambient effects
    _idleTimer = setTimeout(function() {
      var reelArea = document.querySelector('.slot-reel-area');
      if (reelArea) reelArea.classList.add('idle-enhanced');
      // Increase sparkle rate
      if (_sparkleTimer) { clearInterval(_sparkleTimer); }
      _sparkleTimer = setInterval(function() { 
        spawnSparkle(_activeContainer);
        spawnSparkle(_activeContainer); // Double rate when idle
      }, SPARKLE_INTERVAL);
    }, 5000);
  }

  function resetIdleTimer() {
    var reelArea = document.querySelector('.slot-reel-area');
    if (reelArea) reelArea.classList.remove('idle-enhanced');
    startIdleAnimations();
  }

  // --- Inject Premium Sparkle Styles ---
  var style = document.createElement('style');
  style.textContent = [
    '.floating-coin-particle { filter: drop-shadow(0 0 4px rgba(255,215,0,0.6)); }',
    '.idle-enhanced .reel-cell img { animation-duration: 3s !important; }',
    '.idle-enhanced { animation: reel-glow-pulse 2s ease-in-out infinite !important; }'
  ].join('\n');
  document.head.appendChild(style);

  // --- Hook into Slot System ---
  var _origOpenSlot = window.openSlot;
  if (typeof _origOpenSlot === 'function') {
    window.openSlot = function() {
      var result = _origOpenSlot.apply(this, arguments);
      // Start ambient effects after slot opens
      setTimeout(function() {
        var modalBody = document.querySelector('#slotModal .modal-content');
        if (modalBody) {
          startAmbientSparkles(modalBody);
          startIdleAnimations();
          // Listen for user interaction to reset idle (remove first to prevent accumulation on re-open)
          modalBody.removeEventListener('click', resetIdleTimer);
          modalBody.removeEventListener('touchstart', resetIdleTimer);
          modalBody.addEventListener('click', resetIdleTimer);
          modalBody.addEventListener('touchstart', resetIdleTimer);
        }
      }, 500);
      return result;
    };
  }

  // Expose for external use
  
  // Auto-detect already-open slot (e.g. via ?openSlot= URL param)
  setTimeout(function() {
    var modal = document.getElementById('slotModal');
    if (modal && modal.style.display !== 'none') {
      var mc = modal.querySelector('.modal-content');
      if (mc && !mc.querySelector('.slot-ambient-sparkle')) {
        startAmbientSparkles(mc);
        startIdleAnimations();
        mc.addEventListener('click', resetIdleTimer);
        mc.addEventListener('touchstart', resetIdleTimer);
      }
    }
  }, 2000);
  window.PremiumSlotFX = {
    spawnFloatingCoins: spawnFloatingCoins,
    animateWinCounter: animateWinCounter,
    onSpinStart: onSpinStart,
    onSpinEnd: onSpinEnd,
    startAmbientSparkles: startAmbientSparkles,
    stopAmbientSparkles: stopAmbientSparkles,
    setEnabled: function(v) { FX_ENABLED = !!v; if (!v) stopAmbientSparkles(); }
  };

  // Clean up on slot close
  var observer = new MutationObserver(function(mutations) {
    mutations.forEach(function(m) {
      if (m.type === 'attributes' && m.attributeName === 'style') {
        var modal = document.getElementById('slotModal');
        if (modal && (modal.style.display === 'none' || !modal.classList.contains('show'))) {
          stopAmbientSparkles();
          if (_idleTimer) clearTimeout(_idleTimer);
        }
      }
    });
  });
  var slotModal = document.getElementById('slotModal');
  if (slotModal) observer.observe(slotModal, { attributes: true });
})();
