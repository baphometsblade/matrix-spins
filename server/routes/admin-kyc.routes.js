'use strict';

/**
 * Admin KYC Review Panel
 *   GET    /api/admin/kyc/queue              — pending submissions
 *   GET    /api/admin/kyc/user/:id           — full review packet
 *   GET    /api/admin/kyc/document/:id/file  — stream the actual file (admin-only)
 *   POST   /api/admin/kyc/document/:id/approve
 *   POST   /api/admin/kyc/document/:id/reject
 *   POST   /api/admin/kyc/user/:id/approve   — approve all pending docs + mark user 'approved'
 *   POST   /api/admin/kyc/user/:id/reject
 */

const express = require('express');
const path = require('path');
const fs = require('fs');

const db = require('../database');
const { authenticate, requireAdmin } = require('../middleware/auth');
const { audit } = require('../utils/audit-log');
const logger = require('../utils/logger');
const { recomputeTier } = require('./kyc.routes');

const router = express.Router();

router.use(authenticate, requireAdmin);

// ─── GET /api/admin/kyc/queue ────────────────────────────────
router.get('/queue', async (req, res) => {
    try {
        const rows = await db.all(`
            SELECT u.id as user_id, u.username, u.email, u.kyc_status, u.kyc_submitted_at,
                   COUNT(d.id) as doc_count
            FROM users u
            JOIN kyc_documents d ON d.user_id = u.id AND d.status = 'pending'
            WHERE u.kyc_status = 'pending'
            GROUP BY u.id, u.username, u.email, u.kyc_status, u.kyc_submitted_at
            ORDER BY u.kyc_submitted_at ASC
            LIMIT 100
        `);
        res.json({ queue: rows });
    } catch (err) {
        logger.error('KYC queue failed', { error: err.message });
        res.status(500).json({ error: 'Failed to fetch queue' });
    }
});

// ─── GET /api/admin/kyc/user/:id ─────────────────────────────
router.get('/user/:id', async (req, res) => {
    try {
        const userId = parseInt(req.params.id, 10);
        if (!userId) return res.status(400).json({ error: 'Invalid user id' });

        const u = await db.get(
            `SELECT id, username, email, phone, date_of_birth, country, email_verified, phone_verified,
                    kyc_status, kyc_tier, kyc_admin_notes, kyc_submitted_at, kyc_reviewed_at, kyc_reviewed_by,
                    created_at
             FROM users WHERE id = ?`,
            [userId]
        );
        if (!u) return res.status(404).json({ error: 'User not found' });

        const docs = await db.all(
            `SELECT id, doc_type, file_name, mime_type, file_size, sha256, status, admin_notes, submitted_at, reviewed_at
             FROM kyc_documents WHERE user_id = ? ORDER BY submitted_at DESC`,
            [userId]
        );

        res.json({ user: u, documents: docs });
    } catch (err) {
        logger.error('KYC user fetch failed', { error: err.message });
        res.status(500).json({ error: 'Failed to fetch user' });
    }
});

