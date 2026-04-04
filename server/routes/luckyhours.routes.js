'use strict';

const router = require('express').Router();

function getWindowsForDate(dateStr) {
  // dateStr: 'YYYY-MM-DD'
  const dateHash = parseInt(dateStr.replace(/-/g, ''), 10);
  const windowBHour = Math.floor(dateHash % 10) + 8; // 8..17 range (offset 0-9 + 8)

  const [year, month, day] = dateStr.split('-').map(Number);

  // Window A: always 20:00–21:00 UTC
  const windowA = new Date(Date.UTC(year, month - 1, day, 20, 0, 0, 0));

  // Window B: rotating hour
  const windowB = new Date(Date.UTC(year, month - 1, day, windowBHour, 0, 0, 0));

  return [windowA, windowB];
}

function getTodayUTC() {
  return new Date().toISOString().slice(0, 10);
}

function getWindowsForToday() {
  return getWindowsForDate(getTodayUTC());
}

function getWindowsForTomorrow() {
  const now = new Date();
  const tomorrow = new Date(Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate() + 1
  ));
  const tomorrowStr = tomorrow.toISOString().slice(0, 10);
  return getWindowsForDate(tomorrowStr);
}

router.get('/status', function (req, res) {
  try {
    const now = new Date();
    const WINDOW_DURATION_MS = 3600000; // 1 hour in ms
    const MULTIPLIER = 2;
    const LABEL = '2\u00d7 Gems';

    const todayWindows = getWindowsForToday();
    const tomorrowWindows = getWindowsForTomorrow();

    // Check if currently active in any window
    let activeWindow = null;
    for (const w of todayWindows) {
      const windowEnd = new Date(w.getTime() + WINDOW_DURATION_MS);
      if (now >= w && now < windowEnd) {
        activeWindow = w;
        break;
      }
    }

    if (activeWindow !== null) {
      const endsAt = new Date(activeWindow.getTime() + WINDOW_DURATION_MS);

      // Find next non-active window: remaining windows today or first tomorrow
      const futureWindows = todayWindows
        .filter(function (w) { return w !== activeWindow; })
        .concat(tomorrowWindows)
        .filter(function (w) { return w.getTime() > now.getTime(); })
        .sort(function (a, b) { return a.getTime() - b.getTime(); });

      const nextWindowAt = futureWindows.length > 0 ? futureWindows[0] : tomorrowWindows[0];

      return res.json({
        active: true,
        multiplier: MULTIPLIER,
        label: LABEL,
        endsAt: endsAt.toISOString(),
        nextWindowAt: nextWindowAt.toISOString(),
        nextLabel: LABEL
      });
    }

    // Not active — find next upcoming window
    const allFutureWindows = todayWindows
      .concat(tomorrowWindows)
      .filter(function (w) { return w.getTime() > now.getTime(); })
      .sort(function (a, b) { return a.getTime() - b.getTime(); });

    const nextWindowAt = allFutureWindows.length > 0 ? allFutureWindows[0] : tomorrowWindows[0];

    return res.json({
      active: false,
      multiplier: MULTIPLIER,
      label: LABEL,
      endsAt: null,
      nextWindowAt: nextWindowAt.toISOString(),
      nextLabel: LABEL
    });
  } catch (err) {
    return res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
