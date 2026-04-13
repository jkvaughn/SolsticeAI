import { useState } from 'react';
import { Link } from 'react-router';
import {
  ArrowRight, Shield, AlertTriangle, FileCheck, Activity,
  ListChecks, Brain,
} from 'lucide-react';
import {
  fetchTransactions, fetchCadenzaFlags, fetchAgentMessages,
  fetchCount, fetchTransactionCount, fetchCadenzaFlagCount,
  fetchLockupTokenCount,
} from '../../dataClient';
import type { Transaction, MessageType } from '../../types';
import { TX_STATUS_CONFIG, RISK_LEVEL_CONFIG, formatTokenAmount, MESSAGE_TYPE_CONFIG } from '../../types';
import { useBanks } from '../../contexts/BanksContext';
import { useSWRCache } from '../../hooks/useSWRCache';
import { PageShell } from '../PageShell';
import type { PageStat } from '../PageShell';
import { WidgetShell } from '../dashboard/WidgetShell';
import { AgentPerformanceDashboard } from '../governance/AgentPerformanceDashboard';
import { DecisionReviewQueue } from '../governance/DecisionReviewQueue';
import { CTRFilingPanel } from './CTRFilingPanel';
import { UnifiedAlertQueue } from './UnifiedAlertQueue';
import { ProofOfReservesLog } from './ProofOfReservesLog';
import {
  shield as shieldAnim,
  searchSecurity as searchSecurityAnim,
  lightning as lightningAnim,
  checkmark as checkmarkAnim,
} from '../icons/lottie';

// ============================================================
// Compliance Dashboard (Task 156)
//
// Role-specific dashboard shown when user has the "compliance"
// or "bsa_officer" persona. Shows active flags, transaction
// audit trail, and agent decision log with compliance-oriented stats.
// ============================================================

// ── Data types ─────────────────────────────────────────────

interface ComplianceStats {
  checksToday: number;
  flagsRaised: number;
  openEscalations: number;
  cleanSettlements: number;
}

interface ComplianceData {
  stats: ComplianceStats;
  flags: any[];
  transactions: Transaction[];
  agentDecisions: any[];
}

type SeverityFilter = 'all' | 'critical' | 'warning' | 'info';

const COMPLIANCE_MESSAGE_TYPES: MessageType[] = [
  'compliance_query', 'compliance_response', 'risk_alert',
];

