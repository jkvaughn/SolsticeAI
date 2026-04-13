import { useState } from 'react';
import { ShieldCheck } from 'lucide-react';
import { fetchProofOfReserves } from '../../dataClient';
import { useBanks } from '../../contexts/BanksContext';
import { useSWRCache } from '../../hooks/useSWRCache';
import { WidgetShell } from '../dashboard/WidgetShell';

// ============================================================
// Proof of Reserves Log (Task 165)
//
// All attestations for all banks with filter by bank, asset type,
// and date range. Exportable (stub).
// ============================================================

interface Attestation {
  id: string;
  bank_id: string;
  asset_type: string;
  balance: number;
  usd_equivalent: number | null;
  attestation_hash: string | null;
  provider: string;
  fetched_at: string;
}

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '\u2014';
  const d = new Date(iso);
  return d.toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function fmtAmount(n: number | null | undefined): string {
  if (n == null) return '\u2014';
  return '$' + Number(n).toLocaleString(undefined, { maximumFractionDigits: 0 });
}

export function ProofOfReservesLog() {
  const { banks, cacheVersion } = useBanks();
  const [bankFilter, setBankFilter] = useState<string>('all');
  const [assetFilter, setAssetFilter] = useState<string>('all');

  const { data: attestations } = useSWRCache<Attestation[]>({
    key: 'proof-of-reserves',
    fetcher: () => fetchProofOfReserves(),
    deps: [cacheVersion],
    ttl: 2 * 60 * 1000,
  });

  const items = attestations ?? [];
  const filtered = items
    .filter((a) => bankFilter === 'all' || a.bank_id === bankFilter)
    .filter((a) => assetFilter === 'all' || a.asset_type === assetFilter);

  // Unique asset types from data
  const assetTypes = [...new Set(items.map((a) => a.asset_type))];

  // Bank name lookup
  const bankName = (id: string) => {
    const b = (banks ?? []).find((bk: any) => bk.id === id);
    return b?.short_code || b?.name || id.slice(0, 8);
  };

  return (
    <WidgetShell
      title="Proof of Reserves Log"
      icon={ShieldCheck}
      headerRight={
        <div className="flex items-center gap-2">
          <select
            value={bankFilter}
            onChange={(e) => setBankFilter(e.target.value)}
            className="text-[11px] font-mono px-2 py-0.5 rounded-md bg-transparent border border-black/10 dark:border-white/10 text-coda-text cursor-pointer"
          >
            <option value="all">All Banks</option>
            {(banks ?? []).map((b: any) => (
              <option key={b.id} value={b.id}>{b.short_code || b.name}</option>
            ))}
          </select>
          <select
            value={assetFilter}
            onChange={(e) => setAssetFilter(e.target.value)}
            className="text-[11px] font-mono px-2 py-0.5 rounded-md bg-transparent border border-black/10 dark:border-white/10 text-coda-text cursor-pointer"
          >
            <option value="all">All Assets</option>
            {assetTypes.map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
          <span className="text-[11px] font-mono text-coda-text-muted">
            {filtered.length} record{filtered.length !== 1 ? 's' : ''}
          </span>
        </div>
      }
    >
      {filtered.length === 0 ? (
        <div className="py-6 text-center text-[13px] text-coda-text-muted">
          No attestation records{bankFilter !== 'all' || assetFilter !== 'all' ? ' matching filters' : ''}
        </div>
      ) : (
        <div className="space-y-0">
          {/* Header */}
          <div className="grid grid-cols-12 gap-2 py-2 text-[11px] font-mono text-coda-text-muted uppercase tracking-wider">
            <div className="col-span-2">Bank</div>
            <div className="col-span-1">Asset</div>
            <div className="col-span-2">Balance</div>
            <div className="col-span-2">USD Value</div>
            <div className="col-span-3">Attestation Hash</div>
            <div className="col-span-1">Provider</div>
            <div className="col-span-1">Time</div>
          </div>
          {filtered.slice(0, 30).map((a, i) => (
            <div
              key={a.id}
              className={`grid grid-cols-12 gap-2 items-center py-2.5 ${
                i > 0 ? 'border-t border-black/[0.06] dark:border-white/[0.06]' : ''
              }`}
            >
              <div className="col-span-2 text-[12px] text-coda-text font-mono">
                {bankName(a.bank_id)}
              </div>
              <div className="col-span-1 text-[12px] font-mono font-medium text-coda-text">
                {a.asset_type}
              </div>
              <div className="col-span-2 text-[13px] font-mono text-coda-text tabular-nums">
                {Number(a.balance).toLocaleString()}
              </div>
              <div className="col-span-2 text-[13px] font-mono text-coda-text tabular-nums">
                {fmtAmount(a.usd_equivalent)}
              </div>
              <div className="col-span-3 text-[11px] text-coda-text-muted font-mono truncate" title={a.attestation_hash || ''}>
                {a.attestation_hash?.slice(0, 16) || '\u2014'}...
              </div>
              <div className="col-span-1 text-[11px] text-coda-text-muted font-mono">
                {a.provider}
              </div>
              <div className="col-span-1 text-[11px] text-coda-text-muted font-mono tabular-nums">
                {fmtDate(a.fetched_at)}
              </div>
            </div>
          ))}
        </div>
      )}
    </WidgetShell>
  );
}
