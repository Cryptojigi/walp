import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { ethers } from 'ethers';
import { loadDotEnv } from '../server/utils/env.ts';
import { SEPOLIA_CHAIN_ID, getServerConfig } from '../server/config.ts';
import {
  VaultPolicy,
  buildUnsignedEip1559Tx,
  callNearView,
  sendNearFunctionCall,
} from '../server/services/vaultClient.ts';

loadDotEnv();

interface VectorOutcome {
  vector: string;
  expected: string;
  passed: boolean;
  observed: string;
  txHash?: string;
  explorerUrl?: string;
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

export async function buildAttackVectors(params: {
  fromAddress: string;
  denylistedTarget: string;
  maxTxWei: bigint;
  thresholdWei: bigint;
}) {
  const cleanRecipient = '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045';
  const tokenAddress = '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238';
  const attackerAddress = '0x000000000000000000000000000000000000dEaD';

  const overMaxWei = params.maxTxWei + ethers.parseEther('1');
  const overMaxEth = ethers.formatEther(overMaxWei);

  // Choose an escalation amount strictly between approval_threshold_wei and max_tx_wei
  let escalateWei = params.thresholdWei + (params.maxTxWei - params.thresholdWei) / 2n;
  if (escalateWei <= params.thresholdWei) {
    escalateWei = params.thresholdWei + 1n;
  }
  const escalateEth = ethers.formatEther(escalateWei);

  // ERC-20 approve(attacker, uint256::MAX)
  const erc20Interface = new ethers.Interface([
    'function approve(address spender, uint256 amount)',
  ]);
  const unlimitedApproveCalldata = erc20Interface.encodeFunctionData('approve', [
    attackerAddress,
    ethers.MaxUint256,
  ]);

  const [v1, v2, v3, v4, v6] = await Promise.all([
    buildUnsignedEip1559Tx({
      fromAddress: params.fromAddress,
      toAddress: cleanRecipient,
      amountEth: overMaxEth,
      chainId: SEPOLIA_CHAIN_ID,
      nonceOverride: 0,
    }),
    buildUnsignedEip1559Tx({
      fromAddress: params.fromAddress,
      toAddress: params.denylistedTarget,
      amountEth: '0.0001',
      chainId: SEPOLIA_CHAIN_ID,
      nonceOverride: 0,
    }),
    buildUnsignedEip1559Tx({
      fromAddress: params.fromAddress,
      toAddress: tokenAddress,
      amountEth: '0',
      calldataHex: unlimitedApproveCalldata,
      chainId: SEPOLIA_CHAIN_ID,
      nonceOverride: 0,
    }),
    buildUnsignedEip1559Tx({
      fromAddress: params.fromAddress,
      toAddress: cleanRecipient,
      amountEth: '0.0001',
      chainId: 1, // Ethereum Mainnet bypass attempt
      nonceOverride: 0,
    }),
    buildUnsignedEip1559Tx({
      fromAddress: params.fromAddress,
      toAddress: cleanRecipient,
      amountEth: escalateEth,
      chainId: SEPOLIA_CHAIN_ID,
      nonceOverride: 0,
    }),
  ]);

  return { v1, v2, v3, v4, v6 };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(`Usage: npx tsx scripts/attack-demo.ts [options]
Options:
  --contract <walp-vault.owner.testnet>   Vault contract ID (or WALP_VAULT_CONTRACT_ID)
  --agent <agent.owner.testnet>           Scoped agent account ID (or NEAR_AGENT_ACCOUNT_ID)
  --key <ed25519:...>                     Scoped FunctionCall key (or NEAR_AGENT_PRIVATE_KEY)
  --print-vectors                         Build & print unsigned attack RLP payloads offline without sending`);
    return;
  }

  const cfg = getServerConfig();
  const contractId = String(args.contract || cfg.vaultContractId || '');
  const agentId = String(args.agent || cfg.agentAccountId || '');
  const agentKey = String(args.key || cfg.agentPrivateKey || '');

  if (args['print-vectors']) {
    const vectors = await buildAttackVectors({
      fromAddress: '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045',
      denylistedTarget: '0xdead000000000000000000000000000000000001',
      maxTxWei: ethers.parseEther('0.05'),
      thresholdWei: ethers.parseEther('0.01'),
    });
    console.log(JSON.stringify(vectors, null, 2));
    return;
  }