async function fetchComplianceData(): Promise<ComplianceData> {
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  const [
    checksToday, flagsRaised, openEscalations, cleanSettlements,
    flags, transactions, agentMessages,
  ] = await Promise.all([
    fetchCount('compliance_logs', `created_at_gte=${todayStart.toISOString()}`).catch(() =>
      // Fallback: count all compliance logs if date filter not supported
      fetchCount('compliance_logs').catch(() => 0)
    ),
    fetchCadenzaFlagCount().catch(() => 0),
    fetchLockupTokenCount({ status: 'escalated' }).catch(() => 0),
    fetchTransactionCount({ status: 'settled' }).catch(() => 0),
    fetchCadenzaFlags().catch(() => []),
    fetchTransactions({ limit: 20 }).catch(() => []),
    fetchAgentMessages({ limit: 30 }).catch(() => []),
  ]);

  // Filter agent messages to compliance-related types
  const agentDecisions = (agentMessages ?? [])
    .filter((m: any) => COMPLIANCE_MESSAGE_TYPES.includes(m.message_type))
    .slice(0, 10);

  return {
    stats: {
      checksToday,
      flagsRaised,
      openEscalations,
      cleanSettlements,
    },
    flags: flags ?? [],
    transactions: transactions ?? [],
    agentDecisions,
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

const SEVERITY_STYLES: Record<string, { color: string; bg: string }> = {
  critical: { color: 'text-red-500 dark:text-red-400', bg: 'bg-red-500/15' },
  warning: { color: 'text-amber-600 dark:text-amber-400', bg: 'bg-amber-500/15' },
  info: { color: 'text-gray-500 dark:text-gray-400', bg: 'bg-gray-500/15' },
};

function getSeverityStyle(severity: string) {
  return SEVERITY_STYLES[severity] ?? SEVERITY_STYLES.info;
}

// ============================================================
// Component
// ============================================================

export function ComplianceDashboard() {
  const { cacheVersion } = useBanks();
  const [severityFilter, setSeverityFilter] = useState<SeverityFilter>('all');

  const { data } = useSWRCache<ComplianceData>({
    key: 'compliance-dashboard',
    fetcher: fetchComplianceData,
    deps: [cacheVersion],
    ttl: 2 * 60 * 1000,
  });

  const {
    stats = { checksToday: 0, flagsRaised: 0, openEscalations: 0, cleanSettlements: 0 },
    flags = [],
    transactions = [],
    agentDecisions = [],
  } = data ?? {};

  // Filter flags by severity
  const filteredFlags = severityFilter === 'all'
    ? flags
    : flags.filter((f: any) => f.severity === severityFilter);

  // ── PageShell stats ──
  const pageStats: PageStat[] = [
    {
      lottieData: searchSecurityAnim,
      value: stats.checksToday,
      label: 'Checks Run Today',
    },
    {
      lottieData: shieldAnim,
      value: stats.flagsRaised,
      label: 'Flags Raised',
    },
    {
      lottieData: lightningAnim,
      value: stats.openEscalations,
      label: 'Open Escalations',
    },
    {
      lottieData: checkmarkAnim,
      value: stats.cleanSettlements,
      label: 'Clean Settlements',
    },
  ];

  return (
    <PageShell
      title="Compliance Dashboard"
      subtitle="Regulatory Monitoring & Audit Trail"
      stats={pageStats}
    >
      {/* ── Active Flags ── */}
      <WidgetShell
        title="Active Flags"
        icon={AlertTriangle}
        headerRight={
          <div className="flex items-center gap-2">
            {(['all', 'critical', 'warning', 'info'] as SeverityFilter[]).map((sev) => (
              <button
                key={sev}
                onClick={() => setSeverityFilter(sev)}
                className={`text-[11px] font-mono px-2 py-0.5 rounded-md transition-colors cursor-pointer ${
                  severityFilter === sev
                    ? 'bg-black/10 dark:bg-white/10 text-coda-text'
                    : 'text-coda-text-muted hover:text-coda-text'
                }`}
              >
                {sev === 'all' ? 'All' : sev.charAt(0).toUpperCase() + sev.slice(1)}
              </button>
            ))}
            <span className="text-[11px] font-mono text-coda-text-muted ml-1">
              {filteredFlags.length} flag{filteredFlags.length !== 1 ? 's' : ''}
            </span>
          </div>
        }
        footer={
          <Link to="/escalations" className="text-[12px] text-coda-text-muted hover:text-coda-text transition-colors flex items-center gap-1">
            View all escalations <ArrowRight size={12} />
          </Link>
        }
      >
        {filteredFlags.length === 0 ? (
          <div className="py-6 text-center text-[13px] text-coda-text-muted">
            No active flags{severityFilter !== 'all' ? ` with severity "${severityFilter}"` : ''}
          </div>
        ) : (
          <div className="space-y-0">
            {/* Header row */}
            <div className="grid grid-cols-12 gap-2 py-2 text-[11px] font-mono text-coda-text-muted uppercase tracking-wider">
              <div className="col-span-3">Flag Type</div>
              <div className="col-span-2">Severity</div>
              <div className="col-span-3">Transaction</div>
              <div className="col-span-3">Detected At</div>
              <div className="col-span-1" />
            </div>
            {filteredFlags.slice(0, 15).map((flag: any, i: number) => {
              const sevStyle = getSeverityStyle(flag.severity || 'info');
              return (
                <Link
                  key={flag.id}
                  to={flag.transaction_id ? `/transactions/${flag.transaction_id}` : '/escalations'}
                  className={`grid grid-cols-12 gap-2 items-center py-2.5 hover:bg-black/[0.02] dark:hover:bg-white/[0.02] transition-colors group ${
                    i > 0 ? 'border-t border-black/[0.06] dark:border-white/[0.06]' : ''
                  }`}
                >
                  <div className="col-span-3 text-[13px] text-coda-text truncate">
                    {flag.flag_type || flag.type || 'Unknown'}
                  </div>
                  <div className="col-span-2">
                    <span className={`inline-flex items-center px-2 py-0.5 text-[11px] font-mono rounded-md ${sevStyle.bg} ${sevStyle.color}`}>
                      {flag.severity || 'info'}
                    </span>
                  </div>
                  <div className="col-span-3 text-[12px] text-coda-text-muted font-mono truncate">
                    {flag.transaction_id?.slice(0, 8) || '\u2014'}
                  </div>
                  <div className="col-span-3 text-[12px] text-coda-text-muted font-mono tabular-nums">
                    {fmtDate(flag.detected_at || flag.created_at)}
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

      {/* Bottom row: Audit Trail + Agent Decisions */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* ── Transaction Audit Trail ── */}
        <WidgetShell
          title="Transaction Audit Trail"
          icon={FileCheck}
          headerRight={
            <span className="text-[11px] font-mono text-coda-text-muted">
              Last {transactions.length}
            </span>
          }
          footer={
            <Link to="/transactions" className="text-[12px] text-coda-text-muted hover:text-coda-text transition-colors flex items-center gap-1">
              View all transactions <ArrowRight size={12} />
            </Link>
          }
        >
          {transactions.length === 0 ? (
            <div className="py-6 text-center text-[13px] text-coda-text-muted">
              No recent transactions
            </div>
          ) : (
            <div className="space-y-0">
              {transactions.slice(0, 10).map((tx: any, i: number) => {
                const compliancePassed = tx.compliance_passed;
                const riskCfg = tx.risk_level ? RISK_LEVEL_CONFIG[tx.risk_level as keyof typeof RISK_LEVEL_CONFIG] : null;
                const statusCfg = TX_STATUS_CONFIG[tx.status as keyof typeof TX_STATUS_CONFIG] || TX_STATUS_CONFIG.initiated;
                return (
                  <Link
                    key={tx.id}
                    to={`/transactions/${tx.id}`}
                    className={`flex items-center justify-between py-2.5 hover:bg-black/[0.02] dark:hover:bg-white/[0.02] transition-colors group ${
                      i > 0 ? 'border-t border-black/[0.06] dark:border-white/[0.06]' : ''
                    }`}
                  >
                    <div className="flex items-center gap-2 min-w-0 flex-1">
                      <span className="text-[13px] font-mono font-medium text-coda-text tabular-nums w-20 shrink-0">
                        {formatTokenAmount(tx.amount)}
                      </span>
                      <span className="text-[12px] text-coda-text-secondary truncate w-20 shrink-0">
                        {routeLabel(tx)}
                      </span>
                      {/* Compliance badge */}
                      {compliancePassed != null && (
                        <span className={`inline-flex items-center px-1.5 py-0.5 text-[10px] font-mono rounded ${
                          compliancePassed
                            ? 'bg-emerald-500/15 text-emerald-500 dark:text-emerald-400'
                            : 'bg-red-500/15 text-red-500 dark:text-red-400'
                        }`}>
                          {compliancePassed ? 'PASS' : 'FAIL'}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {riskCfg && (
                        <span className={`text-[11px] font-mono ${riskCfg.color}`}>{riskCfg.label}</span>
                      )}
                      <span className={`inline-flex items-center px-1.5 py-0.5 text-[10px] font-mono rounded-md ${statusCfg.bg} ${statusCfg.color}`}>
                        {statusCfg.label}
                      </span>
                      <ArrowRight size={13} className="text-coda-text-muted group-hover:text-coda-text transition-colors" />
                    </div>
                  </Link>
                );
              })}
            </div>
          )}
        </WidgetShell>

        {/* ── Agent Decision Log ── */}
        <WidgetShell
          title="Agent Decision Log"
          icon={Brain}
          headerRight={
            <span className="text-[11px] font-mono text-coda-text-muted">
              Last {agentDecisions.length}
            </span>
          }
        >
          {agentDecisions.length === 0 ? (
            <div className="py-6 text-center text-[13px] text-coda-text-muted">
              No recent compliance decisions
            </div>
          ) : (
            <div className="space-y-0">
              {agentDecisions.map((msg: any, i: number) => {
                const typeCfg = MESSAGE_TYPE_CONFIG[msg.message_type as MessageType] ?? { label: msg.message_type, color: 'text-coda-text-muted' };
                const agentName = msg.from_bank?.short_code || msg.from_bank_id?.slice(0, 6) || 'System';
                const summary = msg.natural_language || (typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content ?? {}).slice(0, 100));
                return (
                  <div
                    key={msg.id}
                    className={`py-3 ${
                      i > 0 ? 'border-t border-black/[0.06] dark:border-white/[0.06]' : ''
                    }`}
                  >
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-[12px] font-mono font-medium text-coda-text">{agentName}</span>
                      <span className={`text-[11px] font-mono ${typeCfg.color}`}>{typeCfg.label}</span>
                      <span className="flex-1" />
                      <span className="text-[11px] text-coda-text-muted font-mono tabular-nums">
                        {fmtDate(msg.created_at)}
                      </span>
                    </div>
                    <p className="text-[12px] text-black/70 dark:text-white/70 line-clamp-2">
                      {summary}
                    </p>
                  </div>
                );
              })}
            </div>
          )}
        </WidgetShell>
      </div>

      {/* ── CTR/SAR Filings (Task 164) ── */}
      <CTRFilingPanel />

      {/* ── Unified Alert Queue (Task 164) ── */}
      <UnifiedAlertQueue />

      {/* ── Proof of Reserves (Task 165) ── */}
      <ProofOfReservesLog />

      {/* ── Agent Governance (Task 162) ── */}
      <AgentPerformanceDashboard />
      <DecisionReviewQueue />
    </PageShell>
  );
}
