document.addEventListener('DOMContentLoaded', () => {
    const smartRedirectionToggle = document.getElementById('smart-redirection-toggle');
    const cookieLockToggle = document.getElementById('cookie-lock-toggle');
    const premiumFeatures = document.getElementById('premium-features');
    const upgradeMessage = document.getElementById('upgrade-message');
    const pendingBalanceEl = document.getElementById('pending-balance');
    const earnedBalanceEl = document.getElementById('earned-balance');
    const transactionsBodyEl = document.getElementById('transactions-body');

    // Load all settings and user data from storage
    chrome.storage.local.get(
        {
            smartRedirectionEnabled: false,
            cookieLockEnabled: false,
            isPremiumUser: false,
            cashBackLedger: { pending: 0, earned: 0, transactions: [] }
        },
        (data) => {
            // --- Controls ---
            smartRedirectionToggle.checked = data.smartRedirectionEnabled;
            cookieLockToggle.checked = data.cookieLockEnabled;
            if (data.isPremiumUser) {
                premiumFeatures.style.display = 'block';
            } else {
                upgradeMessage.style.display = 'block';
            }

            // --- Cash Back Ledger ---
            pendingBalanceEl.textContent = `$${data.cashBackLedger.pending.toFixed(2)}`;
            earnedBalanceEl.textContent = `$${data.cashBackLedger.earned.toFixed(2)}`;

            data.cashBackLedger.transactions.forEach(tx => {
                const row = transactionsBodyEl.insertRow();
                row.innerHTML = `
                    <td>${new Date(tx.date).toLocaleDateString()}</td>
                    <td>${tx.description}</td>
                    <td>$${tx.amount.toFixed(2)}</td>
                    <td>${tx.status}</td>
                `;
            });
        }
    );

    // --- Event Listeners for Controls ---
    smartRedirectionToggle.addEventListener('change', () => {
        chrome.storage.local.set({ smartRedirectionEnabled: smartRedirectionToggle.checked });
    });

    cookieLockToggle.addEventListener('change', () => {
        chrome.storage.local.set({ cookieLockEnabled: cookieLockToggle.checked });
    });
});
