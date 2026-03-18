import { useEffect, useState } from 'react';
import {
  Brain, FileText, Send, Shield, Activity,
  Bot, Link2, CheckCircle2, XCircle, Loader2,
  Clock, ChevronDown, ChevronRight, AlertTriangle,
  Inbox, ArrowDownToLine, Lock, Eye, Scale, ShieldCheck, Coins,
  CircleDollarSign,
} from 'lucide-react';

// ============================================================
// Pipeline Step Definitions
// ============================================================

export interface PipelineStep {
  id: string;
  label: string;
  status: 'pending' | 'active' | 'complete' | 'error' | 'skipped';
  detail?: string;
  timestamp?: string;
  substeps?: { label: string; passed: boolean; detail: string }[];
  riskData?: {
    level: string;
    score: number;
    recommendation: string;
  };
  solanaSignature?: string;
  hint?: string;
  lockupColor?: 'amber' | 'blue' | 'red' | 'purple' | 'green';
}

export interface LockupData {
  lockupStatus: string | null;
  lockupEnd: string | null;
  senderCode: string;
  receiverCode: string;
  ybSymbol?: string;
  tbSymbol?: string;
  resolution?: string;
  reversalReason?: string;
}

export interface TransactionPipeline {
  transactionId: string;
  senderCode: string;
  receiverCode: string;
  amount: number;
  startedAt: string;
  steps: PipelineStep[];
  isComplete: boolean;
  lockupData?: LockupData;
}

const STEP_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  reasoning: Brain,
  tx_created: FileText,
  request_sent: Send,
  awaiting_receiver: Inbox,
  compliance: Shield,
  risk: Activity,
  decision: Bot,
  settlement: Link2,
  network_fee: CircleDollarSign,
  confirmed: CheckCircle2,
  // Lockup flow steps
  yb_mint: Coins,
  soft_settle: Lock,
  cadenza_monitor: Eye,
  resolution: Scale,
  hard_finality: ShieldCheck,
};

// Standard 9-step pipeline (low risk, no lockup)
export function createPipelineSteps(): PipelineStep[] {
  return [
    { id: 'reasoning', label: 'Agent Reasoning', status: 'pending' },
    { id: 'tx_created', label: 'Transaction Created', status: 'pending' },
    { id: 'request_sent', label: 'Payment Request Sent', status: 'pending' },
    { id: 'awaiting_receiver', label: 'Awaiting Receiver', status: 'pending' },
    { id: 'compliance', label: 'Compliance Check', status: 'pending' },
    { id: 'risk', label: 'Risk Assessment', status: 'pending' },
    { id: 'decision', label: 'Agent Decision', status: 'pending' },
    { id: 'settlement', label: 'On-chain Settlement', status: 'pending' },
    { id: 'confirmed', label: 'Settlement Confirmed', status: 'pending' },
  ];
}

// Known compliance check types (matches server-side checks in index.tsx)
const COMPLIANCE_CHECK_LABELS: Record<string, string> = {
  sanctions_screening: 'Sanctions Screening',
  aml_threshold: 'AML Threshold',
  counterparty_verification: 'Counterparty Verification',
  jurisdiction_check: 'Jurisdiction Check',
  purpose_code_validation: 'Purpose Code Validation',
};

const ALL_COMPLIANCE_CHECKS = [
  'sanctions_screening',
  'aml_threshold',
  'counterparty_verification',
  'jurisdiction_check',
  'purpose_code_validation',
];

// Lockup step IDs
const LOCKUP_STEP_IDS = ['yb_mint', 'soft_settle', 'cadenza_monitor', 'resolution', 'hard_finality'];

/**
 * Convert standard pipeline to lockup pipeline by replacing
 * 'settlement' + 'confirmed' with 5 lockup-specific steps.
 * No-op if pipeline already has lockup steps.
 */
function ensureLockupSteps(steps: PipelineStep[], lockupData: LockupData): PipelineStep[] {
  if (steps.some(s => s.id === 'yb_mint')) return steps; // Already converted

  const senderCode = lockupData.senderCode;
  const receiverCode = lockupData.receiverCode;
  const ybSym = lockupData.ybSymbol || `${senderCode}-USDYB`;
  const tbSym = lockupData.tbSymbol || 'BNY-USTB';

  // Keep steps through 'decision', drop 'settlement' + 'confirmed'
  const baseSteps = steps.filter(s => s.id !== 'settlement' && s.id !== 'confirmed');

  // Add lockup steps
  baseSteps.push(
    { id: 'yb_mint', label: 'Yield-Bearing Mint', status: 'pending', detail: `${ybSym} \u2192 BNY` },
    { id: 'soft_settle', label: 'Soft Settlement', status: 'pending', detail: `${tbSym} \u2192 ${receiverCode}` },
    { id: 'cadenza_monitor', label: 'Cadenza Monitoring', status: 'pending' },
    { id: 'resolution', label: 'Resolution', status: 'pending' },
    { id: 'hard_finality', label: 'Hard Finality', status: 'pending' },
  );

  return baseSteps;
}

