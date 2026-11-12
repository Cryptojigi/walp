import React, { useEffect, useState } from 'react';
import {
  Shield,
  CheckCircle2,
  XCircle,
  ExternalLink,
  RefreshCw,
  ArrowRightLeft,
  Lock,
  Unlock,
} from 'lucide-react';
import {
  AllowlistEntry,
  DenylistEntry,
  IntentRecord,
  NearCallOutcome,
  OneClickQuoteResponse,
  OneClickToken,
  RegistryEntry,
  TxActivityRecord,
  VaultPolicy,
} from '../types';
import { WalpApi } from '../services/api';
import { formatEther, parseEther } from 'ethers';

interface ControlCenterProps {
  vaultContractId: string;
  derivedEthAddress: string;
  policy: VaultPolicy | null;
  pendingIntents: IntentRecord[];
  denylist: DenylistEntry[];
  allowlist: AllowlistEntry[];
  registryEntries: RegistryEntry[];
  activityRecords: TxActivityRecord[];
  ownerSignerConfigured: boolean;
  onOwnerDecisionLogged?: (params: {
    action: 'approve' | 'reject';
    intent: IntentRecord;
    outcome: NearCallOutcome;
  }) => void;
  onRefreshVault: () => void;
}

type TabKey = 'policy' | 'queue' | 'intents' | 'audit';

function formatWeiToEth(weiStr?: string): string {
  if (!weiStr) return '0';
  try {
    return formatEther(BigInt(weiStr));
  } catch {
    return weiStr;
  }
}

