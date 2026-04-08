const express = require('express');
const router = express.Router();
const db = require('../database');
const rng = require('../utils/server-rng');
const gameEngine = require('../engine/game-engine');
const { validateRequest, validateUserId, validateAmount } = require('../middleware/validation');
const { logTransaction } = require('../utils/audit-log');

/**
 * POST /api/spin
 * Execute a single spin with server-side RNG and payout calculation
 *
 * Request body:
 * - userId: string
 * - gameId: string
 * - betAmount: number (dollars, e.g., 10.00)
 *
 * Response: {
 *   grid: array (final spin result),
 *   winAmount: number,
 *   balance: string,
 *   sessionStats: { spins, wagered, won, biggestWin }
 * }
 */
router.post('/spin', validateRequest, async (req, res) => {
  const { userId, gameId, betAmount } = req.body;
  const betInCents = Math.floor(betAmount * 100);

  try {
    // Validate inputs
    if (!validateUserId(userId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid user ID'
      });
    }

    if (!gameId || typeof gameId !== 'string') {
      return res.status(400).json({
        success: false,
        message: 'Invalid game ID'
      });
    }

    if (!validateAmount(betInCents)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid bet amount'
      });
    }

    // Enforce minimum and maximum bet limits
    const MIN_BET = 0.01;
    const MAX_BET = 10000.00;

    if (betAmount < MIN_BET || betAmount > MAX_BET) {
      return res.status(400).json({
        success: false,
        message: `Bet amount must be between $${MIN_BET.toFixed(2)} and $${MAX_BET.toFixed(2)}`
      });
    }

    // Retrieve user and check balance
    const user = await db.user.getById(userId);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    if (user.balance < betAmount) {
      return res.status(400).json({
        success: false,
        message: 'Insufficient balance for this bet'
      });
    }

    // Retrieve game configuration
    const game = await db.game.getById(gameId);
    if (!game) {
      return res.status(404).json({
        success: false,
        message: 'Game not found'
      });
    }

    // Deduct bet from balance
    let currentBalance = await db.user.subtractBalance(userId, betAmount);

    // Generate spin result using server-side RNG
    const spinSeed = rng.generateSeed(userId, gameId, Date.now());
    const grid = gameEngine.generateSpinResult(gameId, spinSeed);

    // Calculate payout based on game rules and result
    const { winAmount, payoutMultiplier } = gameEngine.calculatePayout(
      gameId,
      grid,
      betAmount
    );

    // Add payout to balance if win
    if (winAmount > 0) {
      currentBalance = await db.user.addBalance(userId, winAmount);
    }

    // Create game round record for audit trail
    const round = await db.gameRound.create({
      userId,
      gameId,
      betAmount,
      spinSeed,
      grid: JSON.stringify(grid),
      winAmount,
      payoutMultiplier,
      resultingBalance: currentBalance,
      createdAt: new Date()
    });

    // Update session statistics
    const session = await db.session.getOrCreate(userId);
    const updatedSession = await db.session.update(session.id, {
      spins: session.spins + 1,
      wagered: session.wagered + betAmount,
      won: session.won + winAmount,
      biggestWin: Math.max(session.biggestWin, winAmount),
      lastGameId: gameId,
      lastSpinAt: new Date()
    });

    // Log transaction
    logTransaction({
      type: 'spin_result',
      userId,
      gameId,
      betAmount,
      winAmount,
      payoutMultiplier,
      resultingBalance: currentBalance,
      roundId: round.id,
      spinSeed: spinSeed // Store seed for audit/replay
    });

    return res.json({
      success: true,
      grid,
      winAmount,
      balance: `$${currentBalance.toFixed(2)}`,
      sessionStats: {
        spins: updatedSession.spins,
        wagered: `$${updatedSession.wagered.toFixed(2)}`,
        won: `$${updatedSession.won.toFixed(2)}`,
        biggestWin: `$${updatedSession.biggestWin.toFixed(2)}`
      }
    });
  } catch (error) {
    console.error('[SPIN] Error processing spin:', error.message);

    logTransaction({
      type: 'spin_error',
      userId: req.body.userId,
      gameId: req.body.gameId,
      error: error.message
    });

    return res.status(500).json({
      success: false,
      message: 'Spin processing encountered an error. Please try again.'
    });
  }
});

