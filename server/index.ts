import http, { IncomingMessage, ServerResponse } from 'node:http';
import { pathToFileURL } from 'node:url';
import { ethers } from 'ethers';
import { loadDotEnv } from './utils/env.ts';
import { getServerConfig } from './config.ts';
import { listTeeModels, parseIntentWithNearAi } from './services/nearAi.ts';
import { getOneClickDryQuote, getOneClickTokens } from './services/intents.ts';
import { evaluateTransactionRisk } from './services/riskEngine.ts';
import {
  IntentRecordView,
  VaultPolicy,
  assembleAndBroadcastSignedTx,
  buildUnsignedEip1559Tx,
  callNearView,
  deriveVaultEvmAddress,
  getNearAccountBalance,
  getSepoliaEthBalance,
  sendNearFunctionCall,
} from './services/vaultClient.ts';

loadDotEnv();

class HttpError extends Error {
  statusCode: number;
  constructor(statusCode: number, message: string) {
    super(message);
    this.statusCode = statusCode;
  }
}

const rawTxCache = new Map<string, { rawTxHex: string; expectedFromAddress?: string }>();

function cacheRawTx(sighashHex: string, rawTxHex: string, expectedFromAddress?: string): void {
  const key = sighashHex.replace(/^0x/i, '').toLowerCase();
  if (!key) return;
  if (rawTxCache.size >= 500) {
    const oldest = rawTxCache.keys().next().value;
    if (oldest) rawTxCache.delete(oldest);
  }
  rawTxCache.set(key, { rawTxHex, expectedFromAddress });
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const json = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  });
  res.end(json);
}

async function readJsonBody<T = Record<string, unknown>>(req: IncomingMessage): Promise<T> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of req) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buf.length;
    if (total > 256 * 1024) {
      throw new HttpError(413, 'Request payload exceeds 256 KiB limit');
    }
    chunks.push(buf);
  }
  const raw = Buffer.concat(chunks).toString('utf8').trim();
  if (!raw) return {} as T;
  try {
    return JSON.parse(raw) as T;
  } catch {
    throw new HttpError(400, 'Invalid JSON request body');
  }
}

