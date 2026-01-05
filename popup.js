document.addEventListener('DOMContentLoaded', () => {
  const affiliateLinksList = document.getElementById('affiliate-links');
  const settingsLink = document.getElementById('settings-link');
  const upgradeLink = document.getElementById('upgrade-link');
  const premiumPromo = document.getElementById('premium-promo');
  const premiumStatus = document.getElementById('premium-status');

  // Load affiliate links and user status from storage
  chrome.storage.local.get({ affiliateLinks: [], isPremiumUser: false }, (result) => {
    const { affiliateLinks, isPremiumUser } = result;

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

  // Open settings page when the link is clicked
  settingsLink.addEventListener('click', (e) => {
    e.preventDefault();
    chrome.runtime.openOptionsPage();
  });

  // Handle upgrade link click
  if (upgradeLink) {
    upgradeLink.addEventListener('click', (e) => {
      e.preventDefault();
      // In a real extension, this would lead to a payment flow.
      // For now, we'll simulate the upgrade.
      chrome.storage.local.set({ isPremiumUser: true }, () => {
        premiumPromo.style.display = 'none';
        premiumStatus.style.display = 'block';
        alert('You have been upgraded to Premium!');
      });
    });
  }
});
