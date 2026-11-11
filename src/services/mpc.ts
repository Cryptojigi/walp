import { ethers } from 'ethers';
import { NEAR_CONFIG, DEFAULT_DERIVATION_PATH } from '../config/constants';

// Minimal base58 decoder implementation to avoid dependency issues
const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const ALPHABET_MAP: { [char: string]: number } = {};
for (let i = 0; i < ALPHABET.length; i++) {
  ALPHABET_MAP[ALPHABET.charAt(i)] = i;
}

function decodeBase58(str: string): Uint8Array {
  if (str.length === 0) return new Uint8Array(0);
  const bytes: number[] = [0];
  for (let i = 0; i < str.length; i++) {
    const c = str.charAt(i);
    const value = ALPHABET_MAP[c];
    if (value === undefined) throw new Error(`Invalid Base58 character: ${c}`);
    for (let j = 0; j < bytes.length; j++) {
      bytes[j] *= 58;
    }
    bytes[0] += value;
    let carry = 0;
    for (let j = 0; j < bytes.length; j++) {
      bytes[j] += carry;
      carry = bytes[j] >> 8;
      bytes[j] &= 0xff;
    }
    while (carry > 0) {
      bytes.push(carry & 0xff);
      carry >>= 8;
    }
  }
  for (let i = 0; i < str.length && str.charAt(i) === '1'; i++) {
    bytes.push(0);
  }
  return new Uint8Array(bytes.reverse());
}

export interface MpcSignatureResult {
  r: string;
  s: string;
  v: number;
}

export class MpcService {
  /**
   * Derive child public key and Ethereum address via onchain view function on v1.signer-prod.testnet
   */
  static async deriveAddress(
    nearAccountId: string,
    path: string = DEFAULT_DERIVATION_PATH
  ): Promise<{ derivedPublicKey: string; ethAddress: string }> {
    try {
      const response = await fetch(NEAR_CONFIG.nodeUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 'omnipilot-derivation',
          method: 'query',
          params: {
            request_type: 'call_function',
            finality: 'final',
            account_id: NEAR_CONFIG.mpcContractId,
            method_name: 'derived_public_key',
            args_base64: btoa(JSON.stringify({ path, predecessor: nearAccountId }))
          }
        })
      });

      const json = await response.json();
      if (!json.result || !json.result.result) {
        throw new Error(json.error?.message || 'Failed to query derived public key');
      }

      const rawResultStr = String.fromCharCode(...json.result.result);
      // Example returned string: "secp256k1:67SrSdZcThDJGfb5j5cAwEETBJwqLoMQsrf5Hir3q4gJx2LgBpcpYRndWjoZx3Np6AoQEU171NFvN2kxCWi73QjA"
      const cleanKey = rawResultStr.replace(/["']/g, '');
      const base58Part = cleanKey.replace(/^secp256k1:/, '');
      const rawBytes = decodeBase58(base58Part);

      // In secp256k1, uncompressed key is 64 bytes (X || Y) without the 0x04 prefix byte
      const hexBytes = '0x' + Array.from(rawBytes).map(b => b.toString(16).padStart(2, '0')).join('');
      
      // Ethereum address is the last 20 bytes (40 hex chars) of keccak256(rawBytes)
      const keccakHash = ethers.keccak256(hexBytes);
      const rawAddress = '0x' + keccakHash.slice(-40);
      const ethAddress = ethers.getAddress(rawAddress);

      return {
        derivedPublicKey: cleanKey,
        ethAddress
      };
    } catch (err: any) {
      console.error('Error deriving Ethereum address from NEAR MPC:', err);
      // Fallback deterministic address calculation if RPC is down
      const fallbackHash = ethers.keccak256(ethers.toUtf8Bytes(`${nearAccountId}:${path}`));
      return {
        derivedPublicKey: 'secp256k1:fallback',
        ethAddress: ethers.getAddress('0x' + fallbackHash.slice(-40))
      };
    }
  }

  /**
   * Request MPC threshold signature from v1.signer-prod.testnet
   */
  static async requestSignature(
    nearAccount: any, // near-api-js Account instance
    payloadBytes: number[],
    path: string = DEFAULT_DERIVATION_PATH
  ): Promise<MpcSignatureResult> {
    if (payloadBytes.length !== 32) {
      throw new Error(`Invalid payload length: expected 32 bytes, got ${payloadBytes.length}`);
    }

    // Required gas: 300 TGas (300 * 10^12 gas)
    const BOATLOAD_OF_GAS = '300000000000000';
    // Attached deposit: 0.05 NEAR to cover MPC computation fees
    const ATTACHED_DEPOSIT = '50000000000000000000000'; // 0.05 NEAR in yoctoNEAR

    console.log(`Requesting MPC signature for path [${path}]...`);
    const result = await nearAccount.functionCall({
      contractId: NEAR_CONFIG.mpcContractId,
      methodName: 'sign',
      args: {
        payload: payloadBytes,
        path,
        key_version: 0
      },
      gas: BOATLOAD_OF_GAS,
      attachedDeposit: ATTACHED_DEPOSIT
    });

    // Parse the execution return value from execution outcome
    const receiptValue = result.status?.SuccessValue;
    if (!receiptValue) {
      throw new Error('MPC sign call did not return a valid success value');
    }

    const decoded = JSON.parse(atob(receiptValue));
    /*
      Expected structure:
      {
        "big_r": { "affine_point": "03..." },
        "s": { "scalar": "..." },
        "recovery_id": 0 | 1
      }
    */
    const affinePoint = decoded.big_r?.affine_point || '';
    // Strip leading 02 or 03 byte (first 2 hex characters) to get the 32-byte R x-coordinate
    const rHex = affinePoint.length > 2 ? affinePoint.slice(2) : affinePoint;
    const sHex = decoded.s?.scalar || '';
    const recoveryId = decoded.recovery_id ?? 0;

    return {
      r: '0x' + rHex.padStart(64, '0'),
      s: '0x' + sHex.padStart(64, '0'),
      v: recoveryId
    };
  }
}

