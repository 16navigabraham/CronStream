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

export const CONTRACT_ADDRESS = '0x3feb14d164EaA05a85e0276321E4F090a03549f9';

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
