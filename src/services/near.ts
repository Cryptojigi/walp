import * as nearAPI from 'near-api-js';
import { NEAR_CONFIG } from '../config/constants';

const { connect, keyStores, KeyPair } = nearAPI;

export class NearService {
  private static keyStore = new keyStores.BrowserLocalStorageKeyStore();
  private static nearConnection: nearAPI.Near | null = null;

  static async getConnection(): Promise<nearAPI.Near> {
    if (!this.nearConnection) {
      this.nearConnection = await connect({
        networkId: NEAR_CONFIG.networkId,
        nodeUrl: NEAR_CONFIG.nodeUrl,
        walletUrl: NEAR_CONFIG.walletUrl,
        helperUrl: NEAR_CONFIG.helperUrl,
        keyStore: this.keyStore,
        headers: {}
      });
    }
    return this.nearConnection;
  }

  /**
   * Get balance for a NEAR account formatted in NEAR tokens
   */
  static async getNearBalance(accountId: string): Promise<string> {
    try {
      const near = await this.getConnection();
      const account = await near.account(accountId);
      const balance = await account.getAccountBalance();
      // Format yoctoNEAR to NEAR
      const nearTokens = nearAPI.utils.format.formatNearAmount(balance.available, 3);
      return nearTokens;
    } catch (err) {
      console.warn(`Could not fetch balance for ${accountId}:`, err);
      return '0.000';
    }
  }

  /**
   * Check if account exists on testnet
   */
  static async accountExists(accountId: string): Promise<boolean> {
    try {
      const near = await this.getConnection();
      const account = await near.account(accountId);
      await account.state();
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Save a keypair for an account in Browser KeyStore
   */
  static async setAccountKey(accountId: string, privateKey: string): Promise<void> {
    const keyPair = KeyPair.fromString(privateKey as any);
    await this.keyStore.setKey(NEAR_CONFIG.networkId, accountId, keyPair);
  }

  /**
   * Get an authenticated Account object
   */
  static async getAccount(accountId: string): Promise<nearAPI.Account> {
    const near = await this.getConnection();
    return await near.account(accountId);
  }

  /**
   * Generate an instant Testnet Keypair for live testing
   */
  static generateRandomKeypair(): { publicKey: string; secretKey: string } {
    const keyPair = KeyPair.fromRandom('ed25519');
    return {
      publicKey: keyPair.getPublicKey().toString(),
      secretKey: keyPair.toString()
    };
  }

  /**
   * Fast faucet request for a testnet account
   */
  static async createTestnetAccount(newAccountId: string, publicKey: string): Promise<boolean> {
    try {
      const res = await fetch(`${NEAR_CONFIG.helperUrl}/account`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          newAccountId,
          newAccountPublicKey: publicKey
        })
      });
      return res.ok;
    } catch (e) {
      console.warn('Faucet creation error:', e);
      return false;
    }
  }
}
