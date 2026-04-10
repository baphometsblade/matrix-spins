#!/usr/bin/env node
'use strict';

/**
 * mint.js — Deposit confirmation: mint balance tokens + deposit receipt.
 * Called by the backend when Stripe webhook confirms payment.
 *
 * Usage (server-side only, never exposed to client):
 *   const { mintDeposit } = require('./blockchain/mint');
 *   await mintDeposit({ amountAUD: 50.00, playerId: 'uuid', stripePaymentId: 'pi_xxx' });
 */

require('dotenv').config({ path: __dirname + '/.env' });
let ThirdwebSDK;
try { ThirdwebSDK = require('@thirdweb-dev/sdk').ThirdwebSDK; } catch(e) { console.warn('[blockchain/mint] @thirdweb-dev/sdk not installed � mint operations will be no-ops'); }

let _sdk = null;
let _contract = null;
let _receiptCounter = null;

async function getContract() {
    if (_contract) return _contract;

    const network = process.env.CONTRACT_NETWORK || 'mumbai';
    _sdk = ThirdwebSDK.fromPrivateKey(process.env.WALLET_PRIVATE_KEY, network, {
        secretKey: process.env.THIRDWEB_SECRET_KEY,
    });
    _contract = await _sdk.getContract(process.env.CONTRACT_ADDRESS, 'edition');

    // Get next receipt ID (find highest existing token ID > 0)
    try {
        const allTokens = await _contract.getAll();
        _receiptCounter = allTokens.length; // Token 0 = balance, rest are receipts
    } catch (e) {
        _receiptCounter = 1;
    }

    return _contract;
}

/**
 * Mint balance tokens and a deposit receipt.
 * @param {Object} params
 * @param {number} params.amountAUD - Deposit amount in AUD
 * @param {string} params.playerId - Player UUID (hashed for on-chain storage)
 * @param {string} params.stripePaymentId - Stripe payment intent ID
 * @returns {Object} { balanceTokensMinted, receiptId, txHash }
 */
async function mintDeposit({ amountAUD, playerId, stripePaymentId }) {
    // Simulated mode when no contract is deployed
    if (!process.env.CONTRACT_ADDRESS || !ThirdwebSDK) {
        return { simulated: true, balanceTokensMinted: Math.round(amountAUD * 100), receiptId: null, txHash: null };
    }
    const contract = await getContract();
    const walletAddress = process.env.WALLET_ADDRESS || (await _sdk.wallet.getAddress());

    // Token amount: 1 token = $0.01 AUD
    const tokenAmount = Math.round(amountAUD * 100);

    // 1. Mint balance tokens (Token ID 0)
    console.log(`[Mint] Minting ${tokenAmount} balance tokens ($${amountAUD} AUD)...`);

    let balanceTx;
    let retries = 0;
    const MAX_RETRIES = 3;
    const RETRY_DELAYS = [1000, 3000, 9000]; // Exponential backoff

    while (retries <= MAX_RETRIES) {
        try {
            balanceTx = await contract.mintTo(walletAddress, {
                tokenId: 0,
                supply: tokenAmount,
                metadata: {
                    name: 'Matrix Spins Balance',
                    description: `Balance deposit: $${amountAUD.toFixed(2)} AUD`,
                },
            });
            break;
        } catch (err) {
            retries++;
            if (retries > MAX_RETRIES) {
                console.error(`[Mint] Balance mint failed after ${MAX_RETRIES} retries:`, err.message);
                throw new Error(`MINT_FAILED: ${err.message}`);
            }
            console.warn(`[Mint] Retry ${retries}/${MAX_RETRIES} in ${RETRY_DELAYS[retries - 1]}ms...`);
            await new Promise(r => setTimeout(r, RETRY_DELAYS[retries - 1]));
        }
    }

    // 2. Mint deposit receipt (Token ID N)
    const receiptId = ++_receiptCounter;
    const crypto = require('crypto');
    const playerHash = crypto.createHash('sha256').update(playerId).digest('hex');

    console.log(`[Mint] Minting deposit receipt #${receiptId}...`);

    let receiptTx;
    try {
        receiptTx = await contract.mintTo(walletAddress, {
            tokenId: receiptId,
            supply: 1,
            metadata: {
                name: `Deposit Receipt #${receiptId}`,
                description: `Deposit of $${amountAUD.toFixed(2)} AUD`,
                properties: {
                    depositId: `DEP-${Date.now().toString(36).toUpperCase()}`,
                    amountAUD: amountAUD,
                    timestamp: new Date().toISOString(),
                    stripePaymentId: stripePaymentId,
                    playerHash: playerHash,
                },
            },
        });
    } catch (err) {
        // Receipt mint failure is non-critical — balance was already minted
        console.error(`[Mint] Receipt mint failed (non-critical):`, err.message);
    }

    const result = {
        balanceTokensMinted: tokenAmount,
        receiptId: receiptId,
        txHash: balanceTx?.receipt?.transactionHash || null,
        receiptTxHash: receiptTx?.receipt?.transactionHash || null,
    };

    console.log(`[Mint] ✅ Deposit complete:`, result);
    return result;
}

module.exports = { mintDeposit, getContract };

// CLI usage: node blockchain/mint.js --amount=50 --player=test-uuid --stripe=pi_test
if (require.main === module) {
    const args = {};
    process.argv.slice(2).forEach(a => { const [k,v] = a.replace('--','').split('='); args[k]=v; });
    mintDeposit({
        amountAUD: parseFloat(args.amount || '10'),
        playerId: args.player || 'cli-test',
        stripePaymentId: args.stripe || 'pi_cli_test',
    }).then(r => console.log(r)).catch(e => console.error(e));
}
