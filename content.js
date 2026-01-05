// --- Product Page Analysis ---

// Configuration for supported e-commerce sites.
const siteConfigs = [
  {
    name: "Amazon",
    product_page_pattern: "amazon.com/.*/dp/",
    selectors: {
      title: "#productTitle",
      price: ".a-price .a-offscreen" // A common selector for Amazon's price
    }
  }
  // Future sites (e.g., eBay, Walmart) can be added here.
];

// Analyzes the current page to see if it's a known product page.
function analyzeProductPage() {
  const url = window.location.href;
  for (const config of siteConfigs) {
    const pattern = new RegExp(config.product_page_pattern);
    if (pattern.test(url)) {
      console.log(`Product page detected on ${config.name}`);
      const titleElement = document.querySelector(config.selectors.title);
      const priceElement = document.querySelector(config.selectors.price);

      if (titleElement && priceElement) {
        const productData = {
          site: config.name,
          title: titleElement.innerText.trim(),
          price: priceElement.innerText.trim()
        };

        // Send the extracted product data to the background script.
        chrome.runtime.sendMessage({
          type: 'productDetected',
          data: productData
        });
      }
      break; // Stop after finding the first match.
    }
  }
}

// --- Affiliate Link Scanning ---

// Request affiliate patterns from the background script and scan for links.
function initializeLinkScanner() {
    chrome.runtime.sendMessage({ type: 'getAffiliatePatterns' }, (response) => {
        if (response && response.patterns) {
            scanForAffiliateLinks(response.patterns);
        }
    });
}

// Scans the DOM for affiliate links.
function scanForAffiliateLinks(patterns) {
  const links = document.getElementsByTagName('a');
  for (const link of links) {
    if (patterns.some(pattern => link.href.includes(pattern))) {
      chrome.runtime.sendMessage({
        type: 'affiliateLinkDetected',
        data: { url: link.href, timestamp: new Date().toISOString() }
      });
    }
  }
}

// --- Initialization ---

// Run all analyses when the page content has loaded.
window.addEventListener('load', () => {
  analyzeProductPage();
  initializeLinkScanner();
});
