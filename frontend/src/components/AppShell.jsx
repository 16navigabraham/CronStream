import { Outlet, NavLink, useNavigate } from 'react-router-dom';
import { ConnectButton } from '@rainbow-me/rainbowkit';
import { useAccount } from 'wagmi';
import { useProfile } from '../hooks/useProfile';

const NAV = [
  { to: '/app/dashboard',     label: 'Dashboard',      icon: '⬡' },
  { to: '/app/stream/create', label: 'Create Stream',  icon: '+' },
  { to: '/app/withdraw',      label: 'Withdraw',       icon: '↓' },
  { to: '/app/settings',      label: 'Settings',       icon: '⚙' },
];

export default function AppShell() {
  const { address } = useAccount();
  const { profile } = useProfile(address);
  const navigate = useNavigate();

  return (
    <div className="min-h-screen flex">
      {/* Sidebar */}
      <aside className="w-60 bg-surface border-r border-border flex flex-col shrink-0">
        {/* Logo */}
        <div
          className="px-6 py-5 border-b border-border cursor-pointer"
          onClick={() => navigate('/')}
        >
          <span className="text-accent font-mono font-semibold text-lg tracking-tight">
            CronStream
          </span>
          <span className="text-muted text-xs block mt-0.5">
            {profile?.role === 'company' ? 'Company' : profile?.role === 'contractor' ? 'Contractor' : 'Protocol'}
          </span>
        </div>

        {/* Nav */}
        <nav className="flex-1 px-3 py-4 flex flex-col gap-1">
          {NAV.map(({ to, label, icon }) => (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) =>
                `flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-all duration-150
                ${isActive
                  ? 'bg-accent/10 text-accent font-medium'
                  : 'text-muted hover:text-white hover:bg-border'
                }`
              }
            >
              <span className="font-mono text-base w-4 text-center">{icon}</span>
              {label}
            </NavLink>
          ))}
        </nav>

        {/* Wallet */}
        <div className="px-3 py-4 border-t border-border">
          <ConnectButton
            showBalance={false}
            chainStatus="icon"
            accountStatus="avatar"
          />
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 overflow-y-auto bg-dark">
        <Outlet />
      </main>
    </div>
  );
}
