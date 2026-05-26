import { getDefaultConfig } from '@rainbow-me/rainbowkit';
import { arbitrumSepolia } from 'wagmi/chains';
import { defineChain } from 'viem';

export const robinhoodTestnet = defineChain({
  id:   46630,
  name: 'Robinhood Chain Testnet',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: {
    default: { http: ['https://rpc.testnet.chain.robinhood.com'] },
  },
  blockExplorers: {
    default: { name: 'Explorer', url: 'https://explorer.testnet.chain.robinhood.com' },
  },
  testnet: true,
});

// Contract addresses per chain — updated after redeployment with Pausable + balance delta
export const CONTRACT_ADDRESSES = {
  421614: '0x12B1c71A60CBC3Fdd44D3D974546D2751feC04eD', // Arbitrum Sepolia
  46630:  '0xfB9A00926eC7716626DA9b960F0fb75ff58dCBFA', // Robinhood Chain
};

/** Resolve the correct contract address for a given chainId (falls back to Arbitrum Sepolia). */
export function getContractAddress(chainId) {
  return CONTRACT_ADDRESSES[chainId] ?? CONTRACT_ADDRESSES[421614];
}

// Legacy export — keeps any existing imports working, defaults to Arbitrum Sepolia
export const CONTRACT_ADDRESS = CONTRACT_ADDRESSES[421614];

export const ROUTER_ABI = [
  'function createStream(address recipient, address token, uint256 ratePerSecond, uint256 initialDurationSeconds) external returns (bytes32)',
  'function withdrawFromStream(bytes32 streamId, uint256 amount) external',
  'function cancelStream(bytes32 streamId) external',
  'function reclaimUnearned(bytes32 streamId) external',
  'function balanceOf(bytes32 streamId) external view returns (uint256)',
  'function streams(bytes32) external view returns (address sender, address recipient, address token, uint256 ratePerSecond, uint256 startTime, uint256 streamValidUntil, uint256 totalDeposited, uint256 totalWithdrawn, uint256 nonce)',
  'function streamNonces(address) external view returns (uint256)',
  'event StreamCreated(bytes32 indexed streamId, address indexed sender, address indexed recipient, uint256 ratePerSecond)',
  'event WithdrawalExecuted(bytes32 indexed streamId, address indexed recipient, uint256 amount, uint256 protocolFee)',
];

export const wagmiConfig = getDefaultConfig({
  appName:     'CronStream',
  projectId:   import.meta.env.VITE_WALLETCONNECT_PROJECT_ID ?? 'cronstream',
  chains:      [arbitrumSepolia, robinhoodTestnet],
});
