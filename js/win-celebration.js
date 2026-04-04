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