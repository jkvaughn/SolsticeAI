/**
 * AnimatedValue — Apple-style smooth number animation
 *
 * Layers on top of SWR / BanksContext without touching either.
 *
 * Behavior:
 *  - First render: instant (no count-up from zero)
 *  - Value from 0 → N: instant snap (initial data load)
 *  - Small delta (<=50% relative change): smooth ease-out rAF interpolation
 *  - Large delta (>50% relative change): quick opacity crossfade
 *
 * CSS: font-variant-numeric: tabular-nums for stable digit width.
 */

import { useEffect, useRef, useState, useCallback } from 'react';

// ── Easing ───────────────────────────────────────────────────
// Cubic ease-out: fast start, gentle landing
function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

// ── Component ────────────────────────────────────────────────

export interface AnimatedValueProps {
  /** The target numeric value */
  value: number;
  /** Optional formatter (default: v.toLocaleString()) */
  format?: (value: number) => string;
  /** Extra class names forwarded to the <span> */
  className?: string;
  /** Animation duration in ms (default: 350) */
  duration?: number;
  /** Called when a non-initial value change is detected (for parent pulse effects) */
  onLiveChange?: () => void;
}

const defaultFormat = (v: number) => v.toLocaleString();

export function AnimatedValue({
  value,
  format = defaultFormat,
  className = '',
  duration = 350,
  onLiveChange,
}: AnimatedValueProps) {
  // displayRef tracks the currently displayed number (avoids stale closure in rAF)
  const displayRef = useRef(value);
  const [displayValue, setDisplayValue] = useState(value);
  const [crossfading, setCrossfading] = useState(false);

  const isFirstRender = useRef(true);
  const prevValueRef = useRef(value);
  const rafRef = useRef(0);
  const timeoutRef = useRef<ReturnType<typeof setTimeout>>();

  // Keep onLiveChange stable via ref
  const onLiveChangeRef = useRef(onLiveChange);
  onLiveChangeRef.current = onLiveChange;

  const snapTo = useCallback((v: number) => {
    displayRef.current = v;
    setDisplayValue(v);
  }, []);

  useEffect(() => {
    // ── First render: show value instantly ────────────────────
    if (isFirstRender.current) {
      isFirstRender.current = false;
      prevValueRef.current = value;
      snapTo(value);
      return;
    }

    const prev = prevValueRef.current;
    prevValueRef.current = value;

    // No change — nothing to do
    if (value === prev) return;

    // Cancel any in-flight animation
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    if (timeoutRef.current) clearTimeout(timeoutRef.current);

    // ── From zero → N: instant snap (initial SWR load) ───────
    if (prev === 0) {
      snapTo(value);
      return;
    }

    // Signal live change to parent (for pulse effects)
    onLiveChangeRef.current?.();

    // ── Large delta (>50%): opacity crossfade ────────────────
    const delta = Math.abs(value - prev);
    const relativeChange = delta / Math.abs(prev);

    if (relativeChange > 0.5) {
      setCrossfading(true);
      timeoutRef.current = setTimeout(() => {
        snapTo(value);
        setCrossfading(false);
      }, 160); // Fade out 160ms, then snap + fade in 160ms
      return;
    }

    // ── Small delta: smooth rAF interpolation ────────────────
    const startTime = performance.now();
    const startVal = displayRef.current; // use current display (handles interrupted anims)

    const tick = (now: number) => {
      const elapsed = now - startTime;
      const t = Math.min(elapsed / duration, 1);
      const eased = easeOutCubic(t);
      const interpolated = startVal + (value - startVal) * eased;
      const rounded = Math.round(interpolated);

      displayRef.current = rounded;
      setDisplayValue(rounded);

      if (t < 1) {
        rafRef.current = requestAnimationFrame(tick);
      } else {
        // Ensure final value is exact
        displayRef.current = value;
        setDisplayValue(value);
      }
    };

    rafRef.current = requestAnimationFrame(tick);

    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, [value, duration, snapTo]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, []);

  return (
    <span
      className={`inline-block transition-opacity duration-150 ease-out ${
        crossfading ? 'opacity-0' : 'opacity-100'
      } ${className}`}
      style={{ fontVariantNumeric: 'tabular-nums' }}
    >
      {format(displayValue)}
    </span>
  );
}
