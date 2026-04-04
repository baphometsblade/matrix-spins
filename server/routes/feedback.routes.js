'use strict';

const express = require('express');
const router = express.Router();
const db = require('../database');
const { authenticate } = require('../middleware/auth');

var isPg = !!process.env.DATABASE_URL;
var idDef = isPg ? 'SERIAL PRIMARY KEY' : 'INTEGER PRIMARY KEY AUTOINCREMENT';
var tsDef = isPg ? 'TIMESTAMPTZ DEFAULT NOW()' : "TEXT DEFAULT (datetime('now'))";

/**
 * Bootstrap game_ratings table if it doesn't exist.
 * Called during server startup.
 */
async function initFeedbackTable() {
    try {
        const sql = `
            CREATE TABLE IF NOT EXISTS game_ratings (
                id ${idDef},
                user_id INTEGER NOT NULL,
                game_id TEXT NOT NULL,
                rating INTEGER NOT NULL CHECK(rating BETWEEN 1 AND 5),
                review TEXT,
                created_at ${tsDef},
                UNIQUE(user_id, game_id)
            )
        `;
        await db.run(sql);
        console.warn('[Feedback] game_ratings table initialized');
    } catch (err) {
        console.warn('[Feedback] Failed to initialize game_ratings table:', err.message);
    }
}

/**
 * POST /api/feedback/rate
 * Authenticated endpoint to submit or update a game rating.
 *
 * Request body:
 *   {
 *     gameId: string (required),
 *     rating: number (1-5, required),
 *     review: string (optional)
 *   }
 */
router.post('/rate', authenticate, async (req, res) => {
    try {
        const { gameId, rating, review } = req.body;
        const userId = req.user.id;

        // Validate inputs
        if (!gameId) {
            return res.status(400).json({ error: 'gameId is required' });
        }
        if (rating === undefined || rating === null) {
            return res.status(400).json({ error: 'rating is required' });
        }
        if (typeof rating !== 'number' || rating < 1 || rating > 5) {
            return res.status(400).json({ error: 'rating must be a number between 1 and 5' });
        }

        // Sanitize review if provided
        let sanitizedReview = null;
        if (review && typeof review === 'string') {
            sanitizedReview = review.trim().substring(0, 1000); // Max 1000 chars
        }

        // Upsert: insert or update
        const sql = `
            INSERT INTO game_ratings (user_id, game_id, rating, review)
            VALUES (?, ?, ?, ?)
            ON CONFLICT(user_id, game_id) DO UPDATE SET
                rating = excluded.rating,
                review = excluded.review,
                created_at = datetime('now')
        `;

        await db.run(sql, [userId, gameId, rating, sanitizedReview]);

        res.json({
            success: true,
            message: 'Rating submitted successfully',
            gameId,
            rating,
            review: sanitizedReview
        });
    } catch (err) {
        console.warn('[Feedback] POST /rate error:', err.message);
        res.status(500).json({ error: 'Failed to submit rating' });
    }
});

/**
 * GET /api/feedback/game/:gameId
 * Public endpoint to retrieve aggregate rating stats for a game.
 *
 * Returns:
 *   {
 *     gameId: string,
 *     averageRating: number (0-5, or null if no ratings),
 *     totalRatings: number,
 *     distribution: { 1: count, 2: count, 3: count, 4: count, 5: count },
 *     userRating: number | null (only if user is authenticated)
 *   }
 */
router.get('/game/:gameId', async (req, res) => {
    try {
        const { gameId } = req.params;

        // Get aggregate stats
        const statsRow = await db.get(`
            SELECT
                COUNT(*) as total_ratings,
                AVG(rating) as avg_rating
            FROM game_ratings
            WHERE game_id = ?
        `, [gameId]);

        const totalRatings = parseInt(statsRow?.total_ratings) || 0;
        const averageRating = totalRatings > 0 ? parseFloat(statsRow?.avg_rating) : null;

        // Get distribution (count by rating value)
        const distRows = await db.all(`
            SELECT rating, COUNT(*) as count
            FROM game_ratings
            WHERE game_id = ?
            GROUP BY rating
            ORDER BY rating ASC
        `, [gameId]);

        const distribution = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
        distRows.forEach(row => {
            distribution[row.rating] = parseInt(row.count);
        });

        // Get user's own rating if authenticated
        let userRating = null;
        if (req.user && req.user.id) {
            const userRow = await db.get(`
                SELECT rating
                FROM game_ratings
                WHERE user_id = ? AND game_id = ?
            `, [req.user.id, gameId]);
            userRating = userRow ? parseInt(userRow.rating) : null;
        }

        res.json({
            gameId,
            averageRating: averageRating ? Math.round(averageRating * 10) / 10 : null,
            totalRatings,
            distribution,
            userRating
        });
    } catch (err) {
        console.warn('[Feedback] GET /game/:gameId error:', err.message);
        res.status(500).json({ error: 'Failed to load game ratings' });
    }
});

/**
 * GET /api/feedback/top-rated
 * Public endpoint to retrieve top-rated games.
 *
 * Query params:
 *   limit: number (default 10, max 100)
 *
 * Returns:
 *   {
 *     topGames: [
 *       { gameId, averageRating, totalRatings },
 *       ...
 *     ]
 *   }
 */
router.get('/top-rated', async (req, res) => {
    try {
        let limit = Math.min(parseInt(req.query.limit) || 10, 100);
        if (isNaN(limit) || limit < 1) limit = 10;

        const rows = await db.all(`
            SELECT
                game_id,
                COUNT(*) as total_ratings,
                AVG(rating) as avg_rating
            FROM game_ratings
            GROUP BY game_id
            HAVING COUNT(*) >= 3
            ORDER BY avg_rating DESC, total_ratings DESC
            LIMIT ?
        `, [limit]);

        const topGames = rows.map(row => ({
            gameId: row.game_id,
            averageRating: Math.round(parseFloat(row.avg_rating) * 10) / 10,
            totalRatings: parseInt(row.total_ratings)
        }));

        res.json({ topGames });
    } catch (err) {
        console.warn('[Feedback] GET /top-rated error:', err.message);
        res.status(500).json({ error: 'Failed to load top-rated games' });
    }
});

// Table initialization deferred to server startup (see server/index.js)

module.exports = router;
module.exports.bootstrapFeedbackTable = initFeedbackTable;
