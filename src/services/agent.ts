import { IntentExecutionRequest } from '../types';

export interface ParsedIntent {
  action: 'transfer' | 'rebalance' | 'contract_call' | 'unknown';
  request: IntentExecutionRequest;
  confidence: number;
  reasoning: string;
}

export class AgentService {
  /**
   * Parse user natural language prompt into executable blockchain intent
   */
  static parseIntent(prompt: string, fallbackDerivedEthAddress?: string): ParsedIntent {
    const text = prompt.trim();
    
    // Pattern 1: Address extraction (0x followed by 40 hex chars)
    const ethAddressMatch = text.match(/0x[a-fA-F0-9]{40}/);
    const toAddress = ethAddressMatch 
      ? ethAddressMatch[0] 
      : (fallbackDerivedEthAddress || '0x0000000000000000000000000000000000000000');

    // Pattern 2: Amount extraction (e.g. 0.001 ETH, 0.05, 1 eth)
    const amountMatch = text.match(/(\d+(?:\.\d+)?)\s*(?:eth|sepolia\s*eth|ether)?/i);
    let amount = '0.001'; // Safe default for testnet demo
    if (amountMatch && amountMatch[1]) {
      const parsedNum = parseFloat(amountMatch[1]);
      if (parsedNum > 0 && parsedNum < 100) {
        amount = amountMatch[1];
      }
    }

    // Identify intent category
    const lower = text.toLowerCase();
    let action: ParsedIntent['action'] = 'transfer';
    let reasoning = `Extracted transfer of ${amount} Sepolia ETH to ${toAddress}.`;

    if (lower.includes('rebalance') || lower.includes('sweep') || lower.includes('portfolio')) {
      action = 'rebalance';
      reasoning = `Automated portfolio action detected: Allocating ${amount} Sepolia ETH to target account ${toAddress}.`;
    } else if (lower.includes('call') || lower.includes('execute') || lower.includes('contract')) {
      action = 'contract_call';
      reasoning = `Direct contract call detected targeting ${toAddress}.`;
    }

    return {
      action,
      confidence: 0.95,
      reasoning,
      request: {
        targetChain: 'ethereum-sepolia',
        toAddress,
        amount,
        intentPrompt: prompt
      }
    };
  }

  /**
   * Quick demo intent presets for rapid hackathon testing
   */
  static getDemoPresets(derivedEthAddress: string) {
    return [
      {
        id: 'self-ping',
        label: 'Sepolia Self-Ping (0.0001 ETH)',
        description: 'Broadcast a signed transaction from your derived address back to itself to prove onchain MPC control.',
        prompt: `Transfer 0.0001 ETH to ${derivedEthAddress} on Sepolia`,
        amount: '0.0001',
        toAddress: derivedEthAddress
      },
      {
        id: 'vitalik-tribute',
        label: 'Tribute to 0xd8dA...6045 (0.0002 ETH)',
        description: 'Send a cross-chain micropayment to vitalik.eth on Sepolia.',
        prompt: 'Transfer 0.0002 Sepolia ETH to 0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045',
        amount: '0.0002',
        toAddress: '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045'
      },
      {
        id: 'burn-proof',
        label: 'Verifiable Zero-Burn (0.00005 ETH)',
        description: 'Send a verifiable micro-transaction to the zero address (0x000...dEaD).',
        prompt: 'Transfer 0.00005 ETH to 0x000000000000000000000000000000000000dEaD on Sepolia',
        amount: '0.00005',
        toAddress: '0x000000000000000000000000000000000000dEaD'
      }
    ];
  }
}

