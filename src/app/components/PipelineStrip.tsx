/**
 * PipelineStrip — Compact 5-node agent pipeline with animated data-packet pills.
 *
 * ~60px height. Serves as a spatial anchor above the reasoning panel.
 * Option B visual system: Single brand accent for active agent, neutral glass
 * for all others. Identity via icon + monogram + label, NOT per-agent color.
 *
 * Theme-aware: uses --coda-* CSS variables for light/dark support.
 *
 * v2: Multi-transaction awareness — multiple nodes can glow simultaneously,
 * count badges on nodes with 2+ transactions, multiple concurrent pills.
 */

import { motion, AnimatePresence } from './motion-shim';
import { Brain, Shield, Scale, Zap, Link2, Check } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

// ── Brand accent (matches --coda-brand) ────────────────────────
export const BRAND_HEX = '#34d399';
const BRAND_RING_GLOW = 'rgba(52, 211, 153, 0.40)';

// ── Agent configuration ────────────────────────────────────────

export interface AgentConfig {
  key: string;
  name: string;
  monogram: string;     // 2-letter identifier
  icon: LucideIcon;
}

export const PIPELINE_AGENTS: AgentConfig[] = [
  { key: 'maestro',  name: 'Maestro',  monogram: 'Ma', icon: Brain  },
  { key: 'concord',  name: 'Concord',  monogram: 'Co', icon: Shield },
  { key: 'fermata',  name: 'Fermata',  monogram: 'Fe', icon: Scale  },
  { key: 'canto',    name: 'Canto',    monogram: 'Ca', icon: Zap    },
  { key: 'solana',   name: 'Solana',   monogram: 'So', icon: Link2  },
];

// ── Data pill type ─────────────────────────────────────────────

export interface DataPill {
  id: string;            // unique key for AnimatePresence
  fromIndex: number;     // source node index
  toIndex: number;       // target node index
  label: string;         // e.g. "$3M JPM->CITI"
}

// ── Active transaction type ────────────────────────────────────

export interface StripTransaction {
  id: string;
  step: number;          // 0=Maestro, 1=Concord, 2=Fermata, 3=Canto, 4=Solana
  senderCode: string;
  receiverCode: string;
  amount: string;
}

// ── Props ──────────────────────────────────────────────────────

interface PipelineStripProps {
  /** Array of currently tracked transactions with their pipeline positions */
  activeTransactions: StripTransaction[];
  /** Currently animating pills (can have multiple) */
  pills: DataPill[];
  /** Maestro phase active (before any transactions exist) */
  maestroActive?: boolean;
}

// ── Component ──────────────────────────────────────────────────

