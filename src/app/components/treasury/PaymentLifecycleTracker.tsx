import {
  CheckCircle2, Loader2, XCircle, Clock,
  Brain, Shield, Gauge, Link2, AlertTriangle,
  Landmark, Globe, Scale, Activity, ExternalLink,
} from 'lucide-react';
import type { Transaction, AgentMessage } from '../../types';
import { explorerUrl, TX_STATUS_CONFIG } from '../../types';
import { WidgetShell } from '../dashboard/WidgetShell';

// ============================================================
// Payment Lifecycle Tracker (Task 155)
//
// Per-transaction pipeline drill-down showing every agent stage.
// Renders a horizontal progress bar (Maestro -> Concord ->
// Fermata -> Canto/Cadenza) plus risk breakdown, compliance
// checks, and on-chain link.
//
// Used inside TransactionDetail page for treasury-oriented
// pipeline visibility.
// ============================================================

// ── Pipeline stage definitions ─────────────────────────────

interface PipelineStage {
  key: string;
  agent: string;
  label: string;
  icon: typeof Brain;
  msgTypes: string[];
  actions?: string[];
}

const PIPELINE_STAGES: PipelineStage[] = [
  { key: 'dispatch', agent: 'Maestro', label: 'Dispatch', icon: Brain, msgTypes: ['payment_request'] },
  { key: 'compliance', agent: 'Concord', label: 'Compliance', icon: Shield, msgTypes: ['compliance_query', 'compliance_response'] },
  { key: 'risk', agent: 'Fermata', label: 'Risk Scoring', icon: Gauge, msgTypes: ['risk_alert'] },
  { key: 'settlement', agent: 'Canto', label: 'Settlement', icon: Link2, msgTypes: ['settlement_confirm'], actions: ['settlement_started'] },
];

// ── Types ──────────────────────────────────────────────────

interface StageVerdict {
  status: 'completed' | 'active' | 'failed' | 'pending';
  timestamp?: string;
  detail?: string;
  reasoning?: string;
}

interface PaymentLifecycleTrackerProps {
  tx: Transaction;
  messages: AgentMessage[];
  riskScore: any | null;
  complianceLogs: any[];
}

// ── Helpers ────────────────────────────────────────────────

