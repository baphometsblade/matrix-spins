/**
 * Browser-side currency formatting helpers — keeps display consistent across
 * the casino UI. All money is AUD.
 *
 *   window.formatAud(1234.5)        → 'AUD 1,234.50'
 *   window.formatAudCompact(1234.5) → '$1,234.50'
 *   window.formatNumber(1234)       → '1,234'
 */
(function () {
    'use strict';

    const CURRENCY = 'AUD';
    const LOCALE   = 'en-AU';

    function formatAud(value) {
        const n = Number(value);
        if (!Number.isFinite(n)) return 'AUD 0.00';
        return CURRENCY + ' ' + n.toLocaleString(LOCALE, {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2,
        });
    }

    function formatAudCompact(value) {
        const n = Number(value);
        if (!Number.isFinite(n)) return '$0.00';
        return '$' + n.toLocaleString(LOCALE, {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2,
        });
    }

    function formatNumber(value) {
        const n = Number(value);
        if (!Number.isFinite(n)) return '0';
        return n.toLocaleString(LOCALE);
    }

    function formatAudShort(value) {
        const n = Number(value);
        if (!Number.isFinite(n)) return '$0';
        if (Math.abs(n) >= 1_000_000) return '$' + (n / 1_000_000).toFixed(1) + 'M';
        if (Math.abs(n) >= 10_000)    return '$' + (n / 1_000).toFixed(1) + 'K';
        return formatAudCompact(n);
    }

    window.formatAud        = formatAud;
    window.formatAudCompact = formatAudCompact;
    window.formatAudShort   = formatAudShort;
    window.formatNumber     = formatNumber;
    window.AUD_CURRENCY     = CURRENCY;
    window.AUD_LOCALE       = LOCALE;
})();
