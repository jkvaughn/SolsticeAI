import { useEffect, useState, useRef } from 'react';
import {
  Activity, ExternalLink, AlertOctagon, Eye, Clock, Infinity,
} from 'lucide-react';
import { useNavigate } from 'react-router';
import { supabase } from '../supabaseClient';
import { useRealtimeSubscription } from '../hooks/useRealtimeSubscription';
import type {
  Transaction, AgentMessage,
} from '../types';
import {
  formatTokenAmount, explorerUrl,
  TX_STATUS_CONFIG, RISK_LEVEL_CONFIG, MESSAGE_TYPE_CONFIG,
  isOrphanedTransaction, getOrphanAge
} from '../types';
import { useBanks } from '../contexts/BanksContext';
import { useSWRCache } from '../hooks/useSWRCache';
import { PageShell } from './PageShell';
import type { PageStat, PageTab } from './PageShell';
import { WidgetShell } from './dashboard/WidgetShell';
import {
  lightning as lightningAnim,
  dollarReceive as dollarAnim,
  entity as bankAnim,
  checkmark as checkAnim,
} from './icons/lottie';

// ============================================================
// Cadenza lockup status badge config
// ============================================================
const CADENZA_STATUS_CONFIG: Record<string, { label: string; bg: string; color: string }> = {
  soft_settled:        { label: 'Monitoring',  bg: 'bg-blue-500/15',    color: 'text-blue-400' },
  cadenza_monitoring:  { label: 'Monitoring',  bg: 'bg-blue-500/15',    color: 'text-blue-400' },
  cadenza_flagged:     { label: 'Flagged',     bg: 'bg-amber-500/15',   color: 'text-amber-400' },
  cadenza_escalated:   { label: 'Escalated',   bg: 'bg-coda-brand/15',  color: 'text-coda-brand' },
  cadenza_cleared:     { label: 'Cleared',     bg: 'bg-emerald-500/15', color: 'text-emerald-400' },
  cadenza_reversed:    { label: 'Reversed',    bg: 'bg-red-500/15',     color: 'text-red-400' },
  hard_settled:        { label: 'Finalized',   bg: 'bg-emerald-500/15', color: 'text-emerald-400' },
  operator_cleared:    { label: 'Op. Settled', bg: 'bg-emerald-500/15', color: 'text-emerald-400' },
  active:              { label: 'Active',      bg: 'bg-amber-500/15',   color: 'text-amber-400' },
};

const ACTIVE_LOCKUP_STATUSES = ['soft_settled', 'cadenza_monitoring', 'cadenza_flagged', 'cadenza_escalated'];

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

// ============================================================
// Main Component
// ============================================================

