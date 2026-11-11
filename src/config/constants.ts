export const NEAR_CONFIG = {
  networkId: 'testnet',
  nodeUrl: 'https://rpc.testnet.near.org',
  walletUrl: 'https://testnet.mynearwallet.com',
  helperUrl: 'https://helper.testnet.near.org',
  explorerUrl: 'https://testnet.nearblocks.io',
  mpcContractId: 'v1.signer-prod.testnet',
  // Official MPC root public key for v1.signer-prod.testnet (ECDSA secp256k1)
  // Can be verified via `near view v1.signer-prod.testnet public_key`
  mpcRootPublicKey: 'secp256k1:4HFcTSKXTeYPmsxnGsqJgGcr88vjh17r6gYtHnEgo75q37yD4zH4oJqA5h56626qP2UAgu76656q4h5',
};

export const EVM_CONFIG = {
  sepolia: {
    chainId: 11155111,
    chainName: 'Ethereum Sepolia',
    nativeCurrency: { name: 'Sepolia Ether', symbol: 'ETH', decimals: 18 },
    rpcUrls: [
      'https://ethereum-sepolia-rpc.publicnode.com',
      'https://rpc.sepolia.org',
      'https://1rpc.io/sepolia',
    ],
    blockExplorerUrl: 'https://sepolia.etherscan.io',
  }
};

export const DEFAULT_DERIVATION_PATH = 'ethereum-1';

