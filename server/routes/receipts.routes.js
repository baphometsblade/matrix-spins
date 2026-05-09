'use strict';

/**
 * Transaction Receipts — printable, downloadable HTML receipts for deposits
 * and withdrawals. Mounted under /api/receipts.
 *
 * All endpoints require authentication and verify ownership via user_id
 * before returning a row. Receipts are rendered server-side (no JS framework
 * required) with print-ready CSS so the user can print or save as PDF.
 */

const express = require('express');
const { authenticate } = require('../middleware/auth');
const db = require('../database');

const router = express.Router();

const VALID_TYPES = ['deposit', 'withdrawal'];

// ───────────────────────── Helpers ─────────────────────────

function _escapeHtml(s) {
    if (s == null) return '';
    return String(s)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function _formatAud(n) {
    const num = Number(n);
    if (!Number.isFinite(num)) return 'AUD 0.00';
    return 'AUD ' + num.toLocaleString('en-AU', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
    });
}

function _formatDate(s) {
    if (!s) return '—';
    try {
        const d = new Date(s);
        if (isNaN(d.getTime())) return String(s);
        return d.toLocaleString('en-AU', {
            year: 'numeric', month: 'short', day: '2-digit',
            hour: '2-digit', minute: '2-digit', second: '2-digit',
        });
    } catch (_) {
        return String(s);
    }
}

function _statusColor(status) {
    const s = String(status || '').toLowerCase();
    if (s === 'completed' || s === 'approved') return '#00ff41';
    if (s === 'pending') return '#ffd166';
    if (s === 'rejected' || s === 'failed') return '#ff3860';
    return '#9ec79e';
}

function _tableForType(type) {
    return type === 'deposit' ? 'deposits' : 'withdrawals';
}

function _completedCol(type) {
    // deposits has completed_at, withdrawals has processed_at — alias both as completed_at
    return type === 'deposit' ? 'completed_at' : 'processed_at AS completed_at';
}

async function _getOwnedRow(userId, type, reference) {
    const table = _tableForType(type);
    const compCol = _completedCol(type);
    const row = await db.get(
        `SELECT id, user_id, amount, currency, payment_type, status, reference, external_ref, created_at, ${compCol} FROM ${table} WHERE reference = ? AND user_id = ?`,
        [reference, userId]
    );
    return row || null;
}

async function _getUsername(userId) {
    try {
        const u = await db.get('SELECT username, email FROM users WHERE id = ?', [userId]);
        if (!u) return { username: 'Player', email: '' };
        return { username: u.username || 'Player', email: u.email || '' };
    } catch (_) {
        return { username: 'Player', email: '' };
    }
}

