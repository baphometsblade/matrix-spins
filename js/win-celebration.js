/* Matrix Spins - Enhanced Win Celebration Animations */
(function() {
    'use strict';
    
    // Override/enhance the existing win display
    var _originalShowWin = window.showWinAnimation;
    
    window.showWinAnimation = function(amount, multiplier) {
        // Call original if exists
        if (_originalShowWin) _originalShowWin.apply(this, arguments);
        
        // Enhanced celebration for big wins
        if (amount >= 50 || multiplier >= 10) {
            showBigWinCelebration(amount, multiplier);
        }
    };
    
    function showBigWinCelebration(amount, multiplier) {
        var overlay = document.createElement('div');
        overlay.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;z-index:9999;pointer-events:none;';
        
        // Create particles
        for (var i = 0; i < 30; i++) {
            var particle = document.createElement('div');
            var x = Math.random() * 100;
            var delay = Math.random() * 0.5;
            var colors = ['#f59e0b', '#22c55e', '#ef4444', '#3b82f6', '#a855f7'];
            var color = colors[Math.floor(Math.random() * colors.length)];
            particle.style.cssText = 'position:absolute;width:8px;height:8px;background:' + color + 
                ';border-radius:50%;left:' + x + '%;top:-10px;animation:confetti-fall ' + 
                (1.5 + Math.random()) + 's ease-in ' + delay + 's forwards;';
            overlay.appendChild(particle);
        }
        
        document.body.appendChild(overlay);
        setTimeout(function() { overlay.remove(); }, 3000);
    }
    
    // Add confetti keyframes
    if (!document.querySelector('#confetti-styles')) {
        var style = document.createElement('style');
        style.id = 'confetti-styles';
        style.textContent = '@keyframes confetti-fall { ' +
            '0% { transform: translateY(0) rotate(0deg); opacity: 1; } ' +
            '100% { transform: translateY(100vh) rotate(720deg); opacity: 0; } }';
        document.head.appendChild(style);
    }
})();

// Premium win confetti — integrates with existing win handling
(function() {
  function cryptoRand() {
    return crypto.getRandomValues(new Uint32Array(1))[0] / 0xFFFFFFFF;
  }

  function triggerWinConfetti(multiplier) {
    if (typeof confetti === 'undefined') return;
    var mult = parseFloat(multiplier) || 1;
    if (mult >= 100) {
      // Mega win — sustained burst
      var end = Date.now() + 2000;
      (function burst() {
        confetti({ particleCount: 30, spread: 80, origin: { x: cryptoRand(), y: 0.5 }, colors: ['#00ff41','#FFD166','#fff','#F0A500'] });
        if (Date.now() < end) requestAnimationFrame(burst);
      })();
    } else if (mult >= 20) {
      confetti({ particleCount: 120, spread: 90, origin: { y: 0.65 }, colors: ['#00ff41','#FFD166','#fff'] });
    } else if (mult >= 5) {
      confetti({ particleCount: 60, spread: 70, origin: { y: 0.72 }, colors: ['#00ff41','#FFD166'] });
    } else {
      confetti({ particleCount: 25, spread: 50, origin: { y: 0.80 }, colors: ['#00ff41'] });
    }
  }

  // Expose globally
  window.triggerWinConfetti = triggerWinConfetti;

  // Hook into existing win events if they exist
  document.addEventListener('casino:bigwin', function(e) {
    if (e && e.detail) triggerWinConfetti(e.detail.multiplier || e.detail.amount || 1);
  });
})();