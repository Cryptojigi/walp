import { ethers } from 'ethers';
import * as nearAPI from 'near-api-js';
import {
  NEAR_EXPLORER_URL,
  SEPOLIA_CHAIN_ID,
  SEPOLIA_EXPLORER_URL,
  getServerConfig,
} from '../config.ts';

const BASE58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const BASE58_MAP: Record<string, number> = Object.fromEntries(
  Array.from(BASE58_ALPHABET).map((ch, i) => [ch, i])
);

export function decodeBase58(input: string): Uint8Array {
  if (!input) return new Uint8Array(0);
  const bytes: number[] = [0];
  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    const val = BASE58_MAP[ch];
    if (val === undefined) {
      throw new Error(`Invalid Base58 character: ${ch}`);
    }
    for (let j = 0; j < bytes.length; j++) bytes[j] *= 58;
    bytes[0] += val;
    let carry = 0;
    for (let j = 0; j < bytes.length; j++) {
      bytes[j] += carry;
      carry = bytes[j] >> 8;
      bytes[j] &= 0xff;
    }
    while (carry > 0) {
      bytes.push(carry & 0xff);
      carry >>= 8;
    }
  }
  for (let i = 0; i < input.length && input[i] === '1'; i++) {
    bytes.push(0);
  }
  return new Uint8Array(bytes.reverse());
}

export interface Nep297Log {
  standard: string;
  version: string;
  event: string;
  data: Array<Record<string, unknown>>;
}

export interface NearCallOutcome<T = unknown> {
  success: boolean;
  txHash: string;
  explorerUrl: string;
  result: T | null;
  failureReason: string | null;
  logs: string[];
  events: Nep297Log[];
}

export interface VaultPolicy {
  owner_id: string;
  mpc_contract_id: string;
  registry_contract_id: string | null;
  registry_fail_closed: boolean;
  paused: boolean;
  max_tx_wei: string;
  daily_limit_wei: string;
  spent_today_wei: string;
  last_reset_ns: string;
  approval_threshold_wei: string;
  allowed_chain_ids: number[];
  blocked_selectors: string[];
  next_intent_seq: number;
}

export interface IntentRecordView {
  intent_id: string;
  proposer: string;
  chain_id: number;
  to: string;
  value_wei: string;
  sighash_hex: string;
  calldata_selector: string;
  path: string;
  intent_summary: string;
  requires_approval: boolean;
  reason_code: string;
  status: string;
  created_at_ns: string;
  updated_at_ns: string;
  signature?: {
    big_r: string;
    s: string;
    recovery_id: number;
  } | null;
  detail?: string | null;
}

export interface PolicySimulationView {
  allowed: boolean;
  requires_approval: boolean;
  reason_code: string;
  detail: string;
  chain_id?: number | null;
  to?: string | null;
  value_wei?: string | null;
  sighash_hex?: string | null;
  calldata_selector?: string | null;
  check_registry: boolean;
}

export async function nearRpcQuery<T>(method: string, params: Record<string, unknown>): Promise<T> {
  const cfg = getServerConfig();
  let lastError: unknown;
  for (const url of cfg.nearRpcUrls) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 'walp', method, params }),
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) {
        throw new Error(`NEAR RPC ${url} HTTP ${res.status}`);
      }
      const json = (await res.json()) as { result?: T; error?: { message?: string; data?: unknown } };
      if (json.error) {
        throw new Error(
          `NEAR RPC error: ${json.error.message || JSON.stringify(json.error.data || json.error)}`
        );
      }
      if (json.result === undefined) {
        throw new Error(`NEAR RPC ${url} returned empty result`);
      }
      return json.result;
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

export async function callNearView<T>(
  accountId: string,
  methodName: string,
  args: Record<string, unknown> = {}
): Promise<T> {
  const argsBase64 = Buffer.from(JSON.stringify(args), 'utf8').toString('base64');
  const res = await nearRpcQuery<{ result: number[] }>('query', {
    request_type: 'call_function',
    finality: 'final',
    account_id: accountId,
    method_name: methodName,
    args_base64: argsBase64,
  });
  const text = Buffer.from(res.result).toString('utf8');
  return JSON.parse(text) as T;
}

