'use strict';

/**
 * Centralised currency formatting for the casino.
 *
 * All money in this codebase is AUD. Use these helpers wherever an amount
 * is rendered (logs, emails, receipts, API responses) so the format is
 * consistent and the currency code is never lost.
 *
 *   formatAud(1234.5)         → 'AUD 1,234.50'
 *   formatAudCompact(1234.5)  → '$1,234.50'
 *   formatNumber(1234)        → '1,234'
 *   parseAud('AUD 1,234.50')  → 1234.5
 */

const CURRENCY = 'AUD';
const LOCALE = 'en-AU';

function formatAud(value) {
    const n = Number(value);
    if (!Number.isFinite(n)) return 'AUD 0.00';
    return `${CURRENCY} ${n.toLocaleString(LOCALE, {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
    })}`;
}

function formatAudCompact(value) {
    const n = Number(value);
    if (!Number.isFinite(n)) return '$0.00';
    return `$${n.toLocaleString(LOCALE, {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
    })}`;
}

function formatNumber(value) {
    const n = Number(value);
    if (!Number.isFinite(n)) return '0';
    return n.toLocaleString(LOCALE);
}

function parseAud(input) {
    if (typeof input === 'number') return input;
    if (!input) return 0;
    const cleaned = String(input).replace(/[A-Za-z$,\s]/g, '');
    const n = parseFloat(cleaned);
    return Number.isFinite(n) ? n : 0;
}

function asCents(value) {
    const n = Number(value);
    if (!Number.isFinite(n)) return 0;
    return Math.round(n * 100);
}

function fromCents(cents) {
    const n = Number(cents);
    if (!Number.isFinite(n)) return 0;
    return Math.round(n) / 100;
}

module.exports = {
    CURRENCY,
    LOCALE,
    formatAud,
    formatAudCompact,
    formatNumber,
    parseAud,
    asCents,
    fromCents,
};
