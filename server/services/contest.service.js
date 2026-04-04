'use strict';

const db = require('../database');
const config = require('../config');

const VALID_METRICS = ['spins', 'biggest_win', 'total_wagered'];

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Returns the Monday 00:00 UTC and Sunday 23:59:59 UTC for the week
 * containing the given date.
 */
function getWeekBounds(date) {
    const d = new Date(date);
    const day = d.getUTCDay(); // 0=Sun, 1=Mon, ...
    const diffToMonday = day === 0 ? -6 : 1 - day;

    const monday = new Date(Date.UTC(
        d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + diffToMonday,
        0, 0, 0, 0
    ));

    const sunday = new Date(Date.UTC(
        monday.getUTCFullYear(), monday.getUTCMonth(), monday.getUTCDate() + 6,
        23, 59, 59, 999
    ));

    return {
        start: monday.toISOString().replace('T', ' ').slice(0, 19),
        end: sunday.toISOString().replace('T', ' ').slice(0, 19)
    };
}

// ── Core functions ───────────────────────────────────────────────────────────

/**
 * Returns the current week's contest, creating one if it does not exist.
 */
async function getOrCreateCurrentContest() {
    const bounds = getWeekBounds(new Date());

    const existing = await db.get(
        "SELECT id, week_start, week_end, status FROM contests WHERE week_start = ? AND status = 'active'",
        [bounds.start]
    );
    if (existing) return existing;

    await db.run(
        "INSERT OR IGNORE INTO contests (week_start, week_end, status) VALUES (?, ?, 'active')",
        [bounds.start, bounds.end]
    );

    const contest = await db.get(
        "SELECT id, week_start, week_end, status FROM contests WHERE week_start = ? AND status = 'active'",
        [bounds.start]
    );
    return contest;
}

/**
 * Upserts the user's metric value for the current contest.
 *
 * - 'spins': adds metricValue to the running total
 * - 'biggest_win': keeps the maximum value
 * - 'total_wagered': adds metricValue to the running total
 */
async function recordContestEntry(userId, metricType, metricValue) {
    if (!VALID_METRICS.includes(metricType)) return;
    if (!metricValue || metricValue <= 0) return;

    const contest = await getOrCreateCurrentContest();
    if (!contest) return;

    if (metricType === 'biggest_win') {
        // Only update if the new value is larger than the existing one
        // Uses ON CONFLICT UPSERT (works on both SQLite 3.24+ and PostgreSQL)
        await db.run(
            `INSERT INTO contest_entries (contest_id, user_id, metric_type, metric_value, updated_at)
             VALUES (?, ?, ?, ?, datetime('now'))
             ON CONFLICT(contest_id, user_id, metric_type)
             DO UPDATE SET metric_value = CASE
                 WHEN excluded.metric_value > contest_entries.metric_value
                 THEN excluded.metric_value
                 ELSE contest_entries.metric_value END,
                 updated_at = datetime('now')`,
            [contest.id, userId, metricType, metricValue]
        );
    } else {
        // Accumulate: add to existing value
        await db.run(
            `INSERT INTO contest_entries (contest_id, user_id, metric_type, metric_value, updated_at)
             VALUES (?, ?, ?, ?, datetime('now'))
             ON CONFLICT(contest_id, user_id, metric_type)
             DO UPDATE SET metric_value = metric_value + ?, updated_at = datetime('now')`,
            [contest.id, userId, metricType, metricValue, metricValue]
        );
    }
}

/**
 * Returns the ranked leaderboard for a specific metric in a contest.
 */
async function getLeaderboard(contestId, metricType, limit) {
    if (!VALID_METRICS.includes(metricType)) return [];

    const cap = Math.min(limit || 25, 100);
    const rows = await db.all(
        `SELECT ce.user_id, ce.metric_value, u.username, u.display_name
         FROM contest_entries ce
         JOIN users u ON ce.user_id = u.id
         WHERE ce.contest_id = ? AND ce.metric_type = ?
         ORDER BY ce.metric_value DESC
         LIMIT ?`,
        [contestId, metricType, cap]
    );

    return rows.map(function (row, index) {
        return {
            rank: index + 1,
            userId: row.user_id,
            username: row.username,
            displayName: row.display_name || row.username,
            value: row.metric_value
        };
    });
}

/**
 * Returns the user's rank and value for a specific metric in a contest.
 */
