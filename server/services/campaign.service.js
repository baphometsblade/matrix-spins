'use strict';
const db = require('../database');

/**
 * Calculate the ISO timestamp for next Monday midnight UTC.
 * Used to set the end date of the weekend campaign.
 */
function nextMondayMidnight() {
    const now = new Date();
    const day = now.getDay(); // 0=Sun … 6=Sat
    // Days until Monday: Sun→1, Mon→7(wrap), Tue→6, Wed→5, Thu→4, Fri→3, Sat→2
    const daysUntilMonday = day === 0 ? 1 : 8 - day;
    const monday = new Date(now);
    monday.setUTCDate(now.getUTCDate() + daysUntilMonday);
    monday.setUTCHours(0, 0, 0, 0);
    return monday.toISOString().slice(0, 19).replace('T', ' ');
}

/**
 * Build the list of standing (auto-generated) campaigns that are always
 * available even when no admin-created campaigns exist.
 *
 * @param {number|string} userId - used to check if the user has already claimed
 *                                 the first-deposit welcome bonus.
 * @returns {Promise<object[]>}
 */
async function buildStandingCampaigns(userId) {
    const standing = [];
    const now = new Date();
    const dayOfWeek = now.getDay(); // 0=Sun, 5=Fri, 6=Sat

    // ── Welcome match — always available (7-day rolling window) ──────────────
    // Check whether this user has already made a deposit; if so, skip it so
    // we don't mislead returning depositors.
    let firstDepositClaimed = false;
    try {
        const dep = await db.get(
            `SELECT COUNT(*) as cnt FROM deposits WHERE user_id = ? AND status = 'completed'`,
            [userId]
        );
        firstDepositClaimed = dep && dep.cnt > 0;
    } catch (e) {
        console.warn('[Campaign] First-deposit check error:', e.message);
        // Non-fatal — just show the campaign if we can't check
    }

    if (!firstDepositClaimed) {
        standing.push({
            id: 'welcome_match',
            name: '🎰 Welcome 100% Match Bonus',
            type: 'deposit_match',
            bonusPct: 100,
            maxBonus: 500,
            wageringMult: 25,
            minDeposit: 20,
            startAt: new Date(now.getTime() - 86400000).toISOString().slice(0, 19).replace('T', ' '), // started yesterday
            endAt: new Date(now.getTime() + 7 * 24 * 3600000).toISOString().slice(0, 19).replace('T', ' '), // 7 days from now
            promoCode: null,
            claimed: false,
            claimsRemaining: null,
            targetSegment: 'new',
            tag: 'NEW PLAYER',
            description: 'Double your first deposit! We\'ll match it 100% up to $500.'
        });
    }

    // ── Weekend double-XP campaign — Fri/Sat/Sun only ────────────────────────
    if (dayOfWeek === 5 || dayOfWeek === 6 || dayOfWeek === 0) {
        standing.push({
            id: 'weekend_boost',
            name: '🎉 Weekend Double XP Event',
            type: 'xp_boost',
            bonusPct: 50,
            maxBonus: 100,
            wageringMult: 0,
            minDeposit: 10,
            startAt: new Date(now).toISOString().slice(0, 19).replace('T', ' '),
            endAt: nextMondayMidnight(),
            promoCode: null,
            claimed: false,
            claimsRemaining: null,
            targetSegment: 'all',
            tag: 'WEEKEND',
            description: 'Earn double XP on every spin this weekend. Play more, level up faster!'
        });
    }

    // ── Midweek reload — Tue/Wed/Thu ─────────────────────────────────────────
    if (dayOfWeek >= 2 && dayOfWeek <= 4) {
        // End on upcoming Friday midnight
        const daysToFriday = 5 - dayOfWeek;
        const friday = new Date(now);
        friday.setUTCDate(now.getUTCDate() + daysToFriday);
        friday.setUTCHours(0, 0, 0, 0);
        standing.push({
            id: 'midweek_reload',
            name: '⚡ Midweek Reload Bonus',
            type: 'deposit_match',
            bonusPct: 50,
            maxBonus: 250,
            wageringMult: 20,
            minDeposit: 25,
            startAt: new Date(now).toISOString().slice(0, 19).replace('T', ' '),
            endAt: friday.toISOString().slice(0, 19).replace('T', ' '),
            promoCode: null,
            claimed: false,
            claimsRemaining: null,
            targetSegment: 'returning',
            tag: 'MIDWEEK',
            description: 'Top up midweek and get 50% extra credits up to $250. Offer expires Friday!'
        });
    }

    return standing;
}

