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
     HOOK 1: GAME OPEN  → start background + apply chrome
     ================================================================ */
  function onGameOpen(gameId) {
    var container = getSlotContainer();
    if (!container) return;
    _activeContainer = container;

    /* Fetch the UPX profile for this game */
    _activeProfile = UPX.getProfile ? UPX.getProfile(gameId) : null;
    if (!_activeProfile) _activeProfile = UPX.getDefaultProfile ? UPX.getDefaultProfile() : null;

    /* Start animated canvas background */
    if (UPX.startBg && _activeProfile) {
      if(UPX.startAmbient) UPX.startAmbient(container, profile); UPX.startBg(container, _activeProfile.bgType || 'stars');
    }

    /* Apply provider-distinct reel chrome */
    if (UPX.applyChrome && _activeProfile) {
      if(UPX.applyReelStyle) UPX.applyReelStyle(container, profile); UPX.applyChrome(container, _activeProfile.chromeStyle || 'default');
    }

    /* Initialize the win-FX particle canvas layer */
    if (UPX.initFx) {
      UPX.initFx(container);
    }
  }

  /* ================================================================
     HOOK 2: GAME CLOSE → stop background
     ================================================================ */
  function onGameClose() {
    if (UPX.stopBg) if(UPX.stopAmbient) UPX.stopAmbient(); UPX.stopBg();
    _activeProfile = null;
    _activeContainer = null;
  }

  /* ================================================================
     HOOK 3: SPIN START → reset scatter counter
     ================================================================ */
  function onSpinStart() {
    _scattersLanded = 0;
  }

  /* ================================================================
     HOOK 4: REEL STOP → anticipation on later reels
     ================================================================ */
  function onReelStop(reelIdx, totalReels) {
    if (!_activeContainer || !_activeProfile) return;
    _reelCount = totalReels || 5;

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
     HOOK 5: WIN DISPLAY → fire particle FX
     ================================================================ */
  function onWin(amount, bet) {
    if (!_activeContainer || !_activeProfile) return;
    if (!amount || amount <= 0) return;

    var multiplier = bet > 0 ? Math.round(amount / bet) : 0;
    var fxType = (_activeProfile && _activeProfile.winFx) || 'coins';

    /* Small wins: subtle particle burst */
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
     HOOK 6: BIG WIN → enhanced overlay + particles + shake
     ================================================================ */
  function onBigWin(amount, bet) {
    if (!_activeContainer) return;
    var multiplier = bet > 0 ? Math.round(amount / bet) : 50;

    if (UPX.showBigWin) {
      UPX.showBigWin(_activeContainer, multiplier, _activeProfile);
    }
  }

  /* ================================================================
     HOOK 7: FREE SPINS TRIGGERED → cinematic intro
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

  console.log('[UPX-Integration] v1.0 loaded — hooks active');
})();
