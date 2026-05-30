import { useState, useCallback } from 'react';
import { pdf } from '@react-pdf/renderer';
import { Download, Loader2 } from 'lucide-react';
import { StreamStatementDocument } from './StreamStatementPDF';
import { fetchFromServer } from '../hooks/useProfile';

const MONTH_NAMES = [
  'January','February','March','April','May','June',
  'July','August','September','October','November','December',
];

const LOGO_URL = `${window.location.origin}/cronstream.png`;

// Resolve display names for a list of addresses in parallel
async function resolveNames(addresses) {
  const unique = [...new Set(addresses.filter(Boolean).map(a => a.toLowerCase()))];
  const results = await Promise.allSettled(unique.map(addr => fetchFromServer(addr)));
  const map = {};
  unique.forEach((addr, i) => {
    const p = results[i].status === 'fulfilled' ? results[i].value : null;
    map[addr] = p?.name ?? p?.username ?? null;
  });
  return map;
}

export default function DownloadStatement({ streams, role, ownerName, ownerAddress }) {
  const now = new Date();
  const [month,      setMonth]      = useState(now.getMonth());
  const [year,       setYear]       = useState(now.getFullYear());
  const [generating, setGenerating] = useState(false);

  const years = [];
  for (let y = now.getFullYear(); y >= now.getFullYear() - 3; y--) years.push(y);

  const handleDownload = useCallback(async () => {
    setGenerating(true);
    try {
      // Resolve counterparty display names
      const addrs = streams.map(s => (role === 'company' ? s.recipient : s.sender));
      const counterpartyNames = await resolveNames(addrs);

      const doc = (
        <StreamStatementDocument
          streams={streams}
          role={role}
          month={month}
          year={year}
          ownerName={ownerName}
          ownerAddress={ownerAddress}
          counterpartyNames={counterpartyNames}
          logoUrl={LOGO_URL}
        />
      );

      const blob     = await pdf(doc).toBlob();
      const url      = URL.createObjectURL(blob);
      const a        = document.createElement('a');
      a.href         = url;
      a.download     = `cronstream-${role === 'company' ? 'payroll' : 'income'}-${year}-${String(month + 1).padStart(2, '0')}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error('PDF generation failed:', err);
    } finally {
      setGenerating(false);
    }
  }, [streams, role, month, year, ownerName, ownerAddress]);

  return (
    <div className="flex items-center gap-2">
      {/* Month */}
      <select
        value={month}
        onChange={e => setMonth(Number(e.target.value))}
        className="bg-surface border border-border rounded-lg px-2 py-1.5 text-xs text-white focus:outline-none focus:border-accent/50 cursor-pointer"
      >
        {MONTH_NAMES.map((m, i) => (
          <option key={m} value={i}>{m}</option>
        ))}
      </select>

      {/* Year */}
      <select
        value={year}
        onChange={e => setYear(Number(e.target.value))}
        className="bg-surface border border-border rounded-lg px-2 py-1.5 text-xs text-white focus:outline-none focus:border-accent/50 cursor-pointer"
      >
        {years.map(y => (
          <option key={y} value={y}>{y}</option>
        ))}
      </select>

      {/* Download */}
      <button
        onClick={handleDownload}
        disabled={generating || !streams.length}
        className="flex items-center gap-1.5 btn-outline py-1.5 px-3 text-xs disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {generating
          ? <><Loader2 size={12} className="animate-spin" /> Generating…</>
          : <><Download size={12} /> Export PDF</>
        }
      </button>
    </div>
  );
}
