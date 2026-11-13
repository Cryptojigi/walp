/**
 * Walp Agent Connector SDK
 *
 * Real, onchain connector that integrates an autonomous AI agent
 * (ElizaOS, LangChain, OpenAI Tool Calling, or custom bot)
 * with the Walp Onchain RLP Firewall on NEAR.
 *
 * The agent holds ZERO Ethereum private keys. All transfers are
 * submitted to `walp-vault` using the agent's scoped FunctionCall key.
 */

import { ethers } from 'ethers';
import {
  assembleAndBroadcastSignedTx,
  buildUnsignedEip1559Tx,
  callNearView,
  deriveVaultEvmAddress,
  getNearAccountBalance,
  getSepoliaEthBalance,
  sendNearFunctionCall,
  VaultPolicy,
} from '../server/services/vaultClient.ts';
import { getServerConfig } from '../server/config.ts';
import { loadDotEnv } from '../server/utils/env.ts';

loadDotEnv();

export interface WalpAgentConfig {
  vaultContractId?: string;
  agentAccountId?: string;
  agentPrivateKey?: string;
  derivationPath?: string;
}

export interface AgentTransferParams {
  to: string;
  amountEth: string;
  calldataHex?: string;
  summary?: string;
  broadcast?: boolean;
}

export interface AgentTransferResult {
  success: boolean;
  intentId?: string;
  status?: string;
  nearTxHash?: string;
  nearExplorerUrl?: string;
  sepoliaTxHash?: string;
  sepoliaExplorerUrl?: string;
  failureReason?: string;
}

export class WalpAgentWallet {
  private vaultContractId: string;
  private agentAccountId: string;
  private agentPrivateKey: string;
  private derivationPath: string;

  constructor(config?: WalpAgentConfig) {
    const defaultCfg = getServerConfig();
    this.vaultContractId = config?.vaultContractId || defaultCfg.vaultContractId;
    this.agentAccountId = config?.agentAccountId || defaultCfg.agentAccountId || '';
    this.agentPrivateKey = config?.agentPrivateKey || defaultCfg.agentPrivateKey || '';
    this.derivationPath = config?.derivationPath || 'ethereum-1';

    if (!this.vaultContractId) {
      throw new Error('WalpAgentWallet: WALP_VAULT_CONTRACT_ID is required.');
    }
  }

  /**
   * Returns the agent's identity, derived Sepolia address, and live onchain policy.
   */
  async getStatus() {
    const [policy, derived, nearBal] = await Promise.all([
      callNearView<VaultPolicy>(this.vaultContractId, 'get_policy', {}),
      deriveVaultEvmAddress(this.vaultContractId, this.derivationPath),
      getNearAccountBalance(this.vaultContractId),
    ]);

    const ethBalance = await getSepoliaEthBalance(derived.ethAddress);

    return {
      vaultContractId: this.vaultContractId,
      agentAccountId: this.agentAccountId,
      derivedSepoliaAddress: derived.ethAddress,
      sepoliaBalanceEth: ethBalance,
      nearBalance: nearBal.availableNear,
      policy: {
        paused: policy.paused,
        maxTxEth: ethers.formatEther(policy.max_tx_wei),
        dailyLimitEth: ethers.formatEther(policy.daily_limit_wei),
        spentTodayEth: ethers.formatEther(policy.spent_today_wei),
        approvalThresholdEth: ethers.formatEther(policy.approval_threshold_wei),
        allowedChainIds: policy.allowed_chain_ids,
      },
    };
  }

  /**
   * Executes a real transaction through the Walp onchain firewall.
   * If approved by the Rust contract, NEAR MPC co-signs and broadcasts to Sepolia.
   */
  async transfer(params: AgentTransferParams): Promise<AgentTransferResult> {
    if (!this.agentAccountId || !this.agentPrivateKey) {
      throw new Error('WalpAgentWallet: Agent NEAR credentials (NEAR_AGENT_ACCOUNT_ID, NEAR_AGENT_PRIVATE_KEY) must be configured.');
    }

    const { ethAddress } = await deriveVaultEvmAddress(this.vaultContractId, this.derivationPath);

    // 1. Build canonical EIP-1559 unsigned transaction
    const unsigned = await buildUnsignedEip1559Tx({
      fromAddress: ethAddress,
      toAddress: params.to,
      amountEth: params.amountEth,
      calldataHex: params.calldataHex || '0x',
      chainId: 11155111, // Sepolia
    });

    // 2. Submit raw RLP bytes to walp-vault using scoped FunctionCall key
    const outcome = await sendNearFunctionCall<{
      intent_id: string;
      status: string;
      sighash_hex?: string;
      signature?: { big_r: string; s: string; recovery_id: number } | null;
    }>({
      signerAccountId: this.agentAccountId,
      signerPrivateKey: this.agentPrivateKey,
      receiverId: this.vaultContractId,
      methodName: 'request_intent',
      args: {
        raw_tx_hex: unsigned.rawTxHex,
        path: this.derivationPath,
        intent_summary: params.summary || `Agent transfer of ${params.amountEth} ETH to ${params.to}`,
      },
      gas: '300000000000000',
      depositYocto: '0',
    });

    if (!outcome.success) {
      return {
        success: false,
        nearTxHash: outcome.txHash,
        nearExplorerUrl: outcome.explorerUrl,
        failureReason: outcome.failureReason || 'Onchain firewall rejected transaction',
      };
    }

    const intentId = outcome.result?.intent_id;
    const status = outcome.result?.status;

    // 3. If signed and broadcast requested, broadcast to Sepolia
    let sepoliaTxHash: string | undefined;
    let sepoliaExplorerUrl: string | undefined;

    if (params.broadcast !== false && status === 'SIGNED' && outcome.result?.signature) {
      const broadcastRes = await assembleAndBroadcastSignedTx({
        rawTxHex: unsigned.rawTxHex,
        signature: outcome.result.signature,
        expectedFromAddress: ethAddress,
      });
      sepoliaTxHash = broadcastRes.txHash;
      sepoliaExplorerUrl = broadcastRes.explorerUrl;
    }

    return {
      success: true,
      intentId,
      status,
      nearTxHash: outcome.txHash,
      nearExplorerUrl: outcome.explorerUrl,
      sepoliaTxHash,
      sepoliaExplorerUrl,
    };
  }

  /**
   * OpenAI / LangChain compatible tool definition.
   * Drop this directly into an OpenAI Assistant, ElizaOS plugin, or LangChain agent!
   */
  static getToolDefinition() {
    return {
      name: 'walp_execute_safe_payment',
      description:
        'Executes a cross-chain Ethereum transfer protected by Walp onchain firewall caps, denylists, and NEAR MPC signatures. Rejects if spending caps are exceeded.',
      parameters: {
        type: 'object',
        properties: {
          to: {
            type: 'string',
            description: 'Destination Ethereum 0x address',
          },
          amountEth: {
            type: 'string',
            description: 'Amount in ETH to transfer (e.g., "0.0001")',
          },
          summary: {
            type: 'string',
            description: 'Human-readable purpose of this payment',
          },
        },
        required: ['to', 'amountEth'],
      },
    };
  }
}

