document.addEventListener('DOMContentLoaded', () => {
    const openDashboardButton = document.getElementById('open-dashboard-button');

    if (openDashboardButton) {
        openDashboardButton.addEventListener('click', () => {
            chrome.tabs.create({ url: chrome.runtime.getURL('portal.html') });
        });
    } else {
        console.error("The dashboard button was not found in the popup.");
    }
});
