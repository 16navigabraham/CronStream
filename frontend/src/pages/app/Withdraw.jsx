import { useState, useEffect, useRef } from 'react';
import { useAccount, useChainId, useWriteContract, useWaitForTransactionReceipt, useReadContracts } from 'wagmi';
import { formatUnits } from 'viem';
import { useNavigate } from 'react-router-dom';
import { useStreams } from '../../hooks/useStreams';
import { getContractAddress, ROUTER_ABI } from '../../lib/wagmi';

// ─── Live balance cell ────────────────────────────────────────────────────────
function LiveBalance({ streamId, ratePerSecond, baseBalance, fetchedAt }) {
  const [display, setDisplay] = useState(baseBalance);
  const frameRef = useRef(null);

  useEffect(() => {
    function tick() {
      const elapsed = (Date.now() - fetchedAt) / 1000;
      const earned  = parseFloat(formatUnits(ratePerSecond, 6)) * elapsed;
      setDisplay(Math.max(0, baseBalance + earned));
      frameRef.current = requestAnimationFrame(tick);
    }
    frameRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frameRef.current);
  }, [baseBalance, fetchedAt, ratePerSecond]);

  const [int, dec] = display.toFixed(4).split('.');
  return (
    <span className="font-mono tabular-nums text-accent font-semibold text-sm">
      {int}<span className="opacity-60">.{dec}</span>
    </span>
  );
}

// ─── Row withdraw button ──────────────────────────────────────────────────────
function WithdrawButton({ streamId, amount }) {
  const chainId = useChainId();
  const { writeContract, data: txHash, isPending } = useWriteContract();
  const { isLoading: confirming, isSuccess } = useWaitForTransactionReceipt({ hash: txHash });

  function handleWithdraw() {
    if (!amount || amount === 0n) return;
    writeContract({
      address:      getContractAddress(chainId),
      abi:          ROUTER_ABI,
      functionName: 'withdrawFromStream',
      args:         [streamId, amount],
    });
  }

  if (isSuccess) {
    return (
      <span className="text-xs text-accent font-mono flex items-center gap-1">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none">
          <path d="M5 13l4 4L19 7" stroke="#00D4AA" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
        Done
      </span>
    );
  }

  return (
    <button
      onClick={handleWithdraw}
      disabled={isPending || confirming || !amount || amount === 0n}
      className="px-3 py-1.5 rounded-lg bg-accent/10 border border-accent/20 text-accent text-xs font-medium
        hover:bg-accent/20 hover:border-accent/40 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
    >
      {isPending ? 'Confirm…' : confirming ? 'Sending…' : 'Withdraw'}
    </button>
  );
}