/**
 * Apply lockup_status-based step completion to lockup steps.
 */
function applyLockupStatus(steps: PipelineStep[], lockupData: LockupData): void {
  const ls = lockupData.lockupStatus;
  if (!ls) return;

  const now = new Date().toISOString();
  const ybStep = steps.find(s => s.id === 'yb_mint');
  const ssStep = steps.find(s => s.id === 'soft_settle');
  const cmStep = steps.find(s => s.id === 'cadenza_monitor');
  const resStep = steps.find(s => s.id === 'resolution');
  const hfStep = steps.find(s => s.id === 'hard_finality');

  const completeStep = (step: PipelineStep | undefined) => {
    if (step && step.status !== 'complete' && step.status !== 'error') {
      step.status = 'complete';
      step.timestamp = step.timestamp || now;
    }
  };

  const activateStep = (step: PipelineStep | undefined) => {
    if (step && step.status === 'pending') {
      step.status = 'active';
    }
  };

  // lockup_status progression:
  // yb_minted -> soft_settled -> cadenza_monitoring -> cadenza_flagged/cadenza_escalated/cadenza_cleared -> hard_finality/reversed

  if (ls === 'yb_minted') {
    completeStep(ybStep);
    activateStep(ssStep);
  } else if (ls === 'soft_settled' || ls === 'cadenza_monitoring') {
    completeStep(ybStep);
    completeStep(ssStep);
    activateStep(cmStep);
    if (cmStep) {
      cmStep.lockupColor = 'amber';
      if (lockupData.lockupEnd) {
        const remaining = new Date(lockupData.lockupEnd).getTime() - Date.now();
        if (remaining > 0) {
          const secs = Math.ceil(remaining / 1000);
          const m = Math.floor(secs / 60);
          const s = secs % 60;
          cmStep.detail = `Monitoring \u2014 ${m}m ${s}s remaining`;
        } else {
          cmStep.detail = 'Lockup period expired \u2014 awaiting resolution';
        }
      } else {
        cmStep.detail = '\u221E lockup \u2014 escalation eligible';
        cmStep.lockupColor = 'purple';
      }
    }
  } else if (ls === 'cadenza_flagged') {
    completeStep(ybStep);
    completeStep(ssStep);
    completeStep(cmStep);
    activateStep(resStep);
    if (resStep) {
      resStep.lockupColor = 'red';
      resStep.detail = 'Cadenza flagged \u2014 under review';
    }
  } else if (ls === 'cadenza_escalated') {
    completeStep(ybStep);
    completeStep(ssStep);
    completeStep(cmStep);
    activateStep(resStep);
    if (resStep) {
      resStep.lockupColor = 'purple';
      resStep.detail = '\u221E Escalated \u2192 Human Review';
    }
  } else if (ls === 'cadenza_cleared') {
    completeStep(ybStep);
    completeStep(ssStep);
    completeStep(cmStep);
    completeStep(resStep);
    if (resStep) resStep.detail = 'All-clear';
    activateStep(hfStep);
    if (hfStep) {
      hfStep.lockupColor = 'green';
      hfStep.detail = 'Minting deposit tokens...';
    }
  } else if (ls === 'hard_finality') {
    completeStep(ybStep);
    completeStep(ssStep);
    completeStep(cmStep);
    completeStep(resStep);
    if (resStep) resStep.detail = resStep.detail || 'All-clear';
    completeStep(hfStep);
    if (hfStep) {
      const recvSym = `${lockupData.receiverCode}-USDTD`;
      hfStep.detail = `${recvSym} minted`;
      hfStep.lockupColor = 'green';
    }
  } else if (ls === 'reversed') {
    completeStep(ybStep);
    completeStep(ssStep);
    completeStep(cmStep);
    // Resolution shows as error for reversal
    if (resStep) {
      resStep.status = 'error';
      resStep.detail = lockupData.reversalReason || 'Reversed';
      resStep.lockupColor = 'red';
      resStep.timestamp = resStep.timestamp || now;
    }
    // Hard finality shows re-mint
    if (hfStep) {
      hfStep.status = 'complete';
      hfStep.timestamp = hfStep.timestamp || now;
      const senderSym = `${lockupData.senderCode}-USDTD`;
      hfStep.detail = `${senderSym} restored`;
      hfStep.lockupColor = 'red';
    }
  }
}

