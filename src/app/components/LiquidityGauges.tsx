/**
 * LiquidityGauges — Visual arc gauges for per-bank liquidity conditions.
 *
 * Replaces the text-based "Per-Bank Conditions" section inside the expanded
 * CycleRow detail panel in HeartbeatControl.tsx.
 *
 * Each bank gets a 270° SVG arc gauge showing deployed % with:
 *  - Color coded by AVAILABLE balance (emerald >60%, amber 30-60%, red <30%)
 *  - Safety floor tick mark at 80% deployed position
 *  - Animated arc sweep on mount (stroke-dashoffset CSS transition)
 *  - Inflow/outflow indicators below gauge
 *  - Conditional flag badges (stress, repo, corridor)
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { TrendingUp, TrendingDown } from 'lucide-react';

// ============================================================
// SVG Gauge Constants
// ============================================================

const SIZE = 110;
const CX = SIZE / 2;
const CY = SIZE / 2;
const R = 38;
const STROKE_W = 7;
const CIRCUMFERENCE = 2 * Math.PI * R;
const ARC_LENGTH = CIRCUMFERENCE * 0.75; // 270° arc

/** Server-enforced safety floor: 80% deployed = 20% remaining */
const SAFETY_FLOOR_DEPLOYED = 80;

// ============================================================
// Helpers
// ============================================================

/**
 * Arc color based on AVAILABLE balance (100 - deployed_pct).
 *  >60% available → emerald
 *  30-60% available → amber
 *  <30% available → red
 */
function getArcColor(deployedPct: number): string {
  const available = 100 - deployedPct;
  if (available > 60) return '#34d399'; // emerald-400
  if (available > 30) return '#fbbf24'; // amber-400
  return '#ef4444';                      // red-500
}

/** Track (background) color — faint version of the arc color for subtle depth */
function getTrackColor(deployedPct: number): string {
  const available = 100 - deployedPct;
  if (available > 60) return 'rgba(52, 211, 153, 0.10)';
  if (available > 30) return 'rgba(251, 191, 36, 0.10)';
  return 'rgba(239, 68, 68, 0.10)';
}

/** Point on the arc at a given position (0-1 of the 270° arc) */
function arcPoint(fraction: number, radius: number): { x: number; y: number } {
  // Arc starts at 135° (bottom-left), sweeps 270° clockwise
  const angleDeg = 135 + 270 * fraction;
  const angleRad = (angleDeg * Math.PI) / 180;
  return {
    x: CX + radius * Math.cos(angleRad),
    y: CY + radius * Math.sin(angleRad),
  };
}

// ============================================================
// Animated counter hook — counts up from 0 to target on mount
// ============================================================

function useAnimatedCounter(target: number, duration = 800): string {
  const [display, setDisplay] = useState('0.0');
  const rafRef = useRef(0);

  useEffect(() => {
    const start = performance.now();
    const tick = (now: number) => {
      const elapsed = now - start;
      const t = Math.min(elapsed / duration, 1);
      // Cubic ease-out
      const eased = 1 - Math.pow(1 - t, 3);
      const current = target * eased;
      setDisplay(current.toFixed(1));
      if (t < 1) {
        rafRef.current = requestAnimationFrame(tick);
      } else {
        setDisplay(target.toFixed(1));
      }
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); };
  }, [target, duration]);

  return display;
}

// ============================================================
// LiquidityGauges — container
// ============================================================

interface LiquidityGaugesProps {
  banks: Record<string, any>;
}

export function LiquidityGauges({ banks }: LiquidityGaugesProps) {
  const bankCodes = Object.keys(banks);
  if (bankCodes.length === 0) return null;

  return (
    <div>
      <h4 className="text-xs font-light text-coda-text mb-2">
        Per-Bank Liquidity
      </h4>
      <div
        className="grid gap-3"
        style={{
          gridTemplateColumns: `repeat(${Math.min(bankCodes.length, 3)}, minmax(0, 1fr))`,
        }}
      >
        {bankCodes.map((code) => {
          const data = banks[code];
          if (!data) return null;
          return <GaugeCard key={code} bankCode={code} data={data} />;
        })}
      </div>
    </div>
  );
}

// ============================================================
// GaugeCard — individual bank gauge
// ============================================================

