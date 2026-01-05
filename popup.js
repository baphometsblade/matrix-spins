document.addEventListener('DOMContentLoaded', () => {
    // UI Elements
    const featuredDealsEl = document.getElementById('featured-deals');
    // ... other element getters for rewards dashboard ...

    // Load all relevant data from storage
    chrome.storage.local.get(
        {
            partnerConfig: null,
            // ... other data ...
        },
        (data) => {
            // 1. Populate Featured Deals Marketplace
            if (data.partnerConfig && data.partnerConfig.featured_deals) {
                data.partnerConfig.featured_deals.forEach(deal => {
                    const card = document.createElement('div');
                    card.className = 'deal-card';
                    card.innerHTML = `
                        <h3>${deal.title}</h3>
                        <p>${deal.description} <a href="${deal.url}" target="_blank">Shop Now</a></p>
                    `;
                    featuredDealsEl.appendChild(card);
                });
            }

            // 2. Populate Rewards Dashboard (in collapsible section)
            // ... existing rewards dashboard rendering logic ...
        }
    );

    // ... existing event listeners ...
});
