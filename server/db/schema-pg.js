/**
 * PostgreSQL schema DDL — translated from the SQLite originals.
 *
 * Key differences:
 *   AUTOINCREMENT  → SERIAL
 *   REAL (money)   → NUMERIC(15,2)
 *   datetime('now') → NOW()
 *   INTEGER bool   → INTEGER (kept for compat — PG supports it fine)
 */

'use strict';

const TABLES = [
    `CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        username TEXT UNIQUE NOT NULL,
        email TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        balance NUMERIC(15,2) DEFAULT 0,
        is_admin INTEGER DEFAULT 0,
        is_banned INTEGER DEFAULT 0,
        created_at TIMESTAMPTZ DEFAULT NOW()
    )`,

    `CREATE TABLE IF NOT EXISTS transactions (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id),
        type TEXT NOT NULL,
        amount NUMERIC(15,2) NOT NULL,
        balance_before NUMERIC(15,2) NOT NULL,
        balance_after NUMERIC(15,2) NOT NULL,
        reference TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW()
    )`,

    `CREATE TABLE IF NOT EXISTS spins (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id),
        game_id TEXT NOT NULL,
        bet_amount NUMERIC(15,2) NOT NULL,
        result_grid TEXT NOT NULL,
        win_amount NUMERIC(15,2) NOT NULL,
        rng_seed TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW()
    )`,

    `CREATE TABLE IF NOT EXISTS game_stats (
        game_id TEXT PRIMARY KEY,
        total_spins INTEGER DEFAULT 0,
        total_wagered NUMERIC(15,2) DEFAULT 0,
        total_paid NUMERIC(15,2) DEFAULT 0,
        actual_rtp REAL DEFAULT 0
    )`,

    `CREATE TABLE IF NOT EXISTS session_win_caps (
        user_id INTEGER PRIMARY KEY REFERENCES users(id),
        total_wins NUMERIC(15,2) DEFAULT 0,
        session_start TIMESTAMPTZ DEFAULT NOW()
    )`,

    `CREATE TABLE IF NOT EXISTS payment_methods (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id),
        type TEXT NOT NULL,
        label TEXT NOT NULL,
        details_encrypted TEXT,
        is_default INTEGER DEFAULT 0,
        is_verified INTEGER DEFAULT 0,
        created_at TIMESTAMPTZ DEFAULT NOW()
    )`,

    `CREATE TABLE IF NOT EXISTS deposits (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id),
        amount NUMERIC(15,2) NOT NULL,
        currency TEXT DEFAULT 'AUD',
        payment_method_id INTEGER REFERENCES payment_methods(id),
        payment_type TEXT NOT NULL,
        status TEXT DEFAULT 'pending',
        reference TEXT,
        external_ref TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        completed_at TIMESTAMPTZ
    )`,

    `CREATE TABLE IF NOT EXISTS withdrawals (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id),
        amount NUMERIC(15,2) NOT NULL,
        currency TEXT DEFAULT 'AUD',
        payment_method_id INTEGER REFERENCES payment_methods(id),
        payment_type TEXT NOT NULL,
        status TEXT DEFAULT 'pending',
        admin_note TEXT,
        reference TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        processed_at TIMESTAMPTZ
    )`,

    `CREATE TABLE IF NOT EXISTS password_reset_tokens (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id),
        token TEXT UNIQUE NOT NULL,
        expires_at TIMESTAMPTZ NOT NULL,
        used INTEGER DEFAULT 0,
        created_at TIMESTAMPTZ DEFAULT NOW()
    )`,

    `CREATE TABLE IF NOT EXISTS user_verification (
        user_id INTEGER PRIMARY KEY REFERENCES users(id),
        status TEXT DEFAULT 'unverified',
        document_type TEXT,
        submitted_at TIMESTAMPTZ,
        verified_at TIMESTAMPTZ,
        notes TEXT
    )`,

    `CREATE TABLE IF NOT EXISTS user_limits (
        user_id INTEGER PRIMARY KEY REFERENCES users(id),
        daily_deposit_limit NUMERIC(15,2),
        weekly_deposit_limit NUMERIC(15,2),
        monthly_deposit_limit NUMERIC(15,2),
        daily_loss_limit NUMERIC(15,2),
        session_time_limit INTEGER,
        self_excluded_until TIMESTAMPTZ,
        cooling_off_until TIMESTAMPTZ,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
    )`,

    `CREATE TABLE IF NOT EXISTS jackpot_pool (
        tier TEXT PRIMARY KEY,
        current_amount NUMERIC(15,2) NOT NULL,
        seed_amount NUMERIC(15,2) NOT NULL,
        contribution_rate REAL NOT NULL,
        total_contributed NUMERIC(15,2) DEFAULT 0,
        total_paid_out NUMERIC(15,2) DEFAULT 0,
        last_won_at TIMESTAMPTZ,
        last_winner_id INTEGER REFERENCES users(id)
    )`    ,

    `CREATE TABLE IF NOT EXISTS tournaments (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT,
        type TEXT NOT NULL,
        entry_fee NUMERIC(15,2) DEFAULT 0,
        prize_pool NUMERIC(15,2) DEFAULT 0,
        start_date TEXT NOT NULL,
        end_date TEXT NOT NULL,
        status TEXT DEFAULT 'active',
        max_participants INTEGER,
        created_at TIMESTAMPTZ DEFAULT NOW()
    )`,

    `CREATE TABLE IF NOT EXISTS tournament_entries (
        id SERIAL PRIMARY KEY,
        tournament_id INTEGER NOT NULL REFERENCES tournaments(id),
        user_id INTEGER NOT NULL REFERENCES users(id),
        score NUMERIC(15,4) DEFAULT 0,
        spins_played INTEGER DEFAULT 0,
        biggest_win NUMERIC(15,4) DEFAULT 0,
        entry_time TIMESTAMPTZ DEFAULT NOW(),
        last_spin_time TIMESTAMPTZ,
        UNIQUE(tournament_id, user_id)
    )`,

    `CREATE TABLE IF NOT EXISTS tournament_prizes (
        id SERIAL PRIMARY KEY,
        tournament_id INTEGER NOT NULL REFERENCES tournaments(id),
        rank INTEGER NOT NULL,
        prize_gems INTEGER DEFAULT 0,
        prize_description TEXT,
        UNIQUE(tournament_id, rank)
    )`,

    `CREATE TABLE IF NOT EXISTS user_achievements (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id),
        achievement_id TEXT NOT NULL,
        unlocked_at TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE(user_id, achievement_id)
    )`,

    `CREATE TABLE IF NOT EXISTS campaigns (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        type TEXT DEFAULT 'deposit_match',
        bonus_pct INTEGER DEFAULT 50,
        max_bonus NUMERIC(15,2) DEFAULT 200,
        wagering_mult INTEGER DEFAULT 25,
        min_deposit NUMERIC(15,2) DEFAULT 10,
        start_at TIMESTAMPTZ NOT NULL,
        end_at TIMESTAMPTZ NOT NULL,
        active INTEGER DEFAULT 1,
        promo_code TEXT,
        target_segment TEXT DEFAULT 'all',
        max_claims INTEGER DEFAULT 0,
        claims_count INTEGER DEFAULT 0,
        created_at TIMESTAMPTZ DEFAULT NOW()
    )`,

    `CREATE TABLE IF NOT EXISTS campaign_claims (
        id SERIAL PRIMARY KEY,
        campaign_id INTEGER NOT NULL REFERENCES campaigns(id),
        user_id INTEGER NOT NULL REFERENCES users(id),
        claimed_at TIMESTAMPTZ DEFAULT NOW(),
        bonus_amount NUMERIC(15,2) DEFAULT 0,
        UNIQUE(campaign_id, user_id)
    )`,

    `CREATE TABLE IF NOT EXISTS gifts (
        id SERIAL PRIMARY KEY,
        from_user_id INTEGER NOT NULL REFERENCES users(id),
        to_user_id INTEGER NOT NULL REFERENCES users(id),
        amount NUMERIC(15,2) NOT NULL,
        message TEXT DEFAULT '',
        status TEXT DEFAULT 'pending',
        created_at TIMESTAMPTZ DEFAULT NOW(),
        claimed_at TIMESTAMPTZ DEFAULT NULL
    )`,

    `CREATE TABLE IF NOT EXISTS contests (
        id SERIAL PRIMARY KEY,
        week_start TIMESTAMPTZ NOT NULL,
        week_end TIMESTAMPTZ NOT NULL,
        status TEXT DEFAULT 'active',
        finalized_at TIMESTAMPTZ DEFAULT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW()
    )`,

    `CREATE TABLE IF NOT EXISTS contest_entries (
        id SERIAL PRIMARY KEY,
        contest_id INTEGER NOT NULL REFERENCES contests(id),
        user_id INTEGER NOT NULL REFERENCES users(id),
        metric_type TEXT NOT NULL,
        metric_value NUMERIC(15,2) DEFAULT 0,
        updated_at TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE(contest_id, user_id, metric_type)
    )`,

    `CREATE TABLE IF NOT EXISTS contest_prizes (
        id SERIAL PRIMARY KEY,
        contest_id INTEGER NOT NULL REFERENCES contests(id),
        user_id INTEGER NOT NULL REFERENCES users(id),
        rank INTEGER NOT NULL,
        metric_type TEXT NOT NULL,
        prize_amount NUMERIC(15,2) NOT NULL,
        claimed INTEGER DEFAULT 0,
        created_at TIMESTAMPTZ DEFAULT NOW()
    )`,

    `CREATE TABLE IF NOT EXISTS bonus_events (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT DEFAULT '',
        event_type TEXT NOT NULL,
        multiplier NUMERIC(5,2) DEFAULT 2.0,
        target_games TEXT DEFAULT 'all',
        active INTEGER DEFAULT 1,
        start_at TIMESTAMPTZ NOT NULL,
        end_at TIMESTAMPTZ NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW()
    )`,

    `CREATE TABLE IF NOT EXISTS battle_pass_seasons (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        starts_at TIMESTAMPTZ NOT NULL,
        ends_at TIMESTAMPTZ NOT NULL,
        status VARCHAR(20) DEFAULT 'active'
    )`,

    `CREATE TABLE IF NOT EXISTS battle_pass_progress (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id),
        season_id INTEGER NOT NULL REFERENCES battle_pass_seasons(id),
        level INTEGER DEFAULT 0,
        xp INTEGER DEFAULT 0,
        is_premium SMALLINT DEFAULT 0,
        claimed_free TEXT DEFAULT '[]',
        claimed_premium TEXT DEFAULT '[]',
        UNIQUE(user_id, season_id)
    )`,

    `CREATE TABLE IF NOT EXISTS nft_ledger (
        id SERIAL PRIMARY KEY,
        token_id TEXT UNIQUE NOT NULL,
        user_id INTEGER NOT NULL REFERENCES users(id),
        type TEXT NOT NULL,
        amount NUMERIC(15,2) NOT NULL,
        currency TEXT DEFAULT 'AUD',
        source_table TEXT NOT NULL,
        source_id INTEGER NOT NULL,
        metadata TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW()
    )`,

    `CREATE TABLE IF NOT EXISTS deposit_limits (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL UNIQUE REFERENCES users(id),
        daily_limit NUMERIC(15,2),
        weekly_limit NUMERIC(15,2),
        monthly_limit NUMERIC(15,2),
        pending_daily_limit NUMERIC(15,2),
        pending_daily_effective_at TIMESTAMPTZ,
        pending_weekly_limit NUMERIC(15,2),
        pending_weekly_effective_at TIMESTAMPTZ,
        pending_monthly_limit NUMERIC(15,2),
        pending_monthly_effective_at TIMESTAMPTZ,
        updated_at TIMESTAMPTZ DEFAULT NOW()
    )`,

    `CREATE TABLE IF NOT EXISTS perf_metrics (
        id SERIAL PRIMARY KEY,
        page_load_time INTEGER,
        fcp INTEGER,
        lcp INTEGER,
        tti INTEGER,
        dom_nodes INTEGER,
        memory_used_mb NUMERIC(10,2),
        memory_total_mb NUMERIC(10,2),
        memory_limit_mb NUMERIC(10,2),
        url TEXT,
        user_agent TEXT,
        collected_at TIMESTAMPTZ DEFAULT NOW()
    )`,

    `CREATE TABLE IF NOT EXISTS game_favorites (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id),
        game_id TEXT NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE(user_id, game_id)
    )`,

    `CREATE TABLE IF NOT EXISTS game_ratings (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id),
        game_id TEXT NOT NULL,
        rating INTEGER NOT NULL CHECK(rating BETWEEN 1 AND 5),
        review TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE(user_id, game_id)
    )`,

    `CREATE TABLE IF NOT EXISTS chat_messages (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id),
        username TEXT NOT NULL,
        message TEXT NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW()
    )`,

    `CREATE TABLE IF NOT EXISTS activity_log (
        id SERIAL PRIMARY KEY,
        user_id INTEGER,
        action TEXT NOT NULL,
        details TEXT,
        ip_address TEXT,
        user_agent TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW()
    )`,

    `CREATE TABLE IF NOT EXISTS milestone_claims (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id),
        milestone_id TEXT NOT NULL,
        reward_amount NUMERIC(15,2) NOT NULL,
        claimed_at TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE(user_id, milestone_id)
    )`,

    `CREATE TABLE IF NOT EXISTS deposit_campaigns (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT,
        match_percent INTEGER NOT NULL DEFAULT 100,
        max_bonus NUMERIC(15,2) NOT NULL DEFAULT 500,
        min_deposit NUMERIC(15,2) NOT NULL DEFAULT 10,
        start_at TIMESTAMPTZ NOT NULL,
        end_at TIMESTAMPTZ NOT NULL,
        is_active INTEGER DEFAULT 1,
        created_at TIMESTAMPTZ DEFAULT NOW()
    )`,

    `CREATE TABLE IF NOT EXISTS deposit_campaign_claims (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id),
        campaign_id INTEGER NOT NULL REFERENCES deposit_campaigns(id),
        deposit_amount NUMERIC(15,2) NOT NULL,
        bonus_amount NUMERIC(15,2) NOT NULL,
        claimed_at TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE(user_id, campaign_id)
    )`,

    `CREATE TABLE IF NOT EXISTS loss_cashback_claims (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id),
        tier TEXT NOT NULL,
        loss_amount NUMERIC(15,2) NOT NULL,
        cashback_amount NUMERIC(15,2) NOT NULL,
        claimed_at TIMESTAMPTZ DEFAULT NOW()
    )`,

    `CREATE TABLE IF NOT EXISTS referral_codes (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL UNIQUE REFERENCES users(id),
        code TEXT NOT NULL UNIQUE,
        created_at TIMESTAMPTZ DEFAULT NOW()
    )`,

    `CREATE TABLE IF NOT EXISTS referral_claims (
        id SERIAL PRIMARY KEY,
        referrer_id INTEGER NOT NULL REFERENCES users(id),
        referred_id INTEGER NOT NULL UNIQUE REFERENCES users(id),
        bonus_given INTEGER DEFAULT 0,
        created_at TIMESTAMPTZ DEFAULT NOW()
    )`,

    `CREATE TABLE IF NOT EXISTS daily_wheel_spins (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id),
        prize_type TEXT NOT NULL,
        prize_amount NUMERIC(15,2) NOT NULL,
        spun_at TIMESTAMPTZ DEFAULT NOW()
    )`,

    `CREATE TABLE IF NOT EXISTS withdrawal_offers (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id),
        offer_type TEXT NOT NULL,
        offer_amount NUMERIC(15,2) NOT NULL,
        withdrawal_amount NUMERIC(15,2) NOT NULL,
        accepted INTEGER DEFAULT 0,
        created_at TIMESTAMPTZ DEFAULT NOW()
    )`,

    `CREATE TABLE IF NOT EXISTS newsletter_subscribers (
        id SERIAL PRIMARY KEY,
        email TEXT NOT NULL UNIQUE,
        user_id INTEGER REFERENCES users(id),
        subscribed_at TIMESTAMPTZ DEFAULT NOW(),
        unsubscribed INTEGER DEFAULT 0,
        source TEXT DEFAULT 'website'
    )`,

    `CREATE TABLE IF NOT EXISTS premium_tournaments (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        entry_fee NUMERIC(15,2) NOT NULL,
        prize_pool NUMERIC(15,2) NOT NULL,
        max_players INTEGER DEFAULT 100,
        current_players INTEGER DEFAULT 0,
        status TEXT DEFAULT 'active',
        starts_at TIMESTAMPTZ,
        ends_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ DEFAULT NOW()
    )`,

    `CREATE TABLE IF NOT EXISTS premium_tournament_entries (
        id SERIAL PRIMARY KEY,
        tournament_id INTEGER NOT NULL REFERENCES premium_tournaments(id),
        user_id INTEGER NOT NULL REFERENCES users(id),
        score NUMERIC(15,2) DEFAULT 0,
        spins INTEGER DEFAULT 0,
        best_win NUMERIC(15,2) DEFAULT 0,
        joined_at TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE(tournament_id, user_id)
    )`,

    `CREATE TABLE IF NOT EXISTS happy_hour_bonuses (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id),
        happy_hour_name TEXT NOT NULL,
        bonus_amount NUMERIC(15,2) NOT NULL,
        claimed_at TIMESTAMPTZ DEFAULT NOW()
    )`,

    `CREATE TABLE IF NOT EXISTS session_reengage_claims (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id),
        bonus_amount NUMERIC(15,2) NOT NULL,
        claimed_at TIMESTAMPTZ DEFAULT NOW()
    )`,

    `CREATE TABLE IF NOT EXISTS player_ltv (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL UNIQUE REFERENCES users(id),
        total_deposited NUMERIC(15,2) DEFAULT 0,
        total_withdrawn NUMERIC(15,2) DEFAULT 0,
        total_wagered NUMERIC(15,2) DEFAULT 0,
        total_won NUMERIC(15,2) DEFAULT 0,
        net_revenue NUMERIC(15,2) DEFAULT 0,
        session_count INTEGER DEFAULT 0,
        last_active TIMESTAMPTZ,
        whale_tier TEXT DEFAULT 'minnow',
        updated_at TIMESTAMPTZ DEFAULT NOW()
    )`,

    `CREATE TABLE IF NOT EXISTS slot_events (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        game_id TEXT,
        bonus_type TEXT NOT NULL,
        bonus_value NUMERIC(15,2) NOT NULL,
        start_at TIMESTAMPTZ NOT NULL,
        end_at TIMESTAMPTZ NOT NULL,
        is_active INTEGER DEFAULT 1,
        created_at TIMESTAMPTZ DEFAULT NOW()
    )`,
    `CREATE TABLE IF NOT EXISTS loss_insurance_policies (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL,
        tier TEXT NOT NULL,
        cost NUMERIC(15,2) NOT NULL,
        threshold NUMERIC(15,2) NOT NULL,
        refund_pct NUMERIC(5,2) NOT NULL,
        purchased_at TIMESTAMPTZ DEFAULT NOW(),
        expires_at TIMESTAMPTZ NOT NULL,
        claimed INTEGER DEFAULT 0,
        claim_amount NUMERIC(15,2) DEFAULT 0
    )`,
    `CREATE TABLE IF NOT EXISTS seasonal_events (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        theme TEXT NOT NULL,
        start_date TEXT NOT NULL,
        end_date TEXT NOT NULL,
        bonus_multiplier NUMERIC(5,2) NOT NULL DEFAULT 1.0,
        special_currency TEXT,
        challenges TEXT NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
    )`,
    `CREATE TABLE IF NOT EXISTS seasonal_event_progress (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL,
        event_id INTEGER NOT NULL,
        challenge_id INTEGER NOT NULL,
        completed_at TEXT,
        shamrock_balance INTEGER NOT NULL DEFAULT 0,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
    )`,
    `CREATE TABLE IF NOT EXISTS seasonal_event_prizes (
        id SERIAL PRIMARY KEY,
        event_id INTEGER NOT NULL,
        shamrock_cost INTEGER NOT NULL,
        prize_type TEXT NOT NULL,
        prize_name TEXT NOT NULL,
        prize_details TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW()
    )`,
    `CREATE TABLE IF NOT EXISTS gem_purchases (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL,
        package_id TEXT NOT NULL,
        gems_amount INTEGER NOT NULL,
        price_usd NUMERIC(15,2) NOT NULL,
        bonus_percent INTEGER DEFAULT 0,
        created_at TIMESTAMPTZ DEFAULT NOW()
    )`,
    `CREATE TABLE IF NOT EXISTS battle_passes (
        id SERIAL PRIMARY KEY,
        season_number INTEGER NOT NULL,
        name TEXT NOT NULL,
        start_date TEXT NOT NULL,
        end_date TEXT NOT NULL,
        premium_price INTEGER DEFAULT 999,
        elite_price INTEGER DEFAULT 2499,
        rewards TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW()
    )`,
    `CREATE TABLE IF NOT EXISTS battle_pass_purchases (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL,
        pass_id INTEGER NOT NULL,
        tier TEXT DEFAULT 'free',
        purchased_at TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE(user_id, pass_id)
    )`,
    `CREATE TABLE IF NOT EXISTS battle_pass_progress (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL,
        pass_id INTEGER NOT NULL,
        xp INTEGER DEFAULT 0,
        current_level INTEGER DEFAULT 0,
        last_xp_gain TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE(user_id, pass_id)
    )`,
    `CREATE TABLE IF NOT EXISTS battle_pass_claims (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL,
        pass_id INTEGER NOT NULL,
        level INTEGER NOT NULL,
        tier_claimed TEXT NOT NULL,
        claimed_at TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE(user_id, pass_id, level)
    )`,

    `CREATE TABLE IF NOT EXISTS daily_login_rewards (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id),
        login_date TEXT NOT NULL,
        day_streak INTEGER NOT NULL,
        reward_type TEXT NOT NULL,
        reward_amount INTEGER NOT NULL,
        claimed_at TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE(user_id, login_date)
    )`,

    `CREATE TABLE IF NOT EXISTS slot_races (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        duration_minutes INTEGER DEFAULT 5,
        entry_fee INTEGER DEFAULT 0,
        prize_pool INTEGER DEFAULT 0,
        max_players INTEGER DEFAULT 50,
        status TEXT DEFAULT 'waiting',
        started_at TEXT,
        ends_at TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW()
    )`,

    `CREATE TABLE IF NOT EXISTS slot_race_entries (
        id SERIAL PRIMARY KEY,
        race_id INTEGER NOT NULL,
        user_id INTEGER NOT NULL,
        spins_count INTEGER DEFAULT 0,
        total_wagered INTEGER DEFAULT 0,
        total_won INTEGER DEFAULT 0,
        score INTEGER DEFAULT 0,
        joined_at TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE(race_id, user_id)
    )`,

    `CREATE TABLE IF NOT EXISTS slot_race_results (
        id SERIAL PRIMARY KEY,
        race_id INTEGER NOT NULL,
        user_id INTEGER NOT NULL,
        placement INTEGER,
        score INTEGER,
        prize_gems INTEGER DEFAULT 0,
        prize_credits INTEGER DEFAULT 0,
        claimed_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ DEFAULT NOW()
    )`,

    `CREATE TABLE IF NOT EXISTS deposit_bonuses (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id),
        bonus_type TEXT NOT NULL,
        deposit_amount INTEGER NOT NULL,
        bonus_amount INTEGER NOT NULL,
        bonus_multiplier REAL NOT NULL,
        wagering_requirement INTEGER NOT NULL,
        wagered_so_far INTEGER DEFAULT 0,
        status TEXT DEFAULT 'active',
        created_at TIMESTAMPTZ,
        expires_at TIMESTAMPTZ
    )`,

    `CREATE TABLE IF NOT EXISTS cashback_rewards (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id),
        period_date TEXT NOT NULL,
        total_wagered INTEGER DEFAULT 0,
        total_won INTEGER DEFAULT 0,
        net_loss INTEGER DEFAULT 0,
        cashback_rate REAL DEFAULT 0,
        cashback_amount INTEGER DEFAULT 0,
        status TEXT DEFAULT 'pending',
        claimed_at TEXT,
        created_at TEXT,
        UNIQUE(user_id, period_date)
    )`,

    `CREATE TABLE IF NOT EXISTS loyalty_points (
        id SERIAL PRIMARY KEY,
        user_id INTEGER UNIQUE NOT NULL REFERENCES users(id),
        total_earned INTEGER DEFAULT 0,
        current_balance INTEGER DEFAULT 0,
        lifetime_redeemed INTEGER DEFAULT 0,
        updated_at TIMESTAMPTZ DEFAULT NOW()
    )`,

    `CREATE TABLE IF NOT EXISTS loyalty_transactions (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id),
        type TEXT NOT NULL,
        amount INTEGER NOT NULL,
        description TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW()
    )`,

    `CREATE TABLE IF NOT EXISTS loyalty_store_items (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT,
        cost INTEGER NOT NULL,
        reward_type TEXT NOT NULL,
        reward_value INTEGER NOT NULL,
        category TEXT,
        stock INTEGER DEFAULT -1,
        active INTEGER DEFAULT 1,
        created_at TIMESTAMPTZ DEFAULT NOW()
    )`
];


    // ── Spec §4: Provably Fair Sessions ──
    `CREATE TABLE IF NOT EXISTS player_sessions (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        player_id INTEGER NOT NULL REFERENCES users(id),
        server_seed TEXT NOT NULL,
        server_seed_hash TEXT NOT NULL,
        client_seed TEXT,
        nonce BIGINT DEFAULT 0,
        started_at TIMESTAMPTZ DEFAULT NOW(),
        ended_at TIMESTAMPTZ,
        total_spins INTEGER DEFAULT 0,
        total_wagered_cents BIGINT DEFAULT 0,
        total_won_cents BIGINT DEFAULT 0,
        seed_revealed INTEGER DEFAULT 0
    )`,

    // ── Spec §4: Self-Exclusion (proper schema) ──
    `CREATE TABLE IF NOT EXISTS self_exclusions_v2 (
        id SERIAL PRIMARY KEY,
        player_id INTEGER NOT NULL REFERENCES users(id),
        duration TEXT NOT NULL,
        started_at TIMESTAMPTZ DEFAULT NOW(),
        ends_at TIMESTAMPTZ,
        is_permanent INTEGER DEFAULT 0,
        is_active INTEGER DEFAULT 1,
        created_at TIMESTAMPTZ DEFAULT NOW()
    )`,

    // ── Spec §4: Responsible Gambling Limits ──
    `CREATE TABLE IF NOT EXISTS player_limits (
        id SERIAL PRIMARY KEY,
        player_id INTEGER NOT NULL REFERENCES users(id),
        limit_type TEXT NOT NULL,
        period TEXT NOT NULL,
        amount_cents BIGINT NOT NULL,
        pending_increase_cents BIGINT,
        pending_activates_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE(player_id, limit_type, period)
    )`,

    // ── Spec §3: Blockchain Transaction Log ──
    `CREATE TABLE IF NOT EXISTS chain_transactions (
        id SERIAL PRIMARY KEY,
        player_id INTEGER NOT NULL REFERENCES users(id),
        tx_type TEXT NOT NULL,
        token_amount BIGINT NOT NULL,
        amount_aud NUMERIC(15,2) NOT NULL,
        chain_tx_hash TEXT,
        receipt_token_id INTEGER,
        stripe_payment_id TEXT,
        status TEXT DEFAULT 'pending',
        error_message TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        confirmed_at TIMESTAMPTZ
    )`,
];

