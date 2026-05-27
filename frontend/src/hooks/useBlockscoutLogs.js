/**
 * useBlockscoutWithdrawals
 * ─────────────────────────
 * Fetches WithdrawalExecuted events for a recipient from the Blockscout API.
 * Only chains indexed by Blockscout are supported — callers should fall back
 * to viem getLogs for unsupported chains (e.g. Robinhood Chain).
 *
 * Env:
 *   VITE_BLOCKSCOUT_API_KEY  — optional; Builder-plan key from dev.blockscout.com
 *                              sent as ?apikey=<key> on every request
 */

import { useState, useEffect } from 'react';
import { decodeAbiParameters, keccak256, toHex } from 'viem';

// ─── Chain → Blockscout base URL ─────────────────────────────────────────────
// Robinhood Chain (46630) is NOT indexed by Blockscout — omit intentionally.
const BLOCKSCOUT_BASE = {
  421614: 'https://arbitrum-sepolia.blockscout.com',
};

// keccak256("WithdrawalExecuted(bytes32,address,uint256,uint256)")
const WITHDRAWAL_TOPIC0 = keccak256(
  toHex('WithdrawalExecuted(bytes32,address,uint256,uint256)')
);

/** Returns true if the given chainId has Blockscout support */
export function chainHasBlockscout(chainId) {
  return !!BLOCKSCOUT_BASE[chainId];
}

/**
 * Fetch and decode WithdrawalExecuted logs for `address` on `chainId`.
 *
 * Returns:
 *   logs    — parsed log array (newest first), or null while loading
 *   loading — boolean
 *   error   — Error | null
 *
 * Each log:
 *   { transactionHash, blockNumber, timestamp (ms), streamId, amount, protocolFee }
 */
export function useBlockscoutWithdrawals({ address, chainId, contractAddress, enabled = true }) {
  const [logs,    setLogs]    = useState(null);
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState(null);

  const apiKey = import.meta.env.VITE_BLOCKSCOUT_API_KEY ?? '';

  useEffect(() => {
    const base = BLOCKSCOUT_BASE[chainId];
    if (!base || !address || !contractAddress || !enabled) return;

    let cancelled = false;
    setLoading(true);
    setError(null);

    async function load() {
      try {
        // Recipient as a 32-byte padded topic (topic2 position)
        const recipientTopic =
          '0x' + address.toLowerCase().replace('0x', '').padStart(64, '0');

        const allItems = [];
        let pageParams = null;

        // Paginate up to 10 pages (500 logs max — more than enough for testnet)
        for (let page = 0; page < 10; page++) {
          const qs = new URLSearchParams();
          if (apiKey) qs.set('apikey', apiKey);
          if (pageParams) {
            Object.entries(pageParams).forEach(([k, v]) => qs.set(k, String(v)));
          }

          const url = `${base}/api/v2/addresses/${contractAddress}/logs?${qs}`;
          const res = await fetch(url);
          if (!res.ok) throw new Error(`Blockscout responded ${res.status}`);
          const json = await res.json();

          // Keep only our event emitted to this recipient
          const matching = (json.items ?? []).filter(item => {
            const t = item.topics ?? [];
            return (
              t[0]?.toLowerCase() === WITHDRAWAL_TOPIC0.toLowerCase() &&
              t[2]?.toLowerCase() === recipientTopic.toLowerCase()
            );
          });
          allItems.push(...matching);

          if (!json.next_page_params) break;
          pageParams = json.next_page_params;
        }

        if (cancelled) return;

        // Decode each log — data = abi.encode(uint256 amount, uint256 protocolFee)
        const parsed = allItems
          .map(item => {
            let amount = 0n, protocolFee = 0n;
            try {
              [amount, protocolFee] = decodeAbiParameters(
                [{ type: 'uint256' }, { type: 'uint256' }],
                item.data
              );
            } catch { /* malformed — skip */ }

            return {
              transactionHash: item.tx_hash,
              blockNumber:     BigInt(item.block_number ?? 0),
              // Real block timestamp from Blockscout — no approximation needed
              timestamp:       new Date(item.block_timestamp).getTime(),
              streamId:        item.topics?.[1] ?? null,
              amount,
              protocolFee,
            };
          })
          .sort((a, b) => b.timestamp - a.timestamp); // newest first

        setLogs(parsed);
      } catch (err) {
        if (!cancelled) setError(err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => { cancelled = true; };
  }, [address, chainId, contractAddress, enabled, apiKey]);

  return { logs, loading, error };
}
