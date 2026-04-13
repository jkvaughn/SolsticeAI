import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import {
  ArrowRight, Landmark, Clock, TrendingUp,
  ArrowDownUp, ListChecks, History,
} from 'lucide-react';
import {
  fetchTransactions, fetchTreasuryMandates, fetchWallets,
  fetchLockupTokens, fetchTransactionCount,
} from '../../dataClient';
import type { Transaction } from '../../types';
import { TX_STATUS_CONFIG, RISK_LEVEL_CONFIG, formatTokenAmount } from '../../types';
import { useBanks } from '../../contexts/BanksContext';
import { useSWRCache } from '../../hooks/useSWRCache';
import { PageShell } from '../PageShell';
import type { PageStat } from '../PageShell';
import { WidgetShell } from '../dashboard/WidgetShell';
import {
  wallet as walletAnim,
  lightning as lightningAnim,
  dollarReceive as dollarReceiveAnim,
  dollarSend as dollarSendAnim,
} from '../icons/lottie';

// ============================================================
// Treasury Dashboard (Task 155)
//
// Role-specific dashboard shown when user has the "treasury"
// persona selected. Shows settlement queue, standing mandates,
// and recent settlements with treasury-oriented stats.
// ============================================================

// ── Data types ─────────────────────────────────────────────

interface TreasuryStats {
  totalTokenBalance: number;
  deploymentPct: number;
  inflowCount: number;
  outflowCount: number;
  queueCount: number;
}

interface TreasuryData {
  stats: TreasuryStats;
  queueTransactions: Transaction[];
  recentSettled: Transaction[];
  mandates: any[];
}

const QUEUE_STATUSES = ['initiated', 'compliance_check', 'risk_scored', 'executing', 'locked'];

async function fetchTreasuryData(): Promise<TreasuryData> {
  const now = new Date();
  const twentyFourHoursAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();

  const [wallets, queueTxs, recentTxs, mandates, lockups, queueCount] = await Promise.all([
    fetchWallets(),
    fetchTransactions({ limit: 30 }),
    fetchTransactions({ limit: 10 }),
    fetchTreasuryMandates(),
    fetchLockupTokens({ status: 'active' }),
    fetchTransactionCount({ statuses: QUEUE_STATUSES }),
  ]);

  // Total token balance across all wallets
  const totalTokenBalance = (wallets ?? []).reduce(
    (sum: number, w: any) => sum + (w.balance_tokens ?? 0), 0
  ) / 1e6;

  // Locked amount from active lockup tokens
  const lockedAmount = (lockups ?? []).reduce(
    (sum: number, lt: any) => sum + (Number(lt.yb_token_amount) || 0), 0
  ) / 1e6;

  const deploymentPct = totalTokenBalance > 0
    ? Math.round((lockedAmount / totalTokenBalance) * 100)
    : 0;

  // 24h inflow/outflow from recent settled transactions
  const recentSettledAll = (recentTxs ?? []).filter(
    (t: any) => t.status === 'settled' && t.settled_at && new Date(t.settled_at).toISOString() >= twentyFourHoursAgo
  );
  const inflowCount = recentSettledAll.length;
  const outflowCount = recentSettledAll.length; // symmetric network

  // Queue: filter to pending/processing statuses
  const queueTransactions = (queueTxs ?? []).filter(
    (t: any) => QUEUE_STATUSES.includes(t.status)
  );

  // Recent settled
  const recentSettled = (recentTxs ?? []).filter(
    (t: any) => t.status === 'settled'
  ).slice(0, 10);

  return {
    stats: {
      totalTokenBalance,
      deploymentPct,
      inflowCount,
      outflowCount,
      queueCount,
    },
    queueTransactions,
    recentSettled,
    mandates: mandates ?? [],
  };
}

// ── Helpers ────────────────────────────────────────────────

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '\u2014';
  const d = new Date(iso);
  return d.toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function routeLabel(tx: any): string {
  const sender = tx.sender_bank?.short_code || tx.sender_bank_id?.slice(0, 4) || '??';
  const receiver = tx.receiver_bank?.short_code || tx.receiver_bank_id?.slice(0, 4) || '??';
  return `${sender} \u2192 ${receiver}`;
}

