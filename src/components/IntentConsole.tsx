import React, { useState, useEffect } from 'react';
import { Terminal, Send, Zap, Bot, Info, ArrowUpRight } from 'lucide-react';
import { AgentService, ParsedIntent } from '../services/agent';

interface IntentConsoleProps {
  derivedEthAddress: string;
  onExecute: (intent: ParsedIntent) => void;
  isExecuting: boolean;
}

export const IntentConsole: React.FC<IntentConsoleProps> = ({
  derivedEthAddress,
  onExecute,
  isExecuting,
}) => {
  const [prompt, setPrompt] = useState('');
  const [parsed, setParsed] = useState<ParsedIntent | null>(null);

  // Update intent parsing when prompt or derivedEthAddress changes
  useEffect(() => {
    if (prompt.trim()) {
      const result = AgentService.parseIntent(prompt, derivedEthAddress);
      setParsed(result);
    } else {
      setParsed(null);
    }
  }, [prompt, derivedEthAddress]);

  const presets = AgentService.getDemoPresets(derivedEthAddress);

  const handleSelectPreset = (presetPrompt: string) => {
    setPrompt(presetPrompt);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!parsed || isExecuting) return;
    onExecute(parsed);
  };

  return (
    <div className="bg-[#161b22] border border-[#30363d] rounded-xl p-5 shadow-sm">
      
      {/* Header */}
      <div className="flex items-center justify-between pb-3 border-b border-[#21262d]">
        <div className="flex items-center space-x-2">
          <Bot className="w-5 h-5 text-[#00ec97]" />
          <h2 className="text-base font-semibold text-white">Autonomous Intent Engine</h2>
        </div>
        <span className="text-xs text-[#8b949e]">Natural Language to Multi-Chain Execution</span>
      </div>

      {/* Preset Action Buttons */}
      <div className="mt-4">
        <label className="text-xs text-[#8b949e] font-medium block mb-2">
          Quick-Start Hackathon Demo Actions:
        </label>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
          {presets.map((p) => (
            <button
              key={p.id}
              onClick={() => handleSelectPreset(p.prompt)}
              className="text-left p-3 rounded-lg bg-[#0d1117] hover:bg-[#21262d] border border-[#21262d] hover:border-[#30363d] transition-all group"
            >
              <div className="flex items-center justify-between text-xs font-semibold text-[#e6edf3] group-hover:text-[#00ec97]">
                <span>{p.label}</span>
                <ArrowUpRight className="w-3.5 h-3.5 opacity-60 group-hover:opacity-100" />
              </div>
              <p className="text-[11px] text-[#8b949e] mt-1 line-clamp-2">
                {p.description}
              </p>
            </button>
          ))}
        </div>
      </div>

      {/* Prompt Form */}
      <form onSubmit={handleSubmit} className="mt-4">
        <label className="text-xs text-[#8b949e] font-medium block mb-1.5">
          Enter Cross-Chain Instruction or Custom Intent:
        </label>
        <div className="relative">
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            rows={2}
            placeholder="e.g., Transfer 0.001 ETH to 0x742d35Cc6634C0532925a3b844Bc454e4438f44e on Sepolia"
            className="w-full bg-[#0d1117] border border-[#30363d] rounded-lg p-3 text-sm text-[#e6edf3] placeholder-[#484f58] focus:outline-none focus:border-[#00ec97] font-mono resize-none"
          />
        </div>

        {/* Live Parsed Parameters Preview */}
        {parsed && (
          <div className="mt-3 bg-[#0d1117] border border-[#21262d] rounded-lg p-3 text-xs font-mono space-y-1.5">
            <div className="flex items-center justify-between text-[#8b949e]">
              <span className="flex items-center space-x-1.5 text-[#00ec97]">
                <Zap className="w-3.5 h-3.5" />
                <span>Parsed Execution Plan</span>
              </span>
              <span>Confidence: {(parsed.confidence * 100).toFixed(0)}%</span>
            </div>
            
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-2 border-t border-[#21262d] text-[#c9d1d9]">
              <div>
                <span className="text-[#8b949e] block text-[10px]">Action</span>
                <span className="capitalize text-white font-medium">{parsed.action}</span>
              </div>
              <div>
                <span className="text-[#8b949e] block text-[10px]">Target Network</span>
                <span className="text-white font-medium">Ethereum Sepolia</span>
              </div>
              <div>
                <span className="text-[#8b949e] block text-[10px]">Amount</span>
                <span className="text-white font-medium">{parsed.request.amount} ETH</span>
              </div>
              <div>
                <span className="text-[#8b949e] block text-[10px]">Recipient</span>
                <span className="truncate block text-white font-medium" title={parsed.request.toAddress}>
                  {parsed.request.toAddress.slice(0, 6)}...{parsed.request.toAddress.slice(-4)}
                </span>
              </div>
            </div>

            <p className="text-[11px] text-[#8b949e] pt-1 border-t border-[#21262d]">
              {parsed.reasoning}
            </p>
          </div>
        )}

        {/* Submit Execution Button */}
        <div className="mt-4 flex items-center justify-end">
          <button
            type="submit"
            disabled={!parsed || isExecuting}
            className={`px-5 py-2.5 rounded-lg text-sm font-semibold flex items-center space-x-2 transition-all ${
              !parsed || isExecuting
                ? 'bg-[#21262d] text-[#484f58] cursor-not-allowed'
                : 'bg-[#00ec97] hover:bg-[#00d688] text-black shadow-md hover:shadow-lg'
            }`}
          >
            <Send className="w-4 h-4" />
            <span>{isExecuting ? 'Signing via NEAR MPC...' : 'Execute Intent via Chain Signatures'}</span>
          </button>
        </div>
      </form>

    </div>
  );
};

