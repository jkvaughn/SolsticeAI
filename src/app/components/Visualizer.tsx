import { useEffect, useState, useRef, useCallback } from 'react';
import { Radio, AlertOctagon } from 'lucide-react';
import { supabase, callServer } from '../supabaseClient';
import type { Bank, Transaction, Wallet } from '../types';
import {
  formatTokenAmount, truncateAddress, explorerUrl,
  TX_STATUS_CONFIG, RISK_LEVEL_CONFIG,
  isOrphanedTransaction, getOrphanAge
} from '../types';
import { useBanks } from '../contexts/BanksContext';
import { useSWRCache } from '../hooks/useSWRCache';
import { PageHeader } from './PageHeader';
import { PageTransition } from './PageTransition';

// ============================================================
// Types
// ============================================================

interface BankNode {
  bank: Bank;
  wallet: Wallet | null;
  x: number;
  y: number;
}

interface LockupInfo {
  id: string;
  transaction_id: string;
  yb_token_amount: string;
  tb_token_amount: string;
  status: string;
  yield_accrued: string;
  yield_rate_bps: number;
  lockup_start: string;
  lockup_end: string | null;
}

interface InfraNode {
  id: string;
  label: string;
  sublabel: string;
  x: number;
  y: number;
  exists: boolean;
}

// ============================================================
// Fetchers
// ============================================================

async function fetchVisualizerWallets(): Promise<Wallet[]> {
  const { data, error } = await supabase
    .from('wallets')
    .select('*')
    .eq('is_default', true);
  if (error) throw error;
  return data ?? [];
}

async function fetchVisualizerTransactions(): Promise<Transaction[]> {
  const { data, error } = await supabase
    .from('transactions')
    .select('*, sender_bank:banks!transactions_sender_bank_id_fkey(id, short_code), receiver_bank:banks!transactions_receiver_bank_id_fkey(id, short_code)')
    .order('created_at', { ascending: false })
    .limit(50);
  if (error) throw error;
  return data ?? [];
}

async function fetchLockupTokens(): Promise<LockupInfo[]> {
  const { data, error } = await supabase
    .from('lockup_tokens')
    .select('id, transaction_id, yb_token_amount, tb_token_amount, status, yield_accrued, yield_rate_bps, lockup_start, lockup_end')
    .order('created_at', { ascending: false })
    .limit(100);
  if (error) {
    console.error('[Visualizer] lockup_tokens fetch error:', error);
    return [];
  }
  return data ?? [];
}

async function fetchNetworkWallets(): Promise<{ feesBalance: number; feesExists: boolean }> {
  const { data, error } = await supabase
    .from('network_wallets')
    .select('code, balance')
    .eq('code', 'SOLSTICE_FEES')
    .maybeSingle();
  if (error || !data) return { feesBalance: 0, feesExists: false };
  return { feesBalance: Number(data.balance || 0), feesExists: true };
}

// ============================================================
// Lockup status classification
// ============================================================

const ACTIVE_LOCKUP_STATUSES = ['soft_settled', 'cadenza_monitoring', 'cadenza_flagged', 'cadenza_escalated', 'yb_minted'];
const SETTLED_LOCKUP_STATUSES = ['hard_finality', 'cadenza_cleared'];
const REVERSED_LOCKUP_STATUS = 'reversed';

function isLockupTx(tx: Transaction): boolean {
  return tx.lockup_status != null;
}

function isActiveLockup(tx: Transaction): boolean {
  return ACTIVE_LOCKUP_STATUSES.includes(tx.lockup_status || '');
}

function isSettledLockup(tx: Transaction): boolean {
  return SETTLED_LOCKUP_STATUSES.includes(tx.lockup_status || '');
}

function isReversedLockup(tx: Transaction): boolean {
  return tx.lockup_status === REVERSED_LOCKUP_STATUS;
}

// ============================================================
// Format yield for display
// ============================================================

function formatYield(rawAmount: string | number): string {
  const num = Number(rawAmount) / 1_000_000;
  if (num < 0.01) return '$' + num.toFixed(6);
  return '$' + num.toFixed(2);
}

// ============================================================
// SVG Helpers
// ============================================================

/** Offset a point along the line from (x,y) toward (tx,ty) by `dist` pixels */
function offsetPoint(x: number, y: number, tx: number, ty: number, dist: number) {
  const dx = tx - x;
  const dy = ty - y;
  const len = Math.sqrt(dx * dx + dy * dy);
  if (len === 0) return { x, y };
  return { x: x + (dx / len) * dist, y: y + (dy / len) * dist };
}

/** Midpoint with perpendicular offset for labeling curved paths */
function labelPos(x1: number, y1: number, x2: number, y2: number, perpOffset = 0) {
  const mx = (x1 + x2) / 2;
  const my = (y1 + y2) / 2;
  if (perpOffset === 0) return { x: mx, y: my };
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = Math.sqrt(dx * dx + dy * dy);
  if (len === 0) return { x: mx, y: my };
  return { x: mx + (-dy / len) * perpOffset, y: my + (dx / len) * perpOffset };
}

// ============================================================
// Component
// ============================================================

