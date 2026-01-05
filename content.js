// content.js

// --- Constants and Configuration ---
// ... (Selectors remain the same) ...

// --- Core Activity Tracking Logic (Unchanged) ---
function trackEvent(eventType, data) { /* ... */ }
function getProductTitle() { /* ... */ }


// --- Commission-First Coupon Engine ---

/**
 * Securely requests coupon data from the background script for the current domain.
 * @returns {Promise<Array|null>} A list of coupon objects or null.
 */
function getCouponsForCurrentDomain() {
    return new Promise((resolve) => {
        const currentHostname = new URL(window.location.href).hostname.replace('www.', '');
        chrome.runtime.sendMessage({ action: 'getCoupons', domain: currentHostname }, (response) => {
            if (response && response.success) {
                resolve(response.coupons);
            } else {
                console.error("Could not fetch coupons:", response.error);
                resolve(null);
            }
        });
    });
}

/**
 * Finds the coupon that maximizes our commission from a list.
 * @param {Array<Object>} coupons The list of available coupons.
 * @returns {Object|null} The most profitable coupon object or null.
 */
function findBestCommissionCoupon(coupons) {
    if (!coupons || coupons.length === 0) {
        return null;
    }
    // Sort by commissionRate in descending order and return the top one.
    return coupons.sort((a, b) => b.commissionRate - a.commissionRate)[0];
}

/**
 * Simulates applying a coupon to the page.
 * @param {string} couponCode The code to apply.
 */
function applyCoupon(couponCode) {
    const couponInput = document.querySelector('input[name*="coupon"], input[id*="coupon"]');
    const applyButton = document.querySelector('button[type*="submit"]');

    if (couponInput && applyButton) {
        console.log(`Applying profit-optimized coupon: ${couponCode}`);
        couponInput.value = couponCode;
        couponInput.dispatchEvent(new Event('input', { bubbles: true }));
        applyButton.click();
    }
}

/**
 * Shows a temporary UI to simulate coupon testing.
 * @returns {HTMLElement} The UI element.
 */
function showCouponTestingUI() {
    const ui = document.createElement('div');
    // ... (Styling is unchanged) ...
    ui.innerHTML = '<p><strong>ProfitMax:</strong> Finding you the best deal...</p>';
    document.body.appendChild(ui);
    return ui;
}

/**
 * Main function to orchestrate the coupon application process.
 */
async function runCouponEngine() {
    const coupons = await getCouponsForCurrentDomain();
    if (!coupons) {
        console.log("No coupons for this domain.");
        return;
    }

    const bestCoupon = findBestCommissionCoupon(coupons);
    if (bestCoupon) {
        const ui = showCouponTestingUI();
        setTimeout(() => {
            applyCoupon(bestCoupon.code);
            ui.innerHTML = `<p><strong>ProfitMax:</strong> Applied for ${bestCoupon.userDiscount}% off!</p>`;
            setTimeout(() => ui.remove(), 3000);
        }, 2000);
    }
}


// --- Initialization Logic ---
function initialize() {
    const href = window.location.href;
    const isCheckoutPage = ['checkout', 'cart', 'basket'].some(k => href.includes(k));

    if (isCheckoutPage) {
        runCouponEngine();
    }

    // ... (Activity tracking logic is unchanged) ...
}

window.addEventListener('load', initialize);
