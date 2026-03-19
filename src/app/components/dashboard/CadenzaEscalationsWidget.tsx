/**
 * CadenzaEscalationsWidget — Dashboard widget showing Cadenza escalation
 * summary with SWR caching. Links to the full Escalation Dashboard.
 */

import { useRef } from 'react';
import { Link } from 'react-router';
import {
  Shield, AlertOctagon, Clock, CheckCircle2, ArrowRight,
  ArrowRightLeft, Loader2, AlertTriangle, Flag,
} from 'lucide-react';
import { supabase, callServer } from '../../supabaseClient';
import { useSWRCache } from '../../hooks/useSWRCache';
import { useRealtimeSubscription } from '../../hooks/useRealtimeSubscription';
import { useBanks } from '../../contexts/BanksContext';

// ── Types ────────────────────────────────────────────────────

interface EscalationSummaryItem {
  lockup_id: string;
  transaction_id: string;
  sender_name: string;
  sender_code: string;
  receiver_name: string;
  receiver_code: string;
  amount_display: number;
  risk_level: string;
  flag_count: number;
  escalated_at: string;
  escalation_duration_seconds: number;
}

interface CadenzaSummaryData {
  activeEscalations: EscalationSummaryItem[];
  totalMonitored: number;
  totalFlags: number;
  recentlyResolved: number; // resolved in last 24h
}

// ── Fetcher ──────────────────────────────────────────────────

async function fetchCadenzaSummary(): Promise<CadenzaSummaryData> {
  const [escalationsRes, monitoredRes, flagsRes, resolvedRes] = await Promise.all([
    // Active escalations (limited for dashboard)
    callServer<{ escalations: any[]; count: number }>('/cadenza-escalate', {
      action: 'get_escalations',
    }).catch(() => ({ escalations: [], count: 0 })),

    // Total monitored lockups
    Promise.resolve(supabase
      .from('lockup_tokens')
      .select('id', { count: 'exact', head: true }))
      .catch(() => ({ count: 0 })),

    // Total cadenza flags
    Promise.resolve(supabase
      .from('cadenza_flags')
      .select('id', { count: 'exact', head: true }))
      .catch(() => ({ count: 0 })),

    // Recently resolved (last 24h)
    Promise.resolve(supabase
      .from('lockup_tokens')
      .select('id', { count: 'exact', head: true })
      .in('status', ['settled', 'reversed'])
      .gte('updated_at', new Date(Date.now() - 86_400_000).toISOString()))
      .catch(() => ({ count: 0 })),
  ]);

  const escalations = ((escalationsRes as any).escalations || []).map((e: any) => ({
    lockup_id: e.lockup_id,
    transaction_id: e.transaction_id,
    sender_name: e.sender_bank?.name || 'Unknown',
    sender_code: e.sender_bank?.short_code || '??',
    receiver_name: e.receiver_bank?.name || 'Unknown',
    receiver_code: e.receiver_bank?.short_code || '??',
    amount_display: e.amount_display,
    risk_level: e.risk_level,
    flag_count: e.flag_count || 0,
    escalated_at: e.escalated_at,
    escalation_duration_seconds: e.escalation_duration_seconds || 0,
  }));

  return {
    activeEscalations: escalations.slice(0, 3), // show top 3 on dashboard
    totalMonitored: (monitoredRes as any).count ?? 0,
    totalFlags: (flagsRes as any).count ?? 0,
    recentlyResolved: (resolvedRes as any).count ?? 0,
  };
}

// ── Component ────────────────────────────────────────────────

