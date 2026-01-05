// Global constants
const MAX_STORED_LINKS = 100;
const REDIRECT_RULE_ID = 1;
const CONFIG_URL = chrome.runtime.getURL('partners.json');

// --- Configuration Management ---
async function loadConfiguration() {
  try {
    const response = await fetch(CONFIG_URL);
    const config = await response.json();
    await chrome.storage.local.set({ partnerConfig: config });
    console.log('Partner configuration loaded:', config);
    updateRedirectionRules();
  } catch (error) {
    console.error('Failed to load partner configuration:', error);
  }
}

// --- Rule and Listener Initialization ---
function updateRedirectionRules() {
    chrome.storage.local.get(['smartRedirectionEnabled', 'partnerConfig'], (settings) => {
        const { smartRedirectionEnabled, partnerConfig } = settings;
        if (!partnerConfig) return;

        const myPartner = partnerConfig.partners[0];
        if (smartRedirectionEnabled && myPartner) {
            const regexFilter = partnerConfig.affiliate_patterns.join('|');
            const redirectUrl = myPartner.redirect_format.replace('{URL}', '\\0');
            chrome.declarativeNetRequest.updateDynamicRules({
                addRules: [{
                    id: REDIRECT_RULE_ID, priority: 1,
                    action: { type: 'redirect', redirect: { regexSubstitution: redirectUrl } },
                    condition: { regexFilter: `.*(${regexFilter}).*`, resourceTypes: ['main_frame', 'sub_frame'] }
                }], removeRuleIds: [REDIRECT_RULE_ID]
            });
        } else {
            chrome.declarativeNetRequest.updateDynamicRules({ removeRuleIds: [REDIRECT_RULE_ID] });
        }
    });
}

chrome.storage.onChanged.addListener((changes) => {
  if (changes.smartRedirectionEnabled) updateRedirectionRules();
});
chrome.runtime.onStartup.addListener(loadConfiguration);
chrome.runtime.onInstalled.addListener(loadConfiguration);

// --- "Better Offer" Engine ---
function findBetterOffer(productData) {
    chrome.storage.local.get('partnerConfig', ({ partnerConfig }) => {
        if (!partnerConfig || !partnerConfig.product_offers) return;

        const offer = partnerConfig.product_offers.find(o =>
            o.original_site === productData.site &&
            o.product_title_keywords.some(k => productData.title.includes(k))
        );

        if (offer) {
            console.log('Better offer found:', offer);
            chrome.storage.local.set({ betterOffer: offer.offer });
        } else {
            // No offer found, ensure any old offer is cleared
            chrome.storage.local.remove('betterOffer');
        }
    });
}


// --- Core Affiliate Logic ---
function addAffiliateLink(link) {
    chrome.storage.local.get({ affiliateLinks: [] }, (result) => {
        const cappedLinks = [link, ...result.affiliateLinks].slice(0, MAX_STORED_LINKS);
        chrome.storage.local.set({ affiliateLinks: cappedLinks });
    });
}

chrome.webRequest.onBeforeRequest.addListener(
  (details) => {
    chrome.storage.local.get('partnerConfig', ({ partnerConfig }) => {
        if (partnerConfig && partnerConfig.affiliate_patterns.some(p => details.url.includes(p))) {
            addAffiliateLink({ url: details.url, timestamp: new Date().toISOString() });
        }
    });
  },
  { urls: ['<all_urls>'] }
);

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'affiliateLinkDetected') {
      addAffiliateLink(message.data);
  } else if (message.type === 'getAffiliatePatterns') {
      chrome.storage.local.get('partnerConfig', ({ partnerConfig }) => {
        if (partnerConfig) sendResponse({ patterns: partnerConfig.affiliate_patterns });
      });
      return true;
  } else if (message.type === 'productDetected') {
      findBetterOffer(message.data);
  }
});

chrome.cookies.onChanged.addListener((changeInfo) => {
  chrome.storage.local.get(['partnerConfig', 'lastAffiliateCookie', 'isPremiumUser', 'cookieLockEnabled'], (settings) => {
    const { partnerConfig, lastAffiliateCookie, isPremiumUser, cookieLockEnabled } = settings;
    if (!partnerConfig || changeInfo.removed) return;

    const newCookieDomain = changeInfo.cookie.domain;
    const matchingPattern = partnerConfig.affiliate_patterns.find(p => newCookieDomain.includes(p));

    if (matchingPattern) {
        if (isPremiumUser && cookieLockEnabled && lastAffiliateCookie) {
            chrome.notifications.create({ type: 'basic', iconUrl: 'icon.png', title: 'Affiliate Link Blocked', message: `Your locked affiliate from ${lastAffiliateCookie.domain} was protected.` });
            return;
        }

        if (lastAffiliateCookie) {
            const lastMatchingPattern = partnerConfig.affiliate_patterns.find(p => lastAffiliateCookie.domain.includes(p));
            if (lastMatchingPattern && matchingPattern !== lastMatchingPattern) {
                chrome.notifications.create({ type: 'basic', iconUrl: 'icon.png', title: 'Affiliate Link Overwritten', message: `A new affiliate from ${matchingPattern} has replaced one from ${lastMatchingPattern}.` });
            }
        }
        chrome.storage.local.set({ lastAffiliateCookie: { domain: newCookieDomain, timestamp: new Date().toISOString() } });
    }
  });
});