export function PipelineStrip({ activeTransactions, pills, maestroActive }: PipelineStripProps) {
  // Compute per-node state from all active transactions
  const nodeCounts = new Array(PIPELINE_AGENTS.length).fill(0);
  let maxStep = -1;

  if (maestroActive) {
    nodeCounts[0]++;
    maxStep = 0;
  }

  for (const tx of activeTransactions) {
    if (tx.step >= 0 && tx.step < PIPELINE_AGENTS.length) {
      nodeCounts[tx.step]++;
      if (tx.step > maxStep) maxStep = tx.step;
    }
  }

  const isIdle = maxStep < 0;
  const nodePercent = (i: number) => (i / (PIPELINE_AGENTS.length - 1)) * 100;

  return (
    <div className="relative" style={{ height: 64 }}>
      {/* Connector lines */}
      <div className="absolute inset-x-0 flex items-center" style={{ top: 16, paddingLeft: 36, paddingRight: 36 }}>
        <div className="relative w-full" style={{ height: 2 }}>
          {PIPELINE_AGENTS.slice(0, -1).map((_, i) => {
            // A connector is lit if any transaction has passed beyond this segment
            const isLit = maxStep > i;
            return (
              <div
                key={`conn-${i}`}
                className="absolute top-0 h-full transition-all duration-500"
                style={{
                  left: `${nodePercent(i)}%`,
                  width: `${nodePercent(1)}%`,
                  background: isIdle
                    ? `repeating-linear-gradient(90deg, var(--coda-border) 0px, var(--coda-border) 4px, transparent 4px, transparent 8px)`
                    : isLit
                      ? `${BRAND_HEX}88`
                      : 'var(--coda-border)',
                  opacity: isIdle ? 0.5 : isLit ? 1 : 0.3,
                }}
              />
            );
          })}
        </div>
      </div>

      {/* Animated data pills — supports multiple concurrent pills */}
      <AnimatePresence>
        {pills.map((p) => (
          <motion.div
            key={p.id}
            className="absolute z-10 pointer-events-none"
            style={{ top: 8 }}
            initial={{
              left: `calc(${nodePercent(p.fromIndex)}% + 36px * ${1 - p.fromIndex / (PIPELINE_AGENTS.length - 1)} - 36px * ${p.fromIndex / (PIPELINE_AGENTS.length - 1)})`,
              opacity: 0,
              scale: 0.7,
            }}
            animate={{
              left: `calc(${nodePercent(p.toIndex)}% + 36px * ${1 - p.toIndex / (PIPELINE_AGENTS.length - 1)} - 36px * ${p.toIndex / (PIPELINE_AGENTS.length - 1)})`,
              opacity: [0, 1, 1, 0.5],
              scale: [0.7, 1, 1, 0.8],
            }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.8, ease: 'easeInOut' }}
          >
            <div
              className="rounded-full px-2 py-0.5 text-[10px] font-mono font-semibold whitespace-nowrap -translate-x-1/2 bg-black/[0.04] dark:bg-white/[0.06] border border-black/[0.08] dark:border-white/[0.10] text-coda-text-secondary"
            >
              {p.label}
            </div>
          </motion.div>
        ))}
      </AnimatePresence>

      {/* Node circles */}
      <div className="absolute inset-0 flex justify-between items-start px-1">
        {PIPELINE_AGENTS.map((agent, i) => {
          const Icon = agent.icon;
          const count = nodeCounts[i];
          const isActive = count > 0;
          const isCompleted = !isIdle && maxStep > i && count === 0;
          const isLit = !isIdle && maxStep >= i;

          return (
            <div key={agent.key} className="flex flex-col items-center" style={{ width: 72 }}>
              {/* Node */}
              <div className="relative">
                {/* Pulse ring — brand accent, on any active node */}
                {isActive && (
                  <motion.div
                    className="absolute -inset-1 rounded-full"
                    style={{ backgroundColor: BRAND_RING_GLOW }}
                    animate={{ scale: [1, 1.4, 1], opacity: [0.5, 0, 0.5] }}
                    transition={{ duration: 1.5, repeat: Infinity, ease: 'easeInOut' }}
                  />
                )}
                <div
                  className={`relative w-8 h-8 rounded-full flex items-center justify-center transition-all duration-400 ${
                    isActive
                      ? 'bg-black/[0.10] dark:bg-white/[0.12] shadow-[0_0_14px_rgba(120,120,120,0.15)]'
                      : isCompleted
                        ? 'bg-black/[0.06] dark:bg-white/[0.10]'
                        : 'bg-black/[0.04] dark:bg-white/[0.06]'
                  }`}
                  style={{
                    opacity: isIdle ? 0.3 : isLit ? 1 : 0.3,
                  }}
                >
                  {/* Completed: show check overlay, otherwise show icon */}
                  {isCompleted ? (
                    <Check
                      size={13}
                      strokeWidth={2.5}
                      className="text-coda-text-muted transition-colors duration-300"
                    />
                  ) : (
                    <Icon
                      size={14}
                      className={`transition-colors duration-300 ${
                        isActive ? 'text-coda-text' : 'text-coda-text-muted'
                      }`}
                    />
                  )}
                </div>

                {/* Count badge — only if 2+ transactions at this step */}
                {count > 1 && (
                  <motion.div
                    initial={{ scale: 0 }}
                    animate={{ scale: 1 }}
                    className="absolute -top-1 -right-1 min-w-4 h-4 rounded-full bg-neutral-800 dark:bg-neutral-200 text-white dark:text-neutral-900 text-[9px] font-bold flex items-center justify-center px-0.5"
                  >
                    {count}
                  </motion.div>
                )}
              </div>

              {/* Label */}
              <span
                className={`text-[10px] mt-1 font-medium transition-all duration-300 ${
                  isActive
                    ? 'text-coda-text'
                    : isCompleted
                      ? 'text-coda-text-secondary'
                      : 'text-coda-text-muted'
                }`}
              >
                {agent.name}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}