const INDEXES = [
    `CREATE INDEX IF NOT EXISTS idx_transactions_user ON transactions(user_id)`,
    `CREATE INDEX IF NOT EXISTS idx_spins_user ON spins(user_id)`,
    `CREATE INDEX IF NOT EXISTS idx_spins_game ON spins(game_id)`,
    `CREATE INDEX IF NOT EXISTS idx_player_sessions_player ON player_sessions(player_id)`,
    `CREATE INDEX IF NOT EXISTS idx_self_exclusions_v2_player ON self_exclusions_v2(player_id, is_active)`,
    `CREATE INDEX IF NOT EXISTS idx_player_limits_player ON player_limits(player_id)`,
    `CREATE INDEX IF NOT EXISTS idx_chain_transactions_player ON chain_transactions(player_id)`,
    `CREATE INDEX IF NOT EXISTS idx_chain_transactions_status ON chain_transactions(status)`,
    `CREATE INDEX IF NOT EXISTS idx_deposits_user ON deposits(user_id)`,
    `CREATE INDEX IF NOT EXISTS idx_withdrawals_user ON withdrawals(user_id)`,
    `CREATE INDEX IF NOT EXISTS idx_payment_methods_user ON payment_methods(user_id)`,
    `CREATE INDEX IF NOT EXISTS idx_jackpot_tier ON jackpot_pool(tier)`    ,
    `CREATE INDEX IF NOT EXISTS idx_tournament_status ON tournaments(status)`,
    `CREATE INDEX IF NOT EXISTS idx_tournament_entries_tid ON tournament_entries(tournament_id)`,
    `CREATE INDEX IF NOT EXISTS idx_tournament_entries_uid ON tournament_entries(user_id)`,
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_users_referral_code ON users(referral_code) WHERE referral_code IS NOT NULL`,
    `CREATE INDEX IF NOT EXISTS idx_spins_wins ON spins(win_amount, created_at)`,
    `CREATE INDEX IF NOT EXISTS idx_achievements_user ON user_achievements(user_id)`,
    `CREATE INDEX IF NOT EXISTS idx_campaigns_active ON campaigns(active, start_at, end_at)`,
    `CREATE INDEX IF NOT EXISTS idx_deposit_campaign_claims_cid ON deposit_campaign_claims(campaign_id)`,
    `CREATE INDEX IF NOT EXISTS idx_deposit_campaign_claims_uid ON deposit_campaign_claims(user_id)`,
    `CREATE INDEX IF NOT EXISTS idx_gifts_to ON gifts(to_user_id, status)`,
    `CREATE INDEX IF NOT EXISTS idx_gifts_from ON gifts(from_user_id)`,
    `CREATE INDEX IF NOT EXISTS idx_contest_entries_rank ON contest_entries(contest_id, metric_type, metric_value DESC)`,
    `CREATE INDEX IF NOT EXISTS idx_contest_prizes_user ON contest_prizes(user_id, claimed)`,
    `CREATE INDEX IF NOT EXISTS idx_contests_status ON contests(status)`,
    `CREATE INDEX IF NOT EXISTS idx_bonus_events_active ON bonus_events(active, start_at, end_at)`,
    `CREATE INDEX IF NOT EXISTS idx_battle_pass_seasons_status ON battle_pass_seasons(status)`,
    `CREATE INDEX IF NOT EXISTS idx_battle_pass_progress_user ON battle_pass_progress(user_id)`,
    `CREATE INDEX IF NOT EXISTS idx_battle_pass_progress_season ON battle_pass_progress(season_id)`,
    `CREATE INDEX IF NOT EXISTS idx_nft_ledger_user ON nft_ledger(user_id)`,
    `CREATE INDEX IF NOT EXISTS idx_nft_ledger_token ON nft_ledger(token_id)`,
    `CREATE INDEX IF NOT EXISTS idx_nft_ledger_type ON nft_ledger(type, created_at)`,
    `CREATE INDEX IF NOT EXISTS idx_deposit_limits_user ON deposit_limits(user_id)`,
    `CREATE INDEX IF NOT EXISTS idx_perf_metrics_collected_at ON perf_metrics(collected_at)`,
    `CREATE INDEX IF NOT EXISTS idx_perf_metrics_url ON perf_metrics(url)`,
    `CREATE INDEX IF NOT EXISTS idx_deposit_bonuses_user ON deposit_bonuses(user_id)`,
    `CREATE INDEX IF NOT EXISTS idx_deposit_bonuses_status ON deposit_bonuses(status, created_at)`,
    // ROUND 46: Critical composite indexes for high-traffic queries.
    `CREATE INDEX IF NOT EXISTS idx_transactions_user_type_date ON transactions(user_id, type, created_at)`,
    `CREATE INDEX IF NOT EXISTS idx_spins_user_date ON spins(user_id, created_at)`,
    `CREATE INDEX IF NOT EXISTS idx_deposits_user_status ON deposits(user_id, status, created_at)`,
    `CREATE INDEX IF NOT EXISTS idx_withdrawals_user_status ON withdrawals(user_id, status, created_at)`,
    `CREATE INDEX IF NOT EXISTS idx_daily_mission_progress_user_date ON daily_mission_progress(user_id, mission_date, completed)`,
    `CREATE INDEX IF NOT EXISTS idx_spins_user_bet ON spins(user_id, bet_amount, win_amount)`
];


/** Extra columns added via migrations (column name → PG definition). */
const USER_MIGRATIONS = [
    ['display_name', 'TEXT'],
    ['avatar_url', 'TEXT'],
    ['phone', 'TEXT'],
    ['date_of_birth', 'TEXT'],
    ['country', 'TEXT'],
    ['currency', "TEXT DEFAULT 'AUD'"],
    ['email_verified', 'INTEGER DEFAULT 0'],
    ['phone_verified', 'INTEGER DEFAULT 0'],
    ['kyc_status', "TEXT DEFAULT 'unverified'"],
    ['updated_at', 'TIMESTAMPTZ'],
    ['stats_json', 'TEXT'],
    ['last_daily_claim', 'TEXT'],
    ['daily_streak', 'INTEGER DEFAULT 0'],
    ['last_wheel_spin', 'TIMESTAMPTZ'],
    ['promo_codes_used', 'TEXT'],
    ['referral_code', 'TEXT'],
    ['referred_by', 'INTEGER'],
    ['referral_bonus_paid', 'INTEGER DEFAULT 0'],
    ['bonus_balance', 'NUMERIC(15,2) DEFAULT 0'],
    ['wagering_requirement', 'NUMERIC(15,2) DEFAULT 0'],
    ['wagering_progress', 'NUMERIC(15,2) DEFAULT 0'],
    ['subscription_active', 'SMALLINT DEFAULT 0'],
    ['subscription_tier', 'VARCHAR(20)'],
    ['subscription_expires', 'TIMESTAMPTZ'],
    ['subscription_daily_claimed', 'DATE'],
    ['xp', 'INTEGER DEFAULT 0'],
    // Birthday bonus
    ['birth_month', 'INTEGER'],
    ['birth_day', 'INTEGER'],
    ['birthday_claimed', 'TEXT'],
    // Daily cashback
    ['cashback_last', 'TEXT'],
    // First deposit bonus
    ['first_deposit_bonus_claimed', 'INTEGER DEFAULT 0'],
    // Free spins
    ['free_spins_count', 'INTEGER DEFAULT 0'],
    ['free_spins_expires', 'TEXT'],
    ['free_spins_last_auto', 'TEXT'],
    // Deposit streak
    ['deposit_streak', 'INTEGER DEFAULT 0'],
    ['deposit_streak_last', 'TEXT'],
    ['deposit_streak_max', 'INTEGER DEFAULT 0'],
    // Deposit match
    ['deposit_match_credits', 'NUMERIC(15,2) DEFAULT 0'],
    ['deposit_match_last', 'TEXT'],
    // Loss streak deposit match offer
    ['loss_streak_offer_last', 'TEXT'],
    // Fortune wheel
    ['fortune_wheel_last', 'TEXT'],
    ['free_spins_remaining', 'INTEGER DEFAULT 0'],
    ['free_spin_state_json', 'TEXT'],
    // Loyalty
    ['loyalty_points', 'INTEGER DEFAULT 0'],
    ['loyalty_lifetime', 'INTEGER DEFAULT 0'],
    // Milestones
    ['milestone_last_claimed', 'INTEGER DEFAULT 0'],
    // Mystery drops
    ['mystery_next_drop', 'INTEGER DEFAULT 0'],
    // Reload bonus
    ['reload_bonus_claimed_at', 'TEXT'],
    ['reload_bonus_count', 'INTEGER DEFAULT 0'],
    // Referral bonus
    ['referral_count', 'INTEGER DEFAULT 0'],
    ['referral_bonus_earned', 'NUMERIC(15,2) DEFAULT 0'],
    // Scratch cards
    ['scratch_last_date', 'TEXT'],
    ['scratch_result', 'TEXT'],
    // Spin streak
    ['spin_streak_count', 'INTEGER DEFAULT 0'],
    ['spin_streak_last', 'TEXT'],
    // Login streak
    ['streak_count', 'INTEGER DEFAULT 0'],
    ['streak_last_date', 'TEXT'],
    // VIP wheel
    ['vip_wheel_last', 'TEXT'],
    ['gems', 'INTEGER DEFAULT 0'],
    // Win streak
    ['win_streak_current', 'INTEGER DEFAULT 0'],
    ['win_streak_max', 'INTEGER DEFAULT 0'],
    // Level-up bonus
    ['last_bonus_level', 'INTEGER DEFAULT 1'],
    // VIP deposit bonus
    ['vip_deposit_claimed', 'TEXT'],
    // Comeback bonus
    ['comeback_bonus_last', 'TEXT'],
    // Daily login rewards calendar
    ['current_streak', 'INTEGER DEFAULT 0'],
    ['last_login_date', 'TEXT'],
];

/** Extra columns added to withdrawals table via migrations (column name → PG definition). */
const WITHDRAWAL_MIGRATIONS = [
    ['otp_code', 'TEXT'],
    ['otp_attempts', 'INTEGER DEFAULT 0'],
];

/** Extra columns added to spins table (provably fair fields). */
const SPIN_MIGRATIONS = [
    ['server_seed', 'TEXT'],
    ['client_seed', 'TEXT'],
    ['nonce', 'BIGINT DEFAULT 0'],
    ['session_id', 'UUID'],
    ['outcome_hash', 'TEXT'],
];

/** Extra columns added to transactions table (blockchain fields). */
const TRANSACTION_MIGRATIONS = [
    ['chain_tx_hash', 'TEXT'],
    ['stripe_payment_id', 'TEXT'],
];

/** Extra columns for users (status, self-exclusion). */
const USER_STATUS_MIGRATIONS = [
    ['status', "TEXT DEFAULT 'active'"],
    ['last_login', 'TIMESTAMPTZ'],
    ['password_hash', 'TEXT'],
];

module.exports = { TABLES, INDEXES, USER_MIGRATIONS, WITHDRAWAL_MIGRATIONS, SPIN_MIGRATIONS, TRANSACTION_MIGRATIONS, USER_STATUS_MIGRATIONS };
