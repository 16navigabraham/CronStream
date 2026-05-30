/**
 * StreamStatementPDF
 *
 * Generates a CronStream payroll / income statement for a given month + year.
 * Used by both company (payroll disbursement) and contractor (income statement).
 *
 * @react-pdf/renderer renders this server-side in a Web Worker — no DOM APIs.
 */
import {
  Document, Page, Text, View, Image, StyleSheet, Font,
} from '@react-pdf/renderer';
import { formatUnits } from 'viem';

const MONTH_NAMES = [
  'January','February','March','April','May','June',
  'July','August','September','October','November','December',
];

const CHAIN_NAMES = {
  421614: 'Arbitrum Sepolia',
  42161:  'Arbitrum One',
  1:      'Ethereum Mainnet',
};

const TOKEN_LABELS = {
  '0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d': 'USDC',
  '0x2Ca6e6FbAA8D0Bc27a64Ca079aFa6bf5cc8C7ad1': 'CRM',
};

function tokenSymbol(addr) {
  return TOKEN_LABELS[addr] ?? (addr ? addr.slice(0, 6) + '…' : '?');
}

function fmt(bigintVal, decimals = 6, places = 4) {
  if (bigintVal == null) return '0.0000';
  return parseFloat(formatUnits(bigintVal, decimals)).toFixed(places);
}

function shortAddr(addr) {
  return addr ? `${addr.slice(0, 8)}…${addr.slice(-6)}` : '-';
}

function fmtDate(ts) {
  if (!ts || ts === 0n) return '-';
  return new Date(Number(ts) * 1000).toLocaleDateString('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric',
  });
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const C = {
  dark:    '#0A0B0F',
  surface: '#111318',
  border:  '#1E2028',
  accent:  '#00D4AA',
  muted:   '#6B7280',
  white:   '#F9FAFB',
  yellow:  '#EAB308',
};

