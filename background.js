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
    chrome.storage.local.get('lastAffiliateCookie', (result) => {
      const lastCookie = result.lastAffiliateCookie;
      if (lastCookie) {
        const lastMatchingPattern = AFFILIATE_PATTERNS.find(p => lastCookie.domain.includes(p));
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