export function updatePipelineFromTxStatus(
  pipeline: TransactionPipeline,
  txStatus: string,
  extraData?: {
    complianceChecks?: { type: string; passed: boolean; detail: string }[];
    riskLevel?: string;
    riskScore?: number;
    riskReasoning?: string;
    finalityRecommendation?: string;
    solanaTxSignature?: string;
    solanaSlot?: number;
    lockupData?: LockupData;
  }
): TransactionPipeline {
  const lockupData = extraData?.lockupData || pipeline.lockupData;
  const hasLockup = lockupData && lockupData.lockupStatus;

  let steps = [...pipeline.steps.map(s => ({ ...s }))];

  // If lockup data present, convert pipeline to lockup mode
  if (hasLockup && lockupData) {
    steps = ensureLockupSteps(steps, lockupData);
  }

  // Map tx status to which base steps are complete
  const baseCompleteSteps: Record<string, string[]> = {
    'initiated': ['reasoning', 'tx_created', 'request_sent'],
    'compliance_check': ['reasoning', 'tx_created', 'request_sent', 'awaiting_receiver', 'compliance'],
    'risk_scored': ['reasoning', 'tx_created', 'request_sent', 'awaiting_receiver', 'compliance', 'risk'],
    'executing': ['reasoning', 'tx_created', 'request_sent', 'awaiting_receiver', 'compliance', 'risk', 'decision'],
  };

  // For non-lockup: settled/locked completes everything
  if (!hasLockup) {
    baseCompleteSteps['settled'] = ['reasoning', 'tx_created', 'request_sent', 'awaiting_receiver', 'compliance', 'risk', 'decision', 'settlement', 'confirmed'];
    baseCompleteSteps['locked'] = ['reasoning', 'tx_created', 'request_sent', 'awaiting_receiver', 'compliance', 'risk', 'decision', 'settlement', 'confirmed'];
  } else {
    // For lockup: locked/settled only complete base steps through 'decision'
    // Lockup steps are driven by lockup_status via applyLockupStatus
    baseCompleteSteps['locked'] = ['reasoning', 'tx_created', 'request_sent', 'awaiting_receiver', 'compliance', 'risk', 'decision'];
    baseCompleteSteps['settled'] = ['reasoning', 'tx_created', 'request_sent', 'awaiting_receiver', 'compliance', 'risk', 'decision'];
  }
  baseCompleteSteps['rejected'] = ['reasoning', 'tx_created', 'request_sent', 'awaiting_receiver', 'compliance', 'risk', 'decision'];

  const completeStepIds = baseCompleteSteps[txStatus] || [];
  const now = new Date().toISOString();

  for (const step of steps) {
    if (completeStepIds.includes(step.id)) {
      if (step.status !== 'complete' && step.status !== 'error') {
        step.status = 'complete';
        step.timestamp = step.timestamp || now;
      }
    }
  }

  // Apply lockup status-driven completion for lockup steps
  if (hasLockup && lockupData) {
    applyLockupStatus(steps, lockupData);
  }

  // Set the NEXT step after completed ones as active (only for non-lockup steps,
  // since lockup steps manage their own active state)
  if (!hasLockup) {
    const lastCompleteIdx = steps.findLastIndex(s => s.status === 'complete');
    if (lastCompleteIdx >= 0 && lastCompleteIdx < steps.length - 1) {
      const nextStep = steps[lastCompleteIdx + 1];
      if (nextStep.status === 'pending') {
        nextStep.status = 'active';
      }
    }
  } else {
    // For lockup mode: if no lockup step is active yet and decision is complete, activate first pending lockup step
    const hasActiveLockupStep = steps.some(s => LOCKUP_STEP_IDS.includes(s.id) && (s.status === 'active' || s.status === 'complete' || s.status === 'error'));
    if (!hasActiveLockupStep) {
      const lastCompleteIdx = steps.findLastIndex(s => s.status === 'complete');
      if (lastCompleteIdx >= 0 && lastCompleteIdx < steps.length - 1) {
        const nextStep = steps[lastCompleteIdx + 1];
        if (nextStep.status === 'pending') {
          nextStep.status = 'active';
        }
      }
    }
  }

  // If tx is still "initiated", the awaiting_receiver step is the active one
  if (txStatus === 'initiated') {
    const awaitStep = steps.find(s => s.id === 'awaiting_receiver');
    if (awaitStep && awaitStep.status === 'pending') {
      awaitStep.status = 'active';
      awaitStep.hint = 'Receiver Maestro agent is processing autonomously';
    }
  }

  // When awaiting_receiver completes, add detail
  if (txStatus !== 'initiated') {
    const awaitStep = steps.find(s => s.id === 'awaiting_receiver');
    if (awaitStep && awaitStep.status === 'complete') {
      awaitStep.detail = awaitStep.detail || 'Receiver picked up';
      awaitStep.hint = undefined;
    }
  }

  // Special handling for rejected (non-lockup reversal — lockup reversal is handled by applyLockupStatus)
  if (txStatus === 'rejected' && !hasLockup) {
    const decisionStep = steps.find(s => s.id === 'decision');
    if (decisionStep) {
      decisionStep.status = 'error';
      decisionStep.detail = 'Payment Rejected';
    }
    steps.filter(s => s.status === 'pending' || s.status === 'active').forEach(s => {
      s.status = 'skipped';
    });
  }

  // Apply extra data: compliance checks
  if (extraData?.complianceChecks) {
    const compStep = steps.find(s => s.id === 'compliance');
    if (compStep) {
      compStep.substeps = extraData.complianceChecks.map(c => ({
        label: c.type,
        passed: c.passed,
        detail: c.detail,
      }));
      const passed = extraData.complianceChecks.filter(c => c.passed).length;
      const total = extraData.complianceChecks.length;
      compStep.detail = `${passed}/${total} checks passed`;
    }
  }

  // Apply extra data: risk
  if (extraData?.riskLevel) {
    const riskStep = steps.find(s => s.id === 'risk');
    if (riskStep) {
      riskStep.riskData = {
        level: extraData.riskLevel,
        score: extraData.riskScore || 0,
        recommendation: extraData.finalityRecommendation || 'immediate',
      };
      riskStep.detail = `${extraData.riskLevel.toUpperCase()} (${extraData.riskScore}/100)`;
    }
  }

  // Apply extra data: solana signature (only for non-lockup, since lockup doesn't use settlement/confirmed steps)
  if (extraData?.solanaTxSignature && !hasLockup) {
    const settlementStep = steps.find(s => s.id === 'settlement');
    if (settlementStep) {
      settlementStep.solanaSignature = extraData.solanaTxSignature;
      settlementStep.detail = `Tx: ${extraData.solanaTxSignature.slice(0, 12)}...`;
    }
    const confirmedStep = steps.find(s => s.id === 'confirmed');
    if (confirmedStep) {
      confirmedStep.solanaSignature = extraData.solanaTxSignature;
      confirmedStep.detail = extraData.solanaSlot ? `Slot: ${extraData.solanaSlot}` : 'Finalized';
    }
  }

  // Determine completion
  let isComplete: boolean;
  if (hasLockup) {
    const ls = lockupData?.lockupStatus;
    isComplete = ls === 'hard_finality' || ls === 'reversed';
  } else {
    isComplete = txStatus === 'settled' || txStatus === 'locked' || txStatus === 'rejected' || txStatus === 'reversed';
  }

  return { ...pipeline, steps, isComplete, lockupData: lockupData || pipeline.lockupData };
}

