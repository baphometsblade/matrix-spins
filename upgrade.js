document.addEventListener('DOMContentLoaded', () => {
    const upgradeButton = document.getElementById('upgrade-button');
    const statusMessage = document.getElementById('status-message');

    upgradeButton.addEventListener('click', () => {
        // Disable the button to prevent multiple clicks
        upgradeButton.disabled = true;
        upgradeButton.textContent = 'Processing...';
        statusMessage.style.display = 'none';

        // Send a message to the background script to perform the upgrade
        chrome.runtime.sendMessage({ action: 'upgradeToPremium' }, (response) => {
            if (response && response.success) {
                // Success!
                upgradeButton.textContent = 'Upgrade Successful!';
                upgradeButton.style.backgroundColor = '#34c759'; // Green color for success
                statusMessage.textContent = 'Welcome to Premium! Your dashboard will be updated.';
                statusMessage.className = 'status-message success';
                statusMessage.style.display = 'block';
            } else {
                // Handle failure
                upgradeButton.textContent = 'Upgrade Failed';
                upgradeButton.disabled = false; // Re-enable on failure
                statusMessage.textContent = 'Something went wrong. Please try again later.';
                statusMessage.className = 'status-message error';
                statusMessage.style.display = 'block';
            }
        });
    });
});
