import { useEffect, useState, useRef, useCallback } from 'react';
import type React from 'react';
import {
  Activity, Zap, Building2, DollarSign, ExternalLink, ChevronDown,
  ChevronUp, Loader2, Clock, Shield, AlertTriangle, Radio, Filter,
  RotateCcw, XCircle, AlertOctagon, Eye, Undo2, Infinity, Lock
} from 'lucide-react';
import { useNavigate } from 'react-router';
import { supabase, callServer } from '../supabaseClient';
import { useRealtimeSubscription } from '../hooks/useRealtimeSubscription';
import type {
  Transaction, AgentMessage,
} from '../types';
import {
  formatTokenAmount, truncateAddress, explorerUrl,
  TX_STATUS_CONFIG, RISK_LEVEL_CONFIG, MESSAGE_TYPE_CONFIG,
  isOrphanedTransaction, getOrphanAge
} from '../types';
import { useBanks } from '../contexts/BanksContext';
import { useSWRCache } from '../hooks/useSWRCache';
import { PageHeader } from './PageHeader';
import { PageTransition } from './PageTransition';
import { AnimatedValue } from './AnimatedValue';

// ============================================================
// Lockup info type (fetched from lockup_tokens table)
// ============================================================
interface LockupInfo {
  id: string;
  transaction_id: string;
  yb_token_amount: string;
  status: string;
  lockup_start: string;
  lockup_end: string | null;
  yield_accrued: string;
}

// ============================================================
// Cadenza lockup status badge config
// ============================================================
const CADENZA_STATUS_CONFIG: Record<string, { label: string; icon: string; bg: string; color: string }> = {
  soft_settled:        { label: 'Monitoring',  icon: '🔵', bg: 'bg-blue-500/15',    color: 'text-blue-400' },
  cadenza_monitoring:  { label: 'Monitoring',  icon: '🔵', bg: 'bg-blue-500/15',    color: 'text-blue-400' },
  cadenza_flagged:     { label: 'Flagged',     icon: '🟡', bg: 'bg-amber-500/15',   color: 'text-amber-400' },
  cadenza_escalated:   { label: 'Escalated',   icon: '🔴', bg: 'bg-coda-brand/15',  color: 'text-coda-brand' },
  cadenza_cleared:     { label: 'Cleared',     icon: '✅', bg: 'bg-emerald-500/15', color: 'text-emerald-400' },
  cadenza_reversed:    { label: 'Reversed',    icon: '↩️', bg: 'bg-red-500/15',     color: 'text-red-400' },
  hard_settled:        { label: 'Finalized',   icon: '✅', bg: 'bg-emerald-500/15', color: 'text-emerald-400' },
  operator_cleared:    { label: 'Op. Settled', icon: '⚡', bg: 'bg-emerald-500/15', color: 'text-emerald-400' },
  active:              { label: 'Active',      icon: '🔶', bg: 'bg-amber-500/15',   color: 'text-amber-400' },
};

// Active lockup statuses (pending balance + reversal button visible)
const ACTIVE_LOCKUP_STATUSES = ['soft_settled', 'cadenza_monitoring', 'cadenza_flagged', 'cadenza_escalated'];
const REVERSAL_ELIGIBLE_STATUSES = ['soft_settled', 'cadenza_monitoring'];

// ============================================================
// Fetchers
// ============================================================

async function fetchAllTransactions(): Promise<Transaction[]> {
  const { data, error } = await supabase
    .from('transactions')
    .select('*, sender_bank:banks!transactions_sender_bank_id_fkey(id,name,short_code), receiver_bank:banks!transactions_receiver_bank_id_fkey(id,name,short_code)')
    .order('created_at', { ascending: false })
    .limit(100);
  if (error) throw error;
  return data ?? [];
}

async function fetchRecentMessages(): Promise<AgentMessage[]> {
  const { data, error } = await supabase
    .from('agent_messages')
    .select('*, from_bank:banks!agent_messages_from_bank_id_fkey(short_code), to_bank:banks!agent_messages_to_bank_id_fkey(short_code)')
    .order('created_at', { ascending: false })
    .limit(50);
  if (error) throw error;
  return data ?? [];
}

async function fetchLockupMap(): Promise<Record<string, LockupInfo>> {
  const { data, error } = await supabase
    .from('lockup_tokens')
    .select('id, transaction_id, yb_token_amount, status, lockup_start, lockup_end, yield_accrued')
    .order('created_at', { ascending: false })
    .limit(200);
  if (error) {
    console.error('[TransactionMonitor] Failed to fetch lockup_tokens:', error);
    return {};
  }
  const map: Record<string, LockupInfo> = {};
  for (const row of data ?? []) {
    // Keep the first (most recent) lockup per transaction
    if (!map[row.transaction_id]) {
      map[row.transaction_id] = row as LockupInfo;
    }
  }
  return map;
}

