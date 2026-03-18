import { useEffect, useRef, useState, useCallback } from 'react';
import type React from 'react';
import { Link } from 'react-router';
import { Settings, Terminal, Activity, ArrowRight, Wallet, Zap, AlertOctagon, LayoutDashboard, Shield, TrendingUp } from 'lucide-react';
import { supabase } from '../supabaseClient';
import type { Transaction } from '../types';
import { isOrphanedTransaction } from '../types';
import { useBanks } from '../contexts/BanksContext';
import { useSWRCache } from '../hooks/useSWRCache';
import { PageHeader } from './PageHeader';
import { AnimatedValue } from './AnimatedValue';
import { PageTransition } from './PageTransition';
import { NetworkInfrastructureWidget } from './dashboard/NetworkInfrastructureWidget';
import { CadenzaEscalationsWidget } from './dashboard/CadenzaEscalationsWidget';
import { usePersona } from '../contexts/PersonaContext';

// ── Aggregate stats fetched without row limit ────────────────
interface DashboardStats {
  totalTransactions: number;
  settledVolume: number;
}

async function fetchDashboardStats(): Promise<DashboardStats> {
  // Parallel: total count (all statuses) + settled rows (for volume sum)
  const [countRes, settledRes] = await Promise.all([
    supabase
      .from('transactions')
      .select('*', { count: 'exact', head: true }),
    supabase
      .from('transactions')
      .select('amount_display')
      .eq('status', 'settled'),
  ]);

  const totalTransactions = countRes.count ?? 0;
  const settledVolume = (settledRes.data ?? []).reduce(
    (sum: number, t: { amount_display: number | null }) => sum + (t.amount_display || 0),
    0,
  );
  return { totalTransactions, settledVolume };
}

// ── Recent transactions (for orphan/active detection) ────────
async function fetchRecentTransactions(): Promise<Transaction[]> {
  const { data, error } = await supabase
    .from('transactions')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(20);
  if (error) throw error;
  return data ?? [];
}

