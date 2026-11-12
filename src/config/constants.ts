export const NEAR_CONFIG = {
  networkId: 'testnet',
  nodeUrl: 'https://test.rpc.fastnear.com',
  fallbackNodeUrls: ['https://test.rpc.fastnear.com', 'https://rpc.testnet.near.org'],
  explorerUrl: 'https://testnet.nearblocks.io',
  mpcContractId: 'v1.signer-prod.testnet',
  mpcRootPublicKey:
    'secp256k1:4NfTiv3UsGahebgTaHyD9vF8KYKMBnfd6kh94mK6xv8fGBiJB8TBtFMP5WWXz6B89Ac1fbpzPwAvoyQebemHFwx3',
};

export const EVM_CONFIG = {
  sepolia: {
    chainId: 11155111,
    chainName: 'Ethereum Sepolia',
    nativeCurrency: { name: 'Sepolia Ether', symbol: 'ETH', decimals: 18 },
    rpcUrls: [
      'https://ethereum-sepolia-rpc.publicnode.com',
      'https://1rpc.io/sepolia',
      'https://sepolia.drpc.org',
    ],
    blockExplorerUrl: 'https://sepolia.etherscan.io',
  },
};

export const DEFAULT_DERIVATION_PATH = 'ethereum-1';
