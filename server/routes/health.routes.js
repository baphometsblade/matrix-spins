'use strict';

const express = require('express');
const config = require('../config');
const db = require('../database');

const router = express.Router();

router.get('/', async (_req, res) => {
    const out = {
        status: 'ok',
        env: config.NODE_ENV,
        database: db.kind || 'initializing',
        stripe: config.hasStripe ? 'configured' : 'missing',
        webhookSecret: config.hasWebhookSecret ? 'configured' : 'missing',
        time: new Date().toISOString(),
    };
    try {
        await db.get('SELECT 1 AS ok');
        out.dbPing = 'ok';
    } catch (err) {
        out.dbPing = 'error: ' + err.message;
        return res.status(503).json(out);
    }
    res.json(out);
});

module.exports = router;
