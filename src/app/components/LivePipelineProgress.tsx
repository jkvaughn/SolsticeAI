/**
 * LivePipelineProgress — Page-level real-time pipeline tracker
 *
 * Sits between the metrics widgets and the Cycle Log on the Treasury Ops page.
 * Driven by Supabase Realtime subscriptions with step-by-step entrance animation.
 *
 * Two phases:
 *   1. **Mandate Evaluation** — cycle is running but no txns yet. Shows
 *      per-bank evaluation activity driven by agent_messages Realtime
 *      (NO_ACTION status_update messages arrive as each bank is evaluated).
 *   2. **Pipeline Processing** — transactions exist. Shows per-tx waterfall
 *      cards. New txns animate their steps one-by-one (350ms per step) up to
 *      the real status. Once caught up, Realtime UPDATE events drive
 *      subsequent status changes directly.
 *
 * Persistent: stays visible after cycle completes (shows final state).
 * Resets when the next running cycle begins.
 */

import { useEffect, useState, useRef, useMemo, useCallback } from 'react';
import { Loader2, ArrowRight, CheckCircle2, Activity, Brain, Minus } from 'lucide-react';
import { supabase } from '../supabaseClient';
import { useRealtimeSubscription } from '../hooks/useRealtimeSubscription';
import { PipelineWaterfall, STATUS_STEP_COUNT } from './PipelineWaterfall';
import { useBanks } from '../contexts/BanksContext';

// ── Types ─────────────────────────────────────────────────────

interface RunningCycle {
  id: string;
  cycle_number: number;
  status: string;
  started_at: string | null;
  completed_at: string | null;
}

interface LivePipelineProgressProps {
  runningCycle: RunningCycle | null;
}

interface BankEval {
  bankCode: string;
  status: 'evaluating' | 'no_action' | 'payment_initiated';
  reasoning?: string;
  timestamp: number;
}

// ── Component ─────────────────────────────────────────────────

