document.addEventListener('DOMContentLoaded', () => {
  const affiliateLinksList = document.getElementById('affiliate-links');
  const settingsLink = document.getElementById('settings-link');
  const upgradeLink = document.getElementById('upgrade-link');
  const premiumPromo = document.getElementById('premium-promo');
  const premiumStatus = document.getElementById('premium-status');
  const betterOfferContainer = document.getElementById('better-offer-container');
  const betterOfferText = document.getElementById('better-offer-text');

  // Load data from storage
  chrome.storage.local.get({ affiliateLinks: [], isPremiumUser: false, betterOffer: null }, (result) => {
    const { affiliateLinks, isPremiumUser, betterOffer } = result;

    // Display "Better Offer" if available
    if (betterOffer) {
      betterOfferText.innerHTML = `<a href="${betterOffer.url}" target="_blank">${betterOffer.text}</a>`;
      betterOfferContainer.style.display = 'block';
    }

    // Display affiliate links
    affiliateLinks.forEach((link) => {
      const listItem = document.createElement('li');
      const urlSpan = document.createElement('span');
      urlSpan.className = 'url';
      urlSpan.textContent = link.url;
      listItem.appendChild(urlSpan);
      const timestampSpan = document.createElement('span');
      timestampSpan.className = 'timestamp';
      timestampSpan.textContent = ` (${new Date(link.timestamp).toLocaleString()})`;
      listItem.appendChild(timestampSpan);
      affiliateLinksList.appendChild(listItem);
    });

    // Show premium promo or status
    if (isPremiumUser) {
      premiumStatus.style.display = 'block';
    } else {
      premiumPromo.style.display = 'block';
    }
  });

  // Event listeners
  settingsLink.addEventListener('click', (e) => {
    e.preventDefault();
    chrome.runtime.openOptionsPage();
  });

  if (upgradeLink) {
    upgradeLink.addEventListener('click', (e) => {
      e.preventDefault();
      chrome.storage.local.set({ isPremiumUser: true }, () => {
        premiumPromo.style.display = 'none';
        premiumStatus.style.display = 'block';
        alert('You have been upgraded to Premium!');
      });
    });
  }

  // Clear the better offer when the popup is closed so it doesn't persist
  window.addEventListener('unload', () => {
      chrome.storage.local.remove('betterOffer');
  });
});
