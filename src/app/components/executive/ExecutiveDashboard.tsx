import {
  TrendingUp, Users, BarChart3, Shield, Bot, Clock,
} from 'lucide-react';
import {
  fetchTransactions, fetchTransactionCount, fetchSettledVolume,
  fetchNetworkWallets, fetchCadenzaFlags, fetchLockupTokens,
  fetchAgentMessages, fetchCount,
} from '../../dataClient';
import type { Transaction } from '../../types';
import { formatTokenAmount, RISK_LEVEL_CONFIG } from '../../types';
import { useBanks } from '../../contexts/BanksContext';
import { useSWRCache } from '../../hooks/useSWRCache';
import { PageShell } from '../PageShell';
import type { PageStat } from '../PageShell';
import { WidgetShell } from '../dashboard/WidgetShell';
import { MemberRoster } from './MemberRoster';
import { NetworkEconomics } from './NetworkEconomics';
import { DigitalAssetExposure } from './DigitalAssetExposure';
import { NetworkStatusPanel } from './NetworkStatusPanel';
import { OnboardingTracker } from './OnboardingTracker';
import { IncidentLog } from './IncidentLog';
import {
  commandCenter as commandCenterAnim,
  networkWorld as networkWorldAnim,
  lightning as lightningAnim,
  aiNeuralNetworks as aiNeuralNetworksAnim,
} from '../icons/lottie';

// ============================================================
// Executive Dashboard / War Room (Task 166 + Task 168)
//
// Role-specific dashboard shown when persona === 'executive'.
// Comprehensive view: stats, member roster, settlement volume,
// network economics, SLA performance, risk posture, agent fleet,
// network status, onboarding, and incidents.
// ============================================================

// ── Data ──────────────────────────────────────────────────────

interface ExecData {
  totalVolume30d: number;
  activeBankCount: number;
  totalSettlements: number;
  settledVolume: number;
  transactions: Transaction[];
  flags: any[];
  lockups: any[];
  agentMessages: any[];
}

async function fetchExecData(): Promise<ExecData> {
  const [
    totalSettlements, settledVolume, transactions,
    flags, lockups, agentMessages,
  ] = await Promise.all([
    fetchTransactionCount().catch(() => 0),
    fetchSettledVolume().catch(() => 0),
    fetchTransactions({ limit: 200 }).catch(() => []),
    fetchCadenzaFlags().catch(() => []),
    fetchLockupTokens().catch(() => []),
    fetchAgentMessages({ limit: 50 }).catch(() => []),
  ]);

  // 30d volume
  const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;
  const recentTxs = (transactions ?? []).filter(
    (t: any) => t.status === 'settled' && new Date(t.settled_at || t.created_at).getTime() >= thirtyDaysAgo
  );
  const totalVolume30d = recentTxs.reduce((s: number, t: any) => s + (t.amount || 0), 0);

  return {
    totalVolume30d,
    activeBankCount: 0, // Will use banks from context
    totalSettlements,
    settledVolume,
    transactions: transactions ?? [],
    flags: flags ?? [],
    lockups: lockups ?? [],
    agentMessages: agentMessages ?? [],
  };
}

// ── Helpers ──────────────────────────────────────────────────

function fmtUsd(n: number): string {
  if (Math.abs(n) >= 1_000_000_000) return '$' + (n / 1_000_000_000).toFixed(1) + 'B';
  if (Math.abs(n) >= 1_000_000) return '$' + (n / 1_000_000).toFixed(1) + 'M';
  if (Math.abs(n) >= 1_000) return '$' + (n / 1_000).toFixed(0) + 'K';
  return '$' + n.toLocaleString(undefined, { maximumFractionDigits: 0 });
}

function avgSettlementTime(txs: Transaction[]): string {
  const settled = txs.filter((t) => t.status === 'settled' && t.initiated_at && t.settled_at);
  if (settled.length === 0) return '\u2014';
  const totalMs = settled.reduce((s, t) => {
    return s + (new Date(t.settled_at!).getTime() - new Date(t.initiated_at!).getTime());
  }, 0);
  const avgMs = totalMs / settled.length;
  if (avgMs < 60_000) return `${Math.round(avgMs / 1000)}s`;
  return `${(avgMs / 60_000).toFixed(1)}m`;
}

// ── Component ───────────────────────────────────────────────

