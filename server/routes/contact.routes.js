'use strict';

/**
 * Contact Form API
 *
 * Routes:
 *   POST /api/contact — Submit a contact form message (no auth required)
 *
 * Rate-limited to 3 submissions per IP per hour.
 * Stores submissions in `contact_messages` table.
 * Optionally sends email notification to admin if SMTP is configured.
 */

const express = require('express');
const router = express.Router();
const db = require('../database');
const rateLimit = require('express-rate-limit');

// ── Rate Limiter: 3 per IP per hour ──────────────────────────
const contactLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 3,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many contact submissions. Please try again later.' },
});

// ── Allowed categories (whitelist) ───────────────────────────
const ALLOWED_CATEGORIES = [
  'general',
  'support',
  'payments',
  'account',
  'feedback',
  'bug-report',
  'responsible-gambling',
  'kyc',
  'other',
];

// ── Input sanitization: strip HTML tags ──────────────────────
function stripHtml(str) {
  if (typeof str !== 'string') return '';
  return str.replace(/<[^>]*>/g, '').trim();
}

// ── Email validation ─────────────────────────────────────────
function isValidEmail(email) {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
}

// ── Bootstrap contact_messages table ─────────────────────────
async function bootstrapTable() {
  try {
    const isPg = db.isPg();
    const idDef = isPg ? 'SERIAL PRIMARY KEY' : 'INTEGER PRIMARY KEY AUTOINCREMENT';
    const tsDef = isPg ? 'TIMESTAMPTZ DEFAULT NOW()' : "TEXT DEFAULT (datetime('now'))";
    await db.run(
      `CREATE TABLE IF NOT EXISTS contact_messages (
        id ${idDef},
        name TEXT NOT NULL,
        email TEXT NOT NULL,
        category TEXT NOT NULL,
        username TEXT,
        subject TEXT NOT NULL,
        message TEXT NOT NULL,
        ip TEXT,
        created_at ${tsDef},
        status TEXT DEFAULT 'new'
      )`
    );
    console.warn('[Contact] contact_messages table initialized');
  } catch (err) {
    console.warn('[Contact] Bootstrap error:', err.message);
  }
}

// Bootstrap table at module load (same pattern as newsletter.routes.js)
bootstrapTable().catch(function (e) {
  console.warn('[Contact] Bootstrap failed:', e.message);
});

// ── Optional SMTP notification ───────────────────────────────
async function sendAdminNotification(submission) {
  if (!process.env.SMTP_HOST) return; // SMTP not configured — skip silently

  try {
    const nodemailer = require('nodemailer');
    const transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: parseInt(process.env.SMTP_PORT, 10) || 587,
      secure: (process.env.SMTP_SECURE === 'true'),
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      },
    });

    const adminEmail = process.env.ADMIN_EMAIL || process.env.SMTP_USER;
    if (!adminEmail) return;

    await transporter.sendMail({
      from: process.env.SMTP_FROM || process.env.SMTP_USER,
      to: adminEmail,
      subject: `[Matrix Spins] Contact: ${submission.subject}`,
      text: [
        `New contact form submission (#${submission.id})`,
        '',
        `Name:     ${submission.name}`,
        `Email:    ${submission.email}`,
        `Category: ${submission.category}`,
        `Username: ${submission.username || '(not provided)'}`,
        `Subject:  ${submission.subject}`,
        '',
        'Message:',
        submission.message,
        '',
        `IP:       ${submission.ip}`,
        `Time:     ${new Date().toISOString()}`,
      ].join('\n'),
    });
  } catch (err) {
    // Email failure must not block the response
    console.warn('[Contact] Admin notification failed:', err.message);
  }
}

/**
 * POST /api/contact
 * Submit a contact form message (no authentication required).
 *
 * Body: { name, email, category, username?, subject, message }
 *
 * Returns: { success: true, ticketId: number }
 */
router.post('/', contactLimiter, async (req, res) => {
  try {
    let { name, email, category, username, subject, message } = req.body;

    // ── Sanitize all string inputs ─────────────────────────
    name = stripHtml(name);
    email = typeof email === 'string' ? email.trim().toLowerCase() : '';
    category = stripHtml(category);
    username = username ? stripHtml(username) : null;
    subject = stripHtml(subject);
    message = stripHtml(message);

    // ── Validate required fields ───────────────────────────
    if (!name || name.length < 2 || name.length > 100) {
      return res.status(400).json({ error: 'Name must be between 2 and 100 characters' });
    }

    if (!email || !isValidEmail(email)) {
      return res.status(400).json({ error: 'A valid email address is required' });
    }

    if (!category || !ALLOWED_CATEGORIES.includes(category)) {
      return res.status(400).json({
        error: 'Invalid category. Allowed: ' + ALLOWED_CATEGORIES.join(', '),
      });
    }

    if (!subject || subject.length < 5 || subject.length > 200) {
      return res.status(400).json({ error: 'Subject must be between 5 and 200 characters' });
    }

    if (!message || message.length < 10 || message.length > 5000) {
      return res.status(400).json({ error: 'Message must be between 10 and 5000 characters' });
    }

    // ── Determine client IP ────────────────────────────────
    const ip = req.ip || req.headers['x-forwarded-for'] || req.connection.remoteAddress || 'unknown';

    // ── Insert into database ───────────────────────────────
    const result = await db.run(
      `INSERT INTO contact_messages (name, email, category, username, subject, message, ip)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [name, email, category, username, subject, message, ip]
    );

    const ticketId = result.lastInsertRowid || result.lastID || result.id;

    // ── Send admin notification (fire-and-forget) ──────────
    sendAdminNotification({
      id: ticketId,
      name,
      email,
      category,
      username,
      subject,
      message,
      ip,
    });

    res.json({ success: true, ticketId });
  } catch (err) {
    console.warn('[Contact] POST / error:', err.message);
    res.status(500).json({ error: 'Failed to submit contact message. Please try again.' });
  }
});

module.exports = router;
