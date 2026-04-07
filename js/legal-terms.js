/**
 * Legal Terms & Conditions Module
 * Royal Slots Casino - msaart.online
 *
 * Displays Terms of Service, Privacy Policy, and Matrix Money system information
 */

const LegalTerms = (() => {
  'use strict';

  /**
   * Creates and displays the Terms of Service modal
   */
  function showTermsOfService() {
    try {
      const existingModal = document.getElementById('legal-tos-modal-overlay');
      if (existingModal) existingModal.remove();

      const overlay = document.createElement('div');
      overlay.id = 'legal-tos-modal-overlay';
      overlay.className = 'modal-overlay active';
      overlay.innerHTML = `
        <div style="max-width: 800px; width: 100%; background: rgba(15,23,42,0.95); border: 1px solid rgba(249,202,36,0.2); border-radius: 14px; padding: 32px; color: #e0e0e0; font-size: 14px; line-height: 1.6;">
          <button class="modal-close" aria-label="Close" onclick="this.closest('.modal-overlay').remove()">×</button>

          <h1 style="font-size: 28px; margin-bottom: 24px; color: #f9ca24; text-align: center; font-weight: 700;">Terms of Service</h1>
          <p style="color: #aaa; font-size: 12px; margin-bottom: 24px; text-align: center;">Royal Slots Casino | msaart.online | Last Updated: 2026</p>

          <div style="max-height: 70vh; overflow-y: auto; padding-right: 12px;">

            <section style="margin-bottom: 24px;">
              <h2 style="color: #56d2a0; font-size: 18px; margin-bottom: 12px; font-weight: 700;">1. Entertainment Platform & Virtual Currency</h2>
              <p style="margin-bottom: 10px;">Royal Slots Casino ("the Platform") is an entertainment and social gaming platform that uses a virtual currency called "Matrix Money" (MM). Matrix Money has <strong>NO real-world monetary value</strong> and is provided solely for entertainment purposes.</p>
              <p>The games and platform are designed for adult entertainment only. All transactions are final. No real money deposits or withdrawals occur on this Platform.</p>
            </section>

            <section style="margin-bottom: 24px;">
              <h2 style="color: #56d2a0; font-size: 18px; margin-bottom: 12px; font-weight: 700;">2. Digital Credits</h2>
              <p style="margin-bottom: 10px;"><strong>Purchasing Matrix Money:</strong> When you purchase Matrix Money, you are purchasing digital credits that represent entertainment credits usable on this Platform. The purchase price is the stated amount in your local currency.</p>
              <p style="margin-bottom: 10px;"><strong>Withdrawing Matrix Money:</strong> When you withdraw Matrix Money from your account, you are selling your digital credits back to the Platform at its stated value. The Platform will transfer the equivalent value in your designated payment method.</p>
              <p><strong>Important:</strong> This transaction system is used purely as a mechanism for purchase/sale transactions. The credits have no value outside this Platform and cannot be traded, sold, or transferred to third parties.</p>
            </section>

            <section style="margin-bottom: 24px;">
              <h2 style="color: #56d2a0; font-size: 18px; margin-bottom: 12px; font-weight: 700;">3. Eligibility & Age Requirements</h2>
              <p style="margin-bottom: 10px;">You must be at least 18 years of age to use this Platform. By using the Platform, you represent and warrant that you are 18 or older and have the legal capacity to enter into this agreement.</p>
              <p>We reserve the right to verify your age and may request identification. Use by minors is strictly prohibited.</p>
            </section>

            <section style="margin-bottom: 24px;">
              <h2 style="color: #56d2a0; font-size: 18px; margin-bottom: 12px; font-weight: 700;">4. No Guarantee of Winnings</h2>
              <p style="margin-bottom: 10px;">All games on the Platform use certified random number generators (RNG). The Platform maintains a mathematical edge on all games, meaning over time the house will retain a portion of all wagers placed.</p>
              <p style="margin-bottom: 10px;">There is <strong>NO GUARANTEE</strong> that you will win, recover losses, or profit from your play. The outcomes of all games are determined by chance, and your odds of losing are equal to or greater than your odds of winning.</p>
              <p>Playing games on this Platform should be considered pure entertainment with no expectation of financial gain.</p>
            </section>

            <section style="margin-bottom: 24px;">
              <h2 style="color: #56d2a0; font-size: 18px; margin-bottom: 12px; font-weight: 700;">5. Responsible Gaming</h2>
              <p style="margin-bottom: 10px;">We encourage responsible gaming. If you feel that your gaming may be becoming a problem:</p>
              <ul style="margin-left: 20px; margin-bottom: 10px;">
                <li>Set personal limits on time and Matrix Money usage</li>
                <li>Use the Platform's responsible gaming tools</li>
                <li>Reach out to support@msaart.online for assistance</li>
                <li>Consider seeking help from a gambling addiction resource</li>
              </ul>
              <p>The Platform is for entertainment only and should never be used as a means to earn money or recover financial losses.</p>
            </section>

            <section style="margin-bottom: 24px;">
              <h2 style="color: #56d2a0; font-size: 18px; margin-bottom: 12px; font-weight: 700;">6. Account Terms & Conditions</h2>
              <p style="margin-bottom: 10px;"><strong>Account Ownership:</strong> You are responsible for maintaining the confidentiality of your account credentials. You agree not to share your password or allow others to access your account.</p>
              <p style="margin-bottom: 10px;"><strong>One Account Per Person:</strong> You may only maintain one active account. Creating multiple accounts is prohibited and may result in permanent suspension.</p>
              <p style="margin-bottom: 10px;"><strong>Account Termination:</strong> The Platform reserves the right to suspend or terminate any account that violates these terms, engages in prohibited activities, or appears to involve fraudulent activity.</p>
              <p><strong>Account Recovery:</strong> If your account is compromised, contact support immediately. The Platform is not liable for unauthorized activity if you fail to maintain account security.</p>
            </section>

            <section style="margin-bottom: 24px;">
              <h2 style="color: #56d2a0; font-size: 18px; margin-bottom: 12px; font-weight: 700;">7. Prohibited Activities</h2>
              <p style="margin-bottom: 10px;">You agree NOT to:</p>
              <ul style="margin-left: 20px; margin-bottom: 10px;">
                <li>Use automated scripts, bots, or cheating software</li>
                <li>Exploit bugs or glitches in the Platform</li>
                <li>Engage in collusion with other users to manipulate outcomes</li>
                <li>Use the Platform for money laundering or fraudulent purposes</li>
                <li>Provide false information during registration or verification</li>
                <li>Access the Platform from restricted jurisdictions</li>
                <li>Engage in harassment, hate speech, or abusive behavior toward other users or staff</li>
                <li>Reverse engineer, decompile, or attempt to access Platform source code</li>
              </ul>
              <p style="margin-bottom: 10px;">Violations of these prohibitions will result in immediate account suspension and forfeiture of any Matrix Money balance.</p>
            </section>

            <section style="margin-bottom: 24px;">
              <h2 style="color: #56d2a0; font-size: 18px; margin-bottom: 12px; font-weight: 700;">8. All Transactions Are Final</h2>
              <p style="margin-bottom: 10px;">Once you complete a purchase of Matrix Money or use Matrix Money to play a game, that transaction is final and cannot be reversed.</p>
              <p style="margin-bottom: 10px;">You cannot request refunds or chargebacks for Matrix Money purchases or gaming losses. By making a purchase, you acknowledge and accept all outcomes.</p>
              <p>In cases of clear system error, the Platform may, at its sole discretion, offer compensation. Such decisions are made on a case-by-case basis and are not guaranteed.</p>
            </section>

            <section style="margin-bottom: 24px;">
              <h2 style="color: #56d2a0; font-size: 18px; margin-bottom: 12px; font-weight: 700;">9. Platform Modifications & Service Changes</h2>
              <p style="margin-bottom: 10px;">The Platform reserves the right to:</p>
              <ul style="margin-left: 20px; margin-bottom: 10px;">
                <li>Modify or update these Terms of Service at any time</li>
                <li>Change game rules, odds, or payouts</li>
                <li>Adjust Matrix Money pricing or withdrawal policies</li>
                <li>Temporarily suspend or permanently discontinue the Platform</li>
              </ul>
              <p>Continued use of the Platform after changes constitutes acceptance of new terms. We will notify users of material changes via email or in-app notification.</p>
            </section>

            <section style="margin-bottom: 24px;">
              <h2 style="color: #56d2a0; font-size: 18px; margin-bottom: 12px; font-weight: 700;">10. Limitation of Liability</h2>
              <p style="margin-bottom: 10px;">THE PLATFORM IS PROVIDED "AS IS" WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED. TO THE MAXIMUM EXTENT PERMITTED BY LAW, THE PLATFORM DISCLAIMS ALL WARRANTIES INCLUDING MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, AND NON-INFRINGEMENT.</p>
              <p style="margin-bottom: 10px;">IN NO EVENT SHALL THE PLATFORM BE LIABLE FOR INDIRECT, INCIDENTAL, SPECIAL, CONSEQUENTIAL, OR PUNITIVE DAMAGES, INCLUDING LOSS OF PROFITS, DATA, OR USE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGES.</p>
              <p>YOUR SOLE REMEDY FOR DISPUTES IS LIMITED TO THE VALUE OF YOUR MATRIX MONEY BALANCE.</p>
            </section>

            <section style="margin-bottom: 24px;">
              <h2 style="color: #56d2a0; font-size: 18px; margin-bottom: 12px; font-weight: 700;">11. Governing Law & Jurisdiction</h2>
              <p style="margin-bottom: 10px;">These Terms of Service are governed by and construed in accordance with the laws applicable to online entertainment platforms, without regard to conflict of law principles.</p>
              <p>By using the Platform, you agree to submit to the exclusive jurisdiction of the appropriate courts and waive any objection to venue or inconvenient forum.</p>
            </section>

            <section style="margin-bottom: 24px;">
              <h2 style="color: #56d2a0; font-size: 18px; margin-bottom: 12px; font-weight: 700;">12. Contact & Dispute Resolution</h2>
              <p style="margin-bottom: 10px;">For questions, disputes, or complaints, contact us at:</p>
              <p style="margin-bottom: 10px;"><strong>Email:</strong> support@msaart.online<br><strong>Platform:</strong> msaart.online</p>
              <p>We will attempt to resolve disputes within 30 days. If unresolved, you may pursue further legal action in accordance with applicable law.</p>
            </section>

            <section style="border-top: 1px solid rgba(249,202,36,0.2); padding-top: 20px;">
              <p style="color: #f9ca24; font-weight: 700; margin-bottom: 10px;">⚠ Entertainment Only</p>
              <p style="color: #aaa; font-size: 13px;">Royal Slots Casino is an entertainment platform with virtual currency. Matrix Money has no real monetary value. Your use of this Platform constitutes acceptance of these Terms of Service.</p>
            </section>

          </div>

          <button onclick="this.closest('.modal-overlay').remove()" style="width: 100%; margin-top: 24px; padding: 12px 20px; background: linear-gradient(135deg, #f9ca24, #f0932b); color: #000; border: none; border-radius: 8px; font-weight: 700; font-size: 14px; cursor: pointer;">I Accept These Terms</button>
        </div>
      `;

      document.body.appendChild(overlay);
      overlay.addEventListener('click', (e) => {
        if (e.target === overlay) overlay.remove();
      });
    } catch (error) {
      console.warn('Error displaying Terms of Service:', error);
    }
  }

  /**
   * Creates and displays the Privacy Policy modal
   */
  function showPrivacyPolicy() {
    try {
      const existingModal = document.getElementById('legal-privacy-modal-overlay');
      if (existingModal) existingModal.remove();

      const overlay = document.createElement('div');
      overlay.id = 'legal-privacy-modal-overlay';
      overlay.className = 'modal-overlay active';
      overlay.innerHTML = `
        <div style="max-width: 800px; width: 100%; background: rgba(15,23,42,0.95); border: 1px solid rgba(249,202,36,0.2); border-radius: 14px; padding: 32px; color: #e0e0e0; font-size: 14px; line-height: 1.6;">
          <button class="modal-close" aria-label="Close" onclick="this.closest('.modal-overlay').remove()">×</button>

          <h1 style="font-size: 28px; margin-bottom: 24px; color: #f9ca24; text-align: center; font-weight: 700;">Privacy Policy</h1>
          <p style="color: #aaa; font-size: 12px; margin-bottom: 24px; text-align: center;">Royal Slots Casino | msaart.online | Last Updated: 2026</p>

          <div style="max-height: 70vh; overflow-y: auto; padding-right: 12px;">

            <section style="margin-bottom: 24px;">
              <h2 style="color: #56d2a0; font-size: 18px; margin-bottom: 12px; font-weight: 700;">1. Information We Collect</h2>
              <p style="margin-bottom: 10px;"><strong>Account Information:</strong> When you create an account, we collect your name, email address, date of birth, and other registration details.</p>
              <p style="margin-bottom: 10px;"><strong>Payment Information:</strong> We collect information necessary to process your Matrix Money purchases and withdrawals, including payment method details and transaction history.</p>
              <p style="margin-bottom: 10px;"><strong>Usage Data:</strong> We automatically collect data about your interactions with the Platform, including games played, wagers placed, time spent, and IP address.</p>
              <p><strong>Device Information:</strong> We collect information about your device, browser, operating system, and other technical details to provide optimal Platform functionality.</p>
            </section>

            <section style="margin-bottom: 24px;">
              <h2 style="color: #56d2a0; font-size: 18px; margin-bottom: 12px; font-weight: 700;">2. How We Use Your Information</h2>
              <ul style="margin-left: 20px; margin-bottom: 10px;">
                <li>To provide, maintain, and improve the Platform</li>
                <li>To process your Matrix Money transactions</li>
                <li>To verify your age and identity for compliance</li>
                <li>To detect and prevent fraud, abuse, and cheating</li>
                <li>To respond to your support requests</li>
                <li>To send service-related announcements and updates</li>
                <li>To analyze usage patterns and improve user experience</li>
              </ul>
            </section>

            <section style="margin-bottom: 24px;">
              <h2 style="color: #56d2a0; font-size: 18px; margin-bottom: 12px; font-weight: 700;">3. Data Security</h2>
              <p style="margin-bottom: 10px;">We implement industry-standard security measures to protect your personal information, including encryption, secure servers, and access controls.</p>
              <p>However, no security system is completely secure. We cannot guarantee absolute protection of your data. You use the Platform at your own risk.</p>
            </section>

            <section style="margin-bottom: 24px;">
              <h2 style="color: #56d2a0; font-size: 18px; margin-bottom: 12px; font-weight: 700;">4. Third-Party Sharing</h2>
              <p style="margin-bottom: 10px;">We do not sell or rent your personal information to third parties. However, we may share information:</p>
              <ul style="margin-left: 20px; margin-bottom: 10px;">
                <li>With payment processors to facilitate transactions</li>
                <li>With law enforcement if required by law</li>
                <li>With service providers who assist in Platform operations</li>
              </ul>
            </section>

            <section style="margin-bottom: 24px;">
              <h2 style="color: #56d2a0; font-size: 18px; margin-bottom: 12px; font-weight: 700;">5. Your Rights & Choices</h2>
              <p style="margin-bottom: 10px;">You may request access to, correction of, or deletion of your personal data. Contact support@msaart.online with your request.</p>
              <p>Please note that we may retain certain information for legal, compliance, or operational purposes even after deletion requests.</p>
            </section>

            <section style="margin-bottom: 24px;">
              <h2 style="color: #56d2a0; font-size: 18px; margin-bottom: 12px; font-weight: 700;">6. Contact Us</h2>
              <p>For privacy concerns or data requests, contact: <strong>support@msaart.online</strong></p>
            </section>

          </div>

          <button onclick="this.closest('.modal-overlay').remove()" style="width: 100%; margin-top: 24px; padding: 12px 20px; background: linear-gradient(135deg, #f9ca24, #f0932b); color: #000; border: none; border-radius: 8px; font-weight: 700; font-size: 14px; cursor: pointer;">Close</button>
        </div>
      `;

      document.body.appendChild(overlay);
      overlay.addEventListener('click', (e) => {
        if (e.target === overlay) overlay.remove();
      });
    } catch (error) {
      console.warn('Error displaying Privacy Policy:', error);
    }
  }

  /**
   * Creates and displays the Matrix Money system information modal
   */
  function showMatrixMoneyInfo() {
    try {
      const existingModal = document.getElementById('legal-matrix-money-modal-overlay');
      if (existingModal) existingModal.remove();

      const overlay = document.createElement('div');
      overlay.id = 'legal-matrix-money-modal-overlay';
      overlay.className = 'modal-overlay active';
      overlay.innerHTML = `
        <div style="max-width: 800px; width: 100%; background: rgba(15,23,42,0.95); border: 1px solid rgba(249,202,36,0.2); border-radius: 14px; padding: 32px; color: #e0e0e0; font-size: 14px; line-height: 1.6;">
          <button class="modal-close" aria-label="Close" onclick="this.closest('.modal-overlay').remove()">×</button>

          <h1 style="font-size: 28px; margin-bottom: 24px; color: #56d2a0; text-align: center; font-weight: 700;">Matrix Money System</h1>
          <p style="color: #aaa; font-size: 12px; margin-bottom: 24px; text-align: center;">How It Works</p>

          <div style="max-height: 70vh; overflow-y: auto; padding-right: 12px;">

            <section style="margin-bottom: 24px;">
              <h2 style="color: #f9ca24; font-size: 20px; margin-bottom: 12px; font-weight: 700;">What is Matrix Money?</h2>
              <p style="margin-bottom: 10px;">Matrix Money (MM) is a virtual entertainment currency used exclusively on Royal Slots Casino. It has <strong>NO real monetary value</strong> and cannot be converted to cash except through official withdrawal on our Platform.</p>
              <p>Matrix Money is provided for entertainment purposes only. It represents entertainment credits that allow you to play games on the Platform.</p>
            </section>

            <section style="margin-bottom: 24px;">
              <h2 style="color: #f9ca24; font-size: 20px; margin-bottom: 12px; font-weight: 700;">How It Works</h2>
              <p style="margin-bottom: 10px;">To provide a transparent and secure transaction mechanism, Matrix Money purchases and sales use secure digital ledger technology.</p>
              <p style="margin-bottom: 10px;"><strong>What this means:</strong> Each Matrix Money purchase creates a secure digital record of your entertainment credit ownership. Each withdrawal converts that digital record back to currency.</p>
              <p style="color: #aaa; font-size: 13px;">This framework ensures every transaction is traceable, secure, and protected against fraud.</p>
            </section>

            <section style="margin-bottom: 24px; background: rgba(86,210,160,0.1); border: 1px solid rgba(86,210,160,0.3); border-radius: 8px; padding: 16px;">
              <h3 style="color: #56d2a0; font-size: 16px; margin-bottom: 12px; font-weight: 700;">🎮 How Purchases Work</h3>
              <ol style="margin-left: 20px;">
                <li style="margin-bottom: 8px;">You select a Matrix Money package (e.g., $10 for 1,100 MM)</li>
                <li style="margin-bottom: 8px;">You complete payment using your preferred method</li>
                <li style="margin-bottom: 8px;">The Platform creates a secure record of your credits</li>
                <li style="margin-bottom: 8px;">Matrix Money is instantly added to your account balance</li>
                <li>You can now use Matrix Money to play games</li>
              </ol>
            </section>

            <section style="margin-bottom: 24px; background: rgba(249,202,36,0.1); border: 1px solid rgba(249,202,36,0.3); border-radius: 8px; padding: 16px;">
              <h3 style="color: #f9ca24; font-size: 16px; margin-bottom: 12px; font-weight: 700;">💰 How Withdrawals Work</h3>
              <ol style="margin-left: 20px;">
                <li style="margin-bottom: 8px;">You request to withdraw some or all of your Matrix Money</li>
                <li style="margin-bottom: 8px;">The Platform "sells" your digital credits at the stated value</li>
                <li style="margin-bottom: 8px;">Your Matrix Money balance is reduced accordingly</li>
                <li style="margin-bottom: 8px;">Funds are transferred to your registered payment method</li>
                <li>Processing typically takes 3-5 business days</li>
              </ol>
            </section>

            <section style="margin-bottom: 24px;">
              <h2 style="color: #f9ca24; font-size: 20px; margin-bottom: 12px; font-weight: 700;">Important Clarifications</h2>
              <ul style="margin-left: 20px; margin-bottom: 10px;">
                <li style="margin-bottom: 8px;"><strong>No Third-Party Trading:</strong> Matrix Money credits cannot be traded, sold, or transferred to other users or platforms. They exist solely within our system.</li>
                <li style="margin-bottom: 8px;"><strong>Digital Entertainment Credit System:</strong> Matrix Money is a digital entertainment credit system with no real monetary value.</li>
                <li style="margin-bottom: 8px;"><strong>No Profit Guarantee:</strong> This system does not imply any guarantee of profit or return on your entertainment spending.</li>
                <li style="margin-bottom: 8px;"><strong>Final Transactions:</strong> All Matrix Money purchases and gaming losses are final and cannot be reversed or refunded.</li>
              </ul>
            </section>

            <section style="margin-bottom: 24px;">
              <h2 style="color: #f9ca24; font-size: 20px; margin-bottom: 12px; font-weight: 700;">Pricing Tiers</h2>
              <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 12px; margin-top: 12px;">
                <div style="background: rgba(86,210,160,0.15); border: 1px solid rgba(86,210,160,0.3); border-radius: 8px; padding: 12px; text-align: center;">
                  <div style="color: #f9ca24; font-weight: 700; font-size: 16px;">$5</div>
                  <div style="color: #56d2a0; font-size: 14px; font-weight: 700;">500 MM</div>
                </div>
                <div style="background: rgba(86,210,160,0.15); border: 1px solid rgba(86,210,160,0.3); border-radius: 8px; padding: 12px; text-align: center;">
                  <div style="color: #f9ca24; font-weight: 700; font-size: 16px;">$10</div>
                  <div style="color: #56d2a0; font-size: 14px; font-weight: 700;">1,100 MM</div>
                </div>
                <div style="background: rgba(86,210,160,0.15); border: 1px solid rgba(86,210,160,0.3); border-radius: 8px; padding: 12px; text-align: center;">
                  <div style="color: #f9ca24; font-weight: 700; font-size: 16px;">$25</div>
                  <div style="color: #56d2a0; font-size: 14px; font-weight: 700;">3,000 MM</div>
                </div>
                <div style="background: rgba(86,210,160,0.15); border: 1px solid rgba(86,210,160,0.3); border-radius: 8px; padding: 12px; text-align: center;">
                  <div style="color: #f9ca24; font-weight: 700; font-size: 16px;">$50</div>
                  <div style="color: #56d2a0; font-size: 14px; font-weight: 700;">6,500 MM</div>
                </div>
                <div style="background: rgba(86,210,160,0.15); border: 1px solid rgba(86,210,160,0.3); border-radius: 8px; padding: 12px; text-align: center;">
                  <div style="color: #f9ca24; font-weight: 700; font-size: 16px;">$100</div>
                  <div style="color: #56d2a0; font-size: 14px; font-weight: 700;">14,000 MM</div>
                </div>
              </div>
            </section>

            <section style="border-top: 1px solid rgba(249,202,36,0.2); padding-top: 20px;">
              <p style="color: #f9ca24; font-weight: 700; margin-bottom: 10px;">⚠ Remember: Entertainment Only</p>
              <p style="color: #aaa; font-size: 13px;">Matrix Money has NO real monetary value. The transaction system is used purely as a secure mechanism. All games are for entertainment, and the house maintains an edge on all games. Play responsibly.</p>
            </section>

          </div>

          <button onclick="this.closest('.modal-overlay').remove()" style="width: 100%; margin-top: 24px; padding: 12px 20px; background: linear-gradient(135deg, #f9ca24, #f0932b); color: #000; border: none; border-radius: 8px; font-weight: 700; font-size: 14px; cursor: pointer;">Close</button>
        </div>
      `;

      document.body.appendChild(overlay);
      overlay.addEventListener('click', (e) => {
        if (e.target === overlay) overlay.remove();
      });
    } catch (error) {
      console.warn('Error displaying Matrix Money Info:', error);
    }
  }

  // Public API
  return {
    showTermsOfService,
    showPrivacyPolicy,
    showMatrixMoneyInfo
  };
})();

