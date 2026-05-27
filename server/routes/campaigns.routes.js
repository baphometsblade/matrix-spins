'use strict';

const router = require('express').Router();
const db = require('../database');
const { authenticate, requireAdmin } = require('../middleware/auth');
const { bonusGuard } = require('../middleware/bonus-guard'); // ROUND 49

var isPg = db.isPg();
var idDef = isPg ? 'SERIAL PRIMARY KEY' : 'INTEGER PRIMARY KEY AUTOINCREMENT';
var tsDef = isPg ? 'TIMESTAMPTZ DEFAULT NOW()' : "TEXT DEFAULT (datetime('now'))";

// Bootstrap: create deposit_campaigns table if it doesn't exist
db.run(`CREATE TABLE IF NOT EXISTS deposit_campaigns (
    id ${idDef},
    name TEXT NOT NULL,
    description TEXT,
    match_percent INTEGER NOT NULL DEFAULT 100,
    max_bonus REAL NOT NULL DEFAULT 500,
    min_deposit REAL NOT NULL DEFAULT 10,
    start_at TEXT NOT NULL,
    end_at TEXT NOT NULL,
    is_active INTEGER DEFAULT 1,
    created_at ${tsDef}
)`).catch(function(e) { if (e && !String(e.message||e).match(/already exists/i)) console.warn('[campaigns] CREATE TABLE deposit_campaigns failed:', e.message); });

// Bootstrap: create deposit_campaign_claims table if it doesn't exist
db.run(`CREATE TABLE IF NOT EXISTS deposit_campaign_claims (
    id ${idDef},
    user_id INTEGER NOT NULL,
    campaign_id INTEGER NOT NULL,
    deposit_amount REAL NOT NULL,
    bonus_amount REAL NOT NULL,
    claimed_at ${tsDef},
    UNIQUE(user_id, campaign_id),
    FOREIGN KEY (user_id) REFERENCES users(id),
    FOREIGN KEY (campaign_id) REFERENCES deposit_campaigns(id)
)`).catch(function(e) { if (e && !String(e.message||e).match(/already exists/i)) console.warn('[campaigns] CREATE TABLE deposit_campaign_claims failed:', e.message); });

