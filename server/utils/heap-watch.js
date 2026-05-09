'use strict';

/**
 * Heap-watch — periodic memory sampler with leak detection.
 *
 * Logs heap snapshots every HEAP_WATCH_INTERVAL_MS and warns when heap
 * usage rises by HEAP_WATCH_GROWTH_MB across a rolling window. Caller
 * should invoke `start(logger)` once during boot.
 */

const SAMPLE_WINDOW = 6; // keep 6 samples → 30 min default window
const samples = [];
let timer = null;

function snapshot() {
    const m = process.memoryUsage();
    return {
        ts: Date.now(),
        rss: m.rss,
        heapUsed: m.heapUsed,
        heapTotal: m.heapTotal,
        external: m.external,
        arrayBuffers: m.arrayBuffers || 0,
    };
}

function mb(bytes) { return Math.round(bytes / 1048576); }

function start(logger) {
    const interval = parseInt(process.env.HEAP_WATCH_INTERVAL_MS, 10);
    if (!Number.isFinite(interval) || interval <= 0) return null; // disabled
    const growthMb = parseInt(process.env.HEAP_WATCH_GROWTH_MB, 10) || 50;

    const log = logger || console;
    const tick = () => {
        try {
            const s = snapshot();
            samples.push(s);
            while (samples.length > SAMPLE_WINDOW) samples.shift();

            const meta = {
                rssMB: mb(s.rss),
                heapUsedMB: mb(s.heapUsed),
                heapTotalMB: mb(s.heapTotal),
                externalMB: mb(s.external),
            };
            log.info && log.info(`[heap] rss=${meta.rssMB}MB heapUsed=${meta.heapUsedMB}MB heapTotal=${meta.heapTotalMB}MB`, meta);

            if (samples.length === SAMPLE_WINDOW) {
                const first = samples[0];
                const last = samples[samples.length - 1];
                const growth = mb(last.heapUsed - first.heapUsed);
                if (growth >= growthMb) {
                    log.warn && log.warn(`[heap] possible leak — heapUsed grew ${growth}MB across last ${SAMPLE_WINDOW} samples`, {
                        startMB: mb(first.heapUsed),
                        endMB: mb(last.heapUsed),
                        windowMs: last.ts - first.ts,
                    });
                }
            }
        } catch (err) {
            (log.error || log.warn || console.error)('[heap] sampler error: ' + err.message);
        }
    };

    // Take a baseline immediately so trends form quickly
    tick();
    timer = setInterval(tick, interval);
    if (timer.unref) timer.unref();
    return timer;
}

function stop() {
    if (timer) { clearInterval(timer); timer = null; }
    samples.length = 0;
}

function getSamples() {
    return samples.slice();
}

module.exports = { start, stop, snapshot, getSamples };
