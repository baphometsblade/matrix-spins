'use strict';

const express = require('express');
const config = require('../config');
const db = require('../database');

const router = express.Router();
const BOOT_AT = Date.now();

router.get('/', async (_req, res) => {
    const out = {
        status: 'ok',
        env: config.NODE_ENV,
        database: db.kind || 'initializing',
        stripe: config.hasStripe ? 'configured' : 'missing',
        webhookSecret: config.hasWebhookSecret ? 'configured' : 'missing',
        smtp: config.hasSmtp ? 'configured' : 'missing',
        time: new Date().toISOString(),
        uptime_seconds: Math.round((Date.now() - BOOT_AT) / 1000),
        memory_mb: Math.round(process.memoryUsage().rss / (1024 * 1024)),
        node_version: process.version,
    };

    // DB ping with measured latency. If the DB doesn't answer, we
    // return 503 so Render's health check fails over.
    const t0 = Date.now();
    try {
        await db.get('SELECT 1 AS ok');
        out.db_ping_ms = Date.now() - t0;
    } catch (err) {
        out.db_ping_ms = Date.now() - t0;
        out.db_error = err.message;
        return res.status(503).json(Object.assign({}, out, { status: 'db_down' }));
    }

    // Lightweight counts and reconciler status — useful for ops dashboards.
    try {
        const userRow = await db.get('SELECT COUNT(*) AS n FROM users');
        const depRow = await db.get(`SELECT COUNT(*) AS n FROM deposits WHERE status = 'paid'`);
        const eventRow = await db.get('SELECT COUNT(*) AS n FROM processed_webhook_events');
        out.users = Number(userRow && userRow.n) || 0;
        out.paid_deposits = Number(depRow && depRow.n) || 0;
        out.webhook_events_processed = Number(eventRow && eventRow.n) || 0;
    } catch (err) {
        // Counts are best-effort; missing them does not fail the check.
        out.counts_error = err.message;
    }
    try {
        const reconciler = require('./reconciler-status');
        out.reconciler = reconciler.snapshot();
    } catch (err) {
        out.reconciler = { error: err.message };
    }

    res.json(out);
});

module.exports = router;
