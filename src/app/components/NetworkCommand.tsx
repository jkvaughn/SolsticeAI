/**
 * NetworkCommand — War room globe visualization page
 *
 * Renders inside DashboardLayout (sidebar persists).
 * Uses fixed positioning to go edge-to-edge over the entire viewport.
 *
 * Layout:
 *   - Floating header bar (glassmorphic, responsive to sidebar)
 *   - Full-bleed dark Mapbox globe (fills entire viewport)
 *   - Floating metrics badges (bottom-right, over globe)
 *   - Floating Cadenza status pill (top-right, over globe)
 *   - Event ticker (bottom strip, full width)
 */

import { useEffect, useRef } from 'react';
import { Play, Square, RotateCcw } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import {
  useNetworkSimulation,
} from '../hooks/useNetworkSimulation';
import { GlobeCanvas } from './network-command/GlobeCanvas';
import { useLayout } from '../contexts/LayoutContext';
import { useTheme } from './ThemeProvider';

// ============================================================
// Formatters
// ============================================================

function formatTps(n: number): string {
  return n.toLocaleString('en-US', { maximumFractionDigits: 0 });
}

function formatVolume(v: number): string {
  if (v >= 1e9) return `$${(v / 1e9).toFixed(2)}B`;
  if (v >= 1e6) return `$${(v / 1e6).toFixed(2)}M`;
  if (v >= 1e3) return `$${(v / 1e3).toFixed(1)}K`;
  return `$${v.toFixed(0)}`;
}

function timeAgo(iso: string): string {
  const d = Date.now() - new Date(iso).getTime();
  if (d < 0) return 'now';
  const s = Math.floor(d / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  return `${Math.floor(m / 60)}h`;
}

// ============================================================
// Sub-components
// ============================================================

function UtcClock() {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const up = () => {
      if (ref.current) ref.current.textContent = new Date().toISOString().slice(11, 19) + ' UTC';
    };
    up();
    const id = setInterval(up, 1000);
    return () => clearInterval(id);
  }, []);
  return <span ref={ref} className="font-mono text-sm text-black/50 dark:text-white/70 tabular-nums" />;
}

function TickerContent({ events }: { events: typeof import('../hooks/useNetworkSimulation').NetworkSimulationState extends never ? never : any[] }) {
  if (!events || events.length === 0) {
    return (
      <span className="px-8 text-emerald-600/50 dark:text-emerald-500/50 text-[11px] font-mono">
        Awaiting settlements&hellip;
      </span>
    );
  }

  const MC: Record<string, string> = {
    pvp_burn_mint:          'text-emerald-600 dark:text-emerald-400',
    lockup_hard_finality:   'text-amber-600   dark:text-amber-400',
    lockup_reversal:        'text-red-600     dark:text-red-400',
    lockup_user_reversal:   'text-red-600     dark:text-red-400',
  };
  const ML: Record<string, string> = {
    pvp_burn_mint:        'PvP',
    lockup_hard_finality: 'Lockup',
    lockup_reversal:      'Reversed',
    lockup_user_reversal: 'User Rev',
  };

  return (
    <>
      {events.map((ev: any, i: number) => (
        <span key={`${ev.id}-${i}`} className="inline-flex items-center">
          <span className={`text-[11px] font-mono whitespace-nowrap ${MC[ev.settlement_method] || 'text-coda-text-secondary'}`}>
            {ev.sender_code} &rarr; {ev.receiver_code}{' '}
            <span className="text-coda-text-secondary">${(ev.amount || 0).toLocaleString()}</span>
            {' \u00b7 '}
            <span className="text-coda-text-muted">{ML[ev.settlement_method] || ev.settlement_method}</span>
            {' \u00b7 '}
            <span className="text-coda-text-faint">{timeAgo(ev.settled_at)}</span>
          </span>
          <span className="text-coda-text-faint mx-3">&middot;&middot;&middot;</span>
        </span>
      ))}
    </>
  );
}

