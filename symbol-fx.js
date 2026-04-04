/**
 * Symbol Animation Engine + Reel Anticipation + Big Win Celebration
 * Industry-standard slot machine visual effects
 */
(function() {
  'use strict';

  // === SYMBOL IDLE ANIMATIONS ===
  // Makes symbols feel alive with subtle breathing, micro-rotation, and glow
  var _idleInterval = null;

  function initSymbolIdle() {
    if (_idleInterval) clearInterval(_idleInterval);
    _idleInterval = setInterval(function() {
      var cells = document.querySelectorAll('.slot-reel-area .reel-cell img');
      if (!cells.length) return;
      // Pick 2-3 random symbols to animate
      var count = Math.min(3, cells.length);
      for (var i = 0; i < count; i++) {
        var idx = Math.floor(Math.random() * cells.length);
        var img = cells[idx];
        if (img.dataset.idleAnim) continue;
        img.dataset.idleAnim = '1';
        triggerIdleAnim(img);
      }
    }, 2500);
  }

  function triggerIdleAnim(img) {
    var anims = ['idle-breathe', 'idle-shimmer', 'idle-wiggle'];
    var cls = anims[Math.floor(Math.random() * anims.length)];
    img.classList.add(cls);
    setTimeout(function() {
      img.classList.remove(cls);
      delete img.dataset.idleAnim;
    }, 2000);
  }

  // === REEL ANTICIPATION SYSTEM ===
  // Dramatic slowdown on reels, especially the last one
  function triggerAnticipation(reelIndex, totalReels) {
    var reelArea = document.querySelector('.slot-reel-area');
    if (!reelArea) return;
    var reels = reelArea.querySelectorAll('.reel-col, .reel-column, [class*="reel"]');
    if (reelIndex >= reels.length) return;
    
    var reel = reels[reelIndex];
    reel.classList.add('reel-anticipation');
    
    // Add dramatic frame glow
    if (reelIndex === totalReels - 1) {
      reelArea.classList.add('final-reel-tension');
    }
  }

  function clearAnticipation() {
    document.querySelectorAll('.reel-anticipation').forEach(function(el) {
      el.classList.remove('reel-anticipation');
    });
    var ra = document.querySelector('.slot-reel-area');
    if (ra) ra.classList.remove('final-reel-tension');
  }

  // === SYMBOL LANDING EFFECTS ===
  function triggerLanding(cellElement) {
    if (!cellElement) return;
    cellElement.classList.add('symbol-land');
    setTimeout(function() { cellElement.classList.remove('symbol-land'); }, 600);
  }

  // === BIG WIN CELEBRATION ===
  var _celebrationActive = false;

  function triggerBigWin(amount, multiplier) {
    if (_celebrationActive) return;
    _celebrationActive = true;
    
    var overlay = document.createElement('div');
    overlay.className = 'bigwin-overlay';
    overlay.innerHTML = [
      '<div class="bigwin-container">',
      '  <div class="bigwin-burst"></div>',
      '  <div class="bigwin-title">' + getTierLabel(multiplier) + '</div>',
      '  <div class="bigwin-amount">$0</div>',
      '  <div class="bigwin-coins"></div>',
      '</div>'
    ].join('');
    
    document.body.appendChild(overlay);
    requestAnimationFrame(function() { overlay.classList.add('active'); });
    
    // Animate amount counter
    var amountEl = overlay.querySelector('.bigwin-amount');
    animateCounter(amountEl, amount, 2500);
    
    // Spawn coins
    var coinContainer = overlay.querySelector('.bigwin-coins');
    spawnCoinShower(coinContainer, multiplier > 50 ? 40 : 20);
    
    // Auto-dismiss
    setTimeout(function() {
      overlay.classList.remove('active');
      overlay.classList.add('fadeout');
      setTimeout(function() {
        overlay.remove();
        _celebrationActive = false;
      }, 800);
    }, 4000);
    
    // Click to dismiss
    overlay.addEventListener('click', function() {
      overlay.classList.remove('active');
      overlay.classList.add('fadeout');
      setTimeout(function() { overlay.remove(); _celebrationActive = false; }, 500);
    });
  }

  function getTierLabel(mult) {
    if (mult >= 100) return 'MEGA WIN';
    if (mult >= 50)  return 'SUPER WIN';
    if (mult >= 20)  return 'BIG WIN';
    return 'NICE WIN';
  }

  function animateCounter(el, target, duration) {
    var start = performance.now();
    function step(now) {
      var progress = Math.min((now - start) / duration, 1);
      var eased = 1 - Math.pow(1 - progress, 3); // ease-out cubic
      var current = Math.floor(target * eased);
      el.textContent = '$' + current.toLocaleString();
      if (progress < 1) requestAnimationFrame(step);
    }
    requestAnimationFrame(step);
  }

  function spawnCoinShower(container, count) {
    for (var i = 0; i < count; i++) {
      setTimeout(function() {
        var coin = document.createElement('div');
        coin.className = 'bigwin-coin';
        coin.style.left = Math.random() * 100 + '%';
        coin.style.animationDuration = (2 + Math.random() * 2) + 's';
        coin.style.animationDelay = Math.random() * 0.5 + 's';
        coin.innerHTML = '<svg width="28" height="28" viewBox="0 0 28 28"><circle cx="14" cy="14" r="13" fill="url(#coinGrad)" stroke="#8B6914" stroke-width="1.5"/><defs><radialGradient id="coinGrad"><stop offset="0%" stop-color="#FFE44D"/><stop offset="100%" stop-color="#D4A017"/></radialGradient></defs><text x="14" y="18" text-anchor="middle" font-size="14" fill="#8B6914" font-weight="bold">$</text></svg>';
        container.appendChild(coin);
        setTimeout(function() { coin.remove(); }, 4500);
      }, i * 80);
    }
  }

  // === INJECT STYLES ===
  var style = document.createElement('style');
  style.textContent = [
    // Symbol idle animations
    '@keyframes idle-breathe { 0%,100%{transform:scale(1)} 50%{transform:scale(1.06)} }',
    '@keyframes idle-shimmer { 0%{filter:brightness(1)} 50%{filter:brightness(1.3) drop-shadow(0 0 6px rgba(255,215,0,0.5))} 100%{filter:brightness(1)} }',
    '@keyframes idle-wiggle { 0%,100%{transform:rotate(0)} 25%{transform:rotate(-3deg)} 75%{transform:rotate(3deg)} }',
    '.idle-breathe { animation: idle-breathe 1.5s ease-in-out !important; }',
    '.idle-shimmer { animation: idle-shimmer 1.2s ease-in-out !important; }',
    '.idle-wiggle  { animation: idle-wiggle 0.8s ease-in-out !important; }',
    
    // Symbol landing
    '@keyframes symbol-land { 0%{transform:scaleY(0.7) scaleX(1.1)} 40%{transform:scaleY(1.15) scaleX(0.92)} 70%{transform:scaleY(0.95) scaleX(1.03)} 100%{transform:scale(1)} }',
    '.symbol-land img { animation: symbol-land 0.5s cubic-bezier(0.34,1.56,0.64,1) !important; }',
    
    // Reel anticipation
    '@keyframes reel-tension { 0%,100%{box-shadow:none} 50%{box-shadow:0 0 20px rgba(255,215,0,0.3), inset 0 0 15px rgba(255,215,0,0.1)} }',
    '.reel-anticipation { animation: reel-tension 0.6s ease-in-out infinite !important; }',
    '@keyframes final-tension { 0%,100%{border-color:rgba(255,215,0,0.2)} 50%{border-color:rgba(255,215,0,0.7)} }',
    '.final-reel-tension { animation: final-tension 0.5s ease-in-out infinite; border:2px solid rgba(255,215,0,0.2); border-radius:8px; }',
    
    // Big win overlay
    '.bigwin-overlay { position:fixed;inset:0;z-index:999999;background:rgba(0,0,0,0);display:flex;align-items:center;justify-content:center;transition:background 0.5s;cursor:pointer; }',
    '.bigwin-overlay.active { background:rgba(0,0,0,0.75); }',
    '.bigwin-overlay.fadeout { opacity:0;transition:opacity 0.5s; }',
    '.bigwin-container { text-align:center;transform:scale(0.3);opacity:0;transition:all 0.6s cubic-bezier(0.34,1.56,0.64,1); }',
    '.bigwin-overlay.active .bigwin-container { transform:scale(1);opacity:1; }',
    
    '@keyframes burst-spin { from{transform:rotate(0)} to{transform:rotate(360deg)} }',
    '.bigwin-burst { position:absolute;width:500px;height:500px;left:50%;top:50%;margin:-250px 0 0 -250px;',
    '  background:conic-gradient(from 0deg,transparent,rgba(255,215,0,0.15),transparent,rgba(255,215,0,0.1),transparent);',
    '  border-radius:50%;animation:burst-spin 4s linear infinite;pointer-events:none; }',
    
    '.bigwin-title { font-size:64px;font-weight:900;color:#FFD700;text-shadow:0 0 30px rgba(255,215,0,0.6),0 0 60px rgba(255,215,0,0.3),0 4px 8px rgba(0,0,0,0.8);',
    '  letter-spacing:6px;position:relative;z-index:1; }',
    '.bigwin-amount { font-size:48px;font-weight:800;color:#FFF;text-shadow:0 0 20px rgba(255,255,255,0.4),0 4px 6px rgba(0,0,0,0.8);',
    '  margin-top:10px;position:relative;z-index:1; }',
    
    '.bigwin-coins { position:fixed;inset:0;pointer-events:none;overflow:hidden; }',
    '@keyframes coin-fall { 0%{transform:translateY(-50px) rotate(0);opacity:0} 10%{opacity:1} 100%{transform:translateY(110vh) rotate(720deg);opacity:0.6} }',
    '.bigwin-coin { position:absolute;top:-50px;animation:coin-fall 3s ease-in forwards; }',
  ].join('\n');
  document.head.appendChild(style);

  // Auto-start idle on slot open
  var _origOpen2 = window.openSlot;
  if (typeof _origOpen2 === 'function') {
    window.openSlot = function() {
      var result = _origOpen2.apply(this, arguments);
      setTimeout(initSymbolIdle, 1000);
      return result;
    };
  }

  // Expose API
  
  // Auto-detect already-open slot
  setTimeout(function() {
    var modal = document.getElementById('slotModal');
    if (modal && modal.style.display !== 'none' && document.querySelectorAll('.reel-cell').length > 0) {
      initSymbolIdle();
    }
  }, 2500);
  window.SymbolFX = {
    initIdle: initSymbolIdle,
    triggerAnticipation: triggerAnticipation,
    clearAnticipation: clearAnticipation,
    triggerLanding: triggerLanding,
    triggerBigWin: triggerBigWin
  };
})();