// Make functions available globally for onclick handlers
window.showTermsOfService = () => LegalTerms.showTermsOfService();
window.showPrivacyPolicy = () => LegalTerms.showPrivacyPolicy();
window.showMatrixMoneyInfo = () => LegalTerms.showMatrixMoneyInfo();

// ═══ First-visit Terms Acceptance Gate ═══
(function checkFirstVisitConsent() {
    const CONSENT_KEY = 'matrixSpins_termsAccepted';
    if (localStorage.getItem(CONSENT_KEY)) return;

    // Wait for DOM ready
    const show = () => {
        const overlay = document.createElement('div');
        overlay.id = 'first-visit-consent';
        overlay.style.cssText = 'position:fixed;inset:0;z-index:99999;background:rgba(0,0,0,0.92);display:flex;align-items:center;justify-content:center;padding:20px;backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);';
        overlay.innerHTML = `
            <div style="max-width:540px;width:100%;background:linear-gradient(135deg,#0f172a 0%,#1e293b 100%);border:1px solid rgba(249,202,36,0.3);border-radius:16px;padding:32px;color:#e0e0e0;text-align:center;">
                <div style="font-size:48px;margin-bottom:12px;">🎰</div>
                <h2 style="color:#f9ca24;font-size:22px;margin-bottom:12px;">Welcome to Royal Slots Casino</h2>
                <div style="background:rgba(220,38,38,0.12);border:1px solid rgba(220,38,38,0.3);border-radius:8px;padding:12px;margin-bottom:16px;">
                    <p style="color:#fca5a5;font-size:13px;font-weight:600;margin:0;">⚠️ IMPORTANT NOTICE</p>
                    <p style="color:#e0e0e0;font-size:12px;margin:6px 0 0;">Matrix Money is a virtual entertainment currency with <strong>NO real-world monetary value</strong>. This platform is for entertainment purposes only. All purchases constitute the acquisition of digital entertainment credits.</p>
                </div>
                <p style="font-size:13px;color:#94a3b8;margin-bottom:16px;">By continuing, you confirm you are <strong style="color:#f9ca24;">18 years or older</strong> and agree to our <a href="#" onclick="event.preventDefault();showTermsOfService();" style="color:#f9ca24;text-decoration:underline;">Terms of Service</a> and <a href="#" onclick="event.preventDefault();showPrivacyPolicy();" style="color:#f9ca24;text-decoration:underline;">Privacy Policy</a>.</p>
                <button id="acceptTermsBtn" style="background:linear-gradient(135deg,#f59e0b,#d97706);color:#000;font-weight:700;font-size:15px;padding:12px 40px;border:none;border-radius:8px;cursor:pointer;width:100%;transition:opacity 0.2s;">I am 18+ and I Accept</button>
                <p style="font-size:11px;color:#64748b;margin-top:10px;">Gambling can be addictive. Please play responsibly.</p>
            </div>
        `;
        document.body.appendChild(overlay);
        document.getElementById('acceptTermsBtn').addEventListener('click', () => {
            localStorage.setItem(CONSENT_KEY, Date.now().toString());
            overlay.style.opacity = '0';
            overlay.style.transition = 'opacity 0.3s ease';
            setTimeout(() => overlay.remove(), 300);
        });
    };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', show);
    } else {
        show();
    }
})();
