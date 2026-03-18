import React, { useEffect, useState } from 'react';
import {
  CheckCircle2, XCircle, Minus, Shield, BarChart3, Zap,
  AlertTriangle, Lightbulb, ArrowRight, Scale
} from 'lucide-react';
import type { ScenarioResult, ProvingGroundSummary } from './ScenarioCard';
import { ConfigDelta, fetchConfigDiffs, type ConfigDiff } from './ConfigDelta';

// ── Constants ───────────────────────────────────────────────

const CATEGORY_META: Record<string, { label: string; icon: React.ElementType; color: string }> = {
  compliance:  { label: 'Compliance',  icon: Shield,    color: 'text-coda-text-muted' },
  risk:        { label: 'Risk',        icon: BarChart3, color: 'text-coda-text-muted' },
  operational: { label: 'Operational', icon: Zap,       color: 'text-coda-text-muted' },
  dispute:     { label: 'Dispute',     icon: Scale,     color: 'text-purple-400' },
};

const AGENT_ORDER = ['Concord', 'Fermata', 'Maestro', 'Canto', 'Cadenza'] as const;

const AGENT_HEADER_COLORS: Record<string, string> = {
  Concord:  'text-coda-text-secondary',
  Fermata:  'text-coda-text-secondary',
  Maestro:  'text-coda-text-secondary',
  Canto:    'text-coda-text-secondary',
  Cadenza:  'text-purple-400',
};

// ── Mini Resilience Ring ────────────────────────────────────

function MiniRing({ passed, total, label, bankName }: {
  passed: number; total: number; label: string; bankName: string;
}) {
  const pct = total > 0 ? passed / total : 0;
  const r = 40;
  const circ = 2 * Math.PI * r;
  const offset = circ * (1 - pct);
  const color = pct >= 0.8 ? '#34d399' : pct >= 0.5 ? '#fbbf24' : '#f87171';

  return (
    <div className="flex flex-col items-center">
      <p className="text-[10px] font-mono uppercase text-coda-text-muted tracking-wider mb-1">{label}</p>
      <div className="relative w-24 h-24">
        <svg viewBox="0 0 100 100" className="w-full h-full -rotate-90">
          <circle cx="50" cy="50" r={r} fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="7" />
          <circle
            cx="50" cy="50" r={r}
            fill="none" stroke={color} strokeWidth="7" strokeLinecap="round"
            strokeDasharray={circ} strokeDashoffset={offset}
            className="transition-all duration-1000 ease-out"
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-2xl font-bold font-mono text-coda-text">{passed}</span>
          <span className="text-[10px] text-coda-text-muted">/{total}</span>
        </div>
      </div>
      <p className="text-xs font-medium text-coda-text mt-1 truncate max-w-28">{bankName}</p>
      <p className="text-[10px] text-coda-text-muted">{Math.round(pct * 100)}%</p>
    </div>
  );
}

// ── Key Insight ─────────────────────────────────────────────