export const ControlCenter: React.FC<ControlCenterProps> = ({
  vaultContractId,
  derivedEthAddress,
  policy,
  pendingIntents,
  denylist,
  allowlist,
  registryEntries,
  activityRecords,
  ownerSignerConfigured,
  onOwnerDecisionLogged,
  onRefreshVault,
}) => {
  const [tab, setTab] = useState<TabKey>('policy');
  const [actionBusy, setActionBusy] = useState(false);
  const [actionMsg, setActionMsg] = useState<{
    ok: boolean;
    text: string;
    nearUrl?: string;
    sepoliaUrl?: string;
  } | null>(null);

  // Policy update fields
  const [maxTxEth, setMaxTxEth] = useState('0.05');
  const [dailyLimitEth, setDailyLimitEth] = useState('0.2');
  const [thresholdEth, setThresholdEth] = useState('0.01');
  const [chainIdsInput, setChainIdsInput] = useState('11155111');

  useEffect(() => {
    if (policy) {
      setMaxTxEth(formatWeiToEth(policy.max_tx_wei));
      setDailyLimitEth(formatWeiToEth(policy.daily_limit_wei));
      setThresholdEth(formatWeiToEth(policy.approval_threshold_wei));
      setChainIdsInput(policy.allowed_chain_ids.join(', '));
    }
  }, [policy]);

  // Denylist / Allowlist quick forms
  const [newDenyAddr, setNewDenyAddr] = useState('');
  const [newDenyReason, setNewDenyReason] = useState('Suspicious counterparty');
  const [newAllowAddr, setNewAllowAddr] = useState('');
  const [newAllowLabel, setNewAllowLabel] = useState('Trusted contract');

  // 1Click Intents Quote state
  const [tokens, setTokens] = useState<OneClickToken[]>([]);
  const [originAsset, setOriginAsset] = useState('nep141:wrap.near');
  const [destAsset, setDestAsset] = useState('nep141:eth.omft.near');
  const [amountRaw, setAmountRaw] = useState('1000000000000000000000000');
  const [recipientAddr, setRecipientAddr] = useState('0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045');
  const [quote, setQuote] = useState<OneClickQuoteResponse | null>(null);
  const [quoteError, setQuoteError] = useState<string | null>(null);

  useEffect(() => {
    if (tab === 'intents' && tokens.length === 0) {
      WalpApi.getIntentTokens()
        .then((res) => setTokens(res.tokens))
        .catch(() => {});
    }
  }, [tab, tokens.length]);

  const runOwnerAction = async (fn: () => Promise<void>) => {
    setActionBusy(true);
    setActionMsg(null);
    try {
      await fn();
      onRefreshVault();
    } catch (err) {
      setActionMsg({
        ok: false,
        text: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setActionBusy(false);
    }
  };

  const spentWei = BigInt(policy?.spent_today_wei || '0');
  const dailyWei = BigInt(policy?.daily_limit_wei || '1');
  const dailyPct = dailyWei > 0n ? Number((spentWei * 100n) / dailyWei) : 0;

  return (
    <div className="bg-[#161b22] border border-[#30363d] rounded-xl overflow-hidden">
      {/* Tabs */}
      <div className="flex flex-wrap border-b border-[#21262d] bg-[#0d1117]">
        {(
          [
            ['policy', 'Onchain Policy & Lists'],
            ['queue', `Approval Queue (${pendingIntents.length})`],
            ['intents', '1Click Intents Quote'],
            ['audit', `Audit & Receipts (${activityRecords.length})`],
          ] as Array<[TabKey, string]>
        ).map(([key, label]) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`px-4 py-3 text-xs font-semibold border-b-2 transition-colors ${
              tab === key
                ? 'border-[#00ec97] text-white bg-[#161b22]'
                : 'border-transparent text-[#8b949e] hover:text-[#e6edf3]'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="p-5 space-y-4">
        {actionMsg && (
          <div
            className={`p-2.5 rounded border text-xs font-mono space-y-1 ${
              actionMsg.ok
                ? 'bg-emerald-950/30 border-emerald-800 text-emerald-200'
                : 'bg-amber-950/40 border-amber-800 text-amber-200'
            }`}
          >
            <div>{actionMsg.text}</div>
            {(actionMsg.nearUrl || actionMsg.sepoliaUrl) && (
              <div className="flex flex-wrap gap-3 text-[11px]">
                {actionMsg.nearUrl && (
                  <a
                    href={actionMsg.nearUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="text-[#00ec97] hover:underline inline-flex items-center space-x-1"
                  >
                    <span>NearBlocks</span>
                    <ExternalLink className="w-3 h-3" />
                  </a>
                )}
                {actionMsg.sepoliaUrl && (
                  <a
                    href={actionMsg.sepoliaUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="text-[#00ec97] hover:underline inline-flex items-center space-x-1"
                  >
                    <span>Etherscan</span>
                    <ExternalLink className="w-3 h-3" />
                  </a>
                )}
              </div>
            )}
          </div>
        )}

        {/* TAB 1: POLICY */}
        {tab === 'policy' && (
          <div className="space-y-4">
            {policy ? (
              <>
                <div className="bg-[#0d1117] border border-[#21262d] rounded-lg p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-white flex items-center space-x-1.5">
                      <Shield className="w-4 h-4 text-[#00ec97]" />
                      <span>24h Rolling Spend Gauge</span>
                    </span>
                    <span className="text-xs font-mono text-[#c9d1d9]">
                      {formatWeiToEth(policy.spent_today_wei)} / {formatWeiToEth(policy.daily_limit_wei)} ETH
                    </span>
                  </div>
                  <div className="w-full h-2 bg-[#21262d] rounded-full overflow-hidden">
                    <div
                      className="h-full bg-[#00ec97] transition-all"
                      style={{ width: `${Math.min(100, dailyPct)}%` }}
                    />
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-2 text-xs font-mono">
                    <div>
                      <span className="text-[#8b949e] block text-[10px]">Max Per-Tx</span>
                      <span className="text-white">{formatWeiToEth(policy.max_tx_wei)} ETH</span>
                    </div>
                    <div>
                      <span className="text-[#8b949e] block text-[10px]">Approval Threshold</span>
                      <span className="text-white">{formatWeiToEth(policy.approval_threshold_wei)} ETH</span>
                    </div>
                    <div>
                      <span className="text-[#8b949e] block text-[10px]">Allowed Chains</span>
                      <span className="text-white">{policy.allowed_chain_ids.join(', ')}</span>
                    </div>
                    <div>
                      <span className="text-[#8b949e] block text-[10px]">Shared Registry</span>
                      <span className="text-white truncate block" title={policy.registry_contract_id || 'None'}>
                        {policy.registry_contract_id || 'Disabled'}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Owner Emergency Kill-Switch */}
                <div className="flex items-center justify-between bg-[#0d1117] border border-[#21262d] rounded-lg p-3 text-xs">
                  <div>
                    <div className="font-semibold text-white">Owner Emergency Kill-Switch</div>
                    <div className="text-[#8b949e]">
                      Owner: <span className="font-mono text-[#c9d1d9]">{policy.owner_id}</span>
                    </div>
                  </div>
                  <button
                    disabled={actionBusy || !ownerSignerConfigured}
                    onClick={() =>
                      runOwnerAction(async () => {
                        const nextPaused = !policy.paused;
                        const outcome = await WalpApi.ownerTogglePause({
                          contractId: vaultContractId,
                          paused: nextPaused,
                          note: nextPaused ? 'Emergency pause via UI' : 'Resumed via UI',
                        });
                        setActionMsg({
                          ok: outcome.success,
                          text: outcome.success
                            ? nextPaused
                              ? 'Vault paused onchain.'
                              : 'Vault resumed onchain.'
                            : outcome.failureReason || 'Pause toggle failed.',
                          nearUrl: outcome.explorerUrl || undefined,
                        });
                      })
                    }
                    className={`px-3 py-1.5 rounded font-semibold flex items-center space-x-1.5 disabled:opacity-50 ${
                      policy.paused
                        ? 'bg-[#00ec97] text-black'
                        : 'bg-rose-900/60 hover:bg-rose-800 text-rose-100 border border-rose-700'
                    }`}
                  >
                    {policy.paused ? <Unlock className="w-3.5 h-3.5" /> : <Lock className="w-3.5 h-3.5" />}
                    <span>{policy.paused ? 'Unpause Vault' : 'Pause Vault'}</span>
                  </button>
                </div>

                {ownerSignerConfigured && vaultContractId && (
                  <div className="bg-[#0d1117] border border-[#21262d] rounded-lg p-3.5 space-y-2.5 text-xs">
                    <div className="font-semibold text-white">Update Owner Policy Limits</div>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 font-mono">
                      <div>
                        <label className="text-[#8b949e] block text-[10px] mb-1">Max Tx (ETH)</label>
                        <input
                          value={maxTxEth}
                          onChange={(e) => setMaxTxEth(e.target.value)}
                          className="w-full bg-[#161b22] border border-[#30363d] rounded px-2 py-1 text-[11px] text-white"
                        />
                      </div>
                      <div>
                        <label className="text-[#8b949e] block text-[10px] mb-1">Daily (ETH)</label>
                        <input
                          value={dailyLimitEth}
                          onChange={(e) => setDailyLimitEth(e.target.value)}
                          className="w-full bg-[#161b22] border border-[#30363d] rounded px-2 py-1 text-[11px] text-white"
                        />
                      </div>
                      <div>
                        <label className="text-[#8b949e] block text-[10px] mb-1">Escalate (ETH)</label>
                        <input
                          value={thresholdEth}
                          onChange={(e) => setThresholdEth(e.target.value)}
                          className="w-full bg-[#161b22] border border-[#30363d] rounded px-2 py-1 text-[11px] text-white"
                        />
                      </div>
                      <div>
                        <label className="text-[#8b949e] block text-[10px] mb-1">Chain IDs</label>
                        <input
                          value={chainIdsInput}
                          onChange={(e) => setChainIdsInput(e.target.value)}
                          className="w-full bg-[#161b22] border border-[#30363d] rounded px-2 py-1 text-[11px] text-white"
                        />
                      </div>
                    </div>
                    <div className="flex justify-end">
                      <button
                        disabled={actionBusy}
                        onClick={() =>
                          runOwnerAction(async () => {
                            const allowedChainIds = chainIdsInput
                              .split(',')
                              .map((s) => Number(s.trim()))
                              .filter((n) => Number.isInteger(n) && n > 0);
                            if (allowedChainIds.length === 0) {
                              throw new Error('Provide at least one positive EVM chain ID.');
                            }
                            const outcome = await WalpApi.ownerSetPolicy({
                              contractId: vaultContractId,
                              maxTxWei: parseEther(maxTxEth.trim()).toString(),
                              dailyLimitWei: parseEther(dailyLimitEth.trim()).toString(),
                              approvalThresholdWei: parseEther(thresholdEth.trim()).toString(),
                              allowedChainIds,
                            });
                            setActionMsg({
                              ok: outcome.success,
                              text: outcome.success
                                ? 'Policy updated onchain.'
                                : outcome.failureReason || 'Policy update failed.',
                              nearUrl: outcome.explorerUrl || undefined,
                            });
                          })
                        }
                        className="px-3 py-1 rounded bg-[#21262d] hover:bg-[#30363d] border border-[#30363d] text-[11px] font-semibold text-white disabled:opacity-50"
                      >
                        Apply Policy
                      </button>
                    </div>
                  </div>
                )}
              </>
            ) : (
              <div className="text-xs text-[#8b949e] bg-[#0d1117] border border-[#21262d] rounded-lg p-4">
                No deployed vault detected yet. Set <code className="text-[#c9d1d9]">WALP_VAULT_CONTRACT_ID</code> in <code className="text-[#c9d1d9]">.env</code> or click the vault config button in the header.
              </div>
            )}

            {/* Denylist + Shared Registry + Allowlist */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="bg-[#0d1117] border border-[#21262d] rounded-lg p-3.5 space-y-2.5">
                <div className="text-xs font-semibold text-white">
                  Local Denylist ({denylist.length}) & Shared Registry ({registryEntries.length})
                </div>
                <div className="space-y-1.5 max-h-40 overflow-y-auto text-[11px] font-mono">
                  {denylist.map((d) => (
                    <div
                      key={d.address}
                      className="p-2 rounded bg-[#161b22] border border-[#21262d] flex items-start justify-between gap-2"
                    >
                      <div className="min-w-0">
                        <div className="text-rose-300 truncate">{d.address}</div>
                        <div className="text-[#8b949e]">[LOCAL] {d.reason}</div>
                      </div>
                      {ownerSignerConfigured && vaultContractId && (
                        <button
                          disabled={actionBusy}
                          onClick={() =>
                            runOwnerAction(async () => {
                              const out = await WalpApi.ownerDenylist({
                                contractId: vaultContractId,
                                action: 'remove',
                                address: d.address,
                              });
                              setActionMsg({
                                ok: out.success,
                                text: out.success ? `Removed ${d.address} from denylist.` : out.failureReason || 'Remove failed',
                                nearUrl: out.explorerUrl || undefined,
                              });
                            })
                          }
                          className="shrink-0 text-[10px] px-1.5 py-0.5 rounded bg-[#21262d] hover:bg-[#30363d] text-[#c9d1d9]"
                        >
                          Remove
                        </button>
                      )}
                    </div>
                  ))}
                  {registryEntries.map((r) => (
                    <div key={r.address} className="p-2 rounded bg-[#161b22] border border-[#21262d]">
                      <div className="text-amber-300 truncate">{r.address}</div>
                      <div className="text-[#8b949e]">
                        [REGISTRY:{r.category}] {r.reason}
                      </div>
                    </div>
                  ))}
                  {denylist.length === 0 && registryEntries.length === 0 && (
                    <div className="text-[#8b949e]">No denylisted addresses.</div>
                  )}
                </div>

                {ownerSignerConfigured && vaultContractId && (
                  <div className="pt-2 border-t border-[#21262d] flex gap-1.5">
                    <input
                      value={newDenyAddr}
                      onChange={(e) => setNewDenyAddr(e.target.value)}
                      placeholder="0x... address"
                      className="flex-1 bg-[#161b22] border border-[#30363d] rounded px-2 py-1 text-[11px] font-mono text-white"
                    />
                    <button
                      disabled={actionBusy || !newDenyAddr.trim()}
                      onClick={() =>
                        runOwnerAction(async () => {
                          const out = await WalpApi.ownerDenylist({
                            contractId: vaultContractId,
                            action: 'add',
                            address: newDenyAddr.trim(),
                            reason: newDenyReason,
                          });
                          setActionMsg({
                            ok: out.success,
                            text: out.success ? `Added ${newDenyAddr.trim()} to denylist.` : out.failureReason || 'Deny failed',
                            nearUrl: out.explorerUrl || undefined,
                          });
                          setNewDenyAddr('');
                        })
                      }
                      className="px-2.5 py-1 rounded bg-[#21262d] hover:bg-[#30363d] text-[11px] text-white"
                    >
                      Deny
                    </button>
                  </div>
                )}
              </div>

              <div className="bg-[#0d1117] border border-[#21262d] rounded-lg p-3.5 space-y-2.5">
                <div className="text-xs font-semibold text-white">
                  Contract Allowlist ({allowlist.length})
                </div>
                <div className="space-y-1.5 max-h-40 overflow-y-auto text-[11px] font-mono">
                  {allowlist.map((a) => (
                    <div
                      key={a.address}
                      className="p-2 rounded bg-[#161b22] border border-[#21262d] flex items-start justify-between gap-2"
                    >
                      <div className="min-w-0">
                        <div className="text-[#00ec97] truncate">{a.address}</div>
                        <div className="text-[#8b949e]">{a.label}</div>
                      </div>
                      {ownerSignerConfigured && vaultContractId && (
                        <button
                          disabled={actionBusy}
                          onClick={() =>
                            runOwnerAction(async () => {
                              const out = await WalpApi.ownerAllowlist({
                                contractId: vaultContractId,
                                action: 'remove',
                                address: a.address,
                              });
                              setActionMsg({
                                ok: out.success,
                                text: out.success ? `Removed ${a.address} from allowlist.` : out.failureReason || 'Remove failed',
                                nearUrl: out.explorerUrl || undefined,
                              });
                            })
                          }
                          className="shrink-0 text-[10px] px-1.5 py-0.5 rounded bg-[#21262d] hover:bg-[#30363d] text-[#c9d1d9]"
                        >
                          Remove
                        </button>
                      )}
                    </div>
                  ))}
                  {allowlist.length === 0 && (
                    <div className="text-[#8b949e]">
                      Empty — non-empty contract calls escalate to Owner.
                    </div>
                  )}
                </div>

                {ownerSignerConfigured && vaultContractId && (
                  <div className="pt-2 border-t border-[#21262d] flex gap-1.5">
                    <input
                      value={newAllowAddr}
                      onChange={(e) => setNewAllowAddr(e.target.value)}
                      placeholder="0x... contract"
                      className="flex-1 bg-[#161b22] border border-[#30363d] rounded px-2 py-1 text-[11px] font-mono text-white"
                    />
                    <button
                      disabled={actionBusy || !newAllowAddr.trim()}
                      onClick={() =>
                        runOwnerAction(async () => {
                          const out = await WalpApi.ownerAllowlist({
                            contractId: vaultContractId,
                            action: 'add',
                            address: newAllowAddr.trim(),
                            label: newAllowLabel,
                          });
                          setActionMsg({
                            ok: out.success,
                            text: out.success ? `Added ${newAllowAddr.trim()} to allowlist.` : out.failureReason || 'Allow failed',
                            nearUrl: out.explorerUrl || undefined,
                          });
                          setNewAllowAddr('');
                        })
                      }
                      className="px-2.5 py-1 rounded bg-[#21262d] hover:bg-[#30363d] text-[11px] text-white"
                    >
                      Allow
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* TAB 2: APPROVAL QUEUE */}
        {tab === 'queue' && (
          <div className="space-y-3">
            {pendingIntents.length === 0 ? (
              <div className="text-xs text-[#8b949e] bg-[#0d1117] border border-[#21262d] rounded-lg p-6 text-center">
                No intents waiting for Owner approval. Intents above{' '}
                <span className="font-mono text-white">approval_threshold_wei</span> or unallowlisted contract calls appear here.
              </div>
            ) : (
              pendingIntents.map((intent) => (
                <div
                  key={intent.intent_id}
                  className="bg-[#0d1117] border border-[#21262d] rounded-lg p-3.5 space-y-2 text-xs font-mono"
                >
                  <div className="flex items-center justify-between">
                    <span className="text-white font-semibold">
                      {intent.intent_id} · {formatWeiToEth(intent.value_wei)} ETH
                    </span>
                    <span className="text-amber-300">{intent.reason_code}</span>
                  </div>
                  <div className="text-[#8b949e] break-all">
                    To: {intent.to} | Chain: {intent.chain_id} | Selector: {intent.calldata_selector}
                  </div>
                  <div className="text-[#8b949e] break-all">Sighash: 0x{intent.sighash_hex}</div>
                  {ownerSignerConfigured ? (
                    <div className="flex items-center space-x-2 pt-1">
                      <button
                        disabled={actionBusy}
                        onClick={() =>
                          runOwnerAction(async () => {
                            const outcome = await WalpApi.ownerApprove({
                              contractId: vaultContractId,
                              intentId: intent.intent_id,
                              broadcast: true,
                              expectedFromAddress: derivedEthAddress || undefined,
                            });
                            onOwnerDecisionLogged?.({ action: 'approve', intent, outcome });
                            setActionMsg({
                              ok: outcome.success && !outcome.broadcastError,
                              text: outcome.sepoliaBroadcast
                                ? `Approved & broadcast ${intent.intent_id} to Sepolia (${outcome.sepoliaBroadcast.txHash})`
                                : outcome.broadcastError
                                  ? `MPC signed ${intent.intent_id}, Sepolia broadcast warning: ${outcome.broadcastError}`
                                  : outcome.success
                                    ? `Approved & signed ${intent.intent_id} (${outcome.result?.status || 'SIGNED'}).`
                                    : outcome.failureReason || `Approval failed for ${intent.intent_id}`,
                              nearUrl: outcome.explorerUrl || undefined,
                              sepoliaUrl: outcome.sepoliaBroadcast?.explorerUrl || undefined,
                            });
                          })
                        }
                        className="px-3 py-1.5 rounded bg-[#00ec97] text-black font-semibold flex items-center space-x-1"
                      >
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        <span>Approve & MPC Sign</span>
                      </button>
                      <button
                        disabled={actionBusy}
                        onClick={() =>
                          runOwnerAction(async () => {
                            const outcome = await WalpApi.ownerReject({
                              contractId: vaultContractId,
                              intentId: intent.intent_id,
                              reason: 'Rejected by Owner in Walp UI',
                            });
                            onOwnerDecisionLogged?.({ action: 'reject', intent, outcome });
                            setActionMsg({
                              ok: outcome.success,
                              text: outcome.success
                                ? `Rejected ${intent.intent_id}.`
                                : outcome.failureReason || `Reject failed for ${intent.intent_id}`,
                              nearUrl: outcome.explorerUrl || undefined,
                            });
                          })
                        }
                        className="px-3 py-1.5 rounded bg-rose-950 border border-rose-800 text-rose-200 flex items-center space-x-1"
                      >
                        <XCircle className="w-3.5 h-3.5" />
                        <span>Reject</span>
                      </button>
                    </div>
                  ) : (
                    <div className="text-[11px] text-amber-300">
                      Configure NEAR_OWNER_PRIVATE_KEY in .env or call{' '}
                      <code>approve_intent</code> / <code>reject_intent</code> via NEAR CLI.
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        )}

        {/* TAB 3: 1CLICK INTENTS QUOTE */}
        {tab === 'intents' && (
          <div className="space-y-3 text-xs">
            <div className="p-2.5 rounded bg-[#0d1117] border border-[#21262d] text-[#8b949e] flex items-center justify-between">
              <span>
                1Click Dry-Run Quote Mode (<code className="text-[#c9d1d9]">dry: true</code> — mainnet route simulation per HACKATHON.md Q-007)
              </span>
              <span className="font-mono text-[#00ec97]">{tokens.length} Tokens</span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 font-mono">
              <div>
                <label className="text-[#8b949e] block mb-1">Origin Asset</label>
                <select
                  value={originAsset}
                  onChange={(e) => setOriginAsset(e.target.value)}
                  className="w-full bg-[#0d1117] border border-[#30363d] rounded px-2.5 py-1.5 text-white"
                >
                  {(tokens.length > 0 ? tokens : [{ assetId: 'nep141:wrap.near', symbol: 'wNEAR', blockchain: 'near', decimals: 24 }]).map((t) => (
                    <option key={t.assetId} value={t.assetId}>
                      {t.symbol} ({t.blockchain})
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-[#8b949e] block mb-1">Destination Asset</label>
                <select
                  value={destAsset}
                  onChange={(e) => setDestAsset(e.target.value)}
                  className="w-full bg-[#0d1117] border border-[#30363d] rounded px-2.5 py-1.5 text-white"
                >
                  {(tokens.length > 0 ? tokens : [{ assetId: 'nep141:eth.omft.near', symbol: 'ETH', blockchain: 'eth', decimals: 18 }]).map((t) => (
                    <option key={t.assetId} value={t.assetId}>
                      {t.symbol} ({t.blockchain})
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-[#8b949e] block mb-1">Atomic Amount (e.g. 1e24 = 1 wNEAR)</label>
                <input
                  value={amountRaw}
                  onChange={(e) => setAmountRaw(e.target.value)}
                  className="w-full bg-[#0d1117] border border-[#30363d] rounded px-2.5 py-1.5 text-white"
                />
              </div>
              <div>
                <label className="text-[#8b949e] block mb-1">Destination Recipient</label>
                <input
                  value={recipientAddr}
                  onChange={(e) => setRecipientAddr(e.target.value)}
                  className="w-full bg-[#0d1117] border border-[#30363d] rounded px-2.5 py-1.5 text-white"
                />
              </div>
            </div>

            <button
              type="button"
              onClick={async () => {
                setQuoteError(null);
                setQuote(null);
                try {
                  const q = await WalpApi.getIntentQuote({
                    originAsset,
                    destinationAsset: destAsset,
                    amount: amountRaw,
                    refundTo: 'root.near',
                    recipient: recipientAddr || derivedEthAddress || 'root.near',
                    slippageTolerance: 100,
                  });
                  setQuote(q);
                } catch (err) {
                  setQuoteError(err instanceof Error ? err.message : String(err));
                }
              }}
              className="px-4 py-2 rounded-lg bg-[#00ec97] hover:bg-[#00d688] text-black font-semibold flex items-center space-x-1.5"
            >
              <ArrowRightLeft className="w-3.5 h-3.5" />
              <span>Fetch Live 1Click Dry Quote</span>
            </button>

            {quoteError && (
              <div className="p-2.5 rounded bg-rose-950/40 border border-rose-800 text-rose-200 font-mono">
                {quoteError}
              </div>
            )}

            {quote && (
              <div className="bg-[#0d1117] border border-[#00ec97]/40 rounded-lg p-3.5 font-mono space-y-1.5">
                <div className="flex justify-between text-white font-semibold">
                  <span>
                    {quote.quote.amountInFormatted} → {quote.quote.amountOutFormatted}
                  </span>
                  <span className="text-[#00ec97]">~{quote.quote.timeEstimate ?? 30}s</span>
                </div>
                <div className="text-[#8b949e]">
                  Min Out: {quote.quote.minAmountOut} | USD: ${quote.quote.amountInUsd || '?'} → $
                  {quote.quote.amountOutUsd || '?'}
                </div>
                <div className="text-[#8b949e]">
                  Policy Slippage Check:{' '}
                  <span className={quote.policyCheck.passed ? 'text-[#00ec97]' : 'text-amber-300'}>
                    {quote.policyCheck.passed ? 'PASS' : quote.policyCheck.warnings.join('; ')}
                  </span>
                </div>
              </div>
            )}
          </div>
        )}

        {/* TAB 4: AUDIT & RECEIPTS */}
        {tab === 'audit' && (
          <div className="space-y-2.5">
            {activityRecords.length === 0 ? (
              <div className="text-xs text-[#8b949e] bg-[#0d1117] border border-[#21262d] rounded-lg p-6 text-center">
                Execute an intent or attack test in the Console to view real NearBlocks & Etherscan proofs.
              </div>
            ) : (
              activityRecords.map((rec) => (
                <div
                  key={rec.id}
                  className="bg-[#0d1117] border border-[#21262d] rounded-lg p-3 text-xs font-mono space-y-1"
                >
                  <div className="flex items-center justify-between">
                    <span
                      className={
                        rec.outcomeStatus === 'SIGNED'
                          ? 'text-[#00ec97] font-semibold'
                          : rec.outcomeStatus === 'PENDING_APPROVAL'
                            ? 'text-amber-300 font-semibold'
                            : 'text-rose-300 font-semibold'
                      }
                    >
                      {rec.outcomeStatus} ({rec.reasonCode})
                    </span>
                    <span className="text-[#8b949e]">
                      {new Date(rec.timestamp).toLocaleTimeString()}
                    </span>
                  </div>
                  <div className="text-[#c9d1d9] truncate">{rec.prompt}</div>
                  <div className="flex flex-wrap items-center gap-3 text-[11px] text-[#8b949e]">
                    <span>To: {rec.toAddress}</span>
                    <span>Value: {rec.amountEth} ETH</span>
                    {rec.nearExplorerUrl && (
                      <a
                        href={rec.nearExplorerUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="text-[#00ec97] hover:underline inline-flex items-center space-x-1"
                      >
                        <span>NearBlocks</span>
                        <ExternalLink className="w-3 h-3" />
                      </a>
                    )}
                    {rec.sepoliaExplorerUrl && (
                      <a
                        href={rec.sepoliaExplorerUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="text-[#00ec97] hover:underline inline-flex items-center space-x-1"
                      >
                        <span>Etherscan</span>
                        <ExternalLink className="w-3 h-3" />
                      </a>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
        )}
      </div>
    </div>
  );
};
