import { useEffect, useState } from 'react';
import { usePublicClient, useAccount, useChainId } from 'wagmi';
import { parseAbiItem } from 'viem';
import { getContractAddress } from '../lib/wagmi';

const AGENT_URL    = import.meta.env.VITE_AGENT_URL ?? 'http://localhost:3000';
const STREAM_CREATED = parseAbiItem(
  'event StreamCreated(bytes32 indexed streamId, address indexed sender, address indexed recipient, uint256 ratePerSecond)'
);

function mapLog(l) {
  return {
    streamId:      l.args.streamId,
    sender:        l.args.sender,
    recipient:     l.args.recipient,
    ratePerSecond: l.args.ratePerSecond ?? 0n,
    blockNumber:   l.blockNumber,
  };
}

function mapDbRow(r) {
  return {
    streamId:      r.stream_id,
    sender:        r.sender   ?? null,
    recipient:     r.recipient ?? null,
    ratePerSecond: r.rate_per_second ? BigInt(r.rate_per_second) : 0n,
    blockNumber:   null,
  };
}

/**
 * Fetches StreamCreated events for the connected wallet.
 *
 * Priority:
 *  1. Agent DB  — /api/v1/streams?address=0x...  (fast, no RPC limits)
 *  2. viem getLogs fallback (last ~7 days, for when agent is offline)
 */
export function useStreams() {
  const { address } = useAccount();
  const client  = usePublicClient();
  const chainId = useChainId();

  const [sent,     setSent]     = useState([]);
  const [received, setReceived] = useState([]);
  const [loading,  setLoading]  = useState(false);

  useEffect(() => {
    if (!address || !client) return;

    let cancelled = false;

    async function load() {
      setLoading(true);

      // ── 1. Try agent DB ──────────────────────────────────────────────────
      try {
        const res = await fetch(
          `${AGENT_URL}/api/v1/streams?address=${address}`,
          { signal: AbortSignal.timeout(5000) }
        );
        if (res.ok) {
          const { streams } = await res.json();
          if (!cancelled) {
            setSent    (streams.filter(s => s.sender?.toLowerCase()    === address.toLowerCase()).map(mapDbRow));
            setReceived(streams.filter(s => s.recipient?.toLowerCase() === address.toLowerCase()).map(mapDbRow));
            setLoading(false);
            return;
          }
        }
      } catch {
        // Agent offline — fall through to viem
      }

      // ── 2. viem fallback ─────────────────────────────────────────────────
      try {
        const contractAddress = getContractAddress(chainId);
        const currentBlock    = await client.getBlockNumber();
        // ~7 days on Arb Sepolia (4 blocks/s) or Robinhood Chain (2 blocks/s)
        const lookback  = 2_500_000n;
        const fromBlock = currentBlock > lookback ? currentBlock - lookback : 0n;

        const [sentLogs, receivedLogs] = await Promise.all([
          client.getLogs({ address: contractAddress, event: STREAM_CREATED, args: { sender: address },    fromBlock, toBlock: 'latest' }),
          client.getLogs({ address: contractAddress, event: STREAM_CREATED, args: { recipient: address }, fromBlock, toBlock: 'latest' }),
        ]);

        if (!cancelled) {
          setSent    (sentLogs.map(mapLog));
          setReceived(receivedLogs.map(mapLog));
        }
      } catch (err) {
        console.error('useStreams viem fallback error:', err.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => { cancelled = true; };
  }, [address, client, chainId]);

  return { sent, received, loading };
}
