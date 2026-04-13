import { Shield, Brain, UserCheck, Gauge } from 'lucide-react';

// ============================================================
// FermataExplainer (Task 162)
//
// 3-layer risk score explainer for any transaction:
//   Layer 1: Deterministic Floor — rules fired, scores per dimension
//   Layer 2: Fermata LLM Adjustment — what Fermata changed and why
//   Layer 3: Override (if any) — who applied, reason, amount
//
// Visual: stacked waterfall showing floor -> adjustment -> final
// ============================================================

interface FermataExplainerProps {
  riskScore: {
    composite_score?: number;
    floor_score?: number;
    counterparty_score?: number;
    jurisdiction_score?: number;
    asset_type_score?: number;
    behavioral_score?: number;
    rules_fired?: string[];
    hard_overrides?: string[];
    risk_level?: string;
    reasoning?: string;
    finality_recommendation?: string;
    override_by?: string;
    override_reason?: string;
    override_amount?: number;
    [key: string]: any;
  } | null;
}

// ── Waterfall bar segment ──
function WaterfallSegment({ label, value, maxValue, color, startOffset = 0 }: {
  label: string;
  value: number;
  maxValue: number;
  color: string;
  startOffset?: number;
}) {
  const widthPct = maxValue > 0 ? Math.abs(value) / maxValue * 100 : 0;
  const offsetPct = maxValue > 0 ? startOffset / maxValue * 100 : 0;
  return (
    <div className="flex items-center gap-2 text-[11px]">
      <span className="w-28 text-coda-text-muted font-mono truncate">{label}</span>
      <div className="flex-1 h-3 rounded-full bg-black/[0.04] dark:bg-white/[0.06] overflow-hidden relative">
        <div
          className={`h-full rounded-full transition-all ${color}`}
          style={{ width: `${Math.min(widthPct, 100)}%`, marginLeft: `${Math.min(offsetPct, 100 - widthPct)}%` }}
        />
      </div>
      <span className="w-8 text-right font-mono text-coda-text tabular-nums">{value}</span>
    </div>
  );
}

// ── Dimension score row ──
function DimensionRow({ label, score }: { label: string; score: number }) {
  const color = score >= 70 ? 'text-emerald-500' : score >= 40 ? 'text-amber-500' : 'text-red-500';
  return (
    <div className="flex items-center justify-between py-1">
      <span className="text-[11px] text-coda-text-muted">{label}</span>
      <div className="flex items-center gap-2">
        <div className="w-16 h-1.5 rounded-full bg-black/[0.04] dark:bg-white/[0.06] overflow-hidden">
          <div
            className={`h-full rounded-full ${score >= 70 ? 'bg-emerald-500' : score >= 40 ? 'bg-amber-500' : 'bg-red-500'}`}
            style={{ width: `${score}%` }}
          />
        </div>
        <span className={`text-[11px] font-mono tabular-nums ${color}`}>{score}</span>
      </div>
    </div>
  );
}

