/**
 * Matrix Spins Casino — Retention & Engagement System
 * Daily login bonus, win streaks, low balance prompts, session stats, leaderboard
 * All amounts in fiat ($) — zero crypto terminology
 */

(() => {
  const STORAGE_PREFIX = 'royal_slots_';

  // ============================================================================
  // DAILY LOGIN BONUS
  // ============================================================================
  const DailyBonus = {
    BONUS_TIERS: [
      { day: 1, amount: 5.00,   label: 'Day 1' },
      { day: 2, amount: 10.00,  label: 'Day 2' },
      { day: 3, amount: 15.00,  label: 'Day 3' },
      { day: 4, amount: 20.00,  label: 'Day 4' },
      { day: 5, amount: 30.00,  label: 'Day 5' },
      { day: 6, amount: 40.00,  label: 'Day 6' },
      { day: 7, amount: 100.00, label: 'Day 7 Jackpot!' }
    ],

    getStreak() {
      const data = this._load();
      const today = this._todayKey();

      if (data.lastClaimDate === today) {
        return { streak: data.streak, claimedToday: true, nextBonus: null };
      }

      const yesterday = this._dateKey(new Date(Date.now() - 86400000));
      let newStreak = data.lastClaimDate === yesterday ? data.streak + 1 : 1;
      if (newStreak > 7) newStreak = 1;

      const tier = this.BONUS_TIERS[newStreak - 1];
      return { streak: newStreak, claimedToday: false, nextBonus: tier };
    },

    claim() {
      const info = this.getStreak();
      if (info.claimedToday) return null;

      const data = {
        streak: info.streak,
        lastClaimDate: this._todayKey(),
        totalClaimed: (this._load().totalClaimed || 0) + info.nextBonus.amount
      };
      this._save(data);

      return {
        amount: info.nextBonus.amount,
        day: info.streak,
        label: info.nextBonus.label
      };
    },

    _todayKey() {
      return this._dateKey(new Date());
    },

    _dateKey(date) {
      return date.toISOString().split('T')[0];
    },

    _load() {
      try {
        return JSON.parse(localStorage.getItem(STORAGE_PREFIX + 'daily_bonus') || '{}');
      } catch { return {}; }
    },

    _save(data) {
      localStorage.setItem(STORAGE_PREFIX + 'daily_bonus', JSON.stringify(data));
    }
  };

  // ============================================================================
  // WIN STREAK REWARDS
  // ============================================================================
  const WinStreaks = {
    STREAK_REWARDS: {
      3:  { multiplier: 1.1, label: '3-Win Streak! +10% bonus' },
      5:  { multiplier: 1.25, label: '5-Win Streak! +25% bonus' },
      10: { multiplier: 1.5, label: '10-Win Streak! +50% bonus' },
      20: { multiplier: 2.0, label: '20-Win Streak! DOUBLE bonus' }
    },

    currentStreak: 0,
    bestStreak: 0,

    init() {
      const data = this._load();
      this.currentStreak = data.currentStreak || 0;
      this.bestStreak = data.bestStreak || 0;
    },

    recordWin() {
      this.currentStreak++;
      if (this.currentStreak > this.bestStreak) {
        this.bestStreak = this.currentStreak;
      }
      this._save();

      const reward = this.STREAK_REWARDS[this.currentStreak];
      return reward || null;
    },

    recordLoss() {
      this.currentStreak = 0;
      this._save();
    },

    getMultiplier() {
      let best = 1.0;
      for (const [threshold, reward] of Object.entries(this.STREAK_REWARDS)) {
        if (this.currentStreak >= parseInt(threshold)) {
          best = reward.multiplier;
        }
      }
      return best;
    },

    _load() {
      try {
        return JSON.parse(localStorage.getItem(STORAGE_PREFIX + 'win_streaks') || '{}');
      } catch { return {}; }
    },

    _save() {
      localStorage.setItem(STORAGE_PREFIX + 'win_streaks', JSON.stringify({
        currentStreak: this.currentStreak,
        bestStreak: this.bestStreak
      }));
    }
  };

  // ============================================================================
  // LOW BALANCE PROMPT
  // ============================================================================
  const LowBalancePrompt = {
    THRESHOLD: 5.00,
    lastPromptTime: 0,
    COOLDOWN: 120000, // 2 minutes between prompts

    shouldPrompt(balance) {
      if (balance > this.THRESHOLD) return false;
      if (Date.now() - this.lastPromptTime < this.COOLDOWN) return false;
      return true;
    },

    showPrompt(balance) {
      if (!this.shouldPrompt(balance)) return;
      this.lastPromptTime = Date.now();

      const overlay = document.createElement('div');
      overlay.id = 'low-balance-prompt';
      overlay.style.cssText = `
        position: fixed; top: 0; left: 0; right: 0; bottom: 0;
        background: rgba(0,0,0,0.85); z-index: 1000000;
        display: flex; align-items: center; justify-content: center;
        animation: fadeIn 0.3s ease;
      `;
      overlay.innerHTML = `
        <div style="background: linear-gradient(135deg, #1a1a1a, #2d2d2d); border: 2px solid #DAA520;
             border-radius: 12px; padding: 40px; max-width: 400px; text-align: center; color: #E0E0E0;">
          <div style="font-size: 48px; margin-bottom: 16px;">💰</div>
          <h2 style="color: #DAA520; margin-bottom: 12px; font-size: 22px;">Running Low!</h2>
          <p style="margin-bottom: 8px;">Your balance is <strong style="color: #DAA520;">$${balance.toFixed(2)}</strong></p>
          <p style="margin-bottom: 24px; color: #999; font-size: 14px;">Add funds to keep playing your favorite games.</p>
          <div style="display: flex; gap: 12px; justify-content: center;">
            <button onclick="this.closest('#low-balance-prompt').remove()"
              style="padding: 12px 24px; background: #333; color: #ccc; border: 1px solid #555;
                     border-radius: 6px; cursor: pointer; font-size: 14px;">Maybe Later</button>
            <button onclick="this.closest('#low-balance-prompt').remove(); window.CasinoDeposit && window.CasinoDeposit.show();"
              style="padding: 12px 24px; background: linear-gradient(135deg, #DAA520, #B8860B);
                     color: #000; border: none; border-radius: 6px; cursor: pointer; font-weight: bold; font-size: 14px;">
              Deposit Now</button>
          </div>
          <p style="margin-top: 16px; font-size: 11px; color: #666;">Please gamble responsibly. Set deposit limits in your account settings.</p>
        </div>
      `;
      document.body.appendChild(overlay);
      overlay.addEventListener('click', (e) => {
        if (e.target === overlay) overlay.remove();
      });
    }
  };

  // ============================================================================
  // SESSION STATS TRACKER
  // ============================================================================
  const SessionStats = {
    data: {
      sessionId: Date.now().toString(36),
      startTime: Date.now(),
      spinsPlayed: 0,
      totalWagered: 0,
      totalWon: 0,
      biggestWin: 0,
      gamesPlayed: new Set(),
      depositsThisSession: 0
    },

    recordSpin(betAmount, winAmount, gameId) {
      this.data.spinsPlayed++;
      this.data.totalWagered += betAmount;
      this.data.totalWon += winAmount;
      if (winAmount > this.data.biggestWin) this.data.biggestWin = winAmount;
      if (gameId) this.data.gamesPlayed.add(gameId);
    },

    getSessionDuration() {
      return Math.floor((Date.now() - this.data.startTime) / 1000);
    },

    getSessionRtp() {
      if (this.data.totalWagered === 0) return 0;
      return (this.data.totalWon / this.data.totalWagered) * 100;
    },

    getNetResult() {
      return this.data.totalWon - this.data.totalWagered;
    },

    getSummary() {
      const duration = this.getSessionDuration();
      const hours = Math.floor(duration / 3600);
      const minutes = Math.floor((duration % 3600) / 60);
      const seconds = duration % 60;

      return {
        duration: `${String(hours).padStart(2,'0')}:${String(minutes).padStart(2,'0')}:${String(seconds).padStart(2,'0')}`,
        spins: this.data.spinsPlayed,
        wagered: this.data.totalWagered,
        won: this.data.totalWon,
        net: this.getNetResult(),
        rtp: this.getSessionRtp(),
        biggestWin: this.data.biggestWin,
        gamesCount: this.data.gamesPlayed.size
      };
    }
  };

  // ============================================================================
  // LEADERBOARD (Local simulation)
  // ============================================================================
  const Leaderboard = {
    SIMULATED_PLAYERS: [
      { name: 'LuckyAce77', totalWon: 12450.00, biggestWin: 3200.00, spins: 892 },
      { name: 'GoldRush_Pro', totalWon: 9870.50, biggestWin: 2100.00, spins: 1205 },
      { name: 'SpinMaster99', totalWon: 8920.00, biggestWin: 1800.00, spins: 743 },
      { name: 'DiamondKing', totalWon: 7650.25, biggestWin: 4500.00, spins: 561 },
      { name: 'ReelQueen', totalWon: 6340.00, biggestWin: 1200.00, spins: 988 },
      { name: 'JackpotJane', totalWon: 5890.75, biggestWin: 2800.00, spins: 412 },
      { name: 'WildCard_X', totalWon: 4560.00, biggestWin: 950.00, spins: 1567 },
      { name: 'StarPlayer21', totalWon: 3780.50, biggestWin: 780.00, spins: 834 },
      { name: 'MegaSpin', totalWon: 2950.00, biggestWin: 600.00, spins: 1102 },
      { name: 'SlotChamp', totalWon: 2100.25, biggestWin: 450.00, spins: 645 }
    ],

    getTopPlayers(playerStats) {
      const allPlayers = [...this.SIMULATED_PLAYERS];

      if (playerStats && playerStats.totalWon > 0) {
        allPlayers.push({
          name: 'You',
          totalWon: playerStats.totalWon,
          biggestWin: playerStats.biggestWin,
          spins: playerStats.spinsPlayed,
          isPlayer: true
        });
      }

      allPlayers.sort((a, b) => b.totalWon - a.totalWon);
      return allPlayers.slice(0, 10);
    }
  };

  // ============================================================================
  // DEPOSIT / WITHDRAW FLOW (Stripe-ready stubs)
  // ============================================================================
  const CasinoDeposit = {
    QUICK_AMOUNTS: [10, 25, 50, 100, 250],

    show() {
      if (document.getElementById('deposit-modal')) return;

      const modal = document.createElement('div');
      modal.id = 'deposit-modal';
      modal.style.cssText = `
        position: fixed; top: 0; left: 0; right: 0; bottom: 0;
        background: rgba(0,0,0,0.9); z-index: 1000000;
        display: flex; align-items: center; justify-content: center;
      `;

      const quickBtns = this.QUICK_AMOUNTS.map(a =>
        `<button class="deposit-quick-btn" onclick="window.CasinoDeposit.processDeposit(${a})"
          style="padding:14px;background:${a === 25 ? 'rgba(218,165,32,0.15)' : '#1a1a1a'};border:2px solid ${a === 25 ? '#FFD700' : '#DAA520'};color:#DAA520;
                 border-radius:8px;cursor:pointer;font-size:16px;font-weight:bold;
                 transition:all 0.2s;position:relative;">${a === 25 ? '<span style="position:absolute;top:-8px;right:-4px;background:#DAA520;color:#000;font-size:9px;font-weight:800;padding:1px 6px;border-radius:8px;letter-spacing:0.3px;">POPULAR</span>' : ''}$${a}</button>`
      ).join('');

      modal.innerHTML = `
        <div style="background:linear-gradient(135deg,#111,#1a1a1a);border:2px solid #DAA520;
             border-radius:16px;padding:40px;max-width:480px;width:90%;color:#E0E0E0;">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:24px;">
            <h2 style="color:#DAA520;font-size:24px;">Add Funds</h2>
            <button onclick="document.getElementById('deposit-modal').remove()"
              style="background:none;border:none;color:#999;font-size:28px;cursor:pointer;">×</button>
          </div>
          <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin-bottom:24px;">
            ${quickBtns}
          </div>
          <div style="margin-bottom:24px;">
            <label style="display:block;margin-bottom:8px;color:#999;font-size:13px;">Custom Amount</label>
            <div style="display:flex;gap:12px;">
              <input id="deposit-custom-amount" type="number" inputmode="decimal" enterkeyhint="done" autocomplete="off" pattern="[0-9]*" min="5" max="10000" step="5" placeholder="Enter amount"
                style="flex:1;padding:12px;background:#0a0a0a;border:1px solid #333;color:#E0E0E0;
                       border-radius:6px;font-size:16px;">
              <button onclick="const v=document.getElementById('deposit-custom-amount').value;if(v>0)window.CasinoDeposit.processDeposit(parseFloat(v));"
                style="padding:12px 24px;background:linear-gradient(135deg,#DAA520,#B8860B);
                       color:#000;border:none;border-radius:6px;cursor:pointer;font-weight:bold;">Deposit</button>
            </div>
          </div>
          <div style="border-top:1px solid #333;padding-top:16px;">
            <p style="font-size:12px;color:#666;text-align:center;">
              Secure payments powered by Stripe. All transactions in USD.
              <br>Min: $5 | Max: $10,000 per transaction.
            </p>
          </div>
        </div>
      `;

      document.body.appendChild(modal);
      modal.addEventListener('click', (e) => {
        if (e.target === modal) modal.remove();
      });
    },

    processDeposit(amount) {
      const _toast = (msg, sev) => {
        if (typeof showToast === 'function') showToast(msg, sev);
      };

      if (!Number.isFinite(amount) || amount < 5 || amount > 10000) {
        _toast('Deposit must be between $5 and $10,000.', 'error');
        return;
      }

      const token = typeof authToken !== 'undefined' ? authToken : '';
      if (!token) {
        window.location.href = '/login.html';
        return;
      }

      // Keep modal visible with a loading state so the player gets
      // unambiguous feedback while we negotiate the Stripe checkout URL.
      // Built via DOM APIs (no innerHTML) — safe even though amount is
      // validated, no string interpolation into HTML.
      const modal = document.getElementById('deposit-modal');
      const inner = modal && modal.querySelector(':scope > div');
      const originalChildren = inner ? Array.from(inner.childNodes) : null;
      if (inner) {
        while (inner.firstChild) inner.removeChild(inner.firstChild);
        const wrap = document.createElement('div');
        wrap.style.cssText = 'text-align:center;padding:32px 8px;';
        const spinner = document.createElement('div');
        spinner.style.cssText = 'width:48px;height:48px;margin:0 auto 20px;border:4px solid #333;border-top-color:#DAA520;border-radius:50%;animation:retentionSpin 0.8s linear infinite;';
        const heading = document.createElement('h2');
        heading.style.cssText = 'color:#DAA520;font-size:22px;margin:0 0 8px;';
        heading.textContent = 'Redirecting to Stripe…';
        const sub = document.createElement('p');
        sub.style.cssText = 'color:#999;margin:0;font-size:14px;';
        sub.textContent = 'Securing your $' + amount.toFixed(2) + ' deposit. Do not close this window.';
        wrap.appendChild(spinner);
        wrap.appendChild(heading);
        wrap.appendChild(sub);
        inner.appendChild(wrap);

        if (!document.getElementById('retention-spin-keyframes')) {
          const style = document.createElement('style');
          style.id = 'retention-spin-keyframes';
          style.textContent = '@keyframes retentionSpin{to{transform:rotate(360deg)}}';
          document.head.appendChild(style);
        }
      }

      const _restore = () => {
        if (!inner || !originalChildren) return;
        while (inner.firstChild) inner.removeChild(inner.firstChild);
        originalChildren.forEach((n) => inner.appendChild(n));
      };

      fetch('/api/payment/create-checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
        body: JSON.stringify({ amount: amount, playerId: typeof playerId !== 'undefined' ? playerId : 'anon' })
      })
      .then(r => r.json())
      .then(data => {
        if (data.url) {
          window.location.href = data.url;
        } else {
          _restore();
          _toast(data.error || 'Payment error. Please try again.', 'error');
        }
      })
      .catch(e => {
        _restore();
        _toast('Connection error: ' + e.message, 'error');
      });
    },

    _showConfirmation(amount, newBalance) {
      const toast = document.createElement('div');
      toast.style.cssText = `
        position: fixed; top: 20px; right: 20px; z-index: 1000001;
        background: linear-gradient(135deg, #1a3a1a, #0d2d0d); border: 2px solid #4CAF50;
        border-radius: 8px; padding: 20px 28px; color: #4CAF50;
        font-weight: bold; font-size: 16px; box-shadow: 0 8px 24px rgba(0,0,0,0.5);
        animation: slideIn 0.3s ease;
      `;
      toast.innerHTML = `
        <div>+$${amount.toFixed(2)} deposited!</div>
        <div style="font-size:13px;color:#999;margin-top:4px;">New balance: $${newBalance.toFixed(2)}</div>
      `;
      document.body.appendChild(toast);
      setTimeout(() => toast.remove(), 4000);
    }
  };

  const CasinoWithdraw = {
    show() {
      if (document.getElementById('withdraw-modal')) return;

      const balance = parseFloat(localStorage.getItem(STORAGE_PREFIX + 'balance') || '1000');

      const modal = document.createElement('div');
      modal.id = 'withdraw-modal';
      modal.style.cssText = `
        position: fixed; top: 0; left: 0; right: 0; bottom: 0;
        background: rgba(0,0,0,0.9); z-index: 1000000;
        display: flex; align-items: center; justify-content: center;
      `;
      modal.innerHTML = `
        <div style="background:linear-gradient(135deg,#111,#1a1a1a);border:2px solid #DAA520;
             border-radius:16px;padding:40px;max-width:420px;width:90%;color:#E0E0E0;">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:24px;">
            <h2 style="color:#DAA520;font-size:24px;">Withdraw Funds</h2>
            <button onclick="document.getElementById('withdraw-modal').remove()"
              style="background:none;border:none;color:#999;font-size:28px;cursor:pointer;">×</button>
          </div>
          <p style="margin-bottom:16px;color:#999;">Available balance: <strong style="color:#DAA520;">$${balance.toFixed(2)}</strong></p>
          <div style="margin-bottom:24px;">
            <input id="withdraw-amount" type="number" inputmode="decimal" enterkeyhint="done" autocomplete="off" pattern="[0-9]*" min="10" max="${balance}" step="5" placeholder="Amount to withdraw"
              style="width:100%;padding:12px;background:#0a0a0a;border:1px solid #333;color:#E0E0E0;
                     border-radius:6px;font-size:16px;margin-bottom:12px;">
            <button onclick="window.CasinoWithdraw.processWithdraw()"
              style="width:100%;padding:14px;background:linear-gradient(135deg,#DAA520,#B8860B);
                     color:#000;border:none;border-radius:6px;cursor:pointer;font-weight:bold;font-size:16px;">
              Request Withdrawal</button>
          </div>
          <p style="font-size:12px;color:#666;text-align:center;">
            Min withdrawal: $10. Processed within 1-3 business days.
          </p>
        </div>
      `;

      document.body.appendChild(modal);
      modal.addEventListener('click', (e) => {
        if (e.target === modal) modal.remove();
      });
    },

    processWithdraw() {
      const _toast = (msg, sev) => {
        if (typeof showToast === 'function') showToast(msg, sev);
      };
      const amountInput = document.getElementById('withdraw-amount');
      const amount = parseFloat(amountInput?.value || 0);
      const balance = parseFloat(localStorage.getItem(STORAGE_PREFIX + 'balance') || '1000');

      if (!Number.isFinite(amount) || amount < 10) { _toast('Minimum withdrawal is $10.', 'error'); return; }
      if (amount > balance) { _toast('Insufficient balance.', 'error'); return; }

      const newBalance = balance - amount;
      localStorage.setItem(STORAGE_PREFIX + 'balance', newBalance.toFixed(2));

      const balEl = document.getElementById('balanceDisplay');
      if (balEl) balEl.textContent = `$${newBalance.toFixed(2)}`;

      const modal = document.getElementById('withdraw-modal');
      if (modal) modal.remove();

      const toast = document.createElement('div');
      toast.style.cssText = `
        position: fixed; top: 20px; right: 20px; z-index: 1000001;
        background: linear-gradient(135deg, #1a1a3a, #0d0d2d); border: 2px solid #6495ED;
        border-radius: 8px; padding: 20px 28px; color: #6495ED;
        font-weight: bold; font-size: 16px; box-shadow: 0 8px 24px rgba(0,0,0,0.5);
      `;
      toast.innerHTML = `
        <div>Withdrawal of $${amount.toFixed(2)} requested</div>
        <div style="font-size:13px;color:#999;margin-top:4px;">Processing in 1-3 business days</div>
      `;
      document.body.appendChild(toast);
      setTimeout(() => toast.remove(), 5000);
    }
  };

  // ============================================================================
  // RESPONSIBLE GAMBLING
  // ============================================================================
  const ResponsibleGambling = {
    checkSessionDuration() {
      const duration = SessionStats.getSessionDuration();
      // Warn at 1 hour, 2 hours, 4 hours
      if (duration === 3600 || duration === 7200 || duration === 14400) {
        this.showTimeWarning(duration);
      }
    },

    showTimeWarning(seconds) {
      const hours = Math.floor(seconds / 3600);
      const toast = document.createElement('div');
      toast.style.cssText = `
        position: fixed; bottom: 20px; left: 50%; transform: translateX(-50%);
        z-index: 1000001; background: #2d1a00; border: 2px solid #FFA500;
        border-radius: 8px; padding: 16px 28px; color: #FFA500;
        font-size: 14px; box-shadow: 0 4px 16px rgba(0,0,0,0.5); max-width: 400px; text-align: center;
      `;
      toast.innerHTML = `
        <div style="font-weight:bold;margin-bottom:4px;">Session Reminder</div>
        <div>You've been playing for ${hours} hour${hours > 1 ? 's' : ''}. Consider taking a break.</div>
      `;
      document.body.appendChild(toast);
      setTimeout(() => toast.remove(), 10000);
    },

    // Check every 60 seconds
    startMonitoring() {
      setInterval(() => this.checkSessionDuration(), 60000);
    }
  };

  // ============================================================================
  // EXPORTS
  // ============================================================================
  window.CasinoDailyBonus = DailyBonus;
  window.CasinoWinStreaks = WinStreaks;
  window.CasinoLowBalance = LowBalancePrompt;
  window.CasinoSessionStats = SessionStats;
  window.CasinoLeaderboard = Leaderboard;
  window.CasinoDeposit = CasinoDeposit;
  window.CasinoWithdraw = CasinoWithdraw;
  window.CasinoResponsibleGambling = ResponsibleGambling;

  // Auto-init
  WinStreaks.init();
  ResponsibleGambling.startMonitoring();
})();
