#!/usr/bin/env node
'use strict';

/**
 * mint.js — Deposit confirmation: mint balance tokens + deposit receipt.
 * Called by the backend when Stripe webhook confirms payment, or when a
 * deposit is otherwise marked completed.
 *
 * Two call styles are accepted — the function inspects arguments to choose:
 *
 *   // Server-style (preferred — matches payment.routes.js callers):
 *   await mintDeposit('server-wallet', 50.00, {
 *     depositId: 123, userId: 42, stripePaymentId: 'pi_xxx'
 *   });
 *
 *   // Named-params style (also supported):
 *   await mintDeposit({ amountAUD: 50.00, playerId: 42, stripePaymentId: 'pi_xxx' });
 *
 * Behaviour:
 *   - When CONTRACT_ADDRESS is unset, returns a simulated result and does
 *     NOT attempt a chain transaction (DB remains the source of truth).
 *   - When CONTRACT_ADDRESS is set and the Thirdweb SDK is installed, mints
 *     balance tokens (ERC-1155 tokenId=0) + a unique deposit receipt token.
 *   - Retries balance mint up to 3× with exponential backoff. Receipt mint
 *     failures are non-critical (logged, not thrown).
 */

require('dotenv').config({ path: __dirname + '/.env' });
let ThirdwebSDK;
try { ThirdwebSDK = require('@thirdweb-dev/sdk').ThirdwebSDK; } catch (_) { /* not installed — simulated mode */ }

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

    if (_receiptCounter == null) {
        try {
            const allTokens = await _contract.getAll();
            _receiptCounter = Math.max(0, allTokens.length - 1); // tokenId 0 is balance; others are receipts
        } catch (_) {
            _receiptCounter = 0;
        }
    }

    return _contract;
}

/**
 * Normalise the two supported call styles into { amountAUD, playerId, stripePaymentId, depositId }.
 */
function normaliseMintArgs(args) {
    if (args.length === 1 && typeof args[0] === 'object' && args[0] !== null) {
        const o = args[0];
        return {
            amountAUD: Number(o.amountAUD),
            playerId:  o.playerId != null ? String(o.playerId) : null,
            stripePaymentId: o.stripePaymentId || null,
            depositId: o.depositId || null,
            signer: 'server-wallet',
        };
    }
    // Server-style: (signer, amountAUD, options)
    const [signer, amountAUD, options] = args;
    const opts = options || {};
    return {
        amountAUD: Number(amountAUD),
        playerId:  opts.userId != null ? String(opts.userId) : (opts.playerId != null ? String(opts.playerId) : null),
        stripePaymentId: opts.stripePaymentId || null,
        depositId: opts.depositId != null ? String(opts.depositId) : null,
        signer: signer || 'server-wallet',
    };
}

/**
 * Mint balance tokens and a deposit receipt.
 * @returns {Promise<Object>} { simulated?, balanceTokensMinted, receiptId, txHash, receiptTxHash }
 */
async function mintDeposit(...args) {
    const { amountAUD, playerId, stripePaymentId, depositId, signer } = normaliseMintArgs(args);

    if (!Number.isFinite(amountAUD) || amountAUD <= 0) {
        throw new Error(`mintDeposit: invalid amountAUD=${amountAUD}`);
    }
    const tokenAmount = Math.round(amountAUD * 100);

    // Simulated mode — no on-chain write
    if (!process.env.CONTRACT_ADDRESS || !ThirdwebSDK) {
        return {
            simulated: true,
            signer,
            balanceTokensMinted: tokenAmount,
            receiptId: null,
            txHash: null,
            receiptTxHash: null,
            depositId,
        };
    }

    const contract = await getContract();
    const walletAddress = process.env.WALLET_ADDRESS || (await _sdk.wallet.getAddress());

    console.log(`[Mint] Minting ${tokenAmount} balance tokens ($${amountAUD.toFixed(2)} AUD) for deposit ${depositId || '-'}…`);

    let balanceTx;
    const MAX_RETRIES = 3;
    const RETRY_DELAYS = [1000, 3000, 9000];
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
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
            if (attempt === MAX_RETRIES) {
                console.error(`[Mint] Balance mint failed after ${MAX_RETRIES} retries:`, err.message);
                throw new Error(`MINT_FAILED: ${err.message}`);
            }
            const delay = RETRY_DELAYS[attempt];
            console.warn(`[Mint] Retry ${attempt + 1}/${MAX_RETRIES} in ${delay}ms…`);
            await new Promise(r => setTimeout(r, delay));
        }
    }

    // Receipt mint — non-critical
    const receiptId = ++_receiptCounter;
    const crypto = require('crypto');
    const playerHash = playerId ? crypto.createHash('sha256').update(playerId).digest('hex') : null;

    let receiptTx = null;
    try {
        receiptTx = await contract.mintTo(walletAddress, {
            tokenId: receiptId,
            supply: 1,
            metadata: {
                name: `Deposit Receipt #${receiptId}`,
                description: `Deposit of $${amountAUD.toFixed(2)} AUD`,
                properties: {
                    depositId: depositId || `DEP-${Date.now().toString(36).toUpperCase()}`,
                    amountAUD: amountAUD,
                    timestamp: new Date().toISOString(),
                    stripePaymentId: stripePaymentId,
                    playerHash: playerHash,
                },
            },
        });
    } catch (err) {
        console.error(`[Mint] Receipt mint failed (non-critical):`, err.message);
    }

    const result = {
        signer,
        balanceTokensMinted: tokenAmount,
        receiptId,
        txHash: (balanceTx && balanceTx.receipt && balanceTx.receipt.transactionHash) || null,
        receiptTxHash: (receiptTx && receiptTx.receipt && receiptTx.receipt.transactionHash) || null,
        depositId,
    };
    console.log(`[Mint] ✅ Deposit mint complete:`, result);
    return result;
}

module.exports = { mintDeposit, getContract };

// CLI: node blockchain/mint.js --amount=50 --player=42 --stripe=pi_test
if (require.main === module) {
    const args = {};
    process.argv.slice(2).forEach(a => { const [k, v] = a.replace('--', '').split('='); args[k] = v; });
    mintDeposit({
        amountAUD: parseFloat(args.amount || '10'),
        playerId: args.player || 'cli-test',
        stripePaymentId: args.stripe || 'pi_cli_test',
    }).then(r => console.log(r)).catch(e => { console.error(e); process.exit(1); });
}