export function ExecutiveDashboard() {
  const { activeBanks: banks, cacheVersion } = useBanks();

  const { data } = useSWRCache<ExecData>({
    key: 'executive-dashboard',
    fetcher: fetchExecData,
    deps: [cacheVersion],
    ttl: 2 * 60 * 1000,
  });

  const {
    totalVolume30d = 0,
    totalSettlements = 0,
    settledVolume = 0,
    transactions = [],
    flags = [],
    lockups = [],
    agentMessages = [],
  } = data ?? {};

  // ── Page stats ──
  const pageStats: PageStat[] = [
    { lottieData: commandCenterAnim, value: fmtUsd(totalVolume30d / 1e6), label: 'Volume (30d)' },
    { lottieData: networkWorldAnim, value: banks.length, label: 'Active Members' },
    { lottieData: lightningAnim, value: '99.97%', label: 'Network Uptime' },
    { lottieData: aiNeuralNetworksAnim, value: `${totalSettlements > 0 ? Math.round((transactions.filter(t => t.status === 'settled').length / Math.min(totalSettlements, transactions.length || 1)) * 100) : 0}%`, label: 'Autonomy Rate' },
  ];

  // ── Settlement volume by period ──
  const now = Date.now();
  const oneDayAgo = now - 24 * 60 * 60 * 1000;
  const sevenDaysAgo = now - 7 * 24 * 60 * 60 * 1000;
  const thirtyDaysAgo = now - 30 * 24 * 60 * 60 * 1000;

  const settledTxs = transactions.filter((t) => t.status === 'settled');
  const vol24h = settledTxs.filter((t) => new Date(t.settled_at || t.created_at).getTime() >= oneDayAgo).reduce((s, t) => s + (t.amount || 0), 0);
  const vol7d = settledTxs.filter((t) => new Date(t.settled_at || t.created_at).getTime() >= sevenDaysAgo).reduce((s, t) => s + (t.amount || 0), 0);
  const vol30d = settledTxs.filter((t) => new Date(t.settled_at || t.created_at).getTime() >= thirtyDaysAgo).reduce((s, t) => s + (t.amount || 0), 0);

  // ── Volume by bank (top 5) ──
  const bankVolumes: { name: string; volume: number }[] = banks.map((b) => {
    const vol = transactions
      .filter((t) => t.status === 'settled' && (t.sender_bank_id === b.id || t.receiver_bank_id === b.id))
      .reduce((s, t) => s + (t.amount || 0), 0);
    return { name: b.short_code, volume: vol };
  }).sort((a, b) => b.volume - a.volume).slice(0, 5);

  const maxBankVol = Math.max(...bankVolumes.map((b) => b.volume), 1);

  // ── Volume by purpose code (top 5) ──
  const purposeMap: Record<string, number> = {};
  settledTxs.forEach((t) => {
    const code = t.purpose_code || 'UNSPECIFIED';
    purposeMap[code] = (purposeMap[code] || 0) + (t.amount || 0);
  });
  const purposeVolumes = Object.entries(purposeMap)
    .map(([code, volume]) => ({ code, volume }))
    .sort((a, b) => b.volume - a.volume)
    .slice(0, 5);
  const maxPurposeVol = Math.max(...purposeVolumes.map((p) => p.volume), 1);

  // ── SLA performance by risk level ──
  const slaByRisk: { level: string; avgTime: string; count: number }[] = (['low', 'medium', 'high'] as const).map((level) => {
    const lvlTxs = settledTxs.filter((t) => t.risk_level === level && t.initiated_at && t.settled_at);
    const avgMs = lvlTxs.length > 0
      ? lvlTxs.reduce((s, t) => s + (new Date(t.settled_at!).getTime() - new Date(t.initiated_at!).getTime()), 0) / lvlTxs.length
      : 0;
    const avgTime = avgMs > 0
      ? avgMs < 60_000 ? `${Math.round(avgMs / 1000)}s` : `${(avgMs / 60_000).toFixed(1)}m`
      : '\u2014';
    return { level, avgTime, count: lvlTxs.length };
  });

  // ── Risk posture ──
  const inLockup = lockups.filter((l: any) => l.status === 'locked' || l.status === 'active').length;
  const escalated = lockups.filter((l: any) => l.status === 'escalated').length;
  const highRiskTxs = transactions.filter((t) => t.risk_level === 'high').length;
  const criticalFlags = flags.filter((f: any) => f.severity === 'critical').length;

  // Fermata score distribution
  const riskDist = { low: 0, medium: 0, high: 0 };
  transactions.forEach((t) => {
    if (t.risk_level && t.risk_level in riskDist) {
      riskDist[t.risk_level as keyof typeof riskDist]++;
    }
  });

  // ── Agent fleet ──
  const agentCounts: Record<string, { decisions: number; totalConfidence: number }> = {};
  agentMessages.forEach((m: any) => {
    const agent = m.from_bank?.short_code || m.from_bank_id?.slice(0, 6) || 'System';
    if (!agentCounts[agent]) agentCounts[agent] = { decisions: 0, totalConfidence: 0 };
    agentCounts[agent].decisions++;
    agentCounts[agent].totalConfidence += (m.confidence || 0.85);
  });
  const agentFleet = Object.entries(agentCounts).map(([name, c]) => ({
    name,
    decisions: c.decisions,
    avgConfidence: c.decisions > 0 ? c.totalConfidence / c.decisions : 0,
  }));

  return (
    <PageShell
      title="Executive War Room"
      subtitle="Consortium Network Overview & Operations"
      stats={pageStats}
    >
      {/* ── Digital Asset Exposure (Task 165) ── */}
      <DigitalAssetExposure />

      {/* ── Member Roster ── */}
      <MemberRoster />

      {/* ── Settlement Volume + Network Economics ── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <WidgetShell title="Settlement Volume" icon={BarChart3}>
          <div className="space-y-4">
            {/* By period */}
            <div className="grid grid-cols-3 gap-3">
              {[
                { label: '24h', value: vol24h },
                { label: '7d', value: vol7d },
                { label: '30d', value: vol30d },
              ].map((p) => (
                <div key={p.label} className="text-center">
                  <div className="text-[18px] font-mono font-light text-coda-text tabular-nums">
                    {formatTokenAmount(p.value)}
                  </div>
                  <div className="text-[10px] text-coda-text-muted font-mono uppercase mt-0.5">{p.label}</div>
                </div>
              ))}
            </div>

            {/* By bank (bar chart) */}
            {bankVolumes.length > 0 && (
              <div>
                <div className="text-[11px] font-mono text-coda-text-muted uppercase tracking-wider mb-2">By Bank (Top 5)</div>
                {bankVolumes.map((b) => (
                  <div key={b.name} className="flex items-center gap-2 mb-1.5">
                    <span className="text-[12px] font-mono text-coda-text w-10">{b.name}</span>
                    <div className="flex-1 h-3 bg-black/[0.04] dark:bg-white/[0.04] rounded-full overflow-hidden">
                      <div
                        className="h-full bg-blue-500/50 rounded-full transition-all duration-500"
                        style={{ width: `${(b.volume / maxBankVol) * 100}%` }}
                      />
                    </div>
                    <span className="text-[11px] font-mono text-coda-text-muted tabular-nums w-16 text-right">
                      {formatTokenAmount(b.volume)}
                    </span>
                  </div>
                ))}
              </div>
            )}

            {/* By purpose code (bar chart) */}
            {purposeVolumes.length > 0 && (
              <div>
                <div className="text-[11px] font-mono text-coda-text-muted uppercase tracking-wider mb-2">By Purpose Code (Top 5)</div>
                {purposeVolumes.map((p) => (
                  <div key={p.code} className="flex items-center gap-2 mb-1.5">
                    <span className="text-[12px] font-mono text-coda-text w-24 truncate">{p.code}</span>
                    <div className="flex-1 h-3 bg-black/[0.04] dark:bg-white/[0.04] rounded-full overflow-hidden">
                      <div
                        className="h-full bg-purple-500/50 rounded-full transition-all duration-500"
                        style={{ width: `${(p.volume / maxPurposeVol) * 100}%` }}
                      />
                    </div>
                    <span className="text-[11px] font-mono text-coda-text-muted tabular-nums w-16 text-right">
                      {formatTokenAmount(p.volume)}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </WidgetShell>

        <NetworkEconomics />
      </div>

      {/* ── SLA Performance + Risk Posture ── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <WidgetShell title="SLA Performance" icon={Clock}>
          <div className="space-y-3">
            <div className="text-[11px] font-mono text-coda-text-muted uppercase tracking-wider">
              Avg Settlement Time by Risk Level
            </div>
            <div className="space-y-0">
              {/* Header */}
              <div className="grid grid-cols-3 gap-2 py-2 text-[11px] font-mono text-coda-text-muted uppercase tracking-wider">
                <div>Risk Level</div>
                <div>Avg Time</div>
                <div>Count</div>
              </div>
              {slaByRisk.map((row, i) => {
                const cfg = RISK_LEVEL_CONFIG[row.level as keyof typeof RISK_LEVEL_CONFIG];
                return (
                  <div
                    key={row.level}
                    className={`grid grid-cols-3 gap-2 py-2.5 ${
                      i > 0 ? 'border-t border-black/[0.06] dark:border-white/[0.06]' : ''
                    }`}
                  >
                    <div>
                      <span className={`inline-flex px-1.5 py-0.5 text-[11px] font-mono rounded ${cfg?.bg} ${cfg?.color}`}>
                        {cfg?.label || row.level}
                      </span>
                    </div>
                    <div className="text-[14px] font-mono text-coda-text tabular-nums">{row.avgTime}</div>
                    <div className="text-[13px] font-mono text-coda-text-muted tabular-nums">{row.count}</div>
                  </div>
                );
              })}
            </div>
            <div className="pt-2 border-t border-black/[0.06] dark:border-white/[0.06]">
              <div className="flex items-center justify-between">
                <span className="text-[12px] text-coda-text-muted">Overall Avg Settlement</span>
                <span className="text-[14px] font-mono font-medium text-coda-text">{avgSettlementTime(transactions)}</span>
              </div>
            </div>
          </div>
        </WidgetShell>

        <WidgetShell title="Risk Posture" icon={Shield}>
          <div className="space-y-4">
            {/* Summary cards */}
            <div className="grid grid-cols-2 gap-3">
              {[
                { label: 'In Lockup', value: inLockup, color: 'text-coda-brand' },
                { label: 'Escalated', value: escalated, color: escalated > 0 ? 'text-red-500' : 'text-coda-text-muted' },
                { label: 'High Risk Txns', value: highRiskTxs, color: highRiskTxs > 0 ? 'text-amber-500' : 'text-coda-text-muted' },
                { label: 'Critical Flags', value: criticalFlags, color: criticalFlags > 0 ? 'text-red-500' : 'text-coda-text-muted' },
              ].map((item) => (
                <div key={item.label} className="text-center py-2 rounded-lg bg-black/[0.02] dark:bg-white/[0.02]">
                  <div className={`text-[22px] font-mono font-light tabular-nums ${item.color}`}>
                    {item.value}
                  </div>
                  <div className="text-[10px] text-coda-text-muted font-mono uppercase mt-0.5">{item.label}</div>
                </div>
              ))}
            </div>

            {/* Fermata score distribution */}
            <div>
              <div className="text-[11px] font-mono text-coda-text-muted uppercase tracking-wider mb-2">
                Risk Score Distribution
              </div>
              <div className="flex items-center gap-2">
                {(['low', 'medium', 'high'] as const).map((level) => {
                  const count = riskDist[level];
                  const total = riskDist.low + riskDist.medium + riskDist.high;
                  const pct = total > 0 ? (count / total) * 100 : 0;
                  const cfg = RISK_LEVEL_CONFIG[level];
                  return (
                    <div key={level} className="flex-1">
                      <div className="flex items-center justify-between mb-1">
                        <span className={`text-[11px] font-mono ${cfg.color}`}>{cfg.label}</span>
                        <span className="text-[11px] font-mono text-coda-text-muted">{count}</span>
                      </div>
                      <div className="h-2 bg-black/[0.04] dark:bg-white/[0.04] rounded-full overflow-hidden">
                        <div
                          className={`h-full ${cfg.bg} rounded-full transition-all duration-500`}
                          style={{ width: `${Math.max(pct, 2)}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </WidgetShell>
      </div>

      {/* ── Agent Fleet Status ── */}
      <WidgetShell title="Agent Fleet Status" icon={Bot}>
        {agentFleet.length === 0 ? (
          <div className="py-4 text-center text-[13px] text-coda-text-muted">No agent activity recorded</div>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
            {agentFleet.map((agent) => (
              <div
                key={agent.name}
                className="rounded-lg bg-black/[0.02] dark:bg-white/[0.02] p-3"
              >
                <div className="flex items-center gap-2 mb-2">
                  <div className="w-2 h-2 rounded-full bg-emerald-500" />
                  <span className="text-[13px] font-mono font-medium text-coda-text">{agent.name}</span>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <div className="text-[16px] font-mono text-coda-text tabular-nums">{agent.decisions}</div>
                    <div className="text-[9px] text-coda-text-muted font-mono uppercase">Decisions</div>
                  </div>
                  <div>
                    <div className="text-[16px] font-mono text-coda-text tabular-nums">
                      {(agent.avgConfidence * 100).toFixed(0)}%
                    </div>
                    <div className="text-[9px] text-coda-text-muted font-mono uppercase">Confidence</div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </WidgetShell>

      {/* ── Task 168: Network Status, Onboarding, Incidents ── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <NetworkStatusPanel />
        <OnboardingTracker />
      </div>

      <IncidentLog />
    </PageShell>
  );
}
