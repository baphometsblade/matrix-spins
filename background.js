// A list of common affiliate marketing platforms and their URL patterns
const AFFILIATE_PATTERNS = [
  'affiliate.com',
  'shareasale.com',
  'cj.com',
  'rakuten.com',
  'amazon-adsystem.com',
  'impact.com',
  'awin.com'
];
const MAX_STORED_LINKS = 100;
const REDIRECT_RULE_ID = 1;

// Helper function to update the redirection rules based on user settings
function updateRedirectionRules() {
  chrome.storage.local.get({ smartRedirectionEnabled: false }, (settings) => {
    if (settings.smartRedirectionEnabled) {
      const regexFilter = AFFILIATE_PATTERNS.join('|');
      chrome.declarativeNetRequest.updateDynamicRules({
        addRules: [{
          id: REDIRECT_RULE_ID,
          priority: 1,
          action: {
            type: 'redirect',
            redirect: {
              regexSubstitution: 'https://my-partner-network.com/redirect?url=\\0'
            }
          },
          condition: {
            regexFilter: `.*(${regexFilter}).*`,
            resourceTypes: ['main_frame', 'sub_frame']
          }
        }],
        removeRuleIds: [REDIRECT_RULE_ID]
      });
    } else {
      chrome.declarativeNetRequest.updateDynamicRules({
        removeRuleIds: [REDIRECT_RULE_ID]
      });
    }
  });
}

// Listen for changes in settings
chrome.storage.onChanged.addListener((changes, namespace) => {
  if (changes.smartRedirectionEnabled) {
    updateRedirectionRules();
  }
});

// Run on extension startup
chrome.runtime.onStartup.addListener(() => {
  updateRedirectionRules();
});
// Run on extension installation
chrome.runtime.onInstalled.addListener(() => {
  updateRedirectionRules();
});


// Helper function to store affiliate links and cap the list size
function addAffiliateLink(link) {
  chrome.storage.local.get({ affiliateLinks: [] }, (result) => {
    const affiliateLinks = result.affiliateLinks;
    affiliateLinks.push(link);
    // Keep only the most recent links
    const cappedLinks = affiliateLinks.slice(-MAX_STORED_LINKS);
    chrome.storage.local.set({ affiliateLinks: cappedLinks });
  });
}

// Listen for network requests
chrome.webRequest.onBeforeRequest.addListener(
  (details) => {
    if (AFFILIATE_PATTERNS.some(pattern => details.url.includes(pattern))) {
      console.log('Affiliate link detected by webRequest:', details.url);
      addAffiliateLink({
        url: details.url,
        timestamp: new Date().toISOString()
      });
    }
  },
  { urls: ['<all_urls>'] },
  []
);

// Listen for messages from content scripts
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'affiliateLinkDetected') {
    console.log('Affiliate link detected by content script:', message.data);
    addAffiliateLink(message.data);
  } else if (message.type === 'getAffiliatePatterns') {
    // Send the patterns to the content script
    sendResponse({ patterns: AFFILIATE_PATTERNS });
  }
  // Return true to indicate you wish to send a response asynchronously
  return true;
});

// Listen for cookie changes
chrome.cookies.onChanged.addListener((changeInfo) => {
  const newCookieDomain = changeInfo.cookie.domain;
  const matchingPattern = AFFILIATE_PATTERNS.find(p => newCookieDomain.includes(p));

  if (matchingPattern && !changeInfo.removed) {
    console.log('Affiliate cookie changed:', changeInfo);
    chrome.storage.local.get(['lastAffiliateCookie', 'isPremiumUser', 'cookieLockEnabled'], (settings) => {
      const { lastAffiliateCookie, isPremiumUser, cookieLockEnabled } = settings;

      if (isPremiumUser && cookieLockEnabled && lastAffiliateCookie) {
        // If the lock is on, don't update the cookie, just show a notification
        console.log('Affiliate cookie lock is enabled. A new affiliate link was blocked.');
        chrome.notifications.create({
          type: 'basic',
          iconUrl: 'icon.png',
          title: 'Affiliate Link Blocked',
          message: `Your locked affiliate from ${lastAffiliateCookie.domain} was protected from being overwritten.`
        });
        return; // Stop further processing
      }

      if (lastAffiliateCookie) {
        const lastMatchingPattern = AFFILIATE_PATTERNS.find(p => lastAffiliateCookie.domain.includes(p));
        if (lastMatchingPattern && matchingPattern !== lastMatchingPattern) {
          console.log(`Last-click attribution detected! New affiliate '${matchingPattern}' replaced '${lastMatchingPattern}'.`);
          chrome.notifications.create({
            type: 'basic',
            iconUrl: 'icon.png',
            title: 'Affiliate Link Overwritten',
            message: `A new affiliate from ${matchingPattern} has replaced one from ${lastMatchingPattern}.`
          });
        }
      }

      chrome.storage.local.set({
        lastAffiliateCookie: {
          domain: newCookieDomain,
          timestamp: new Date().toISOString()
        }
      });
    });
  }
});