export async function getNearAccountBalance(
  accountId: string
): Promise<{ exists: boolean; availableNear: string; availableYocto: string; codeHash?: string }> {
  if (!accountId) return { exists: false, availableNear: '0.000', availableYocto: '0' };
  try {
    const view = await nearRpcQuery<{ amount: string; storage_usage: number; code_hash?: string }>('query', {
      request_type: 'view_account',
      finality: 'final',
      account_id: accountId,
    });
    const formatted = nearAPI.utils.format.formatNearAmount(view.amount, 3);
    return {
      exists: true,
      availableNear: formatted,
      availableYocto: view.amount,
      codeHash: view.code_hash,
    };
  } catch {
    return { exists: false, availableNear: '0.000', availableYocto: '0' };
  }
}

export async function withSepoliaProvider<T>(
  fn: (provider: ethers.JsonRpcProvider, rpcUrl: string) => Promise<T>
): Promise<T> {
  const cfg = getServerConfig();
  let lastError: unknown;
  for (const url of cfg.sepoliaRpcUrls) {
    try {
      const provider = new ethers.JsonRpcProvider(
        url,
        { chainId: SEPOLIA_CHAIN_ID, name: 'sepolia' },
        { staticNetwork: true }
      );
      return await fn(provider, url);
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

export async function deriveVaultEvmAddress(
  predecessorAccountId: string,
  path: string = 'ethereum-1'
): Promise<{ derivedPublicKey: string; ethAddress: string }> {
  const cfg = getServerConfig();
  const cleanKey = await callNearView<string>(cfg.mpcContractId, 'derived_public_key', {
    path,
    predecessor: predecessorAccountId,
  });
  const base58Part = cleanKey.replace(/^secp256k1:/, '');
  const rawBytes = decodeBase58(base58Part);
  if (rawBytes.length !== 64) {
    throw new Error(`Unexpected derived_public_key byte length: ${rawBytes.length}`);
  }
  const keccak = ethers.keccak256(rawBytes);
  const ethAddress = ethers.getAddress(`0x${keccak.slice(-40)}`);
  return { derivedPublicKey: cleanKey, ethAddress };
}

export async function getSepoliaEthBalance(address: string): Promise<string> {
  if (!address || !ethers.isAddress(address)) return '0.0000';
  try {
    const wei = await withSepoliaProvider((p) => p.getBalance(address));
    return Number(ethers.formatEther(wei)).toFixed(4);
  } catch {
    return '0.0000';
  }
}

export async function buildUnsignedEip1559Tx(params: {
  fromAddress: string;
  toAddress: string;
  amountEth: string;
  calldataHex?: string;
  chainId?: number;
  nonceOverride?: number;
}): Promise<{
  rawTxHex: string;
  sighashHex: string;
  chainId: number;
  to: string;
  valueWei: string;
  nonce: number;
  gasLimit: string;
  maxFeePerGas: string;
  maxPriorityFeePerGas: string;
  data: string;
}> {
  const chainId = params.chainId ?? SEPOLIA_CHAIN_ID;
  const to = ethers.getAddress(params.toAddress);
  const valueWei = ethers.parseEther(params.amountEth || '0');
  const data = params.calldataHex && params.calldataHex !== '' ? params.calldataHex : '0x';

  let nonce = params.nonceOverride ?? 0;
  let maxFeePerGas = ethers.parseUnits('15', 'gwei');
  let maxPriorityFeePerGas = ethers.parseUnits('1.5', 'gwei');
  let gasLimit = data !== '0x' ? 75_000n : 21_000n;

  if (chainId === SEPOLIA_CHAIN_ID && params.fromAddress && ethers.isAddress(params.fromAddress)) {
    try {
      await withSepoliaProvider(async (provider) => {
        const [fetchedNonce, feeData] = await Promise.all([
          params.nonceOverride !== undefined
            ? Promise.resolve(params.nonceOverride)
            : provider.getTransactionCount(params.fromAddress, 'pending'),
          provider.getFeeData(),
        ]);
        nonce = fetchedNonce;
        if (feeData.maxFeePerGas) maxFeePerGas = feeData.maxFeePerGas;
        if (feeData.maxPriorityFeePerGas) maxPriorityFeePerGas = feeData.maxPriorityFeePerGas;
        if (data !== '0x') {
          try {
            const est = await provider.estimateGas({
              from: params.fromAddress,
              to,
              value: valueWei,
              data,
            });
            gasLimit = (est * 120n) / 100n;
          } catch {
            gasLimit = 75_000n;
          }
        }
      });
    } catch {
      // Allow offline/synthetic tx building with safe defaults if RPC temporarily unavailable
    }
  }

  const tx = new ethers.Transaction();
  tx.type = 2;
  tx.chainId = BigInt(chainId);
  tx.nonce = nonce;
  tx.maxPriorityFeePerGas = maxPriorityFeePerGas;
  tx.maxFeePerGas = maxFeePerGas;
  tx.gasLimit = gasLimit;
  tx.to = to;
  tx.value = valueWei;
  tx.data = data;

  const rawTxHex = tx.unsignedSerialized;
  const sighashHex = ethers.keccak256(rawTxHex).slice(2);

  return {
    rawTxHex,
    sighashHex,
    chainId,
    to,
    valueWei: valueWei.toString(),
    nonce,
    gasLimit: gasLimit.toString(),
    maxFeePerGas: maxFeePerGas.toString(),
    maxPriorityFeePerGas: maxPriorityFeePerGas.toString(),
    data,
  };
}

export function assembleSignedTx(params: {
  rawTxHex: string;
  signature: { big_r: string; s: string; recovery_id: number };
  expectedFromAddress?: string;
}): { signedRawHex: string; recoveredFrom: string; txHash: string } {
  const tx = ethers.Transaction.from(params.rawTxHex);
  const cleanR = params.signature.big_r.replace(/^0x/i, '');
  let rHex: string;
  if (cleanR.length === 64) {
    rHex = cleanR;
  } else if (cleanR.length === 66 && (cleanR.startsWith('02') || cleanR.startsWith('03'))) {
    rHex = cleanR.slice(2);
  } else if (cleanR.length === 130 && cleanR.startsWith('04')) {
    rHex = cleanR.slice(2, 66);
  } else {
    throw new Error(`Invalid secp256k1 big_r format (length=${cleanR.length})`);
  }
  const sHex = params.signature.s.replace(/^0x/i, '');
  if (!/^[a-fA-F0-9]{1,64}$/.test(rHex) || !/^[a-fA-F0-9]{1,64}$/.test(sHex)) {
    throw new Error('Invalid hex scalar in MPC signature');
  }
  const r = `0x${rHex.padStart(64, '0')}`;
  const s = `0x${sHex.padStart(64, '0')}`;
  if (params.signature.recovery_id !== 0 && params.signature.recovery_id !== 1) {
    throw new Error(`Invalid secp256k1 recovery_id: ${params.signature.recovery_id}`);
  }
  tx.signature = ethers.Signature.from({
    r,
    s,
    yParity: params.signature.recovery_id,
  });

  const recoveredFrom = tx.from || '';
  if (
    params.expectedFromAddress &&
    recoveredFrom.toLowerCase() !== params.expectedFromAddress.toLowerCase()
  ) {
    throw new Error(
      `Signature sender mismatch: recovered ${recoveredFrom}, expected derived vault ${params.expectedFromAddress}`
    );
  }

  return {
    signedRawHex: tx.serialized,
    recoveredFrom,
    txHash: tx.hash || ethers.keccak256(tx.serialized),
  };
}

export async function assembleAndBroadcastSignedTx(params: {
  rawTxHex: string;
  signature: { big_r: string; s: string; recovery_id: number };
  expectedFromAddress?: string;
}): Promise<{ txHash: string; explorerUrl: string; signedRawHex: string; recoveredFrom: string }> {
  const { signedRawHex, recoveredFrom } = assembleSignedTx(params);
  const txResponse = await withSepoliaProvider((provider) => provider.broadcastTransaction(signedRawHex));
  return {
    txHash: txResponse.hash,
    explorerUrl: `${SEPOLIA_EXPLORER_URL}/tx/${txResponse.hash}`,
    signedRawHex,
    recoveredFrom,
  };
}

export function extractNep297Events(logs: string[]): Nep297Log[] {
  const out: Nep297Log[] = [];
  for (const line of logs) {
    if (!line.startsWith('EVENT_JSON:')) continue;
    try {
      const parsed = JSON.parse(line.slice('EVENT_JSON:'.length)) as Nep297Log;
      if (parsed && typeof parsed.event === 'string' && Array.isArray(parsed.data)) {
        out.push(parsed);
      }
    } catch {
      // Ignore non-JSON log lines
    }
  }
  return out;
}

interface NearJsonRpcError {
  name?: string;
  code?: number;
  message?: string;
  data?: unknown;
  cause?: { name?: string; info?: unknown };
}

export interface NearFinalExecutionOutcome {
  status?: { SuccessValue?: string; Failure?: unknown } | string;
  final_execution_status?: string;
  transaction_outcome?: { id?: string; outcome?: { logs?: string[] } };
  receipts_outcome?: Array<{ outcome?: { logs?: string[]; status?: unknown } }>;
}

export interface SendNearActionsParams {
  signerAccountId: string;
  signerPrivateKey: string;
  receiverId: string;
  actions: nearAPI.transactions.Action[];
  timeoutMs?: number;
}

async function nearRpcRawPost<T>(
  url: string,
  method: string,
  params: Record<string, unknown> | unknown[],
  timeoutMs: number = 15_000
): Promise<{ result?: T; error?: NearJsonRpcError }> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 'walp', method, params }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const text = await res.text();
  let parsed: { result?: T; error?: NearJsonRpcError };
  try {
    parsed = JSON.parse(text) as { result?: T; error?: NearJsonRpcError };
  } catch {
    throw new Error(`NEAR RPC ${url} HTTP ${res.status}: ${text.slice(0, 200)}`);
  }
  if (!res.ok && !parsed.error) {
    throw new Error(`NEAR RPC ${url} HTTP ${res.status}`);
  }
  return parsed;
}

function formatNearRpcError(err: NearJsonRpcError): string {
  const causePart = err.cause?.name ? `${err.cause.name}: ` : '';
  const dataPart =
    typeof err.data === 'string'
      ? err.data
      : err.data !== undefined
        ? JSON.stringify(err.data)
        : err.message || 'Unknown NEAR RPC error';
  return `${causePart}${dataPart}`;
}

function isTransientPendingRpcError(serializedErr: string, rawData: unknown): boolean {
  return (
    rawData === 'Timeout' ||
    serializedErr.includes('TIMEOUT_ERROR') ||
    serializedErr.includes('NOT_OBSERVED') ||
    serializedErr.includes('UNKNOWN_TRANSACTION') ||
    serializedErr.includes('Timeout')
  );
}

function isOutcomeFinal(outcome: NearFinalExecutionOutcome | undefined): outcome is NearFinalExecutionOutcome {
  if (!outcome || typeof outcome.status !== 'object' || outcome.status === null) {
    return false;
  }
  const hasTerminalStatus = 'SuccessValue' in outcome.status || 'Failure' in outcome.status;
  if (!hasTerminalStatus) return false;
  return !outcome.final_execution_status || outcome.final_execution_status === 'FINAL';
}

async function probeSubmittedTx(
  txHash: string,
  signerAccountId: string,
  rpcUrls: string[]
): Promise<NearFinalExecutionOutcome | null> {
  for (const url of rpcUrls) {
    try {
      const resp = await nearRpcRawPost<NearFinalExecutionOutcome>(
        url,
        'tx',
        { tx_hash: txHash, sender_account_id: signerAccountId, wait_until: 'NONE' },
        5_000
      );
      if (resp.result) return resp.result;
    } catch {
      // ignore probe transport failures
    }
  }
  return null;
}

async function pollNearTxFinality(
  txHash: string,
  signerAccountId: string,
  rpcUrls: string[],
  timeoutMs: number
): Promise<NearFinalExecutionOutcome> {
  const deadline = Date.now() + timeoutMs;
  let lastNote = 'pending finality';
  let idx = 0;

  while (Date.now() < deadline) {
    const url = rpcUrls[idx % rpcUrls.length];
    idx++;
    try {
      const resp = await nearRpcRawPost<NearFinalExecutionOutcome>(
        url,
        'tx',
        { tx_hash: txHash, sender_account_id: signerAccountId, wait_until: 'FINAL' },
        12_000
      );
      if (isOutcomeFinal(resp.result)) {
        return resp.result;
      }
      if (resp.error) {
        const serialized = JSON.stringify(resp.error);
        lastNote = formatNearRpcError(resp.error);
        if (!isTransientPendingRpcError(serialized, resp.error.data)) {
          throw new Error(`NEAR tx status error for ${txHash}: ${lastNote}`);
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.startsWith('NEAR tx status error')) throw err;
      lastNote = msg;
    }
    await new Promise((resolve) => setTimeout(resolve, 1_200));
  }

  throw new Error(
    `Timed out waiting for NEAR transaction finality (${txHash}): ${lastNote}. Check ${NEAR_EXPLORER_URL}/tx/${txHash}`
  );
}

export function parseNearOutcome<T = unknown>(
  txHash: string,
  outcome: NearFinalExecutionOutcome
): NearCallOutcome<T> {
  const resolvedTxHash = outcome.transaction_outcome?.id || txHash;
  const allLogs: string[] = [
    ...(outcome.transaction_outcome?.outcome?.logs || []),
    ...(outcome.receipts_outcome || []).flatMap((r) => r.outcome?.logs || []),
  ];
  const events = extractNep297Events(allLogs);

  const statusObj =
    typeof outcome.status === 'object' && outcome.status !== null
      ? (outcome.status as { SuccessValue?: string; Failure?: unknown })
      : null;

  if (statusObj && 'Failure' in statusObj && statusObj.Failure) {
    return {
      success: false,
      txHash: resolvedTxHash,
      explorerUrl: `${NEAR_EXPLORER_URL}/tx/${resolvedTxHash}`,
      result: null,
      failureReason: JSON.stringify(statusObj.Failure),
      logs: allLogs,
      events,
    };
  }

  let decodedResult: T | null = null;
  if (statusObj && typeof statusObj.SuccessValue === 'string' && statusObj.SuccessValue.length > 0) {
    const rawJson = Buffer.from(statusObj.SuccessValue, 'base64').toString('utf8');
    if (rawJson) {
      decodedResult = JSON.parse(rawJson) as T;
    }
  }

  return {
    success: true,
    txHash: resolvedTxHash,
    explorerUrl: `${NEAR_EXPLORER_URL}/tx/${resolvedTxHash}`,
    result: decodedResult,
    failureReason: null,
    logs: allLogs,
    events,
  };
}

/**
 * Signs a NEAR transaction once per nonce and broadcasts with `wait_until: 'INCLUDED'`,
 * then polls for `FINAL` finality so cross-shard contract deploys and async MPC callbacks
 * never fail with `FailoverRpcProvider` `RetriesExceeded` or double-submit nonces.
 */
export async function sendNearActions<T = unknown>(
  params: SendNearActionsParams
): Promise<NearCallOutcome<T>> {
  const cfg = getServerConfig();
  const keyStore = new nearAPI.keyStores.InMemoryKeyStore();
  const keyPair = nearAPI.KeyPair.fromString(
    params.signerPrivateKey as Parameters<typeof nearAPI.KeyPair.fromString>[0]
  );
  await keyStore.setKey('testnet', params.signerAccountId, keyPair);
  const signer = new nearAPI.InMemorySigner(keyStore);
  const publicKeyStr = keyPair.getPublicKey().toString();
  const rpcUrls = cfg.nearRpcUrls;
  const timeoutMs = params.timeoutMs ?? 75_000;

  let lastError: unknown;

  for (let nonceAttempt = 0; nonceAttempt < 3; nonceAttempt++) {
    const [accessKeyView, blockView] = await Promise.all([
      nearRpcQuery<{ nonce: number | string }>('query', {
        request_type: 'view_access_key',
        finality: 'optimistic',
        account_id: params.signerAccountId,
        public_key: publicKeyStr,
      }),
      nearRpcQuery<{ header: { hash: string } }>('block', { finality: 'final' }),
    ]);

    const nonce = BigInt(accessKeyView.nonce || 0) + 1n;
    const recentBlockHash = nearAPI.utils.serialize.base_decode(blockView.header.hash);
    const [txHashBytes, signedTx] = await nearAPI.transactions.signTransaction(
      params.receiverId,
      nonce,
      params.actions,
      recentBlockHash,
      signer,
      params.signerAccountId,
      'testnet'
    );
    const txHash = nearAPI.utils.serialize.base_encode(txHashBytes);
    const signedTxBase64 = Buffer.from(nearAPI.transactions.encodeTransaction(signedTx)).toString(
      'base64'
    );

    let acceptedOutcome: NearFinalExecutionOutcome | null = null;
    let shouldRetryFreshNonce = false;

    for (let i = 0; i < rpcUrls.length; i++) {
      const url = rpcUrls[i];
      try {
        const resp = await nearRpcRawPost<NearFinalExecutionOutcome>(
          url,
          'send_tx',
          { signed_tx_base64: signedTxBase64, wait_until: 'INCLUDED' },
          20_000
        );
        if (resp.result) {
          acceptedOutcome = resp.result;
          break;
        }
        if (resp.error) {
          const serialized = JSON.stringify(resp.error);
          if (serialized.includes('InvalidNonce') || serialized.includes('Expired')) {
            const existing = await probeSubmittedTx(txHash, params.signerAccountId, rpcUrls);
            if (existing) {
              acceptedOutcome = existing;
              break;
            }
            lastError = new Error(formatNearRpcError(resp.error));
            shouldRetryFreshNonce = true;
            break;
          }
          if (isTransientPendingRpcError(serialized, resp.error.data)) {
            const existing = await probeSubmittedTx(txHash, params.signerAccountId, rpcUrls);
            if (existing) {
              acceptedOutcome = existing;
              break;
            }
            lastError = new Error(formatNearRpcError(resp.error));
            continue;
          }
          throw new Error(formatNearRpcError(resp.error));
        }
      } catch (err) {
        const isTransportOrTimeout =
          err instanceof Error &&
          (err.name === 'TimeoutError' ||
            err.name === 'AbortError' ||
            /timeout|abort|fetch failed|HTTP 5|HTTP 408|ECONN|ENOTFOUND|ETIMEDOUT/i.test(
              err.message
            ));
        if (!isTransportOrTimeout) {
          throw err;
        }
        lastError = err;
        const existing = await probeSubmittedTx(txHash, params.signerAccountId, rpcUrls);
        if (existing) {
          acceptedOutcome = existing;
          break;
        }
      }
    }

    if (acceptedOutcome) {
      const finalOutcome = isOutcomeFinal(acceptedOutcome)
        ? acceptedOutcome
        : await pollNearTxFinality(txHash, params.signerAccountId, rpcUrls, timeoutMs);
      return parseNearOutcome<T>(txHash, finalOutcome);
    }

    if (!shouldRetryFreshNonce) {
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 600));
  }

  throw lastError instanceof Error
    ? lastError
    : new Error(String(lastError || 'NEAR transaction submission failed across all configured RPC URLs'));
}

export async function sendNearFunctionCall<T = unknown>(params: {
  signerAccountId: string;
  signerPrivateKey: string;
  receiverId: string;
  methodName: string;
  args: Record<string, unknown>;
  gas?: string;
  depositYocto?: string;
}): Promise<NearCallOutcome<T>> {
  const action = nearAPI.transactions.functionCall(
    params.methodName,
    params.args,
    BigInt(params.gas || '300000000000000'),
    BigInt(params.depositYocto || '0')
  );
  return sendNearActions<T>({
    signerAccountId: params.signerAccountId,
    signerPrivateKey: params.signerPrivateKey,
    receiverId: params.receiverId,
    actions: [action],
  });
}
