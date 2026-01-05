// --- Authentication & UI Control ---
// ... (Authentication and UI update logic remains largely unchanged) ...
async function updateUIForLogin(userId) {
    // ... (logic to show/hide upgrade card is still here) ...
    loadPortalData(userId); // Pass userId to loadPortalData
}
// ...

// --- Data Loading & Feature Initialization ---
async function loadPortalData(userId) {
    const userData = await getUserData();
    if (!userData) return;

    loadRewards(userData);
    loadWatchedProducts(userData);
    loadPartnerStores();
    loadSponsoredProducts();
    initializeReferralSection(userId); // <-- New function call
}

// ... (loadRewards, etc. are unchanged) ...

// --- New Functions for Referral Program ---
function initializeReferralSection(userId) {
    const referralCodeEl = document.getElementById('referral-code');
    const applyButton = document.getElementById('apply-referral-button');

    // Generate and display the user's own referral code
    const userReferralCode = `REF-${userId.toUpperCase().substring(0, 4)}`;
    referralCodeEl.textContent = userReferralCode;

    // Add event listener for applying a code
    applyButton.addEventListener('click', handleApplyReferral);
}

function handleApplyReferral() {
    const input = document.getElementById('referral-input');
    const statusEl = document.getElementById('referral-status');
    const code = input.value.trim();

    if (!code) {
        statusEl.textContent = 'Please enter a code.';
        statusEl.style.color = 'orange';
        return;
    }

    statusEl.textContent = 'Applying...';
    chrome.runtime.sendMessage({ action: 'applyReferralCode', code }, (response) => {
        if (response.success) {
            statusEl.textContent = 'Success! $5 bonus applied to your rewards.';
            statusEl.style.color = '#34c759'; // Green
            // Reload rewards to show the new bonus
            getUserData().then(loadRewards);
        } else {
            let message = 'An error occurred.';
            if (response.reason === 'invalid_code') {
                message = 'This referral code is not valid.';
            } else if (response.reason === 'login_required') {
                message = 'You must be logged in to apply a code.';
            }
            statusEl.textContent = message;
            statusEl.style.color = '#ff3b30'; // Red
        }
    });
}


// --- Existing Functions (Callbacks for features) ---
// ... (loadRewards, loadWatchedProducts, loadPartnerStores, loadSponsoredProducts, handleAddProduct, etc.)
// Note: No changes are needed in the other functions.
function loadRewards(userData) { /* ... */ }
function loadWatchedProducts(userData) { /* ... */ }
function loadPartnerStores() { /* ... */ }
function loadSponsoredProducts() { /* ... */ }
async function handleAddProduct() { /* ... */ }

// Make sure to attach the event listener for login
document.addEventListener('DOMContentLoaded', () => {
    // ... auth listeners
});
