import { useState, useEffect, useRef, useMemo } from 'react';
import { ChevronDown, CheckCircle2, Loader2, Circle } from 'lucide-react';
import type { AgentMessage } from '../../types';
import type { TransactionPipeline } from './PipelineTracker';

// ============================================================
// Types
// ============================================================

interface FeedItem {
  id: string;
  ts: number;
  from: 'maestro' | 'concord' | 'fermata' | 'canto' | 'solana';
  to?: 'maestro' | 'concord' | 'fermata' | 'canto' | 'solana' | 'network';
  text: string;
  detail?: string;
  type: 'dispatch' | 'process' | 'result' | 'blockchain' | 'error';
  status?: 'active' | 'complete' | 'error';
}

// ============================================================
// Agent config — Option B: Single Brand Accent (Swiss financial)
// All agents use neutral glass. Distinguished by icon + monogram + name.
// Color conveys STATUS only (green=pass, red=fail, neutral=pending).
// Active agent gets brand ring/glow.
// ============================================================

const AGENT_CONFIG = {
  maestro:  { icon: '↗', mono: 'Ma', name: 'Maestro',  role: 'Orchestrator' },
  concord:  { icon: '◈', mono: 'Co', name: 'Concord',  role: 'Compliance' },
  fermata:  { icon: '△', mono: 'Fe', name: 'Fermata',  role: 'Risk' },
  canto:    { icon: '⟿', mono: 'Ca', name: 'Canto',    role: 'Settlement' },
  solana:   { icon: '◎', mono: 'So', name: 'Solana',   role: 'Network' },
} as const;

// ============================================================
// Build granular inter-agent feed items
// ============================================================

