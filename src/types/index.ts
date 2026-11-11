export interface DerivedAccount {
  nearAccountId: string;
  path: string;
  ethAddress: string;
  btcAddress?: string;
  nearBalance: string;
  ethBalance: string;
}

export type TxStepStatus = 'idle' | 'pending' | 'success' | 'error';

export interface ExecutionStep {
  id: string;
  title: string;
  description: string;
  status: TxStepStatus;
  detail?: string;
  txHash?: string;
  explorerUrl?: string;
}

export interface IntentExecutionRequest {
  targetChain: 'ethereum-sepolia' | 'bitcoin-testnet';
  toAddress: string;
  amount: string; // in native units, e.g. ETH
  data?: string;
  intentPrompt?: string;
}

export interface StoredTxRecord {
  id: string;
  timestamp: number;
  nearAccountId: string;
  targetChain: string;
  toAddress: string;
  amount: string;
  nearTxHash?: string;
  foreignTxHash: string;
  status: 'confirmed' | 'failed';
  intentPrompt?: string;
}

