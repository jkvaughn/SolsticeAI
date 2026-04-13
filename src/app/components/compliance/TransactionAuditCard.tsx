import { useEffect, useState } from 'react';
import {
  Shield, ExternalLink, FileDown,
  CheckCircle2, XCircle, AlertTriangle,
} from 'lucide-react';
import { toast } from 'sonner';
import { fetchComplianceLogs, fetchRiskScore } from '../../dataClient';
import { explorerUrl } from '../../types';
import { WidgetShell } from '../dashboard/WidgetShell';

// ============================================================
// TransactionAuditCard (Task 156)
//
// Per-transaction compliance audit card showing:
// - 6 Concord compliance checks with pass/fail/warning badges
// - Risk score with 4-dimension breakdown
// - Deterministic floor score + rules fired
// - On-chain signature with explorer link
// - Export PDF stub
// ============================================================

interface TransactionAuditCardProps {
  transactionId: string;
  solanaTxSignature?: string | null;
}

// ── Concord check names ──────────────────────────────────
const CONCORD_CHECKS = [
  'sanctions',
  'jurisdiction',
  'purpose_code',
  'aml_threshold',
  'counterparty',
  'duplicate',
] as const;

const CHECK_LABELS: Record<string, string> = {
  sanctions: 'Sanctions Screening',
  jurisdiction: 'Jurisdiction Verification',
  purpose_code: 'Purpose Code Validation',
  aml_threshold: 'AML Threshold Check',
  counterparty: 'Counterparty Due Diligence',
  duplicate: 'Duplicate Detection',
};

// ── Result badge ─────────────────────────────────────────

function ResultBadge({ result }: { result: boolean | string | null | undefined }) {
  if (result === true || result === 'passed' || result === 'pass') {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 text-[11px] font-mono rounded-md bg-emerald-500/15 text-emerald-500 dark:text-emerald-400">
        <CheckCircle2 size={11} />
        Pass
      </span>
    );
  }
  if (result === false || result === 'failed' || result === 'fail') {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 text-[11px] font-mono rounded-md bg-red-500/15 text-red-500 dark:text-red-400">
        <XCircle size={11} />
        Fail
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 text-[11px] font-mono rounded-md bg-amber-500/15 text-amber-600 dark:text-amber-400">
      <AlertTriangle size={11} />
      Warning
    </span>
  );
}

// ── Risk dimension display ───────────────────────────────

const RISK_DIMENSIONS = [
  { key: 'counterparty', label: 'Counterparty' },
  { key: 'jurisdiction', label: 'Jurisdiction' },
  { key: 'asset_type', label: 'Asset Type' },
  { key: 'behavioral', label: 'Behavioral' },
] as const;

function RiskBar({ value, max = 100 }: { value: number; max?: number }) {
  const pct = Math.min(Math.max((value / max) * 100, 0), 100);
  const color = pct >= 70 ? 'bg-red-500' : pct >= 40 ? 'bg-amber-500' : 'bg-emerald-500';
  return (
    <div className="flex items-center gap-2 flex-1">
      <div className="h-1.5 flex-1 bg-black/[0.06] dark:bg-white/[0.06] rounded-full overflow-hidden">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-[11px] font-mono text-coda-text-muted tabular-nums w-8 text-right">{Math.round(value)}</span>
    </div>
  );
}

// ============================================================
// Component
// ============================================================

