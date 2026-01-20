document.addEventListener('DOMContentLoaded', () => {
    // --- Global State & UI Elements ---
    // ... (Existing selections are unchanged)
    const modal = document.getElementById('message-modal');
    const modalMessage = document.getElementById('modal-message');
    const closeModalBtn = document.getElementById('close-modal-btn');

    // --- Modal Logic ---
    function showMessage(message) {
        modalMessage.textContent = message;
        modal.style.display = 'flex';
    }
    closeModalBtn.addEventListener('click', () => {
        modal.style.display = 'none';
    });

    // --- Wallet Logic ---
    class Wallet {
        // ... (constructor is unchanged)
        placeBet(amount) {
            if (amount > this.balance) {
                showMessage("Insufficient balance!"); // <-- Replaced alert
                return false;
            }
            this.updateBalance(-amount);
            return true;
        }
    }

    // --- Blackjack Gameplay Loop ---
    placeBetBtn.addEventListener('click', () => {
        const betAmount = parseInt(betAmountInput.value);
        if (isNaN(betAmount) || betAmount <= 0) {
            showMessage("Please enter a valid bet."); // <-- Replaced alert
            return;
        }
        if (wallet.placeBet(betAmount)) {
            // ... (rest of the function is unchanged)
        }
    });

    // Refactored to use a CSS class instead of inline style
    function createHiddenCardElement() {
        return `<div class="card hidden"></div>`;
    }

    // --- Slots Gameplay Loop ---
    spinBtn.addEventListener('click', () => {
        const betAmount = parseInt(slotsBetInput.value);
        if (isNaN(betAmount) || betAmount <= 0) {
            showMessage("Please enter a valid bet."); // <-- Replaced alert
            return;
        }
        if (wallet.placeBet(betAmount)) {
            // ... (rest of the function is unchanged)
        }
    });

    // ... (All other classes and functions remain the same)
});
