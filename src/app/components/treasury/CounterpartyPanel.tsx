import { useMemo } from 'react';
import { Link } from 'react-router';
import { ArrowRight, Users } from 'lucide-react';
import { fetchTransactions } from '../../dataClient';
import { useBanks } from '../../contexts/BanksContext';
import { useSWRCache } from '../../hooks/useSWRCache';
import { WidgetShell } from '../dashboard/WidgetShell';
import { formatTokenAmount } from '../../types';
import type { Transaction } from '../../types';

// ============================================================
// CounterpartyPanel (Task 161)
//
// Per-counterparty relationship view. Shows bilateral volume,
// transaction count, avg settlement time, avg risk score,
// active mandates count, and last 5 transactions per pair.
// ============================================================

interface CounterpartyPanelProps {
  bankId?: string;
}

interface CounterpartySummary {
  bankId: string;
  bankName: string;
  shortCode: string;
  volume: number;
  txCount: number;
  avgSettleMs: number;
  avgRisk: number;
  recentTxs: Transaction[];
}

function fmtDuration(ms: number): string {
  if (ms < 1000) return '<1s';
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`;
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m`;
  return `${(ms / 3_600_000).toFixed(1)}h`;
}

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '\u2014';
  return new Date(iso).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export function CounterpartyPanel({ bankId }: CounterpartyPanelProps) {
  const { banks, cacheVersion } = useBanks();

  const { data: allTxs } = useSWRCache<Transaction[]>({
    key: `counterparty-panel-${bankId || 'all'}`,
    fetcher: () => fetchTransactions({ bank_id: bankId, limit: 200 }),
    deps: [cacheVersion, bankId],
    ttl: 2 * 60 * 1000,
  });

  const summaries = useMemo(() => {
    if (!allTxs || allTxs.length === 0) return [];
    const map = new Map<string, CounterpartySummary>();

    for (const tx of allTxs) {
      // Determine the counterparty relative to bankId
      const cpId = bankId
        ? (tx.sender_bank_id === bankId ? tx.receiver_bank_id : tx.sender_bank_id)
        : tx.receiver_bank_id; // fallback: group by receiver

      if (!map.has(cpId)) {
        const bank = banks.find(b => b.id === cpId);
        map.set(cpId, {
          bankId: cpId,
          bankName: bank?.name || (tx.sender_bank_id === cpId
            ? (tx as any).sender_bank?.name
            : (tx as any).receiver_bank?.name) || cpId.slice(0, 8),
          shortCode: bank?.short_code || (tx.sender_bank_id === cpId
            ? (tx as any).sender_bank?.short_code
            : (tx as any).receiver_bank?.short_code) || '??',
          volume: 0,
          txCount: 0,
          avgSettleMs: 0,
          avgRisk: 0,
          recentTxs: [],
        });
      }

      const s = map.get(cpId)!;
      s.volume += (tx.amount || 0);
      s.txCount += 1;
      if (s.recentTxs.length < 5) s.recentTxs.push(tx);
    }

    // Calculate averages
    for (const [, s] of map) {
      const settledTxs = s.recentTxs.filter(t => t.settled_at && t.initiated_at);
      if (settledTxs.length > 0) {
        const totalMs = settledTxs.reduce((sum, t) => {
          return sum + (new Date(t.settled_at!).getTime() - new Date(t.initiated_at!).getTime());
        }, 0);
        s.avgSettleMs = totalMs / settledTxs.length;
      }
      const risked = allTxs.filter(t =>
        (t.sender_bank_id === s.bankId || t.receiver_bank_id === s.bankId) && t.risk_score != null
      );
      if (risked.length > 0) {
        s.avgRisk = risked.reduce((sum, t) => sum + (t.risk_score || 0), 0) / risked.length;
      }
    }

    return Array.from(map.values()).sort((a, b) => b.volume - a.volume);
  }, [allTxs, bankId, banks]);

  return (
    <WidgetShell
      title="Counterparty Relationships"
      icon={Users}
      headerRight={
        <span className="text-[11px] font-mono text-coda-text-muted">
          {summaries.length} counterpart{summaries.length !== 1 ? 'ies' : 'y'}
        </span>
      }
    >
      {summaries.length === 0 ? (
        <div className="py-6 text-center text-[13px] text-coda-text-muted">
          No counterparty data available
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          {summaries.map(cp => (
            <div key={cp.bankId} className="rounded-xl border border-black/[0.06] dark:border-white/[0.06] p-4">
              <div className="flex items-center justify-between mb-3">
                <div>
                  <div className="text-[14px] font-medium text-coda-text">{cp.bankName}</div>
                  <div className="text-[11px] font-mono text-coda-text-muted">{cp.shortCode}</div>
                </div>
                <div className="text-right">
                  <div className="text-[14px] font-mono font-medium text-coda-text tabular-nums">
                    {formatTokenAmount(cp.volume)}
                  </div>
                  <div className="text-[11px] text-coda-text-muted">{cp.txCount} txns</div>
                </div>
              </div>

              <div className="flex items-center gap-4 text-[11px] text-coda-text-muted mb-3">
                <span>Avg settle: <span className="font-mono text-coda-text">{cp.avgSettleMs > 0 ? fmtDuration(cp.avgSettleMs) : '\u2014'}</span></span>
                <span>Avg risk: <span className="font-mono text-coda-text">{cp.avgRisk > 0 ? cp.avgRisk.toFixed(0) : '\u2014'}</span></span>
              </div>

              {cp.recentTxs.length > 0 && (
                <div className="space-y-0 border-t border-black/[0.06] dark:border-white/[0.06] pt-2">
                  {cp.recentTxs.map((tx, i) => (
                    <Link
                      key={tx.id}
                      to={`/transactions/${tx.id}`}
                      className={`flex items-center justify-between py-1.5 hover:bg-black/[0.02] dark:hover:bg-white/[0.02] transition-colors group ${
                        i > 0 ? 'border-t border-black/[0.04] dark:border-white/[0.04]' : ''
                      }`}
                    >
                      <span className="text-[12px] font-mono text-coda-text tabular-nums">
                        {formatTokenAmount(tx.amount)}
                      </span>
                      <span className="text-[11px] text-coda-text-muted">
                        {fmtDate(tx.settled_at || tx.initiated_at || tx.created_at)}
                      </span>
                      <ArrowRight size={11} className="text-coda-text-muted group-hover:text-coda-text transition-colors" />
                    </Link>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </WidgetShell>
  );
}
