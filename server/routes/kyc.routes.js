'use strict';

/**
 * KYC Verification — three tiers:
 *   - unverified  : deposit cap $500, withdrawals blocked
 *   - basic       : email + phone verified, deposit cap $5000
 *   - full        : ID document + proof of address approved by admin, no caps
 *
 * Documents are stored on disk under /uploads/kyc/<userId>/, and the DB only
 * holds the file reference (path + mime + size + sha256 of contents).
 */

const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const multer = require('multer');

const db = require('../database');
const { authenticate } = require('../middleware/auth');
const { audit } = require('../utils/audit-log');
const logger = require('../utils/logger');

const router = express.Router();

function _isPg() { return typeof db.isPg === 'function' && db.isPg(); }
function _idDef() { return _isPg() ? 'SERIAL PRIMARY KEY' : 'INTEGER PRIMARY KEY AUTOINCREMENT'; }
function _tsDef() { return _isPg() ? 'TIMESTAMPTZ DEFAULT NOW()' : "TEXT DEFAULT (datetime('now'))"; }

// ─── Migrations ──────────────────────────────────────────────
[
    "kyc_tier TEXT DEFAULT 'unverified'",
    'kyc_admin_notes TEXT',
    'kyc_submitted_at TEXT',
    'kyc_reviewed_at TEXT',
    'kyc_reviewed_by INTEGER',
].forEach(function(colDef) {
    db.run('ALTER TABLE users ADD COLUMN ' + colDef).catch(function(e) {
        if (e && !String(e.message || e).match(/duplicate column|already exists|no such table/i)) {
            console.warn('[KYC] users ALTER failed:', e.message || e);
        }
    });
});

db.run(`CREATE TABLE IF NOT EXISTS kyc_documents (
    id ${_idDef()},
    user_id INTEGER NOT NULL,
    doc_type TEXT NOT NULL,
    file_path TEXT NOT NULL,
    file_name TEXT,
    mime_type TEXT,
    file_size INTEGER,
    sha256 TEXT,
    status TEXT DEFAULT 'pending',
    admin_notes TEXT,
    submitted_at ${_tsDef()},
    reviewed_at TEXT,
    reviewed_by INTEGER
)`).catch(function(e){ if (e && !String(e.message||e).match(/already exists/i)) console.warn('[KYC] documents create failed:', e.message||e); });

db.run('CREATE INDEX IF NOT EXISTS idx_kyc_documents_user ON kyc_documents(user_id)').catch(function(){});
db.run('CREATE INDEX IF NOT EXISTS idx_kyc_documents_status ON kyc_documents(status)').catch(function(){});

// ─── Multer setup ────────────────────────────────────────────
const UPLOAD_ROOT = path.resolve(__dirname, '..', 'uploads', 'kyc');
try { fs.mkdirSync(UPLOAD_ROOT, { recursive: true }); } catch (_) {}

const ALLOWED_MIMES = new Set(['image/jpeg', 'image/png', 'image/webp', 'application/pdf']);
const MAX_FILE_BYTES = 8 * 1024 * 1024; // 8 MB

const VALID_DOC_TYPES = new Set(['passport', 'drivers_license', 'national_id', 'proof_of_address']);

const storage = multer.diskStorage({
    destination(req, file, cb) {
        const userDir = path.join(UPLOAD_ROOT, String(req.user && req.user.id || 'anon'));
        try { fs.mkdirSync(userDir, { recursive: true }); } catch (_) {}
        cb(null, userDir);
    },
    filename(req, file, cb) {
        const ext = path.extname(file.originalname || '').toLowerCase().replace(/[^a-z0-9.]/g, '').slice(0, 8);
        const rand = crypto.randomBytes(8).toString('hex');
        cb(null, Date.now() + '-' + rand + ext);
    },
});

