import { useEffect, useState, useCallback, useRef } from 'react';
import { useParams, useNavigate, Link } from 'react-router';
import useSWR from 'swr';
import {
  ArrowLeft, ExternalLink, Copy, CheckCircle2,
  Clock, Shield, AlertTriangle, Zap, Hash, Link2,
  ChevronDown, ChevronRight, Gauge, Scale, Globe,
  Activity, Brain, Landmark, Radio, TrendingUp,
  ArrowRightLeft, FileText, Eye, Flag, Timer,
  ArrowDownUp, CircleDollarSign, Coins, Hourglass,
  UserCheck, RotateCcw, FastForward, Plus, Lock, Loader2,
} from 'lucide-react';
import { supabase, callServer } from '../supabaseClient';
import {
  fetchRiskScore, fetchComplianceLogs, fetchWallets, fetchLockupToken,
  fetchCadenzaFlags, fetchCorridorTransactions, fetchCorridorTransactionCount,
  fetchHeartbeatCycles, fetchTreasuryMandates,
} from '../dataClient';
import { SettlementLifecycle } from './SettlementLifecycle';
import type { Transaction, AgentMessage, Wallet as WalletType } from '../types';
import {
  formatTokenAmount, truncateAddress, explorerUrl,
  TX_STATUS_CONFIG, RISK_LEVEL_CONFIG, MESSAGE_TYPE_CONFIG,
} from '../types';

// ============================================================
// SWR fetcher — returns all detail data in one composite shape
// ============================================================

// ── Lockup & Cadenza types ──────────────────────────────────

interface LockupToken {
  id: string;
  transaction_id: string;
  sender_bank_id: string;
  receiver_bank_id: string;
  yb_token_mint: string;
  yb_token_symbol: string;
  yb_token_amount: string;
  yb_holder: string;
  tb_token_mint: string;
  tb_token_symbol: string;
  tb_token_amount: string;
  tb_holder: string;
  yield_rate_bps: number;
  yield_accrued: string;
  yield_last_calculated: string;
  lockup_start: string;
  lockup_end: string | null;
  status: string;
  resolution?: string | null;
  resolved_by?: string | null;
  resolved_at?: string | null;
  created_at: string;
}

interface CadenzaFlag {
  id: string;
  transaction_id: string;
  lockup_token_id: string;
  flag_type: string;
  severity: string;
  reasoning: string;
  detected_at: string;
  action_taken?: string | null;
  action_at?: string | null;
}

// ── Primary data: above-the-fold critical data (fast) ──
interface TxPrimaryData {
  tx: Transaction;
  messages: AgentMessage[];
  riskScore: any;
  complianceLogs: any[];
}

async function fetchTxPrimary(key: string): Promise<TxPrimaryData> {
  const txId = key.replace('tx-primary/', '');

  const [txRes, msgRes, riskData, compData] = await Promise.all([
    supabase
      .from('transactions')
      .select('*, sender_bank:banks!transactions_sender_bank_id_fkey(id, name, short_code, jurisdiction, tier, swift_bic, status, token_mint_address, token_symbol, agent_system_prompt), receiver_bank:banks!transactions_receiver_bank_id_fkey(id, name, short_code, jurisdiction, tier, swift_bic, status, token_mint_address, token_symbol, agent_system_prompt)')
      .eq('id', txId)
      .single(),
    supabase
      .from('agent_messages')
      .select('*, from_bank:banks!agent_messages_from_bank_id_fkey(short_code, name), to_bank:banks!agent_messages_to_bank_id_fkey(short_code, name)')
      .eq('transaction_id', txId)
      .order('created_at', { ascending: true }),
    fetchRiskScore(txId),
    fetchComplianceLogs(txId),
  ]);

  if (txRes.error) throw txRes.error;
  return {
    tx: txRes.data as Transaction,
    messages: (msgRes.data || []) as AgentMessage[],
    riskScore: riskData || null,
    complianceLogs: compData || [],
  };
}

// ── Secondary data: below-the-fold detail data (deferred) ──
interface TxSecondaryData {
  senderWallet: WalletType | null;
  receiverWallet: WalletType | null;
  corridorHistory: any[];
  cycle: any;
  cycleTxCount: number;
  mandates: any[];
  lockup: LockupToken | null;
  cadenzaFlags: CadenzaFlag[];
}

async function fetchTxSecondary(key: string): Promise<TxSecondaryData> {
  // Key format: "tx-secondary/{txId}/{senderBankId}/{receiverBankId}/{createdAt}"
  const parts = key.replace('tx-secondary/', '').split('/');
  const txId = parts[0];
  const senderBankId = parts[1];
  const receiverBankId = parts[2];
  const createdAt = parts[3] || null;

  const [senderWallets, receiverWallets, corridorTxs, lockupData, flagsData] = await Promise.all([
    fetchWallets(senderBankId),
    fetchWallets(receiverBankId),
    fetchCorridorTransactions(senderBankId, receiverBankId, txId, 10),
    fetchLockupToken(txId),
    fetchCadenzaFlags({ transaction_id: txId }),
  ]);

  let cycle: any = null;
  let cycleTxCount = 0;
  let mandates: any[] = [];

  if (createdAt) {
    const txTime = new Date(createdAt).getTime();
    const [cyclesData, mandatesData] = await Promise.all([
      fetchHeartbeatCycles(5),
      fetchTreasuryMandates(receiverBankId),
    ]);

    mandates = mandatesData || [];

    // Filter cycles to those that started before or near the transaction time
    const relevantCycles = (cyclesData || []).filter(
      (c: any) => new Date(c.started_at).getTime() <= txTime + 5000
    );

    if (relevantCycles.length > 0) {
      const matchingCycle = relevantCycles.find((c: any) => {
        const start = new Date(c.started_at).getTime();
        const end = c.completed_at ? new Date(c.completed_at).getTime() : Date.now();
        return txTime >= start - 2000 && txTime <= end + 5000;
      });
      if (matchingCycle) {
        cycle = matchingCycle;
        const windowStart = new Date(new Date(matchingCycle.started_at).getTime() - 2000).toISOString();
        const windowEnd = matchingCycle.completed_at
          ? new Date(new Date(matchingCycle.completed_at).getTime() + 5000).toISOString()
          : new Date(Date.now() + 10000).toISOString();
        cycleTxCount = await fetchCorridorTransactionCount(windowStart, windowEnd);
      }
    }
  }

  return {
    senderWallet: senderWallets.find((w: any) => w.is_default) || senderWallets[0] || null,
    receiverWallet: receiverWallets.find((w: any) => w.is_default) || receiverWallets[0] || null,
    corridorHistory: corridorTxs || [],
    cycle,
    cycleTxCount,
    mandates,
    lockup: lockupData || null,
    cadenzaFlags: flagsData || [],
  };
}



// ============================================================
// Agent persona mapping
// ============================================================

const AGENT_PERSONAS: Record<string, { name: string; role: string; color: string; bgColor: string; borderColor: string; icon: typeof Shield }> = {
  concord:  { name: 'Concord',  role: 'Compliance Agent',  color: 'text-coda-text-secondary',  bgColor: 'bg-coda-surface-hover/40',   borderColor: 'border-coda-border/30',  icon: Shield },
  fermata:  { name: 'Fermata',  role: 'Risk Agent',        color: 'text-coda-text-secondary',  bgColor: 'bg-coda-surface-hover/40',   borderColor: 'border-coda-border/30',  icon: Gauge },
  maestro:  { name: 'Maestro',  role: 'Orchestrator',      color: 'text-coda-text-secondary',  bgColor: 'bg-coda-surface-hover/40',   borderColor: 'border-coda-border/30',  icon: Brain },
  canto:    { name: 'Canto',    role: 'Settlement Agent',  color: 'text-coda-text-secondary',  bgColor: 'bg-coda-surface-hover/40',   borderColor: 'border-coda-border/30',  icon: Link2 },
};

function resolveAgent(msg: AgentMessage): typeof AGENT_PERSONAS[string] {
  const nl = (msg.natural_language || '').toLowerCase();
  const content = msg.content as Record<string, any>;
  const action = content?.action as string | undefined;

  if (msg.message_type === 'compliance_response' || msg.message_type === 'compliance_query' || nl.startsWith('concord')) return AGENT_PERSONAS.concord;
  if (msg.message_type === 'risk_alert' || nl.startsWith('fermata')) return AGENT_PERSONAS.fermata;
  if (action === 'settlement_started' || msg.message_type === 'settlement_confirm' || nl.startsWith('canto')) return AGENT_PERSONAS.canto;
  if (action === 'agent_decision' || msg.message_type === 'payment_accept' || msg.message_type === 'payment_reject' || nl.startsWith('maestro')) return AGENT_PERSONAS.maestro;
  if (msg.message_type === 'payment_request') return AGENT_PERSONAS.maestro;
  return AGENT_PERSONAS.maestro;
}

// Pipeline step config
const PIPELINE_STEPS = [
  { key: 'dispatch', agent: 'maestro', label: 'Dispatch', msgTypes: ['payment_request'] },
  { key: 'compliance', agent: 'concord', label: 'Compliance', msgTypes: ['compliance_query', 'compliance_response'] },
  { key: 'risk', agent: 'fermata', label: 'Risk Scoring', msgTypes: ['risk_alert'] },
  { key: 'decision', agent: 'maestro', label: 'Decision', msgTypes: ['payment_accept', 'payment_reject'], actions: ['agent_decision'] },
  { key: 'settlement', agent: 'canto', label: 'Settlement', msgTypes: ['settlement_confirm'], actions: ['settlement_started'] },
] as const;

