document.addEventListener('DOMContentLoaded', () => {
    // ... (All existing selections are unchanged)
    const resetBalanceBtn = document.getElementById('reset-balance-btn');

    // ... (All existing classes and functions are unchanged)

    // --- Event Listeners ---
    // ... (All existing listeners are unchanged)

    resetBalanceBtn.addEventListener('click', () => {
        wallet.balance = 1000;
        wallet.updateBalance(0); // Update UI and save to localStorage
        showMessage("Your balance has been reset to $1000.");
    });
});
