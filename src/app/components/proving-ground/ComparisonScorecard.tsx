import React, { useState } from 'react';
import {
  CheckCircle2, XCircle, Minus, ChevronDown, ChevronRight,
  Shield, BarChart3, Zap, Clock, Brain, ArrowRight, AlertTriangle, Scale
} from 'lucide-react';
import type { ScenarioResult, AgentResult } from './ScenarioCard';
import { ConfigDelta } from './ConfigDelta';
import { CadenzaConfigComparison } from './CadenzaConfigComparison';

// ── Shared constants ────────────────────────────────────────

const AGENT_BADGE: Record<string, { bg: string; text: string; border: string }> = {
  Concord: { bg: 'bg-white/8', text: 'text-coda-text-secondary', border: 'border-white/10' },
  Fermata: { bg: 'bg-white/8', text: 'text-coda-text-secondary', border: 'border-white/10' },
  Maestro: { bg: 'bg-white/8', text: 'text-coda-text-secondary', border: 'border-white/10' },
  Canto:   { bg: 'bg-white/8', text: 'text-coda-text-secondary', border: 'border-white/10' },
  Cadenza: { bg: 'bg-purple-500/10', text: 'text-purple-400', border: 'border-purple-500/20' },
};

const RESULT_BADGE: Record<string, { icon: React.ElementType; style: string; label: string }> = {
  CAUGHT: { icon: CheckCircle2, style: 'text-emerald-600 dark:text-emerald-400', label: 'CAUGHT' },
  MISSED: { icon: XCircle,      style: 'text-red-600 dark:text-red-400',     label: 'MISSED' },
  'N/A':  { icon: Minus,        style: 'text-coda-text-muted', label: 'N/A' },
};

const CATEGORY_ICON: Record<string, React.ElementType> = {
  compliance: Shield,
  risk: BarChart3,
  operational: Zap,
  dispute: Scale,
};

// ── Compact Agent Result Row ────────────────────────────────

function AgentRow({ ar, highlight }: { ar: AgentResult; highlight?: 'green' | 'red' }) {
  const [expanded, setExpanded] = useState(false);
  const badge = AGENT_BADGE[ar.agent] || AGENT_BADGE.Concord;
  const rb = RESULT_BADGE[ar.result] || RESULT_BADGE['N/A'];
  const RbIcon = rb.icon;

  const borderClass = highlight === 'green'
    ? 'border-emerald-500/40'
    : highlight === 'red'
      ? 'border-red-500/40'
      : badge.border;

  return (
    <div className={`p-2.5 rounded-lg border bg-white/2 ${borderClass}`}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <span className={`text-[10px] font-mono font-semibold px-1.5 py-0.5 rounded-full ${badge.bg} ${badge.text}`}>
            {ar.agent}
          </span>
          <span className={`flex items-center gap-0.5 text-[10px] font-mono ${rb.style}`}>
            <RbIcon size={12} /> {rb.label}
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          {ar.score !== undefined && (
            <span className="text-[10px] font-mono text-coda-text-muted">{ar.score}/100</span>
          )}
          <span className="text-[9px] font-mono text-coda-text-muted flex items-center gap-0.5">
            <Clock size={9} />{(ar.timing_ms / 1000).toFixed(1)}s
          </span>
        </div>
      </div>
      <button onClick={() => setExpanded(!expanded)} className="mt-1.5 w-full text-left flex items-start gap-1 cursor-pointer">
        {expanded ? <ChevronDown size={10} className="text-coda-text-muted mt-0.5 flex-shrink-0" /> : <ChevronRight size={10} className="text-coda-text-muted mt-0.5 flex-shrink-0" />}
        <p className={`text-[11px] text-coda-text-muted leading-relaxed ${expanded ? '' : 'line-clamp-2'}`}>
          {ar.reasoning}
        </p>
      </button>
    </div>
  );
}

// ── Divergence Callout ──────────────────────────────────────

function DivergenceCallout({ resultA, resultB }: { resultA: ScenarioResult; resultB: ScenarioResult }) {
  if (resultA.overall_result === resultB.overall_result) return null;

  const caughtBank = resultA.overall_result === 'PASS' ? resultA.bank_name : resultB.bank_name;
  const missedBank = resultA.overall_result === 'PASS' ? resultB.bank_name : resultA.bank_name;

  // Find which agents diverged
  const divergedAgents: string[] = [];
  const allAgents = new Set([
    ...resultA.agent_results.map(a => a.agent),
    ...resultB.agent_results.map(a => a.agent),
  ]);
  for (const agent of allAgents) {
    const arA = resultA.agent_results.find(a => a.agent === agent);
    const arB = resultB.agent_results.find(a => a.agent === agent);
    if (arA && arB && arA.result !== arB.result) {
      divergedAgents.push(agent);
    }
  }

  return (
    <div className="dashboard-card-subtle p-3 border border-coda-border-subtle">
      <div className="flex items-start gap-2">
        <AlertTriangle size={14} className="text-amber-600 dark:text-amber-400 flex-shrink-0 mt-0.5" />
        <div>
          <p className="text-xs font-medium text-coda-text-secondary">Divergent Result Detected</p>
          <p className="text-[11px] text-coda-text-muted mt-0.5">
            <span className="text-emerald-600 dark:text-emerald-400 font-medium">{caughtBank}</span> caught this scenario while{' '}
            <span className="text-red-600 dark:text-red-400 font-medium">{missedBank}</span> did not.
            {divergedAgents.length > 0 && (
              <> Diverging agents: {divergedAgents.map((a, i) => (
                <span key={a}>
                  {i > 0 && ', '}
                  <span className="font-mono text-coda-text-secondary">{a}</span>
                </span>
              ))}.</>
            )}
          </p>
        </div>
      </div>
    </div>
  );
}