  if (!contractId || !agentId || !agentKey) {
    throw new Error(
      'Missing --contract / --agent / --key (or WALP_VAULT_CONTRACT_ID, NEAR_AGENT_ACCOUNT_ID, NEAR_AGENT_PRIVATE_KEY in .env).'
    );
  }

  console.log('============================================================');
  console.log('Walp Red-Team Adversarial Verification Suite (Live Testnet)');
  console.log(`Vault Contract : ${contractId}`);
  console.log(`Scoped Agent   : ${agentId}`);
  console.log('============================================================\n');

  const policy = await callNearView<VaultPolicy>(contractId, 'get_policy', {});
  const denylist = await callNearView<Array<{ address: string }>>(contractId, 'get_denylist', {});
  const denylistedTarget =
    denylist[0]?.address || '0xdead000000000000000000000000000000000001';

  const vectors = await buildAttackVectors({
    fromAddress: '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045',
    denylistedTarget,
    maxTxWei: BigInt(policy.max_tx_wei),
    thresholdWei: BigInt(policy.approval_threshold_wei),
  });

  const results: VectorOutcome[] = [];

  // Vector 1: Over Max Tx with spoofed intent_summary
  {
    const out = await sendNearFunctionCall({
      signerAccountId: agentId,
      signerPrivateKey: agentKey,
      receiverId: contractId,
      methodName: 'request_intent',
      args: {
        raw_tx_hex: vectors.v1.rawTxHex,
        path: 'ethereum-1',
        intent_summary: 'Send 0.0001 ETH',
      },
      gas: '200000000000000',
    });
    const hasDenied = out.events.some(
      (e) => e.event === 'Denied' && e.data[0]?.reason_code === 'WALP_EXCEEDS_MAX_TX'
    );
    const passed = !out.success && (out.failureReason || '').includes('WALP_EXCEEDS_MAX_TX') && hasDenied;
    results.push({
      vector: 'Vector 1 — Over Max Tx (spoofed summary)',
      expected: 'Panic WALP_EXCEEDS_MAX_TX + NEP-297 Denied',
      passed,
      observed: out.failureReason || 'Unexpected success',
      txHash: out.txHash,
      explorerUrl: out.explorerUrl,
    });
  }

  // Vector 2: Denylisted Target
  {
    const out = await sendNearFunctionCall({
      signerAccountId: agentId,
      signerPrivateKey: agentKey,
      receiverId: contractId,
      methodName: 'request_intent',
      args: { raw_tx_hex: vectors.v2.rawTxHex, path: 'ethereum-1' },
      gas: '200000000000000',
    });
    const hasDenied = out.events.some(
      (e) => e.event === 'Denied' && e.data[0]?.reason_code === 'WALP_TARGET_DENYLISTED'
    );
    const passed = !out.success && (out.failureReason || '').includes('WALP_TARGET_DENYLISTED') && hasDenied;
    results.push({
      vector: 'Vector 2 — Denylisted Target',
      expected: 'Panic WALP_TARGET_DENYLISTED + NEP-297 Denied',
      passed,
      observed: out.failureReason || 'Unexpected success',
      txHash: out.txHash,
      explorerUrl: out.explorerUrl,
    });
  }

  // Vector 3: Blocked ERC-20 unlimited approve calldata
  {
    const out = await sendNearFunctionCall({
      signerAccountId: agentId,
      signerPrivateKey: agentKey,
      receiverId: contractId,
      methodName: 'request_intent',
      args: { raw_tx_hex: vectors.v3.rawTxHex, path: 'ethereum-1' },
      gas: '200000000000000',
    });
    const hasDenied = out.events.some(
      (e) => e.event === 'Denied' && e.data[0]?.reason_code === 'WALP_CALLDATA_BLOCKED'
    );
    const passed = !out.success && (out.failureReason || '').includes('WALP_CALLDATA_BLOCKED') && hasDenied;
    results.push({
      vector: 'Vector 3 — Blocked Calldata (ERC-20 Max Approve)',
      expected: 'Panic WALP_CALLDATA_BLOCKED + NEP-297 Denied',
      passed,
      observed: out.failureReason || 'Unexpected success',
      txHash: out.txHash,
      explorerUrl: out.explorerUrl,
    });
  }

