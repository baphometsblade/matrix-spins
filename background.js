// Global constants and initial setup...
const MAX_STORED_LINKS = 100;
const REDIRECT_RULE_ID = 1;
const CONFIG_URL = chrome.runtime.getURL('partners.json');
const BROWSING_HISTORY_LENGTH = 10;

// --- Configuration Management ---
async function loadConfiguration() { /* ... unchanged ... */ }
function updateRedirectionRules() { /* ... unchanged ... */ }
chrome.storage.onChanged.addListener((changes) => { if (changes.smartRedirectionEnabled) updateRedirectionRules(); });
chrome.runtime.onStartup.addListener(loadConfiguration);
chrome.runtime.onInstalled.addListener(loadConfiguration);


// --- Intelligent Offer Engine ---

// Maintains a list of recently viewed product categories.
function updateBrowsingHistory(productData) {
    chrome.storage.local.get({ browsingHistory: [], partnerConfig: null }, ({ browsingHistory, partnerConfig }) => {
        if (!partnerConfig || !partnerConfig.product_offers) return;

        // Find the category for the current product from our config
        const offer = partnerConfig.product_offers.find(o =>
            o.product_title_keywords.some(k => productData.title.includes(k))
        );

        if (offer && offer.category) {
            const updatedHistory = [offer.category, ...browsingHistory].slice(0, BROWSING_HISTORY_LENGTH);
            chrome.storage.local.set({ browsingHistory: updatedHistory });
        }
    });
}

// Finds a direct match or a proactive offer based on browsing history.
function findBetterOffer(productData) {
    chrome.storage.local.get({ partnerConfig: null, browsingHistory: [] }, ({ partnerConfig, browsingHistory }) => {
        if (!partnerConfig) return;

        // 1. Check for a direct product match first.
        const directOffer = partnerConfig.product_offers.find(o =>
            o.original_site === productData.site &&
            o.product_title_keywords.some(k => productData.title.includes(k))
        );

        if (directOffer) {
            console.log('Direct offer found:', directOffer);
            chrome.storage.local.set({ betterOffer: { ...directOffer.offer, productTitle: productData.title } });
            return;
        }

        // 2. If no direct match, look for a proactive, category-based offer.
        if (browsingHistory.length > 0) {
            // Find the most frequent category in recent history
            const frequentCategory = browsingHistory.reduce((a, b, i, arr) => (arr.filter(v => v === a).length >= arr.filter(v => v === b).length ? a : b), null);

            if (frequentCategory) {
                const proactiveOffer = partnerConfig.category_offers.find(co => co.category === frequentCategory);
                if (proactiveOffer) {
                    console.log('Proactive offer found:', proactiveOffer);
                    // Personalize the offer text
                    const personalizedText = proactiveOffer.offer.text.replace('{category}', frequentCategory);
                    chrome.storage.local.set({ betterOffer: { ...proactiveOffer.offer, text: personalizedText, productTitle: `Deals on ${frequentCategory}` } });
                    return;
                }
            }
        }

        // 3. No offers found, clear any old one.
        chrome.storage.local.remove('betterOffer');
    });
}

// --- Cash Back & Other Logic (mostly unchanged) ---
function addPendingTransaction(offer, productTitle) { /* ... unchanged ... */ }
function addAffiliateLink(link) { /* ... unchanged ... */ }

// --- Message & Event Listeners ---
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'productDetected') {
      updateBrowsingHistory(message.data);
      findBetterOffer(message.data);
  } else if (message.type === 'offerClicked') {
      addPendingTransaction(message.data.offer, message.data.productTitle);
  }
  // Other handlers...
});

// Other listeners (onBeforeRequest, onChanged) are unchanged.
chrome.webRequest.onBeforeRequest.addListener( (details) => { /* ... unchanged ... */ }, { urls: ['<all_urls>'] });
chrome.cookies.onChanged.addListener((changeInfo) => { /* ... unchanged ... */ });
