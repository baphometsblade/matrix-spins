/**
 * Session Insights API — Sprint 219
 * 
 * Provides server-side session analytics that the client can poll for
 * personalized insights. No auth required (uses localStorage user data
 * on the client side as fallback).
 * 
 * GET /api/session-insights/:userId
 *   Returns computed insights based on recent spin history.
 * 
 * POST /api/session-insights/log
 *   Logs a session summary for analytics (fire-and-forget from client).
 */

const express = require('express');
const router = express.Router();

// In-memory session log (not persisted — ephemeral analytics)
const sessionLogs = new Map(); // userId -> [{ ...sessionData }]
const MAX_LOGS_PER_USER = 50;
const SESSION_LOG_STALE_MS = 2 * 60 * 60 * 1000; // 2h (was 24h — too long for memory safety)

// Prune inactive users every 10 minutes to prevent unbounded Map growth
setInterval(function pruneSessionLogs() {
    var now = Date.now();
    var pruned = 0;
    for (var [uid, logs] of sessionLogs) {
        if (!logs.length) { sessionLogs.delete(uid); pruned++; continue; }
        var lastEntry = logs[logs.length - 1];
        if (now - lastEntry.timestamp > SESSION_LOG_STALE_MS) {
            sessionLogs.delete(uid);
            pruned++;
        }
    }
    if (pruned > 0) console.warn('[SessionInsights] Pruned ' + pruned + ' stale user logs');
}, 10 * 60 * 1000);

// POST /api/session-insights/log — client pushes session summary
router.post('/session-insights/log', express.json(), (req, res) => {
    try {
        const { userId, gameId, spins, wins, totalWagered, totalWon, biggestWin, duration } = req.body;
        if (!userId || !gameId) {
            return res.status(400).json({ error: 'userId and gameId required' });
        }

        const entry = {
            gameId,
            spins: Number(spins) || 0,
            wins: Number(wins) || 0,
            totalWagered: Number(totalWagered) || 0,
            totalWon: Number(totalWon) || 0,
            biggestWin: Number(biggestWin) || 0,
            duration: Number(duration) || 0,
            timestamp: Date.now()
        };

        if (!sessionLogs.has(userId)) sessionLogs.set(userId, []);
        const logs = sessionLogs.get(userId);
        logs.push(entry);
        if (logs.length > MAX_LOGS_PER_USER) logs.shift();

        res.json({ ok: true, totalSessions: logs.length });
    } catch (err) {
        res.status(500).json({ error: 'Internal error' });
    }
});

// GET /api/session-insights/:userId — returns computed insights
router.get('/session-insights/:userId', (req, res) => {
    try {
        const { userId } = req.params;
        const logs = sessionLogs.get(userId) || [];

        if (logs.length === 0) {
            return res.json({
                totalSessions: 0,
                insights: [],
                recommendation: 'Play some games to get personalized insights!'
            });
        }

        // Compute aggregate stats
        let totalSpins = 0, totalWins = 0, totalWagered = 0, totalWon = 0;
        let biggestWin = 0, totalDuration = 0;
        const gameCounts = {};

        for (const log of logs) {
            totalSpins += log.spins;
            totalWins += log.wins;
            totalWagered += log.totalWagered;
            totalWon += log.totalWon;
            if (log.biggestWin > biggestWin) biggestWin = log.biggestWin;
            totalDuration += log.duration;
            gameCounts[log.gameId] = (gameCounts[log.gameId] || 0) + 1;
        }

        const winRate = totalSpins > 0 ? (totalWins / totalSpins * 100).toFixed(1) : 0;
        const rtp = totalWagered > 0 ? (totalWon / totalWagered * 100).toFixed(1) : 0;
        const avgSessionLen = (totalDuration / logs.length / 60).toFixed(1); // minutes

        // Find favorite game
        let favGame = null, favCount = 0;
        for (const [gid, count] of Object.entries(gameCounts)) {
            if (count > favCount) { favCount = count; favGame = gid; }
        }

        // Build insights
        const insights = [];
        insights.push(`Win rate: ${winRate}% across ${totalSpins} spins`);
        insights.push(`Session RTP: ${rtp}%`);
        insights.push(`Biggest win: $${biggestWin.toFixed(2)}`);
        if (favGame) insights.push(`Favorite game: ${favGame} (${favCount} sessions)`);
        insights.push(`Avg session: ${avgSessionLen} min`);

        // Recommendation
        let recommendation;
        if (Number(rtp) >= 95) recommendation = 'You\'re running hot! Consider setting a win target.';
        else if (Number(rtp) >= 85) recommendation = 'Solid session performance. Stay disciplined!';
        else if (Number(rtp) >= 70) recommendation = 'Below average returns. Try switching games for variety.';
        else recommendation = 'Tough variance streak. Consider taking a break or lowering bets.';

        res.json({
            totalSessions: logs.length,
            stats: { totalSpins, totalWins, totalWagered, totalWon, biggestWin, winRate, rtp, avgSessionLen },
            favoriteGame: favGame,
            insights,
            recommendation
        });
    } catch (err) {
        res.status(500).json({ error: 'Internal error' });
    }
});

module.exports = router;