export function LivePipelineProgress({ runningCycle }: LivePipelineProgressProps) {
  const { banks } = useBanks();
  const [txns, setTxns] = useState<any[]>([]);
  const [visible, setVisible] = useState(false);
  const [newTxIds, setNewTxIds] = useState<Set<string>>(new Set());
  const lastCycleIdRef = useRef<string | null>(null);
  const seenIdsRef = useRef<Set<string>>(new Set());

  // Pre-transaction: per-bank mandate evaluation status
  const [bankEvals, setBankEvals] = useState<Map<string, BankEval>>(new Map());

  // ── Step-by-step entrance animation state ────────────────────
  // Txns currently animating their entrance (step-by-step reveal)
  const [animatingTxIds, setAnimatingTxIds] = useState<Set<string>>(new Set());
  // Current displayed step count per tx (0-9) during entrance animation
  const [displaySteps, setDisplaySteps] = useState<Map<string, number>>(new Map());
  // Target step count per tx (derived from real status)
  const targetStepsRef = useRef<Map<string, number>>(new Map());

  // ── Cycle lifecycle ──────────────────────────────────────────

  useEffect(() => {
    if (!runningCycle) return;

    if (runningCycle.id !== lastCycleIdRef.current) {
      lastCycleIdRef.current = runningCycle.id;
      seenIdsRef.current = new Set();
      setTxns([]);
      setNewTxIds(new Set());
      setBankEvals(new Map());
      setAnimatingTxIds(new Set());
      setDisplaySteps(new Map());
      targetStepsRef.current = new Map();
    }

    if (runningCycle.status === 'running') {
      setVisible(true);
    }
  }, [runningCycle?.id, runningCycle?.status]);

  // ── Realtime subscription on transactions ─────────────────────
  const txWindowStartRef = useRef<string | null>(null);
  useEffect(() => {
    if (runningCycle?.started_at) {
      txWindowStartRef.current = new Date(new Date(runningCycle.started_at).getTime() - 2000).toISOString();
    }
  }, [runningCycle?.started_at]);

  useRealtimeSubscription({
    channelName: `pipeline-txns-${runningCycle?.id ?? 'idle'}`,
    subscriptions: (runningCycle && visible && runningCycle.started_at) ? [
      {
        table: 'transactions',
        event: 'INSERT',
        callback: (payload: any) => {
          const row = payload.new;
          const windowStart = txWindowStartRef.current;
          if (!row || !windowStart || row.created_at < windowStart) return;
          setTxns(prev => {
            if (prev.some(t => t.id === row.id)) return prev;
            seenIdsRef.current.add(row.id);
            // Mark as new for card entrance animation
            setNewTxIds(ids => new Set(ids).add(row.id));
            setTimeout(() => setNewTxIds(ids => {
              const next = new Set(ids);
              next.delete(row.id);
              return next;
            }), 2000);
            // Start step-by-step entrance animation
            const target = STATUS_STEP_COUNT[row.status] ?? 0;
            targetStepsRef.current.set(row.id, target);
            setDisplaySteps(prev => new Map(prev).set(row.id, 0));
            setAnimatingTxIds(prev => new Set(prev).add(row.id));
            return [...prev, row];
          });
        },
      },
      {
        table: 'transactions',
        event: 'UPDATE',
        callback: (payload: any) => {
          const row = payload.new;
          if (!row) return;
          // Update target step count if tx is still animating
          if (row.status) {
            const newTarget = STATUS_STEP_COUNT[row.status] ?? 0;
            targetStepsRef.current.set(row.id, newTarget);
          }
          setTxns(prev =>
            prev.map(t => t.id === row.id ? { ...t, ...row } : t)
          );
        },
      },
    ] : [],
    onPoll: runningCycle ? () => fetchTransactions(runningCycle) : undefined,
  });

  // ── Realtime subscription on agent_messages (mandate evaluations) ──
  // Build bankId → short_code lookup
  const bankLookupRef = useRef<Map<string, string>>(new Map());
  useEffect(() => {
    const lookup = new Map<string, string>();
    for (const b of banks) {
      lookup.set(b.id, b.short_code || b.id.slice(0, 6));
    }
    bankLookupRef.current = lookup;
  }, [banks]);

  const agentWindowStartRef = useRef<string | null>(null);
  useEffect(() => {
    if (runningCycle?.started_at) {
      agentWindowStartRef.current = new Date(new Date(runningCycle.started_at).getTime() - 2000).toISOString();
    }
  }, [runningCycle?.started_at]);

  useRealtimeSubscription({
    channelName: `pipeline-agents-${runningCycle?.id ?? 'idle'}`,
    subscriptions: (runningCycle && visible && runningCycle.status === 'running' && runningCycle.started_at) ? [
      {
        table: 'agent_messages',
        event: 'INSERT',
        callback: (payload: any) => {
          const row = payload.new;
          const windowStart = agentWindowStartRef.current;
          if (!row || !windowStart || row.created_at < windowStart) return;
          const bankLookup = bankLookupRef.current;

          // Treasury cycle NO_ACTION — bank decided not to act
          if (
            row.message_type === 'status_update' &&
            row.content?.action === 'NO_ACTION' &&
            row.content?.context === 'treasury_cycle'
          ) {
            const bankId = row.from_bank_id;
            const bankCode = bankLookup.get(bankId) || bankId?.slice(0, 6);
            setBankEvals(prev => {
              const next = new Map(prev);
              next.set(bankId, {
                bankCode,
                status: 'no_action',
                reasoning: row.content?.reasoning?.slice(0, 80),
                timestamp: Date.now(),
              });
              return next;
            });
          }

          // Payment request sent — a bank initiated a transaction
          if (row.message_type === 'payment_request' && row.transaction_id) {
            const bankId = row.from_bank_id;
            const bankCode = bankLookup.get(bankId) || bankId?.slice(0, 6);
            setBankEvals(prev => {
              const next = new Map(prev);
              next.set(bankId, {
                bankCode,
                status: 'payment_initiated',
                timestamp: Date.now(),
              });
              return next;
            });
          }
        },
      },
    ] : [],
    onPoll: runningCycle ? () => fetchTransactions(runningCycle) : undefined,
  });

  // ── Step-by-step entrance animation timer ──────────────────
  // Runs while visible. Ticks at 350ms, incrementing each animating tx by 1 step.
  const animatingRef = useRef<Set<string>>(new Set());
  animatingRef.current = animatingTxIds;

  useEffect(() => {
    if (!visible) return;

    const interval = setInterval(() => {
      const animating = animatingRef.current;
      if (animating.size === 0) return;

      setDisplaySteps(prev => {
        const targets = targetStepsRef.current;
        let changed = false;
        const next = new Map(prev);
        const completed: string[] = [];

        for (const txId of animating) {
          const current = next.get(txId) ?? 0;
          const target = targets.get(txId) ?? 0;
          if (current < target) {
            next.set(txId, current + 1);
            changed = true;
          } else {
            completed.push(txId);
          }
        }

        if (completed.length > 0) {
          setAnimatingTxIds(prev => {
            const upd = new Set(prev);
            for (const id of completed) upd.delete(id);
            return upd;
          });
        }

        return changed ? next : prev;
      });
    }, 350);

    return () => clearInterval(interval);
  }, [visible]);

  // ── Initial seed poll + final poll ──────────────────────────
  useEffect(() => {
    if (!runningCycle || !visible) return;
    // Seed poll on mount and final poll on completion
    fetchTransactions(runningCycle);
  }, [runningCycle?.id, runningCycle?.status, visible]);

  const fetchTransactions = useCallback(async (cycle: RunningCycle) => {
    if (!cycle.started_at) return;
    try {
      const windowStart = new Date(new Date(cycle.started_at).getTime() - 2000).toISOString();
      const windowEnd = cycle.completed_at
        ? new Date(new Date(cycle.completed_at).getTime() + 5000).toISOString()
        : new Date(Date.now() + 10000).toISOString();

      const { data } = await supabase
        .from('transactions')
        .select('id, amount_display, amount, status, purpose_code, sender_bank_id, receiver_bank_id, created_at, sender_bank:banks!transactions_sender_bank_id_fkey(short_code), receiver_bank:banks!transactions_receiver_bank_id_fkey(short_code)')
        .gte('created_at', windowStart)
        .lte('created_at', windowEnd)
        .order('created_at', { ascending: true });

      if (data && data.length > 0) {
        // Initialize step animation for newly discovered txns
        const newTxFromPoll: any[] = [];
        for (const tx of data) {
          if (!seenIdsRef.current.has(tx.id)) {
            seenIdsRef.current.add(tx.id);
            newTxFromPoll.push(tx);
            const target = STATUS_STEP_COUNT[tx.status] ?? 0;
            targetStepsRef.current.set(tx.id, target);
          } else {
            // Update target for existing txns (status may have advanced)
            const target = STATUS_STEP_COUNT[tx.status] ?? 0;
            targetStepsRef.current.set(tx.id, target);
          }
        }
        if (newTxFromPoll.length > 0) {
          setDisplaySteps(prev => {
            const next = new Map(prev);
            for (const tx of newTxFromPoll) {
              if (!next.has(tx.id)) next.set(tx.id, 0);
            }
            return next;
          });
          setAnimatingTxIds(prev => {
            const next = new Set(prev);
            for (const tx of newTxFromPoll) next.add(tx.id);
            return next;
          });
        }

        setTxns(prev => {
          const merged = new Map(prev.map((t: any) => [t.id, t]));
          for (const tx of data) {
            merged.set(tx.id, { ...merged.get(tx.id), ...tx });
          }
          return Array.from(merged.values());
        });
      }
    } catch (err) {
      console.error('[LivePipelineProgress] Fetch error:', err);
    }
  }, []);

  // ── Also poll periodically while running (Realtime INSERT may lack joined fields) ──
  useEffect(() => {
    if (!runningCycle || runningCycle.status !== 'running') return;
    const interval = setInterval(() => {
      fetchTransactions(runningCycle);
    }, 4000);
    return () => clearInterval(interval);
  }, [runningCycle?.id, runningCycle?.status, fetchTransactions]);

  // ── Stagger indices for entrance animation ──────────────────
  const staggerMap = useMemo(() => {
    const map = new Map<string, number>();
    let i = 0;
    for (const tx of txns) {
      if (newTxIds.has(tx.id)) {
        map.set(tx.id, i++);
      }
    }
    return map;
  }, [txns, newTxIds]);

  // ── Derived state ──────────────────────────────────────────
  const isCompleted = runningCycle?.status === 'completed';
  const isError = runningCycle?.status === 'error';
  const isRunning = runningCycle?.status === 'running';
  const hasTxns = txns.length > 0;
  const bankEvalList = useMemo(() =>
    Array.from(bankEvals.values()).sort((a, b) => a.timestamp - b.timestamp),
    [bankEvals]
  );

  if (!visible || !runningCycle) return null;

  return (
    <div className="transition-all duration-500 ease-[cubic-bezier(0.4,0,0.2,1)] opacity-100 translate-y-0">
      <div className="dashboard-card p-4 space-y-3">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <Activity size={15} className="text-coda-text-secondary" />
            <h3 className="text-sm font-semibold text-coda-text">
              Pipeline Progress
            </h3>
            <span className="font-mono text-xs text-coda-text-muted">
              Cycle #{runningCycle.cycle_number}
            </span>
          </div>
          <div className="flex items-center gap-2">
            {isRunning && (
              <div className="flex items-center gap-1.5">
                <span className="relative flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-500 opacity-50" />
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
                </span>
                <span className="text-[11px] font-semibold text-emerald-500">Live</span>
              </div>
            )}
            {isCompleted && (
              <div className="flex items-center gap-1.5">
                <CheckCircle2 size={12} className="text-emerald-500" />
                <span className="text-[11px] font-semibold text-emerald-500">Complete</span>
              </div>
            )}
            {isError && (
              <span className="text-[11px] font-semibold text-red-400">Error</span>
            )}
            {hasTxns && (
              <span className="text-[11px] text-coda-text-muted">
                {txns.length} txn{txns.length !== 1 ? 's' : ''}
              </span>
            )}
          </div>
        </div>

        {/* ── Pre-transaction: Mandate Evaluation Phase ──────── */}
        {isRunning && !hasTxns && (
          <div className="space-y-2">
            {/* Active evaluation indicator */}
            <div className="flex items-center gap-2.5 px-3 py-3 rounded-xl backdrop-blur-md bg-black/[0.03] dark:bg-white/[0.03] border border-coda-border-subtle">
              <Brain size={14} className="text-coda-text-secondary shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-semibold text-coda-text">Evaluating Mandates</span>
                  <Loader2 size={11} className="text-coda-text-muted animate-spin" />
                </div>
                <p className="text-[10px] text-coda-text-muted mt-0.5">
                  Agents analyzing market conditions and treasury mandates...
                </p>
              </div>
            </div>

            {/* Per-bank evaluation results as they stream in */}
            {bankEvalList.length > 0 && (
              <div className="flex flex-wrap gap-1.5 px-1">
                {bankEvalList.map(eval_ => (
                  <div
                    key={eval_.bankCode}
                    className="flex items-center gap-1.5 px-2 py-1 rounded-md bg-black/[0.03] dark:bg-white/[0.02] border border-coda-border-subtle animate-fade-slide-in"
                  >
                    {eval_.status === 'no_action' ? (
                      <Minus size={10} className="text-coda-text-muted shrink-0" />
                    ) : eval_.status === 'payment_initiated' ? (
                      <CheckCircle2 size={10} className="text-emerald-400 shrink-0" />
                    ) : (
                      <Loader2 size={10} className="text-coda-text-muted animate-spin shrink-0" />
                    )}
                    <span className="text-[10px] font-mono text-coda-text-muted">
                      {eval_.bankCode}
                    </span>
                    <span className={`text-[10px] ${
                      eval_.status === 'no_action' ? 'text-coda-text-muted' :
                      eval_.status === 'payment_initiated' ? 'text-emerald-400' :
                      'text-coda-text-muted'
                    }`}>
                      {eval_.status === 'no_action' ? 'No action' :
                       eval_.status === 'payment_initiated' ? 'Payment initiated' :
                       'Evaluating...'}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ── Transaction Waterfalls ──────────────────────────── */}
        {hasTxns && (
          <div className="grid gap-2 sm:grid-cols-1 lg:grid-cols-2">
            {txns.map((tx: any) => {
              // Resolve bank short_codes: prefer joined data, fall back to BanksContext lookup
              const bankById = (id: string) => banks.find(b => b.id === id);
              const sCode = tx.sender_bank?.short_code || bankById(tx.sender_bank_id)?.short_code || '?';
              const rCode = tx.receiver_bank?.short_code || bankById(tx.receiver_bank_id)?.short_code || '?';
              const amount = tx.amount_display || (tx.amount ? tx.amount / 1e6 : 0);
              const isNew = newTxIds.has(tx.id);
              const stagger = staggerMap.get(tx.id) ?? 0;
              const isAnimating = animatingTxIds.has(tx.id);
              const currentSteps = displaySteps.get(tx.id);

              return (
                <div
                  key={tx.id}
                  className={`px-3 py-2.5 rounded-xl backdrop-blur-md
                    bg-black/[0.03] dark:bg-white/[0.03] border border-coda-border-subtle
                    transition-all duration-300
                    ${isNew ? 'animate-tx-in' : ''}`}
                  style={isNew ? { '--stagger': `${stagger * 80}ms` } as React.CSSProperties : undefined}
                >
                  {/* Tx header */}
                  <div className="flex items-center gap-2">
                    <div className="flex items-center gap-1.5 text-xs font-mono text-coda-text">
                      <span className="font-bold">{sCode}</span>
                      <ArrowRight size={10} className="text-coda-text-muted" />
                      <span className="font-bold">{rCode}</span>
                    </div>
                    <span className="font-mono text-xs text-coda-text font-semibold">
                      ${amount.toLocaleString()}
                    </span>
                    {tx.purpose_code && (
                      <span className="text-[10px] text-coda-text-muted font-mono">
                        {tx.purpose_code}
                      </span>
                    )}
                  </div>
                  {/* Pipeline checklist — step animation during entrance, then Realtime-driven */}
                  <PipelineWaterfall
                    status={tx.status || 'initiated'}
                    animatedStepCount={isAnimating ? currentSteps : undefined}
                  />
                </div>
              );
            })}
          </div>
        )}

        {/* ── Mandate Evaluation Summary (after txns appear, if cycle still running) ── */}
        {hasTxns && isRunning && bankEvalList.some(e => e.status === 'no_action') && (
          <div className="flex flex-wrap gap-1.5 px-1 pt-1 border-t border-coda-border-subtle">
            {bankEvalList
              .filter(e => e.status === 'no_action')
              .map(eval_ => (
                <div key={eval_.bankCode} className="flex items-center gap-1 px-2 py-0.5 rounded text-[10px] text-coda-text-muted">
                  <Minus size={9} className="shrink-0" />
                  <span className="font-mono">{eval_.bankCode}</span>
                  <span>— No action</span>
                </div>
              ))}
          </div>
        )}
      </div>
    </div>
  );
}