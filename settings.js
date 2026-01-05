document.addEventListener('DOMContentLoaded', () => {
    // ... other element getters ...
    const watchedProductsBodyEl = document.getElementById('watched-products-body');

    // Load all settings and user data from storage
    chrome.storage.local.get(
        {
            // ... other settings ...
            watchedProducts: []
        },
        (data) => {
            // ... other controls and ledger rendering ...

            // --- Watched Products ---
            data.watchedProducts.forEach(product => {
                const row = watchedProductsBodyEl.insertRow();
                row.innerHTML = `
                    <td><a href="${product.url}" target="_blank">${product.title}</a></td>
                    <td>${product.originalPrice || product.price}</td>
                    <td>${product.price}</td>
                `;
            });
        }
    );

    // ... other event listeners ...
});
