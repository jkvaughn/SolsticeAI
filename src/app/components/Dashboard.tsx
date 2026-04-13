import { useEffect, useRef, useState, useCallback } from 'react';
import type React from 'react';
import { Link } from 'react-router';
import { Settings, ArrowRight, AlertOctagon, Shield, TrendingUp } from 'lucide-react';
import { fetchCount, fetchTransactions, fetchTransactionCount, fetchSettledVolume } from '../dataClient';
import type { Transaction } from '../types';
import { isOrphanedTransaction } from '../types';
import { useBanks } from '../contexts/BanksContext';
import { useSWRCache } from '../hooks/useSWRCache';
import { useRealtimeSubscription } from '../hooks/useRealtimeSubscription';
import { AnimatedValue } from './AnimatedValue';
import { PageShell } from './PageShell';
import type { PageStat } from './PageShell';
import { NetworkInfrastructureWidget } from './dashboard/NetworkInfrastructureWidget';
import { CadenzaEscalationsWidget } from './dashboard/CadenzaEscalationsWidget';
import { WidgetShell } from './dashboard/WidgetShell';
import { usePersona } from '../contexts/PersonaContext';
import { TreasuryDashboard } from './treasury/TreasuryDashboard';
import { ComplianceDashboard } from './compliance/ComplianceDashboard';
import {
  wallet as walletAnim,
  lightning as lightningAnim,
  refresh as refreshAnim,
  dollarReceive as dollarReceiveAnim,
} from './icons/lottie';

// ── Aggregate stats fetched without row limit ────────────────
interface DashboardStats {
  totalTransactions: number;
  settledVolume: number;
}

async function fetchDashboardStats(): Promise<DashboardStats> {
  const [totalTransactions, settledVolume] = await Promise.all([
    fetchTransactionCount(),
    fetchSettledVolume(),
  ]);
  return { totalTransactions, settledVolume };
}

// ── Recent transactions (for orphan/active detection) ────────
async function fetchRecentTransactions(): Promise<Transaction[]> {
  return fetchTransactions({ limit: 20 });
}

