import { useEffect, useState, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router';
import { Radio, AlertOctagon, Activity, ZoomIn, ZoomOut, Maximize } from 'lucide-react';
import { supabase, callServer } from '../supabaseClient';
import { fetchTransactions, fetchWallets as dcFetchWallets, fetchLockupTokens as dcFetchLockups, fetchNetworkWallets as dcFetchNetworkWallets } from '../dataClient';
import type { Bank, Transaction, Wallet } from '../types';
import {
  formatTokenAmount, truncateAddress, explorerUrl,
  TX_STATUS_CONFIG, RISK_LEVEL_CONFIG,
  isOrphanedTransaction, getOrphanAge
} from '../types';
import { useBanks } from '../contexts/BanksContext';
import { useSWRCache } from '../hooks/useSWRCache';
import { useTheme } from './ThemeProvider';
import { PageShell } from './PageShell';
import type { PageStat } from './PageShell';
import { WidgetShell } from './dashboard/WidgetShell';

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
  return dcFetchWallets();
}

async function fetchVisualizerTransactions(): Promise<Transaction[]> {
  // Use dataClient for production routing (Azure Postgres vs Supabase)
  return fetchTransactions({ limit: 50 });
}

async function fetchLockupTokens(): Promise<LockupInfo[]> {
  return dcFetchLockups({ limit: 100 });
}

