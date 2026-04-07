const express = require('express');
const router = express.Router();
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { mintOnDeposit } = require('../blockchain/mint');
const { burnOnWithdrawal } = require('../blockchain/burn');
const db = require('../database');
const { validateRequest, validateAmount, validateUserId } = require('../middleware/validation');
const { logTransaction } = require('../utils/audit-log');

/**
 * Generate a unique reference number for player-facing communication
 * @param {string} type - 'deposit' or 'withdrawal'
 * @returns {string} Reference number (RSC-XXXXX or RSW-XXXXX)
 */
function generateReferenceNumber(type) {
  const prefix = type === 'deposit' ? 'RSC' : 'RSW';
  const timestamp = Date.now().toString().slice(-5);
  const random = Math.random().toString(36).substring(2, 7).toUpperCase();
  return `${prefix}-${timestamp}${random}`;
}

/**
 * POST /api/deposit
 * Process a deposit via Stripe with silent blockchain integration
 *
 * Request body:
 * - amount: number (cents, e.g., 5000 = $50.00)
 * - paymentMethodId: string (Stripe payment method ID)
 * - userId: string
 *
 * Response: { success: true, balance: string, referenceNumber: string }
 */
router.post('/deposit', validateRequest, async (req, res) => {
  const { amount, paymentMethodId, userId } = req.body;

  try {
    // Validate inputs
    if (!validateAmount(amount)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid deposit amount'
      });
    }

    if (!validateUserId(userId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid user ID'
      });
    }

    if (!paymentMethodId) {
      return res.status(400).json({
        success: false,
        message: 'Payment method is required'
      });
    }

    // Create Stripe PaymentIntent
    const paymentIntent = await stripe.paymentIntents.create({
      amount: amount,
      currency: 'usd',
      payment_method: paymentMethodId,
      confirm: true,
      return_url: `${process.env.BASE_URL}/deposit-complete`
    });

    // Check if payment succeeded
    if (paymentIntent.status !== 'succeeded') {
      logTransaction({
        type: 'deposit_failed',
        userId,
        amount,
        stripePaymentIntentId: paymentIntent.id,
        reason: paymentIntent.status
      });

      return res.status(400).json({
        success: false,
        message: 'Payment processing failed. Please try again.'
      });
    }

    const referenceNumber = generateReferenceNumber('deposit');
    const amountInDollars = amount / 100;

    // Attempt blockchain mint (non-blocking - fire and forget with retry)
    mintOnDeposit(userId, amount, paymentIntent.id)
      .catch((error) => {
        // Log blockchain failure internally
        console.error(`[BLOCKCHAIN] Mint failed for deposit ${referenceNumber}:`, error.message);
        logTransaction({
          type: 'mint_failed_retry',
          userId,
          amount,
          paymentIntentId: paymentIntent.id,
          referenceNumber,
          error: error.message
        });
        // TODO: Implement background retry mechanism
      });

    // Update user balance in database
    const updatedBalance = await db.user.addBalance(userId, amountInDollars);

    // Log successful transaction
    logTransaction({
      type: 'deposit_success',
      userId,
      amount: amountInDollars,
      paymentIntentId: paymentIntent.id,
      referenceNumber
    });

    return res.json({
      success: true,
      balance: `$${updatedBalance.toFixed(2)}`,
      referenceNumber
    });
  } catch (error) {
    console.error('[DEPOSIT] Error processing deposit:', error.message);

    logTransaction({
      type: 'deposit_error',
      userId: req.body.userId,
      error: error.message
    });

    return res.status(500).json({
      success: false,
      message: 'Deposit processing encountered an error. Please contact support.'
    });
  }
});

/**
 * POST /api/withdraw
 * Process a withdrawal with silent blockchain integration
 *
 * Request body:
 * - amount: number (dollars, e.g., 50.00)
 * - userId: string
 *
 * Response: { success: true, message: string, referenceNumber: string }
 */
