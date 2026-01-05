document.addEventListener('DOMContentLoaded', () => {
    // ... existing element getters ...
    const watchedProductsBodyEl = document.getElementById('watched-products-body');
    const chartContainer = document.getElementById('price-chart-container');
    let currentChart = null;

    // --- Chart Rendering Function ---
    function renderPriceChart(product) {
        chartContainer.style.display = 'block';
        const ctx = document.getElementById('price-chart').getContext('2d');

        const labels = product.priceHistory.map(h => new Date(h.date).toLocaleDateString());
        const data = product.priceHistory.map(h => parseFloat(h.price.replace('$', '')));

        if (currentChart) {
            currentChart.destroy();
        }

        currentChart = new Chart(ctx, {
            type: 'line',
            data: {
                labels: labels,
                datasets: [{
                    label: `Price History for ${product.title}`,
                    data: data,
                    borderColor: 'rgb(75, 192, 192)',
                    tension: 0.1
                }]
            }
        });
    }

    // --- Load and Render Data ---
    chrome.storage.local.get({ watchedProducts: [] /* ... other data ... */ }, (data) => {
        // ... existing rendering for ledger, controls, etc. ...

        // Render Watched Products Table
        data.watchedProducts.forEach(product => {
            const row = watchedProductsBodyEl.insertRow();
            const cell1 = row.insertCell();
            cell1.innerHTML = `<a href="${product.url}" target="_blank">${product.title}</a>`;

            const cell2 = row.insertCell();
            cell2.textContent = product.price;

            const cell3 = row.insertCell();
            const historyButton = document.createElement('button');
            historyButton.textContent = 'View History';
            historyButton.onclick = () => renderPriceChart(product);
            cell3.appendChild(historyButton);
        });
    });

    // ... existing event listeners ...
});
