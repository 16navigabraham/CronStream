import { useEffect, useState } from 'react';
import { usePublicClient, useAccount } from 'wagmi';
import { parseAbiItem } from 'viem';
import { CONTRACT_ADDRESS } from '../lib/wagmi';

const STREAM_CREATED = parseAbiItem(
  'event StreamCreated(bytes32 indexed streamId, address indexed sender, address indexed recipient, uint256 ratePerSecond)'
);

/**
 * Fetches StreamCreated events for the connected wallet.
 * Returns streams sent BY this address (company view) and TO this address (contractor view).
 */
export function useStreams() {
  const { address } = useAccount();
  const client = usePublicClient();

  const [sent,     setSent]     = useState([]);
  const [received, setReceived] = useState([]);
  const [loading,  setLoading]  = useState(false);

  useEffect(() => {
    if (!address || !client) return;

    let cancelled = false;

    async function fetch() {
      setLoading(true);
      try {
        const [sentLogs, receivedLogs] = await Promise.all([
          client.getLogs({
            address: CONTRACT_ADDRESS,
            event:   STREAM_CREATED,
            args:    { sender: address },
            fromBlock: 0n,
            toBlock:  'latest',
          }),
          client.getLogs({
            address: CONTRACT_ADDRESS,
            event:   STREAM_CREATED,
            args:    { recipient: address },
            fromBlock: 0n,
            toBlock:  'latest',
          }),
        ]);

        if (cancelled) return;

        setSent(sentLogs.map(l => ({
          streamId:     l.args.streamId,
          sender:       l.args.sender,
          recipient:    l.args.recipient,
          ratePerSecond: l.args.ratePerSecond,
          blockNumber:  l.blockNumber,
        })));

        setReceived(receivedLogs.map(l => ({
          streamId:     l.args.streamId,
          sender:       l.args.sender,
          recipient:    l.args.recipient,
          ratePerSecond: l.args.ratePerSecond,
          blockNumber:  l.blockNumber,
        })));
      } catch (err) {
        console.error('useStreams fetch error:', err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    fetch();
    return () => { cancelled = true; };
  }, [address, client]);

  return { sent, received, loading };
}
