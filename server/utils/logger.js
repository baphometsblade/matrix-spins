'use strict';

/**
 * Centralised winston logger for the casino server.
 *
 * Transports:
 *  - Console (always; level driven by LOG_LEVEL or NODE_ENV)
 *  - Daily-rotated file `logs/app-%DATE%.log`         (info+)
 *  - Daily-rotated file `logs/error-%DATE%.log`       (error only)
 *  - Daily-rotated file `logs/audit-%DATE%.log`       (financial/security events)
 *
 * Rotation:
 *  - Files rotate at midnight UTC.
 *  - 30-day retention, 50 MB max per file.
 *
 * Sensitive-field redaction is best-effort; never log raw passwords or tokens.
 */

const path = require('path');
const fs = require('fs');
const winston = require('winston');
require('winston-daily-rotate-file');

const LOG_DIR = process.env.LOG_DIR || path.join(__dirname, '..', '..', 'logs');
try { fs.mkdirSync(LOG_DIR, { recursive: true }); } catch (_) { /* readonly fs (Vercel) — fall back to console only */ }

const isProd = process.env.NODE_ENV === 'production';
const LEVEL = (process.env.LOG_LEVEL || (isProd ? 'info' : 'debug')).toLowerCase();

// Redact secrets from any object passed as metadata.
const REDACT_KEYS = ['password', 'password_hash', 'newPassword', 'currentPassword', 'token', 'jwt', 'authorization', 'cookie', 'apiKey', 'api_key', 'secret', 'card', 'cvv', 'cardNumber', 'ssn'];
function redact(value, depth = 0) {
    if (depth > 6 || value == null) return value;
    if (Array.isArray(value)) return value.map(v => redact(v, depth + 1));
    if (typeof value === 'object') {
        const out = {};
        for (const k of Object.keys(value)) {
            if (REDACT_KEYS.includes(k.toLowerCase())) {
                out[k] = '[REDACTED]';
            } else {
                out[k] = redact(value[k], depth + 1);
            }
        }
        return out;
    }
    return value;
}

const redactFormat = winston.format((info) => {
    if (info && typeof info === 'object') {
        for (const k of Object.keys(info)) {
            if (k === 'level' || k === 'message' || k === 'timestamp') continue;
            info[k] = redact(info[k]);
        }
    }
    return info;
});

const baseFormat = winston.format.combine(
    redactFormat(),
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    winston.format.splat()
);

const consoleFormat = winston.format.combine(
    baseFormat,
    isProd ? winston.format.json() : winston.format.printf(({ timestamp, level, message, stack, ...meta }) => {
        const metaStr = Object.keys(meta).length ? ' ' + JSON.stringify(meta) : '';
        return `[${timestamp}] ${level.toUpperCase()} ${message}${stack ? '\n' + stack : ''}${metaStr}`;
    })
);

const fileFormat = winston.format.combine(baseFormat, winston.format.json());

const transports = [
    new winston.transports.Console({ level: LEVEL, format: consoleFormat, handleExceptions: false }),
];

let auditTransport = null;
let canWriteFiles = false;
try {
    fs.accessSync(LOG_DIR, fs.constants.W_OK);
    canWriteFiles = true;
} catch (_) {
    canWriteFiles = false;
}

if (canWriteFiles) {
    transports.push(new winston.transports.DailyRotateFile({
        level: LEVEL,
        filename: path.join(LOG_DIR, 'app-%DATE%.log'),
        datePattern: 'YYYY-MM-DD',
        zippedArchive: true,
        maxSize: '50m',
        maxFiles: '30d',
        format: fileFormat,
        handleExceptions: false,
    }));
    transports.push(new winston.transports.DailyRotateFile({
        level: 'error',
        filename: path.join(LOG_DIR, 'error-%DATE%.log'),
        datePattern: 'YYYY-MM-DD',
        zippedArchive: true,
        maxSize: '50m',
        maxFiles: '30d',
        format: fileFormat,
        handleExceptions: false,
    }));
    auditTransport = new winston.transports.DailyRotateFile({
        level: 'info',
        filename: path.join(LOG_DIR, 'audit-%DATE%.log'),
        datePattern: 'YYYY-MM-DD',
        zippedArchive: true,
        maxSize: '50m',
        maxFiles: '90d', // longer retention for audit trail
        format: fileFormat,
        handleExceptions: false,
    });
}

const logger = winston.createLogger({
    level: LEVEL,
    transports,
    exitOnError: false,
});

// Dedicated audit logger — uses console + the audit file (info+ only)
const auditTransports = [
    new winston.transports.Console({ level: 'info', format: consoleFormat }),
];
if (auditTransport) auditTransports.push(auditTransport);

const auditLogger = winston.createLogger({
    level: 'info',
    defaultMeta: { channel: 'audit' },
    transports: auditTransports,
    exitOnError: false,
});

logger.audit = auditLogger;
logger.redact = redact;
logger.logDir = LOG_DIR;
logger.canWriteFiles = canWriteFiles;

module.exports = logger;
