import React from 'react';
import { ShieldAlert, ShieldCheck, Settings2 } from 'lucide-react';

interface NavbarProps {
  vaultContractId: string;
  paused: boolean;
  nearAiConfigured: boolean;
  onOpenConfigModal: () => void;
}

export const Navbar: React.FC<NavbarProps> = ({
  vaultContractId,
  paused,
  nearAiConfigured,
  onOpenConfigModal,
}) => {
  return (
    <header className="border-b border-[#21262d] bg-[#0d1117]/95 backdrop-blur sticky top-0 z-40">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between gap-4">
        {/* Brand */}
        <div className="flex items-center space-x-3">
          <div className="w-9 h-9 rounded-lg bg-[#161b22] border border-[#30363d] flex items-center justify-center p-1.5">
            <svg viewBox="0 0 32 32" fill="none" className="w-full h-full" xmlns="http://www.w3.org/2000/svg">
              <path
                d="M5 9L11 24.5L16 13.5L21 24.5L27 9"
                stroke="#00EC97"
                strokeWidth="2.75"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              <circle cx="16" cy="13.5" r="2.25" fill="#FFFFFF" />
            </svg>
          </div>
          <div>
            <div className="flex items-center space-x-2">
              <span className="font-bold tracking-tight text-white text-lg font-mono">Walp</span>
              <span className="text-xs px-2 py-0.5 rounded bg-[#161b22] text-[#8b949e] font-mono border border-[#21262d]">
                RLP Firewall + Chain Signatures
              </span>
            </div>
            <p className="text-xs text-[#8b949e] hidden sm:block">
              Onchain NEAR policy vault governing MPC secp256k1 execution
            </p>
          </div>
        </div>

        {/* Status & Controls */}
        <div className="flex items-center space-x-2.5">
          <span className="hidden lg:inline-flex text-xs font-mono px-2.5 py-1 rounded-md bg-[#161b22] border border-[#30363d] text-[#8b949e]">
            {nearAiConfigured ? 'NEAR AI TEE Ready' : 'Parser Fallback Mode'}
          </span>

          <span
            className={`inline-flex items-center space-x-1.5 text-xs font-mono px-2.5 py-1 rounded-md border ${
              paused
                ? 'bg-rose-950/50 border-rose-800 text-rose-300'
                : 'bg-[#161b22] border-[#30363d] text-[#00ec97]'
            }`}
          >
            {paused ? <ShieldAlert className="w-3.5 h-3.5" /> : <ShieldCheck className="w-3.5 h-3.5" />}
            <span>{paused ? 'Vault Paused' : 'Firewall Active'}</span>
          </span>

          <button
            onClick={onOpenConfigModal}
            className="flex items-center space-x-2 px-3 py-1.5 rounded-md bg-[#21262d] hover:bg-[#30363d] border border-[#30363d] text-xs font-mono text-[#e6edf3] transition-colors"
          >
            <Settings2 className="w-3.5 h-3.5 text-[#00ec97]" />
            <span className="truncate max-w-[180px]">
              {vaultContractId || 'Configure Vault'}
            </span>
          </button>
        </div>
      </div>
    </header>
  );
};
