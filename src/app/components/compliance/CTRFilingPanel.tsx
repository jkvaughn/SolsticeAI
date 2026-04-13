import { useState } from 'react';
import { FileCheck, Eye, Send, X } from 'lucide-react';
import { fetchComplianceFilings } from '../../dataClient';
import { callServer } from '../../supabaseClient';
import { useBanks } from '../../contexts/BanksContext';
import { useSWRCache } from '../../hooks/useSWRCache';
import { WidgetShell } from '../dashboard/WidgetShell';
import type { ComplianceFiling } from './IComplianceFiling';

// ============================================================
// CTR Filing Panel (Task 164)
//
// Shows compliance filings (CTR, SAR candidates) with a status
// pipeline: auto_generated -> under_review -> filed / dismissed.
// Auto-trigger display for transactions >= $10,000.
// ============================================================

const STATUS_STYLES: Record<string, { label: string; color: string; bg: string }> = {
  auto_generated: { label: 'Auto-Generated', color: 'text-blue-500 dark:text-blue-400', bg: 'bg-blue-500/15' },
  under_review:   { label: 'Under Review',   color: 'text-amber-600 dark:text-amber-400', bg: 'bg-amber-500/15' },
  filed:          { label: 'Filed',           color: 'text-emerald-500 dark:text-emerald-400', bg: 'bg-emerald-500/15' },
  dismissed:      { label: 'Dismissed',       color: 'text-gray-500 dark:text-gray-400', bg: 'bg-gray-500/15' },
};

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '\u2014';
  const d = new Date(iso);
  return d.toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function fmtAmount(n: number | null | undefined): string {
  if (n == null) return '\u2014';
  return '$' + Number(n).toLocaleString(undefined, { maximumFractionDigits: 0 });
}

export function CTRFilingPanel() {
  const { cacheVersion } = useBanks();
  const [updating, setUpdating] = useState<string | null>(null);

  const { data: filings, invalidate } = useSWRCache<ComplianceFiling[]>({
    key: 'compliance-filings',
    fetcher: () => fetchComplianceFilings(),
    deps: [cacheVersion],
    ttl: 2 * 60 * 1000,
  });

  const items = filings ?? [];

  async function handleReview(id: string, status: 'under_review' | 'filed' | 'dismissed') {
    setUpdating(id);
    try {
      await callServer(`/compliance-filings/${id}/review`, { status, filed_by: 'operator' });
      invalidate();
    } catch (err) {
      console.error('Failed to update filing:', err);
    } finally {
      setUpdating(null);
    }
  }

  return (
    <WidgetShell
      title="CTR / SAR Filings"
      icon={FileCheck}
      headerRight={
        <div className="flex items-center gap-2">
          <span className="text-[11px] font-mono text-coda-text-muted">
            {items.length} filing{items.length !== 1 ? 's' : ''}
          </span>
          <span className="text-[10px] text-blue-400 font-mono px-2 py-0.5 rounded bg-blue-500/10">
            CTR auto-generated for transactions &ge;$10,000
          </span>
        </div>
      }
    >
      {items.length === 0 ? (
        <div className="py-6 text-center text-[13px] text-coda-text-muted">
          No compliance filings
        </div>
      ) : (
        <div className="space-y-0">
          {/* Header */}
          <div className="grid grid-cols-12 gap-2 py-2 text-[11px] font-mono text-coda-text-muted uppercase tracking-wider">
            <div className="col-span-1">Type</div>
            <div className="col-span-2">Transaction</div>
            <div className="col-span-2">Amount</div>
            <div className="col-span-2">Trigger Reason</div>
            <div className="col-span-2">Status</div>
            <div className="col-span-1">Filed By</div>
            <div className="col-span-2">Actions</div>
          </div>
          {items.slice(0, 20).map((f, i) => {
            const st = STATUS_STYLES[f.status] ?? STATUS_STYLES.auto_generated;
            const isUpdating = updating === f.id;
            return (
              <div
                key={f.id}
                className={`grid grid-cols-12 gap-2 items-center py-2.5 ${
                  i > 0 ? 'border-t border-black/[0.06] dark:border-white/[0.06]' : ''
                }`}
              >
                <div className="col-span-1">
                  <span className="text-[12px] font-mono font-medium text-coda-text">
                    {f.filing_type}
                  </span>
                </div>
                <div className="col-span-2 text-[12px] text-coda-text-muted font-mono truncate">
                  {f.transaction_id?.slice(0, 8) || '\u2014'}
                </div>
                <div className="col-span-2 text-[13px] font-mono text-coda-text tabular-nums">
                  {fmtAmount(f.amount)}
                </div>
                <div className="col-span-2 text-[12px] text-coda-text-muted truncate">
                  {f.trigger_reason || '\u2014'}
                </div>
                <div className="col-span-2">
                  <span className={`inline-flex items-center px-2 py-0.5 text-[11px] font-mono rounded-md ${st.bg} ${st.color}`}>
                    {st.label}
                  </span>
                </div>
                <div className="col-span-1 text-[12px] text-coda-text-muted truncate">
                  {f.filed_by || '\u2014'}
                </div>
                <div className="col-span-2 flex items-center gap-1">
                  {f.status === 'auto_generated' && (
                    <button
                      onClick={() => handleReview(f.id, 'under_review')}
                      disabled={isUpdating}
                      className="inline-flex items-center gap-1 px-2 py-1 text-[11px] font-mono rounded-md bg-amber-500/15 text-amber-600 dark:text-amber-400 hover:bg-amber-500/25 transition-colors cursor-pointer disabled:opacity-50"
                    >
                      <Eye size={11} /> Review
                    </button>
                  )}
                  {f.status === 'under_review' && (
                    <>
                      <button
                        onClick={() => handleReview(f.id, 'filed')}
                        disabled={isUpdating}
                        className="inline-flex items-center gap-1 px-2 py-1 text-[11px] font-mono rounded-md bg-emerald-500/15 text-emerald-500 dark:text-emerald-400 hover:bg-emerald-500/25 transition-colors cursor-pointer disabled:opacity-50"
                      >
                        <Send size={11} /> File
                      </button>
                      <button
                        onClick={() => handleReview(f.id, 'dismissed')}
                        disabled={isUpdating}
                        className="inline-flex items-center gap-1 px-2 py-1 text-[11px] font-mono rounded-md bg-gray-500/15 text-gray-500 dark:text-gray-400 hover:bg-gray-500/25 transition-colors cursor-pointer disabled:opacity-50"
                      >
                        <X size={11} />
                      </button>
                    </>
                  )}
                  {(f.status === 'filed' || f.status === 'dismissed') && (
                    <span className="text-[11px] text-coda-text-muted font-mono">
                      {fmtDate(f.filed_at || f.created_at)}
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </WidgetShell>
  );
}
