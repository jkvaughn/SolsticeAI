import { useState, useEffect, useRef } from 'react';
import { ChevronDown, Link2, Loader2 } from 'lucide-react';
import type { AgentMessage } from '../../types';
import { formatTokenAmount } from '../../types';
import type { TransactionPipeline, PipelineStep } from './PipelineTracker';
import { AgentActivityFeed } from './AgentActivityFeed';

// ============================================================
// Types
// ============================================================

export interface VisualStep {
  type: 'request' | 'compliance' | 'risk' | 'execution' | 'accepted' | 'rejected' | 'settled' | 'awaiting';
  status: 'pending' | 'active' | 'complete' | 'error';
  timestamp?: string;
  agentName: string;
  bankCode: string;
  role: string;
  message: string;
  data?: Record<string, string>;
  complianceData?: {
    score: number;
    maxScore: number;
    level: string;
    action: string;
    checks: { name: string; passed: boolean; detail: string; meta?: string }[];
    reasoning?: string;
  };
  riskData?: {
    level: string;
    score: number;
    recommendation: string;
  };
  chainData?: Record<string, string>;
  solanaSignature?: string;
}

export interface TransactionGroup {
  id: string;
  pipeline: TransactionPipeline;
  steps: VisualStep[];
  relatedMessages: AgentMessage[];
  userPrompt?: string;
}

// ============================================================
// Step Configuration
// ============================================================

const STEP_CONFIG: Record<string, {
  label: string;
  icon: string;
  color: string;
  dotBg: string;
  dotBorder: string;
  labelText: string;
  agentBg: string;
  agentBorder: string;
  activeBg: string;
}> = {
  request:    { label: 'PAYMENT REQUEST',  icon: '↗', color: 'rgb(245,158,11)',   dotBg: 'bg-amber-500/10',   dotBorder: 'border-amber-500',   labelText: 'text-amber-600 dark:text-amber-400',   agentBg: 'bg-amber-500/5',   agentBorder: 'border-amber-500/10', activeBg: 'bg-amber-500/[0.04]' },
  compliance: { label: 'COMPLIANCE',       icon: '◈', color: 'rgb(139,92,246)',   dotBg: 'bg-violet-500/10',  dotBorder: 'border-violet-500',  labelText: 'text-violet-600 dark:text-violet-400',  agentBg: 'bg-violet-500/5',  agentBorder: 'border-violet-500/10', activeBg: 'bg-violet-500/[0.04]' },
  risk:       { label: 'RISK ASSESSMENT',  icon: '△', color: 'rgb(236,72,153)',   dotBg: 'bg-pink-500/10',    dotBorder: 'border-pink-500',    labelText: 'text-pink-600 dark:text-pink-400',    agentBg: 'bg-pink-500/5',    agentBorder: 'border-pink-500/10', activeBg: 'bg-pink-500/[0.04]' },
  execution:  { label: 'EXECUTION',        icon: '⟿', color: 'rgb(34,211,238)',   dotBg: 'bg-cyan-500/10',    dotBorder: 'border-cyan-500',    labelText: 'text-cyan-600 dark:text-cyan-400',    agentBg: 'bg-cyan-500/5',    agentBorder: 'border-cyan-500/10', activeBg: 'bg-cyan-500/[0.04]' },
  accepted:   { label: 'ACCEPTED',         icon: '✓', color: 'rgb(96,165,250)',   dotBg: 'bg-blue-500/10',    dotBorder: 'border-blue-500',    labelText: 'text-blue-600 dark:text-blue-400',    agentBg: 'bg-blue-500/5',    agentBorder: 'border-blue-500/10', activeBg: 'bg-blue-500/[0.04]' },
  rejected:   { label: 'REJECTED',         icon: '✗', color: 'rgb(239,68,68)',    dotBg: 'bg-red-500/10',     dotBorder: 'border-red-500',     labelText: 'text-red-600 dark:text-red-400',     agentBg: 'bg-red-500/5',     agentBorder: 'border-red-500/10', activeBg: 'bg-red-500/[0.04]' },
  settled:    { label: 'SETTLED',          icon: '◉', color: 'rgb(52,211,153)',   dotBg: 'bg-emerald-500/10', dotBorder: 'border-emerald-500', labelText: 'text-emerald-600 dark:text-emerald-400', agentBg: 'bg-emerald-500/5', agentBorder: 'border-emerald-500/10', activeBg: 'bg-emerald-500/[0.04]' },
  awaiting:   { label: 'AWAITING',         icon: '…', color: 'rgb(96,165,250)',   dotBg: 'bg-blue-500/10',    dotBorder: 'border-blue-500',    labelText: 'text-blue-600 dark:text-blue-400',    agentBg: 'bg-blue-500/5',    agentBorder: 'border-blue-500/10', activeBg: 'bg-blue-500/[0.04]' },
};

