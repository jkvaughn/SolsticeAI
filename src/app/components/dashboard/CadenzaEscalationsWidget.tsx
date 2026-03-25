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
import { WidgetShell } from './WidgetShell';

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
  recentlyResolved: number;
}

// ── Fetcher ──────────────────────────────────────────────────

async function fetchCadenzaSummary(): Promise<CadenzaSummaryData> {
  const [escalationsRes, monitoredRes, flagsRes, resolvedRes] = await Promise.all([
    callServer<{ escalations: any[]; count: number }>('/cadenza-escalate', {
      action: 'get_escalations',
    }).catch(() => ({ escalations: [], count: 0 })),

    Promise.resolve(supabase
      .from('lockup_tokens')
      .select('id', { count: 'exact', head: true }))
      .catch(() => ({ count: 0 })),

    Promise.resolve(supabase
      .from('cadenza_flags')
      .select('id', { count: 'exact', head: true }))
      .catch(() => ({ count: 0 })),

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
    activeEscalations: escalations.slice(0, 3),
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
    ttl: 2 * 60 * 1000,
  });

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

  const statusBadge = (
    <>
      {isValidating && <Loader2 className="w-3 h-3 text-coda-text-muted animate-spin" />}
      {hasEscalations && (
        <span className="inline-flex items-center gap-1.5 text-xs text-coda-text-muted tabular-nums">
          <AlertOctagon className="w-3 h-3" />
          {summary!.activeEscalations.length} active
        </span>
      )}
    </>
  );

  const footerLink = summary ? (
    <Link
      to="/escalations"
      className="flex items-center justify-center gap-2 py-1 text-xs text-coda-text-muted hover:text-coda-text transition-colors group"
    >
      View Escalation Dashboard
      <ArrowRight className="w-3 h-3 group-hover:translate-x-0.5 transition-transform" />
    </Link>
  ) : undefined;

  return (
    <WidgetShell title="Cadenza Escalations" headerRight={statusBadge} footer={footerLink}>
      {error && !summary && (
        <div className="flex items-center gap-2 p-3 rounded-lg bg-red-500/5 border border-red-500/15">
          <AlertTriangle className="w-3.5 h-3.5 text-red-400 flex-shrink-0" />
          <p className="text-xs text-red-400">Failed to load Cadenza data</p>
        </div>
      )}

      {summary && (
        <div className="space-y-0">
          {/* Status metrics as flat rows */}
          <div className="flex items-center justify-between py-2.5">
            <span className="text-xs text-coda-text-secondary">Monitored Lockups</span>
            <span className="text-sm font-medium text-coda-text tabular-nums">{summary.totalMonitored}</span>
          </div>
          <div className="flex items-center justify-between py-2.5 border-t border-black/[0.06] dark:border-white/[0.06]">
            <span className="text-xs text-coda-text-secondary">Cadenza Flags</span>
            <span className="text-sm font-medium text-coda-text tabular-nums">{summary.totalFlags}</span>
          </div>
          <div className="flex items-center justify-between py-2.5 border-t border-black/[0.06] dark:border-white/[0.06]">
            <span className="text-xs text-coda-text-secondary">Resolved (24h)</span>
            <span className="text-sm font-medium text-coda-text tabular-nums">{summary.recentlyResolved}</span>
          </div>

          {/* Active escalation items */}
          {hasEscalations ? (
            <div className="pt-3 mt-1 border-t border-black/[0.06] dark:border-white/[0.06] space-y-0">
              {summary!.activeEscalations.map((esc, i) => (
                <EscalationRow key={esc.lockup_id} item={esc} border={i > 0} />
              ))}
            </div>
          ) : (
            <div className="flex items-center gap-3 py-3 mt-1 border-t border-black/[0.06] dark:border-white/[0.06]">
              <CheckCircle2 className="w-4 h-4 text-emerald-400 flex-shrink-0" />
              <div>
                <p className="text-xs font-medium text-emerald-500 dark:text-emerald-400">No active escalations</p>
                <p className="text-[10px] text-coda-text-muted mt-0.5">
                  Cadenza is monitoring {summary.totalMonitored} lockup{summary.totalMonitored !== 1 ? 's' : ''}
                </p>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Skeleton */}
      {!summary && !error && (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-10 rounded-lg bg-black/[0.02] dark:bg-white/[0.02] animate-pulse" />
          ))}
        </div>
      )}
    </WidgetShell>
  );
}

// ── Escalation Row ───────────────────────────────────────────

function EscalationRow({ item, border }: { item: EscalationSummaryItem; border?: boolean }) {
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
      className={`flex items-center gap-3 py-2.5 hover:bg-black/[0.02] dark:hover:bg-white/[0.02] transition-colors group ${
        border ? 'border-t border-black/[0.04] dark:border-white/[0.04]' : ''
      }`}
    >
      <AlertOctagon className="w-3.5 h-3.5 text-coda-brand flex-shrink-0" />

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5 text-xs font-medium text-coda-text">
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

      <span className="text-xs font-medium text-coda-text tabular-nums flex-shrink-0">
        {formatAmount(item.amount_display)}
      </span>

      <ArrowRight className="w-3 h-3 text-coda-text-muted group-hover:text-coda-brand transition-colors flex-shrink-0" />
    </Link>
  );
}
