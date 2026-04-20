'use strict';

const express = require('express');
const { authenticate } = require('../middleware/auth');
const nftService = require('../services/nft.service');

const router = express.Router();

router.get('/', authenticate, async (req, res) => {
    try {
        const items = await nftService.listForUser(req.user.id);
        res.json({ nfts: items });
    } catch (err) {
        console.error('[nft/list]', err);
        res.status(500).json({ error: 'Failed to fetch NFTs.' });
    }
});

router.get('/:tokenId', authenticate, async (req, res) => {
    try {
        const list = await nftService.listForUser(req.user.id);
        const nft = list.find(n => n.tokenId === req.params.tokenId);
        if (!nft) return res.status(404).json({ error: 'NFT not found.' });
        res.json({ nft });
    } catch (err) {
        console.error('[nft/get]', err);
        res.status(500).json({ error: 'Failed to fetch NFT.' });
    }
});

module.exports = router;
