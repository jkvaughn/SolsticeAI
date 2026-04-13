import { useState, useCallback } from 'react';
import { Play, Loader2, BarChart3, ArrowRight } from 'lucide-react';
import { callServer } from '../../supabaseClient';
import { evaluateRules, type RiskRule, type RuleContext } from '../../../../supabase/functions/server/risk-engine';

// ============================================================
// RuleSimulation — Simulate impact of rule changes on recent txs
// (Task 163 — Hybrid Scoring UI)
// ============================================================

interface RuleSimulationProps {
  rules: RiskRule[];
}

interface SimResult {
  currentDist: number[];
  projectedDist: number[];
  deltaFlagged: number;
  totalTxs: number;
}

const DEFAULT_WEIGHTS = { counterparty: 0.25, jurisdiction: 0.25, asset_type: 0.25, behavioral: 0.25 };

// Score buckets: 0-20, 20-40, 40-60, 60-80, 80-100
const BUCKET_LABELS = ['0-20', '20-40', '40-60', '60-80', '80-100'];
const BUCKET_COLORS_CURRENT   = ['bg-emerald-500/60', 'bg-emerald-500/40', 'bg-amber-500/40', 'bg-amber-500/60', 'bg-red-500/50'];
const BUCKET_COLORS_PROJECTED = ['bg-emerald-500/80', 'bg-emerald-500/60', 'bg-amber-500/60', 'bg-amber-500/80', 'bg-red-500/70'];

function toBucket(score: number): number {
  if (score < 20) return 0;
  if (score < 40) return 1;
  if (score < 60) return 2;
  if (score < 80) return 3;
  return 4;
}

// Build a synthetic RuleContext from a transaction row
function txToContext(tx: any): RuleContext {
  return {
    amount: Number(tx.amount ?? 0),
    purposeCode: tx.purpose_code ?? 'PAY',
    senderJurisdiction: tx.sender_jurisdiction ?? tx.sender_bank?.jurisdiction ?? 'US',
    receiverJurisdiction: tx.receiver_jurisdiction ?? tx.receiver_bank?.jurisdiction ?? 'US',
    senderTier: tx.sender_tier ?? tx.sender_bank?.tier ?? 'tier1',
    receiverTier: tx.receiver_tier ?? tx.receiver_bank?.tier ?? 'tier1',
    receiverStatus: tx.receiver_status ?? tx.receiver_bank?.status ?? 'active',
    corridorHistoryCount: tx.corridor_history_count ?? 10,
    corridorAvgAmount: tx.corridor_avg_amount ?? Number(tx.amount ?? 1_000_000),
    senderTxCount60m: tx.sender_tx_count_60m ?? 1,
    senderTxBelow10k24h: tx.sender_tx_below_10k_24h ?? 0,
    uniqueCounterparties30m: tx.unique_counterparties_30m ?? 1,
    watchlistMatch: tx.watchlist_match ?? false,
    purposeCodeApproved: tx.purpose_code_approved ?? true,
  };
}

