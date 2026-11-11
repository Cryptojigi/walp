import React, { useState } from 'react';
import { Copy, Check, ExternalLink, ArrowRight, ShieldCheck, RefreshCw } from 'lucide-react';
import { EVM_CONFIG } from '../config/constants';

interface AccountCardProps {
  nearAccountId: string;
  nearBalance: string;
  ethAddress: string;
  ethBalance: string;
  path: string;
  onPathChange: (newPath: string) => void;
  onRefresh: () => void;
  isRefreshing: boolean;
}

export const AccountCard: React.FC<AccountCardProps> = ({
  nearAccountId,
  nearBalance,
  ethAddress,
  ethBalance,
  path,
  onPathChange,
  onRefresh,
  isRefreshing,
}) => {
  const [copiedNear, setCopiedNear] = useState(false);
  const [copiedEth, setCopiedEth] = useState(false);

  const copyToClipboard = (text: string, type: 'near' | 'eth') => {
    navigator.clipboard.writeText(text);
    if (type === 'near') {
      setCopiedNear(true);
      setTimeout(() => setCopiedNear(false), 2000);
    } else {
      setCopiedEth(true);
      setTimeout(() => setCopiedEth(false), 2000);
    }
  };

  return (
    <div className="bg-[#161b22] border border-[#30363d] rounded-xl p-5 shadow-sm">
      <div className="flex flex-col md:flex-row md:items-center justify-between pb-4 border-b border-[#21262d] gap-3">
        <div>
          <h2 className="text-base font-semibold text-white flex items-center space-x-2">
            <span>Omnichain Derived Identity</span>
            <span className="text-xs font-normal text-[#8b949e]">Additive Key Derivation (AKD)</span>
          </h2>
          <p className="text-xs text-[#8b949e] mt-0.5">
            One NEAR account mathematically controls native addresses across any blockchain via Multi-Party Computation.
          </p>
        </div>

        <div className="flex items-center space-x-3">
          <div className="flex items-center space-x-2 text-xs">
            <span className="text-[#8b949e]">Path:</span>
            <input
              type="text"
              value={path}
              onChange={(e) => onPathChange(e.target.value)}
              className="bg-[#0d1117] border border-[#30363d] rounded px-2.5 py-1 text-xs font-mono text-[#e6edf3] focus:outline-none focus:border-[#00ec97] w-28"
              placeholder="ethereum-1"
            />
          </div>

          <button
            onClick={onRefresh}
            disabled={isRefreshing}
            className="p-1.5 rounded-md text-[#8b949e] hover:text-[#e6edf3] hover:bg-[#21262d] transition-colors"
            title="Refresh Balances"
          >
            <RefreshCw className={`w-4 h-4 ${isRefreshing ? 'animate-spin text-[#00ec97]' : ''}`} />
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
        
        {/* NEAR Controller Side */}
        <div className="bg-[#0d1117] border border-[#21262d] rounded-lg p-4">
          <div className="flex items-center justify-between text-xs text-[#8b949e] mb-1">
            <span className="font-medium text-[#c9d1d9]">NEAR Protocol (Orchestrator)</span>
            <span>Testnet</span>
          </div>

          <div className="mt-2 flex items-center justify-between">
            <div className="font-mono text-sm font-semibold text-white truncate max-w-[220px]">
              {nearAccountId || 'Not Connected'}
            </div>
            {nearAccountId && (
              <button
                onClick={() => copyToClipboard(nearAccountId, 'near')}
                className="text-[#8b949e] hover:text-[#e6edf3] p-1"
              >
                {copiedNear ? <Check className="w-3.5 h-3.5 text-[#00ec97]" /> : <Copy className="w-3.5 h-3.5" />}
              </button>
            )}
          </div>

          <div className="mt-4 pt-3 border-t border-[#21262d] flex items-baseline justify-between">
            <span className="text-xs text-[#8b949e]">Balance:</span>
            <span className="font-mono text-base font-bold text-[#e6edf3]">
              {nearBalance} <span className="text-xs text-[#8b949e] font-normal">NEAR</span>
            </span>
          </div>
        </div>

        {/* Foreign Derived Address Side (Ethereum Sepolia) */}
        <div className="bg-[#0d1117] border border-[#21262d] rounded-lg p-4">
          <div className="flex items-center justify-between text-xs text-[#8b949e] mb-1">
            <span className="font-medium text-[#c9d1d9] flex items-center space-x-1.5">
              <span>Ethereum Sepolia (Derived)</span>
              <span title="Cryptographically verified via NEAR MPC">
                <ShieldCheck className="w-3.5 h-3.5 text-[#00ec97]" />
              </span>
            </span>
            <a
              href={`${EVM_CONFIG.sepolia.blockExplorerUrl}/address/${ethAddress}`}
              target="_blank"
              rel="noreferrer"
              className="text-[#00ec97] hover:underline flex items-center space-x-1"
            >
              <span>Etherscan</span>
              <ExternalLink className="w-3 h-3" />
            </a>
          </div>

          <div className="mt-2 flex items-center justify-between">
            <div className="font-mono text-xs text-[#8b949e] truncate max-w-[220px]" title={ethAddress}>
              {ethAddress}
            </div>
            {ethAddress && (
              <button
                onClick={() => copyToClipboard(ethAddress, 'eth')}
                className="text-[#8b949e] hover:text-[#e6edf3] p-1"
              >
                {copiedEth ? <Check className="w-3.5 h-3.5 text-[#00ec97]" /> : <Copy className="w-3.5 h-3.5" />}
              </button>
            )}
          </div>

          <div className="mt-4 pt-3 border-t border-[#21262d] flex items-baseline justify-between">
            <span className="text-xs text-[#8b949e]">Balance:</span>
            <span className="font-mono text-base font-bold text-[#e6edf3]">
              {ethBalance} <span className="text-xs text-[#8b949e] font-normal">ETH</span>
            </span>
          </div>
        </div>

      </div>

      {/* Info note */}
      <div className="mt-4 flex items-center justify-between text-xs text-[#8b949e] bg-[#0d1117]/50 px-3 py-2 rounded border border-[#21262d]">
        <div className="flex items-center space-x-2">
          <span>Need test tokens for this derived Sepolia address?</span>
          <a
            href="https://sepoliafaucet.com"
            target="_blank"
            rel="noreferrer"
            className="text-[#00ec97] hover:underline flex items-center space-x-0.5"
          >
            <span>Sepolia Faucet</span>
            <ExternalLink className="w-3 h-3" />
          </a>
        </div>
        <span className="hidden sm:inline text-[#8b949e]">No seed phrases. No external private key stored.</span>
      </div>
    </div>
  );
};
