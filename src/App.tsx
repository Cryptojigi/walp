import React, { useCallback, useEffect, useState } from 'react';
import { formatEther } from 'ethers';
import { Navbar } from './components/Navbar';
import { AccountCard } from './components/AccountCard';
import { IntentConsole } from './components/IntentConsole';
import { ControlCenter } from './components/ControlCenter';
import { ContractModal } from './components/ContractModal';
import { DEFAULT_DERIVATION_PATH } from './config/constants';
import { WalpApi } from './services/api';
import {
  NearAiModelInfo,
  NearCallOutcome,
  ParsedIntentResponse,
  ServerHealth,
  TxActivityRecord,
  UnsignedTxPayload,
  VaultStatusResponse,
} from './types';
import { AlertTriangle, Terminal } from 'lucide-react';

const STORAGE_CONTRACT_KEY = 'walp_vault_contract_id';
const STORAGE_PATH_KEY = 'walp_derivation_path';
const STORAGE_ACTIVITY_KEY = 'walp_activity_records_v2';

function extractReasonCode(outcome: NearCallOutcome): string {
  if (outcome.result?.reason_code) {
    return outcome.result.reason_code;
  }
  for (const evt of outcome.events) {
    const data = evt.data?.[0];
    if (data && typeof data.reason_code === 'string') {
      return data.reason_code;
    }
  }
  const match = outcome.failureReason?.match(/WALP_[A-Z0-9_]+/);
  return match ? match[0] : outcome.success ? 'WALP_OK' : 'WALP_EXECUTION_ERROR';
}

function classifyOutcome(
  outcome: NearCallOutcome
): TxActivityRecord['outcomeStatus'] {
  if (!outcome.success) {
    return 'BLOCKED_ONCHAIN';
  }
  const status = outcome.result?.status;
  if (status === 'SIGNED') return 'SIGNED';
  if (status === 'PENDING_APPROVAL') return 'PENDING_APPROVAL';
  if (status === 'DENIED') return 'DENIED_ASYNC';
  return 'FAILED';
}

