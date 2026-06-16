/**
 * Index migration — adds missing indexes to existing databases.
 *
 * Safe for both SQLite and PostgreSQL:
 *   - Uses CREATE INDEX IF NOT EXISTS (idempotent)
 *   - try/catch per index so one failure (e.g. table not yet created)
 *     does NOT block the rest
 *   - Logs progress so deploy logs show exactly which indexes were applied
 *
 * Called from server/index.js after initSchemas() — by that point all
 * service-bootstrapped tables (gems, cosmetics, boosts, etc.) exist.
 *
 * For NEW databases the same indexes are declared in schema-sqlite.js
 * (DEFERRED_INDEXES) and schema-pg.js (INDEXES), so they are created
 * at init time. This migration covers databases created before these
 * indexes were added to the schema files.
 */

'use strict';

const MIGRATION_INDEXES = [
    // ── CRITICAL: Revenue/Auth ──
    'CREATE INDEX IF NOT EXISTS idx_users_email ON users(email)',
    'CREATE INDEX IF NOT EXISTS idx_users_username ON users(username)',
    'CREATE INDEX IF NOT EXISTS idx_deposits_reference ON deposits(reference)',
    'CREATE INDEX IF NOT EXISTS idx_spins_user_game ON spins(user_id, game_id, created_at)',

    // ── HIGH: Bonus/claim tables ──
    'CREATE INDEX IF NOT EXISTS idx_cashback_rewards_user ON cashback_rewards(user_id, created_at)',
    'CREATE INDEX IF NOT EXISTS idx_milestone_claims_user ON milestone_claims(user_id, milestone_id)',
    'CREATE INDEX IF NOT EXISTS idx_session_reengage_claims_user ON session_reengage_claims(user_id)',
    'CREATE INDEX IF NOT EXISTS idx_loss_cashback_claims_user ON loss_cashback_claims(user_id)',
    'CREATE INDEX IF NOT EXISTS idx_happy_hour_bonuses_user ON happy_hour_bonuses(user_id)',
    'CREATE INDEX IF NOT EXISTS idx_withdrawal_offers_user ON withdrawal_offers(user_id, created_at)',
    'CREATE INDEX IF NOT EXISTS idx_referral_codes_user ON referral_codes(user_id)',
    'CREATE INDEX IF NOT EXISTS idx_referral_codes_code ON referral_codes(code)',
    'CREATE INDEX IF NOT EXISTS idx_referral_claims_referrer ON referral_claims(referrer_id)',
    'CREATE INDEX IF NOT EXISTS idx_referral_claims_referred ON referral_claims(referred_id)',
    'CREATE INDEX IF NOT EXISTS idx_promo_codes_code ON promo_codes(code)',
    'CREATE INDEX IF NOT EXISTS idx_promo_redemptions_user ON promo_redemptions(user_id)',
    'CREATE INDEX IF NOT EXISTS idx_promo_redemptions_code ON promo_redemptions(code_id)',
    'CREATE INDEX IF NOT EXISTS idx_battle_pass_claims_user_pass ON battle_pass_claims(user_id, pass_id)',
    'CREATE INDEX IF NOT EXISTS idx_battle_pass_progress_user_pass ON battle_pass_progress(user_id, pass_id)',

    // ── MEDIUM: Admin/analytics/service ──
    'CREATE INDEX IF NOT EXISTS idx_activity_log_user ON activity_log(user_id, created_at)',
    'CREATE INDEX IF NOT EXISTS idx_activity_log_created ON activity_log(created_at)',
    'CREATE INDEX IF NOT EXISTS idx_newsletter_subscribers_email ON newsletter_subscribers(email)',
    'CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_token ON password_reset_tokens(token)',
    'CREATE INDEX IF NOT EXISTS idx_email_verification_tokens_token ON email_verification_tokens(token)',
    'CREATE INDEX IF NOT EXISTS idx_slot_races_status ON slot_races(status)',
    'CREATE INDEX IF NOT EXISTS idx_slot_race_entries_race_user ON slot_race_entries(race_id, user_id)',
    'CREATE INDEX IF NOT EXISTS idx_gem_balances_user ON gem_balances(user_id)',
    'CREATE INDEX IF NOT EXISTS idx_cosmetic_inventory_user ON cosmetic_inventory(user_id, item_id)',
    'CREATE INDEX IF NOT EXISTS idx_active_boosts_user ON active_boosts(user_id, expires_at)',
    'CREATE INDEX IF NOT EXISTS idx_slot_events_active ON slot_events(is_active, start_at, end_at)',
    'CREATE INDEX IF NOT EXISTS idx_seasonal_event_progress_user ON seasonal_event_progress(user_id, event_id)',
    'CREATE INDEX IF NOT EXISTS idx_gem_purchases_user ON gem_purchases(user_id, created_at)',
];

/**
 * Apply all missing indexes. Safe for both SQLite and PostgreSQL.
 *
 * @param {object} db — the database facade (server/database.js)
 *                      Must expose an async `run(sql)` method.
 */
async function applyIndexes(db) {
    console.warn('[migration-add-indexes] Applying %d indexes…', MIGRATION_INDEXES.length);
    let applied = 0;
    let skipped = 0;

    for (const stmt of MIGRATION_INDEXES) {
        try {
            await db.run(stmt);
            applied++;
        } catch (err) {
            // Expected for tables not yet created (lazy-init routes).
            // Log but do NOT re-throw — one missing table must never
            // block the remaining indexes or trip degraded mode.
            skipped++;
            console.warn('[migration-add-indexes] Skipped (non-fatal): %s — %s', stmt.split(' ON ')[1] || stmt, err.message);
        }
    }

    console.warn('[migration-add-indexes] Done: %d applied, %d skipped', applied, skipped);
}

module.exports = { applyIndexes, MIGRATION_INDEXES };
