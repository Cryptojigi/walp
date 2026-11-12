import { ONECLICK_API_URL } from '../config.ts';

export interface OneClickToken {
  assetId: string;
  decimals: number;
  blockchain: string;
  symbol: string;
  price?: number;
  priceUpdatedAt?: string;
  contractAddress?: string;
  coingeckoId?: string;
}

export interface OneClickQuoteParams {
  originAsset: string;
  destinationAsset: string;
  amount: string;
  refundTo: string;
  recipient: string;
  slippageTolerance?: number;
}

export interface OneClickQuoteResult {
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

let tokenCache: { expiresAt: number; tokens: OneClickToken[] } | null = null;

export async function getOneClickTokens(search?: string): Promise<OneClickToken[]> {
  if (!tokenCache || Date.now() >= tokenCache.expiresAt) {
    const res = await fetch(`${ONECLICK_API_URL}/v0/tokens`, {
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      throw new Error(`1Click /v0/tokens failed with HTTP ${res.status}`);
    }
    const tokens = (await res.json()) as OneClickToken[];
    tokenCache = { expiresAt: Date.now() + 60_000, tokens };
  }

  const all = tokenCache.tokens;
  if (!search?.trim()) return all;
  const q = search.trim().toLowerCase();
  return all.filter(
    (t) =>
      t.symbol.toLowerCase().includes(q) ||
      t.blockchain.toLowerCase().includes(q) ||
      t.assetId.toLowerCase().includes(q)
  );
}

export async function getOneClickDryQuote(
  params: OneClickQuoteParams,
  maxSlippageBps: number = 300
): Promise<OneClickQuoteResult> {
  if (!params.originAsset || !params.destinationAsset) {
    throw new Error('originAsset and destinationAsset are required');
  }
  if (!/^\d+$/.test(params.amount) || BigInt(params.amount) <= 0n) {
    throw new Error('amount must be a positive integer string in smallest token units');
  }
  if (!params.refundTo?.trim() || !params.recipient?.trim()) {
    throw new Error('refundTo and recipient addresses are required');
  }

  const slippageBps = Number.isFinite(params.slippageTolerance)
    ? Math.max(10, Math.min(2000, Math.floor(params.slippageTolerance!)))
    : 100;

  const deadline = new Date(Date.now() + 30 * 60 * 1000).toISOString();
  const payload = {
    dry: true as const,
    swapType: 'EXACT_INPUT',
    slippageTolerance: slippageBps,
    originAsset: params.originAsset,
    depositType: 'ORIGIN_CHAIN',
    destinationAsset: params.destinationAsset,
    amount: params.amount,
    refundTo: params.refundTo.trim(),
    refundType: 'ORIGIN_CHAIN',
    recipient: params.recipient.trim(),
    recipientType: 'DESTINATION_CHAIN',
    deadline,
  };

  const res = await fetch(`${ONECLICK_API_URL}/v0/quote`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(12_000),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`1Click quote failed (${res.status}): ${text}`);
  }

  const data = (await res.json()) as {
    quote: OneClickQuoteResult['quote'];
    signature?: string;
    correlationId?: string;
    timestamp?: string;
  };

  const warnings: string[] = [];
  if (slippageBps > maxSlippageBps) {
    warnings.push(`Requested slippage ${slippageBps} bps exceeds Walp policy cap ${maxSlippageBps} bps`);
  }
  const inUsd = Number(data.quote?.amountInUsd || 0);
  const outUsd = Number(data.quote?.amountOutUsd || 0);
  if (inUsd > 0 && outUsd > 0 && outUsd < inUsd * 0.9) {
    warnings.push(`Quote output USD ($${outUsd.toFixed(2)}) is >10% below input USD ($${inUsd.toFixed(2)})`);
  }

  return {
    dry: true,
    quote: data.quote,
    slippageBps,
    policyCheck: {
      passed: warnings.length === 0,
      warnings,
    },
    signature: data.signature,
    correlationId: data.correlationId,
    timestamp: data.timestamp,
  };
}
