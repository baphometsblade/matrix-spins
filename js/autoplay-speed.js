/* Matrix Spins - Enhanced Autoplay with Speed Control */
(function() {
    'use strict';
    
    window.AUTOPLAY_SPEEDS = {
        normal: { delay: 2000, label: 'Normal' },
        fast:   { delay: 1000, label: 'Fast' },
        turbo:  { delay: 500,  label: 'Turbo' }
    };
    
    window.autoplaySpeed = 'normal';
    
    window.setAutoplaySpeed = function(speed) {
        if (window.AUTOPLAY_SPEEDS[speed]) {
            window.autoplaySpeed = speed;
            // Update UI indicator
            var indicator = document.querySelector('.autoplay-speed-indicator');
            if (indicator) indicator.textContent = window.AUTOPLAY_SPEEDS[speed].label;
        }
    };
    
    window.getAutoplayDelay = function() {
        return window.AUTOPLAY_SPEEDS[window.autoplaySpeed].delay;
    };
})();