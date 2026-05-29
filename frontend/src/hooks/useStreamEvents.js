/**
 * useStreamEvents
 * ────────────────────────────────────────────────────────────────────────────
 * Watches on-chain events for the connected wallet and triggers an immediate
 * data refresh when anything relevant happens.
 *
 * Events watched:
 *   StreamCreated          - new stream appears (company or contractor side)
 *   WithdrawalExecuted     - contractor withdrew, balances changed
 *   UnspentFundsReclaimed  - company reclaimed, balances changed
 *   StreamExtended         - agent extended a stream, streamValidUntil changed
 *
 * Usage:
 *   const { received, loading, refresh } = useStreams();
 *   useStreamEvents(refresh);   ← drops into any page, self-contained
 */

import { useEffect, useRef } from 'react';
import { useWatchContractEvent } from 'wagmi';
import { useAccount, useChainId } from 'wagmi';
import { getContractAddress, ROUTER_ABI } from '../lib/wagmi';
import { invalidateStreamsCache } from './useStreams';

// Minimum ms between event-triggered refreshes - avoids re-fetch storms when
// multiple events land in the same block.
const DEBOUNCE_MS = 1_200;

export function useStreamEvents(refresh) {
  const { address }        = useAccount();
  const chainId            = useChainId();
  const contractAddress    = getContractAddress(chainId);
  const timerRef           = useRef(null);

  // Debounced refresh - coalesces bursts of events into one re-fetch
  const trigger = () => {
    if (!address || !refresh) return;
    invalidateStreamsCache(address);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      refresh();
      timerRef.current = null;
    }, DEBOUNCE_MS);
  };

  useEffect(() => () => {
    if (timerRef.current) clearTimeout(timerRef.current);
  }, []);

  // ── StreamCreated - new stream for sender or recipient ───────────────────
  useWatchContractEvent({
    address:   contractAddress,
    abi:       ROUTER_ABI,
    eventName: 'StreamCreated',
    onLogs(logs) {
      if (!address) return;
      const addrLow = address.toLowerCase();
      const relevant = logs.some(
        l => l.args?.sender?.toLowerCase()    === addrLow ||
             l.args?.recipient?.toLowerCase() === addrLow
      );
      if (relevant) {
        console.log('[useStreamEvents] StreamCreated - refreshing');
        trigger();
      }
    },
  });

  // ── WithdrawalExecuted - balance changed on a stream this wallet owns ────
  useWatchContractEvent({
    address:   contractAddress,
    abi:       ROUTER_ABI,
    eventName: 'WithdrawalExecuted',
    onLogs(logs) {
      if (!address) return;
      const addrLow = address.toLowerCase();
      // recipient field in the event is the contractor who withdrew
      const relevant = logs.some(
        l => l.args?.recipient?.toLowerCase() === addrLow
      );
      if (relevant) {
        console.log('[useStreamEvents] WithdrawalExecuted - refreshing');
        trigger();
      }
    },
  });

  // ── UnspentFundsReclaimed - company reclaimed unearned funds ─────────────
  useWatchContractEvent({
    address:   contractAddress,
    abi:       ROUTER_ABI,
    eventName: 'UnspentFundsReclaimed',
    onLogs(logs) {
      if (!address) return;
      const addrLow = address.toLowerCase();
      const relevant = logs.some(
        l => l.args?.sender?.toLowerCase() === addrLow
      );
      if (relevant) {
        console.log('[useStreamEvents] UnspentFundsReclaimed - refreshing');
        trigger();
      }
    },
  });

  // ── StreamExtended - agent extended a stream, streamValidUntil changed ───
  // Any extension on any stream this wallet is party to should refresh.
  // We can't filter by address in the event args (only streamId is indexed),
  // so we trigger for all extensions - the fetch is cheap (cached server-side).
  useWatchContractEvent({
    address:   contractAddress,
    abi:       ROUTER_ABI,
    eventName: 'StreamExtended',
    onLogs() {
      if (!address) return;
      console.log('[useStreamEvents] StreamExtended - refreshing');
      trigger();
    },
  });
}
