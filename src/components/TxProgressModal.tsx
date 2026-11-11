import React from 'react';
import { CheckCircle2, CircleDashed, AlertCircle, ExternalLink, X, Shield, ArrowRight } from 'lucide-react';
import { ExecutionStep } from '../types';

interface TxProgressModalProps {
  isOpen: boolean;
  onClose: () => void;
  steps: ExecutionStep[];
  error?: string | null;
  finalTxHash?: string | null;
  explorerUrl?: string | null;
}

export const TxProgressModal: React.FC<TxProgressModalProps> = ({
  isOpen,
  onClose,
  steps,
  error,
  finalTxHash,
  explorerUrl,
}) => {
  if (!isOpen) return null;

  const isAllComplete = steps.length > 0 && steps.every((s) => s.status === 'success');
  const hasError = !!error || steps.some((s) => s.status === 'error');

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm">
      <div className="bg-[#161b22] border border-[#30363d] rounded-xl max-w-lg w-full p-6 shadow-2xl relative">
        
        {/* Header */}
        <div className="flex items-center justify-between pb-4 border-b border-[#21262d]">
          <div className="flex items-center space-x-2">
            <Shield className="w-5 h-5 text-[#00ec97]" />
            <h3 className="text-base font-semibold text-white">
              NEAR Chain Signatures Pipeline
            </h3>
          </div>
          {(isAllComplete || hasError) && (
            <button
              onClick={onClose}
              className="text-[#8b949e] hover:text-[#e6edf3] p-1 rounded-md transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          )}
        </div>

        {/* Step-by-step Execution List */}
        <div className="mt-5 space-y-4">
          {steps.map((step, idx) => {
            const isPending = step.status === 'pending';
            const isSuccess = step.status === 'success';
            const isError = step.status === 'error';
            const isIdle = step.status === 'idle';

            return (
              <div key={step.id} className="flex items-start space-x-3">
                <div className="mt-0.5 flex-shrink-0">
                  {isSuccess && <CheckCircle2 className="w-5 h-5 text-[#00ec97]" />}
                  {isPending && <CircleDashed className="w-5 h-5 text-blue-400 animate-spin" />}
                  {isError && <AlertCircle className="w-5 h-5 text-rose-500" />}
                  {isIdle && (
                    <div className="w-5 h-5 rounded-full border border-[#30363d] text-[10px] font-mono text-[#8b949e] flex items-center justify-center">
                      {idx + 1}
                    </div>
                  )}
                </div>

                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-[#e6edf3] flex items-center justify-between">
                    <span>{step.title}</span>
                    <span className="text-[11px] font-mono text-[#8b949e] capitalize">{step.status}</span>
                  </div>
                  <p className="text-xs text-[#8b949e] mt-0.5">{step.description}</p>
                  
                  {step.detail && (
                    <div className="mt-1 text-[11px] font-mono bg-[#0d1117] px-2.5 py-1 rounded border border-[#21262d] text-[#c9d1d9] truncate">
                      {step.detail}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {/* Error message display */}
        {hasError && error && (
          <div className="mt-5 p-3 rounded-lg bg-rose-950/40 border border-rose-900/50 text-xs text-rose-300">
            <span className="font-semibold block mb-0.5">Execution Failed:</span>
            {error}
          </div>
        )}

        {/* Final Success Link */}
        {isAllComplete && explorerUrl && (
          <div className="mt-5 p-4 rounded-lg bg-[#0d1117] border border-[#00ec97]/40">
            <div className="flex items-center justify-between">
              <div>
                <span className="text-xs text-[#00ec97] font-semibold block">
                  Broadcasted & Verified on Ethereum Sepolia!
                </span>
                <span className="text-xs text-[#8b949e] font-mono truncate max-w-xs block mt-0.5">
                  {finalTxHash}
                </span>
              </div>
              <a
                href={explorerUrl}
                target="_blank"
                rel="noreferrer"
                className="px-3 py-1.5 rounded bg-[#00ec97] hover:bg-[#00d688] text-black text-xs font-semibold flex items-center space-x-1.5 transition-colors"
              >
                <span>View on Etherscan</span>
                <ExternalLink className="w-3.5 h-3.5" />
              </a>
            </div>
          </div>
        )}

        {/* Close Button when done */}
        {(isAllComplete || hasError) && (
          <div className="mt-6 flex justify-end">
            <button
              onClick={onClose}
              className="px-4 py-2 rounded-lg bg-[#21262d] hover:bg-[#30363d] text-sm font-medium text-[#e6edf3] transition-colors"
            >
              Close
            </button>
          </div>
        )}

      </div>
    </div>
  );
};

