import { useState, useEffect, useRef } from 'react';
import { ChevronDown, Loader2, Activity, ExternalLink, CheckCircle2 } from 'lucide-react';
import { useNavigate } from 'react-router';
import type { TransactionGroup } from './TransactionLifecycle';
import { StepProgressSidebar } from './AgentActivityFeed';
import type { TransactionPipeline } from './PipelineTracker';

// ============================================================
// Helpers
// ============================================================

const fmtAmount = (n: number) =>
  n >= 1000 ? `$${n.toLocaleString()}` : `$${n}`;

const fmtTime = (ts?: string) => {
  if (!ts) return '';
  try {
    return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  } catch {
    return '';
  }
};

// ============================================================
// Compact Live Transaction Card (for sidebar)
// ============================================================

function SidebarLiveCard({
  group,
  elapsedMs,
}: {
  group: TransactionGroup;
  elapsedMs: number;
}) {
  const navigate = useNavigate();
  const { pipeline } = group;
  const isComplete = pipeline.isComplete;
  const isRejected = pipeline.steps.some(s => s.status === 'error');
  const completedCount = pipeline.steps.filter(s => s.status === 'complete').length;
  const totalSteps = pipeline.steps.length;
  const progressPercent = Math.round((completedCount / totalSteps) * 100);

  const formatElapsed = (ms: number) => {
    if (ms < 1000) return `${ms}ms`;
    const s = ms / 1000;
    if (s < 60) return `${s.toFixed(1)}s`;
    return `${Math.floor(s / 60)}m ${Math.floor(s % 60)}s`;
  };

  return (
    <div className="rounded-xl overflow-hidden transition-all duration-300 border border-coda-border-subtle bg-black/[0.02] dark:bg-white/[0.03] backdrop-blur-sm">
      {/* Header */}
      <div className="px-3 py-2 flex items-center gap-2">
        {isComplete ? (
          isRejected ? (
            <div className="w-1.5 h-1.5 rounded-full bg-red-500 shrink-0" />
          ) : (
            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 dark:text-emerald-400 shrink-0" />
          )
        ) : (
          <Loader2 className="w-3.5 h-3.5 text-emerald-500 dark:text-emerald-400 animate-spin shrink-0" />
        )}
        <span className="text-[9px] tracking-wider text-coda-text-muted font-mono">
          TX-{pipeline.transactionId.slice(0, 6)}
        </span>
        <span className="text-[13px] font-medium text-coda-text font-mono tracking-tight">
          {fmtAmount(pipeline.amount)}
        </span>
        <span className={`text-[8px] font-medium ml-auto font-mono ${
          isComplete
            ? isRejected ? 'text-red-500' : 'text-emerald-500 dark:text-emerald-400'
            : 'text-coda-text-muted'
        }`}>
          {isComplete ? (isRejected ? 'REJECTED' : 'SETTLED') : formatElapsed(elapsedMs)}
        </span>
      </div>

      {/* Route */}
      <div className="px-3 pb-1.5 flex items-center gap-1">
        <span className="bg-blue-500/10 text-blue-600 dark:text-blue-400 px-1.5 py-0.5 rounded text-[8px] font-medium font-mono">
          {pipeline.senderCode}
        </span>
        <span className="text-coda-text-muted text-[8px]">→</span>
        <span className="bg-coda-brand/10 text-coda-brand px-1.5 py-0.5 rounded text-[8px] font-medium font-mono">
          {pipeline.receiverCode}
        </span>
      </div>

      {/* Progress bar */}
      <div className="h-[2px] bg-black/[0.04] dark:bg-white/[0.06] mx-3 rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-500 ${
            isComplete
              ? isRejected ? 'bg-red-500' : 'bg-emerald-500 dark:bg-emerald-400'
              : 'bg-emerald-500 dark:bg-emerald-400'
          }`}
          style={{ width: `${progressPercent}%` }}
        />
      </div>

      {/* Step progress */}
      <div className="px-3 py-2 flex items-center gap-2">
        <div className="flex-1 min-w-0">
          <StepProgressSidebar pipeline={pipeline} />
        </div>
        <button
          onClick={() => navigate(`/transactions/${pipeline.transactionId}`)}
          className="shrink-0 text-[8px] text-coda-text-muted hover:text-blue-500 transition-colors font-mono flex items-center gap-0.5"
          title="View details"
        >
          <ExternalLink className="w-2.5 h-2.5" />
        </button>
      </div>
    </div>
  );
}

// ============================================================
// Compact Completed Transaction Row (for sidebar)
// ============================================================

function SidebarCompletedRow({
  group,
  isOpen,
  onToggle,
}: {
  group: TransactionGroup;
  isOpen: boolean;
  onToggle: () => void;
}) {
  const navigate = useNavigate();
  const { pipeline } = group;
  const isRejected = pipeline.steps.some(s => s.status === 'error');

  return (
    <div className={`rounded-xl overflow-hidden transition-all duration-200 ${
      isOpen ? 'bg-black/[0.02] dark:bg-white/[0.03] border border-coda-border-subtle' : 'hover:bg-black/[0.01] dark:hover:bg-white/[0.02]'
    }`}>
      <button
        onClick={onToggle}
        className="w-full px-3 py-2 flex items-center gap-2 text-left"
      >
        {isRejected ? (
          <div className="w-1.5 h-1.5 rounded-full bg-red-500 shrink-0" />
        ) : (
          <CheckCircle2 className="w-3 h-3 text-emerald-500 dark:text-emerald-400 shrink-0" />
        )}
        <span className="text-[9px] tracking-wider text-coda-text-muted font-mono">
          TX-{pipeline.transactionId.slice(0, 6)}
        </span>
        <span className="text-[12px] font-medium text-coda-text font-mono tracking-tight">
          {fmtAmount(pipeline.amount)}
        </span>
        <div className="flex items-center gap-1 ml-auto">
          <span className="text-[8px] text-coda-text-muted font-mono">
            {fmtTime(pipeline.startedAt)}
          </span>
          <ChevronDown className={`w-2.5 h-2.5 text-coda-text-muted transition-transform duration-150 ${
            isOpen ? 'rotate-180' : ''
          }`} />
        </div>
      </button>

      {isOpen && (
        <div className="px-3 pb-2 border-t border-coda-border/10 pt-1.5">
          {/* Route */}
          <div className="flex items-center gap-1 mb-2">
            <span className="bg-blue-500/10 text-blue-600 dark:text-blue-400 px-1.5 py-0.5 rounded text-[8px] font-medium font-mono">
              {pipeline.senderCode}
            </span>
            <span className="text-coda-text-muted text-[8px]">→</span>
            <span className="bg-coda-brand/10 text-coda-brand px-1.5 py-0.5 rounded text-[8px] font-medium font-mono">
              {pipeline.receiverCode}
            </span>
            <span className={`text-[8px] font-medium ml-auto px-1.5 py-0.5 rounded font-mono ${
              isRejected
                ? 'bg-red-500/10 text-red-500'
                : 'bg-emerald-500/10 text-emerald-500'
            }`}>
              {isRejected ? 'REJECTED' : 'SETTLED'}
            </span>
          </div>
          <StepProgressSidebar pipeline={pipeline} />
          <button
            onClick={() => navigate(`/transactions/${pipeline.transactionId}`)}
            className="mt-2 w-full text-center text-[9px] text-coda-text-muted hover:text-blue-500 transition-colors font-mono flex items-center justify-center gap-1"
          >
            <ExternalLink className="w-2.5 h-2.5" />
            View Details
          </button>
        </div>
      )}
    </div>
  );
}

// ============================================================
// Pending Pipeline Card (for sidebar)
// ============================================================

function SidebarPendingCard({
  pipeline,
  bankCode,
  thinkingStep,
  elapsed,
}: {
  pipeline: TransactionPipeline;
  bankCode: string;
  thinkingStep: string;
  elapsed: number;
}) {
  return (
    <div className="rounded-xl overflow-hidden border border-coda-border-subtle bg-black/[0.02] dark:bg-white/[0.03] backdrop-blur-sm">
      <div className="px-3 py-2 flex items-center gap-2">
        <Loader2 className="w-3.5 h-3.5 text-emerald-500 dark:text-emerald-400 animate-spin shrink-0" />
        <span className="text-[9px] tracking-wider text-coda-text-muted font-mono">PENDING</span>
        <span className="text-[12px] font-medium text-coda-text font-mono tracking-tight">...</span>
        <span className="text-[8px] font-medium text-coda-text-muted font-mono ml-auto">
          {(elapsed / 1000).toFixed(1)}s
        </span>
      </div>
      <div className="px-3 pb-2 flex items-center gap-1.5">
        <span className="text-[9px] font-mono text-emerald-600 dark:text-emerald-400 truncate">{thinkingStep}</span>
      </div>
      <div className="h-[2px] bg-black/[0.04] dark:bg-white/[0.06] mx-3 rounded-full mb-2">
        <div className="h-full w-[8%] bg-emerald-500 dark:bg-emerald-400 rounded-full" />
      </div>
    </div>
  );
}

// ============================================================
// Transaction Sidebar — floating right panel
// ============================================================

export function TransactionSidebar({
  activeGroups,
  completedGroups,
  pendingPipeline,
  thinkingActive,
  thinkingStep,
  thinkingElapsed,
  bankCode,
  now,
}: {
  activeGroups: TransactionGroup[];
  completedGroups: TransactionGroup[];
  pendingPipeline: TransactionPipeline | null;
  thinkingActive: boolean;
  thinkingStep: string;
  thinkingElapsed: number;
  bankCode: string;
  now: number;
}) {
  const [openTxId, setOpenTxId] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();

  const totalCount = activeGroups.length + completedGroups.length + (pendingPipeline ? 1 : 0);
  const settledCount = completedGroups.filter(
    g => !g.pipeline.steps.some(s => s.status === 'error')
  ).length;

  // Auto-scroll when active transactions change
  useEffect(() => {
    if (scrollRef.current && activeGroups.length > 0) {
      scrollRef.current.scrollTop = 0; // Keep active at top
    }
  }, [activeGroups.length]);

  return (
    <div className="h-full flex flex-col">
      {/* Sidebar header */}
      <div className="px-4 py-4 border-b border-black/[0.06] dark:border-white/[0.06]">
        <div className="flex items-center gap-2 mb-2">
          <Activity className="w-4 h-4 text-coda-text-muted" />
          <span className="text-sm font-medium text-coda-text">Transactions</span>
        </div>
        <div className="flex items-center gap-3">
          <div className="text-center">
            <div className="text-[8px] uppercase tracking-wider text-coda-text-muted font-mono">Total</div>
            <div className="text-[14px] font-medium font-mono text-coda-text">{totalCount}</div>
          </div>
          <div className="text-center">
            <div className="text-[8px] uppercase tracking-wider text-coda-text-muted font-mono">Active</div>
            <div className="text-[14px] font-medium font-mono text-amber-500">{activeGroups.length}</div>
          </div>
          <div className="text-center">
            <div className="text-[8px] uppercase tracking-wider text-coda-text-muted font-mono">Settled</div>
            <div className="text-[14px] font-medium font-mono text-emerald-500">{settledCount}</div>
          </div>
        </div>
      </div>

      {/* Scrollable transaction list */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-3 py-3 space-y-2 scrollbar-thin">
        {/* Pending */}
        {pendingPipeline && thinkingActive && (
          <SidebarPendingCard
            pipeline={pendingPipeline}
            bankCode={bankCode}
            thinkingStep={thinkingStep}
            elapsed={thinkingElapsed}
          />
        )}

        {/* Active transactions */}
        {activeGroups.map(group => (
          <SidebarLiveCard
            key={group.id}
            group={group}
            elapsedMs={now - new Date(group.pipeline.startedAt).getTime()}
          />
        ))}

        {/* Divider between active and completed */}
        {activeGroups.length > 0 && completedGroups.length > 0 && (
          <div className="flex items-center gap-2 py-1">
            <div className="h-px flex-1 bg-coda-border/15" />
            <span className="text-[8px] uppercase tracking-widest text-coda-text-muted font-mono">
              History
            </span>
            <div className="h-px flex-1 bg-coda-border/15" />
          </div>
        )}

        {/* Completed transactions */}
        {completedGroups.map(group => (
          <SidebarCompletedRow
            key={group.id}
            group={group}
            isOpen={openTxId === group.id}
            onToggle={() => setOpenTxId(openTxId === group.id ? null : group.id)}
          />
        ))}

        {/* Empty state */}
        {totalCount === 0 && (
          <div className="flex flex-col items-center justify-center py-8 text-center">
            <Activity className="w-6 h-6 text-coda-text-muted/30 mb-2" />
            <span className="text-[10px] text-coda-text-muted font-mono">
              No transactions yet
            </span>
            <span className="text-[9px] text-coda-text-muted/60 font-mono mt-0.5">
              Send a payment to get started
            </span>
          </div>
        )}
      </div>
    </div>
  );
}