import { useState, useEffect, useRef } from 'react';
import { useAuth } from '../context/AuthContext';

const AGENT_URL = import.meta.env.VITE_AGENT_URL ?? 'http://localhost:3000';

export default function RepoPicker({ isConnected, value, onChange }) {
  const { authFetch }  = useAuth();
  const [items,   setItems]   = useState([]);
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState(null);
  const [manual,  setManual]  = useState(false);
  const [query,   setQuery]   = useState('');
  const [open,    setOpen]    = useState(false);
  const wrapperRef = useRef(null);

  useEffect(() => {
    function onDown(e) {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, []);

  useEffect(() => {
    if (!isConnected || manual) return;
    setLoading(true);
    setError(null);
    authFetch(`${AGENT_URL}/api/v1/platforms/github/repos`)
      .then(r => r.json())
      .then(data => {
        setItems(data.items ?? []);
        if (!data.items?.length) setManual(true);
      })
      .catch(err => { setError(err.message); setManual(true); })
      .finally(() => setLoading(false));
  }, [isConnected, manual]);

  const filtered = items.filter(r =>
    !query || r.fullName.toLowerCase().includes(query.toLowerCase()),
  );

  if (!isConnected || manual) {
    return (
      <div className="flex flex-col gap-1.5">
        <input
          value={value}
          onChange={e => onChange(e.target.value)}
          placeholder="owner/repo"
          className="input"
        />
        {!isConnected ? (
          <p className="text-xs text-muted px-1">Connect GitHub in Settings to browse your repos.</p>
        ) : (
          <button type="button" onClick={() => { setError(null); setManual(false); }}
            className="text-xs text-muted hover:text-accent font-mono self-start transition-colors">
            ← Browse connected repos
          </button>
        )}
        {error && <p className="text-[10px] text-red-400 font-mono px-1">{error}</p>}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2" ref={wrapperRef}>
      {value && (
        <div className="flex items-center justify-between bg-dark border border-accent/30 rounded-xl px-4 py-2.5">
          <span className="text-sm font-mono text-white">{value}</span>
          <button type="button" onClick={() => onChange('')}
            className="text-muted hover:text-white text-lg w-5 h-5 flex items-center justify-center">×</button>
        </div>
      )}

      {!value && (
        <div className="relative">
          {loading ? (
            <div className="input flex items-center gap-3 cursor-default">
              <div className="w-4 h-4 shrink-0 border-2 border-accent border-t-transparent rounded-full animate-spin" />
              <span className="text-sm text-muted">Fetching repos…</span>
            </div>
          ) : (
            <input
              value={query}
              onChange={e => { setQuery(e.target.value); setOpen(true); }}
              onFocus={() => filtered.length > 0 && setOpen(true)}
              placeholder="Search repos…"
              className="input"
            />
          )}

          {open && filtered.length > 0 && (
            <div className="absolute top-full left-0 right-0 mt-1 z-50 bg-surface border border-border rounded-xl shadow-lg overflow-y-auto max-h-48">
              {filtered.map(repo => (
                <button
                  key={repo.fullName}
                  type="button"
                  onMouseDown={e => e.preventDefault()}
                  onClick={() => { onChange(repo.fullName); setQuery(''); setOpen(false); }}
                  className="w-full flex items-start justify-between px-4 py-2.5 hover:bg-dark border-b border-border last:border-b-0 text-left transition-colors gap-3"
                >
                  <div className="min-w-0">
                    <div className="font-mono text-sm text-white truncate">{repo.fullName}</div>
                    {repo.description && (
                      <div className="text-xs text-muted truncate mt-0.5">{repo.description}</div>
                    )}
                  </div>
                  <div className="flex items-center gap-2 shrink-0 mt-0.5">
                    {repo.language && <span className="text-xs text-muted font-mono">{repo.language}</span>}
                    {repo.isPrivate && <span className="text-xs text-yellow-400/70 font-mono">private</span>}
                  </div>
                </button>
              ))}
            </div>
          )}

          {items.length === 0 && !loading && (
            <p className="text-xs text-muted px-1 mt-1">No repos found.</p>
          )}
        </div>
      )}

      <button type="button" onClick={() => setManual(true)}
        className="text-xs text-muted hover:text-accent font-mono self-start transition-colors">
        + Enter manually instead
      </button>
    </div>
  );
}
