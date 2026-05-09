/**
 * Matrix Spins Casino — Support Chat REST API
 *
 * Player-side endpoints for the live support chat widget.
 * Real-time delivery uses Socket.IO (see realtime.service.js); REST is the
 * fallback transport + history loader.
 *
 * Mounted at /api/support
 *   GET  /conversation                — get or create the user's open conversation
 *   GET  /messages                    — load message history
 *   POST /send                        — send a message
 *   POST /read                        — mark messages as read
 *   GET  /canned                      — list canned/quick replies
 *
 * Admin (requires is_admin):
 *   GET  /admin/inbox                 — list all conversations
 *   GET  /admin/conversations/:id     — full conversation detail
 *   POST /admin/conversations/:id/reply
 *   POST /admin/conversations/:id/status
 */
'use strict';

const express = require('express');
const router = express.Router();
const { authenticate, requireAdmin } = require('../middleware/auth');
const support = require('../services/support-chat.service');
const realtime = require('../services/realtime.service');

const RATE_WINDOW_MS = 2000;
const userRate = new Map();
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of userRate.entries()) {
    if (now - v > 30000) userRate.delete(k);
  }
}, 60000);

function rateOk(userId) {
  const now = Date.now();
  const last = userRate.get(userId) || 0;
  if (now - last < RATE_WINDOW_MS) return false;
  userRate.set(userId, now);
  return true;
}

function sanitize(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const CANNED_RESPONSES = [
  { id: 'deposit', label: 'How do I deposit?', body: 'To deposit, head to your Wallet and click Deposit. We accept cards via Stripe and crypto. Minimum deposit is $10.' },
  { id: 'withdraw', label: 'Withdrawal status', body: 'You can request a withdrawal from your Wallet → Withdraw. Minimum is $10. Most payouts complete within 1–5 business days.' },
  { id: 'bonus', label: 'Bonus / wagering', body: 'Bonus credits carry a wagering requirement (typically 15x–45x). Check your Wallet for current wagering progress.' },
  { id: 'kyc', label: 'Account verification', body: 'Upload a photo ID and proof of address from Account → Verification. Reviews take 1–2 hours during business hours.' },
  { id: 'rg', label: 'Responsible gambling', body: 'You can set deposit limits, loss limits, and self-exclude from Account → Responsible Play. We support 1 day to 5 year exclusions.' },
  { id: 'fair', label: 'Fairness / RNG', body: 'All games use cryptographically secure RNG and provably fair seeds. Verify any spin under Account → Provably Fair.' },
  { id: 'human', label: 'Talk to a human', body: 'A live agent will join the chat shortly. Average response time is 5–10 minutes during business hours.' },
];

const AGENT_CANNED = [
  { id: 'greet', label: 'Greeting', body: 'Hi! Thanks for reaching out — I can help with that. Could you share a bit more about the issue?' },
  { id: 'verify', label: 'Verify account', body: 'For security, can you confirm the email address on your account so I can pull up your details?' },
  { id: 'investigating', label: 'Investigating', body: 'Looking into this now — give me one minute and I\'ll have an answer for you.' },
  { id: 'resolved', label: 'Resolved', body: 'Glad I could help! I\'m marking this as resolved. Reach out anytime if you need anything else.' },
  { id: 'kyc_pending', label: 'KYC pending', body: 'Your verification documents are being reviewed by our compliance team and should clear within 24 hours.' },
  { id: 'withdraw_processing', label: 'Withdrawal processing', body: 'I see your withdrawal in our queue and it\'s being processed normally. You\'ll see it within 1–5 business days.' },
];

// ── Player endpoints ─────────────────────────────────────────

router.get('/canned', (req, res) => {
  res.json({ responses: CANNED_RESPONSES });
});

router.get('/conversation', authenticate, async (req, res) => {
  try {
    const conv = await support.getOrCreateConversation(req.user.id);
    res.json({ conversation: conv });
  } catch (err) {
    console.warn('[Support] conversation failed:', err.message);
    res.status(500).json({ error: 'Failed to load conversation' });
  }
});

router.get('/messages', authenticate, async (req, res) => {
  try {
    const conv = await support.getOrCreateConversation(req.user.id);
    const messages = await support.getMessages(conv.id);
    const unread = await support.unreadCountForUser(req.user.id);
    res.json({ conversation: conv, messages, unread });
  } catch (err) {
    console.warn('[Support] messages failed:', err.message);
    res.status(500).json({ error: 'Failed to load messages' });
  }
});

router.post('/send', authenticate, async (req, res) => {
  try {
    const userId = req.user.id;

    // Self-exclusion check (regulatory)
    try {
      const exclusion = await require('../database').get(
        "SELECT id FROM self_exclusions WHERE user_id = ? AND is_active = 1 AND (ends_at IS NULL OR ends_at > datetime('now'))",
        [userId]
      );
      if (exclusion) {
        return res.status(403).json({ error: 'Your account is self-excluded from all platform activities' });
      }
    } catch (_) {/* table may not exist yet */}

    if (!rateOk(userId)) {
      return res.status(429).json({ error: 'Slow down — please wait a moment between messages.' });
    }

    const body = sanitize(req.body && req.body.body);
    if (!body || body.length < 1) return res.status(400).json({ error: 'Message body required' });
    if (body.length > 2000) return res.status(400).json({ error: 'Message too long (max 2000 chars)' });

    const conv = await support.getOrCreateConversation(userId);
    const username = req.user.username || ('Player' + userId);
    const message = await support.postMessage({
      conversationId: conv.id,
      senderType: 'user',
      senderId: userId,
      senderName: username,
      body,
    });

    // Realtime push to agents
    realtime.broadcastToAgents('support:user_message', { conversationId: conv.id, userId, username, message });

    res.status(201).json({ message });
  } catch (err) {
    console.warn('[Support] send failed:', err.message);
    res.status(500).json({ error: 'Failed to send message' });
  }
});

router.post('/read', authenticate, async (req, res) => {
  try {
    const conv = await support.getOrCreateConversation(req.user.id);
    await support.markReadByUser(conv.id, req.user.id);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed' });
  }
});

router.post('/typing', authenticate, async (req, res) => {
  try {
    const conv = await support.getOrCreateConversation(req.user.id);
    realtime.broadcastToAgents('support:typing', { conversationId: conv.id, userId: req.user.id, username: req.user.username });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed' });
  }
});

// ── Admin endpoints ──────────────────────────────────────────

router.get('/admin/inbox', authenticate, requireAdmin, async (req, res) => {
  try {
    const status = req.query.status;
    const conversations = await support.listConversations({ status, limit: 100 });
    const totalUnread = await support.totalUnreadForAgents();
    res.json({ conversations, totalUnread });
  } catch (err) {
    console.warn('[Support] admin inbox failed:', err.message);
    res.status(500).json({ error: 'Failed to load inbox' });
  }
});

router.get('/admin/canned', authenticate, requireAdmin, (req, res) => {
  res.json({ responses: AGENT_CANNED });
});

router.get('/admin/conversations/:id', authenticate, requireAdmin, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) return res.status(400).json({ error: 'Bad id' });
    const conversation = await support.getConversation(id);
    if (!conversation) return res.status(404).json({ error: 'Not found' });
    const messages = await support.getMessages(id);
    res.json({ conversation, messages });
  } catch (err) {
    res.status(500).json({ error: 'Failed' });
  }
});

