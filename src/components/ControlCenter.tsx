import React, { useEffect, useState } from 'react';
import {
  ArrowRightLeft,
  CheckCircle2,
  ExternalLink,
  Lock,
  Shield,
  Unlock,
  XCircle,
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

function shortAddress(addr: string): string {
  if (!addr || addr.length < 14) return addr;
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
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
  const [newDenyReason] = useState('Suspicious counterparty');
  const [newAllowAddr, setNewAllowAddr] = useState('');
  const [newAllowLabel] = useState('Trusted contract');

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
    <section className="rounded-[28px] bg-white dark:bg-[#1c1c1e] border border-black/[0.06] dark:border-white/[0.09] shadow-[0_8px_30px_rgba(0,0,0,0.04)] dark:shadow-[0_12px_36px_rgba(0,0,0,0.35)] overflow-hidden min-w-0">
      {/* iOS Segmented Tab Strip */}
      <div className="p-3 sm:p-4 border-b border-black/[0.06] dark:border-white/[0.08]">
        <div className="flex overflow-x-auto no-scrollbar gap-1 p-1 rounded-2xl bg-[#f5f5f7] dark:bg-[#2c2c2e]">
          {(
            [
              ['policy', 'Policy & Lists'],
              ['queue', `Queue (${pendingIntents.length})`],
              ['intents', '1Click Quote'],
              ['audit', `Audit (${activityRecords.length})`],
            ] as Array<[TabKey, string]>
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => setTab(key)}
              className={`shrink-0 flex-1 px-3.5 py-2 rounded-xl text-xs font-semibold whitespace-nowrap transition-all ${
                tab === key
                  ? 'bg-white dark:bg-[#3a3a3c] text-[#1d1d1f] dark:text-white shadow-sm'
                  : 'text-[#59595e] dark:text-[#98989d] hover:text-[#1d1d1f] dark:hover:text-white'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="p-5 sm:p-6 space-y-4 min-w-0">
        {actionMsg && (
          <div
            className={`p-3 rounded-2xl border text-xs font-mono space-y-1.5 break-words ${
              actionMsg.ok
                ? 'bg-[#34c759]/10 border-[#34c759]/30 text-[#146c32] dark:text-[#30d158]'
                : 'bg-amber-500/10 border-amber-500/30 text-amber-800 dark:text-amber-300'
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
                    className="text-[#005bb8] dark:text-[#0a84ff] hover:underline inline-flex items-center gap-1"
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
                    className="text-[#005bb8] dark:text-[#0a84ff] hover:underline inline-flex items-center gap-1"
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
          <div className="space-y-4 min-w-0">
            {policy ? (
              <>
                <div className="rounded-2xl bg-[#f5f5f7] dark:bg-[#2c2c2e] p-4 space-y-3 min-w-0">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-xs font-semibold text-[#1d1d1f] dark:text-white flex items-center gap-1.5">
                      <Shield className="w-4 h-4 text-[#00a86b] dark:text-[#30d158] shrink-0" />
                      <span>24h Rolling Spend Gauge</span>
                    </span>
                    <span className="text-xs font-mono text-[#1d1d1f] dark:text-[#f5f5f7]">
                      {formatWeiToEth(policy.spent_today_wei)} / {formatWeiToEth(policy.daily_limit_wei)} ETH
                    </span>
                  </div>
                  <div className="w-full h-2 bg-black/[0.08] dark:bg-white/[0.1] rounded-full overflow-hidden">
                    <div
                      className="h-full bg-[#00a86b] dark:bg-[#30d158] transition-all"
                      style={{ width: `${Math.min(100, dailyPct)}%` }}
                    />
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-1 text-xs font-mono">
                    <div className="min-w-0">
                      <span className="text-[#59595e] dark:text-[#98989d] block text-[10px]">Max Per-Tx</span>
                      <span className="text-[#1d1d1f] dark:text-white">{formatWeiToEth(policy.max_tx_wei)} ETH</span>
                    </div>
                    <div className="min-w-0">
                      <span className="text-[#59595e] dark:text-[#98989d] block text-[10px]">Approval Threshold</span>
                      <span className="text-[#1d1d1f] dark:text-white">{formatWeiToEth(policy.approval_threshold_wei)} ETH</span>
                    </div>
                    <div className="min-w-0">
                      <span className="text-[#59595e] dark:text-[#98989d] block text-[10px]">Allowed Chains</span>
                      <span className="text-[#1d1d1f] dark:text-white">{policy.allowed_chain_ids.join(', ')}</span>
                    </div>
                    <div className="min-w-0">
                      <span className="text-[#59595e] dark:text-[#98989d] block text-[10px]">Shared Registry</span>
                      <span className="text-[#1d1d1f] dark:text-white truncate block" title={policy.registry_contract_id || 'None'}>
                        {policy.registry_contract_id || 'Disabled'}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Owner Emergency Kill-Switch */}
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-2xl bg-[#f5f5f7] dark:bg-[#2c2c2e] p-4 text-xs">
                  <div className="min-w-0">
                    <div className="font-semibold text-[#1d1d1f] dark:text-white">
                      Owner Emergency Kill-Switch
                    </div>
                    <div className="text-[#59595e] dark:text-[#98989d] mt-0.5 truncate">
                      Owner: <span className="font-mono text-[#1d1d1f] dark:text-white">{policy.owner_id}</span>
                    </div>
                  </div>
                  <button
                    type="button"
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
                    className={`min-h-[40px] px-4 py-2 rounded-full font-semibold inline-flex items-center justify-center gap-1.5 disabled:opacity-45 shrink-0 transition-colors ${
                      policy.paused
                        ? 'bg-[#34c759] text-white dark:text-black'
                        : 'bg-[#ff3b30]/12 hover:bg-[#ff3b30]/20 text-[#c92a22] dark:text-[#ff6961]'
                    }`}
                  >
                    {policy.paused ? <Unlock className="w-3.5 h-3.5" /> : <Lock className="w-3.5 h-3.5" />}
                    <span>{policy.paused ? 'Unpause Vault' : 'Pause Vault'}</span>
                  </button>
                </div>

                {ownerSignerConfigured && vaultContractId && (
                  <div className="rounded-2xl bg-[#f5f5f7] dark:bg-[#2c2c2e] p-4 space-y-3 text-xs">
                    <div className="font-semibold text-[#1d1d1f] dark:text-white">
                      Update Owner Policy Limits
                    </div>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 font-mono">
                      <div className="min-w-0">
                        <label htmlFor="walp-max-tx" className="text-[#59595e] dark:text-[#98989d] block text-[10px] mb-1">Max Tx (ETH)</label>
                        <input
                          id="walp-max-tx"
                          name="maxTxEth"
                          value={maxTxEth}
                          onChange={(e) => setMaxTxEth(e.target.value)}
                          className="w-full min-h-[38px] bg-white dark:bg-[#1c1c1e] border border-black/[0.07] dark:border-white/[0.08] rounded-xl px-2.5 py-1.5 text-xs text-[#1d1d1f] dark:text-white focus:outline-none focus:ring-2 focus:ring-[#005bb8]"
                        />
                      </div>
                      <div className="min-w-0">
                        <label htmlFor="walp-daily-limit" className="text-[#59595e] dark:text-[#98989d] block text-[10px] mb-1">Daily (ETH)</label>
                        <input
                          id="walp-daily-limit"
                          name="dailyLimitEth"
                          value={dailyLimitEth}
                          onChange={(e) => setDailyLimitEth(e.target.value)}
                          className="w-full min-h-[38px] bg-white dark:bg-[#1c1c1e] border border-black/[0.07] dark:border-white/[0.08] rounded-xl px-2.5 py-1.5 text-xs text-[#1d1d1f] dark:text-white focus:outline-none focus:ring-2 focus:ring-[#005bb8]"
                        />
                      </div>
                      <div className="min-w-0">
                        <label htmlFor="walp-threshold-eth" className="text-[#59595e] dark:text-[#98989d] block text-[10px] mb-1">Escalate (ETH)</label>
                        <input
                          id="walp-threshold-eth"
                          name="thresholdEth"
                          value={thresholdEth}
                          onChange={(e) => setThresholdEth(e.target.value)}
                          className="w-full min-h-[38px] bg-white dark:bg-[#1c1c1e] border border-black/[0.07] dark:border-white/[0.08] rounded-xl px-2.5 py-1.5 text-xs text-[#1d1d1f] dark:text-white focus:outline-none focus:ring-2 focus:ring-[#005bb8]"
                        />
                      </div>
                      <div className="min-w-0">
                        <label htmlFor="walp-chain-ids" className="text-[#59595e] dark:text-[#98989d] block text-[10px] mb-1">Chain IDs</label>
                        <input
                          id="walp-chain-ids"
                          name="allowedChainIds"
                          value={chainIdsInput}
                          onChange={(e) => setChainIdsInput(e.target.value)}
                          className="w-full min-h-[38px] bg-white dark:bg-[#1c1c1e] border border-black/[0.07] dark:border-white/[0.08] rounded-xl px-2.5 py-1.5 text-xs text-[#1d1d1f] dark:text-white focus:outline-none focus:ring-2 focus:ring-[#005bb8]"
                        />
                      </div>
                    </div>
                    <div className="flex justify-end">
                      <button
                        type="button"
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
                        className="min-h-[38px] px-4 py-1.5 rounded-full bg-[#1d1d1f] hover:bg-black dark:bg-[#f5f5f7] dark:hover:bg-white text-xs font-semibold text-white dark:text-[#1d1d1f] disabled:opacity-45 transition-colors"
                      >
                        Apply Policy
                      </button>
                    </div>
                  </div>
                )}
              </>
            ) : (
              <div className="text-xs text-[#59595e] dark:text-[#98989d] bg-[#f5f5f7] dark:bg-[#2c2c2e] rounded-2xl p-4">
                No deployed vault detected yet. Set <code className="font-mono text-[#1d1d1f] dark:text-white">WALP_VAULT_CONTRACT_ID</code> in <code className="font-mono text-[#1d1d1f] dark:text-white">.env</code> or open Vault Config in the header.
              </div>
            )}

            {/* Denylist + Shared Registry + Allowlist */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
              <div className="rounded-2xl bg-[#f5f5f7] dark:bg-[#2c2c2e] p-4 space-y-3 min-w-0">
                <div className="text-xs font-semibold text-[#1d1d1f] dark:text-white">
                  Local Denylist ({denylist.length}) & Registry ({registryEntries.length})
                </div>
                <div className="space-y-2 max-h-44 overflow-y-auto text-[11px] font-mono">
                  {denylist.map((d) => (
                    <div
                      key={d.address}
                      className="p-2.5 rounded-xl bg-white dark:bg-[#1c1c1e] flex items-start justify-between gap-2 min-w-0"
                    >
                      <div className="min-w-0">
                        <div className="text-[#c92a22] dark:text-[#ff6961] truncate" title={d.address}>
                          {shortAddress(d.address)}
                        </div>
                        <div className="text-[#59595e] dark:text-[#98989d] break-words">
                          [LOCAL] {d.reason}
                        </div>
                      </div>
                      {ownerSignerConfigured && vaultContractId && (
                        <button
                          type="button"
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
                                text: out.success
                                  ? `Removed ${d.address} from denylist.`
                                  : out.failureReason || 'Remove failed',
                                nearUrl: out.explorerUrl || undefined,
                              });
                            })
                          }
                          className="shrink-0 text-[10px] px-2.5 py-1 rounded-full bg-[#f5f5f7] hover:bg-black/[0.08] dark:bg-[#2c2c2e] dark:hover:bg-[#3a3a3c] text-[#1d1d1f] dark:text-white"
                        >
                          Remove
                        </button>
                      )}
                    </div>
                  ))}
                  {registryEntries.map((r) => (
                    <div key={r.address} className="p-2.5 rounded-xl bg-white dark:bg-[#1c1c1e] min-w-0">
                      <div className="text-amber-700 dark:text-amber-300 truncate" title={r.address}>
                        {shortAddress(r.address)}
                      </div>
                      <div className="text-[#59595e] dark:text-[#98989d] break-words">
                        [REGISTRY:{r.category}] {r.reason}
                      </div>
                    </div>
                  ))}
                  {denylist.length === 0 && registryEntries.length === 0 && (
                    <div className="text-[#59595e] dark:text-[#98989d]">No denylisted addresses.</div>
                  )}
                </div>

                {ownerSignerConfigured && vaultContractId && (
                  <div className="pt-2 border-t border-black/[0.06] dark:border-white/[0.08] flex gap-1.5 min-w-0">
                    <input
                      id="walp-deny-addr"
                      name="denyAddress"
                      aria-label="Address to add to local denylist"
                      value={newDenyAddr}
                      onChange={(e) => setNewDenyAddr(e.target.value)}
                      placeholder="0x... address"
                      className="flex-1 min-w-0 min-h-[36px] bg-white dark:bg-[#1c1c1e] border border-black/[0.07] dark:border-white/[0.08] rounded-xl px-2.5 py-1 text-[11px] font-mono text-[#1d1d1f] dark:text-white"
                    />
                    <button
                      type="button"
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
                            text: out.success
                              ? `Added ${newDenyAddr.trim()} to denylist.`
                              : out.failureReason || 'Deny failed',
                            nearUrl: out.explorerUrl || undefined,
                          });
                          setNewDenyAddr('');
                        })
                      }
                      className="shrink-0 px-3 py-1 rounded-xl bg-[#1d1d1f] dark:bg-[#f5f5f7] text-white dark:text-[#1d1d1f] text-[11px] font-semibold disabled:opacity-45"
                    >
                      Deny
                    </button>
                  </div>
                )}
              </div>

              <div className="rounded-2xl bg-[#f5f5f7] dark:bg-[#2c2c2e] p-4 space-y-3 min-w-0">
                <div className="text-xs font-semibold text-[#1d1d1f] dark:text-white">
                  Contract Allowlist ({allowlist.length})
                </div>
                <div className="space-y-2 max-h-44 overflow-y-auto text-[11px] font-mono">
                  {allowlist.map((a) => (
                    <div
                      key={a.address}
                      className="p-2.5 rounded-xl bg-white dark:bg-[#1c1c1e] flex items-start justify-between gap-2 min-w-0"
                    >
                      <div className="min-w-0">
                        <div className="text-[#146c32] dark:text-[#30d158] truncate" title={a.address}>
                          {shortAddress(a.address)}
                        </div>
                        <div className="text-[#59595e] dark:text-[#98989d] break-words">{a.label}</div>
                      </div>
                      {ownerSignerConfigured && vaultContractId && (
                        <button
                          type="button"
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
                                text: out.success
                                  ? `Removed ${a.address} from allowlist.`
                                  : out.failureReason || 'Remove failed',
                                nearUrl: out.explorerUrl || undefined,
                              });
                            })
                          }
                          className="shrink-0 text-[10px] px-2.5 py-1 rounded-full bg-[#f5f5f7] hover:bg-black/[0.08] dark:bg-[#2c2c2e] dark:hover:bg-[#3a3a3c] text-[#1d1d1f] dark:text-white"
                        >
                          Remove
                        </button>
                      )}
                    </div>
                  ))}
                  {allowlist.length === 0 && (
                    <div className="text-[#59595e] dark:text-[#98989d] leading-relaxed">
                      Empty — non-empty contract calls escalate to Owner.
                    </div>
                  )}
                </div>

                {ownerSignerConfigured && vaultContractId && (
                  <div className="pt-2 border-t border-black/[0.06] dark:border-white/[0.08] flex gap-1.5 min-w-0">
                    <input
                      id="walp-allow-addr"
                      name="allowAddress"
                      aria-label="Contract address to allowlist"
                      value={newAllowAddr}
                      onChange={(e) => setNewAllowAddr(e.target.value)}
                      placeholder="0x... contract"
                      className="flex-1 min-w-0 min-h-[36px] bg-white dark:bg-[#1c1c1e] border border-black/[0.07] dark:border-white/[0.08] rounded-xl px-2.5 py-1 text-[11px] font-mono text-[#1d1d1f] dark:text-white"
                    />
                    <button
                      type="button"
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
                            text: out.success
                              ? `Added ${newAllowAddr.trim()} to allowlist.`
                              : out.failureReason || 'Allow failed',
                            nearUrl: out.explorerUrl || undefined,
                          });
                          setNewAllowAddr('');
                        })
                      }
                      className="shrink-0 px-3 py-1 rounded-xl bg-[#1d1d1f] dark:bg-[#f5f5f7] text-white dark:text-[#1d1d1f] text-[11px] font-semibold disabled:opacity-45"
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
              <div className="text-xs text-[#59595e] dark:text-[#98989d] bg-[#f5f5f7] dark:bg-[#2c2c2e] rounded-2xl p-6 text-center leading-relaxed">
                No intents waiting for Owner approval. Intents above{' '}
                <span className="font-mono text-[#1d1d1f] dark:text-white">approval_threshold_wei</span> or unallowlisted contract calls appear here.
              </div>
            ) : (
              pendingIntents.map((intent) => (
                <div
                  key={intent.intent_id}
                  className="bg-[#f5f5f7] dark:bg-[#2c2c2e] rounded-2xl p-4 space-y-2.5 text-xs font-mono min-w-0"
                >
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1">
                    <span className="text-[#1d1d1f] dark:text-white font-semibold">
                      {intent.intent_id} · {formatWeiToEth(intent.value_wei)} ETH
                    </span>
                    <span className="text-amber-700 dark:text-amber-300">{intent.reason_code}</span>
                  </div>
                  <div className="text-[#59595e] dark:text-[#98989d] break-all">
                    To: {intent.to} | Chain: {intent.chain_id} | Selector: {intent.calldata_selector}
                  </div>
                  <div className="text-[#59595e] dark:text-[#98989d] break-all">
                    Sighash: 0x{intent.sighash_hex}
                  </div>
                  {ownerSignerConfigured ? (
                    <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 pt-1">
                      <button
                        type="button"
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
                        className="min-h-[40px] px-4 py-2 rounded-full bg-[#34c759] hover:bg-[#2eb350] text-white dark:text-black font-semibold inline-flex items-center justify-center gap-1.5"
                      >
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        <span>Approve & MPC Sign</span>
                      </button>
                      <button
                        type="button"
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
                        className="min-h-[40px] px-4 py-2 rounded-full bg-[#ff3b30]/12 hover:bg-[#ff3b30]/20 text-[#c92a22] dark:text-[#ff6961] font-semibold inline-flex items-center justify-center gap-1.5"
                      >
                        <XCircle className="w-3.5 h-3.5" />
                        <span>Reject</span>
                      </button>
                    </div>
                  ) : (
                    <div className="text-[11px] text-amber-700 dark:text-amber-300">
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
          <div className="space-y-3.5 text-xs min-w-0">
            <div className="p-3 rounded-2xl bg-[#f5f5f7] dark:bg-[#2c2c2e] text-[#59595e] dark:text-[#98989d] flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <span>
                1Click Dry-Run Quote Mode (<code className="font-mono text-[#1d1d1f] dark:text-white">dry: true</code>)
              </span>
              <span className="font-mono font-semibold text-[#146c32] dark:text-[#30d158] shrink-0">
                {tokens.length} Tokens
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 font-mono">
              <div className="min-w-0">
                <label htmlFor="walp-origin-asset" className="text-[#59595e] dark:text-[#98989d] block mb-1">Origin Asset</label>
                <select
                  id="walp-origin-asset"
                  name="originAsset"
                  value={originAsset}
                  onChange={(e) => setOriginAsset(e.target.value)}
                  className="w-full min-h-[40px] bg-[#f5f5f7] dark:bg-[#2c2c2e] border border-black/[0.07] dark:border-white/[0.08] rounded-xl px-3 py-2 text-[#1d1d1f] dark:text-white"
                >
                  {(tokens.length > 0 ? tokens : [{ assetId: 'nep141:wrap.near', symbol: 'wNEAR', blockchain: 'near', decimals: 24 }]).map((t) => (
                    <option key={t.assetId} value={t.assetId}>
                      {t.symbol} ({t.blockchain})
                    </option>
                  ))}
                </select>
              </div>
              <div className="min-w-0">
                <label htmlFor="walp-dest-asset" className="text-[#59595e] dark:text-[#98989d] block mb-1">Destination Asset</label>
                <select
                  id="walp-dest-asset"
                  name="destAsset"
                  value={destAsset}
                  onChange={(e) => setDestAsset(e.target.value)}
                  className="w-full min-h-[40px] bg-[#f5f5f7] dark:bg-[#2c2c2e] border border-black/[0.07] dark:border-white/[0.08] rounded-xl px-3 py-2 text-[#1d1d1f] dark:text-white"
                >
                  {(tokens.length > 0 ? tokens : [{ assetId: 'nep141:eth.omft.near', symbol: 'ETH', blockchain: 'eth', decimals: 18 }]).map((t) => (
                    <option key={t.assetId} value={t.assetId}>
                      {t.symbol} ({t.blockchain})
                    </option>
                  ))}
                </select>
              </div>
              <div className="min-w-0">
                <label htmlFor="walp-1click-amount" className="text-[#59595e] dark:text-[#98989d] block mb-1">Atomic Amount (1e24 = 1 wNEAR)</label>
                <input
                  id="walp-1click-amount"
                  name="amountRaw"
                  value={amountRaw}
                  onChange={(e) => setAmountRaw(e.target.value)}
                  className="w-full min-h-[40px] bg-[#f5f5f7] dark:bg-[#2c2c2e] border border-black/[0.07] dark:border-white/[0.08] rounded-xl px-3 py-2 text-[#1d1d1f] dark:text-white"
                />
              </div>
              <div className="min-w-0">
                <label htmlFor="walp-1click-recipient" className="text-[#59595e] dark:text-[#98989d] block mb-1">Destination Recipient</label>
                <input
                  id="walp-1click-recipient"
                  name="recipientAddr"
                  value={recipientAddr}
                  onChange={(e) => setRecipientAddr(e.target.value)}
                  className="w-full min-h-[40px] bg-[#f5f5f7] dark:bg-[#2c2c2e] border border-black/[0.07] dark:border-white/[0.08] rounded-xl px-3 py-2 text-[#1d1d1f] dark:text-white"
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
              className="w-full sm:w-auto min-h-[44px] px-5 py-2.5 rounded-2xl bg-[#1d1d1f] hover:bg-black dark:bg-[#00ec97] dark:hover:bg-[#00d688] text-white dark:text-black font-semibold inline-flex items-center justify-center gap-2 transition-colors"
            >
              <ArrowRightLeft className="w-3.5 h-3.5" />
              <span>Fetch Live 1Click Dry Quote</span>
            </button>

            {quoteError && (
              <div className="p-3 rounded-2xl bg-[#ff3b30]/10 border border-[#ff3b30]/25 text-[#c92a22] dark:text-[#ff8a80] font-mono break-words">
                {quoteError}
              </div>
            )}

            {quote && (
              <div className="rounded-2xl bg-[#34c759]/[0.08] border border-[#34c759]/30 p-4 font-mono space-y-1.5 min-w-0">
                <div className="flex flex-wrap justify-between gap-2 text-[#1d1d1f] dark:text-white font-semibold">
                  <span>
                    {quote.quote.amountInFormatted} → {quote.quote.amountOutFormatted}
                  </span>
                  <span className="text-[#146c32] dark:text-[#30d158]">~{quote.quote.timeEstimate ?? 30}s</span>
                </div>
                <div className="text-[#59595e] dark:text-[#98989d] break-words">
                  Min Out: {quote.quote.minAmountOut} | USD: ${quote.quote.amountInUsd || '?'} → $
                  {quote.quote.amountOutUsd || '?'}
                </div>
                <div className="text-[#59595e] dark:text-[#98989d]">
                  Policy Slippage Check:{' '}
                  <span className={quote.policyCheck.passed ? 'text-[#146c32] dark:text-[#30d158] font-semibold' : 'text-amber-600 dark:text-amber-300'}>
                    {quote.policyCheck.passed ? 'PASS' : quote.policyCheck.warnings.join('; ')}
                  </span>
                </div>
              </div>
            )}
          </div>
        )}

        {/* TAB 4: AUDIT & RECEIPTS */}
        {tab === 'audit' && (
          <div className="space-y-2.5 min-w-0">
            {activityRecords.length === 0 ? (
              <div className="text-xs text-[#59595e] dark:text-[#98989d] bg-[#f5f5f7] dark:bg-[#2c2c2e] rounded-2xl p-6 text-center">
                Execute an intent or attack test in the Console to view real NearBlocks & Etherscan proofs.
              </div>
            ) : (
              activityRecords.map((rec) => (
                <div
                  key={rec.id}
                  className="rounded-2xl bg-[#f5f5f7] dark:bg-[#2c2c2e] p-3.5 text-xs font-mono space-y-1.5 min-w-0"
                >
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1 min-w-0">
                    <span
                      className={`font-semibold break-all ${
                        rec.outcomeStatus === 'SIGNED'
                          ? 'text-[#146c32] dark:text-[#30d158]'
                          : rec.outcomeStatus === 'PENDING_APPROVAL'
                            ? 'text-amber-700 dark:text-amber-300'
                            : 'text-[#c92a22] dark:text-[#ff6961]'
                      }`}
                    >
                      {rec.outcomeStatus} ({rec.reasonCode})
                    </span>
                    <span className="text-[#59595e] dark:text-[#98989d] shrink-0 text-[11px]">
                      {new Date(rec.timestamp).toLocaleTimeString()}
                    </span>
                  </div>
                  <div className="text-[#1d1d1f] dark:text-[#f5f5f7] line-clamp-2 break-words">
                    {rec.prompt}
                  </div>
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-[#59595e] dark:text-[#98989d]">
                    <span title={rec.toAddress}>To: {shortAddress(rec.toAddress)}</span>
                    <span>Value: {rec.amountEth} ETH</span>
                    {rec.nearExplorerUrl && (
                      <a
                        href={rec.nearExplorerUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="text-[#005bb8] dark:text-[#0a84ff] hover:underline inline-flex items-center gap-1"
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
                        className="text-[#005bb8] dark:text-[#0a84ff] hover:underline inline-flex items-center gap-1"
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
    </section>
  );
};
