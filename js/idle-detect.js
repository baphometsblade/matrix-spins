/* Matrix Spins - Idle Detection & Attract Mode */
(function() {
    'use strict';
    var idleTimer = null;
    var attractTimer = null;
    var IDLE_TIMEOUT = 30000; // 30 seconds — then start attract mode
    var attractActive = false;
    var attractFrame = null;

    function resetIdle() {
        clearTimeout(idleTimer);
        stopAttract();
        idleTimer = setTimeout(startAttract, IDLE_TIMEOUT);
    }

    /* ── Attract Mode ─────────────────────────────────────────── */
    function startAttract() {
        if (attractActive) return;
        attractActive = true;

        // Only show attract mode in the slot view, not lobby
        var reelArea = document.getElementById('reelArea') || document.querySelector('.reel-grid');
        if (!reelArea || reelArea.offsetParent === null) {
            // Not in slot view — show idle prompt instead
            showIdlePrompt();
            return;
        }

        // Add attract shimmer overlay
        var overlay = document.createElement('div');
        overlay.className = 'attract-overlay';
        overlay.id = 'attractOverlay';

        var textWrap = document.createElement('div');
        textWrap.className = 'attract-text';

        var title = document.createElement('div');
        title.className = 'attract-title';
        title.textContent = 'SPIN TO WIN';

        var sub = document.createElement('div');
        sub.className = 'attract-sub';
        sub.textContent = 'Tap anywhere to play';

        textWrap.appendChild(title);
        textWrap.appendChild(sub);
        overlay.appendChild(textWrap);
        document.body.appendChild(overlay);

        // Animate reel symbols with gentle pulse
        var cells = reelArea.querySelectorAll('.reel-cell, .symbol-cell');
        var idx = 0;
        function pulseNext() {
            if (!attractActive) return;
            cells.forEach(function(c) { c.classList.remove('attract-pulse'); });
            if (cells.length > 0) {
                var col = idx % (Math.min(cells.length, 5));
                // Pulse an entire column worth of cells
                for (var r = col; r < cells.length; r += 5) {
                    cells[r].classList.add('attract-pulse');
                }
                idx++;
            }
            attractFrame = setTimeout(pulseNext, 800);
        }
        pulseNext();

        // Click/tap anywhere dismisses attract mode
        overlay.addEventListener('click', function() { resetIdle(); }, { once: true });
    }

    function stopAttract() {
        if (!attractActive) return;
        attractActive = false;
        clearTimeout(attractFrame);
        var overlay = document.getElementById('attractOverlay');
        if (overlay) overlay.remove();
        // Remove any lingering pulse classes
        document.querySelectorAll('.attract-pulse').forEach(function(c) {
            c.classList.remove('attract-pulse');
        });
    }

    /* ── Idle Prompt (lobby / fallback) ───────────────────────── */
    function showIdlePrompt() {
        var existing = document.querySelector('.idle-prompt');
        if (existing) return;

        var prompt = document.createElement('div');
        prompt.className = 'idle-prompt';
        prompt.style.cssText = 'position:fixed;bottom:80px;right:20px;background:rgba(10,10,26,0.95);' +
            'border:1px solid #f59e0b;border-radius:12px;padding:16px 20px;z-index:9000;max-width:300px;' +
            'animation:slideUp 0.5s ease;';

        var heading = document.createElement('div');
        heading.style.cssText = 'color:#f59e0b;font-weight:700;margin-bottom:6px;';
        heading.textContent = 'Still spinning?';

        var msg = document.createElement('div');
        msg.style.cssText = 'color:#aaa;font-size:13px;margin-bottom:12px;';
        msg.textContent = 'Your lucky streak awaits! The jackpot is growing every second.';

        var btn = document.createElement('button');
        btn.style.cssText = 'background:linear-gradient(135deg,#f59e0b,#d97706);' +
            'color:#000;border:none;padding:8px 20px;border-radius:6px;font-weight:700;cursor:pointer;';
        btn.textContent = 'Keep Playing';
        btn.addEventListener('click', function() { prompt.remove(); });

        prompt.appendChild(heading);
        prompt.appendChild(msg);
        prompt.appendChild(btn);
        document.body.appendChild(prompt);

        setTimeout(function() { if (prompt.parentElement) prompt.remove(); }, 20000);
    }

    ['mousemove', 'mousedown', 'keypress', 'touchstart', 'scroll'].forEach(function(ev) {
        document.addEventListener(ev, resetIdle, { passive: true });
    });
    resetIdle();

    // Add styles for attract mode + slideUp
    if (!document.querySelector('#idle-styles')) {
        var s = document.createElement('style');
        s.id = 'idle-styles';
        s.textContent =
            '@keyframes slideUp{from{transform:translateY(30px);opacity:0}to{transform:translateY(0);opacity:1}}' +
            '@keyframes attractShimmer{0%{background-position:-200% 0}100%{background-position:200% 0}}' +
            '@keyframes attractPulse{0%{transform:scale(1);filter:brightness(1)}50%{transform:scale(1.08);filter:brightness(1.6) drop-shadow(0 0 8px #f59e0b)}100%{transform:scale(1);filter:brightness(1)}}' +
            '@keyframes attractFloat{0%{transform:translateY(0)}50%{transform:translateY(-8px)}100%{transform:translateY(0)}}' +
            '.attract-overlay{position:fixed;inset:0;z-index:8500;background:rgba(0,0,0,0.4);' +
              'display:flex;align-items:center;justify-content:center;cursor:pointer;' +
              'animation:slideUp 0.6s ease;}' +
            '.attract-text{text-align:center;animation:attractFloat 2s ease-in-out infinite;}' +
            '.attract-title{font-size:clamp(28px,5vw,48px);font-weight:900;color:#f59e0b;' +
              'text-shadow:0 0 20px rgba(245,158,11,0.6),0 2px 8px rgba(0,0,0,0.5);' +
              'background:linear-gradient(90deg,#f59e0b,#fcd34d,#f59e0b);background-size:200% 100%;' +
              '-webkit-background-clip:text;-webkit-text-fill-color:transparent;' +
              'animation:attractShimmer 3s linear infinite;}' +
            '.attract-sub{font-size:clamp(14px,2vw,18px);color:rgba(255,255,255,0.7);margin-top:8px;}' +
            '.attract-pulse{animation:attractPulse 0.8s ease-in-out!important;}';
        document.head.appendChild(s);
    }
})();
