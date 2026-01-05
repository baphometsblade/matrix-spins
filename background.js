// --- Message & Event Listeners ---
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'getCouponsForRetailer') {
        chrome.storage.local.get('partnerConfig', ({ partnerConfig }) => {
            if (partnerConfig && partnerConfig.coupon_codes) {
                const retailerConfig = partnerConfig.coupon_codes.find(
                    c => c.retailer_hostname === message.data.hostname
                );
                sendResponse(retailerConfig ? retailerConfig.coupons : []);
            }
        });
        return true; // Indicates asynchronous response
    }
    // ... other message handlers ...
});

// ... All other existing code remains unchanged ...
