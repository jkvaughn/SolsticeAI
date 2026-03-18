/**
 * ConfigChangeToast — LiquidGlass-styled floating notification showing
 * what Aria just changed. Springs in from the top with frosted glass,
 * auto-dismisses with a smooth exit.
 *
 * Positioning: fills the space between the sidebar nav and the Aria chat
 * panel when it's open, otherwise extends to the right edge of the viewport.
 */

import React, { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from '../motion-shim';
import { Sparkles, Check, ArrowRight, X } from 'lucide-react';

// ── Types ────────────────────────────────────────────────────

export interface ChangeDetail {
  parameter: string;
  from: unknown;
  to: unknown;
  category: 'maestro' | 'concord' | 'fermata' | 'treasury';
}

interface ConfigChangeToastProps {
  changes: ChangeDetail[];
  visible: boolean;
  onDismiss: () => void;
  /** Auto-dismiss after ms (default 5000) */
  duration?: number;
  sidebarWidth?: number;
  /** Whether the Aria chat panel is open (affects right edge positioning) */
  chatPanelOpen?: boolean;
}

// ── Helpers ──────────────────────────────────────────────────

const CATEGORY_LABELS: Record<string, string> = {
  maestro: 'Maestro',
  concord: 'Concord',
  fermata: 'Fermata',
  treasury: 'Treasury',
};

const PARAM_LABELS: Record<string, string> = {
  auto_accept_ceiling: 'Auto-accept Ceiling',
  escalation_first_time_threshold: 'First-Time Threshold',
  escalation_cross_jurisdiction: 'Cross-Jurisdiction Threshold',
  escalation_velocity_count: 'Velocity Guard',
  risk_weight_counterparty: 'Counterparty Weight',
  risk_weight_jurisdiction: 'Jurisdiction Weight',
  risk_weight_asset_type: 'Asset Type Weight',
  risk_weight_behavioral: 'Behavioral Weight',
  risk_instant_ceiling: 'Instant Ceiling',
  risk_deferred_24h_ceiling: '24h Ceiling',
  risk_deferred_72h_ceiling: '72h Ceiling',
  balance_safety_floor_pct: 'Safety Floor',
  heartbeat_participation: 'Heartbeat Participation',
  jurisdiction_whitelist: 'Jurisdiction Whitelist',
  approved_purpose_codes: 'Purpose Codes',
  agent_system_prompt: 'Personality Prompt',
};

function formatVal(val: unknown): string {
  if (val === null || val === undefined) return '—';
  if (typeof val === 'boolean') return val ? 'On' : 'Off';
  if (Array.isArray(val)) return val.join(', ');
  if (typeof val === 'number') {
    if (val >= 1_000_000) return `$${(val / 1_000_000).toFixed(1)}M`;
    if (val >= 1_000) return `$${(val / 1_000).toFixed(0)}K`;
    if (val < 1 && val > 0) return `${(val * 100).toFixed(0)}%`;
    return String(val);
  }
  if (typeof val === 'string' && val.length > 40) return val.slice(0, 40) + '...';
  return String(val);
}

// ── Spring constants (Apple feel) ────────────────────────────

const SPRING_IN = { type: 'spring' as const, stiffness: 380, damping: 30, mass: 0.8 };
const SPRING_OUT = { type: 'spring' as const, stiffness: 400, damping: 35, mass: 0.6 };
const PANEL_WIDTH = 340; // Must match GlobalInputBar PANEL_WIDTH
const PANEL_GAP = 16; // gap between toast right edge and chat panel

// ── Component ────────────────────────────────────────────────

export function ConfigChangeToast({
  changes,
  visible,
  onDismiss,
  duration = 5000,
  sidebarWidth = 0,
  chatPanelOpen = false,
}: ConfigChangeToastProps) {
  // Auto-dismiss
  useEffect(() => {
    if (!visible) return;
    const t = setTimeout(onDismiss, duration);
    return () => clearTimeout(t);
  }, [visible, duration, onDismiss]);

  // Group changes by category
  const grouped = changes.reduce<Record<string, ChangeDetail[]>>((acc, ch) => {
    const cat = ch.category || 'maestro';
    if (!acc[cat]) acc[cat] = [];
    acc[cat].push(ch);
    return acc;
  }, {});

  const categoryOrder = ['maestro', 'concord', 'fermata', 'treasury'];
  const sortedCategories = categoryOrder.filter(c => grouped[c]);

  // Right offset: when chat panel is open, stay left of it
  const rightOffset = chatPanelOpen ? PANEL_WIDTH + PANEL_GAP + 12 : 0;

  return createPortal(
    <AnimatePresence>
      {visible && changes.length > 0 && (
        <motion.div
          initial={{ opacity: 0, y: -60, scale: 0.92 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: -40, scale: 0.95 }}
          transition={SPRING_IN}
          className="fixed top-6 z-[1000] pointer-events-auto"
          style={{
            left: `${sidebarWidth + 16}px`,
            right: `${rightOffset + 16}px`,
          }}
        >
          {/* LiquidGlass container */}
          <motion.div
            className="max-w-lg mx-auto
                       backdrop-blur-2xl bg-white/[0.12] dark:bg-white/[0.06]
                       border border-white/20 dark:border-white/10
                       shadow-[0_8px_32px_rgba(0,0,0,0.12),0_2px_8px_rgba(0,0,0,0.06)]
                       dark:shadow-[0_8px_32px_rgba(0,0,0,0.4),0_2px_8px_rgba(0,0,0,0.2)]
                       rounded-2xl overflow-hidden"
            exit={{ scale: 0.95 }}
            transition={SPRING_OUT}
          >
            {/* Header */}
            <div className="px-4 pt-4 pb-2 flex items-center gap-3">
              <motion.div
                initial={{ scale: 0, rotate: -180 }}
                animate={{ scale: 1, rotate: 0 }}
                transition={{ ...SPRING_IN, delay: 0.1 }}
                className="w-8 h-8 rounded-full bg-gradient-to-br from-coda-brand to-coda-brand-dim
                           flex items-center justify-center shadow-lg shadow-coda-brand/25"
              >
                <Check size={16} className="text-white" strokeWidth={3} />
              </motion.div>
              <div className="flex-1 min-w-0">
                <motion.p
                  initial={{ opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: 0.15, duration: 0.3 }}
                  className="text-sm font-semibold text-coda-text"
                >
                  Configuration Updated
                </motion.p>
                <motion.p
                  initial={{ opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: 0.2, duration: 0.3 }}
                  className="text-[11px] text-coda-text-muted"
                >
                  Aria applied {changes.length} change{changes.length !== 1 ? 's' : ''}
                </motion.p>
              </div>
              <motion.button
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.3 }}
                onClick={onDismiss}
                className="p-1 rounded-full hover:bg-black/10 dark:hover:bg-white/10
                           transition-colors cursor-pointer"
              >
                <X size={14} className="text-coda-text-muted" />
              </motion.button>
            </div>

            {/* Change rows */}
            <div className="px-4 pb-3 space-y-1.5">
              {sortedCategories.map((cat, catIdx) => (
                <motion.div
                  key={cat}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.2 + catIdx * 0.08, duration: 0.3 }}
                >
                  <p className="text-[9px] font-bold uppercase tracking-wider text-coda-text-muted mt-1 mb-0.5">
                    {CATEGORY_LABELS[cat]}
                  </p>
                  {grouped[cat].map((ch, i) => (
                    <motion.div
                      key={ch.parameter}
                      initial={{ opacity: 0, x: -8 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: 0.25 + catIdx * 0.08 + i * 0.05, duration: 0.25 }}
                      className="flex items-center gap-2 py-1 text-xs"
                    >
                      <span className="text-coda-text-secondary font-medium truncate flex-shrink-0 max-w-[140px]">
                        {PARAM_LABELS[ch.parameter] || ch.parameter}
                      </span>
                      <span className="text-coda-text-muted font-mono text-[10px] truncate max-w-[60px]">
                        {formatVal(ch.from)}
                      </span>
                      <ArrowRight size={10} className="text-coda-brand flex-shrink-0" />
                      <span className="text-coda-brand font-mono text-[10px] font-semibold truncate max-w-[60px]">
                        {formatVal(ch.to)}
                      </span>
                    </motion.div>
                  ))}
                </motion.div>
              ))}
            </div>

            {/* Progress bar (auto-dismiss timer) */}
            <motion.div
              initial={{ scaleX: 1 }}
              animate={{ scaleX: 0 }}
              transition={{ duration: duration / 1000, ease: 'linear' }}
              className="h-0.5 bg-gradient-to-r from-coda-brand to-coda-brand-dim origin-left"
            />
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body
  );
}