export function TransactionMonitor() {
  const navigate = useNavigate();
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

  const transactions = txData ?? [];
  const [agentMessages, setAgentMessages] = useState<AgentMessage[]>([]);

  // Sync SWR message data into local state (so Realtime INSERTs can prepend)
  useEffect(() => {
    if (msgData) setAgentMessages(msgData);
  }, [msgData]);

  const [messageFilter, setMessageFilter] = useState<string>('all');
  const [statusFilter, setStatusFilter] = useState<string>('all');

  // Stable refs for Realtime callbacks
  const invalidateTxsRef = useRef(invalidateTxs);
  invalidateTxsRef.current = invalidateTxs;

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

  // ── Derived counts ──────────────────────────────────────────

  const totalVolume = transactions
    .filter((t) => t.status === 'settled')
    .reduce((sum, t) => sum + (t.amount_display || 0), 0);

  const activeCount = transactions.filter(
    (t) => ['initiated', 'compliance_check', 'risk_scored', 'executing'].includes(t.status)
  ).length;

  const orphanCount = transactions.filter(isOrphanedTransaction).length;
  const lockedCount = transactions.filter((t) => t.status === 'locked').length;
  const settledCount = transactions.filter(t => t.status === 'settled').length;
  const reversedCount = transactions.filter(t => t.status === 'reversed').length;

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

  // -- PageShell stats --
  const pageStats: PageStat[] = [
    {
      lottieData: lightningAnim,
      value: transactions.length,
      label: 'Total Transactions',
    },
    {
      lottieData: dollarAnim,
      value: `$${totalVolume.toLocaleString()}`,
      label: 'Settled Volume',
    },
    {
      lottieData: checkAnim,
      value: settledCount,
      label: 'Settled',
    },
    {
      lottieData: bankAnim,
      value: banks.length,
      label: 'Network Banks',
    },
  ];

  // -- PageShell tabs (content switcher) --
  const pageTabs: PageTab[] = [
    { id: 'all', label: 'All', count: transactions.length },
    { id: 'settled', label: 'Settled', count: settledCount },
    { id: 'active', label: 'Active', count: activeCount },
    { id: 'locked', label: 'Locked', count: lockedCount },
    { id: 'reversed', label: 'Reversed', count: reversedCount },
    { id: 'messages', label: 'Agent Messages', count: agentMessages.length },
  ];

  // Orphan alert banner
  const orphanAlert = orphanCount > 0 ? (
    <div className="p-3 rounded-2xl border border-amber-700/50 bg-amber-500/10 dark:bg-amber-950/20 flex items-center gap-3">
      <AlertOctagon className="w-4 h-4 text-amber-500 dark:text-amber-400 shrink-0" />
      <div className="flex-1">
        <span className="text-xs text-amber-700 dark:text-amber-300 font-medium">
          {orphanCount} orphaned transaction{orphanCount !== 1 ? 's' : ''} detected
        </span>
        <span className="text-xs text-amber-600/80 dark:text-amber-500/80 ml-2">
          Stuck in non-terminal state for &gt;2 minutes.
        </span>
      </div>
    </div>
  ) : undefined;

  return (
    <PageShell
      title="Transaction Monitor"
      subtitle="Network-wide wholesale settlement tracking"
      stats={pageStats}
      tabs={pageTabs}
      activeTab={statusFilter}
      onTabChange={setStatusFilter}
      alert={orphanAlert}
      headerActions={
        <button
          onClick={() => { invalidateTxs(); invalidateMsgs(); }}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-full border border-black/[0.06] dark:border-white/[0.08] text-coda-text hover:bg-black/5 dark:hover:bg-white/5 transition-colors cursor-pointer"
        >
          <Activity className="w-3 h-3" />
          <span>Refresh</span>
        </button>
      }
    >

      <WidgetShell
        title={statusFilter === 'messages' ? 'Agent Messages' : 'Settlements'}
        headerRight={statusFilter === 'messages' ? (
          <select
            value={messageFilter}
            onChange={(e) => setMessageFilter(e.target.value)}
            className="text-[10px] bg-transparent border-none text-coda-text-muted focus:outline-none cursor-pointer"
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
        ) : undefined}
      >
        {statusFilter === 'messages' ? (
          /* ── Agent Messages ─────────────────────────────────── */
          <>
            <div className="flex items-center gap-3 px-1 pb-2 text-[11px] text-coda-text-muted">
              <span className="w-14 shrink-0">Time</span>
              <span className="w-20 shrink-0">Route</span>
              <span className="w-16 shrink-0">Type</span>
              <span className="flex-1">Message</span>
            </div>

            <div className="max-h-[600px] overflow-y-auto scrollbar-thin">
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
                  <div
                    key={msg.id}
                    className="flex items-center gap-3 px-1 py-2.5 text-xs border-t border-black/[0.06] dark:border-white/[0.06] hover:bg-black/[0.02] dark:hover:bg-white/[0.02] transition-colors"
                  >
                    <span className="text-coda-text-muted font-mono text-[10px] w-14 shrink-0">
                      {new Date(msg.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                    </span>
                    <span className="font-mono text-coda-text-secondary text-[11px] w-20 shrink-0">
                      {fromCode} &rarr; {toCode}
                    </span>
                    <span className={`shrink-0 px-1.5 py-0.5 rounded text-[10px] ${config.color} bg-coda-surface-hover`}>
                      {config.label}
                    </span>
                    <span className="text-coda-text-secondary text-[11px] truncate flex-1">
                      {msg.natural_language || JSON.stringify(msg.content).slice(0, 100)}
                    </span>
                  </div>
                );
              })}
            </div>
          </>
        ) : (
          /* ── Settlements Table ──────────────────────────────── */
          <>
            <div className="grid grid-cols-[1fr_1.5fr_0.8fr_0.8fr_auto] gap-4 px-1 pb-2 text-[11px] text-coda-text-muted">
              <span>Amount</span>
              <span>Route</span>
              <span>Status</span>
              <span>Time</span>
              <span className="w-16 text-right">Actions</span>
            </div>

            <div>
              {displayTransactions.length === 0 && (
                <div className="p-8 text-center text-sm text-coda-text-muted">
                  No transactions yet
                </div>
              )}
              {displayTransactions.map((tx) => {
                const statusConfig = TX_STATUS_CONFIG[tx.status] || TX_STATUS_CONFIG.initiated;
                const senderCode = (tx as any).sender_bank?.short_code || '???';
                const receiverCode = (tx as any).receiver_bank?.short_code || '???';
                const orphaned = isOrphanedTransaction(tx);
                const isExpiredRejection = tx.status === 'rejected' && (tx as any).risk_reasoning?.startsWith('Expired:');
                const lockupStatus = tx.lockup_status;
                const cadenzaConfig = lockupStatus ? CADENZA_STATUS_CONFIG[lockupStatus] : null;
                const isActiveLockup = lockupStatus ? ACTIVE_LOCKUP_STATUSES.includes(lockupStatus) : false;
                const isEscalated = lockupStatus === 'cadenza_escalated';

                return (
                  <div
                    key={tx.id}
                    className={`grid grid-cols-[1fr_1.5fr_0.8fr_0.8fr_auto] gap-4 items-center px-1 py-3.5 border-t border-black/[0.06] dark:border-white/[0.06] ${
                      orphaned ? 'bg-amber-500/[0.03]' : ''
                    }`}
                  >
                    <span className="font-mono text-sm text-coda-text" style={{ fontVariantNumeric: 'tabular-nums' }}>
                      {tx.amount_display != null ? `$${tx.amount_display.toLocaleString()}` : formatTokenAmount(tx.amount)}
                    </span>

                    <div className="flex items-center gap-2 min-w-0">
                      <span className="text-xs text-coda-text-secondary truncate">
                        {senderCode} → {receiverCode}
                      </span>
                      {cadenzaConfig && (
                        <span
                          className={`shrink-0 px-1.5 py-0.5 rounded text-[9px] font-medium flex items-center gap-0.5 ${cadenzaConfig.bg} ${cadenzaConfig.color}`}
                          title={`Cadenza: ${cadenzaConfig.label}`}
                        >
                          <Eye className="w-2.5 h-2.5" />
                          {cadenzaConfig.label}
                        </span>
                      )}
                      {isActiveLockup && tx.amount_display != null && (
                        <span
                          className={`shrink-0 flex items-center gap-0.5 text-[9px] font-mono ${
                            isEscalated ? 'text-coda-brand' : 'text-coda-text-muted'
                          }`}
                        >
                          {isEscalated ? <Infinity className="w-2.5 h-2.5" /> : <Clock className="w-2.5 h-2.5" />}
                          ${tx.amount_display.toLocaleString()}
                        </span>
                      )}
                      {tx.solana_tx_signature && (
                        <a
                          href={explorerUrl(tx.solana_tx_signature)}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-coda-text-muted hover:text-coda-text shrink-0 transition-colors"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <ExternalLink className="w-3 h-3" />
                        </a>
                      )}
                    </div>

                    <span className={`inline-flex items-center justify-center w-fit px-2 py-0.5 rounded-full text-[10px] font-medium ${
                      orphaned
                        ? 'bg-amber-500/15 text-amber-500 dark:text-amber-400'
                        : isExpiredRejection
                        ? 'bg-black/[0.04] dark:bg-white/[0.06] text-coda-text-muted'
                        : `${statusConfig.bg} ${statusConfig.color}`
                    }`}>
                      {orphaned ? `Orphaned` : isExpiredRejection ? 'Expired' : statusConfig.label}
                    </span>

                    <span className="text-[11px] text-coda-text-muted font-mono" style={{ fontVariantNumeric: 'tabular-nums' }}>
                      {new Date(tx.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </span>

                    <div className="w-16 flex justify-end">
                      <button
                        onClick={() => navigate(`/transactions/${tx.id}`)}
                        className="px-3 py-1 text-[11px] rounded-full border border-black/[0.06] dark:border-white/[0.08] text-coda-text hover:bg-black/5 dark:hover:bg-white/5 transition-colors cursor-pointer"
                      >
                        View
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </WidgetShell>
    </PageShell>
  );
}