export function Visualizer() {
  const { activeBanks: banks, cacheVersion } = useBanks();

  const { data: walletsData } = useSWRCache<Wallet[]>({
    key: 'visualizer-wallets',
    fetcher: fetchVisualizerWallets,
    deps: [cacheVersion],
    ttl: 3 * 60 * 1000,
  });

  const {
    data: txData,
    invalidate: invalidateTxs,
  } = useSWRCache<Transaction[]>({
    key: 'visualizer-transactions',
    fetcher: fetchVisualizerTransactions,
    deps: [cacheVersion],
    ttl: 2 * 60 * 1000,
  });

  const {
    data: lockupData,
    invalidate: invalidateLockups,
  } = useSWRCache<LockupInfo[]>({
    key: 'visualizer-lockups',
    fetcher: fetchLockupTokens,
    deps: [cacheVersion],
    ttl: 2 * 60 * 1000,
  });

  const {
    data: feesData,
    invalidate: invalidateFees,
  } = useSWRCache<{ feesBalance: number; feesExists: boolean }>({
    key: 'visualizer-fees',
    fetcher: fetchNetworkWallets,
    deps: [cacheVersion],
    ttl: 3 * 60 * 1000,
  });

  // BNY custodian existence check
  const [bnyExists, setBnyExists] = useState(false);
  const [bnyActiveLockups, setBnyActiveLockups] = useState(0);
  const [bnyTotalYield, setBnyTotalYield] = useState(0);

  useEffect(() => {
    callServer<{ status: string; custodian: any }>('/custodian-status', {})
      .then(res => {
        setBnyExists(res.custodian != null);
      })
      .catch(() => setBnyExists(false));
  }, [cacheVersion]);

  const wallets = walletsData ?? [];
  const transactions = txData ?? [];
  const lockups = lockupData ?? [];
  const fees = feesData ?? { feesBalance: 0, feesExists: false };

  // Compute BNY stats from lockups
  useEffect(() => {
    const active = lockups.filter(l => ['active', 'escalated'].includes(l.status));
    setBnyActiveLockups(active.length);
    const totalYield = lockups.reduce((sum, l) => sum + Number(l.yield_accrued || 0), 0);
    setBnyTotalYield(totalYield);
  }, [lockups]);

  const svgRef = useRef<SVGSVGElement>(null);

  // Stable refs for Realtime callbacks
  const invalidateTxsRef = useRef(invalidateTxs);
  invalidateTxsRef.current = invalidateTxs;
  const invalidateLockupsRef = useRef(invalidateLockups);
  invalidateLockupsRef.current = invalidateLockups;
  const invalidateFeesRef = useRef(invalidateFees);
  invalidateFeesRef.current = invalidateFees;

  // Force re-render every 30s for orphan age updates
  const [, setTick] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setTick(t => t + 1), 30_000);
    return () => clearInterval(timer);
  }, []);

  // Realtime: invalidate caches on changes
  useEffect(() => {
    const reloadTimer = { current: null as ReturnType<typeof setTimeout> | null };

    const channel = supabase
      .channel('viz-tx-lockup')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'transactions' }, () => {
        if (reloadTimer.current) clearTimeout(reloadTimer.current);
        reloadTimer.current = setTimeout(() => { invalidateTxsRef.current(); }, 2000);
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'lockup_tokens' }, () => {
        if (reloadTimer.current) clearTimeout(reloadTimer.current);
        reloadTimer.current = setTimeout(() => {
          invalidateLockupsRef.current();
          invalidateTxsRef.current();
        }, 2000);
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'network_wallets' }, () => {
        invalidateFeesRef.current();
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
      if (reloadTimer.current) clearTimeout(reloadTimer.current);
    };
  }, []);

  // ── Layout ──────────────────────────────────────────────────

  const centerX = 400;
  const centerY = 240;
  const radius = 160;

  // BNY at center of polygon
  const bnyNode: InfraNode = {
    id: 'bny',
    label: 'BNY',
    sublabel: 'Custodian',
    x: centerX,
    y: centerY,
    exists: bnyExists,
  };

  // Rimark/Solstice at bottom-right
  const rimarkNode: InfraNode = {
    id: 'rimark',
    label: 'Solstice',
    sublabel: 'Network Fees',
    x: 680,
    y: 510,
    exists: fees.feesExists,
  };

  const bankNodes: BankNode[] = banks.map((bank, i) => {
    const angle = (2 * Math.PI * i) / Math.max(banks.length, 1) - Math.PI / 2;
    return {
      bank,
      wallet: wallets.find((w) => w.bank_id === bank.id) || null,
      x: centerX + radius * Math.cos(angle),
      y: centerY + radius * Math.sin(angle),
    };
  });

  const getBankNode = (bankId: string) => bankNodes.find((n) => n.bank.id === bankId);

  // ── Transaction categories ──────────────────────────────────

  // Separate lockup vs direct transactions
  const directTxs = transactions.filter(t => !isLockupTx(t));
  const lockupTxs = transactions.filter(t => isLockupTx(t));

  // Direct transactions (original behavior)
  const directActive = directTxs.filter(t =>
    ['initiated', 'compliance_check', 'risk_scored', 'executing'].includes(t.status)
  );
  const directSettled = directTxs.filter(t => t.status === 'settled');
  const directLocked = directTxs.filter(t => t.status === 'locked');

  // Lockup transactions by state
  const lockupActive = lockupTxs.filter(t => isActiveLockup(t));
  const lockupSettled = lockupTxs.filter(t => isSettledLockup(t) || (t.status === 'settled' && isLockupTx(t)));
  const lockupReversed = lockupTxs.filter(t => isReversedLockup(t));

  // In-flight lockup txs (still in pipeline, not yet soft-settled)
  const lockupInFlight = lockupTxs.filter(t =>
    ['initiated', 'compliance_check', 'risk_scored', 'executing'].includes(t.status)
  );

  // Orphans (from all transactions)
  const allActive = transactions.filter(t =>
    ['initiated', 'compliance_check', 'risk_scored', 'executing'].includes(t.status)
  );
  const orphanedTxs = allActive.filter(isOrphanedTransaction);
  const healthyDirectActive = directActive.filter(t => !isOrphanedTransaction(t));

  // Whether to show infrastructure nodes
  const showBny = bnyExists && lockupTxs.length > 0;
  const showRimark = fees.feesExists;

  return (
    <div className="flex flex-col gap-4 h-[calc(100vh-4rem)]">
      {/* ═══ HEADER ═══ */}
      <PageHeader
        icon={Radio}
        title="Live Settlement Flows"
        subtitle="Solstice Network real-time visualization"
      >
        {lockupActive.length > 0 && (
          <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-amber-500/10 border border-amber-500/20">
            <span className="w-2 h-2 rounded-full bg-amber-500 animate-pulse" />
            <span className="text-[11px] font-mono font-bold text-amber-500">
              {lockupActive.length} lockup{lockupActive.length !== 1 ? 's' : ''}
            </span>
          </span>
        )}
        {orphanedTxs.length > 0 && (
          <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-amber-500/10 border border-amber-700/30">
            <AlertOctagon className="w-3 h-3 text-amber-500 dark:text-amber-400 animate-pulse" />
            <span className="text-[11px] font-mono font-bold text-amber-600 dark:text-amber-400">
              {orphanedTxs.length} orphaned
            </span>
          </span>
        )}
      </PageHeader>

      <PageTransition className="flex gap-4 flex-1 min-h-0">
        {/* ════ LEFT: SVG Canvas ════ */}
        <div className="flex-1 min-w-0 dashboard-card overflow-hidden relative">
          {banks.length === 0 ? (
            <div className="flex items-center justify-center h-full text-center">
              <div>
                <Radio className="w-10 h-10 text-coda-text-muted mx-auto mb-3" />
                <p className="text-sm font-mono text-coda-text-muted mb-1">No banks deployed</p>
                <p className="text-xs font-mono text-coda-text-muted">Deploy banks on the Setup page to see the network visualization.</p>
              </div>
            </div>
          ) : (
            <svg
              ref={svgRef}
              viewBox="0 0 800 600"
              className="w-full h-full"
              preserveAspectRatio="xMidYMid slice"
            >
              <defs>
                {/* Glow filters */}
                <filter id="glow">
                  <feGaussianBlur stdDeviation="3" result="coloredBlur" />
                  <feMerge>
                    <feMergeNode in="coloredBlur" />
                    <feMergeNode in="SourceGraphic" />
                  </feMerge>
                </filter>
                <filter id="amber-glow">
                  <feGaussianBlur stdDeviation="4" result="coloredBlur" />
                  <feMerge>
                    <feMergeNode in="coloredBlur" />
                    <feMergeNode in="SourceGraphic" />
                  </feMerge>
                </filter>
                <filter id="purple-glow">
                  <feGaussianBlur stdDeviation="3" result="coloredBlur" />
                  <feMerge>
                    <feMergeNode in="coloredBlur" />
                    <feMergeNode in="SourceGraphic" />
                  </feMerge>
                </filter>
                <filter id="bny-pulse-filter">
                  <feGaussianBlur stdDeviation="6" result="coloredBlur" />
                  <feMerge>
                    <feMergeNode in="coloredBlur" />
                    <feMergeNode in="SourceGraphic" />
                  </feMerge>
                </filter>

                {/* Arrow markers */}
                <marker id="arrow-green" viewBox="0 0 10 10" refX="5" refY="5" markerWidth="4" markerHeight="4" orient="auto-start-reverse">
                  <path d="M 0 0 L 10 5 L 0 10 z" fill="#10b981" />
                </marker>
                <marker id="arrow-yellow" viewBox="0 0 10 10" refX="5" refY="5" markerWidth="4" markerHeight="4" orient="auto-start-reverse">
                  <path d="M 0 0 L 10 5 L 0 10 z" fill="#eab308" />
                </marker>
                <marker id="arrow-red" viewBox="0 0 10 10" refX="5" refY="5" markerWidth="4" markerHeight="4" orient="auto-start-reverse">
                  <path d="M 0 0 L 10 5 L 0 10 z" fill="#ef4444" />
                </marker>
                <marker id="arrow-gray" viewBox="0 0 10 10" refX="5" refY="5" markerWidth="4" markerHeight="4" orient="auto-start-reverse">
                  <path d="M 0 0 L 10 5 L 0 10 z" fill="#374151" />
                </marker>
                <marker id="arrow-amber" viewBox="0 0 10 10" refX="5" refY="5" markerWidth="4" markerHeight="4" orient="auto-start-reverse">
                  <path d="M 0 0 L 10 5 L 0 10 z" fill="#f59e0b" />
                </marker>
                <marker id="arrow-purple" viewBox="0 0 10 10" refX="5" refY="5" markerWidth="4" markerHeight="4" orient="auto-start-reverse">
                  <path d="M 0 0 L 10 5 L 0 10 z" fill="#a855f7" />
                </marker>
                <marker id="arrow-green-solid" viewBox="0 0 10 10" refX="5" refY="5" markerWidth="4" markerHeight="4" orient="auto-start-reverse">
                  <path d="M 0 0 L 10 5 L 0 10 z" fill="#10b981" />
                </marker>

                {/* Animation styles */}
                <style>{`
                  @keyframes dash-flow {
                    to { stroke-dashoffset: -20; }
                  }
                  @keyframes dash-flow-lockup {
                    to { stroke-dashoffset: -24; }
                  }
                  @keyframes pulse-line {
                    0%, 100% { opacity: 0.4; }
                    50% { opacity: 1; }
                  }
                  @keyframes orphan-pulse {
                    0%, 100% { opacity: 0.3; }
                    50% { opacity: 0.8; }
                  }
                  @keyframes bny-pulse {
                    0%, 100% { opacity: 0.15; }
                    50% { opacity: 0.4; }
                  }
                  @keyframes reversal-flash {
                    0%, 100% { opacity: 0.3; }
                    25% { opacity: 1; }
                    50% { opacity: 0.1; }
                    75% { opacity: 0.8; }
                  }
                  @keyframes dash-reverse {
                    to { stroke-dashoffset: 24; }
                  }
                  @keyframes yield-flow {
                    to { stroke-dashoffset: -16; }
                  }
                  .active-flow {
                    animation: dash-flow 1s linear infinite;
                  }
                  .lockup-flow {
                    animation: dash-flow-lockup 1.2s linear infinite;
                  }
                  .locked-pulse {
                    animation: pulse-line 2s ease-in-out infinite;
                  }
                  .orphan-pulse {
                    animation: orphan-pulse 1.5s ease-in-out infinite;
                  }
                  .bny-pulse-ring {
                    animation: bny-pulse 2s ease-in-out infinite;
                  }
                  .reversal-flash {
                    animation: reversal-flash 1s ease-in-out infinite;
                  }
                  .reverse-flow {
                    animation: dash-reverse 0.8s linear infinite;
                  }
                  .yield-sweep-flow {
                    animation: yield-flow 2s linear infinite;
                  }
                `}</style>
              </defs>

              {/* ═══ LAYER 1: Yield sweep line (BNY → Rimark) ═══ */}
              {showBny && showRimark && (
                <g>
                  <line
                    x1={bnyNode.x} y1={bnyNode.y}
                    x2={rimarkNode.x} y2={rimarkNode.y}
                    stroke="#10b981" strokeWidth="0.5" strokeOpacity="0.15"
                  />
                  <line
                    x1={bnyNode.x} y1={bnyNode.y}
                    x2={rimarkNode.x} y2={rimarkNode.y}
                    stroke="#10b981" strokeWidth="1" strokeDasharray="4 12"
                    strokeOpacity="0.3" className="yield-sweep-flow"
                  />
                  {(() => {
                    const lp = labelPos(bnyNode.x, bnyNode.y, rimarkNode.x, rimarkNode.y, -10);
                    return (
                      <text x={lp.x} y={lp.y} textAnchor="middle"
                        className="text-[7px] font-mono" fill="#10b981" fillOpacity="0.5">
                        yield sweep
                      </text>
                    );
                  })()}
                </g>
              )}

              {/* ═══ LAYER 2: Direct settled paths (non-lockup) ═══ */}
              {directSettled.map((tx) => {
                const from = getBankNode(tx.sender_bank_id);
                const to = getBankNode(tx.receiver_bank_id);
                if (!from || !to) return null;
                return (
                  <line
                    key={`settled-${tx.id}`}
                    x1={from.x} y1={from.y} x2={to.x} y2={to.y}
                    stroke="#10b981" strokeWidth="1" strokeOpacity="0.15"
                    markerEnd="url(#arrow-green)"
                  />
                );
              })}

              {/* ═══ LAYER 3: Direct locked paths (non-lockup) ═══ */}
              {directLocked.map((tx) => {
                const from = getBankNode(tx.sender_bank_id);
                const to = getBankNode(tx.receiver_bank_id);
                if (!from || !to) return null;
                return (
                  <line
                    key={`locked-${tx.id}`}
                    x1={from.x} y1={from.y} x2={to.x} y2={to.y}
                    stroke="#a855f7" strokeWidth="2" strokeDasharray="6 4"
                    className="locked-pulse"
                  />
                );
              })}

              {/* ═══ LAYER 4: Lockup settled paths (sender → BNY → receiver, green solid) ═══ */}
              {showBny && lockupSettled.map((tx) => {
                const from = getBankNode(tx.sender_bank_id);
                const to = getBankNode(tx.receiver_bank_id);
                if (!from || !to) return null;
                return (
                  <g key={`lockup-settled-${tx.id}`}>
                    {/* Sender → BNY */}
                    <line
                      x1={from.x} y1={from.y} x2={bnyNode.x} y2={bnyNode.y}
                      stroke="#10b981" strokeWidth="1" strokeOpacity="0.2"
                      markerEnd="url(#arrow-green-solid)"
                    />
                    {/* BNY → Receiver */}
                    <line
                      x1={bnyNode.x} y1={bnyNode.y} x2={to.x} y2={to.y}
                      stroke="#10b981" strokeWidth="1" strokeOpacity="0.2"
                      markerEnd="url(#arrow-green-solid)"
                    />
                  </g>
                );
              })}

              {/* ═══ LAYER 5: Lockup reversed paths (red flash, reverse direction) ═══ */}
              {showBny && lockupReversed.map((tx) => {
                const from = getBankNode(tx.sender_bank_id);
                const to = getBankNode(tx.receiver_bank_id);
                if (!from || !to) return null;
                return (
                  <g key={`lockup-reversed-${tx.id}`}>
                    {/* BNY → Sender (clawback direction) */}
                    <line
                      x1={bnyNode.x} y1={bnyNode.y} x2={from.x} y2={from.y}
                      stroke="#ef4444" strokeWidth="1.5" strokeOpacity="0.15"
                    />
                    <line
                      x1={bnyNode.x} y1={bnyNode.y} x2={from.x} y2={from.y}
                      stroke="#ef4444" strokeWidth="1.5" strokeDasharray="4 8"
                      className="reversal-flash"
                      markerEnd="url(#arrow-red)"
                    />
                    {/* BNY ← Receiver (burned) */}
                    <line
                      x1={to.x} y1={to.y} x2={bnyNode.x} y2={bnyNode.y}
                      stroke="#ef4444" strokeWidth="1" strokeOpacity="0.1"
                    />
                    {/* Label */}
                    {(() => {
                      const lp = labelPos(bnyNode.x, bnyNode.y, from.x, from.y, -12);
                      return (
                        <text x={lp.x} y={lp.y} textAnchor="middle"
                          className="text-[7px] font-mono font-bold" fill="#ef4444">
                          REVERSED
                        </text>
                      );
                    })()}
                  </g>
                );
              })}

              {/* ═══ LAYER 6: Active lockup paths (sender → BNY amber, BNY → receiver purple) ═══ */}
              {showBny && lockupActive.map((tx) => {
                const from = getBankNode(tx.sender_bank_id);
                const to = getBankNode(tx.receiver_bank_id);
                if (!from || !to) return null;

                const isEscalated = tx.lockup_status === 'cadenza_escalated';
                const isFlagged = tx.lockup_status === 'cadenza_flagged';

                return (
                  <g key={`lockup-active-${tx.id}`}>
                    {/* Sender → BNY (yield-bearing token, amber) */}
                    <line
                      x1={from.x} y1={from.y} x2={bnyNode.x} y2={bnyNode.y}
                      stroke="#f59e0b" strokeWidth="2" strokeOpacity="0.15"
                    />
                    <line
                      x1={from.x} y1={from.y} x2={bnyNode.x} y2={bnyNode.y}
                      stroke="#f59e0b" strokeWidth="2" strokeDasharray="6 18"
                      className="lockup-flow"
                      filter="url(#amber-glow)"
                      markerEnd="url(#arrow-amber)"
                    />

                    {/* BNY → Receiver (T-bill token, purple) */}
                    <line
                      x1={bnyNode.x} y1={bnyNode.y} x2={to.x} y2={to.y}
                      stroke="#a855f7" strokeWidth="2" strokeOpacity="0.15"
                    />
                    <line
                      x1={bnyNode.x} y1={bnyNode.y} x2={to.x} y2={to.y}
                      stroke="#a855f7" strokeWidth="2" strokeDasharray="6 18"
                      className="lockup-flow"
                      filter="url(#purple-glow)"
                      markerEnd="url(#arrow-purple)"
                    />

                    {/* Amount label on sender→BNY leg */}
                    {(() => {
                      const lp = labelPos(from.x, from.y, bnyNode.x, bnyNode.y, -12);
                      return (
                        <>
                          <text x={lp.x} y={lp.y - 4} textAnchor="middle"
                            className="text-[8px] font-mono" fill="#f59e0b">
                            {formatTokenAmount(tx.amount)}
                          </text>
                          <text x={lp.x} y={lp.y + 7} textAnchor="middle"
                            className="text-[7px] font-mono" fill="#f59e0b" fillOpacity="0.7">
                            USDYB
                          </text>
                        </>
                      );
                    })()}

                    {/* Token label on BNY→receiver leg */}
                    {(() => {
                      const lp = labelPos(bnyNode.x, bnyNode.y, to.x, to.y, -12);
                      return (
                        <>
                          <text x={lp.x} y={lp.y - 4} textAnchor="middle"
                            className="text-[8px] font-mono" fill="#a855f7">
                            {formatTokenAmount(tx.amount)}
                          </text>
                          <text x={lp.x} y={lp.y + 7} textAnchor="middle"
                            className="text-[7px] font-mono" fill="#a855f7" fillOpacity="0.7">
                            USTB
                          </text>
                        </>
                      );
                    })()}

                    {/* Status chip at midpoint of sender→receiver */}
                    {(isEscalated || isFlagged) && (() => {
                      const lp = labelPos(from.x, from.y, to.x, to.y, 16);
                      return (
                        <text x={lp.x} y={lp.y} textAnchor="middle"
                          className="text-[7px] font-mono font-bold"
                          fill={isEscalated ? '#a855f7' : '#f59e0b'}>
                          {isEscalated ? '⚠ ESCALATED' : '⚡ FLAGGED'}
                        </text>
                      );
                    })()}
                  </g>
                );
              })}

              {/* ═══ LAYER 7: Orphaned transaction paths (amber pulsing — unchanged) ═══ */}
              {orphanedTxs.map((tx) => {
                const from = getBankNode(tx.sender_bank_id);
                const to = getBankNode(tx.receiver_bank_id);
                if (!from || !to) return null;
                return (
                  <g key={`orphan-${tx.id}`}>
                    <line
                      x1={from.x} y1={from.y} x2={to.x} y2={to.y}
                      stroke="#f59e0b" strokeWidth="2.5" strokeOpacity="0.15"
                    />
                    <line
                      x1={from.x} y1={from.y} x2={to.x} y2={to.y}
                      stroke="#f59e0b" strokeWidth="2" strokeDasharray="3 8"
                      className="orphan-pulse" filter="url(#amber-glow)"
                      markerEnd="url(#arrow-amber)"
                    />
                    <text
                      x={(from.x + to.x) / 2} y={(from.y + to.y) / 2 - 14}
                      textAnchor="middle" className="text-[8px] font-mono font-bold" fill="#f59e0b">
                      ORPHANED
                    </text>
                    <text
                      x={(from.x + to.x) / 2} y={(from.y + to.y) / 2 - 2}
                      textAnchor="middle" className="text-[9px] font-mono" fill="#f59e0b">
                      {formatTokenAmount(tx.amount)}
                    </text>
                    <text
                      x={(from.x + to.x) / 2} y={(from.y + to.y) / 2 + 10}
                      textAnchor="middle" className="text-[8px] font-mono" fill="#92400e">
                      {getOrphanAge(tx)} stuck @ {TX_STATUS_CONFIG[tx.status]?.label}
                    </text>
                  </g>
                );
              })}

              {/* ═══ LAYER 8: Healthy direct active paths (animated — unchanged) ═══ */}
              {healthyDirectActive.map((tx) => {
                const from = getBankNode(tx.sender_bank_id);
                const to = getBankNode(tx.receiver_bank_id);
                if (!from || !to) return null;

                const riskColor =
                  tx.risk_level === 'high' ? '#ef4444' :
                  tx.risk_level === 'medium' ? '#eab308' :
                  '#10b981';

                const arrowId =
                  tx.risk_level === 'high' ? 'arrow-red' :
                  tx.risk_level === 'medium' ? 'arrow-yellow' :
                  'arrow-green';

                return (
                  <g key={`active-${tx.id}`}>
                    <line
                      x1={from.x} y1={from.y} x2={to.x} y2={to.y}
                      stroke={riskColor} strokeWidth="2" strokeOpacity="0.2"
                    />
                    <line
                      x1={from.x} y1={from.y} x2={to.x} y2={to.y}
                      stroke={riskColor} strokeWidth="2" strokeDasharray="5 15"
                      className="active-flow" filter="url(#glow)"
                      markerEnd={`url(#${arrowId})`}
                    />
                    <text
                      x={(from.x + to.x) / 2} y={(from.y + to.y) / 2 - 8}
                      textAnchor="middle" className="text-[9px] font-mono" fill={riskColor}>
                      {formatTokenAmount(tx.amount)}
                    </text>
                    <text
                      x={(from.x + to.x) / 2} y={(from.y + to.y) / 2 + 6}
                      textAnchor="middle" className="text-[8px] font-mono"
                      fill="var(--coda-text-muted)">
                      {TX_STATUS_CONFIG[tx.status]?.label}
                    </text>
                  </g>
                );
              })}

              {/* ═══ LAYER 9: Bank Nodes (unchanged) ═══ */}
              {bankNodes.map((node) => (
                <g key={node.bank.id}>
                  <circle cx={node.x} cy={node.y} r={48}
                    fill="none" stroke="var(--coda-border)" strokeWidth="1" />
                  <circle cx={node.x} cy={node.y} r={44}
                    fill="var(--coda-surface)" stroke="var(--coda-border)" strokeWidth="1.5" />
                  <circle cx={node.x + 32} cy={node.y - 32} r={4}
                    fill={node.bank.status === 'active' ? '#10b981' : '#ef4444'} />
                  <text x={node.x} y={node.y - 8} textAnchor="middle"
                    className="text-[14px] font-mono font-bold" fill="var(--coda-text)">
                    {node.bank.short_code}
                  </text>
                  <text x={node.x} y={node.y + 8} textAnchor="middle"
                    className="text-[9px] font-mono" fill="#10b981">
                    {node.wallet ? formatTokenAmount(node.wallet.balance_tokens) : '$0'}
                  </text>
                  <text x={node.x} y={node.y + 20} textAnchor="middle"
                    className="text-[8px] font-mono" fill="var(--coda-text-muted)">
                    {node.bank.token_symbol || ''}
                  </text>
                </g>
              ))}

              {/* ═══ LAYER 10: BNY Custodian Node (diamond, center) ═══ */}
              {showBny && (
                <g>
                  {/* Diamond shape (rotated square) */}
                  <rect
                    x={bnyNode.x - 34} y={bnyNode.y - 34}
                    width={68} height={68}
                    rx={6}
                    fill="var(--coda-surface)"
                    stroke={bnyActiveLockups > 0 ? '#f59e0b' : 'var(--coda-border)'}
                    strokeWidth={bnyActiveLockups > 0 ? 2 : 1.5}
                    transform={`rotate(45, ${bnyNode.x}, ${bnyNode.y})`}
                  />
                  {/* Inner content (not rotated) */}
                  <text x={bnyNode.x} y={bnyNode.y - 12} textAnchor="middle"
                    className="text-[12px] font-mono font-bold"
                    fill={bnyActiveLockups > 0 ? '#f59e0b' : 'var(--coda-text)'}>
                    BNY
                  </text>
                  <text x={bnyNode.x} y={bnyNode.y + 2} textAnchor="middle"
                    className="text-[8px] font-mono" fill="var(--coda-text-muted)">
                    Custodian
                  </text>
                  {bnyActiveLockups > 0 && (
                    <text x={bnyNode.x} y={bnyNode.y + 14} textAnchor="middle"
                      className="text-[8px] font-mono" fill="#f59e0b">
                      {bnyActiveLockups} lockup{bnyActiveLockups !== 1 ? 's' : ''}
                    </text>
                  )}
                  {bnyTotalYield > 0 && (
                    <text x={bnyNode.x} y={bnyNode.y + 25} textAnchor="middle"
                      className="text-[7px] font-mono" fill="#10b981">
                      yield: {formatYield(bnyTotalYield)}
                    </text>
                  )}
                </g>
              )}

              {/* ═══ LAYER 11: Rimark/Solstice Fees Node (small, bottom) ═══ */}
              {showRimark && (
                <g>
                  <circle cx={rimarkNode.x} cy={rimarkNode.y} r={28}
                    fill="var(--coda-surface)" stroke="var(--coda-border)" strokeWidth="1" />
                  <circle cx={rimarkNode.x} cy={rimarkNode.y} r={24}
                    fill="var(--coda-surface)" stroke="#10b981" strokeWidth="1" strokeOpacity="0.3" />
                  <text x={rimarkNode.x} y={rimarkNode.y - 6} textAnchor="middle"
                    className="text-[9px] font-mono font-bold" fill="var(--coda-text)">
                    Solstice
                  </text>
                  <text x={rimarkNode.x} y={rimarkNode.y + 5} textAnchor="middle"
                    className="text-[7px] font-mono" fill="var(--coda-text-muted)">
                    Network Fees
                  </text>
                  <text x={rimarkNode.x} y={rimarkNode.y + 16} textAnchor="middle"
                    className="text-[8px] font-mono" fill="#10b981">
                    {fees.feesBalance > 0 ? formatYield(fees.feesBalance) : '$0.00'}
                  </text>
                </g>
              )}

              {/* ═══ Legend ═══ */}
              <g transform="translate(20, 530)">
                <text x="0" y="0" fill="var(--coda-text-muted)" className="text-[9px] font-mono">Legend:</text>
                <line x1="60" y1="-3" x2="90" y2="-3" stroke="#10b981" strokeWidth="2" />
                <text x="95" y="0" fill="var(--coda-text-muted)" className="text-[9px] font-mono">Low Risk</text>
                <line x1="160" y1="-3" x2="190" y2="-3" stroke="#eab308" strokeWidth="2" />
                <text x="195" y="0" fill="var(--coda-text-muted)" className="text-[9px] font-mono">Med Risk</text>
                <line x1="270" y1="-3" x2="300" y2="-3" stroke="#ef4444" strokeWidth="2" />
                <text x="305" y="0" fill="var(--coda-text-muted)" className="text-[9px] font-mono">High Risk</text>
                <line x1="380" y1="-3" x2="410" y2="-3" stroke="#10b981" strokeWidth="1" strokeOpacity="0.3" />
                <text x="415" y="0" fill="var(--coda-text-muted)" className="text-[9px] font-mono">Settled</text>
              </g>
              <g transform="translate(20, 548)">
                <line x1="60" y1="-3" x2="90" y2="-3" stroke="#f59e0b" strokeWidth="2" strokeDasharray="6 6" />
                <text x="95" y="0" fill="#f59e0b" className="text-[9px] font-mono">Lockup (YB)</text>
                <line x1="190" y1="-3" x2="220" y2="-3" stroke="#a855f7" strokeWidth="2" strokeDasharray="6 6" />
                <text x="225" y="0" fill="#a855f7" className="text-[9px] font-mono">Lockup (TB)</text>
                <line x1="320" y1="-3" x2="350" y2="-3" stroke="#ef4444" strokeWidth="1.5" strokeDasharray="4 8" />
                <text x="355" y="0" fill="#ef4444" className="text-[9px] font-mono">Reversed</text>
                <line x1="430" y1="-3" x2="460" y2="-3" stroke="#f59e0b" strokeWidth="2" strokeDasharray="3 8" />
                <text x="465" y="0" fill="#f59e0b" className="text-[9px] font-mono">Orphaned</text>
              </g>
            </svg>
          )}
        </div>

        {/* ════ RIGHT: Transaction Log ════ */}
        <div className="w-[320px] xl:w-[360px] flex-shrink-0 dashboard-card overflow-hidden flex flex-col">
          <div className="px-4 py-3 border-b border-coda-border/50 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-coda-text">Transaction Log</h2>
            <div className="flex items-center gap-1.5">
              {lockupActive.length > 0 && (
                <span className="flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-amber-500/10 text-amber-500 text-[10px] font-mono font-bold">
                  {lockupActive.length} lockup
                </span>
              )}
              {orphanedTxs.length > 0 && (
                <span className="flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-amber-500/10 text-amber-600 dark:text-amber-400 text-[10px] font-mono font-bold">
                  <AlertOctagon className="w-2.5 h-2.5" />
                  {orphanedTxs.length}
                </span>
              )}
            </div>
          </div>

          <div className="flex-1 overflow-y-auto p-2 space-y-1.5 scrollbar-thin">
            {transactions.length === 0 && (
              <div className="text-center text-[10px] font-mono text-coda-text-muted py-8">
                No transactions yet
              </div>
            )}

            {transactions.map((tx) => {
              const statusConfig = TX_STATUS_CONFIG[tx.status];
              const senderCode = (tx as any).sender_bank?.short_code || '???';
              const receiverCode = (tx as any).receiver_bank?.short_code || '???';
              const orphaned = isOrphanedTransaction(tx);
              const isExpiredRejection = tx.status === 'rejected' && tx.risk_reasoning?.startsWith('Expired:');
              const hasLockup = isLockupTx(tx);

              // Lockup status display
              const lockupLabel = hasLockup
                ? tx.lockup_status === 'cadenza_escalated' ? 'Escalated'
                : tx.lockup_status === 'cadenza_flagged' ? 'Flagged'
                : tx.lockup_status === 'hard_finality' ? 'Finalized'
                : tx.lockup_status === 'reversed' ? 'Reversed'
                : isActiveLockup(tx) ? 'Lockup'
                : null
                : null;

              const lockupColor = hasLockup
                ? tx.lockup_status === 'cadenza_escalated' ? 'bg-purple-500/20 text-purple-400'
                : tx.lockup_status === 'cadenza_flagged' ? 'bg-amber-500/20 text-amber-400'
                : tx.lockup_status === 'reversed' ? 'bg-red-500/20 text-red-400'
                : tx.lockup_status === 'hard_finality' ? 'bg-emerald-500/20 text-emerald-400'
                : isActiveLockup(tx) ? 'bg-amber-500/15 text-amber-400'
                : ''
                : '';

              return (
                <div
                  key={tx.id}
                  className={`p-2 rounded border text-[10px] font-mono ${
                    orphaned
                      ? 'border-amber-700/40 bg-amber-950/20'
                      : hasLockup && isActiveLockup(tx)
                      ? 'border-amber-500/20 bg-amber-500/5'
                      : 'border-coda-border/50 bg-coda-surface-alt/20'
                  }`}
                >
                  <div className="flex items-center justify-between mb-0.5">
                    <span className="text-coda-text-secondary">
                      {hasLockup
                        ? <>{senderCode} &rarr; BNY &rarr; {receiverCode}</>
                        : <>{senderCode} &rarr; {receiverCode}</>
                      }
                    </span>
                    <div className="flex items-center gap-1">
                      {orphaned && (
                        <AlertOctagon className="w-2.5 h-2.5 text-amber-400 animate-pulse" />
                      )}
                      {lockupLabel && (
                        <span className={`px-1 py-0.5 rounded ${lockupColor}`}>
                          {lockupLabel}
                        </span>
                      )}
                      <span className={`px-1 py-0.5 rounded ${
                        orphaned
                          ? 'bg-amber-500/20 text-amber-400'
                          : isExpiredRejection
                          ? 'bg-coda-surface-hover text-coda-text-muted'
                          : `${statusConfig.bg} ${statusConfig.color}`
                      }`}>
                        {orphaned ? 'Orphaned' : isExpiredRejection ? 'Expired' : statusConfig.label}
                      </span>
                    </div>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-coda-text">{formatTokenAmount(tx.amount)}</span>
                    <span className="text-coda-text-muted">
                      {orphaned
                        ? `${getOrphanAge(tx)} stuck`
                        : new Date(tx.created_at).toLocaleTimeString()
                      }
                    </span>
                  </div>
                  {tx.solana_tx_signature && (
                    <a
                      href={explorerUrl(tx.solana_tx_signature)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-blue-500 dark:text-blue-400 hover:text-blue-400 dark:hover:text-blue-300 mt-0.5 inline-block"
                    >
                      {truncateAddress(tx.solana_tx_signature, 6)}
                    </a>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </PageTransition>
    </div>
  );
}