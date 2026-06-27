'use strict';

/**
 * Reusable express-validator chains for common casino payloads.
 *
 * Usage:
 *   const { validateLogin, runValidation } = require('../middleware/validators');
 *   router.post('/login', validateLogin, runValidation, handler);
 *
 * The sanitize middleware already strips HTML/encodes entities globally; these
 * validators add *typed* checks (numeric ranges, format strings, enum values)
 * that sanitize cannot do. Together they provide layered defence.
 */

const { body, param, query, validationResult } = require('express-validator');

// 400-on-failure helper. Logs nothing — bad payloads are user error, not server error.
function runValidation(req, res, next) {
    const errors = validationResult(req);
    if (errors.isEmpty()) return next();
    const first = errors.array({ onlyFirstError: true })[0];
    return res.status(400).json({
        error: first ? first.msg : 'Invalid request',
        field: first ? first.path : undefined,
        details: errors.array({ onlyFirstError: true }),
    });
}

const validateRegister = [
    body('username').isString().trim().isLength({ min: 3, max: 20 }).matches(/^[a-zA-Z0-9_]+$/)
        .withMessage('Username must be 3-20 chars (letters, numbers, underscore)'),
    body('email').isEmail().normalizeEmail().isLength({ max: 254 })
        .withMessage('Valid email required'),
    body('password').isString().isLength({ min: 8, max: 128 })
        .withMessage('Password must be 8-128 characters'),
    body('dateOfBirth').isISO8601().withMessage('Date of birth must be ISO date (YYYY-MM-DD)'),
    body('acceptTerms').toBoolean().equals('true').withMessage('Terms acceptance required'),
    body('referralCode').optional({ nullable: true, checkFalsy: true }).isString().isLength({ max: 20 }),
];

const validateLogin = [
    body('username').isString().trim().isLength({ min: 1, max: 254 }).withMessage('Username/email required'),
    body('password').isString().isLength({ min: 1, max: 128 }).withMessage('Password required'),
];

const validateChangePassword = [
    body('currentPassword').isString().isLength({ min: 1, max: 128 }).withMessage('Current password required'),
    body('newPassword').isString().isLength({ min: 8, max: 128 }).withMessage('New password 8-128 chars'),
];

const validateResetPassword = [
    body('token').isString().isLength({ min: 64, max: 64 }).matches(/^[a-f0-9]+$/i).withMessage('Invalid token format'),
    body('newPassword').isString().isLength({ min: 8, max: 128 }).withMessage('New password 8-128 chars'),
];

const validateForgotPassword = [
    body('email').isEmail().normalizeEmail().isLength({ max: 254 }).withMessage('Valid email required'),
];

const validateAmount = (field = 'amount', { min = 0.01, max = 100000 } = {}) => [
    body(field).isFloat({ min, max }).withMessage(`${field} must be between ${min} and ${max}`),
];

// Spin accepts EITHER `bet` (canonical, sent by js/api-client.js) or the
// long-standing legacy alias `betAmount`. The route at spin.routes.js:350
// coalesces both, so the validator must too — otherwise every request that
// sends only `betAmount` (every existing integration test + any client still
// on the legacy field name) gets 400 BEFORE the route's business logic runs,
// which masks self-exclusion (403), wagering caps, and over-draw checks
// behind a misleading "bet must be 0.01-1000" message.
const validateSpin = [
    body('gameId').optional().isString().isLength({ max: 64 }),
    body('bet').optional().isFloat({ min: 0.01, max: 1000 }).withMessage('bet must be 0.01-1000'),
    body('betAmount').optional().isFloat({ min: 0.01, max: 1000 }).withMessage('betAmount must be 0.01-1000'),
    body().custom((_value, { req }) => {
        const b = req.body && req.body.bet;
        const ba = req.body && req.body.betAmount;
        if (b === undefined && ba === undefined) {
            throw new Error('bet amount is required');
        }
        return true;
    }),
    body('lines').optional().isInt({ min: 1, max: 100 }),
];

const validateDeposit = [
    body('amount').isFloat({ min: 1, max: 25000 }).withMessage('Deposit must be $1-$25,000'),
    body('paymentType').optional().isIn(['stripe', 'card', 'crypto', 'bitcoin', 'eth', 'usdc']),
    body('paymentMethodId').optional().isString().isLength({ max: 200 }),
];

const validateWithdraw = [
    body('amount').isFloat({ min: 10, max: 50000 }).withMessage('Withdrawal must be $10-$50,000'),
    body('method').optional().isIn(['stripe', 'crypto', 'bitcoin', 'eth', 'usdc', 'bank']),
    body('address').optional().isString().isLength({ max: 200 }),
];

// Promo-code redemption. The route uppercases + slices to 32 chars after this,
// but validating up-front gives a clean 400 (and blocks junk before bonusGuard's
// self-exclusion/cap DB reads run). Codes are alphanumeric + dash/underscore.
const validatePromoRedeem = [
    body('code').isString().trim().isLength({ min: 1, max: 32 })
        .matches(/^[A-Za-z0-9_-]+$/).withMessage('Invalid promo code format'),
];

// Profile update — every field is optional (partial update). Mirrors the inline
// checks in profile.routes.js PUT /me as a typed first line of defence.
const validateProfileUpdate = [
    body('displayName').optional({ nullable: true }).isString().isLength({ max: 30 })
        .withMessage('Display name must be ≤ 30 chars'),
    body('bio').optional({ nullable: true }).isString().isLength({ max: 280 })
        .withMessage('Bio must be ≤ 280 chars'),
    body('avatarId').optional({ nullable: true }).isString().isLength({ max: 40 }),
    body('profileVisibility').optional().isIn(['public', 'friends', 'private'])
        .withMessage('Invalid profile visibility'),
    body('showOnLeaderboard').optional().isBoolean(),
    body('showActivityFeed').optional().isBoolean(),
];

const validateIdParam = [
    param('id').isInt({ min: 1, max: 2147483647 }).withMessage('Invalid id'),
];

const validatePagination = [
    query('limit').optional().isInt({ min: 1, max: 200 }).toInt(),
    query('offset').optional().isInt({ min: 0, max: 1000000 }).toInt(),
    query('page').optional().isInt({ min: 1, max: 100000 }).toInt(),
];

module.exports = {
    runValidation,
    validateRegister,
    validateLogin,
    validateChangePassword,
    validateResetPassword,
    validateForgotPassword,
    validateAmount,
    validateSpin,
    validateDeposit,
    validateWithdraw,
    validatePromoRedeem,
    validateProfileUpdate,
    validateIdParam,
    validatePagination,
};
