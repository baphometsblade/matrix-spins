// --- Coupon Testing Engine ---

function applyBestCoupon(coupon, savings, config) {
    const couponField = document.querySelector(config.selectors.coupon_field);
    const modalContent = document.querySelector('#coupon-modal .modal-content');

    // 1. Apply the best coupon code one last time
    couponField.value = coupon.code;

    // 2. Update the modal UI to show the final result
    modalContent.innerHTML = `
        <span class="close-button">&times;</span>
        <h2>✅ Savings Found!</h2>
        <div id="savings-summary">
            <p>We applied the coupon <strong>${coupon.code}</strong> and saved you <strong>$${savings.toFixed(2)}</strong>!</p>
        </div>
    `;

    // Re-add the close button event listener
    document.querySelector('.close-button').onclick = () => {
        document.getElementById('coupon-modal').style.display = 'none';
    };
}

async function startCouponEngine(config) {
    // ... (logic for fetching and testing coupons is unchanged) ...

    if (bestCoupon) {
        console.log(`Best coupon found: ${bestCoupon.code} with $${maxSavings} savings.`);
        applyBestCoupon(bestCoupon, maxSavings, config);
    } else {
        statusEl.innerText = "No working coupons found.";
    }
}

// ... All other code remains unchanged ...