// ============================================================
// Component
// ============================================================

export function TreasuryDashboard() {
  const { cacheVersion } = useBanks();

  const { data } = useSWRCache<TreasuryData>({
    key: 'treasury-dashboard',
    fetcher: fetchTreasuryData,
    deps: [cacheVersion],
    ttl: 2 * 60 * 1000,
  });

  const {
    stats = { totalTokenBalance: 0, deploymentPct: 0, inflowCount: 0, outflowCount: 0, queueCount: 0 },
    queueTransactions = [],
    recentSettled = [],
    mandates = [],
  } = data ?? {};

  // ── PageShell stats ──
  const pageStats: PageStat[] = [
    {
      lottieData: walletAnim,
      value: `$${stats.totalTokenBalance.toLocaleString(undefined, { maximumFractionDigits: 0 })}`,
      label: 'Token Balance',
    },
    {
      lottieData: lightningAnim,
      value: `${stats.deploymentPct}%`,
      label: 'Deployment',
    },
    {
      lottieData: dollarReceiveAnim,
      value: stats.inflowCount,
      label: '24h Settlements',
    },
    {
      lottieData: dollarSendAnim,
      value: stats.queueCount,
      label: 'Settlement Queue',
    },
  ];

  return (
    <PageShell
      title="Treasury Dashboard"
      subtitle="Settlement Operations & Mandate Monitoring"
      stats={pageStats}
    >
      {/* ── Settlement Queue ── */}
      <WidgetShell
        title="Settlement Queue"
        icon={ListChecks}
        headerRight={
          <span className="text-[11px] font-mono text-coda-text-muted">
            {queueTransactions.length} active
          </span>
        }
        footer={
          <Link to="/transactions" className="text-[12px] text-coda-text-muted hover:text-coda-text transition-colors flex items-center gap-1">
            View all transactions <ArrowRight size={12} />
          </Link>
        }
      >
        {queueTransactions.length === 0 ? (
          <div className="py-6 text-center text-[13px] text-coda-text-muted">
            No transactions in queue
          </div>
        ) : (
          <div className="space-y-0">
            {/* Header row */}
            <div className="grid grid-cols-12 gap-2 py-2 text-[11px] font-mono text-coda-text-muted uppercase tracking-wider">
              <div className="col-span-2">Amount</div>
              <div className="col-span-3">Route</div>
              <div className="col-span-2">Status</div>
              <div className="col-span-2">Time</div>
              <div className="col-span-2">Risk</div>
              <div className="col-span-1" />
            </div>
            {queueTransactions.slice(0, 15).map((tx, i) => {
              const statusCfg = TX_STATUS_CONFIG[tx.status] || TX_STATUS_CONFIG.initiated;
              const riskCfg = tx.risk_level ? RISK_LEVEL_CONFIG[tx.risk_level] : null;
              return (
                <Link
                  key={tx.id}
                  to={`/transactions/${tx.id}`}
                  className={`grid grid-cols-12 gap-2 items-center py-2.5 hover:bg-black/[0.02] dark:hover:bg-white/[0.02] transition-colors group ${
                    i > 0 ? 'border-t border-black/[0.06] dark:border-white/[0.06]' : ''
                  }`}
                >
                  <div className="col-span-2 text-[14px] font-mono font-medium text-coda-text tabular-nums">
                    {formatTokenAmount(tx.amount)}
                  </div>
                  <div className="col-span-3 text-[13px] text-coda-text-secondary truncate">
                    {routeLabel(tx)}
                  </div>
                  <div className="col-span-2">
                    <span className={`inline-flex items-center px-2 py-0.5 text-[11px] font-mono rounded-md ${statusCfg.bg} ${statusCfg.color}`}>
                      {statusCfg.label}
                    </span>
                  </div>
                  <div className="col-span-2 text-[12px] text-coda-text-muted font-mono tabular-nums">
                    {fmtDate(tx.initiated_at || tx.created_at)}
                  </div>
                  <div className="col-span-2">
                    {riskCfg ? (
                      <span className={`text-[12px] font-mono ${riskCfg.color}`}>{riskCfg.label}</span>
                    ) : (
                      <span className="text-[12px] text-coda-text-muted">\u2014</span>
                    )}
                  </div>
                  <div className="col-span-1 flex justify-end">
                    <ArrowRight size={13} className="text-coda-text-muted group-hover:text-coda-text transition-colors" />
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </WidgetShell>

      {/* Bottom row: Mandates + Recent */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* ── Standing Mandates ── */}
        <WidgetShell
          title="Standing Mandates"
          icon={Landmark}
          headerRight={
            <span className="text-[11px] font-mono text-coda-text-muted">
              {mandates.length} active
            </span>
          }
        >
          {mandates.length === 0 ? (
            <div className="py-6 text-center text-[13px] text-coda-text-muted">
              No active treasury mandates
            </div>
          ) : (
            <div className="space-y-0">
              {mandates.map((m: any, i: number) => (
                <div
                  key={m.id}
                  className={`py-3 ${
                    i > 0 ? 'border-t border-black/[0.06] dark:border-white/[0.06]' : ''
                  }`}
                >
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-[14px] font-medium text-coda-text">{m.name || 'Unnamed Mandate'}</span>
                    <span className="text-[11px] font-mono px-2 py-0.5 rounded bg-coda-brand/10 text-coda-brand">
                      P{m.priority ?? 0}
                    </span>
                  </div>
                  <div className="flex items-center gap-4 text-[12px] text-coda-text-muted">
                    {m.conditions && (
                      <span className="truncate max-w-[200px]">{
                        typeof m.conditions === 'string' ? m.conditions : JSON.stringify(m.conditions).slice(0, 60)
                      }</span>
                    )}
                    {m.counterparty_bank_id && (
                      <span className="font-mono">CP: {m.counterparty_bank_id.slice(0, 8)}</span>
                    )}
                  </div>
                  {m.last_triggered_at && (
                    <div className="text-[11px] text-coda-text-muted mt-1">
                      Last triggered: {fmtDate(m.last_triggered_at)}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </WidgetShell>

        {/* ── Recent Settlements ── */}
        <WidgetShell
          title="Recent Settlements"
          icon={History}
          headerRight={
            <span className="text-[11px] font-mono text-coda-text-muted">
              Last 10
            </span>
          }
        >
          {recentSettled.length === 0 ? (
            <div className="py-6 text-center text-[13px] text-coda-text-muted">
              No recent settlements
            </div>
          ) : (
            <div className="space-y-0">
              {recentSettled.map((tx: any, i: number) => {
                const riskCfg = tx.risk_level ? RISK_LEVEL_CONFIG[tx.risk_level] : null;
                return (
                  <Link
                    key={tx.id}
                    to={`/transactions/${tx.id}`}
                    className={`flex items-center justify-between py-2.5 hover:bg-black/[0.02] dark:hover:bg-white/[0.02] transition-colors group ${
                      i > 0 ? 'border-t border-black/[0.06] dark:border-white/[0.06]' : ''
                    }`}
                  >
                    <div className="flex items-center gap-3 min-w-0 flex-1">
                      <span className="text-[14px] font-mono font-medium text-coda-text tabular-nums w-24 shrink-0">
                        {formatTokenAmount(tx.amount)}
                      </span>
                      <span className="text-[13px] text-coda-text-secondary truncate">
                        {routeLabel(tx)}
                      </span>
                    </div>
                    <div className="flex items-center gap-3 shrink-0">
                      <span className="text-[12px] text-coda-text-muted font-mono tabular-nums">
                        {fmtDate(tx.settled_at)}
                      </span>
                      {riskCfg && (
                        <span className={`text-[11px] font-mono ${riskCfg.color}`}>{riskCfg.label}</span>
                      )}
                      <ArrowRight size={13} className="text-coda-text-muted group-hover:text-coda-text transition-colors" />
                    </div>
                  </Link>
                );
              })}
            </div>
          )}
        </WidgetShell>
      </div>
    </PageShell>
  );
}