async function getUserRank(contestId, userId, metricType) {
    if (!VALID_METRICS.includes(metricType)) return null;

    const entry = await db.get(
        'SELECT metric_value FROM contest_entries WHERE contest_id = ? AND user_id = ? AND metric_type = ?',
        [contestId, userId, metricType]
    );
    if (!entry) return { rank: null, value: 0 };

    const countAbove = await db.get(
        `SELECT COUNT(*) as cnt FROM contest_entries
         WHERE contest_id = ? AND metric_type = ? AND metric_value > ?`,
        [contestId, metricType, entry.metric_value]
    );

    return {
        rank: (countAbove ? countAbove.cnt : 0) + 1,
        value: entry.metric_value
    };
}

/**
 * Finalizes a contest by awarding prizes to the top players across all
 * metric types. Marks the contest as finalized so it cannot be awarded twice.
 */
async function finalizeContest(contestId) {
    const contest = await db.get('SELECT id, week_start, week_end, status, finalized_at FROM contests WHERE id = ?', [contestId]);
    if (!contest) return { error: 'Contest not found' };
    if (contest.status === 'finalized') return { error: 'Contest already finalized' };

    const prizes = config.CONTESTS.PRIZES;
    const wageringMult = config.CONTESTS.PRIZE_WAGERING;
    const defaultMetric = config.CONTESTS.DEFAULT_METRIC;

    const leaderboard = await getLeaderboard(contestId, defaultMetric, 25);
    const awarded = [];

    for (const entry of leaderboard) {
        const prizeAmount = prizes[entry.rank];
        if (!prizeAmount || prizeAmount <= 0) continue;

        // Award as bonus_balance with wagering requirement
        const wageringReq = prizeAmount * wageringMult;

        try {
            await db.run(
                `UPDATE users SET bonus_balance = bonus_balance + ?,
                     wagering_requirement = wagering_requirement + ?
                 WHERE id = ?`,
                [prizeAmount, wageringReq, entry.userId]
            );

            await db.run(
                `INSERT INTO contest_prizes (contest_id, user_id, rank, metric_type, prize_amount)
                 VALUES (?, ?, ?, ?, ?)`,
                [contestId, entry.userId, entry.rank, defaultMetric, prizeAmount]
            );

            const user = await db.get('SELECT balance, bonus_balance FROM users WHERE id = ?', [entry.userId]);
            await db.run(
                `INSERT INTO transactions (user_id, type, amount, balance_before, balance_after, reference)
                 VALUES (?, 'contest_prize', ?, ?, ?, ?)`,
                [entry.userId, prizeAmount, user ? user.balance : 0, user ? user.balance : 0,
                    'contest:' + contestId + ':rank' + entry.rank]
            );

            awarded.push({
                userId: entry.userId,
                username: entry.username,
                rank: entry.rank,
                prize: prizeAmount,
                wagering: wageringReq
            });
        } catch (e) {
            console.warn('[Contest] Prize award error for user', entry.userId, ':', e.message);
        }
    }

    await db.run(
        "UPDATE contests SET status = 'finalized', finalized_at = datetime('now') WHERE id = ?",
        [contestId]
    );

    return { finalized: true, awardsCount: awarded.length, awards: awarded };
}

/**
 * Returns unclaimed contest prizes for a user.
 */
async function getUserPrizes(userId) {
    const rows = await db.all(
        `SELECT cp.id, cp.contest_id, cp.rank, cp.metric_type, cp.prize_amount, cp.claimed, cp.created_at,
                c.week_start, c.week_end
         FROM contest_prizes cp
         JOIN contests c ON cp.contest_id = c.id
         WHERE cp.user_id = ?
         ORDER BY cp.created_at DESC`,
        [userId]
    );
    return rows;
}

/**
 * Checks for any active contests whose week_end has passed and finalizes them.
 * Called periodically (e.g. on a timer or at contest access time).
 */
async function checkAndFinalizeExpired() {
    const expired = await db.all(
        "SELECT id FROM contests WHERE status = 'active' AND week_end < datetime('now')"
    );
    for (const contest of expired) {
        try {
            await finalizeContest(contest.id);
        } catch (e) {
            console.warn('[Contest] Auto-finalize error for contest', contest.id, ':', e.message);
        }
    }
}

module.exports = {
    getOrCreateCurrentContest,
    recordContestEntry,
    getLeaderboard,
    getUserRank,
    finalizeContest,
    getUserPrizes,
    checkAndFinalizeExpired,
    VALID_METRICS
};