// ─── Main ─────────────────────────────────────────────────────────────────────
export default function Withdraw() {
  const { address }               = useAccount();
  const chainId                   = useChainId();
  const navigate                  = useNavigate();
  const { received, loading }     = useStreams();

  // Batch-read balances for all streams
  const calls = received.map(s => ({
    address:      getContractAddress(chainId),
    abi:          ROUTER_ABI,
    functionName: 'balanceOf',
    args:         [s.streamId],
  }));
  const { data: balances, dataUpdatedAt } = useReadContracts({
    contracts: calls,
    query: { enabled: received.length > 0, refetchInterval: 10_000 },
  });

  const fetchedAt = dataUpdatedAt ?? Date.now();

  const rows = received.map((s, i) => {
    const rawBalance    = balances?.[i]?.result ?? 0n;
    const baseBalance   = parseFloat(formatUnits(rawBalance, 6));
    const ratePerSecond = s.ratePerSecond ?? 0n;
    const rateDisplay   = (parseFloat(formatUnits(ratePerSecond, 6)) * 86400).toFixed(2);

    return { ...s, rawBalance, baseBalance, ratePerSecond, rateDisplay };
  });

  const totalWithdrawable = rows.reduce((sum, r) => sum + r.rawBalance, 0n);

  // ─── Empty state ────────────────────────────────────────────────────────────
  if (!loading && received.length === 0) {
    return (
      <div className="p-4 sm:p-6 w-full">
        <h1 className="text-2xl font-bold mb-1">Withdraw</h1>
        <p className="text-muted text-sm mb-10">Your incoming streams and withdrawable balances.</p>
        <div className="card border-dashed flex flex-col items-center justify-center py-24 text-center">
          <div className="w-16 h-16 rounded-2xl bg-surface border border-border flex items-center justify-center mb-4 text-2xl">↓</div>
          <p className="font-medium mb-1">No incoming streams</p>
          <p className="text-muted text-sm max-w-xs">When a company starts streaming to your wallet, it will appear here.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 sm:p-6 w-full">

      {/* Header */}
      <div className="flex items-start justify-between gap-4 mb-6 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold mb-1">Withdraw</h1>
          <p className="text-muted text-sm">Your incoming streams and withdrawable balances.</p>
        </div>

        {totalWithdrawable > 0n && (
          <div className="text-right shrink-0">
            <div className="text-xs text-muted font-mono uppercase tracking-widest mb-0.5">Total available</div>
            <div className="font-mono font-bold text-accent text-2xl tabular-nums">
              {parseFloat(formatUnits(totalWithdrawable, 6)).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              <span className="text-base text-muted ml-1">USDC</span>
            </div>
          </div>
        )}
      </div>

      {/* Table */}
      <div className="rounded-2xl border border-border overflow-hidden">

        {/* Table header */}
        <div className="grid grid-cols-[1fr_auto_auto_auto_auto] items-center gap-4 px-5 py-3
          bg-surface border-b border-border text-xs font-mono text-muted uppercase tracking-wider">
          <span>Stream</span>
          <span className="text-right hidden sm:block">Rate / day</span>
          <span className="text-right">Available</span>
          <span className="text-right hidden md:block">Status</span>
          <span className="text-right">Action</span>
        </div>

        {/* Skeleton rows */}
        {loading && [1, 2, 3].map(i => (
          <div key={i} className="grid grid-cols-[1fr_auto_auto_auto_auto] items-center gap-4 px-5 py-4 border-b border-border last:border-0 animate-pulse">
            <div className="flex flex-col gap-1.5">
              <div className="h-3.5 bg-border rounded w-32" />
              <div className="h-3 bg-border rounded w-20" />
            </div>
            <div className="h-3.5 bg-border rounded w-16 hidden sm:block" />
            <div className="h-3.5 bg-border rounded w-20" />
            <div className="h-5 bg-border rounded w-14 hidden md:block" />
            <div className="h-7 bg-border rounded w-20" />
          </div>
        ))}

        {/* Data rows */}
        {!loading && rows.map(row => {
          const now       = Math.floor(Date.now() / 1000);
          const isActive  = row.streamValidUntil ? Number(row.streamValidUntil) > now : false;
          const senderShort = row.sender
            ? `${row.sender.slice(0, 6)}…${row.sender.slice(-4)}`
            : '—';

          return (
            <div
              key={row.streamId}
              className="grid grid-cols-[1fr_auto_auto_auto_auto] items-center gap-4 px-5 py-4
                border-b border-border last:border-0 hover:bg-white/[0.02] transition-colors"
            >
              {/* Stream identity */}
              <div className="min-w-0">
                <button
                  onClick={() => navigate(`/app/stream/${row.streamId}`)}
                  className="font-mono text-sm text-white hover:text-accent transition-colors truncate block max-w-full text-left"
                >
                  {row.streamId.slice(0, 10)}…{row.streamId.slice(-6)}
                </button>
                <div className="text-xs text-muted font-mono mt-0.5">from {senderShort}</div>
              </div>

              {/* Rate */}
              <div className="text-right hidden sm:block">
                <span className="text-sm font-mono text-white">{row.rateDisplay}</span>
                <div className="text-xs text-muted">USDC/day</div>
              </div>

              {/* Live balance */}
              <div className="text-right">
                <LiveBalance
                  streamId={row.streamId}
                  ratePerSecond={row.ratePerSecond}
                  baseBalance={row.baseBalance}
                  fetchedAt={fetchedAt}
                />
                <div className="text-xs text-muted">USDC</div>
              </div>

              {/* Status badge */}
              <div className="hidden md:flex justify-end">
                <span className={`text-xs font-mono px-2 py-1 rounded-lg border
                  ${isActive
                    ? 'bg-accent/10 border-accent/20 text-accent'
                    : 'bg-border/30 border-border text-muted'}`}>
                  {isActive ? 'active' : 'ended'}
                </span>
              </div>

              {/* Withdraw button */}
              <div className="flex justify-end">
                <WithdrawButton streamId={row.streamId} amount={row.rawBalance} />
              </div>
            </div>
          );
        })}
      </div>

      {/* Footer note */}
      {!loading && rows.length > 0 && (
        <p className="text-xs text-muted mt-4 font-mono">
          Balances accrue in real time. Withdraw any amount at any time — no lock-up.
        </p>
      )}
    </div>
  );
}