function fmtTime(iso: string | null | undefined): string {
  if (!iso) return '\u2014';
  const d = new Date(iso);
  return d.toLocaleString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '\u2014';
  const d = new Date(iso);
  return d.toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function resolveStageVerdict(
  stage: PipelineStage,
  tx: Transaction,
  messages: AgentMessage[],
  riskScore: any | null,
  complianceLogs: any[],
): StageVerdict {
  const stageMessages = messages.filter((m) => {
    const matchesType = stage.msgTypes.includes(m.message_type);
    const content = m.content as Record<string, any> | undefined;
    const matchesAction = stage.actions?.includes(content?.action as string);
    return matchesType || matchesAction;
  });

  const latestMsg = stageMessages.length > 0
    ? stageMessages.reduce((a, b) => new Date(a.created_at) > new Date(b.created_at) ? a : b)
    : null;

  // Dispatch — always completed if tx exists
  if (stage.key === 'dispatch') {
    return {
      status: 'completed',
      timestamp: tx.initiated_at || tx.created_at,
      detail: `Dispatched ${tx.purpose_code || 'payment'}`,
      reasoning: latestMsg?.natural_language?.slice(0, 120) || undefined,
    };
  }

  // Compliance
  if (stage.key === 'compliance') {
    if (tx.compliance_passed === true) {
      return {
        status: 'completed',
        timestamp: latestMsg?.created_at || undefined,
        detail: 'All checks passed',
        reasoning: latestMsg?.natural_language?.slice(0, 120) || undefined,
      };
    }
    if (tx.compliance_passed === false) {
      return {
        status: 'failed',
        timestamp: latestMsg?.created_at || undefined,
        detail: 'Compliance rejected',
        reasoning: latestMsg?.natural_language?.slice(0, 120) || undefined,
      };
    }
    if (tx.status === 'compliance_check') {
      return { status: 'active', detail: 'Checking...' };
    }
    if (['risk_scored', 'executing', 'settled', 'locked', 'reversed'].includes(tx.status)) {
      return {
        status: 'completed',
        timestamp: latestMsg?.created_at || undefined,
        detail: 'Passed',
      };
    }
    return { status: 'pending' };
  }

  // Risk scoring
  if (stage.key === 'risk') {
    if (riskScore) {
      const score = riskScore.composite_score ?? riskScore.risk_score ?? 0;
      return {
        status: 'completed',
        timestamp: riskScore.created_at || latestMsg?.created_at || undefined,
        detail: `Score: ${score}`,
        reasoning: riskScore.finality_recommendation
          ? `Finality: ${riskScore.finality_recommendation.replace(/_/g, ' ')}`
          : undefined,
      };
    }
    if (tx.status === 'risk_scored' || ['executing', 'settled', 'locked', 'reversed'].includes(tx.status)) {
      return {
        status: 'completed',
        timestamp: latestMsg?.created_at || undefined,
        detail: tx.risk_score != null ? `Score: ${tx.risk_score}` : 'Scored',
      };
    }
    if (tx.status === 'compliance_check') {
      return { status: 'pending' };
    }
    return { status: 'pending' };
  }

  // Settlement
  if (stage.key === 'settlement') {
    if (tx.status === 'settled') {
      return {
        status: 'completed',
        timestamp: tx.settled_at || latestMsg?.created_at || undefined,
        detail: 'Finalized',
        reasoning: tx.settlement_method?.replace(/_/g, ' ') || undefined,
      };
    }
    if (tx.status === 'locked') {
      return {
        status: 'completed',
        timestamp: latestMsg?.created_at || undefined,
        detail: 'Lockup active',
        reasoning: 'Awaiting finality window',
      };
    }
    if (tx.status === 'rejected' || tx.status === 'reversed') {
      return {
        status: 'failed',
        timestamp: tx.reversed_at || latestMsg?.created_at || undefined,
        detail: tx.status === 'rejected' ? 'Rejected' : 'Reversed',
        reasoning: tx.reversal_reason || undefined,
      };
    }
    if (tx.status === 'executing') {
      return { status: 'active', detail: 'Executing...' };
    }
    return { status: 'pending' };
  }

  return { status: 'pending' };
}

// ── Status icon component ──────────────────────────────────

function StatusIcon({ status }: { status: StageVerdict['status'] }) {
  switch (status) {
    case 'completed':
      return <CheckCircle2 className="w-5 h-5 text-emerald-500" />;
    case 'active':
      return <Loader2 className="w-5 h-5 text-coda-brand animate-spin" />;
    case 'failed':
      return <XCircle className="w-5 h-5 text-red-500" />;
    default:
      return <Clock className="w-5 h-5 text-coda-text-muted/40" />;
  }
}

// ── Score bar (compact) ────────────────────────────────────

function ScoreBar({ label, score, icon: Icon }: { label: string; score: number; icon: typeof Shield }) {
  const color = score >= 70 ? 'bg-emerald-500' : score >= 40 ? 'bg-amber-500' : 'bg-red-500';
  const textColor = score >= 70 ? 'text-emerald-400' : score >= 40 ? 'text-amber-400' : 'text-red-400';
  return (
    <div className="flex items-center gap-2">
      <Icon className="w-3.5 h-3.5 text-coda-text-muted shrink-0" />
      <span className="text-[11px] text-coda-text-muted w-20 shrink-0">{label}</span>
      <div className="flex-1 h-2 rounded-full bg-coda-surface-hover/30 overflow-hidden">
        <div className={`h-full rounded-full ${color} transition-all duration-500`} style={{ width: `${Math.max(2, score)}%` }} />
      </div>
      <span className={`text-[11px] font-mono font-medium ${textColor} w-8 text-right`}>{score}</span>
    </div>
  );
}

// ============================================================
// Main Component
// ============================================================

export function PaymentLifecycleTracker({ tx, messages, riskScore, complianceLogs }: PaymentLifecycleTrackerProps) {
  const verdicts = PIPELINE_STAGES.map((stage) =>
    resolveStageVerdict(stage, tx, messages, riskScore, complianceLogs)
  );

  const completedCount = verdicts.filter((v) => v.status === 'completed').length;
  const progressPct = (completedCount / PIPELINE_STAGES.length) * 100;

  // Compliance checks from tx data
  const complianceChecks = tx.compliance_checks ?? [];

  return (
    <WidgetShell title="Payment Lifecycle" icon={Brain}>
      {/* ── Pipeline progress bar ── */}
      <div className="mb-4">
        <div className="h-1.5 rounded-full bg-coda-surface-hover/30 overflow-hidden mb-6">
          <div
            className="h-full rounded-full bg-gradient-to-r from-coda-brand to-emerald-500 transition-all duration-700"
            style={{ width: `${progressPct}%` }}
          />
        </div>

        {/* Pipeline stages — horizontal */}
        <div className="flex items-start">
          {PIPELINE_STAGES.map((stage, idx) => {
            const verdict = verdicts[idx];
            const StageIcon = stage.icon;
            const isLast = idx === PIPELINE_STAGES.length - 1;

            return (
              <div key={stage.key} className="flex items-start flex-1 min-w-0">
                {/* Stage node */}
                <div className="flex flex-col items-center gap-1.5 flex-1 min-w-0">
                  <div className={`w-11 h-11 rounded-xl flex items-center justify-center border transition-all duration-300 ${
                    verdict.status === 'completed' ? 'bg-emerald-500/15 border-emerald-500/30' :
                    verdict.status === 'failed' ? 'bg-red-500/15 border-red-500/30' :
                    verdict.status === 'active' ? 'bg-coda-brand/15 border-coda-brand/30 animate-pulse' :
                    'bg-coda-surface-hover/20 border-coda-border/20'
                  }`}>
                    <StatusIcon status={verdict.status} />
                  </div>
                  <span className={`text-[11px] font-mono font-medium ${
                    verdict.status === 'completed' ? 'text-emerald-500' :
                    verdict.status === 'failed' ? 'text-red-500' :
                    verdict.status === 'active' ? 'text-coda-brand' :
                    'text-coda-text-muted'
                  }`}>
                    {stage.agent}
                  </span>
                  <span className="text-[10px] text-coda-text-muted">{stage.label}</span>
                  {verdict.timestamp && (
                    <span className="text-[10px] text-coda-text-muted/60 font-mono tabular-nums">
                      {fmtTime(verdict.timestamp)}
                    </span>
                  )}
                  {verdict.detail && (
                    <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded ${
                      verdict.status === 'completed' ? 'bg-emerald-500/10 text-emerald-400' :
                      verdict.status === 'failed' ? 'bg-red-500/10 text-red-400' :
                      verdict.status === 'active' ? 'bg-coda-brand/10 text-coda-brand' :
                      'bg-coda-surface-hover/20 text-coda-text-muted'
                    }`}>
                      {verdict.detail}
                    </span>
                  )}
                  {verdict.reasoning && (
                    <span className="text-[10px] text-coda-text-muted/70 max-w-[140px] text-center line-clamp-2">
                      {verdict.reasoning}
                    </span>
                  )}
                </div>

                {/* Connector line between stages */}
                {!isLast && (
                  <div className="flex items-center pt-5 px-1">
                    <div className={`h-[2px] w-6 rounded-full transition-colors duration-300 ${
                      verdict.status === 'completed' ? 'bg-emerald-500/40' : 'bg-coda-border/20'
                    }`} />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* ── Risk Score Breakdown ── */}
      {riskScore && (
        <div className="pt-4 border-t border-black/[0.06] dark:border-white/[0.06]">
          <div className="flex items-center gap-2 mb-3">
            <Gauge size={13} className="text-coda-text-muted" />
            <span className="text-[11px] font-mono text-coda-text-muted uppercase tracking-wider">Risk Breakdown</span>
            <span className={`text-[12px] font-mono font-bold ml-auto ${
              (riskScore.composite_score ?? 0) >= 70 ? 'text-red-400' :
              (riskScore.composite_score ?? 0) >= 40 ? 'text-amber-400' :
              'text-emerald-400'
            }`}>
              {riskScore.composite_score ?? riskScore.risk_score ?? 0}/100
            </span>
          </div>
          <div className="space-y-1.5">
            <ScoreBar label="Counterparty" score={riskScore.counterparty_score ?? 0} icon={Landmark} />
            <ScoreBar label="Jurisdiction" score={riskScore.jurisdiction_score ?? 0} icon={Globe} />
            <ScoreBar label="Asset Type" score={riskScore.asset_type_score ?? 0} icon={Scale} />
            <ScoreBar label="Behavioral" score={riskScore.behavioral_score ?? 0} icon={Activity} />
          </div>
          {riskScore.floor_score != null && riskScore.floor_score > 0 && (
            <div className="flex items-center gap-2 mt-3 pt-2 border-t border-black/[0.04] dark:border-white/[0.04]">
              <Shield size={11} className="text-amber-500" />
              <span className="text-[10px] font-mono text-coda-text-muted">FLOOR</span>
              <span className="text-[11px] font-mono font-bold text-amber-400">{riskScore.floor_score}</span>
              {riskScore.rules_fired?.length > 0 && (
                <div className="flex gap-1 ml-2">
                  {riskScore.rules_fired.slice(0, 3).map((r: string) => (
                    <span key={r} className="px-1 py-0.5 rounded text-[9px] font-mono bg-amber-500/10 text-amber-500">{r}</span>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* ── Compliance Checks ── */}
      {complianceChecks.length > 0 && (
        <div className="pt-4 border-t border-black/[0.06] dark:border-white/[0.06]">
          <div className="flex items-center gap-2 mb-3">
            <Shield size={13} className="text-coda-text-muted" />
            <span className="text-[11px] font-mono text-coda-text-muted uppercase tracking-wider">Compliance Checks</span>
          </div>
          <div className="space-y-1">
            {complianceChecks.map((check: { type: string; passed: boolean; detail: string }, i: number) => (
              <div key={i} className="flex items-center gap-2">
                {check.passed ? (
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                ) : (
                  <XCircle className="w-3.5 h-3.5 text-red-500 shrink-0" />
                )}
                <span className="text-[12px] text-coda-text-secondary">{check.type}</span>
                <span className="text-[11px] text-coda-text-muted ml-auto truncate max-w-[200px]">{check.detail}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── On-chain signature ── */}
      {tx.solana_tx_signature && (
        <div className="pt-4 border-t border-black/[0.06] dark:border-white/[0.06]">
          <a
            href={explorerUrl(tx.solana_tx_signature, 'tx')}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 text-[12px] font-mono text-coda-brand hover:text-coda-brand/80 transition-colors"
          >
            <Link2 size={13} />
            <span className="truncate max-w-[280px]">{tx.solana_tx_signature}</span>
            <ExternalLink size={11} className="shrink-0" />
          </a>
        </div>
      )}
    </WidgetShell>
  );
}