// ============================================================
// Main Component
// ============================================================

export function TransactionMonitor() {
  const { activeBanks: banks, cacheVersion } = useBanks();

  const {
    data: txData,
    invalidate: invalidateTxs,
  } = useSWRCache<Transaction[]>({
    key: 'monitor-transactions',
    fetcher: fetchAllTransactions,
    deps: [cacheVersion],
    ttl: 2 * 60 * 1000,
  });

  const {
    data: msgData,
    invalidate: invalidateMsgs,
  } = useSWRCache<AgentMessage[]>({
    key: 'monitor-messages',
    fetcher: fetchRecentMessages,
    deps: [cacheVersion],
    ttl: 2 * 60 * 1000,
  });

  const {
    data: lockupMap,
    invalidate: invalidateLockups,
  } = useSWRCache<Record<string, LockupInfo>>({
    key: 'monitor-lockups',
    fetcher: fetchLockupMap,
    deps: [cacheVersion],
    ttl: 2 * 60 * 1000,
  });

  const transactions = txData ?? [];
  const [agentMessages, setAgentMessages] = useState<AgentMessage[]>([]);

  // Sync SWR message data into local state (so Realtime INSERTs can prepend)
  useEffect(() => {
    if (msgData) setAgentMessages(msgData);
  }, [msgData]);

  const [expandedTx, setExpandedTx] = useState<string | null>(null);
  const [messageFilter, setMessageFilter] = useState<string>('all');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [actionLoading, setActionLoading] = useState<Record<string, string>>({});

  // Stable refs for Realtime callbacks
  const invalidateTxsRef = useRef(invalidateTxs);
  invalidateTxsRef.current = invalidateTxs;
  const invalidateLockupsRef = useRef(invalidateLockups);
  invalidateLockupsRef.current = invalidateLockups;

  // Force re-render every 30s to update orphan ages
  const [, setTick] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setTick(t => t + 1), 30_000);
    return () => clearInterval(timer);
  }, []);

  // ── Realtime subscriptions ─────────────────────────────────
  const reloadTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useRealtimeSubscription({
    channelName: 'tx-monitor',
    subscriptions: [
      {
        table: 'transactions',
        event: '*',
        callback: () => {
          if (reloadTimer.current) clearTimeout(reloadTimer.current);
          reloadTimer.current = setTimeout(() => { invalidateTxsRef.current(); }, 2000);
        },
      },
    ],
    onPoll: () => { invalidateTxsRef.current(); },
  });

  useRealtimeSubscription({
    channelName: 'msg-monitor',
    subscriptions: [
      {
        table: 'agent_messages',
        event: 'INSERT',
        callback: (payload) => {
          setAgentMessages((prev) => [payload.new as AgentMessage, ...prev].slice(0, 50));
        },
      },
    ],
    onPoll: () => { invalidateTxsRef.current(); },
  });

  // Lockup tokens — live updates for Cadenza badges
  useRealtimeSubscription({
    channelName: 'lockup-monitor',
    subscriptions: [
      {
        table: 'lockup_tokens',
        event: '*',
        callback: () => {
          if (reloadTimer.current) clearTimeout(reloadTimer.current);
          reloadTimer.current = setTimeout(() => {
            invalidateTxsRef.current();
            invalidateLockupsRef.current();
          }, 1500);
        },
      },
    ],
    onPoll: () => { invalidateTxsRef.current(); invalidateLockupsRef.current(); },
  });

  // ── Orphan actions ──────────────────────────────────────────

  async function handleRetryTransaction(txId: string) {
    setActionLoading(prev => ({ ...prev, [txId]: 'retrying' }));
    try {
      const result = await callServer<{ status: string; orchestrator_result?: unknown }>('/retry-transaction', {
        transaction_id: txId,
      });
      console.log(`[TransactionMonitor] Retry result for ${txId.slice(0, 8)}:`, result);
      setTimeout(() => invalidateTxs(), 1000);
    } catch (err) {
      console.error(`[TransactionMonitor] Retry failed for ${txId.slice(0, 8)}:`, err);
    } finally {
      setActionLoading(prev => {
        const next = { ...prev };
        delete next[txId];
        return next;
      });
    }
  }

  async function handleExpireTransaction(txId: string) {
    setActionLoading(prev => ({ ...prev, [txId]: 'expiring' }));
    try {
      const result = await callServer<{ status: string }>('/expire-transaction', {
        transaction_id: txId,
      });
      console.log(`[TransactionMonitor] Expire result for ${txId.slice(0, 8)}:`, result);
      setTimeout(() => invalidateTxs(), 1000);
    } catch (err) {
      console.error(`[TransactionMonitor] Expire failed for ${txId.slice(0, 8)}:`, err);
    } finally {
      setActionLoading(prev => {
        const next = { ...prev };
        delete next[txId];
        return next;
      });
    }
  }

  // ── Lockup reversal (Cadenza user_reversal) ────────────────
  async function handleRequestReversal(txId: string, lockupId: string) {
    setActionLoading(prev => ({ ...prev, [txId]: 'reversing' }));
    try {
      const result = await callServer<{ status?: string; error?: string }>('/cadenza-monitor', {
        action: 'user_reversal',
        lockup_id: lockupId,
        reason: 'Operator-initiated reversal from Transaction Monitor',
      });
      console.log(`[TransactionMonitor] Reversal result for lockup ${lockupId.slice(0, 8)}:`, result);
      setTimeout(() => {
        invalidateTxs();
        invalidateLockups();
      }, 1500);
    } catch (err) {
      console.error(`[TransactionMonitor] Reversal failed for lockup ${lockupId.slice(0, 8)}:`, err);
    } finally {
      setActionLoading(prev => {
        const next = { ...prev };
        delete next[txId];
        return next;
      });
    }
  }

  // Summary stats
  const totalVolume = transactions
    .filter((t) => t.status === 'settled')
    .reduce((sum, t) => sum + (t.amount_display || 0), 0);

  const activeCount = transactions.filter(
    (t) => ['initiated', 'compliance_check', 'risk_scored', 'executing'].includes(t.status)
  ).length;

  const orphanCount = transactions.filter(isOrphanedTransaction).length;

  const lockedCount = transactions.filter((t) => t.status === 'locked').length;

  const filteredMessages = messageFilter === 'all'
    ? agentMessages
    : agentMessages.filter((m) => m.transaction_id === messageFilter);

  // Apply status filter to transactions
  const displayTransactions = statusFilter === 'all'
    ? transactions
    : statusFilter === 'locked'
    ? transactions.filter((t) => t.status === 'locked')
    : statusFilter === 'settled'
    ? transactions.filter((t) => t.status === 'settled')
    : statusFilter === 'reversed'
    ? transactions.filter((t) => t.status === 'reversed')
    : statusFilter === 'active'
    ? transactions.filter((t) => ['initiated', 'compliance_check', 'risk_scored', 'executing'].includes(t.status))
    : statusFilter === 'orphaned'
    ? transactions.filter(isOrphanedTransaction)
    : transactions;

  return (
    <div className="space-y-4">
      <PageHeader
        icon={Activity}
        title="Transaction Monitor"
        subtitle="Network-wide wholesale settlement tracking"
      >
        <button
          onClick={() => { invalidateTxs(); invalidateMsgs(); }}
          className="flex items-center gap-1.5 px-3 py-1.5 dashboard-button text-xs text-coda-text-secondary hover:text-coda-text"
        >
          <Activity className="w-3 h-3" />
          Refresh
        </button>
      </PageHeader>

      {/* Summary Stats */}
      <div className="grid grid-cols-6 gap-4">
        <StatCard
          icon={Zap}
          label="Total Transactions"
          value={transactions.length}
        />
        <StatCard
          icon={DollarSign}
          label="Settled Volume"
          value={totalVolume}
          format={(v) => `$${v.toLocaleString()}`}
        />
        <StatCard
          icon={Activity}
          label="Active Settlements"
          value={activeCount}
          highlight={activeCount > 0}
        />
        <StatCard
          icon={Lock}
          label="Locked"
          value={lockedCount}
          highlight={lockedCount > 0}
        />
        <StatCard
          icon={AlertOctagon}
          label="Orphaned"
          value={orphanCount}
          highlight={orphanCount > 0}
          danger={orphanCount > 0}
        />
        <StatCard
          icon={Building2}
          label="Network Banks"
          value={banks.length}
        />
      </div>

      <PageTransition className="space-y-4">
      {/* Orphan Alert Banner */}
      {orphanCount > 0 && (
        <div className="p-3 rounded-lg border border-amber-700/50 bg-amber-500/10 dark:bg-amber-950/20 flex items-center gap-3">
          <AlertOctagon className="w-4 h-4 text-amber-500 dark:text-amber-400 shrink-0" />
          <div className="flex-1">
            <span className="text-xs text-amber-700 dark:text-amber-300 font-bold">
              {orphanCount} orphaned transaction{orphanCount !== 1 ? 's' : ''} detected
            </span>
            <span className="text-xs text-amber-600/80 dark:text-amber-500/80 ml-2">
              Stuck in non-terminal state for &gt;2 minutes. Retry to re-trigger orchestration or expire to clear.
            </span>
          </div>
        </div>
      )}

      {/* Transactions Table */}
      <div className="dashboard-card overflow-hidden">
        <div className="px-4 py-3 border-b border-white/10 dark:border-white/10 flex items-center justify-between">
          <h2 className="text-sm font-bold dashboard-text">Settlements</h2>
          <div className="flex items-center gap-2">
            <Filter className="w-3 h-3 text-muted-foreground" />
            <div className="flex items-center gap-1">
              {([
                { key: 'all', label: 'All', count: transactions.length },
                { key: 'locked', label: 'Locked', count: lockedCount },
                { key: 'active', label: 'Active', count: activeCount },
                { key: 'settled', label: 'Settled', count: transactions.filter(t => t.status === 'settled').length },
                { key: 'reversed', label: 'Reversed', count: transactions.filter(t => t.status === 'reversed').length },
              ] as const).map(f => (
                <button
                  key={f.key}
                  onClick={() => setStatusFilter(f.key)}
                  className={`px-2 py-0.5 rounded text-[10px] font-mono font-semibold transition-colors ${
                    statusFilter === f.key
                      ? f.key === 'locked'
                        ? 'bg-amber-500/20 text-amber-400'
                        : 'bg-coda-brand/20 text-coda-brand'
                      : 'text-coda-text-muted hover:text-coda-text-secondary'
                  }`}
                >
                  {f.label}{f.count > 0 && statusFilter !== f.key ? ` (${f.count})` : ''}
                </button>
              ))}
            </div>
            <span className="text-xs dashboard-text-muted ml-1">
              {statusFilter !== 'all' ? `${displayTransactions.length} of ${transactions.length}` : `${transactions.length} total`}
            </span>
          </div>
        </div>

        <div className="divide-y divide-white/5">
          {transactions.length === 0 && (
            <div className="p-8 text-center text-sm text-coda-text-muted">
              No transactions yet
            </div>
          )}
          {displayTransactions.map((tx) => (
            <TransactionRow
              key={tx.id}
              tx={tx}
              lockup={(lockupMap ?? {})[tx.id] ?? null}
              expanded={expandedTx === tx.id}
              onToggle={() => setExpandedTx(expandedTx === tx.id ? null : tx.id)}
              actionState={actionLoading[tx.id]}
              onRetry={() => handleRetryTransaction(tx.id)}
              onExpire={() => handleExpireTransaction(tx.id)}
              onRequestReversal={(lockupId) => handleRequestReversal(tx.id, lockupId)}
            />
          ))}
        </div>
      </div>

      {/* Agent Message Feed */}
      <div className="dashboard-card overflow-hidden">
        <div className="px-4 py-3 border-b border-white/10 dark:border-white/10 flex items-center justify-between">
          <h2 className="text-sm font-bold dashboard-text flex items-center gap-2">
            <Radio className="w-3.5 h-3.5 text-muted-foreground" />
            Agent Messages
          </h2>
          <div className="flex items-center gap-2">
            <Filter className="w-3 h-3 text-muted-foreground" />
            <select
              value={messageFilter}
              onChange={(e) => setMessageFilter(e.target.value)}
              className="text-xs bg-transparent border-none text-coda-text-muted focus:outline-none cursor-pointer"
            >
              <option value="all">All Messages</option>
              {transactions.map((tx) => {
                const sCode = (tx as any).sender_bank?.short_code || '???';
                const rCode = (tx as any).receiver_bank?.short_code || '???';
                return (
                  <option key={tx.id} value={tx.id}>
                    {sCode} → {rCode}
                  </option>
                );
              })}
            </select>
          </div>
        </div>

        <div className="max-h-80 overflow-y-auto divide-y divide-white/5 scrollbar-thin">
          {filteredMessages.length === 0 && (
            <div className="p-6 text-center text-xs text-coda-text-muted">
              No messages yet
            </div>
          )}
          {filteredMessages.map((msg) => {
            const config = MESSAGE_TYPE_CONFIG[msg.message_type] || MESSAGE_TYPE_CONFIG.system;
            const fromCode = (msg as any).from_bank?.short_code || '???';
            const toCode = (msg as any).to_bank?.short_code || '???';

            return (
              <div key={msg.id} className="px-4 py-2.5 flex items-center gap-3 text-xs hover:bg-white/[0.02] transition-colors">
                <span className="text-coda-text-muted font-mono text-[10px] w-14 shrink-0">
                  {new Date(msg.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                </span>
                <span className="font-mono text-coda-text-secondary text-[11px] w-20 shrink-0">
                  {fromCode} &rarr; {toCode}
                </span>
                <span className={`shrink-0 px-1.5 py-0.5 rounded text-[10px] ${config.color} bg-coda-surface-hover`}>
                  {config.label}
                </span>
                <span className="text-coda-text-secondary text-[11px] truncate">
                  {msg.natural_language || JSON.stringify(msg.content).slice(0, 100)}
                </span>
              </div>
            );
          })}
        </div>
      </div>
      </PageTransition>
    </div>
  );
}

// ============================================================
// StatCard — with AnimatedValue + pulse overlay
// ============================================================

function StatCard({ icon: Icon, label, value, highlight, danger, format }: {
  icon: React.ElementType; label: string; value: number; highlight?: boolean; danger?: boolean; format?: (v: number) => string;
}) {
  const iconColor = danger ? 'text-amber-500 dark:text-amber-400' : highlight ? 'text-coda-brand' : 'text-muted-foreground';
  const valueColor = danger ? 'text-amber-500 dark:text-amber-400' : highlight ? 'text-coda-brand' : 'dashboard-text';

  const [pulseKey, setPulseKey] = useState(0);
  const triggerPulse = useCallback(() => {
    setPulseKey((k) => k + 1);
  }, []);

  return (
    <div className={`dashboard-card-nested p-4 relative overflow-hidden ${danger ? 'border-amber-500/20' : ''}`}>
      {pulseKey > 0 && (
        <div
          key={pulseKey}
          className="absolute inset-0 pointer-events-none animate-stat-pulse"
        />
      )}
      <div className="flex items-center gap-2 mb-2">
        <Icon className={`w-3.5 h-3.5 ${iconColor}`} />
        <span className="text-xs dashboard-text-muted">{label}</span>
      </div>
      <div className={`text-xl font-bold ${valueColor}`}>
        <AnimatedValue
          value={value}
          format={format}
          onLiveChange={triggerPulse}
        />
      </div>
    </div>
  );
}

// ============================================================
// TransactionRow
// ============================================================

function TransactionRow({ tx, lockup, expanded, onToggle, actionState, onRetry, onExpire, onRequestReversal }: {
  tx: Transaction; lockup: LockupInfo | null; expanded: boolean; onToggle: () => void;
  actionState?: string; onRetry: () => void; onExpire: () => void; onRequestReversal: (lockupId: string) => void;
}) {
  const navigate = useNavigate();
  const [riskScore, setRiskScore] = useState<any>(null);
  const [complianceLogs, setComplianceLogs] = useState<any[]>([]);
  const [txMessages, setTxMessages] = useState<AgentMessage[]>([]);
  const [detailLoaded, setDetailLoaded] = useState(false);

  const statusConfig = TX_STATUS_CONFIG[tx.status] || TX_STATUS_CONFIG.initiated;
  const riskConfig = tx.risk_level ? RISK_LEVEL_CONFIG[tx.risk_level] : null;
  const senderCode = (tx as any).sender_bank?.short_code || '???';
  const receiverCode = (tx as any).receiver_bank?.short_code || '???';
  const orphaned = isOrphanedTransaction(tx);
  const isExpiredRejection = tx.status === 'rejected' && (tx as any).risk_reasoning?.startsWith('Expired:');

  // Cadenza lockup display
  const lockupStatus = tx.lockup_status;
  const cadenzaConfig = lockupStatus ? CADENZA_STATUS_CONFIG[lockupStatus] : null;
  const isActiveLockup = lockupStatus ? ACTIVE_LOCKUP_STATUSES.includes(lockupStatus) : false;
  const isReversalEligible = lockupStatus ? REVERSAL_ELIGIBLE_STATUSES.includes(lockupStatus) : false;
  const isEscalated = lockupStatus === 'cadenza_escalated';
  const [showReversalConfirm, setShowReversalConfirm] = useState(false);

  useEffect(() => {
    if (expanded && !detailLoaded) {
      loadDetails();
    }
  }, [expanded]);

  async function loadDetails() {
    try {
      const [riskRes, compRes, msgRes] = await Promise.all([
        supabase.from('risk_scores').select('*').eq('transaction_id', tx.id).maybeSingle(),
        supabase.from('compliance_logs').select('*').eq('transaction_id', tx.id).order('created_at'),
        supabase
          .from('agent_messages')
          .select('*, from_bank:banks!agent_messages_from_bank_id_fkey(short_code), to_bank:banks!agent_messages_to_bank_id_fkey(short_code)')
          .eq('transaction_id', tx.id)
          .order('created_at'),
      ]);

      if (riskRes.data) setRiskScore(riskRes.data);
      if (compRes.data) setComplianceLogs(compRes.data);
      if (msgRes.data) setTxMessages(msgRes.data);
      setDetailLoaded(true);
    } catch (err) {
      console.error('Failed to load tx details:', err);
    }
  }

  return (
    <div className={`${orphaned ? 'bg-amber-500/[0.03]' : ''}`}>
      {/* Main Row */}
      <div
        className="px-4 py-3 flex items-center gap-3 cursor-pointer hover:bg-white/[0.02] transition-colors"
        onClick={onToggle}
      >
        {expanded ? (
          <ChevronUp className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
        ) : (
          <ChevronDown className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
        )}

        {/* Sender → Receiver */}
        <span className="font-mono text-xs text-coda-text w-24 shrink-0">
          {senderCode} &rarr; {receiverCode}
        </span>

        {/* Amount */}
        <span className="font-mono text-xs text-coda-text w-24 shrink-0 text-right" style={{ fontVariantNumeric: 'tabular-nums' }}>
          {tx.amount_display != null ? `$${tx.amount_display.toLocaleString()}` : formatTokenAmount(tx.amount)}
        </span>

        {/* Status */}
        <span className={`shrink-0 px-1.5 py-0.5 rounded text-[10px] font-semibold ${
          orphaned
            ? 'bg-amber-500/20 text-amber-500 dark:text-amber-400'
            : isExpiredRejection
            ? 'bg-coda-surface-hover text-coda-text-muted'
            : `${statusConfig.bg} ${statusConfig.color}`
        }`}>
          {orphaned ? `Orphaned (${getOrphanAge(tx)})` : isExpiredRejection ? 'Expired' : statusConfig.label}
        </span>

        {/* Risk Level */}
        {riskConfig && (
          <span className={`shrink-0 px-1.5 py-0.5 rounded text-[10px] ${riskConfig.bg} ${riskConfig.color}`}>
            {riskConfig.label}
          </span>
        )}

        {/* Orphan indicator */}
        {orphaned && (
          <AlertOctagon className="w-3 h-3 text-amber-500 dark:text-amber-400 animate-pulse shrink-0" />
        )}

        {/* Cadenza Status Badge (lockup transactions only) */}
        {cadenzaConfig && (
          <span
            className={`shrink-0 px-1.5 py-0.5 rounded text-[10px] font-semibold flex items-center gap-1 ${cadenzaConfig.bg} ${cadenzaConfig.color}`}
            title={`Cadenza: ${cadenzaConfig.label}${isActiveLockup ? ' — Soft settled, pending hard finality' : ''}`}
          >
            <Eye className="w-2.5 h-2.5" />
            {cadenzaConfig.label}
          </span>
        )}

        {/* Pending Balance (active lockup transactions) */}
        {isActiveLockup && tx.amount_display != null && (
          <span
            className={`shrink-0 flex items-center gap-1 text-[10px] font-mono ${
              isEscalated ? 'text-coda-brand' : 'text-amber-400'
            }`}
            title="Soft settled — pending hard finality. BNY-USTB held in custodian."
          >
            {isEscalated ? <Infinity className="w-2.5 h-2.5" /> : <Clock className="w-2.5 h-2.5" />}
            ${tx.amount_display.toLocaleString()}
          </span>
        )}

        {/* Spacer */}
        <div className="flex-1" />

        {/* Timestamp */}
        <span className="text-[10px] text-coda-text-muted font-mono shrink-0">
          {new Date(tx.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
        </span>

        {/* Explorer link */}
        {tx.solana_tx_signature && (
          <a
            href={explorerUrl(tx.solana_tx_signature)}
            target="_blank"
            rel="noopener noreferrer"
            className="text-blue-500 dark:text-blue-400 hover:text-blue-400 dark:hover:text-blue-300 shrink-0"
            onClick={(e) => e.stopPropagation()}
          >
            <ExternalLink className="w-3 h-3" />
          </a>
        )}
      </div>

      {/* Expanded Detail */}
      {expanded && (
        <div className="px-4 pb-4 space-y-3">
          {/* Action Buttons (orphaned) */}
          {orphaned && (
            <div className="flex items-center gap-2">
              <button
                onClick={(e) => { e.stopPropagation(); onRetry(); }}
                disabled={!!actionState}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-coda-brand/20 text-coda-brand hover:bg-coda-brand/30 disabled:opacity-50 transition-colors"
              >
                {actionState === 'retrying' ? <Loader2 className="w-3 h-3 animate-spin" /> : <RotateCcw className="w-3 h-3" />}
                Retry
              </button>
              <button
                onClick={(e) => { e.stopPropagation(); onExpire(); }}
                disabled={!!actionState}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-red-600/20 text-red-500 dark:text-red-400 hover:bg-red-600/30 disabled:opacity-50 transition-colors"
              >
                {actionState === 'expiring' ? <Loader2 className="w-3 h-3 animate-spin" /> : <XCircle className="w-3 h-3" />}
                Expire
              </button>
            </div>
          )}

          {/* Detail link */}
          <button
            onClick={() => navigate(`/transactions/${tx.id}`)}
            className="flex items-center gap-1.5 text-xs text-blue-500 dark:text-blue-400 hover:underline"
          >
            Open Full Detail
            <ExternalLink className="w-3 h-3" />
          </button>

          {/* Request Reversal — only for active lockups eligible for user-initiated reversal */}
          {isReversalEligible && lockup && (
            <div className="flex items-center gap-2">
              {!showReversalConfirm ? (
                <button
                  onClick={(e) => { e.stopPropagation(); setShowReversalConfirm(true); }}
                  disabled={!!actionState}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-red-600/15 text-red-400 hover:bg-red-600/25 border border-red-500/20 disabled:opacity-50 transition-colors"
                >
                  <Undo2 className="w-3 h-3" />
                  Request Reversal
                </button>
              ) : (
                <div className="flex items-center gap-2 p-2 rounded-lg border border-red-500/30 bg-red-500/5">
                  <AlertTriangle className="w-3.5 h-3.5 text-red-400 shrink-0" />
                  <span className="text-[11px] text-red-300">
                    Request reversal of this transaction? Cadenza will process immediately.
                  </span>
                  <button
                    onClick={(e) => { e.stopPropagation(); onRequestReversal(lockup.id); setShowReversalConfirm(false); }}
                    disabled={!!actionState}
                    className="flex items-center gap-1 px-2 py-1 rounded text-[10px] font-bold bg-red-600/30 text-red-300 hover:bg-red-600/50 disabled:opacity-50 transition-colors shrink-0"
                  >
                    {actionState === 'reversing' ? <Loader2 className="w-3 h-3 animate-spin" /> : <Undo2 className="w-3 h-3" />}
                    Confirm
                  </button>
                  <button
                    onClick={(e) => { e.stopPropagation(); setShowReversalConfirm(false); }}
                    className="flex items-center gap-1 px-2 py-1 rounded text-[10px] text-coda-text-muted hover:text-coda-text transition-colors shrink-0"
                  >
                    Cancel
                  </button>
                </div>
              )}
            </div>
          )}

          {!detailLoaded ? (
            <div className="flex items-center gap-2 py-2">
              <Loader2 className="w-3 h-3 animate-spin text-coda-text-muted" />
              <span className="text-xs text-coda-text-muted">Loading details…</span>
            </div>
          ) : (
            <>
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
              {/* Risk Score */}
              <div className="dashboard-card-subtle p-3">
                <div className="flex items-center gap-1.5 mb-2">
                  <Shield className="w-3 h-3 text-coda-text-muted" />
                  <span className="text-[10px] text-coda-text-muted font-semibold">Risk Assessment</span>
                </div>
                {riskScore ? (
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-mono font-semibold text-coda-text">{riskScore.composite_score ?? riskScore.score ?? '—'}/100</span>
                      {riskScore.risk_level && (
                        <span className={`px-1.5 py-0.5 rounded text-[10px] ${RISK_LEVEL_CONFIG[riskScore.risk_level as keyof typeof RISK_LEVEL_CONFIG]?.bg || ''} ${RISK_LEVEL_CONFIG[riskScore.risk_level as keyof typeof RISK_LEVEL_CONFIG]?.color || ''}`}>
                          {riskScore.risk_level}
                        </span>
                      )}
                    </div>
                    {riskScore.reasoning && (
                      <p className="text-[10px] text-coda-text-muted leading-relaxed">{riskScore.reasoning}</p>
                    )}
                  </div>
                ) : (
                  <span className="text-[10px] text-coda-text-muted">No risk data</span>
                )}
              </div>

              {/* Compliance Logs */}
              <div className="dashboard-card-subtle p-3">
                <div className="flex items-center gap-1.5 mb-2">
                  <AlertTriangle className="w-3 h-3 text-coda-text-muted" />
                  <span className="text-[10px] text-coda-text-muted font-semibold">Compliance Checks</span>
                </div>
                {complianceLogs.length > 0 ? (
                  <div className="space-y-1">
                    {complianceLogs.map((log: any, i: number) => (
                      <div key={log.id || i} className="flex items-center gap-2 text-[10px]">
                        <span className={`px-1 py-0.5 rounded ${log.check_result ? 'bg-emerald-500/20 text-emerald-400' : 'bg-red-500/20 text-red-400'}`}>
                          {log.check_result ? 'pass' : 'fail'}
                        </span>
                        <span className="text-coda-text-muted truncate">{(log.check_type || '').replace(/_/g, ' ')}{log.details?.detail ? ` — ${log.details.detail}` : ''}</span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <span className="text-[10px] text-coda-text-muted">No compliance logs</span>
                )}
              </div>

              {/* Messages */}
              <div className="dashboard-card-subtle p-3">
                <div className="flex items-center gap-1.5 mb-2">
                  <Radio className="w-3 h-3 text-coda-text-muted" />
                  <span className="text-[10px] text-coda-text-muted font-semibold">Agent Messages ({txMessages.length})</span>
                </div>
                {txMessages.length > 0 ? (
                  <div className="space-y-1 max-h-32 overflow-y-auto scrollbar-thin">
                    {txMessages.map((msg) => {
                      const config = MESSAGE_TYPE_CONFIG[msg.message_type] || MESSAGE_TYPE_CONFIG.system;
                      const fromCode = (msg as any).from_bank?.short_code || '???';
                      const toCode = (msg as any).to_bank?.short_code || '???';
                      return (
                        <div key={msg.id} className="flex items-center gap-1.5 text-[10px]">
                          <span className="font-mono text-coda-text-secondary">{fromCode}&rarr;{toCode}</span>
                          <span className={`px-1 py-0.5 rounded ${config.color} bg-coda-surface-hover`}>{config.label}</span>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <span className="text-[10px] text-coda-text-muted">No messages</span>
                )}
              </div>
            </div>

            {/* Lockup Detail — only for lockup transactions */}
            {lockup && (
              <div className="dashboard-card-subtle p-3 mt-3">
                <div className="flex items-center gap-1.5 mb-2">
                  <Eye className="w-3 h-3 text-coda-text-muted" />
                  <span className="text-[10px] text-coda-text-muted font-semibold">Cadenza Lockup</span>
                  {cadenzaConfig && (
                    <span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${cadenzaConfig.bg} ${cadenzaConfig.color}`}>
                      {cadenzaConfig.label}
                    </span>
                  )}
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[10px]">
                  <div>
                    <span className="text-coda-text-muted block">BNY-USTB Held</span>
                    <span className="text-coda-text font-mono font-semibold">
                      {formatTokenAmount(lockup.yb_token_amount)}
                    </span>
                  </div>
                  <div>
                    <span className="text-coda-text-muted block">Lockup Start</span>
                    <span className="text-coda-text font-mono">
                      {new Date(lockup.lockup_start).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </div>
                  <div>
                    <span className="text-coda-text-muted block">Lockup End</span>
                    <span className={`font-mono ${isEscalated ? 'text-coda-brand' : lockup.lockup_end ? 'text-coda-text' : 'text-coda-text-muted'}`}>
                      {isEscalated ? '∞ (escalated)' : lockup.lockup_end
                        ? new Date(lockup.lockup_end).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
                        : 'Pending'}
                    </span>
                  </div>
                  <div>
                    <span className="text-coda-text-muted block">Yield Accrued</span>
                    <span className="text-emerald-400 font-mono font-semibold">
                      {formatTokenAmount(lockup.yield_accrued)}
                    </span>
                  </div>
                </div>
                {/* Task 117: Lockup duration — requested vs effective */}
                {tx.lockup_duration_minutes != null && (
                  <div className="flex items-center gap-2 mt-2 text-[10px] font-mono">
                    <span className="text-blue-400">Requested: {tx.lockup_duration_minutes === 0 ? '0 (instant)' : `${tx.lockup_duration_minutes}min`}</span>
                    <span className="text-coda-text-muted">|</span>
                    <span className="text-amber-400">
                      Effective: {isEscalated ? '∞' : lockup.lockup_end
                        ? `${Math.round((new Date(lockup.lockup_end).getTime() - new Date(lockup.lockup_start).getTime()) / 60_000)}min`
                        : '—'}
                    </span>
                    {tx.lockup_duration_minutes > 0 && lockup.lockup_end &&
                      Math.round((new Date(lockup.lockup_end).getTime() - new Date(lockup.lockup_start).getTime()) / 60_000) > tx.lockup_duration_minutes && (
                      <span className="text-amber-400/60">(risk extended)</span>
                    )}
                  </div>
                )}
              </div>
            )}
            </>
          )}
        </div>
      )}
    </div>
  );
}