// ─── GET /api/admin/kyc/document/:id/file ───────────────────
// Streams the actual document — admin-only — paths sanitized to prevent traversal.
router.get('/document/:id/file', async (req, res) => {
    try {
        const id = parseInt(req.params.id, 10);
        if (!id) return res.status(400).json({ error: 'Invalid document id' });

        const doc = await db.get(
            'SELECT id, file_path, mime_type, file_name FROM kyc_documents WHERE id = ?',
            [id]
        );
        if (!doc) return res.status(404).json({ error: 'Document not found' });

        const root = path.resolve(__dirname, '..');
        const abs = path.resolve(root, doc.file_path);
        // Refuse anything outside server/uploads/kyc/
        const safeRoot = path.resolve(root, 'uploads', 'kyc');
        if (!abs.startsWith(safeRoot) || !fs.existsSync(abs)) {
            return res.status(404).json({ error: 'File not found' });
        }
        res.setHeader('Content-Type', doc.mime_type || 'application/octet-stream');
        res.setHeader('Content-Disposition', 'inline; filename="' + (doc.file_name || ('doc-' + id)).replace(/"/g, '') + '"');
        res.setHeader('Cache-Control', 'private, no-store');
        fs.createReadStream(abs).pipe(res);
    } catch (err) {
        logger.error('KYC file stream failed', { error: err.message });
        res.status(500).json({ error: 'Failed to load file' });
    }
});

// ─── POST /api/admin/kyc/document/:id/approve ───────────────
router.post('/document/:id/approve', async (req, res) => {
    try {
        const id = parseInt(req.params.id, 10);
        const notes = (req.body && req.body.notes) || null;
        const doc = await db.get('SELECT id, user_id, status FROM kyc_documents WHERE id = ?', [id]);
        if (!doc) return res.status(404).json({ error: 'Document not found' });

        const now = new Date().toISOString();
        await db.run(
            "UPDATE kyc_documents SET status = 'approved', admin_notes = ?, reviewed_at = ?, reviewed_by = ? WHERE id = ?",
            [notes, now, req.user.id, id]
        );

        audit('kyc.doc.approve', { userId: doc.user_id, ip: req.ip, requestId: req.id, details: { docId: id, notes } }).catch(() => {});
        res.json({ ok: true });
    } catch (err) {
        logger.error('KYC doc approve failed', { error: err.message });
        res.status(500).json({ error: 'Approve failed' });
    }
});

// ─── POST /api/admin/kyc/document/:id/reject ────────────────
router.post('/document/:id/reject', async (req, res) => {
    try {
        const id = parseInt(req.params.id, 10);
        const notes = (req.body && req.body.notes) || 'Document rejected';
        const doc = await db.get('SELECT id, user_id, status FROM kyc_documents WHERE id = ?', [id]);
        if (!doc) return res.status(404).json({ error: 'Document not found' });

        const now = new Date().toISOString();
        await db.run(
            "UPDATE kyc_documents SET status = 'rejected', admin_notes = ?, reviewed_at = ?, reviewed_by = ? WHERE id = ?",
            [notes, now, req.user.id, id]
        );

        audit('kyc.doc.reject', { userId: doc.user_id, ip: req.ip, requestId: req.id, details: { docId: id, notes } }).catch(() => {});
        res.json({ ok: true });
    } catch (err) {
        logger.error('KYC doc reject failed', { error: err.message });
        res.status(500).json({ error: 'Reject failed' });
    }
});

// ─── POST /api/admin/kyc/user/:id/approve ───────────────────
router.post('/user/:id/approve', async (req, res) => {
    try {
        const userId = parseInt(req.params.id, 10);
        const notes = (req.body && req.body.notes) || null;
        const u = await db.get('SELECT id FROM users WHERE id = ?', [userId]);
        if (!u) return res.status(404).json({ error: 'User not found' });

        const now = new Date().toISOString();
        await db.run(
            "UPDATE kyc_documents SET status = 'approved', reviewed_at = ?, reviewed_by = ? WHERE user_id = ? AND status = 'pending'",
            [now, req.user.id, userId]
        );
        await db.run(
            "UPDATE users SET kyc_status = 'approved', kyc_admin_notes = ?, kyc_reviewed_at = ?, kyc_reviewed_by = ? WHERE id = ?",
            [notes, now, req.user.id, userId]
        );
        await recomputeTier(userId);

        audit('kyc.user.approve', { userId, ip: req.ip, requestId: req.id, details: { reviewer: req.user.id, notes } }).catch(() => {});
        res.json({ ok: true });
    } catch (err) {
        logger.error('KYC user approve failed', { error: err.message });
        res.status(500).json({ error: 'Approve failed' });
    }
});

// ─── POST /api/admin/kyc/user/:id/reject ────────────────────
router.post('/user/:id/reject', async (req, res) => {
    try {
        const userId = parseInt(req.params.id, 10);
        const notes = (req.body && req.body.notes) || 'KYC rejected — please resubmit.';
        const u = await db.get('SELECT id FROM users WHERE id = ?', [userId]);
        if (!u) return res.status(404).json({ error: 'User not found' });

        const now = new Date().toISOString();
        await db.run(
            "UPDATE kyc_documents SET status = 'rejected', reviewed_at = ?, reviewed_by = ? WHERE user_id = ? AND status = 'pending'",
            [now, req.user.id, userId]
        );
        await db.run(
            "UPDATE users SET kyc_status = 'rejected', kyc_admin_notes = ?, kyc_reviewed_at = ?, kyc_reviewed_by = ? WHERE id = ?",
            [notes, now, req.user.id, userId]
        );
        await recomputeTier(userId);

        audit('kyc.user.reject', { userId, ip: req.ip, requestId: req.id, details: { reviewer: req.user.id, notes } }).catch(() => {});
        res.json({ ok: true });
    } catch (err) {
        logger.error('KYC user reject failed', { error: err.message });
        res.status(500).json({ error: 'Reject failed' });
    }
});

module.exports = router;