// ============================================================
// Helpers
// ============================================================

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '\u2014';
  const d = new Date(iso);
  return d.toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function elapsed(from: string | null, to: string | null): string {
  if (!from) return '\u2014';
  const start = new Date(from).getTime();
  const end = to ? new Date(to).getTime() : Date.now();
  const ms = end - start;
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60_000)}m ${Math.floor((ms % 60_000) / 1000)}s`;
}

// ── Live Duration / Countdown component ──
// For locked txs with lockup_until: counts DOWN to lockup expiry
// For in-progress txs: counts UP (live elapsed) with ticking animation
// For terminal txs: static elapsed
function LiveDuration({ from, to, lockupUntil, isTerminal }: {
  from: string | null;
  to: string | null;
  lockupUntil: string | null | undefined;
  isTerminal: boolean;
}) {
  const [now, setNow] = useState(Date.now());
  const hasActiveLockup = !!lockupUntil && new Date(lockupUntil).getTime() > Date.now();
  const isLive = !isTerminal || hasActiveLockup;

  useEffect(() => {
    if (!isLive) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [isLive]);

  if (!from) return <span>{'\u2014'}</span>;

  // If there's a lockup_until → countdown mode
  if (lockupUntil) {
    const lockupEnd = new Date(lockupUntil).getTime();
    const remaining = lockupEnd - now;

    if (remaining <= 0) {
      return (
        <div className="flex items-center gap-1.5 animate-[fadeSlideIn_0.4s_ease-out]">
          <span className="text-emerald-400 font-semibold">Expired</span>
          <Loader2 className="w-3 h-3 text-emerald-400/70 animate-spin" />
          <span className="text-[10px] text-emerald-400/60">settling...</span>
        </div>
      );
    }

    const totalSecs = Math.floor(remaining / 1000);
    const hrs = Math.floor(totalSecs / 3600);
    const mins = Math.floor((totalSecs % 3600) / 60);
    const secs = totalSecs % 60;

    const start = new Date(from).getTime();
    const totalDuration = lockupEnd - start;
    const progressFrac = totalDuration > 0 ? Math.min(1, Math.max(0, 1 - remaining / totalDuration)) : 0;

    const urgencyColor = remaining < 60_000 ? 'text-red-400' : remaining < 300_000 ? 'text-amber-400' : 'text-coda-text-secondary';

    return (
      <div className="space-y-1.5">
        <div className={`tabular-nums ${urgencyColor} flex items-baseline gap-1`}>
          <span>{hrs > 0 ? `${hrs}h ${String(mins).padStart(2, '0')}m` : `${mins}m`}</span>
          <span className="text-[13px] opacity-70 animate-pulse">
            {String(secs).padStart(2, '0')}s
          </span>
        </div>
        <div className="w-full h-[3px] rounded-full bg-coda-border/20 overflow-hidden">
          <div
            className="h-full rounded-full transition-all duration-1000 ease-linear"
            style={{
              width: `${progressFrac * 100}%`,
              background: remaining < 60_000
                ? 'linear-gradient(90deg, #f87171, #ef4444)'
                : remaining < 300_000
                  ? 'linear-gradient(90deg, #fbbf24, #f59e0b)'
                  : 'linear-gradient(90deg, #818cf8, #6366f1)',
            }}
          />
        </div>
      </div>
    );
  }

  // No lockup — elapsed time (live tick if not terminal)
  const start = new Date(from).getTime();
  const end = to ? new Date(to).getTime() : now;
  const ms = end - start;

  if (ms < 1000) return <span className="tabular-nums">{ms}ms</span>;
  if (ms < 60_000) {
    const s = Math.floor(ms / 1000);
    const tenths = Math.floor((ms % 1000) / 100);
    return (
      <span className="tabular-nums">
        {s}<span className="text-[13px] opacity-70">.{tenths}s</span>
        {!isTerminal && <span className="inline-block w-[3px] h-[14px] ml-1 bg-coda-text-secondary/50 rounded-full animate-pulse align-middle" />}
      </span>
    );
  }
  const totalSecs = Math.floor(ms / 1000);
  const mins = Math.floor(totalSecs / 60);
  const secs = totalSecs % 60;
  return (
    <span className="tabular-nums">
      {mins}m <span className="text-[13px] opacity-70">{String(secs).padStart(2, '0')}s</span>
      {!isTerminal && <span className="inline-block w-[3px] h-[14px] ml-1 bg-coda-text-secondary/50 rounded-full animate-pulse align-middle" />}
    </span>
  );
}

// ============================================================
// Sub-components
// ============================================================

function ScoreBar({ label, score, icon: Icon }: { label: string; score: number; icon: typeof Shield }) {
  const color = score >= 70 ? 'bg-emerald-500' : score >= 40 ? 'bg-amber-500' : 'bg-red-500';
  const textColor = score >= 70 ? 'text-emerald-400' : score >= 40 ? 'text-amber-400' : 'text-red-400';
  return (
    <div className="flex items-center gap-3">
      <Icon className="w-4 h-4 text-coda-text-muted shrink-0" />
      <span className="text-[13px] text-coda-text-muted w-28 shrink-0">{label}</span>
      <div className="flex-1 h-2.5 rounded-full bg-coda-surface-hover/30 overflow-hidden">
        <div className={`h-full rounded-full ${color} transition-all duration-500`} style={{ width: `${Math.max(2, score)}%` }} />
      </div>
      <span className={`text-[13px] font-mono font-medium ${textColor} w-10 text-right`}>{score}</span>
    </div>
  );
}

// Pipeline flow node
function PipelineNode({ step, verdict, isActive, isCompleted }: {
  step: typeof PIPELINE_STEPS[number];
  verdict: { status: 'passed' | 'failed' | 'pending' | 'active'; detail?: string } | null;
  isActive: boolean;
  isCompleted: boolean;
}) {
  const persona = AGENT_PERSONAS[step.agent];
  const Icon = persona.icon;
  const status = verdict?.status || 'pending';

  return (
    <div className="flex flex-col items-center gap-2 flex-1 min-w-0">
      <div className={`w-12 h-12 rounded-xl flex items-center justify-center border transition-all duration-300 ${
        status === 'passed' ? 'bg-emerald-500/15 border-emerald-500/30' :
        status === 'failed' ? 'bg-red-500/15 border-red-500/30' :
        isActive ? `${persona.bgColor} ${persona.borderColor} animate-pulse` :
        'bg-coda-surface-hover/20 border-coda-border/20'
      }`}>
        {status === 'passed' ? <CheckCircle2 className="w-5 h-5 text-emerald-500" /> :
         status === 'failed' ? <AlertTriangle className="w-5 h-5 text-red-500" /> :
         <Icon className={`w-5 h-5 ${isActive ? persona.color : 'text-coda-text-muted'}`} />}
      </div>
      <span className={`text-[12px] font-mono font-medium ${
        isCompleted ? persona.color : 'text-coda-text-muted'
      }`}>{persona.name}</span>
      <span className="text-[11px] text-coda-text-muted">{step.label}</span>
      {verdict?.detail && (
        <span className={`text-[11px] font-mono px-2 py-0.5 rounded ${
          status === 'passed' ? 'bg-emerald-500/10 text-emerald-400' :
          status === 'failed' ? 'bg-red-500/10 text-red-400' :
          'bg-coda-surface-hover/20 text-coda-text-muted'
        }`}>
          {verdict.detail}
        </span>
      )}
    </div>
  );
}

// Bank profile card
function BankProfileCard({ bank, wallet, role }: { bank: any; wallet: WalletType | null; role: 'Sender' | 'Receiver' }) {
  const tokenBalance = wallet ? (wallet.balance_tokens / 1e6) : null;
  const solBalance = wallet ? (wallet.balance_lamports / 1e9) : null;

  return (
    <div className="liquid-glass-card squircle p-5">
      <div className="flex items-center gap-3 mb-4">
        <div className={`w-10 h-10 rounded-lg flex items-center justify-center text-[13px] font-bold font-mono ${
          role === 'Sender' ? 'bg-blue-500/10 text-blue-500' : 'bg-coda-brand/10 text-coda-brand'
        }`}>
          {(bank?.short_code || '??').slice(0, 2)}
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-[15px] font-medium text-coda-text">{bank?.name || 'Unknown'}</div>
          <div className="text-[12px] text-coda-text-muted font-mono">{bank?.short_code || '???'} &middot; {role}</div>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        {[
          { label: 'Jurisdiction', value: bank?.jurisdiction || '\u2014' },
          { label: 'SWIFT/BIC', value: bank?.swift_bic || '\u2014' },
          { label: 'Token Balance', value: tokenBalance != null ? `$${tokenBalance.toLocaleString()}` : '\u2014' },
          { label: 'SOL Balance', value: solBalance != null ? `${solBalance.toFixed(4)} SOL` : '\u2014' },
        ].map(item => (
          <div key={item.label}>
            <div className="text-[11px] text-coda-text-muted mb-1">{item.label}</div>
            <div className="text-[14px] font-mono text-coda-text-secondary">{item.value}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ============================================================
// Main Component
// ============================================================

export function TransactionDetail() {
  const { txId } = useParams<{ txId: string }>();
  const navigate = useNavigate();

  // ── SWR: two-phase fetch for fast initial render ──
  // Phase 1 (primary): tx + messages + risk + compliance — renders header, pipeline, risk
  const primaryKey = txId ? `tx-primary/${txId}` : null;
  const { data: primaryData, error, isLoading, mutate: mutatePrimary } = useSWR<TxPrimaryData>(
    primaryKey,
    fetchTxPrimary,
    {
      revalidateOnFocus: false,
      dedupingInterval: 3000,
      keepPreviousData: true,
    },
  );

  const tx = primaryData?.tx ?? null;
  const messages = primaryData?.messages ?? [];
  const riskScore = primaryData?.riskScore ?? null;
  const complianceLogs = primaryData?.complianceLogs ?? [];

  // Phase 2 (secondary): wallets, corridor, lockup, flags, cycle, mandates
  // Only fetches once we have the primary tx data (bank IDs needed for queries)
  const secondaryKey = tx
    ? `tx-secondary/${tx.id}/${tx.sender_bank_id}/${tx.receiver_bank_id}/${tx.created_at || ''}`
    : null;
  const { data: secondaryData, mutate: mutateSecondary } = useSWR<TxSecondaryData>(
    secondaryKey,
    fetchTxSecondary,
    {
      revalidateOnFocus: false,
      dedupingInterval: 5000,
      keepPreviousData: true,
    },
  );

  // Combined mutate that revalidates both phases
  const mutate = useCallback(
    (updateFn?: any, opts?: any) => {
      mutatePrimary(updateFn, opts);
      mutateSecondary();
    },
    [mutatePrimary, mutateSecondary],
  );

  const senderWallet = secondaryData?.senderWallet ?? null;
  const receiverWallet = secondaryData?.receiverWallet ?? null;
  const corridorHistory = secondaryData?.corridorHistory ?? [];
  const cycle = secondaryData?.cycle ?? null;
  const cycleTxCount = secondaryData?.cycleTxCount ?? 0;
  const mandates = secondaryData?.mandates ?? [];
  const lockup = secondaryData?.lockup ?? null;
  const cadenzaFlags = secondaryData?.cadenzaFlags ?? [];

  // UI-only local state
  const [copied, setCopied] = useState<string | null>(null);
  const [expandedMsg, setExpandedMsg] = useState<string | null>(null);
  const [showMandates, setShowMandates] = useState(false);
  const [detailTab, setDetailTab] = useState<'overview' | 'settlement' | 'intelligence' | 'counterparties'>('overview');

  // ── Cadenza escalation state ──
  const [resolveLoading, setResolveLoading] = useState<string | null>(null);
  const [resolveError, setResolveError] = useState<string | null>(null);
  const [briefing, setBriefing] = useState<any>(null);
  const [briefingLoading, setBriefingLoading] = useState(false);

  // ── Lockup management state ──
  const [lockupActionLoading, setLockupActionLoading] = useState<string | null>(null);
  const [lockupActionError, setLockupActionError] = useState<string | null>(null);
  const [lockupActionSuccess, setLockupActionSuccess] = useState<string | null>(null);
  const [showExtendModal, setShowExtendModal] = useState(false);
  const [extendMinutes, setExtendMinutes] = useState(30);
  const [showReverseConfirm, setShowReverseConfirm] = useState(false);
  const [reverseReason, setReverseReason] = useState('');

  // ── Status transition animation state ──
  // Detects when tx status changes (e.g. locked → settled) and triggers animations
  const prevStatusRef = useRef<string | null>(null);
  const [justTransitioned, setJustTransitioned] = useState<'settled' | 'reversed' | null>(null);

  useEffect(() => {
    if (!tx) return;
    const prev = prevStatusRef.current;
    prevStatusRef.current = tx.status;
    if (prev && prev !== tx.status) {
      if (tx.status === 'settled' && (prev === 'locked' || prev === 'risk_scored' || prev === 'accepted')) {
        setJustTransitioned('settled');
        setTimeout(() => setJustTransitioned(null), 6000);
      } else if (tx.status === 'reversed' && prev === 'locked') {
        setJustTransitioned('reversed');
        setTimeout(() => setJustTransitioned(null), 6000);
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tx?.status]);

  const handleLockupAction = useCallback(async (action: string, extra?: Record<string, unknown>) => {
    if (!tx) return;
    setLockupActionLoading(action);
    setLockupActionError(null);
    setLockupActionSuccess(null);
    try {
      const result = await callServer<{ status?: string; error?: string }>('/lockup-action', {
        action,
        transaction_id: tx.id,
        operator_name: 'Network Operator',
        ...extra,
      });
      if (result.error) {
        setLockupActionError(result.error);
      } else {
        const labels: Record<string, string> = {
          settle_now: 'Transaction settled successfully',
          extend: `Lockup extended by ${(extra as any)?.extend_minutes || '?'} minutes`,
          reverse: 'Transaction reversed — funds returned to sender',
        };
        setLockupActionSuccess(labels[action] || 'Action completed');
        setShowExtendModal(false);
        setShowReverseConfirm(false);
        setTimeout(() => mutate(), 1500);
      }
    } catch (err) {
      setLockupActionError(`Action failed: ${(err as Error).message}`);
    } finally {
      setLockupActionLoading(null);
    }
  }, [tx, mutate]);

  // ── Live yield counter ──
  const [liveYield, setLiveYield] = useState<string | null>(null);
  const yieldTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── Realtime subscription: optimistic message append + full revalidate on tx update ──
  useEffect(() => {
    if (!txId) return;
    const ch = supabase
      .channel(`tx-detail-${txId}`)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'transactions', filter: `id=eq.${txId}` }, () => {
        mutatePrimary();
        mutateSecondary();
      })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'agent_messages' }, (p) => {
        const msg = p.new as AgentMessage;
        if (msg.transaction_id === txId) {
          // Optimistic append — add the new message to cached data immediately,
          // then revalidate in background so counts/verdicts stay correct
          mutatePrimary(
            (prev: TxPrimaryData | undefined) => prev ? { ...prev, messages: [...prev.messages, msg] } : prev,
            { revalidate: true },
          );
        }
      })
      // Also subscribe to lockup_tokens and cadenza_flags changes
      .on('postgres_changes', { event: '*', schema: 'public', table: 'lockup_tokens' }, (p) => {
        const row = p.new as any;
        if (row?.transaction_id === txId) {
          mutateSecondary();
        }
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'cadenza_flags' }, (p) => {
        const row = p.new as any;
        if (row?.transaction_id === txId) {
          mutateSecondary();
        }
      })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [txId, mutatePrimary, mutateSecondary]);

  // ── Live yield accrual timer ──
  useEffect(() => {
    if (yieldTimerRef.current) {
      clearInterval(yieldTimerRef.current);
      yieldTimerRef.current = null;
    }
    if (!lockup || !['active', 'escalated'].includes(lockup.status)) {
      setLiveYield(null);
      return;
    }

    const computeYield = () => {
      const baseYield = BigInt(lockup.yield_accrued || '0');
      const amount = BigInt(lockup.yb_token_amount || '0');
      const bps = lockup.yield_rate_bps || 525;
      const lastCalc = lockup.yield_last_calculated || lockup.lockup_start;
      const elapsedMs = Date.now() - new Date(lastCalc).getTime();
      if (elapsedMs <= 0) {
        setLiveYield((Number(baseYield) / 1e6).toFixed(6));
        return;
      }
      const elapsedSecs = Math.floor(elapsedMs / 1000);
      // yield = principal * rate * time / (365.25 * 86400 * 10000)
      const numerator = amount * BigInt(bps) * BigInt(elapsedSecs);
      const denominator = BigInt(Math.floor(365.25 * 86400 * 10000));
      const delta = numerator / denominator;
      const total = baseYield + delta;
      setLiveYield((Number(total) / 1e6).toFixed(6));
    };

    computeYield();
    yieldTimerRef.current = setInterval(computeYield, 1000);
    return () => {
      if (yieldTimerRef.current) clearInterval(yieldTimerRef.current);
    };
  }, [lockup]);

  // ── Auto-settle expired lockups ──
  // When the lockup timer has passed and the tx is still "locked",
  // auto-trigger settlement. Handles orchestrator-inline lockups that
  // have no lockup_tokens row and thus are invisible to the Cadenza scan.
  const autoSettleTriggered = useRef(false);
  useEffect(() => {
    if (!tx || tx.status !== 'locked' || autoSettleTriggered.current) return;
    // Concurrency guard: skip auto-settle if a manual lockup action is in progress
    if (lockupActionLoading) {
      console.log(`[TransactionDetail] Skipping auto-settle — manual action "${lockupActionLoading}" in progress for tx ${tx.id.slice(0, 8)}`);
      return;
    }
    const lockupUntil = (tx as any).lockup_until;
    if (!lockupUntil) return;
    const expiryMs = new Date(lockupUntil).getTime();
    const nowMs = Date.now();
    if (nowMs < expiryMs) {
      // Not expired yet — set a timer to auto-settle when it does
      const delay = expiryMs - nowMs + 2000; // 2s grace
      const timer = setTimeout(() => {
        if (!autoSettleTriggered.current && !lockupActionLoading) {
          autoSettleTriggered.current = true;
          console.log(`[TransactionDetail] Lockup expired, auto-triggering settlement for tx ${tx.id.slice(0, 8)}`);
          callServer('/lockup-action', {
            action: 'settle_now',
            transaction_id: tx.id,
            operator_name: 'Auto-settle (timer expired)',
          }).then(() => {
            // Immediate refresh + delayed follow-up to catch secondary data (lockup_tokens)
            mutate();
            setTimeout(() => mutate(), 2500);
          }).catch((err: unknown) => {
            console.error('[TransactionDetail] Auto-settle failed:', err);
            autoSettleTriggered.current = false; // allow retry
          });
        }
      }, delay); // use full delay — no cap, so 10-minute lockups wait the full 10 minutes
      return () => clearTimeout(timer);
    } else {
      // Already expired — trigger immediately
      autoSettleTriggered.current = true;
      console.log(`[TransactionDetail] Lockup already expired, auto-triggering settlement for tx ${tx.id.slice(0, 8)}`);
      callServer('/lockup-action', {
        action: 'settle_now',
        transaction_id: tx.id,
        operator_name: 'Auto-settle (timer expired)',
      }).then(() => {
        mutate();
        setTimeout(() => mutate(), 2500);
      }).catch((err: unknown) => {
        console.error('[TransactionDetail] Auto-settle failed:', err);
        autoSettleTriggered.current = false;
      });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tx?.id, tx?.status, lockupActionLoading, mutate]);

  // ── Cadenza resolution handler ──
  const handleResolve = useCallback(async (decision: 'approve' | 'reverse') => {
    if (!lockup) return;
    setResolveLoading(decision);
    setResolveError(null);
    try {
      await callServer('/cadenza-escalate', {
        action: 'resolve_escalation',
        lockup_id: lockup.id,
        decision,
        operator_name: 'Network Operator',
      });
      mutate();
    } catch (err) {
      console.error('[TransactionDetail] resolve_escalation error:', err);
      setResolveError(`Failed to ${decision}: ${(err as Error).message}`);
    } finally {
      setResolveLoading(null);
    }
  }, [lockup, mutate]);

  // ── Fetch Cadenza briefing ──
  const fetchBriefing = useCallback(async () => {
    if (!lockup) return;
    setBriefingLoading(true);
    try {
      const result = await callServer<any>('/cadenza-escalate', {
        action: 'get_briefing',
        lockup_id: lockup.id,
      });
      setBriefing(result.briefing || result);
    } catch (err) {
      console.error('[TransactionDetail] get_briefing error:', err);
    } finally {
      setBriefingLoading(false);
    }
  }, [lockup]);

  const copyText = (text: string, label: string) => {
    navigator.clipboard?.writeText(text).then(() => {
      setCopied(label);
      setTimeout(() => setCopied(null), 1500);
    });
  };

  if (isLoading && !primaryData) {
    return (
      <div className="w-full px-6 pb-10 animate-pulse">
        {/* Back button skeleton */}
        <div className="h-5 w-16 rounded bg-coda-surface-hover/30 mb-5" />
        {/* Header card skeleton */}
        <div className="liquid-glass-card squircle p-7 mb-4">
          <div className="flex items-start justify-between mb-5">
            <div>
              <div className="h-4 w-40 rounded bg-coda-surface-hover/30 mb-3" />
              <div className="h-10 w-48 rounded bg-coda-surface-hover/30" />
            </div>
            <div className="h-9 w-24 rounded-lg bg-coda-surface-hover/30" />
          </div>
          <div className="flex items-center gap-4 mb-5">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-coda-surface-hover/30" />
              <div>
                <div className="h-4 w-28 rounded bg-coda-surface-hover/30 mb-1.5" />
                <div className="h-3 w-20 rounded bg-coda-surface-hover/20" />
              </div>
            </div>
            <div className="flex-1 flex items-center justify-center">
              <div className="h-px flex-1 bg-coda-border/10" />
              <div className="w-6 h-4 mx-2 rounded bg-coda-surface-hover/20" />
              <div className="h-px flex-1 bg-coda-border/10" />
            </div>
            <div className="flex items-center gap-3">
              <div>
                <div className="h-4 w-28 rounded bg-coda-surface-hover/30 mb-1.5" />
                <div className="h-3 w-20 rounded bg-coda-surface-hover/20" />
              </div>
              <div className="w-10 h-10 rounded-lg bg-coda-surface-hover/30" />
            </div>
          </div>
          <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="bg-coda-surface-hover/10 rounded-lg p-3.5">
                <div className="h-3 w-16 rounded bg-coda-surface-hover/20 mb-2" />
                <div className="h-5 w-24 rounded bg-coda-surface-hover/30" />
              </div>
            ))}
          </div>
        </div>
        {/* Pipeline skeleton */}
        <div className="liquid-glass-card squircle p-6 mb-4">
          <div className="h-4 w-40 rounded bg-coda-surface-hover/30 mb-5" />
          <div className="flex items-center justify-between">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="flex flex-col items-center gap-2 flex-1">
                <div className="w-12 h-12 rounded-xl bg-coda-surface-hover/20" />
                <div className="h-3 w-14 rounded bg-coda-surface-hover/20" />
                <div className="h-3 w-20 rounded bg-coda-surface-hover/15" />
              </div>
            ))}
          </div>
        </div>
        {/* Risk + Compliance skeleton */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 mb-5">
          {[0, 1].map(i => (
            <div key={i} className="liquid-glass-card squircle p-6">
              <div className="h-4 w-36 rounded bg-coda-surface-hover/30 mb-5" />
              <div className="space-y-3">
                {Array.from({ length: 4 }).map((_, j) => (
                  <div key={j} className="flex items-center gap-3">
                    <div className="w-6 h-6 rounded-md bg-coda-surface-hover/20" />
                    <div className="flex-1">
                      <div className="h-4 w-full rounded bg-coda-surface-hover/20 mb-1" />
                      <div className="h-3 w-3/4 rounded bg-coda-surface-hover/15" />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (!tx) {
    return (
      <div className="p-8 text-center">
        <p className="text-base text-coda-text-muted font-mono">
          {error ? 'Failed to load transaction' : 'Transaction not found'}
        </p>
        {error && <p className="text-sm text-red-400/70 font-mono mt-2">{String(error.message || error)}</p>}
        <button onClick={() => navigate(-1)} className="mt-4 text-sm text-blue-500"><span>Go back</span></button>
      </div>
    );
  }

  // ── Computed ────────────────────────────────────────────────

  const statusCfg = TX_STATUS_CONFIG[tx.status] || { label: tx.status, color: 'text-coda-text-muted', bg: 'bg-coda-surface-hover/20' };
  const senderBank = (tx as any).sender_bank;
  const receiverBank = (tx as any).receiver_bank;
  const senderCode = senderBank?.short_code || '???';
  const receiverCode = receiverBank?.short_code || '???';
  const isTerminal = ['settled', 'rejected', 'reversed', 'locked'].includes(tx.status);
  const hasLockup = tx.lockup_status != null && lockup != null;
  const isEscalated = lockup?.status === 'escalated';

  // Derive effective lockup status — handles race condition where tx.status updates
  // to 'settled'/'reversed' before the secondary SWR refetch gets the updated lockup_tokens row.
  const effectiveLockupStatus: string | null = lockup
    ? (lockup.status === 'active' || lockup.status === 'escalated')
      ? (tx.status === 'settled' ? 'settled' : tx.status === 'reversed' ? 'reversed' : lockup.status)
      : lockup.status
    : null;
  const isLockupSettled = effectiveLockupStatus === 'settled';
  const isLockupReversed = effectiveLockupStatus === 'reversed';
  const isLockupFinalized = isLockupSettled || isLockupReversed;

  const compChecks = complianceLogs.length > 0
    ? complianceLogs.map((log: any) => ({ type: log.check_type, passed: log.check_result, detail: log.details?.detail || '\u2014' }))
    : ((tx as any).compliance_checks || []);

  const pipelineVerdicts = computePipelineVerdicts(messages, tx);

  const corridorStats = {
    totalVolume: corridorHistory.reduce((sum: number, t: any) => sum + (t.amount_display || 0), 0),
    settledCount: corridorHistory.filter((t: any) => t.status === 'settled').length,
  };

  // ── Render ─────────────────────────────────────────────────

  return (
    <div className="w-full px-6 pb-10">
      {/* Back button */}
      <button
        onClick={() => navigate(-1)}
        className="flex items-center gap-1.5 text-sm text-coda-text-muted mb-4 hover:text-coda-text transition-colors cursor-pointer"
      >
        <ArrowLeft className="w-4 h-4" />
        <span>Back</span>
      </button>

      {/* ═══ Settlement Transition Banner ═══ */}
      {justTransitioned && (
        <div className={`mb-4 px-5 py-3.5 rounded-xl border backdrop-blur-md flex items-center gap-3 animate-[slideDown_0.4s_ease-out] ${
          justTransitioned === 'settled'
            ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400'
            : 'bg-red-500/10 border-red-500/30 text-red-400'
        }`}>
          {justTransitioned === 'settled' ? (
            <>
              <div className="w-8 h-8 rounded-full bg-emerald-500/20 flex items-center justify-center shrink-0">
                <CheckCircle2 className="w-5 h-5 text-emerald-400" />
              </div>
              <div>
                <div className="text-sm font-semibold font-mono">Hard Finality Achieved</div>
                <div className="text-xs text-emerald-400/70 font-mono mt-0.5">
                  Lockup period complete. Receiver deposit tokens minted. Transaction is now irreversible.
                </div>
              </div>
            </>
          ) : (
            <>
              <div className="w-8 h-8 rounded-full bg-red-500/20 flex items-center justify-center shrink-0">
                <RotateCcw className="w-5 h-5 text-red-400" />
              </div>
              <div>
                <div className="text-sm font-semibold font-mono">Transaction Reversed</div>
                <div className="text-xs text-red-400/70 font-mono mt-0.5">
                  Lockup reversed. Sender deposit tokens re-minted. Escrow tokens burned.
                </div>
              </div>
            </>
          )}
        </div>
      )}

      {/* ═══ Section 1: Header Card — Fill / Outline two-zone ═══ */}
      <div className={`squircle overflow-hidden mb-4 transition-all duration-700 ${
        justTransitioned === 'settled' ? 'ring-1 ring-emerald-500/20' :
        justTransitioned === 'reversed' ? 'ring-1 ring-red-500/20' : ''
      }`}>
        {/* ── Title zone (LiquidGlass fill) ── */}
        <div className="liquid-glass-card p-7 pb-5">
          <div className="flex items-start justify-between mb-5">
            <div>
              <div className="flex items-center gap-2.5 mb-2">
                <span className="text-xs text-coda-text-muted">Transaction</span>
                <button onClick={() => copyText(tx.id, 'id')} className="flex items-center gap-1 text-xs font-mono text-coda-text-muted hover:text-coda-text transition-colors cursor-pointer">
                  <Hash className="w-3.5 h-3.5" /><span>{tx.id.slice(0, 12)}...</span>
                  {copied === 'id' ? <CheckCircle2 className="w-3.5 h-3.5 text-coda-brand" /> : <Copy className="w-3 h-3" />}
                </button>
              </div>
              <div className="text-4xl font-bold font-mono text-coda-text tracking-tight">
                {tx.amount_display != null ? `$${tx.amount_display.toLocaleString()}` : formatTokenAmount(tx.amount)}
              </div>
            </div>
            <div className={`px-4 py-2 rounded-lg text-sm font-semibold font-mono transition-all duration-700 ${statusCfg.color} ${statusCfg.bg} ${
              justTransitioned === 'settled' ? 'ring-2 ring-emerald-400/60 shadow-[0_0_20px_rgba(52,211,153,0.3)] scale-105' :
              justTransitioned === 'reversed' ? 'ring-2 ring-red-400/60 shadow-[0_0_20px_rgba(248,113,113,0.3)] scale-105' : ''
            }`}>
              {statusCfg.label.toUpperCase()}
            </div>
          </div>

          {/* Route */}
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-blue-500/10 flex items-center justify-center text-sm font-bold font-mono text-blue-500">{senderCode.slice(0, 2)}</div>
              <div>
                <div className="text-[15px] font-medium text-coda-text">{senderBank?.name || senderCode}</div>
                <div className="text-xs text-coda-text-muted font-mono">{senderCode}{senderBank?.jurisdiction ? ` \u00B7 ${senderBank.jurisdiction}` : ''}</div>
              </div>
            </div>
            <div className="flex-1 flex items-center justify-center">
              <div className="h-px flex-1 bg-coda-border/20" />
              <span className="px-3 text-xs text-coda-text-muted font-mono">&rarr;</span>
              <div className="h-px flex-1 bg-coda-border/20" />
            </div>
            <div className="flex items-center gap-3">
              <div>
                <div className="text-[15px] font-medium text-coda-text text-right">{receiverBank?.name || receiverCode}</div>
                <div className="text-xs text-coda-text-muted font-mono text-right">{receiverCode}{receiverBank?.jurisdiction ? ` \u00B7 ${receiverBank.jurisdiction}` : ''}</div>
              </div>
              <div className="w-10 h-10 rounded-lg bg-coda-brand/10 flex items-center justify-center text-sm font-bold font-mono text-coda-brand">{receiverCode.slice(0, 2)}</div>
            </div>
          </div>
        </div>

        {/* ── Stats zone (outline only) ── */}
        <div className="border border-white/[0.7] dark:border-white/[0.1] border-t-0 rounded-b-[20px] px-7 py-5">
          <div className="grid grid-cols-2 lg:grid-cols-5 gap-6">
            {[
              { label: 'Initiated', value: fmtDate(tx.initiated_at || tx.created_at), icon: Clock },
              { label: 'Duration', value: elapsed(tx.initiated_at || tx.created_at, isTerminal ? tx.settled_at || tx.updated_at : null), icon: Zap },
              { label: 'Purpose', value: tx.purpose_code || '\u2014', icon: Landmark },
              { label: 'Risk Score', value: riskScore?.composite_score != null ? `${riskScore.composite_score}/100` : (tx as any).risk_score != null ? `${(tx as any).risk_score}/100` : '\u2014', icon: Gauge },
              { label: 'Messages', value: `${messages.length} events`, icon: Radio },
            ].map(s => {
              const shouldFlash = justTransitioned && s.label === 'Duration';
              return (
                <div key={s.label} className={`transition-all duration-500 ${
                  shouldFlash ? (justTransitioned === 'settled' ? 'bg-emerald-500/10 ring-1 ring-emerald-500/20 rounded-lg p-2 -m-2' : 'bg-red-500/10 ring-1 ring-red-500/20 rounded-lg p-2 -m-2') : ''
                }`}>
                  <div className="flex items-center gap-2 mb-1">
                    <s.icon className="w-3.5 h-3.5 text-coda-text-muted" />
                    <span className="text-[11px] text-coda-text-muted">
                      {s.label === 'Duration' && tx.status === 'locked' && (tx as any).lockup_until ? 'Countdown' : s.label}
                    </span>
                  </div>
                  <div className="text-[15px] font-medium font-mono text-coda-text">
                    {s.label === 'Duration' ? (
                      <LiveDuration
                        from={tx.initiated_at || tx.created_at}
                        to={isTerminal ? tx.settled_at || tx.updated_at : null}
                        lockupUntil={tx.status === 'locked' ? (tx as any).lockup_until : null}
                        isTerminal={isTerminal}
                      />
                    ) : s.value}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* ═══ Detail Tabs ═══ */}
      <div className="flex items-center gap-1 mb-4">
        {([
          { id: 'overview', label: 'Overview' },
          { id: 'settlement', label: 'Settlement' },
          { id: 'intelligence', label: 'Intelligence' },
          { id: 'counterparties', label: 'Counterparties' },
        ] as const).map(tab => (
          <button
            key={tab.id}
            onClick={() => setDetailTab(tab.id)}
            className={`px-4 py-1.5 rounded-full text-sm transition-all duration-300 cursor-pointer ${
              detailTab === tab.id
                ? 'bg-coda-text text-white dark:bg-white dark:text-black font-medium'
                : 'text-coda-text-muted hover:text-coda-text hover:bg-black/5 dark:hover:bg-white/5'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div>
        {/* ═══ OVERVIEW TAB ═══ */}
        {detailTab === 'overview' && (
          <>
        {/* ═══ Section 3: Inter-Agent Pipeline Flow ═══ */}
        <div className="liquid-glass-card squircle p-6 mb-4">
          <h3 className="text-base font-light text-coda-text mb-5 flex items-center gap-2">
            <ArrowRightLeft className="w-5 h-5" />
            Agent Pipeline Flow
          </h3>
          <div className="flex items-start">
            {PIPELINE_STEPS.map((step, i) => {
              const verdict = pipelineVerdicts[step.key];
              const currentIdx = PIPELINE_STEPS.findIndex(s => pipelineVerdicts[s.key]?.status === 'active');
              const isActive = i === currentIdx;
              const isCompleted = verdict?.status === 'passed' || verdict?.status === 'failed';

              return (
                <div key={step.key} className="flex items-start flex-1">
                  <PipelineNode step={step} verdict={verdict} isActive={isActive} isCompleted={isCompleted} />
                  {i < PIPELINE_STEPS.length - 1 && (
                    <div className="flex items-center pt-5 px-1">
                      <div className={`h-px w-full min-w-[16px] transition-colors duration-300 ${
                        isCompleted ? 'bg-coda-brand/40' : 'bg-coda-border/15'
                      }`} />
                      <ChevronRight className={`w-4 h-4 shrink-0 ${isCompleted ? 'text-coda-brand/40' : 'text-coda-text-muted/40'}`} />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* ═══ Section 4: Risk Assessment + Compliance ═══ */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-4">

          {/* Risk Assessment */}
          <div className="liquid-glass-card squircle p-6">
            <h3 className="text-base font-light text-coda-text mb-4 flex items-center gap-2">
              <Gauge className="w-5 h-5" />
              Risk Assessment
              {riskScore?.risk_level && (
                <span className={`ml-auto px-2.5 py-1 rounded-full text-xs font-semibold ${RISK_LEVEL_CONFIG[riskScore.risk_level as keyof typeof RISK_LEVEL_CONFIG]?.bg || ''} ${RISK_LEVEL_CONFIG[riskScore.risk_level as keyof typeof RISK_LEVEL_CONFIG]?.color || ''}`}>
                  {(riskScore.risk_level as string).toUpperCase()}
                </span>
              )}
            </h3>

            {riskScore ? (
              <div className="space-y-4">
                {/* Score + Finality row */}
                <div className="flex items-center gap-5">
                  <div className="relative w-[64px] h-[64px] shrink-0">
                    <svg viewBox="0 0 64 64" className="w-[64px] h-[64px] -rotate-90">
                      <circle cx="32" cy="32" r="26" fill="none" stroke="currentColor" strokeWidth="4" className="text-coda-surface-hover/30" />
                      <circle cx="32" cy="32" r="26" fill="none" strokeWidth="4" strokeLinecap="round"
                        strokeDasharray={`${(riskScore.composite_score / 100) * 163.4} 163.4`}
                        className={riskScore.composite_score >= 70 ? 'text-emerald-500' : riskScore.composite_score >= 40 ? 'text-amber-500' : 'text-red-500'} />
                    </svg>
                    <span className="absolute inset-0 flex items-center justify-center text-lg font-bold font-mono text-coda-text">{riskScore.composite_score}</span>
                  </div>
                  <div className="flex-1 space-y-2">
                    {riskScore.finality_recommendation && (
                      <div className="text-[13px] text-coda-text-muted">
                        Finality: <span className={`font-medium ${riskScore.finality_recommendation === 'immediate' ? 'text-emerald-400' : 'text-amber-400'}`}>
                          {riskScore.finality_recommendation.replace(/_/g, ' ')}
                        </span>
                      </div>
                    )}
                  </div>
                </div>

                {/* Score bars — compact */}
                <div className="space-y-2">
                  <ScoreBar label="Counterparty" score={riskScore.counterparty_score ?? 0} icon={Landmark} />
                  <ScoreBar label="Jurisdiction" score={riskScore.jurisdiction_score ?? 0} icon={Globe} />
                  <ScoreBar label="Asset Type" score={riskScore.asset_type_score ?? 0} icon={Scale} />
                  <ScoreBar label="Behavioral" score={riskScore.behavioral_score ?? 0} icon={Activity} />
                </div>

                {/* AI Reasoning */}
                {riskScore.reasoning && (
                  <div className="pt-3 border-t border-black/[0.06] dark:border-white/[0.06]">
                    <p className="text-[11px] text-coda-text-muted mb-2">AI Reasoning</p>
                    <div className="text-[12px] text-coda-text-secondary leading-[1.6]">
                      {(() => {
                        // Split on newlines first, then on sentences for long blocks
                        const lines = riskScore.reasoning.split('\n').filter((l: string) => l.trim());
                        const segments = lines.length > 1 ? lines : riskScore.reasoning.split(/(?<=\.)\s+/);
                        return segments.filter((s: string) => s.trim()).map((seg: string, i: number) => {
                          const trimmed = seg.trim().replace(/\*\*(.*?)\*\*/g, '$1').replace(/^#+\s*/, '');
                          // Format ALL_CAPS_TERMS as code badges
                          const parts = trimmed.split(/(\b[A-Z][A-Z0-9_]{2,}\b)/g);
                          return (
                            <span key={i}>
                              {i > 0 && ' '}
                              {parts.map((part: string, j: number) =>
                                /^[A-Z][A-Z0-9_]{2,}$/.test(part)
                                  ? <code key={j} className="px-1 py-0.5 rounded bg-black/[0.04] dark:bg-white/[0.06] text-[11px] font-mono text-coda-text">{part}</code>
                                  : part
                              )}
                            </span>
                          );
                        });
                      })()}
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div className="py-8 text-center">
                <Gauge className="w-6 h-6 text-coda-text-muted mx-auto mb-3" />
                <p className="text-[13px] text-coda-text-muted font-mono">Risk assessment pending</p>
              </div>
            )}
          </div>

          {/* Compliance Checks */}
          <div className="liquid-glass-card squircle p-6">
            <h3 className="text-base font-light text-coda-text mb-4 flex items-center gap-2">
              <Shield className="w-5 h-5" />
              Compliance Checks
              {compChecks.length > 0 && (
                <span className={`ml-auto px-2.5 py-1 rounded-full text-xs font-semibold ${
                  compChecks.every((c: any) => c.passed) ? 'bg-emerald-500/20 text-emerald-400' : 'bg-red-500/20 text-red-400'
                }`}>
                  {compChecks.filter((c: any) => c.passed).length}/{compChecks.length} PASSED
                </span>
              )}
            </h3>

            {compChecks.length > 0 ? (
              <div>
                {compChecks.map((check: any, i: number) => (
                  <div key={i} className={`flex items-center gap-3 py-3 ${i > 0 ? 'border-t border-black/[0.06] dark:border-white/[0.06]' : ''}`}>
                    {check.passed ? <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" /> : <AlertTriangle className="w-4 h-4 text-red-500 shrink-0" />}
                    <div className="flex-1 min-w-0">
                      <span className="text-[13px] font-medium text-coda-text capitalize">{(check.type || '').replace(/_/g, ' ')}</span>
                    </div>
                    <span className="text-[12px] text-coda-text-muted text-right max-w-[60%] truncate" title={check.detail || '\u2014'}>{check.detail || '\u2014'}</span>
                  </div>
                ))}
              </div>
            ) : (
              <div className="py-8 text-center">
                <Shield className="w-6 h-6 text-coda-text-muted mx-auto mb-3" />
                <p className="text-[13px] text-coda-text-muted font-mono">Compliance checks pending</p>
              </div>
            )}

            {tx.memo && (
              <div className="mt-3 pt-3 border-t border-black/[0.06] dark:border-white/[0.06]">
                <div className="text-[11px] text-coda-text-muted mb-1">Memo</div>
                <p className="text-[13px] text-coda-text-muted font-mono truncate" title={tx.memo}>{tx.memo}</p>
              </div>
            )}
          </div>
        </div>
          </>
        )}

        {/* ═══ SETTLEMENT TAB ═══ */}
        {detailTab === 'settlement' && (
          <>
        {/* ═══ Section 6: Settlement Lifecycle ═══ */}
        <SettlementLifecycle
          tx={tx}
          lockup={lockup}
          messages={messages}
          senderCode={senderCode}
          receiverCode={receiverCode}
          senderMint={senderBank?.token_mint_address}
          receiverMint={receiverBank?.token_mint_address}
          justTransitioned={justTransitioned}
        />

        {/* ═══ Section 6b: Travel Rule Compliance ═══ */}
        {tx.travel_rule_payload && (
          <TravelRuleSection payload={tx.travel_rule_payload} />
        )}
          </>
        )}

        {/* ═══ INTELLIGENCE TAB ═══ */}
        {detailTab === 'intelligence' && (
          <>
        {/* ═══ Section 2: Treasury Cycle Context ═══ */}
        {cycle && (
          <div className="liquid-glass-card squircle p-6 mb-4">
            <h3 className="text-base font-light text-coda-text mb-4 flex items-center gap-2">
              <Activity className="w-5 h-5" />
              Treasury Cycle Origin
              <span className="ml-auto px-2.5 py-1 rounded-full text-xs font-semibold bg-coda-brand/15 text-coda-brand border border-coda-brand/20">
                Cycle #{cycle.cycle_number}
              </span>
            </h3>
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
              <div className="lg:col-span-2">
                <div className="text-[11px] text-coda-text-muted mb-1.5">Market Event</div>
                {cycle.market_event?.cycle_narrative ? (
                  <p className="text-[14px] text-coda-text-secondary leading-relaxed">{cycle.market_event.cycle_narrative}</p>
                ) : (
                  <p className="text-[14px] text-coda-text-muted italic">No market event narrative</p>
                )}
                {cycle.market_event?.event_type && (
                  <span className="inline-flex items-center mt-2 px-2.5 py-1 rounded text-xs font-mono bg-coda-surface-hover/30 text-coda-text-muted">
                    {cycle.market_event.event_type.replace(/_/g, ' ')}
                  </span>
                )}
              </div>
              <div className="space-y-3">
                <div>
                  <div className="text-[11px] text-coda-text-muted mb-1">Cycle Window</div>
                  <div className="text-[13px] font-mono text-coda-text-secondary">
                    {fmtDate(cycle.started_at)}{cycle.completed_at ? ` \u2192 ${fmtDate(cycle.completed_at)}` : ' \u2192 Running...'}
                  </div>
                </div>
                <div className="flex gap-5">
                  <div>
                    <div className="text-[11px] text-coda-text-muted mb-1">Banks Evaluated</div>
                    <div className="text-[13px] font-mono text-coda-text-secondary">{cycle.banks_evaluated}</div>
                  </div>
                  <div>
                    <div className="text-[11px] text-coda-text-muted mb-1">Transactions</div>
                    <div className="text-[13px] font-mono text-coda-text-secondary">{cycleTxCount} in cycle</div>
                  </div>
                </div>
                <Link to="/treasury-ops" className="flex items-center gap-1.5 text-[13px] text-blue-400 hover:text-blue-300 font-mono transition-colors">
                  View in Treasury Ops <ExternalLink className="w-4 h-4" />
                </Link>
              </div>
            </div>
          </div>
        )}

        {/* ═══ Section 7: Agent Communication Log ═══ */}
        <div className="liquid-glass-card squircle p-6 mb-4">
          <h3 className="text-base font-light text-coda-text mb-5 flex items-center gap-2">
            <Zap className="w-5 h-5" />
            Agent Communication Log
            <span className="ml-auto text-[13px] text-coda-text-muted">{messages.length} messages</span>
          </h3>

          {messages.length === 0 ? (
            <p className="text-[13px] text-coda-text-muted font-mono py-6 text-center">No agent messages for this transaction</p>
          ) : (
            <div className="space-y-0">
              {messages.map((msg, i) => {
                const config = MESSAGE_TYPE_CONFIG[msg.message_type] || { label: msg.message_type, color: 'text-coda-text-muted' };
                const fromCode = (msg as any).from_bank?.short_code || '???';
                const toCode = (msg as any).to_bank?.short_code || 'ALL';
                const isLast = i === messages.length - 1;
                const agent = resolveAgent(msg);
                const AgentIcon = agent.icon;
                const content = msg.content as Record<string, any>;
                const isExpanded = expandedMsg === msg.id;
                const hasRichContent = !!(content?.checks || content?.composite_score != null || content?.reasoning || content?.risk_context || content?.action);
                const hasLongText = (msg.natural_language || '').length > 100;
                const isExpandable = hasRichContent || hasLongText;

                return (
                  <div key={msg.id} className="flex gap-4">
                    {/* Timeline line + agent icon */}
                    <div className="flex flex-col items-center w-7 shrink-0">
                      <div className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 mt-0.5 ${agent.bgColor}`}>
                        <AgentIcon className={`w-3.5 h-3.5 ${agent.color}`} />
                      </div>
                      {!isLast && <div className="w-px flex-1 bg-coda-border/15 min-h-[20px]" />}
                    </div>

                    {/* Content */}
                    <div className="flex-1 pb-4 min-w-0">
                      {/* Header row */}
                      <div className="flex items-center gap-2.5 mb-1 flex-wrap">
                        <span className={`text-[13px] font-semibold font-mono ${agent.color}`}>{agent.name}</span>
                        <span className="text-xs text-coda-text-muted font-mono">{agent.role}</span>
                        <span className={`text-xs px-2 py-0.5 rounded font-mono ${config.color} bg-coda-surface-hover/30`}>{config.label}</span>
                        <span className="text-[13px] text-coda-text-muted font-mono">{fromCode} &rarr; {toCode}</span>
                        <span className="text-[11px] text-coda-text-muted font-mono ml-auto tabular-nums shrink-0">
                          {new Date(msg.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                        </span>
                      </div>

                      {/* Natural language message */}
                      {msg.natural_language && (
                        <p className={`text-[14px] text-coda-text-muted leading-relaxed ${!isExpanded && hasLongText ? 'line-clamp-2' : ''}`}>
                          {msg.natural_language}
                        </p>
                      )}

                      {/* Inline rich content badges */}
                      {!isExpanded && msg.message_type === 'compliance_response' && content?.checks_passed != null && (
                        <div className="flex items-center gap-2 mt-1.5">
                          <span className={`text-xs font-mono px-2 py-0.5 rounded ${
                            content.result === 'PASSED' ? 'bg-emerald-500/10 text-emerald-400' : 'bg-red-500/10 text-red-400'
                          }`}>{content.result}</span>
                          <span className="text-xs text-coda-text-muted">{content.checks_passed}/{content.checks_total} checks passed</span>
                        </div>
                      )}

                      {!isExpanded && msg.message_type === 'risk_alert' && content?.composite_score != null && (
                        <div className="flex items-center gap-2 mt-1.5">
                          <span className={`text-xs font-mono px-2 py-0.5 rounded ${
                            (content.risk_level as string) === 'low' ? 'bg-emerald-500/10 text-emerald-400' :
                            (content.risk_level as string) === 'medium' ? 'bg-amber-500/10 text-amber-400' : 'bg-red-500/10 text-red-400'
                          }`}>{(content.risk_level as string || '').toUpperCase()} {content.composite_score}/100</span>
                          {content.finality && <span className="text-xs text-coda-text-muted">Finality: {content.finality}</span>}
                        </div>
                      )}

                      {!isExpanded && content?.action === 'agent_decision' && (
                        <div className="flex items-center gap-2 mt-1.5">
                          <span className={`text-xs font-mono px-2 py-0.5 rounded ${
                            content.decision === 'accept' ? 'bg-emerald-500/10 text-emerald-400' : 'bg-red-500/10 text-red-400'
                          }`}>{(content.decision as string || '').toUpperCase()}</span>
                        </div>
                      )}

                      {/* Expand toggle */}
                      {isExpandable && (
                        <button onClick={() => setExpandedMsg(isExpanded ? null : msg.id)}
                          className="flex items-center gap-1 mt-1.5 text-xs text-coda-text-muted hover:bg-black/[0.02] dark:hover:bg-white/[0.02] transition-colors cursor-pointer rounded-md px-1 py-0.5">
                          {isExpanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                          <span>{isExpanded ? 'Collapse' : 'Show full details'}</span>
                        </button>
                      )}

                      {/* Expanded detail panel */}
                      {isExpanded && (
                        <div className={`mt-3 p-4 rounded-lg border space-y-4 ${agent.bgColor} ${agent.borderColor}`}>
                          {/* Compliance checks detail */}
                          {content?.checks && Array.isArray(content.checks) && (
                            <div>
                              <div className="text-[11px] text-coda-text-muted mb-2">Individual Checks</div>
                              <div className="space-y-1.5">
                                {content.checks.map((ch: any, ci: number) => (
                                  <div key={ci} className="flex items-start gap-2.5 text-[13px]">
                                    <span className={`shrink-0 mt-0.5 ${ch.passed ? 'text-emerald-400' : 'text-red-400'}`}>{ch.passed ? '✓' : '✗'}</span>
                                    <div className="flex-1">
                                      <span className="text-coda-text-secondary capitalize font-medium">{(ch.type || '').replace(/_/g, ' ')}</span>
                                      <span className="text-coda-text-muted ml-2">&mdash; {ch.detail}</span>
                                    </div>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}

                          {/* Risk sub-scores */}
                          {content?.composite_score != null && (
                            <div>
                              <div className="text-[11px] text-coda-text-muted mb-2">Risk Sub-scores</div>
                              <div className="grid grid-cols-2 gap-x-5 gap-y-2">
                                {[
                                  { label: 'Counterparty', val: content.counterparty_score },
                                  { label: 'Jurisdiction', val: content.jurisdiction_score },
                                  { label: 'Asset Type', val: content.asset_type_score },
                                  { label: 'Behavioral', val: content.behavioral_score },
                                ].filter(s => s.val != null).map(s => (
                                  <div key={s.label} className="flex items-center justify-between text-[13px]">
                                    <span className="text-coda-text-muted">{s.label}</span>
                                    <span className={`font-mono font-medium ${
                                      s.val >= 70 ? 'text-emerald-400' : s.val >= 40 ? 'text-amber-400' : 'text-red-400'
                                    }`}>{s.val}/100</span>
                                  </div>
                                ))}
                              </div>
                              {content.finality && (
                                <div className="mt-2 text-[13px]">
                                  <span className="text-coda-text-muted">Finality: </span>
                                  <span className={content.finality === 'immediate' ? 'text-emerald-400 font-medium' : 'text-amber-400 font-medium'}>
                                    {String(content.finality).replace(/_/g, ' ')}
                                  </span>
                                </div>
                              )}
                            </div>
                          )}

                          {/* Agent decision context */}
                          {content?.risk_context && (
                            <div>
                              <div className="text-[11px] text-coda-text-muted mb-1.5">Decision Context</div>
                              <div className="text-[13px]">
                                <span className="text-coda-text-muted">Decision: </span>
                                <span className={content.decision === 'accept' ? 'text-emerald-400 font-semibold' : 'text-red-400 font-semibold'}>
                                  {(content.decision as string || '').toUpperCase()}
                                </span>
                                <span className="text-coda-text-muted mx-2">&middot;</span>
                                <span className="text-coda-text-muted">Risk: </span>
                                <span className={
                                  content.risk_context.level === 'low' ? 'text-emerald-400' :
                                  content.risk_context.level === 'medium' ? 'text-amber-400' : 'text-red-400'
                                }>
                                  {String(content.risk_context.level).toUpperCase()} ({content.risk_context.score}/100)
                                </span>
                              </div>
                            </div>
                          )}

                          {/* Full reasoning */}
                          {content?.reasoning && typeof content.reasoning === 'string' && (
                            <div>
                              <div className="text-[11px] text-coda-text-muted mb-1.5">Full Reasoning</div>
                              <p className="text-[13px] text-coda-text-muted leading-relaxed">{content.reasoning}</p>
                            </div>
                          )}

                          {/* Raw payload fallback */}
                          {!content?.composite_score && !content?.checks && !content?.reasoning && !content?.risk_context && !content?.action && Object.keys(content || {}).length > 0 && (
                            <div>
                              <div className="text-[11px] text-coda-text-muted mb-1.5">Payload</div>
                              <pre className="text-xs text-coda-text-muted font-mono leading-relaxed overflow-x-auto whitespace-pre-wrap break-all">
                                {JSON.stringify(content, null, 2)}
                              </pre>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* ═══ Section 8: Active Treasury Mandates ═══ */}
        {mandates.length > 0 && (
          <div className="liquid-glass-card squircle p-6 mb-4">
            <button
              onClick={() => setShowMandates(!showMandates)}
              className="w-full flex items-center gap-3 p-0 text-base font-light text-coda-text hover:bg-black/[0.02] dark:hover:bg-white/[0.02] transition-colors cursor-pointer"
            >
              <FileText className="w-5 h-5" />
              <span>{receiverCode} Active Treasury Mandates ({mandates.length})</span>
              <span className="ml-auto">
                {showMandates ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
              </span>
            </button>

            {showMandates && (
              <div className="mt-4 space-y-3">
                {mandates.map((m: any) => (
                  <div key={m.id} className="flex items-start gap-3 p-3 rounded-lg bg-coda-surface-hover/10">
                    <div className={`w-6 h-6 rounded flex items-center justify-center shrink-0 mt-0.5 ${
                      m.mandate_type === 'liquidity_rebalance' ? 'bg-blue-500/15 text-blue-400' :
                      m.mandate_type === 'regulatory_payment' ? 'bg-coda-brand/15 text-coda-brand' :
                      'bg-emerald-500/15 text-emerald-400'
                    }`}>
                      <FileText className="w-3.5 h-3.5" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-[13px] font-medium text-coda-text capitalize">{(m.mandate_type || '').replace(/_/g, ' ')}</span>
                        <span className="text-[11px] px-2 py-0.5 rounded bg-coda-surface-hover/20 text-coda-text-muted font-mono">P{m.priority}</span>
                      </div>
                      <div className="text-[13px] text-coda-text-muted mt-1">{m.description || '\u2014'}</div>
                      {m.parameters && (
                        <div className="text-xs text-coda-text-muted font-mono mt-1">
                          {m.parameters.min_amount && m.parameters.max_amount
                            ? `$${m.parameters.min_amount.toLocaleString()} \u2013 $${m.parameters.max_amount.toLocaleString()}`
                            : ''}
                          {m.parameters.purpose_codes?.length > 0 ? ` \u00B7 ${m.parameters.purpose_codes.join(', ')}` : ''}
                          {m.parameters.counterparties?.length > 0 ? ` \u00B7 Counterparties: ${m.parameters.counterparties.join(', ')}` : ''}
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

          </>
        )}

        {/* ═══ COUNTERPARTIES TAB ═══ */}
        {detailTab === 'counterparties' && (
          <>
        {/* ═══ Section 5: Bank Counterparty Profiles ═══ */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-4">
          <BankProfileCard bank={senderBank} wallet={senderWallet} role="Sender" />
          <BankProfileCard bank={receiverBank} wallet={receiverWallet} role="Receiver" />
        </div>

        {/* ═══ Section 9: Corridor History ═══ */}
        {corridorHistory.length > 0 && (
          <div className="liquid-glass-card squircle p-6 mb-4">
            <h3 className="text-base font-light text-coda-text mb-4 flex items-center gap-2">
              <TrendingUp className="w-5 h-5" />
              Corridor History
              <span className="text-coda-text-muted font-mono text-xs ml-1">
                {senderCode} &harr; {receiverCode}
              </span>
              <span className="ml-auto text-[13px] text-coda-text-muted">
                {corridorHistory.length} previous &middot; ${corridorStats.totalVolume.toLocaleString()} total volume
              </span>
            </h3>
            <div className="space-y-2">
              {corridorHistory.slice(0, 5).map((hTx: any) => {
                const st = TX_STATUS_CONFIG[hTx.status as keyof typeof TX_STATUS_CONFIG] || TX_STATUS_CONFIG.initiated;
                return (
                  <Link key={hTx.id} to={`/transactions/${hTx.id}`}
                    className="flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-coda-surface-hover/10 transition-colors group">
                    <span className="text-[13px] font-mono text-coda-text-secondary w-24 shrink-0">
                      ${(hTx.amount_display || 0).toLocaleString()}
                    </span>
                    <span className={`text-xs px-2 py-0.5 rounded font-mono ${st.bg} ${st.color}`}>
                      {st.label}
                    </span>
                    {hTx.purpose_code && (
                      <span className="text-xs text-coda-text-muted font-mono">{hTx.purpose_code}</span>
                    )}
                    <span className="ml-auto text-xs text-coda-text-muted font-mono">
                      {new Date(hTx.created_at).toLocaleDateString([], { month: 'short', day: 'numeric' })}
                    </span>
                    <ChevronRight className="w-4 h-4 text-coda-text-muted opacity-0 group-hover:opacity-100 transition-opacity" />
                  </Link>
                );
              })}
              {corridorHistory.length > 5 && (
                <p className="text-xs text-coda-text-muted font-mono text-center py-2">
                  +{corridorHistory.length - 5} more transactions
                </p>
              )}
            </div>
          </div>
        )}

          </>
        )}

        {/* ═══ Sections 10–12: Cadenza Lockup Details (in Settlement tab) ═══ */}
        {detailTab === 'settlement' && hasLockup && lockup && (
          <>
            {/* ═══ Section 10: Three-Token Flow ═══ */}
            <div className={`liquid-glass-card squircle p-6 mb-4 transition-all duration-700 ${
              justTransitioned === 'settled' ? 'ring-1 ring-emerald-500/25 shadow-[0_0_30px_rgba(52,211,153,0.08)]' :
              justTransitioned === 'reversed' ? 'ring-1 ring-red-500/25 shadow-[0_0_30px_rgba(248,113,113,0.08)]' : ''
            }`}>
              <h3 className="text-base font-light text-coda-text mb-5 flex items-center gap-2">
                <ArrowDownUp className="w-5 h-5" />
                Three-Token Lockup Flow
                <span className={`ml-auto px-2.5 py-1 rounded-full text-xs font-semibold transition-all duration-500 ${
                  effectiveLockupStatus === 'active' ? 'bg-amber-500/15 text-amber-600 dark:text-amber-400 border border-amber-500/25 dark:border-amber-500/20' :
                  effectiveLockupStatus === 'escalated' ? 'bg-coda-brand/15 text-coda-brand border border-coda-brand/25 dark:border-coda-brand/20' :
                  effectiveLockupStatus === 'settled' ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border border-emerald-500/25 dark:border-emerald-500/20' :
                  effectiveLockupStatus === 'reversed' ? 'bg-red-500/15 text-red-600 dark:text-red-400 border border-red-500/25 dark:border-red-500/20' :
                  'bg-coda-surface-hover/30 text-coda-text-muted border border-coda-border/20'
                } ${justTransitioned === 'settled' && effectiveLockupStatus === 'settled' ? 'ring-2 ring-emerald-400/40 scale-110' :
                   justTransitioned === 'reversed' && effectiveLockupStatus === 'reversed' ? 'ring-2 ring-red-400/40 scale-110' : ''}`}>
                  {(effectiveLockupStatus || lockup.status).toUpperCase()}
                </span>
              </h3>

              {/* Task 117: Lockup duration info — requested vs effective */}
              {tx.lockup_duration_minutes != null && (
                <div className="flex flex-wrap gap-3 mb-5 text-[12px] font-mono">
                  <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-500/[0.08] border border-blue-500/25 dark:border-blue-500/15">
                    <span className="text-blue-500 dark:text-blue-400">Requested:</span>
                    <span className="text-coda-text-secondary font-semibold">
                      {tx.lockup_duration_minutes === 0 ? 'Instant (0 min)' : `${tx.lockup_duration_minutes} min`}
                    </span>
                  </div>
                  {lockup.lockup_end && (
                    <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-500/[0.08] border border-amber-500/25 dark:border-amber-500/15">
                      <span className="text-amber-500 dark:text-amber-400">Effective:</span>
                      <span className="text-coda-text-secondary font-semibold">
                        {(() => {
                          const effMs = new Date(lockup.lockup_end).getTime() - new Date(lockup.lockup_start).getTime();
                          const effMins = Math.round(effMs / 60_000);
                          return effMins >= 60 ? `${Math.floor(effMins / 60)}h ${effMins % 60}m` : `${effMins} min`;
                        })()}
                      </span>
                      {tx.lockup_duration_minutes > 0 && lockup.lockup_end && (() => {
                        const effMins = Math.round((new Date(lockup.lockup_end).getTime() - new Date(lockup.lockup_start).getTime()) / 60_000);
                        return effMins > tx.lockup_duration_minutes;
                      })() && (
                        <span className="text-[10px] text-amber-400/70">(risk extended)</span>
                      )}
                    </div>
                  )}
                  {!lockup.lockup_end && (
                    <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-coda-brand/[0.08] border border-coda-brand/25 border-coda-brand/15">
                      <span className="text-coda-brand">Effective:</span>
                      <span className="text-coda-text-secondary font-semibold">Indefinite</span>
                      <span className="text-[10px] text-coda-brand/70">(escalation eligible)</span>
                    </div>
                  )}
                </div>
              )}

              {/* Flow diagram: Sender → YB Token (BNY) → TB Token (Receiver) */}
              <div className="flex items-stretch gap-0 overflow-x-auto pb-2">
                {/* Step 1: Sender Deposit (Burn) */}
                <div className="flex-1 min-w-[180px]">
                  <div className={`rounded-xl p-4 h-full relative backdrop-blur-md ${
                    isLockupFinalized
                      ? 'bg-emerald-500/[0.06] border border-emerald-500/25 dark:bg-emerald-500/5 dark:border-emerald-500/20'
                      : 'bg-blue-500/[0.06] border border-blue-500/25 dark:bg-blue-500/8 dark:border-blue-500/20'
                  }`}>
                    {isLockupFinalized && (
                      <div className="absolute top-2.5 right-2.5">
                        <CheckCircle2 className="w-4 h-4 text-emerald-500" />
                      </div>
                    )}
                    <div className="flex items-center gap-2 mb-3">
                      <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${
                        isLockupFinalized ? 'bg-emerald-500/15' : 'bg-blue-500/15'
                      }`}>
                        <CircleDollarSign className={`w-4 h-4 ${isLockupFinalized ? 'text-emerald-400' : 'text-blue-400'}`} />
                      </div>
                      <div>
                        <div className={`text-[12px] font-semibold font-mono ${isLockupFinalized ? 'text-emerald-400' : 'text-blue-400'}`}>1. SENDER DEPOSIT</div>
                        <div className="text-[11px] text-coda-text-muted">{senderCode} tokens burned</div>
                      </div>
                    </div>
                    <div className="space-y-2">
                      <div>
                        <span className="text-[10px] text-coda-text-muted block">Amount</span>
                        <span className="text-[13px] font-mono font-semibold text-coda-text">
                          ${(Number(lockup.yb_token_amount) / 1e6).toLocaleString()}
                        </span>
                      </div>
                      <div>
                        <span className="text-[10px] text-coda-text-muted block">Initiated</span>
                        <span className="text-[12px] font-mono text-coda-text-muted">
                          {fmtDate(lockup.lockup_start)}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Arrow */}
                <div className="flex items-center px-2 shrink-0">
                  <div className={`h-px w-4 ${isLockupFinalized ? 'bg-emerald-500/30' : 'bg-coda-border/30'}`} />
                  <ChevronRight className={`w-4 h-4 ${isLockupFinalized ? 'text-emerald-500/50' : 'text-coda-text-muted/60'}`} />
                </div>

                {/* Step 2: Yield-Bearing Token (BNY Custodian) */}
                <div className="flex-1 min-w-[180px]">
                  <div className={`rounded-xl p-4 h-full relative backdrop-blur-md ${
                    isLockupSettled
                      ? 'bg-emerald-500/[0.06] border border-emerald-500/25 dark:bg-emerald-500/5 dark:border-emerald-500/20'
                      : isLockupReversed
                        ? 'bg-red-500/[0.06] border border-red-500/25 dark:bg-red-500/5 dark:border-red-500/20'
                        : 'bg-amber-500/[0.06] border border-amber-500/25 dark:bg-amber-500/8 dark:border-amber-500/20'
                  }`}>
                    {isLockupFinalized && (
                      <div className="absolute top-2.5 right-2.5">
                        {isLockupSettled
                          ? <CheckCircle2 className="w-4 h-4 text-emerald-500" />
                          : <RotateCcw className="w-4 h-4 text-red-400" />
                        }
                      </div>
                    )}
                    <div className="flex items-center gap-2 mb-3">
                      <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${
                        isLockupSettled ? 'bg-emerald-500/15' : isLockupReversed ? 'bg-red-500/15' : 'bg-amber-500/15'
                      }`}>
                        <Coins className={`w-4 h-4 ${
                          isLockupSettled ? 'text-emerald-400' : isLockupReversed ? 'text-red-400' : 'text-amber-400'
                        }`} />
                      </div>
                      <div>
                        <div className={`text-[12px] font-semibold font-mono ${
                          isLockupSettled ? 'text-emerald-400' : isLockupReversed ? 'text-red-400' : 'text-amber-400'
                        }`}>2. YIELD-BEARING</div>
                        <div className="text-[11px] text-coda-text-muted">
                          {isLockupSettled ? 'Burned from escrow' : isLockupReversed ? 'Returned to sender' : 'BNY Custodian holds'}
                        </div>
                      </div>
                    </div>
                    <div className="space-y-2">
                      <div>
                        <span className="text-[10px] text-coda-text-muted block">Token</span>
                        <span className={`text-[13px] font-mono font-semibold ${
                          isLockupSettled ? 'text-emerald-400 line-through opacity-60' : isLockupReversed ? 'text-red-400 line-through opacity-60' : 'text-amber-400'
                        }`}>{lockup.yb_token_symbol}</span>
                        {isLockupFinalized && (
                          <span className={`text-[10px] ml-1.5 ${isLockupSettled ? 'text-emerald-400/70' : 'text-red-400/70'}`}>
                            ({isLockupSettled ? 'burned' : 'returned'})
                          </span>
                        )}
                      </div>
                      <div>
                        <span className="text-[10px] text-coda-text-muted block">Mint</span>
                        <button
                          onClick={() => copyText(lockup.yb_token_mint, 'yb-mint')}
                          className="flex items-center text-[12px] font-mono text-coda-text-muted"
                        >
                          <span>{truncateAddress(lockup.yb_token_mint, 6)}</span>
                          {copied === 'yb-mint' ? <CheckCircle2 className="w-3 h-3 text-coda-brand" /> : <Copy className="w-3 h-3" />}
                        </button>
                      </div>
                      <div>
                        <span className="text-[10px] text-coda-text-muted block">Holder</span>
                        <button
                          onClick={() => copyText(lockup.yb_holder, 'yb-holder')}
                          className="flex items-center text-[12px] font-mono text-coda-text-muted"
                        >
                          <span>{truncateAddress(lockup.yb_holder, 6)}</span>
                          {copied === 'yb-holder' ? <CheckCircle2 className="w-3 h-3 text-coda-brand" /> : <Copy className="w-3 h-3" />}
                        </button>
                      </div>
                      {lockup.yb_token_mint && (
                        <a href={explorerUrl(lockup.yb_token_mint, 'address')} target="_blank" rel="noopener noreferrer"
                          className="flex items-center gap-1 text-[11px] text-blue-400 hover:text-blue-300 transition-colors">
                          <ExternalLink className="w-3 h-3" /> Explorer
                        </a>
                      )}
                    </div>
                  </div>
                </div>

                {/* Arrow */}
                <div className="flex items-center px-2 shrink-0">
                  <div className={`h-px w-4 ${isLockupFinalized ? 'bg-emerald-500/30' : 'bg-coda-border/30'}`} />
                  <ChevronRight className={`w-4 h-4 ${isLockupFinalized ? 'text-emerald-500/50' : 'text-coda-text-muted/60'}`} />
                </div>

                {/* Step 3: T-Bill Token (Receiver) */}
                <div className="flex-1 min-w-[180px]">
                  <div className={`rounded-xl p-4 h-full relative backdrop-blur-md transition-all duration-700 ${
                    isLockupSettled
                      ? 'bg-emerald-500/[0.06] border border-emerald-500/25 dark:bg-emerald-500/5 dark:border-emerald-500/20'
                      : isLockupReversed
                        ? 'bg-red-500/[0.06] border border-red-500/25 dark:bg-red-500/5 dark:border-red-500/20'
                        : 'bg-coda-brand/[0.06] border border-coda-brand/25 dark:bg-coda-brand/8 dark:border-coda-brand/20'
                  } ${justTransitioned === 'settled' && isLockupSettled ? 'animate-[fadeSlideIn_0.6s_ease-out] ring-1 ring-emerald-400/30' : ''}`}>
                    {isLockupFinalized && (
                      <div className="absolute top-2.5 right-2.5">
                        {isLockupSettled
                          ? <CheckCircle2 className="w-4 h-4 text-emerald-500" />
                          : <RotateCcw className="w-4 h-4 text-red-400" />
                        }
                      </div>
                    )}
                    <div className="flex items-center gap-2 mb-3">
                      <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${
                        isLockupSettled ? 'bg-emerald-500/15' : isLockupReversed ? 'bg-red-500/15' : 'bg-coda-brand/15'
                      }`}>
                        <Landmark className={`w-4 h-4 ${
                          isLockupSettled ? 'text-emerald-400' : isLockupReversed ? 'text-red-400' : 'text-coda-brand'
                        }`} />
                      </div>
                      <div>
                        <div className={`text-[12px] font-semibold font-mono ${
                          isLockupSettled ? 'text-emerald-400' : isLockupReversed ? 'text-red-400' : 'text-coda-brand'
                        }`}>3. T-BILL TOKEN</div>
                        <div className="text-[11px] text-coda-text-muted">
                          {isLockupSettled ? `${receiverCode} received` : isLockupReversed ? 'Not minted' : `${receiverCode} holds`}
                        </div>
                      </div>
                    </div>
                    <div className="space-y-2">
                      <div>
                        <span className="text-[10px] text-coda-text-muted block">Token</span>
                        <span className={`text-[13px] font-mono font-semibold ${
                          isLockupSettled ? 'text-emerald-400' : isLockupReversed ? 'text-red-400 line-through opacity-60' : 'text-coda-brand'
                        }`}>{lockup.tb_token_symbol}</span>
                        {isLockupSettled && (
                          <span className="text-[10px] ml-1.5 text-emerald-400/70">(minted)</span>
                        )}
                        {isLockupReversed && (
                          <span className="text-[10px] ml-1.5 text-red-400/70">(cancelled)</span>
                        )}
                      </div>
                      <div>
                        <span className="text-[10px] text-coda-text-muted block">Mint</span>
                        <button
                          onClick={() => copyText(lockup.tb_token_mint, 'tb-mint')}
                          className="flex items-center text-[12px] font-mono text-coda-text-muted"
                        >
                          <span>{truncateAddress(lockup.tb_token_mint, 6)}</span>
                          {copied === 'tb-mint' ? <CheckCircle2 className="w-3 h-3 text-coda-brand" /> : <Copy className="w-3 h-3" />}
                        </button>
                      </div>
                      <div>
                        <span className="text-[10px] text-coda-text-muted block">Holder</span>
                        <button
                          onClick={() => copyText(lockup.tb_holder, 'tb-holder')}
                          className="flex items-center text-[12px] font-mono text-coda-text-muted"
                        >
                          <span>{truncateAddress(lockup.tb_holder, 6)}</span>
                          {copied === 'tb-holder' ? <CheckCircle2 className="w-3 h-3 text-coda-brand" /> : <Copy className="w-3 h-3" />}
                        </button>
                      </div>
                      {lockup.tb_token_mint && (
                        <a href={explorerUrl(lockup.tb_token_mint, 'address')} target="_blank" rel="noopener noreferrer"
                          className="flex items-center gap-1 text-[11px] text-blue-400 hover:text-blue-300 transition-colors">
                          <ExternalLink className="w-3 h-3" /> Explorer
                        </a>
                      )}
                    </div>
                  </div>
                </div>
              </div>

              {/* Resolution summary bar — shown when lockup is finalized */}
              {isLockupFinalized && (
                <div className={`mt-4 p-3.5 rounded-xl border flex flex-wrap items-center gap-x-5 gap-y-2 text-[12px] font-mono transition-all duration-500 ${
                  isLockupSettled
                    ? 'bg-emerald-500/5 border-emerald-500/15'
                    : 'bg-red-500/5 border-red-500/15'
                } ${justTransitioned ? 'animate-[fadeSlideIn_0.5s_ease-out]' : ''}`}>
                  <div className="flex items-center gap-1.5">
                    {isLockupSettled
                      ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
                      : <RotateCcw className="w-3.5 h-3.5 text-red-400" />
                    }
                    <span className={`font-semibold ${isLockupSettled ? 'text-emerald-400' : 'text-red-400'}`}>
                      {isLockupSettled ? 'Hard Finality Achieved' : 'Lockup Reversed'}
                    </span>
                  </div>
                  {(lockup.resolved_at || tx.settled_at) && (
                    <div className="flex items-center gap-1.5 text-coda-text-muted">
                      <Clock className="w-3 h-3 text-coda-text-muted" />
                      {fmtDate(lockup.resolved_at || tx.settled_at)}
                    </div>
                  )}
                  {lockup.resolved_by && (
                    <div className="flex items-center gap-1.5 text-coda-text-muted">
                      <UserCheck className="w-3 h-3 text-coda-text-muted" />
                      {lockup.resolved_by}
                    </div>
                  )}
                  {lockup.resolution && (
                    <div className="flex items-center gap-1.5 text-coda-text-muted">
                      <FileText className="w-3 h-3 text-coda-text-muted" />
                      {lockup.resolution.replace(/_/g, ' ')}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* ═══ Section 11: Yield Accrual ═══ */}
            <div className="liquid-glass-card squircle p-6 mb-4">
              <h3 className="text-base font-light text-coda-text mb-4 flex items-center gap-2">
                <TrendingUp className="w-5 h-5" />
                Yield Accrual
                {!isLockupFinalized && ['active', 'escalated'].includes(lockup.status) && (
                  <span className="ml-2 flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/25 dark:border-emerald-500/20 animate-pulse">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 dark:bg-emerald-400" />
                    LIVE
                  </span>
                )}
                {isLockupFinalized && (
                  <span className={`ml-2 flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] border ${
                    isLockupSettled ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/25 dark:border-emerald-500/20' : 'bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/25 dark:border-red-500/20'
                  }`}>
                    {isLockupSettled ? 'FINAL' : 'REVERSED'}
                  </span>
                )}
              </h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
                <div>
                  <div className="text-[11px] text-coda-text-muted mb-1.5">Rate</div>
                  <div className="text-[20px] font-mono font-bold text-coda-text-secondary">
                    {lockup.yield_rate_bps} <span className="text-[14px] text-coda-text-muted">bps</span>
                  </div>
                  <div className="text-[12px] text-coda-text-muted font-mono">
                    {(lockup.yield_rate_bps / 100).toFixed(2)}% annualized
                  </div>
                </div>
                <div>
                  <div className="text-[11px] text-coda-text-muted mb-1.5">Accrued</div>
                  <div className="text-[20px] font-mono font-bold text-emerald-600 dark:text-emerald-400">
                    ${liveYield ?? (Number(lockup.yield_accrued) / 1e6).toFixed(6)}
                  </div>
                  <div className="text-[12px] text-coda-text-muted font-mono">
                    on ${(Number(lockup.yb_token_amount) / 1e6).toLocaleString()} principal
                  </div>
                </div>
                <div>
                  <div className="text-[11px] text-coda-text-muted mb-1.5">Duration</div>
                  {(() => {
                    const resolvedTime = lockup.resolved_at || tx.settled_at;
                    const endTime = isLockupFinalized && resolvedTime ? new Date(resolvedTime).getTime() : Date.now();
                    const elapsedMs = endTime - new Date(lockup.lockup_start).getTime();
                    const elapsedMins = Math.floor(elapsedMs / 60_000);
                    const elapsedHrs = Math.floor(elapsedMins / 60);
                    const totalEnd = lockup.lockup_end ? new Date(lockup.lockup_end).getTime() - new Date(lockup.lockup_start).getTime() : null;
                    const totalMins = totalEnd ? Math.floor(totalEnd / 60_000) : null;
                    return (
                      <>
                        <div className="text-[20px] font-mono font-bold text-coda-text-secondary">
                          {elapsedHrs > 0 ? `${elapsedHrs}h ${elapsedMins % 60}m` : `${elapsedMins}m`}
                        </div>
                        <div className={`text-[12px] font-mono ${
                          isLockupFinalized ? (isLockupSettled ? 'text-emerald-400' : 'text-red-400')
                          : isEscalated ? 'text-coda-brand' : 'text-coda-text-muted'
                        }`}>
                          {isLockupFinalized
                            ? (isLockupSettled ? 'lockup complete — settled' : 'lockup complete — reversed')
                            : isEscalated ? '∞ (escalated — no expiry)' : totalMins != null ? `of ${Math.floor(totalMins / 60)}h ${totalMins % 60}m total` : 'no end set'}
                        </div>
                        {totalEnd && (
                          <div className="mt-2 h-2 rounded-full bg-coda-surface-hover/40 dark:bg-coda-surface-hover/30 overflow-hidden">
                            <div
                              className={`h-full rounded-full transition-all duration-1000 ${
                                isLockupFinalized
                                  ? (isLockupSettled ? 'bg-emerald-500/80' : 'bg-red-500/60')
                                  : 'bg-amber-500/60'
                              }`}
                              style={{ width: isLockupFinalized ? '100%' : `${Math.min(100, (elapsedMs / totalEnd) * 100)}%` }}
                            />
                          </div>
                        )}
                      </>
                    );
                  })()}
                </div>
                <div>
                  <div className="text-[11px] text-coda-text-muted mb-1.5">Yield Destination</div>
                  <div className="text-[14px] font-mono font-medium text-coda-text-secondary">
                    Rimark Network Fees
                  </div>
                  <div className="text-[12px] text-coda-text-muted font-mono">
                    Custodian: BNY
                  </div>
                </div>
              </div>
            </div>

            {/* ═══ Section 11b: Lockup Management ═══ */}
            {tx.status === 'locked' && lockup && ['active', 'escalated'].includes(lockup.status) && !isLockupFinalized && (
              <div className="liquid-glass-card squircle p-6 mb-4 border border-amber-500/25 dark:border-amber-500/15">
                <h3 className="text-base font-light text-coda-text mb-4 flex items-center gap-2">
                  <Lock className="w-5 h-5 text-amber-400" />
                  Lockup Management
                  <span className="ml-auto px-2.5 py-1 rounded-full text-[11px] font-semibold bg-amber-500/15 text-amber-600 dark:text-amber-400 border border-amber-500/25 dark:border-amber-500/20">
                    OPERATOR CONTROLS
                  </span>
                </h3>

                {/* Status feedback */}
                {lockupActionError && (
                  <div className="mb-4 p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-[13px] text-red-400 font-mono flex items-center gap-2">
                    <AlertTriangle className="w-4 h-4 shrink-0" />
                    {lockupActionError}
                  </div>
                )}
                {lockupActionSuccess && (
                  <div className="mb-4 p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-[13px] text-emerald-400 font-mono flex items-center gap-2">
                    <CheckCircle2 className="w-4 h-4 shrink-0" />
                    {lockupActionSuccess}
                  </div>
                )}

                <p className="text-[13px] text-coda-text-muted mb-4 leading-relaxed">
                  This transaction is in a lockup hold. Use these controls to manage it independently of Cadenza's automated monitoring.
                  {isEscalated && (
                    <span className="text-coda-brand ml-1">Note: This lockup is escalated — use the Escalation Resolution panel below for Cadenza-specific actions.</span>
                  )}
                </p>

                {/* Action buttons */}
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-4">
                  {/* Final Settle Now */}
                  <button
                    onClick={() => handleLockupAction('settle_now')}
                    disabled={!!lockupActionLoading}
                    className="liquid-button flex items-center px-4 py-3 backdrop-blur-md text-left group disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {lockupActionLoading === 'settle_now' ? (
                      <Loader2 className="w-5 h-5 text-emerald-400 animate-spin" />
                    ) : (
                      <FastForward className="w-5 h-5 text-emerald-400 group-hover:scale-110 transition-transform" />
                    )}
                    <div>
                      <div className="text-[13px] font-semibold text-emerald-600 dark:text-emerald-400 font-mono">Final Settle Now</div>
                      <div className="text-[11px] text-coda-text-muted">Skip countdown, hard finality</div>
                    </div>
                  </button>

                  {/* Extend Lockup */}
                  <button
                    onClick={() => setShowExtendModal(!showExtendModal)}
                    disabled={!!lockupActionLoading}
                    className="liquid-button flex items-center px-4 py-3 backdrop-blur-md text-left group disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {lockupActionLoading === 'extend' ? (
                      <Loader2 className="w-5 h-5 text-blue-400 animate-spin" />
                    ) : (
                      <Plus className="w-5 h-5 text-blue-400 group-hover:scale-110 transition-transform" />
                    )}
                    <div>
                      <div className="text-[13px] font-semibold text-blue-600 dark:text-blue-400 font-mono">Extend Lockup</div>
                      <div className="text-[11px] text-coda-text-muted">Add time to countdown</div>
                    </div>
                  </button>

                  {/* Reverse */}
                  <button
                    onClick={() => setShowReverseConfirm(!showReverseConfirm)}
                    disabled={!!lockupActionLoading}
                    className="liquid-button flex items-center px-4 py-3 backdrop-blur-md text-left group disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {lockupActionLoading === 'reverse' ? (
                      <Loader2 className="w-5 h-5 text-red-400 animate-spin" />
                    ) : (
                      <RotateCcw className="w-5 h-5 text-red-400 group-hover:scale-110 transition-transform" />
                    )}
                    <div>
                      <div className="text-[13px] font-semibold text-red-600 dark:text-red-400 font-mono">Reverse</div>
                      <div className="text-[11px] text-coda-text-muted">Claw back to sender</div>
                    </div>
                  </button>
                </div>

                {/* Extend modal */}
                {showExtendModal && (
                  <div className="p-4 rounded-xl bg-blue-500/5 border border-blue-500/15 mb-3">
                    <div className="flex items-center gap-2 mb-3">
                      <Plus className="w-4 h-4 text-blue-400" />
                      <span className="text-[13px] font-semibold text-blue-400 font-mono">Extend Lockup Duration</span>
                    </div>
                    <div className="flex items-center gap-3">
                      <label className="text-[12px] text-coda-text-muted font-mono shrink-0">Add minutes:</label>
                      <input
                        type="number"
                        min={5}
                        max={1440}
                        value={extendMinutes}
                        onChange={(e) => setExtendMinutes(Math.max(5, Number(e.target.value)))}
                        className="w-24 px-3 py-1.5 rounded-lg bg-coda-surface-hover/20 border border-coda-border/20 text-[13px] font-mono text-coda-text-secondary focus:outline-none focus:border-blue-500/40"
                      />
                      <div className="flex gap-2">
                        {[15, 30, 60, 120].map(m => (
                          <button
                            key={m}
                            onClick={() => setExtendMinutes(m)}
                            className={`px-2.5 py-1 text-[11px] font-mono rounded-md transition-colors ${
                              extendMinutes === m
                                ? 'text-blue-400'
                                : 'text-coda-text-muted hover:text-coda-text'
                            }`}
                          >
                            <span>{m}m</span>
                          </button>
                        ))}
                      </div>
                      <button
                        onClick={() => handleLockupAction('extend', { extend_minutes: extendMinutes })}
                        disabled={!!lockupActionLoading}
                        className="liquid-button ml-auto px-4 py-1.5 text-blue-400 text-[12px] font-semibold font-mono disabled:opacity-50"
                      >
                        <span>{lockupActionLoading === 'extend' ? 'Extending...' : `Extend +${extendMinutes}m`}</span>
                      </button>
                    </div>
                    {(tx as any).lockup_until && (
                      <div className="mt-2 text-[11px] text-coda-text-muted font-mono">
                        Current expiry: {new Date((tx as any).lockup_until).toLocaleString()} → New: {new Date(new Date((tx as any).lockup_until).getTime() + extendMinutes * 60_000).toLocaleString()}
                      </div>
                    )}
                  </div>
                )}

                {/* Reverse confirmation */}
                {showReverseConfirm && (
                  <div className="p-4 rounded-xl bg-red-500/5 border border-red-500/15 mb-3">
                    <div className="flex items-center gap-2 mb-3">
                      <AlertTriangle className="w-4 h-4 text-red-400" />
                      <span className="text-[13px] font-semibold text-red-400 font-mono">Confirm Reversal</span>
                    </div>
                    <p className="text-[12px] text-coda-text-muted mb-3">
                      This will burn LOCKUP-USTB escrow tokens from BNY, re-mint sender deposit tokens, and mark the transaction as reversed. The receiver never had tokens — this is a clean reversal. This action is <strong className="text-red-400">irreversible</strong>.
                    </p>
                    <div className="flex items-center gap-3">
                      <input
                        type="text"
                        placeholder="Reason for reversal (optional)"
                        value={reverseReason}
                        onChange={(e) => setReverseReason(e.target.value)}
                        className="flex-1 px-3 py-1.5 rounded-lg bg-coda-surface-hover/20 border border-coda-border/20 text-[13px] font-mono text-coda-text-secondary placeholder:text-coda-text-muted/50 focus:outline-none focus:border-red-500/40"
                      />
                      <button
                        onClick={() => setShowReverseConfirm(false)}
                        className="px-3 py-1.5 text-[12px] font-mono text-coda-text-muted"
                      >
                        <span>Cancel</span>
                      </button>
                      <button
                        onClick={() => handleLockupAction('reverse', { reason: reverseReason || undefined })}
                        disabled={!!lockupActionLoading}
                        className="liquid-button px-4 py-1.5 bg-red-500/15 text-red-400 text-[12px] font-semibold font-mono disabled:opacity-50"
                      >
                        <span>{lockupActionLoading === 'reverse' ? 'Reversing...' : 'Confirm Reverse'}</span>
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* ═══ Section 12: Cadenza Activity ═══ */}
            <div className="liquid-glass-card squircle p-6 mb-4">
              <h3 className="text-base font-light text-coda-text mb-5 flex items-center gap-2">
                <Eye className="w-5 h-5" />
                Cadenza Activity
                <span className="ml-auto text-[13px] text-coda-text-muted">{cadenzaFlags.length} event{cadenzaFlags.length !== 1 ? 's' : ''}</span>
              </h3>

              {cadenzaFlags.length === 0 ? (
                <div className="py-8 text-center">
                  <Eye className="w-6 h-6 text-coda-text-muted mx-auto mb-3" />
                  <p className="text-[13px] text-coda-text-muted font-mono">
                    {isLockupFinalized
                      ? 'No Cadenza flags raised — lockup resolved cleanly'
                      : 'No Cadenza flags raised — monitoring in progress'}
                  </p>
                </div>
              ) : (
                <div className="space-y-0">
                  {cadenzaFlags.map((flag, i) => {
                    const isLast = i === cadenzaFlags.length - 1;
                    const severityConfig: Record<string, { color: string; bg: string; icon: typeof Shield }> = {
                      info: { color: 'text-blue-400', bg: 'bg-blue-500/15', icon: Eye },
                      warning: { color: 'text-amber-400', bg: 'bg-amber-500/15', icon: AlertTriangle },
                      escalate: { color: 'text-coda-brand', bg: 'bg-coda-brand/15', icon: Flag },
                      auto_reverse: { color: 'text-red-400', bg: 'bg-red-500/15', icon: RotateCcw },
                    };
                    const sc = severityConfig[flag.severity] || severityConfig.info;
                    const FlagIcon = sc.icon;

                    return (
                      <div key={flag.id} className="flex gap-4">
                        <div className="flex flex-col items-center w-7 shrink-0">
                          <div className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 mt-0.5 ${sc.bg}`}>
                            <FlagIcon className={`w-3.5 h-3.5 ${sc.color}`} />
                          </div>
                          {!isLast && <div className="w-px flex-1 bg-coda-border/15 min-h-[20px]" />}
                        </div>
                        <div className="flex-1 pb-4 min-w-0">
                          <div className="flex items-center gap-2.5 mb-1 flex-wrap">
                            <span className={`text-[13px] font-semibold font-mono ${sc.color}`}>
                              {flag.flag_type.replace(/_/g, ' ')}
                            </span>
                            <span className={`text-xs px-2 py-0.5 rounded font-mono ${sc.bg} ${sc.color}`}>
                              {flag.severity.toUpperCase()}
                            </span>
                            {flag.action_taken && (
                              <span className="text-xs px-2 py-0.5 rounded font-mono bg-coda-surface-hover/30 text-coda-text-muted">
                                → {flag.action_taken}
                              </span>
                            )}
                            <span className="text-[11px] text-coda-text-muted font-mono ml-auto tabular-nums shrink-0">
                              {new Date(flag.detected_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                            </span>
                          </div>
                          <p className="text-[14px] text-coda-text-muted leading-relaxed">
                            {flag.reasoning}
                          </p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Cadenza Decision Summary */}
              {cadenzaFlags.length > 0 && (
                <div className="mt-4 pt-4 border-t border-coda-border/20">
                  <div className="text-[11px] text-coda-text-muted mb-2">Current Decision</div>
                  <div className="flex items-center gap-3">
                    <span className={`text-[15px] font-mono font-bold ${
                      lockup.status === 'settled' ? 'text-emerald-400' :
                      lockup.status === 'reversed' ? 'text-red-400' :
                      lockup.status === 'escalated' ? 'text-coda-brand' :
                      'text-amber-400'
                    }`}>
                      {lockup.status === 'settled' ? 'CLEARED → SETTLED' :
                       lockup.status === 'reversed' ? 'REVERSED' :
                       lockup.status === 'escalated' ? 'ESCALATED — AWAITING HUMAN REVIEW' :
                       'MONITORING'}
                    </span>
                    {lockup.resolution && (
                      <span className="text-xs px-2.5 py-1 rounded bg-coda-surface-hover/20 text-coda-text-muted font-mono">
                        {lockup.resolution.replace(/_/g, ' ')}
                        {lockup.resolved_by ? ` by ${lockup.resolved_by.replace('operator:', '')}` : ''}
                      </span>
                    )}
                  </div>
                </div>
              )}

              {/* Escalation: AI Briefing + Approve/Reverse */}
              {isEscalated && (
                <div className="mt-5 pt-5 border-t border-coda-brand/20">
                  <div className="flex items-center gap-2 mb-4">
                    <Flag className="w-4 h-4 text-coda-brand" />
                    <span className="text-[12px] font-medium text-coda-brand font-mono">
                      Human Review Required
                    </span>
                  </div>

                  {/* Briefing */}
                  {!briefing && !briefingLoading && (
                    <button
                      onClick={fetchBriefing}
                      className="liquid-button mb-4 px-4 py-2 text-[13px] font-mono font-medium text-coda-brand"
                    >
                      <Brain className="w-4 h-4 inline mr-2" />
                      <span>Generate AI Briefing</span>
                    </button>
                  )}
                  {briefingLoading && (
                    <div className="flex items-center gap-2 mb-4 text-[13px] text-coda-text-muted font-mono">
                      <div className="w-4 h-4 border-2 border-coda-brand/30 border-t-coda-brand rounded-full animate-spin" />
                      Generating escalation briefing…
                    </div>
                  )}
                  {briefing && (
                    <div className="mb-5 p-4 rounded-lg bg-coda-brand/5 border border-coda-brand/15 space-y-3">
                      {briefing.executive_summary && (
                        <div>
                          <div className="text-[11px] text-coda-brand/60 mb-1">Executive Summary</div>
                          <p className="text-[14px] text-coda-text-secondary leading-relaxed">{briefing.executive_summary}</p>
                        </div>
                      )}
                      {briefing.risk_assessment && (
                        <div>
                          <div className="text-[11px] text-coda-brand/60 mb-1">Risk Assessment</div>
                          <p className="text-[13px] text-coda-text-muted leading-relaxed">{briefing.risk_assessment}</p>
                        </div>
                      )}
                      {briefing.recommended_action && (
                        <div className="flex items-center gap-3">
                          <span className="text-[11px] text-coda-brand/60">Recommendation:</span>
                          <span className={`text-[13px] font-mono font-bold ${
                            briefing.recommended_action === 'APPROVE_SETTLEMENT' ? 'text-emerald-400' :
                            briefing.recommended_action === 'REVERSE_TRANSACTION' ? 'text-red-400' :
                            'text-amber-400'
                          }`}>
                            {briefing.recommended_action.replace(/_/g, ' ')}
                          </span>
                          {briefing.confidence != null && (
                            <span className="text-xs text-coda-text-muted font-mono">
                              ({(briefing.confidence * 100).toFixed(0)}% confidence)
                            </span>
                          )}
                        </div>
                      )}
                      {briefing.reasoning && (
                        <div>
                          <div className="text-[11px] text-coda-brand/60 mb-1">Reasoning</div>
                          <p className="text-[13px] text-coda-text-muted leading-relaxed">{briefing.reasoning}</p>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Resolve buttons */}
                  {resolveError && (
                    <div className="mb-3 p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-[13px] text-red-400 font-mono">
                      {resolveError}
                    </div>
                  )}
                  <div className="flex items-center gap-3">
                    <button
                      onClick={() => handleResolve('approve')}
                      disabled={resolveLoading !== null}
                      className="liquid-button flex items-center px-5 py-2.5 text-[13px] font-mono font-semibold text-emerald-400 disabled:opacity-50"
                    >
                      {resolveLoading === 'approve' ? (
                        <div className="w-4 h-4 border-2 border-emerald-400/30 border-t-emerald-400 rounded-full animate-spin" />
                      ) : (
                        <UserCheck className="w-4 h-4" />
                      )}
                      <span>Approve Settlement</span>
                    </button>
                    <button
                      onClick={() => handleResolve('reverse')}
                      disabled={resolveLoading !== null}
                      className="liquid-button flex items-center px-5 py-2.5 text-[13px] font-mono font-semibold bg-red-500/15 text-red-400 disabled:opacity-50"
                    >
                      {resolveLoading === 'reverse' ? (
                        <div className="w-4 h-4 border-2 border-red-400/30 border-t-red-400 rounded-full animate-spin" />
                      ) : (
                        <RotateCcw className="w-4 h-4" />
                      )}
                      <span>Reverse Transaction</span>
                    </button>
                  </div>
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ============================================================
// Pipeline verdict computation
// ============================================================

function computePipelineVerdicts(messages: AgentMessage[], tx: Transaction): Record<string, { status: 'passed' | 'failed' | 'pending' | 'active'; detail?: string }> {
  const verdicts: Record<string, { status: 'passed' | 'failed' | 'pending' | 'active'; detail?: string }> = {
    dispatch: { status: 'pending' },
    compliance: { status: 'pending' },
    risk: { status: 'pending' },
    decision: { status: 'pending' },
    settlement: { status: 'pending' },
  };

  const hasPaymentRequest = messages.some(m => m.message_type === 'payment_request');
  const complianceMsg = messages.find(m => m.message_type === 'compliance_response');
  const riskMsg = messages.find(m => m.message_type === 'risk_alert');
  const decisionMsg = messages.find(m => m.message_type === 'payment_accept' || m.message_type === 'payment_reject' || (m.content as any)?.action === 'agent_decision');
  const settlementMsg = messages.find(m => m.message_type === 'settlement_confirm' || (m.content as any)?.action === 'settlement_started');

  if (hasPaymentRequest) {
    verdicts.dispatch = { status: 'passed', detail: 'Dispatched' };
  } else if (tx.status !== 'initiated') {
    verdicts.dispatch = { status: 'passed', detail: 'Dispatched' };
  }

  if (complianceMsg) {
    const content = complianceMsg.content as any;
    const passed = content?.result === 'PASSED';
    verdicts.compliance = {
      status: passed ? 'passed' : 'failed',
      detail: `${content?.checks_passed || '?'}/${content?.checks_total || '?'} ${passed ? 'Passed' : 'Failed'}`,
    };
  } else if (['compliance_check', 'risk_scored', 'executing', 'settled'].includes(tx.status)) {
    verdicts.compliance = { status: 'passed', detail: tx.compliance_passed ? 'Passed' : 'Failed' };
  } else if (tx.status === 'initiated' && hasPaymentRequest) {
    verdicts.compliance = { status: 'active' };
  }

  if (riskMsg) {
    const content = riskMsg.content as any;
    verdicts.risk = {
      status: 'passed',
      detail: `${(content?.risk_level as string || '').toUpperCase()} ${content?.composite_score}/100`,
    };
  } else if (['risk_scored', 'executing', 'settled'].includes(tx.status)) {
    verdicts.risk = { status: 'passed', detail: tx.risk_level ? `${tx.risk_level.toUpperCase()}` : 'Scored' };
  } else if (tx.status === 'compliance_check') {
    verdicts.risk = { status: 'active' };
  }

  if (decisionMsg) {
    const content = decisionMsg.content as any;
    const isAccept = decisionMsg.message_type === 'payment_accept' || content?.decision === 'accept';
    verdicts.decision = {
      status: isAccept ? 'passed' : 'failed',
      detail: isAccept ? 'Accepted' : 'Rejected',
    };
  } else if (['executing', 'settled'].includes(tx.status)) {
    verdicts.decision = { status: 'passed', detail: 'Accepted' };
  } else if (tx.status === 'rejected') {
    verdicts.decision = { status: 'failed', detail: 'Rejected' };
  } else if (tx.status === 'risk_scored') {
    verdicts.decision = { status: 'active' };
  }

  if (tx.status === 'settled') {
    verdicts.settlement = { status: 'passed', detail: 'Confirmed' };
  } else if (settlementMsg) {
    verdicts.settlement = { status: 'active', detail: 'Executing...' };
  } else if (tx.status === 'executing') {
    verdicts.settlement = { status: 'active', detail: 'Executing...' };
  } else if (tx.status === 'locked') {
    verdicts.settlement = { status: 'failed', detail: 'Locked' };
  }

  return verdicts;
}

// ============================================================
// Travel Rule Compliance Section
// ============================================================

function TravelRuleSection({ payload }: { payload: any }) {
  const [expanded, setExpanded] = useState(false);
  const isTransmitted = payload?.status === 'transmitted';

  return (
    <div className="liquid-glass-card squircle p-6 mb-4">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-3 p-0 text-base font-light text-coda-text hover:bg-black/[0.02] dark:hover:bg-white/[0.02] transition-colors cursor-pointer"
      >
        <UserCheck className="w-5 h-5" />
        <span>Travel Rule Compliance</span>
        <span className={`ml-2 px-2.5 py-1 rounded-full text-[11px] font-semibold ${
          isTransmitted
            ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border border-emerald-500/25 dark:border-emerald-500/20'
            : 'bg-coda-surface-hover/30 text-coda-text-muted border border-coda-border/20'
        }`}>
          {isTransmitted ? 'Transmitted' : 'Not Required'}
        </span>
        <span className="ml-auto">
          {expanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
        </span>
      </button>

      {!isTransmitted && payload?.reason && (
        <p className="text-[12px] text-coda-text-muted mt-3 font-mono">{payload.reason}</p>
      )}

      {isTransmitted && expanded && (
        <div className="mt-4 space-y-0 divide-y divide-coda-border/10">
          {[
            { label: 'Standard', value: `${payload.standard} v${payload.version}` },
            { label: 'Originator', value: `${payload.originator?.name} (${payload.originator?.bic})` },
            { label: 'Originator Account', value: payload.originator?.accountNumber, mono: true },
            { label: 'Beneficiary', value: `${payload.beneficiary?.name} (${payload.beneficiary?.bic})` },
            { label: 'Beneficiary Account', value: payload.beneficiary?.accountNumber, mono: true },
            { label: 'Amount', value: `$${Number(payload.amount).toLocaleString()} ${payload.currency}` },
            { label: 'Purpose', value: payload.purposeCode },
            { label: 'Transmitted At', value: payload.transmittedAt ? new Date(payload.transmittedAt).toLocaleString() : '—' },
          ].map(row => (
            <div key={row.label} className="flex items-center py-2.5 gap-4">
              <span className="text-[11px] text-coda-text-muted font-mono w-40 shrink-0">{row.label}</span>
              <span className={`text-[12px] text-coda-text-secondary truncate ${row.mono ? 'font-mono' : ''}`}>
                {row.value || '\u2014'}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}