const upload = multer({
    storage,
    limits: { fileSize: MAX_FILE_BYTES, files: 1 },
    fileFilter(req, file, cb) {
        if (!ALLOWED_MIMES.has(file.mimetype)) {
            return cb(new Error('Unsupported file type — only JPG, PNG, WebP, and PDF are accepted.'));
        }
        cb(null, true);
    },
});

// ─── Helpers ─────────────────────────────────────────────────
function computeSha256(filePath) {
    return new Promise((resolve, reject) => {
        const hash = crypto.createHash('sha256');
        const stream = fs.createReadStream(filePath);
        stream.on('data', (d) => hash.update(d));
        stream.on('end', () => resolve(hash.digest('hex')));
        stream.on('error', reject);
    });
}

function tierLimits(tier) {
    switch ((tier || 'unverified').toLowerCase()) {
        case 'full':  return { depositLimit: null, withdrawalAllowed: true };
        case 'basic': return { depositLimit: 5000, withdrawalAllowed: true };
        default:      return { depositLimit: 500, withdrawalAllowed: false };
    }
}

async function recomputeTier(userId) {
    const u = await db.get(
        'SELECT email_verified, phone_verified, kyc_status FROM users WHERE id = ?',
        [userId]
    );
    if (!u) return 'unverified';
    let tier = 'unverified';
    if (u.email_verified && u.phone_verified) tier = 'basic';
    if (u.kyc_status === 'approved') tier = 'full';
    await db.run('UPDATE users SET kyc_tier = ? WHERE id = ?', [tier, userId]);
    return tier;
}

// ─── GET /api/kyc/status ─────────────────────────────────────
router.get('/status', authenticate, async (req, res) => {
    try {
        const u = await db.get(
            `SELECT email_verified, phone_verified, kyc_status, kyc_tier, kyc_admin_notes,
                    kyc_submitted_at, kyc_reviewed_at
             FROM users WHERE id = ?`,
            [req.user.id]
        );
        if (!u) return res.status(404).json({ error: 'User not found' });

        const tier = await recomputeTier(req.user.id);
        const limits = tierLimits(tier);

        const docs = await db.all(
            `SELECT id, doc_type, file_name, mime_type, file_size, status, admin_notes, submitted_at, reviewed_at
             FROM kyc_documents WHERE user_id = ? ORDER BY submitted_at DESC`,
            [req.user.id]
        );

        res.json({
            tier,
            limits,
            emailVerified: !!u.email_verified,
            phoneVerified: !!u.phone_verified,
            status: u.kyc_status || 'unverified',
            adminNotes: u.kyc_admin_notes || null,
            submittedAt: u.kyc_submitted_at,
            reviewedAt: u.kyc_reviewed_at,
            documents: docs,
        });
    } catch (err) {
        logger.error('KYC status failed', { error: err.message });
        res.status(500).json({ error: 'Failed to fetch KYC status' });
    }
});

