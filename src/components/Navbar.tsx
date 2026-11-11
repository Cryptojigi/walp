import React from 'react';
import { KeyRound } from 'lucide-react';

interface NavbarProps {
  nearAccountId: string;
  onOpenAccountModal: () => void;
}

export const Navbar: React.FC<NavbarProps> = ({ nearAccountId, onOpenAccountModal }) => {
  return (
    <header className="border-b border-[#21262d] bg-[#0d1117]/90 backdrop-blur sticky top-0 z-40">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
        
        {/* Brand */}
        <div className="flex items-center space-x-3.5">
          {/* Custom Walp Monogram Emblem */}
          <div className="w-9 h-9 rounded-lg bg-[#161b22] border border-[#30363d] flex items-center justify-center p-1.5 shadow-sm">
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
            <div className="flex items-center space-x-2.5">
              <span className="font-extrabold tracking-tight text-white text-xl uppercase font-mono">Walp</span>
              <span className="text-[11px] px-2 py-0.5 rounded bg-[#161b22] text-[#8b949e] font-mono border border-[#21262d]">
                MPC Core
              </span>
            </div>
            <p className="text-xs text-[#8b949e] hidden sm:block">
              Autonomous Cross-Chain Agent powered by NEAR Chain Signatures
            </p>
          </div>
        </div>

        {/* Network & Account Controls */}
        <div className="flex items-center space-x-3">
          <div className="hidden md:flex items-center space-x-2 text-xs font-mono bg-[#161b22] px-3 py-1.5 rounded-md border border-[#30363d] text-[#8b949e]">
            <span>NEAR Testnet</span>
            <span className="text-[#30363d]">/</span>
            <span>Sepolia</span>
          </div>

          <button
            onClick={onOpenAccountModal}
            className="flex items-center space-x-2 px-3 py-1.5 rounded-md bg-[#21262d] hover:bg-[#30363d] border border-[#30363d] text-sm text-[#e6edf3] transition-colors"
          >
            <KeyRound className="w-4 h-4 text-[#00ec97]" />
            <span className="font-mono text-xs font-medium">
              {nearAccountId ? nearAccountId : 'Connect Account'}
            </span>
          </button>
        </div>

      </div>
    </header>
  );
};
