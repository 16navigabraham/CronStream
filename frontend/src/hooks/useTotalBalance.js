import { useReadContracts, useChainId } from 'wagmi';
import { formatUnits } from 'viem';
import { getContractAddress, ROUTER_ABI } from '../lib/wagmi';

/**
 * Sums balanceOf(streamId) across all provided stream IDs.
 * Returns { total (formatted string), raw (BigInt), isLoading }
 */
export function useTotalBalance(streamIds = [], decimals = 6) {
  const chainId = useChainId();
  const calls = streamIds.map(id => ({
    address:      getContractAddress(chainId),
    abi:          ROUTER_ABI,
    functionName: 'balanceOf',
    args:         [id],
  }));

  const { data, isLoading } = useReadContracts({
    contracts: calls,
    query: {
      enabled: calls.length > 0,
      refetchInterval: 10_000,
    },
  });

  const raw = data
    ? data.reduce((sum, r) => sum + (r.result ?? 0n), 0n)
    : 0n;

  return {
    raw,
    total:     raw > 0n ? parseFloat(formatUnits(raw, decimals)).toFixed(4) : '0.0000',
    isLoading,
  };
}
