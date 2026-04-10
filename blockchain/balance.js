#!/usr/bin/env node
'use strict';

/**
 * balance.js — Query on-chain balance and convert to AUD.
 *
 * Usage:
 *   const { getChainBalance } = require('./blockchain/balance');
 *   const balanceAUD = await getChainBalance();
 */

require('dotenv').config({ path: __dirname + '/.env' });
let ThirdwebSDK;
try { ThirdwebSDK = require('@thirdweb-dev/sdk').ThirdwebSDK; } catch(e) { /* @thirdweb-dev/sdk not installed — balance queries will use simulated mode */ }

let _sdk = null;
let _contract = null;

async function getContract() {
    if (_contract) return _contract;
    const network = process.env.CONTRACT_NETWORK || 'mumbai';
    _sdk = ThirdwebSDK.fromPrivateKey(process.env.WALLET_PRIVATE_KEY, network, {
        secretKey: process.env.THIRDWEB_SECRET_KEY,
    });
    _contract = await _sdk.getContract(process.env.CONTRACT_ADDRESS, 'edition');
    return _contract;
}

/**
 * Get the on-chain balance in AUD.
 * @returns {Object} { tokens, balanceAUD, walletAddress }
 */
async function getChainBalance() {
    // Simulated mode when no contract is deployed
    if (!process.env.CONTRACT_ADDRESS) {
        return { simulated: true, tokens: 0, balanceAUD: 0, walletAddress: null, formatted: '$0.00 AUD (simulated)' };
    }
    const contract = await getContract();
    const walletAddress = process.env.WALLET_ADDRESS || (await _sdk.wallet.getAddress());

    const balance = await contract.balanceOf(walletAddress, 0);
    const tokens = parseInt(balance.toString(), 10);
    const balanceAUD = tokens / 100;

    return {
        tokens,
        balanceAUD,
        walletAddress,
        formatted: `$${balanceAUD.toFixed(2)} AUD`,
    };
}

/**
 * Get total deposit receipts count.
 * @returns {number} Number of deposit receipts on-chain
 */
async function getReceiptCount() {
    const contract = await getContract();
    try {
        const allTokens = await contract.getAll();
        return Math.max(0, allTokens.length - 1); // Subtract token ID 0 (balance)
    } catch (e) {
        return 0;
    }
}

module.exports = { getChainBalance, getReceiptCount, getContract };

if (require.main === module) {
    getChainBalance()
        .then(r => console.log('On-chain balance:', r))
        .catch(e => console.error('Error:', e.message));
}
