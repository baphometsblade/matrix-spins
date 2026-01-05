document.addEventListener('DOMContentLoaded', () => {
  const smartRedirectionToggle = document.getElementById('smart-redirection-toggle');
  const cookieLockToggle = document.getElementById('cookie-lock-toggle');
  const premiumFeatures = document.getElementById('premium-features');
  const upgradeMessage = document.getElementById('upgrade-message');

  // Load the current settings from storage
  chrome.storage.local.get(
    {
      smartRedirectionEnabled: false,
      cookieLockEnabled: false,
      isPremiumUser: false // Simulate premium status
    },
    (settings) => {
      smartRedirectionToggle.checked = settings.smartRedirectionEnabled;
      cookieLockToggle.checked = settings.cookieLockEnabled;

      if (settings.isPremiumUser) {
        premiumFeatures.style.display = 'block';
      } else {
        upgradeMessage.style.display = 'block';
      }
    }
  );

  // Save settings when toggles are changed
  smartRedirectionToggle.addEventListener('change', () => {
    chrome.storage.local.set({ smartRedirectionEnabled: smartRedirectionToggle.checked });
  });

  cookieLockToggle.addEventListener('change', () => {
    chrome.storage.local.set({ cookieLockEnabled: cookieLockToggle.checked });
  });
});
