/**
 * ui-premium-effects.js
 * Premium micro-interaction effects for Matrix Spins Casino
 * Enhances the visual experience with smooth animations and feedback.
 */
(function () {
    'use strict';

    // ─── Ripple Effect on Buttons ────────────────────────────────────────────
    function _addRippleEffect() {
        document.addEventListener('click', function (e) {
            if (!e.target || typeof e.target.closest !== 'function') return;
            const btn = e.target.closest('.btn, .filter-tab, .csb-item, .btn-deposit, .btn-play');
            if (!btn) return;
            const ripple = document.createElement('span');
            const rect = btn.getBoundingClientRect();
            const size = Math.max(rect.width, rect.height) * 1.5;
            const x = e.clientX - rect.left - size / 2;
            const y = e.clientY - rect.top - size / 2;
            ripple.style.cssText = [
                'position:absolute',
                'border-radius:50%',
                'pointer-events:none',
                'transform:scale(0)',
                'animation:_premRipple 0.5s ease-out forwards',
                'background:rgba(255,255,255,0.18)',
                `width:${size}px`,
                `height:${size}px`,
                `left:${x}px`,
                `top:${y}px`,
                'z-index:10400',
            ].join(';');
            btn.style.position = btn.style.position || 'relative';
            btn.style.overflow = btn.style.overflow || 'hidden';
            btn.appendChild(ripple);
            setTimeout(function () { ripple.remove(); }, 550);
        });
    }

    // ─── Inject Ripple Keyframes ─────────────────────────────────────────────
    function _injectStyles() {
        if (document.getElementById('_premiumEffectsStyles')) return;
        const s = document.createElement('style');
        s.id = '_premiumEffectsStyles';
        s.textContent = `
@keyframes _premRipple {
    to { transform: scale(1); opacity: 0; }
}
@keyframes _premCardEntrance {
    from { opacity: 0; transform: translateY(12px) scale(0.97); }
    to   { opacity: 1; transform: translateY(0) scale(1); }
}
.prem-card-enter {
    animation: _premCardEntrance 0.35s cubic-bezier(0.22,1,0.36,1) both;
}
/* Golden glow on win ticker items */
.win-ticker-item .win-amount,
.win-ticker-amount {
    color: #fbbf24 !important;
    font-weight: 800 !important;
    text-shadow: 0 0 8px rgba(251,191,36,0.4);
}
/* Enhanced promo bar font */
.promo-item {
    font-weight: 700;
    letter-spacing: 0.3px;
    color: rgba(255,255,255,0.95);
}
.promo-sep {
    color: rgba(251,191,36,0.6);
    font-size: 10px;
}
/* Premium scrollbar */
::-webkit-scrollbar { width: 6px; height: 6px; }
::-webkit-scrollbar-track { background: rgba(255,255,255,0.03); }
::-webkit-scrollbar-thumb { background: rgba(251,191,36,0.3); border-radius: 4px; }
::-webkit-scrollbar-thumb:hover { background: rgba(251,191,36,0.5); }
/* Smooth image load fade-in */
.game-thumbnail img {
    transition: opacity 0.3s ease, transform 0.35s cubic-bezier(0.22,1,0.36,1);
}
.game-card:hover .game-thumbnail img {
    transform: scale(1.04);
}
/* Premium section header underline */
.section-header {
    position: relative;
    padding-bottom: 12px;
    margin-bottom: 4px;
}
.section-header::after {
    content: '';
    position: absolute;
    bottom: 0;
    left: 0;
    width: 48px;
    height: 2px;
    background: linear-gradient(90deg, #fbbf24, transparent);
    border-radius: 1px;
}
/* Jackpot tier glow */
.jackpot-tier-grand .jackpot-amount,
.jackpot-tier[data-tier="grand"] .jackpot-amount {
    text-shadow: 0 0 16px rgba(251,191,36,0.6), 0 0 32px rgba(251,191,36,0.3);
    animation: _grandPulse 2s ease-in-out infinite;
}
@keyframes _grandPulse {
    0%, 100% { text-shadow: 0 0 16px rgba(251,191,36,0.6), 0 0 32px rgba(251,191,36,0.3); }
    50%       { text-shadow: 0 0 24px rgba(251,191,36,0.9), 0 0 48px rgba(251,191,36,0.5); }
}
/* Stat number countup animation */
@keyframes _statCountUp {
    from { transform: translateY(6px); opacity: 0; }
    to   { transform: translateY(0); opacity: 1; }
}
.hero-stat-number { animation: _statCountUp 0.5s cubic-bezier(0.22,1,0.36,1) both; }
/* Better balance flash */
.balance-up   { animation: _balUp   0.6s ease-out !important; }
.balance-down { animation: _balDown 0.6s ease-out !important; }
@keyframes _balUp   { 0%,100%{color:inherit} 50%{color:#4ade80; text-shadow:0 0 12px rgba(74,222,128,.7);} }
@keyframes _balDown { 0%,100%{color:inherit} 50%{color:#f87171; text-shadow:0 0 12px rgba(248,113,113,.7);} }
/* VIP badge pulse */
.vip-tier-badge {
    animation: _vipPulse 3s ease-in-out infinite;
}
@keyframes _vipPulse {
    0%,100%{ box-shadow: 0 0 8px rgba(139,92,246,0.4); }
    50%    { box-shadow: 0 0 16px rgba(139,92,246,0.7), 0 0 32px rgba(139,92,246,0.3); }
}
/* Smooth filter tab transition */
.filter-tabs { scroll-behavior: smooth; }
/* Card grid stagger */
.game-grid .game-card:nth-child(1)  { animation-delay: 0.02s; }
.game-grid .game-card:nth-child(2)  { animation-delay: 0.04s; }
.game-grid .game-card:nth-child(3)  { animation-delay: 0.06s; }
.game-grid .game-card:nth-child(4)  { animation-delay: 0.08s; }
.game-grid .game-card:nth-child(5)  { animation-delay: 0.10s; }
.game-grid .game-card:nth-child(6)  { animation-delay: 0.12s; }
.game-grid .game-card:nth-child(7)  { animation-delay: 0.14s; }
.game-grid .game-card:nth-child(8)  { animation-delay: 0.16s; }
.game-grid .game-card:nth-child(9)  { animation-delay: 0.18s; }
.game-grid .game-card:nth-child(10) { animation-delay: 0.20s; }
`;
        document.head.appendChild(s);
    }

    // ─── Stagger Animation on Cards When Lobby Renders ───────────────────────
    function _observeCardGrid() {
        const grid = document.querySelector('.game-grid, #gameGrid');
        if (!grid) return;
        const observer = new MutationObserver(function (mutations) {
            mutations.forEach(function (m) {
                m.addedNodes.forEach(function (node) {
                    if (node.nodeType === 1 && node.classList.contains('game-card')) {
                        node.classList.add('prem-card-enter');
                        setTimeout(function () { node.classList.remove('prem-card-enter'); }, 400);
                    }
                });
            });
        });
        observer.observe(grid, { childList: true });
    }

    // ─── Tilt Effect on Game Cards ────────────────────────────────────────────
    function _addCardTilt() {
        // Only apply if animation quality allows
        const q = (typeof appSettings !== 'undefined' && appSettings && appSettings.animationQuality) || 'high';
        if (q === 'low' || q === 'off') return;

        document.addEventListener('mousemove', function (e) {
            if (!e.target || typeof e.target.closest !== 'function') return;
            const card = e.target.closest('.game-card');
            if (!card) return;
            const rect = card.getBoundingClientRect();
            const x = (e.clientX - rect.left) / rect.width - 0.5;
            const y = (e.clientY - rect.top) / rect.height - 0.5;
            card.style.transform = `translateY(-6px) scale(1.03) rotateX(${-y * 4}deg) rotateY(${x * 4}deg)`;
        });

        document.addEventListener('mouseleave', function (e) {
            if (!e.target || typeof e.target.closest !== 'function') return;
            const card = e.target.closest('.game-card');
            if (!card) return;
            card.style.transform = '';
        }, true);
    }

    // ─── Animated Counter for Balance ────────────────────────────────────────
    function _animateBalanceCounter(el, from, to, duration) {
        if (!el || from === to) return;
        const start = performance.now();
        const diff = to - from;
        function step(now) {
            const progress = Math.min((now - start) / duration, 1);
            const ease = 1 - Math.pow(1 - progress, 3);
            el.textContent = (from + diff * ease).toFixed(2);
            if (progress < 1) requestAnimationFrame(step);
        }
        requestAnimationFrame(step);
    }
    // Expose globally for win-logic.js / ui-slot.js to use optionally
    window.premAnimateBalance = _animateBalanceCounter;

    // ─── Smooth Scroll to Sections ───────────────────────────────────────────
    function _enhanceScrollBehavior() {
        document.querySelectorAll('[data-scroll-to]').forEach(function (el) {
            el.addEventListener('click', function () {
                const target = document.querySelector(el.dataset.scrollTo);
                if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
            });
        });
    }

    // ─── Tooltip on truncated game names ────────────────────────────────────
    function _addGameNameTooltips() {
        document.addEventListener('mouseover', function (e) {
            if (!e.target || typeof e.target.closest !== 'function') return;
            const name = e.target.closest('.game-name');
            if (!name || name.title) return;
            if (name.scrollWidth > name.offsetWidth) {
                name.title = name.textContent.trim();
            }
        });
    }

    // ─── Init ─────────────────────────────────────────────────────────────────
    function _init() {
        _injectStyles();
        _addRippleEffect();
        _observeCardGrid();
        _addCardTilt();
        _enhanceScrollBehavior();
        _addGameNameTooltips();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', _init);
    } else {
        _init();
    }

})();
