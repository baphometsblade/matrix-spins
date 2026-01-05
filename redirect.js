// redirect.js

/**
 * This script runs on the redirect.html page.
 * It's the client-side part of our dynamic affiliate link optimizer.
 */
window.addEventListener('DOMContentLoaded', () => {
    // 1. Get the original target URL from the query string.
    const urlParams = new URLSearchParams(window.location.search);
    const targetUrl = urlParams.get('target');

    if (!targetUrl) {
        console.error("Redirect router: No target URL specified.");
        // Failsafe: try to send the user somewhere sensible, like the new tab page.
        chrome.tabs.update({ url: 'chrome://newtab' });
        return;
    }

    // 2. Send a message to the background script to get the optimized link.
    chrome.runtime.sendMessage(
        {
            action: 'getOptimalAffiliateLink',
            targetUrl: targetUrl
        },
        (response) => {
            if (response && response.success) {
                // 3. Success! Redirect the user to the final, profit-optimized URL.
                console.log(`Redirecting to optimized affiliate link: ${response.finalUrl}`);
                chrome.tabs.update({ url: response.finalUrl });
            } else {
                // 4. Failsafe: If the lookup fails, send the user to the original destination.
                console.warn("Could not find an optimal affiliate link. Redirecting to original target.");
                chrome.tabs.update({ url: targetUrl });
            }
        }
    );
});
