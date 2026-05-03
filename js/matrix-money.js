/**
 * Matrix Money System Module
 * Matrix Spins Casino - msaart.online
 *
 * Manages virtual currency purchases and withdrawals via backend API.
 * Purchases = Buying digital credits
 * Withdrawals = Withdrawing digital credits
 *
 * Depends on: auth.js (apiRequest, authToken)
 */

const MatrixMoney = (() => {
  'use strict';

  // Payment methods available for selection
  const PAYMENT_METHODS = [
    { id: 'visa',          label: 'Visa',            icon: '💳' },
    { id: 'mastercard',    label: 'Mastercard',      icon: '💳' },
    { id: 'payid',         label: 'PayID',           icon: '🏦' },
    { id: 'bank_transfer', label: 'Bank Transfer',   icon: '🏦' }
  ];

  // Cached packages from server (fallback to hardcoded)
  let cachedPackages = [
    { id: 'mm_500',   price: 5,   credits: 500,   bonus: 0,    label: 'Bronze Collectible' },
    { id: 'mm_1100',  price: 10,  credits: 1100,  bonus: 100,  label: 'Silver Collectible' },
    { id: 'mm_3000',  price: 25,  credits: 3000,  bonus: 500,  label: 'Gold Collectible' },
    { id: 'mm_6500',  price: 50,  credits: 6500,  bonus: 1500, label: 'Platinum Collectible' },
    { id: 'mm_14000', price: 100, credits: 14000, bonus: 4000, label: 'Diamond Collectible' }
  ];

  // ─── Helpers ─────────────────────────────────────────────────────────────

  /**
   * Wrapper around the global apiRequest from auth.js.
   * Falls back to a direct fetch if apiRequest isn't available.
   */
  async function api(path, opts = {}) {
    if (typeof apiRequest === 'function') {
      return apiRequest(path, opts);
    }
    // Fallback for standalone usage
    const tokenKey = typeof STORAGE_KEY_TOKEN !== 'undefined' ? STORAGE_KEY_TOKEN : 'casinoToken';
    const token = localStorage.getItem(tokenKey);
    const headers = { 'Accept': 'application/json' };
    if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
    if (token) headers['Authorization'] = 'Bearer ' + token;
    const response = await fetch(path, {
      method: opts.method || 'GET',
      headers,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined
    });
    const data = await response.json().catch(() => null);
    if (!response.ok) {
      const err = new Error((data && data.error) || 'Request failed');
      err.status = response.status;
      err.payload = data;
      throw err;
    }
    return data || {};
  }

  function isLoggedIn() {
    if (typeof authToken !== 'undefined' && authToken) return true;
    const tokenKey = typeof STORAGE_KEY_TOKEN !== 'undefined' ? STORAGE_KEY_TOKEN : 'casinoToken';
    return !!localStorage.getItem(tokenKey);
  }

  function removeModal(id) {
    const el = document.getElementById(id);
    if (el) el.remove();
  }

  function createOverlay(id) {
    removeModal(id);
    const overlay = document.createElement('div');
    overlay.id = id;
    overlay.className = 'modal-overlay active';
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) overlay.remove();
    });
    return overlay;
  }

  /**
   * Builds payment method selector HTML
   */
  function buildPaymentSelector(namePrefix) {
    return PAYMENT_METHODS.map((pm, i) => `
      <label style="display:flex;align-items:center;gap:10px;padding:10px 12px;cursor:pointer;border:1px solid rgba(86,210,160,${i===0?'0.5':'0.2'});border-radius:8px;margin-bottom:6px;transition:all 0.2s;"
             onclick="this.parentElement.querySelectorAll('label').forEach(l=>{l.style.borderColor='rgba(86,210,160,0.2)';l.querySelector('input').checked=false});this.style.borderColor='rgba(86,210,160,0.5)';this.querySelector('input').checked=true;">
        <input type="radio" name="${namePrefix}_payment" value="${pm.id}" ${i===0?'checked':''} style="accent-color:#56d2a0;">
        <span style="font-size:18px;">${pm.icon}</span>
        <span style="color:#e0e0e0;font-size:14px;">${pm.label}</span>
      </label>
    `).join('');
  }

  function getSelectedPayment(namePrefix) {
    const checked = document.querySelector(`input[name="${namePrefix}_payment"]:checked`);
    return checked ? checked.value : PAYMENT_METHODS[0].id;
  }

  // ─── Fetch Packages ──────────────────────────────────────────────────────

  async function fetchPackages() {
    try {
      const data = await api('/api/matrix-money/packages');
      if (data && data.packages && data.packages.length) {
        cachedPackages = data.packages;
      }
    } catch (e) {
      console.warn('[MatrixMoney] Could not fetch packages from server, using defaults:', e.message);
    }
  }

  // ─── Purchase Flow ───────────────────────────────────────────────────────

  /**
   * Displays the purchase Matrix Money modal with package options
   */
  async function showPurchaseModal() {
    if (!isLoggedIn()) {
      showErrorModal('Please log in to purchase Matrix Money.');
      return;
    }

    // Refresh packages from server
    await fetchPackages();

    const overlay = createOverlay('matrix-money-purchase-modal');

    let packagesHtml = cachedPackages.map(pkg => `
      <div style="background: rgba(86,210,160,0.1); border: 2px solid rgba(86,210,160,0.3); border-radius: 10px; padding: 16px; margin-bottom: 12px; cursor: pointer; transition: all 0.3s ease;"
           class="matrix-package-option"
           onmouseover="this.style.borderColor='rgba(249,202,36,0.5)'; this.style.background='rgba(249,202,36,0.1)'"
           onmouseout="this.style.borderColor='rgba(86,210,160,0.3)'; this.style.background='rgba(86,210,160,0.1)'"
           onclick="MatrixMoney.confirmPurchase('${pkg.id}', ${pkg.price}, ${pkg.credits}, '${pkg.label}', ${pkg.bonus || 0})">
        <div style="display: flex; justify-content: space-between; align-items: center;">
          <div>
            <div style="color: #f9ca24; font-weight: 700; font-size: 16px;">${pkg.label}</div>
            <div style="color: #56d2a0; font-size: 14px; margin-top: 4px;">Credit Value: $${pkg.price.toFixed(2)}</div>
            <div style="color: #aaa; font-size: 12px; margin-top: 2px;">Get ${pkg.credits.toLocaleString()} Matrix Money${pkg.bonus ? ' + ' + pkg.bonus.toLocaleString() + ' bonus' : ''}</div>
          </div>
          <div style="background: linear-gradient(135deg, #f9ca24, #f0932b); color: #000; padding: 8px 16px; border-radius: 6px; font-weight: 700; font-size: 14px;">
            Buy Now
          </div>
        </div>
      </div>
    `).join('');

    overlay.innerHTML = `
      <div style="max-width: 600px; width: 100%; background: rgba(15,23,42,0.95); border: 1px solid rgba(249,202,36,0.2); border-radius: 14px; padding: 32px; color: #e0e0e0; max-height: 90vh; overflow-y: auto;">
        <button class="modal-close" aria-label="Close" onclick="this.closest('.modal-overlay').remove()">×</button>

        <h1 style="font-size: 24px; margin-bottom: 8px; color: #56d2a0; font-weight: 700;">Purchase Matrix Money</h1>
        <p style="color: #aaa; font-size: 13px; margin-bottom: 24px;">Select a package to buy entertainment credits</p>

        <div style="background: rgba(86,210,160,0.15); border-left: 3px solid #56d2a0; padding: 12px 14px; border-radius: 6px; margin-bottom: 20px; font-size: 13px;">
          <strong style="color: #56d2a0;">ℹ About Matrix Money:</strong>
          <p style="color: #aaa; margin-top: 6px;">When you purchase Matrix Money, you are purchasing digital credits representing entertainment. These credits have no value outside this Platform and cannot be traded or transferred. Matrix Money has NO real monetary value—it is for entertainment only.</p>
        </div>

        ${packagesHtml}

        <div style="background: rgba(249,202,36,0.1); border-left: 3px solid #f9ca24; padding: 12px 14px; border-radius: 6px; margin-top: 20px; font-size: 12px;">
          <strong style="color: #f9ca24;">⚠ Important Disclaimer:</strong>
          <p style="color: #aaa; margin-top: 6px;">• All purchases are final and cannot be refunded<br>
          • Matrix Money has no real-world monetary value<br>
          • Games are for entertainment with no guarantee of winnings<br>
          • You must be 18+ to use this Platform<br>
          • By purchasing, you accept our Terms of Service</p>
        </div>

        <button onclick="this.closest('.modal-overlay').remove()" style="width: 100%; margin-top: 20px; padding: 10px 20px; background: rgba(255,255,255,0.1); color: #aaa; border: 1px solid rgba(255,255,255,0.2); border-radius: 6px; font-weight: 600; cursor: pointer;">Cancel</button>
      </div>
    `;

    document.body.appendChild(overlay);
  }

  /**
   * Displays confirmation dialog for purchase with payment method selection
   */
  function confirmPurchase(packageId, price, credits, label, bonus) {
    const overlay = createOverlay('matrix-money-confirm-modal');
    overlay.innerHTML = `
      <div style="max-width: 520px; width: 100%; background: rgba(15,23,42,0.95); border: 1px solid rgba(249,202,36,0.3); border-radius: 14px; padding: 32px; color: #e0e0e0; text-align: center; max-height: 90vh; overflow-y: auto;">
        <h2 style="font-size: 22px; margin-bottom: 20px; color: #56d2a0; font-weight: 700;">Confirm Purchase</h2>

        <div style="background: rgba(86,210,160,0.15); border: 1px solid rgba(86,210,160,0.3); border-radius: 10px; padding: 20px; margin-bottom: 24px;">
          <div style="color: #aaa; font-size: 12px; margin-bottom: 8px;">You are purchasing digital credits:</div>
          <div style="color: #56d2a0; font-size: 28px; font-weight: 700; margin-bottom: 12px;">${label}</div>
          <div style="color: #f9ca24; font-size: 18px; margin-bottom: 8px;">$${price.toFixed(2)} AUD</div>
          <div style="color: #aaa; font-size: 13px; border-top: 1px solid rgba(86,210,160,0.3); padding-top: 12px; margin-top: 12px;">
            You will receive<br>
            <strong style="color: #56d2a0; font-size: 20px;">${credits.toLocaleString()} MM</strong>
            ${bonus > 0 ? `<br><span style="color:#f9ca24;font-size:13px;">+ ${bonus.toLocaleString()} bonus credits</span>` : ''}
          </div>
        </div>

        <div style="text-align: left; margin-bottom: 20px;">
          <div style="color: #56d2a0; font-weight: 600; font-size: 14px; margin-bottom: 10px;">Select Payment Method:</div>
          ${buildPaymentSelector('purchase')}
        </div>

        <div style="background: rgba(249,202,36,0.1); border-left: 3px solid #f9ca24; padding: 12px 14px; border-radius: 6px; margin-bottom: 20px; text-align: left; font-size: 12px;">
          <strong style="color: #f9ca24;">⚠ Final Confirmation:</strong>
          <p style="color: #aaa; margin-top: 6px;">
            • This transaction is <strong>FINAL</strong> and cannot be reversed<br>
            • Matrix Money has no resale value outside this Platform<br>
            • You are 18+ and accept these terms<br>
            • Gaming is for entertainment only
          </p>
        </div>

        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px;">
          <button onclick="document.getElementById('matrix-money-confirm-modal').remove()" style="padding: 12px 20px; background: rgba(255,255,255,0.1); color: #aaa; border: 1px solid rgba(255,255,255,0.2); border-radius: 6px; font-weight: 700; cursor: pointer;">Cancel</button>
          <button id="mm-confirm-purchase-btn" onclick="MatrixMoney.processPurchase('${packageId}')" style="padding: 12px 20px; background: linear-gradient(135deg, #f9ca24, #f0932b); color: #000; border: none; border-radius: 6px; font-weight: 700; cursor: pointer;">Confirm Purchase</button>
        </div>
      </div>
    `;

    document.body.appendChild(overlay);
  }

  /**
   * Processes the purchase via backend API
   */
  async function processPurchase(packageId) {
    const btn = document.getElementById('mm-confirm-purchase-btn');
    if (btn) {
      btn.disabled = true;
      btn.textContent = 'Processing...';
      btn.style.opacity = '0.6';
    }

    try {
      const paymentType = getSelectedPayment('purchase');

      const data = await api('/api/matrix-money/purchase', {
        method: 'POST',
        body: { packageId, paymentType },
        requireAuth: true
      });

      // Close modals
      removeModal('matrix-money-confirm-modal');
      removeModal('matrix-money-purchase-modal');

      // Update balance display if the global updateBalance function exists
      if (data.balance !== undefined) {
        if (typeof updateBalanceDisplay === 'function') {
          updateBalanceDisplay(data.balance);
        } else if (typeof balance !== 'undefined') {
          balance = data.balance;
          const balEl = document.getElementById('balance');
          if (balEl) balEl.textContent = data.balance.toLocaleString('en-US', { minimumFractionDigits: 2 });
        }
      }

      const receiptInfo = data.receipt || {};
      const bonusMsg = data.bonusAwarded > 0
        ? `<br><span style="color:#f9ca24;">+ ${data.bonusAwarded.toLocaleString()} bonus credits awarded!</span>`
        : '';

      showSuccessModal(
        'Purchase Successful!',
        `You have acquired <strong>${(receiptInfo.credits || 0).toLocaleString()} digital credits</strong> worth $${(receiptInfo.price || 0).toFixed(2)}.` +
        `<br>Your account has been credited with <strong>${(receiptInfo.credits || 0).toLocaleString()} Matrix Money</strong>.${bonusMsg}`,
        receiptInfo.transactionRef
          ? `Reference: <code style="color:#56d2a0;background:rgba(86,210,160,0.1);padding:2px 6px;border-radius:4px;">${receiptInfo.transactionRef}</code><br>You can now use your Matrix Money to play games on the Platform!`
          : 'You can now use your Matrix Money to play games on the Platform!'
      );
    } catch (err) {
      console.warn('[MatrixMoney] Purchase error:', err);
      if (btn) {
        btn.disabled = false;
        btn.textContent = 'Confirm Purchase';
        btn.style.opacity = '1';
      }
      const msg = err.message || 'An error occurred while processing your purchase.';
      showErrorModal(msg);
    }
  }

  // ─── Withdrawal Flow ─────────────────────────────────────────────────────

  /**
   * Displays the withdrawal modal with custom amount input
   */
  async function showWithdrawModal() {
    if (!isLoggedIn()) {
      showErrorModal('Please log in to withdraw Matrix Money.');
      return;
    }

    // Fetch current balance from server
    let currentBalance = 0;
    let wagering = { complete: true };
    try {
      const balData = await api('/api/matrix-money/balance', { requireAuth: true });
      currentBalance = balData.balance || 0;
      wagering = balData.wagering || { complete: true };
    } catch (e) {
      console.warn('[MatrixMoney] Could not fetch balance:', e.message);
    }

    const overlay = createOverlay('matrix-money-withdraw-modal');

    // Quick-select amounts
    const quickAmounts = [20, 50, 100, 250, 500, 1000].filter(a => a <= currentBalance);

    let quickHtml = quickAmounts.map(amount => `
      <button onclick="document.getElementById('mm-withdraw-amount').value=${amount}"
              style="background:rgba(86,210,160,0.15);border:1px solid rgba(86,210,160,0.3);color:#56d2a0;padding:8px 14px;border-radius:6px;cursor:pointer;font-weight:600;font-size:13px;">
        $${amount}
      </button>
    `).join('');

    const wageringWarning = !wagering.complete
      ? `<div style="background:rgba(255,70,70,0.15);border-left:3px solid #ff4646;padding:12px 14px;border-radius:6px;margin-bottom:20px;font-size:13px;">
           <strong style="color:#ff4646;">⚠ Wagering Incomplete:</strong>
           <p style="color:#aaa;margin-top:6px;">You must complete your wagering requirements (${Math.round((wagering.progress / wagering.requirement) * 100)}%) before withdrawing.</p>
         </div>`
      : '';

    overlay.innerHTML = `
      <div style="max-width: 600px; width: 100%; background: rgba(15,23,42,0.95); border: 1px solid rgba(249,202,36,0.2); border-radius: 14px; padding: 32px; color: #e0e0e0; max-height: 90vh; overflow-y: auto;">
        <button class="modal-close" aria-label="Close" onclick="this.closest('.modal-overlay').remove()">×</button>

        <h1 style="font-size: 24px; margin-bottom: 8px; color: #f9ca24; font-weight: 700;">Withdraw Matrix Money</h1>
        <p style="color: #aaa; font-size: 13px; margin-bottom: 24px;">Withdraw your balance back to your account</p>

        <div style="background: rgba(86,210,160,0.15); border: 1px solid rgba(86,210,160,0.3); border-radius: 10px; padding: 16px; margin-bottom: 20px; text-align: center;">
          <div style="color: #aaa; font-size: 12px; margin-bottom: 4px;">Your Balance</div>
          <div style="color: #56d2a0; font-size: 28px; font-weight: 700;">M$${currentBalance.toLocaleString('en-US', { minimumFractionDigits: 2 })}</div>
        </div>

        ${wageringWarning}

        <div style="background: rgba(249,202,36,0.15); border-left: 3px solid #f9ca24; padding: 12px 14px; border-radius: 6px; margin-bottom: 20px; font-size: 13px;">
          <strong style="color: #f9ca24;">ℹ How Withdrawals Work:</strong>
          <p style="color: #aaa; margin-top: 6px;">When you withdraw Matrix Money, funds will be transferred to your selected payment method within 3-5 business days.</p>
        </div>

        <div style="margin-bottom: 20px;">
          <label style="color: #56d2a0; font-weight: 600; font-size: 14px; display: block; margin-bottom: 10px;">Withdrawal Amount (AUD):</label>
          <input type="number" id="mm-withdraw-amount" inputmode="decimal" enterkeyhint="done" autocomplete="off" pattern="[0-9]*" min="20" max="${Math.min(currentBalance, 50000)}" step="1" placeholder="Enter amount (min $20)"
                 style="width: 100%; padding: 12px 14px; background: rgba(15,23,42,0.8); border: 1px solid rgba(86,210,160,0.3); border-radius: 8px; color: #e0e0e0; font-size: 16px; box-sizing: border-box;">
          <div style="display: flex; gap: 8px; margin-top: 10px; flex-wrap: wrap;">
            ${quickHtml}
          </div>
        </div>

        <div style="text-align: left; margin-bottom: 20px;">
          <div style="color: #f9ca24; font-weight: 600; font-size: 14px; margin-bottom: 10px;">Payment Method:</div>
          ${buildPaymentSelector('withdraw')}
        </div>

        <div style="background: rgba(249,202,36,0.1); border-left: 3px solid #f9ca24; padding: 12px 14px; border-radius: 6px; margin-bottom: 20px; font-size: 12px;">
          <strong style="color: #f9ca24;">⚠ Important:</strong>
          <p style="color: #aaa; margin-top: 6px;">• Minimum withdrawal: $20<br>
          • Withdrawals are final and cannot be reversed<br>
          • Processing time: 3-5 business days<br>
          • Matrix Money has no value outside this Platform</p>
        </div>

        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px;">
          <button onclick="this.closest('.modal-overlay').remove()" style="padding: 12px 20px; background: rgba(255,255,255,0.1); color: #aaa; border: 1px solid rgba(255,255,255,0.2); border-radius: 6px; font-weight: 700; cursor: pointer;">Cancel</button>
          <button onclick="MatrixMoney.confirmWithdraw()" id="mm-withdraw-submit" style="padding: 12px 20px; background: linear-gradient(135deg, #f9ca24, #f0932b); color: #000; border: none; border-radius: 6px; font-weight: 700; cursor: pointer;">Continue</button>
        </div>
      </div>
    `;

    document.body.appendChild(overlay);
  }

  /**
   * Validates and shows withdrawal confirmation
   */
  function confirmWithdraw() {
    const input = document.getElementById('mm-withdraw-amount');
    if (!input) return;
    const amount = parseFloat(input.value);

    if (isNaN(amount) || amount < 20) {
      showErrorModal('Minimum withdrawal amount is $20.');
      return;
    }
    if (amount > 50000) {
      showErrorModal('Maximum withdrawal amount is $50,000.');
      return;
    }

    const paymentType = getSelectedPayment('withdraw');
    const paymentLabel = PAYMENT_METHODS.find(p => p.id === paymentType)?.label || paymentType;

    const overlay = createOverlay('matrix-money-withdraw-confirm-modal');
    overlay.innerHTML = `
      <div style="max-width: 500px; width: 100%; background: rgba(15,23,42,0.95); border: 1px solid rgba(249,202,36,0.3); border-radius: 14px; padding: 32px; color: #e0e0e0; text-align: center;">
        <h2 style="font-size: 22px; margin-bottom: 20px; color: #f9ca24; font-weight: 700;">Confirm Withdrawal</h2>

        <div style="background: rgba(249,202,36,0.15); border: 1px solid rgba(249,202,36,0.3); border-radius: 10px; padding: 20px; margin-bottom: 24px;">
          <div style="color: #aaa; font-size: 12px; margin-bottom: 8px;">You are withdrawing:</div>
          <div style="color: #f9ca24; font-size: 28px; font-weight: 700; margin-bottom: 12px;">$${amount.toFixed(2)} AUD</div>
          <div style="color: #aaa; font-size: 13px;">via <strong style="color:#56d2a0;">${paymentLabel}</strong></div>
          <div style="color: #aaa; font-size: 12px; border-top: 1px solid rgba(249,202,36,0.3); padding-top: 12px; margin-top: 12px;">
            Processing time:<br>
            <strong style="color: #f9ca24;">3-5 business days</strong>
          </div>
        </div>

        <div style="background: rgba(249,202,36,0.1); border-left: 3px solid #f9ca24; padding: 12px 14px; border-radius: 6px; margin-bottom: 20px; text-align: left; font-size: 12px;">
          <strong style="color: #f9ca24;">⚠ Final Confirmation:</strong>
          <p style="color: #aaa; margin-top: 6px;">
            • This withdrawal is <strong>FINAL</strong> and cannot be reversed<br>
            • Your Matrix Money balance will be reduced by $${amount.toFixed(2)}<br>
            • Funds will be sent to your ${paymentLabel}<br>
            • No refunds for gaming losses are available
          </p>
        </div>

        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px;">
          <button onclick="document.getElementById('matrix-money-withdraw-confirm-modal').remove()" style="padding: 12px 20px; background: rgba(255,255,255,0.1); color: #aaa; border: 1px solid rgba(255,255,255,0.2); border-radius: 6px; font-weight: 700; cursor: pointer;">Cancel</button>
          <button id="mm-confirm-withdraw-btn" onclick="MatrixMoney.processWithdraw(${amount}, '${paymentType}')" style="padding: 12px 20px; background: linear-gradient(135deg, #f9ca24, #f0932b); color: #000; border: none; border-radius: 6px; font-weight: 700; cursor: pointer;">Confirm Withdrawal</button>
        </div>
      </div>
    `;

    document.body.appendChild(overlay);
  }

  /**
   * Processes the withdrawal via backend API
   */
  async function processWithdraw(amount, paymentType) {
    const btn = document.getElementById('mm-confirm-withdraw-btn');
    if (btn) {
      btn.disabled = true;
      btn.textContent = 'Processing...';
      btn.style.opacity = '0.6';
    }

    try {
      const data = await api('/api/matrix-money/withdraw', {
        method: 'POST',
        body: { amount, paymentType },
        requireAuth: true
      });

      // Close all withdrawal modals
      removeModal('matrix-money-withdraw-confirm-modal');
      removeModal('matrix-money-withdraw-modal');

      // Update balance display
      if (data.balance !== undefined) {
        if (typeof updateBalanceDisplay === 'function') {
          updateBalanceDisplay(data.balance);
        } else if (typeof balance !== 'undefined') {
          balance = data.balance;
          const balEl = document.getElementById('balance');
          if (balEl) balEl.textContent = data.balance.toLocaleString('en-US', { minimumFractionDigits: 2 });
        }
      }

      const receiptInfo = data.receipt || {};
      const wdInfo = data.withdrawal || {};

      showSuccessModal(
        'Withdrawal Initiated!',
        `Your withdrawal of <strong>$${amount.toFixed(2)} AUD</strong> has been submitted.` +
        `<br>Reference: <code style="color:#f9ca24;background:rgba(249,202,36,0.1);padding:2px 6px;border-radius:4px;">${wdInfo.reference || 'N/A'}</code>`,
        receiptInfo.transactionRef
          ? `Reference ID: <code style="color:#56d2a0;background:rgba(86,210,160,0.1);padding:2px 6px;border-radius:4px;">${receiptInfo.transactionRef}</code><br>Your funds will arrive in ${wdInfo.estimatedDays || 4} business days.`
          : `Your funds will arrive in ${wdInfo.estimatedDays || 4} business days. You will receive an email confirmation.`
      );
    } catch (err) {
      console.warn('[MatrixMoney] Withdrawal error:', err);
      if (btn) {
        btn.disabled = false;
        btn.textContent = 'Confirm Withdrawal';
        btn.style.opacity = '1';
      }
      const msg = err.message || 'An error occurred while processing your withdrawal.';
      showErrorModal(msg);
    }
  }

  // ─── Transaction History ─────────────────────────────────────────────────

  /**
   * Loads transaction history from backend API
   */
  async function getTransactionHistory() {
    try {
      const data = await api('/api/matrix-money/transactions', { requireAuth: true });
      return data.transactions || [];
    } catch (err) {
      console.warn('[MatrixMoney] Failed to load transactions:', err.message);
      return [];
    }
  }

  /**
   * Gets user's transaction history from backend
   */
  async function getTransactionHistory() {
    try {
      const data = await api('/api/matrix-money/receipts', { requireAuth: true });
      return data.receipts || [];
    } catch (err) {
      console.warn('[MatrixMoney] Failed to load receipts:', err.message);
      return [];
    }
  }

  /**
   * Gets current balance and receipt summary from backend
   */
  async function getBalance() {
    try {
      return await api('/api/matrix-money/balance', { requireAuth: true });
    } catch (err) {
      console.warn('[MatrixMoney] Failed to load balance:', err.message);
      return null;
    }
  }

  // ─── UI Helpers ──────────────────────────────────────────────────────────

  /**
   * Shows success modal dialog
   */
  function showSuccessModal(title, message, additionalInfo) {
    const overlay = createOverlay('matrix-money-success-modal');
    overlay.innerHTML = `
      <div style="max-width: 500px; width: 100%; background: rgba(15,23,42,0.95); border: 1px solid rgba(86,210,160,0.3); border-radius: 14px; padding: 32px; color: #e0e0e0; text-align: center;">
        <div style="font-size: 48px; margin-bottom: 16px;">✓</div>
        <h2 style="font-size: 24px; margin-bottom: 16px; color: #56d2a0; font-weight: 700;">${title}</h2>
        <p style="color: #aaa; font-size: 14px; margin-bottom: 16px; line-height: 1.6;">${message}</p>
        <div style="background: rgba(86,210,160,0.1); border-left: 3px solid #56d2a0; padding: 12px 14px; border-radius: 6px; margin-bottom: 20px; text-align: left; font-size: 12px;">
          <p style="color: #aaa;">${additionalInfo}</p>
        </div>
        <button onclick="this.closest('.modal-overlay').remove()" style="width: 100%; padding: 12px 20px; background: linear-gradient(135deg, #56d2a0, #4ecdc4); color: #000; border: none; border-radius: 6px; font-weight: 700; cursor: pointer;">Continue</button>
      </div>
    `;
    document.body.appendChild(overlay);
  }

  /**
   * Shows error modal dialog
   */
  function showErrorModal(message) {
    const overlay = createOverlay('matrix-money-error-modal');
    overlay.innerHTML = `
      <div style="max-width: 500px; width: 100%; background: rgba(15,23,42,0.95); border: 1px solid rgba(255,70,70,0.3); border-radius: 14px; padding: 32px; color: #e0e0e0; text-align: center;">
        <div style="font-size: 48px; margin-bottom: 16px;">⚠</div>
        <h2 style="font-size: 22px; margin-bottom: 16px; color: #ff4646; font-weight: 700;">Error</h2>
        <p style="color: #aaa; font-size: 14px; margin-bottom: 20px;">${message}</p>
        <button onclick="this.closest('.modal-overlay').remove()" style="width: 100%; padding: 12px 20px; background: rgba(255,70,70,0.3); color: #ff4646; border: 1px solid rgba(255,70,70,0.5); border-radius: 6px; font-weight: 700; cursor: pointer;">Close</button>
      </div>
    `;
    document.body.appendChild(overlay);
  }

  // Public API
  return {
    showPurchaseModal,
    confirmPurchase,
    processPurchase,
    showWithdrawModal,
    confirmWithdraw,
    processWithdraw,
    showSuccessModal,
    showErrorModal,
    getTransactionHistory,
    getBalance
  };
})();

// Make functions available globally for onclick handlers and button clicks
window.MatrixMoney = MatrixMoney;

// Hook into existing deposit button if present (integrate with existing site)
document.addEventListener('DOMContentLoaded', () => {
  try {
    // Look for deposit buttons and wire up Matrix Money modals
    const depositButtons = document.querySelectorAll('[data-action="deposit"], .deposit-btn, .deposit-button');
    depositButtons.forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        MatrixMoney.showPurchaseModal();
      });
    });

    // Look for withdraw buttons
    const withdrawButtons = document.querySelectorAll('[data-action="withdraw"], .withdraw-btn, .withdraw-button');
    withdrawButtons.forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        MatrixMoney.showWithdrawModal();
      });
    });
  } catch (error) {
    console.warn('Error initializing Matrix Money event listeners:', error);
  }
});