export function buildFeedItems(
  pipeline: TransactionPipeline,
  messages: AgentMessage[],
): FeedItem[] {
  const items: FeedItem[] = [];
  const msgIds = new Set<string>();
  const baseTs = new Date(pipeline.startedAt).getTime();

  for (const step of pipeline.steps) {
    if (step.status === 'pending') continue;

    const ts = step.timestamp
      ? new Date(step.timestamp).getTime()
      : baseTs;

    switch (step.id) {
      case 'reasoning':
        items.push({
          id: 'feed-reasoning',
          ts,
          from: 'maestro',
          text: 'Analyzing payment instruction via Gemini 2.5 Flash...',
          type: 'process',
          status: step.status === 'active' ? 'active' : 'complete',
        });
        if (step.status === 'complete') {
          items.push({
            id: 'feed-reasoning-done',
            ts: ts + 1,
            from: 'maestro',
            text: `Parsed: Send $${pipeline.amount.toLocaleString()} ${pipeline.senderCode} → ${pipeline.receiverCode}`,
            type: 'result',
            status: 'complete',
          });
        }
        break;

      case 'tx_created':
        if (step.status === 'complete') {
          items.push({
            id: 'feed-tx-created',
            ts,
            from: 'maestro',
            to: 'network',
            text: `Transaction record created: ${pipeline.transactionId.slice(0, 12)}...`,
            type: 'blockchain',
            status: 'complete',
          });
        }
        break;

      case 'request_sent':
        if (step.status === 'complete') {
          items.push({
            id: 'feed-request-sent',
            ts,
            from: 'maestro',
            to: 'maestro',
            text: `Dispatching payment request to ${pipeline.receiverCode} Maestro agent`,
            type: 'dispatch',
            status: 'complete',
          });
        }
        break;

      case 'awaiting_receiver':
        if (step.status === 'active') {
          items.push({
            id: 'feed-awaiting',
            ts,
            from: 'maestro',
            text: `Waiting for ${pipeline.receiverCode} agent to pick up request...`,
            type: 'process',
            status: 'active',
          });
        } else if (step.status === 'complete') {
          items.push({
            id: 'feed-awaiting',
            ts,
            from: 'maestro',
            text: `${pipeline.receiverCode} agent acknowledged — beginning verification pipeline`,
            type: 'result',
            status: 'complete',
          });
        }
        break;

      case 'compliance':
        if (step.status === 'active' || step.status === 'complete') {
          items.push({
            id: 'feed-comp-handoff',
            ts,
            from: 'maestro',
            to: 'concord',
            text: `Routing to Concord for compliance verification`,
            type: 'dispatch',
            status: 'complete',
          });
        }

        if (step.substeps && step.substeps.length > 0) {
          for (let i = 0; i < step.substeps.length; i++) {
            const sub = step.substeps[i];
            const checkName = sub.label.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
            items.push({
              id: `feed-comp-check-${i}`,
              ts: ts + i + 1,
              from: 'concord',
              text: `${sub.passed ? '✓' : '✗'} ${checkName}`,
              detail: sub.detail,
              type: sub.passed ? 'result' : 'error',
              status: sub.passed ? 'complete' : 'error',
            });
          }
        }

        if (step.status === 'complete') {
          const passCount = step.substeps?.filter(s => s.passed).length || 0;
          const totalCount = step.substeps?.length || 0;
          items.push({
            id: 'feed-comp-summary',
            ts: ts + 10,
            from: 'concord',
            to: 'maestro',
            text: `Compliance complete: ${passCount}/${totalCount} checks passed → APPROVE`,
            type: 'dispatch',
            status: 'complete',
          });
        }

        if (step.status === 'active' && (!step.substeps || step.substeps.length === 0)) {
          items.push({
            id: 'feed-comp-running',
            ts: ts + 1,
            from: 'concord',
            text: 'Running compliance checks...',
            type: 'process',
            status: 'active',
          });
        }
        break;

      case 'risk':
        if (step.status === 'active' || step.status === 'complete') {
          items.push({
            id: 'feed-risk-handoff',
            ts,
            from: 'maestro',
            to: 'fermata',
            text: 'Routing to Fermata for risk assessment',
            type: 'dispatch',
            status: 'complete',
          });
        }

        if (step.status === 'active') {
          items.push({
            id: 'feed-risk-calc',
            ts: ts + 1,
            from: 'fermata',
            text: 'Calculating risk score via Gemini — LCR impact analysis...',
            type: 'process',
            status: 'active',
          });
        }

        if (step.riskData) {
          const lvl = step.riskData.level.toUpperCase();
          items.push({
            id: 'feed-risk-score',
            ts: ts + 2,
            from: 'fermata',
            text: `Risk level: ${lvl} — Score: ${step.riskData.score}/100`,
            type: 'result',
            status: 'complete',
          });
          items.push({
            id: 'feed-risk-report',
            ts: ts + 3,
            from: 'fermata',
            to: 'maestro',
            text: `Assessment complete. Finality: ${step.riskData.recommendation.replace(/_/g, ' ')}`,
            type: 'dispatch',
            status: 'complete',
          });
        } else if (step.status === 'complete') {
          items.push({
            id: 'feed-risk-done',
            ts: ts + 2,
            from: 'fermata',
            to: 'maestro',
            text: step.detail || 'Risk assessment complete',
            type: 'dispatch',
            status: 'complete',
          });
        }
        break;

      case 'decision':
        if (step.status === 'complete') {
          items.push({
            id: 'feed-decision',
            ts,
            from: 'maestro',
            text: 'All verifications passed — ACCEPTING payment',
            detail: step.detail,
            type: 'result',
            status: 'complete',
          });
          items.push({
            id: 'feed-decision-route',
            ts: ts + 1,
            from: 'maestro',
            to: 'canto',
            text: 'Routing to Canto for on-chain settlement',
            type: 'dispatch',
            status: 'complete',
          });
        } else if (step.status === 'error') {
          items.push({
            id: 'feed-decision',
            ts,
            from: 'maestro',
            text: step.detail || 'Verification failed — REJECTING payment',
            type: 'error',
            status: 'error',
          });
        }
        break;

      case 'settlement':
        if (step.status === 'active') {
          items.push({
            id: 'feed-settle-start',
            ts,
            from: 'canto',
            text: 'Building atomic burn-and-mint transaction...',
            type: 'process',
            status: 'active',
          });
          items.push({
            id: 'feed-settle-chain',
            ts: ts + 1,
            from: 'canto',
            to: 'solana',
            text: 'Submitting to Solana Devnet...',
            type: 'blockchain',
            status: 'active',
          });
        }
        if (step.solanaSignature) {
          items.push({
            id: 'feed-settle-sig',
            ts: ts + 2,
            from: 'solana',
            to: 'canto',
            text: `TX confirmed: ${step.solanaSignature.slice(0, 20)}...`,
            type: 'blockchain',
            status: 'complete',
          });
        }
        if (step.status === 'complete') {
          items.push({
            id: 'feed-settle-done',
            ts: ts + 3,
            from: 'canto',
            text: 'On-chain settlement executed successfully',
            type: 'result',
            status: 'complete',
          });
        }
        break;

      case 'confirmed':
        if (step.status === 'complete') {
          items.push({
            id: 'feed-confirmed',
            ts,
            from: 'canto',
            to: 'maestro',
            text: 'Settlement confirmed — both wallets updated',
            type: 'dispatch',
            status: 'complete',
          });
          items.push({
            id: 'feed-final',
            ts: ts + 1,
            from: 'maestro',
            to: 'network',
            text: 'Transaction lifecycle complete ✓',
            type: 'result',
            status: 'complete',
          });
        }
        break;
    }
  }

  // ── Real agent messages ──────────────────────────────────
  for (const msg of messages) {
    if (msgIds.has(msg.id)) continue;
    msgIds.add(msg.id);

    const nl = (msg.natural_language || '').replace(/^Maestro\s*[—\-:]\s*/i, '').trim();
    if (!nl) continue;

    let from: FeedItem['from'] = 'maestro';
    let type: FeedItem['type'] = 'process';

    switch (msg.message_type) {
      case 'settlement_confirm':
        from = 'canto';
        type = 'blockchain';
        break;
      case 'payment_accept':
        type = 'result';
        break;
      case 'payment_reject':
        type = 'error';
        break;
    }

    const hasSimilar = items.some(
      it =>
        it.from === from &&
        Math.abs(it.ts - new Date(msg.created_at).getTime()) < 2000 &&
        it.type === type,
    );

    if (!hasSimilar) {
      items.push({
        id: `msg-${msg.id}`,
        ts: new Date(msg.created_at).getTime(),
        from,
        text: nl.length > 200 ? nl.slice(0, 197) + '...' : nl,
        type,
        status: 'complete',
      });
    }
  }

  items.sort((a, b) => a.ts - b.ts);
  return items;
}

