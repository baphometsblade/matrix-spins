// content.js

// --- Constants and Configuration ---
const CHECKOUT_PAGE_IDENTIFIERS = ['checkout', 'cart', 'basket']; // Keywords to identify checkout pages
const COUPON_INPUT_SELECTORS = 'input[name*="coupon"], input[name*="voucher"], input[id*="coupon"]';
const APPLY_BUTTON_SELECTORS = 'button[type*="submit"], button:contains("Apply")';

// --- Core Logic ---

/**
 * Fetches the coupon configuration for the current domain.
 * @returns {Promise<Object|null>} The coupon configuration or null if not found.
 */
async function getCouponsForCurrentDomain() {
    try {
        const response = await fetch(chrome.runtime.getURL('partners.json'));
        const config = await response.json();
        const currentHostname = new URL(window.location.href).hostname;

        // Find the partner config that matches the current site
        return config.coupons[currentHostname] || null;
    } catch (error) {
        console.error("Error fetching or parsing coupon config:", error);
        return null;
    }
}

/**
 * Finds the coupon that maximizes our commission.
 * This is the core of the "commission-first" strategy.
 * @param {Array<Object>} coupons The list of available coupons.
 * @returns {Object} The best coupon to apply.
 */
function findBestCommissionCoupon(coupons) {
    if (!coupons || coupons.length === 0) {
        return null;
    }
    // Sort by commissionRate in descending order and return the first one
    return coupons.sort((a, b) => b.commissionRate - a.commissionRate)[0];
}

/**
 * Simulates the process of trying and applying a coupon.
 * @param {string} couponCode The coupon code to apply.
 */
function applyCoupon(couponCode) {
    const couponInput = document.querySelector(COUPON_INPUT_SELECTORS);
    const applyButton = document.querySelector(APPLY_BUTTON_SELECTORS);

    if (couponInput && applyButton) {
        console.log(`Applying profit-optimized coupon: ${couponCode}`);
        // Simulate user input
        couponInput.value = couponCode;
        couponInput.dispatchEvent(new Event('input', { bubbles: true }));

        // Click the apply button
        applyButton.click();
    } else {
        console.warn("Could not find coupon input or apply button on this page.");
    }
}

/**
 * Creates a subtle UI element to inform the user we are "testing" coupons.
 * This is the "theater" aspect of the strategy.
 */
function showCouponTestingUI() {
    const ui = document.createElement('div');
    ui.id = 'profitmax-coupon-tester';
    ui.style.position = 'fixed';
    ui.style.bottom = '20px';
    ui.style.right = '20px';
    ui.style.backgroundColor = 'white';
    ui.style.padding = '20px';
    ui.style.border = '1px solid #ccc';
    ui.style.borderRadius = '8px';
    ui.style.zIndex = '9999';
    ui.innerHTML = '<p><strong>ProfitMax Shopper:</strong> Testing coupons for the best deal...</p>';
    document.body.appendChild(ui);
    return ui;
}

/**
 * The main function that orchestrates the coupon application process.
 */
async function runCouponEngine() {
    const coupons = await getCouponsForCurrentDomain();
    if (!coupons) {
        console.log("No coupons available for this domain.");
        return;
    }

    const bestCoupon = findBestCommissionCoupon(coupons);
    if (bestCoupon) {
        const ui = showCouponTestingUI();
        // Wait a few seconds to simulate "testing"
        setTimeout(() => {
            applyCoupon(bestCoupon.code);
            ui.innerHTML = `<p><strong>ProfitMax Shopper:</strong> Applied coupon for ${bestCoupon.userDiscount}% off!</p>`;
            // The UI can be removed after a few more seconds
            setTimeout(() => ui.remove(), 3000);
        }, 2000);
    }
}


// --- Initialization ---

// Check if the current page URL suggests it's a checkout page.
const isCheckoutPage = CHECKOUT_PAGE_IDENTIFIERS.some(keyword =>
    window.location.href.includes(keyword)
);

if (isCheckoutPage) {
    // Run the engine when the page is fully loaded
    window.addEventListener('load', runCouponEngine);
}
