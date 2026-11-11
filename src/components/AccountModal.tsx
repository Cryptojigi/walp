import React, { useState } from 'react';
import { X, KeyRound, Sparkles, Check, AlertCircle } from 'lucide-react';
import { NearService } from '../services/near';

interface AccountModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentAccountId: string;
  onSaveAccount: (accountId: string, privateKey?: string) => void;
}

export const AccountModal: React.FC<AccountModalProps> = ({
  isOpen,
  onClose,
  currentAccountId,
  onSaveAccount,
}) => {
  const [accountId, setAccountId] = useState(currentAccountId || 'walp-demo.testnet');
  const [privateKey, setPrivateKey] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [generatedInfo, setGeneratedInfo] = useState<{ publicKey: string; secretKey: string } | null>(null);

  if (!isOpen) return null;

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    if (!accountId.trim()) return;
    onSaveAccount(accountId.trim(), privateKey.trim() || undefined);
    onClose();
  };

  const handleGenerateKeypair = () => {
    setIsGenerating(true);
    const keypair = NearService.generateRandomKeypair();
    const randomSuffix = Math.floor(1000 + Math.random() * 9000);
    const suggestedAccount = `walp-${randomSuffix}.testnet`;
    setAccountId(suggestedAccount);
    setPrivateKey(keypair.secretKey);
    setGeneratedInfo(keypair);
    setIsGenerating(false);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm">
      <div className="bg-[#161b22] border border-[#30363d] rounded-xl max-w-md w-full p-6 shadow-2xl relative">
        
        {/* Header */}
        <div className="flex items-center justify-between pb-4 border-b border-[#21262d]">
          <div className="flex items-center space-x-2">
            <KeyRound className="w-5 h-5 text-[#00ec97]" />
            <h3 className="text-base font-semibold text-white">NEAR Account Configuration</h3>
          </div>
          <button
            onClick={onClose}
            className="text-[#8b949e] hover:text-[#e6edf3] p-1 rounded-md transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Quick Demo Keypair Generator */}
        <div className="mt-4 p-3 bg-[#0d1117] border border-[#21262d] rounded-lg">
          <div className="flex items-center justify-between">
            <span className="text-xs text-[#c9d1d9] font-medium flex items-center space-x-1.5">
              <Sparkles className="w-3.5 h-3.5 text-[#00ec97]" />
              <span>Instant Testnet Keypair</span>
            </span>
            <button
              type="button"
              onClick={handleGenerateKeypair}
              disabled={isGenerating}
              className="px-2.5 py-1 text-xs rounded bg-[#21262d] hover:bg-[#30363d] text-[#e6edf3] border border-[#30363d] transition-colors"
            >
              Generate New
            </button>
          </div>
          <p className="text-[11px] text-[#8b949e] mt-1">
            Generates a valid ed25519 NEAR keypair in local storage for seamless testing.
          </p>
        </div>

        {/* Account Form */}
        <form onSubmit={handleSave} className="mt-4 space-y-4">
          <div>
            <label className="text-xs text-[#8b949e] font-medium block mb-1">
              NEAR Testnet Account ID:
            </label>
            <input
              type="text"
              value={accountId}
              onChange={(e) => setAccountId(e.target.value)}
              placeholder="e.g., yourname.testnet"
              className="w-full bg-[#0d1117] border border-[#30363d] rounded-lg px-3 py-2 text-sm text-[#e6edf3] font-mono focus:outline-none focus:border-[#00ec97]"
              required
            />
          </div>

          <div>
            <label className="text-xs text-[#8b949e] font-medium block mb-1">
              Private Key (Optional - for onchain contract signing):
            </label>
            <input
              type="password"
              value={privateKey}
              onChange={(e) => setPrivateKey(e.target.value)}
              placeholder="ed25519:..."
              className="w-full bg-[#0d1117] border border-[#30363d] rounded-lg px-3 py-2 text-sm text-[#e6edf3] font-mono focus:outline-none focus:border-[#00ec97]"
            />
            <p className="text-[11px] text-[#8b949e] mt-1">
              Leave blank to run in sandbox simulation mode (pre-funded demo signatures).
            </p>
          </div>

          <div className="pt-2 flex justify-end space-x-2">
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
              Save & Activate
            </button>
          </div>
        </form>

      </div>
    </div>
  );
};