// ============================================================
// Lockup Countdown Component
// ============================================================

function LockupCountdown({ lockupEnd }: { lockupEnd: string | null }) {
  const [remaining, setRemaining] = useState('');

  useEffect(() => {
    if (!lockupEnd) {
      setRemaining('\u221E');
      return;
    }
    const update = () => {
      const ms = new Date(lockupEnd).getTime() - Date.now();
      if (ms <= 0) {
        setRemaining('Expired');
        return;
      }
      const totalSecs = Math.ceil(ms / 1000);
      const m = Math.floor(totalSecs / 60);
      const s = totalSecs % 60;
      setRemaining(m > 0 ? `${m}m ${s}s` : `${s}s`);
    };
    update();
    const interval = setInterval(update, 1000);
    return () => clearInterval(interval);
  }, [lockupEnd]);

  const isInfinite = !lockupEnd;

  return (
    <span className={`text-[10px] font-mono ${isInfinite ? 'text-purple-400' : 'text-amber-400'}`}>
      {remaining}
    </span>
  );
}

// ============================================================
// Lockup step color utilities
// ============================================================

function getLockupStatusIconColor(step: PipelineStep): string {
  if (!step.lockupColor) return '';
  switch (step.lockupColor) {
    case 'amber': return 'text-amber-400';
    case 'blue': return 'text-blue-400';
    case 'red': return 'text-red-400';
    case 'purple': return 'text-purple-400';
    case 'green': return 'text-coda-brand';
    default: return '';
  }
}

function getLockupActiveBg(step: PipelineStep): string {
  if (!step.lockupColor || step.status !== 'active') return '';
  switch (step.lockupColor) {
    case 'amber': return 'animate-pulse';
    case 'red': return 'animate-pulse';
    case 'purple': return 'animate-pulse';
    default: return '';
  }
}

function getLockupBadgeStyle(step: PipelineStep): string {
  if (!step.lockupColor) return 'bg-coda-surface-hover text-coda-text-muted';
  switch (step.lockupColor) {
    case 'amber': return 'bg-amber-500/15 text-amber-400';
    case 'blue': return 'bg-blue-500/15 text-blue-400';
    case 'red': return 'bg-red-500/15 text-red-400';
    case 'purple': return 'bg-purple-500/15 text-purple-400';
    case 'green': return 'bg-emerald-500/15 text-emerald-400';
    default: return 'bg-coda-surface-hover text-coda-text-muted';
  }
}

// ============================================================
// Pipeline Tracker Component
// ============================================================

