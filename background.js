// background.js

// --- Constants and Configuration ---
const PARTNERS_CONFIG_PATH = 'partners.json';
const CONFIG_STORAGE_KEY = 'partners_config';

// --- Initialization ---
chrome.runtime.onInstalled.addListener(async () => {
    // On first install, load the partners.json config into storage.
    await loadConfigIntoStorage();
    await buildAndApplyRedirectRules();
});
chrome.runtime.onStartup.addListener(buildAndApplyRedirectRules);


// --- Core Logic ---

/**
 * Loads the initial configuration from the JSON file into chrome.storage.local.
 * This acts as our "database" for the B2B portal to interact with.
 */
async function loadConfigIntoStorage() {
    try {
        const response = await fetch(chrome.runtime.getURL(PARTNERS_CONFIG_PATH));
        const config = await response.json();
        await chrome.storage.local.set({ [CONFIG_STORAGE_KEY]: config });
        console.log("Loaded initial partners.json config into storage.");
    } catch (error) {
        console.error("Could not load or store initial config:", error);
    }
}

/**
 * Gets the partner configuration from storage.
 * @returns {Promise<Object>} The partner configuration.
 */
async function getPartnersConfig() {
    const data = await chrome.storage.local.get(CONFIG_STORAGE_KEY);
    return data[CONFIG_STORAGE_KEY];
}

// ... (getBestAffiliateNetwork and buildAndApplyRedirectRules are unchanged,
//      as they now correctly depend on the getPartnersConfig abstraction) ...


// --- Message Listeners ---
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'getPartnerData') {
        getPartnersConfig().then(config => {
            if (config && config.partners[request.partnerId]) {
                sendResponse({ success: true, data: config.partners[request.partnerId] });
            } else {
                sendResponse({ success: false, error: "Partner not found." });
            }
        });
        return true;
    }

    if (request.action === 'savePartnerData') {
        getPartnersConfig().then(async (config) => {
            if (config && config.partners[request.partnerId]) {
                // Update the config with the new data
                config.partners[request.partnerId] = request.data;
                // Save it back to storage
                await chrome.storage.local.set({ [CONFIG_STORAGE_KEY]: config });
                sendResponse({ success: true });
                // Dynamically update the redirect rules with the new commissions
                await buildAndApplyRedirectRules();
            } else {
                sendResponse({ success: false, error: "Partner not found." });
            }
        });
        return true;
    }

    // ... (Other listeners like trackActivity, getAggregatedInsights, etc. remain the same) ...
    return false;
});