function KeyInsight({ divergences, bankNameA, bankNameB, configDiffs }: {
  divergences: { scenario: ScenarioResult; caughtBy: string; missedBy: string }[];
  bankNameA: string;
  bankNameB: string;
  configDiffs: ConfigDiff[];
}) {
  if (divergences.length === 0) {
    return (
      <div className="dashboard-card p-3 border border-emerald-500/20 bg-emerald-500/5">
        <div className="flex items-start gap-2">
          <CheckCircle2 size={14} className="text-emerald-400 flex-shrink-0 mt-0.5" />
          <p className="text-xs text-coda-text-muted">
            Both <span className="font-medium text-coda-text">{bankNameA}</span> and{' '}
            <span className="font-medium text-coda-text">{bankNameB}</span> produced identical results across all scenarios.
          </p>
        </div>
      </div>
    );
  }

  const aCaught = divergences.filter(d => d.caughtBy === bankNameA).length;
  const bCaught = divergences.filter(d => d.caughtBy === bankNameB).length;
  const betterBank = aCaught > bCaught ? bankNameA : bCaught > aCaught ? bankNameB : null;
  const betterCount = Math.max(aCaught, bCaught);
  const worseBank = betterBank === bankNameA ? bankNameB : bankNameA;

  // Find the most impactful config diff
  const topDiff = configDiffs.length > 0 ? configDiffs[0] : null;

  return (
    <div className="dashboard-card p-3 border border-coda-border-subtle">
      <div className="flex items-start gap-2">
        <Lightbulb size={14} className="text-coda-text-muted flex-shrink-0 mt-0.5" />
        <div>
          <p className="text-xs font-medium text-coda-text-secondary">Key Insight</p>
          <p className="text-[11px] text-coda-text-muted mt-0.5 leading-relaxed">
            {betterBank ? (
              <>
                <span className="text-emerald-600 dark:text-emerald-400 font-medium">{betterBank}</span>'s configuration caught{' '}
                <span className="font-medium text-coda-text">{betterCount}</span> scenario{betterCount !== 1 ? 's' : ''} that{' '}
                <span className="text-red-600 dark:text-red-400 font-medium">{worseBank}</span>'s configuration missed.
                {topDiff && (
                  <> Primary differentiator: {topDiff.agent}'s {topDiff.label.toLowerCase()} ({topDiff.valueA} vs {topDiff.valueB}).</>
                )}
              </>
            ) : (
              <>
                Both banks caught and missed different scenarios — {bankNameA} caught {aCaught}, {bankNameB} caught {bCaught}.
                {topDiff && (
                  <> Key config difference: {topDiff.agent}'s {topDiff.label.toLowerCase()} ({topDiff.valueA} vs {topDiff.valueB}).</>
                )}
              </>
            )}
          </p>
        </div>
      </div>
    </div>
  );
}

// ── Main Component ──────────────────────────────────────────

interface ComparisonSummaryProps {
  resultsA: ScenarioResult[];
  resultsB: ScenarioResult[];
  summaryA: ProvingGroundSummary;
  summaryB: ProvingGroundSummary;
  bankNameA: string;
  bankNameB: string;
  bankIdA: string;
  bankIdB: string;
}