// Bootstrap: seed default "Welcome Weekend" campaign if none exist
// Retry with delay since DB may not be ready at module load time
function seedDefaultCampaign() {
    setTimeout(async function() {
        try {
            var count = await db.get('SELECT COUNT(*) as cnt FROM deposit_campaigns');
            if (count && count.cnt === 0) {
                var now = new Date();
                var endDate = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

                var startAt = now.toISOString().slice(0, 19).replace('T', ' ');
                var endAt = endDate.toISOString().slice(0, 19).replace('T', ' ');

                await db.run(
                    `INSERT INTO deposit_campaigns (name, description, match_percent, max_bonus, min_deposit, start_at, end_at, is_active)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
                    ['Welcome Weekend', 'Double your deposit! 100% match up to $500 on your next deposit.', 100, 500, 20, startAt, endAt, 1]
                );
                console.warn('[campaigns] Seeded default "Welcome Weekend" campaign');
        }
    } catch (err) {
        console.warn('[campaigns] Error seeding default campaign:', err.message);
    }
    }, 5000); // 5s delay for DB to initialize
}
seedDefaultCampaign();

/**
 * GET /active
 * Public endpoint - return currently active campaigns
 * Campaigns are active if:
 *   - is_active = 1
 *   - current time is between start_at and end_at
 */
router.get('/active', async function(req, res) {
    try {
        var now = new Date().toISOString().slice(0, 19).replace('T', ' ');
        var campaigns = await db.all(
            `SELECT id, name, description, match_percent, max_bonus, min_deposit, start_at, end_at
             FROM deposit_campaigns
             WHERE is_active = 1 AND start_at <= datetime(?) AND end_at >= datetime(?)
             ORDER BY created_at DESC`,
            [now, now]
        );

        var result = (campaigns || []).map(function(c) {
            return {
                id: c.id,
                name: c.name,
                description: c.description,
                matchPercent: parseFloat(c.match_percent) || 0,
                maxBonus: parseFloat(c.max_bonus) || 0,
                minDeposit: parseFloat(c.min_deposit) || 0,
                startAt: c.start_at,
                endAt: c.end_at
            };
        });

        return res.json(result);
    } catch (err) {
        console.warn('[campaigns] GET /active error:', err.message);
        return res.status(500).json({ error: 'Internal server error' });
    }
});

/**
 * GET /admin/all
 * Admin-only endpoint - return all campaigns
 */
router.get('/admin/all', authenticate, requireAdmin, async function(req, res) {
    try {
        var campaigns = await db.all(
            `SELECT id, name, description, match_percent, max_bonus, min_deposit, start_at, end_at, is_active, created_at
             FROM deposit_campaigns
             ORDER BY created_at DESC
             LIMIT 200`
        );

        var result = (campaigns || []).map(function(c) {
            return {
                id: c.id,
                name: c.name,
                description: c.description,
                matchPercent: parseFloat(c.match_percent) || 0,
                maxBonus: parseFloat(c.max_bonus) || 0,
                minDeposit: parseFloat(c.min_deposit) || 0,
                startAt: c.start_at,
                endAt: c.end_at,
                isActive: c.is_active === 1,
                createdAt: c.created_at
            };
        });

        return res.json(result);
    } catch (err) {
        console.warn('[campaigns] GET /admin/all error:', err.message);
        return res.status(500).json({ error: 'Internal server error' });
    }
});

/**
 * POST /admin/create
 * Admin-only endpoint - create a new deposit match campaign
 * Body: { name, matchPercent, maxBonus, minDeposit, startAt, endAt, description }
 */
router.post('/admin/create', authenticate, requireAdmin, async function(req, res) {
    try {
        var body = req.body || {};
        var name = (body.name || '').trim();
        var matchPercent = parseInt(body.matchPercent, 10);
        var maxBonus = parseFloat(body.maxBonus);
        var minDeposit = parseFloat(body.minDeposit);
        var startAt = body.startAt;
        var endAt = body.endAt;
        var description = (body.description || '').slice(0, 500);

        // Validate required fields
        if (!name || !startAt || !endAt) {
            return res.status(400).json({ error: 'name, startAt, and endAt are required' });
        }

        if (name.length > 100) {
            return res.status(400).json({ error: 'name must be 100 characters or less' });
        }

        // Default and validate numeric ranges
        if (isNaN(matchPercent)) matchPercent = 100;
        if (matchPercent < 1 || matchPercent > 500) {
            return res.status(400).json({ error: 'matchPercent must be between 1 and 500' });
        }
        if (!Number.isFinite(maxBonus) || maxBonus <= 0) maxBonus = 500;
        if (maxBonus > 10000) {
            return res.status(400).json({ error: 'maxBonus must be $10,000 or less' });
        }
        if (!Number.isFinite(minDeposit) || minDeposit <= 0) minDeposit = 10;
        if (minDeposit > 1000) {
            return res.status(400).json({ error: 'minDeposit must be $1,000 or less' });
        }

        // Validate date formats
        if (isNaN(Date.parse(startAt)) || isNaN(Date.parse(endAt))) {
            return res.status(400).json({ error: 'Invalid date format for startAt or endAt' });
        }

        var startDate = new Date(startAt);
        var endDate = new Date(endAt);

        if (endDate <= startDate) {
            return res.status(400).json({ error: 'endAt must be after startAt' });
        }

        // Insert campaign
        var result = await db.run(
            `INSERT INTO deposit_campaigns (name, description, match_percent, max_bonus, min_deposit, start_at, end_at, is_active)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [name, description, matchPercent, maxBonus, minDeposit, startAt, endAt, 1]
        );

        var campaignId = result.lastInsertRowid || result.insertId;

        console.warn('[campaigns] Admin created campaign:', { id: campaignId, name: name });

        return res.json({
            success: true,
            id: campaignId,
            name: name,
            description: description,
            matchPercent: matchPercent,
            maxBonus: maxBonus,
            minDeposit: minDeposit,
            startAt: startAt,
            endAt: endAt,
            isActive: true
        });
    } catch (err) {
        console.warn('[campaigns] POST /admin/create error:', err.message);
        return res.status(500).json({ error: 'Internal server error' });
    }
});

/**
 * POST /claim
 * Authenticated endpoint - claim a campaign bonus on deposit
 * Body: { campaignId, depositAmount }
 *
 * Validation:
 *   - Campaign must exist and be active (now between start_at and end_at)
 *   - depositAmount must be >= min_deposit
 *   - User can claim max once per campaign (UNIQUE constraint)
 *
 * Bonus calculation:
 *   bonusAmount = min(depositAmount * matchPercent / 100, maxBonus)
 *
 * Actions:
 *   - Record claim in deposit_campaign_claims
 *   - Credit bonus to user's bonus_balance
 *   - Record transaction
 */
router.post('/claim', authenticate, bonusGuard, async function(req, res) { // ROUND 49: Added bonusGuard
    try {
        var userId = req.user.id;

        // ROUND 38: Self-exclusion check (regulatory compliance)
        try {
            var exclusion = await db.get(
                "SELECT id FROM self_exclusions WHERE user_id = ? AND is_active = 1 AND (ends_at IS NULL OR ends_at > datetime('now'))",
                [userId]
            );
            if (exclusion) {
                return res.status(403).json({ error: 'Account is self-excluded. Bonuses are disabled.' });
            }
        } catch (exclErr) {
            if (exclErr.message && exclErr.message.includes('no such table')) { /* OK */ }
            else {
                console.error('[SelfExcl] Check failed:', exclErr.message);
                return res.status(500).json({ error: 'Security check failed' });
            }
        }
        var body = req.body || {};
        var campaignId = parseInt(body.campaignId);
        var depositAmount = parseFloat(body.depositAmount) || 0;

        // Validate inputs
        if (!campaignId || isNaN(campaignId)) {
            return res.status(400).json({ error: 'campaignId is required and must be numeric' });
        }

        if (depositAmount <= 0) {
            return res.status(400).json({ error: 'depositAmount must be greater than 0' });
        }

        // Fetch campaign
        var campaign = await db.get(
            `SELECT id, name, match_percent, max_bonus, min_deposit, start_at, end_at, is_active
             FROM deposit_campaigns
             WHERE id = ?`,
            [campaignId]
        );

        if (!campaign) {
            return res.status(404).json({ error: 'Campaign not found' });
        }

        // Check if campaign is active
        var now = new Date().toISOString().slice(0, 19).replace('T', ' ');
        if (campaign.is_active !== 1 || campaign.start_at > now || campaign.end_at < now) {
            return res.status(400).json({ error: 'Campaign is not currently active' });
        }

        // Check minimum deposit
        var minDeposit = parseFloat(campaign.min_deposit) || 0;
        if (depositAmount < minDeposit) {
            return res.status(400).json({
                error: 'Deposit amount does not meet minimum requirement',
                minDeposit: minDeposit,
                depositAmount: depositAmount
            });
        }

        // ROUND 32: CRITICAL — Verify actual deposit exists in deposits table.
        // Previously accepted client-claimed depositAmount without verification.
        // Player could claim bonus for a deposit they never made.
        var verifiedDeposit = await db.get(
            "SELECT SUM(amount) as total FROM deposits WHERE user_id = ? AND amount >= ? AND created_at >= datetime('now', '-24 hours') AND status IN ('completed', 'confirmed')",
            [userId, minDeposit]
        );
        if (!verifiedDeposit || !verifiedDeposit.total || verifiedDeposit.total < depositAmount) {
            return res.status(400).json({
                error: 'No verified deposit found matching this amount in the last 24 hours',
                required: depositAmount,
                verified: verifiedDeposit ? verifiedDeposit.total : 0
            });
        }

        // Check if user already claimed this campaign
        var existingClaim = await db.get(
            'SELECT id FROM deposit_campaign_claims WHERE user_id = ? AND campaign_id = ?',
            [userId, campaignId]
        );

        if (existingClaim) {
            return res.status(400).json({ error: 'You have already claimed this campaign bonus' });
        }

        // Calculate bonus
        var matchPercent = parseFloat(campaign.match_percent) || 0;
        var maxBonus = parseFloat(campaign.max_bonus) || 0;
        var bonusAmount = Math.min(
            depositAmount * (matchPercent / 100),
            maxBonus
        );
        bonusAmount = Math.round(bonusAmount * 100) / 100;

        if (bonusAmount <= 0) {
            return res.status(400).json({ error: 'No bonus available' });
        }

        // Record claim
        var claimResult = await db.run(
            `INSERT INTO deposit_campaign_claims (user_id, campaign_id, deposit_amount, bonus_amount)
             VALUES (?, ?, ?, ?)`,
            [userId, campaignId, depositAmount, bonusAmount]
        );

        // Credit bonus to bonus_balance with 30x wagering (deposit match)
        await db.run(
            'UPDATE users SET bonus_balance = COALESCE(bonus_balance, 0) + ?, wagering_requirement = COALESCE(wagering_requirement, 0) + ? WHERE id = ?',
            [bonusAmount, bonusAmount * 30, userId]
        );

        // Record transaction
        await db.run(
            `INSERT INTO transactions (user_id, type, amount, balance_before, balance_after, reference)
             VALUES (?, ?, ?, COALESCE((SELECT balance FROM users WHERE id = ?), 0), COALESCE((SELECT balance FROM users WHERE id = ?), 0), ?)`,
            [userId, 'bonus', bonusAmount, userId, userId, 'Deposit Match Bonus: ' + campaign.name + ' (' + matchPercent + '%) — $' + bonusAmount.toFixed(2)]
        );

        // Fetch updated user bonus balance
        var updated = await db.get(
            'SELECT bonus_balance FROM users WHERE id = ?',
            [userId]
        );

        var claimId = claimResult.lastInsertRowid || claimResult.insertId;

        console.warn('[campaigns] User claimed campaign:', { userId: userId, campaignId: campaignId, bonusAmount: bonusAmount });

        return res.json({
            success: true,
            claimId: claimId,
            campaignId: campaignId,
            campaignName: campaign.name,
            depositAmount: depositAmount,
            matchPercent: matchPercent,
            bonusAmount: bonusAmount,
            newBonusBalance: parseFloat(updated?.bonus_balance) || 0
        });
    } catch (err) {
        console.warn('[campaigns] POST /claim error:', err.message);
        return res.status(500).json({ error: 'Internal server error' });
    }
});

module.exports = router;