// ============================================================
// Helpers
// ============================================================

const fmtAmount = (n: number) =>
  n >= 1000 ? `$${n.toLocaleString()}` : `$${n}`;

const fmtTime = (ts?: string) => {
  if (!ts) return '';
  try {
    return new Date(ts).toLocaleTimeString();
  } catch {
    return '';
  }
};

// ============================================================
// KV Panel — key/value grid
// ============================================================

function KVPanel({ data }: { data: Record<string, string> }) {
  const entries = Object.entries(data).filter(([, v]) => v);
  if (entries.length === 0) return null;

  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(160px,1fr))] gap-px bg-coda-border/20 rounded-md overflow-hidden mt-2">
      {entries.map(([k, v]) => (
        <div key={k} className="bg-coda-surface-alt/50 dark:bg-coda-surface-alt/30 px-2.5 py-1.5">
          <div className="text-[9px] uppercase tracking-wider text-coda-text-muted font-mono mb-0.5">{k}</div>
          <div className="text-[11px] text-coda-text-secondary font-mono break-all">{v}</div>
        </div>
      ))}
    </div>
  );
}

// ============================================================
// Compliance Panel
// ============================================================

function CompliancePanel({ data }: { data: NonNullable<VisualStep['complianceData']> }) {
  return (
    <div className="mt-2 space-y-2">
      {/* Score bar */}
      <div className="flex items-center gap-3 px-2.5 py-2 rounded-md bg-violet-500/[0.03] dark:bg-violet-500/[0.05] border border-violet-500/10">
        <div className="flex-1">
          <div className="flex justify-between mb-1">
            <span className="text-[9px] uppercase tracking-wider text-coda-text-muted font-mono">Risk Score</span>
            <span className="text-[11px] font-medium text-emerald-600 dark:text-emerald-400 font-mono">
              {data.score}/{data.maxScore}
            </span>
          </div>
          <div className="h-0.5 bg-coda-surface-hover rounded-full">
            <div
              className="h-full bg-emerald-500 rounded-full transition-all"
              style={{ width: `${Math.max((data.score / data.maxScore) * 100, 2)}%`, minWidth: 2 }}
            />
          </div>
        </div>
        <span className="text-[9px] font-medium text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded font-mono uppercase tracking-wider">
          {data.level}
        </span>
        <span className="text-[10px] text-coda-text-muted font-mono">{data.action}</span>
      </div>

      {/* Checks */}
      {data.checks.map((ch, i) => (
        <div
          key={i}
          className={`flex items-center gap-2 px-2.5 py-1 rounded ${
            i % 2 === 0 ? 'bg-coda-surface-alt/20' : ''
          }`}
        >
          <span className={`text-[10px] w-3 ${ch.passed ? 'text-emerald-500' : 'text-red-500'}`}>
            {ch.passed ? '✓' : '✗'}
          </span>
          <span className="text-[11px] text-coda-text-muted font-mono min-w-[110px]">{ch.name}</span>
          <span className="text-[11px] text-coda-text-secondary flex-1">{ch.detail}</span>
          {ch.meta && <span className="text-[10px] text-coda-text-muted font-mono">{ch.meta}</span>}
        </div>
      ))}

      {/* Reasoning */}
      {data.reasoning && (
        <div className="mt-1.5 px-2.5 py-2 text-[11px] text-coda-text-muted leading-relaxed border-l-2 border-violet-500/20 bg-violet-500/[0.02] rounded-r">
          {data.reasoning}
        </div>
      )}
    </div>
  );
}

