import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import * as nearAPI from 'near-api-js';
import { loadDotEnv } from '../server/utils/env.ts';
import { getServerConfig } from '../server/config.ts';
import {
  NearCallOutcome,
  callNearView,
  deriveVaultEvmAddress,
  getNearAccountBalance,
  nearRpcQuery,
  sendNearActions,
  sendNearFunctionCall,
} from '../server/services/vaultClient.ts';

loadDotEnv();

function sha256Base58(bytes: Uint8Array): string {
  const digest = crypto.createHash('sha256').update(bytes).digest();
  return nearAPI.utils.serialize.base_encode(digest);
}

function assertTxOk<T>(label: string, out: NearCallOutcome<T>): NearCallOutcome<T> {
  if (!out.success) {
    throw new Error(`${label} failed (${out.txHash}): ${out.failureReason || 'Unknown failure'}`);
  }
  return out;
}

function parseArgs(argv: string[]): Record<string, string | boolean> {
  const out: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith('--')) continue;
    const key = arg.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith('--')) {
      out[key] = true;
    } else {
      out[key] = next;
      i++;
    }
  }
  return out;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(`Usage: npx tsx scripts/setup-scoped-key.ts [options]
Options:
  --owner <account.testnet>        Owner testnet account (default: NEAR_OWNER_ACCOUNT_ID)
  --vault <walp-vault.owner>       Vault subaccount ID (default: walp-vault.<owner>)
  --registry <walp-registry.owner> Registry subaccount ID (default: walp-registry.<owner>)
  --agent <agent.owner>            Agent subaccount ID (default: agent.<owner>)
  --allowance <near>               Scoped key allowance in NEAR (default: 0.5)
  --max-tx-wei <wei>               Max per-tx wei (default: 50000000000000000 = 0.05 ETH)
  --daily-limit-wei <wei>          Daily limit wei (default: 200000000000000000 = 0.20 ETH)
  --threshold-wei <wei>            Escalation threshold wei (default: 10000000000000000 = 0.01 ETH)
  --dry-run                        Print planned setup without broadcasting NEAR transactions`);
    return;
  }

  const cfg = getServerConfig();
  const ownerId = String(args.owner || cfg.ownerAccountId || '');
  const ownerKey = cfg.ownerPrivateKey;
  const vaultId = String(args.vault || cfg.vaultContractId || (ownerId ? `walp-vault.${ownerId}` : ''));
  const registryId = String(
    args.registry || cfg.registryContractId || (ownerId ? `walp-registry.${ownerId}` : '')
  );
  const agentId = String(args.agent || cfg.agentAccountId || (ownerId ? `agent.${ownerId}` : ''));
  const allowanceNear = String(args.allowance || '0.5');
  const maxTxWei = String(args['max-tx-wei'] || '50000000000000000');
  const dailyLimitWei = String(args['daily-limit-wei'] || '200000000000000000');
  const thresholdWei = String(args['threshold-wei'] || '10000000000000000');

  if (!ownerId || ownerId === 'your-owner.testnet') {
    throw new Error('Set NEAR_OWNER_ACCOUNT_ID in .env or pass --owner <your-account>.testnet');
  }
  if (!args['dry-run'] && !ownerKey) {
    throw new Error('NEAR_OWNER_PRIVATE_KEY must be set in .env to deploy contracts and provision subaccounts.');
  }

  const outDir = path.join(process.cwd(), 'contracts', 'out');
  const vaultWasmPath = path.join(outDir, 'walp_vault.wasm');
  const regWasmPath = path.join(outDir, 'walp_registry.wasm');

  const vaultWasmExists = fs.existsSync(vaultWasmPath);
  const regWasmExists = fs.existsSync(regWasmPath);
  const vaultBytes = vaultWasmExists ? fs.statSync(vaultWasmPath).size : 0;
  const regBytes = regWasmExists ? fs.statSync(regWasmPath).size : 0;
  const storagePerByteYocto = BigInt('10000000000000000000'); // 10^19 yoctoNEAR / byte
  const vaultDepositYocto =
    BigInt(vaultBytes) * storagePerByteYocto + BigInt(nearAPI.utils.format.parseNearAmount('0.7')!);
  const regDepositYocto =
    BigInt(regBytes) * storagePerByteYocto + BigInt(nearAPI.utils.format.parseNearAmount('0.5')!);

  if (args['dry-run']) {
    console.log('Dry-run plan (no transactions sent):');
    console.log(
      JSON.stringify(
        {
          ownerId,
          vaultId,
          registryId,
          agentId,
          mpcContractId: cfg.mpcContractId,
          allowanceNear,
          maxTxWei,
          dailyLimitWei,
          thresholdWei,
          vaultWasmPresent: vaultWasmExists,
          vaultWasmBytes: vaultBytes,
          plannedVaultDepositNear: nearAPI.utils.format.formatNearAmount(vaultDepositYocto.toString(), 4),
          registryWasmPresent: regWasmExists,
          registryWasmBytes: regBytes,
          plannedRegistryDepositNear: nearAPI.utils.format.formatNearAmount(regDepositYocto.toString(), 4),
          plannedAgentDepositNear: '0.5',
        },
        null,
        2
      )
    );
    return;
  }

  if (!vaultWasmExists || !regWasmExists) {
    throw new Error(
      `Compiled WASM files not found in ${outDir}. Run WSL build first: wsl bash -lc "./scripts/build-contracts.sh"`
    );
  }

  const vaultWasm = fs.readFileSync(vaultWasmPath);
  const regWasm = fs.readFileSync(regWasmPath);
  const vaultWasmHash = sha256Base58(vaultWasm);
  const regWasmHash = sha256Base58(regWasm);

  const ownerBal = await getNearAccountBalance(ownerId);
  if (!ownerBal.exists) {
    throw new Error(`Owner account ${ownerId} was not found on NEAR Testnet.`);
  }
  const ownerPubKey = nearAPI.KeyPair.fromString(
    ownerKey as Parameters<typeof nearAPI.KeyPair.fromString>[0]
  ).getPublicKey();
  console.log(`Owner account ${ownerId}: available=${ownerBal.availableNear} NEAR`);

  const [regStatus, vaultStatus, agentStatus] = await Promise.all([
    getNearAccountBalance(registryId),
    getNearAccountBalance(vaultId),
    getNearAccountBalance(agentId),
  ]);

  const allowanceYocto = BigInt(nearAPI.utils.format.parseNearAmount(allowanceNear)!);
  const agentCreateDepositYocto = BigInt(nearAPI.utils.format.parseNearAmount('0.5')!);
  const totalNeededYocto =
    (regStatus.exists ? 0n : regDepositYocto) +
    (vaultStatus.exists ? 0n : vaultDepositYocto) +
    (agentStatus.exists ? 0n : agentCreateDepositYocto) +
    BigInt(nearAPI.utils.format.parseNearAmount('0.05')!);

  if (BigInt(ownerBal.availableYocto) < totalNeededYocto) {
    throw new Error(
      `Insufficient owner balance on ${ownerId}: have ${ownerBal.availableNear} NEAR, need at least ~${nearAPI.utils.format.formatNearAmount(totalNeededYocto.toString(), 4)} NEAR for remaining deployments + gas.`
    );
  }

  // 1. Create / deploy / initialize walp-registry (idempotent)
  if (!regStatus.exists) {
    console.log(
      `Creating, deploying, and initializing ${registryId} (deposit ${nearAPI.utils.format.formatNearAmount(regDepositYocto.toString(), 4)} NEAR for ${regWasm.length} bytes)...`
    );
    const out = assertTxOk(
      `Create/deploy/init ${registryId}`,
      await sendNearActions({
        signerAccountId: ownerId,
        signerPrivateKey: ownerKey,
        receiverId: registryId,
        actions: [
          nearAPI.transactions.createAccount(),
          nearAPI.transactions.transfer(regDepositYocto),
          nearAPI.transactions.addKey(ownerPubKey, nearAPI.transactions.fullAccessKey()),
          nearAPI.transactions.deployContract(regWasm),
          nearAPI.transactions.functionCall(
            'init',
            { owner_id: ownerId },
            BigInt('50000000000000'),
            0n
          ),
        ],
      })
    );
    console.log(`  Registry ready: ${out.explorerUrl}`);
  } else {
    if (regStatus.codeHash === regWasmHash) {
      console.log(`Registry WASM on ${registryId} already matches local build (${regWasm.length} bytes); skipping redeploy.`);
    } else {
      console.log(`Deploying updated WASM to existing ${registryId}...`);
      const out = await sendNearActions({
        signerAccountId: registryId,
        signerPrivateKey: ownerKey,
        receiverId: registryId,
        actions: [nearAPI.transactions.deployContract(regWasm)],
      }).catch((err) => {
        console.log(`Skipping redeploy of ${registryId}: ${err instanceof Error ? err.message : String(err)}`);
        return null;
      });
      if (out) assertTxOk(`Redeploy ${registryId}`, out);
    }

    const regInitialized = await callNearView(registryId, 'list_entries', {})
      .then(() => true)
      .catch(() => false);
    if (!regInitialized) {
      console.log(`Initializing existing registry ${registryId}...`);
      const initOut = assertTxOk(
        `Init ${registryId}`,
        await sendNearFunctionCall({
          signerAccountId: ownerId,
          signerPrivateKey: ownerKey,
          receiverId: registryId,
          methodName: 'init',
          args: { owner_id: ownerId },
          gas: '50000000000000',
        })
      );
      console.log(`  Registry initialized: ${initOut.explorerUrl}`);
    }
  }

  // Seed default shared registry threat entry (idempotent)
  const seedRegTarget = '0xbad0000000000000000000000000000000000002';
  const alreadyInRegistry = await callNearView<boolean>(registryId, 'is_denylisted', {
    address: seedRegTarget,
  }).catch(() => false);
  if (!alreadyInRegistry) {
    assertTxOk(
      'Seed registry entry',
      await sendNearFunctionCall({
        signerAccountId: ownerId,
        signerPrivateKey: ownerKey,
        receiverId: registryId,
        methodName: 'report_address',
        args: {
          address: seedRegTarget,
          category: 'EXPLOIT',
          reason: 'Walp demo shared-registry threat address',
          evidence_hash: 'sha256:walp-demo-seed',
        },
        gas: '50000000000000',
      })
    );
  }

  // 2. Create / deploy / initialize walp-vault (idempotent)
  const vaultInitArgs = {
    owner_id: ownerId,
    mpc_contract_id: cfg.mpcContractId,
    max_tx_wei: maxTxWei,
    daily_limit_wei: dailyLimitWei,
    approval_threshold_wei: thresholdWei,
    allowed_chain_ids: [11155111],
    registry_contract_id: registryId,
    registry_fail_closed: true,
  };

  if (!vaultStatus.exists) {
    console.log(
      `Creating, deploying, and initializing ${vaultId} (deposit ${nearAPI.utils.format.formatNearAmount(vaultDepositYocto.toString(), 4)} NEAR for ${vaultWasm.length} bytes)...`
    );
    const out = assertTxOk(
      `Create/deploy/init ${vaultId}`,
      await sendNearActions({
        signerAccountId: ownerId,
        signerPrivateKey: ownerKey,
        receiverId: vaultId,
        actions: [
          nearAPI.transactions.createAccount(),
          nearAPI.transactions.transfer(vaultDepositYocto),
          nearAPI.transactions.addKey(ownerPubKey, nearAPI.transactions.fullAccessKey()),
          nearAPI.transactions.deployContract(vaultWasm),
          nearAPI.transactions.functionCall(
            'init',
            vaultInitArgs,
            BigInt('80000000000000'),
            0n
          ),
        ],
      })
    );
    console.log(`  Vault ready: ${out.explorerUrl}`);
  } else {
    if (vaultStatus.codeHash === vaultWasmHash) {
      console.log(`Vault WASM on ${vaultId} already matches local build (${vaultWasm.length} bytes); skipping redeploy.`);
    } else {
      console.log(`Deploying updated WASM to existing ${vaultId}...`);
      const out = await sendNearActions({
        signerAccountId: vaultId,
        signerPrivateKey: ownerKey,
        receiverId: vaultId,
        actions: [nearAPI.transactions.deployContract(vaultWasm)],
      }).catch((err) => {
        console.log(`Skipping redeploy of ${vaultId}: ${err instanceof Error ? err.message : String(err)}`);
        return null;
      });
      if (out) assertTxOk(`Redeploy ${vaultId}`, out);
    }

    const vaultInitialized = await callNearView(vaultId, 'get_policy', {})
      .then(() => true)
      .catch(() => false);
    if (!vaultInitialized) {
      console.log(`Initializing existing vault ${vaultId}...`);
      assertTxOk(
        `Init ${vaultId}`,
        await sendNearFunctionCall({
          signerAccountId: ownerId,
          signerPrivateKey: ownerKey,
          receiverId: vaultId,
          methodName: 'init',
          args: vaultInitArgs,
          gas: '80000000000000',
        })
      );
    }
  }

  // Seed default local denylist entry for Vector 2 (idempotent)
  const seedVaultDenylist = '0xdead000000000000000000000000000000000001';
  const existingDenylist = await callNearView<Array<{ address: string }>>(
    vaultId,
    'get_denylist',
    {}
  ).catch(() => []);
  if (!existingDenylist.some((entry) => entry.address.toLowerCase() === seedVaultDenylist)) {
    assertTxOk(
      'Seed local denylist',
      await sendNearFunctionCall({
        signerAccountId: ownerId,
        signerPrivateKey: ownerKey,
        receiverId: vaultId,
        methodName: 'add_denylist',
        args: {
          address: seedVaultDenylist,
          reason: 'Walp demo local denylist target',
          evidence_hash: 'sha256:walp-local-seed',
        },
        gas: '50000000000000',
      })
    );
  }

  // 3. Provision zero-Full-Access-Key Agent subaccount with ONLY FunctionCall(request_intent)
  let createdScopedKey: nearAPI.KeyPair | null = null;

  if (!agentStatus.exists) {
    createdScopedKey = nearAPI.KeyPair.fromRandom('ed25519');
    console.log(`Creating zero-Full-Access-Key agent subaccount ${agentId}...`);
    const tempFullKey = nearAPI.KeyPair.fromRandom('ed25519');
    assertTxOk(
      `Create subaccount ${agentId}`,
      await sendNearActions({
        signerAccountId: ownerId,
        signerPrivateKey: ownerKey,
        receiverId: agentId,
        actions: [
          nearAPI.transactions.createAccount(),
          nearAPI.transactions.transfer(agentCreateDepositYocto),
          nearAPI.transactions.addKey(tempFullKey.getPublicKey(), nearAPI.transactions.fullAccessKey()),
        ],
      })
    );
    assertTxOk(
      `Scope keys on ${agentId}`,
      await sendNearActions({
        signerAccountId: agentId,
        signerPrivateKey: tempFullKey.toString(),
        receiverId: agentId,
        actions: [
          nearAPI.transactions.addKey(
            createdScopedKey.getPublicKey(),
            nearAPI.transactions.functionCallAccessKey(vaultId, ['request_intent'], allowanceYocto)
          ),
          nearAPI.transactions.deleteKey(tempFullKey.getPublicKey()),
        ],
      })
    );
  } else {
    console.log(`Agent account ${agentId} already exists; verifying onchain access keys...`);
  }

  const keyListView = await nearRpcQuery<{
    keys: Array<{
      public_key: string;
      access_key: { permission: string | { FunctionCall: { receiver_id: string; method_names: string[] } } };
    }>;
  }>('query', {
    request_type: 'view_access_key_list',
    finality: 'final',
    account_id: agentId,
  });
  const hasFullAccess = keyListView.keys.some((k) => k.access_key.permission === 'FullAccess');
  if (hasFullAccess) {
    console.warn(
      `WARNING: ${agentId} still holds a FullAccess key! Use a fresh --agent <name>.${ownerId} or delete FullAccess keys before publishing demo credentials.`
    );
  }
  console.log(
    `Verified keys on ${agentId}:`,
    JSON.stringify(
      keyListView.keys.map((k) => ({
        public_key: k.public_key,
        permission: k.access_key.permission,
      }))
    )
  );

  const derived = await deriveVaultEvmAddress(vaultId, 'ethereum-1');
  console.log('\n============================================================');
  console.log('Walp Onchain Provisioning Complete');
  console.log('============================================================');
  console.log(`WALP_VAULT_CONTRACT_ID=${vaultId}`);
  console.log(`WALP_REGISTRY_CONTRACT_ID=${registryId}`);
  console.log(`NEAR_AGENT_ACCOUNT_ID=${agentId}`);
  if (createdScopedKey) {
    console.log(`NEAR_AGENT_PUBLIC_KEY=${createdScopedKey.getPublicKey().toString()}`);
    console.log(`NEAR_AGENT_PRIVATE_KEY=${createdScopedKey.toString()}`);
  } else {
    console.log('NEAR_AGENT_PRIVATE_KEY=(unchanged — kept existing key for existing agent account)');
  }
  console.log(`Derived Vault Sepolia Address (ethereum-1): ${derived.ethAddress}`);
  console.log('Note: Owner private key stays strictly in .env; NEVER publish or commit it.');
}

main().catch((err) => {
  console.error('Setup failed:', err);
  process.exit(1);
});
