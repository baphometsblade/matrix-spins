'use strict';

/**
 * Prometheus-compatible metrics middleware.
 *
 * Counters / histograms / gauges are exposed at /api/metrics in the
 * standard text exposition format. Falls back to a hand-rolled exporter
 * if `prom-client` isn't installed (so the server still boots).
 *
 * Tracked:
 *   - http_requests_total{method,route,status}      counter
 *   - http_request_duration_seconds{method,route}   histogram
 *   - http_requests_in_flight                       gauge
 *   - http_request_errors_total{method,route}       counter
 *   - process_*  +  nodejs_*                        defaults
 */

let promClient = null;
try {
    promClient = require('prom-client');
} catch (_) {
    promClient = null;
}

const fallback = {
    counters: new Map(), // key -> count
    histograms: new Map(), // key -> { sum, count, buckets: { le: count } }
    inFlight: 0,
};
const HIST_BUCKETS_S = [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10];

let registry = null;
let httpRequestsTotal = null;
let httpRequestDurationSeconds = null;
let httpRequestsInFlight = null;
let httpRequestErrorsTotal = null;

function init() {
    if (!promClient) return;
    registry = new promClient.Registry();
    promClient.collectDefaultMetrics({ register: registry, prefix: 'casino_' });

    httpRequestsTotal = new promClient.Counter({
        name: 'http_requests_total',
        help: 'Total HTTP requests',
        labelNames: ['method', 'route', 'status'],
        registers: [registry],
    });
    httpRequestDurationSeconds = new promClient.Histogram({
        name: 'http_request_duration_seconds',
        help: 'HTTP request duration in seconds',
        labelNames: ['method', 'route'],
        buckets: HIST_BUCKETS_S,
        registers: [registry],
    });
    httpRequestsInFlight = new promClient.Gauge({
        name: 'http_requests_in_flight',
        help: 'In-flight HTTP requests',
        registers: [registry],
    });
    httpRequestErrorsTotal = new promClient.Counter({
        name: 'http_request_errors_total',
        help: 'HTTP requests with status >= 500',
        labelNames: ['method', 'route'],
        registers: [registry],
    });
}
init();

function normalizeRoute(req) {
    if (req.route && req.baseUrl != null) {
        // Express resolved a route — gives the parameter-shape we want
        const tail = req.route.path === '/' ? '' : req.route.path;
        return (req.baseUrl || '') + tail || req.path;
    }
    // Collapse high-cardinality IDs in the raw path
    return req.path
        .replace(/\/(\d+)(?=\/|$)/g, '/:id')
        .replace(/\/[a-f0-9]{16,}/gi, '/:hash');
}

function fallbackInc(map, key, by = 1) {
    map.set(key, (map.get(key) || 0) + by);
}
function fallbackObserve(key, value) {
    let h = fallback.histograms.get(key);
    if (!h) {
        h = { sum: 0, count: 0, buckets: {} };
        for (const b of HIST_BUCKETS_S) h.buckets[b] = 0;
        fallback.histograms.set(key, h);
    }
    h.sum += value;
    h.count += 1;
    for (const b of HIST_BUCKETS_S) if (value <= b) h.buckets[b] += 1;
}

function metricsMiddleware() {
    return function (req, res, next) {
        // Skip metrics scrape itself, static assets, and the lightweight ping
        if (req.path === '/api/metrics' || req.path === '/api/health/ping') return next();
        if (!req.path.startsWith('/api/')) return next();

        const start = process.hrtime.bigint();
        if (promClient) httpRequestsInFlight.inc();
        else fallback.inFlight++;

        res.on('finish', () => {
            const durSec = Number(process.hrtime.bigint() - start) / 1e9;
            const route = normalizeRoute(req);
            const labels = { method: req.method, route, status: String(res.statusCode) };

            if (promClient) {
                httpRequestsTotal.inc(labels);
                httpRequestDurationSeconds.observe({ method: req.method, route }, durSec);
                httpRequestsInFlight.dec();
                if (res.statusCode >= 500) httpRequestErrorsTotal.inc({ method: req.method, route });
            } else {
                fallbackInc(fallback.counters, `http_requests_total|${req.method}|${route}|${res.statusCode}`);
                fallbackObserve(`${req.method}|${route}`, durSec);
                fallback.inFlight = Math.max(0, fallback.inFlight - 1);
                if (res.statusCode >= 500) {
                    fallbackInc(fallback.counters, `http_request_errors_total|${req.method}|${route}`);
                }
            }
        });

        next();
    };
}

