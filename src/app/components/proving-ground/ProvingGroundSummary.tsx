import {
  CheckCircle2, XCircle, Minus, Shield, BarChart3, Zap,
  AlertTriangle, Download, Scale
} from 'lucide-react';
import type { ScenarioResult, ProvingGroundSummary as SummaryType } from './ScenarioCard';

// ── Category config ─────────────────────────────────────────

const CATEGORY_META: Record<string, { label: string; icon: React.ElementType; color: string }> = {
  compliance:   { label: 'Compliance Gauntlet',  icon: Shield,    color: 'text-coda-text-muted' },
  risk:         { label: 'Risk Provocation',     icon: BarChart3, color: 'text-coda-text-muted' },
  operational:  { label: 'Operational Stress',   icon: Zap,       color: 'text-coda-text-muted' },
  dispute:      { label: 'Dispute Resolution',   icon: Scale,     color: 'text-purple-400' },
};

// ── Agent colors ────────────────────────────────────────────

const AGENT_ORDER = ['Concord', 'Fermata', 'Maestro', 'Canto', 'Cadenza'] as const;

const AGENT_HEADER_COLORS: Record<string, string> = {
  Concord:  'text-coda-text-secondary',
  Fermata:  'text-coda-text-secondary',
  Maestro:  'text-coda-text-secondary',
  Canto:    'text-coda-text-secondary',
  Cadenza:  'text-purple-400',
};

// ── Resilience Ring ─────────────────────────────────────────

function ResilienceRing({ passed, total }: { passed: number; total: number }) {
  const pct = total > 0 ? passed / total : 0;
  const radius = 52;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference * (1 - pct);
  const color = pct >= 0.8 ? '#34d399' : pct >= 0.5 ? '#fbbf24' : '#f87171';

  return (
    <div className="flex flex-col items-center">
      <div className="relative w-32 h-32">
        <svg viewBox="0 0 120 120" className="w-full h-full -rotate-90">
          <circle
            cx="60" cy="60" r={radius}
            fill="none"
            stroke="rgba(255,255,255,0.06)"
            strokeWidth="8"
          />
          <circle
            cx="60" cy="60" r={radius}
            fill="none"
            stroke={color}
            strokeWidth="8"
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={offset}
            className="transition-all duration-1000 ease-out"
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-3xl font-bold font-mono text-coda-text">{passed}</span>
          <span className="text-xs text-coda-text-muted">/{total}</span>
        </div>
      </div>
      <p className="text-sm font-medium text-coda-text mt-2">Resilience Score</p>
      <p className="text-xs text-coda-text-muted">{Math.round(pct * 100)}% scenarios passed</p>
    </div>
  );
}

// ── Main Summary Component ──────────────────────────────────

interface ProvingGroundSummaryViewProps {
  results: ScenarioResult[];
  summary: SummaryType;
}