// ============================================================
// Feed Item Row — Option B: neutral glass + monogram badges
// ============================================================

function FeedItemRow({ item, prevItem }: { item: FeedItem; prevItem?: FeedItem }) {
  const fromCfg = AGENT_CONFIG[item.from];
  const toCfg = item.to && item.to in AGENT_CONFIG ? AGENT_CONFIG[item.to as keyof typeof AGENT_CONFIG] : null;
  const isActive = item.status === 'active';
  const isError = item.status === 'error';
  const isComplete = item.status === 'complete';
  const isDispatch = item.type === 'dispatch';
  const isBlockchain = item.type === 'blockchain';

  // Show agent separator when sender changes
  const showSenderChange = !prevItem || prevItem.from !== item.from;

  return (
    <>
      {/* Agent separator line when sender changes */}
      {showSenderChange && prevItem && (
        <div className="flex items-center gap-2 my-1.5 px-1">
          <div className="h-px flex-1 bg-coda-border/15" />
        </div>
      )}

      <div className={`flex items-start gap-2 py-[3px] px-1.5 rounded-md group transition-colors ${
        isActive ? 'bg-coda-brand/[0.04]' : 'hover:bg-coda-surface-hover/10'
      }`}>
        {/* Timestamp */}
        <span className="text-[8px] text-coda-text-muted font-mono shrink-0 tabular-nums w-[52px] mt-[3px] opacity-60 group-hover:opacity-100 transition-opacity">
          {new Date(item.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
        </span>

        {/* Agent monogram badge — neutral glass, active gets brand ring */}
        <div className={`w-5 h-4 rounded flex items-center justify-center text-[7px] font-bold font-mono shrink-0 mt-[1px] border transition-all ${
          isActive
            ? 'bg-coda-brand/10 border-coda-brand/40 text-coda-brand shadow-[0_0_6px_rgba(96,165,250,0.2)]'
            : 'bg-black/[0.03] dark:bg-white/[0.06] border-coda-border-subtle text-coda-text-muted'
        }`}>
          {fromCfg.mono}
        </div>

        {/* Message content */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1 flex-wrap">
            {/* From agent name — neutral, not colored */}
            <span className={`text-[10px] font-semibold ${
              isActive ? 'text-coda-text' : 'text-coda-text-secondary'
            }`}>
              {fromCfg.name}
            </span>

            {/* Role subtitle on sender change */}
            {showSenderChange && (
              <span className="text-[8px] text-coda-text-muted font-mono">
                {fromCfg.role}
              </span>
            )}

            {/* Arrow + To agent */}
            {toCfg && (isDispatch || isBlockchain) && (
              <>
                <span className="text-[9px] text-coda-text-muted">→</span>
                <span className="text-[10px] font-semibold text-coda-text-secondary">
                  {toCfg.name}
                </span>
              </>
            )}

            {/* Blockchain indicator */}
            {isBlockchain && !toCfg && (
              <span className="text-[8px] px-1 py-0 rounded bg-black/[0.04] dark:bg-white/[0.06] text-coda-text-muted font-mono border border-coda-border-subtle">
                CHAIN
              </span>
            )}
          </div>

          {/* Message text — status-driven color */}
          <p className={`text-[11px] leading-snug mt-0.5 ${
            isError
              ? 'text-red-500 dark:text-red-400'
              : isComplete
                ? 'text-coda-text-muted'
                : isActive
                  ? 'text-coda-text-secondary'
                  : 'text-coda-text-muted'
          }`}>
            {item.text}
          </p>

          {/* Detail */}
          {item.detail && (
            <p className="text-[9px] text-coda-text-muted leading-snug mt-0.5 truncate">
              {item.detail}
            </p>
          )}
        </div>

        {/* Status indicator — brand for active, red for error */}
        <div className="shrink-0 mt-[3px]">
          {isActive ? (
            <Loader2 className="w-3 h-3 text-coda-brand animate-spin" />
          ) : isError ? (
            <span className="text-[9px] text-red-500 dark:text-red-400">✗</span>
          ) : isComplete && isDispatch ? (
            <span className="text-[9px] text-coda-text-muted">↗</span>
          ) : null}
        </div>
      </div>
    </>
  );
}

// ============================================================
// Compact Step Progress Sidebar
// ============================================================

const STEP_LABELS: Record<string, { label: string; agent: keyof typeof AGENT_CONFIG }> = {
  reasoning:         { label: 'Parse',      agent: 'maestro' },
  tx_created:        { label: 'Create',     agent: 'maestro' },
  request_sent:      { label: 'Dispatch',   agent: 'maestro' },
  awaiting_receiver: { label: 'Await',      agent: 'maestro' },
  compliance:        { label: 'Compliance', agent: 'concord' },
  risk:              { label: 'Risk',       agent: 'fermata' },
  decision:          { label: 'Decision',   agent: 'maestro' },
  settlement:        { label: 'Settle',     agent: 'canto' },
  confirmed:         { label: 'Confirm',    agent: 'canto' },
};

export function StepProgressSidebar({ pipeline }: { pipeline: TransactionPipeline }) {
  return (
    <div className="flex flex-col gap-0 py-1">
      <div className="text-[8px] tracking-widest uppercase text-coda-text-muted font-mono mb-2 px-1">
        Pipeline
      </div>
      {pipeline.steps.map((step, i) => {
        const cfg = STEP_LABELS[step.id] || { label: step.label, agent: 'maestro' as const };
        const isComplete = step.status === 'complete';
        const isActive = step.status === 'active';
        const isError = step.status === 'error';
        const isLast = i === pipeline.steps.length - 1;

        return (
          <div key={step.id} className="flex items-stretch gap-0">
            {/* Vertical connector line + status icon */}
            <div className="flex flex-col items-center w-4 shrink-0">
              {/* Status indicator */}
              {isComplete ? (
                <CheckCircle2 className="w-3.5 h-3.5 text-coda-brand shrink-0" />
              ) : isActive ? (
                <Loader2 className="w-3.5 h-3.5 text-coda-brand animate-spin shrink-0" />
              ) : isError ? (
                <div className="w-2 h-2 rounded-full bg-red-500 shrink-0 mt-[2px]" />
              ) : (
                <Circle className="w-3.5 h-3.5 text-coda-text-muted/30 shrink-0" />
              )}
              {/* Connector line */}
              {!isLast && (
                <div className={`w-px flex-1 min-h-[10px] ${
                  isComplete ? 'bg-coda-brand/25 dark:bg-coda-brand/20' : 'bg-coda-border/15'
                }`} />
              )}
            </div>

            {/* Label — color matches status, not agent identity */}
            <div className={`text-[9px] font-mono pb-1.5 leading-none mt-[1px] ml-0.5 ${
              isComplete
                ? 'text-coda-brand'
                : isActive
                  ? 'text-coda-text font-medium'
                  : isError
                    ? 'text-red-500 dark:text-red-400'
                    : 'text-coda-text-muted/40'
            }`}>
              {cfg.label}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ============================================================
// Agent Activity Feed — main panel (always open in split view)
// ============================================================

export function AgentActivityFeed({
  pipeline,
  messages,
  defaultOpen = true,
}: {
  pipeline: TransactionPipeline;
  messages: AgentMessage[];
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const scrollRef = useRef<HTMLDivElement>(null);
  const isActive = !pipeline.isComplete;

  const feedItems = useMemo(
    () => buildFeedItems(pipeline, messages),
    [pipeline, messages],
  );

  // Auto-scroll when new items appear
  useEffect(() => {
    if (open && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [feedItems.length, open]);

  if (feedItems.length === 0) return null;

  return (
    <div className="border-t border-coda-border/15">
      <button
        onClick={() => setOpen(!open)}
        className="w-full px-3 py-1.5 flex items-center gap-1.5 text-[10px] text-coda-text-muted hover:text-coda-text-secondary transition-colors"
      >
        <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${isActive ? 'bg-coda-brand animate-pulse' : 'bg-coda-brand'}`} />
        <span className="font-medium tracking-wider uppercase">
          Agent Comms
        </span>
        <span className="text-coda-text-muted">
          {feedItems.length} messages
        </span>
        <ChevronDown className={`w-3 h-3 ml-auto transition-transform duration-150 ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="flex border-t border-coda-border/10">
          {/* Left: Agent communication feed */}
          <div
            ref={scrollRef}
            className="flex-1 px-1.5 py-1.5 max-h-[260px] overflow-y-auto scrollbar-thin"
          >
            {feedItems.map((item, i) => (
              <FeedItemRow
                key={item.id}
                item={item}
                prevItem={i > 0 ? feedItems[i - 1] : undefined}
              />
            ))}

            {/* Live listening indicator */}
            {isActive && (
              <div className="flex items-center gap-2 py-1.5 px-1.5 mt-1">
                <div className="flex gap-[3px]">
                  {[0, 1, 2].map(i => (
                    <div
                      key={i}
                      className="w-[3px] h-[3px] rounded-full bg-coda-brand animate-pulse"
                      style={{ animationDelay: `${i * 200}ms` }}
                    />
                  ))}
                </div>
                <span className="text-[9px] text-coda-text-muted font-mono">
                  listening for agent comms...
                </span>
              </div>
            )}
          </div>

          {/* Right: Compact step progress sidebar */}
          <div className="w-[80px] border-l border-coda-border/10 px-2 py-1.5 shrink-0">
            <StepProgressSidebar pipeline={pipeline} />
          </div>
        </div>
      )}
    </div>
  );
}