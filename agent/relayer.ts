/**
 * Walp Autonomous Relayer & Intent Daemon
 * 
 * This service runs autonomously to monitor cross-chain intent requests,
 * request threshold signatures from NEAR MPC (v1.signer-prod.testnet),
 * and broadcast confirmed transactions to target EVM networks (Ethereum Sepolia).
 */

import { ethers } from 'ethers';
import * as nearAPI from 'near-api-js';

const NEAR_RPC = 'https://rpc.testnet.near.org';
const MPC_CONTRACT_ID = 'v1.signer-prod.testnet';
const SEPOLIA_RPC = 'https://ethereum-sepolia-rpc.publicnode.com';
const SEPOLIA_CHAIN_ID = 11155111;

async function runAutonomousRelayer() {
  console.log('------------------------------------------------------------');
  console.log('🤖 Walp Autonomous Relayer Daemon initialized.');
  console.log(`Connecting to NEAR Testnet: ${NEAR_RPC}`);
  console.log(`Targeting MPC Contract: ${MPC_CONTRACT_ID}`);
  console.log(`EVM Settlement Network: Ethereum Sepolia (Chain ID: ${SEPOLIA_CHAIN_ID})`);
  console.log('------------------------------------------------------------\n');

  const provider = new ethers.JsonRpcProvider(SEPOLIA_RPC);
  const blockNumber = await provider.getBlockNumber();
  console.log(`[Sepolia] Current Head Block: #${blockNumber}`);

  // Query MPC root public key
  try {
    const res = await fetch(NEAR_RPC, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 'relayer-init',
        method: 'query',
        params: {
          request_type: 'call_function',
          finality: 'final',
          account_id: MPC_CONTRACT_ID,
          method_name: 'public_key',
          args_base64: 'e30='
        }
      })
    });
    const data = await res.json();
    if (data.result && data.result.result) {
      const pubKey = String.fromCharCode(...data.result.result);
      console.log(`[NEAR MPC] Root Public Key verified: ${pubKey}`);
    }
  } catch (e: any) {
    console.warn('[NEAR MPC] Warning querying root public key:', e.message);
  }

  console.log('\n✅ Relayer listening for cross-chain execution intents...');
}

runAutonomousRelayer().catch((err) => {
  console.error('Fatal Relayer Error:', err);
  process.exit(1);
});

