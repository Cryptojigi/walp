import React, { useEffect, useState } from 'react';
import { X, Server, Shield, CheckCircle2, AlertTriangle } from 'lucide-react';
import { ServerHealth } from '../types';

interface ContractModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentContractId: string;
  onApplyContractId: (contractId: string) => void;
  health: ServerHealth | null;
}

export const ContractModal: React.FC<ContractModalProps> = ({
  isOpen,
  onClose,
  currentContractId,
  onApplyContractId,
  health,
}) => {
  const [contractId, setContractId] = useState(currentContractId);

  useEffect(() => {
    setContractId(currentContractId);
  }, [currentContractId, isOpen]);

  if (!isOpen) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onApplyContractId(contractId.trim());
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm">
      <div className="bg-[#161b22] border border-[#30363d] rounded-xl max-w-md w-full p-6 shadow-2xl">
        <div className="flex items-center justify-between pb-4 border-b border-[#21262d]">
          <div className="flex items-center space-x-2">
            <Server className="w-5 h-5 text-[#00ec97]" />
            <h3 className="text-base font-semibold text-white">Vault & Server Configuration</h3>
          </div>
          <button onClick={onClose} className="text-[#8b949e] hover:text-[#e6edf3] p-1">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="mt-4 space-y-2 bg-[#0d1117] border border-[#21262d] rounded-lg p-3 text-xs">
          <div className="flex items-center justify-between">
            <span className="text-[#8b949e]">NEAR AI Cloud TEE Key (.env)</span>
            {health?.nearAiConfigured ? (
              <span className="text-[#00ec97] flex items-center space-x-1 font-mono">
                <CheckCircle2 className="w-3.5 h-3.5" />
                <span>Configured</span>
              </span>
            ) : (
              <span className="text-amber-400 flex items-center space-x-1 font-mono">
                <AlertTriangle className="w-3.5 h-3.5" />
                <span>Fallback</span>
              </span>
            )}
          </div>
          <div className="flex items-center justify-between">
            <span className="text-[#8b949e]">Scoped Agent Key (.env)</span>
            <span className="font-mono text-[#c9d1d9]">
              {health?.agentAccountConfigured ? health.agentAccountId : 'Not configured'}
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-[#8b949e]">Owner Admin Key (.env)</span>
            <span className="font-mono text-[#c9d1d9]">
              {health?.ownerSignerConfigured ? health.ownerAccountId : 'CLI / Wallet only'}
            </span>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="mt-4 space-y-4">
          <div>
            <label className="text-xs text-[#8b949e] font-medium block mb-1">
              Target Vault Contract ID (NEAR Testnet)
            </label>
            <input
              type="text"
              value={contractId}
              onChange={(e) => setContractId(e.target.value)}
              placeholder="walp-vault.your-account.testnet"
              className="w-full bg-[#0d1117] border border-[#30363d] rounded-lg px-3 py-2 text-sm text-[#e6edf3] font-mono focus:outline-none focus:border-[#00ec97]"
            />
            <p className="text-[11px] text-[#8b949e] mt-1.5 flex items-start space-x-1.5">
              <Shield className="w-3.5 h-3.5 text-[#00ec97] flex-shrink-0 mt-0.5" />
              <span>
                Private keys never enter browser storage. Signing keys remain server-side in <code className="text-[#c9d1d9]">.env</code>.
              </span>
            </p>
          </div>

          <div className="flex justify-end space-x-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-lg bg-[#21262d] hover:bg-[#30363d] text-sm text-[#e6edf3]"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-4 py-2 rounded-lg bg-[#00ec97] hover:bg-[#00d688] text-sm font-semibold text-black"
            >
              Inspect Vault
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
