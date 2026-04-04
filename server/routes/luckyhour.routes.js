'use strict';

const router = require('express').Router();

// Lucky Hour windows: 12pm-1pm and 7pm-8pm UTC daily (peak gambling hours)
const LUCKY_WINDOWS = [
    { startHour: 12, endHour: 13 },
    { startHour: 19, endHour: 20 }
];
const LUCKY_MULTIPLIER = 1.5;
const WINDOW_DURATION_MS = 3600000; // 1 hour

/**
 * Find the next Lucky Hour window start time from a given moment.
 * Checks today's remaining windows first, then tomorrow's.
 */
function findNextWindow(now) {
    const currentHour = now.getUTCHours();
    const currentMinutes = now.getUTCMinutes();
    const currentSeconds = now.getUTCSeconds();

    // Check today's windows (any that haven't ended yet)
    for (const w of LUCKY_WINDOWS) {
        if (currentHour < w.startHour) {
            // This window hasn't started yet today
            return new Date(Date.UTC(
                now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(),
                w.startHour, 0, 0, 0
            ));
        }
    }

    // All today's windows have passed — return first window tomorrow
    const tomorrow = new Date(now);
    tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
    return new Date(Date.UTC(
        tomorrow.getUTCFullYear(), tomorrow.getUTCMonth(), tomorrow.getUTCDate(),
        LUCKY_WINDOWS[0].startHour, 0, 0, 0
    ));
}

/**
 * Check if the current time falls within any Lucky Hour window.
 * Returns the active window definition or null.
 */
function getActiveWindow(now) {
    const currentHour = now.getUTCHours();
    for (const w of LUCKY_WINDOWS) {
        if (currentHour >= w.startHour && currentHour < w.endHour) {
            return w;
        }
    }
    return null;
}

// GET /lucky-hour — returns current Lucky Hour status
router.get('/lucky-hour', function (req, res) {
    try {
        const now = new Date();
        const activeWindow = getActiveWindow(now);

        if (activeWindow) {
            // Currently in a Lucky Hour window
            const endsAt = new Date(Date.UTC(
                now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(),
                activeWindow.endHour, 0, 0, 0
            ));

            // Find the next window (after this one ends)
            const afterEnd = new Date(endsAt.getTime() + 1000);
            const nextAt = findNextWindow(afterEnd);

            return res.json({
                active: true,
                multiplier: LUCKY_MULTIPLIER,
                endsAt: endsAt.toISOString(),
                nextAt: nextAt.toISOString()
            });
        }

        // Not in a Lucky Hour — find next upcoming window
        const nextAt = findNextWindow(now);

        return res.json({
            active: false,
            nextAt: nextAt.toISOString()
        });
    } catch (err) {
        return res.status(500).json({ error: 'Internal server error' });
    }
});

module.exports = router;
