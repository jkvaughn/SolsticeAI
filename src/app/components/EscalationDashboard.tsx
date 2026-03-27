import { useEffect, useState, useCallback, useRef } from 'react';
import {
  Shield, AlertTriangle, Clock, CheckCircle2, RotateCcw,
  ChevronDown, ChevronRight, Loader2, Brain, TrendingUp,
  Coins, ExternalLink, Eye, ArrowRightLeft, AlertOctagon,
  Flag, Infinity as InfinityIcon,
} from 'lucide-react';
import { motion, AnimatePresence } from './motion-shim';
import { useNavigate } from 'react-router';
import { supabase, callServer } from '../supabaseClient';
import { useRealtimeSubscription } from '../hooks/useRealtimeSubscription';
import { formatTokenAmount, explorerUrl, truncateAddress } from '../types';
import { useAuth } from '../contexts/AuthContext';
import { PageShell } from './PageShell';
import type { PageStat } from './PageShell';
import {
  AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogFooter,
  AlertDialogTitle, AlertDialogDescription, AlertDialogAction, AlertDialogCancel,
} from './ui/alert-dialog';

// ============================================================
// Types
// ============================================================

interface EscalationItem {
  lockup_id: string;
  transaction_id: string;
  sender_bank: { id: string; name: string; short_code: string; jurisdiction: string; tier?: string; swift_bic?: string } | null;
  receiver_bank: { id: string; name: string; short_code: string; jurisdiction: string; tier?: string; swift_bic?: string } | null;
  amount_display: number;
  purpose_code: string;
  memo: string | null;
  risk_level: string;
  risk_score: number;
  risk_reasoning: string | null;
  yb_token_symbol: string;
  yb_token_amount: string;
  tb_token_symbol: string;
  tb_token_amount: string;
  yield_rate_bps: number;
  yield_accrued_raw: string;
  yield_accrued_display: string;
  lockup_start: string;
  lockup_end: string | null;
  status: string;
  resolution: string | null;
  escalated_at: string;
  escalation_duration_seconds: number;
  escalation_duration_display: string;
  flags: any[];
  flag_count: number;
  transaction_created_at: string | null;
  solana_tx_signature: string | null;
}

interface Briefing {
  recommended_action: string;
  confidence: number;
  summary: string;
  risk_factors: string[];
  mitigating_factors: string[];
  yield_impact: string;
  regulatory_note?: string;
}

interface SarDraft {
  subject: string;
  transaction: string;
  indicators: string[];
  typology: 'structuring' | 'velocity_abuse' | 'sanctions_evasion' | 'duplicate_pattern' | 'anomalous_behavior';
  recommendedAction: 'file' | 'monitor' | 'dismiss';
}

// ============================================================
// Helpers
// ============================================================

function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency', currency: 'USD',
    minimumFractionDigits: 0, maximumFractionDigits: 2,
  }).format(amount);
}

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return `${h}h ${m}m`;
}

const SEVERITY_STYLES: Record<string, { bg: string; text: string; border: string }> = {
  info:     { bg: 'bg-blue-500/10',   text: 'text-blue-400',   border: 'border-blue-500/20' },
  warn:     { bg: 'bg-amber-500/10',  text: 'text-amber-400',  border: 'border-amber-500/20' },
  critical: { bg: 'bg-red-500/10',    text: 'text-red-400',    border: 'border-red-500/20' },
  escalate: { bg: 'bg-coda-brand/10', text: 'text-coda-brand', border: 'border-coda-brand/20' },
};

// ============================================================
// Live Yield Counter
// ============================================================

