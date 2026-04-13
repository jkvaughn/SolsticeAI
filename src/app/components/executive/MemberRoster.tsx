import { useState, useMemo } from 'react';
import { Users, ArrowUpDown } from 'lucide-react';
import { useBanks } from '../../contexts/BanksContext';
import { useSWRCache } from '../../hooks/useSWRCache';
import { fetchTransactions } from '../../dataClient';
import type { Transaction, Bank } from '../../types';
import { formatTokenAmount } from '../../types';
import { WidgetShell } from '../dashboard/WidgetShell';

// ============================================================
// Member Roster (Task 166)
//
// Sortable table of all consortium member banks with status,
// tier, jurisdiction, volume, and activity metadata.
// ============================================================

type SortField = 'name' | 'short_code' | 'status' | 'tier' | 'jurisdiction' | 'volume' | 'last_activity' | 'created_at';
type SortDir = 'asc' | 'desc';

interface MemberRow {
  bank: Bank;
  volume: number;
  lastActivity: string | null;
}

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '\u2014';
  const d = new Date(iso);
  return d.toLocaleDateString([], { month: 'short', day: 'numeric', year: '2-digit' });
}

const STATUS_STYLES: Record<string, string> = {
  active: 'bg-emerald-500/15 text-emerald-500 dark:text-emerald-400',
  suspended: 'bg-red-500/15 text-red-500 dark:text-red-400',
  pending: 'bg-amber-500/15 text-amber-600 dark:text-amber-400',
};

const TIER_STYLES: Record<string, string> = {
  'tier-1': 'bg-blue-500/15 text-blue-500 dark:text-blue-400',
  'tier-2': 'bg-purple-500/15 text-purple-500 dark:text-purple-400',
  'tier-3': 'bg-gray-500/15 text-gray-500 dark:text-gray-400',
};

export function MemberRoster() {
  const { activeBanks: banks, cacheVersion } = useBanks();
  const [sortField, setSortField] = useState<SortField>('name');
  const [sortDir, setSortDir] = useState<SortDir>('asc');

  const { data: txs } = useSWRCache<Transaction[]>({
    key: 'member-roster-txs',
    fetcher: () => fetchTransactions({ limit: 200 }),
    deps: [cacheVersion],
    ttl: 5 * 60 * 1000,
  });

  const rows = useMemo<MemberRow[]>(() => {
    const txList = txs ?? [];
    return banks.map((bank) => {
      const bankTxs = txList.filter(
        (t) => t.sender_bank_id === bank.id || t.receiver_bank_id === bank.id
      );
      const volume = bankTxs.reduce((sum, t) => sum + (t.amount || 0), 0);
      const lastTx = bankTxs.sort(
        (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      )[0];
      return { bank, volume, lastActivity: lastTx?.created_at ?? null };
    });
  }, [banks, txs]);

  const sorted = useMemo(() => {
    const copy = [...rows];
    copy.sort((a, b) => {
      let cmp = 0;
      switch (sortField) {
        case 'name': cmp = a.bank.name.localeCompare(b.bank.name); break;
        case 'short_code': cmp = a.bank.short_code.localeCompare(b.bank.short_code); break;
        case 'status': cmp = (a.bank.status || '').localeCompare(b.bank.status || ''); break;
        case 'tier': cmp = (a.bank.tier || '').localeCompare(b.bank.tier || ''); break;
        case 'jurisdiction': cmp = (a.bank.jurisdiction || '').localeCompare(b.bank.jurisdiction || ''); break;
        case 'volume': cmp = a.volume - b.volume; break;
        case 'last_activity': cmp = (a.lastActivity || '').localeCompare(b.lastActivity || ''); break;
        case 'created_at': cmp = a.bank.created_at.localeCompare(b.bank.created_at); break;
      }
      return sortDir === 'asc' ? cmp : -cmp;
    });
    return copy;
  }, [rows, sortField, sortDir]);

  const toggleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortField(field);
      setSortDir('asc');
    }
  };

  const cols: { field: SortField; label: string; span: number }[] = [
    { field: 'name', label: 'Name', span: 3 },
    { field: 'short_code', label: 'Code', span: 1 },
    { field: 'status', label: 'Status', span: 1 },
    { field: 'tier', label: 'Tier', span: 1 },
    { field: 'jurisdiction', label: 'Jurisdiction', span: 2 },
    { field: 'volume', label: 'Volume', span: 2 },
    { field: 'last_activity', label: 'Last Activity', span: 1 },
    { field: 'created_at', label: 'Joined', span: 1 },
  ];

  return (
    <WidgetShell title="Member Roster" icon={Users}>
      <div className="overflow-x-auto">
        {/* Header */}
        <div className="grid grid-cols-12 gap-2 py-2 text-[11px] font-mono text-coda-text-muted uppercase tracking-wider">
          {cols.map((col) => (
            <button
              key={col.field}
              onClick={() => toggleSort(col.field)}
              className={`col-span-${col.span} flex items-center gap-1 cursor-pointer hover:text-coda-text transition-colors text-left`}
            >
              {col.label}
              {sortField === col.field && (
                <ArrowUpDown size={10} className="text-coda-text" />
              )}
            </button>
          ))}
        </div>

        {/* Rows */}
        {sorted.length === 0 ? (
          <div className="py-6 text-center text-[13px] text-coda-text-muted">No members</div>
        ) : (
          sorted.map((row, i) => {
            const statusStyle = STATUS_STYLES[row.bank.status] ?? STATUS_STYLES.active;
            const tierKey = (row.bank.tier || 'tier-1').toLowerCase().replace(' ', '-');
            const tierStyle = TIER_STYLES[tierKey] ?? TIER_STYLES['tier-1'];
            return (
              <div
                key={row.bank.id}
                className={`grid grid-cols-12 gap-2 items-center py-2.5 ${
                  i > 0 ? 'border-t border-black/[0.06] dark:border-white/[0.06]' : ''
                }`}
              >
                <div className="col-span-3 text-[13px] text-coda-text truncate">{row.bank.name}</div>
                <div className="col-span-1 text-[12px] font-mono text-coda-text-secondary">{row.bank.short_code}</div>
                <div className="col-span-1">
                  <span className={`inline-flex px-1.5 py-0.5 text-[10px] font-mono rounded ${statusStyle}`}>
                    {row.bank.status || 'Active'}
                  </span>
                </div>
                <div className="col-span-1">
                  <span className={`inline-flex px-1.5 py-0.5 text-[10px] font-mono rounded ${tierStyle}`}>
                    {row.bank.tier || 'Tier 1'}
                  </span>
                </div>
                <div className="col-span-2 text-[12px] text-coda-text-muted truncate">{row.bank.jurisdiction || '\u2014'}</div>
                <div className="col-span-2 text-[13px] font-mono text-coda-text tabular-nums">{formatTokenAmount(row.volume)}</div>
                <div className="col-span-1 text-[11px] font-mono text-coda-text-muted tabular-nums">{fmtDate(row.lastActivity)}</div>
                <div className="col-span-1 text-[11px] font-mono text-coda-text-muted tabular-nums">{fmtDate(row.bank.created_at)}</div>
              </div>
            );
          })
        )}
      </div>
    </WidgetShell>
  );
}
