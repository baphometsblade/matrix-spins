/* Royal Slots - Jackpot Ticker Bar */
(function() {
    'use strict';
    
    async function fetchJackpots() {
        try {
            var resp = await fetch('/api/jackpot/pools');
            if (!resp.ok) return null;
            return await resp.json();
        } catch(e) { return null; }
    }
    
    function formatMoney(n) { return '\$' + Number(n).toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2}); }
    
    async function createTicker() {
        var data = await fetchJackpots();
        if (!data || !data.pools) return;
        
        var ticker = document.createElement('div');
        ticker.className = 'jackpot-ticker';
        
        var content = document.createElement('span');
        content.className = 'jackpot-ticker-content';
        
        var items = [];
        if (data.pools.grand) items.push('GRAND JACKPOT: ' + formatMoney(data.pools.grand.current));
        if (data.pools.major) items.push('MAJOR: ' + formatMoney(data.pools.major.current));
        if (data.pools.minor) items.push('MINOR: ' + formatMoney(data.pools.minor.current));
        if (data.pools.mini) items.push('MINI: ' + formatMoney(data.pools.mini.current));
        
        content.textContent = items.join('  \u2022  ') + '  \u2022  ' + items.join('  \u2022  ');
        ticker.appendChild(content);
        
        var nav = document.querySelector('nav, .navbar, header');
        if (nav && nav.parentElement) {
            nav.parentElement.insertBefore(ticker, nav.nextSibling);
        } else {
            document.body.insertBefore(ticker, document.body.firstChild);
        }
    }
    
    setTimeout(createTicker, 2000);
    // Refresh jackpot values every 30 seconds
    setInterval(async function() {
        var existing = document.querySelector('.jackpot-ticker-content');
        if (!existing) return;
        var data = await fetchJackpots();
        if (!data || !data.pools) return;
        var items = [];
        if (data.pools.grand) items.push('GRAND JACKPOT: ' + formatMoney(data.pools.grand.current));
        if (data.pools.major) items.push('MAJOR: ' + formatMoney(data.pools.major.current));
        if (data.pools.minor) items.push('MINOR: ' + formatMoney(data.pools.minor.current));
        if (data.pools.mini) items.push('MINI: ' + formatMoney(data.pools.mini.current));
        existing.textContent = items.join('  \u2022  ') + '  \u2022  ' + items.join('  \u2022  ');
    }, 30000);
})();