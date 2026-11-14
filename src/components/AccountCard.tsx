import React, { useState } from 'react';
import { Check, Copy, ExternalLink, RefreshCw, ShieldCheck } from 'lucide-react';
import { EVM_CONFIG, NEAR_CONFIG } from '../config/constants';

interface AccountCardProps {
  vaultContractId: string;
  nearBalance: string;
  ethAddress: string;
  ethBalance: string;
  path: string;
  onPathChange: (newPath: string) => void;
  onRefresh: () => void;
  isRefreshing: boolean;
  deployed: boolean;
}

export const AccountCard: React.FC<AccountCardProps> = ({
  vaultContractId,
  nearBalance,
  ethAddress,
  ethBalance,
  path,
  onPathChange,
  onRefresh,
  isRefreshing,
  deployed,
}) => {
  const [copiedNear, setCopiedNear] = useState(false);
  const [copiedEth, setCopiedEth] = useState(false);

  const copyToClipboard = (text: string, type: 'near' | 'eth') => {
    if (!text) return;
    navigator.clipboard.writeText(text);
    if (type === 'near') {
      setCopiedNear(true);
      setTimeout(() => setCopiedNear(false), 1800);
    } else {
      setCopiedEth(true);
      setTimeout(() => setCopiedEth(false), 1800);
    }
  };

  return (
    <section className="rounded-[28px] bg-white dark:bg-[#1c1c1e] border border-black/[0.06] dark:border-white/[0.09] shadow-[0_8px_30px_rgba(0,0,0,0.04)] dark:shadow-[0_12px_36px_rgba(0,0,0,0.35)] p-4 sm:p-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-4 border-b border-black/[0.06] dark:border-white/[0.08] gap-3">
        <div className="min-w-0">
          <h2 className="text-lg sm:text-xl font-semibold tracking-tight text-[#1d1d1f] dark:text-white">
            Vault Custody & Derived MPC Address
          </h2>
          <p className="text-xs sm:text-sm text-[#59595e] dark:text-[#98989d] mt-1 leading-relaxed">
            Derived exclusively from <code className="font-mono text-xs px-1.5 py-0.5 rounded bg-black/[0.05] dark:bg-white/[0.08] text-[#1d1d1f] dark:text-[#f5f5f7] whitespace-nowrap">{NEAR_CONFIG.mpcContractId}</code>. Only validated vault calls can sign.
          </p>
        </div>

        <div className="flex items-center justify-between sm:justify-end gap-2 shrink-0 pt-1 sm:pt-0">
          <div className="flex items-center gap-2 text-xs sm:text-sm bg-[#f5f5f7] dark:bg-[#2c2c2e] rounded-full px-3 py-1.5 sm:px-3.5 sm:py-2 border border-black/[0.05] dark:border-white/[0.06]">
            <label htmlFor="walp-derivation-path" className="text-xs font-medium text-[#59595e] dark:text-[#98989d]">
              Path
            </label>
            <input
              id="walp-derivation-path"
              name="derivationPath"
              type="text"
              value={path}
              onChange={(e) => onPathChange(e.target.value)}
              className="bg-transparent text-xs sm:text-sm font-mono font-medium text-[#1d1d1f] dark:text-white focus:outline-none w-24 sm:w-28"
              placeholder="ethereum-1"
            />
          </div>
          <button
            type="button"
            onClick={onRefresh}
            disabled={isRefreshing}
            className="w-9 h-9 sm:w-10 sm:h-10 rounded-full bg-[#f5f5f7] hover:bg-black/[0.08] dark:bg-[#2c2c2e] dark:hover:bg-[#3a3a3c] flex items-center justify-center text-[#59595e] dark:text-[#98989d] hover:text-[#1d1d1f] dark:hover:text-white transition-colors shrink-0"
            title="Refresh Onchain State"
            aria-label="Refresh Onchain State"
          >
            <RefreshCw className={`w-4 h-4 ${isRefreshing ? 'animate-spin text-[#00a86b] dark:text-[#30d158]' : ''}`} />
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5 sm:gap-4 mt-4 sm:mt-5">
        {/* NEAR Policy Vault Card */}
        <div className="rounded-2xl bg-[#f5f5f7] dark:bg-[#2c2c2e] p-4 sm:p-5 min-w-0 flex flex-col justify-between gap-3 sm:gap-3.5">
          <div className="flex items-center justify-between gap-2 text-xs sm:text-sm">
            <span className="font-medium text-[#59595e] dark:text-[#98989d]">NEAR Policy Vault Contract</span>
            <span
              className={`font-semibold px-2 sm:px-2.5 py-0.5 sm:py-1 rounded-full text-xs shrink-0 ${
                deployed
                  ? 'bg-[#34c759]/15 text-[#146c32] dark:bg-[#30d158]/15 dark:text-[#30d158]'
                  : 'bg-black/[0.06] text-[#59595e] dark:bg-white/[0.08] dark:text-[#98989d]'
              }`}
            >
              {deployed ? 'Onchain Active' : 'Not Deployed'}
            </span>
          </div>

          <div className="flex items-center justify-between gap-2 min-w-0">
            <div className="font-mono text-sm sm:text-base font-semibold text-[#1d1d1f] dark:text-white truncate min-w-0">
              {vaultContractId || 'Set WALP_VAULT_CONTRACT_ID in .env'}
            </div>
            {vaultContractId && (
              <div className="flex items-center gap-1 sm:gap-1.5 shrink-0">
                <button
                  type="button"
                  onClick={() => copyToClipboard(vaultContractId, 'near')}
                  className="w-8 h-8 rounded-full bg-white dark:bg-[#1c1c1e] flex items-center justify-center text-[#59595e] dark:text-[#98989d] hover:text-[#1d1d1f] dark:hover:text-white transition-colors"
                  title="Copy contract ID"
                >
                  {copiedNear ? <Check className="w-3.5 h-3.5 text-[#00a86b] dark:text-[#30d158]" /> : <Copy className="w-3.5 h-3.5" />}
                </button>
                <a
                  href={`${NEAR_CONFIG.explorerUrl}/address/${vaultContractId}`}
                  target="_blank"
                  rel="noreferrer"
                  className="w-8 h-8 rounded-full bg-white dark:bg-[#1c1c1e] flex items-center justify-center text-[#59595e] dark:text-[#98989d] hover:text-[#005bb8] dark:hover:text-[#0a84ff] transition-colors"
                  title="View on NearBlocks"
                >
                  <ExternalLink className="w-3.5 h-3.5" />
                </a>
              </div>
            )}
          </div>

          <div className="pt-3 border-t border-black/[0.06] dark:border-white/[0.08] flex items-center justify-between gap-2">
            <span className="text-xs sm:text-sm font-medium text-[#59595e] dark:text-[#98989d] whitespace-nowrap">
              <span className="sm:hidden">NEAR Balance</span>
              <span className="hidden sm:inline">Contract NEAR Balance</span>
            </span>
            <div className="font-mono text-lg sm:text-2xl font-bold text-[#1d1d1f] dark:text-white whitespace-nowrap inline-flex items-baseline gap-1">
              <span>{nearBalance}</span>
              <span className="text-xs sm:text-sm font-medium text-[#59595e] dark:text-[#98989d]">NEAR</span>
            </div>
          </div>
        </div>

        {/* Derived Sepolia Card */}
        <div className="rounded-2xl bg-[#f5f5f7] dark:bg-[#2c2c2e] p-4 sm:p-5 min-w-0 flex flex-col justify-between gap-3 sm:gap-3.5">
          <div className="flex items-center justify-between gap-2 text-xs sm:text-sm">
            <span className="font-medium text-[#59595e] dark:text-[#98989d] flex items-center gap-1.5 min-w-0">
              <span className="truncate">Sepolia (MPC Derived)</span>
              <ShieldCheck className="w-4 h-4 text-[#00a86b] dark:text-[#30d158] shrink-0" />
            </span>
            {ethAddress && (
              <a
                href={`${EVM_CONFIG.sepolia.blockExplorerUrl}/address/${ethAddress}`}
                target="_blank"
                rel="noreferrer"
                className="text-[#005bb8] dark:text-[#0a84ff] hover:underline font-medium text-xs sm:text-sm flex items-center gap-1 shrink-0"
              >
                <span>Etherscan</span>
                <ExternalLink className="w-3.5 h-3.5" />
              </a>
            )}
          </div>

          <div className="flex items-center justify-between gap-2 min-w-0">
            <div className="font-mono text-sm sm:text-base font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] truncate min-w-0" title={ethAddress}>
              {ethAddress || 'Derives once vault contract ID is set'}
            </div>
            {ethAddress && (
              <button
                type="button"
                onClick={() => copyToClipboard(ethAddress, 'eth')}
                className="w-8 h-8 rounded-full bg-white dark:bg-[#1c1c1e] flex items-center justify-center text-[#59595e] dark:text-[#98989d] hover:text-[#1d1d1f] dark:hover:text-white transition-colors shrink-0"
                title="Copy Sepolia address"
              >
                {copiedEth ? <Check className="w-3.5 h-3.5 text-[#00a86b] dark:text-[#30d158]" /> : <Copy className="w-3.5 h-3.5" />}
              </button>
            )}
          </div>

          <div className="pt-3 border-t border-black/[0.06] dark:border-white/[0.08] flex items-center justify-between gap-2">
            <span className="text-xs sm:text-sm font-medium text-[#59595e] dark:text-[#98989d] whitespace-nowrap">
              Sepolia Balance
            </span>
            <div className="font-mono text-lg sm:text-2xl font-bold text-[#1d1d1f] dark:text-white whitespace-nowrap inline-flex items-baseline gap-1">
              <span>{ethBalance}</span>
              <span className="text-xs sm:text-sm font-medium text-[#59595e] dark:text-[#98989d]">ETH</span>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
};
