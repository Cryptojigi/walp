import { ethers } from 'ethers';
import { EVM_CONFIG } from '../config/constants';

export interface UnsignedEVMTransaction {
  tx: ethers.Transaction;
  unsignedSerialized: string;
  hashToSign: string; // 32-byte keccak256 hash (0x-prefixed)
  hashBytes: number[]; // Array of 32 bytes for NEAR contract payload
}

export class EvmService {
  private static getProvider(): ethers.JsonRpcProvider {
    const urls = EVM_CONFIG.sepolia.rpcUrls;
    // Connect to primary RPC
    return new ethers.JsonRpcProvider(urls[0], {
      chainId: EVM_CONFIG.sepolia.chainId,
      name: 'sepolia'
    });
  }

  /**
   * Fetch native Sepolia ETH balance
   */
  static async getBalance(address: string): Promise<string> {
    try {
      if (!address || !ethers.isAddress(address)) {
        return '0.0000';
      }
      const provider = this.getProvider();
      const balanceWei = await provider.getBalance(address);
      const balanceEth = ethers.formatEther(balanceWei);
      // Format to 4 decimal places
      return parseFloat(balanceEth).toFixed(4);
    } catch (err) {
      console.warn('Failed to fetch Sepolia balance:', err);
      return '0.0000';
    }
  }

  /**
   * Fetch current pending nonce for the address
   */
  static async getNonce(address: string): Promise<number> {
    const provider = this.getProvider();
    return await provider.getTransactionCount(address, 'pending');
  }

  /**
   * Build unsigned EIP-1559 EVM transaction for Sepolia
   */
  static async buildUnsignedTransaction(
    fromAddress: string,
    toAddress: string,
    amountEth: string,
    data: string = '0x'
  ): Promise<UnsignedEVMTransaction> {
    const provider = this.getProvider();
    const nonce = await this.getNonce(fromAddress);
    const feeData = await provider.getFeeData();

    // Sane fee defaults for Sepolia testnet
    const maxFeePerGas = feeData.maxFeePerGas ?? ethers.parseUnits('25', 'gwei');
    const maxPriorityFeePerGas = feeData.maxPriorityFeePerGas ?? ethers.parseUnits('2', 'gwei');
    
    // 21000 for standard ETH transfer, or estimated gas for contract calls
    let gasLimit = 21000n;
    if (data && data !== '0x') {
      try {
        gasLimit = await provider.estimateGas({
          from: fromAddress,
          to: toAddress,
          value: ethers.parseEther(amountEth),
          data
        });
        // Add 20% buffer
        gasLimit = (gasLimit * 120n) / 100n;
      } catch (e) {
        gasLimit = 65000n;
      }
    }

    const tx = new ethers.Transaction();
    tx.to = toAddress;
    tx.value = ethers.parseEther(amountEth);
    tx.nonce = nonce;
    tx.gasLimit = gasLimit;
    tx.maxFeePerGas = maxFeePerGas;
    tx.maxPriorityFeePerGas = maxPriorityFeePerGas;
    tx.chainId = BigInt(EVM_CONFIG.sepolia.chainId);
    tx.type = 2; // EIP-1559
    tx.data = data;

    // Get the unsigned transaction hash (32 bytes)
    const unsignedSerialized = tx.unsignedSerialized;
    const hashToSign = ethers.keccak256(unsignedSerialized);
    const hashBytes = Array.from(ethers.getBytes(hashToSign));

    return {
      tx,
      unsignedSerialized,
      hashToSign,
      hashBytes
    };
  }

  /**
   * Attach ECDSA signature (r, s, v) from NEAR MPC to the transaction and broadcast to Sepolia
   */
  static async broadcastSignedTransaction(
    unsignedTx: ethers.Transaction,
    signature: { r: string; s: string; v: number }
  ): Promise<{ txHash: string; explorerUrl: string }> {
    const provider = this.getProvider();

    // Format r and s as 32-byte 0x-prefixed hex strings
    const rFormatted = signature.r.startsWith('0x') ? signature.r : `0x${signature.r}`;
    const sFormatted = signature.s.startsWith('0x') ? signature.s : `0x${signature.s}`;

    // Attach signature
    unsignedTx.signature = ethers.Signature.from({
      r: rFormatted,
      s: sFormatted,
      v: signature.v
    });

    const rawSerialized = unsignedTx.serialized;
    console.log('Broadcasting raw transaction to Sepolia:', rawSerialized);

    const txResponse = await provider.broadcastTransaction(rawSerialized);
    const explorerUrl = `${EVM_CONFIG.sepolia.blockExplorerUrl}/tx/${txResponse.hash}`;

    return {
      txHash: txResponse.hash,
      explorerUrl
    };
  }
}

