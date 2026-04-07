/* Royal Slots - Quick Deposit FAB (Floating Action Button) */
(function() {
    'use strict';
    
    function createFAB() {
        var fab = document.createElement('button');
        fab.className = 'quick-deposit-fab';
        fab.innerHTML = '&#128176; Quick Deposit';
        fab.onclick = function() {
            // Trigger the existing wallet/deposit modal
            if (typeof window.showDepositModal === 'function') {
                window.showDepositModal();
            } else if (typeof window.openWalletPanel === 'function') {
                window.openWalletPanel('deposit');
            } else {
                // Fallback: look for deposit button in the UI
                var depBtn = document.querySelector('[data-action="deposit"], .deposit-btn, #deposit-btn');
                if (depBtn) depBtn.click();
            }
        };
        document.body.appendChild(fab);
        return fab;
    }
    
    var fab = null;
    
    function checkBalance() {
        // Show FAB when balance is low
        var balEl = document.querySelector('.balance-amount, .wallet-balance, [data-balance]');
        if (!balEl) return;
        var bal = parseFloat(balEl.textContent.replace(/[^0-9.]/g, ''));
        if (!fab) fab = createFAB();
        if (bal < 10 && bal >= 0) {
            fab.classList.add('visible');
        } else {
            fab.classList.remove('visible');
        }
    }
    
    // Check every 5 seconds
    setInterval(checkBalance, 5000);
    setTimeout(checkBalance, 3000);
})();