export function Dashboard() {
  const { activeBanks: banks, cacheVersion } = useBanks();
  const { persona } = usePersona();

  const {
    data: transactions,
    invalidate: invalidateTxs,
  } = useSWRCache<Transaction[]>({
    key: 'dashboard-transactions',
    fetcher: fetchRecentTransactions,
    deps: [cacheVersion],
    ttl: 2 * 60 * 1000, // 2 min — dashboard data is high-frequency
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

  useEffect(() => {
    const reloadTimer = { current: null as ReturnType<typeof setTimeout> | null };

    const txChannel = supabase
      .channel('dashboard-transactions-rt')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'transactions' }, () => {
        if (reloadTimer.current) clearTimeout(reloadTimer.current);
        reloadTimer.current = setTimeout(() => {
          invalidateRef.current();
          invalidateStatsRef.current();
        }, 1500);
      })
      .subscribe();

    return () => {
      supabase.removeChannel(txChannel);
      if (reloadTimer.current) clearTimeout(reloadTimer.current);
    };
  }, []);

  const activeSettlements = txList.filter(
    (t) => ['initiated', 'compliance_check', 'risk_scored', 'executing'].includes(t.status)
  ).length;

  const orphanCount = txList.filter(isOrphanedTransaction).length;

  // ── Persona-specific data (Task 126) ──
  const [escalationCount, setEscalationCount] = useState(0);
  const [flagCount, setFlagCount] = useState(0);

  useEffect(() => {
    if (persona !== 'compliance' && persona !== 'leadership') return;
    Promise.all([
      supabase.from('lockup_tokens').select('id', { count: 'exact', head: true }).eq('status', 'escalated'),
      supabase.from('cadenza_flags').select('id', { count: 'exact', head: true }).is('action_taken', null),
    ]).then(([escRes, flagRes]) => {
      setEscalationCount(escRes.count ?? 0);
      setFlagCount(flagRes.count ?? 0);
    });
  }, [persona, cacheVersion]);

  const settlementRate = totalTransactions > 0
    ? Math.round((txList.filter(t => t.status === 'settled').length / Math.min(totalTransactions, txList.length)) * 100)
    : 0;

  return (
    <div className="space-y-4">
      <PageHeader
        icon={LayoutDashboard}
        title="CODA Agentic Payments"
        subtitle="Bank-to-Bank Wholesale Settlement on Solstice Network"
      />

      {/* Leadership: Executive Summary strip (Task 126) */}
      {persona === 'leadership' && (
        <div className="dashboard-card-subtle p-4">
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
        <Link to="/escalations" className="block dashboard-card-subtle p-4 hover:border-violet-500/30 transition-all group">
          <div className="flex items-center gap-2 mb-3">
            <Shield size={14} className="text-violet-500 dark:text-violet-400" />
            <span className="text-[11px] font-bold tracking-wide font-mono text-violet-600 dark:text-violet-400 uppercase">Compliance Overview</span>
            <div className="flex-1" />
            <ArrowRight size={13} className="text-violet-500/50 group-hover:text-violet-500 transition-colors" />
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

      {/* Orphan Alert */}
      {orphanCount > 0 && (
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
      )}

      {/* Stats Row */}
      <div className="grid grid-cols-4 gap-4">
        <StatCard label="Network Banks" value={banks.length} icon={Wallet} />
        <StatCard label="Total Settlements" value={totalTransactions} icon={Zap} />
        <StatCard
          label="Active Settlements"
          value={activeSettlements}
          icon={Activity}
          highlight={activeSettlements > 0}
          warning={orphanCount > 0 ? `${orphanCount} orphaned` : undefined}
        />
        <StatCard
          label="Settled Volume"
          value={settledVolume}
          icon={Activity}
          format={(v) => `$${v.toLocaleString()}`}
        />
      </div>

      {/* Network Infrastructure & Cadenza Escalations */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <NetworkInfrastructureWidget />
        <CadenzaEscalationsWidget />
      </div>

      <PageTransition className="space-y-4">
      {/* Quick Actions */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <QuickAction
          to="/setup"
          icon={Settings}
          title="Network Setup"
          desc="Deploy banks & tokens"
        />
        {banks.slice(0, 2).map((bank) => (
          <QuickAction
            key={bank.id}
            to={`/agent/${bank.id}`}
            icon={Terminal}
            title={`${bank.short_code} Maestro`}
            desc={bank.name}
          />
        ))}
        <QuickAction
          to="/transactions"
          icon={Activity}
          title="Transaction Monitor"
          desc="Network-wide view"
          badge={orphanCount > 0 ? `${orphanCount} orphaned` : undefined}
        />
      </div>

      {/* Bank Agent Links */}
      {banks.length > 0 && (
        <div className="dashboard-card p-5">
          <h2 className="text-sm dashboard-text-muted mb-3">Agent Terminals</h2>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {banks.map((bank) => {
              const defaultWallet = bank.wallets?.find(w => w.is_default) ?? bank.wallets?.[0];
              const balanceTokens = defaultWallet ? defaultWallet.balance_tokens / 1e6 : null;
              return (
              <Link
                key={bank.id}
                to={`/agent/${bank.id}`}
                className="flex items-center justify-between p-3 dashboard-card-nested dashboard-hover transition-all group"
              >
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-bold dashboard-text group-hover:text-coda-text transition-colors">
                    {bank.short_code}
                  </div>
                  <div className="text-xs dashboard-text-muted truncate">{bank.name}</div>
                  {balanceTokens !== null && (
                    <div className="text-[11px] font-mono mt-1 text-coda-text-secondary">
                      ${balanceTokens.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
                    </div>
                  )}
                </div>
                <ArrowRight className="w-4 h-4 text-muted-foreground group-hover:text-coda-text transition-colors flex-shrink-0" />
              </Link>
              );
            })}
          </div>
        </div>
      )}

      {/* Empty State */}
      {banks.length === 0 && (
        <div className="dashboard-card p-8 text-center">
          <Settings className="w-8 h-8 text-muted-foreground mx-auto mb-3" />
          <p className="text-sm dashboard-text-muted mb-4">No banks deployed yet</p>
          <Link
            to="/setup"
            className="inline-flex items-center gap-2 px-5 py-2.5 bg-neutral-800 hover:bg-neutral-700 dark:bg-neutral-200 dark:hover:bg-neutral-300 dark:text-neutral-900 text-white text-sm rounded-xl transition-colors liquid-button"
          >
            Go to Setup
            <ArrowRight className="w-3.5 h-3.5" />
          </Link>
        </div>
      )}
      </PageTransition>
    </div>
  );
}

function StatCard({ label, value, icon: Icon, highlight, warning, format }: {
  label: string; value: number; icon: React.ElementType; highlight?: boolean; warning?: string; format?: (v: number) => string;
}) {
  // ── Pulse overlay: replays animation on each live value change ──
  const [pulseKey, setPulseKey] = useState(0);

  const triggerPulse = useCallback(() => {
    setPulseKey((k) => k + 1);
  }, []);

  return (
    <div className="dashboard-card-nested p-4 card-animate relative overflow-hidden">
      {/* Pulse overlay — remounts on each pulseKey to replay animation */}
      {pulseKey > 0 && (
        <div
          key={pulseKey}
          className="absolute inset-0 pointer-events-none animate-stat-pulse"
        />
      )}
      <div className="flex items-center gap-2 mb-2">
        <Icon className={`w-3.5 h-3.5 ${highlight ? 'text-coda-text' : 'text-muted-foreground'}`} />
        <span className="text-xs dashboard-text-muted">{label}</span>
      </div>
      <div className={`text-xl font-bold ${highlight ? 'text-coda-text' : 'dashboard-text'}`}>
        <AnimatedValue
          value={value}
          format={format}
          onLiveChange={triggerPulse}
        />
      </div>
      {warning && (
        <div className="flex items-center gap-1 mt-1.5">
          <AlertOctagon className="w-2.5 h-2.5 text-amber-500 dark:text-amber-400" />
          <span className="text-[10px] text-amber-500 dark:text-amber-400">{warning}</span>
        </div>
      )}
    </div>
  );
}

function QuickAction({ to, icon: Icon, title, desc, badge }: {
  to: string; icon: React.ElementType; title: string; desc: string; badge?: string;
}) {
  return (
    <Link
      to={to}
      className="dashboard-card-nested p-4 card-hover-lift group relative"
    >
      <Icon className="w-5 h-5 text-muted-foreground group-hover:text-coda-text mb-2 transition-colors" />
      <div className="text-sm font-bold dashboard-text">{title}</div>
      <div className="text-xs dashboard-text-muted">{desc}</div>
      {badge && (
        <span className="absolute top-3 right-3 px-1.5 py-0.5 rounded-full text-[9px] font-bold bg-amber-500/15 text-amber-600 dark:text-amber-400 border border-amber-500/20">
          {badge}
        </span>
      )}
    </Link>
  );
}