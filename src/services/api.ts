import {
  NearAiModelInfo,
  NearCallOutcome,
  OneClickQuoteResponse,
  OneClickToken,
  ParsedIntentResponse,
  RiskEvaluation,
  ServerHealth,
  UnsignedTxPayload,
  VaultStatusResponse,
} from '../types';

async function apiFetch<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error((data as { error?: string }).error || `Request failed (${res.status})`);
  }
  return data as T;
}

export const WalpApi = {
  getHealth: () => apiFetch<ServerHealth>('/api/health'),

  getAiModels: () => apiFetch<{ models: NearAiModelInfo[] }>('/api/ai/models'),

  parseIntent: (payload: {
    prompt: string;
    derivedEthAddress?: string;
    vaultPolicySummary?: Record<string, unknown>;
    model?: string;
  }) =>
    apiFetch<ParsedIntentResponse>('/api/ai/parse-intent', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  getVaultStatus: (contractId?: string, path: string = 'ethereum-1') => {
    const qs = new URLSearchParams();
    if (contractId) qs.set('contractId', contractId);
    if (path) qs.set('path', path);
    return apiFetch<VaultStatusResponse>(`/api/vault/status?${qs.toString()}`);
  },

  buildUnsignedTx: (payload: {
    fromAddress?: string;
    toAddress: string;
    amountEth: string;
    calldataHex?: string;
    chainId?: number;
  }) =>
    apiFetch<UnsignedTxPayload>('/api/tx/build-unsigned', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  evaluateRisk: (payload: {
    prompt?: string;
    toAddress: string;
    amountEth: string;
    chainId: number;
    calldataHex?: string;
    rawTxHex?: string;
  }) =>
    apiFetch<RiskEvaluation>('/api/risk/evaluate', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  requestIntent: (payload: {
    contractId?: string;
    rawTxHex: string;
    path?: string;
    intentSummary?: string;
    broadcast?: boolean;
    expectedFromAddress?: string;
  }) =>
    apiFetch<NearCallOutcome>('/api/vault/request-intent', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  ownerApprove: (payload: {
    contractId?: string;
    intentId: string;
    rawTxHex?: string;
    broadcast?: boolean;
    expectedFromAddress?: string;
  }) =>
    apiFetch<NearCallOutcome>('/api/vault/owner/approve', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  ownerReject: (payload: { contractId?: string; intentId: string; reason?: string }) =>
    apiFetch<NearCallOutcome>('/api/vault/owner/reject', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  ownerTogglePause: (payload: { contractId?: string; paused: boolean; note?: string }) =>
    apiFetch<NearCallOutcome>('/api/vault/owner/pause', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  ownerDenylist: (payload: {
    contractId?: string;
    action: 'add' | 'remove';
    address: string;
    reason?: string;
  }) =>
    apiFetch<NearCallOutcome>('/api/vault/owner/denylist', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  ownerAllowlist: (payload: {
    contractId?: string;
    action: 'add' | 'remove';
    address: string;
    label?: string;
  }) =>
    apiFetch<NearCallOutcome>('/api/vault/owner/allowlist', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  ownerSetPolicy: (payload: {
    contractId?: string;
    maxTxWei: string;
    dailyLimitWei: string;
    approvalThresholdWei: string;
    allowedChainIds: number[];
  }) =>
    apiFetch<NearCallOutcome>('/api/vault/owner/policy', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  getIntentTokens: (q?: string) => {
    const qs = q ? `?q=${encodeURIComponent(q)}` : '';
    return apiFetch<{ count: number; tokens: OneClickToken[] }>(`/api/intents/tokens${qs}`);
  },

  getIntentQuote: (payload: {
    originAsset: string;
    destinationAsset: string;
    amount: string;
    refundTo: string;
    recipient: string;
    slippageTolerance?: number;
  }) =>
    apiFetch<OneClickQuoteResponse>('/api/intents/quote', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
};
