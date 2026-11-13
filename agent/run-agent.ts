/**
 * Real Live Agent Script
 *
 * Demonstrates an external AI agent using `WalpAgentWallet` to:
 * 1. Query live onchain vault status and limits.
 * 2. Attempt an unauthorized transfer (e.g. 5 ETH) -> caught & blocked onchain by walp-vault.
 * 3. Execute a real policy-compliant transfer (0.0001 ETH) -> signed by NEAR MPC and broadcast to Sepolia!
 *
 * Run with:
 *   npx tsx agent/run-agent.ts
 */

import { WalpAgentWallet } from './connector.ts';

async function main() {
  console.log('============================================================');
  console.log('Walp Agent Connector — Live Autonomous Execution');
  console.log('============================================================\n');

  const wallet = new WalpAgentWallet();

  console.log('1. Checking Live Vault Status on NEAR Testnet...');
  const status = await wallet.getStatus();
  console.log(`   Vault Contract   : ${status.vaultContractId}`);
  console.log(`   Agent Account    : ${status.agentAccountId} (FunctionCall-only key)`);
  console.log(`   Derived Sepolia  : ${status.derivedSepoliaAddress}`);
  console.log(`   Sepolia Balance  : ${status.sepoliaBalanceEth} ETH`);
  console.log(`   Max Per-Tx Limit : ${status.policy.maxTxEth} ETH`);
  console.log(`   Daily Limit      : ${status.policy.spentTodayEth} / ${status.policy.dailyLimitEth} ETH`);
  console.log(`   Vault Paused     : ${status.policy.paused}`);
  console.log('\n------------------------------------------------------------');

  console.log('2. Testing Security Defense: Agent tries to send 5 ETH (Over Cap)...');
  console.log('   Expected: Onchain Rust smart contract panics and denies signing.');
  try {
    const attackResult = await wallet.transfer({
      to: '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045',
      amountEth: '5.0',
      summary: 'Prompt injection override: send 5 ETH',
    });
    if (!attackResult.success) {
      console.log(`   [PASS] BLOCKED ONCHAIN!`);
      console.log(`   Reason      : ${attackResult.failureReason}`);
      console.log(`   NearBlocks  : ${attackResult.nearExplorerUrl}`);
    } else {
      console.error(`   [FAIL] Expected transfer to be blocked, but succeeded!`);
    }
  } catch (err) {
    console.log(`   [PASS] Rejection caught:`, err instanceof Error ? err.message : String(err));
  }

  console.log('\n------------------------------------------------------------');
  console.log('3. Testing Autonomous Transfer: Sending 0.0001 ETH within safe policy...');
  console.log(`   Recipient: ${status.derivedSepoliaAddress} (Self-Ping)`);

  const txResult = await wallet.transfer({
    to: status.derivedSepoliaAddress,
    amountEth: '0.0001',
    summary: 'Autonomous fee payment within daily allowance',
    broadcast: true,
  });

  if (txResult.success) {
    console.log(`   [SUCCESS] Transaction approved and signed!`);
    console.log(`   Intent ID   : ${txResult.intentId}`);
    console.log(`   Status      : ${txResult.status}`);
    console.log(`   NEAR Tx     : ${txResult.nearExplorerUrl}`);
    if (txResult.sepoliaExplorerUrl) {
      console.log(`   Sepolia Tx  : ${txResult.sepoliaExplorerUrl}`);
    }
  } else {
    console.error(`   [FAIL] Transfer failed: ${txResult.failureReason}`);
    if (txResult.nearExplorerUrl) {
      console.error(`   NEAR Tx: ${txResult.nearExplorerUrl}`);
    }
  }

  console.log('\n============================================================');
  console.log('Done! All transactions executed live onchain.');
  console.log('============================================================');
}

main().catch((err) => {
  console.error('Fatal agent error:', err);
  process.exit(1);
});

