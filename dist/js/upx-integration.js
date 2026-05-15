/* ================================================================
   UPX Integration Layer  v1.0
   Wires ultra-premium-slot.js (UPX) into the casino game flow.
   Hooks: openSlot, spin, reelStop, bigWin, freeSpins
   ================================================================ */
(function(){
  "use strict";
  var UPX = window.UltraPremiumSlot;
  if (!UPX) { console.warn('[UPX-Integration] UPX engine not loaded'); return; }

  /* ---- state -------------------------------------------------- */
  var _activeProfile = null;
  var _activeContainer = null;
  var _reelCount = 5;
  var _scattersLanded = 0;
  /* ---- reel animation styles ---------------------------------- */
  var REEL_ANIMS = {
    cascade:      'upx-reel-cascade 0.4s ease-in',
    bounce:       'upx-reel-bounce 0.5s cubic-bezier(0.34,1.56,0.64,1)',
    slam:         'upx-reel-slam 0.3s ease-in',
    smooth:       'upx-reel-smooth 0.6s ease-in-out',
    turbo:        'upx-reel-slam 0.15s linear',
    elastic:      'upx-reel-bounce 0.6s cubic-bezier(0.68,-0.55,0.265,1.55)',
    wave:         'upx-reel-wave 0.5s ease-in-out',
    gravity:      'upx-reel-cascade 0.5s cubic-bezier(0.55,0,1,0.45)',
    magnetic:     'upx-reel-smooth 0.4s cubic-bezier(0.25,0.46,0.45,0.94)',
    spiral:       'upx-reel-spiral 0.5s ease-out',
    jelly:        'upx-reel-bounce 0.7s cubic-bezier(0.34,1.56,0.64,1)',
    glitch:       'upx-reel-glitch 0.3s steps(4)',
    flutter:      'upx-reel-wave 0.6s ease-in-out',
    thunder_drop: 'upx-reel-slam 0.2s cubic-bezier(0.55,0,1,0.45)',
    feather_fall: 'upx-reel-smooth 0.8s ease-out'
  };

  function animateReelStop(reelIdx) {
    if (!_activeContainer || !_activeProfile) return;
    var style = (_activeProfile.reelStyle) || 'smooth';
    var anim = REEL_ANIMS[style] || REEL_ANIMS.smooth;
    
    /* Find reel columns - try several common selector patterns */
    var reels = _activeContainer.querySelectorAll('.reel-column, .slot-reel, [class*="reel-col"], .reel');
    if (!reels.length) reels = _activeContainer.querySelectorAll('.slot-reels > div, .reels-container > div');
    
    if (reels.length > reelIdx) {
      var reel = reels[reelIdx];
      /* Reset and re-trigger animation */
      reel.style.animation = 'none';
      reel.offsetHeight; /* force reflow */
      reel.style.animation = anim;
      
      /* Stagger delay for cascading feel */
      var delay = reelIdx * 0.08;
      reel.style.animationDelay = delay + 's';
      
      /* Clean up after animation completes */
      setTimeout(function() {
        reel.style.animation = '';
        reel.style.animationDelay = '';
      }, 1200);
    }
  }

  /* ---- helpers ------------------------------------------------ */
  function getSlotContainer() {
    return document.querySelector('.slot-modal-fullscreen')
        || document.querySelector('.slot-modal')
        || document.querySelector('[class*="slot-game"]');
  }

  function getCurrentGameObj() {
    return (typeof currentGame !== 'undefined') ? currentGame : null;
  }

  /* ================================================================
     HOOK 1: GAME OPEN  ? start background + apply chrome
     ================================================================ */
  function onGameOpen(gameId) {
    var container = getSlotContainer();
    if (!container) return;
    _activeContainer = container;

    /* Fetch the UPX profile for this game */
    _activeProfile = UPX.getProfile ? UPX.getProfile(gameId) : null;
    if (!_activeProfile) _activeProfile = UPX.getDefaultProfile ? UPX.getDefaultProfile() : null;

    /* Show loading shimmer before background */
    if (UPX.showLoadShimmer && _activeProfile) {
      UPX.showLoadShimmer(container, _activeProfile);
    }

    /* Start animated canvas background */
    if (UPX.startBg && _activeProfile) {
      if(UPX.startAmbient) UPX.startAmbient(container, _activeProfile); UPX.startBg(container, _activeProfile, _activeProfile.accentColor);
    }

    /* Apply provider-distinct reel chrome */
    if (UPX.applyChrome && _activeProfile) {
      if(UPX.applyReelStyle) UPX.applyReelStyle(container, _activeProfile); UPX.applyChrome(container, _activeProfile.chrome || 'default');
    }

    /* Initialize the win-FX particle canvas layer */
    if (UPX.initFx) {
      UPX.initFx(container);
    }
  }

  /* ================================================================
     HOOK 2: GAME CLOSE ? stop background
     ================================================================ */
  function onGameClose() {
    if (UPX.stopAmbient) UPX.stopAmbient(); if (UPX.stopBg) UPX.stopBg();
    _activeProfile = null;
    _activeContainer = null;
  }

  /* ================================================================
     HOOK 3: SPIN START ? reset scatter counter
     ================================================================ */
  function onSpinStart() {
    _scattersLanded = 0;
    
    /* Apply spin-start animation to all reels */
    if (_activeContainer && _activeProfile) {
      var reels = _activeContainer.querySelectorAll('.reel-column, .slot-reel, [class*="reel-col"], .reel');
      if (!reels.length) reels = _activeContainer.querySelectorAll('.slot-reels > div, .reels-container > div');
      for (var i = 0; i < reels.length; i++) {
        reels[i].style.animation = 'none';
      }
    }
  }

  /* ================================================================
     HOOK 4: REEL STOP ? anticipation on later reels
     ================================================================ */
  function onReelStop(reelIdx, totalReels) {
    if (!_activeContainer || !_activeProfile) return;
    _reelCount = totalReels || 5;

    /* Apply reel-style animation to this reel column */
    animateReelStop(reelIdx);

    /* Trigger anticipation on reel 3+ if 2+ scatters already landed */
    if (reelIdx >= 2 && _scattersLanded >= 2) {
      if (UPX.triggerAnticipation) {
        UPX.triggerAnticipation(_activeContainer, _activeProfile, reelIdx);
      }
    }

    /* Trigger anticipation on the last reel for extra drama */
    if (reelIdx === _reelCount - 1 && _scattersLanded >= 1) {
      if (UPX.triggerAnticipation) {
        UPX.triggerAnticipation(_activeContainer, _activeProfile, reelIdx);
      }
    }
  }

  /* Track scatter landings during reel stops */
  function onScatterLand() {
    _scattersLanded++;
  }

  /* ================================================================
     HOOK 5: WIN DISPLAY ? fire particle FX
     ================================================================ */
  function onWin(amount, bet) {
    if (!_activeContainer || !_activeProfile) return;
    if (!amount || amount <= 0) return;

    var multiplier = bet > 0 ? Math.round(amount / bet) : 0;
    var fxType = (_activeProfile && _activeProfile.winFX) || 'coins';

    /* Small wins: subtle particle burst */
          /* Apply winning symbol animations */
      if (UPX.animateWinSymbols && _activeProfile) {
        UPX.animateWinSymbols(_activeContainer, _activeProfile);
      }
      
      if (multiplier >= 2 && multiplier < 10) {
      if (UPX.winFx && UPX.winFx[fxType]) {
        UPX.winFx[fxType]();
      }
    }
    /* Medium wins: bigger burst */
    else if (multiplier >= 10 && multiplier < 50) {
      if (UPX.winFx && UPX.winFx[fxType]) {
        UPX.winFx[fxType]();
        setTimeout(function(){ UPX.winFx[fxType](); }, 300);
      }
      if (UPX.screenShake) UPX.screenShake(_activeContainer, 0.5);
    }
  }

  /* ================================================================
     HOOK 6: BIG WIN ? enhanced overlay + particles + shake
     ================================================================ */
  function onBigWin(amount, bet) {
    if (!_activeContainer) return;
    var multiplier = bet > 0 ? Math.round(amount / bet) : 50;

    if (UPX.showBigWin) {
      UPX.showBigWin(_activeContainer, multiplier, _activeProfile);
    }
  }

  /* ================================================================
     HOOK 7: FREE SPINS TRIGGERED ? cinematic intro
     ================================================================ */
  function onFreeSpinsTrigger(count) {
    if (!_activeContainer || !_activeProfile) return;
    if (UPX.showFreeSpinsIntro) {
      UPX.showFreeSpinsIntro(_activeContainer, _activeProfile, count);
    }
  }

  /* ================================================================
     MONKEY-PATCH INTEGRATION
     Hooks into existing functions non-destructively
     ================================================================ */

  /* --- Patch openSlot ------------------------------------------ */
  if (typeof window.openSlot === 'function') {
    var _origOpenSlot = window.openSlot;
    window.openSlot = function(gameId) {
      var result = _origOpenSlot.apply(this, arguments);
      try { onGameOpen(gameId); } catch(e) { console.warn('[UPX] openSlot hook error:', e); }
      return result;
    };
  } else {
    /* Fallback: watch for slot modal appearing via MutationObserver */
    var _slotObserver = new MutationObserver(function(mutations) {
      mutations.forEach(function(m) {
        m.addedNodes.forEach(function(node) {
          if (node.nodeType === 1 && (node.classList.contains('slot-modal-fullscreen') || node.querySelector && node.querySelector('.slot-modal-fullscreen'))) {
            var game = getCurrentGameObj();
            if (game) onGameOpen(game.id);
          }
        });
      });
    });
    _slotObserver.observe(document.body, {childList: true, subtree: true});
  }

  /* --- Patch closeSlotModal if it exists ----------------------- */
  if (typeof window.closeSlotModal === 'function') {
    var _origClose = window.closeSlotModal;
    window.closeSlotModal = function() {
      try { onGameClose(); } catch(e) {}
      return _origClose.apply(this, arguments);
    };
  }

  /* --- Patch spin ---------------------------------------------- */
  if (typeof window.spin === 'function') {
    var _origSpin = window.spin;
    window.spin = function() {
      try { onSpinStart(); } catch(e) {}
      return _origSpin.apply(this, arguments);
    };
  }

  /* --- Patch showBigWinCelebration ----------------------------- */
  if (typeof window.showBigWinCelebration === 'function') {
    var _origBigWin = window.showBigWinCelebration;
    window.showBigWinCelebration = function(amount) {
      try {
        var bet = (typeof currentBet !== 'undefined') ? currentBet : 1;
        onBigWin(amount, bet);
      } catch(e) { console.warn('[UPX] bigWin hook error:', e); }
      return _origBigWin.apply(this, arguments);
    };
  }

  /* --- Patch showFreeSpinsOverlay ------------------------------ */
  if (typeof window.showFreeSpinsOverlay === 'function') {
    var _origFSO = window.showFreeSpinsOverlay;
    window.showFreeSpinsOverlay = function(game, count) {
      try { onFreeSpinsTrigger(count); } catch(e) {}
      return _origFSO.apply(this, arguments);
    };
  }

  /* --- Patch displayServerWinResult for per-win FX ------------- */
  if (typeof window.displayServerWinResult === 'function') {
    var _origDSWR = window.displayServerWinResult;
    window.displayServerWinResult = function(result, game) {
      var ret = _origDSWR.apply(this, arguments);
      try {
        if (result && result.winAmount > 0) {
          var bet = (typeof currentBet !== 'undefined') ? currentBet : 1;
          onWin(result.winAmount, bet);
        }
      } catch(e) {}
      return ret;
    };
  }

  /* --- Listen for reel stop events (custom event approach) ------ */
  document.addEventListener('upx-reel-stop', function(e) {
    if (e.detail) onReelStop(e.detail.reelIdx, e.detail.totalReels);
  });
  document.addEventListener('upx-scatter-land', function(e) {
    onScatterLand();
  });

  /* --- Listen for slot-modal class changes to detect game open -- */
  document.addEventListener('DOMContentLoaded', function() {
    /* If a game is already open on load, hook in */
    var game = getCurrentGameObj();
    if (game) {
      setTimeout(function(){ onGameOpen(game.id); }, 500);
    }
  });

  /* --- Expose for manual debugging ----------------------------- */
  window._upxIntegration = {
    onGameOpen: onGameOpen,
    onGameClose: onGameClose,
    onSpinStart: onSpinStart,
    onReelStop: onReelStop,
    onWin: onWin,
    onBigWin: onBigWin,
    onFreeSpinsTrigger: onFreeSpinsTrigger,
    getProfile: function(){ return _activeProfile; },
    getContainer: function(){ return _activeContainer; }
  };

  // UPX-Integration v1.0 loaded
})();