async function fetchNetworkWallets(): Promise<{ feesBalance: number; feesExists: boolean }> {
  try {
    const wallets = await dcFetchNetworkWallets();
    const fees = wallets.find((w: any) => w.code === 'SOLSTICE_FEES');
    if (!fees) return { feesBalance: 0, feesExists: false };
    return { feesBalance: Number(fees.balance || 0), feesExists: true };
  } catch {
    return { feesBalance: 0, feesExists: false };
  }
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

/**
 * Manhattan-routed SVG path between two points with rounded corners.
 * Routes: horizontal from source → vertical → horizontal to target.
 * `r` controls the corner radius.
 */
function manhattanPath(x1: number, y1: number, x2: number, y2: number, r = 10, midBias = 0.5): string {
  const mx = x1 + (x2 - x1) * midBias;
  const dy = y2 - y1;
  const dx1 = mx - x1;
  const dx2 = x2 - mx;

  // Clamp radius to half the smallest segment
  const minSeg = Math.min(Math.abs(dx1), Math.abs(dy), Math.abs(dx2));
  const cr = Math.min(r, minSeg / 2);

  if (cr < 1 || Math.abs(dy) < 2) {
    // Fallback: straight line if segments too small
    return `M ${x1} ${y1} L ${x2} ${y2}`;
  }

  const sy = dy > 0 ? 1 : -1;
  const sx1 = dx1 > 0 ? 1 : -1;
  const sx2 = dx2 > 0 ? 1 : -1;

  return [
    `M ${x1} ${y1}`,
    `L ${mx - sx1 * cr} ${y1}`,
    `Q ${mx} ${y1} ${mx} ${y1 + sy * cr}`,
    `L ${mx} ${y2 - sy * cr}`,
    `Q ${mx} ${y2} ${mx + sx2 * cr} ${y2}`,
    `L ${x2} ${y2}`,
  ].join(' ');
}

/**
 * Single-column Manhattan routing for the bank visualizer.
 *
 * Bank-to-bank (direct): exit LEFT edge → left channel → enter LEFT edge (C-shape)
 * Bank-to-infra:         exit RIGHT edge → horizontal to infra (L-shape)
 * Infra-to-bank:         exit infra → horizontal left → vertical → enter RIGHT edge
 *
 * `idx` offsets parallel lines so they nest without overlapping.
 */
function gridRoute(
  x1: number, y1: number,
  x2: number, y2: number,
  positions: { x: number; y: number }[],
  idx = 0,
  r = 10
): string {
  const HW = 60;  // half card width (120/2)
  const HH = 36;  // half card height (72/2)
  const GAP = 4;  // px between nested parallel lines

  const slot = idx % 11 - 5; // -5 to +5
  const offset = slot * GAP;

  // Check if each point is a bank node
  const srcIsBank = positions.some(p => Math.abs(p.x - x1) < 5 && Math.abs(p.y - y1) < 5);
  const dstIsBank = positions.some(p => Math.abs(p.x - x2) < 5 && Math.abs(p.y - y2) < 5);

  // ── Bank-to-bank: "C" shape through left channel ──
  if (srcIsBank && dstIsBank) {
    const leftChannel = x1 - HW - 20 - Math.abs(offset);
    const APAD = 6; // arrow padding gap
    const exitX = x1 - HW;
    const enterX = x2 - HW - APAD;
    const exitY = y1 + offset;
    const enterY = y2 + offset;
    const sy = enterY > exitY ? 1 : -1;
    const cr = Math.min(r, Math.abs(exitX - leftChannel) / 2, Math.abs(enterY - exitY) / 4);

    if (cr < 1) return `M ${exitX} ${exitY} L ${leftChannel} ${exitY} L ${leftChannel} ${enterY} L ${enterX} ${enterY}`;

    return [
      `M ${exitX} ${exitY}`,
      `L ${leftChannel + cr} ${exitY}`,
      `Q ${leftChannel} ${exitY} ${leftChannel} ${exitY + sy * cr}`,
      `L ${leftChannel} ${enterY - sy * cr}`,
      `Q ${leftChannel} ${enterY} ${leftChannel + cr} ${enterY}`,
      `L ${enterX} ${enterY}`,
    ].join(' ');
  }

  // ── Bank-to-infra: exit RIGHT edge → mid-channel → vertical → horizontal to infra ──
  // Uses a mid-channel between banks and infra so vertical segment doesn't pass through infra nodes
  if (srcIsBank && !dstIsBank) {
    const APAD = 6;
    const exitX = x1 + HW;
    const exitY = y1 + offset;
    const midX = x1 + HW + 60 + Math.abs(offset); // vertical channel between banks and infra
    const cr = Math.min(r, Math.abs(midX - exitX) / 2, Math.abs(y2 - exitY) / 2, Math.abs(x2 - midX) / 2);

    if (cr < 1 || Math.abs(y2 - exitY) < 3) {
      return `M ${exitX} ${exitY} L ${x2 - APAD} ${y2}`;
    }

    const sy = y2 > exitY ? 1 : -1;
    return [
      `M ${exitX} ${exitY}`,
      `L ${midX - cr} ${exitY}`,
      `Q ${midX} ${exitY} ${midX} ${exitY + sy * cr}`,
      `L ${midX} ${y2 - sy * cr}`,
      `Q ${midX} ${y2} ${midX + cr} ${y2}`,
      `L ${x2 - APAD} ${y2}`,
    ].join(' ');
  }

  // ── Infra-to-bank: from infra → mid-channel → vertical → horizontal into bank RIGHT edge ──
  if (!srcIsBank && dstIsBank) {
    const APAD = 6;
    const enterX = x2 + HW + APAD;
    const enterY = y2 + offset;
    const midX = x2 + HW + 60 + Math.abs(offset); // same mid-channel
    const cr = Math.min(r, Math.abs(midX - enterX) / 2, Math.abs(enterY - y1) / 2, Math.abs(x1 - midX) / 2);

    if (cr < 1 || Math.abs(enterY - y1) < 3) {
      return `M ${x1} ${y1} L ${enterX} ${enterY}`;
    }

    const sy = enterY > y1 ? 1 : -1;
    return [
      `M ${x1} ${y1}`,
      `L ${midX + cr} ${y1}`,
      `Q ${midX} ${y1} ${midX} ${y1 + sy * cr}`,
      `L ${midX} ${enterY - sy * cr}`,
      `Q ${midX} ${enterY} ${midX - cr} ${enterY}`,
      `L ${enterX} ${enterY}`,
    ].join(' ');
  }

  // Fallback: straight line (infra-to-infra, shouldn't happen)
  return `M ${x1} ${y1} L ${x2} ${y2}`;
}


// ============================================================
// Component
// ============================================================

export function Visualizer() {
  const navigate = useNavigate();
  const { resolved } = useTheme();
  const isDark = resolved === 'dark';
  const { activeBanks: unsortedBanks, cacheVersion } = useBanks();
  const banks = [...unsortedBanks].sort((a, b) => a.name.localeCompare(b.name));

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

  // ── Zoom / Pan state ──
  const DEFAULT_VIEWBOX = { x: 20, y: 20, w: 640, h: 760 };
  const [viewBox, setViewBox] = useState(DEFAULT_VIEWBOX);
  const isPanning = useRef(false);
  const panStart = useRef({ x: 0, y: 0, vx: 0, vy: 0 });

  const zoomBy = useCallback((factor: number) => {
    setViewBox(vb => {
      const cx = vb.x + vb.w / 2;
      const cy = vb.y + vb.h / 2;
      const nw = vb.w * factor;
      const nh = vb.h * factor;
      return { x: cx - nw / 2, y: cy - nh / 2, w: nw, h: nh };
    });
  }, []);

  const resetZoom = useCallback(() => setViewBox(DEFAULT_VIEWBOX), []);

  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    const factor = e.deltaY > 0 ? 1.08 : 0.92;
    zoomBy(factor);
  }, [zoomBy]);

  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    isPanning.current = true;
    panStart.current = { x: e.clientX, y: e.clientY, vx: viewBox.x, vy: viewBox.y };
    (e.target as Element).setPointerCapture(e.pointerId);
  }, [viewBox.x, viewBox.y]);

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    if (!isPanning.current || !svgRef.current) return;
    const svg = svgRef.current;
    const rect = svg.getBoundingClientRect();
    const scaleX = viewBox.w / rect.width;
    const scaleY = viewBox.h / rect.height;
    const dx = (e.clientX - panStart.current.x) * scaleX;
    const dy = (e.clientY - panStart.current.y) * scaleY;
    setViewBox(vb => ({ ...vb, x: panStart.current.vx - dx, y: panStart.current.vy - dy }));
  }, [viewBox.w, viewBox.h]);

  const handlePointerUp = useCallback(() => {
    isPanning.current = false;
  }, []);

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

  // ── Single-column layout ──
  // Banks stacked vertically on the left; infra on the right.
  // Direct bank-to-bank lines route through the left channel.
  // Lockup lines detour right through Yield Vault.
  const gridLayout = (() => {
    const n = banks.length;
    if (n === 0) return { cols: 0, rows: 0, positions: [] as { x: number; y: number }[] };

    const rowH = 100; // vertical spacing between bank centers
    const bankX = 180; // single column X position
    const startY = 80;

    const positions: { x: number; y: number }[] = [];
    for (let i = 0; i < n; i++) {
      positions.push({ x: bankX, y: startY + i * rowH });
    }
    return { cols: 1, rows: n, positions };
  })();

  // Infrastructure nodes — right side, vertically centered
  const gridYs = gridLayout.positions.map(p => p.y);
  const minGridY = gridYs.length > 0 ? Math.min(...gridYs) : 80;
  const maxGridY = gridYs.length > 0 ? Math.max(...gridYs) : 480;
  const infraX = 560;
  const infraCenterY = (minGridY + maxGridY) / 2;

  const bnyNode: InfraNode = {
    id: 'bny',
    label: 'Yield Vault',
    sublabel: 'BNY',
    x: infraX,
    y: infraCenterY - 65,
    exists: bnyExists,
  };

  const rimarkNode: InfraNode = {
    id: 'rimark',
    label: 'Solstice',
    sublabel: 'Network Fees',
    x: infraX,
    y: infraCenterY + 65,
    exists: fees.feesExists,
  };

  const bankNodes: BankNode[] = banks.map((bank, i) => ({
    bank,
    wallet: wallets.find((w) => w.bank_id === bank.id) || null,
    x: gridLayout.positions[i]?.x ?? 400,
    y: gridLayout.positions[i]?.y ?? 220,
  }));

  const getBankNode = (bankId: string) => bankNodes.find((n) => n.bank.id === bankId);

  // Per-bank transaction counts
  const bankTxCounts = new Map<string, { sent: number; received: number; settled: number }>();
  for (const tx of transactions) {
    const s = bankTxCounts.get(tx.sender_bank_id) ?? { sent: 0, received: 0, settled: 0 };
    s.sent++;
    if (tx.status === 'settled') s.settled++;
    bankTxCounts.set(tx.sender_bank_id, s);

    const r = bankTxCounts.get(tx.receiver_bank_id) ?? { sent: 0, received: 0, settled: 0 };
    r.received++;
    if (tx.status === 'settled') r.settled++;
    bankTxCounts.set(tx.receiver_bank_id, r);
  }

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

  const pageStats: PageStat[] = [
    { icon: Activity, value: lockupActive.length, label: 'Active Lockups' },
    { icon: AlertOctagon, value: lockupSettled.length, label: 'Settled' },
    { icon: AlertOctagon, value: lockupReversed.length, label: 'Reversed' },
  ];
  if (orphanedTxs.length > 0) {
    pageStats.push({ icon: AlertOctagon, value: orphanedTxs.length, label: 'Orphaned' });
  }

  return (
    <div>
      <PageShell
        title="Live Settlement Flows"
        subtitle="Solstice Network real-time visualization"
        stats={pageStats}
      >
        <div className="flex gap-4" style={{ height: 'calc(100vh - 16rem)' }}>
        {/* ════ LEFT: Two-zone SVG Canvas ════ */}
        <div className="flex-1 min-w-0 flex flex-col overflow-hidden" style={{
          borderRadius: 20,
          border: `1px solid ${isDark ? 'rgba(255,255,255,0.1)' : 'rgba(255,255,255,0.7)'}`,
        }}>
          {/* Top zone: Outline only (transparent) — Legend */}
          <div className="px-5 py-2.5 flex items-center gap-5 transition-colors duration-500" style={{
            borderBottom: `1px solid ${isDark ? 'rgba(255,255,255,0.06)' : 'rgba(255,255,255,0.7)'}`,
          }}>
            {[
              { color: '#10b981', label: 'Low Risk', dash: false },
              { color: '#eab308', label: 'Med Risk', dash: false },
              { color: '#ef4444', label: 'High Risk', dash: false },
              { color: '#10b981', label: 'Settled', dash: false, opacity: 0.3 },
              { color: '#f59e0b', label: 'Lockup', dash: true },
              { color: '#ef4444', label: 'Reversed', dash: true },
              { color: '#10b981', label: 'Fee Flow', dash: true, opacity: 0.35 },
            ].map((item) => (
              <div key={item.label} className="flex items-center gap-1.5">
                <svg width="16" height="4" className="flex-shrink-0">
                  <line x1="0" y1="2" x2="16" y2="2"
                    stroke={item.color} strokeWidth="1.5"
                    strokeDasharray={item.dash ? '3 3' : 'none'}
                    strokeOpacity={item.opacity ?? 1} />
                </svg>
                <span className="text-[10px] text-coda-text-muted whitespace-nowrap">{item.label}</span>
              </div>
            ))}
          </div>

          {/* Bottom zone: Glass fill — Network Map */}
          <div className="flex-1 min-h-0 relative transition-colors duration-500" style={{
            backdropFilter: 'blur(20px)',
            WebkitBackdropFilter: 'blur(20px)',
            background: isDark ? 'rgba(255,255,255,0.05)' : 'rgba(255,255,255,0.55)',
            touchAction: 'none',
          }}>
            {/* Zoom controls */}
            {banks.length > 0 && (
              <div className="absolute top-3 right-3 z-10 flex flex-col gap-1">
                {[
                  { icon: ZoomIn, action: () => zoomBy(0.8), label: 'Zoom in' },
                  { icon: ZoomOut, action: () => zoomBy(1.25), label: 'Zoom out' },
                  { icon: Maximize, action: resetZoom, label: 'Reset zoom' },
                ].map(({ icon: Icon, action, label }) => (
                  <button
                    key={label}
                    onClick={action}
                    title={label}
                    className="w-8 h-8 rounded-lg flex items-center justify-center bg-white/60 dark:bg-white/10 backdrop-blur-sm border border-white/40 dark:border-white/10 text-coda-text-muted hover:text-coda-text transition-colors cursor-pointer"
                  >
                    <Icon size={14} />
                  </button>
                ))}
              </div>
            )}
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
              viewBox={`${viewBox.x} ${viewBox.y} ${viewBox.w} ${viewBox.h}`}
              className="absolute inset-0 w-full h-full cursor-grab active:cursor-grabbing"
              preserveAspectRatio="xMidYMid meet"
              onWheel={handleWheel}
              onPointerDown={handlePointerDown}
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerUp}
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
                <filter id="coda-brand-glow">
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
                <marker id="arrow-green" viewBox="0 0 10 10" refX="10" refY="5" markerWidth="8" markerHeight="8" markerUnits="userSpaceOnUse" orient="auto-start-reverse">
                  <path d="M 0 0 L 10 5 L 0 10 z" fill="#10b981" />
                </marker>
                <marker id="arrow-yellow" viewBox="0 0 10 10" refX="10" refY="5" markerWidth="8" markerHeight="8" markerUnits="userSpaceOnUse" orient="auto-start-reverse">
                  <path d="M 0 0 L 10 5 L 0 10 z" fill="#eab308" />
                </marker>
                <marker id="arrow-red" viewBox="0 0 10 10" refX="10" refY="5" markerWidth="8" markerHeight="8" markerUnits="userSpaceOnUse" orient="auto-start-reverse">
                  <path d="M 0 0 L 10 5 L 0 10 z" fill="#ef4444" />
                </marker>
                <marker id="arrow-gray" viewBox="0 0 10 10" refX="10" refY="5" markerWidth="8" markerHeight="8" markerUnits="userSpaceOnUse" orient="auto-start-reverse">
                  <path d="M 0 0 L 10 5 L 0 10 z" fill="#374151" />
                </marker>
                <marker id="arrow-amber" viewBox="0 0 10 10" refX="10" refY="5" markerWidth="8" markerHeight="8" markerUnits="userSpaceOnUse" orient="auto-start-reverse">
                  <path d="M 0 0 L 10 5 L 0 10 z" fill="#f59e0b" />
                </marker>
                <marker id="arrow-purple" viewBox="0 0 10 10" refX="10" refY="5" markerWidth="8" markerHeight="8" markerUnits="userSpaceOnUse" orient="auto-start-reverse">
                  <path d="M 0 0 L 10 5 L 0 10 z" fill="#a855f7" />
                </marker>
                <marker id="arrow-green-solid" viewBox="0 0 10 10" refX="10" refY="5" markerWidth="8" markerHeight="8" markerUnits="userSpaceOnUse" orient="auto-start-reverse">
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

              {/* ═══ LAYER 0: Grid guide lines (subtle) ═══ */}
              {gridLayout.positions.length > 0 && (() => {
                const xs = [...new Set(gridLayout.positions.map(p => p.x))].sort((a, b) => a - b);
                const ys = [...new Set(gridLayout.positions.map(p => p.y))].sort((a, b) => a - b);
                const minX = xs[0] - 70;
                const maxX = xs[xs.length - 1] + 70;
                const minY = ys[0] - 50;
                const maxY = ys[ys.length - 1] + 50;
                return (
                  <g>
                    {ys.map(y => (
                      <line key={`gy-${y}`} x1={minX} y1={y} x2={maxX} y2={y}
                        stroke="var(--coda-border)" strokeWidth="0.5" strokeOpacity="0.06" />
                    ))}
                    {xs.map(x => (
                      <line key={`gx-${x}`} x1={x} y1={minY} x2={x} y2={maxY}
                        stroke="var(--coda-border)" strokeWidth="0.5" strokeOpacity="0.06" />
                    ))}
                  </g>
                );
              })()}

              {/* ═══ LAYER 2: Direct settled paths (Manhattan routed) ═══ */}
              {directSettled.map((tx, i) => {
                const from = getBankNode(tx.sender_bank_id);
                const to = getBankNode(tx.receiver_bank_id);
                if (!from || !to) return null;
                const bias = 0.4 + (i % 3) * 0.1;
                return (
                  <path key={`settled-${tx.id}`}
                    d={gridRoute(from.x, from.y, to.x, to.y, gridLayout.positions, i, 12)}
                    fill="none" stroke="#10b981" strokeWidth="1.5" strokeOpacity="0.25"
                    markerEnd="url(#arrow-green)" />
                );
              })}

              {/* ═══ LAYER 3: Direct locked paths ═══ */}
              {directLocked.map((tx, i) => {
                const from = getBankNode(tx.sender_bank_id);
                const to = getBankNode(tx.receiver_bank_id);
                if (!from || !to) return null;
                return (
                  <path key={`locked-${tx.id}`}
                    d={gridRoute(from.x, from.y, to.x, to.y, gridLayout.positions, i, 12)}
                    fill="none" stroke="#a855f7" strokeWidth="1.5" strokeDasharray="6 4"
                    className="locked-pulse" />
                );
              })}

              {/* ═══ LAYER 4: Lockup settled paths (sender → BNY → receiver) ═══ */}
              {showBny && lockupSettled.map((tx, i) => {
                const from = getBankNode(tx.sender_bank_id);
                const to = getBankNode(tx.receiver_bank_id);
                if (!from || !to) return null;
                const bias = 0.35 + (i % 4) * 0.08;
                return (
                  <g key={`lockup-settled-${tx.id}`}>
                    <path d={gridRoute(from.x, from.y, bnyNode.x, bnyNode.y, gridLayout.positions, i, 12)}
                      fill="none" stroke="#10b981" strokeWidth="1" strokeOpacity="0.25"
                      markerEnd="url(#arrow-green-solid)" />
                    <path d={gridRoute(bnyNode.x, bnyNode.y, to.x, to.y, gridLayout.positions, i + 50, 12)}
                      fill="none" stroke="#10b981" strokeWidth="1" strokeOpacity="0.25"
                      markerEnd="url(#arrow-green-solid)" />
                  </g>
                );
              })}

              {/* ═══ LAYER 5: Lockup reversed paths ═══ */}
              {showBny && lockupReversed.map((tx, i) => {
                const from = getBankNode(tx.sender_bank_id);
                const to = getBankNode(tx.receiver_bank_id);
                if (!from || !to) return null;
                const bias = 0.4 + (i % 3) * 0.08;
                return (
                  <g key={`lockup-reversed-${tx.id}`}>
                    <path d={gridRoute(bnyNode.x, bnyNode.y, from.x, from.y, gridLayout.positions, i, 12)}
                      fill="none" stroke="#ef4444" strokeWidth="1.5" strokeDasharray="4 8"
                      className="reversal-flash" markerEnd="url(#arrow-red)" />
                    <path d={gridRoute(to.x, to.y, bnyNode.x, bnyNode.y, gridLayout.positions, i + 50, 12)}
                      fill="none" stroke="#ef4444" strokeWidth="1" strokeOpacity="0.1" />
                    {(() => {
                      const lp = labelPos(bnyNode.x, bnyNode.y, from.x, from.y, -12);
                      return (
                        <text x={lp.x} y={lp.y} textAnchor="middle"
                          className="text-[7px]" fontWeight="700" fill="#ef4444">
                          REVERSED
                        </text>
                      );
                    })()}
                  </g>
                );
              })}

              {/* ═══ LAYER 6: Active lockup paths (sender → BNY → receiver) ═══ */}
              {showBny && lockupActive.map((tx, i) => {
                const from = getBankNode(tx.sender_bank_id);
                const to = getBankNode(tx.receiver_bank_id);
                if (!from || !to) return null;
                const isEscalated = tx.lockup_status === 'cadenza_escalated';
                const isFlagged = tx.lockup_status === 'cadenza_flagged';
                const bias = 0.35 + (i % 4) * 0.08;

                return (
                  <g key={`lockup-active-${tx.id}`}>
                    {/* Sender → BNY (amber) */}
                    <path d={gridRoute(from.x, from.y, bnyNode.x, bnyNode.y, gridLayout.positions, i, 14)}
                      fill="none" stroke="#f59e0b" strokeWidth="1.5" strokeOpacity="0.2" />
                    <path d={gridRoute(from.x, from.y, bnyNode.x, bnyNode.y, gridLayout.positions, i, 14)}
                      fill="none" stroke="#f59e0b" strokeWidth="1.5" strokeDasharray="6 18"
                      className="lockup-flow" markerEnd="url(#arrow-amber)" />
                    {/* BNY → Receiver (purple) */}
                    <path d={gridRoute(bnyNode.x, bnyNode.y, to.x, to.y, gridLayout.positions, i + 50, 14)}
                      fill="none" stroke="#a855f7" strokeWidth="1.5" strokeOpacity="0.2" />
                    <path d={gridRoute(bnyNode.x, bnyNode.y, to.x, to.y, gridLayout.positions, i + 50, 14)}
                      fill="none" stroke="#a855f7" strokeWidth="1.5" strokeDasharray="6 18"
                      className="lockup-flow" markerEnd="url(#arrow-purple)" />
                    {/* Labels */}
                    {(() => {
                      const lp = labelPos(from.x, from.y, bnyNode.x, bnyNode.y, -14);
                      return (
                        <text x={lp.x} y={lp.y} textAnchor="middle"
                          className="text-[7px]" fill="#f59e0b">
                          {formatTokenAmount(tx.amount)} USDYB
                        </text>
                      );
                    })()}
                    {(() => {
                      const lp = labelPos(bnyNode.x, bnyNode.y, to.x, to.y, -14);
                      return (
                        <text x={lp.x} y={lp.y} textAnchor="middle"
                          className="text-[7px]" fill="#a855f7">
                          {formatTokenAmount(tx.amount)} USTB
                        </text>
                      );
                    })()}
                    {(isEscalated || isFlagged) && (() => {
                      const lp = labelPos(from.x, from.y, to.x, to.y, 18);
                      return (
                        <text x={lp.x} y={lp.y} textAnchor="middle"
                          className="text-[7px]" fontWeight="700"
                          fill={isEscalated ? '#a855f7' : '#f59e0b'}>
                          {isEscalated ? 'ESCALATED' : 'FLAGGED'}
                        </text>
                      );
                    })()}
                  </g>
                );
              })}

              {/* ═══ LAYER 7: Orphaned transaction paths ═══ */}
              {orphanedTxs.map((tx, i) => {
                const from = getBankNode(tx.sender_bank_id);
                const to = getBankNode(tx.receiver_bank_id);
                if (!from || !to) return null;
                const mx = (from.x + to.x) / 2;
                const my = (from.y + to.y) / 2;
                return (
                  <g key={`orphan-${tx.id}`}>
                    <path d={gridRoute(from.x, from.y, to.x, to.y, gridLayout.positions, i, 12)}
                      fill="none" stroke="#f59e0b" strokeWidth="2" strokeDasharray="3 8"
                      className="orphan-pulse" markerEnd="url(#arrow-amber)" />
                    <text x={mx} y={my - 8} textAnchor="middle"
                      className="text-[7px]" fontWeight="700" fill="#f59e0b">
                      ORPHANED — {formatTokenAmount(tx.amount)}
                    </text>
                    <text x={mx} y={my + 4} textAnchor="middle"
                      className="text-[7px]" fill="#92400e">
                      {getOrphanAge(tx)} stuck
                    </text>
                  </g>
                );
              })}

              {/* ═══ LAYER 8: Healthy direct active paths (animated) ═══ */}
              {healthyDirectActive.map((tx, i) => {
                const from = getBankNode(tx.sender_bank_id);
                const to = getBankNode(tx.receiver_bank_id);
                if (!from || !to) return null;
                const riskColor = tx.risk_level === 'high' ? '#ef4444' : tx.risk_level === 'medium' ? '#eab308' : '#10b981';
                const arrowId = tx.risk_level === 'high' ? 'arrow-red' : tx.risk_level === 'medium' ? 'arrow-yellow' : 'arrow-green';
                const bias = 0.4 + (i % 3) * 0.1;
                const mx = (from.x + to.x) / 2;
                const my = (from.y + to.y) / 2;

                return (
                  <g key={`active-${tx.id}`}>
                    <path d={gridRoute(from.x, from.y, to.x, to.y, gridLayout.positions, i, 12)}
                      fill="none" stroke={riskColor} strokeWidth="1.5" strokeOpacity="0.2" />
                    <path d={gridRoute(from.x, from.y, to.x, to.y, gridLayout.positions, i, 12)}
                      fill="none" stroke={riskColor} strokeWidth="1.5" strokeDasharray="5 15"
                      className="active-flow" markerEnd={`url(#${arrowId})`} />
                    <text x={mx} y={my - 6} textAnchor="middle"
                      className="text-[8px]" fill={riskColor}>
                      {formatTokenAmount(tx.amount)}
                    </text>
                    <text x={mx} y={my + 5} textAnchor="middle"
                      className="text-[7px]" fill="var(--coda-text-muted)">
                      {TX_STATUS_CONFIG[tx.status]?.label}
                    </text>
                  </g>
                );
              })}

              {/* ═══ LAYER 8b: Animated particles on active paths ═══ */}
              {healthyDirectActive.map((tx, i) => {
                const from = getBankNode(tx.sender_bank_id);
                const to = getBankNode(tx.receiver_bank_id);
                if (!from || !to) return null;
                const riskColor = tx.risk_level === 'high' ? '#ef4444' : tx.risk_level === 'medium' ? '#eab308' : '#10b981';
                const bias = 0.4 + (i % 3) * 0.1;
                const d = gridRoute(from.x, from.y, to.x, to.y, gridLayout.positions, i, 12);
                const dur = 2 + (i % 3) * 0.5;
                return (
                  <g key={`particle-direct-${tx.id}`}>
                    <circle r="2" fill={riskColor} opacity="0.9">
                      <animateMotion dur={`${dur}s`} repeatCount="indefinite" path={d} />
                    </circle>
                    <circle r="1" fill="white" opacity="0.6">
                      <animateMotion dur={`${dur}s`} repeatCount="indefinite" path={d} begin={`${dur * 0.5}s`} />
                    </circle>
                  </g>
                );
              })}

              {/* Lockup active particles (sender → BNY leg) */}
              {showBny && lockupActive.map((tx, i) => {
                const from = getBankNode(tx.sender_bank_id);
                const to = getBankNode(tx.receiver_bank_id);
                if (!from || !to) return null;
                const bias = 0.35 + (i % 4) * 0.08;
                const d1 = gridRoute(from.x, from.y, bnyNode.x, bnyNode.y, gridLayout.positions, i, 14);
                const d2 = gridRoute(bnyNode.x, bnyNode.y, to.x, to.y, gridLayout.positions, i + 50, 14);
                const dur = 2.5 + (i % 3) * 0.4;
                return (
                  <g key={`particle-lockup-${tx.id}`}>
                    <circle r="2" fill="#f59e0b" opacity="0.85">
                      <animateMotion dur={`${dur}s`} repeatCount="indefinite" path={d1} />
                    </circle>
                    <circle r="2" fill="#a855f7" opacity="0.85">
                      <animateMotion dur={`${dur}s`} repeatCount="indefinite" path={d2} />
                    </circle>
                  </g>
                );
              })}

              {/* ═══ Fee connections: Bank → Solstice Network Fees ═══ */}
              {showRimark && bankNodes.map((node, i) => {
                const counts = bankTxCounts.get(node.bank.id);
                if (!counts || counts.sent + counts.received === 0) return null;
                // Fee lines use a wider mid-channel (further right) to separate from solid lockup lines
                const feeSlot = (i % 7 - 3) * 4;
                const feeExitX = node.x + 60;
                const feeExitY = node.y + feeSlot;
                const feeMidX = node.x + 60 + 120 + Math.abs(feeSlot); // further right than lockup mid-channel
                const feeTargetX = rimarkNode.x - 50; // left edge of Solstice card
                const feeTargetY = rimarkNode.y;
                const fcr = 8;
                const fsy = feeTargetY > feeExitY ? 1 : -1;
                const d = Math.abs(feeTargetY - feeExitY) < 3
                  ? `M ${feeExitX} ${feeExitY} L ${feeTargetX} ${feeTargetY}`
                  : [
                    `M ${feeExitX} ${feeExitY}`,
                    `L ${feeMidX - fcr} ${feeExitY}`,
                    `Q ${feeMidX} ${feeExitY} ${feeMidX} ${feeExitY + fsy * fcr}`,
                    `L ${feeMidX} ${feeTargetY - fsy * fcr}`,
                    `Q ${feeMidX} ${feeTargetY} ${feeMidX + fcr} ${feeTargetY}`,
                    `L ${feeTargetX} ${feeTargetY}`,
                  ].join(' ');
                return (
                  <g key={`fee-${node.bank.id}`}>
                    <path d={d}
                      fill="none" stroke="#10b981" strokeWidth="1" strokeDasharray="3 6"
                      strokeOpacity="0.8" />
                    {/* Subtle fee particle */}
                    <circle r="1.2" fill="#10b981" opacity="0.5">
                      <animateMotion dur={`${4 + i * 0.6}s`} repeatCount="indefinite" path={d} />
                    </circle>
                  </g>
                );
              })}

              {/* ═══ LAYER 9: Bank Nodes (detailed cards) ═══ */}
              {bankNodes.map((node) => {
                const pw = 120, ph = 72;
                const counts = bankTxCounts.get(node.bank.id) ?? { sent: 0, received: 0, settled: 0 };
                const isActive = node.bank.status === 'active';
                return (
                  <g key={node.bank.id}>
                    {/* Glass card */}
                    <rect x={node.x - pw/2} y={node.y - ph/2} width={pw} height={ph}
                      rx={14} fill="var(--coda-surface)" fillOpacity="0.92"
                      stroke="var(--coda-border)" strokeWidth="1" />
                    {/* Status dot (top-right) */}
                    <circle cx={node.x + pw/2 - 12} cy={node.y - ph/2 + 12} r={3}
                      fill={isActive ? '#10b981' : '#ef4444'} />
                    {/* Bank code */}
                    <text x={node.x} y={node.y - 14} textAnchor="middle"
                      className="text-[14px]" fontWeight="500" fill="var(--coda-text)">
                      {node.bank.short_code}
                    </text>
                    {/* Balance */}
                    <text x={node.x} y={node.y - 2} textAnchor="middle"
                      className="text-[10px]" fill="#10b981" fontWeight="500">
                      {node.wallet ? formatTokenAmount(node.wallet.balance_tokens) : '$0'}
                    </text>
                    {/* Divider */}
                    <line x1={node.x - pw/2 + 14} y1={node.y + 8} x2={node.x + pw/2 - 14} y2={node.y + 8}
                      stroke="var(--coda-border)" strokeWidth="0.5" strokeOpacity="0.4" />
                    {/* Bottom row: jurisdiction • sent/received • token */}
                    <text x={node.x} y={node.y + 23} textAnchor="middle"
                      className="text-[7px]" fill="var(--coda-text-muted)">
                      {[
                        node.bank.jurisdiction,
                        counts.sent + counts.received > 0 ? `${counts.sent}↑ ${counts.received}↓` : null,
                        node.bank.token_symbol,
                      ].filter(Boolean).join('  ·  ')}
                    </text>
                  </g>
                );
              })}

              {/* ═══ LAYER 10+11: Infrastructure cluster (BNY + Solstice) ═══ */}
              {(showBny || showRimark) && (
                <g>
                  {/* Infrastructure label */}
                  <text x={infraX} y={bnyNode.y - 38} textAnchor="middle"
                    className="text-[8px]" fill="var(--coda-text-muted)" fillOpacity="0.6">
                    Infrastructure
                  </text>

                  {/* BNY Custodian */}
                  {showBny && (
                    <g>
                      <rect x={bnyNode.x - 50} y={bnyNode.y - 30} width={100} height={60}
                        rx={12} fill="var(--coda-surface)" fillOpacity="0.9"
                        stroke="var(--coda-border)" strokeWidth="1" />
                      <text x={bnyNode.x} y={bnyNode.y - 6} textAnchor="middle"
                        className="text-[10px]" fontWeight="600" fill="var(--coda-text)">
                        Yield Vault
                      </text>
                      <text x={bnyNode.x} y={bnyNode.y + 6} textAnchor="middle"
                        className="text-[7px]" fill="var(--coda-text-muted)">
                        BNY
                      </text>
                      {bnyActiveLockups > 0 && (
                        <text x={bnyNode.x} y={bnyNode.y + 17} textAnchor="middle"
                          className="text-[7px]" fill="var(--coda-text-muted)">
                          {bnyActiveLockups} lockup{bnyActiveLockups !== 1 ? 's' : ''}
                        </text>
                      )}
                    </g>
                  )}

                  {/* Solstice Fees */}
                  {showRimark && (
                    <g>
                      <rect x={rimarkNode.x - 50} y={rimarkNode.y - 30} width={100} height={60}
                        rx={12} fill="var(--coda-surface)" fillOpacity="0.9"
                        stroke="var(--coda-border)" strokeWidth="1" />
                      <text x={rimarkNode.x} y={rimarkNode.y - 6} textAnchor="middle"
                        className="text-[11px]" fontWeight="600" fill="var(--coda-text)">
                        Solstice
                      </text>
                      <text x={rimarkNode.x} y={rimarkNode.y + 6} textAnchor="middle"
                        className="text-[7px]" fill="var(--coda-text-muted)">
                        Network Fees
                      </text>
                      <text x={rimarkNode.x} y={rimarkNode.y + 17} textAnchor="middle"
                        className="text-[8px]" fill="#10b981">
                        {fees.feesBalance > 0 ? formatYield(fees.feesBalance) : '$0.00'}
                      </text>
                    </g>
                  )}

                  {/* Yield sweep connector between BNY and Solstice */}
                  {showBny && showRimark && (
                    <line
                      x1={bnyNode.x} y1={bnyNode.y + 24}
                      x2={rimarkNode.x} y2={rimarkNode.y - 24}
                      stroke="#10b981" strokeWidth="1" strokeDasharray="3 6"
                      strokeOpacity="0.25" className="yield-sweep-flow" />
                  )}
                </g>
              )}

            </svg>
          )}
          </div>

        </div>

        {/* ════ RIGHT: Transaction Log ════ */}
        <WidgetShell
          title="Transaction Log"
          className="w-[320px] xl:w-[360px] flex-shrink-0 flex flex-col overflow-hidden"
          headerRight={
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
          }
        >

          <div className="flex-1 overflow-y-auto -mx-5 px-5 scrollbar-thin">
            {transactions.length === 0 && (
              <div className="text-center text-xs text-coda-text-muted py-8">
                No transactions yet
              </div>
            )}

            {transactions.map((tx, txIdx) => {
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
                ? tx.lockup_status === 'cadenza_escalated' ? 'bg-coda-brand/15 text-coda-brand'
                : tx.lockup_status === 'cadenza_flagged' ? 'bg-amber-500/15 text-amber-400'
                : tx.lockup_status === 'reversed' ? 'bg-red-500/15 text-red-400'
                : tx.lockup_status === 'hard_finality' ? 'bg-emerald-500/15 text-emerald-400'
                : isActiveLockup(tx) ? 'bg-amber-500/15 text-amber-400'
                : ''
                : '';

              const statusBadgeClass = orphaned
                ? 'bg-amber-500/15 text-amber-400'
                : isExpiredRejection
                ? 'bg-white/8 text-coda-text-muted'
                : `${statusConfig.bg} ${statusConfig.color}`;

              return (
                <div
                  key={tx.id}
                  onClick={() => navigate(`/transactions/${tx.id}`)}
                  className={`flex items-start gap-2 py-2.5 border-t border-black/[0.06] dark:border-white/[0.06] cursor-pointer
                    hover:bg-black/[0.02] dark:hover:bg-white/[0.02] transition-colors
                    ${txIdx === 0 ? 'border-t-0' : ''}
                    ${orphaned ? 'bg-amber-500/[0.02]' : ''}
                  `}
                >
                  {/* Route column */}
                  <div className="flex-1 min-w-0">
                    <p className="text-xs text-coda-text-secondary leading-snug">
                      {hasLockup
                        ? <>{senderCode} <span className="text-coda-text-muted">→</span> BNY <span className="text-coda-text-muted">→</span> {receiverCode}</>
                        : <>{senderCode} <span className="text-coda-text-muted">→</span> {receiverCode}</>
                      }
                    </p>
                    <div className="flex items-center gap-2 mt-0.5">
                      <span className="text-[10px] font-mono font-medium text-coda-text">
                        {formatTokenAmount(tx.amount)}
                      </span>
                    </div>
                    {tx.solana_tx_signature && (
                      <a
                        href={explorerUrl(tx.solana_tx_signature)}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={(e) => e.stopPropagation()}
                        className="text-[10px] text-blue-500 dark:text-blue-400 hover:text-blue-400 dark:hover:text-blue-300 mt-0.5 inline-block font-mono"
                      >
                        {truncateAddress(tx.solana_tx_signature, 6)}
                      </a>
                    )}
                  </div>

                  {/* Status badges */}
                  <div className="flex flex-col items-end gap-1 flex-shrink-0 pt-0.5">
                    <div className="flex items-center gap-1">
                      {orphaned && (
                        <AlertOctagon className="w-2.5 h-2.5 text-amber-400 animate-pulse" />
                      )}
                      {lockupLabel && (
                        <span className={`inline-flex px-1.5 py-0.5 rounded text-[9px] font-medium uppercase tracking-wide ${lockupColor}`}>
                          {lockupLabel}
                        </span>
                      )}
                      <span className={`inline-flex px-1.5 py-0.5 rounded text-[9px] font-medium uppercase tracking-wide ${statusBadgeClass}`}>
                        {orphaned ? 'Orphaned' : isExpiredRejection ? 'Expired' : statusConfig.label}
                      </span>
                    </div>
                    <span className="text-[10px] text-coda-text-muted tabular-nums">
                      {orphaned
                        ? `${getOrphanAge(tx)} stuck`
                        : new Date(tx.created_at).toLocaleTimeString()
                      }
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </WidgetShell>
        </div>
      </PageShell>
    </div>
  );
}