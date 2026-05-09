#!/usr/bin/env node
/**
 * scripts/monitor.js — Standalone uptime monitor
 *
 * Polls /api/health/ping and /api/health/ready on the target URL,
 * logs structured status, and posts to ALERT_WEBHOOK_URL on failure.
 *
 * Run locally:        npm run monitor
 * Run in CI / cron:   MONITOR_TARGET_URL=https://msaart.online node scripts/monitor.js --once
 *
 * Env:
 *   MONITOR_TARGET_URL   target host (required)
 *   MONITOR_INTERVAL_MS  poll interval (default 60_000)
 *   ALERT_WEBHOOK_URL    Slack/Discord webhook for failures (optional)
 */
'use strict';

require('dotenv').config();

const https = require('https');
const http = require('http');
const { URL } = require('url');

const TARGET = process.env.MONITOR_TARGET_URL || 'http://127.0.0.1:3000';
const INTERVAL = parseInt(process.env.MONITOR_INTERVAL_MS, 10) || 60_000;
const ALERT_URL = process.env.ALERT_WEBHOOK_URL || null;
const ONCE = process.argv.includes('--once');
const TIMEOUT_MS = 10_000;

function fetchJson(url) {
    return new Promise((resolve, reject) => {
        const u = new URL(url);
        const lib = u.protocol === 'https:' ? https : http;
        const start = Date.now();
        const req = lib.get(
            u,
            { timeout: TIMEOUT_MS, headers: { accept: 'application/json', 'user-agent': 'matrix-spins-monitor/1.0' } },
            (res) => {
                let body = '';
                res.on('data', (c) => (body += c));
                res.on('end', () => {
                    const ms = Date.now() - start;
                    let parsed = null;
                    try { parsed = body ? JSON.parse(body) : null; } catch (_) { /* keep null */ }
                    resolve({ status: res.statusCode, ms, body: parsed, raw: body });
                });
            }
        );
        req.on('timeout', () => { req.destroy(new Error('timeout')); });
        req.on('error', reject);
    });
}

async function postAlert(message, payload) {
    if (!ALERT_URL) return;
    try {
        const u = new URL(ALERT_URL);
        const lib = u.protocol === 'https:' ? https : http;
        const data = JSON.stringify({ text: message, payload });
        await new Promise((resolve, reject) => {
            const req = lib.request(
                u,
                { method: 'POST', headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(data) }, timeout: 5_000 },
                (res) => { res.on('data', () => {}); res.on('end', resolve); }
            );
            req.on('error', reject);
            req.on('timeout', () => req.destroy(new Error('alert webhook timeout')));
            req.write(data);
            req.end();
        });
    } catch (err) {
        console.error('[monitor] alert webhook failed:', err.message);
    }
}

function fmt(obj) {
    return JSON.stringify(obj);
}

async function tick() {
    const stamp = new Date().toISOString();
    const ping = await fetchJson(`${TARGET}/api/health/ping`).catch((e) => ({ error: e.message }));
    const ready = await fetchJson(`${TARGET}/api/health/ready`).catch((e) => ({ error: e.message }));

    const pingOk = ping && ping.status === 200;
    const readyOk = ready && ready.status === 200;
    const overall = pingOk && readyOk ? 'ok' : (pingOk ? 'degraded' : 'down');

    console.log(fmt({
        ts: stamp,
        target: TARGET,
        overall,
        ping: { ok: pingOk, ms: ping.ms || null, status: ping.status || null, error: ping.error || null },
        ready: {
            ok: readyOk,
            ms: ready.ms || null,
            status: ready.status || null,
            db: ready.body && ready.body.checks ? ready.body.checks.db : null,
            error: ready.error || null,
        },
    }));

    if (overall !== 'ok') {
        await postAlert(
            `🚨 Matrix Spins ${overall.toUpperCase()} — ${TARGET}`,
            { ts: stamp, overall, ping, ready }
        );
    }
    return overall;
}

async function main() {
    if (ONCE) {
        const status = await tick();
        process.exit(status === 'ok' ? 0 : 1);
    }
    console.log(`[monitor] Watching ${TARGET} every ${INTERVAL}ms — Ctrl+C to stop.`);
    await tick();
    setInterval(() => { tick().catch((e) => console.error('[monitor] tick error:', e.message)); }, INTERVAL);
}

main().catch((err) => {
    console.error('[monitor] FATAL:', err.message);
    process.exit(1);
});