// ============================================================
// Risk Panel
// ============================================================

function RiskPanel({ data }: { data: NonNullable<VisualStep['riskData']> }) {
  const levelColor = data.level === 'low' ? 'text-emerald-500' : data.level === 'high' ? 'text-red-500' : 'text-amber-500';
  return (
    <div className="mt-2">
      <div className="grid grid-cols-3 gap-px bg-coda-border/20 rounded-md overflow-hidden mb-2">
        {[
          { l: 'Level', v: data.level.toUpperCase(), c: levelColor },
          { l: 'Score', v: `${data.score}/100`, c: 'text-coda-text-secondary' },
          { l: 'Finality', v: data.recommendation.replace(/_/g, ' '), c: 'text-coda-text-secondary' },
        ].map((s) => (
          <div key={s.l} className="bg-coda-surface-alt/50 dark:bg-coda-surface-alt/30 px-2.5 py-2">
            <div className="text-[9px] uppercase tracking-wider text-coda-text-muted font-mono mb-0.5">{s.l}</div>
            <div className={`text-[12px] font-medium font-mono ${s.c}`}>{s.v}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ============================================================
// Step Row — individual step with expandable detail
// ============================================================

export function StepRow({
  step,
  isLatest,
  animate,
  defaultOpen,
}: {
  step: VisualStep;
  isLatest: boolean;
  animate: boolean;
  defaultOpen: boolean;
}) {
  const [open, setOpen] = useState(false);
  const cfg = STEP_CONFIG[step.type] || STEP_CONFIG.request;
  const hasDetail = step.data || step.complianceData || step.riskData || step.chainData;
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  useEffect(() => {
    if (defaultOpen && hasDetail) {
      const t = setTimeout(() => { if (mounted.current) setOpen(true); }, 250);
      return () => clearTimeout(t);
    }
  }, [defaultOpen, hasDetail]);

  // Awaiting step — special minimal row
  if (step.type === 'awaiting') {
    return (
      <div className="flex items-center gap-2 py-2 px-3 animate-in fade-in slide-in-from-bottom-1">
        <div className="w-4 h-4 rounded-full bg-blue-500/10 border border-blue-500/30 flex items-center justify-center">
          <Loader2 className="w-2.5 h-2.5 text-blue-500 animate-spin" />
        </div>
        <span className="text-[10px] uppercase tracking-wider text-blue-600 dark:text-blue-400 font-mono font-medium">
          AWAITING RECEIVER
        </span>
        <span className="text-[11px] text-coda-text-muted flex-1">
          {step.message}
        </span>
        <div className="flex gap-0.5">
          {[0, 1, 2].map(i => (
            <div
              key={i}
              className="w-1 h-1 rounded-full bg-blue-500 animate-pulse"
              style={{ animationDelay: `${i * 200}ms` }}
            />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div
      className={`rounded-lg mb-0.5 transition-all duration-200 ${
        isLatest ? `border ${cfg.activeBg}` : 'border border-transparent'
      }`}
      style={isLatest ? { borderColor: `${cfg.color}25` } : undefined}
    >
      <div
        onClick={() => hasDetail && setOpen(!open)}
        className={`flex items-center gap-2 px-3 py-2 ${
          hasDetail ? 'cursor-pointer hover:bg-coda-surface-hover/20' : ''
        } ${animate ? 'animate-in fade-in slide-in-from-bottom-1' : ''}`}
      >
        {/* Dot */}
        <div
          className={`w-4 h-4 rounded-full flex-shrink-0 flex items-center justify-center text-[8px] border-[1.5px] ${cfg.dotBg} ${cfg.dotBorder}`}
          style={isLatest ? { boxShadow: `0 0 8px ${cfg.color}30` } : undefined}
        >
          <span style={{ color: cfg.color }}>{cfg.icon}</span>
        </div>

        {/* Label */}
        <span className={`text-[9px] font-medium tracking-wider font-mono min-w-[90px] ${cfg.labelText}`}>
          {cfg.label}
        </span>

        {/* Agent badge */}
        <div className={`flex items-center gap-1.5 px-1.5 py-0.5 rounded ${cfg.agentBg} border ${cfg.agentBorder}`}>
          <div
            className={`w-4 h-4 rounded flex items-center justify-center text-[8px] font-bold font-mono border ${cfg.dotBg} ${cfg.agentBorder}`}
            style={{ color: cfg.color }}
          >
            {step.bankCode.slice(0, 2)}
          </div>
          <div className="leading-none">
            <div className="text-[10px] font-medium text-coda-text">{step.agentName}</div>
            <div className="text-[8px] text-coda-text-muted font-mono">{step.role}</div>
          </div>
        </div>

        {/* Message */}
        <span className={`text-[12px] flex-1 truncate ${
          isLatest ? 'text-coda-text-secondary' : 'text-coda-text-muted'
        }`}>
          {step.message}
        </span>

        {/* Timestamp */}
        <span className="text-[10px] text-coda-text-muted font-mono flex-shrink-0">
          {fmtTime(step.timestamp)}
        </span>

        {/* Chevron */}
        {hasDetail && (
          <ChevronDown className={`w-3 h-3 text-coda-text-muted transition-transform duration-150 ${
            open ? 'rotate-180' : ''
          }`} />
        )}
      </div>

      {/* Expanded detail */}
      {open && hasDetail && (
        <div className="px-3 pb-3 pl-9 animate-in fade-in slide-in-from-top-1 duration-150">
          {step.complianceData && <CompliancePanel data={step.complianceData} />}
          {step.riskData && <RiskPanel data={step.riskData} />}
          {step.chainData && <KVPanel data={step.chainData} />}
          {step.data && !step.complianceData && !step.riskData && !step.chainData && (
            <KVPanel data={step.data} />
          )}
          {step.solanaSignature && (
            <a
              href={`https://explorer.solana.com/tx/${step.solanaSignature}?cluster=devnet`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 mt-2 text-[11px] text-blue-600 dark:text-blue-400 hover:text-blue-500 dark:hover:text-blue-300 transition-colors font-mono"
            >
              <Link2 className="w-3 h-3" />
              View on Solana Explorer
            </a>
          )}
        </div>
      )}
    </div>
  );
}

// ============================================================
// Settled Transaction Row — collapsed
// ============================================================

export function TransactionRow({
  group,
  isOpen,
  onToggle,
}: {
  group: TransactionGroup;
  isOpen: boolean;
  onToggle: () => void;
}) {
  const { pipeline, steps } = group;
  const isRejected = pipeline.steps.some(s => s.status === 'error');

  return (
    <div className={`rounded-xl overflow-hidden transition-all duration-200 ${
      isOpen
        ? 'liquid-glass-subtle'
        : 'border border-transparent hover:border-coda-border/30 hover:bg-coda-surface-alt/10'
    }`}>
      <button
        onClick={onToggle}
        className="w-full px-3 py-2.5 flex items-center gap-3 text-left"
      >
        {/* Status dot */}
        <div className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${
          isRejected ? 'bg-red-500' : 'bg-emerald-500'
        }`} />

        {/* TX ID */}
        <span className="text-[10px] tracking-wider text-coda-text-muted font-mono min-w-[70px]">
          TX-{pipeline.transactionId.slice(0, 6)}
        </span>

        {/* Amount */}
        <span className="text-[15px] font-medium text-coda-text font-mono tracking-tight min-w-[80px] text-left">
          {fmtAmount(pipeline.amount)}
        </span>

        {/* From → To */}
        <div className="flex items-center gap-1">
          <span className="bg-blue-500/10 text-blue-600 dark:text-blue-400 px-1.5 py-0.5 rounded text-[9px] font-medium font-mono">
            {pipeline.senderCode}
          </span>
          <span className="text-coda-text-muted text-[9px]">→</span>
          <span className="bg-violet-500/10 text-violet-600 dark:text-violet-400 px-1.5 py-0.5 rounded text-[9px] font-medium font-mono">
            {pipeline.receiverCode}
          </span>
        </div>

        {/* Status badge */}
        <span className={`text-[9px] font-medium px-2 py-0.5 rounded font-mono ${
          isRejected
            ? 'bg-red-500/10 text-red-600 dark:text-red-400'
            : 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
        }`}>
          {isRejected ? 'REJECTED' : 'SETTLED'}
        </span>

        {/* Steps count */}
        <span className="text-[10px] text-coda-text-muted font-mono">{steps.length} steps</span>

        {/* Time */}
        <span className="text-[10px] text-coda-text-muted font-mono ml-auto min-w-[70px] text-right">
          {fmtTime(pipeline.startedAt)}
        </span>

        {/* Chevron */}
        <ChevronDown className={`w-3 h-3 text-coda-text-muted transition-transform duration-150 ${
          isOpen ? 'rotate-180' : ''
        }`} />
      </button>

      {/* Expanded steps */}
      {isOpen && (
        <div className="px-2 pb-3 border-t border-coda-border/20">
          {steps.map((s, i) => (
            <StepRow key={i} step={s} isLatest={false} animate={false} defaultOpen={false} />
          ))}
        </div>
      )}
    </div>
  );
}

// ============================================================
// Live Transaction Card — active/in-progress
// ============================================================

export function LiveTransactionCard({
  group,
  elapsedMs,
}: {
  group: TransactionGroup;
  elapsedMs: number;
}) {
  const { pipeline, steps } = group;
  const scrollRef = useRef<HTMLDivElement>(null);
  const isComplete = pipeline.isComplete;
  const isRejected = pipeline.steps.some(s => s.status === 'error');

  const completedCount = pipeline.steps.filter(s => s.status === 'complete').length;
  const totalSteps = pipeline.steps.length;
  const progressPercent = Math.round((completedCount / totalSteps) * 100);

  const activeStep = pipeline.steps.find(s => s.status === 'active');
  const lastStep = steps[steps.length - 1];
  const lastCfg = lastStep ? STEP_CONFIG[lastStep.type] || STEP_CONFIG.request : STEP_CONFIG.request;

  // Auto-scroll
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [steps.length]);

  const formatElapsed = (ms: number) => {
    if (ms < 1000) return `${ms}ms`;
    const s = ms / 1000;
    if (s < 60) return `${s.toFixed(1)}s`;
    return `${Math.floor(s / 60)}m ${Math.floor(s % 60)}s`;
  };

  return (
    <div className={`rounded-xl overflow-hidden transition-all duration-300 border ${
      isComplete
        ? isRejected
          ? 'border-red-500/20 bg-red-500/[0.02]'
          : 'border-emerald-500/20 bg-emerald-500/[0.02]'
        : 'border-blue-500/20 bg-blue-500/[0.02] animate-[bpulse_2.5s_ease-in-out_infinite]'
    } liquid-glass-subtle`}>
      {/* Header */}
      <div className={`px-4 py-2.5 flex items-center gap-3 border-b ${
        isComplete ? 'border-coda-border/20' : 'border-blue-500/10'
      }`}>
        {/* Status dot */}
        <div className={`w-2 h-2 rounded-full flex-shrink-0 ${
          isComplete
            ? isRejected ? 'bg-red-500' : 'bg-emerald-500'
            : 'bg-blue-500 animate-pulse'
        }`} />

        {/* TX ID */}
        <span className="text-[10px] tracking-wider text-coda-text-muted font-mono">
          TX-{pipeline.transactionId.slice(0, 6)}
        </span>

        {/* Amount */}
        <span className="text-[17px] font-medium text-coda-text font-mono tracking-tight">
          {fmtAmount(pipeline.amount)}
        </span>

        {/* From → To */}
        <div className="flex items-center gap-1">
          <span className="bg-blue-500/10 text-blue-600 dark:text-blue-400 px-2 py-0.5 rounded text-[10px] font-medium font-mono">
            {pipeline.senderCode}
          </span>
          <span className="text-coda-text-muted text-[9px]">→</span>
          <span className="bg-violet-500/10 text-violet-600 dark:text-violet-400 px-2 py-0.5 rounded text-[10px] font-medium font-mono">
            {pipeline.receiverCode}
          </span>
        </div>

        {/* Status */}
        <div className="ml-auto flex items-center gap-2">
          <span className="text-[10px] text-coda-text-muted font-mono">
            {formatElapsed(elapsedMs)}
          </span>
          {isComplete ? (
            <span className={`text-[10px] font-medium tracking-wider font-mono ${
              isRejected ? 'text-red-600 dark:text-red-400' : 'text-emerald-600 dark:text-emerald-400'
            }`}>
              {isRejected ? '✗ REJECTED' : '✓ SETTLED'}
            </span>
          ) : (
            <span className="text-[10px] font-medium tracking-wider font-mono flex items-center gap-1.5"
              style={{ color: lastCfg.color }}
            >
              <span className="inline-block w-5 h-0.5 rounded-full overflow-hidden" style={{ background: `${lastCfg.color}20` }}>
                <span
                  className="block h-full w-2/5 rounded-full animate-shimmer"
                  style={{
                    backgroundImage: `linear-gradient(90deg, transparent, ${lastCfg.color}, transparent)`,
                    backgroundSize: '200% 100%',
                  }}
                />
              </span>
              PROCESSING
            </span>
          )}
        </div>
      </div>

      {/* Progress bar */}
      <div className="h-0.5 bg-coda-surface-hover/30">
        <div
          className={`h-full rounded-full transition-all duration-500 ${
            isComplete
              ? isRejected ? 'bg-red-500' : 'bg-emerald-500'
              : 'bg-blue-500'
          }`}
          style={{ width: `${progressPercent}%` }}
        />
      </div>

      {/* Steps */}
      <div ref={scrollRef} className="px-2 py-1.5 max-h-[500px] overflow-y-auto scrollbar-thin">
        {steps.map((s, i) => (
          <StepRow
            key={`${s.type}-${i}`}
            step={s}
            isLatest={i === steps.length - 1 && !isComplete}
            animate={true}
            defaultOpen={
              i === steps.length - 1 && !isComplete &&
              (s.type === 'compliance' || s.type === 'risk')
            }
          />
        ))}

        {/* Waiting dots */}
        {!isComplete && steps.length > 0 && !steps.some(s => s.type === 'awaiting') && (
          <div className="flex items-center gap-1 py-2 pl-9 animate-in fade-in">
            {[0, 1, 2].map(i => (
              <div
                key={i}
                className="w-1 h-1 rounded-full animate-pulse"
                style={{ backgroundColor: lastCfg.color, animationDelay: `${i * 200}ms` }}
              />
            ))}
            <span className="text-[10px] text-coda-text-muted font-mono ml-1">
              {activeStep ? `${activeStep.label}...` : 'awaiting next agent'}
            </span>
          </div>
        )}
      </div>

      {/* Agent Activity Feed */}
      <AgentActivityFeed
        pipeline={pipeline}
        messages={group.relatedMessages}
        defaultOpen={!isComplete}
      />
    </div>
  );
}

// ============================================================
// Build Visual Steps from Pipeline + Agent Messages
// ============================================================

const COMPLIANCE_CHECK_LABELS: Record<string, string> = {
  sanctions_screening: 'Sanctions Screening',
  aml_threshold: 'AML Threshold',
  counterparty_verification: 'Counterparty Verification',
  jurisdiction_check: 'Jurisdiction Check',
  purpose_code_validation: 'Purpose Code',
};

export function buildVisualSteps(
  pipeline: TransactionPipeline,
  messages: AgentMessage[],
  _bankCode: string,
): VisualStep[] {
  const steps: VisualStep[] = [];

  // ── REQUEST (reasoning + tx_created + request_sent) ─────
  const requestPipeSteps = pipeline.steps.filter(s =>
    ['reasoning', 'tx_created', 'request_sent'].includes(s.id)
  );
  const requestComplete = requestPipeSteps.some(s => s.status === 'complete');
  const requestActive = requestPipeSteps.some(s => s.status === 'active');

  if (requestComplete || requestActive) {
    const requestMsg = messages.find(m => m.message_type === 'payment_request');
    const content = requestMsg?.content as Record<string, unknown> | undefined;

    const data: Record<string, string> = {};
    if (content) {
      if (content.amount_display) data['Amount'] = `$${Number(content.amount_display).toLocaleString()}`;
      else if (content.amount) data['Amount'] = `$${Number(content.amount).toLocaleString()}`;
      if (content.purpose_code) data['Purpose'] = String(content.purpose_code);
      if (content.memo) data['Memo'] = String(content.memo);
      if (content.token_standard) data['Token'] = String(content.token_standard);
      if (content.asset) data['Asset'] = String(content.asset);
    }

    steps.push({
      type: 'request',
      status: requestComplete ? 'complete' : 'active',
      timestamp: requestPipeSteps.find(s => s.timestamp)?.timestamp || pipeline.startedAt,
      agentName: 'Maestro',
      bankCode: pipeline.senderCode,
      role: 'Settlement',
      message: requestMsg?.natural_language || `Initiating ${fmtAmount(pipeline.amount)} payment to ${pipeline.receiverCode}.`,
      data: Object.keys(data).length > 0 ? data : undefined,
    });
  }

  // ── AWAITING RECEIVER ───────────────────────────────────
  const awaitStep = pipeline.steps.find(s => s.id === 'awaiting_receiver');
  if (awaitStep?.status === 'active') {
    steps.push({
      type: 'awaiting',
      status: 'active',
      agentName: 'Maestro',
      bankCode: pipeline.receiverCode,
      role: 'Settlement',
      message: awaitStep.hint || 'Receiver Maestro agent is processing autonomously...',
    });
  }

  // ── COMPLIANCE ──────────────────────────────────────────
  const compStep = pipeline.steps.find(s => s.id === 'compliance');
  if (compStep && (compStep.status === 'complete' || compStep.status === 'active')) {
    const complianceData = compStep.substeps ? {
      score: 0,
      maxScore: 100,
      level: 'Low',
      action: 'Process immediately',
      checks: compStep.substeps.map(sub => ({
        name: COMPLIANCE_CHECK_LABELS[sub.label] || sub.label.replace(/_/g, ' '),
        passed: sub.passed,
        detail: sub.detail,
      })),
    } : undefined;

    steps.push({
      type: 'compliance',
      status: compStep.status as 'active' | 'complete',
      timestamp: compStep.timestamp,
      agentName: 'Concord',
      bankCode: pipeline.receiverCode,
      role: 'Compliance',
      message: compStep.detail || (compStep.status === 'active' ? 'Running compliance checks...' : 'Compliance check passed.'),
      complianceData,
    });
  }

  // ── RISK ────────────────────────────────────────────────
  const riskStep = pipeline.steps.find(s => s.id === 'risk');
  if (riskStep && (riskStep.status === 'complete' || riskStep.status === 'active')) {
    steps.push({
      type: 'risk',
      status: riskStep.status as 'active' | 'complete',
      timestamp: riskStep.timestamp,
      agentName: 'Fermata',
      bankCode: pipeline.receiverCode,
      role: 'Risk',
      message: riskStep.detail || (riskStep.status === 'active' ? 'Assessing transaction risk...' : 'Risk assessment complete.'),
      riskData: riskStep.riskData ? {
        level: riskStep.riskData.level,
        score: riskStep.riskData.score,
        recommendation: riskStep.riskData.recommendation,
      } : undefined,
    });
  }

  // ── DECISION (accepted/rejected) ────────────────────────
  const decisionStep = pipeline.steps.find(s => s.id === 'decision');
  if (decisionStep && (decisionStep.status === 'complete' || decisionStep.status === 'active' || decisionStep.status === 'error')) {
    const acceptMsg = messages.find(m => m.message_type === 'payment_accept');
    const rejectMsg = messages.find(m => m.message_type === 'payment_reject');
    const isError = decisionStep.status === 'error';

    steps.push({
      type: isError ? 'rejected' : 'accepted',
      status: decisionStep.status as 'active' | 'complete' | 'error',
      timestamp: decisionStep.timestamp || acceptMsg?.created_at || rejectMsg?.created_at,
      agentName: 'Maestro',
      bankCode: pipeline.receiverCode,
      role: 'Settlement',
      message: (acceptMsg || rejectMsg)?.natural_language
        || decisionStep.detail
        || (isError ? 'Payment rejected.' : 'Payment accepted.'),
    });
  }

  // ── SETTLEMENT (settlement + confirmed) ─────────────────
  const settlementStep = pipeline.steps.find(s => s.id === 'settlement');
  const confirmedStep = pipeline.steps.find(s => s.id === 'confirmed');

  if (
    (settlementStep && (settlementStep.status === 'complete' || settlementStep.status === 'active')) ||
    (confirmedStep && confirmedStep.status === 'complete')
  ) {
    const settleMsg = messages.find(m => m.message_type === 'settlement_confirm');
    const content = settleMsg?.content as Record<string, unknown> | undefined;

    const chainData: Record<string, string> = {};
    if (settlementStep?.solanaSignature) {
      const sig = settlementStep.solanaSignature;
      chainData['Tx'] = `${sig.slice(0, 12)}...${sig.slice(-4)}`;
    }
    if (confirmedStep?.detail) {
      chainData['Slot'] = confirmedStep.detail.replace('Slot: ', '');
    }
    if (content?.tx_signature) chainData['Tx'] = `${String(content.tx_signature).slice(0, 12)}...${String(content.tx_signature).slice(-4)}`;
    chainData['Fee'] = '0.000005 SOL';
    chainData['Finality'] = 'Confirmed';
    chainData['Network'] = 'Solana Devnet';

    const isSettled = confirmedStep?.status === 'complete';

    steps.push({
      type: 'settled',
      status: isSettled ? 'complete' : 'active',
      timestamp: confirmedStep?.timestamp || settlementStep?.timestamp,
      agentName: 'Maestro',
      bankCode: pipeline.receiverCode,
      role: 'Settlement',
      message: settleMsg?.natural_language || (isSettled ? 'Settlement confirmed on Solana Devnet.' : 'Executing on-chain settlement...'),
      chainData: Object.keys(chainData).length > 0 ? chainData : undefined,
      solanaSignature: settlementStep?.solanaSignature || (content?.tx_signature as string),
    });
  }

  return steps;
}