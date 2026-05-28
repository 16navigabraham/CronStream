import { useEffect, useState, useRef, useCallback } from 'react';
import { usePublicClient, useAccount, useChainId } from 'wagmi';
import { parseAbiItem, keccak256, toHex, decodeAbiParameters } from 'viem';
import { getContractAddress, CONTRACT_ADDRESSES } from '../lib/wagmi';

const AGENT_URL    = import.meta.env.VITE_AGENT_URL ?? 'http://localhost:3000';
const BS_API_KEY   = import.meta.env.VITE_BLOCKSCOUT_API_KEY ?? '';

// Blockscout base URLs — only chains indexed by Blockscout
const BLOCKSCOUT_BASE = {
  421614: 'https://arbitrum-sepolia.blockscout.com',
};

// keccak256("StreamCreated(bytes32,address,address,uint256)")
const STREAM_CREATED_TOPIC0 = keccak256(
  toHex('StreamCreated(bytes32,address,address,uint256)')
);

const STREAM_CREATED = parseAbiItem(
  'event StreamCreated(bytes32 indexed streamId, address indexed sender, address indexed recipient, uint256 ratePerSecond)'
);

function mapLog(l, chainId) {
  return {
    streamId:      l.args.streamId,
    sender:        l.args.sender,
    recipient:     l.args.recipient,
    ratePerSecond: l.args.ratePerSecond ?? 0n,
    blockNumber:   l.blockNumber,
    chainId,
  };
}

function mapDbRow(r) {
  // The server merges DB row (snake_case) with on-chain data (camelCase from ethers).
  // We handle both naming styles so old and new responses both work.
  function bi(v) { try { return v != null ? BigInt(v) : null; } catch { return null; } }

  return {
    streamId:           r.stream_id,
    sender:             r.sender          ?? null,
    recipient:          r.recipient       ?? null,
    token:              r.token           ?? null,
    ratePerSecond:      bi(r.ratePerSecond)    ?? bi(r.rate_per_second)    ?? 0n,
    startTime:          bi(r.startTime)        ?? bi(r.start_time)         ?? 0n,
    streamValidUntil:   bi(r.streamValidUntil) ?? bi(r.stream_valid_until) ?? 0n,
    totalDeposited:     bi(r.totalDeposited)   ?? bi(r.total_deposited)    ?? 0n,
    totalWithdrawn:     bi(r.totalWithdrawn)   ?? bi(r.total_withdrawn)    ?? 0n,
    rawBalance:         bi(r.balance)          ?? null,
    verificationSource: r.verification_source  ?? null,
    verificationTarget: r.verification_target  ?? r.github_repo            ?? null,
    blockNumber:        null,
    chainId:            r.chain_id ? Number(r.chain_id) : null,
  };
}

// ─── Module-level deduplication + shared cache ───────────────────────────────
//
// Multiple components (CompanyDashboard, ContractorDashboard, IncomeHistory,
// StreamHistory, StreamDetail, Profile, etc.) all call useStreams() at the
// same time. Without dedup each mount fires its own fetch — 8+ hits per page.
//
// Solution:
//   _inFlight  — all concurrent callers share the same Promise
//   _memCache  — 18s TTL; subsequent polls within the window skip the network
//   POLL_MS    — each hook instance polls every 20s, but since all callers share
//                the cache only the first caller past the TTL makes a real request

const _inFlight = new Map(); // address → Promise<{sent,received}|null>
const _memCache = new Map(); // address → { sent, received, ts }
const CACHE_MS  = 18_000;   // 18s — shorter than server's 30s so polls always land
const POLL_MS   = 20_000;   // background poll interval per hook instance

/**
 * Bust the in-memory stream cache for an address.
 * Call after any successful on-chain write so the next fetch returns fresh data.
 */
export function invalidateStreamsCache(address) {
  if (address) _memCache.delete(address.toLowerCase());
}

/**
 * Fetch streams from the agent DB (priority-1 path).
 * Deduplicates concurrent calls and caches results for CACHE_MS.
 */
async function fetchFromAgent(address) {
  const key = address.toLowerCase();

  // 1. Memory cache hit — skip network
  const hit = _memCache.get(key);
  if (hit && Date.now() - hit.ts < CACHE_MS) return hit;

  // 2. Already in-flight — share the promise
  if (_inFlight.has(key)) return _inFlight.get(key);

  // 3. New request
  const promise = fetch(
    `${AGENT_URL}/api/v1/streams?address=${address}`,
    { signal: AbortSignal.timeout(5000) }
  )
    .then(async res => {
      if (!res.ok) return null;
      const { streams } = await res.json();
      if (!streams?.length) return null;
      const addrLow = key;
      const sent     = streams.filter(s => s.sender?.toLowerCase()    === addrLow).map(mapDbRow);
      const received = streams.filter(s => s.recipient?.toLowerCase() === addrLow).map(mapDbRow);
      const result = { sent, received };
      _memCache.set(key, { ...result, ts: Date.now() });
      return result;
    })
    .catch(() => null)
    .finally(() => _inFlight.delete(key));

  _inFlight.set(key, promise);
  return promise;
}

/**
 * Fetch StreamCreated events for an address from Blockscout.
 * Returns { sent: [...], received: [...] } or null on failure.
 */