/**
 * GET /api/session/:userId
 * Retrieve current session statistics for the user
 *
 * Response: {
 *   sessionStats: {
 *     spins: number,
 *     wagered: string,
 *     won: string,
 *     biggestWin: string,
 *     sessionStartedAt: string (ISO 8601),
 *     lastGameId: string,
 *     lastSpinAt: string (ISO 8601)
 *   }
 * }
 */
router.get('/session/:userId', async (req, res) => {
  const { userId } = req.params;

  try {
    if (!validateUserId(userId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid user ID'
      });
    }

    const user = await db.user.getById(userId);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // Retrieve or create session
    const session = await db.session.getOrCreate(userId);

    return res.json({
      success: true,
      sessionStats: {
        spins: session.spins,
        wagered: `$${session.wagered.toFixed(2)}`,
        won: `$${session.won.toFixed(2)}`,
        biggestWin: `$${session.biggestWin.toFixed(2)}`,
        sessionStartedAt: session.createdAt.toISOString(),
        lastGameId: session.lastGameId,
        lastSpinAt: session.lastSpinAt ? session.lastSpinAt.toISOString() : null
      }
    });
  } catch (error) {
    console.error('[SESSION] Error retrieving session:', error.message);

    logTransaction({
      type: 'session_error',
      userId,
      error: error.message
    });

    return res.status(500).json({
      success: false,
      message: 'Unable to retrieve session. Please try again.'
    });
  }
});

/**
 * POST /api/session/:userId/reset
 * Reset session statistics (admin/internal only)
 * Typically called at end of day or when user requests session reset
 *
 * Response: { success: true, sessionStats: {...} }
 */
router.post('/session/:userId/reset', async (req, res) => {
  const { userId } = req.params;

  try {
    if (!validateUserId(userId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid user ID'
      });
    }

    const session = await db.session.getOrCreate(userId);

    // Store previous session stats for audit
    logTransaction({
      type: 'session_reset',
      userId,
      previousStats: {
        spins: session.spins,
        wagered: session.wagered,
        won: session.won,
        biggestWin: session.biggestWin
      }
    });

    // Reset session
    const resetSession = await db.session.reset(session.id);

    return res.json({
      success: true,
      sessionStats: {
        spins: resetSession.spins,
        wagered: `$${resetSession.wagered.toFixed(2)}`,
        won: `$${resetSession.won.toFixed(2)}`,
        biggestWin: `$${resetSession.biggestWin.toFixed(2)}`,
        sessionStartedAt: resetSession.createdAt.toISOString()
      }
    });
  } catch (error) {
    console.error('[SESSION] Error resetting session:', error.message);

    logTransaction({
      type: 'session_reset_error',
      userId,
      error: error.message
    });

    return res.status(500).json({
      success: false,
      message: 'Unable to reset session. Please contact support.'
    });
  }
});

/**
 * GET /api/game/:gameId
 * Retrieve game metadata and configuration
 *
 * Response: {
 *   gameId: string,
 *   name: string,
 *   studio: string,
 *   paylines: number,
 *   minBet: number,
 *   maxBet: number,
 *   rtp: number (as percentage, e.g., 96.5)
 * }
 */
router.get('/game/:gameId', async (req, res) => {
  const { gameId } = req.params;

  try {
    const game = await db.game.getById(gameId);
    if (!game) {
      return res.status(404).json({
        success: false,
        message: 'Game not found'
      });
    }

    return res.json({
      success: true,
      game: {
        gameId: game.id,
        name: game.name,
        studio: game.studio,
        paylines: game.paylines,
        minBet: game.minBet,
        maxBet: game.maxBet,
        rtp: game.rtp
      }
    });
  } catch (error) {
    console.error('[GAME] Error retrieving game:', error.message);

    return res.status(500).json({
      success: false,
      message: 'Unable to retrieve game information.'
    });
  }
});

module.exports = router;
