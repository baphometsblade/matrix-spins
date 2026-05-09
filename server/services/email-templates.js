'use strict';

/**
 * Matrix-themed HTML email templates.
 *
 * Each template is a pure function: (data) => { subject, text, html }.
 * Layout is consistent across templates for brand recognition.
 *
 * Design tokens:
 *   bg-base:    #0a0e0a (deep matrix black)
 *   bg-card:    linear-gradient(135deg, #0d1f0d, #051005)
 *   border:     rgba(0, 255, 65, 0.3) (matrix green at 30%)
 *   accent:     #00ff41 (matrix green)
 *   accent-dim: #008f23
 *   text:       #d6f5d6
 *   muted:      #6a8a6a
 *   danger:     #ff3860
 */

const COLORS = {
    bgBase:   '#0a0e0a',
    bgCard:   '#0d1f0d',
    bgCard2:  '#051005',
    border:   'rgba(0, 255, 65, 0.3)',
    accent:   '#00ff41',
    accentDim:'#008f23',
    text:     '#d6f5d6',
    muted:    '#6a8a6a',
    danger:   '#ff3860',
    gold:     '#ffd700',
};

function escapeHtml(s) {
    if (s == null) return '';
    return String(s)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function formatAud(n) {
    const num = Number(n) || 0;
    return 'AUD ' + num.toLocaleString('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatDate(d) {
    const date = d instanceof Date ? d : new Date(d || Date.now());
    return date.toLocaleString('en-AU', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Australia/Sydney' });
}

/**
 * Wrap content in the standard Matrix-themed shell.
 * @param {object} opts
 * @param {string} opts.title - email title (top of card)
 * @param {string} opts.preheader - hidden preview text
 * @param {string} opts.body - inner HTML body content
 * @param {string} [opts.unsubscribeUrl] - if present, renders an unsubscribe link in the footer
 */
function shell(opts) {
    const { title, preheader, body, unsubscribeUrl } = opts;
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${escapeHtml(title)}</title>
</head>
<body style="margin:0;padding:0;background:${COLORS.bgBase};font-family:'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:${COLORS.text};">
  <span style="display:none;font-size:1px;color:${COLORS.bgBase};line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;">${escapeHtml(preheader || '')}</span>
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:${COLORS.bgBase};padding:32px 12px;">
    <tr><td align="center">
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="600" style="max-width:600px;width:100%;">
        <tr><td style="padding:0 0 18px;text-align:center;">
          <div style="font-family:'Courier New',monospace;font-size:12px;color:${COLORS.accentDim};letter-spacing:3px;">[ MATRIX_SPINS // CASINO ]</div>
        </td></tr>
        <tr><td style="background:linear-gradient(135deg,${COLORS.bgCard},${COLORS.bgCard2});border:1px solid ${COLORS.border};border-radius:14px;overflow:hidden;box-shadow:0 0 40px rgba(0,255,65,0.08);">
          <div style="height:3px;background:linear-gradient(90deg,${COLORS.accent},transparent);"></div>
          <div style="padding:32px 28px 8px;">
            <h1 style="margin:0 0 18px;font-family:'Courier New',monospace;color:${COLORS.accent};font-size:22px;font-weight:700;letter-spacing:1px;text-shadow:0 0 12px rgba(0,255,65,0.4);">${escapeHtml(title)}</h1>
          </div>
          <div style="padding:0 28px 28px;color:${COLORS.text};line-height:1.65;font-size:15px;">
            ${body}
          </div>
          <div style="padding:18px 28px;background:rgba(0,255,65,0.04);border-top:1px solid ${COLORS.border};color:${COLORS.muted};font-size:12px;text-align:center;">
            Matrix Spins Casino &middot; <a href="https://msaart.online" style="color:${COLORS.accentDim};text-decoration:none;">msaart.online</a><br>
            Play responsibly &middot; 18+ only &middot; Gambler's Help 1800 858 858
            ${unsubscribeUrl ? `<br><br><a href="${escapeHtml(unsubscribeUrl)}" style="color:${COLORS.muted};text-decoration:underline;">Unsubscribe</a> &middot; <a href="https://msaart.online/email-preferences.html" style="color:${COLORS.muted};text-decoration:underline;">Email preferences</a>` : ''}
          </div>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

function button(label, url) {
    return `<div style="text-align:center;margin:28px 0;">
        <a href="${escapeHtml(url)}" style="display:inline-block;background:linear-gradient(135deg,${COLORS.accent},${COLORS.accentDim});color:${COLORS.bgBase};text-decoration:none;padding:14px 38px;border-radius:8px;font-weight:700;font-size:15px;letter-spacing:1px;text-transform:uppercase;box-shadow:0 0 20px rgba(0,255,65,0.3);">${escapeHtml(label)}</a>
    </div>`;
}

function panel(content, opts) {
    opts = opts || {};
    const accent = opts.accent || COLORS.accent;
    return `<div style="background:rgba(0,0,0,0.35);border:1px solid ${accent}55;border-left:3px solid ${accent};border-radius:8px;padding:18px 20px;margin:18px 0;">${content}</div>`;
}

function kv(label, value) {
    return `<tr>
        <td style="padding:8px 0;color:${COLORS.muted};font-size:13px;">${escapeHtml(label)}</td>
        <td style="padding:8px 0;color:${COLORS.text};font-size:14px;text-align:right;font-family:'Courier New',monospace;">${value}</td>
    </tr>`;
}

// ─────────────────────────────────────────────────────────────
// TEMPLATES
// ─────────────────────────────────────────────────────────────

function welcome(data) {
    const { username, verifyUrl } = data;
    const u = escapeHtml(username || 'player');
    const subject = `Welcome to Matrix Spins, ${u}`;
    const body = `
        <p>Welcome to the grid, <strong style="color:${COLORS.accent};">${u}</strong>.</p>
        <p>Your account is live. ${verifyUrl ? 'To unlock deposits, withdrawals, and your welcome bonus, verify your email below:' : 'You are ready to play.'}</p>
        ${verifyUrl ? button('Verify my email', verifyUrl) : ''}
        ${panel(`
            <div style="font-family:'Courier New',monospace;color:${COLORS.accent};font-size:13px;letter-spacing:2px;margin-bottom:6px;">[ FIRST DEPOSIT BONUS ]</div>
            <div style="color:${COLORS.text};font-size:24px;font-weight:700;">100% match up to ${formatAud(500)}</div>
            <div style="color:${COLORS.muted};font-size:12px;margin-top:6px;">45x wagering applies. Bonus credited on first deposit.</div>
        `)}
        <p style="color:${COLORS.muted};font-size:13px;">100+ slots. Real cash withdrawals. Provably-fair RNG.</p>`;
    return {
        subject,
        text: `Welcome to Matrix Spins, ${u}.\n\nYour account is live.${verifyUrl ? '\n\nVerify your email to unlock deposits and your 100% welcome bonus:\n' + verifyUrl : ''}\n\nMatrix Spins`,
        html: shell({ title: 'Welcome to the grid', preheader: 'Your Matrix Spins account is live.', body, unsubscribeUrl: data.unsubscribeUrl }),
    };
}

function depositConfirmation(data) {
    const { username, amount, currency, reference, paymentType, balance, bonusAwarded } = data;
    const u = escapeHtml(username || 'player');
    const cur = currency || 'AUD';
    const subject = `Deposit confirmed — ${cur} ${Number(amount).toFixed(2)}`;
    const body = `
        <p>Hi ${u}, your deposit has cleared and is ready to play.</p>
        ${panel(`
            <table cellpadding="0" cellspacing="0" border="0" width="100%">
                ${kv('Amount', `<strong style="color:${COLORS.accent};">${escapeHtml(formatAud(amount))}</strong>`)}
                ${kv('Method', escapeHtml(paymentType || 'card'))}
                ${kv('Reference', `<span style="font-size:11px;">${escapeHtml(reference || '—')}</span>`)}
                ${kv('Time', escapeHtml(formatDate(Date.now())))}
                ${balance != null ? kv('New balance', `<strong>${escapeHtml(formatAud(balance))}</strong>`) : ''}
                ${bonusAwarded ? kv('Bonus credited', `<strong style="color:${COLORS.gold};">${escapeHtml(formatAud(bonusAwarded))}</strong>`) : ''}
            </table>
        `)}
        ${button('Play now', 'https://msaart.online')}
        <p style="color:${COLORS.muted};font-size:12px;">Need a receipt? <a href="https://msaart.online/receipt.html?ref=${encodeURIComponent(reference || '')}" style="color:${COLORS.accentDim};">Download from your account.</a></p>`;
    return {
        subject,
        text: `Deposit confirmed.\n\nAmount: ${formatAud(amount)}\nMethod: ${paymentType || 'card'}\nReference: ${reference || '-'}\nTime: ${formatDate(Date.now())}${balance != null ? `\nNew balance: ${formatAud(balance)}` : ''}\n\nMatrix Spins`,
        html: shell({ title: 'Deposit confirmed', preheader: `${cur} ${Number(amount).toFixed(2)} credited.`, body, unsubscribeUrl: data.unsubscribeUrl }),
    };
}

function withdrawalRequested(data) {
    const { username, amount, currency, reference, paymentType, etaDays } = data;
    const u = escapeHtml(username || 'player');
    const subject = `Withdrawal request received — ${formatAud(amount)}`;
    const body = `
        <p>Hi ${u}, we have received your withdrawal request and it's now in the queue for review.</p>
        ${panel(`
            <table cellpadding="0" cellspacing="0" border="0" width="100%">
                ${kv('Amount', `<strong style="color:${COLORS.accent};">${escapeHtml(formatAud(amount))}</strong>`)}
                ${kv('Method', escapeHtml(paymentType || 'bank_transfer'))}
                ${kv('Reference', `<span style="font-size:11px;">${escapeHtml(reference || '—')}</span>`)}
                ${kv('Status', '<span style="color:#fa0;">Pending review</span>')}
                ${kv('Estimated', `${etaDays || 3} business day${etaDays === 1 ? '' : 's'}`)}
            </table>
        `)}
        <p style="color:${COLORS.muted};font-size:13px;">You'll receive another email when the withdrawal is approved or if we need more information. If you didn't request this, contact <a href="mailto:support@msaart.online" style="color:${COLORS.accent};">support@msaart.online</a> immediately.</p>`;
    return {
        subject,
        text: `Withdrawal request received.\n\nAmount: ${formatAud(amount)}\nMethod: ${paymentType}\nReference: ${reference}\nStatus: Pending review\nEstimated: ${etaDays || 3} business days\n\nMatrix Spins`,
        html: shell({ title: 'Withdrawal request received', preheader: `${formatAud(amount)} pending review.`, body, unsubscribeUrl: data.unsubscribeUrl }),
    };
}

function withdrawalApproved(data) {
    const { username, amount, currency, reference, paymentType } = data;
    const u = escapeHtml(username || 'player');
    const subject = `Withdrawal approved — ${formatAud(amount)}`;
    const body = `
        <p>Hi ${u}, your withdrawal has been approved and the funds are on their way.</p>
        ${panel(`
            <table cellpadding="0" cellspacing="0" border="0" width="100%">
                ${kv('Amount', `<strong style="color:${COLORS.accent};">${escapeHtml(formatAud(amount))}</strong>`)}
                ${kv('Method', escapeHtml(paymentType || 'bank_transfer'))}
                ${kv('Reference', `<span style="font-size:11px;">${escapeHtml(reference || '—')}</span>`)}
                ${kv('Status', `<span style="color:${COLORS.accent};">Approved</span>`)}
                ${kv('Approved at', escapeHtml(formatDate(Date.now())))}
            </table>
        `, { accent: COLORS.accent })}
        <p style="color:${COLORS.muted};font-size:13px;">Bank transfers typically arrive within 1–3 business days. Crypto withdrawals settle on-chain in minutes.</p>`;
    return {
        subject,
        text: `Withdrawal approved.\n\nAmount: ${formatAud(amount)}\nMethod: ${paymentType}\nReference: ${reference}\nStatus: Approved\n\nMatrix Spins`,
        html: shell({ title: 'Withdrawal approved', preheader: `${formatAud(amount)} on its way.`, body, unsubscribeUrl: data.unsubscribeUrl }),
    };
}

function withdrawalRejected(data) {
    const { username, amount, reference, reason } = data;
    const u = escapeHtml(username || 'player');
    const subject = `Withdrawal request — action required`;
    const body = `
        <p>Hi ${u}, we were unable to process your withdrawal request.</p>
        ${panel(`
            <table cellpadding="0" cellspacing="0" border="0" width="100%">
                ${kv('Amount', escapeHtml(formatAud(amount)))}
                ${kv('Reference', `<span style="font-size:11px;">${escapeHtml(reference || '—')}</span>`)}
                ${kv('Status', `<span style="color:${COLORS.danger};">Declined</span>`)}
            </table>
            <div style="margin-top:14px;padding-top:14px;border-top:1px solid ${COLORS.border};">
                <div style="color:${COLORS.muted};font-size:12px;margin-bottom:4px;">Reason</div>
                <div style="color:${COLORS.text};font-size:14px;">${escapeHtml(reason || 'See your account history for details.')}</div>
            </div>
        `, { accent: COLORS.danger })}
        <p>Your funds have been returned to your account balance and remain available to play or to withdraw via another method.</p>
        ${button('Open my account', 'https://msaart.online/account.html')}
        <p style="color:${COLORS.muted};font-size:13px;">Questions? Reply to this email or contact <a href="mailto:support@msaart.online" style="color:${COLORS.accent};">support@msaart.online</a>.</p>`;
    return {
        subject,
        text: `Withdrawal declined.\n\nAmount: ${formatAud(amount)}\nReference: ${reference}\nReason: ${reason || 'See account history.'}\n\nFunds returned to balance.\n\nMatrix Spins`,
        html: shell({ title: 'Withdrawal declined', preheader: 'Funds returned to your balance.', body, unsubscribeUrl: data.unsubscribeUrl }),
    };
}

function passwordReset(data) {
    const { username, resetUrl, expiryHours } = data;
    const u = escapeHtml(username || 'player');
    const exp = expiryHours || 1;
    const subject = `Reset your Matrix Spins password`;
    const body = `
        <p>Hi ${u}, we received a request to reset your password.</p>
        <p>Click below to set a new password. This link expires in <strong style="color:${COLORS.accent};">${exp} hour${exp !== 1 ? 's' : ''}</strong>.</p>
        ${button('Reset my password', resetUrl)}
        <p style="color:${COLORS.muted};font-size:12px;">If the button doesn't work, copy this link:</p>
        <p style="color:${COLORS.accentDim};font-size:11px;word-break:break-all;font-family:'Courier New',monospace;">${escapeHtml(resetUrl)}</p>
        <p style="color:${COLORS.muted};font-size:13px;margin-top:24px;">If you did not request this, you can ignore this email — your password remains unchanged.</p>`;
    return {
        subject,
        text: `Password reset requested.\n\n${resetUrl}\n\nExpires in ${exp} hour${exp !== 1 ? 's' : ''}.\n\nIf you didn't request this, ignore this email.\n\nMatrix Spins`,
        html: shell({ title: 'Reset your password', preheader: `Link expires in ${exp} hour${exp !== 1 ? 's' : ''}.`, body }),
    };
}

function selfExclusionConfirmation(data) {
    const { username, durationLabel, expiresAt } = data;
    const u = escapeHtml(username || 'player');
    const subject = `Self-exclusion activated`;
    const body = `
        <p>Hi ${u}, your self-exclusion has been activated.</p>
        ${panel(`
            <table cellpadding="0" cellspacing="0" border="0" width="100%">
                ${kv('Duration', escapeHtml(durationLabel || 'Indefinite'))}
                ${kv('Activated', escapeHtml(formatDate(Date.now())))}
                ${expiresAt ? kv('Ends', escapeHtml(formatDate(expiresAt))) : ''}
            </table>
        `, { accent: COLORS.danger })}
        <p>During your exclusion period:</p>
        <ul style="color:${COLORS.text};line-height:1.7;">
            <li>You cannot deposit, place bets, or open new accounts</li>
            <li>Promotional emails are paused</li>
            <li>Existing balance can be withdrawn at any time</li>
        </ul>
        <p style="color:${COLORS.muted};font-size:13px;">If you need support, please reach out to <a href="https://gamblershelp.com.au" style="color:${COLORS.accent};">Gambler's Help (1800 858 858)</a> — confidential, 24/7.</p>`;
    return {
        subject,
        text: `Self-exclusion activated.\n\nDuration: ${durationLabel || 'Indefinite'}\nActivated: ${formatDate(Date.now())}\n\nDuring exclusion, deposits and bets are blocked. Existing balance is withdrawable.\n\nGambler's Help: 1800 858 858`,
        html: shell({ title: 'Self-exclusion activated', preheader: 'Your exclusion is now in effect.', body }),
    };
}

function vipTierUpgrade(data) {
    const { username, tierName, emoji, benefits } = data;
    const u = escapeHtml(username || 'player');
    const tier = escapeHtml(tierName || 'VIP');
    const subject = `${emoji || '★'} You've unlocked ${tier} VIP`;
    const benefitsHtml = (benefits && benefits.length)
        ? '<ul style="color:' + COLORS.text + ';line-height:1.8;">' + benefits.map(b => '<li>' + escapeHtml(b) + '</li>').join('') + '</ul>'
        : '';
    const body = `
        <p>Congratulations ${u} — your play has earned you ${tier} VIP status.</p>
        ${panel(`
            <div style="text-align:center;">
                <div style="font-size:42px;margin-bottom:8px;">${escapeHtml(emoji || '★')}</div>
                <div style="font-family:'Courier New',monospace;color:${COLORS.accent};font-size:20px;letter-spacing:3px;text-transform:uppercase;font-weight:700;">${tier} VIP</div>
            </div>
        `, { accent: COLORS.gold })}
        ${benefitsHtml ? '<p>Your new benefits:</p>' + benefitsHtml : ''}
        ${button('See VIP perks', 'https://msaart.online/vip.html')}`;
    return {
        subject,
        text: `Congratulations ${u}, you've unlocked ${tier} VIP.\n\n${(benefits || []).map(b => '- ' + b).join('\n')}\n\nMatrix Spins`,
        html: shell({ title: `Welcome to ${tier} VIP`, preheader: `New tier unlocked: ${tier}`, body, unsubscribeUrl: data.unsubscribeUrl }),
    };
}

function jackpotWin(data) {
    const { username, amount, jackpotTier, gameName } = data;
    const u = escapeHtml(username || 'player');
    const tier = escapeHtml(jackpotTier || 'Jackpot');
    const subject = `🎉 JACKPOT! You won ${formatAud(amount)}`;
    const body = `
        <p style="font-size:18px;">Congratulations ${u} — you hit the <strong style="color:${COLORS.gold};">${tier}</strong> jackpot.</p>
        ${panel(`
            <div style="text-align:center;">
                <div style="font-family:'Courier New',monospace;color:${COLORS.muted};font-size:13px;letter-spacing:3px;">[ JACKPOT_HIT ]</div>
                <div style="color:${COLORS.gold};font-size:42px;font-weight:900;letter-spacing:-1px;margin:8px 0;text-shadow:0 0 20px rgba(255,215,0,0.4);">${escapeHtml(formatAud(amount))}</div>
                ${gameName ? `<div style="color:${COLORS.text};font-size:14px;">on <strong>${escapeHtml(gameName)}</strong></div>` : ''}
            </div>
        `, { accent: COLORS.gold })}
        <p>Your winnings have been added to your account balance and are immediately withdrawable (subject to standard verification).</p>
        ${button('View my balance', 'https://msaart.online/account.html')}`;
    return {
        subject,
        text: `JACKPOT! You won ${formatAud(amount)} on the ${tier} jackpot${gameName ? ' (' + gameName + ')' : ''}.\n\nWinnings added to your account.\n\nMatrix Spins`,
        html: shell({ title: 'You hit the jackpot', preheader: `${formatAud(amount)} added to your account.`, body, unsubscribeUrl: data.unsubscribeUrl }),
    };
}

function weeklyActivitySummary(data) {
    const { username, weekStart, weekEnd, totalSpins, totalWagered, totalWon, netResult, biggestWin, hoursPlayed } = data;
    const u = escapeHtml(username || 'player');
    const subject = `Your weekly Matrix Spins summary`;
    const net = Number(netResult || 0);
    const netLabel = net >= 0 ? `<span style="color:${COLORS.accent};">+${escapeHtml(formatAud(net))}</span>` : `<span style="color:${COLORS.danger};">${escapeHtml(formatAud(net))}</span>`;
    const body = `
        <p>Hi ${u}, here's your activity for ${escapeHtml(formatDate(weekStart))} – ${escapeHtml(formatDate(weekEnd))}.</p>
        ${panel(`
            <table cellpadding="0" cellspacing="0" border="0" width="100%">
                ${kv('Spins', String(totalSpins || 0))}
                ${kv('Total wagered', escapeHtml(formatAud(totalWagered || 0)))}
                ${kv('Total won', escapeHtml(formatAud(totalWon || 0)))}
                ${kv('Net result', netLabel)}
                ${biggestWin ? kv('Biggest win', `<strong style="color:${COLORS.gold};">${escapeHtml(formatAud(biggestWin))}</strong>`) : ''}
                ${hoursPlayed ? kv('Time played', `${Number(hoursPlayed).toFixed(1)} hours`) : ''}
            </table>
        `)}
        <p style="color:${COLORS.muted};font-size:13px;">Manage your <a href="https://msaart.online/loss-limits.html" style="color:${COLORS.accent};">deposit/loss limits</a> or <a href="https://msaart.online/self-exclusion.html" style="color:${COLORS.accent};">take a break</a> at any time.</p>
        ${button('Open my account', 'https://msaart.online/account.html')}`;
    return {
        subject,
        text: `Weekly summary for ${u}\n\nSpins: ${totalSpins || 0}\nWagered: ${formatAud(totalWagered || 0)}\nWon: ${formatAud(totalWon || 0)}\nNet: ${formatAud(net)}\nBiggest win: ${formatAud(biggestWin || 0)}\nHours played: ${(hoursPlayed || 0).toFixed(1)}\n\nMatrix Spins`,
        html: shell({ title: 'Your weekly summary', preheader: `${totalSpins || 0} spins · net ${formatAud(net)}`, body, unsubscribeUrl: data.unsubscribeUrl }),
    };
}

function broadcast(data) {
    const { subject, headline, body: bodyText, ctaLabel, ctaUrl, unsubscribeUrl } = data;
    const headlineEsc = escapeHtml(headline || subject);
    const paragraphs = String(bodyText || '').split(/\n\n+/).map(p =>
        '<p>' + escapeHtml(p).replace(/\n/g, '<br>') + '</p>'
    ).join('');
    const body = `
        ${paragraphs}
        ${ctaUrl && ctaLabel ? button(ctaLabel, ctaUrl) : ''}`;
    return {
        subject: subject || 'Update from Matrix Spins',
        text: (headline ? headline + '\n\n' : '') + (bodyText || '') + (ctaUrl ? '\n\n' + ctaLabel + ': ' + ctaUrl : '') + '\n\nMatrix Spins',
        html: shell({ title: headlineEsc, preheader: headline || subject, body, unsubscribeUrl }),
    };
}

function emailVerification(data) {
    const { username, verificationUrl, expiryHours } = data;
    const u = escapeHtml(username || 'player');
    const exp = expiryHours || 24;
    const subject = `Verify your Matrix Spins email`;
    const body = `
        <p>Hi ${u}, please verify your email address to unlock deposits, withdrawals, and your welcome bonus.</p>
        ${button('Verify my email', verificationUrl)}
        <p style="color:${COLORS.muted};font-size:12px;">Or copy this link:</p>
        <p style="color:${COLORS.accentDim};font-size:11px;word-break:break-all;font-family:'Courier New',monospace;">${escapeHtml(verificationUrl)}</p>
        <p style="color:${COLORS.muted};font-size:13px;">Link expires in ${exp} hours.</p>`;
    return {
        subject,
        text: `Verify your Matrix Spins email.\n\n${verificationUrl}\n\nExpires in ${exp} hours.\n\nMatrix Spins`,
        html: shell({ title: 'Verify your email', preheader: 'One click and you\'re in.', body }),
    };
}

function withdrawalOtp(data) {
    const { username, otpCode, amount, expiryMinutes } = data;
    const u = escapeHtml(username || 'player');
    const exp = expiryMinutes || 15;
    const subject = `Withdrawal verification code: ${otpCode}`;
    const body = `
        <p>Hi ${u}, you requested a withdrawal of <strong>${escapeHtml(formatAud(amount))}</strong>. Enter this code in the app to confirm:</p>
        <div style="margin:32px 0;text-align:center;">
            <div style="display:inline-block;background:${COLORS.bgBase};border:2px solid ${COLORS.accent};padding:20px 36px;border-radius:10px;font-family:'Courier New',monospace;font-size:34px;letter-spacing:12px;font-weight:700;color:${COLORS.accent};text-shadow:0 0 12px rgba(0,255,65,0.4);">${escapeHtml(otpCode)}</div>
        </div>
        <p style="color:${COLORS.muted};font-size:13px;">Code expires in <strong>${exp} minutes</strong>. If you did NOT request this, do not share the code, change your password immediately, and contact support.</p>`;
    return {
        subject,
        text: `Matrix Spins withdrawal verification code: ${otpCode}\n\nAmount: ${formatAud(amount)}\nExpires in ${exp} minutes.\n\nIf you did not request this, do not share the code.`,
        html: shell({ title: 'Confirm your withdrawal', preheader: `Code: ${otpCode}`, body }),
    };
}

function transactionReceipt(data) {
    const { username, type, amount, reference, paymentType, status, occurredAt } = data;
    const u = escapeHtml(username || 'player');
    const typeLabel = (type || '').toLowerCase() === 'withdrawal' ? 'Withdrawal' : 'Deposit';
    const subject = `Receipt — ${typeLabel} ${escapeHtml(reference || '')}`;
    const body = `
        <p>Hi ${u}, this is your receipt for the transaction below.</p>
        ${panel(`
            <table cellpadding="0" cellspacing="0" border="0" width="100%">
                ${kv('Type', escapeHtml(typeLabel))}
                ${kv('Amount', `<strong style="color:${COLORS.accent};">${escapeHtml(formatAud(amount))}</strong>`)}
                ${kv('Method', escapeHtml(paymentType || '—'))}
                ${kv('Reference', `<span style="font-size:11px;">${escapeHtml(reference || '—')}</span>`)}
                ${kv('Status', escapeHtml(status || 'completed'))}
                ${kv('Date', escapeHtml(formatDate(occurredAt || Date.now())))}
            </table>
        `)}
        <p style="color:${COLORS.muted};font-size:12px;">This receipt is for your records. Keep it for tax / dispute purposes. The full transaction history is always available in your <a href="https://msaart.online/history.html" style="color:${COLORS.accent};">account dashboard</a>.</p>`;
    return {
        subject,
        text: `Receipt — ${typeLabel}\n\nAmount: ${formatAud(amount)}\nMethod: ${paymentType}\nReference: ${reference}\nStatus: ${status}\nDate: ${formatDate(occurredAt || Date.now())}\n\nMatrix Spins`,
        html: shell({ title: 'Transaction receipt', preheader: `${typeLabel} · ${formatAud(amount)}`, body, unsubscribeUrl: data.unsubscribeUrl }),
    };
}

module.exports = {
    welcome,
    depositConfirmation,
    withdrawalRequested,
    withdrawalApproved,
    withdrawalRejected,
    passwordReset,
    selfExclusionConfirmation,
    vipTierUpgrade,
    jackpotWin,
    weeklyActivitySummary,
    broadcast,
    emailVerification,
    withdrawalOtp,
    transactionReceipt,
    // helpers exposed for tests
    _shell: shell,
    _formatAud: formatAud,
    _escapeHtml: escapeHtml,
};
