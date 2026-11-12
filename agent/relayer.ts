/**
 * Walp Autonomous Relayer & Vault Monitor
 *
 * Monitors pending intents and vault policy state on `walp-vault.<owner>.testnet`
 * and checks connectivity to NEAR Testnet, MPC (`v1.signer-prod.testnet`), and Sepolia RPC.
 */

import { loadDotEnv } from '../server/utils/env.ts';
import { MPC_CONTRACT_ID, SEPOLIA_CHAIN_ID, getServerConfig } from '../server/config.ts';
import {
  VaultPolicy,
  callNearView,
  deriveVaultEvmAddress,
  withSepoliaProvider,
} from '../server/services/vaultClient.ts';

loadDotEnv();

async function runAutonomousRelayer() {
  const cfg = getServerConfig();
  console.log('------------------------------------------------------------');
  console.log('Walp Autonomous Relayer & Policy Monitor');
  console.log(`NEAR RPCs      : ${cfg.nearRpcUrls.join(', ')}`);
  console.log(`MPC Contract   : ${MPC_CONTRACT_ID}`);
  console.log(`Sepolia Chain  : ${SEPOLIA_CHAIN_ID}`);
  console.log(`Vault Contract : ${cfg.vaultContractId || '(not configured in .env)'}`);
  console.log('------------------------------------------------------------\n');

  const blockNumber = await withSepoliaProvider((provider) => provider.getBlockNumber());
  console.log(`[Sepolia] Head block: #${blockNumber}`);

  const rootPubKey = await callNearView<string>(MPC_CONTRACT_ID, 'public_key', {});
  console.log(`[NEAR MPC] Root public key: ${rootPubKey}`);

  if (cfg.vaultContractId) {
    const [policy, pending, derived] = await Promise.all([
      callNearView<VaultPolicy>(cfg.vaultContractId, 'get_policy', {}),
      callNearView<unknown[]>(cfg.vaultContractId, 'get_pending_intents', {}),
      deriveVaultEvmAddress(cfg.vaultContractId, 'ethereum-1'),
    ]);
    console.log(`[Vault] Derived Sepolia Address : ${derived.ethAddress}`);
    console.log(
      `[Vault] Paused=${policy.paused} | MaxTx=${policy.max_tx_wei} wei | DailySpent=${policy.spent_today_wei}/${policy.daily_limit_wei} wei`
    );
    console.log(`[Vault] Pending Owner Approvals : ${pending.length}`);
  } else {
    console.log('[Vault] Set WALP_VAULT_CONTRACT_ID in .env to monitor live onchain vault state.');
  }
}

runAutonomousRelayer().catch((err) => {
  console.error('Relayer error:', err);
  process.exit(1);
});