function GaugeCard({ bankCode, data }: { bankCode: string; data: any }) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    // Trigger arc sweep on next frame so CSS transition plays
    const raf = requestAnimationFrame(() => setMounted(true));
    return () => cancelAnimationFrame(raf);
  }, []);

  const deployed = Math.min(Math.max(data.deployed_pct ?? 0, 0), 100);
  const arcColor = getArcColor(deployed);
  const trackColor = getTrackColor(deployed);

  // Arc fill: offset = arcLength when empty, 0 when full 270°
  const fillOffset = mounted ? ARC_LENGTH * (1 - deployed / 100) : ARC_LENGTH;

  // Safety floor tick mark at 80% deployed position on the arc
  const floorFraction = SAFETY_FLOOR_DEPLOYED / 100;
  const tickInner = arcPoint(floorFraction, R - STROKE_W / 2 - 2);
  const tickOuter = arcPoint(floorFraction, R + STROKE_W / 2 + 2);
  const labelPos = arcPoint(floorFraction, R + STROKE_W / 2 + 10);

  // Animated deployed % counter
  const deployedDisplay = useAnimatedCounter(deployed);

  // Flags — only shown when true
  const flags: { label: string; className: string }[] = [];
  if (data.liquidity_stress) {
    flags.push({ label: 'STRESS', className: 'bg-red-500/15 text-red-400' });
  }
  if (data.repo_maturing > 0) {
    flags.push({ label: 'REPO', className: 'bg-amber-500/15 text-amber-400' });
  }
  if (data.corridor_window_open) {
    flags.push({ label: 'CORRIDOR', className: 'bg-blue-500/15 text-blue-400' });
  }

  return (
    <div className="flex flex-col items-center px-3 py-3 rounded-xl bg-black/[0.02] dark:bg-white/[0.02]">
      {/* SVG Arc Gauge */}
      <svg
        width={SIZE}
        height={SIZE}
        viewBox={`0 0 ${SIZE} ${SIZE}`}
        className="overflow-visible"
      >
        {/* Background track — full 270° arc, faint */}
        <circle
          cx={CX}
          cy={CY}
          r={R}
          fill="none"
          stroke={trackColor}
          strokeWidth={STROKE_W}
          strokeLinecap="round"
          strokeDasharray={`${ARC_LENGTH} ${CIRCUMFERENCE}`}
          transform={`rotate(135, ${CX}, ${CY})`}
        />

        {/* Fill arc — sweeps from bottom-left clockwise */}
        <circle
          cx={CX}
          cy={CY}
          r={R}
          fill="none"
          stroke={arcColor}
          strokeWidth={STROKE_W}
          strokeLinecap="round"
          strokeDasharray={`${ARC_LENGTH} ${CIRCUMFERENCE}`}
          strokeDashoffset={fillOffset}
          transform={`rotate(135, ${CX}, ${CY})`}
          style={{
            transition: 'stroke-dashoffset 0.8s cubic-bezier(0.4, 0, 0.2, 1), stroke 0.5s ease',
          }}
        />

        {/* Safety floor tick mark — dashed line at 80% deployed */}
        <line
          x1={tickInner.x}
          y1={tickInner.y}
          x2={tickOuter.x}
          y2={tickOuter.y}
          stroke="rgba(255,255,255,0.25)"
          strokeWidth={1.5}
          strokeDasharray="2 2"
        />
        {/* "Floor" label */}
        <text
          x={labelPos.x}
          y={labelPos.y}
          textAnchor="middle"
          dominantBaseline="middle"
          fill="rgba(255,255,255,0.25)"
          fontSize={7}
          fontFamily="ui-monospace, SFMono-Regular, monospace"
        >
          Floor
        </text>

        {/* Center: bank short code */}
        <text
          x={CX}
          y={CY - 8}
          textAnchor="middle"
          dominantBaseline="middle"
          fill="var(--coda-text)"
          fontSize={14}
          fontWeight={600}
          fontFamily="ui-monospace, SFMono-Regular, monospace"
        >
          {bankCode}
        </text>

        {/* Center: deployed % (animated counter) */}
        <text
          x={CX}
          y={CY + 8}
          textAnchor="middle"
          dominantBaseline="middle"
          fill={arcColor}
          fontSize={12}
          fontWeight={500}
          fontFamily="ui-monospace, SFMono-Regular, monospace"
          style={{ fontVariantNumeric: 'tabular-nums' }}
        >
          {deployedDisplay}%
        </text>

        {/* Center: "deployed" label */}
        <text
          x={CX}
          y={CY + 21}
          textAnchor="middle"
          dominantBaseline="middle"
          fill="var(--coda-text-faint)"
          fontSize={8}
          fontFamily="inherit"
        >
          deployed
        </text>
      </svg>

      {/* Inflow / Outflow row */}
      <div className="flex items-center gap-3 mt-1 text-[10px]">
        <span className="flex items-center gap-0.5 text-coda-text-secondary font-mono">
          <TrendingUp size={10} className="text-coda-text-muted" />
          ${((data.inflow ?? 0) / 1e6).toLocaleString()}
        </span>
        <span className="flex items-center gap-0.5 text-coda-text-secondary font-mono">
          <TrendingDown size={10} className="text-coda-text-muted" />
          ${((data.outflow ?? 0) / 1e6).toLocaleString()}
        </span>
      </div>

      {/* Flag badges */}
      {flags.length > 0 && (
        <div className="flex flex-wrap justify-center gap-1 mt-2">
          {flags.map((f) => (
            <span
              key={f.label}
              className={`px-1.5 py-0.5 rounded text-[8px] font-medium tracking-wide ${f.className}`}
            >
              {f.label}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
