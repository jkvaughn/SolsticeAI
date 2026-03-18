/**
 * PipelineWaterfall — Compact 2-column pipeline checklist
 *
 * Renders inside each transaction card in the LivePipelineProgress section.
 * Shows the 9-step settlement pipeline as a checklist with emerald checkmarks
 * (completed), animated spinner (active), and dim circles (pending).
 *
 * Driven by real Supabase Realtime status updates — each backend status change
 * (initiated → compliance_check → risk_scored → executing → settled) triggers
 * a re-render with smooth CSS transitions on icons and labels.
 *
 * Status-to-step mapping reused from PipelineTracker.tsx.
 */

import { Check, Loader2, Circle, XCircle, AlertTriangle } from 'lucide-react';

// ── Pipeline step definitions ────────────────────────────────

interface StepDef {
  id: string;
  label: string;
}

const STEPS: StepDef[] = [
  { id: 'reasoning',          label: 'Agent Reasoning' },
  { id: 'tx_created',         label: 'Tx Created' },
  { id: 'request_sent',       label: 'Request Sent' },
  { id: 'awaiting_receiver',  label: 'Awaiting Receiver' },
  { id: 'compliance',         label: 'Compliance Check' },
  { id: 'risk',               label: 'Risk Assessment' },
  { id: 'decision',           label: 'Agent Decision' },
  { id: 'settlement',         label: 'On-chain Settlement' },
  { id: 'confirmed',          label: 'Confirmed' },
];

// ── Status → completed step IDs ──────────────────────────────

const STATUS_COMPLETED_STEPS: Record<string, string[]> = {
  initiated:        ['reasoning', 'tx_created', 'request_sent'],
  compliance_check: ['reasoning', 'tx_created', 'request_sent', 'awaiting_receiver', 'compliance'],
  risk_scored:      ['reasoning', 'tx_created', 'request_sent', 'awaiting_receiver', 'compliance', 'risk'],
  executing:        ['reasoning', 'tx_created', 'request_sent', 'awaiting_receiver', 'compliance', 'risk', 'decision'],
  settled:          ['reasoning', 'tx_created', 'request_sent', 'awaiting_receiver', 'compliance', 'risk', 'decision', 'settlement', 'confirmed'],
  locked:           ['reasoning', 'tx_created', 'request_sent', 'awaiting_receiver', 'compliance', 'risk', 'decision', 'settlement', 'confirmed'],
  rejected:         ['reasoning', 'tx_created', 'request_sent', 'awaiting_receiver', 'compliance', 'risk', 'decision'],
  reversed:         ['reasoning', 'tx_created', 'request_sent', 'awaiting_receiver', 'compliance', 'risk', 'decision', 'settlement', 'confirmed'],
};

// Active step = the step currently processing (spinner).
// Every non-terminal status shows what's in progress next.
const STATUS_ACTIVE_STEP: Record<string, string> = {
  initiated:        'awaiting_receiver',
  compliance_check: 'risk',
  risk_scored:      'decision',
  executing:        'settlement',
};

/** Map status → total completed steps (exported for parent use) */
export const STATUS_STEP_COUNT: Record<string, number> = {
  initiated: 3,
  compliance_check: 5,
  risk_scored: 6,
  executing: 7,
  settled: 9,
  locked: 9,
  rejected: 7,
  reversed: 9,
};

// ── Component ────────────────────────────────────────────────

export interface PipelineWaterfallProps {
  status: string;
  /**
   * Optional override: number of steps to show as completed (0–9).
   * When provided, step-by-step animation is driven by the parent.
   * First N steps get checkmarks, step N+1 gets spinner, rest pending.
   * Terminal icons only appear when animation reaches the target.
   */
  animatedStepCount?: number;
}

export function PipelineWaterfall({ status, animatedStepCount }: PipelineWaterfallProps) {
  const useAnimated = animatedStepCount !== undefined;
  const targetCount = STATUS_STEP_COUNT[status] ?? 0;
  const isAtTarget = useAnimated ? animatedStepCount >= targetCount : true;

  let completedSet: Set<string>;
  let activeStepId: string | null;

  if (useAnimated) {
    const count = Math.max(0, Math.min(animatedStepCount, STEPS.length));
    completedSet = new Set(STEPS.slice(0, count).map(s => s.id));
    activeStepId = count < STEPS.length ? STEPS[count].id : null;
  } else {
    completedSet = new Set(STATUS_COMPLETED_STEPS[status] || []);
    activeStepId = STATUS_ACTIVE_STEP[status] || null;
  }

  const isRejected = status === 'rejected';
  const isLocked = status === 'locked';

  // Split into 2 columns: 5 left, 4 right
  const leftSteps = STEPS.slice(0, 5);
  const rightSteps = STEPS.slice(5);

  const renderStep = (step: StepDef) => {
    const isCompleted = completedSet.has(step.id);
    const isActive = step.id === activeStepId;

    // Terminal icon on the last completed step for rejected/locked
    const completedArr = useAnimated
      ? STEPS.slice(0, animatedStepCount!).map(s => s.id)
      : (STATUS_COMPLETED_STEPS[status] || []);
    const isFinalStep = isCompleted && step.id === completedArr[completedArr.length - 1];
    const showRejectIcon = isRejected && isFinalStep && isAtTarget;
    const showLockIcon = isLocked && isFinalStep && isAtTarget;

    return (
      <div
        key={step.id}
        className="flex items-center gap-1.5 transition-all duration-300"
      >
        {/* Status icon with smooth transitions */}
        <div className="relative w-[13px] h-[13px] shrink-0">
          {showRejectIcon ? (
            <XCircle size={13} className="text-red-400 transition-colors duration-300" />
          ) : showLockIcon ? (
            <AlertTriangle size={13} className="text-amber-400 transition-colors duration-300" />
          ) : isActive ? (
            <Loader2 size={13} className="text-emerald-400 animate-spin" />
          ) : isCompleted ? (
            <div className="w-[13px] h-[13px] rounded-full bg-emerald-500/20 flex items-center justify-center transition-all duration-300">
              <Check size={9} strokeWidth={3} className="text-emerald-400" />
            </div>
          ) : (
            <Circle size={13} className="text-coda-text-muted/30 transition-colors duration-300" />
          )}
        </div>

        {/* Label */}
        <span
          className={`text-[10px] font-mono leading-none transition-colors duration-300 ${
            isCompleted
              ? showRejectIcon
                ? 'text-red-400/80'
                : showLockIcon
                  ? 'text-amber-400/80'
                  : 'text-coda-text-secondary'
              : isActive
                ? 'text-emerald-400'
                : 'text-coda-text-muted/50'
          }`}
        >
          {step.label}
        </span>
      </div>
    );
  };

  return (
    <div
      className="grid grid-cols-2 gap-x-4 gap-y-1 mt-2 pt-2 border-t border-coda-border-subtle"
      onClick={(e) => e.stopPropagation()}
    >
      {/* Left column */}
      <div className="flex flex-col gap-1">
        {leftSteps.map(renderStep)}
      </div>
      {/* Right column */}
      <div className="flex flex-col gap-1">
        {rightSteps.map(renderStep)}
      </div>
    </div>
  );
}