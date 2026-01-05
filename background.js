// background.js

// --- Constants and Configuration ---
const PARTNERS_CONFIG_PATH = 'partners.json';

// --- Dynamic User ID Management ---
/**
 * Gets the unique user ID for the extension instance, creating one if it doesn't exist.
 * @returns {Promise<string>} The unique user ID.
 */
async function getUserId() {
    let data = await chrome.storage.local.get('userId');
    if (data.userId) {
        return data.userId;
    }
    // Generate a new unique ID using the Web Crypto API
    const newUserId = `user_${crypto.randomUUID()}`;
    await chrome.storage.local.set({ userId: newUserId });
    console.log("New user ID generated:", newUserId);
    return newUserId;
}


// --- User Data Management ---
async function getCurrentUserData() {
    const userId = await getUserId();
    const key = `user_${userId}`;
    const data = await chrome.storage.local.get(key);
    return data[key] || { id: userId, isPremiumUser: false };
}

async function saveCurrentUserData(userData) {
    const userId = await getUserId();
    const key = `user_${userId}`;
    await chrome.storage.local.set({ [key]: userData });
    return true;
}

async function upgradeUserToPremium() {
    const userData = await getCurrentUserData();
    userData.isPremiumUser = true;
    await saveCurrentUserData(userData);
    console.log("User upgraded to Premium.");
    return true;
}


// --- Dynamic Affiliate Link Optimizer (Unchanged) ---
async function getPartnersConfig() { /* ... */ }
async function getBestAffiliateNetwork(domain) { /* ... */ }
async function buildAndApplyRedirectRules() { /* ... */ }


// --- Data Pipeline Services ---
async function storeUserActivity(event) {
    const userId = await getUserId();
    const storageKey = `activity_${userId}`;
    try {
        const data = await chrome.storage.local.get(storageKey);
        const activityLog = data[storageKey] || [];
        activityLog.push(event);
        await chrome.storage.local.set({ [storageKey]: activityLog });
    } catch (error) {
        console.error("Error storing user activity:", error);
    }
}

async function getAggregatedInsights() {
    const allData = await chrome.storage.local.get(null);
    const insights = {};
    for (const key in allData) {
        if (key.startsWith('activity_')) {
            const activityLog = allData[key];
            for (const event of activityLog) {
                if (!event.productTitle) continue;
                const productName = event.productTitle.trim().toLowerCase();
                if (!insights[productName]) {
                    insights[productName] = { productName: event.productTitle.trim(), views: 0, addToCarts: 0 };
                }
                if (event.type === 'productView') insights[productName].views++;
                else if (event.type === 'addToCart') insights[productName].addToCarts++;
            }
        }
    }
    console.log("--- Aggregated B2B Data Insights ---", insights);
    return insights;
}


// --- Initialization & Event Listeners ---
chrome.runtime.onInstalled.addListener(() => {
    getUserId(); // Ensure a user ID is created on first install
    buildAndApplyRedirectRules();
});
chrome.runtime.onStartup.addListener(buildAndApplyRedirectRules);

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    // ... (All message listeners remain the same, but now implicitly use the dynamic user ID)
});
