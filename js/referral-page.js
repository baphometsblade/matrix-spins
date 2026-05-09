/* Referral page logic — talks to /api/referral, /api/referral-commission */
(function () {
  'use strict';

  document.addEventListener('DOMContentLoaded', main);

  async function main() {
    const api = window.MatrixSpinsAPI;
    if (!api) return;
    const user = await api.loadSession();
    if (!user) { window.location.href = 'login.html?next=referral.html'; return; }

    const $ = (id) => document.getElementById(id);
    const fmtMoney = (n) => '$' + (Number(n) || 0).toFixed(2);

    // Logout + balance
    const logoutBtn = $('logout');
    if (logoutBtn) {
      logoutBtn.addEventListener('click', async () => {
        await api.logout();
        window.location.href = 'index.html';
      });
    }
    try {
      const b = await api.getBalance();
      const chip = $('balanceChip');
      if (chip) chip.textContent = api.formatCents(b.availableCents);
    } catch (_) { /* non-fatal */ }

    // Fetch referral code & build sharing URL
    let refCode = '';
    try {
      const r = await fetch('/api/referral/code', { credentials: 'include' });
      if (r.ok) {
        const data = await r.json();
        refCode = data.code || '';
        $('refCode').textContent = refCode || '—';
        const refURL = window.location.origin + '/?ref=' + encodeURIComponent(refCode);
        $('refLinkInput').value = refURL;

        const enc = encodeURIComponent(refURL);
        const shareText = encodeURIComponent('Join me on Matrix Spins Casino! Sign up with my link and we both get a $5 bonus, plus I earn revenue share on your play. ');
        $('shareTwitter').href = 'https://twitter.com/intent/tweet?text=' + shareText + '&url=' + enc;
        $('shareFacebook').href = 'https://www.facebook.com/sharer/sharer.php?u=' + enc + '&quote=' + shareText;
        $('shareWhatsApp').href = 'https://wa.me/?text=' + shareText + '%20' + enc;
        $('shareEmail').href = 'mailto:?subject=' + encodeURIComponent('Join Matrix Spins Casino') +
                               '&body=' + shareText + '%0A%0A' + enc;
      }
    } catch (e) { console.warn('Failed to load referral code', e); }

    // Copy link
    const copyBtn = $('copyBtn');
    if (copyBtn) {
      copyBtn.addEventListener('click', async () => {
        const input = $('refLinkInput');
        try { await navigator.clipboard.writeText(input.value); }
        catch (_) { input.select(); document.execCommand('copy'); }
        copyBtn.textContent = 'Copied!';
        copyBtn.classList.add('copied');
        setTimeout(() => {
          copyBtn.textContent = 'Copy Link';
          copyBtn.classList.remove('copied');
        }, 2000);
      });
    }

    // Stats
    async function loadStats() {
      try {
        const [refInfoRes, commRes] = await Promise.all([
          fetch('/api/referral/info', { credentials: 'include' }),
          fetch('/api/referral-commission/stats', { credentials: 'include' })
        ]);
        const refInfo = refInfoRes.ok ? await refInfoRes.json() : null;
        const commission = commRes.ok ? await commRes.json() : null;

        if (refInfo && refInfo.stats) {
          $('statTotal').textContent = String(refInfo.stats.totalReferrals || 0);
        }
        if (commission) {
          $('statActive').textContent = String(commission.activeReferees || 0);
          $('statPending').textContent = fmtMoney(commission.pending);
          $('statPaid').textContent = fmtMoney(commission.paid);
          $('tier1Total').textContent = fmtMoney(commission.tier1Total);
          $('tier2Total').textContent = fmtMoney(commission.tier2Total);
          $('claimableTotal').textContent = fmtMoney(commission.pending);

          const claimBtn = $('claimBtn');
          const minPayout = commission.minPayout || 1;
          if (commission.pending >= minPayout) {
            claimBtn.disabled = false;
            $('claimMinNote').textContent = 'Minimum $' + minPayout.toFixed(2) + ' to claim';
          } else {
            claimBtn.disabled = true;
            $('claimMinNote').textContent = '$' + minPayout.toFixed(2) + ' minimum — keep referring to unlock';
          }
        }
      } catch (e) { console.warn('Stats load error', e); }
    }

    // Per-referee breakdown — built with DOM API (no innerHTML on user data)
    async function loadBreakdown() {
      try {
        const r = await fetch('/api/referral-commission/breakdown', { credentials: 'include' });
        if (!r.ok) return;
        const { referees } = await r.json();
        const tbody = $('breakdownBody');
        if (!tbody) return;

        // Clear children
        while (tbody.firstChild) tbody.removeChild(tbody.firstChild);

        if (!referees || referees.length === 0) {
          const tr = document.createElement('tr');
          const td = document.createElement('td');
          td.colSpan = 6;
          td.style.opacity = '.6';
          td.style.textAlign = 'center';
          td.style.padding = '1.5rem';
          td.textContent = 'No commissions yet — share your link to start earning.';
          tr.appendChild(td);
          tbody.appendChild(tr);
          return;
        }

        referees.forEach((row) => {
          const tr = document.createElement('tr');
          const masked = (row.username && row.username.length > 1)
            ? row.username[0] + '***' + row.username.slice(-1)
            : 'Unknown';
          appendCell(tr, masked);
          appendCell(tr, fmtMoney(row.refereeTotalLoss));
          appendCell(tr, fmtMoney(row.tier1Earned));
          appendCell(tr, fmtMoney(row.tier2Earned));
          appendPillCell(tr, fmtMoney(row.pending), 'pending');
          appendPillCell(tr, fmtMoney(row.paid), 'paid');
          tbody.appendChild(tr);
        });
      } catch (e) { console.warn('Breakdown load error', e); }
    }

    function appendCell(tr, text) {
      const td = document.createElement('td');
      td.textContent = text;
      tr.appendChild(td);
    }
    function appendPillCell(tr, text, cls) {
      const td = document.createElement('td');
      const span = document.createElement('span');
      span.className = 'pill ' + cls;
      span.textContent = text;
      td.appendChild(span);
      tr.appendChild(td);
    }

    // Leaderboard
    async function loadLeaderboard() {
      try {
        const r = await fetch('/api/referral-commission/leaderboard');
        if (!r.ok) return;
        const { leaderboard } = await r.json();
        const body = $('leaderboardBody');
        if (!body) return;
        while (body.firstChild) body.removeChild(body.firstChild);

        if (!leaderboard || leaderboard.length === 0) {
          const empty = document.createElement('div');
          empty.style.opacity = '.6';
          empty.style.textAlign = 'center';
          empty.style.padding = '1rem';
          empty.textContent = 'Be the first on the leaderboard!';
          body.appendChild(empty);
          return;
        }

        leaderboard.forEach((row) => {
          const wrap = document.createElement('div');
          wrap.className = 'leaderboard-row';

          const rank = document.createElement('div');
          rank.className = 'leaderboard-rank';
          rank.textContent = '#' + row.rank;
          wrap.appendChild(rank);

          const name = document.createElement('div');
          name.style.flex = '1';
          name.textContent = row.username;
          wrap.appendChild(name);

          const friends = document.createElement('div');
          friends.style.opacity = '.7';
          friends.textContent = row.activeReferees + ' friends';
          wrap.appendChild(friends);

          const earned = document.createElement('div');
          earned.style.fontWeight = '700';
          earned.style.color = '#FFD700';
          earned.textContent = fmtMoney(row.totalEarned);
          wrap.appendChild(earned);

          body.appendChild(wrap);
        });
      } catch (e) { console.warn('Leaderboard load error', e); }
    }

    // Claim
    const claimBtn = $('claimBtn');
    if (claimBtn) {
      claimBtn.addEventListener('click', async () => {
        const msg = $('claimMsg');
        claimBtn.disabled = true;
        msg.textContent = 'Processing…';
        msg.style.color = '';
        try {
          const r = await fetch('/api/referral-commission/claim', {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' }
          });
          const data = await r.json();
          if (r.ok) {
            msg.textContent = data.message || 'Claimed!';
            msg.style.color = '#4CAF50';
            await loadStats();
            await loadBreakdown();
          } else {
            msg.textContent = data.error || 'Failed to claim';
            msg.style.color = '#F44336';
            claimBtn.disabled = false;
          }
        } catch (_) {
          msg.textContent = 'Network error';
          msg.style.color = '#F44336';
          claimBtn.disabled = false;
        }
      });
    }

    // Terms toggle
    const termsToggle = $('termsToggle');
    if (termsToggle) {
      termsToggle.addEventListener('click', () => {
        const expanded = termsToggle.getAttribute('aria-expanded') === 'true';
        termsToggle.setAttribute('aria-expanded', String(!expanded));
        $('termsBody').classList.toggle('open');
      });
    }

    // Initial load
    loadStats();
    loadBreakdown();
    loadLeaderboard();
  }
})();