  // Vector 4: Wrong Chain Bypass (chain_id = 1)
  {
    const out = await sendNearFunctionCall({
      signerAccountId: agentId,
      signerPrivateKey: agentKey,
      receiverId: contractId,
      methodName: 'request_intent',
      args: { raw_tx_hex: vectors.v4.rawTxHex, path: 'ethereum-1' },
      gas: '200000000000000',
    });
    const hasDenied = out.events.some(
      (e) => e.event === 'Denied' && e.data[0]?.reason_code === 'WALP_UNSUPPORTED_CHAIN'
    );
    const passed = !out.success && (out.failureReason || '').includes('WALP_UNSUPPORTED_CHAIN') && hasDenied;
    results.push({
      vector: 'Vector 4 — Wrong Chain Bypass (chain_id=1)',
      expected: 'Panic WALP_UNSUPPORTED_CHAIN + NEP-297 Denied',
      passed,
      observed: out.failureReason || 'Unexpected success',
      txHash: out.txHash,
      explorerUrl: out.explorerUrl,
    });
  }

  // Vector 5: Protocol Key Escalation (call set_policy with scoped request_intent key)
  {
    let observed = '';
    let passed = false;
    try {
      const out = await sendNearFunctionCall({
        signerAccountId: agentId,
        signerPrivateKey: agentKey,
        receiverId: contractId,
        methodName: 'set_policy',
        args: {
          max_tx_wei: '100000000000000000000',
          daily_limit_wei: '100000000000000000000',
          approval_threshold_wei: '100000000000000000000',
          allowed_chain_ids: [1, 11155111],
        },
        gas: '50000000000000',
      });
      observed = out.success ? 'Unexpected success' : out.failureReason || 'Failed';
      passed =
        !out.success &&
        (observed.includes('MethodNameMismatch') ||
          observed.includes("isn't allowed by the access key") ||
          observed.includes('WALP_UNAUTHORIZED_OWNER_ONLY') ||
          observed.includes('allowed method'));
    } catch (err) {
      const errType =
        typeof err === 'object' && err !== null && 'type' in err
          ? String((err as { type?: unknown }).type || '')
          : '';
      const msg = err instanceof Error ? err.message : String(err);
      observed = errType ? `${errType}: ${msg}` : msg;
      passed =
        errType === 'MethodNameMismatch' ||
        observed.includes('MethodNameMismatch') ||
        observed.includes("isn't allowed by the access key") ||
        observed.includes("doesn't match allowed method names") ||
        observed.includes('InvalidAccessKeyError');
    }
    results.push({
      vector: 'Vector 5 — Protocol Key Escalation (set_policy)',
      expected: 'RPC InvalidAccessKeyError(MethodNameMismatch)',
      passed,
      observed,
    });
  }

  // Vector 6: Safe Threshold Escalation -> PENDING_APPROVAL (MPC NOT called)
  {
    const out = await sendNearFunctionCall<{ intent_id: string; status: string }>({
      signerAccountId: agentId,
      signerPrivateKey: agentKey,
      receiverId: contractId,
      methodName: 'request_intent',
      args: { raw_tx_hex: vectors.v6.rawTxHex, path: 'ethereum-1' },
      gas: '250000000000000',
    });
    const proposed = out.events.some(
      (e) => e.event === 'IntentProposed' && e.data[0]?.reason_code === 'WALP_THRESHOLD_ESCALATED'
    );
    const passed = out.success && out.result?.status === 'PENDING_APPROVAL' && proposed;
    results.push({
      vector: 'Vector 6 — Safe Threshold Escalation',
      expected: 'PENDING_APPROVAL + IntentProposed (MPC skipped)',
      passed,
      observed: out.success ? JSON.stringify(out.result) : out.failureReason || 'Failed',
      txHash: out.txHash,
      explorerUrl: out.explorerUrl,
    });
  }

  for (const r of results) {
    console.log(`[${r.passed ? 'PASS' : 'FAIL'}] ${r.vector}`);
    console.log(`  Expected: ${r.expected}`);
    console.log(`  Observed: ${r.observed}`);
    if (r.explorerUrl) console.log(`  Explorer: ${r.explorerUrl}`);
    console.log('');
  }

  const allPassed = results.every((r) => r.passed);
  if (!allPassed) {
    process.exit(1);
  }
}

const isEntrypoint =
  process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (isEntrypoint) {
  main().catch((err) => {
    console.error('Red-team suite error:', err);
    process.exit(1);
  });
}
