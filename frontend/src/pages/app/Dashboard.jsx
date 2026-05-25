import { useAccount } from 'wagmi';
import { useNavigate } from 'react-router-dom';
import { formatUnits } from 'viem';
import { useProfile }     from '../../hooks/useProfile';
import { useStreams }     from '../../hooks/useStreams';
import { useAgentStatus } from '../../hooks/useAgentStatus';

function AgentStatusBadge({ online, data }) {
  if (online === null) {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-mono text-muted">
        <span className="w-1.5 h-1.5 rounded-full bg-muted animate-pulse" />
        Checking agent…
      </span>
    );
  }
  if (!online) {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-mono text-muted">
        <span className="w-1.5 h-1.5 rounded-full bg-red-500" />
        Agent offline
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 text-xs font-mono text-accent">
      <span className="w-1.5 h-1.5 rounded-full bg-accent animate-pulse" />
      Agent online · {data?.extensionsServed ?? 0} extensions served
    </span>
  );
}

function StreamRow({ stream, label }) {
  const navigate = useNavigate();
  const short = (addr) => addr ? `${addr.slice(0, 6)}…${addr.slice(-4)}` : '—';

  return (
    <button
      onClick={() => navigate(`/app/stream/${stream.streamId}`)}
      className="w-full flex items-center justify-between px-4 py-3 rounded-lg border border-border hover:border-accent/30 hover:bg-surface transition-colors duration-150 text-left"
    >
      <div>
        <div className="text-xs font-mono text-white mb-0.5">
          {stream.streamId ? `${stream.streamId.slice(0, 10)}…${stream.streamId.slice(-6)}` : '—'}
        </div>
        <div className="text-xs text-muted">{label}: {short(stream[label === 'To' ? 'recipient' : 'sender'])}</div>
      </div>
      <div className="text-right">
        <div className="text-xs font-mono text-accent">
          {stream.ratePerSecond != null
            ? `${(parseFloat(formatUnits(stream.ratePerSecond, 6)) * 86400).toFixed(2)}/day`
            : '—'}
        </div>
        <div className="text-xs text-muted mt-0.5">View →</div>
      </div>
    </button>
  );
}

export default function Dashboard() {
  const { address }   = useAccount();
  const { profile }   = useProfile(address);
  const navigate      = useNavigate();
  const isCompany     = profile?.role === 'company';

  const { sent, received, loading } = useStreams();
  const { online, data: agentData } = useAgentStatus();

  const streams   = isCompany ? sent : received;
  const streamLabel = isCompany ? 'To' : 'From';

  const shortAddr = address ? `${address.slice(0, 6)}...${address.slice(-4)}` : '';

  const stats = isCompany
    ? [
        { label: 'Streams Created',  value: sent.length || '—' },
        { label: 'Total Deposited',  value: '—' },
        { label: 'Unearned Budget',  value: '—' },
        { label: 'Protocol Fees',    value: '—' },
      ]
    : [
        { label: 'Active Streams',   value: received.length || '—' },
        { label: 'Total Earned',     value: '—' },
        { label: 'Available Now',    value: '—' },
        { label: 'Total Withdrawn',  value: '—' },
      ];

  const actions = isCompany
    ? [
        { label: 'Create Stream', desc: 'Fund a new contractor stream', path: '/app/stream/create', icon: '+' },
        { label: 'Settings',      desc: 'Update profile and chain',     path: '/app/settings',     icon: '⚙' },
      ]
    : [
        { label: 'Withdraw',   desc: 'Claim your earned tokens', path: '/app/withdraw',  icon: '↓' },
        { label: 'Settings',   desc: 'Update your profile',      path: '/app/settings',  icon: '⚙' },
      ];

  return (
    <div className="p-8 max-w-5xl">

      {/* Header */}
      <div className="flex items-start justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold mb-1">
            Welcome back{profile?.name ? `, ${profile.name}` : ''} 👋
          </h1>
          <p className="text-muted text-sm font-mono">{shortAddr}</p>
        </div>
        <AgentStatusBadge online={online} data={agentData} />
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-10">
        {stats.map(({ label, value }) => (
          <div key={label} className="stat-card">
            <div className="stat-value">{value}</div>
            <div className="stat-label">{label}</div>
          </div>
        ))}
      </div>

      {/* Quick actions */}
      <div className="mb-10">
        <h2 className="text-sm font-medium text-muted uppercase tracking-widest mb-4">Quick actions</h2>
        <div className="grid sm:grid-cols-3 gap-4">
          {actions.map(({ label, desc, path, icon }) => (
            <button
              key={label}
              onClick={() => navigate(path)}
              className="card text-left hover:border-accent/40 cursor-pointer transition-colors duration-150 group"
            >
              <div className="font-mono text-accent text-xl mb-3 group-hover:scale-110 transition-transform duration-150">
                {icon}
              </div>
              <div className="font-semibold mb-1 text-sm">{label}</div>
              <div className="text-muted text-xs">{desc}</div>
            </button>
          ))}
        </div>
      </div>

      {/* Stream list */}
      <div>
        <h2 className="text-sm font-medium text-muted uppercase tracking-widest mb-4">
          {isCompany ? 'Streams Created' : 'Incoming Streams'}
        </h2>

        {loading ? (
          <div className="card border-dashed flex items-center justify-center py-12">
            <p className="text-muted text-sm font-mono animate-pulse">Loading streams…</p>
          </div>
        ) : streams.length === 0 ? (
          <div className="card border-dashed flex items-center justify-center py-16 text-center">
            <div>
              <div className="text-4xl mb-3 opacity-30">⬡</div>
              <p className="text-muted text-sm">No streams yet</p>
              {isCompany && (
                <button
                  onClick={() => navigate('/app/stream/create')}
                  className="btn-primary mt-4 text-sm py-2 px-5"
                >
                  Create your first stream
                </button>
              )}
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {streams.map(stream => (
              <StreamRow key={stream.streamId} stream={stream} label={streamLabel} />
            ))}
          </div>
        )}
      </div>

      {/* Agent info panel (only when online) */}
      {online && agentData && (
        <div className="mt-8 card border-accent/10 bg-accent/5">
          <h2 className="text-xs font-medium text-muted uppercase tracking-widest mb-3">Autonomous Agent</h2>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-xs font-mono">
            <div>
              <div className="text-muted mb-1">Extensions served</div>
              <div className="text-white font-semibold">{agentData.extensionsServed ?? 0}</div>
            </div>
            <div>
              <div className="text-muted mb-1">Signer</div>
              <div className="text-accent break-all">{agentData.signer ? `${agentData.signer.slice(0, 10)}…` : '—'}</div>
            </div>
            {agentData.balances && Object.entries(agentData.balances).map(([chain, bal]) => (
              <div key={chain}>
                <div className="text-muted mb-1">{chain} balance</div>
                <div className="text-white">{typeof bal === 'string' ? bal : JSON.stringify(bal)}</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
