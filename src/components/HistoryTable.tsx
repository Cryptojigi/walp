import React from 'react';
import { ExternalLink, Clock, CheckCircle2 } from 'lucide-react';
import { StoredTxRecord } from '../types';
import { EVM_CONFIG } from '../config/constants';

interface HistoryTableProps {
  records: StoredTxRecord[];
}

export const HistoryTable: React.FC<HistoryTableProps> = ({ records }) => {
  if (records.length === 0) {
    return (
      <div className="bg-[#161b22] border border-[#30363d] rounded-xl p-8 text-center">
        <Clock className="w-8 h-8 text-[#8b949e] mx-auto mb-2 opacity-50" />
        <h3 className="text-sm font-medium text-[#c9d1d9]">No Cross-Chain Executions Yet</h3>
        <p className="text-xs text-[#8b949e] mt-1 max-w-sm mx-auto">
          Broadcast an intent or demo transaction above to see verifiable onchain execution proofs and Etherscan records here.
        </p>
      </div>
    );
  }

  return (
    <div className="bg-[#161b22] border border-[#30363d] rounded-xl overflow-hidden shadow-sm">
      <div className="p-4 border-b border-[#21262d] flex items-center justify-between">
        <h3 className="text-sm font-semibold text-white">Execution Proofs & Activity</h3>
        <span className="text-xs font-mono text-[#8b949e]">{records.length} Transactions</span>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-left text-xs">
          <thead className="bg-[#0d1117] text-[#8b949e] border-b border-[#21262d] uppercase text-[10px] tracking-wider font-mono">
            <tr>
              <th className="py-2.5 px-4">Time</th>
              <th className="py-2.5 px-4">Target Network</th>
              <th className="py-2.5 px-4">Recipient</th>
              <th className="py-2.5 px-4">Amount</th>
              <th className="py-2.5 px-4">Status</th>
              <th className="py-2.5 px-4 text-right">Verification</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#21262d] font-mono">
            {records.map((r) => {
              const formattedTime = new Date(r.timestamp).toLocaleTimeString();
              const explorerUrl = `${EVM_CONFIG.sepolia.blockExplorerUrl}/tx/${r.foreignTxHash}`;

              return (
                <tr key={r.id} className="hover:bg-[#1f242c]/50 transition-colors">
                  <td className="py-3 px-4 text-[#8b949e] whitespace-nowrap">{formattedTime}</td>
                  <td className="py-3 px-4 text-white">Ethereum Sepolia</td>
                  <td className="py-3 px-4 text-[#c9d1d9] truncate max-w-[140px]" title={r.toAddress}>
                    {r.toAddress.slice(0, 6)}...{r.toAddress.slice(-4)}
                  </td>
                  <td className="py-3 px-4 text-white font-semibold">{r.amount} ETH</td>
                  <td className="py-3 px-4">
                    <span className="inline-flex items-center space-x-1 text-[#00ec97]">
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      <span className="capitalize">Confirmed</span>
                    </span>
                  </td>
                  <td className="py-3 px-4 text-right">
                    <a
                      href={explorerUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center space-x-1 text-[#00ec97] hover:underline"
                    >
                      <span>Etherscan</span>
                      <ExternalLink className="w-3 h-3" />
                    </a>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
};

