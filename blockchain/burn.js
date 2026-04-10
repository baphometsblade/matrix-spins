#!/usr/bin/env node
'use strict';

/**
 * burn.js — Withdrawal execution: burn balance tokens + mark receipt.
 * Called by the backend when a withdrawal is approved.
 *
 * Usage (server-side only):
 *   const { burnWithdrawal } = require('./blockchain/burn');
 *   await burnWithdrawal({ amountAUD: 50.00, playerId: 'uuid' });
 */

require('dotenv').config({ path: __dirname + '/.env' });
let ThirdwebSDK;
try { ThirdwebSDK = require('@thirdweb-dev/sdk').ThirdwebSDK; } catch(e) { console.warn('[blockchain/burn] @thirdweb-dev/sdk not installed � burn operations will be no-ops'); }

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
 * Burn balance tokens for withdrawal.
 * @param {Object} params
 * @param {number} params.amountAUD - Withdrawal amount in AUD
 * @param {string} params.playerId - Player UUID (for logging)
 * @returns {Object} { tokensBurned, txHash }
 */
async function burnWithdrawal({ amountAUD, playerId }) {
    // Simulated mode when no contract is deployed
    if (!process.env.CONTRACT_ADDRESS || !ThirdwebSDK) {
        return { simulated: true, tokensBurned: Math.round(amountAUD * 100), txHash: null };
    }
    const contract = await getContract();
    const walletAddress = process.env.WALLET_ADDRESS || (await _sdk.wallet.getAddress());

    const tokenAmount = Math.round(amountAUD * 100);

    // Verify sufficient balance on-chain
    const balance = await contract.balanceOf(walletAddress, 0);
    const balanceNum = parseInt(balance.toString(), 10);

    if (balanceNum < tokenAmount) {
        throw new Error(`INSUFFICIENT_CHAIN_BALANCE: On-chain balance ${balanceNum} < requested burn ${tokenAmount}`);
    }

    console.log(`[Burn] Burning ${tokenAmount} tokens ($${amountAUD} AUD) for player ${playerId}...`);

    let tx;
    let retries = 0;
    const MAX_RETRIES = 3;
    const RETRY_DELAYS = [1000, 3000, 9000];

    while (retries <= MAX_RETRIES) {
        try {
            tx = await contract.burn(0, tokenAmount);
            break;
        } catch (err) {
            retries++;
            if (retries > MAX_RETRIES) {
                console.error(`[Burn] Failed after ${MAX_RETRIES} retries:`, err.message);
                throw new Error(`BURN_FAILED: ${err.message}`);
            }
            console.warn(`[Burn] Retry ${retries}/${MAX_RETRIES} in ${RETRY_DELAYS[retries - 1]}ms...`);
            await new Promise(r => setTimeout(r, RETRY_DELAYS[retries - 1]));
        }
    }

    const result = {
        tokensBurned: tokenAmount,
        txHash: tx?.receipt?.transactionHash || null,
    };

    console.log(`[Burn] ✅ Withdrawal burn complete:`, result);
    return result;
}

module.exports = { burnWithdrawal, getContract };

if (require.main === module) {
    const args = {};
    process.argv.slice(2).forEach(a => { const [k,v] = a.replace('--','').split('='); args[k]=v; });
    burnWithdrawal({
        amountAUD: parseFloat(args.amount || '10'),
        playerId: args.player || 'cli-test',
    }).then(r => console.log(r)).catch(e => console.error(e));
}