const s = StyleSheet.create({
  page: {
    backgroundColor: C.dark,
    color: C.white,
    fontFamily: 'Helvetica',
    padding: 40,
    fontSize: 9,
  },

  // Header
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 28 },
  logo:   { width: 32, height: 32, borderRadius: 8 },
  headerRight: { alignItems: 'flex-end' },
  docTitle: { fontSize: 16, fontFamily: 'Helvetica-Bold', color: C.white, marginBottom: 2 },
  docSub:   { fontSize: 9, color: C.muted },

  // Info grid
  infoGrid: { flexDirection: 'row', gap: 12, marginBottom: 24 },
  infoCard: {
    flex: 1, backgroundColor: C.surface,
    borderRadius: 8, padding: 12,
    border: `1px solid ${C.border}`,
  },
  infoLabel: { fontSize: 7, color: C.muted, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 4 },
  infoValue: { fontSize: 10, fontFamily: 'Helvetica-Bold', color: C.white },
  infoSub:   { fontSize: 8, color: C.muted, marginTop: 2 },

  // Period banner
  periodBanner: {
    backgroundColor: C.surface, borderRadius: 8, padding: '10 14',
    border: `1px solid ${C.border}`, marginBottom: 20,
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
  },
  periodLabel: { fontSize: 7, color: C.muted, textTransform: 'uppercase', letterSpacing: 1 },
  periodValue: { fontSize: 13, fontFamily: 'Helvetica-Bold', color: C.accent, marginTop: 2 },
  generatedAt: { fontSize: 7, color: C.muted },

  // Table
  tableHeader: {
    flexDirection: 'row', backgroundColor: C.surface,
    borderRadius: '6 6 0 0', padding: '7 10',
    border: `1px solid ${C.border}`, borderBottom: 0,
  },
  tableRow: {
    flexDirection: 'row', padding: '9 10',
    borderLeft: `1px solid ${C.border}`,
    borderRight: `1px solid ${C.border}`,
    borderBottom: `1px solid ${C.border}`,
  },
  tableRowAlt: {
    backgroundColor: '#0E1015',
  },
  thText: { fontSize: 7, color: C.muted, textTransform: 'uppercase', letterSpacing: 0.8, fontFamily: 'Helvetica-Bold' },
  tdText: { fontSize: 8, color: C.white },
  tdMono: { fontSize: 8, color: C.muted, fontFamily: 'Helvetica' },
  tdAccent: { fontSize: 8, color: C.accent, fontFamily: 'Helvetica-Bold' },

  // Column widths
  colCounterparty: { flex: 2 },
  colStream:       { flex: 1.6 },
  colPeriod:       { flex: 2 },
  colRate:         { flex: 1.2 },
  colAmount:       { flex: 1.2, alignItems: 'flex-end' },

  // Summary
  summaryBox: {
    backgroundColor: C.surface, borderRadius: 8,
    border: `1px solid ${C.border}`, padding: 14, marginTop: 20,
  },
  summaryTitle: { fontSize: 8, color: C.muted, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 10 },
  summaryRow:   { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6 },
  summaryLabel: { fontSize: 9, color: C.muted },
  summaryValue: { fontSize: 10, fontFamily: 'Helvetica-Bold', color: C.white },
  summaryTotal: {
    flexDirection: 'row', justifyContent: 'space-between',
    borderTop: `1px solid ${C.border}`, paddingTop: 8, marginTop: 4,
  },
  summaryTotalLabel: { fontSize: 10, fontFamily: 'Helvetica-Bold', color: C.white },
  summaryTotalValue: { fontSize: 12, fontFamily: 'Helvetica-Bold', color: C.accent },

  // Status badge
  badgeActive:  { fontSize: 7, color: C.accent,  backgroundColor: '#00D4AA15', borderRadius: 4, padding: '2 5' },
  badgePending: { fontSize: 7, color: C.yellow,  backgroundColor: '#EAB30815', borderRadius: 4, padding: '2 5' },
  badgeEnded:   { fontSize: 7, color: C.muted,   backgroundColor: '#1E202820', borderRadius: 4, padding: '2 5' },

  // Footer
  footer: {
    marginTop: 28, paddingTop: 12,
    borderTop: `1px solid ${C.border}`,
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
  },
  footerLeft:  { fontSize: 7, color: C.muted },
  footerRight: { fontSize: 7, color: C.muted, textAlign: 'right' },
  footerAccent: { color: C.accent },

  // Empty state
  emptyBox: {
    alignItems: 'center', padding: 40,
    backgroundColor: C.surface, borderRadius: 8,
    border: `1px solid ${C.border}`,
  },
  emptyText: { fontSize: 10, color: C.muted },
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

function streamStatus(stream, nowSec) {
  const until = Number(stream.streamValidUntil ?? 0n);
  const start = Number(stream.startTime ?? 0n);
  if (until > nowSec) return 'active';
  if (start > 0 && until <= start) return 'pending';
  return 'ended';
}

function StatusBadge({ status }) {
  const style = status === 'active' ? s.badgeActive
    : status === 'pending' ? s.badgePending
    : s.badgeEnded;
  const label = status === 'active' ? 'Active'
    : status === 'pending' ? 'Pending'
    : 'Ended';
  return <Text style={style}>{label}</Text>;
}

// Filter streams active during the selected month
function filterByMonth(streams, year, month) {
  const start = new Date(year, month, 1).getTime() / 1000;       // start of month
  const end   = new Date(year, month + 1, 0, 23, 59, 59).getTime() / 1000; // end of month

  return streams.filter(s => {
    const sStart = Number(s.startTime ?? 0n);
    const sUntil = Number(s.streamValidUntil ?? 0n);
    // Include if stream overlaps the month at all
    // Either started before month end AND (still active OR ended after month start)
    if (sStart === 0) return false;
    if (sStart > end) return false;
    if (sUntil > 0 && sUntil < start) return false;
    return true;
  });
}

// Group amounts by token symbol
function sumByToken(streams, field) {
  const totals = {};
  for (const s of streams) {
    const sym = tokenSymbol(s.token);
    const val = parseFloat(fmt(s[field] ?? 0n));
    totals[sym] = (totals[sym] ?? 0) + val;
  }
  return totals;
}

// ─── Table row ────────────────────────────────────────────────────────────────

function StreamRow({ stream, role, index, nowSec, counterpartyName }) {
  const status     = streamStatus(stream, nowSec);
  const sym        = tokenSymbol(stream.token);
  const ratePerDay = parseFloat(formatUnits(stream.ratePerSecond ?? 0n, 6)) * 86400;
  const amount     = role === 'company'
    ? fmt(stream.totalWithdrawn ?? 0n)  // paid out
    : fmt(stream.totalWithdrawn ?? 0n); // received

  const periodStart = fmtDate(stream.startTime);
  const periodEnd   = stream.streamValidUntil && stream.streamValidUntil > stream.startTime
    ? fmtDate(stream.streamValidUntil)
    : status === 'active' ? 'Ongoing' : '-';

  return (
    <View style={[s.tableRow, index % 2 === 1 ? s.tableRowAlt : {}]}>
      <View style={s.colCounterparty}>
        <Text style={s.tdText}>{counterpartyName}</Text>
        <StatusBadge status={status} />
      </View>
      <View style={s.colStream}>
        <Text style={s.tdMono}>{stream.streamId ? stream.streamId.slice(0, 10) + '…' : '-'}</Text>
      </View>
      <View style={s.colPeriod}>
        <Text style={s.tdMono}>{periodStart} – {periodEnd}</Text>
      </View>
      <View style={s.colRate}>
        <Text style={s.tdMono}>{ratePerDay.toFixed(2)} {sym}/day</Text>
      </View>
      <View style={s.colAmount}>
        <Text style={s.tdAccent}>{amount}</Text>
        <Text style={[s.tdMono, { fontSize: 7 }]}>{sym}</Text>
      </View>
    </View>
  );
}

// ─── Document ─────────────────────────────────────────────────────────────────

export function StreamStatementDocument({
  streams,        // enriched stream objects
  role,           // 'company' | 'contractor'
  month,          // 0-indexed month
  year,
  ownerName,      // display name of the logged-in user
  ownerAddress,
  counterpartyNames, // Map<address, string>
  logoUrl,        // absolute URL or data URL for the logo
}) {
  const nowSec    = Math.floor(Date.now() / 1000);
  const filtered  = filterByMonth(streams, year, month);
  const monthName = MONTH_NAMES[month];
  const isCompany = role === 'company';

  const docTitle   = isCompany ? 'Payroll Disbursement Statement' : 'Income Statement';
  const partyLabel = isCompany ? 'Company' : 'Contractor';
  const amountLabel = isCompany ? 'Total Paid' : 'Total Received';
  const counterpartyLabel = isCompany ? 'Contractor' : 'Company';

  const totals       = sumByToken(filtered, 'totalWithdrawn');
  const totalEntries = Object.entries(totals);
  const generatedAt  = new Date().toLocaleString('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });

  const chainName = filtered[0]?.chainId
    ? (CHAIN_NAMES[filtered[0].chainId] ?? `Chain ${filtered[0].chainId}`)
    : 'Arbitrum Sepolia';

  return (
    <Document
      title={`CronStream ${docTitle} – ${monthName} ${year}`}
      author="CronStream Protocol"
      subject={`${partyLabel} payment statement`}
    >
      <Page size="A4" style={s.page}>

        {/* ── Header ─────────────────────────────────────────────────────── */}
        <View style={s.header}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            {logoUrl && <Image src={logoUrl} style={s.logo} />}
            <View>
              <Text style={{ fontSize: 13, fontFamily: 'Helvetica-Bold', color: C.accent }}>CronStream</Text>
              <Text style={{ fontSize: 8, color: C.muted }}>Protocol Infrastructure</Text>
            </View>
          </View>
          <View style={s.headerRight}>
            <Text style={s.docTitle}>{docTitle}</Text>
            <Text style={s.docSub}>Generated {generatedAt}</Text>
          </View>
        </View>

        {/* ── Period + entity info ────────────────────────────────────────── */}
        <View style={s.periodBanner}>
          <View>
            <Text style={s.periodLabel}>Statement Period</Text>
            <Text style={s.periodValue}>{monthName} {year}</Text>
          </View>
          <View style={{ alignItems: 'flex-end' }}>
            <Text style={s.generatedAt}>Network: {chainName}</Text>
            <Text style={[s.generatedAt, { marginTop: 2 }]}>Document ref: CS-{year}{String(month + 1).padStart(2, '0')}-{ownerAddress?.slice(2, 8).toUpperCase()}</Text>
          </View>
        </View>

        <View style={s.infoGrid}>
          <View style={s.infoCard}>
            <Text style={s.infoLabel}>{partyLabel}</Text>
            <Text style={s.infoValue}>{ownerName || shortAddr(ownerAddress)}</Text>
            <Text style={s.infoSub}>{shortAddr(ownerAddress)}</Text>
          </View>
          <View style={s.infoCard}>
            <Text style={s.infoLabel}>Streams this period</Text>
            <Text style={s.infoValue}>{filtered.length}</Text>
            <Text style={s.infoSub}>{streams.length} total all time</Text>
          </View>
          {totalEntries.slice(0, 1).map(([sym, val]) => (
            <View key={sym} style={s.infoCard}>
              <Text style={s.infoLabel}>{amountLabel} ({sym})</Text>
              <Text style={[s.infoValue, { color: C.accent }]}>{val.toFixed(4)}</Text>
              <Text style={s.infoSub}>{sym} · milestone-verified</Text>
            </View>
          ))}
        </View>

        {/* ── Table ──────────────────────────────────────────────────────── */}
        <View style={s.tableHeader}>
          <Text style={[s.thText, s.colCounterparty]}>{counterpartyLabel}</Text>
          <Text style={[s.thText, s.colStream]}>Stream ID</Text>
          <Text style={[s.thText, s.colPeriod]}>Period</Text>
          <Text style={[s.thText, s.colRate]}>Rate</Text>
          <Text style={[s.thText, s.colAmount, { textAlign: 'right' }]}>{amountLabel}</Text>
        </View>

        {filtered.length === 0 ? (
          <View style={s.emptyBox}>
            <Text style={s.emptyText}>No streams active during {monthName} {year}</Text>
          </View>
        ) : (
          filtered.map((stream, i) => {
            const cpAddr = isCompany ? stream.recipient : stream.sender;
            const cpName = counterpartyNames?.[cpAddr?.toLowerCase()] ?? shortAddr(cpAddr);
            return (
              <StreamRow
                key={stream.streamId}
                stream={stream}
                role={role}
                index={i}
                nowSec={nowSec}
                counterpartyName={cpName}
              />
            );
          })
        )}

        {/* ── Summary ────────────────────────────────────────────────────── */}
        {filtered.length > 0 && (
          <View style={s.summaryBox}>
            <Text style={s.summaryTitle}>Summary</Text>
            {totalEntries.map(([sym, val]) => (
              <View key={sym} style={s.summaryRow}>
                <Text style={s.summaryLabel}>{amountLabel} · {sym}</Text>
                <Text style={s.summaryValue}>{val.toFixed(4)} {sym}</Text>
              </View>
            ))}
            <View style={s.summaryRow}>
              <Text style={s.summaryLabel}>Active streams</Text>
              <Text style={s.summaryValue}>{filtered.filter(s => streamStatus(s, nowSec) === 'active').length}</Text>
            </View>
            <View style={s.summaryRow}>
              <Text style={s.summaryLabel}>Completed streams</Text>
              <Text style={s.summaryValue}>{filtered.filter(s => streamStatus(s, nowSec) === 'ended').length}</Text>
            </View>
            {totalEntries.length > 0 && (
              <View style={s.summaryTotal}>
                <Text style={s.summaryTotalLabel}>Total · {monthName} {year}</Text>
                <Text style={s.summaryTotalValue}>
                  {totalEntries.map(([sym, val]) => `${val.toFixed(4)} ${sym}`).join('  +  ')}
                </Text>
              </View>
            )}
          </View>
        )}

        {/* ── Footer ─────────────────────────────────────────────────────── */}
        <View style={s.footer}>
          <View style={s.footerLeft}>
            <Text>This document is generated by <Text style={s.footerAccent}>CronStream Protocol</Text> and reflects</Text>
            <Text>on-chain verified milestone payments. All figures are auditable on {chainName}.</Text>
          </View>
          <View style={s.footerRight}>
            <Text>cronstream.xyz</Text>
            <Text style={{ marginTop: 2, color: C.muted }}>Not financial advice. Verify on-chain.</Text>
          </View>
        </View>

      </Page>
    </Document>
  );
}