function _renderReceiptHtml({ type, row, user }) {
    const title = type === 'deposit' ? 'Deposit Receipt' : 'Withdrawal Receipt';
    const accent = _statusColor(row.status);

    const ref = _escapeHtml(row.reference);
    const status = _escapeHtml(String(row.status || 'unknown').toUpperCase());
    const method = _escapeHtml(row.payment_type || '—');
    const amount = _escapeHtml(_formatAud(row.amount));
    const created = _escapeHtml(_formatDate(row.created_at));
    const completed = _escapeHtml(_formatDate(row.completed_at));
    const username = _escapeHtml(user.username);
    const email = _escapeHtml(user.email);
    const externalRef = _escapeHtml(row.external_ref || '—');

    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${_escapeHtml(title)} ${ref} — Matrix Spins</title>
<style>
  *{box-sizing:border-box;}
  body{margin:0;background:#0a0e0a;color:#d6f5d6;font-family:'Courier New','Consolas',monospace;display:flex;align-items:flex-start;justify-content:center;min-height:100vh;padding:30px 16px;}
  .receipt{max-width:680px;width:100%;background:linear-gradient(135deg,#0d1f0d,#051005);border:1px solid rgba(0,255,65,0.3);border-left:4px solid ${accent};border-radius:14px;padding:36px 32px;box-shadow:0 0 40px rgba(0,255,65,0.10);}
  .brand{display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid rgba(0,255,65,0.25);padding-bottom:16px;margin-bottom:22px;}
  .brand-name{font-size:22px;color:#00ff41;letter-spacing:3px;font-weight:700;}
  .brand-tag{font-size:11px;color:#7fbf7f;letter-spacing:2px;text-transform:uppercase;}
  h1{margin:0 0 6px;font-size:20px;color:${accent};letter-spacing:1px;text-transform:uppercase;}
  .ref{font-size:12px;color:#9ec79e;margin-bottom:24px;word-break:break-all;}
  .row{display:flex;justify-content:space-between;align-items:flex-start;gap:16px;padding:10px 0;border-bottom:1px dashed rgba(0,255,65,0.15);}
  .row:last-of-type{border-bottom:none;}
  .label{color:#7fbf7f;font-size:13px;text-transform:uppercase;letter-spacing:1px;}
  .value{color:#d6f5d6;font-size:14px;text-align:right;word-break:break-word;}
  .amount{font-size:28px;color:#00ff41;font-weight:700;letter-spacing:2px;}
  .pill{display:inline-block;padding:4px 10px;border-radius:12px;font-size:11px;font-weight:700;letter-spacing:1px;color:${accent};border:1px solid ${accent};}
  .footer{margin-top:28px;padding-top:18px;border-top:1px solid rgba(0,255,65,0.25);font-size:11px;color:#6a8a6a;text-align:center;line-height:1.7;}
  .actions{margin-top:24px;display:flex;justify-content:center;gap:12px;}
  .btn{background:#00ff41;color:#0a0e0a;border:none;padding:10px 22px;font-family:inherit;font-weight:700;letter-spacing:2px;border-radius:6px;cursor:pointer;text-transform:uppercase;font-size:12px;}
  .btn:hover{filter:brightness(1.1);}
  .btn.secondary{background:transparent;color:#00ff41;border:1px solid rgba(0,255,65,0.5);}
  @media print{
    body{background:#fff;color:#000;padding:0;}
    .receipt{box-shadow:none;border:1px solid #333;background:#fff;color:#000;border-left-color:#000;}
    .brand-name,h1,.amount,.value{color:#000 !important;}
    .label,.brand-tag,.footer,.ref{color:#444 !important;}
    .pill{color:#000 !important;border-color:#000 !important;}
    .actions{display:none !important;}
    @page{size:A4;margin:18mm;}
  }
</style>
</head>
<body>
  <div class="receipt">
    <div class="brand">
      <div>
        <div class="brand-name">MATRIX SPINS</div>
        <div class="brand-tag">Official Transaction Receipt</div>
      </div>
      <div class="pill">${status}</div>
    </div>

    <h1>${_escapeHtml(title)}</h1>
    <div class="ref">Reference: ${ref}</div>

    <div class="row">
      <div class="label">Amount</div>
      <div class="value amount">${amount}</div>
    </div>
    <div class="row">
      <div class="label">Type</div>
      <div class="value">${_escapeHtml(type === 'deposit' ? 'Deposit' : 'Withdrawal')}</div>
    </div>
    <div class="row">
      <div class="label">Payment Method</div>
      <div class="value">${method}</div>
    </div>
    <div class="row">
      <div class="label">Status</div>
      <div class="value">${status}</div>
    </div>
    <div class="row">
      <div class="label">Account</div>
      <div class="value">${username}${email ? '<br><span style="font-size:11px;color:#7fbf7f;">' + email + '</span>' : ''}</div>
    </div>
    <div class="row">
      <div class="label">Initiated</div>
      <div class="value">${created}</div>
    </div>
    <div class="row">
      <div class="label">${type === 'deposit' ? 'Completed' : 'Processed'}</div>
      <div class="value">${completed}</div>
    </div>
    <div class="row">
      <div class="label">External Ref</div>
      <div class="value" style="font-size:11px;">${externalRef}</div>
    </div>

    <div class="actions">
      <button class="btn" onclick="window.print()">Print Receipt</button>
      <a class="btn secondary" href="/account.html">Back to Account</a>
    </div>

    <div class="footer">
      Matrix Spins &middot; Australian-licensed entertainment platform.<br>
      Keep this receipt for your records. For support contact support@msaart.online.<br>
      Generated ${_escapeHtml(_formatDate(new Date().toISOString()))}.
    </div>
  </div>
</body>
</html>`;
}

// ═══════════════════════════════════════════════════
//  ENDPOINTS
// ═══════════════════════════════════════════════════

/**
 * GET /api/receipts/list?type=deposit|withdrawal&limit=50
 *
 * Returns a list of the user's transactions. If `type` omitted, returns both
 * deposits and withdrawals merged (sorted desc by created_at).
 */
router.get('/list', authenticate, async (req, res) => {
    try {
        const type = req.query.type ? String(req.query.type).toLowerCase() : null;
        let limit = parseInt(req.query.limit, 10);
        if (!Number.isFinite(limit) || limit <= 0) limit = 50;
        if (limit > 200) limit = 200;

        if (type && VALID_TYPES.indexOf(type) === -1) {
            return res.status(400).json({ error: 'Invalid type — use deposit or withdrawal.' });
        }

        const userId = req.user.id;
        const out = [];

        if (!type || type === 'deposit') {
            const dep = await db.all(
                'SELECT id, reference, amount, currency, payment_type, status, created_at, completed_at FROM deposits WHERE user_id = ? ORDER BY id DESC LIMIT ?',
                [userId, limit]
            );
            (dep || []).forEach(r => out.push(Object.assign({ type: 'deposit' }, r)));
        }
        if (!type || type === 'withdrawal') {
            const wd = await db.all(
                'SELECT id, reference, amount, currency, payment_type, status, created_at, processed_at AS completed_at FROM withdrawals WHERE user_id = ? ORDER BY id DESC LIMIT ?',
                [userId, limit]
            );
            (wd || []).forEach(r => out.push(Object.assign({ type: 'withdrawal' }, r)));
        }

        // Sort merged list newest first
        out.sort((a, b) => {
            const aT = a.created_at ? new Date(a.created_at).getTime() : 0;
            const bT = b.created_at ? new Date(b.created_at).getTime() : 0;
            return bT - aT;
        });

        res.json({ transactions: out.slice(0, limit) });
    } catch (err) {
        console.warn('[receipts/list] error:', err.message);
        res.status(500).json({ error: 'Failed to load transactions' });
    }
});

/**
 * GET /api/receipts/:type/:reference
 *
 * Returns the row + a printable HTML receipt body in `html`.
 */
router.get('/:type/:reference', authenticate, async (req, res) => {
    try {
        const type = String(req.params.type || '').toLowerCase();
        const reference = String(req.params.reference || '').trim();
        if (VALID_TYPES.indexOf(type) === -1) {
            return res.status(400).json({ error: 'Invalid type — use deposit or withdrawal.' });
        }
        if (!reference || reference.length > 200) {
            return res.status(400).json({ error: 'Invalid reference.' });
        }

        const row = await _getOwnedRow(req.user.id, type, reference);
        if (!row) return res.status(404).json({ error: 'Transaction not found.' });

        const user = await _getUsername(req.user.id);
        const html = _renderReceiptHtml({ type, row, user });
        res.json({ transaction: Object.assign({ type }, row), html });
    } catch (err) {
        console.warn('[receipts/:type/:reference] error:', err.message);
        res.status(500).json({ error: 'Failed to load receipt' });
    }
});

/**
 * GET /api/receipts/:type/:reference/download
 *
 * Streams a standalone HTML receipt with Content-Disposition: attachment.
 */
router.get('/:type/:reference/download', authenticate, async (req, res) => {
    try {
        const type = String(req.params.type || '').toLowerCase();
        const reference = String(req.params.reference || '').trim();
        if (VALID_TYPES.indexOf(type) === -1) {
            return res.status(400).send('Invalid type.');
        }
        if (!reference || reference.length > 200) {
            return res.status(400).send('Invalid reference.');
        }

        const row = await _getOwnedRow(req.user.id, type, reference);
        if (!row) return res.status(404).send('Transaction not found.');

        const user = await _getUsername(req.user.id);
        const html = _renderReceiptHtml({ type, row, user });
        // Sanitise reference for filename
        const safeRef = reference.replace(/[^A-Za-z0-9_\-\.]/g, '_');
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="receipt-${safeRef}.html"`);
        res.send(html);
    } catch (err) {
        console.warn('[receipts/:type/:reference/download] error:', err.message);
        res.status(500).send('Failed to render receipt');
    }
});

module.exports = router;