export function createWalpServer(): http.Server {
  return http.createServer(async (req, res) => {
    if (req.method === 'OPTIONS') {
      sendJson(res, 204, {});
      return;
    }

    const url = new URL(req.url || '/', 'http://127.0.0.1');
    const pathname = url.pathname;
    const cfg = getServerConfig();

    try {
      if (req.method === 'GET' && pathname === '/api/health') {
        sendJson(res, 200, {
          ok: true,
          nearAiConfigured: Boolean(cfg.nearAiApiKey),
          vaultContractId: cfg.vaultContractId || null,
          registryContractId: cfg.registryContractId || null,
          mpcContractId: cfg.mpcContractId,
          agentAccountConfigured: Boolean(cfg.agentAccountId && cfg.agentPrivateKey),
          agentAccountId: cfg.agentAccountId || null,
          ownerSignerConfigured: Boolean(cfg.ownerAccountId && cfg.ownerPrivateKey),
          ownerAccountId: cfg.ownerAccountId || null,
        });
        return;
      }

      if (req.method === 'GET' && pathname === '/api/ai/models') {
        const models = await listTeeModels();
        sendJson(res, 200, { models });
        return;
      }

      if (req.method === 'POST' && pathname === '/api/ai/parse-intent') {
        const body = await readJsonBody<{
          prompt?: string;
          derivedEthAddress?: string;
          vaultPolicySummary?: Record<string, unknown>;
          model?: string;
        }>(req);
        if (!body.prompt?.trim()) {
          sendJson(res, 400, { error: 'prompt is required' });
          return;
        }
        const parsed = await parseIntentWithNearAi({
          prompt: body.prompt,
          derivedEthAddress: body.derivedEthAddress,
          vaultPolicySummary: body.vaultPolicySummary,
          model: body.model,
        });
        sendJson(res, 200, parsed);
        return;
      }

      if (req.method === 'GET' && pathname === '/api/vault/status') {
        const contractId = url.searchParams.get('contractId')?.trim() || cfg.vaultContractId;
        const pathParam = url.searchParams.get('path')?.trim() || 'ethereum-1';
        if (!contractId) {
          sendJson(res, 200, {
            deployed: false,
            contractId: null,
            message: 'WALP_VAULT_CONTRACT_ID is not configured yet.',
          });
          return;
        }

        const [balanceInfo, derived] = await Promise.all([
          getNearAccountBalance(contractId),
          deriveVaultEvmAddress(contractId, pathParam).catch((err) => ({
            derivedPublicKey: '',
            ethAddress: '',
            error: err instanceof Error ? err.message : String(err),
          })),
        ]);

        const ethAddress = 'ethAddress' in derived ? derived.ethAddress : '';
        const ethBalance = ethAddress ? await getSepoliaEthBalance(ethAddress) : '0.0000';

        let policy: VaultPolicy | null = null;
        let pendingIntents: IntentRecordView[] = [];
        let recentIntents: IntentRecordView[] = [];
        let denylist: unknown[] = [];
        let allowlist: unknown[] = [];
        let registryEntries: unknown[] = [];
        let vaultError: string | null = null;

        try {
          [policy, pendingIntents, recentIntents, denylist, allowlist] = await Promise.all([
            callNearView<VaultPolicy>(contractId, 'get_policy', {}),
            callNearView<IntentRecordView[]>(contractId, 'get_pending_intents', {}),
            callNearView<IntentRecordView[]>(contractId, 'get_recent_intents', { limit: 25 }),
            callNearView<unknown[]>(contractId, 'get_denylist', {}),
            callNearView<unknown[]>(contractId, 'get_allowlist', {}),
          ]);

          const regId = policy.registry_contract_id || cfg.registryContractId;
          if (regId) {
            registryEntries = await callNearView<unknown[]>(regId, 'list_entries', { limit: 50 }).catch(
              () => []
            );
          }
        } catch (err) {
          vaultError = err instanceof Error ? err.message : String(err);
        }

        sendJson(res, 200, {
          deployed: Boolean(policy),
          contractId,
          path: pathParam,
          nearAccountExists: balanceInfo.exists,
          nearBalance: balanceInfo.availableNear,
          derivedPublicKey: 'derivedPublicKey' in derived ? derived.derivedPublicKey : '',
          ethAddress,
          ethBalance,
          deriveError: 'error' in derived ? derived.error : null,
          vaultError,
          policy,
          pendingIntents,
          recentIntents,
          denylist,
          allowlist,
          registryEntries,
        });
        return;
      }

      if (req.method === 'POST' && pathname === '/api/tx/build-unsigned') {
        const body = await readJsonBody<{
          fromAddress?: string;
          toAddress?: string;
          amountEth?: string;
          calldataHex?: string;
          chainId?: number;
          nonceOverride?: number;
        }>(req);
        if (!body.toAddress) {
          sendJson(res, 400, { error: 'toAddress is required' });
          return;
        }
        const unsigned = await buildUnsignedEip1559Tx({
          fromAddress: body.fromAddress || '',
          toAddress: body.toAddress,
          amountEth: body.amountEth || '0',
          calldataHex: body.calldataHex || '0x',
          chainId: body.chainId,
          nonceOverride: body.nonceOverride,
        });
        cacheRawTx(unsigned.sighashHex, unsigned.rawTxHex, body.fromAddress || undefined);
        sendJson(res, 200, unsigned);
        return;
      }

      if (req.method === 'POST' && pathname === '/api/risk/evaluate') {
        const body = await readJsonBody<{
          prompt?: string;
          toAddress?: string;
          amountEth?: string;
          chainId?: number;
          calldataHex?: string;
          rawTxHex?: string;
        }>(req);
        if (!body.toAddress) {
          sendJson(res, 400, { error: 'toAddress is required' });
          return;
        }
        const evalResult = await evaluateTransactionRisk({
          prompt: body.prompt,
          toAddress: body.toAddress,
          amountEth: body.amountEth || '0',
          chainId: body.chainId ?? 11155111,
          calldataHex: body.calldataHex || '0x',
          rawTxHex: body.rawTxHex,
        });
        sendJson(res, 200, evalResult);
        return;
      }

      if (req.method === 'POST' && pathname === '/api/vault/request-intent') {
        const body = await readJsonBody<{
          contractId?: string;
          rawTxHex?: string;
          path?: string;
          intentSummary?: string;
          broadcast?: boolean;
          expectedFromAddress?: string;
        }>(req);
        const contractId = body.contractId?.trim() || cfg.vaultContractId;
        if (!contractId) {
          sendJson(res, 400, { error: 'WALP_VAULT_CONTRACT_ID is not configured' });
          return;
        }
        if (!body.rawTxHex) {
          sendJson(res, 400, { error: 'rawTxHex is required' });
          return;
        }
        if (!cfg.agentAccountId || !cfg.agentPrivateKey) {
          sendJson(res, 400, {
            error: 'NEAR_AGENT_ACCOUNT_ID and NEAR_AGENT_PRIVATE_KEY are not configured on server',
          });
          return;
        }

        try {
          cacheRawTx(ethers.keccak256(body.rawTxHex), body.rawTxHex, body.expectedFromAddress);
        } catch {
          // Ignore malformed rawTxHex pre-caching; onchain RLP decoder will inspect it.
        }

        const outcome = await sendNearFunctionCall<{
          intent_id: string;
          status: string;
          sighash_hex?: string;
          signature?: { big_r: string; s: string; recovery_id: number } | null;
        }>({
          signerAccountId: cfg.agentAccountId,
          signerPrivateKey: cfg.agentPrivateKey,
          receiverId: contractId,
          methodName: 'request_intent',
          args: {
            raw_tx_hex: body.rawTxHex,
            path: body.path || 'ethereum-1',
            intent_summary: body.intentSummary || '',
          },
          gas: '300000000000000',
          depositYocto: '0',
        });

        let sepoliaBroadcast: {
          txHash: string;
          explorerUrl: string;
          recoveredFrom: string;
        } | null = null;
        let broadcastError: string | null = null;

        if (
          body.broadcast &&
          outcome.success &&
          outcome.result?.status === 'SIGNED' &&
          outcome.result.signature
        ) {
          try {
            sepoliaBroadcast = await assembleAndBroadcastSignedTx({
              rawTxHex: body.rawTxHex,
              signature: outcome.result.signature,
              expectedFromAddress: body.expectedFromAddress,
            });
          } catch (err) {
            broadcastError = err instanceof Error ? err.message : String(err);
          }
        }

        sendJson(res, 200, {
          ...outcome,
          sepoliaBroadcast,
          broadcastError,
        });
        return;
      }

      if (req.method === 'POST' && pathname === '/api/vault/owner/approve') {
        const body = await readJsonBody<{
          contractId?: string;
          intentId?: string;
          rawTxHex?: string;
          broadcast?: boolean;
          expectedFromAddress?: string;
        }>(req);
        const contractId = body.contractId?.trim() || cfg.vaultContractId;
        if (!contractId || !body.intentId) {
          sendJson(res, 400, { error: 'contractId and intentId are required' });
          return;
        }
        if (!cfg.ownerAccountId || !cfg.ownerPrivateKey) {
          sendJson(res, 400, {
            error: 'Owner key not configured in server .env; sign approve_intent from Owner wallet/CLI.',
          });
          return;
        }
        const outcome = await sendNearFunctionCall<{
          status: string;
          sighash_hex?: string;
          signature?: { big_r: string; s: string; recovery_id: number } | null;
        }>({
          signerAccountId: cfg.ownerAccountId,
          signerPrivateKey: cfg.ownerPrivateKey,
          receiverId: contractId,
          methodName: 'approve_intent',
          args: { intent_id: body.intentId },
          gas: '300000000000000',
          depositYocto: '0',
        });

        const sighashKey = outcome.result?.sighash_hex?.replace(/^0x/i, '').toLowerCase() || '';
        const cached = sighashKey ? rawTxCache.get(sighashKey) : undefined;
        const resolvedRawTxHex = body.rawTxHex || cached?.rawTxHex;
        const resolvedExpectedFrom = body.expectedFromAddress || cached?.expectedFromAddress;
        const shouldBroadcast = body.broadcast ?? Boolean(resolvedRawTxHex);

        let sepoliaBroadcast: { txHash: string; explorerUrl: string; recoveredFrom: string } | null = null;
        let broadcastError: string | null = null;
        if (
          shouldBroadcast &&
          resolvedRawTxHex &&
          outcome.success &&
          outcome.result?.status === 'SIGNED' &&
          outcome.result.signature
        ) {
          try {
            sepoliaBroadcast = await assembleAndBroadcastSignedTx({
              rawTxHex: resolvedRawTxHex,
              signature: outcome.result.signature,
              expectedFromAddress: resolvedExpectedFrom,
            });
          } catch (err) {
            broadcastError = err instanceof Error ? err.message : String(err);
          }
        }

        sendJson(res, 200, {
          ...outcome,
          rawTxCached: Boolean(resolvedRawTxHex),
          sepoliaBroadcast,
          broadcastError,
        });
        return;
      }

      if (req.method === 'POST' && pathname === '/api/vault/owner/reject') {
        const body = await readJsonBody<{ contractId?: string; intentId?: string; reason?: string }>(req);
        const contractId = body.contractId?.trim() || cfg.vaultContractId;
        if (!contractId || !body.intentId) {
          sendJson(res, 400, { error: 'contractId and intentId are required' });
          return;
        }
        if (!cfg.ownerAccountId || !cfg.ownerPrivateKey) {
          sendJson(res, 400, {
            error: 'Owner key not configured in server .env; sign reject_intent from Owner wallet/CLI.',
          });
          return;
        }
        const outcome = await sendNearFunctionCall({
          signerAccountId: cfg.ownerAccountId,
          signerPrivateKey: cfg.ownerPrivateKey,
          receiverId: contractId,
          methodName: 'reject_intent',
          args: { intent_id: body.intentId, reason: body.reason || 'Rejected by owner' },
          gas: '50000000000000',
        });
        sendJson(res, 200, outcome);
        return;
      }

      if (req.method === 'POST' && pathname === '/api/vault/owner/pause') {
        const body = await readJsonBody<{ contractId?: string; paused?: boolean; note?: string }>(req);
        const contractId = body.contractId?.trim() || cfg.vaultContractId;
        if (!contractId || typeof body.paused !== 'boolean') {
          sendJson(res, 400, { error: 'contractId and paused boolean are required' });
          return;
        }
        if (!cfg.ownerAccountId || !cfg.ownerPrivateKey) {
          sendJson(res, 400, {
            error: 'Owner key not configured in server .env; sign toggle_pause from Owner wallet/CLI.',
          });
          return;
        }
        const outcome = await sendNearFunctionCall({
          signerAccountId: cfg.ownerAccountId,
          signerPrivateKey: cfg.ownerPrivateKey,
          receiverId: contractId,
          methodName: 'toggle_pause',
          args: { paused: body.paused, note: body.note || null },
          gas: '50000000000000',
        });
        sendJson(res, 200, outcome);
        return;
      }

      if (req.method === 'POST' && pathname === '/api/vault/owner/denylist') {
        const body = await readJsonBody<{
          contractId?: string;
          action?: 'add' | 'remove';
          address?: string;
          reason?: string;
        }>(req);
        const contractId = body.contractId?.trim() || cfg.vaultContractId;
        if (!contractId || !body.address) {
          sendJson(res, 400, { error: 'contractId and address are required' });
          return;
        }
        if (!cfg.ownerAccountId || !cfg.ownerPrivateKey) {
          sendJson(res, 400, { error: 'Owner key not configured in server .env' });
          return;
        }
        const methodName = body.action === 'remove' ? 'remove_denylist' : 'add_denylist';
        const args =
          body.action === 'remove'
            ? { address: body.address }
            : { address: body.address, reason: body.reason || 'Added via Owner dashboard' };
        const outcome = await sendNearFunctionCall({
          signerAccountId: cfg.ownerAccountId,
          signerPrivateKey: cfg.ownerPrivateKey,
          receiverId: contractId,
          methodName,
          args,
          gas: '50000000000000',
        });
        sendJson(res, 200, outcome);
        return;
      }

      if (req.method === 'POST' && pathname === '/api/vault/owner/allowlist') {
        const body = await readJsonBody<{
          contractId?: string;
          action?: 'add' | 'remove';
          address?: string;
          label?: string;
        }>(req);
        const contractId = body.contractId?.trim() || cfg.vaultContractId;
        if (!contractId || !body.address) {
          sendJson(res, 400, { error: 'contractId and address are required' });
          return;
        }
        if (!cfg.ownerAccountId || !cfg.ownerPrivateKey) {
          sendJson(res, 400, { error: 'Owner key not configured in server .env' });
          return;
        }
        const methodName = body.action === 'remove' ? 'remove_allowlist' : 'add_allowlist';
        const args =
          body.action === 'remove'
            ? { address: body.address }
            : { address: body.address, label: body.label || 'Allowlisted target' };
        const outcome = await sendNearFunctionCall({
          signerAccountId: cfg.ownerAccountId,
          signerPrivateKey: cfg.ownerPrivateKey,
          receiverId: contractId,
          methodName,
          args,
          gas: '50000000000000',
        });
        sendJson(res, 200, outcome);
        return;
      }

      if (req.method === 'POST' && pathname === '/api/vault/owner/policy') {
        const body = await readJsonBody<{
          contractId?: string;
          maxTxWei?: string;
          dailyLimitWei?: string;
          approvalThresholdWei?: string;
          allowedChainIds?: number[];
        }>(req);
        const contractId = body.contractId?.trim() || cfg.vaultContractId;
        if (
          !contractId ||
          !body.maxTxWei ||
          !body.dailyLimitWei ||
          !body.approvalThresholdWei ||
          !Array.isArray(body.allowedChainIds)
        ) {
          sendJson(res, 400, { error: 'Missing required policy fields' });
          return;
        }
        if (!cfg.ownerAccountId || !cfg.ownerPrivateKey) {
          sendJson(res, 400, { error: 'Owner key not configured in server .env' });
          return;
        }
        const outcome = await sendNearFunctionCall({
          signerAccountId: cfg.ownerAccountId,
          signerPrivateKey: cfg.ownerPrivateKey,
          receiverId: contractId,
          methodName: 'set_policy',
          args: {
            max_tx_wei: body.maxTxWei,
            daily_limit_wei: body.dailyLimitWei,
            approval_threshold_wei: body.approvalThresholdWei,
            allowed_chain_ids: body.allowedChainIds,
          },
          gas: '50000000000000',
        });
        sendJson(res, 200, outcome);
        return;
      }

      if (req.method === 'GET' && pathname === '/api/intents/tokens') {
        const q = url.searchParams.get('q') || undefined;
        const tokens = await getOneClickTokens(q);
        sendJson(res, 200, { count: tokens.length, tokens });
        return;
      }

      if (req.method === 'POST' && pathname === '/api/intents/quote') {
        const body = await readJsonBody<{
          originAsset?: string;
          destinationAsset?: string;
          amount?: string;
          refundTo?: string;
          recipient?: string;
          slippageTolerance?: number;
        }>(req);
        const quote = await getOneClickDryQuote({
          originAsset: body.originAsset || '',
          destinationAsset: body.destinationAsset || '',
          amount: body.amount || '',
          refundTo: body.refundTo || '',
          recipient: body.recipient || '',
          slippageTolerance: body.slippageTolerance,
        });
        sendJson(res, 200, quote);
        return;
      }

      sendJson(res, 404, { error: `Route not found: ${req.method} ${pathname}` });
    } catch (err) {
      const statusCode = err instanceof HttpError ? err.statusCode : 500;
      sendJson(res, statusCode, {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  });
}

const isEntrypoint =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isEntrypoint) {
  const cfg = getServerConfig();
  const server = createWalpServer();
  server.listen(cfg.port, '127.0.0.1', () => {
    console.log(`[Walp API] Listening on http://127.0.0.1:${cfg.port}`);
    console.log(
      `[Walp API] Vault=${cfg.vaultContractId || '(unconfigured)'} | NEAR_AI=${
        cfg.nearAiApiKey ? 'configured' : 'unset'
      }`
    );
  });
}
