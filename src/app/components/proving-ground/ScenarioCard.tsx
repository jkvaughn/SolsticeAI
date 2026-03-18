import React from 'react';
import { Play, Loader2, CheckCircle2, XCircle, AlertTriangle, Shield, BarChart3, Zap, Scale } from 'lucide-react';

// ── Types ───────────────────────────────────────────────────

export interface ProvingGroundScenario {
  id: string;
  category: 'compliance' | 'risk' | 'operational' | 'dispute';
  name: string;
  description: string;
  tests_agents: string[];
  expected_behavior: string;
  severity: 'critical' | 'high' | 'medium';
}

export interface AgentResult {
  agent: string;
  result: 'CAUGHT' | 'MISSED' | 'N/A';
  reasoning: string;
  score?: number;
  timing_ms: number;
}

export interface PipelineStep {
  step: string;
  status: string;
  timestamp: string;
  data?: any;
}

export interface ScenarioResult {
  scenario_id: string;
  scenario_name: string;
  category: string;
  bank_id: string;
  bank_name: string;
  overall_result: 'PASS' | 'FAIL' | 'ERROR';
  duration_ms: number;
  agent_results: AgentResult[];
  pipeline_trace: PipelineStep[];
  expected_behavior: string;
  actual_behavior: string;
  error_message?: string;
}

export interface ProvingGroundSummary {
  total: number;
  passed: number;
  failed: number;
  duration_ms: number;
  by_category: Record<string, { passed: number; failed: number }>;
}

// ── Agent color map ─────────────────────────────────────────

const AGENT_COLORS: Record<string, string> = {
  Concord:  'bg-white/8 text-coda-text-secondary border-white/10',
  Fermata:  'bg-white/8 text-coda-text-secondary border-white/10',
  Maestro:  'bg-white/8 text-coda-text-secondary border-white/10',
  Canto:    'bg-white/8 text-coda-text-secondary border-white/10',
  Cadenza:  'bg-purple-500/10 text-purple-400 border-purple-500/20',
};

// ── Severity badge ──────────────────────────────────────────

const SEVERITY_STYLES: Record<string, string> = {
  critical: 'bg-red-500/15 text-red-600 dark:text-red-400 border-red-500/20',
  high:     'bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/20',
  medium:   'bg-white/8 text-coda-text-secondary border-white/10',
};

// ── Category icon ───────────────────────────────────────────

const CATEGORY_ICONS: Record<string, React.ElementType> = {
  compliance: Shield,
  risk: BarChart3,
  operational: Zap,
  dispute: Scale,
};

// ── Result icon helper ──────────────────────────────────────

function ResultIcon({ result, size = 14 }: { result: string; size?: number }) {
  if (result === 'PASS') return <CheckCircle2 size={size} className="text-emerald-600 dark:text-emerald-400" />;
  if (result === 'ERROR') return <AlertTriangle size={size} className="text-amber-600 dark:text-amber-400" />;
  return <XCircle size={size} className="text-red-600 dark:text-red-400" />;
}

// ── Component ───────────────────────────────────────────────

interface ScenarioCardProps {
  scenario: ProvingGroundScenario;
  result?: ScenarioResult;
  resultB?: ScenarioResult;
  compareMode?: boolean;
  bankNameA?: string;
  bankNameB?: string;
  isRunning: boolean;
  isSelected: boolean;
  disabled: boolean;
  onRun: () => void;
  onSelect: () => void;
}

export function ScenarioCard({
  scenario,
  result,
  resultB,
  compareMode,
  bankNameA,
  bankNameB,
  isRunning,
  isSelected,
  disabled,
  onRun,
  onSelect,
}: ScenarioCardProps) {
  const CatIcon = CATEGORY_ICONS[scenario.category] || Shield;

  return (
    <div
      onClick={onSelect}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(); } }}
      className={`
        w-full text-left p-3 rounded-xl transition-all duration-200 group cursor-pointer
        ${isSelected
          ? 'bg-white/10 dark:bg-white/8 border border-coda-brand/30 shadow-sm'
          : 'bg-white/3 dark:bg-white/2 border border-transparent hover:bg-white/6 hover:border-white/10'
        }
      `}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-start gap-2.5 flex-1 min-w-0">
          {/* Category icon */}
          <div className={`w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5 ${
            scenario.category === 'dispute' ? 'bg-purple-500/10' : 'bg-white/5'
          }`}>
            <CatIcon size={14} className={scenario.category === 'dispute' ? 'text-purple-400' : 'text-coda-text-muted'} />
          </div>

          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-sm font-medium text-coda-text leading-tight truncate">
                {scenario.name}
              </span>
              <span className={`text-[10px] font-mono uppercase px-1.5 py-0.5 rounded-full border ${SEVERITY_STYLES[scenario.severity]}`}>
                {scenario.severity}
              </span>
            </div>

            <p className="text-xs text-coda-text-muted mt-0.5 line-clamp-2 leading-relaxed">
              {scenario.description}
            </p>

            {/* Agent pills */}
            <div className="flex items-center gap-1 mt-1.5">
              {scenario.tests_agents.map((agent) => (
                <span
                  key={agent}
                  className={`text-[10px] font-mono px-1.5 py-0.5 rounded-full border ${AGENT_COLORS[agent] || 'bg-white/10 text-coda-text-muted'}`}
                >
                  {agent}
                </span>
              ))}
            </div>
          </div>
        </div>

        {/* Run button / Result badge(s) */}
        <div className="flex items-center gap-1.5 flex-shrink-0 mt-0.5">
          {/* Compare mode: dual badges */}
          {compareMode && (result || resultB) ? (
            <div className="flex items-center gap-1">
              {result ? (
                <span className="flex items-center gap-0.5" title={bankNameA}>
                  <span className="text-[8px] font-mono text-coda-text-muted">A</span>
                  <ResultIcon result={result.overall_result} />
                </span>
              ) : null}
              {resultB ? (
                <span className="flex items-center gap-0.5" title={bankNameB}>
                  <span className="text-[8px] font-mono text-coda-text-muted">B</span>
                  <ResultIcon result={resultB.overall_result} />
                </span>
              ) : null}
            </div>
          ) : !compareMode && result ? (
            <span className="flex items-center gap-1">
              <ResultIcon result={result.overall_result} size={16} />
              <span className="text-[10px] font-mono text-coda-text-muted">
                {(result.duration_ms / 1000).toFixed(1)}s
              </span>
            </span>
          ) : null}

          <button
            onClick={(e) => { e.stopPropagation(); onRun(); }}
            disabled={disabled || isRunning}
            className={`
              w-7 h-7 rounded-lg flex items-center justify-center transition-all cursor-pointer
              ${isRunning
                ? 'bg-coda-brand/20 text-coda-brand'
                : disabled
                  ? 'bg-white/5 text-coda-text-muted cursor-not-allowed'
                  : 'bg-white/5 text-coda-text-muted hover:bg-coda-brand/15 hover:text-coda-brand'
              }
            `}
          >
            {isRunning ? (
              <Loader2 size={14} className="animate-spin" />
            ) : (
              <Play size={12} className="ml-0.5" />
            )}
          </button>
        </div>
      </div>
    </div>
  );
}