async function exposition(_req, res) {
    res.setHeader('Content-Type', 'text/plain; version=0.0.4; charset=utf-8');
    if (promClient) {
        try {
            res.end(await registry.metrics());
        } catch (err) {
            res.status(500).end(`# error rendering metrics: ${err.message}\n`);
        }
        return;
    }
    // Hand-rolled fallback
    const lines = [];
    lines.push('# HELP http_requests_total Total HTTP requests');
    lines.push('# TYPE http_requests_total counter');
    for (const [k, v] of fallback.counters) {
        const [name, method, route, status] = k.split('|');
        if (name !== 'http_requests_total') continue;
        lines.push(`http_requests_total{method="${method}",route="${route}",status="${status}"} ${v}`);
    }
    lines.push('# HELP http_request_errors_total HTTP responses with status >= 500');
    lines.push('# TYPE http_request_errors_total counter');
    for (const [k, v] of fallback.counters) {
        const [name, method, route] = k.split('|');
        if (name !== 'http_request_errors_total') continue;
        lines.push(`http_request_errors_total{method="${method}",route="${route}"} ${v}`);
    }
    lines.push('# HELP http_request_duration_seconds HTTP request duration');
    lines.push('# TYPE http_request_duration_seconds histogram');
    for (const [k, h] of fallback.histograms) {
        const [method, route] = k.split('|');
        for (const b of HIST_BUCKETS_S) {
            lines.push(`http_request_duration_seconds_bucket{method="${method}",route="${route}",le="${b}"} ${h.buckets[b]}`);
        }
        lines.push(`http_request_duration_seconds_bucket{method="${method}",route="${route}",le="+Inf"} ${h.count}`);
        lines.push(`http_request_duration_seconds_sum{method="${method}",route="${route}"} ${h.sum}`);
        lines.push(`http_request_duration_seconds_count{method="${method}",route="${route}"} ${h.count}`);
    }
    lines.push('# HELP http_requests_in_flight In-flight HTTP requests');
    lines.push('# TYPE http_requests_in_flight gauge');
    lines.push(`http_requests_in_flight ${fallback.inFlight}`);

    const mem = process.memoryUsage();
    lines.push('# HELP nodejs_heap_used_bytes Process heap used (bytes)');
    lines.push('# TYPE nodejs_heap_used_bytes gauge');
    lines.push(`nodejs_heap_used_bytes ${mem.heapUsed}`);
    lines.push('# HELP nodejs_heap_total_bytes Process heap total (bytes)');
    lines.push('# TYPE nodejs_heap_total_bytes gauge');
    lines.push(`nodejs_heap_total_bytes ${mem.heapTotal}`);
    lines.push('# HELP nodejs_rss_bytes Process resident set size (bytes)');
    lines.push('# TYPE nodejs_rss_bytes gauge');
    lines.push(`nodejs_rss_bytes ${mem.rss}`);
    lines.push('# HELP process_uptime_seconds Process uptime in seconds');
    lines.push('# TYPE process_uptime_seconds gauge');
    lines.push(`process_uptime_seconds ${process.uptime()}`);

    res.end(lines.join('\n') + '\n');
}

module.exports = { metricsMiddleware, exposition, hasPromClient: !!promClient };
