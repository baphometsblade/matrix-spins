document.addEventListener('DOMContentLoaded', () => {
    // UI Elements
    const pendingBalanceEl = document.getElementById('pending-balance');
    const earnedBalanceEl = document.getElementById('earned-balance');
    const personalizedOfferEl = document.getElementById('personalized-offer');
    const offerTextEl = document.getElementById('offer-text');
    const affiliateLinksListEl = document.getElementById('affiliate-links-list');
    const settingsLink = document.getElementById('settings-link');
    const premiumStatusEl = document.getElementById('premium-status');

    // Load all relevant data from storage
    chrome.storage.local.get(
        {
            cashBackLedger: { pending: 0, earned: 0 },
            betterOffer: null,
            affiliateLinks: [],
            isPremiumUser: false
        },
        (data) => {
            // 1. Populate Rewards Dashboard
            pendingBalanceEl.textContent = `$${data.cashBackLedger.pending.toFixed(2)}`;
            earnedBalanceEl.textContent = `$${data.cashBackLedger.earned.toFixed(2)}`;

            // 2. Display Personalized Offer
            if (data.betterOffer) {
                const offerLink = document.createElement('a');
                offerLink.href = data.betterOffer.url;
                offerLink.target = '_blank';
                offerLink.textContent = data.betterOffer.text;

                offerLink.addEventListener('click', () => {
                    chrome.runtime.sendMessage({
                        type: 'offerClicked',
                        data: { offer: data.betterOffer, productTitle: data.betterOffer.productTitle }
                    });
                });

                offerTextEl.innerHTML = ''; // Clear previous content
                offerTextEl.appendChild(offerLink);
                personalizedOfferEl.style.display = 'block';
            }

            // 3. Populate Detected Links (in collapsible section)
            data.affiliateLinks.forEach(link => {
                const li = document.createElement('li');
                li.textContent = link.url;
                affiliateLinksListEl.appendChild(li);
            });

            // 4. Display Premium Status
            if (data.isPremiumUser) {
                premiumStatusEl.textContent = 'Premium User ✨';
            }
        }
    );

    // --- Event Listeners ---
    settingsLink.addEventListener('click', (e) => {
        e.preventDefault();
        chrome.runtime.openOptionsPage();
    });

    // Clear the offer when the popup closes to keep it fresh
    window.addEventListener('unload', () => {
        chrome.storage.local.remove('betterOffer');
    });
});
