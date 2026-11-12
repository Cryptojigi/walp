export interface ServerHealth {
  ok: boolean;
  nearAiConfigured: boolean;
  vaultContractId: string | null;
  registryContractId: string | null;
  mpcContractId: string;
  agentAccountConfigured: boolean;
  agentAccountId: string | null;
  ownerSignerConfigured: boolean;
  ownerAccountId: string | null;
}

export interface NearAiModelInfo {
  id: string;
  name: string;
  ownedBy: string;
  teeAttested: boolean;
  supportedFeatures: string[];
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

export interface DenylistEntry {
  address: string;
  reason: string;
  reporter: string;
  evidence_hash: string;
  added_at_ns: string;
}

export interface AllowlistEntry {
  address: string;
  label: string;
  added_at_ns: string;
}

export interface RegistryEntry {
  address: string;
  category: string;
  reason: string;
  evidence_hash: string;
  reporter: string;
  added_at_ns: string;
  active: boolean;
}

export interface IntentRecord {
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

export interface VaultStatusResponse {
  deployed: boolean;
  contractId: string | null;
  path?: string;
  message?: string;
  nearAccountExists?: boolean;
  nearBalance?: string;
  derivedPublicKey?: string;
  ethAddress?: string;
  ethBalance?: string;
  deriveError?: string | null;
  vaultError?: string | null;
  policy?: VaultPolicy | null;
  pendingIntents?: IntentRecord[];
  recentIntents?: IntentRecord[];
  denylist?: DenylistEntry[];
  allowlist?: AllowlistEntry[];
  registryEntries?: RegistryEntry[];
}

export interface ParsedIntentResponse {
  action: 'transfer' | 'contract_call' | 'swap_quote' | 'unknown';
  recipient: string;
  amountEth: string;
  chainId: number;
  calldataHex: string;
  injectionSignals: string[];
  reasoning: string;
  confidence: number;
  modelUsed: string;
  teeAttested: boolean;
  parsedBy: 'near-ai-tee' | 'deterministic-fallback';
  requestId?: string;
  warning?: string;
}

export interface UnsignedTxPayload {
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
}

export interface RiskCheckItem {
  id: string;
  label: string;
  status: 'PASS' | 'WARN' | 'BLOCK';
  detail: string;
}

export interface RiskEvaluation {
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
  onchainSimulation: {
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
  } | null;
}

export interface Nep297Event {
  standard: string;
  version: string;
  event: string;
  data: Array<Record<string, unknown>>;
}

export interface NearCallOutcome {
  success: boolean;
  txHash: string;
  explorerUrl: string;
  result: {
    intent_id?: string;
    status?: string;
    reason_code?: string;
    signature?: {
      big_r: string;
      s: string;
      recovery_id: number;
    } | null;
    detail?: string | null;
  } | null;
  failureReason: string | null;
  logs: string[];
  events: Nep297Event[];
  sepoliaBroadcast?: {
    txHash: string;
    explorerUrl: string;
    recoveredFrom: string;
  } | null;
  broadcastError?: string | null;
}

export interface OneClickToken {
  assetId: string;
  decimals: number;
  blockchain: string;
  symbol: string;
  price?: number;
  contractAddress?: string;
}

export interface OneClickQuoteResponse {
  dry: true;
  quote: {
    amountIn: string;
    amountInFormatted: string;
    amountInUsd?: string;
    amountOut: string;
    amountOutFormatted: string;
    amountOutUsd?: string;
    minAmountOut: string;
    timeEstimate?: number;
    refundFee?: string;
    withdrawFee?: string;
  };
  slippageBps: number;
  policyCheck: {
    passed: boolean;
    warnings: string[];
  };
  signature?: string;
  correlationId?: string;
  timestamp?: string;
}

export interface TxActivityRecord {
  id: string;
  timestamp: number;
  prompt: string;
  toAddress: string;
  amountEth: string;
  chainId: number;
  outcomeStatus: 'SIGNED' | 'PENDING_APPROVAL' | 'BLOCKED_ONCHAIN' | 'DENIED_ASYNC' | 'FAILED';
  reasonCode: string;
  nearTxHash?: string;
  nearExplorerUrl?: string;
  sepoliaTxHash?: string;
  sepoliaExplorerUrl?: string;
  events: Nep297Event[];
  detail?: string;
}