export function ProvingGroundSummaryView({ results, summary }: ProvingGroundSummaryViewProps) {
  const failures = results.filter(r => r.overall_result === 'FAIL');

  return (
    <div className="space-y-4">
      {/* Top: Resilience Ring + Category Breakdown */}
      <div className="dashboard-card p-5">
        <div className="flex items-start justify-between">
          {/* Resilience Ring */}
          <ResilienceRing passed={summary.passed} total={summary.total} />

          {/* Category Breakdown */}
          <div className="flex-1 ml-6 space-y-3">
            <p className="text-[10px] font-mono uppercase text-coda-text-muted tracking-wider mb-2">Category Breakdown</p>
            {Object.entries(CATEGORY_META).map(([key, meta]) => {
              const cat = summary.by_category[key] || { passed: 0, failed: 0 };
              const total = cat.passed + cat.failed;
              const pct = total > 0 ? cat.passed / total : 0;
              const CatIcon = meta.icon;
              return (
                <div key={key} className="flex items-center gap-3">
                  <CatIcon size={14} className={meta.color} />
                  <span className="text-xs text-coda-text w-28 truncate">{meta.label}</span>
                  <div className="flex-1 h-2 rounded-full bg-white/5 overflow-hidden">
                    <div
                      className="h-full rounded-full transition-all duration-700"
                      style={{
                        width: `${pct * 100}%`,
                        backgroundColor: pct >= 0.8 ? '#34d399' : pct >= 0.5 ? '#fbbf24' : '#f87171',
                      }}
                    />
                  </div>
                  <span className="text-xs font-mono text-coda-text-muted w-12 text-right">
                    {cat.passed}/{total}
                  </span>
                </div>
              );
            })}

            <div className="flex items-center gap-2 pt-2 border-t border-white/10">
              <span className="text-[10px] font-mono text-coda-text-muted">Total duration:</span>
              <span className="text-xs font-mono text-coda-text-muted">
                {(summary.duration_ms / 1000).toFixed(1)}s
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Agent Performance Grid */}
      <div className="dashboard-card p-4 overflow-x-auto">
        <p className="text-[10px] font-mono uppercase text-coda-text-muted tracking-wider mb-3">Agent Performance Grid</p>
        <table className="w-full text-xs">
          <thead>
            <tr>
              <th className="text-left py-1.5 px-2 text-coda-text-muted font-medium">Scenario</th>
              {AGENT_ORDER.map(a => (
                <th key={a} className={`text-center py-1.5 px-2 font-mono font-medium ${AGENT_HEADER_COLORS[a]}`}>{a}</th>
              ))}
              <th className="text-center py-1.5 px-2 text-coda-text-muted font-medium">Result</th>
            </tr>
          </thead>
          <tbody>
            {results.map(r => (
              <tr key={r.scenario_id} className="border-t border-white/10">
                <td className="py-1.5 px-2 text-coda-text truncate max-w-[160px]" title={r.scenario_name}>
                  {r.scenario_name}
                </td>
                {AGENT_ORDER.map(agent => {
                  const ar = r.agent_results.find(a => a.agent === agent);
                  if (!ar) return <td key={agent} className="text-center py-1.5 px-2"><Minus size={12} className="inline text-coda-text-muted" /></td>;
                  return (
                    <td key={agent} className="text-center py-1.5 px-2">
                      {ar.result === 'CAUGHT' ? (
                        <CheckCircle2 size={14} className="inline text-emerald-400" />
                      ) : ar.result === 'MISSED' ? (
                        <XCircle size={14} className="inline text-red-400" />
                      ) : (
                        <Minus size={12} className="inline text-coda-text-muted" />
                      )}
                    </td>
                  );
                })}
                <td className="text-center py-1.5 px-2">
                  <span className={`text-[10px] font-mono font-semibold px-1.5 py-0.5 rounded-full ${
                    r.overall_result === 'PASS'
                      ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400'
                      : r.overall_result === 'ERROR'
                        ? 'bg-amber-500/15 text-amber-600 dark:text-amber-400'
                        : 'bg-red-500/15 text-red-600 dark:text-red-400'
                  }`}>
                    {r.overall_result}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Findings */}
      {failures.length > 0 && (
        <div className="dashboard-card p-4">
          <p className="text-[10px] font-mono uppercase text-red-400/70 tracking-wider mb-2 flex items-center gap-1.5">
            <AlertTriangle size={10} />
            Findings ({failures.length})
          </p>
          <div className="space-y-2">
            {failures.map(f => (
              <div key={f.scenario_id} className="flex items-start gap-2 py-1.5 border-b border-white/10 last:border-0">
                <XCircle size={14} className="text-red-400 flex-shrink-0 mt-0.5" />
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium text-coda-text">{f.scenario_name}</p>
                  <p className="text-[11px] text-coda-text-muted mt-0.5 line-clamp-2">{f.actual_behavior}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Export (disabled) */}
      <div className="flex justify-end">
        <button
          disabled
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/5 text-coda-text-muted text-xs font-mono cursor-not-allowed"
          title="Coming soon"
        >
          <Download size={12} />
          Export Report
        </button>
      </div>
    </div>
  );
}