export function RuleSimulation({ rules }: RuleSimulationProps) {
  const [simResult, setSimResult] = useState<SimResult | null>(null);
  const [running, setRunning] = useState(false);

  const runSimulation = useCallback(async () => {
    setRunning(true);
    try {
      // Fetch recent transactions
      const txRes = await callServer<any[]>('/data/transactions?limit=50');
      const txs = Array.isArray(txRes) ? txRes : (txRes as any)?.transactions ?? [];
      if (txs.length === 0) {
        setSimResult({ currentDist: [0,0,0,0,0], projectedDist: [0,0,0,0,0], deltaFlagged: 0, totalTxs: 0 });
        return;
      }

      // "Current" = only active rules; "Projected" = all rules as-is (includes toggled state)
      const activeOnly = rules.filter(r => r.active);
      const currentDist = [0,0,0,0,0];
      const projectedDist = [0,0,0,0,0];
      let currentFlagged = 0;
      let projectedFlagged = 0;

      for (const tx of txs) {
        const ctx = txToContext(tx);
        const curResult = evaluateRules(ctx, activeOnly, DEFAULT_WEIGHTS);
        const projResult = evaluateRules(ctx, rules, DEFAULT_WEIGHTS);

        currentDist[toBucket(curResult.floor_score)]++;
        projectedDist[toBucket(projResult.floor_score)]++;

        if (curResult.floor_score >= 40) currentFlagged++;
        if (projResult.floor_score >= 40) projectedFlagged++;
      }

      setSimResult({
        currentDist,
        projectedDist,
        deltaFlagged: projectedFlagged - currentFlagged,
        totalTxs: txs.length,
      });
    } catch (err) {
      console.error('[RuleSimulation] error:', err);
    } finally {
      setRunning(false);
    }
  }, [rules]);

  const maxCount = simResult
    ? Math.max(1, ...simResult.currentDist, ...simResult.projectedDist)
    : 1;

  return (
    <div className="mt-3 p-4 rounded-xl border border-coda-border bg-black/[0.01] dark:bg-white/[0.01] space-y-4">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-coda-text flex items-center gap-1.5">
          <BarChart3 size={14} />
          Impact Simulation
        </span>
        <button
          onClick={runSimulation}
          disabled={running}
          className="flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-medium bg-coda-brand/10 text-coda-brand hover:bg-coda-brand/20 transition-colors disabled:opacity-40"
        >
          {running ? <Loader2 size={12} className="animate-spin" /> : <Play size={12} />}
          Run Simulation
        </button>
      </div>

      {simResult && (
        <div className="space-y-3">
          {/* Bar comparison */}
          <div className="grid grid-cols-5 gap-2">
            {BUCKET_LABELS.map((label, i) => (
              <div key={label} className="space-y-1">
                <div className="text-[9px] font-mono text-coda-text-muted text-center">{label}</div>
                <div className="flex gap-0.5 h-20 items-end justify-center">
                  {/* Current */}
                  <div className="w-3 flex flex-col justify-end">
                    <div
                      className={`${BUCKET_COLORS_CURRENT[i]} rounded-t-sm transition-all`}
                      style={{ height: `${(simResult.currentDist[i] / maxCount) * 100}%`, minHeight: simResult.currentDist[i] > 0 ? '4px' : '0' }}
                    />
                  </div>
                  {/* Projected */}
                  <div className="w-3 flex flex-col justify-end">
                    <div
                      className={`${BUCKET_COLORS_PROJECTED[i]} rounded-t-sm transition-all border border-white/20`}
                      style={{ height: `${(simResult.projectedDist[i] / maxCount) * 100}%`, minHeight: simResult.projectedDist[i] > 0 ? '4px' : '0' }}
                    />
                  </div>
                </div>
                <div className="flex gap-0.5 justify-center text-[8px] font-mono text-coda-text-muted">
                  <span>{simResult.currentDist[i]}</span>
                  <ArrowRight size={8} />
                  <span>{simResult.projectedDist[i]}</span>
                </div>
              </div>
            ))}
          </div>

          {/* Legend */}
          <div className="flex items-center gap-4 text-[10px] text-coda-text-muted">
            <span className="flex items-center gap-1">
              <span className="w-2 h-2 rounded-sm bg-emerald-500/50" /> Current
            </span>
            <span className="flex items-center gap-1">
              <span className="w-2 h-2 rounded-sm bg-emerald-500/80 border border-white/20" /> Projected
            </span>
          </div>

          {/* Delta summary */}
          <div className={`text-xs font-mono p-2 rounded-lg ${
            simResult.deltaFlagged > 0
              ? 'bg-amber-500/10 text-amber-600 dark:text-amber-400'
              : simResult.deltaFlagged < 0
                ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                : 'bg-black/[0.02] dark:bg-white/[0.02] text-coda-text-muted'
          }`}>
            {simResult.deltaFlagged === 0
              ? `No change across ${simResult.totalTxs} recent transactions`
              : simResult.deltaFlagged > 0
                ? `This change would have flagged ${simResult.deltaFlagged} additional transaction${simResult.deltaFlagged > 1 ? 's' : ''} out of ${simResult.totalTxs}`
                : `This change would have cleared ${Math.abs(simResult.deltaFlagged)} transaction${Math.abs(simResult.deltaFlagged) > 1 ? 's' : ''} from flagging out of ${simResult.totalTxs}`
            }
          </div>
        </div>
      )}
    </div>
  );
}
