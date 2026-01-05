// Request the affiliate patterns from the background script
chrome.runtime.sendMessage({ type: 'getAffiliatePatterns' }, (response) => {
  if (response && response.patterns) {
    const AFFILIATE_PATTERNS = response.patterns;
    scanForAffiliateLinks(AFFILIATE_PATTERNS);
  }
});

// Scan the DOM for affiliate links
function scanForAffiliateLinks(patterns) {
  const links = document.getElementsByTagName('a');
  for (const link of links) {
    if (patterns.some(pattern => link.href.includes(pattern))) {
      // Send the affiliate link to the background script
      chrome.runtime.sendMessage({
        type: 'affiliateLinkDetected',
        data: {
          url: link.href,
          timestamp: new Date().toISOString()
        }
      });
    }
  }
}

// Listen for messages from the background script (e.g., to re-scan the page)
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'scanPage') {
    chrome.runtime.sendMessage({ type: 'getAffiliatePatterns' }, (response) => {
      if (response && response.patterns) {
        scanForAffiliateLinks(response.patterns);
      }
    });
  }
});
