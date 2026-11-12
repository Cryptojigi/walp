import { ethers } from 'ethers';
import { getServerConfig } from '../config.ts';
import { scanPromptInjection } from './nearAi.ts';
import {
  PolicySimulationView,
  VaultPolicy,
  callNearView,
  withSepoliaProvider,
} from './vaultClient.ts';

export interface RiskCheckItem {
  id: string;
  label: string;
  status: 'PASS' | 'WARN' | 'BLOCK';
  detail: string;
}

export interface RiskEvaluationResult {
  verdict: 'ALLOW' | 'WARN' | 'BLOCK';
  reasonCode: string;
  checks: RiskCheckItem[];
  counterparty: {
    address: string;
    isContract: boolean;
    bytecodeSize: number;
    nonce: number | null;
    balanceEth: string | null;
  };
  onchainSimulation: PolicySimulationView | null;
}

const DEFAULT_BLOCKED_SELECTORS = new Set(['0xf2fde38b', '0x3659cfe6', '0x4f1ef286']);

export function inspectEvmCalldataLocal(
  calldataHex: string,
  blockedSelectors: string[] = Array.from(DEFAULT_BLOCKED_SELECTORS)
): { status: 'PASS' | 'WARN' | 'BLOCK'; reasonCode: string; detail: string } {
  const clean = (calldataHex || '0x').trim().toLowerCase();
  if (clean === '0x' || clean === '') {
    return { status: 'PASS', reasonCode: 'NO_CALLDATA', detail: 'Plain native transfer (empty calldata)' };
  }
  if (!/^0x[0-9a-f]+$/.test(clean) || clean.length % 2 !== 0) {
    return { status: 'BLOCK', reasonCode: 'WALP_RLP_INVALID', detail: 'Invalid hex calldata' };
  }
  const byteLen = (clean.length - 2) / 2;
  if (byteLen < 4) {
    return {
      status: 'BLOCK',
      reasonCode: 'WALP_CALLDATA_BLOCKED',
      detail: `Truncated calldata (${byteLen} bytes) shorter than 4-byte selector`,
    };
  }
  const selector = clean.slice(0, 10);
  if (blockedSelectors.map((s) => s.toLowerCase()).includes(selector)) {
    return {
      status: 'BLOCK',
      reasonCode: 'WALP_CALLDATA_BLOCKED',
      detail: `Selector ${selector} is blocked by policy`,
    };
  }
  if (selector === '0x095ea7b3' || selector === '0x39509351') {
    if (byteLen !== 68) {
      return {
        status: 'BLOCK',
        reasonCode: 'WALP_CALLDATA_BLOCKED',
        detail: `Malformed ERC-20 allowance calldata length ${byteLen}`,
      };
    }
    const top16Bytes = clean.slice(2 + 36 * 2, 2 + 52 * 2);
    if (!/^0+$/.test(top16Bytes)) {
      return {
        status: 'BLOCK',
        reasonCode: 'WALP_CALLDATA_BLOCKED',
        detail: `Unlimited or >= 2^128 ERC-20 allowance detected (${selector})`,
      };
    }
    return {
      status: 'WARN',
      reasonCode: 'ERC20_ALLOWANCE_CALL',
      detail: `Bounded ERC-20 allowance call (${selector})`,
    };
  }
  if (selector === '0xa22cb465') {
    if (byteLen !== 68) {
      return { status: 'BLOCK', reasonCode: 'WALP_CALLDATA_BLOCKED', detail: 'Malformed setApprovalForAll calldata' };
    }
    const boolWord = clean.slice(2 + 36 * 2);
    if (!/^0+$/.test(boolWord)) {
      return { status: 'BLOCK', reasonCode: 'WALP_CALLDATA_BLOCKED', detail: 'setApprovalForAll(true) is blocked' };
    }
  }
  return {
    status: 'PASS',
    reasonCode: 'CALLDATA_INSPECTED',
    detail: `Selector ${selector} (${byteLen} bytes) passed calldata safety screen`,
  };
}

