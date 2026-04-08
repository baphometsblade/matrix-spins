#!/usr/bin/env node
'use strict';

/**
 * deploy.js — One-time deployment of RoyalSlotsToken ERC-1155 to Polygon.
 *
 * Prerequisites:
 *   npm install @thirdweb-dev/sdk ethers@5 dotenv
 *   Copy .env.example to .env and fill in keys
 *
 * Usage:
 *   node blockchain/deploy.js          # Deploy to testnet (Mumbai)
 *   node blockchain/deploy.js --mainnet  # Deploy to Polygon mainnet
 *
 * After deployment, CONTRACT_ADDRESS is written to .env automatically.
 */

require('dotenv').config({ path: __dirname + '/.env' });
const { ThirdwebSDK } = require('@thirdweb-dev/sdk');

const isMainnet = process.argv.includes('--mainnet') || process.env.USE_TESTNET === 'false';
const network = isMainnet ? 'polygon' : 'mumbai';

async function deploy() {
    console.log(`\n  Deploying RoyalSlotsToken (ERC-1155) to ${network}...`);
    console.log(`  Network: ${isMainnet ? 'Polygon Mainnet (137)' : 'Polygon Mumbai Testnet (80001)'}\n`);

    if (!process.env.WALLET_PRIVATE_KEY || !process.env.THIRDWEB_SECRET_KEY) {
        console.error('  ERROR: WALLET_PRIVATE_KEY and THIRDWEB_SECRET_KEY must be set in .env');
        process.exit(1);
    }

    const sdk = ThirdwebSDK.fromPrivateKey(process.env.WALLET_PRIVATE_KEY, network, {
        secretKey: process.env.THIRDWEB_SECRET_KEY,
    });

    console.log('  Deploying contract...');
    const contractAddress = await sdk.deployer.deployEdition({
        name: 'Matrix Spins Casino',
        description: 'ERC-1155 settlement layer for Matrix Spins Casino. Token ID 0 = balance ($0.01 USD per token). Token ID N>0 = deposit receipts.',
        primary_sale_recipient: process.env.WALLET_ADDRESS || (await sdk.wallet.getAddress()),
        symbol: 'MXSP',
    });

    console.log(`\n  ✅ Contract deployed successfully!`);
    console.log(`  Address: ${contractAddress}`);
    console.log(`  Network: ${network}`);
    console.log(`  Explorer: https://${isMainnet ? '' : 'mumbai.'}polygonscan.com/address/${contractAddress}`);

    // Write to .env
    const fs = require('fs');
    const envPath = __dirname + '/.env';
    let envContent = '';
    try { envContent = fs.readFileSync(envPath, 'utf-8'); } catch (e) {}

    if (envContent.includes('CONTRACT_ADDRESS=')) {
        envContent = envContent.replace(/CONTRACT_ADDRESS=.*/, `CONTRACT_ADDRESS=${contractAddress}`);
    } else {
        envContent += `\nCONTRACT_ADDRESS=${contractAddress}\n`;
    }
    envContent = envContent.replace(/CONTRACT_NETWORK=.*/, `CONTRACT_NETWORK=${network}`);
    fs.writeFileSync(envPath, envContent);

    console.log(`  CONTRACT_ADDRESS written to .env\n`);
}

deploy().catch(err => {
    console.error('  Deployment failed:', err.message);
    process.exit(1);
});