// ─── POST /api/kyc/upload ────────────────────────────────────
// multipart/form-data: file=<binary>, doc_type=<passport|drivers_license|national_id|proof_of_address>
router.post('/upload', authenticate, (req, res, next) => {
    upload.single('file')(req, res, async (err) => {
        if (err) {
            logger.warn('KYC upload error', { error: err.message });
            const safeMsg = err.code === 'LIMIT_FILE_SIZE' ? 'File too large (max 10 MB)'
                : err.code === 'LIMIT_UNEXPECTED_FILE' ? 'Unexpected file field'
                : 'Upload failed';
            return res.status(400).json({ error: safeMsg });
        }
        try {
            if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

            const docType = String(req.body.doc_type || '').toLowerCase();
            if (!VALID_DOC_TYPES.has(docType)) {
                // Cleanup the uploaded file before rejecting
                try { fs.unlinkSync(req.file.path); } catch (_) {}
                return res.status(400).json({ error: 'Invalid doc_type. Must be one of: passport, drivers_license, national_id, proof_of_address' });
            }

            const sha = await computeSha256(req.file.path);
            const relPath = path.relative(path.resolve(__dirname, '..'), req.file.path).replace(/\\/g, '/');

            await db.run(
                `INSERT INTO kyc_documents (user_id, doc_type, file_path, file_name, mime_type, file_size, sha256, status)
                 VALUES (?, ?, ?, ?, ?, ?, ?, 'pending')`,
                [req.user.id, docType, relPath, req.file.originalname, req.file.mimetype, req.file.size, sha]
            );

            // Mark KYC as pending review for the user
            const now = new Date().toISOString();
            await db.run(
                "UPDATE users SET kyc_status = 'pending', kyc_submitted_at = ? WHERE id = ?",
                [now, req.user.id]
            );

            audit('kyc.upload', {
                userId: req.user.id, ip: req.ip, requestId: req.id,
                details: { docType, sha256: sha, size: req.file.size },
            }).catch(() => {});

            res.json({
                ok: true,
                message: 'Document uploaded. Review typically takes 1-3 business days.',
                docType,
                sha256: sha,
            });
        } catch (e) {
            logger.error('KYC upload processing failed', { error: e.message, stack: e.stack });
            try { if (req.file) fs.unlinkSync(req.file.path); } catch (_) {}
            res.status(500).json({ error: 'Upload processing failed' });
        }
    });
});

// ─── DELETE /api/kyc/document/:id ───────────────────────────
// Allow user to remove a document while it's still pending.
router.delete('/document/:id', authenticate, async (req, res) => {
    try {
        const id = parseInt(req.params.id, 10);
        if (!id) return res.status(400).json({ error: 'Invalid document id' });

        const doc = await db.get(
            'SELECT id, user_id, file_path, status FROM kyc_documents WHERE id = ?',
            [id]
        );
        if (!doc || doc.user_id !== req.user.id) return res.status(404).json({ error: 'Document not found' });
        if (doc.status !== 'pending') return res.status(400).json({ error: 'Cannot delete reviewed documents' });

        try {
            const abs = path.resolve(__dirname, '..', doc.file_path);
            if (fs.existsSync(abs)) fs.unlinkSync(abs);
        } catch (_) {}
        await db.run('DELETE FROM kyc_documents WHERE id = ?', [id]);

        res.json({ ok: true });
    } catch (err) {
        logger.error('KYC delete failed', { error: err.message });
        res.status(500).json({ error: 'Delete failed' });
    }
});

// ─── Internal middleware export ─────────────────────────────
async function enforceWithdrawalKyc(req, res, next) {
    try {
        if (!req.user) return res.status(401).json({ error: 'Authentication required' });
        const tier = await recomputeTier(req.user.id);
        const limits = tierLimits(tier);
        if (!limits.withdrawalAllowed) {
            return res.status(403).json({
                error: 'Identity verification required before withdrawal',
                kycRequired: true,
                tier,
            });
        }
        req.kycTier = tier;
        next();
    } catch (e) {
        logger.error('KYC enforce failed', { error: e.message });
        res.status(500).json({ error: 'KYC check failed' });
    }
}

async function enforceDepositCap(req, res, next) {
    try {
        if (!req.user) return next(); // optionalAuth path — let the route reject
        const amount = Number(req.body && req.body.amount) || 0;
        const tier = await recomputeTier(req.user.id);
        const limits = tierLimits(tier);
        if (limits.depositLimit !== null && amount > limits.depositLimit) {
            return res.status(403).json({
                error: 'Deposit exceeds your KYC tier limit. Verify identity to raise it.',
                kycRequired: true,
                tier,
                limit: limits.depositLimit,
            });
        }
        next();
    } catch (e) {
        logger.error('KYC deposit cap check failed', { error: e.message });
        next();
    }
}

module.exports = router;
module.exports.router = router;
module.exports.recomputeTier = recomputeTier;
module.exports.tierLimits = tierLimits;
module.exports.enforceWithdrawalKyc = enforceWithdrawalKyc;
module.exports.enforceDepositCap = enforceDepositCap;