router.post('/admin/conversations/:id/reply', authenticate, requireAdmin, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) return res.status(400).json({ error: 'Bad id' });
    const body = sanitize(req.body && req.body.body);
    if (!body) return res.status(400).json({ error: 'Body required' });
    if (body.length > 2000) return res.status(400).json({ error: 'Message too long' });

    const conv = await support.getConversation(id);
    if (!conv) return res.status(404).json({ error: 'Conversation not found' });

    const agentName = req.user.username || 'Support';
    const message = await support.postMessage({
      conversationId: id,
      senderType: 'agent',
      senderId: req.user.id,
      senderName: agentName,
      body,
    });

    // Mark all user messages as read by agent (the agent just opened/replied)
    await support.markReadByAgent(id);

    // Realtime push to user + create a notification entry so they see it on the bell too
    realtime.sendToUser(conv.user_id, 'support:agent_message', {
      conversationId: id,
      message,
    });

    try {
      const notify = require('../services/notification.service');
      await notify.notify({
        userId: conv.user_id,
        type: 'support',
        title: 'New message from Support',
        body: body.length > 120 ? body.slice(0, 117) + '…' : body,
        linkAction: 'support',
        toast: true,
      });
    } catch (_) {/* notification service optional */}

    res.status(201).json({ message });
  } catch (err) {
    console.warn('[Support] admin reply failed:', err.message);
    res.status(500).json({ error: 'Failed to send reply' });
  }
});

router.post('/admin/conversations/:id/status', authenticate, requireAdmin, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const status = req.body && req.body.status;
    if (!support.STATUSES.includes(status)) return res.status(400).json({ error: 'Invalid status' });
    await support.setStatus(id, status);
    const conv = await support.getConversation(id);
    if (conv) {
      realtime.sendToUser(conv.user_id, 'support:status', { conversationId: id, status });
    }
    res.json({ ok: true, status });
  } catch (err) {
    res.status(500).json({ error: 'Failed' });
  }
});

router.post('/admin/conversations/:id/typing', authenticate, requireAdmin, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const conv = await support.getConversation(id);
    if (conv) {
      realtime.sendToUser(conv.user_id, 'support:agent_typing', { conversationId: id });
    }
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed' });
  }
});

router.post('/admin/conversations/:id/read', authenticate, requireAdmin, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    await support.markReadByAgent(id);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed' });
  }
});

module.exports = router;