/**
 * Get active campaigns visible to a user.
 *
 * Merges admin-created DB campaigns with auto-generated standing campaigns.
 * Standing campaigns are appended only when they don't duplicate an existing
 * DB campaign of the same type (checked by campaign id prefix / type).
 *
 * Always returns an array (empty is OK — never throws).
 */
async function getActiveCampaigns(userId) {
    let dbCampaigns = [];

    try {
        const rows = await db.all(`
            SELECT c.id, c.name, c.type, c.bonus_pct, c.max_bonus, c.wagering_mult, c.min_deposit,
                   c.start_at, c.end_at, c.promo_code, c.target_segment, c.max_claims, c.claims_count,
                   (SELECT COUNT(*) FROM campaign_claims cc
                    WHERE cc.campaign_id = c.id AND cc.user_id = ?) as user_claimed
            FROM campaigns c
            WHERE c.active = 1
              AND c.start_at <= datetime('now')
              AND c.end_at > datetime('now')
              AND (c.max_claims = 0 OR c.claims_count < c.max_claims)
            ORDER BY c.end_at ASC
        `, [userId]);

        dbCampaigns = rows.map(c => ({
            id: c.id,
            name: c.name,
            type: c.type,
            bonusPct: c.bonus_pct,
            maxBonus: c.max_bonus,
            wageringMult: c.wagering_mult,
            minDeposit: c.min_deposit,
            startAt: c.start_at,
            endAt: c.end_at,
            promoCode: c.promo_code,
            claimed: c.user_claimed > 0,
            claimsRemaining: c.max_claims > 0 ? c.max_claims - c.claims_count : null,
            targetSegment: c.target_segment,
            tag: null,
            description: null
        }));
    } catch (e) {
        console.warn('[Campaign] DB query error:', e.message);
        // Continue — we can still return standing campaigns
    }

    // Build and merge standing campaigns
    try {
        const standing = await buildStandingCampaigns(userId);

        // Collect types already represented by DB campaigns so we don't duplicate
        const dbTypes = new Set(dbCampaigns.map(c => c.type));

        // Also collect any standing-IDs that match an existing DB campaign name prefix
        for (const s of standing) {
            const alreadyExists = dbCampaigns.some(
                c => c.type === s.type && c.targetSegment === s.targetSegment
            );
            if (!alreadyExists) {
                dbCampaigns.push(s);
            }
        }
    } catch (e) {
        console.warn('[Campaign] standing campaigns error:', e.message);
        // Non-fatal — return whatever DB campaigns we have
    }

    return dbCampaigns;
}

/**
 * Admin: create a new campaign
 */
async function createCampaign(data) {
    const result = await db.run(`
        INSERT INTO campaigns (name, type, bonus_pct, max_bonus, wagering_mult, min_deposit, start_at, end_at, promo_code, target_segment, max_claims)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [data.name, data.type || 'deposit_match', data.bonusPct || 50, data.maxBonus || 200,
        data.wageringMult || 25, data.minDeposit || 10, data.startAt, data.endAt,
        data.promoCode || null, data.targetSegment || 'all', data.maxClaims || 0]);
    return result;
}

/**
 * Admin: list all campaigns
 */
async function getAllCampaigns() {
    return db.all(`SELECT id, name, type, bonus_pct, max_bonus, wagering_mult, min_deposit, start_at, end_at, promo_code, target_segment, max_claims, claims_count, active, created_at FROM campaigns ORDER BY created_at DESC LIMIT 50`);
}

/**
 * Admin: toggle campaign active status
 */
async function toggleCampaign(campaignId, active) {
    return db.run(`UPDATE campaigns SET active = ? WHERE id = ?`, [active ? 1 : 0, campaignId]);
}

module.exports = { getActiveCampaigns, createCampaign, getAllCampaigns, toggleCampaign };
