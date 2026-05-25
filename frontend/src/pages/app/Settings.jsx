import { useState } from 'react';
import { useAccount } from 'wagmi';
import { useProfile } from '../../hooks/useProfile';

export default function Settings() {
  const { address } = useAccount();
  const { profile, saveProfile } = useProfile(address);

  const [form, setForm]     = useState({
    name:    profile?.name    ?? '',
    github:  profile?.github  ?? '',
    website: profile?.website ?? '',
    role:    profile?.role    ?? '',
  });
  const [saved, setSaved] = useState(false);

  function handleChange(e) {
    setForm(f => ({ ...f, [e.target.name]: e.target.value }));
  }

  function handleSubmit(e) {
    e.preventDefault();
    saveProfile(form);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  return (
    <div className="p-8 max-w-lg">
      <h1 className="text-2xl font-bold mb-1">Settings</h1>
      <p className="text-muted text-sm mb-8">Update your profile and preferences.</p>

      <form onSubmit={handleSubmit} className="flex flex-col gap-6">
        {/* Profile */}
        <div className="card flex flex-col gap-5">
          <h2 className="text-xs font-medium text-muted uppercase tracking-widest">Profile</h2>

          <div>
            <label className="label">Role</label>
            <select name="role" value={form.role} onChange={handleChange} className="input">
              <option value="">Select role</option>
              <option value="company">Company</option>
              <option value="contractor">Contractor</option>
            </select>
          </div>

          <div>
            <label className="label">{form.role === 'company' ? 'Company name' : 'Your name'}</label>
            <input name="name" value={form.name} onChange={handleChange} className="input" placeholder="Name" />
          </div>

          <div>
            <label className="label">GitHub {form.role === 'company' ? 'organisation' : 'username'}</label>
            <input name="github" value={form.github} onChange={handleChange} className="input" placeholder="github-handle" />
          </div>

          {form.role === 'company' && (
            <div>
              <label className="label">Website</label>
              <input name="website" value={form.website} onChange={handleChange} className="input" placeholder="https://..." />
            </div>
          )}
        </div>

        {/* Wallet */}
        <div className="card flex flex-col gap-3">
          <h2 className="text-xs font-medium text-muted uppercase tracking-widest">Wallet</h2>
          <div>
            <label className="label">Connected address</label>
            <div className="input text-muted select-all cursor-default text-xs">{address}</div>
          </div>
        </div>

        {/* Contract */}
        <div className="card flex flex-col gap-3">
          <h2 className="text-xs font-medium text-muted uppercase tracking-widest">Contract</h2>
          <div className="flex flex-col gap-2 text-xs font-mono text-muted">
            <div className="flex justify-between">
              <span>Arbitrum Sepolia</span>
              <span className="badge-active">421614</span>
            </div>
            <div className="flex justify-between">
              <span>Robinhood Chain</span>
              <span className="badge-active">46630</span>
            </div>
            <div className="mt-2 text-muted break-all">
              0x3feb14d164EaA05a85e0276321E4F090a03549f9
            </div>
          </div>
        </div>

        <button type="submit" className="btn-primary w-full text-center">
          {saved ? '✓ Saved' : 'Save Changes'}
        </button>
      </form>
    </div>
  );
}