// ── Result Column ───────────────────────────────────────────

function ResultColumn({ result, otherResult, label }: {
  result: ScenarioResult;
  otherResult: ScenarioResult;
  label: string;
}) {
  const isPassing = result.overall_result === 'PASS';
  const isDivergent = result.overall_result !== otherResult.overall_result;

  return (
    <div className="flex-1 min-w-0 space-y-2">
      {/* Bank header */}
      <div className={`p-3 rounded-xl border-2 ${
        isPassing
          ? 'border-emerald-500/30 bg-emerald-500/5'
          : 'border-red-500/30 bg-red-500/5'
      }`}>
        <div className="flex items-center justify-between">
          <div>
            <p className="text-[10px] font-mono uppercase text-coda-text-muted tracking-wider">{label}</p>
            <p className="text-sm font-medium text-coda-text mt-0.5">{result.bank_name}</p>
          </div>
          <div className="text-right">
            <span className={`text-xl font-bold font-mono ${isPassing ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}`}>
              {result.overall_result}
            </span>
            <p className="text-[9px] font-mono text-coda-text-muted">{(result.duration_ms / 1000).toFixed(1)}s</p>
          </div>
        </div>
      </div>

      {/* Agent results */}
      <div className="space-y-1.5">
        {result.agent_results.map((ar, i) => {
          const otherAr = otherResult.agent_results.find(a => a.agent === ar.agent);
          const isDiverging = isDivergent && otherAr && otherAr.result !== ar.result;
          const highlight = isDiverging
            ? (ar.result === 'CAUGHT' ? 'green' : ar.result === 'MISSED' ? 'red' : undefined)
            : undefined;
          return <AgentRow key={`${ar.agent}-${i}`} ar={ar} highlight={highlight} />;
        })}
      </div>

      {/* Actual behavior */}
      <div className="p-2.5 rounded-lg bg-white/3 border border-white/10">
        <p className="text-[9px] font-mono uppercase text-coda-text-muted mb-1 tracking-wider">Actual Behavior</p>
        <p className="text-[11px] text-coda-text-muted leading-relaxed">{result.actual_behavior}</p>
      </div>
    </div>
  );
}

// ── Main Component ──────────────────────────────────────────

interface ComparisonScorecardProps {
  resultA: ScenarioResult;
  resultB: ScenarioResult;
}

export function ComparisonScorecard({ resultA, resultB }: ComparisonScorecardProps) {
  const CatIcon = CATEGORY_ICON[resultA.category] || Shield;
  const isDispute = resultA.category === 'dispute';

  return (
    <div className="space-y-3">
      {/* Scenario header */}
      <div className="dashboard-card p-4">
        <div className="flex items-center gap-3">
          <CatIcon size={20} className="text-coda-text-muted" />
          <div>
            <h3 className="text-base font-semibold text-coda-text">{resultA.scenario_name}</h3>
            <p className="text-xs text-coda-text-muted capitalize">{resultA.category} scenario</p>
          </div>
        </div>

        {/* Expected behavior (shared) */}
        <div className="mt-3 p-2.5 rounded-lg bg-white/3 border border-white/10">
          <p className="text-[9px] font-mono uppercase text-coda-text-muted mb-1 tracking-wider">Expected Behavior</p>
          <p className="text-[11px] text-coda-text-muted leading-relaxed">{resultA.expected_behavior}</p>
        </div>
      </div>

      {/* Divergence callout */}
      <DivergenceCallout resultA={resultA} resultB={resultB} />

      {/* Side-by-side results */}
      <div className="flex gap-3">
        <ResultColumn result={resultA} otherResult={resultB} label="Bank A" />
        <ResultColumn result={resultB} otherResult={resultA} label="Bank B" />
      </div>

      {/* Config delta — for dispute scenarios, show Cadenza config comparison first */}
      {isDispute && (
        <CadenzaConfigComparison
          bankIdA={resultA.bank_id}
          bankIdB={resultB.bank_id}
          bankNameA={resultA.bank_name}
          bankNameB={resultB.bank_name}
          resultA={resultA}
          resultB={resultB}
        />
      )}

      {/* Full config delta — for dispute scenarios, filter to Cadenza; otherwise show all */}
      <ConfigDelta
        bankIdA={resultA.bank_id}
        bankIdB={resultB.bank_id}
        bankNameA={resultA.bank_name}
        bankNameB={resultB.bank_name}
        filterAgents={isDispute ? ['Cadenza'] : undefined}
      />
    </div>
  );
}