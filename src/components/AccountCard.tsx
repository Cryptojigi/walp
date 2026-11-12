import React, { useState } from 'react';
import { Copy, Check, ExternalLink, ShieldCheck, RefreshCw } from 'lucide-react';
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
    <div className="bg-[#161b22] border border-[#30363d] rounded-xl p-5">
      <div className="flex flex-col md:flex-row md:items-center justify-between pb-4 border-b border-[#21262d] gap-3">
        <div>
          <h2 className="text-base font-semibold text-white">
            Vault Custody & Derived MPC Address
          </h2>
          <p className="text-xs text-[#8b949e] mt-0.5">
            Only the NEAR smart contract account can request signatures for this derived Sepolia address via {NEAR_CONFIG.mpcContractId}.
          </p>
        </div>

        <div className="flex items-center space-x-3">
          <div className="flex items-center space-x-2 text-xs">
            <span className="text-[#8b949e]">Path:</span>
            <input
              type="text"
              value={path}
              onChange={(e) => onPathChange(e.target.value)}
              className="bg-[#0d1117] border border-[#30363d] rounded px-2.5 py-1 text-xs font-mono text-[#e6edf3] focus:outline-none focus:border-[#00ec97] w-32"
              placeholder="ethereum-1"
            />
          </div>
          <button
            onClick={onRefresh}
            disabled={isRefreshing}
            className="p-1.5 rounded-md text-[#8b949e] hover:text-[#e6edf3] hover:bg-[#21262d] transition-colors"
            title="Refresh Onchain State"
          >
            <RefreshCw className={`w-4 h-4 ${isRefreshing ? 'animate-spin text-[#00ec97]' : ''}`} />
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
        <div className="bg-[#0d1117] border border-[#21262d] rounded-lg p-4">
          <div className="flex items-center justify-between text-xs text-[#8b949e] mb-1">
            <span className="font-medium text-[#c9d1d9]">NEAR Policy Vault Contract</span>
            <span className="font-mono">{deployed ? 'Onchain Active' : 'Not Deployed'}</span>
          </div>
          <div className="mt-2 flex items-center justify-between">
            <div className="font-mono text-sm font-semibold text-white truncate">
              {vaultContractId || 'Set WALP_VAULT_CONTRACT_ID in .env'}
            </div>
            {vaultContractId && (
              <div className="flex items-center space-x-1">
                <button
                  onClick={() => copyToClipboard(vaultContractId, 'near')}
                  className="text-[#8b949e] hover:text-[#e6edf3] p-1"
                  title="Copy contract ID"
                >
                  {copiedNear ? <Check className="w-3.5 h-3.5 text-[#00ec97]" /> : <Copy className="w-3.5 h-3.5" />}
                </button>
                <a
                  href={`${NEAR_CONFIG.explorerUrl}/address/${vaultContractId}`}
                  target="_blank"
                  rel="noreferrer"
                  className="text-[#8b949e] hover:text-[#00ec97] p-1"
                  title="View on NearBlocks"
                >
                  <ExternalLink className="w-3.5 h-3.5" />
                </a>
              </div>
            )}
          </div>
          <div className="mt-4 pt-3 border-t border-[#21262d] flex items-baseline justify-between">
            <span className="text-xs text-[#8b949e]">Contract NEAR Balance</span>
            <span className="font-mono text-base font-bold text-[#e6edf3]">
              {nearBalance} <span className="text-xs text-[#8b949e] font-normal">NEAR</span>
            </span>
          </div>
        </div>

        <div className="bg-[#0d1117] border border-[#21262d] rounded-lg p-4">
          <div className="flex items-center justify-between text-xs text-[#8b949e] mb-1">
            <span className="font-medium text-[#c9d1d9] flex items-center space-x-1.5">
              <span>Ethereum Sepolia (MPC Derived)</span>
              <ShieldCheck className="w-3.5 h-3.5 text-[#00ec97]" />
            </span>
            {ethAddress && (
              <a
                href={`${EVM_CONFIG.sepolia.blockExplorerUrl}/address/${ethAddress}`}
                target="_blank"
                rel="noreferrer"
                className="text-[#00ec97] hover:underline flex items-center space-x-1"
              >
                <span>Etherscan</span>
                <ExternalLink className="w-3 h-3" />
              </a>
            )}
          </div>
          <div className="mt-2 flex items-center justify-between">
            <div className="font-mono text-xs text-[#c9d1d9] truncate" title={ethAddress}>
              {ethAddress || 'Derives once vault contract ID is set'}
            </div>
            {ethAddress && (
              <button
                onClick={() => copyToClipboard(ethAddress, 'eth')}
                className="text-[#8b949e] hover:text-[#e6edf3] p-1"
                title="Copy Sepolia address"
              >
                {copiedEth ? <Check className="w-3.5 h-3.5 text-[#00ec97]" /> : <Copy className="w-3.5 h-3.5" />}
              </button>
            )}
          </div>
          <div className="mt-4 pt-3 border-t border-[#21262d] flex items-baseline justify-between">
            <span className="text-xs text-[#8b949e]">Sepolia Balance</span>
            <span className="font-mono text-base font-bold text-[#e6edf3]">
              {ethBalance} <span className="text-xs text-[#8b949e] font-normal">ETH</span>
            </span>
          </div>
        </div>
      </div>
    </div>
  );
};