// ============================================================
// Main Component
// ============================================================
export function NetworkCommand() {
  const { state: sim, start, stop, reset } = useNetworkSimulation();
  const { sidebarWidth } = useLayout();
  const { theme } = useTheme();

  // Ticker scroll via rAF
  const tickerRef = useRef<HTMLDivElement>(null);
  const tickerRaf = useRef(0);
  const tickerPaused = useRef(false);
  const tpsRef = useRef(sim.tps);
  tpsRef.current = sim.tps;

  useEffect(() => {
    let offset = 0;
    function tick() {
      if (tickerRef.current && !tickerPaused.current) {
        const speed = 0.5 + Math.min(1.5, tpsRef.current / 10000);
        offset += speed;
        const half = tickerRef.current.scrollWidth / 2;
        if (half > 0 && offset >= half) offset -= half;
        tickerRef.current.style.transform = `translateX(-${offset}px)`;
      }
      tickerRaf.current = requestAnimationFrame(tick);
    }
    tickerRaf.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(tickerRaf.current);
  }, []);

  const flagCount = sim.cadenzaFlags.length;

  return (
    <div className="fixed inset-0 z-0 pointer-events-none bg-coda-bg">

      {/* ===== GLOBE — FULL BLEED (behind everything) ===== */}
      <div className="absolute inset-0 pointer-events-auto">
        <GlobeCanvas sim={sim} sidebarWidth={sidebarWidth} />
      </div>

      {/* ===== HEARTBEAT BANNER ===== */}
      <AnimatePresence>
        {sim.heartbeatBanner && (
          <motion.div
            key="hb-banner"
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            transition={{ duration: 0.3 }}
            className="absolute top-16 left-1/2 -translate-x-1/2 z-50 px-6 py-2.5 squircle-sm dashboard-card-subtle pointer-events-auto"
          >
            <span className="text-emerald-600 dark:text-emerald-400 font-mono text-sm font-semibold tracking-wider">
              CYCLE COMPLETE
            </span>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ===== FLOATING HEADER BAR ===== */}
      <header
        className="absolute top-4 right-4 z-20 flex items-center justify-between px-5 py-3 squircle-lg backdrop-blur-xl border border-black/10 dark:border-white/10 shadow-2xl bg-white/60 dark:bg-white/5 transition-all duration-500 pointer-events-auto"
        style={{ left: `${sidebarWidth + 16}px` }}
      >
        <div>
          <h1 className="text-sm font-semibold tracking-[0.2em] uppercase text-black/80 dark:text-white/90">
            Network Command
          </h1>
          <p className="text-[10px] text-black/30 dark:text-white/30 tracking-wider">
            Solstice Network &mdash; Institutional Settlement Layer
          </p>
        </div>

        <div className="flex items-center gap-4">
          <UtcClock />

          <div className="flex items-center gap-1.5">
            {!sim.running ? (
              <button
                onClick={start}
                disabled={!sim.metricsLoaded}
                className="flex items-center gap-1.5 px-3 py-1.5 squircle-sm bg-emerald-500/15 hover:bg-emerald-500/25 border border-emerald-500/30 text-emerald-600 dark:text-emerald-400 text-[10px] font-mono font-semibold uppercase tracking-wider transition-colors disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
              >
                <Play size={12} fill="currentColor" />
                {sim.metricsLoaded ? 'Start' : 'Loading\u2026'}
              </button>
            ) : (
              <button
                onClick={stop}
                className="flex items-center gap-1.5 px-3 py-1.5 squircle-sm bg-red-500/15 hover:bg-red-500/25 border border-red-500/30 text-red-600 dark:text-red-400 text-[10px] font-mono font-semibold uppercase tracking-wider transition-colors cursor-pointer"
              >
                <Square size={10} fill="currentColor" />
                Stop
              </button>
            )}
            <button
              onClick={reset}
              disabled={sim.running}
              className="flex items-center justify-center w-7 h-7 squircle-sm hover:bg-black/10 dark:hover:bg-white/10 border border-black/10 dark:border-white/10 text-black/40 dark:text-white/40 transition-colors disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer"
              title="Reset counters"
            >
              <RotateCcw size={12} />
            </button>
          </div>

          <span className={`px-2.5 py-1 rounded-full text-[10px] font-mono font-semibold tracking-wider uppercase border ${
            sim.networkMode === 'production'
              ? 'bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/25'
              : 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/25'
          }`}>
            {sim.networkMode}
          </span>
        </div>
      </header>

      {/* ── Floating metrics (bottom-right) ── */}
      <div className="absolute bottom-14 right-4 z-10 flex flex-col gap-2 pointer-events-none select-none">
        <FloatingMetric label="TPS" value={formatTps(sim.tps)} />
        <FloatingMetric label="Confirmed" value={sim.confirmedTxs.toLocaleString()} />
        <FloatingMetric label="Settled" value={formatVolume(sim.volumeSettled)} />
        <FloatingMetric label="Lockups" value={sim.activeLockups.toString()} />
        <FloatingMetric label="Yield" value={`$${sim.yieldAccruing >= 1e3 ? (sim.yieldAccruing / 1e3).toFixed(2) + 'K' : sim.yieldAccruing.toFixed(2)}`} />
        <FloatingMetric label="Fees" value={`$${sim.feesCollected >= 1e3 ? (sim.feesCollected / 1e3).toFixed(2) + 'K' : sim.feesCollected.toFixed(2)}`} />
        {flagCount === 0 ? (
          <FloatingMetric label="Cadenza" value="NOMINAL" variant="ok" />
        ) : (
          <FloatingMetric label="Cadenza" value={`${flagCount} FLAG${flagCount > 1 ? 'S' : ''}`} variant="alert" />
        )}
      </div>

      {/* ===== EVENT TICKER (bottom strip) ===== */}
      <div
        className="absolute bottom-0 left-0 right-0 z-10 h-9 border-t border-coda-border/20 backdrop-blur-md bg-coda-surface/40 overflow-hidden pointer-events-auto"
        onMouseEnter={() => { tickerPaused.current = true; }}
        onMouseLeave={() => { tickerPaused.current = false; }}
      >
        <div
          ref={tickerRef}
          className="flex items-center h-full whitespace-nowrap will-change-transform"
        >
          <TickerContent events={sim.settlementEvents} />
          <TickerContent events={sim.settlementEvents} />
        </div>
      </div>
    </div>
  );
}

// ── Small floating metric badge ────────────────────────────
function FloatingMetric({ label, value, variant }: { label: string; value: string; variant?: 'ok' | 'alert' }) {
  const bgClass = variant === 'ok'
    ? 'bg-emerald-500/10'
    : variant === 'alert'
      ? 'bg-red-500/10'
      : 'bg-white/60 dark:bg-black/40';
  const textClass = variant === 'ok'
    ? 'text-emerald-600 dark:text-emerald-400'
    : variant === 'alert'
      ? 'text-red-600 dark:text-red-400'
      : 'text-black/75 dark:text-white/75';
  const borderClass = variant === 'ok'
    ? 'border-emerald-500/25'
    : variant === 'alert'
      ? 'border-red-500/25'
      : 'border-black/8 dark:border-white/8';

  return (
    <div className={`flex items-baseline gap-2 px-3 py-1 rounded-lg ${bgClass} backdrop-blur-sm border ${borderClass}`}>
      <span className="text-[9px] uppercase tracking-wider text-black/35 dark:text-white/35 font-mono">{label}</span>
      <span className={`text-sm font-mono font-semibold ${textClass} tabular-nums`}>{value}</span>
    </div>
  );
}

export default NetworkCommand;