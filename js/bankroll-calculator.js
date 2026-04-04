// ═══════════════════════════════════════════════════════════════════════════════════════
// BANKROLL MANAGEMENT CALCULATOR
// A responsible gambling tool to help players manage their bankroll effectively
// ═══════════════════════════════════════════════════════════════════════════════════════

(function() {
    'use strict';

    // House edge constants (as percentages)
    const HOUSE_EDGES = {
        conservative: 2.5,
        moderate: 3.5,
        aggressive: 4.5
    };

    // Risk level bet size ranges (% of bankroll per spin)
    const BET_SIZE_RANGES = {
        conservative: { min: 0.5, max: 1.0 },
        moderate: { min: 1.0, max: 2.0 },
        aggressive: { min: 2.0, max: 5.0 }
    };

    // Session duration averages (spins per hour)
    const SPINS_PER_HOUR = 60;

    // Color scheme
    const COLORS = {
        dark: '#1a1a2e',
        darkCard: '#16213e',
        gold: '#fbbf24',
        success: '#10b981',
        warning: '#f59e0b',
        danger: '#ef4444',
        text: '#e0e0e0',
        textMuted: '#a0a0a0'
    };

    // ═══════════════════════════════════════════════════════════════════════════════════
    // UTILITY FUNCTIONS
    // ═══════════════════════════════════════════════════════════════════════════════════

    function formatCurrency(amount) {
        return '$' + Number(amount || 0).toLocaleString(undefined, {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2
        });
    }

    function getCurrentBalance() {
        // Try to get balance from global scope
        if (typeof balance !== 'undefined') {
            return balance;
        }
        // Fallback to currentUser.balance if available
        if (typeof currentUser !== 'undefined' && currentUser && currentUser.balance) {
            return currentUser.balance;
        }
        // Final fallback to localStorage
        const stored = localStorage.getItem('balance');
        return stored ? parseFloat(stored) : 0;
    }

    function createModal() {
        const modal = document.createElement('div');
        modal.id = 'bankrollCalculatorModal';
        modal.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: rgba(0, 0, 0, 0.8);
            display: flex;
            justify-content: center;
            align-items: center;
            z-index: 10000;
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
        `;

        const content = document.createElement('div');
        content.style.cssText = `
            background: linear-gradient(135deg, ${COLORS.dark} 0%, ${COLORS.darkCard} 100%);
            border: 2px solid ${COLORS.gold};
            border-radius: 12px;
            padding: 32px;
            max-width: 900px;
            width: 90%;
            max-height: 90vh;
            overflow-y: auto;
            box-shadow: 0 0 40px rgba(251, 191, 36, 0.3);
        `;

        modal.appendChild(content);
        return { modal, content };
    }

    function calculateSessionStats(bankroll, sessionDurationHours, riskLevel) {
        const estimatedSpins = Math.round(SPINS_PER_HOUR * sessionDurationHours);
        const betSizeRange = BET_SIZE_RANGES[riskLevel];
        const recommendedBetMin = (bankroll * betSizeRange.min) / 100;
        const recommendedBetMax = (bankroll * betSizeRange.max) / 100;
        const recommendedBetMid = (recommendedBetMin + recommendedBetMax) / 2;

        const houseEdge = HOUSE_EDGES[riskLevel] / 100;
        const expectedLossMin = estimatedSpins * recommendedBetMin * houseEdge;
        const expectedLossMax = estimatedSpins * recommendedBetMax * houseEdge;

        return {
            estimatedSpins,
            recommendedBetMin: Math.max(recommendedBetMin, 0.01),
            recommendedBetMax,
            recommendedBetMid,
            expectedLossMin,
            expectedLossMax,
            betSizePercentage: { min: betSizeRange.min, max: betSizeRange.max }
        };
    }

    function getWarningStatus(currentBalance, startingBalance, riskLevel) {
        const remaining = currentBalance / startingBalance;

        if (remaining <= 0.1) {
            return { level: 'critical', text: 'CRITICAL: Only 10% or less of session budget remaining', color: COLORS.danger };
        }
        if (remaining <= 0.25) {
            return { level: 'warning', text: 'WARNING: 25% or less of session budget remaining', color: COLORS.warning };
        }
        if (remaining <= 0.5) {
            return { level: 'caution', text: 'CAUTION: 50% or less of session budget remaining', color: COLORS.warning };
        }

        return { level: 'healthy', text: 'Session budget is healthy', color: COLORS.success };
    }

    function createSessionBudgetSection(bankroll, sessionDuration, riskLevel) {
        const stats = calculateSessionStats(bankroll, sessionDuration, riskLevel);

        const div = document.createElement('div');
        div.style.cssText = `
            background: ${COLORS.darkCard};
            border: 1px solid ${COLORS.gold}40;
            border-radius: 8px;
            padding: 20px;
            margin-bottom: 20px;
        `;

        const title = document.createElement('h3');
        title.textContent = 'Session Budget Calculator';
        title.style.cssText = `
            color: ${COLORS.gold};
            margin: 0 0 16px 0;
            font-size: 18px;
            text-transform: uppercase;
            letter-spacing: 1px;
        `;
        div.appendChild(title);

        // Input section
        const inputSection = document.createElement('div');
        inputSection.style.cssText = `
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
            gap: 16px;
            margin-bottom: 20px;
        `;

        // Bankroll input
        const bankrollGroup = document.createElement('div');
        bankrollGroup.innerHTML = `
            <label style="color: ${COLORS.gold}; font-size: 12px; text-transform: uppercase; letter-spacing: 0.5px; display: block; margin-bottom: 6px;">Total Bankroll</label>
            <input type="number" id="bankrollInput" value="${bankroll}" min="1" step="10" style="
                width: 100%;
                padding: 10px;
                background: ${COLORS.dark};
                border: 1px solid ${COLORS.gold}60;
                border-radius: 4px;
                color: ${COLORS.gold};
                font-weight: bold;
                box-sizing: border-box;
            ">
        `;
        inputSection.appendChild(bankrollGroup);

        // Session duration input
        const durationGroup = document.createElement('div');
        durationGroup.innerHTML = `
            <label style="color: ${COLORS.gold}; font-size: 12px; text-transform: uppercase; letter-spacing: 0.5px; display: block; margin-bottom: 6px;">Session Duration</label>
            <select id="durationSelect" style="
                width: 100%;
                padding: 10px;
                background: ${COLORS.dark};
                border: 1px solid ${COLORS.gold}60;
                border-radius: 4px;
                color: ${COLORS.gold};
                font-weight: bold;
                box-sizing: border-box;
                cursor: pointer;
            ">
                <option value="1">1 Hour</option>
                <option value="2">2 Hours</option>
                <option value="4">4 Hours</option>
            </select>
        `;
        inputSection.appendChild(durationGroup);

        // Risk level input
        const riskGroup = document.createElement('div');
        riskGroup.innerHTML = `
            <label style="color: ${COLORS.gold}; font-size: 12px; text-transform: uppercase; letter-spacing: 0.5px; display: block; margin-bottom: 6px;">Risk Level</label>
            <select id="riskSelect" style="
                width: 100%;
                padding: 10px;
                background: ${COLORS.dark};
                border: 1px solid ${COLORS.gold}60;
                border-radius: 4px;
                color: ${COLORS.gold};
                font-weight: bold;
                box-sizing: border-box;
                cursor: pointer;
            ">
                <option value="conservative">Conservative</option>
                <option value="moderate" selected>Moderate</option>
                <option value="aggressive">Aggressive</option>
            </select>
        `;
        inputSection.appendChild(riskGroup);

        div.appendChild(inputSection);

        // Output section
        const outputSection = document.createElement('div');
        outputSection.style.cssText = `
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
            gap: 12px;
        `;

        const outputItems = [
            {
                label: 'Recommended Bet Size',
                value: `${formatCurrency(stats.recommendedBetMin)} - ${formatCurrency(stats.recommendedBetMax)}`
            },
            {
                label: 'Estimated Spins',
                value: stats.estimatedSpins.toLocaleString()
            },
            {
                label: 'Expected Loss (Low)',
                value: formatCurrency(stats.expectedLossMin)
            },
            {
                label: 'Expected Loss (High)',
                value: formatCurrency(stats.expectedLossMax)
            }
        ];

        outputItems.forEach(item => {
            const card = document.createElement('div');
            card.style.cssText = `
                background: ${COLORS.dark};
                border: 1px solid ${COLORS.gold}40;
                border-radius: 6px;
                padding: 12px;
                text-align: center;
            `;
            card.innerHTML = `
                <div style="color: ${COLORS.textMuted}; font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 6px;">${item.label}</div>
                <div style="color: ${COLORS.gold}; font-size: 16px; font-weight: bold;">${item.value}</div>
            `;
            outputSection.appendChild(card);
        });

        div.appendChild(outputSection);
        return { element: div, stats, inputs: { bankrollInput: null, durationSelect: null, riskSelect: null } };
    }

    function createBetSizeAdvisorSection(currentBalance, startingBalance) {
        const div = document.createElement('div');
        div.style.cssText = `
            background: ${COLORS.darkCard};
            border: 1px solid ${COLORS.gold}40;
            border-radius: 8px;
            padding: 20px;
            margin-bottom: 20px;
        `;

        const title = document.createElement('h3');
        title.textContent = 'Bet Size Advisor';
        title.style.cssText = `
            color: ${COLORS.gold};
            margin: 0 0 16px 0;
            font-size: 18px;
            text-transform: uppercase;
            letter-spacing: 1px;
        `;
        div.appendChild(title);

        const advisorContent = document.createElement('div');
        advisorContent.style.cssText = `
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
            gap: 12px;
        `;

        const riskLevels = ['conservative', 'moderate', 'aggressive'];
        riskLevels.forEach(level => {
            const range = BET_SIZE_RANGES[level];
            const minBet = (currentBalance * range.min) / 100;
            const maxBet = (currentBalance * range.max) / 100;

            const card = document.createElement('div');
            card.style.cssText = `
                background: ${COLORS.dark};
                border: 1px solid ${COLORS.gold}40;
                border-radius: 6px;
                padding: 14px;
            `;

            const levelTitle = document.createElement('div');
            levelTitle.textContent = level.charAt(0).toUpperCase() + level.slice(1);
            levelTitle.style.cssText = `
                color: ${COLORS.gold};
                font-weight: bold;
                margin-bottom: 8px;
                text-transform: uppercase;
                font-size: 12px;
            `;
            card.appendChild(levelTitle);

            const percentageInfo = document.createElement('div');
            percentageInfo.style.cssText = `
                color: ${COLORS.textMuted};
                font-size: 12px;
                margin-bottom: 8px;
            `;
            percentageInfo.textContent = `${range.min}% - ${range.max}% per spin`;
            card.appendChild(percentageInfo);

            const betRange = document.createElement('div');
            betRange.style.cssText = `
                color: ${COLORS.gold};
                font-weight: bold;
                font-size: 14px;
            `;
            betRange.textContent = `${formatCurrency(minBet)} - ${formatCurrency(maxBet)}`;
            card.appendChild(betRange);

            advisorContent.appendChild(card);
        });

        div.appendChild(advisorContent);

        // Warning section
        const warning = getWarningStatus(currentBalance, startingBalance, 'moderate');
        const warningDiv = document.createElement('div');
        warningDiv.style.cssText = `
            background: ${warning.color}20;
            border: 1px solid ${warning.color};
            border-radius: 6px;
            padding: 12px;
            margin-top: 12px;
            color: ${warning.color};
            font-size: 13px;
            text-align: center;
            font-weight: 500;
        `;
        warningDiv.textContent = warning.text;
        div.appendChild(warningDiv);

        return { element: div };
    }

    function createSessionStatsSection(startingBalance) {
        const currentBalance = getCurrentBalance();
        const sessionPL = currentBalance - startingBalance;
        const spinCount = typeof stats !== 'undefined' && stats.totalSpins
            ? stats.totalSpins
            : parseInt(localStorage.getItem('sessionSpinCount') || '0');

        const div = document.createElement('div');
        div.style.cssText = `
            background: ${COLORS.darkCard};
            border: 1px solid ${COLORS.gold}40;
            border-radius: 8px;
            padding: 20px;
        `;

        const title = document.createElement('h3');
        title.textContent = 'Session Statistics';
        title.style.cssText = `
            color: ${COLORS.gold};
            margin: 0 0 16px 0;
            font-size: 18px;
            text-transform: uppercase;
            letter-spacing: 1px;
        `;
        div.appendChild(title);

        const statsGrid = document.createElement('div');
        statsGrid.style.cssText = `
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
            gap: 12px;
        `;

        const plColor = sessionPL >= 0 ? COLORS.success : COLORS.danger;

        const statsItems = [
            { label: 'Starting Balance', value: formatCurrency(startingBalance) },
            { label: 'Current Balance', value: formatCurrency(currentBalance) },
            { label: 'Session P&L', value: formatCurrency(sessionPL), color: plColor },
            { label: 'Spins This Session', value: spinCount.toLocaleString() }
        ];

        statsItems.forEach(item => {
            const card = document.createElement('div');
            card.style.cssText = `
                background: ${COLORS.dark};
                border: 1px solid ${COLORS.gold}40;
                border-radius: 6px;
                padding: 12px;
                text-align: center;
            `;
            card.innerHTML = `
                <div style="color: ${COLORS.textMuted}; font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 6px;">${item.label}</div>
                <div style="color: ${item.color || COLORS.gold}; font-size: 16px; font-weight: bold;">${item.value}</div>
            `;
            statsGrid.appendChild(card);
        });

        div.appendChild(statsGrid);
        return { element: div, startingBalance };
    }

    function createHeader() {
        const header = document.createElement('div');
        header.style.cssText = `
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 24px;
        `;

        const title = document.createElement('h2');
        title.textContent = 'Bankroll Management Calculator';
        title.style.cssText = `
            color: ${COLORS.gold};
            margin: 0;
            font-size: 24px;
            text-transform: uppercase;
            letter-spacing: 2px;
        `;
        header.appendChild(title);

        const closeBtn = document.createElement('button');
        closeBtn.innerHTML = '×';
        closeBtn.style.cssText = `
            background: none;
            border: none;
            color: ${COLORS.gold};
            font-size: 32px;
            cursor: pointer;
            padding: 0;
            width: 36px;
            height: 36px;
            display: flex;
            align-items: center;
            justify-content: center;
            transition: all 0.2s ease;
        `;
        closeBtn.onmouseover = () => closeBtn.style.color = COLORS.warning;
        closeBtn.onmouseout = () => closeBtn.style.color = COLORS.gold;
        closeBtn.onclick = () => {
            const modal = document.getElementById('bankrollCalculatorModal');
            if (modal) modal.remove();
        };
        header.appendChild(closeBtn);

        return header;
    }

    function attachInputListeners(container, sessionBudgetSection) {
        const bankrollInput = container.querySelector('#bankrollInput');
        const durationSelect = container.querySelector('#durationSelect');
        const riskSelect = container.querySelector('#riskSelect');

        function updateCalculations() {
            const bankroll = parseFloat(bankrollInput.value) || 0;
            const duration = parseFloat(durationSelect.value) || 1;
            const risk = riskSelect.value || 'moderate';

            if (bankroll <= 0) return;

            const stats = calculateSessionStats(bankroll, duration, risk);

            // Update output cards
            const outputCards = container.querySelectorAll('[data-output-card]');
            const outputs = [
                `${formatCurrency(stats.recommendedBetMin)} - ${formatCurrency(stats.recommendedBetMax)}`,
                stats.estimatedSpins.toLocaleString(),
                formatCurrency(stats.expectedLossMin),
                formatCurrency(stats.expectedLossMax)
            ];

            outputCards.forEach((card, i) => {
                if (i < outputs.length) {
                    const valueDiv = card.querySelector('[data-value]');
                    if (valueDiv) valueDiv.textContent = outputs[i];
                }
            });
        }

        bankrollInput.addEventListener('input', updateCalculations);
        durationSelect.addEventListener('change', updateCalculations);
        riskSelect.addEventListener('change', updateCalculations);
    }

    // ═══════════════════════════════════════════════════════════════════════════════════
    // PUBLIC API
    // ═══════════════════════════════════════════════════════════════════════════════════

    window.BankrollCalculator = {
        show: function() {
            // Remove any existing modal
            const existing = document.getElementById('bankrollCalculatorModal');
            if (existing) existing.remove();

            const currentBalance = getCurrentBalance();
            const startingBalance = currentBalance;

            const { modal, content } = createModal();

            // Add header
            content.appendChild(createHeader());

            // Add session budget calculator
            const budgetSection = createSessionBudgetSection(currentBalance, 1, 'moderate');
            content.appendChild(budgetSection.element);

            // Mark output cards for updates
            content.querySelectorAll('[data-output-card]').forEach(card => {
                card.setAttribute('data-output-card', 'true');
            });

            // Add bet size advisor
            const advisorSection = createBetSizeAdvisorSection(currentBalance, startingBalance);
            content.appendChild(advisorSection.element);

            // Add session stats
            const statsSection = createSessionStatsSection(startingBalance);
            content.appendChild(statsSection.element);

            // Add footer text
            const footer = document.createElement('div');
            footer.style.cssText = `
                color: ${COLORS.textMuted};
                font-size: 12px;
                text-align: center;
                margin-top: 20px;
                padding-top: 16px;
                border-top: 1px solid ${COLORS.gold}20;
            `;
            footer.innerHTML = `
                <p style="margin: 0;">This calculator is a responsible gambling tool to help you manage your bankroll.</p>
                <p style="margin: 6px 0 0 0;">Actual results may vary. Always play within your means.</p>
            `;
            content.appendChild(footer);

            // Attach event listeners
            attachInputListeners(content, budgetSection);

            document.body.appendChild(modal);

            // Close on backdrop click
            modal.addEventListener('click', (e) => {
                if (e.target === modal) {
                    modal.remove();
                }
            });

            console.warn('BankrollCalculator modal opened. Balance: ' + formatCurrency(currentBalance));
        }
    };

    console.warn('BankrollCalculator module loaded successfully');

})();
