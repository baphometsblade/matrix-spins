// --- Modal Control Functions ---
const modal = document.getElementById('premium-upsell-modal');
const closeModalButton = document.getElementById('close-modal-button');

function showPremiumModal() {
    if (modal) modal.style.display = 'flex';
}

function hidePremiumModal() {
    if (modal) modal.style.display = 'none';
}

// Add event listener to close the modal
if (closeModalButton) {
    closeModalButton.addEventListener('click', hidePremiumModal);
}


// --- Authentication & UI Control ---
// ... (Authentication logic is unchanged) ...
async function updateUIForLogin(userId) {
    document.getElementById('auth-status').innerHTML = `<span id="user-info">Welcome, ${userId}!</span> <button id="logout-button">Logout</button>`;
    document.querySelector('.grid-container').style.display = 'grid';

    // --- REMOVED: Old passive upgrade card logic ---
    // document.getElementById('upgrade-card').style.display = 'none';

    loadPortalData(userId);
}
// ...


// --- Feature Logic ---

async function handleAddProduct() {
    // ... (Getting input values is unchanged) ...
    const product = { /* ... */ };

    chrome.runtime.sendMessage({ action: 'watchProduct', product }, (response) => {
        if (response.success) {
            // ... (Success logic is unchanged) ...
        } else {
            // --- NEW: Aggressive Upsell Trigger ---
            // Instead of showing a simple text error, we now trigger the modal.
            if (response.reason === 'premium_required' || response.reason === 'limit_reached') {
                showPremiumModal(); // Display the high-friction modal
            } else {
                // Handle other errors normally
                const statusEl = document.getElementById('watch-product-status');
                statusEl.textContent = 'An unknown error occurred.';
                statusEl.style.display = 'block';
            }
        }
    });
}


// --- All other functions remain the same ---
// ... (loadPortalData, loadRewards, loadWatchedProducts, etc.) ...
// Note: We are no longer manipulating the old `#upgrade-card`.
function loadWatchedProducts(userData) {
    // ... (The form and button are still created here) ...
    document.getElementById('add-product-button').addEventListener('click', handleAddProduct);
    // ...
}
// ... Rest of the file is unchanged
