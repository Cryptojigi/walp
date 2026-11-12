export const DEFAULT_NEAR_RPC_URLS = [
  'https://test.rpc.fastnear.com',
  'https://rpc.testnet.near.org',
];

export const DEFAULT_SEPOLIA_RPC_URLS = [
  'https://ethereum-sepolia-rpc.publicnode.com',
  'https://1rpc.io/sepolia',
  'https://sepolia.drpc.org',
];

export const MPC_CONTRACT_ID = 'v1.signer-prod.testnet';
export const MPC_ROOT_PUBLIC_KEY =
  'secp256k1:4NfTiv3UsGahebgTaHyD9vF8KYKMBnfd6kh94mK6xv8fGBiJB8TBtFMP5WWXz6B89Ac1fbpzPwAvoyQebemHFwx3';

export const SEPOLIA_CHAIN_ID = 11155111;
export const SEPOLIA_EXPLORER_URL = 'https://sepolia.etherscan.io';
export const NEAR_EXPLORER_URL = 'https://testnet.nearblocks.io';

export const NEAR_AI_BASE_URL = 'https://cloud-api.near.ai/v1';
export const NEAR_AI_DEFAULT_MODEL = 'Qwen/Qwen3.6-35B-A3B-FP8';
export const NEAR_AI_TEE_MODELS = [
  'Qwen/Qwen3.6-35B-A3B-FP8',
  'z-ai/glm-5.3-flash',
  'Qwen/Qwen3.8-27B',
  'deepseek-ai/DeepSeek-V4.1-Flash-1017',
];

export const ONECLICK_API_URL = 'https://1click.chaindefuser.com';

export interface ServerConfig {
  port: number;
  nearRpcUrls: string[];
  sepoliaRpcUrls: string[];
  mpcContractId: string;
  vaultContractId: string;
  registryContractId: string;
  ownerAccountId: string;
  ownerPrivateKey: string;
  agentAccountId: string;
  agentPrivateKey: string;
  nearAiApiKey: string;
  nearAiBaseUrl: string;
}

export function getServerConfig(): ServerConfig {
  const customNearRpc = process.env.NEAR_RPC_URL?.trim();
  const customSepoliaRpc = process.env.SEPOLIA_RPC_URL?.trim();

  return {
    port: Number(process.env.PORT || 3001),
    nearRpcUrls: customNearRpc
      ? [customNearRpc, ...DEFAULT_NEAR_RPC_URLS.filter((u) => u !== customNearRpc)]
      : DEFAULT_NEAR_RPC_URLS,
    sepoliaRpcUrls: customSepoliaRpc
      ? [customSepoliaRpc, ...DEFAULT_SEPOLIA_RPC_URLS.filter((u) => u !== customSepoliaRpc)]
      : DEFAULT_SEPOLIA_RPC_URLS,
    mpcContractId: process.env.MPC_CONTRACT_ID?.trim() || MPC_CONTRACT_ID,
    vaultContractId: process.env.WALP_VAULT_CONTRACT_ID?.trim() || '',
    registryContractId: process.env.WALP_REGISTRY_CONTRACT_ID?.trim() || '',
    ownerAccountId: process.env.NEAR_OWNER_ACCOUNT_ID?.trim() || '',
    ownerPrivateKey: process.env.NEAR_OWNER_PRIVATE_KEY?.trim() || '',
    agentAccountId: process.env.NEAR_AGENT_ACCOUNT_ID?.trim() || '',
    agentPrivateKey: process.env.NEAR_AGENT_PRIVATE_KEY?.trim() || '',
    nearAiApiKey: process.env.NEAR_AI_API_KEY?.trim() || '',
    nearAiBaseUrl: process.env.NEAR_AI_BASE_URL?.trim() || NEAR_AI_BASE_URL,
  };
}
