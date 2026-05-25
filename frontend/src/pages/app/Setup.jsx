import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAccount } from 'wagmi';
import { useProfile } from '../../hooks/useProfile';

export default function Setup() {
  const navigate = useNavigate();
  const { address } = useAccount();
  const { saveProfile } = useProfile(address);

  const [role, setRole]       = useState(null); // 'company' | 'contractor'
  const [form, setForm]       = useState({ name: '', github: '', website: '' });
  const [loading, setLoading] = useState(false);

  function handleChange(e) {
    setForm(f => ({ ...f, [e.target.name]: e.target.value }));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (!role || !form.name) return;
    setLoading(true);
    saveProfile({ role, ...form });
    navigate('/app/dashboard', { replace: true });
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-6">
      <div className="max-w-lg w-full">
        <h1 className="text-2xl font-bold mb-1">Set up your profile</h1>
        <p className="text-muted text-sm mb-8">Tell us how you'll use CronStream.</p>

        {/* Role picker */}
        <div className="grid grid-cols-2 gap-4 mb-8">
          {[
            { value: 'company',    icon: '🏢', title: 'Company',    desc: 'Create streams and pay contractors' },
            { value: 'contractor', icon: '💻', title: 'Contractor', desc: 'Receive streams and withdraw earnings' },
          ].map(({ value, icon, title, desc }) => (
            <button
              key={value}
              type="button"
              onClick={() => setRole(value)}
              className={`card text-left transition-all duration-200 cursor-pointer
                ${role === value
                  ? 'border-accent bg-accent/5'
                  : 'hover:border-accent/40'
                }`}
            >
              <div className="text-2xl mb-3">{icon}</div>
              <div className="font-semibold mb-1">{title}</div>
              <div className="text-muted text-xs leading-relaxed">{desc}</div>
            </button>
          ))}
        </div>

        {/* Form */}
        {role && (
          <form onSubmit={handleSubmit} className="card flex flex-col gap-5">
            <div>
              <label className="label">
                {role === 'company' ? 'Company name' : 'Your name'}
              </label>
              <input
                name="name"
                value={form.name}
                onChange={handleChange}
                placeholder={role === 'company' ? 'Acme Corp' : 'Alex Johnson'}
                className="input"
                required
              />
            </div>

            <div>
              <label className="label">GitHub {role === 'company' ? 'organisation' : 'username'}</label>
              <input
                name="github"
                value={form.github}
                onChange={handleChange}
                placeholder={role === 'company' ? 'acme-org' : 'alexj'}
                className="input"
              />
            </div>

            {role === 'company' && (
              <div>
                <label className="label">Website</label>
                <input
                  name="website"
                  value={form.website}
                  onChange={handleChange}
                  placeholder="https://acme.com"
                  className="input"
                />
              </div>
            )}

            <button
              type="submit"
              disabled={loading || !form.name}
              className="btn-primary w-full text-center disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? 'Saving...' : 'Continue to Dashboard'}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
