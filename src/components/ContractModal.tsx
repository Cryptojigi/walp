import React, { useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, Server, Shield, X } from 'lucide-react';
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
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center sm:p-4 bg-black/50 backdrop-blur-md">
      <div className="bg-white dark:bg-[#1c1c1e] border border-black/[0.08] dark:border-white/[0.1] rounded-t-[28px] sm:rounded-[28px] max-w-md w-full p-6 shadow-2xl space-y-5">
        <div className="flex items-center justify-between pb-3 border-b border-black/[0.06] dark:border-white/[0.08]">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-8 h-8 rounded-xl bg-[#f5f5f7] dark:bg-[#2c2c2e] flex items-center justify-center shrink-0">
              <Server className="w-4 h-4 text-[#00a86b] dark:text-[#30d158]" />
            </div>
            <h3 className="text-base font-semibold text-[#1d1d1f] dark:text-white truncate">
              Vault & Server Configuration
            </h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-8 h-8 rounded-full bg-[#f5f5f7] dark:bg-[#2c2c2e] flex items-center justify-center text-[#59595e] dark:text-[#98989d] hover:text-[#1d1d1f] dark:hover:text-white shrink-0"
            aria-label="Close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="rounded-2xl bg-[#f5f5f7] dark:bg-[#2c2c2e] divide-y divide-black/[0.05] dark:divide-white/[0.06] text-xs">
          <div className="p-3 flex items-center justify-between gap-2">
            <span className="text-[#59595e] dark:text-[#98989d]">NEAR AI Cloud TEE Key</span>
            {health?.nearAiConfigured ? (
              <span className="text-[#146c32] dark:text-[#30d158] flex items-center gap-1 font-mono font-medium">
                <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                <span>Configured</span>
              </span>
            ) : (
              <span className="text-amber-600 dark:text-amber-400 flex items-center gap-1 font-mono font-medium">
                <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                <span>Fallback</span>
              </span>
            )}
          </div>
          <div className="p-3 flex items-center justify-between gap-2">
            <span className="text-[#59595e] dark:text-[#98989d] shrink-0">Scoped Agent Key</span>
            <span className="font-mono text-[#1d1d1f] dark:text-white truncate">
              {health?.agentAccountConfigured ? health.agentAccountId : 'Not configured'}
            </span>
          </div>
          <div className="p-3 flex items-center justify-between gap-2">
            <span className="text-[#59595e] dark:text-[#98989d] shrink-0">Owner Admin Key</span>
            <span className="font-mono text-[#1d1d1f] dark:text-white truncate">
              {health?.ownerSignerConfigured ? health.ownerAccountId : 'CLI / Wallet only'}
            </span>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="walp-modal-contract-id" className="text-xs text-[#59595e] dark:text-[#98989d] font-medium block mb-1.5">
              Target Vault Contract ID (NEAR Testnet)
            </label>
            <input
              id="walp-modal-contract-id"
              name="vaultContractId"
              type="text"
              value={contractId}
              onChange={(e) => setContractId(e.target.value)}
              placeholder="walp-vault.your-account.testnet"
              className="w-full bg-[#f5f5f7] dark:bg-[#2c2c2e] border border-black/[0.08] dark:border-white/[0.1] rounded-2xl px-3.5 py-2.5 text-sm text-[#1d1d1f] dark:text-white font-mono focus:outline-none focus:ring-2 focus:ring-[#005bb8] dark:focus:ring-[#0a84ff]"
            />
            <p className="text-[11px] text-[#59595e] dark:text-[#98989d] mt-2 flex items-start gap-1.5 leading-relaxed">
              <Shield className="w-3.5 h-3.5 text-[#00a86b] dark:text-[#30d158] shrink-0 mt-0.5" />
              <span>
                Private keys never enter browser storage. Signing keys remain server-side in{' '}
                <code className="font-mono text-[#1d1d1f] dark:text-white">.env</code>.
              </span>
            </p>
          </div>

          <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="min-h-[44px] px-5 py-2.5 rounded-full bg-[#f5f5f7] hover:bg-black/[0.08] dark:bg-[#2c2c2e] dark:hover:bg-[#3a3a3c] text-sm font-medium text-[#1d1d1f] dark:text-white transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="min-h-[44px] px-5 py-2.5 rounded-full bg-[#1d1d1f] hover:bg-black dark:bg-[#f5f5f7] dark:hover:bg-white text-sm font-semibold text-white dark:text-[#1d1d1f] transition-colors"
            >
              Inspect Vault
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