export function CadenzaEscalationsWidget() {
  const { cacheVersion } = useBanks();

  const {
    data,
    isValidating,
    error,
    invalidate,
  } = useSWRCache<CadenzaSummaryData>({
    key: 'dashboard-cadenza-escalations',
    fetcher: fetchCadenzaSummary,
    deps: [cacheVersion],
    ttl: 2 * 60 * 1000, // 2 min — escalations are time-sensitive
  });

  // Realtime: invalidate on lockup_tokens or cadenza_flags changes
  const invalidateRef = useRef(invalidate);
  invalidateRef.current = invalidate;

  const reloadTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const debouncedInvalidate = () => {
    if (reloadTimer.current) clearTimeout(reloadTimer.current);
    reloadTimer.current = setTimeout(() => invalidateRef.current(), 1500);
  };

  useRealtimeSubscription({
    channelName: 'dashboard-cadenza-rt',
    subscriptions: [
      { table: 'lockup_tokens', event: '*', callback: () => debouncedInvalidate() },
      { table: 'cadenza_flags', event: '*', callback: () => debouncedInvalidate() },
    ],
    onPoll: () => invalidateRef.current(),
  });

  const summary = data;
  const hasEscalations = summary && summary.activeEscalations.length > 0;

  return (
    <div className={`dashboard-card p-5 ${hasEscalations ? 'border-coda-brand/20' : ''}`}>
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Shield className="w-4 h-4 text-coda-brand" />
          <h2 className="text-sm font-bold dashboard-text">Cadenza Escalations</h2>
        </div>
        <div className="flex items-center gap-2">
          {isValidating && (
            <Loader2 className="w-3 h-3 text-coda-text-muted animate-spin" />
          )}
          {hasEscalations && (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-bold bg-coda-brand/15 text-coda-brand tabular-nums">
              <AlertOctagon className="w-2.5 h-2.5" />
              {summary!.activeEscalations.length} Active
            </span>
          )}
        </div>
      </div>

      {error && !summary && (
        <div className="flex items-center gap-2 p-3 rounded-lg bg-red-500/5 border border-red-500/15">
          <AlertTriangle className="w-3.5 h-3.5 text-red-400 flex-shrink-0" />
          <p className="text-xs text-red-400">Failed to load Cadenza data</p>
        </div>
      )}

      {summary && (
        <>
          {/* Status metrics row */}
          <div className="grid grid-cols-3 gap-3 mb-4">
            <div className="dashboard-card-nested p-3 text-center">
              <p className="text-[10px] text-coda-text-muted uppercase tracking-wider mb-1">Monitored</p>
              <p className="text-sm font-bold dashboard-text tabular-nums">{summary.totalMonitored}</p>
            </div>
            <div className="dashboard-card-nested p-3 text-center">
              <p className="text-[10px] text-coda-text-muted uppercase tracking-wider mb-1">Flags</p>
              <p className="text-sm font-bold text-coda-brand tabular-nums">{summary.totalFlags}</p>
            </div>
            <div className="dashboard-card-nested p-3 text-center">
              <p className="text-[10px] text-coda-text-muted uppercase tracking-wider mb-1">Resolved 24h</p>
              <p className="text-sm font-bold text-emerald-400 tabular-nums">{summary.recentlyResolved}</p>
            </div>
          </div>

          {/* Active escalation items */}
          {hasEscalations ? (
            <div className="space-y-2 mb-3">
              {summary!.activeEscalations.map((esc) => (
                <EscalationRow key={esc.lockup_id} item={esc} />
              ))}
            </div>
          ) : (
            <div className="flex items-center gap-3 p-3 rounded-lg bg-emerald-500/5 border border-emerald-500/15 mb-3">
              <CheckCircle2 className="w-4 h-4 text-emerald-400 flex-shrink-0" />
              <div>
                <p className="text-xs font-medium text-emerald-500 dark:text-emerald-400">No active escalations</p>
                <p className="text-[10px] text-coda-text-muted mt-0.5">
                  Cadenza is monitoring {summary.totalMonitored} lockup{summary.totalMonitored !== 1 ? 's' : ''}
                </p>
              </div>
            </div>
          )}

          {/* Link to full dashboard */}
          <Link
            to="/escalations"
            className="flex items-center justify-center gap-2 py-2 rounded-lg text-xs font-medium text-coda-brand hover:bg-coda-brand/5 transition-colors group"
          >
            View Escalation Dashboard
            <ArrowRight className="w-3 h-3 group-hover:translate-x-0.5 transition-transform" />
          </Link>
        </>
      )}

      {/* Skeleton */}
      {!summary && !error && (
        <div className="space-y-3">
          <div className="grid grid-cols-3 gap-3">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-14 rounded-lg bg-coda-surface-alt animate-pulse" />
            ))}
          </div>
          <div className="h-16 rounded-lg bg-coda-surface-alt animate-pulse" />
        </div>
      )}
    </div>
  );
}

// ── Escalation Row ───────────────────────────────────────────

function EscalationRow({ item }: { item: EscalationSummaryItem }) {
  const formatAmount = (amount: number) =>
    new Intl.NumberFormat('en-US', {
      style: 'currency', currency: 'USD',
      minimumFractionDigits: 0, maximumFractionDigits: 0,
    }).format(amount);

  const formatDuration = (seconds: number): string => {
    if (seconds < 60) return `${seconds}s`;
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    return `${h}h ${m}m`;
  };

  const riskColor =
    item.risk_level === 'high' ? 'text-red-400' :
    item.risk_level === 'medium' ? 'text-amber-400' : 'text-emerald-400';

  return (
    <Link
      to={`/transactions/${item.transaction_id}`}
      className="flex items-center gap-3 p-2.5 rounded-lg dashboard-card-nested dashboard-hover transition-all group"
    >
      <div className="flex-shrink-0">
        <AlertOctagon className="w-3.5 h-3.5 text-coda-brand" />
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5 text-xs font-medium dashboard-text">
          <span className="truncate">{item.sender_code}</span>
          <ArrowRightLeft className="w-2.5 h-2.5 text-coda-text-muted flex-shrink-0" />
          <span className="truncate">{item.receiver_code}</span>
        </div>
        <div className="flex items-center gap-2 mt-0.5">
          <span className={`text-[10px] font-mono ${riskColor}`}>{item.risk_level?.toUpperCase()}</span>
          {item.flag_count > 0 && (
            <span className="flex items-center gap-0.5 text-[10px] text-coda-brand">
              <Flag className="w-2 h-2" /> {item.flag_count}
            </span>
          )}
          <span className="flex items-center gap-0.5 text-[10px] text-coda-text-muted">
            <Clock className="w-2 h-2" /> {formatDuration(item.escalation_duration_seconds)}
          </span>
        </div>
      </div>

      <div className="text-right flex-shrink-0">
        <p className="text-xs font-bold dashboard-text tabular-nums">
          {formatAmount(item.amount_display)}
        </p>
      </div>

      <ArrowRight className="w-3 h-3 text-coda-text-muted group-hover:text-coda-brand transition-colors flex-shrink-0" />
    </Link>
  );
}