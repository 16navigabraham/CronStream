import { useEffect, useState, useMemo } from 'react';
import { useAccount, useChainId, usePublicClient } from 'wagmi';
import { formatUnits, parseAbiItem } from 'viem';
import {
  AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
} from 'recharts';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, ExternalLink } from 'lucide-react';
import { useProfile }   from '../../hooks/useProfile';
import { useStreams }    from '../../hooks/useStreams';
import { useReadContracts } from 'wagmi';
import { getContractAddress, ROUTER_ABI } from '../../lib/wagmi';
import { CHAIN_TOKENS }  from '../../hooks/useWalletTokens';
import {
  useBlockscoutWithdrawals,
  chainHasBlockscout,
} from '../../hooks/useBlockscoutLogs';

// ─── helpers ──────────────────────────────────────────────────────────────────
function tokenMeta(chainId, tokenAddress) {
  if (!tokenAddress) return { symbol: null, decimals: 6, logoUrl: null };
  const k = (CHAIN_TOKENS[chainId] ?? []).find(
    t => t.address.toLowerCase() === tokenAddress.toLowerCase()
  );
  return k ?? { symbol: tokenAddress.slice(0, 6) + '…', decimals: 18, logoUrl: null };
}

const WITHDRAWAL_EVENT = parseAbiItem(
  'event WithdrawalExecuted(bytes32 indexed streamId, address indexed recipient, uint256 amount, uint256 protocolFee)'
);

const RANGES = [
  { label: 'Day',   key: 'day',   buckets: 24,  ms: 3_600_000 },
  { label: 'Week',  key: 'week',  buckets: 7,   ms: 86_400_000 },
  { label: 'Month', key: 'month', buckets: 30,  ms: 86_400_000 },
  { label: 'Year',  key: 'year',  buckets: 12,  ms: 2_592_000_000 },
];

function bucketLabel(i, cfg) {
  const now  = Date.now();
  const time = new Date(now - (cfg.buckets - 1 - i) * cfg.ms);
  if (cfg.key === 'day')   return time.getHours() + 'h';
  if (cfg.key === 'week')  return ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][time.getDay()];
  if (cfg.key === 'month') return time.getDate() + '';
  if (cfg.key === 'year')  return ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][time.getMonth()];
  return i + '';
}

// Only used for viem fallback (Robinhood Chain)
function approximateTimestamp(blockNumber, currentBlock) {
  return Date.now() - Number(currentBlock - blockNumber) * 250;
}

// ─── Blockscout tx explorer URL ───────────────────────────────────────────────
const BLOCKSCOUT_TX_URL = {
  421614: hash => `https://arbitrum-sepolia.blockscout.com/tx/${hash}`,
};