export function Dashboard() {
  const { activeBanks: banks, cacheVersion } = useBanks();
  const { persona } = usePersona();

  // Treasury role gets a dedicated dashboard (Task 155)
  if (persona === 'treasury') {
    return <TreasuryDashboard />;
  }

  // Compliance/BSA Officer role gets a dedicated dashboard (Task 156)
  if (persona === 'compliance' || persona === 'bsa_officer') {
    return <ComplianceDashboard />;
  }

  const {
    data: transactions,
    invalidate: invalidateTxs,
  } = useSWRCache<Transaction[]>({
    key: 'dashboard-transactions',
    fetcher: fetchRecentTransactions,
    deps: [cacheVersion],
    ttl: 2 * 60 * 1000,
  });

  const {
    data: stats,
    invalidate: invalidateStats,
  } = useSWRCache<DashboardStats>({
    key: 'dashboard-stats',
    fetcher: fetchDashboardStats,
    deps: [cacheVersion],
    ttl: 2 * 60 * 1000,
  });

  const txList = transactions ?? [];
  const { totalTransactions = 0, settledVolume = 0 } = stats ?? {};

  // ── Realtime: invalidate both caches on transaction changes ──
  const invalidateRef = useRef(invalidateTxs);
  invalidateRef.current = invalidateTxs;
  const invalidateStatsRef = useRef(invalidateStats);
  invalidateStatsRef.current = invalidateStats;

  const reloadTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useRealtimeSubscription({
    channelName: 'dashboard-transactions-rt',
    subscriptions: [
      {
        table: 'transactions',
        event: '*',
        callback: () => {
          if (reloadTimer.current) clearTimeout(reloadTimer.current);
          reloadTimer.current = setTimeout(() => {
            invalidateRef.current();
            invalidateStatsRef.current();
          }, 1500);
        },
      },
    ],
    onPoll: () => {
      invalidateRef.current();
      invalidateStatsRef.current();
    },
  });

  const activeSettlements = txList.filter(
    (t) => ['initiated', 'compliance_check', 'risk_scored', 'executing'].includes(t.status)
  ).length;

  const orphanCount = txList.filter(isOrphanedTransaction).length;

  // ── Persona-specific data (Task 126) ──
  const [escalationCount, setEscalationCount] = useState(0);
  const [flagCount, setFlagCount] = useState(0);

  useEffect(() => {
    if (persona !== 'compliance' && persona !== 'executive' && persona !== 'bsa_officer') return;
    Promise.all([
      fetchCount('lockup_tokens', 'status=escalated'),
      fetchCount('cadenza_flags', 'action_taken=null'),
    ]).then(([escCount, fCount]) => {
      setEscalationCount(escCount);
      setFlagCount(fCount);
    });
  }, [persona, cacheVersion]);

  const settlementRate = totalTransactions > 0
    ? Math.round((txList.filter(t => t.status === 'settled').length / Math.min(totalTransactions, txList.length)) * 100)
    : 0;

  // ── PageShell stats ──
  const pageStats: PageStat[] = [
    {
      lottieData: walletAnim,
      value: banks.length,
      label: 'Network Banks',
    },
    {
      lottieData: lightningAnim,
      value: totalTransactions,
      label: 'Total Settlements',
    },
    {
      lottieData: refreshAnim,
      value: activeSettlements,
      label: 'Active Settlements',
    },
    {
      lottieData: dollarReceiveAnim,
      value: `$${settledVolume.toLocaleString()}`,
      label: 'Settled Volume',
    },
  ];

  // ── Orphan alert banner ──
  const orphanAlert = orphanCount > 0 ? (
    <Link
      to="/transactions"
      className="flex items-center gap-3 p-4 liquid-glass-card squircle-sm border-amber-500/30 dark:border-amber-500/20 hover:border-amber-500/50 transition-all group"
    >
      <AlertOctagon className="w-4 h-4 text-amber-500 dark:text-amber-400 shrink-0 animate-pulse" />
      <div className="flex-1">
        <span className="text-xs text-amber-700 dark:text-amber-300 font-bold">
          {orphanCount} orphaned transaction{orphanCount !== 1 ? 's' : ''} detected
        </span>
        <span className="text-xs text-amber-600/80 dark:text-amber-500/80 ml-2">
          Stuck in pipeline &gt;2 min. Click to review in Transaction Monitor.
        </span>
      </div>
      <ArrowRight className="w-3.5 h-3.5 text-amber-600 dark:text-amber-500 group-hover:text-amber-500 dark:group-hover:text-amber-400 transition-colors" />
    </Link>
  ) : undefined;

  return (
    <PageShell
      title="CODA Agentic Payments"
      subtitle="Bank-to-Bank Wholesale Settlement on Solstice Network"
      stats={pageStats}
      alert={orphanAlert}
    >
      {/* Executive: Executive Summary strip (Task 126) */}
      {persona === 'executive' && (
        <div className="dashboard-card-subtle p-4 mb-4">
          <div className="flex items-center gap-2 mb-3">
            <TrendingUp size={14} className="text-blue-500 dark:text-blue-400" />
            <span className="text-[11px] font-bold tracking-wide font-mono text-blue-600 dark:text-blue-400 uppercase">Executive Summary</span>
          </div>
          <div className="grid grid-cols-5 gap-3">
            <div className="text-center">
              <div className="text-lg font-bold font-mono text-coda-text">${settledVolume.toLocaleString()}</div>
              <div className="text-[10px] text-coda-text-muted">Network Volume</div>
            </div>
            <div className="text-center">
              <div className="text-lg font-bold font-mono text-coda-text">{settlementRate}%</div>
              <div className="text-[10px] text-coda-text-muted">Settlement Rate</div>
            </div>
            <div className="text-center">
              <div className="text-lg font-bold font-mono text-coda-text">{banks.length}</div>
              <div className="text-[10px] text-coda-text-muted">Active Banks</div>
            </div>
            <div className="text-center">
              <div className="text-lg font-bold font-mono text-coda-text">{totalTransactions}</div>
              <div className="text-[10px] text-coda-text-muted">Total Settlements</div>
            </div>
            <div className="text-center">
              <div className="text-lg font-bold font-mono text-coda-text">{escalationCount}</div>
              <div className="text-[10px] text-coda-text-muted">Open Escalations</div>
            </div>
          </div>
        </div>
      )}

      {/* Compliance: Compliance Overview strip (Task 126) */}
      {persona === 'compliance' && (
        <Link to="/escalations" className="block dashboard-card-subtle p-4 mb-4 hover:border-coda-brand/30 transition-all group">
          <div className="flex items-center gap-2 mb-3">
            <Shield size={14} className="text-coda-brand" />
            <span className="text-[11px] font-bold tracking-wide font-mono text-coda-brand uppercase">Compliance Overview</span>
            <div className="flex-1" />
            <ArrowRight size={13} className="text-coda-brand/50 group-hover:text-coda-brand transition-colors" />
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div className="text-center">
              <div className="text-lg font-bold font-mono text-coda-text">{escalationCount}</div>
              <div className="text-[10px] text-coda-text-muted">Active Escalations</div>
            </div>
            <div className="text-center">
              <div className="text-lg font-bold font-mono text-coda-text">{flagCount}</div>
              <div className="text-[10px] text-coda-text-muted">Pending Flags</div>
            </div>
            <div className="text-center">
              <div className="text-lg font-bold font-mono text-coda-text">{totalTransactions}</div>
              <div className="text-[10px] text-coda-text-muted">Total Audited</div>
            </div>
          </div>
        </Link>
      )}

      {/* Network Infrastructure & Cadenza Escalations */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <NetworkInfrastructureWidget />
        <CadenzaEscalationsWidget />
      </div>

      {/* Agent Terminals — clean table rows */}
      {banks.length > 0 && (
        <WidgetShell title="Agent Terminals">
          <div className="space-y-0">
            {banks.map((bank, i) => {
              const defaultWallet = bank.wallets?.find(w => w.is_default) ?? bank.wallets?.[0];
              const balanceTokens = defaultWallet ? defaultWallet.balance_tokens / 1e6 : null;
              return (
                <Link
                  key={bank.id}
                  to={`/agent/${bank.id}`}
                  className={`flex items-center justify-between py-3 hover:bg-black/[0.02] dark:hover:bg-white/[0.02] transition-colors group ${
                    i > 0 ? 'border-t border-black/[0.06] dark:border-white/[0.06]' : ''
                  }`}
                >
                  <div className="flex items-center gap-3 min-w-0 flex-1">
                    <span className="text-sm font-medium text-coda-text w-12">{bank.short_code}</span>
                    <span className="text-xs text-coda-text-muted truncate">{bank.name}</span>
                  </div>
                  {balanceTokens !== null && (
                    <span className="text-sm font-medium text-coda-text tabular-nums font-mono mr-3">
                      ${balanceTokens.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
                    </span>
                  )}
                  <ArrowRight className="w-3.5 h-3.5 text-coda-text-muted group-hover:text-coda-text transition-colors flex-shrink-0" />
                </Link>
              );
            })}
          </div>
        </WidgetShell>
      )}

      {/* Empty State */}
      {banks.length === 0 && (
        <div className="dashboard-card p-8 text-center">
          <Settings className="w-8 h-8 text-muted-foreground mx-auto mb-3" />
          <p className="text-sm dashboard-text-muted mb-4">No banks deployed yet</p>
          <Link
            to="/setup"
            className="inline-flex items-center px-5 py-2.5 bg-transparent text-sm"
          >
            <span>Go to Setup</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </Link>
        </div>
      )}
    </PageShell>
  );
}

