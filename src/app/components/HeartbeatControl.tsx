import { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import type React from 'react';
import { createPortal } from 'react-dom';
import {
  Play, Square, Zap, Loader2,
  CheckCircle2, RotateCcw, ChevronDown, Hash,
  TrendingUp, Activity, Clock, ChevronRight,
  ArrowRight, Brain, Landmark, Globe,
} from 'lucide-react';
import { supabase, callServer } from '../supabaseClient';
import { useHeartbeat } from './HeartbeatContext';
import { NetworkActivityFeed } from './NetworkActivityFeed';
import { useSWRCache, evictSWRCache } from '../hooks/useSWRCache';
import { useRealtimeSubscription } from '../hooks/useRealtimeSubscription';
import { PageHeader } from './PageHeader';
import { PageTransition } from './PageTransition';
import { AnimatedValue } from './AnimatedValue';
import { LiquidityGauges } from './LiquidityGauges';
import { Link } from 'react-router';
import { LivePipelineProgress } from './LivePipelineProgress';
import { AgentReasoningPanel } from './AgentReasoningPanel';

// ============================================================
// Types
// ============================================================

interface HeartbeatCycle {
  id: string;
  cycle_number: number;
  status: string;
  banks_evaluated: number;
  transactions_initiated: number;
  market_event: {
    event_type: string;
    cycle_narrative: string;
    per_bank_events: Record<string, unknown>;
  } | null;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
}

// ============================================================
// Helpers
// ============================================================

const SPEED_OPTIONS = [
  { label: 'Slow (30s)', value: 30_000 },
  { label: 'Normal (15s)', value: 15_000 },
  { label: 'Fast (8s)', value: 8_000 },
  { label: 'Demo (5s)', value: 5_000 },
] as const;

const EVENT_BADGE: Record<string, { bg: string; text: string }> = {
  normal_ops:       { bg: 'bg-emerald-500/10', text: 'text-emerald-600 dark:text-emerald-400' },
  deposit_surge:    { bg: 'bg-amber-500/10',   text: 'text-amber-600 dark:text-amber-400' },
  liquidity_squeeze:{ bg: 'bg-red-500/10',     text: 'text-red-600 dark:text-red-400' },
  repo_maturity:    { bg: 'bg-blue-500/10',    text: 'text-blue-600 dark:text-blue-400' },
  corridor_window:  { bg: 'bg-coda-brand/10',  text: 'text-coda-brand' },
};

const STATUS_BADGE: Record<string, { bg: string; text: string; pulse?: boolean }> = {
  completed: { bg: 'bg-emerald-500/10', text: 'text-emerald-600 dark:text-emerald-400' },
  error:     { bg: 'bg-red-500/10',     text: 'text-red-600 dark:text-red-400' },
  running:   { bg: 'bg-amber-500/10',   text: 'text-amber-600 dark:text-amber-400', pulse: true },
};

// Transaction status styling for the expanded view
const TX_STATUS_MAP: Record<string, { bg: string; text: string }> = {
  initiated:        { bg: 'bg-coda-text-muted/15',    text: 'text-coda-text-muted' },
  compliance_check: { bg: 'bg-blue-500/15',    text: 'text-blue-400' },
  risk_scored:      { bg: 'bg-yellow-500/15',  text: 'text-yellow-400' },
  executing:        { bg: 'bg-orange-500/15',  text: 'text-orange-400' },
  settled:          { bg: 'bg-emerald-500/15', text: 'text-emerald-400' },
  locked:           { bg: 'bg-coda-brand/15',  text: 'text-coda-brand' },
  rejected:         { bg: 'bg-red-500/15',     text: 'text-red-400' },
  reversed:         { bg: 'bg-red-900/15',     text: 'text-red-600' },
};

// ── Module-level cycle detail cache ──────────────────────────
// Persists across expand/collapse and route changes so re-opening a
// cycle row is instant.  Completed cycles are cached indefinitely;
// running cycles use the cache as an initial seed but keep polling.
interface CycleDetailData {
  txns: any[];
  noActions: any[];
  txnIds: Set<string>;  // pre-populated set for animation gating
}
const cycleDetailCache = new Map<string, CycleDetailData>();

function relativeTime(isoStr: string | null | undefined): string {
  if (!isoStr) return '\u2014';
  const diff = Date.now() - new Date(isoStr).getTime();
  if (diff < 0) return 'just now';
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  return `${hr}h ago`;
}

function eventLabel(evtType: string | undefined): string {
  if (!evtType) return '\u2014';
  return evtType.replace(/_/g, ' ');
}

// ============================================================
// Fetcher (module-level, stable reference)
// ============================================================

async function fetchRecentCycles(): Promise<HeartbeatCycle[]> {
  const { data, error } = await supabase
    .from('heartbeat_cycles')
    .select('*')
    .order('cycle_number', { ascending: false })
    .limit(20);
  if (error) throw error;
  return (data || []) as HeartbeatCycle[];
}

// ============================================================
// Component
// ============================================================

export default function HeartbeatControl() {
  // Heartbeat context (persists across pages)
  const {
    isRunning, cycleInFlight, latestCycleNumber,
    currentSpeed, setCurrentSpeed,
    startHeartbeat, stopHeartbeat, runSingleCycle,
    setLatestCycleNumber,
  } = useHeartbeat();

  // -- SWR-cached cycles (instant on return visits) --
  const {
    data: cachedCycles,
    invalidate: invalidateCycles,
  } = useSWRCache<HeartbeatCycle[]>({
    key: 'heartbeat-cycles',
    fetcher: fetchRecentCycles,
  });

  // Local cycles state: seeded from SWR cache, then Realtime mutations
  // update it in-place for instant UI feedback.
  const [cycles, setCycles] = useState<HeartbeatCycle[]>([]);

  // Sync SWR cache -> local state whenever cache revalidates
  useEffect(() => {
    if (cachedCycles && cachedCycles.length > 0) {
      setCycles(cachedCycles);
      setLatestCycleNumber(cachedCycles[0].cycle_number);
    }
  }, [cachedCycles, setLatestCycleNumber]);

  // Derived metrics from current cycles (replaces separate totalCycles / totalTransactions state)
  const totalCycles = useMemo(
    () => cycles.filter((c) => c.status === 'completed').length,
    [cycles],
  );
  const totalTransactions = useMemo(
    () => cycles.filter((c) => c.status === 'completed')
      .reduce((sum, c) => sum + (c.transactions_initiated || 0), 0),
    [cycles],
  );

  // Other local state
  const [mandatesSeeded, setMandatesSeeded] = useState(false);
  const [seedingInProgress, setSeedingInProgress] = useState(false);
  const [speedOpen, setSpeedOpen] = useState(false);
  const [expandedCycleId, setExpandedCycleId] = useState<string | null>(null);
  const speedBtnRef = useRef<HTMLButtonElement>(null);
  const [speedDropdownPos, setSpeedDropdownPos] = useState<{ top: number; left: number; width: number } | null>(null);

  // Recalculate dropdown position when opened
  useEffect(() => {
    if (speedOpen && speedBtnRef.current) {
      const rect = speedBtnRef.current.getBoundingClientRect();
      setSpeedDropdownPos({ top: rect.bottom + 4, left: rect.left, width: rect.width });
    }
  }, [speedOpen]);

  // Close dropdown on outside click or scroll
  useEffect(() => {
    if (!speedOpen) return;
    const close = () => setSpeedOpen(false);
    window.addEventListener('scroll', close, true);
    const handleClick = (e: MouseEvent) => {
      if (speedBtnRef.current && !speedBtnRef.current.contains(e.target as Node)) {
        setSpeedOpen(false);
      }
    };
    window.addEventListener('mousedown', handleClick);
    return () => {
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('mousedown', handleClick);
    };
  }, [speedOpen]);

  // Relative time re-render every 5s
  const [, setTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setTick((v) => v + 1), 5_000);
    return () => clearInterval(t);
  }, []);

  // -- Seed mandates --
  const seedMandates = useCallback(async () => {
    setSeedingInProgress(true);
    try {
      const result = await callServer<{ results?: unknown[] }>('/seed-mandates', {});
      if (result?.results) setMandatesSeeded(true);
    } catch (err) {
      console.error('[HeartbeatControl] Seed mandates error:', err);
    } finally {
      setSeedingInProgress(false);
    }
  }, []);

  // -- Reset cycles --
  const resetCycles = useCallback(async () => {
    if (!window.confirm('Reset all heartbeat cycles and network snapshots? This cannot be undone.')) return;
    try {
      await callServer('/network-heartbeat', { action: 'reset_cycles' }, 5);
      setCycles([]);
      setLatestCycleNumber(0);
      evictSWRCache('heartbeat-cycles');
      invalidateCycles();
    } catch (err) {
      console.error('[HeartbeatControl] Reset cycles error:', err);
    }
  }, [setLatestCycleNumber, invalidateCycles]);

  // -- On mount: load heartbeat status (mandates check) --
  useEffect(() => {
    callServer<{
      last_cycle: HeartbeatCycle | null;
      active_banks: number;
      active_mandates: number;
    }>('/network-heartbeat', { action: 'status' }, 5)
      .then((data) => {
        if (data.last_cycle) setLatestCycleNumber(data.last_cycle.cycle_number);
        setMandatesSeeded((data.active_mandates || 0) > 0);
      })
      .catch((err) => console.error('[HeartbeatControl] Status error:', err));
  }, [setLatestCycleNumber]);

  // -- Realtime subscription --
  // Direct-mutate local state for instant UI, then also invalidate SWR
  // so the cache stays fresh for return visits.
  useRealtimeSubscription({
    channelName: 'heartbeat-cycles-rt',
    subscriptions: [
      {
        table: 'heartbeat_cycles',
        event: 'INSERT',
        callback: (payload) => {
          const newCycle = payload.new as HeartbeatCycle;
          setCycles((prev) => [newCycle, ...prev].slice(0, 20));
          setLatestCycleNumber(newCycle.cycle_number);
          invalidateCycles();
        },
      },
      {
        table: 'heartbeat_cycles',
        event: 'UPDATE',
        callback: (payload) => {
          const updated = payload.new as HeartbeatCycle;
          setCycles((prev) => prev.map((c) => (c.id === updated.id ? updated : c)));
          invalidateCycles();
        },
      },
    ],
    onPoll: invalidateCycles,
  });

  // - Derived state --
  const lastCycle = cycles.length > 0 ? cycles[0] : null;
  const lastEventType = lastCycle?.market_event?.event_type;
  const lastStatus = lastCycle?.status || 'idle';

  // The most recent running or just-completed cycle for the live pipeline tracker
  const pipelineCycle = useMemo(() => {
    const running = cycles.find((c) => c.status === 'running');
    if (running) return running;
    // Also return the most recent completed cycle so it can fade out gracefully
    if (lastCycle && (lastCycle.status === 'completed' || lastCycle.status === 'error')) return lastCycle;
    return null;
  }, [cycles, lastCycle]);

  // -- Render --
  return (
    <div className="space-y-4">
      {/* SECTION 1: HEADER ROW */}
      <PageHeader
        icon={Landmark}
        title="Treasury Operations"
        subtitle="Autonomous inter-bank settlement engine"
      >
        {cycleInFlight && <Loader2 size={14} className="text-coda-text-muted animate-spin" />}
        <div className="flex items-center gap-2">
          <div className="relative flex-shrink-0">
            <div
              className={`w-2.5 h-2.5 rounded-full ${
                isRunning ? 'bg-emerald-500' : 'bg-coda-text-faint'
              }`}
            />
            {isRunning && (
              <div className="absolute inset-0 w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse" />
            )}
          </div>
          <span
            className={`text-xs font-semibold tracking-wide uppercase ${
              isRunning ? 'text-emerald-500' : 'text-coda-text-muted'
            }`}
          >
            {isRunning ? 'Running' : 'Stopped'}
          </span>
        </div>
      </PageHeader>

      <PageTransition className="space-y-0">
      {/* MAIN CONTENT */}
      <div className="flex gap-4 items-start">
        {/* LEFT: Main Controls */}
        <div className="flex-1 min-w-0 space-y-4">

        {/* SECTION 2: CONTROLS ROW */}
        <div className="dashboard-card p-4 flex flex-wrap items-center gap-3 relative z-10">
          {/* Start / Stop */}
          {!isRunning ? (
            <button
              onClick={startHeartbeat}
              disabled={cycleInFlight || !mandatesSeeded}
              className="flex items-center gap-2 px-4 py-2 squircle-sm text-sm font-semibold text-white
                bg-coda-brand hover:bg-coda-brand-dim transition-colors
                disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
            >
              <Play size={14} />
              Start Engine
            </button>
          ) : (
            <button
              onClick={stopHeartbeat}
              className="flex items-center gap-2 px-4 py-2 squircle-sm text-sm font-semibold text-white
                bg-red-600 hover:bg-red-500 transition-colors cursor-pointer"
            >
              <Square size={14} />
              Stop
            </button>
          )}

          {/* Single Cycle */}
          <button
            onClick={runSingleCycle}
            disabled={cycleInFlight || !mandatesSeeded}
            className="flex items-center gap-2 px-4 py-2 squircle-sm text-sm font-semibold text-white
              bg-coda-brand hover:bg-coda-brand/80 transition-colors
              disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
          >
            {cycleInFlight ? <Loader2 size={14} className="animate-spin" /> : <Zap size={14} />}
            Single Cycle
          </button>

          {/* Network Command */}
          <Link
            to="/network-command"
            className="flex items-center gap-2 px-3 py-2 squircle-sm text-sm
              dashboard-card-subtle text-coda-text-secondary hover:text-coda-text transition-colors no-underline cursor-pointer"
          >
            <Globe size={14} />
            Network Command
          </Link>

          {/* Speed selector */}
          <div className="relative">
            <button
              ref={speedBtnRef}
              onClick={() => setSpeedOpen((v) => !v)}
              className="flex items-center gap-2 px-3 py-2 squircle-sm text-sm
                dashboard-card-subtle text-coda-text-secondary hover:text-coda-text transition-colors cursor-pointer"
            >
              <Clock size={14} />
              {SPEED_OPTIONS.find((o) => o.value === currentSpeed)?.label || 'Normal (15s)'}
              <ChevronDown size={12} className={`transition-transform ${speedOpen ? 'rotate-180' : ''}`} />
            </button>
          </div>

          {/* Speed dropdown -- portaled to body so backdrop-blur works outside parent's backdrop-filter context */}
          {speedOpen && speedDropdownPos && createPortal(
            <div
              className="fixed z-[9999] rounded-[10px] overflow-hidden shadow-xl
                backdrop-blur-2xl backdrop-saturate-150 bg-white/30 dark:bg-white/[0.06]
                border border-white/30 dark:border-white/[0.10]"
              style={{
                top: speedDropdownPos.top,
                left: speedDropdownPos.left,
                width: speedDropdownPos.width,
                WebkitBackdropFilter: 'blur(40px) saturate(1.5)',
              }}
            >
              {SPEED_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  onMouseDown={(e) => e.stopPropagation()}
                  onClick={() => { setCurrentSpeed(opt.value); setSpeedOpen(false); }}
                  className={`w-full text-left px-3 py-2 text-sm transition-colors cursor-pointer
                    ${currentSpeed === opt.value
                      ? 'bg-black/[0.08] dark:bg-white/[0.10] text-coda-text font-semibold'
                      : 'text-coda-text-secondary hover:bg-white/10 dark:hover:bg-white/[0.08]'
                    }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>,
            document.body
          )}

          {/* Divider */}
          <div className="w-px h-6 bg-coda-border hidden sm:block" />

          {/* Seed Mandates / Seeded badge */}
          {!mandatesSeeded ? (
            <button
              onClick={seedMandates}
              disabled={seedingInProgress}
              className="flex items-center gap-2 px-3 py-2 squircle-sm text-sm
                dashboard-button text-coda-text-secondary hover:text-coda-text transition-colors
                disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
            >
              {seedingInProgress ? <Loader2 size={14} className="animate-spin" /> : <Activity size={14} />}
              Seed Mandates
            </button>
          ) : (
            <div className="flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-emerald-500">
              <CheckCircle2 size={14} />
              Mandates seeded
            </div>
          )}

          {/* Reset Cycles */}
          <button
            onClick={resetCycles}
            className="flex items-center gap-2 px-3 py-2 squircle-sm text-sm
              text-coda-text-muted hover:text-red-500 dark:hover:text-red-400 transition-colors cursor-pointer ml-auto"
          >
            <RotateCcw size={14} />
            Reset Cycles
          </button>
        </div>

        {/* SECTION 3: LIVE METRICS ROW */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {/* Total Cycles */}
          <MetricCard
            icon={Hash}
            label="Total Cycles"
            value={totalCycles}
          />

          {/* Transactions Initiated */}
          <MetricCard
            icon={TrendingUp}
            label="Txns Initiated"
            value={totalTransactions}
          />

          {/* Current Status */}
          <div className="dashboard-card-subtle p-4">
            <div className="flex items-center gap-2 mb-1.5">
              <Activity size={14} className="text-coda-text-muted" />
              <span className="text-xs text-coda-text-muted">Last Status</span>
            </div>
            <StatusBadge status={lastStatus} />
          </div>

          {/* Last Event Type */}
          <div className="dashboard-card-subtle p-4">
            <div className="flex items-center gap-2 mb-1.5">
              <Zap size={14} className="text-coda-text-muted" />
              <span className="text-xs text-coda-text-muted">Last Event</span>
            </div>
            <EventBadge eventType={lastEventType} />
          </div>
        </div>

        {/* SECTION 3.5: LIVE PIPELINE PROGRESS */}
        <LivePipelineProgress runningCycle={pipelineCycle} />

        {/* SECTION 3.75: AGENT REASONING PANEL (detailed view below overview) */}
        <AgentReasoningPanel isRunning={isRunning} currentCycle={pipelineCycle} />

        {/* SECTION 4: CYCLE LOG */}
        <div>
          <h3 className="text-sm font-semibold text-coda-text mb-3">Cycle Log</h3>
          <div className="space-y-3">
            {cycles.length === 0 ? (
              <div className="text-center py-10 text-coda-text-muted text-sm">
                No cycles yet. Seed mandates and start the engine.
              </div>
            ) : (
              cycles.map((cycle, idx) => (
                <CycleRow
                  key={cycle.id}
                  cycle={cycle}
                  isNew={idx === 0 && cycle.status === 'running'}
                  expanded={expandedCycleId === cycle.id}
                  onToggle={() => setExpandedCycleId(expandedCycleId === cycle.id ? null : cycle.id)}
                />
              ))
            )}
          </div>
        </div>
        </div>

        {/* RIGHT: Live Activity Feed */}
        <div className="w-[380px] xl:w-[440px] flex-shrink-0 dashboard-card overflow-hidden flex flex-col sticky top-8 max-h-[calc(100vh-4rem)]">
          <NetworkActivityFeed />
        </div>
      </div>
      </PageTransition>
    </div>
  );
}

// ============================================================
// Sub-components
// ============================================================

function EventBadge({ eventType }: { eventType: string | undefined }) {
  if (!eventType) return <span className="text-sm text-coda-text-muted">&mdash;</span>;
  const style = EVENT_BADGE[eventType] || EVENT_BADGE.normal_ops;
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-md text-xs font-semibold ${style.bg} ${style.text}`}>
      {eventLabel(eventType)}
    </span>
  );
}

function StatusBadge({ status }: { status: string }) {
  const style = STATUS_BADGE[status] || { bg: 'bg-coda-surface-alt', text: 'text-coda-text-muted' };
  return (
    <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-xs font-semibold ${style.bg} ${style.text}`}>
      {(style as any).pulse && (
        <span className="relative flex h-1.5 w-1.5">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75" />
          <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-amber-500" />
        </span>
      )}
      {status}
    </span>
  );
}

function CycleRow({ cycle, isNew, expanded, onToggle }: { cycle: HeartbeatCycle; isNew: boolean; expanded: boolean; onToggle: () => void }) {
  const evtType = cycle.market_event?.event_type;

  // -- Lazy-loaded detail data --
  const [detailLoaded, setDetailLoaded] = useState(false);
  const [cycleTxns, setCycleTxns] = useState<any[]>([]);
  const [noActionDecisions, setNoActionDecisions] = useState<any[]>([]);
  const [detailLoading, setDetailLoading] = useState(false);

  // Track whether we've ever expanded (so we render content once loaded, even while collapsing)
  const hasExpandedOnce = useRef(false);
  if (expanded) hasExpandedOnce.current = true;

  // Load details when expanded -- supports both completed and running cycles
  // Check module-level cache first for instant re-opens (no animation).
  useEffect(() => {
    if (!expanded) return;
    if (detailLoaded && cycle.status !== 'running') return;
    if (cycle.status !== 'completed' && cycle.status !== 'running') return;

    // ── Cache hit — instant populate, suppress animation ──
    const cached = cycleDetailCache.get(cycle.id);
    if (cached && !detailLoaded) {
      setCycleTxns(cached.txns);
      setNoActionDecisions(cached.noActions);
      setDetailLoaded(true);
      // For completed cycles, cache is authoritative — no refetch needed.
      // For running cycles, we still want to poll for new txns after seeding.
      if (cycle.status === 'completed') return;
    }

    // ── Cache miss or running cycle — fetch from network ──
    if (!cached) {
      loadCycleDetails();
    }
  }, [expanded, cycle.status]);

  // Real-time polling for running cycles that are expanded
  useEffect(() => {
    if (!expanded || cycle.status !== 'running') return;
    const interval = setInterval(() => {
      loadCycleDetails(true /* silent */);
    }, 3000);
    return () => clearInterval(interval);
  }, [expanded, cycle.status]);

  async function loadCycleDetails(silent = false) {
    if (!cycle.started_at) return;
    if (!silent) setDetailLoading(true);
    try {
      const windowStart = new Date(new Date(cycle.started_at).getTime() - 2000).toISOString();
      // For running cycles, use "now + buffer"; for completed, use completed_at + buffer
      const windowEnd = cycle.completed_at
        ? new Date(new Date(cycle.completed_at).getTime() + 5000).toISOString()
        : new Date(Date.now() + 10000).toISOString();

      const { data: txns } = await supabase
        .from('transactions')
        .select('id, amount_display, amount, status, purpose_code, sender_bank_id, receiver_bank_id, created_at, sender_bank:banks!transactions_sender_bank_id_fkey(short_code), receiver_bank:banks!transactions_receiver_bank_id_fkey(short_code)')
        .gte('created_at', windowStart)
        .lte('created_at', windowEnd)
        .order('created_at', { ascending: true });

      const incoming = txns || [];

      setCycleTxns(incoming);

      // ── Write to module-level cache ──
      const allIds = new Set(incoming.map((tx: any) => tx.id));

      const { data: msgs } = await supabase
        .from('agent_messages')
        .select('id, from_bank_id, content, natural_language, created_at, from_bank:banks!agent_messages_from_bank_id_fkey(short_code)')
        .eq('message_type', 'status_update')
        .gte('created_at', windowStart)
        .lte('created_at', windowEnd)
        .order('created_at', { ascending: true });

      const noActions = (msgs || []).filter((m: any) => {
        const content = m.content;
        return content?.action === 'NO_ACTION' && content?.context === 'treasury_cycle';
      });
      setNoActionDecisions(noActions);

      // Persist to module-level cache (survives collapse/re-expand & route changes)
      cycleDetailCache.set(cycle.id, {
        txns: incoming,
        noActions,
        txnIds: allIds,
      });

      setDetailLoaded(true);
    } catch (err) {
      console.error('[CycleRow] Error loading details:', err);
    } finally {
      if (!silent) setDetailLoading(false);
    }
  }

  const perBankEvents = cycle.market_event?.per_bank_events || {};
  const bankCodes = Object.keys(perBankEvents);

  return (
    <div className={`squircle-sm ${isNew ? 'animate-fade-slide-in' : ''}`}>
      {/* Summary row (clickable) */}
      <button
        onClick={onToggle}
        className={`w-full flex items-center gap-3 px-3 py-2.5 dashboard-card rounded-[5px] cursor-pointer
          hover:bg-coda-surface-hover/50 transition-colors text-left relative z-10 ${expanded ? 'rounded-b-none' : ''}`}
      >
        <ChevronRight
          size={14}
          className={`text-coda-text-muted flex-shrink-0 transition-transform duration-200 ${expanded ? 'rotate-90' : ''}`}
        />
        <span className="font-mono text-xs text-coda-text-muted w-10 text-right flex-shrink-0">
          #{cycle.cycle_number}
        </span>
        <span className="text-xs text-coda-text-muted w-16 flex-shrink-0">
          {relativeTime(cycle.completed_at || cycle.started_at || cycle.created_at)}
        </span>
        <span className="text-xs text-coda-text-secondary w-18 flex-shrink-0">
          {cycle.banks_evaluated} bank{cycle.banks_evaluated !== 1 ? 's' : ''}
        </span>
        <span className="font-mono text-xs text-coda-text w-14 flex-shrink-0">
          {cycle.transactions_initiated} txn{cycle.transactions_initiated !== 1 ? 's' : ''}
        </span>
        <div className="flex-1 min-w-0">
          <EventBadge eventType={evtType} />
        </div>
        <StatusBadge status={cycle.status} />
      </button>

      {/* Expanded detail panel */}
      <div
        className={`relative z-0 -mt-1 grid transition-all duration-500 ease-[cubic-bezier(0.4,0,0.2,1)] ${
          expanded ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'
        }`}
      >
        <div className="overflow-hidden min-h-0">
          {hasExpandedOnce.current && (
          <div className="backdrop-blur-xl bg-white/[0.07] dark:bg-white/[0.03] border-t border-white/20 dark:border-white/10 px-4 py-3 pt-4 space-y-4 rounded-b-[14px]">
            {cycle.market_event && (
              <div>
                <h4 className="text-xs font-semibold text-coda-text-muted uppercase tracking-wide mb-1.5">
                  Market Event
                </h4>
                <p className="text-sm text-coda-text">
                  {cycle.market_event.cycle_narrative}
                </p>
              </div>
            )}

            {bankCodes.length > 0 && (
              <LiquidityGauges banks={perBankEvents} />
            )}

            {detailLoading ? (
              <div className="flex items-center justify-center py-6 gap-2">
                <Loader2 size={16} className="text-coda-text-muted animate-spin" />
                <span className="text-xs text-coda-text-muted">Loading cycle details...</span>
              </div>
            ) : detailLoaded ? (
              <>
                {/* Transactions — compact settlement links */}
                {cycleTxns.length > 0 && (
                <div>
                  <h4 className="text-xs font-semibold text-coda-text-muted uppercase tracking-wide mb-2">
                    Transactions Created ({cycleTxns.length})
                  </h4>
                    <div className="space-y-1.5">
                      {cycleTxns.map((tx: any) => {
                        const sCode = tx.sender_bank?.short_code || '?';
                        const rCode = tx.receiver_bank?.short_code || '?';
                        const amount = tx.amount_display || tx.amount / 1e6;
                        const statusStyle = TX_STATUS_MAP[tx.status] || TX_STATUS_MAP.initiated;
                        return (
                          <Link
                            key={tx.id}
                            to={`/transactions/${tx.id}`}
                            className="group flex items-center gap-3 px-3 py-2 rounded-lg backdrop-blur-md
                              bg-white/[0.06] dark:bg-white/[0.03] border border-white/10
                              hover:bg-white/[0.12] dark:hover:bg-white/[0.07] hover:border-white/20
                              transition-all duration-200 cursor-pointer no-underline"
                          >
                            <div className="flex items-center gap-1.5 text-xs font-mono text-coda-text">
                              <span className="font-bold">{sCode}</span>
                              <ArrowRight size={10} className="text-coda-text-muted" />
                              <span className="font-bold">{rCode}</span>
                            </div>
                            <span className="font-mono text-xs text-coda-text font-semibold">
                              ${amount.toLocaleString()}
                            </span>
                            <span className={`inline-flex px-1.5 py-0.5 rounded text-[10px] font-semibold transition-colors duration-300 ${statusStyle.bg} ${statusStyle.text}`}>
                              {tx.status}
                            </span>
                            {tx.purpose_code && (
                              <span className="text-[10px] text-coda-text-muted font-mono">
                                {tx.purpose_code}
                              </span>
                            )}
                            <ChevronRight
                              size={12}
                              className="ml-auto text-coda-text-muted/0 group-hover:text-coda-text-muted transition-all duration-200 -translate-x-1 group-hover:translate-x-0"
                            />
                          </Link>
                        );
                      })}
                    </div>
                </div>
                )}

                {/* No transactions for completed cycles */}
                {cycleTxns.length === 0 && cycle.status !== 'running' && (
                  <div>
                    <h4 className="text-xs font-semibold text-coda-text-muted uppercase tracking-wide mb-2">
                      Transactions Created
                    </h4>
                    <p className="text-xs text-coda-text-muted italic py-1">
                      No transactions recorded for this cycle.
                    </p>
                  </div>
                )}

                {noActionDecisions.length > 0 && (
                  <div>
                    <h4 className="text-xs font-semibold text-coda-text-muted uppercase tracking-wide mb-2">
                      Agent Decisions
                    </h4>
                    <div className="space-y-1.5">
                      {noActionDecisions.map((msg: any) => {
                        const bankCode = msg.from_bank?.short_code || '?';
                        const reasoning = msg.content?.reasoning || msg.natural_language || '';
                        return (
                          <div key={msg.id} className="flex items-start gap-3 px-3 py-2 rounded-lg backdrop-blur-md bg-white/[0.06] dark:bg-white/[0.03] border border-white/10">
                            <div className="flex items-center gap-1.5 flex-shrink-0 pt-0.5">
                              <Brain size={12} className="text-coda-text-muted" />
                              <span className="font-mono text-xs font-bold text-coda-text">{bankCode}</span>
                            </div>
                            <div className="flex-1 min-w-0">
                              <span className="inline-flex px-1.5 py-0.5 rounded text-[10px] font-semibold bg-coda-surface-alt text-coda-text-muted mb-1">
                                NO_ACTION
                              </span>
                              <p className="text-xs text-coda-text-secondary leading-relaxed mt-1 line-clamp-3">
                                {reasoning.slice(0, 300)}
                              </p>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

              </>
            ) : null}
          </div>
          )}
        </div>
      </div>
    </div>
  );
}

// MetricCard -- with AnimatedValue + pulse overlay
function MetricCard({ icon: Icon, label, value }: { icon: React.ElementType; label: string; value: number }) {
  const [pulseKey, setPulseKey] = useState(0);
  const triggerPulse = useCallback(() => {
    setPulseKey((k) => k + 1);
  }, []);

  return (
    <div className="dashboard-card-subtle p-4 relative overflow-hidden">
      {pulseKey > 0 && (
        <div
          key={pulseKey}
          className="absolute inset-0 pointer-events-none animate-stat-pulse"
        />
      )}
      <div className="flex items-center gap-2 mb-1.5">
        <Icon size={14} className="text-coda-text-muted" />
        <span className="text-xs text-coda-text-muted">{label}</span>
      </div>
      <p className="text-2xl font-semibold font-mono text-coda-text">
        <AnimatedValue
          value={value}
          onLiveChange={triggerPulse}
        />
      </p>
    </div>
  );
}