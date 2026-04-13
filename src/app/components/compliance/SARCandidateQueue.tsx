import { Link } from 'react-router';
import { ArrowRight, FileWarning } from 'lucide-react';
import { fetchTransactions, fetchCadenzaFlags } from '../../dataClient';
import type { Transaction } from '../../types';
import { formatTokenAmount, RISK_LEVEL_CONFIG } from '../../types';
import { useBanks } from '../../contexts/BanksContext';
import { useSWRCache } from '../../hooks/useSWRCache';
import { WidgetShell } from '../dashboard/WidgetShell';

// ============================================================
// SAR Candidate Queue (Task 167)
//
// Auto-surfaced transactions meeting SAR threshold:
// risk_score > 70 OR cadenza_flags with severity='critical'.
// ============================================================

interface SARCandidate {
  tx: Transaction;
  flags: string[];
  score: number;
}

async function fetchSARData(): Promise<SARCandidate[]> {
  const [txs, flags] = await Promise.all([
    fetchTransactions({ limit: 200 }).catch(() => []),
    fetchCadenzaFlags().catch(() => []),
  ]);

  // Build flag map: txId -> flag types
  const flagMap: Record<string, string[]> = {};
  (flags ?? []).forEach((f: any) => {
    if (f.severity === 'critical' && f.transaction_id) {
      if (!flagMap[f.transaction_id]) flagMap[f.transaction_id] = [];
      flagMap[f.transaction_id].push(f.flag_type || f.type || 'Critical');
    }
  });

  // Candidates: risk_score > 70 OR has critical flag
  const candidates: SARCandidate[] = [];
  (txs ?? []).forEach((tx: Transaction) => {
    const score = tx.risk_score ?? (tx.risk_level === 'high' ? 80 : 0);
    const txFlags = flagMap[tx.id] || [];
    if (score > 70 || txFlags.length > 0) {
      candidates.push({ tx, flags: txFlags, score });
    }
  });

  return candidates.sort((a, b) => b.score - a.score);
}

function routeLabel(tx: any): string {
  const sender = tx.sender_bank?.short_code || tx.sender_bank_id?.slice(0, 4) || '??';
  const receiver = tx.receiver_bank?.short_code || tx.receiver_bank_id?.slice(0, 4) || '??';
  return `${sender} \u2192 ${receiver}`;
}

export function SARCandidateQueue() {
  const { cacheVersion } = useBanks();

  const { data: candidates } = useSWRCache<SARCandidate[]>({
    key: 'sar-candidates',
    fetcher: fetchSARData,
    deps: [cacheVersion],
    ttl: 3 * 60 * 1000,
  });

  const list = candidates ?? [];

  return (
    <WidgetShell
      title="SAR Candidate Queue"
      icon={FileWarning}
      headerRight={
        <div className="flex items-center gap-2">
          <span className="text-[11px] font-mono text-coda-text-muted">
            {list.length} candidate{list.length !== 1 ? 's' : ''}
          </span>
          <button
            onClick={() => {
              // Stub: show toast
              alert('FinCEN export not yet implemented. SAR filing will be generated in a future update.');
            }}
            className="text-[11px] font-mono text-coda-brand hover:text-coda-brand/80 transition-colors cursor-pointer"
          >
            Export to FinCEN
          </button>
        </div>
      }
    >
      {list.length === 0 ? (
        <div className="py-6 text-center text-[13px] text-coda-text-muted">
          No SAR candidates at this time
        </div>
      ) : (
        <div className="space-y-0">
          {/* Header */}
          <div className="grid grid-cols-12 gap-2 py-2 text-[11px] font-mono text-coda-text-muted uppercase tracking-wider">
            <div className="col-span-2">Amount</div>
            <div className="col-span-2">Route</div>
            <div className="col-span-2">Risk Score</div>
            <div className="col-span-3">Flags</div>
            <div className="col-span-2">Status</div>
            <div className="col-span-1" />
          </div>

          {list.slice(0, 15).map((c, i) => {
            const riskCfg = c.tx.risk_level ? RISK_LEVEL_CONFIG[c.tx.risk_level as keyof typeof RISK_LEVEL_CONFIG] : null;
            return (
              <Link
                key={c.tx.id}
                to={`/transactions/${c.tx.id}`}
                className={`grid grid-cols-12 gap-2 items-center py-2.5 hover:bg-black/[0.02] dark:hover:bg-white/[0.02] transition-colors group ${
                  i > 0 ? 'border-t border-black/[0.06] dark:border-white/[0.06]' : ''
                }`}
              >
                <div className="col-span-2 text-[13px] font-mono font-medium text-coda-text tabular-nums">
                  {formatTokenAmount(c.tx.amount)}
                </div>
                <div className="col-span-2 text-[12px] text-coda-text-secondary">
                  {routeLabel(c.tx)}
                </div>
                <div className="col-span-2">
                  <span className={`text-[13px] font-mono font-bold tabular-nums ${
                    c.score > 80 ? 'text-red-500' : c.score > 70 ? 'text-amber-500' : 'text-coda-text'
                  }`}>
                    {c.score}
                  </span>
                </div>
                <div className="col-span-3 flex flex-wrap gap-1">
                  {c.flags.length > 0 ? (
                    c.flags.slice(0, 2).map((f, fi) => (
                      <span key={fi} className="inline-flex px-1.5 py-0.5 text-[10px] font-mono rounded bg-red-500/15 text-red-500 dark:text-red-400">
                        {f}
                      </span>
                    ))
                  ) : (
                    <span className="text-[11px] text-coda-text-muted">High score</span>
                  )}
                </div>
                <div className="col-span-2">
                  {riskCfg && (
                    <span className={`inline-flex px-1.5 py-0.5 text-[10px] font-mono rounded ${riskCfg.bg} ${riskCfg.color}`}>
                      {riskCfg.label}
                    </span>
                  )}
                </div>
                <div className="col-span-1 flex justify-end">
                  <ArrowRight size={13} className="text-coda-text-muted group-hover:text-coda-text transition-colors" />
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </WidgetShell>
  );
}