export function PipelineTracker({
  pipeline,
  compact = false,
}: {
  pipeline: TransactionPipeline;
  compact?: boolean;
}) {
  const [expandedSteps, setExpandedSteps] = useState<Set<string>>(new Set());
  const [elapsedMs, setElapsedMs] = useState(0);
  const [activeStepElapsed, setActiveStepElapsed] = useState(0);

  const isLockupPipeline = pipeline.steps.some(s => s.id === 'yb_mint');

  // Live timer
  useEffect(() => {
    if (pipeline.isComplete) return;
    const start = new Date(pipeline.startedAt).getTime();
    const interval = setInterval(() => {
      setElapsedMs(Date.now() - start);
    }, 100);
    return () => clearInterval(interval);
  }, [pipeline.startedAt, pipeline.isComplete]);

  // Active step elapsed timer
  useEffect(() => {
    if (pipeline.isComplete) return;
    const activeStep = pipeline.steps.find(s => s.status === 'active');
    if (!activeStep) return;

    // Find the timestamp of the last completed step (= when active step started)
    const completedSteps = pipeline.steps.filter(s => s.status === 'complete' && s.timestamp);
    const lastCompleteTime = completedSteps.length > 0
      ? Math.max(...completedSteps.map(s => new Date(s.timestamp!).getTime()))
      : new Date(pipeline.startedAt).getTime();

    const interval = setInterval(() => {
      setActiveStepElapsed(Date.now() - lastCompleteTime);
    }, 500);
    return () => clearInterval(interval);
  }, [pipeline.steps, pipeline.isComplete, pipeline.startedAt]);

  const toggleStep = (stepId: string) => {
    setExpandedSteps(prev => {
      const next = new Set(prev);
      if (next.has(stepId)) next.delete(stepId);
      else next.add(stepId);
      return next;
    });
  };

  const formatElapsed = (ms: number) => {
    if (ms < 1000) return `${ms}ms`;
    const s = ms / 1000;
    if (s < 60) return `${s.toFixed(1)}s`;
    return `${Math.floor(s / 60)}m ${Math.floor(s % 60)}s`;
  };

  const totalElapsed = pipeline.isComplete
    ? (() => {
        const lastTimestamp = [...pipeline.steps].reverse().find(s => s.timestamp)?.timestamp;
        if (lastTimestamp) {
          return new Date(lastTimestamp).getTime() - new Date(pipeline.startedAt).getTime();
        }
        return elapsedMs;
      })()
    : elapsedMs;

  const completedCount = pipeline.steps.filter(s => s.status === 'complete').length;
  const totalSteps = pipeline.steps.length;
  const progressPercent = Math.round((completedCount / totalSteps) * 100);

  // Find the currently active step
  const activeStep = pipeline.steps.find(s => s.status === 'active');
  const isStuck = activeStep && activeStepElapsed > 30_000; // >30s on one step

  // Determine border styling
  const isReversed = pipeline.lockupData?.lockupStatus === 'reversed';
  const borderClass = pipeline.isComplete
    ? (pipeline.steps.some(s => s.status === 'error') || isReversed)
      ? 'border-red-800/50 bg-red-950/10'
      : 'border-coda-brand/50 bg-coda-brand/5'
    : isLockupPipeline && activeStep?.lockupColor === 'amber'
      ? 'border-amber-800/40 bg-amber-950/10'
      : isLockupPipeline && activeStep?.lockupColor === 'purple'
        ? 'border-purple-800/40 bg-purple-950/10'
        : isLockupPipeline && activeStep?.lockupColor === 'red'
          ? 'border-red-800/40 bg-red-950/10'
          : 'border-blue-800/40 bg-blue-950/10';

  // Header dot color
  const dotClass = pipeline.isComplete
    ? (pipeline.steps.some(s => s.status === 'error') || isReversed) ? 'bg-red-400' : 'bg-coda-brand'
    : activeStep?.lockupColor === 'amber' ? 'bg-amber-400 animate-pulse'
      : activeStep?.lockupColor === 'purple' ? 'bg-purple-400 animate-pulse'
        : activeStep?.lockupColor === 'red' ? 'bg-red-400 animate-pulse'
          : 'bg-blue-400 animate-pulse';

  // Footer label
  const footerLabel = pipeline.isComplete
    ? isReversed ? 'Reversed'
      : pipeline.steps.some(s => s.status === 'error') ? 'Rejected'
        : isLockupPipeline ? 'Hard Finality' : 'Settled'
    : null;

  return (
    <div className={`rounded-lg border ${borderClass}`}>
      {/* Header */}
      <div className="px-3 py-2 border-b border-coda-border/50 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className={`w-2 h-2 rounded-full ${dotClass}`} />
          <span className="text-[12px] font-bold text-coda-text-secondary uppercase tracking-wider">
            {isLockupPipeline ? 'Lockup Pipeline' : 'Settlement Pipeline'}
          </span>
          <span className="text-[11px] text-coda-text-muted">
            {pipeline.senderCode} {'\u2192'} {pipeline.receiverCode}
          </span>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-[11px] text-coda-text-muted">
            {completedCount}/{totalSteps}
          </span>
          {/* Lockup countdown in header */}
          {isLockupPipeline && activeStep?.id === 'cadenza_monitor' && pipeline.lockupData && (
            <LockupCountdown lockupEnd={pipeline.lockupData.lockupEnd} />
          )}
          <span className={`text-[11px] ${pipeline.isComplete ? 'text-coda-text-muted' : 'text-blue-500 dark:text-blue-400'}`}>
            {formatElapsed(totalElapsed)}
          </span>
        </div>
      </div>

      {/* Progress bar */}
      <div className="h-0.5 bg-coda-surface-hover">
        <div
          className={`h-full transition-all duration-500 ${
            (pipeline.steps.some(s => s.status === 'error') || isReversed) ? 'bg-red-500'
            : isLockupPipeline && activeStep?.lockupColor === 'amber' ? 'bg-amber-500'
              : isLockupPipeline && activeStep?.lockupColor === 'purple' ? 'bg-purple-500'
                : 'bg-coda-brand'
          }`}
          style={{ width: `${progressPercent}%` }}
        />
      </div>

      {/* Steps */}
      <div className={`${compact ? 'px-3 py-2' : 'px-3 py-2.5'}`}>
        {pipeline.steps.map((step, idx) => {
          const Icon = STEP_ICONS[step.id] || CheckCircle2;
          const isExpanded = expandedSteps.has(step.id);
          const hasExpandableContent = step.substeps || step.riskData || step.solanaSignature;
          const isLast = idx === pipeline.steps.length - 1;
          const isActive = step.status === 'active';
          const isLockupStep = LOCKUP_STEP_IDS.includes(step.id);

          // Auto-expand compliance & risk when complete to show results
          // Also auto-expand active cadenza_monitor to show countdown
          const shouldShowContent = isExpanded || (isActive && (step.substeps || step.id === 'awaiting_receiver' || step.id === 'compliance' || step.id === 'cadenza_monitor'));

          // Color overrides for lockup steps
          const lockupIconColor = isLockupStep ? getLockupStatusIconColor(step) : '';
          const lockupPulse = isLockupStep ? getLockupActiveBg(step) : '';

          // Connector line color
          const connectorColor = step.status === 'complete'
            ? (step.lockupColor === 'red' ? 'bg-red-700/60'
              : step.lockupColor === 'green' ? 'bg-coda-brand/60'
                : 'bg-coda-brand/60')
            : step.status === 'error' ? 'bg-red-700/60'
              : step.status === 'active'
                ? (step.lockupColor === 'amber' ? 'bg-amber-700/40'
                  : step.lockupColor === 'purple' ? 'bg-purple-700/40'
                    : step.lockupColor === 'red' ? 'bg-red-700/40'
                      : 'bg-blue-700/40')
                : 'bg-coda-border/60';

          // Status icon rendering
          const renderStatusIcon = () => {
            if (step.status === 'active') {
              const activeColor = lockupIconColor || 'text-blue-500 dark:text-blue-400';
              return <Loader2 className={`w-[18px] h-[18px] ${activeColor} animate-spin ${lockupPulse}`} />;
            }
            if (step.status === 'complete') {
              const completeColor = step.lockupColor === 'red' ? 'bg-red-500/20' : 'bg-coda-brand/20';
              const checkColor = step.lockupColor === 'red' ? 'text-red-400' : 'text-coda-brand';
              return (
                <div className={`w-[18px] h-[18px] rounded-full ${completeColor} flex items-center justify-center`}>
                  <CheckCircle2 className={`w-3 h-3 ${checkColor}`} />
                </div>
              );
            }
            if (step.status === 'error') {
              return (
                <div className="w-[18px] h-[18px] rounded-full bg-red-500/20 flex items-center justify-center">
                  <XCircle className="w-3 h-3 text-red-400" />
                </div>
              );
            }
            // pending / skipped
            return (
              <div className="w-[18px] h-[18px] rounded-full bg-coda-surface-hover flex items-center justify-center">
                <div className={`w-1.5 h-1.5 rounded-full ${step.status === 'skipped' ? 'bg-coda-text-faint' : 'bg-coda-text-faint'}`} />
              </div>
            );
          };

          // Label color
          const labelColor = step.status === 'complete'
            ? (step.lockupColor === 'red' ? 'text-red-300' : 'text-coda-text-secondary')
            : step.status === 'active'
              ? (lockupIconColor ? `${lockupIconColor} font-medium` : 'text-blue-400 dark:text-blue-300 font-medium')
              : step.status === 'error' ? 'text-red-300'
                : step.status === 'skipped' ? 'text-coda-text-muted line-through'
                  : 'text-coda-text-muted';

          // Icon color
          const iconColor = step.status === 'complete'
            ? (step.lockupColor === 'red' ? 'text-red-400' : 'text-coda-brand')
            : step.status === 'active'
              ? (lockupIconColor || 'text-blue-500 dark:text-blue-400')
              : step.status === 'error' ? 'text-red-400'
                : 'text-coda-text-muted';

          // Detail badge style
          const badgeStyle = step.status === 'error' ? 'bg-red-500/15 text-red-400'
            : step.id === 'risk' && step.riskData
              ? step.riskData.level === 'low' ? 'bg-emerald-500/15 text-emerald-400'
                : step.riskData.level === 'high' ? 'bg-red-500/15 text-red-400'
                  : 'bg-yellow-500/15 text-yellow-400'
              : isLockupStep ? getLockupBadgeStyle(step)
                : 'bg-coda-surface-hover text-coda-text-muted';

          return (
            <div key={step.id} className="relative">
              {/* Connector line */}
              {!isLast && (
                <div className={`absolute left-[9px] top-[20px] w-[1px] ${connectorColor}`}
                  style={{ height: shouldShowContent ? 'calc(100% - 2px)' : '14px' }} />
              )}

              {/* Step row */}
              <div
                className={`flex items-center gap-2 py-[3px] ${hasExpandableContent ? 'cursor-pointer' : ''} group`}
                onClick={() => hasExpandableContent && toggleStep(step.id)}
              >
                {/* Status icon */}
                <div className="relative z-10 shrink-0">
                  {renderStatusIcon()}
                </div>

                {/* Label */}
                <Icon className={`w-3 h-3 shrink-0 ${iconColor}`} />
                <span className={`text-[12px] flex-1 ${labelColor}`}>
                  {step.label}
                </span>

                {/* Active step elapsed timer (not for cadenza_monitor which has countdown) */}
                {isActive && step.id !== 'cadenza_monitor' && (
                  <span className={`text-[10px] ${isStuck ? 'text-amber-400' : lockupIconColor || 'text-blue-500'}`}>
                    {formatElapsed(activeStepElapsed)}
                  </span>
                )}

                {/* Cadenza monitor countdown inline */}
                {isActive && step.id === 'cadenza_monitor' && pipeline.lockupData && (
                  <LockupCountdown lockupEnd={pipeline.lockupData.lockupEnd} />
                )}

                {/* Detail badge */}
                {step.detail && step.status !== 'pending' && (
                  <span className={`text-[10px] px-1.5 py-0.5 rounded ${badgeStyle}`}>
                    {step.detail}
                  </span>
                )}

                {/* Expand indicator */}
                {hasExpandableContent && (step.status === 'complete' || step.status === 'active') && (
                  <span className="text-coda-text-muted opacity-0 group-hover:opacity-100 transition-opacity">
                    {isExpanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
                  </span>
                )}
              </div>

              {/* Expanded / inline content */}
              {shouldShowContent && (step.status === 'complete' || step.status === 'active') && (
                <div className="ml-8 mb-2 mt-1 space-y-1">
                  {/* Awaiting Receiver -- inline guidance */}
                  {step.id === 'awaiting_receiver' && step.status === 'active' && (
                    <div className="space-y-1.5">
                      <div className="flex items-center gap-1.5 text-[10px] text-blue-500 dark:text-blue-400">
                        <ArrowDownToLine className="w-3 h-3 shrink-0 animate-bounce" />
                        <span>Receiver&apos;s Maestro agent is processing the payment request autonomously...</span>
                      </div>
                      {activeStepElapsed > 30_000 && (
                        <div className="flex items-start gap-1.5 text-[10px] text-amber-400/80 pl-[18px]">
                          <AlertTriangle className="w-3 h-3 shrink-0 mt-0.5" />
                          <span>
                            {activeStepElapsed > 90_000
                              ? `Waiting ${formatElapsed(activeStepElapsed)}. Receiver orchestration may have failed. Use Retry from Transaction Monitor.`
                              : `Waiting ${formatElapsed(activeStepElapsed)}. Receiver agent is running compliance, risk, and decision pipeline...`
                            }
                          </span>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Cadenza Monitor -- expanded lockup info */}
                  {step.id === 'cadenza_monitor' && step.status === 'active' && pipeline.lockupData && (
                    <div className="space-y-1.5">
                      <div className={`flex items-center gap-1.5 text-[10px] ${!pipeline.lockupData.lockupEnd ? 'text-purple-400' : 'text-amber-400'}`}>
                        <Eye className="w-3 h-3 shrink-0" />
                        <span>
                          {!pipeline.lockupData.lockupEnd
                            ? 'Indefinite lockup \u2014 high risk transaction under escalated monitoring. Awaiting human review.'
                            : 'Cadenza agent is monitoring this lockup for anomalies. Yield is accruing on the locked tokens.'
                          }
                        </span>
                      </div>
                      {pipeline.lockupData.lockupEnd && (
                        <div className="flex items-center gap-1.5 text-[10px] text-coda-text-muted pl-[18px]">
                          <Clock className="w-3 h-3 shrink-0" />
                          <span>Lockup expires: {new Date(pipeline.lockupData.lockupEnd).toLocaleTimeString()}</span>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Compliance Check -- show sub-checks inline when active or complete */}
                  {step.id === 'compliance' && step.status === 'active' && !step.substeps && (
                    <div className="space-y-1">
                      <div className="text-[10px] text-blue-500 dark:text-blue-400 mb-1.5">
                        Running compliance checks...
                      </div>
                      {ALL_COMPLIANCE_CHECKS.map((checkType, i) => (
                        <div key={checkType} className="flex items-center gap-1.5 text-[11px]">
                          <Loader2 className="w-3 h-3 text-blue-500/50 animate-spin shrink-0" style={{ animationDelay: `${i * 200}ms` }} />
                          <span className="text-coda-text-muted">{COMPLIANCE_CHECK_LABELS[checkType] || checkType}</span>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Substeps (compliance checks -- results) */}
                  {step.substeps?.map((sub, i) => (
                    <div key={i} className="flex items-start gap-1.5 text-[11px]">
                      {sub.passed ? (
                        <CheckCircle2 className="w-3 h-3 text-emerald-500 shrink-0 mt-0.5" />
                      ) : (
                        <XCircle className="w-3 h-3 text-red-500 shrink-0 mt-0.5" />
                      )}
                      <div>
                        <span className="text-coda-text-muted">{COMPLIANCE_CHECK_LABELS[sub.label] || sub.label.replace(/_/g, ' ')}</span>
                        <span className="text-coda-text-muted ml-1">{'\u2014'} {sub.detail}</span>
                      </div>
                    </div>
                  ))}

                  {/* Risk data */}
                  {step.riskData && (
                    <div className="grid grid-cols-3 gap-2 p-2 rounded bg-coda-surface-alt/50 border border-coda-border/50">
                      <div>
                        <div className="text-[9px] text-coda-text-muted uppercase">Level</div>
                        <div className={`text-[12px] font-bold ${
                          step.riskData.level === 'low' ? 'text-emerald-400' :
                          step.riskData.level === 'high' ? 'text-red-400' :
                          'text-yellow-400'
                        }`}>{step.riskData.level.toUpperCase()}</div>
                      </div>
                      <div>
                        <div className="text-[9px] text-coda-text-muted uppercase">Score</div>
                        <div className="text-[12px] text-coda-text-secondary">{step.riskData.score}/100</div>
                      </div>
                      <div>
                        <div className="text-[9px] text-coda-text-muted uppercase">Finality</div>
                        <div className="text-[12px] text-coda-text-secondary">{step.riskData.recommendation.replace(/_/g, ' ')}</div>
                      </div>
                    </div>
                  )}

                  {/* Solana signature */}
                  {step.solanaSignature && (
                    <a
                      href={`https://explorer.solana.com/tx/${step.solanaSignature}?cluster=${import.meta.env.VITE_SOLANA_CLUSTER || 'devnet'}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-[11px] text-blue-500 dark:text-blue-400 hover:text-blue-400 dark:hover:text-blue-300 transition-colors"
                    >
                      <Link2 className="w-3 h-3" />
                      View on Solana Explorer
                    </a>
                  )}

                  {/* Hint text */}
                  {step.hint && step.status === 'active' && step.id !== 'awaiting_receiver' && (
                    <div className="text-[9px] text-coda-text-muted italic pl-1">
                      {step.hint}
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Footer -- transaction ID + active step label */}
      <div className="px-3 py-1.5 border-t border-coda-border/30 flex items-center justify-between">
        <span className="text-[10px] font-mono text-coda-text-muted">
          TX: {pipeline.transactionId.slice(0, 8)}...{pipeline.transactionId.slice(-4)}
        </span>
        {footerLabel ? (
          <span className={`text-[10px] font-bold uppercase tracking-wider ${
            (isReversed || pipeline.steps.some(s => s.status === 'error')) ? 'text-red-400' : 'text-coda-brand'
          }`}>
            {footerLabel}
          </span>
        ) : activeStep && (
          <span className={`text-[10px] animate-pulse ${
            activeStep.lockupColor === 'amber' ? 'text-amber-400'
            : activeStep.lockupColor === 'purple' ? 'text-purple-400'
              : activeStep.lockupColor === 'red' ? 'text-red-400'
                : 'text-blue-500 dark:text-blue-400'
          }`}>
            {activeStep.label}...
          </span>
        )}
      </div>
    </div>
  );
}

// ============================================================
// Mini pipeline for activity feed
// ============================================================

export function MiniPipeline({ pipeline }: { pipeline: TransactionPipeline }) {
  const completedCount = pipeline.steps.filter(s => s.status === 'complete').length;
  const hasError = pipeline.steps.some(s => s.status === 'error');

  return (
    <div className="flex items-center gap-1">
      {pipeline.steps.map((step) => (
        <div
          key={step.id}
          className={`w-1.5 h-1.5 rounded-full transition-colors ${
            step.status === 'complete'
              ? (step.lockupColor === 'red' ? 'bg-red-400' : 'bg-coda-brand')
              : step.status === 'active'
                ? (step.lockupColor === 'amber' ? 'bg-amber-400 animate-pulse'
                  : step.lockupColor === 'purple' ? 'bg-purple-400 animate-pulse'
                    : step.lockupColor === 'red' ? 'bg-red-400 animate-pulse'
                      : 'bg-blue-400 animate-pulse')
                : step.status === 'error' ? 'bg-red-400'
                  : 'bg-coda-text-faint'
          }`}
          title={`${step.label}: ${step.status}`}
        />
      ))}
      <span className={`text-[10px] ml-1 ${
        hasError ? 'text-red-400' :
        completedCount === pipeline.steps.length ? 'text-coda-brand' :
        'text-coda-text-muted'
      }`}>
        {completedCount}/{pipeline.steps.length}
      </span>
    </div>
  );
}