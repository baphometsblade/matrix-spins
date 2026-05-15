/* Matrix Spins - Promotional Popup System (Client) */
(function() {
    'use strict';
    
    const PROMO_CHECK_INTERVAL = 120000; // Check every 2 minutes
    const SHOWN_PROMOS = new Set();
    
    async function fetchPromos() {
        try {
            const token = localStorage.getItem('casinoToken');
            const headers = token ? { 'Authorization': 'Bearer ' + token } : {};
            const resp = await fetch('/api/promos/active', { headers });
            if (!resp.ok) return [];
            const data = await resp.json();
            return data.promos || [];
        } catch (e) { return []; }
    }
    
    function showPromoPopup(promo) {
        if (SHOWN_PROMOS.has(promo.id)) return;
        SHOWN_PROMOS.add(promo.id);

        // ROUND 66: Build the popup with safe DOM construction (textContent /
        // createElement) instead of innerHTML interpolation. The promo fields
        // come from the future /api/promos/active endpoint which is admin-
        // controlled; an admin who can edit promo copy could inject script
        // tags reaching every logged-in user. textContent escapes everything.
        const overlay = document.createElement('div');
        overlay.className = 'promo-overlay';

        const popup = document.createElement('div');
        popup.className = 'promo-popup';

        const closeBtn = document.createElement('button');
        closeBtn.className = 'promo-close';
        closeBtn.textContent = '\u00d7';
        closeBtn.addEventListener('click', function() { overlay.remove(); });

        const icon = document.createElement('div');
        icon.className = 'promo-icon';
        icon.textContent = '\uD83C\uDF89';

        const title = document.createElement('h2');
        title.textContent = String(promo.title || '');

        const message = document.createElement('p');
        message.textContent = String(promo.message || '');

        const ctaBtn = document.createElement('button');
        ctaBtn.className = 'promo-cta';
        ctaBtn.textContent = String(promo.cta || 'OK');
        ctaBtn.addEventListener('click', function() { overlay.remove(); });

        popup.appendChild(closeBtn);
        popup.appendChild(icon);
        popup.appendChild(title);
        popup.appendChild(message);
        popup.appendChild(ctaBtn);
        overlay.appendChild(popup);
        document.body.appendChild(overlay);

        // Auto-dismiss after 15 seconds
        setTimeout(function() { if (overlay.parentElement) overlay.remove(); }, 15000);
    }
    
    async function checkAndShowPromos() {
        const promos = await fetchPromos();
        if (promos.length > 0) showPromoPopup(promos[0]);
    }
    
    // Start checking after 30 seconds (don't interrupt initial load)
    setTimeout(checkAndShowPromos, 30000);
    setInterval(checkAndShowPromos, PROMO_CHECK_INTERVAL);
})();