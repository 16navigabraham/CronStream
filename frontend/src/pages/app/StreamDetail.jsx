import { useParams, useNavigate } from 'react-router-dom';
import { useReadContract } from 'wagmi';
import { formatUnits } from 'viem';
import { CONTRACT_ADDRESS, ROUTER_ABI } from '../../lib/wagmi';

export default function StreamDetail() {
  const { id } = useParams();
  const navigate = useNavigate();

  const { data: stream, isLoading } = useReadContract({
    address:      CONTRACT_ADDRESS,
    abi:          ROUTER_ABI,
    functionName: 'streams',
    args:         [id],
  });

  const { data: balance } = useReadContract({
    address:      CONTRACT_ADDRESS,
    abi:          ROUTER_ABI,
    functionName: 'balanceOf',
    args:         [id],
    query: { refetchInterval: 5000 }, // refresh every 5s
  });

  if (isLoading) {
    return (
      <div className="p-8 flex items-center justify-center min-h-64">
        <div className="text-muted font-mono text-sm animate-pulse">Loading stream...</div>
      </div>
    );
  }

  if (!stream || stream[0] === '0x0000000000000000000000000000000000000000') {
    return (
      <div className="p-8">
        <p className="text-muted">Stream not found.</p>
        <button className="btn-outline mt-4 text-sm" onClick={() => navigate('/app/dashboard')}>
          Back to Dashboard
        </button>
      </div>
    );
  }

  const [sender, recipient, token, ratePerSecond, startTime, streamValidUntil, totalDeposited, totalWithdrawn] = stream;

  const now           = BigInt(Math.floor(Date.now() / 1000));
  const isActive      = now < streamValidUntil;
  const elapsed       = isActive ? now - startTime : streamValidUntil - startTime;
  const duration      = streamValidUntil - startTime;
  const progressPct   = duration > 0n ? Number((elapsed * 100n) / duration) : 100;
  const balanceFormatted = balance ? parseFloat(formatUnits(balance, 6)).toFixed(4) : '—';

  return (
    <div className="p-8 max-w-2xl">
      <button onClick={() => navigate(-1)} className="text-muted text-sm hover:text-white mb-6 flex items-center gap-2">
        ← Back
      </button>

      <div className="flex items-center gap-3 mb-8">
        <h1 className="text-2xl font-bold">Stream</h1>
        <span className={isActive ? 'badge-active' : 'badge-expired'}>
          {isActive ? 'Active' : 'Expired'}
        </span>
      </div>

      {/* Balance card */}
      <div className="card bg-accent/5 border-accent/20 mb-6">
        <div className="text-muted text-xs uppercase tracking-widest mb-1">Available to withdraw</div>
        <div className="text-4xl font-mono font-bold text-accent mb-1">{balanceFormatted}</div>
        <div className="text-muted text-xs font-mono">{token}</div>
      </div>

      {/* Progress */}
      <div className="card mb-6">
        <div className="flex justify-between text-xs text-muted mb-2">
          <span>Stream progress</span>
          <span className="font-mono">{progressPct.toFixed(1)}%</span>
        </div>
        <div className="h-1.5 bg-border rounded-full overflow-hidden">
          <div
            className="h-full bg-accent rounded-full transition-all duration-1000"
            style={{ width: `${Math.min(progressPct, 100)}%` }}
          />
        </div>
      </div>

      {/* Details */}
      <div className="card flex flex-col gap-4">
        {[
          { label: 'Stream ID',       value: `${id?.slice(0, 10)}...${id?.slice(-6)}`,                          mono: true  },
          { label: 'Sender',          value: `${sender?.slice(0, 6)}...${sender?.slice(-4)}`,                   mono: true  },
          { label: 'Recipient',       value: `${recipient?.slice(0, 6)}...${recipient?.slice(-4)}`,             mono: true  },
          { label: 'Rate',            value: `${formatUnits(ratePerSecond ?? 0n, 6)} / second`,                 mono: true  },
          { label: 'Total Deposited', value: `${formatUnits(totalDeposited ?? 0n, 6)}`,                         mono: true  },
          { label: 'Total Withdrawn', value: `${formatUnits(totalWithdrawn ?? 0n, 6)}`,                         mono: true  },
          { label: 'Expires',         value: new Date(Number(streamValidUntil) * 1000).toLocaleString(),        mono: false },
        ].map(({ label, value, mono }) => (
          <div key={label} className="flex justify-between items-start gap-4">
            <span className="text-muted text-xs uppercase tracking-widest shrink-0">{label}</span>
            <span className={`text-sm text-right break-all ${mono ? 'font-mono' : ''}`}>{value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
