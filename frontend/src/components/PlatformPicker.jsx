import { useState, useEffect, useRef } from 'react';
import { useAuth } from '../context/AuthContext';

const AGENT_URL = import.meta.env.VITE_AGENT_URL ?? 'http://localhost:3000';

const CONFIG = {
  jira: {
    endpoint:    '/api/v1/platforms/jira/projects',
    placeholder: 'Search Jira projects…',
    manual:      'PROJECT-KEY',
    label:       item => item.name,
    sub:         item => item.key,
    value:       item => item.key,
    notConnected: 'Connect Jira in Settings to browse your projects.',
  },
  bitbucket: {
    endpoint:    '/api/v1/platforms/bitbucket/repos',
    placeholder: 'Search Bitbucket repos…',
    manual:      'workspace/repo-slug',
    label:       item => item.fullName,
    sub:         item => item.language ?? (item.isPrivate ? 'private' : ''),
    value:       item => item.fullName,
    notConnected: 'Connect Bitbucket in Settings to browse your repos.',
  },
  figma: {
    endpoint:    '/api/v1/platforms/figma/files',
    placeholder: 'https://www.figma.com/file/...',
    manual:      'https://www.figma.com/file/...',
    label:       item => item.name,
    sub:         item => item.projectName ?? '',
    value:       item => item.url,
    notConnected: 'Paste your Figma file URL below.',
  },
};

export default function PlatformPicker({ source, value, onChange, isConnected }) {
  const { authFetch }    = useAuth();
  const cfg              = CONFIG[source];
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
    if (!isConnected || manual || !cfg) return;
    setLoading(true);
    setError(null);
    authFetch(`${AGENT_URL}${cfg.endpoint}`)
      .then(r => r.json())
      .then(data => {
        setItems(data.items ?? []);
        if (!data.items?.length) setManual(true);
      })
      .catch(err => { setError(err.message); setManual(true); })
      .finally(() => setLoading(false));
  }, [source, isConnected, manual]);

  if (!cfg) return null;

  const filtered = items.filter(item =>
    !query || cfg.label(item).toLowerCase().includes(query.toLowerCase()),
  );

  // Not connected — show manual input with hint
  if (!isConnected || manual) {
    return (
      <div className="flex flex-col gap-1.5">
        <input
          value={value}
          onChange={e => onChange(e.target.value)}
          placeholder={cfg.manual}
          className="input"
        />
        {!isConnected ? (
          <p className="text-xs text-muted px-1">{cfg.notConnected}</p>
        ) : (
          <button type="button" onClick={() => { setError(null); setManual(false); }}
            className="text-xs text-muted hover:text-accent font-mono self-start transition-colors">
            ← Browse connected {source}
          </button>
        )}
        {error && <p className="text-[10px] text-red-400 font-mono px-1">{error}</p>}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2" ref={wrapperRef}>
      {/* Selected item */}
      {value && (
        <div className="flex items-center justify-between bg-dark border border-accent/30 rounded-xl px-4 py-2.5">
          <span className="text-sm font-mono text-white truncate">{value}</span>
          <button type="button" onClick={() => onChange('')}
            className="text-muted hover:text-white text-lg w-5 h-5 flex items-center justify-center shrink-0">×</button>
        </div>
      )}

      {!value && (
        <div className="relative">
          {loading ? (
            <div className="input flex items-center gap-3 cursor-default">
              <div className="w-4 h-4 shrink-0 border-2 border-accent border-t-transparent rounded-full animate-spin" />
              <span className="text-sm text-muted">Fetching {source}…</span>
            </div>
          ) : (
            <input
              value={query}
              onChange={e => { setQuery(e.target.value); setOpen(true); }}
              onFocus={() => filtered.length > 0 && setOpen(true)}
              placeholder={cfg.placeholder}
              className="input"
            />
          )}

          {open && filtered.length > 0 && (
            <div className="absolute top-full left-0 right-0 mt-1 z-50 bg-surface border border-border rounded-xl shadow-lg overflow-y-auto max-h-48">
              {filtered.map((item, i) => (
                <button
                  key={i}
                  type="button"
                  onMouseDown={e => e.preventDefault()}
                  onClick={() => { onChange(cfg.value(item)); setQuery(''); setOpen(false); }}
                  className="w-full flex items-start justify-between px-4 py-2.5 hover:bg-dark border-b border-border last:border-b-0 text-left transition-colors gap-3"
                >
                  <div className="min-w-0">
                    <div className="font-mono text-sm text-white truncate">{cfg.label(item)}</div>
                    {cfg.sub(item) && (
                      <div className="text-xs text-muted truncate mt-0.5">{cfg.sub(item)}</div>
                    )}
                  </div>
                </button>
              ))}
            </div>
          )}

          {items.length === 0 && !loading && (
            <p className="text-xs text-muted px-1 mt-1">No items found.</p>
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
