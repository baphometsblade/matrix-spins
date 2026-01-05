document.addEventListener('DOMContentLoaded', () => {
  const affiliateLinksList = document.getElementById('affiliate-links');

  // Retrieve the affiliate links from storage
  chrome.storage.local.get({ affiliateLinks: [] }, (result) => {
    const affiliateLinks = result.affiliateLinks;

    // Display the affiliate links in the popup
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
  });
});
