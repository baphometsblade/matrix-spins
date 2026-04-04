/**
 * RTP (Return to Player) Monitoring Service
 *
 * Tracks actual payout ratios per game per day and alerts when RTP drifts
 * beyond configured tolerance. Industry standard for regulated slots.
 */
const db = require('../database');

var _tableReady = false;

async function ensureTable() {
    if (_tableReady) return;
    try {
        await db.run(`
            CREATE TABLE IF NOT EXISTS rtp_daily_stats (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                game_id TEXT NOT NULL,
                date TEXT NOT NULL,
                total_bets REAL DEFAULT 0,
                total_wins REAL DEFAULT 0,
                spin_count INTEGER DEFAULT 0,
                UNIQUE(game_id, date)
            )
        `);
        _tableReady = true;
    } catch (_) { _tableReady = true; }
}

/**
 * Record a spin result for RTP tracking (fire-and-forget, never blocks spin)
 */
async function recordSpin(gameId, betAmount, winAmount) {
    await ensureTable();
    var today = new Date().toISOString().slice(0, 10);
    try {
        await db.run(
            "INSERT INTO rtp_daily_stats (game_id, date, total_bets, total_wins, spin_count) " +
            "VALUES (?, ?, ?, ?, 1) " +
            "ON CONFLICT(game_id, date) DO UPDATE SET " +
            "total_bets = rtp_daily_stats.total_bets + excluded.total_bets, " +
            "total_wins = rtp_daily_stats.total_wins + excluded.total_wins, " +
            "spin_count = rtp_daily_stats.spin_count + 1",
            [gameId, today, betAmount, winAmount]
        );
    } catch (err) {
        console.warn('[RTP Monitor] Record error:', err.message);
    }
}

/**
 * Calculate actual RTP for a game over the last N days
 */
async function getGameRTP(gameId, days) {
    days = days || 7;
    await ensureTable();
    try {
        var row = await db.get(
            "SELECT SUM(total_bets) as wagered, SUM(total_wins) as paid, SUM(spin_count) as spins " +
            "FROM rtp_daily_stats WHERE game_id = ? AND date >= date('now', '-' || ? || ' days')",
            [gameId, days]
        );
        if (!row || !row.wagered || row.wagered === 0) {
            return { gameId: gameId, actualRTP: 0, totalSpins: 0, period: days + 'd' };
        }
        return {
            gameId: gameId,
            actualRTP: parseFloat(((row.paid / row.wagered) * 100).toFixed(2)),
            totalWagered: row.wagered,
            totalPaid: row.paid,
            totalSpins: row.spins,
            period: days + 'd'
        };
    } catch (err) {
        console.warn('[RTP Monitor] Query error:', err.message);
        return { gameId: gameId, actualRTP: 0, totalSpins: 0, period: days + 'd' };
    }
}

/**
 * Check if RTP has drifted beyond tolerance. Logs an alert if so.
 * Called probabilistically (~1% of spins) to avoid overhead.
 */
async function checkDrift(gameId, configuredRTP, tolerancePct) {
    tolerancePct = tolerancePct || 3;
    var stats = await getGameRTP(gameId, 7);
    if (stats.totalSpins < 200) return { drifted: false }; // Not enough data
    var drift = Math.abs(stats.actualRTP - configuredRTP);
    if (drift > tolerancePct) {
        console.error(JSON.stringify({
            ts: new Date().toISOString(),
            level: 'error',
            event: 'rtp_drift',
            game: gameId,
            configured: configuredRTP,
            actual: stats.actualRTP,
            drift: parseFloat(drift.toFixed(2)),
            spins: stats.totalSpins
        }));
        return { drifted: true, drift: drift, stats: stats };
    }
    return { drifted: false, drift: drift, stats: stats };
}

module.exports = { recordSpin: recordSpin, getGameRTP: getGameRTP, checkDrift: checkDrift };