async function fetchFromBlockscout(address, chainId) {
  const base = BLOCKSCOUT_BASE[chainId];
  if (!base) return null;

  const contractAddress = getContractAddress(chainId);
  const paddedAddress   = '0x' + address.toLowerCase().replace('0x', '').padStart(64, '0');

  try {
    const allItems = [];
    let pageParams = null;

    for (let page = 0; page < 20; page++) {
      const qs = new URLSearchParams();
      if (BS_API_KEY) qs.set('apikey', BS_API_KEY);
      if (pageParams) {
        Object.entries(pageParams).forEach(([k, v]) => qs.set(k, String(v)));
      }

      const url = `${base}/api/v2/addresses/${contractAddress}/logs?${qs}`;
      const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
      if (!res.ok) throw new Error(`Blockscout ${res.status}`);
      const json = await res.json();

      // Keep only StreamCreated events involving this address
      const matching = (json.items ?? []).filter(item => {
        const t = item.topics ?? [];
        return (
          t[0]?.toLowerCase() === STREAM_CREATED_TOPIC0.toLowerCase() &&
          (t[2]?.toLowerCase() === paddedAddress.toLowerCase() ||
           t[3]?.toLowerCase() === paddedAddress.toLowerCase())
        );
      });
      allItems.push(...matching);

      if (!json.next_page_params) break;
      pageParams = json.next_page_params;
    }

    // Decode each log
    const parsed = allItems.map(item => {
      const t = item.topics ?? [];
      let ratePerSecond = 0n;
      try {
        [ratePerSecond] = decodeAbiParameters([{ type: 'uint256' }], item.data);
      } catch { /* skip */ }

      // topics: [topic0, streamId, sender, recipient]
      const rawSender    = t[2] ? '0x' + t[2].slice(-40) : null;
      const rawRecipient = t[3] ? '0x' + t[3].slice(-40) : null;

      return {
        streamId:      t[1] ?? null,
        sender:        rawSender,
        recipient:     rawRecipient,
        ratePerSecond,
        blockNumber:   BigInt(item.block_number ?? 0),
        chainId:       Number(chainId),
      };
    });

    const addrLow = address.toLowerCase();
    return {
      sent:     parsed.filter(s => s.sender?.toLowerCase()    === addrLow),
      received: parsed.filter(s => s.recipient?.toLowerCase() === addrLow),
    };
  } catch (err) {
    console.warn('[useStreams] Blockscout fallback error:', err.message);
    return null;
  }
}

/**
 * Fetches StreamCreated events for the connected wallet.
 *
 * Priority:
 *  1. Agent DB  — /api/v1/streams?address=0x...  (fast, no RPC limits)
 *  2. Blockscout — for Arb Sepolia (no block-range limits, indexes all history)
 *  3. viem getLogs fallback — for other chains, last ~7 days
 *
 * Background refresh:
 *  - Auto-polls every 20s; multiple callers share the same underlying fetch
 *    via the module-level _inFlight / _memCache dedup
 *  - Call refresh() after any on-chain write to force an immediate re-fetch
 *  - Call invalidateStreamsCache(address) from event watchers for the same effect
 */
export function useStreams() {
  const { address } = useAccount();
  const client  = usePublicClient();
  const chainId = useChainId();

  const [sent,     setSent]     = useState([]);
  const [received, setReceived] = useState([]);
  const [loading,  setLoading]  = useState(false);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  // ── Core load function ───────────────────────────────────────────────────
  const load = useCallback(async (force = false) => {
    if (!address || !client) return;

    // Bust cache so the next fetchFromAgent call goes to the network
    if (force) invalidateStreamsCache(address);

    setLoading(true);

    // ── 1. Agent DB (deduplicated) ─────────────────────────────────────────
    const dbResult = await fetchFromAgent(address);
    if (dbResult) {
      if (mountedRef.current) {
        setSent(dbResult.sent);
        setReceived(dbResult.received);
        setLoading(false);
      }
      return;
    }

    // ── 2. Blockscout (Arb Sepolia — all history, no RPC limit) ───────────
    const bsResult = await fetchFromBlockscout(address, 421614);
    if (bsResult && (bsResult.sent.length > 0 || bsResult.received.length > 0)) {
      if (mountedRef.current) {
        setSent(bsResult.sent);
        setReceived(bsResult.received);
        setLoading(false);
      }
      return;
    }

    // ── 3. viem fallback (current wallet chain) ────────────────────────────
    try {
      const contractAddress = getContractAddress(chainId);
      const currentBlock    = await client.getBlockNumber();
      const lookback  = 2_500_000n;
      const fromBlock = currentBlock > lookback ? currentBlock - lookback : 0n;

      const [sentLogs, receivedLogs] = await Promise.all([
        client.getLogs({ address: contractAddress, event: STREAM_CREATED, args: { sender: address },    fromBlock, toBlock: 'latest' }),
        client.getLogs({ address: contractAddress, event: STREAM_CREATED, args: { recipient: address }, fromBlock, toBlock: 'latest' }),
      ]);

      if (mountedRef.current) {
        setSent    (sentLogs.map(l => mapLog(l, chainId)));
        setReceived(receivedLogs.map(l => mapLog(l, chainId)));
      }
    } catch (err) {
      console.error('useStreams viem fallback error:', err.message);
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, [address, client, chainId]);

  // Public refresh — busts cache and re-fetches immediately
  const refresh = useCallback(() => load(true), [load]);

  // ── Initial load + background poll ──────────────────────────────────────
  useEffect(() => {
    if (!address || !client) return;

    load();

    // Background poll — multiple concurrent callers share the same fetch
    // via module-level cache, so there's no thundering herd.
    const timer = setInterval(() => load(true), POLL_MS);
    return () => clearInterval(timer);
  }, [address, client, chainId, load]);

  return { sent, received, loading, refresh };
}
