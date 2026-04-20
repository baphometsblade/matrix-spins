#!/usr/bin/env node
'use strict';

/**
 * burn.js — Withdrawal execution: burn balance tokens.
 * Called by the backend when a withdrawal is created/approved so the
 * on-chain audit ledger stays aligned with the DB.
 *
 * Two call styles are accepted — the function inspects arguments:
 *
 *   // Server-style (preferred — matches payment.routes.js callers):
 *   await burnWithdrawal('server-wallet', 50.00, {
 *     withdrawalId: 123, userId: 42
 *   });
 *
 *   // Named-params style (also supported):
 *   await burnWithdrawal({ amountAUD: 50.00, playerId: 42 });
 *
 * Behaviour:
 *   - When CONTRACT_ADDRESS is unset, returns a simulated result and does
 *     NOT attempt a chain transaction (DB remains the source of truth).
 *   - When CONTRACT_ADDRESS is set and the Thirdweb SDK is installed, burns
 *     tokenId=0 (balance tokens). Retries up to 3× with exponential backoff.
 *   - Verifies on-chain balance ≥ requested burn before attempting the tx.
 */

require('dotenv').config({ path: __dirname + '/.env' });
let ThirdwebSDK;
try { ThirdwebSDK = require('@thirdweb-dev/sdk').ThirdwebSDK; } catch (_) { /* not installed — simulated mode */ }

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

function normaliseBurnArgs(args) {
    if (args.length === 1 && typeof args[0] === 'object' && args[0] !== null) {
        const o = args[0];
        return {
            amountAUD: Number(o.amountAUD),
            playerId:  o.playerId != null ? String(o.playerId) : null,
            withdrawalId: o.withdrawalId || null,
            signer: 'server-wallet',
        };
    }
    const [signer, amountAUD, options] = args;
    const opts = options || {};
    return {
        amountAUD: Number(amountAUD),
        playerId:  opts.userId != null ? String(opts.userId) : (opts.playerId != null ? String(opts.playerId) : null),
        withdrawalId: opts.withdrawalId != null ? String(opts.withdrawalId) : null,
        signer: signer || 'server-wallet',
    };
}

/**
 * Burn balance tokens for a withdrawal.
 * @returns {Promise<Object>} { simulated?, tokensBurned, txHash, withdrawalId }
 */
async function burnWithdrawal(...args) {
    const { amountAUD, playerId, withdrawalId, signer } = normaliseBurnArgs(args);

    if (!Number.isFinite(amountAUD) || amountAUD <= 0) {
        throw new Error(`burnWithdrawal: invalid amountAUD=${amountAUD}`);
    }
    const tokenAmount = Math.round(amountAUD * 100);

    if (!process.env.CONTRACT_ADDRESS || !ThirdwebSDK) {
        return {
            simulated: true,
            signer,
            tokensBurned: tokenAmount,
            txHash: null,
            withdrawalId,
        };
    }

    const contract = await getContract();
    const walletAddress = process.env.WALLET_ADDRESS || (await _sdk.wallet.getAddress());

    const balance = await contract.balanceOf(walletAddress, 0);
    const balanceNum = parseInt(balance.toString(), 10);
    if (balanceNum < tokenAmount) {
        throw new Error(`INSUFFICIENT_CHAIN_BALANCE: on-chain balance ${balanceNum} < requested burn ${tokenAmount}`);
    }

    console.log(`[Burn] Burning ${tokenAmount} tokens ($${amountAUD.toFixed(2)} AUD) for withdrawal ${withdrawalId || '-'} (player ${playerId || '-'})…`);

    let tx;
    const MAX_RETRIES = 3;
    const RETRY_DELAYS = [1000, 3000, 9000];
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
        try {
            tx = await contract.burn(0, tokenAmount);
            break;
        } catch (err) {
            if (attempt === MAX_RETRIES) {
                console.error(`[Burn] Failed after ${MAX_RETRIES} retries:`, err.message);
                throw new Error(`BURN_FAILED: ${err.message}`);
            }
            const delay = RETRY_DELAYS[attempt];
            console.warn(`[Burn] Retry ${attempt + 1}/${MAX_RETRIES} in ${delay}ms…`);
            await new Promise(r => setTimeout(r, delay));
        }
    }

    const result = {
        signer,
        tokensBurned: tokenAmount,
        txHash: (tx && tx.receipt && tx.receipt.transactionHash) || null,
        withdrawalId,
    };
    console.log(`[Burn] ✅ Withdrawal burn complete:`, result);
    return result;
}

module.exports = { burnWithdrawal, getContract };

if (require.main === module) {
    const args = {};
    process.argv.slice(2).forEach(a => { const [k, v] = a.replace('--', '').split('='); args[k] = v; });
    burnWithdrawal({
        amountAUD: parseFloat(args.amount || '10'),
        playerId: args.player || 'cli-test',
    }).then(r => console.log(r)).catch(e => { console.error(e); process.exit(1); });
}