router.post('/withdraw', validateRequest, async (req, res) => {
  const { amount, userId } = req.body;

  try {
    // Validate inputs
    if (!validateAmount(amount * 100)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid withdrawal amount'
      });
    }

    if (!validateUserId(userId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid user ID'
      });
    }

    // Check user balance
    const user = await db.user.getById(userId);
    if (!user || user.balance < amount) {
      logTransaction({
        type: 'withdrawal_insufficient_balance',
        userId,
        requestedAmount: amount,
        currentBalance: user?.balance || 0
      });

      return res.status(400).json({
        success: false,
        message: 'Insufficient balance for this withdrawal'
      });
    }

    const referenceNumber = generateReferenceNumber('withdrawal');
    const amountInCents = Math.floor(amount * 100);

    // Attempt blockchain burn (must succeed before payout)
    let blockchainTxHash;
    try {
      blockchainTxHash = await burnOnWithdrawal(userId, amountInCents);
    } catch (burnError) {
      console.error(`[BLOCKCHAIN] Burn failed for withdrawal ${referenceNumber}:`, burnError.message);

      logTransaction({
        type: 'withdrawal_burn_failed',
        userId,
        amount,
        referenceNumber,
        error: burnError.message
      });

      // Hold withdrawal in pending state - do NOT deduct balance yet
      await db.withdrawal.create({
        userId,
        amount,
        referenceNumber,
        status: 'pending_blockchain',
        stripePayoutId: null,
        blockchainTxHash: null,
        createdAt: new Date()
      });

      // TODO: Implement background retry for blockchain burn
      return res.status(202).json({
        success: true,
        message: `Withdrawal of $${amount.toFixed(2)} is being processed.`,
        referenceNumber
      });
    }

    // Blockchain burn succeeded - now trigger Stripe payout
    let stripePayoutId;
    try {
      // Retrieve user's connected Stripe account or payment method
      const userPaymentInfo = await db.user.getPaymentInfo(userId);

      const payout = await stripe.payouts.create({
        amount: amountInCents,
        currency: 'usd',
        destination: userPaymentInfo.stripeAccountId || userPaymentInfo.paymentMethodId
      });

      stripePayoutId = payout.id;
    } catch (payoutError) {
      console.error(`[STRIPE] Payout failed for withdrawal ${referenceNumber}:`, payoutError.message);

      logTransaction({
        type: 'withdrawal_payout_failed',
        userId,
        amount,
        referenceNumber,
        blockchainTxHash,
        error: payoutError.message
      });

      // Blockchain succeeded but payout failed - hold in pending state
      await db.withdrawal.create({
        userId,
        amount,
        referenceNumber,
        status: 'pending_payout',
        stripePayoutId: null,
        blockchainTxHash,
        createdAt: new Date()
      });

      // TODO: Implement background retry for payout
      return res.status(202).json({
        success: true,
        message: `Withdrawal of $${amount.toFixed(2)} is being processed.`,
        referenceNumber
      });
    }

    // Both blockchain and payout succeeded - deduct balance
    const updatedBalance = await db.user.subtractBalance(userId, amount);

    // Record completed withdrawal
    await db.withdrawal.create({
      userId,
      amount,
      referenceNumber,
      status: 'completed',
      stripePayoutId,
      blockchainTxHash,
      createdAt: new Date()
    });

    logTransaction({
      type: 'withdrawal_success',
      userId,
      amount,
      referenceNumber,
      stripePayoutId,
      blockchainTxHash
    });

    return res.json({
      success: true,
      message: `Withdrawal of $${amount.toFixed(2)} is being processed.`,
      referenceNumber
    });
  } catch (error) {
    console.error('[WITHDRAW] Error processing withdrawal:', error.message);

    logTransaction({
      type: 'withdrawal_error',
      userId: req.body.userId,
      error: error.message
    });

    return res.status(500).json({
      success: false,
      message: 'Withdrawal processing encountered an error. Please contact support.'
    });
  }
});

/**
 * GET /api/balance/:userId
 * Retrieve user's current balance
 *
 * Response: { balance: string }
 */
router.get('/balance/:userId', async (req, res) => {
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

    // Optionally verify against on-chain balance (non-blocking)
    // This is fire-and-forget for audit purposes
    db.blockchain
      .verifyBalance(userId, user.balance)
      .catch((error) => {
        console.warn(`[AUDIT] Balance verification mismatch for user ${userId}:`, error.message);
      });

    return res.json({
      balance: `$${user.balance.toFixed(2)}`
    });
  } catch (error) {
    console.error('[BALANCE] Error retrieving balance:', error.message);

    return res.status(500).json({
      success: false,
      message: 'Unable to retrieve balance. Please try again.'
    });
  }
});

/**
 * POST /api/deposit/webhook
 * Stripe webhook handler for deposit status updates
 *
 * Verifies Stripe signature and handles:
 * - payment_intent.succeeded
 * - payment_intent.payment_failed
 */
router.post('/deposit/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  const sig = req.headers['stripe-signature'];
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  let event;

  try {
    event = stripe.webhooks.constructEvent(req.body, sig, webhookSecret);
  } catch (error) {
    console.error('[WEBHOOK] Stripe signature verification failed:', error.message);
    return res.sendStatus(400);
  }

  try {
    switch (event.type) {
      case 'payment_intent.succeeded': {
        const paymentIntent = event.data.object;

        // Retrieve and update deposit record
        const deposit = await db.deposit.getByPaymentIntentId(paymentIntent.id);
        if (deposit) {
          await db.deposit.update(deposit.id, {
            status: 'completed',
            confirmedAt: new Date()
          });

          logTransaction({
            type: 'webhook_deposit_confirmed',
            paymentIntentId: paymentIntent.id,
            userId: deposit.userId,
            amount: paymentIntent.amount / 100
          });
        }
        break;
      }

      case 'payment_intent.payment_failed': {
        const paymentIntent = event.data.object;

        // Retrieve and mark deposit as failed
        const deposit = await db.deposit.getByPaymentIntentId(paymentIntent.id);
        if (deposit) {
          await db.deposit.update(deposit.id, {
            status: 'failed',
            failureReason: paymentIntent.last_payment_error?.message,
            failedAt: new Date()
          });

          logTransaction({
            type: 'webhook_deposit_failed',
            paymentIntentId: paymentIntent.id,
            userId: deposit.userId,
            amount: paymentIntent.amount / 100,
            reason: paymentIntent.last_payment_error?.message
          });
        }
        break;
      }

      default:
        // Unhandled event type
        console.log(`[WEBHOOK] Unhandled event type: ${event.type}`);
    }

    return res.sendStatus(200);
  } catch (error) {
    console.error('[WEBHOOK] Error processing webhook:', error.message);

    logTransaction({
      type: 'webhook_error',
      eventType: event.type,
      error: error.message
    });

    return res.sendStatus(500);
  }
});

module.exports = router;
