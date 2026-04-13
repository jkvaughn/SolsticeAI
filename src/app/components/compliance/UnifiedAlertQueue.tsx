import { useState } from 'react';
import { Bell, CheckCircle } from 'lucide-react';
import { fetchUnifiedAlerts } from '../../dataClient';
import { callServer } from '../../supabaseClient';
import { useBanks } from '../../contexts/BanksContext';
import { useSWRCache } from '../../hooks/useSWRCache';
import { WidgetShell } from '../dashboard/WidgetShell';

// ============================================================
// Unified Alert Queue (Task 164)
//
// Merged queue combining Cadenza flags, external alerts, and
// compliance filing alerts. Filterable by source with resolve action.
// ============================================================

type SourceFilter = 'all' | 'cadenza' | 'external' | 'filing';

interface UnifiedAlert {
  id: string;
  source: 'cadenza' | 'external' | 'filing';
  source_id: string | null;
  alert_type: string;
  severity: string;
  title: string;
  description: string | null;
  transaction_id: string | null;
  bank_id: string | null;
  resolved: boolean;
  resolved_by: string | null;
  resolved_at: string | null;
  created_at: string;
}

const SOURCE_STYLES: Record<string, { label: string; color: string; bg: string }> = {
  cadenza:  { label: 'Cadenza',  color: 'text-purple-500 dark:text-purple-400', bg: 'bg-purple-500/15' },
  external: { label: 'External', color: 'text-sky-500 dark:text-sky-400', bg: 'bg-sky-500/15' },
  filing:   { label: 'Filing',   color: 'text-orange-500 dark:text-orange-400', bg: 'bg-orange-500/15' },
};

const SEVERITY_STYLES: Record<string, { color: string; bg: string }> = {
  critical: { color: 'text-red-500 dark:text-red-400', bg: 'bg-red-500/15' },
  high:     { color: 'text-orange-500 dark:text-orange-400', bg: 'bg-orange-500/15' },
  medium:   { color: 'text-amber-600 dark:text-amber-400', bg: 'bg-amber-500/15' },
  low:      { color: 'text-gray-500 dark:text-gray-400', bg: 'bg-gray-500/15' },
};

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '\u2014';
  const d = new Date(iso);
  return d.toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export function UnifiedAlertQueue() {
  const { cacheVersion } = useBanks();
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>('all');
  const [resolving, setResolving] = useState<string | null>(null);

  const { data: alerts, invalidate } = useSWRCache<UnifiedAlert[]>({
    key: 'unified-alerts',
    fetcher: () => fetchUnifiedAlerts({ resolved: false }),
    deps: [cacheVersion],
    ttl: 2 * 60 * 1000,
  });

  const items = alerts ?? [];
  const filtered = sourceFilter === 'all'
    ? items
    : items.filter((a) => a.source === sourceFilter);

  async function handleResolve(id: string) {
    setResolving(id);
    try {
      await callServer(`/unified-alerts/${id}/resolve`, { resolved_by: 'operator' });
      invalidate();
    } catch (err) {
      console.error('Failed to resolve alert:', err);
    } finally {
      setResolving(null);
    }
  }

  return (
    <WidgetShell
      title="Unified Alert Queue"
      icon={Bell}
      headerRight={
        <div className="flex items-center gap-2">
          {(['all', 'cadenza', 'external', 'filing'] as SourceFilter[]).map((src) => (
            <button
              key={src}
              onClick={() => setSourceFilter(src)}
              className={`text-[11px] font-mono px-2 py-0.5 rounded-md transition-colors cursor-pointer ${
                sourceFilter === src
                  ? 'bg-black/10 dark:bg-white/10 text-coda-text'
                  : 'text-coda-text-muted hover:text-coda-text'
              }`}
            >
              {src === 'all' ? 'All' : src.charAt(0).toUpperCase() + src.slice(1)}
            </button>
          ))}
          <span className="text-[11px] font-mono text-coda-text-muted ml-1">
            {filtered.length} alert{filtered.length !== 1 ? 's' : ''}
          </span>
        </div>
      }
    >
      {filtered.length === 0 ? (
        <div className="py-6 text-center text-[13px] text-coda-text-muted">
          No active alerts{sourceFilter !== 'all' ? ` from ${sourceFilter}` : ''}
        </div>
      ) : (
        <div className="space-y-0">
          {/* Header */}
          <div className="grid grid-cols-12 gap-2 py-2 text-[11px] font-mono text-coda-text-muted uppercase tracking-wider">
            <div className="col-span-1">Source</div>
            <div className="col-span-2">Alert Type</div>
            <div className="col-span-1">Severity</div>
            <div className="col-span-3">Title</div>
            <div className="col-span-2">Transaction</div>
            <div className="col-span-2">Time</div>
            <div className="col-span-1">Actions</div>
          </div>
          {filtered.slice(0, 20).map((a, i) => {
            const srcStyle = SOURCE_STYLES[a.source] ?? SOURCE_STYLES.external;
            const sevStyle = SEVERITY_STYLES[a.severity] ?? SEVERITY_STYLES.medium;
            const isResolving = resolving === a.id;
            return (
              <div
                key={a.id}
                className={`grid grid-cols-12 gap-2 items-center py-2.5 ${
                  i > 0 ? 'border-t border-black/[0.06] dark:border-white/[0.06]' : ''
                }`}
              >
                <div className="col-span-1">
                  <span className={`inline-flex items-center px-1.5 py-0.5 text-[10px] font-mono rounded ${srcStyle.bg} ${srcStyle.color}`}>
                    {srcStyle.label}
                  </span>
                </div>
                <div className="col-span-2 text-[12px] text-coda-text font-mono truncate">
                  {a.alert_type}
                </div>
                <div className="col-span-1">
                  <span className={`inline-flex items-center px-1.5 py-0.5 text-[10px] font-mono rounded ${sevStyle.bg} ${sevStyle.color}`}>
                    {a.severity}
                  </span>
                </div>
                <div className="col-span-3 text-[12px] text-coda-text truncate">
                  {a.title}
                </div>
                <div className="col-span-2 text-[12px] text-coda-text-muted font-mono truncate">
                  {a.transaction_id?.slice(0, 8) || '\u2014'}
                </div>
                <div className="col-span-2 text-[12px] text-coda-text-muted font-mono tabular-nums">
                  {fmtDate(a.created_at)}
                </div>
                <div className="col-span-1">
                  <button
                    onClick={() => handleResolve(a.id)}
                    disabled={isResolving}
                    className="inline-flex items-center gap-1 px-2 py-1 text-[11px] font-mono rounded-md bg-emerald-500/15 text-emerald-500 dark:text-emerald-400 hover:bg-emerald-500/25 transition-colors cursor-pointer disabled:opacity-50"
                  >
                    <CheckCircle size={11} /> Resolve
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </WidgetShell>
  );
}