// ─── Transaction log row ──────────────────────────────────────────────────────
function LogRow({ txHash, timestamp, amount, symbol, decimals }) {
  const date = new Date(timestamp);
  const fmt  = parseFloat(formatUnits(amount ?? 0n, decimals));
  const explorerUrl = BLOCKSCOUT_TX_URL[/* passed via prop */ 0]; // resolved below via closure

  return (
    <div className="flex items-center justify-between gap-4 px-5 py-3.5 border-b border-border last:border-0 hover:bg-white/[0.02] transition-colors">
      <div className="min-w-0">
        <p className="text-xs font-mono text-white/60 truncate">
          {txHash?.slice(0, 10)}…{txHash?.slice(-6)}
        </p>
        <p className="text-[10px] text-muted font-mono mt-0.5">
          {date.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
        </p>
      </div>
      <div className="text-right shrink-0">
        <p className="text-sm font-mono font-semibold text-accent tabular-nums">
          +{fmt.toFixed(decimals <= 6 ? 4 : 6)}
        </p>
        {symbol && <p className="text-[10px] text-muted font-mono">{symbol}</p>}
      </div>
    </div>
  );
}

// LogRow with explorer link — accepts chainId
function LogEntry({ item, chainId, symbol, decimals }) {
  const date = new Date(item.timestamp);
  const fmt  = parseFloat(formatUnits(item.amount ?? 0n, decimals));
  const url  = BLOCKSCOUT_TX_URL[chainId]?.(item.transactionHash);

  return (
    <div className="flex items-center justify-between gap-4 px-5 py-3.5 border-b border-border last:border-0 hover:bg-white/[0.02] transition-colors group">
      <div className="min-w-0 flex items-center gap-2.5">
        {url ? (
          <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1.5 min-w-0 group/link"
          >
            <span className="text-xs font-mono text-white/60 truncate group-hover/link:text-accent transition-colors">
              {item.transactionHash?.slice(0, 10)}…{item.transactionHash?.slice(-6)}
            </span>
            <ExternalLink size={10} className="text-muted group-hover/link:text-accent transition-colors shrink-0" />
          </a>
        ) : (
          <span className="text-xs font-mono text-white/60 truncate">
            {item.transactionHash?.slice(0, 10)}…{item.transactionHash?.slice(-6)}
          </span>
        )}
        <p className="text-[10px] text-muted font-mono mt-0.5 hidden sm:block">
          {date.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
        </p>
      </div>
      <div className="text-right shrink-0">
        <p className="text-xs text-muted font-mono sm:hidden">
          {date.toLocaleString(undefined, { month: 'short', day: 'numeric' })}
        </p>
        <p className="text-sm font-mono font-semibold text-accent tabular-nums">
          +{fmt.toFixed(decimals <= 6 ? 4 : 6)}
        </p>
        {symbol && <p className="text-[10px] text-muted font-mono">{symbol}</p>}
      </div>
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────
export default function IncomeHistory() {
  const { address }  = useAccount();
  const chainId      = useChainId();
  const client       = usePublicClient();
  const navigate     = useNavigate();
  const { received } = useStreams();

  const [range, setRange]   = useState('month');
  const [chartData, setData] = useState([]);
  const [viemLogs, setViemLogs] = useState([]); // fallback logs for non-Blockscout chains
  const [viemLoading, setViemLoading] = useState(false);

  const cfg = RANGES.find(r => r.key === range);

  // ── Resolve primary token ────────────────────────────────────────────────
  const contractAddr = getContractAddress(chainId);
  const metaCalls = received.map(s => ({
    address: contractAddr, abi: ROUTER_ABI, functionName: 'streams', args: [s.streamId],
  }));
  const { data: metaData } = useReadContracts({
    contracts: metaCalls,
    query: { enabled: received.length > 0 },
  });
  const primaryToken = metaData?.find(r => r?.result?.token)?.result?.token ?? null;
  const { symbol, decimals } = tokenMeta(chainId, primaryToken);

  // ── Blockscout (Arb Sepolia) ─────────────────────────────────────────────
  const useBlockscout = chainHasBlockscout(chainId);
  const {
    logs: bsLogs,
    loading: bsLoading,
    error: bsError,
  } = useBlockscoutWithdrawals({
    address,
    chainId,
    contractAddress: contractAddr,
    enabled: useBlockscout && !!address && !!contractAddr,
  });

  // ── viem fallback (Robinhood Chain OR when Blockscout errors/expires) ────
  useEffect(() => {
    // Run viem if: chain has no Blockscout support, OR Blockscout errored
    if ((useBlockscout && !bsError) || !address || !client) return;
    let cancelled = false;
    setViemLoading(true);

    async function load() {
      try {
        const now        = Date.now();
        const windowMs   = cfg.buckets * cfg.ms;
        const curBlk     = await client.getBlockNumber();
        const blocksBack = BigInt(Math.floor(windowMs / 250));
        const fromBlock  = curBlk > blocksBack ? curBlk - blocksBack : 0n;

        const logs = await client.getLogs({
          address:   contractAddr,
          event:     WITHDRAWAL_EVENT,
          args:      { recipient: address },
          fromBlock,
          toBlock:   'latest',
        });

        if (!cancelled) {
          // Shape to same structure as Blockscout logs
          setViemLogs(
            [...logs]
              .map(l => ({
                transactionHash: l.transactionHash,
                blockNumber:     l.blockNumber,
                // Approximate timestamp — viem fallback limitation
                timestamp: approximateTimestamp(l.blockNumber, curBlk),
                streamId:  l.args.streamId,
                amount:    l.args.amount ?? 0n,
                protocolFee: l.args.protocolFee ?? 0n,
              }))
              .sort((a, b) => b.timestamp - a.timestamp)
          );
        }
      } catch (err) {
        console.warn('[IncomeHistory viem]', err.message);
        if (!cancelled) setViemLogs([]);
      } finally {
        if (!cancelled) setViemLoading(false);
      }
    }

    load();
    return () => { cancelled = true; };
  }, [address, chainId, range, decimals, client, useBlockscout, bsError]);

  // ── Merge: Blockscout when healthy, viem when not ────────────────────────
  const blockscoutHealthy = useBlockscout && !bsError;
  // useMemo prevents new array ref on every render (would cause infinite useEffect loop)
  const activeLogs = useMemo(
    () => blockscoutHealthy ? (bsLogs ?? []) : viemLogs,
    [blockscoutHealthy, bsLogs, viemLogs]
  );
  const activeLoading = blockscoutHealthy ? bsLoading : viemLoading;

  // ── Build chart from active logs ─────────────────────────────────────────
  useEffect(() => {
    const now = Date.now();
    const buckets = Array.from({ length: cfg.buckets }, (_, i) => ({
      label: bucketLabel(i, cfg),
      value: 0,
    }));

    for (const log of activeLogs) {
      const age  = now - log.timestamp;
      const bIdx = cfg.buckets - 1 - Math.floor(age / cfg.ms);
      if (bIdx >= 0 && bIdx < cfg.buckets) {
        buckets[bIdx].value += parseFloat(formatUnits(log.amount ?? 0n, decimals));
      }
    }

    setData(buckets);
  }, [activeLogs, range, decimals]);

  // Filter logs to the current range window
  const windowMs   = cfg.buckets * cfg.ms;
  const logsInRange = activeLogs.filter(l => Date.now() - l.timestamp <= windowMs);

  const totalInRange = chartData.reduce((s, d) => s + d.value, 0);
  const hasData      = chartData.some(d => d.value > 0);

  return (
    <div className="p-4 sm:p-6 w-full">

      {/* ── Back nav ──────────────────────────────────────────────────────── */}
      <button
        onClick={() => navigate('/app/dashboard')}
        className="flex items-center gap-2 text-xs text-muted hover:text-white transition-colors mb-5 group"
      >
        <ArrowLeft className="w-3.5 h-3.5 group-hover:-translate-x-0.5 transition-transform" />
        Dashboard
      </button>

      {/* ── Header ────────────────────────────────────────────────────────── */}
      <div className="flex items-start justify-between gap-4 mb-6 flex-wrap">
        <div>
          <p className="text-[10px] font-mono text-muted uppercase tracking-widest mb-1">Income history</p>
          <div className="text-3xl font-mono font-bold text-white tabular-nums">
            {activeLoading ? '—' : totalInRange.toFixed(decimals <= 6 ? 2 : 4)}
            {symbol && <span className="text-lg text-muted ml-2">{symbol}</span>}
          </div>
          <p className="text-xs text-muted mt-1">received · this {cfg.label.toLowerCase()}</p>
        </div>

        {/* Range picker */}
        <div className="flex rounded-xl border border-border overflow-hidden shrink-0 text-xs">
          {RANGES.map(r => (
            <button
              key={r.key}
              onClick={() => setRange(r.key)}
              className={`px-4 py-2 font-medium transition-colors
                ${range === r.key ? 'bg-accent/10 text-accent' : 'text-muted hover:text-white bg-dark'}`}
            >
              {r.label}
            </button>
          ))}
        </div>
      </div>

      {/* ── Chart card ────────────────────────────────────────────────────── */}
      <div className="card mb-6">
        <div className="h-52">
          {activeLoading ? (
            <div className="h-full flex items-center justify-center">
              <div className="w-5 h-5 rounded-full border-2 border-accent border-t-transparent animate-spin" />
            </div>
          ) : !hasData ? (
            <div className="h-full flex flex-col items-center justify-center gap-1.5">
              <svg className="w-8 h-8 text-muted/30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
              </svg>
              <p className="text-xs text-muted font-mono">No withdrawals in this period</p>
            </div>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={chartData} margin={{ top: 4, right: 4, left: -32, bottom: 0 }}>
                <defs>
                  <linearGradient id="incomeGrad2" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%"   stopColor="#7c3aed" stopOpacity={0.35} />
                    <stop offset="100%" stopColor="#7c3aed" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#1e1e2e" vertical={false} />
                <XAxis dataKey="label" tick={{ fontSize: 10, fill: '#6b7280', fontFamily: 'monospace' }} tickLine={false} axisLine={false} />
                <YAxis tick={{ fontSize: 10, fill: '#6b7280', fontFamily: 'monospace' }} tickLine={false} axisLine={false} />
                <Tooltip
                  contentStyle={{ background: '#12121a', border: '1px solid #1e1e2e', borderRadius: 12, fontSize: 12, fontFamily: 'monospace' }}
                  labelStyle={{ color: '#9ca3af' }}
                  itemStyle={{ color: '#7c3aed' }}
                  formatter={v => [`${v.toFixed(4)} ${symbol ?? ''}`, 'Received']}
                />
                <Area type="monotone" dataKey="value" stroke="#7c3aed" strokeWidth={2} fill="url(#incomeGrad2)" dot={false} activeDot={{ r: 4, fill: '#7c3aed' }} />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      {/* ── Transaction log ───────────────────────────────────────────────── */}
      <div className="card p-0 overflow-hidden">
        <div className="px-5 py-4 border-b border-border flex items-center justify-between">
          <p className="text-xs font-mono text-muted uppercase tracking-widest">Transactions</p>
          <div className="flex items-center gap-3">
            {logsInRange.length > 0 && (
              <span className="text-[10px] font-mono text-muted">
                {logsInRange.length} withdrawal{logsInRange.length !== 1 ? 's' : ''}
              </span>
            )}
            {/* Blockscout attribution */}
            {blockscoutHealthy && (
              <a
                href="https://arbitrum-sepolia.blockscout.com"
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1 text-[10px] font-mono text-muted/50 hover:text-muted transition-colors"
              >
                <img
                  src="https://avatars.githubusercontent.com/u/56025565?s=16"
                  alt="Blockscout"
                  className="w-3 h-3 rounded-full opacity-60"
                />
                Blockscout
              </a>
            )}
          </div>
        </div>

        {/* Blockscout errored (expired key, rate limit, etc.) — fell back to viem */}
        {useBlockscout && bsError && (
          <div className="px-5 py-3 border-b border-border bg-yellow-500/5">
            <p className="text-[10px] text-yellow-500/70 font-mono">
              Blockscout unavailable — showing on-chain data via RPC
            </p>
          </div>
        )}

        {activeLoading ? (
          <div className="px-5 py-10 flex items-center justify-center">
            <div className="w-5 h-5 rounded-full border-2 border-accent border-t-transparent animate-spin" />
          </div>
        ) : logsInRange.length === 0 ? (
          <div className="px-5 py-12 text-center">
            <p className="text-xs text-muted font-mono">No transactions in this period</p>
          </div>
        ) : (
          <div className="overflow-y-auto max-h-80">
            {logsInRange.map((item, i) => (
              <LogEntry
                key={(item.transactionHash ?? '') + i}
                item={item}
                chainId={chainId}
                symbol={symbol}
                decimals={decimals}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
