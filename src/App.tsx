import React, { useCallback, useEffect, useState } from 'react';
import { formatEther } from 'ethers';
import { Navbar, AppView, ThemeMode } from './components/Navbar';
import { LandingOverview } from './components/LandingOverview';
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
const STORAGE_THEME_KEY = 'walp_theme_mode';

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
  const [theme, setTheme] = useState<ThemeMode>(() => {
    const saved = localStorage.getItem(STORAGE_THEME_KEY);
    return saved === 'dark' ? 'dark' : 'light';
  });
  const [activeView, setActiveView] = useState<AppView>(() =>
    window.location.hash === '#console' ? 'console' : 'overview'
  );
  const [pendingPresetId, setPendingPresetId] = useState<string | null>(null);

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

  useEffect(() => {
    const root = document.documentElement;
    if (theme === 'dark') {
      root.classList.add('dark');
    } else {
      root.classList.remove('dark');
    }
    localStorage.setItem(STORAGE_THEME_KEY, theme);
  }, [theme]);

  const handleChangeView = (view: AppView) => {
    setActiveView(view);
    window.history.replaceState(null, '', view === 'console' ? '#console' : '#overview');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleOpenConsole = (presetId?: string) => {
    if (presetId) {
      setPendingPresetId(presetId);
    }
    handleChangeView('console');
  };

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
    <div className="min-h-screen bg-[#f5f5f7] text-[#1d1d1f] dark:bg-black dark:text-[#f5f5f7] flex flex-col overflow-x-hidden">
      <Navbar
        vaultContractId={activeContractId}
        paused={Boolean(vaultStatus?.policy?.paused)}
        nearAiConfigured={Boolean(health?.nearAiConfigured)}
        activeView={activeView}
        onChangeView={handleChangeView}
        theme={theme}
        onToggleTheme={() => setTheme((prev) => (prev === 'dark' ? 'light' : 'dark'))}
        onOpenConfigModal={() => setIsConfigOpen(true)}
      />

      <main className="flex-1 max-w-6xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-6 min-w-0">
        {serverError && (
          <div className="rounded-2xl bg-[#ff3b30]/10 border border-[#ff3b30]/25 p-4 flex items-start gap-3 text-xs text-[#c92a22] dark:text-[#ff8a80]">
            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
            <div className="min-w-0">
              <p className="font-semibold">Backend Server Notice</p>
              <p className="mt-0.5 opacity-90 break-words">{serverError}</p>
            </div>
          </div>
        )}

        {!activeContractId && !serverError && (
          <div className="rounded-2xl bg-amber-500/10 border border-amber-500/25 p-4 flex items-start gap-3 text-xs text-amber-800 dark:text-amber-300">
            <Terminal className="w-4 h-4 shrink-0 mt-0.5" />
            <div className="space-y-1 min-w-0">
              <p className="font-semibold">No Deployed Vault Contract Selected</p>
              <p className="opacity-90 break-words">
                Set <code className="font-mono px-1 py-0.5 rounded bg-black/[0.06] dark:bg-white/[0.1]">WALP_VAULT_CONTRACT_ID</code> in <code className="font-mono px-1 py-0.5 rounded bg-black/[0.06] dark:bg-white/[0.1]">.env</code> or tap Vault Config above.
              </p>
            </div>
          </div>
        )}

        {activeView === 'overview' ? (
          <LandingOverview onOpenConsole={handleOpenConsole} />
        ) : (
          <div className="space-y-6 min-w-0">
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
              <div className="lg:col-span-6 min-w-0">
                <IntentConsole
                  derivedEthAddress={vaultStatus?.ethAddress || ''}
                  vaultContractId={activeContractId}
                  path={path}
                  policy={vaultStatus?.policy || null}
                  models={models}
                  agentConfigured={Boolean(health?.agentAccountConfigured)}
                  initialPresetId={pendingPresetId}
                  onPresetConsumed={() => setPendingPresetId(null)}
                  onActivityLogged={handleActivityLogged}
                  onRefreshVault={() => void refreshVault()}
                />
              </div>

              <div className="lg:col-span-6 min-w-0">
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
          </div>
        )}
      </main>

      <footer className="border-t border-black/[0.06] dark:border-white/[0.08] py-5 px-4 sm:px-6 lg:px-8 text-xs text-[#59595e] dark:text-[#98989d]">
        <div className="max-w-6xl mx-auto flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2">
          <span>
            Walp — NEAR Rust RLP Firewall + Chain Signatures (<code className="font-mono">v1.signer-prod.testnet</code>)
          </span>
          <span className="font-mono">
            AI: cloud-api.near.ai TEE · 1Click: dry-run quotes only
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