export async function evaluateTransactionRisk(params: {
  prompt?: string;
  toAddress: string;
  amountEth: string;
  chainId: number;
  calldataHex?: string;
  rawTxHex?: string;
}): Promise<RiskEvaluationResult> {
  const cfg = getServerConfig();
  const checks: RiskCheckItem[] = [];
  let normalizedTo: string;
  try {
    normalizedTo = ethers.getAddress(params.toAddress).toLowerCase();
  } catch {
    normalizedTo = params.toAddress.toLowerCase();
  }

  // 1. Prompt-injection scan
  const promptHits = params.prompt ? scanPromptInjection(params.prompt) : [];
  if (promptHits.length > 0) {
    checks.push({
      id: 'prompt_scan',
      label: 'Prompt Injection Scanner',
      status: 'WARN',
      detail: `Adversarial phrasing detected (${promptHits.join(', ')}); deterministic policy enforced regardless of AI text.`,
    });
  } else {
    checks.push({
      id: 'prompt_scan',
      label: 'Prompt Injection Scanner',
      status: 'PASS',
      detail: 'No prompt-injection override patterns detected',
    });
  }

  // 2. Calldata scan (refreshed with onchain policy.blocked_selectors when available)
  let calldataCheck = inspectEvmCalldataLocal(params.calldataHex || '0x');
  const calldataCheckIndex = checks.push({
    id: 'calldata',
    label: 'EVM Calldata Screen',
    status: calldataCheck.status,
    detail: calldataCheck.detail,
  }) - 1;

  // 3. Sepolia RPC counterparty intelligence
  let isContract = false;
  let bytecodeSize = 0;
  let nonce: number | null = null;
  let balanceEth: string | null = null;

  if (ethers.isAddress(normalizedTo)) {
    try {
      await withSepoliaProvider(async (provider) => {
        const [code, txCount, bal] = await Promise.all([
          provider.getCode(normalizedTo),
          provider.getTransactionCount(normalizedTo),
          provider.getBalance(normalizedTo),
        ]);
        isContract = code !== '0x';
        bytecodeSize = code.length > 2 ? (code.length - 2) / 2 : 0;
        nonce = txCount;
        balanceEth = Number(ethers.formatEther(bal)).toFixed(4);
      });

      if (isContract) {
        checks.push({
          id: 'counterparty_code',
          label: 'Sepolia Bytecode Check',
          status: 'WARN',
          detail: `Target is a smart contract (${bytecodeSize} bytes); unallowlisted contract calls escalate to Owner.`,
        });
      } else if (nonce === 0 && balanceEth === '0.0000') {
        checks.push({
          id: 'counterparty_history',
          label: 'Sepolia Account History',
          status: 'WARN',
          detail: 'Fresh zero-nonce, zero-balance EOA on Sepolia (possible burner address).',
        });
      } else {
        checks.push({
          id: 'counterparty_history',
          label: 'Sepolia Account History',
          status: 'PASS',
          detail: `Active EOA (nonce=${nonce}, balance=${balanceEth} ETH).`,
        });
      }
    } catch (err) {
      checks.push({
        id: 'counterparty_rpc',
        label: 'Sepolia Counterparty RPC',
        status: 'WARN',
        detail: `Sepolia RPC lookup failed: ${err instanceof Error ? err.message : String(err)}`,
      });
    }
  } else {
    checks.push({
      id: 'address_format',
      label: 'Recipient Address Validation',
      status: 'BLOCK',
      detail: 'Invalid EVM 20-byte recipient address',
    });
  }

  // 4. Onchain walp-vault simulation + shared walp-registry check
  let onchainSimulation: PolicySimulationView | null = null;
  if (cfg.vaultContractId) {
    try {
      const policy = await callNearView<VaultPolicy>(cfg.vaultContractId, 'get_policy', {});
      if (Array.isArray(policy.blocked_selectors)) {
        calldataCheck = inspectEvmCalldataLocal(params.calldataHex || '0x', policy.blocked_selectors);
        checks[calldataCheckIndex] = {
          id: 'calldata',
          label: 'EVM Calldata Screen',
          status: calldataCheck.status,
          detail: calldataCheck.detail,
        };
      }
      if (params.rawTxHex) {
        onchainSimulation = await callNearView<PolicySimulationView>(
          cfg.vaultContractId,
          'simulate_policy_check',
          { raw_tx_hex: params.rawTxHex }
        );
        checks.push({
          id: 'vault_simulate',
          label: 'Onchain walp-vault::simulate_policy_check',
          status: !onchainSimulation.allowed
            ? 'BLOCK'
            : onchainSimulation.requires_approval
              ? 'WARN'
              : 'PASS',
          detail: `${onchainSimulation.reason_code}: ${onchainSimulation.detail}`,
        });
      }

      const regId = policy.registry_contract_id || cfg.registryContractId;
      if (regId && ethers.isAddress(normalizedTo)) {
        try {
          const regCheck = await callNearView<{ blocked: boolean; entry?: { category: string; reason: string } }>(
            regId,
            'check_address',
            { address: normalizedTo }
          );
          checks.push({
            id: 'walp_registry',
            label: `Shared Threat Registry (${regId})`,
            status: regCheck.blocked ? 'BLOCK' : 'PASS',
            detail: regCheck.blocked
              ? `WALP_REGISTRY_DENYLISTED [${regCheck.entry?.category || 'THREAT'}]: ${regCheck.entry?.reason || 'Blocked'}`
              : 'Address clear in shared walp-registry',
          });
        } catch (regErr) {
          checks.push({
            id: 'walp_registry',
            label: `Shared Threat Registry (${regId})`,
            status: policy.registry_fail_closed ? 'BLOCK' : 'WARN',
            detail: `Registry check error (${policy.registry_fail_closed ? 'fail-closed' : 'fail-open'}): ${
              regErr instanceof Error ? regErr.message : String(regErr)
            }`,
          });
        }
      }
    } catch (vaultErr) {
      checks.push({
        id: 'vault_simulate',
        label: 'Onchain walp-vault Check',
        status: 'WARN',
        detail: `Could not reach ${cfg.vaultContractId}: ${
          vaultErr instanceof Error ? vaultErr.message : String(vaultErr)
        }`,
      });
    }
  }

  let verdict: 'ALLOW' | 'WARN' | 'BLOCK' = 'ALLOW';
  let reasonCode = onchainSimulation?.reason_code || 'WALP_WITHIN_AUTONOMOUS_POLICY';
  if (checks.some((c) => c.status === 'BLOCK')) {
    verdict = 'BLOCK';
    const firstBlock = checks.find((c) => c.status === 'BLOCK');
    if (firstBlock?.id === 'address_format') reasonCode = 'WALP_RLP_INVALID';
    else if (firstBlock?.id === 'walp_registry') reasonCode = 'WALP_REGISTRY_DENYLISTED';
    else if (calldataCheck.status === 'BLOCK') reasonCode = calldataCheck.reasonCode;
    else if (onchainSimulation && !onchainSimulation.allowed) reasonCode = onchainSimulation.reason_code;
  } else if (checks.some((c) => c.status === 'WARN')) {
    verdict = 'WARN';
    if (onchainSimulation?.requires_approval) reasonCode = onchainSimulation.reason_code;
  }

  return {
    verdict,
    reasonCode,
    checks,
    counterparty: {
      address: normalizedTo,
      isContract,
      bytecodeSize,
      nonce,
      balanceEth,
    },
    onchainSimulation,
  };
}
