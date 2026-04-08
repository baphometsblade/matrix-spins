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
        
        const overlay = document.createElement('div');
        overlay.className = 'promo-overlay';
        overlay.innerHTML = '<div class="promo-popup">' +
            '<button class="promo-close" onclick="this.parentElement.parentElement.remove()">&times;</button>' +
            '<div class="promo-icon">&#127881;</div>' +
            '<h2>' + promo.title + '</h2>' +
            '<p>' + promo.message + '</p>' +
            '<button class="promo-cta" onclick="this.closest(\'.promo-overlay\').remove()">' + promo.cta + '</button>' +
            '</div>';
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