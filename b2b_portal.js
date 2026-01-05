// b2b_portal.js

// --- Global variable to hold the current partner's data ---
let currentPartnerData = null;

document.addEventListener('DOMContentLoaded', () => {
    // ... (Login/logout event listeners are unchanged) ...
    const saveBidsButton = document.getElementById('save-bids-button');
    if (saveBidsButton) {
        saveBidsButton.addEventListener('click', handleSaveBids);
    }
});

// --- Authentication ---
function showDashboard(partnerId) {
    document.getElementById('login-screen').style.display = 'none';
    document.getElementById('dashboard-screen').style.display = 'block';
    document.getElementById('partner-welcome').textContent = `Welcome, ${partnerId}`;

    // Load both the data visualization and the new bidding controls
    loadInsights(partnerId);
    loadBiddingControls(partnerId);
}

function showLoginScreen() { /* ... unchanged ... */ }


// --- B2B Data Visualization (Unchanged) ---
async function loadInsights(partnerId) { /* ... */ }
function renderInsightsChart(labels, viewsData, addToCartsData) { /* ... */ }


// --- NEW: Commission Bidding System ---

/**
 * Fetches the partner's data and dynamically builds the bidding UI.
 * @param {string} partnerId The ID of the logged-in partner.
 */
function loadBiddingControls(partnerId) {
    // Message the background script to get the partner's config
    chrome.runtime.sendMessage({ action: 'getPartnerData', partnerId }, (response) => {
        const container = document.getElementById('bidding-controls');
        if (response && response.success) {
            currentPartnerData = response.data; // Store for later saving
            let html = '';

            // Create controls for affiliate networks
            if (currentPartnerData.affiliateNetworks) {
                html += '<h4>Affiliate Network Commissions (%)</h4>';
                currentPartnerData.affiliateNetworks.forEach((network, index) => {
                    html += `
                        <div class="commission-bid-row">
                            <label for="aff-net-${index}">${network.name}</label>
                            <input type="number" id="aff-net-${index}" value="${network.baseCommission}" step="0.1" min="0">
                        </div>
                    `;
                });
            }

            // In a full implementation, you'd add controls for coupons here too.
            // This demonstrates the core affiliate bidding functionality.

            container.innerHTML = html;
        } else {
            container.innerHTML = '<p>Could not load commission data.</p>';
            console.error(response.error);
        }
    });
}

/**
 * Reads the new values from the UI, updates the data object, and saves it.
 */
function handleSaveBids() {
    const partnerId = sessionStorage.getItem('loggedInPartner');
    const statusEl = document.getElementById('save-status');

    if (!partnerId || !currentPartnerData) {
        statusEl.textContent = 'Error: No partner data loaded.';
        statusEl.style.display = 'block';
        return;
    }

    // Update the data object with the new values from the input fields
    if (currentPartnerData.affiliateNetworks) {
        currentPartnerData.affiliateNetworks.forEach((network, index) => {
            const input = document.getElementById(`aff-net-${index}`);
            network.baseCommission = parseFloat(input.value);
        });
    }

    // Send the updated data back to the background script
    chrome.runtime.sendMessage(
        { action: 'savePartnerData', partnerId, data: currentPartnerData },
        (response) => {
            if (response && response.success) {
                statusEl.textContent = 'Changes saved successfully! Redirect rules have been updated.';
                statusEl.style.color = '#34c759';
            } else {
                statusEl.textContent = 'Error saving changes.';
                statusEl.style.color = '#ff3b30';
            }
            statusEl.style.display = 'block';
            setTimeout(() => { statusEl.style.display = 'none'; }, 4000);
        }
    );
}