export function App() {
  const [health, setHealth] = useState<ServerHealth | null>(null);
  const [models, setModels] = useState<NearAiModelInfo[]>([]);
  const [vaultContractId, setVaultContractId] = useState<string>(
    () => localStorage.getItem(STORAGE_CONTRACT_KEY) || ''
  );
  const [path, setPath] = useState<string>(
    () => localStorage.getItem(STORAGE_PATH_KEY) || DEFAULT_DERIVATION_PATH
  );
  const [vaultStatus, setVaultStatus] = useState<VaultStatusResponse | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const [isConfigOpen, setIsConfigOpen] = useState(false);

  const [activityRecords, setActivityRecords] = useState<TxActivityRecord[]>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_ACTIVITY_KEY);
      if (saved) return JSON.parse(saved) as TxActivityRecord[];
    } catch {
      // Ignore corrupt local UI log
    }
    return [];
  });

  const refreshVault = useCallback(
    async (targetContractId?: string, targetPath?: string) => {
      const effectiveContract =
        targetContractId !== undefined ? targetContractId : vaultContractId;
      const effectivePath = targetPath !== undefined ? targetPath : path;
      setIsRefreshing(true);
      setServerError(null);
      try {
        const status = await WalpApi.getVaultStatus(
          effectiveContract || undefined,
          effectivePath
        );
        setVaultStatus(status);
      } catch (err) {
        setServerError(err instanceof Error ? err.message : String(err));
      } finally {
        setIsRefreshing(false);
      }
    },
    [vaultContractId, path]
  );

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const [h, m] = await Promise.all([
          WalpApi.getHealth(),
          WalpApi.getAiModels().catch(() => ({ models: [] })),
        ]);
        if (!active) return;
        setHealth(h);
        setModels(m.models);
        const initialContract =
          localStorage.getItem(STORAGE_CONTRACT_KEY) || h.vaultContractId || '';
        if (initialContract && initialContract !== vaultContractId) {
          setVaultContractId(initialContract);
        }
        await refreshVault(initialContract, path);
      } catch (err) {
        if (!active) return;
        setServerError(
          err instanceof Error
            ? `API server unreachable (${err.message}). Start with npm run dev.`
            : 'API server unreachable. Start with npm run dev.'
        );
      }
    })();
    return () => {
      active = false;
    };
    // Initial boot only
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleApplyContractId = (newId: string) => {
    setVaultContractId(newId);
    if (newId) {
      localStorage.setItem(STORAGE_CONTRACT_KEY, newId);
    } else {
      localStorage.removeItem(STORAGE_CONTRACT_KEY);
    }
    void refreshVault(newId, path);
  };

  const handlePathChange = (newPath: string) => {
    setPath(newPath);
    localStorage.setItem(STORAGE_PATH_KEY, newPath);
    void refreshVault(vaultContractId, newPath);
  };

  const handleActivityLogged = ({
    prompt,
    parsed,
    unsigned,
    outcome,
  }: {
    prompt: string;
    parsed: ParsedIntentResponse;
    unsigned: UnsignedTxPayload;
    outcome: NearCallOutcome;
  }) => {
    const entry: TxActivityRecord = {
      id: outcome.txHash || `local-${Date.now()}`,
      timestamp: Date.now(),
      prompt,
      toAddress: parsed.recipient || unsigned.to,
      amountEth: parsed.amountEth,
      chainId: parsed.chainId || unsigned.chainId,
      outcomeStatus: classifyOutcome(outcome),
      reasonCode: extractReasonCode(outcome),
      nearTxHash: outcome.txHash || undefined,
      nearExplorerUrl: outcome.explorerUrl || undefined,
      sepoliaTxHash: outcome.sepoliaBroadcast?.txHash,
      sepoliaExplorerUrl: outcome.sepoliaBroadcast?.explorerUrl,
      events: outcome.events || [],
      detail:
        outcome.result?.detail ||
        outcome.failureReason ||
        outcome.broadcastError ||
        undefined,
    };

    setActivityRecords((prev) => {
      const next = [entry, ...prev].slice(0, 40);
      try {
        localStorage.setItem(STORAGE_ACTIVITY_KEY, JSON.stringify(next));
      } catch {
        // Ignore storage quota issues
      }
      return next;
    });
  };

  const handleOwnerDecisionLogged = ({
    action,
    intent,
    outcome,
  }: {
    action: 'approve' | 'reject';
    intent: { intent_id: string; to: string; value_wei: string; chain_id: number };
    outcome: NearCallOutcome;
  }) => {
    let amountEth = intent.value_wei;
    try {
      amountEth = formatEther(BigInt(intent.value_wei));
    } catch {
      // keep raw wei string
    }
    const entry: TxActivityRecord = {
      id: outcome.txHash || `owner-${action}-${intent.intent_id}-${Date.now()}`,
      timestamp: Date.now(),
      prompt: `Owner ${action} ${intent.intent_id}`,
      toAddress: intent.to,
      amountEth,
      chainId: intent.chain_id,
      outcomeStatus: classifyOutcome(outcome),
      reasonCode: extractReasonCode(outcome),
      nearTxHash: outcome.txHash || undefined,
      nearExplorerUrl: outcome.explorerUrl || undefined,
      sepoliaTxHash: outcome.sepoliaBroadcast?.txHash,
      sepoliaExplorerUrl: outcome.sepoliaBroadcast?.explorerUrl,
      events: outcome.events || [],
      detail:
        outcome.result?.detail ||
        outcome.failureReason ||
        outcome.broadcastError ||
        undefined,
    };

    setActivityRecords((prev) => {
      const next = [entry, ...prev].slice(0, 40);
      try {
        localStorage.setItem(STORAGE_ACTIVITY_KEY, JSON.stringify(next));
      } catch {
        // Ignore storage quota issues
      }
      return next;
    });
  };

  const activeContractId =
    vaultStatus?.contractId || vaultContractId || health?.vaultContractId || '';

  return (
    <div className="min-h-screen bg-[#0d1117] text-[#e6edf3] flex flex-col">
      <Navbar
        vaultContractId={activeContractId}
        paused={Boolean(vaultStatus?.policy?.paused)}
        nearAiConfigured={Boolean(health?.nearAiConfigured)}
        onOpenConfigModal={() => setIsConfigOpen(true)}
      />

      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-6">
        {serverError && (
          <div className="bg-red-950/30 border border-red-700/50 rounded-xl p-4 flex items-start space-x-3 text-xs text-red-200">
            <AlertTriangle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
            <div>
              <p className="font-semibold text-red-300">Backend Server Notice</p>
              <p className="mt-0.5 text-red-200/80">{serverError}</p>
            </div>
          </div>
        )}

        {!activeContractId && !serverError && (
          <div className="bg-amber-950/20 border border-amber-700/40 rounded-xl p-4 flex items-start space-x-3 text-xs text-amber-200">
            <Terminal className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
            <div className="space-y-1">
              <p className="font-semibold text-amber-300">
                No Deployed Vault Contract Selected
              </p>
              <p className="text-amber-200/80">
                Set <code className="font-mono bg-[#0d1117] px-1 py-0.5 rounded">WALP_VAULT_CONTRACT_ID</code> in <code className="font-mono bg-[#0d1117] px-1 py-0.5 rounded">.env</code> or click <strong className="text-white">Vault Config</strong> above. Offline verification runs without credentials via <code className="font-mono bg-[#0d1117] px-1 py-0.5 rounded">cargo test --test sandbox_redteam</code>.
              </p>
            </div>
          </div>
        )}

        <AccountCard
          vaultContractId={activeContractId}
          nearBalance={vaultStatus?.nearBalance || '0'}
          ethAddress={vaultStatus?.ethAddress || ''}
          ethBalance={vaultStatus?.ethBalance || '0'}
          path={path}
          onPathChange={handlePathChange}
          onRefresh={() => void refreshVault()}
          isRefreshing={isRefreshing}
          deployed={Boolean(vaultStatus?.deployed)}
        />

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          <div className="lg:col-span-6">
            <IntentConsole
              derivedEthAddress={vaultStatus?.ethAddress || ''}
              vaultContractId={activeContractId}
              path={path}
              policy={vaultStatus?.policy || null}
              models={models}
              agentConfigured={Boolean(health?.agentAccountConfigured)}
              onActivityLogged={handleActivityLogged}
              onRefreshVault={() => void refreshVault()}
            />
          </div>

          <div className="lg:col-span-6">
            <ControlCenter
              vaultContractId={activeContractId}
              derivedEthAddress={vaultStatus?.ethAddress || ''}
              policy={vaultStatus?.policy || null}
              pendingIntents={vaultStatus?.pendingIntents || []}
              denylist={vaultStatus?.denylist || []}
              allowlist={vaultStatus?.allowlist || []}
              registryEntries={vaultStatus?.registryEntries || []}
              activityRecords={activityRecords}
              ownerSignerConfigured={Boolean(health?.ownerSignerConfigured)}
              onOwnerDecisionLogged={handleOwnerDecisionLogged}
              onRefreshVault={() => void refreshVault()}
            />
          </div>
        </div>
      </main>

      <footer className="border-t border-[#21262d] bg-[#0d1117] py-4 px-4 sm:px-6 lg:px-8 text-xs text-[#8b949e]">
        <div className="max-w-7xl mx-auto flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2">
          <span>
            Walp — Onchain NEAR Rust RLP Firewall + Chain Signatures (<code className="font-mono">v1.signer-prod.testnet</code>)
          </span>
          <span className="font-mono">
            AI: cloud-api.near.ai TEE • 1Click: dry-run quotes only • No browser private keys
          </span>
        </div>
      </footer>

      <ContractModal
        isOpen={isConfigOpen}
        onClose={() => setIsConfigOpen(false)}
        currentContractId={activeContractId}
        onApplyContractId={handleApplyContractId}
        health={health}
      />
    </div>
  );
}

export default App;
