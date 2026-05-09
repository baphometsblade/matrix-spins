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

const validateSpin = [
    body('gameId').optional().isString().isLength({ max: 64 }),
    body('bet').isFloat({ min: 0.01, max: 1000 }).withMessage('bet must be 0.01-1000'),
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
    validateIdParam,
    validatePagination,
};