export function ComparisonSummaryView({
  resultsA, resultsB, summaryA, summaryB,
  bankNameA, bankNameB, bankIdA, bankIdB,
}: ComparisonSummaryProps) {
  const [configDiffs, setConfigDiffs] = useState<ConfigDiff[]>([]);

  useEffect(() => {
    fetchConfigDiffs(bankIdA, bankIdB).then(setConfigDiffs);
  }, [bankIdA, bankIdB]);

  // Build divergence list
  const allScenarioIds = new Set([
    ...resultsA.map(r => r.scenario_id),
    ...resultsB.map(r => r.scenario_id),
  ]);

  const divergences: { scenario: ScenarioResult; caughtBy: string; missedBy: string }[] = [];
  for (const sid of allScenarioIds) {
    const rA = resultsA.find(r => r.scenario_id === sid);
    const rB = resultsB.find(r => r.scenario_id === sid);
    if (rA && rB && rA.overall_result !== rB.overall_result) {
      const caughtBy = rA.overall_result === 'PASS' ? bankNameA : bankNameB;
      const missedBy = rA.overall_result === 'PASS' ? bankNameB : bankNameA;
      divergences.push({ scenario: rA, caughtBy, missedBy });
    }
  }

  return (
    <div className="space-y-4">
      {/* Key Insight */}
      <KeyInsight
        divergences={divergences}
        bankNameA={bankNameA}
        bankNameB={bankNameB}
        configDiffs={configDiffs}
      />

      {/* Dual Resilience Rings */}
      <div className="dashboard-card p-5">
        <div className="flex items-center justify-center gap-12">
          <MiniRing passed={summaryA.passed} total={summaryA.total} label="Bank A" bankName={bankNameA} />
          <div className="flex flex-col items-center text-coda-text-muted">
            <span className="text-lg font-mono">vs</span>
          </div>
          <MiniRing passed={summaryB.passed} total={summaryB.total} label="Bank B" bankName={bankNameB} />
        </div>

        {/* Category breakdown side by side */}
        <div className="mt-4 pt-3 border-t border-white/10">
          <p className="text-[10px] font-mono uppercase text-coda-text-muted tracking-wider mb-2">Category Breakdown</p>
          {Object.entries(CATEGORY_META).map(([key, meta]) => {
            const catA = summaryA.by_category[key] || { passed: 0, failed: 0 };
            const catB = summaryB.by_category[key] || { passed: 0, failed: 0 };
            const totalA = catA.passed + catA.failed;
            const totalB = catB.passed + catB.failed;
            const CatIcon = meta.icon;
            return (
              <div key={key} className="flex items-center gap-2 py-1">
                <CatIcon size={12} className={meta.color} />
                <span className="text-xs text-coda-text w-20 truncate">{meta.label}</span>
                <span className="text-[10px] font-mono text-coda-text-muted w-8 text-right">{catA.passed}/{totalA}</span>
                <div className="flex-1 flex gap-1">
                  <div className="flex-1 h-1.5 rounded-full bg-white/5 overflow-hidden">
                    <div className="h-full rounded-full bg-emerald-400/60 transition-all duration-700" style={{ width: totalA > 0 ? `${(catA.passed/totalA)*100}%` : '0%' }} />
                  </div>
                  <div className="flex-1 h-1.5 rounded-full bg-white/5 overflow-hidden">
                    <div className="h-full rounded-full bg-emerald-400/60 transition-all duration-700" style={{ width: totalB > 0 ? `${(catB.passed/totalB)*100}%` : '0%' }} />
                  </div>
                </div>
                <span className="text-[10px] font-mono text-coda-text-muted w-8">{catB.passed}/{totalB}</span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Comparative Agent Grid */}
      <div className="dashboard-card p-4 overflow-x-auto">
        <p className="text-[10px] font-mono uppercase text-coda-text-muted tracking-wider mb-3">Comparative Agent Performance</p>
        <table className="w-full text-xs">
          <thead>
            <tr>
              <th className="text-left py-1.5 px-2 text-coda-text-muted font-medium">Scenario</th>
              {AGENT_ORDER.map(a => (
                <th key={a} className={`text-center py-1.5 px-1 font-mono font-medium ${AGENT_HEADER_COLORS[a]}`}>
                  <span className="block text-[10px]">{a}</span>
                  <span className="block text-[8px] text-coda-text-muted font-normal">A | B</span>
                </th>
              ))}
              <th className="text-center py-1.5 px-2 text-coda-text-muted font-medium">
                <span className="block">Result</span>
                <span className="block text-[8px] text-coda-text-muted font-normal">A | B</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {resultsA.map(rA => {
              const rB = resultsB.find(r => r.scenario_id === rA.scenario_id);
              const isDivergent = rB && rA.overall_result !== rB.overall_result;
              return (
                <tr key={rA.scenario_id} className={`border-t ${isDivergent ? 'border-coda-border-subtle bg-white/3' : 'border-white/10'}`}>
                  <td className="py-1.5 px-2 text-coda-text truncate max-w-[130px]" title={rA.scenario_name}>
                    {rA.scenario_name}
                  </td>
                  {AGENT_ORDER.map(agent => {
                    const arA = rA.agent_results.find(a => a.agent === agent);
                    const arB = rB?.agent_results.find(a => a.agent === agent);
                    const agentDiverges = arA && arB && arA.result !== arB.result;
                    return (
                      <td key={agent} className={`text-center py-1.5 px-1 ${agentDiverges ? 'bg-white/5' : ''}`}>
                        <div className="flex items-center justify-center gap-0.5">
                          {renderResultIcon(arA?.result)}
                          <span className="text-coda-text-muted text-[8px]">|</span>
                          {renderResultIcon(arB?.result)}
                        </div>
                      </td>
                    );
                  })}
                  <td className="text-center py-1.5 px-2">
                    <div className="flex items-center justify-center gap-1">
                      <span className={`text-[9px] font-mono font-semibold px-1 py-0.5 rounded-full ${
                        rA.overall_result === 'PASS' ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400' : rA.overall_result === 'ERROR' ? 'bg-amber-500/15 text-amber-600 dark:text-amber-400' : 'bg-red-500/15 text-red-600 dark:text-red-400'
                      }`}>{rA.overall_result}</span>
                      {rB && (
                        <span className={`text-[9px] font-mono font-semibold px-1 py-0.5 rounded-full ${
                          rB.overall_result === 'PASS' ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400' : rB.overall_result === 'ERROR' ? 'bg-amber-500/15 text-amber-600 dark:text-amber-400' : 'bg-red-500/15 text-red-600 dark:text-red-400'
                        }`}>{rB.overall_result}</span>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Divergence Summary */}
      {divergences.length > 0 && (
        <div className="dashboard-card p-4">
          <p className="text-[10px] font-mono uppercase text-coda-text-muted tracking-wider mb-2 flex items-center gap-1.5">
            <AlertTriangle size={10} />
            Divergent Scenarios ({divergences.length})
          </p>
          <div className="space-y-2">
            {divergences.map(d => {
              // Find which config diffs might be relevant
              const scenarioAgents = d.scenario.agent_results.map(a => a.agent);
              const relevantDiffs = configDiffs.filter(cd => scenarioAgents.some(a => a === cd.agent || (a === 'Maestro' && cd.agent === 'Treasury')));
              return (
                <div key={d.scenario.scenario_id} className="p-2.5 rounded-lg border border-coda-border-subtle bg-white/3">
                  <div className="flex items-start justify-between">
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium text-coda-text">{d.scenario.scenario_name}</p>
                      <p className="text-[10px] text-coda-text-muted mt-0.5">
                        <span className="text-emerald-600 dark:text-emerald-400">{d.caughtBy}</span>
                        {' caught '}
                        <span className="text-coda-text-muted mx-0.5">/</span>
                        {' '}
                        <span className="text-red-600 dark:text-red-400">{d.missedBy}</span>
                        {' missed'}
                      </p>
                    </div>
                    <div className="flex items-center gap-1">
                      <CheckCircle2 size={12} className="text-emerald-400" />
                      <ArrowRight size={10} className="text-coda-text-muted" />
                      <XCircle size={12} className="text-red-400" />
                    </div>
                  </div>
                  {relevantDiffs.length > 0 && (
                    <div className="mt-1.5 pt-1.5 border-t border-white/10">
                      <p className="text-[9px] font-mono text-coda-text-muted">
                        Relevant config: {relevantDiffs.map(cd =>
                          `${cd.agent} ${cd.label.toLowerCase()} (${cd.valueA} vs ${cd.valueB})`
                        ).join('; ')}
                      </p>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Config Delta */}
      <ConfigDelta
        bankIdA={bankIdA}
        bankIdB={bankIdB}
        bankNameA={bankNameA}
        bankNameB={bankNameB}
        diffs={configDiffs}
      />
    </div>
  );
}

// ── Helper ──────────────────────────────────────────────────

function renderResultIcon(result?: string) {
  if (!result) return <Minus size={10} className="text-coda-text-muted" />;
  if (result === 'CAUGHT') return <CheckCircle2 size={11} className="text-emerald-400" />;
  if (result === 'MISSED') return <XCircle size={11} className="text-red-400" />;
  return <Minus size={10} className="text-coda-text-muted" />;
}