function LiveYieldCounter({ baseAmountRaw, yieldRateBps, lockupStart }: {
  baseAmountRaw: string;
  yieldRateBps: number;
  lockupStart: string;
}) {
  const [displayYield, setDisplayYield] = useState('$0.00');

  useEffect(() => {
    const principal = Number(BigInt(baseAmountRaw || '0')) / 1_000_000;
    const annualRate = yieldRateBps / 10_000;
    const startMs = new Date(lockupStart).getTime();

    const tick = () => {
      const elapsedSeconds = (Date.now() - startMs) / 1000;
      const yieldAmount = principal * annualRate * (elapsedSeconds / (365.25 * 86400));
      setDisplayYield(`$${yieldAmount.toFixed(6)}`);
    };

    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [baseAmountRaw, yieldRateBps, lockupStart]);

  return (
    <span className="font-mono text-emerald-400 tabular-nums">{displayYield}</span>
  );
}

// ============================================================
// Live Duration Counter
// ============================================================

function LiveDurationCounter({ escalatedAt }: { escalatedAt: string }) {
  const [duration, setDuration] = useState('');

  useEffect(() => {
    const startMs = new Date(escalatedAt).getTime();
    const tick = () => {
      const elapsed = Math.floor((Date.now() - startMs) / 1000);
      setDuration(formatDuration(elapsed));
    };
    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [escalatedAt]);

  return <span className="font-mono tabular-nums">{duration}</span>;
}

// ============================================================
// Escalation Card
// ============================================================

function EscalationCard({
  item,
  onApprove,
  onReverse,
  isResolving,
  resolvingDecision,
}: {
  item: EscalationItem;
  onApprove: (lockupId: string) => void;
  onReverse: (lockupId: string) => void;
  isResolving: string | null;
  resolvingDecision: 'approve' | 'reverse' | null;
}) {
  const navigate = useNavigate();
  const [briefing, setBriefing] = useState<Briefing | null>(null);
  const [briefingLoading, setBriefingLoading] = useState(false);
  const [briefingError, setBriefingError] = useState<string | null>(null);
  const [briefingExpanded, setBriefingExpanded] = useState(false);
  const [sarDraft, setSarDraft] = useState<SarDraft | null>(null);
  const [sarExpanded, setSarExpanded] = useState(false);
  const [flagsExpanded, setFlagsExpanded] = useState(false);

  const sender = item.sender_bank;
  const receiver = item.receiver_bank;
  const corridor = sender && receiver
    ? `${sender.jurisdiction} → ${receiver.jurisdiction}`
    : 'Unknown';

  const loadBriefing = useCallback(async () => {
    if (briefing) {
      setBriefingExpanded(!briefingExpanded);
      return;
    }
    setBriefingLoading(true);
    setBriefingError(null);
    try {
      const res = await callServer<{ briefing: Briefing; sarDraft?: SarDraft }>('/cadenza-escalate', {
        action: 'get_briefing',
        lockup_id: item.lockup_id,
      });
      setBriefing(res.briefing);
      if (res.sarDraft) setSarDraft(res.sarDraft);
      setBriefingExpanded(true);
    } catch (err) {
      setBriefingError(err instanceof Error ? err.message : String(err));
    } finally {
      setBriefingLoading(false);
    }
  }, [item.lockup_id, briefing, briefingExpanded]);

  const resolvingThis = isResolving === item.lockup_id;

  // Processing step labels for the animated overlay
  const processingSteps = resolvingDecision === 'approve'
    ? ['Validating lockup state…', 'Settling on Solana…', 'Distributing yield…', 'Finalizing…']
    : ['Validating lockup state…', 'Initiating clawback…', 'Returning deposit…', 'Finalizing…'];

  return (
    <div className={`liquid-glass-card squircle overflow-hidden relative transition-all duration-300 ${resolvingThis ? 'ring-2 ring-offset-1 ring-offset-transparent' : ''} ${resolvingThis && resolvingDecision === 'approve' ? 'ring-emerald-500/40' : ''} ${resolvingThis && resolvingDecision === 'reverse' ? 'ring-red-500/40' : ''}`}>
      {/* Processing overlay */}
      <AnimatePresence>
        {resolvingThis && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.3 }}
            className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-4 backdrop-blur-[6px]"
            style={{ background: 'rgba(0,0,0,0.35)' }}
          >
            {/* Pulsing ring spinner */}
            <div className="relative">
              <div
                className={`w-12 h-12 rounded-full border-2 border-t-transparent animate-spin ${resolvingDecision === 'approve' ? 'border-emerald-400' : 'border-red-400'}`}
              />
              <div className="absolute inset-0 flex items-center justify-center">
                {resolvingDecision === 'approve'
                  ? <CheckCircle2 size={20} className="text-emerald-400" />
                  : <RotateCcw size={20} className="text-red-400" />
                }
              </div>
            </div>

            {/* Animated step label */}
            <ProcessingStepLabel steps={processingSteps} color={resolvingDecision === 'approve' ? 'emerald' : 'red'} />

            {/* Solana status badge */}
            <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-black/30 border border-white/10">
              <div
                className={`w-1.5 h-1.5 rounded-full animate-pulse ${resolvingDecision === 'approve' ? 'bg-emerald-400' : 'bg-red-400'}`}
              />
              <span className="text-[10px] font-mono text-white/70">
                {resolvingDecision === 'approve' ? 'Settling' : 'Reversing'} on Solana
              </span>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Card content — dims when processing */}
      <div className={`transition-all duration-300 ${resolvingThis ? 'opacity-30 pointer-events-none select-none' : ''}`}>
        {/* Card Header */}
        <div className="p-5 pb-0">
          <div className="flex items-start justify-between gap-4">
            <div className="flex-1 min-w-0">
              {/* Bank corridor */}
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-sm font-semibold text-coda-text truncate">
                  {sender?.name || 'Unknown'}
                </span>
                <ArrowRightLeft size={14} className="text-coda-text-muted flex-shrink-0" />
                <span className="text-sm font-semibold text-coda-text truncate">
                  {receiver?.name || 'Unknown'}
                </span>
              </div>
              <div className="flex items-center gap-3 mt-1.5 flex-wrap">
                <span className="text-xs text-coda-text-muted font-mono">{corridor}</span>
                <span className="text-xs text-coda-text-muted">|</span>
                <span className="text-xs text-coda-text-muted">{item.purpose_code}</span>
                {item.solana_tx_signature && (
                  <>
                    <span className="text-xs text-coda-text-muted">|</span>
                    <a
                      href={explorerUrl(item.solana_tx_signature)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs text-coda-brand hover:underline flex items-center gap-1"
                    >
                      Explorer <ExternalLink size={10} />
                    </a>
                  </>
                )}
              </div>
            </div>

            {/* Amount */}
            <div className="text-right flex-shrink-0">
              <p className="text-lg font-bold text-coda-text tabular-nums">
                {formatCurrency(item.amount_display)}
              </p>
              <div className="flex items-center gap-1 justify-end mt-0.5">
                <span className={`inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded-md ${
                  item.risk_level === 'high' ? 'bg-red-500/15 text-red-400' :
                  item.risk_level === 'medium' ? 'bg-amber-500/15 text-amber-400' :
                  'bg-emerald-500/15 text-emerald-400'
                }`}>
                  {item.risk_level?.toUpperCase()} ({item.risk_score})
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Stats row */}
        <div className="px-5 py-3 mt-3 border-t border-coda-border-subtle">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            {/* Time in escalation */}
            <div>
              <p className="text-[10px] text-coda-text-muted mb-0.5">Escalation Time</p>
              <div className="flex items-center gap-1.5 text-sm text-amber-400">
                <Clock size={13} />
                <LiveDurationCounter escalatedAt={item.escalated_at} />
              </div>
            </div>

            {/* Yield accruing */}
            <div>
              <p className="text-[10px] text-coda-text-muted mb-0.5">Yield Accrued</p>
              <div className="flex items-center gap-1.5 text-sm">
                <TrendingUp size={13} className="text-emerald-400" />
                <LiveYieldCounter
                  baseAmountRaw={item.yb_token_amount}
                  yieldRateBps={item.yield_rate_bps}
                  lockupStart={item.lockup_start}
                />
              </div>
            </div>

            {/* Flags count */}
            <div>
              <p className="text-[10px] text-coda-text-muted mb-0.5">Cadenza Flags</p>
              <div className="flex items-center gap-1.5 text-sm text-coda-brand">
                <Flag size={13} />
                <span className="font-mono">{item.flag_count}</span>
              </div>
            </div>

            {/* Rate */}
            <div>
              <p className="text-[10px] text-coda-text-muted mb-0.5">Yield Rate</p>
              <div className="flex items-center gap-1.5 text-sm text-blue-400">
                <Coins size={13} />
                <span className="font-mono">{(item.yield_rate_bps / 100).toFixed(2)}%</span>
              </div>
            </div>
          </div>
        </div>

        {/* Flags timeline (collapsible) */}
        {item.flags.length > 0 && (
          <div className="px-5 border-t border-coda-border-subtle">
            <button
              onClick={() => setFlagsExpanded(!flagsExpanded)}
              className="w-full flex items-center gap-2 py-2.5 text-xs text-coda-text-muted hover:bg-black/[0.02] dark:hover:bg-white/[0.02] transition-colors cursor-pointer"
            >
              {flagsExpanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
              <span className="font-medium">Cadenza Flag Timeline ({item.flags.length})</span>
            </button>
            {flagsExpanded && (
              <div className="pb-3 space-y-2">
                {item.flags.map((flag: any, i: number) => {
                  const sev = SEVERITY_STYLES[flag.severity] || SEVERITY_STYLES.info;
                  return (
                    <div
                      key={flag.id || i}
                      className={`flex items-start gap-2.5 p-2.5 rounded-lg border ${sev.bg} ${sev.border}`}
                    >
                      <div className={`mt-0.5 ${sev.text}`}>
                        {flag.severity === 'escalate' ? <AlertOctagon size={13} /> :
                         flag.severity === 'critical' ? <AlertTriangle size={13} /> :
                         flag.severity === 'warn' ? <Flag size={13} /> :
                         <Eye size={13} />}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className={`text-[10px] font-bold ${sev.text}`}>
                            {flag.severity}
                          </span>
                          <span className="text-[10px] text-coda-text-muted font-mono">
                            {flag.flag_type}
                          </span>
                          <span className="text-[10px] text-coda-text-muted ml-auto">
                            {new Date(flag.detected_at).toLocaleString()}
                          </span>
                        </div>
                        <p className="text-xs text-coda-text-secondary mt-0.5 leading-relaxed">
                          {flag.reasoning}
                        </p>
                        {flag.action_taken && (
                          <p className="text-[10px] text-coda-text-muted mt-1 italic">
                            Action: {flag.action_taken}
                          </p>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* Briefing panel */}
        <div className="px-5 border-t border-coda-border-subtle">
          <button
            onClick={loadBriefing}
            disabled={briefingLoading}
            className="w-full flex items-center gap-2 py-2.5 text-xs text-coda-text-muted hover:bg-black/[0.02] dark:hover:bg-white/[0.02] transition-colors cursor-pointer disabled:opacity-50"
          >
            {briefingLoading ? (
              <Loader2 size={13} className="animate-spin" />
            ) : briefingExpanded ? (
              <ChevronDown size={13} />
            ) : (
              <ChevronRight size={13} />
            )}
            <Brain size={13} className="text-coda-brand" />
            <span className="font-medium">
              {briefingLoading ? 'Generating AI Briefing...' : briefing ? 'AI Briefing' : 'View Briefing'}
            </span>
            {briefing && (
              <span className={`ml-auto text-[10px] font-bold px-1.5 py-0.5 rounded ${
                briefing.recommended_action === 'approve' ? 'bg-emerald-500/15 text-emerald-400' : 'bg-red-500/15 text-red-400'
              }`}>
                Recommends: {briefing.recommended_action} ({Math.round(briefing.confidence * 100)}%)
              </span>
            )}
          </button>

          {briefingError && (
            <div className="pb-3">
              <p className="text-xs text-red-400 bg-red-500/10 rounded-lg p-2.5">{briefingError}</p>
            </div>
          )}

          {briefingExpanded && briefing && (
            <div className="pb-4 space-y-3">
              {/* Summary */}
              <div className="p-3 rounded-lg bg-coda-brand/5 border border-coda-brand/15">
                <p className="text-xs text-coda-text-secondary leading-relaxed">{briefing.summary}</p>
              </div>

              {/* Confidence gauge */}
              <div>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-[10px] text-coda-text-muted">Confidence</span>
                  <span className="text-xs font-mono font-bold text-coda-text">
                    {Math.round(briefing.confidence * 100)}%
                  </span>
                </div>
                <div className="w-full h-1.5 rounded-full bg-coda-surface-alt overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all duration-500 ${
                      briefing.confidence >= 0.8 ? 'bg-emerald-500' :
                      briefing.confidence >= 0.5 ? 'bg-amber-500' : 'bg-red-500'
                    }`}
                    style={{ width: `${briefing.confidence * 100}%` }}
                  />
                </div>
              </div>

              {/* Risk & mitigating factors */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {briefing.risk_factors?.length > 0 && (
                  <div>
                    <p className="text-[10px] text-red-400 mb-1.5">Risk Factors</p>
                    <ul className="space-y-1">
                      {briefing.risk_factors.map((f, i) => (
                        <li key={i} className="text-xs text-coda-text-secondary flex items-start gap-1.5">
                          <AlertTriangle size={10} className="text-red-400 mt-0.5 flex-shrink-0" />
                          {f}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {briefing.mitigating_factors?.length > 0 && (
                  <div>
                    <p className="text-[10px] text-emerald-400 mb-1.5">Mitigating Factors</p>
                    <ul className="space-y-1">
                      {briefing.mitigating_factors.map((f, i) => (
                        <li key={i} className="text-xs text-coda-text-secondary flex items-start gap-1.5">
                          <CheckCircle2 size={10} className="text-emerald-400 mt-0.5 flex-shrink-0" />
                          {f}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>

              {/* Yield impact */}
              {briefing.yield_impact && (
                <div className="p-2.5 rounded-lg bg-emerald-500/5 border border-emerald-500/15">
                  <p className="text-[10px] text-emerald-400 mb-0.5">Yield Impact</p>
                  <p className="text-xs text-coda-text-secondary">{briefing.yield_impact}</p>
                </div>
              )}

              {/* Regulatory note */}
              {briefing.regulatory_note && (
                <div className="p-2.5 rounded-lg bg-amber-500/5 border border-amber-500/15">
                  <p className="text-[10px] text-amber-400 mb-0.5">Regulatory Note</p>
                  <p className="text-xs text-coda-text-secondary">{briefing.regulatory_note}</p>
                </div>
              )}

              {/* SAR Draft (Task 127) */}
              {sarDraft && (
                <div className="rounded-lg bg-amber-500/[0.08] border border-amber-500/20 overflow-hidden">
                  <button
                    onClick={() => setSarExpanded(!sarExpanded)}
                    className="w-full flex items-center gap-2 px-3 py-2.5 text-xs hover:bg-black/[0.02] dark:hover:bg-white/[0.02] transition-colors cursor-pointer"
                  >
                    <AlertTriangle size={13} className="text-amber-500" />
                    <span className="font-semibold text-amber-500">SAR DRAFT</span>
                    <span className="text-[10px] text-coda-text-muted">&mdash; Not Filed</span>
                    <span className="ml-auto px-1.5 py-0.5 rounded text-[9px] font-bold bg-amber-500/15 text-amber-400 border border-amber-500/20">
                      For Review Only
                    </span>
                    {sarExpanded ? <ChevronDown size={12} className="text-amber-400" /> : <ChevronRight size={12} className="text-amber-400" />}
                  </button>

                  {sarExpanded && (
                    <div className="px-3 pb-3 space-y-2.5">
                      {/* Subject */}
                      <div>
                        <p className="text-[10px] text-coda-text-muted mb-0.5">Subject</p>
                        <p className="text-xs text-coda-text-secondary">{sarDraft.subject}</p>
                      </div>

                      {/* Transaction */}
                      <div>
                        <p className="text-[10px] text-coda-text-muted mb-0.5">Transaction</p>
                        <p className="text-xs text-coda-text-secondary font-mono">{sarDraft.transaction}</p>
                      </div>

                      {/* Indicators */}
                      {sarDraft.indicators.length > 0 && (
                        <div>
                          <p className="text-[10px] text-coda-text-muted mb-1">Suspicious Indicators</p>
                          <ul className="space-y-1">
                            {sarDraft.indicators.map((ind, i) => (
                              <li key={i} className="text-xs text-coda-text-secondary flex items-start gap-1.5">
                                <AlertTriangle size={10} className="text-amber-400 mt-0.5 flex-shrink-0" />
                                {ind}
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}

                      {/* Typology + Action badges */}
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="px-2 py-0.5 rounded text-[10px] font-bold font-mono bg-coda-brand/15 text-coda-brand border border-coda-brand/20">
                          {sarDraft.typology.replace(/_/g, ' ')}
                        </span>
                        <span className={`px-2 py-0.5 rounded text-[10px] font-bold font-mono border ${
                          sarDraft.recommendedAction === 'file'
                            ? 'bg-red-500/15 text-red-400 border-red-500/20'
                            : sarDraft.recommendedAction === 'monitor'
                            ? 'bg-amber-500/15 text-amber-400 border-amber-500/20'
                            : 'bg-coda-surface-hover/30 text-coda-text-muted border-coda-border/20'
                        }`}>
                          {sarDraft.recommendedAction}
                        </span>
                      </div>

                      {/* Disclaimer */}
                      <p className="text-xs text-coda-text-faint italic">
                        This is a simulation draft. No actual SAR has been filed with FinCEN.
                      </p>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Action buttons */}
        <div className="px-5 py-4 border-t border-coda-border-subtle flex items-center gap-3">
          <button
            onClick={() => navigate(`/transactions/${item.transaction_id}`)}
            className="flex items-center px-3 py-2 text-xs font-medium text-coda-text-muted cursor-pointer hover:text-coda-text transition-colors"
          >
            <Eye size={13} />
            <span>View Details</span>
          </button>

          <div className="flex-1" />

          <button
            onClick={() => onReverse(item.lockup_id)}
            disabled={resolvingThis}
            className="liquid-button flex items-center px-4 py-2 text-xs font-medium bg-red-500/10 text-red-400 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {resolvingThis ? <Loader2 size={13} className="animate-spin" /> : <RotateCcw size={13} />}
            <span>Reverse</span>
          </button>

          <button
            onClick={() => onApprove(item.lockup_id)}
            disabled={resolvingThis}
            className="liquid-button flex items-center px-4 py-2 text-xs font-medium text-emerald-400 bg-transparent cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {resolvingThis ? <Loader2 size={13} className="animate-spin" /> : <CheckCircle2 size={13} />}
            <span>Approve</span>
          </button>
        </div>
      </div>{/* end dimming wrapper */}
    </div>
  );
}

// ============================================================
// Processing step label — cycles through steps with crossfade
// ============================================================

function ProcessingStepLabel({ steps, color }: { steps: string[]; color: 'emerald' | 'red' }) {
  const [stepIndex, setStepIndex] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => {
      setStepIndex(prev => (prev + 1) % steps.length);
    }, 2200);
    return () => clearInterval(interval);
  }, [steps.length]);

  return (
    <div className="h-5 relative w-48 flex items-center justify-center">
      <AnimatePresence mode="wait">
        <motion.span
          key={stepIndex}
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -6 }}
          transition={{ duration: 0.25 }}
          className={`absolute text-xs font-medium ${color === 'emerald' ? 'text-emerald-300' : 'text-red-300'}`}
        >
          {steps[stepIndex]}
        </motion.span>
      </AnimatePresence>
    </div>
  );
}

// ============================================================
// Main Component
// ============================================================

export function EscalationDashboard() {
  const { user } = useAuth();
  const operatorName = user?.user_metadata?.full_name || user?.user_metadata?.name || user?.email || 'Operator';

  const [escalations, setEscalations] = useState<EscalationItem[]>([]);
  const [totalMonitored, setTotalMonitored] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isResolving, setIsResolving] = useState<string | null>(null);
  const [resolvingDecision, setResolvingDecision] = useState<'approve' | 'reverse' | null>(null);
  const isResolvingRef = useRef<string | null>(null);

  // Confirmation dialog state
  const [confirmDialog, setConfirmDialog] = useState<{
    open: boolean;
    lockupId: string;
    decision: 'approve' | 'reverse';
    amount?: string;
  }>({ open: false, lockupId: '', decision: 'approve' });

  // Fetch escalations
  const fetchEscalations = useCallback(async () => {
    try {
      const res = await callServer<{ escalations: EscalationItem[]; count: number }>('/cadenza-escalate', {
        action: 'get_escalations',
      });
      setEscalations(res.escalations || []);
      setError(null);
    } catch (err) {
      console.error('[EscalationDashboard] fetch error:', err);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  // Fetch total monitored lockup count for empty state
  const fetchMonitoredCount = useCallback(async () => {
    try {
      const { count, error: countErr } = await supabase
        .from('lockup_tokens')
        .select('id', { count: 'exact', head: true });
      if (!countErr && count !== null) {
        setTotalMonitored(count);
      }
    } catch {
      // non-critical
    }
  }, []);

  // Initial load
  useEffect(() => {
    fetchEscalations();
    fetchMonitoredCount();
  }, [fetchEscalations, fetchMonitoredCount]);

  // Realtime subscription for lockup_tokens status changes
  useRealtimeSubscription({
    channelName: 'escalation-dashboard-lockups',
    subscriptions: [
      {
        table: 'lockup_tokens',
        event: '*',
        callback: () => {
          // Suppress realtime re-fetches while a resolution action is in-flight
          // to prevent the item from reappearing before /lockup-settle completes
          if (isResolvingRef.current) {
            console.log('[EscalationDashboard] Suppressing realtime re-fetch — resolution in progress');
            return;
          }
          fetchEscalations();
          fetchMonitoredCount();
        },
      },
    ],
    onPoll: () => {
      if (!isResolvingRef.current) {
        fetchEscalations();
        fetchMonitoredCount();
      }
    },
  });

  // Handle approve/reverse with confirmation
  const handleApproveClick = useCallback((lockupId: string) => {
    const item = escalations.find(e => e.lockup_id === lockupId);
    setConfirmDialog({
      open: true,
      lockupId,
      decision: 'approve',
      amount: item ? formatCurrency(item.amount_display) : undefined,
    });
  }, [escalations]);

  const handleReverseClick = useCallback((lockupId: string) => {
    const item = escalations.find(e => e.lockup_id === lockupId);
    setConfirmDialog({
      open: true,
      lockupId,
      decision: 'reverse',
      amount: item ? formatCurrency(item.amount_display) : undefined,
    });
  }, [escalations]);

  const executeResolution = useCallback(async () => {
    const { lockupId, decision } = confirmDialog;
    setConfirmDialog(prev => ({ ...prev, open: false }));
    setIsResolving(lockupId);
    isResolvingRef.current = lockupId;
    setResolvingDecision(decision);

    try {
      const result = await callServer<{ error?: string }>('/cadenza-escalate', {
        action: 'resolve_escalation',
        lockup_id: lockupId,
        decision,
        operator_name: operatorName,
      });

      // Check for server-side error returned in 200 body
      if (result?.error) {
        throw new Error(result.error);
      }

      // Remove from local state immediately
      setEscalations(prev => prev.filter(e => e.lockup_id !== lockupId));

      // Delayed confirmation re-fetch to verify server state is consistent
      setTimeout(() => {
        fetchEscalations();
        fetchMonitoredCount();
      }, 2000);
    } catch (err) {
      console.error(`[EscalationDashboard] ${decision} error:`, err);
      setError(`Failed to ${decision}: ${err instanceof Error ? err.message : String(err)}`);
      // Re-fetch to restore accurate state after failure
      fetchEscalations();
    } finally {
      setIsResolving(null);
      isResolvingRef.current = null;
      setResolvingDecision(null);
    }
  }, [confirmDialog, operatorName, fetchEscalations, fetchMonitoredCount]);

  const pageStats: PageStat[] = [
    { icon: AlertOctagon, value: escalations.length, label: 'Active Escalations' },
    { icon: Eye, value: totalMonitored, label: 'Monitored Lockups' },
  ];

  return (
    <PageShell
      title="Cadenza Escalations"
      subtitle="Human-in-the-loop review for escalated lockup transactions"
      stats={pageStats}
    >

      {/* Error banner */}
      {error && (
        <div className="liquid-glass-card squircle p-4 border-red-500/30 bg-red-500/5">
          <div className="flex items-center gap-2">
            <AlertTriangle size={14} className="text-red-400 flex-shrink-0" />
            <p className="text-xs text-red-400 flex-1">{error}</p>
            <button
              onClick={() => setError(null)}
              className="text-xs text-red-400 cursor-pointer hover:text-red-300 transition-colors"
            >
              <span>Dismiss</span>
            </button>
          </div>
        </div>
      )}

      {/* Loading state */}
      {loading && (
        <div className="liquid-glass-card squircle p-12 flex flex-col items-center justify-center gap-3">
          <Loader2 size={24} className="animate-spin text-coda-text-muted" />
          <p className="text-sm text-coda-text-muted">Loading escalations...</p>
        </div>
      )}

      {/* Empty state */}
      <AnimatePresence>
        {!loading && escalations.length === 0 && (
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.35, ease: [0.25, 0.46, 0.45, 0.94] }}
            className="liquid-glass-card squircle p-12 flex flex-col items-center justify-center gap-4"
          >
            <div className="w-16 h-16 rounded-2xl bg-emerald-500/10 flex items-center justify-center">
              <CheckCircle2 size={32} className="text-emerald-400" />
            </div>
            <div className="text-center">
              <h3 className="text-lg font-semibold text-coda-text mb-1">No Active Escalations</h3>
              <p className="text-sm text-coda-text-muted">
                Cadenza is monitoring{' '}
                <span className="font-bold text-coda-text tabular-nums">{totalMonitored}</span>
                {' '}lockup{totalMonitored !== 1 ? 's' : ''}
              </p>
            </div>
            <div className="flex items-center gap-2 mt-2 px-4 py-2 rounded-lg bg-coda-surface-alt">
              <InfinityIcon size={14} className="text-coda-brand" />
              <p className="text-xs text-coda-text-muted">
                Escalated transactions will appear here for human review
              </p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Escalation cards */}
      {!loading && (
        <div className="space-y-4">
          <AnimatePresence>
            {escalations.map((item, index) => (
              <motion.div
                key={item.lockup_id}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, x: -40 }}
                transition={{
                  duration: 0.35,
                  delay: index * 0.05,
                  ease: [0.25, 0.46, 0.45, 0.94],
                }}
              >
                <EscalationCard
                  item={item}
                  onApprove={handleApproveClick}
                  onReverse={handleReverseClick}
                  isResolving={isResolving}
                  resolvingDecision={resolvingDecision}
                />
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      )}

      {/* Confirmation Dialog */}
      <AlertDialog
        open={confirmDialog.open}
        onOpenChange={(open) => setConfirmDialog(prev => ({ ...prev, open }))}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {confirmDialog.decision === 'approve' ? 'Approve Settlement' : 'Reverse Transaction'}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {confirmDialog.decision === 'approve' ? (
                <>
                  This will finalize the <span className="font-bold">{confirmDialog.amount}</span> payment
                  and complete hard settlement on Solana. The lockup tokens will be released and the yield
                  distributed. This action cannot be undone.
                </>
              ) : (
                <>
                  This will reverse the <span className="font-bold">{confirmDialog.amount}</span> payment
                  and initiate a clawback on Solana. The sender's deposit will be returned and the lockup
                  closed. This action cannot be undone.
                </>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={executeResolution}
              className={
                confirmDialog.decision === 'approve'
                  ? '!bg-emerald-600 hover:!bg-emerald-700 text-white !border-emerald-700 [backdrop-filter:none]'
                  : '!bg-red-600 hover:!bg-red-700 text-white !border-red-700 [backdrop-filter:none]'
              }
            >
              {confirmDialog.decision === 'approve' ? (
                <span className="flex items-center gap-1.5">
                  <CheckCircle2 size={14} /> Confirm Approval
                </span>
              ) : (
                <span className="flex items-center gap-1.5">
                  <RotateCcw size={14} /> Confirm Reversal
                </span>
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </PageShell>
  );
}