export function FermataExplainer({ riskScore }: FermataExplainerProps) {
  if (!riskScore) {
    return (
      <div className="py-4 text-center">
        <Gauge className="w-5 h-5 text-coda-text-muted mx-auto mb-2" />
        <p className="text-[12px] text-coda-text-muted">Risk score not yet available</p>
      </div>
    );
  }

  const floor = riskScore.floor_score ?? 0;
  const composite = riskScore.composite_score ?? 0;
  const llmAdjustment = composite - floor - (riskScore.override_amount ?? 0);
  const overrideAmount = riskScore.override_amount ?? 0;
  const maxVal = Math.max(composite, 100);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 mb-1">
        <Gauge size={14} className="text-coda-text-muted" />
        <span className="text-[12px] font-mono font-semibold text-coda-text">Risk Score Explainer</span>
        <span className={`ml-auto px-2 py-0.5 rounded-full text-[10px] font-mono font-bold ${
          composite >= 70 ? 'bg-emerald-500/15 text-emerald-500' : composite >= 40 ? 'bg-amber-500/15 text-amber-500' : 'bg-red-500/15 text-red-500'
        }`}>
          {composite}/100
        </span>
      </div>

      {/* ── Waterfall visualization ── */}
      <div className="space-y-1.5">
        <WaterfallSegment label="Floor" value={floor} maxValue={maxVal} color="bg-blue-500/60" />
        <WaterfallSegment label="LLM Adjust" value={llmAdjustment} maxValue={maxVal} color={llmAdjustment >= 0 ? 'bg-emerald-500/60' : 'bg-red-500/60'} startOffset={floor} />
        {overrideAmount !== 0 && (
          <WaterfallSegment label="Override" value={overrideAmount} maxValue={maxVal} color="bg-purple-500/60" startOffset={floor + llmAdjustment} />
        )}
        <WaterfallSegment label="Final" value={composite} maxValue={maxVal} color={composite >= 70 ? 'bg-emerald-500' : composite >= 40 ? 'bg-amber-500' : 'bg-red-500'} />
      </div>

      {/* ── Layer 1: Deterministic Floor ── */}
      <div className="pt-3 border-t border-black/[0.06] dark:border-white/[0.06]">
        <div className="flex items-center gap-2 mb-2">
          <Shield size={12} className="text-blue-500" />
          <span className="text-[11px] font-mono font-semibold text-coda-text">Layer 1: Deterministic Floor</span>
          <span className="ml-auto text-[11px] font-mono font-bold text-coda-text tabular-nums">{floor}</span>
        </div>
        <div className="ml-5 space-y-0">
          <DimensionRow label="Counterparty" score={riskScore.counterparty_score ?? 0} />
          <DimensionRow label="Jurisdiction" score={riskScore.jurisdiction_score ?? 0} />
          <DimensionRow label="Asset Type" score={riskScore.asset_type_score ?? 0} />
          <DimensionRow label="Behavioral" score={riskScore.behavioral_score ?? 0} />
        </div>
        {(riskScore.rules_fired?.length ?? 0) > 0 && (
          <div className="ml-5 mt-2">
            <span className="text-[10px] text-coda-text-muted">Rules fired:</span>
            <div className="flex flex-wrap gap-1 mt-1">
              {riskScore.rules_fired!.map((r: string) => (
                <span key={r} className="px-1.5 py-0.5 rounded text-[9px] font-mono bg-amber-500/10 text-amber-600 dark:text-amber-400">{r}</span>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* ── Layer 2: Fermata LLM Adjustment ── */}
      <div className="pt-3 border-t border-black/[0.06] dark:border-white/[0.06]">
        <div className="flex items-center gap-2 mb-2">
          <Brain size={12} className="text-emerald-500" />
          <span className="text-[11px] font-mono font-semibold text-coda-text">Layer 2: Fermata LLM Adjustment</span>
          <span className={`ml-auto text-[11px] font-mono font-bold tabular-nums ${llmAdjustment >= 0 ? 'text-emerald-500' : 'text-red-500'}`}>
            {llmAdjustment >= 0 ? '+' : ''}{llmAdjustment}
          </span>
        </div>
        {riskScore.reasoning ? (
          <p className="ml-5 text-[11px] text-coda-text-secondary leading-relaxed">
            {riskScore.reasoning.slice(0, 300)}{riskScore.reasoning.length > 300 ? '...' : ''}
          </p>
        ) : (
          <p className="ml-5 text-[11px] text-coda-text-muted italic">No LLM reasoning recorded</p>
        )}
      </div>

      {/* ── Layer 3: Override ── */}
      {(riskScore.override_by || (riskScore.hard_overrides?.length ?? 0) > 0) && (
        <div className="pt-3 border-t border-black/[0.06] dark:border-white/[0.06]">
          <div className="flex items-center gap-2 mb-2">
            <UserCheck size={12} className="text-purple-500" />
            <span className="text-[11px] font-mono font-semibold text-coda-text">Layer 3: Override</span>
            {overrideAmount !== 0 && (
              <span className={`ml-auto text-[11px] font-mono font-bold tabular-nums ${overrideAmount >= 0 ? 'text-purple-500' : 'text-red-500'}`}>
                {overrideAmount >= 0 ? '+' : ''}{overrideAmount}
              </span>
            )}
          </div>
          <div className="ml-5 space-y-1">
            {riskScore.override_by && (
              <p className="text-[11px] text-coda-text-secondary">
                Applied by: <span className="font-mono text-coda-text">{riskScore.override_by}</span>
              </p>
            )}
            {riskScore.override_reason && (
              <p className="text-[11px] text-coda-text-secondary">
                Reason: {riskScore.override_reason}
              </p>
            )}
            {(riskScore.hard_overrides?.length ?? 0) > 0 && (
              <div className="flex flex-wrap gap-1 mt-1">
                {riskScore.hard_overrides!.map((r: string) => (
                  <span key={r} className="px-1.5 py-0.5 rounded text-[9px] font-mono bg-red-500/15 text-red-500">{r} HARD</span>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
