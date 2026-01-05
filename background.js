// Global constants, config loading, etc. remain the same...
const PRICE_WATCH_ALARM = 'priceWatchAlarm';

// --- Price Watch Logic ---

// Adds a product to the user's watch list, initializing its price history.
function watchProduct(product) {
    chrome.storage.local.get({ watchedProducts: [], isPremiumUser: false }, (data) => {
        if (!data.isPremiumUser) {
            console.log('Price Watch is a premium feature.');
            // In a real app, you might trigger a UI element asking them to upgrade.
            return;
        }

        const newWatchedProduct = {
            ...product,
            originalPrice: product.price, // Keep track of the starting price
            priceHistory: [{ date: new Date().toISOString(), price: product.price }]
        };

        const updatedList = [newWatchedProduct, ...data.watchedProducts];
        chrome.storage.local.set({ watchedProducts: updatedList });
        console.log('Product added to watch list with price history:', newWatchedProduct);
    });
}

// Periodically checks for price drops and records the price history.
async function checkPrices() {
    console.log("Checking prices and recording history...");
    const { watchedProducts } = await chrome.storage.local.get({ watchedProducts: [] });
    if (!watchedProducts.length) return;

    let productsWereUpdated = false;
    const updatedProducts = watchedProducts.map(product => {
        // --- This section is a simulation of fetching a new price ---
        const currentPriceNumber = parseFloat(product.price.replace('$', ''));
        // To make the history interesting, we'll simulate a random fluctuation.
        const fluctuation = (Math.random() - 0.4) * 0.1; // Fluctuate by up to ~10%
        const simulatedNewPrice = (currentPriceNumber * (1 + fluctuation)).toFixed(2);
        const newPriceString = `$${simulatedNewPrice}`;
        // --- End of simulation ---

        // Always record the new price in the history
        const newHistoryEntry = { date: new Date().toISOString(), price: newPriceString };
        const updatedHistory = [...product.priceHistory, newHistoryEntry];

        productsWereUpdated = true;

        // If the price dropped below the last recorded price, send a notification.
        if (newPriceString < product.price) {
            console.log(`Price drop detected for ${product.title}!`);
            chrome.notifications.create(`price-drop-${product.url}`, {
                type: 'basic',
                iconUrl: 'icon.png',
                title: 'Price Drop Alert!',
                message: `${product.title} is now ${newPriceString}!`,
                buttons: [{ title: 'Buy Now' }]
            });
        }

        return {
            ...product,
            price: newPriceString, // Update the current price
            priceHistory: updatedHistory
        };
    });

    if (productsWereUpdated) {
        await chrome.storage.local.set({ watchedProducts: updatedProducts });
        console.log("Price history updated for watched products.");
    }
}

// --- Alarms, Initialization, and other listeners remain the same ---
// ... (The rest of the background.js file remains unchanged) ...
// The existing alarm setup, notification click handler, and message listeners are all still here.