export function TransactionAuditCard({ transactionId, solanaTxSignature }: TransactionAuditCardProps) {
  const [complianceLogs, setComplianceLogs] = useState<any[]>([]);
  const [riskScore, setRiskScore] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!transactionId) return;
    setLoading(true);
    Promise.all([
      fetchComplianceLogs(transactionId).catch(() => []),
      fetchRiskScore(transactionId).catch(() => null),
    ]).then(([logs, risk]) => {
      setComplianceLogs(logs ?? []);
      setRiskScore(risk);
      setLoading(false);
    });
  }, [transactionId]);

  if (loading) {
    return (
      <WidgetShell title="Compliance Audit" icon={Shield}>
        <div className="py-6 text-center text-[13px] text-coda-text-muted">Loading audit data...</div>
      </WidgetShell>
    );
  }

  // Build a map from compliance logs for check results
  const checkMap = new Map<string, { passed: boolean; detail: string }>();
  for (const log of complianceLogs) {
    const checkType = log.check_type || log.type;
    if (checkType) {
      checkMap.set(checkType, {
        passed: log.passed ?? log.result === 'passed',
        detail: log.detail || log.message || '',
      });
    }
  }

  // Risk dimension scores
  const dimensions = riskScore?.dimensions ?? riskScore?.breakdown ?? {};
  const floorScore = riskScore?.floor_score ?? riskScore?.deterministic_floor ?? null;
  const rulesFired = riskScore?.rules_fired ?? riskScore?.rules ?? [];
  const totalScore = riskScore?.total_score ?? riskScore?.score ?? null;

  return (
    <WidgetShell
      title="Compliance Audit"
      icon={Shield}
      headerRight={
        <button
          onClick={() => toast.info('PDF export coming soon')}
          className="inline-flex items-center gap-1 px-2 py-1 text-[11px] font-mono text-coda-text-muted hover:text-coda-text transition-colors cursor-pointer rounded-md hover:bg-black/[0.04] dark:hover:bg-white/[0.04]"
        >
          <FileDown size={12} />
          Export PDF
        </button>
      }
    >
      {/* ── Concord Compliance Checks ── */}
      <div className="mb-4">
        <div className="text-[11px] font-mono text-coda-text-muted uppercase tracking-wider mb-2">
          Concord Compliance Checks
        </div>
        <div className="space-y-0">
          {CONCORD_CHECKS.map((check, i) => {
            const result = checkMap.get(check);
            return (
              <div
                key={check}
                className={`flex items-center justify-between py-2 ${
                  i > 0 ? 'border-t border-black/[0.06] dark:border-white/[0.06]' : ''
                }`}
              >
                <div className="flex-1 min-w-0">
                  <div className="text-[13px] text-coda-text">{CHECK_LABELS[check]}</div>
                  {result?.detail && (
                    <div className="text-[11px] text-black/70 dark:text-white/70 truncate mt-0.5">
                      {result.detail}
                    </div>
                  )}
                </div>
                <div className="shrink-0 ml-3">
                  {result ? (
                    <ResultBadge result={result.passed} />
                  ) : (
                    <span className="text-[11px] font-mono text-coda-text-muted">\u2014</span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* ── Risk Score Breakdown ── */}
      {totalScore != null && (
        <div className="mb-4">
          <div className="text-[11px] font-mono text-coda-text-muted uppercase tracking-wider mb-2">
            Risk Score Breakdown
          </div>
          <div className="flex items-center gap-3 mb-3">
            <span className="text-2xl font-mono font-medium text-coda-text">{Math.round(totalScore)}</span>
            <span className="text-[12px] text-coda-text-muted">/ 100</span>
            {floorScore != null && (
              <span className="text-[11px] font-mono text-coda-text-muted ml-2">
                Floor: {Math.round(floorScore)}
              </span>
            )}
          </div>
          <div className="space-y-2">
            {RISK_DIMENSIONS.map(({ key, label }) => {
              const val = dimensions[key] ?? 0;
              return (
                <div key={key} className="flex items-center gap-3">
                  <span className="text-[12px] text-coda-text-muted w-24 shrink-0">{label}</span>
                  <RiskBar value={typeof val === 'number' ? val : Number(val) || 0} />
                </div>
              );
            })}
          </div>
          {Array.isArray(rulesFired) && rulesFired.length > 0 && (
            <div className="mt-3">
              <div className="text-[11px] font-mono text-coda-text-muted mb-1">Rules Fired</div>
              <div className="flex flex-wrap gap-1">
                {rulesFired.map((rule: string, i: number) => (
                  <span key={i} className="inline-flex px-2 py-0.5 text-[10px] font-mono rounded bg-amber-500/10 text-amber-600 dark:text-amber-400">
                    {rule}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── On-Chain Signature ── */}
      {solanaTxSignature && (
        <div className="pt-3 border-t border-black/[0.06] dark:border-white/[0.06]">
          <div className="text-[11px] font-mono text-coda-text-muted uppercase tracking-wider mb-1">
            On-Chain Signature
          </div>
          <a
            href={explorerUrl(solanaTxSignature, 'tx')}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 text-[12px] font-mono text-coda-brand hover:underline"
          >
            {solanaTxSignature.slice(0, 16)}...{solanaTxSignature.slice(-8)}
            <ExternalLink size={11} />
          </a>
        </div>
      )}
    </WidgetShell>
  );
}
