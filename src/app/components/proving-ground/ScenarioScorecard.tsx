import React, { useState } from 'react';
import {
  CheckCircle2, XCircle, Minus, ChevronDown, ChevronRight,
  Shield, BarChart3, Zap, Clock, Brain, AlertTriangle, Scale
} from 'lucide-react';
import type { ScenarioResult, AgentResult, PipelineStep } from './ScenarioCard';

// ── Agent colors (matching the rest of the app) ─────────────

const AGENT_BADGE: Record<string, { bg: string; text: string; border: string }> = {
  Concord: { bg: 'bg-white/8', text: 'text-coda-text-secondary', border: 'border-white/10' },
  Fermata: { bg: 'bg-white/8', text: 'text-coda-text-secondary', border: 'border-white/10' },
  Maestro: { bg: 'bg-white/8', text: 'text-coda-text-secondary', border: 'border-white/10' },
  Canto:   { bg: 'bg-white/8', text: 'text-coda-text-secondary', border: 'border-white/10' },
  Cadenza: { bg: 'bg-coda-brand/10', text: 'text-coda-brand', border: 'border-coda-brand/20' },
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

// ── Agent Result Card ───────────────────────────────────────

function AgentResultCard({ ar }: { ar: AgentResult }) {
  const [expanded, setExpanded] = useState(false);
  const badge = AGENT_BADGE[ar.agent] || AGENT_BADGE.Concord;
  const rb = RESULT_BADGE[ar.result] || RESULT_BADGE['N/A'];
  const RbIcon = rb.icon;

  return (
    <div className={`dashboard-card-subtle p-3 ${badge.border} border`}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className={`text-xs font-mono font-semibold px-2 py-0.5 rounded-full ${badge.bg} ${badge.text}`}>
            {ar.agent}
          </span>
          <span className={`flex items-center gap-1 text-xs font-mono ${rb.style}`}>
            <RbIcon size={14} />
            {rb.label}
          </span>
        </div>
        <div className="flex items-center gap-2">
          {ar.score !== undefined && (
            <span className="text-xs font-mono text-coda-text-muted">
              Score: <span className="text-coda-text-secondary font-semibold">{ar.score}</span>/100
            </span>
          )}
          <span className="text-[10px] font-mono text-coda-text-muted flex items-center gap-0.5">
            <Clock size={10} />
            {(ar.timing_ms / 1000).toFixed(1)}s
          </span>
        </div>
      </div>

      {/* Reasoning preview / expand */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="mt-2 w-full text-left flex items-start gap-1 group hover:bg-black/[0.02] dark:hover:bg-white/[0.02] transition-colors cursor-pointer rounded-md p-1"
      >
        {expanded ? <ChevronDown size={12} className="text-coda-text-muted mt-0.5 flex-shrink-0" /> : <ChevronRight size={12} className="text-coda-text-muted mt-0.5 flex-shrink-0" />}
        <p className={`text-xs text-coda-text-muted leading-relaxed ${expanded ? '' : 'line-clamp-2'}`}>
          {ar.reasoning}
        </p>
      </button>
    </div>
  );
}

// ── Pipeline Trace ──────────────────────────────────────────

function PipelineTrace({ trace }: { trace: PipelineStep[] }) {
  if (!trace.length) return null;

  return (
    <div className="mt-3">
      <p className="text-[10px] font-mono uppercase text-coda-text-muted mb-1.5 tracking-wider">Pipeline Trace</p>
      <div className="flex items-center gap-1 flex-wrap">
        {trace.map((step, i) => {
          const isOk = step.status === 'ok' || step.status === 'passed' || step.status === 'started';
          const isFail = step.status === 'failed' || step.status === 'error';
          return (
            <span key={i} className="contents">
              <span
                className={`text-[10px] font-mono px-2 py-0.5 rounded-full border ${
                  isOk
                    ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20'
                    : isFail
                      ? 'bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/20'
                      : 'bg-white/5 text-coda-text-muted border-white/10'
                }`}
                title={JSON.stringify(step.data || {}).slice(0, 200)}
              >
                {step.step.replace(/_/g, ' ')}
              </span>
              {i < trace.length - 1 && (
                <span className="text-coda-text-muted text-[10px]">&rarr;</span>
              )}
            </span>
          );
        })}
      </div>
    </div>
  );
}

// ── Main Scorecard ──────────────────────────────────────────

interface ScenarioScorecardProps {
  result: ScenarioResult;
}

export function ScenarioScorecard({ result }: ScenarioScorecardProps) {
  const CatIcon = CATEGORY_ICON[result.category] || Shield;
  const isPassing = result.overall_result === 'PASS';
  const isError = result.overall_result === 'ERROR';

  const bannerStyle = isPassing
    ? 'border-emerald-500/30 bg-emerald-500/5'
    : isError
      ? 'border-coda-border-subtle bg-white/3'
      : 'border-red-500/30 bg-red-500/5';

  const BannerIcon = isPassing ? CheckCircle2 : isError ? AlertTriangle : XCircle;
  const bannerIconColor = isPassing ? 'text-emerald-600 dark:text-emerald-400' : isError ? 'text-amber-600 dark:text-amber-400' : 'text-red-600 dark:text-red-400';
  const resultColor = isPassing ? 'text-emerald-600 dark:text-emerald-400' : isError ? 'text-amber-600 dark:text-amber-400' : 'text-red-600 dark:text-red-400';

  return (
    <div className="space-y-3">
      {/* Overall Banner */}
      <div className={`dashboard-card p-4 border-2 ${bannerStyle}`}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <BannerIcon size={28} className={bannerIconColor} />
            <div>
              <h3 className="text-lg font-semibold text-coda-text">
                {result.scenario_name}
              </h3>
              <div className="flex items-center gap-2 mt-0.5">
                <CatIcon size={12} className="text-coda-text-muted" />
                <span className="text-xs text-coda-text-muted capitalize">{result.category}</span>
                <span className="text-xs text-coda-text-muted">|</span>
                <span className="text-xs text-coda-text-muted">{result.bank_name}</span>
              </div>
            </div>
          </div>
          <div className="text-right">
            <span className={`text-2xl font-bold font-mono ${resultColor}`}>
              {result.overall_result}
            </span>
            <p className="text-[10px] font-mono text-coda-text-muted mt-0.5">
              {(result.duration_ms / 1000).toFixed(1)}s total
            </p>
          </div>
        </div>
      </div>

      {/* Per-Agent Results */}
      <div className="space-y-2">
        <p className="text-[10px] font-mono uppercase text-coda-text-muted tracking-wider flex items-center gap-1.5">
          <Brain size={10} />
          Agent Results
        </p>
        {result.agent_results.map((ar, i) => (
          <AgentResultCard key={`${ar.agent}-${i}`} ar={ar} />
        ))}
      </div>

      {/* Expected vs Actual */}
      <div className="grid grid-cols-2 gap-2">
        <div className="dashboard-card-subtle p-3">
          <p className="text-[10px] font-mono uppercase text-coda-text-muted mb-1 tracking-wider">Expected Behavior</p>
          <p className="text-xs text-coda-text-muted leading-relaxed">{result.expected_behavior}</p>
        </div>
        <div className="dashboard-card-subtle p-3">
          <p className="text-[10px] font-mono uppercase text-coda-text-muted mb-1 tracking-wider">Actual Behavior</p>
          <p className="text-xs text-coda-text-muted leading-relaxed">{result.actual_behavior}</p>
        </div>
      </div>

      {/* Error detail (expandable) */}
      {isError && result.error_message && (
        <div className="dashboard-card-subtle p-3 border border-coda-border-subtle">
          <p className="text-[10px] font-mono uppercase text-coda-text-muted mb-1 tracking-wider">Error Detail</p>
          <p className="text-xs text-coda-text-muted font-mono leading-relaxed break-all">{result.error_message}</p>
        </div>
      )}

      {/* Pipeline Trace */}
      <PipelineTrace trace={result.pipeline_trace} />
    </div>
  );
}