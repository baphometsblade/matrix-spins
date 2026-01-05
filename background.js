// background.js

// --- Constants and Configuration ---
const PARTNERS_CONFIG_PATH = 'partners.json';
const RULE_ID_PREFIX = 'affiliate_redirect_';

// --- Core Logic ---

/**
 * Fetches the partner configuration from partners.json.
 * @returns {Promise<Object>} The parsed partner configuration.
 */
async function getPartnersConfig() {
    try {
        const response = await fetch(chrome.runtime.getURL(PARTNERS_CONFIG_PATH));
        if (!response.ok) {
            throw new Error(`Failed to fetch partners config: ${response.statusText}`);
        }
        return await response.json();
    } catch (error) {
        console.error("Could not load or parse partners.json:", error);
        return null;
    }
}

/**
 * Clears all existing dynamic rules for this extension.
 */
async function clearExistingRules() {
    const existingRules = await chrome.declarativeNetRequest.getDynamicRules();
    const ruleIds = existingRules.map(rule => rule.id);
    if (ruleIds.length > 0) {
        console.log("Clearing existing rules:", ruleIds);
        await chrome.declarativeNetRequest.updateDynamicRules({ removeRuleIds: ruleIds });
    }
}

/**
 * Builds and applies the redirection rules based on the partner configuration.
 * This is the core of the last-click attribution engine.
 * @param {Object} config The partner configuration.
 */
async function buildAndApplyRedirectRules(config) {
    if (!config || !config.partnerDomains || !config.affiliateTrackerUrl) {
        console.error("Invalid partner configuration. Cannot build redirect rules.");
        return;
    }

    const newRules = config.partnerDomains.map((domain, index) => ({
        id: index + 1, // Rule IDs must be > 0
        priority: 1,
        action: {
            type: 'redirect',
            redirect: {
                // The redirectUrl is our tracker, with the original destination appended.
                // The affiliate network is responsible for forwarding the user.
                transform: {
                    scheme: 'https',
                    host: new URL(config.affiliateTrackerUrl).hostname,
                    path: new URL(config.affiliateTrackerUrl).pathname,
                    queryTransform: {
                        // Adds a query param like "redirectUrl=https://www.amazon.com/product"
                        addOrReplaceParams: [{
                            key: 'redirectUrl',
                            value: '%req_url%' // A custom value to be replaced with the original request URL
                        }]
                    }
                }
            }
        },
        condition: {
            urlFilter: `*://${domain}/`, // Matches the partner domain
            resourceTypes: ['main_frame'] // Only apply to top-level navigation
        }
    }));

    if (newRules.length > 0) {
        try {
            await clearExistingRules();
            await chrome.declarativeNetRequest.updateDynamicRules({ addRules: newRules });
            console.log("Successfully applied last-click attribution rules for:", config.partnerDomains);
        } catch (error) {
            console.error("Error applying declarativeNetRequest rules:", error);
        }
    }
}


/**
 * Initializes the extension by loading the config and setting up the rules.
 */
async function initialize() {
    const config = await getPartnersConfig();
    if (config) {
        await buildAndApplyRedirectRules(config);
    }
}

// --- Event Listeners ---

// Run the initialization logic when the extension is first installed or updated.
chrome.runtime.onInstalled.addListener(initialize);

// Also run on browser startup, in case the rules were cleared.
chrome.runtime.onStartup.addListener(initialize);
