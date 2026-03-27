import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import {
  Sliders, Save, RefreshCw,
  Check, AlertTriangle, Zap, Shield, BarChart3, Landmark, Globe,
  FileText, Activity, Gauge, Eye, Timer
} from 'lucide-react';
import { motion, AnimatePresence } from './motion-shim';
import { PageShell } from './PageShell';
import { WidgetShell } from './dashboard/WidgetShell';
import type { PageStat } from './PageShell';
import { useBanks } from '../contexts/BanksContext';
import { callServer } from '../supabaseClient';
import { useSWRCache, evictSWRCache } from '../hooks/useSWRCache';
import type { BankAgentConfig, NetworkDefaults, TreasuryMandate } from '../types';
import { GlobalInputBar } from './aria/GlobalInputBar';
import type { AriaMode, Suggestion, WorkflowState } from './aria/GlobalInputBar';
import { ConfigChangeToast } from './aria/ConfigChangeToast';
import type { ChangeDetail } from './aria/ConfigChangeToast';
import { useAria } from '../contexts/AriaContext';
import { useLayout } from '../contexts/LayoutContext';
import { usePersona } from '../contexts/PersonaContext';

// ============================================================
// SWR fetcher types
// ============================================================
interface BankConfigPayload {
  config: BankAgentConfig;
  agent_system_prompt: string;
  bank_name: string;
  bank_code: string;
  mandates: TreasuryMandate[];
  network_defaults: NetworkDefaults;
}

interface DefaultsPayload {
  network_defaults: NetworkDefaults;
}

// ============================================================
// Purpose Code Labels
// ============================================================
const PURPOSE_CODE_LABELS: Record<string, string> = {
  WHOLESALE_TREASURY: 'Wholesale Treasury',
  INTERBANK_SETTLEMENT: 'Interbank Settlement',
  LIQUIDITY_MGMT: 'Liquidity Management',
  REPO_SETTLEMENT: 'Repo Settlement',
  COLLATERAL_TRANSFER: 'Collateral Transfer',
  CROSS_BORDER: 'Cross Border',
  FX_SETTLEMENT: 'FX Settlement',
};

// ============================================================
// Mandate type badge colors — monochromatic LiquidGlass
// ============================================================
const MANDATE_TYPE_COLORS: Record<string, string> = {
  rebalance: 'bg-black/[0.06] dark:bg-white/[0.08] text-coda-text-secondary',
  sweep: 'bg-coda-text-muted/10 text-coda-text-secondary',
  liquidity_provision: 'bg-black/[0.06] dark:bg-white/[0.08] text-coda-text-secondary',
  scheduled_settlement: 'bg-coda-text-faint/15 text-coda-text-muted',
  contingency: 'bg-destructive/10 text-destructive',
};

// ============================================================
// Dollar formatting helper
// ============================================================
function fmtDollar(n: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency', currency: 'USD',
    minimumFractionDigits: 0, maximumFractionDigits: 0,
  }).format(n);
}


// ============================================================
// Number input with dollar formatting + animated value display
// ============================================================
function DollarInput({
  label, value, onChange, min, max, helperText, isDefault, onReset, disabled
}: {
  label: string; value: number; onChange: (v: number) => void;
  min: number; max: number; helperText?: string;
  isDefault: boolean; onReset: () => void; disabled?: boolean;
}) {
  const [editing, setEditing] = React.useState(false);
  const [flash, setFlash] = React.useState(false);
  const prevRef = React.useRef(value);

  // Detect programmatic changes (Aria) vs user edits
  React.useEffect(() => {
    if (!editing && prevRef.current !== value && prevRef.current !== 0) {
      setFlash(true);
      const t = setTimeout(() => setFlash(false), 1200);
      return () => clearTimeout(t);
    }
    prevRef.current = value;
  }, [value, editing]);

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between">
        <label className="text-xs font-medium text-coda-text-secondary">{label}</label>
        {isDefault ? (
          <span className="text-[10px] text-coda-text-muted font-mono">(network default)</span>
        ) : (
          <button onClick={onReset} className="liquid-button text-[10px] text-coda-text-muted"><span>Reset</span></button>
        )}
      </div>
      <div className="relative">
        <input
          type="number"
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
          onFocus={() => setEditing(true)}
          onBlur={() => setEditing(false)}
          min={min} max={max} disabled={disabled}
          className={`w-full px-3 py-1.5 rounded-lg text-sm font-mono text-right bg-black/[0.03] dark:bg-white/[0.05] border text-coda-text disabled:opacity-50 focus:outline-none focus:ring-1 focus:ring-coda-brand/40 transition-all duration-500 ${
            flash
              ? 'border-coda-brand/50 shadow-[0_0_12px_rgba(37,99,235,0.15)]'
              : 'border-coda-border'
          }`}
        />
      </div>
      {helperText && <p className="text-[10px] text-coda-text-muted">{helperText}</p>}
    </div>
  );
}

// ============================================================
// Slider component — with smooth animated thumb + fill transitions
// ============================================================
function SliderInput({
  label, value, onChange, min, max, step, suffix, disabled
}: {
  label: string; value: number; onChange: (v: number) => void;
  min: number; max: number; step: number; suffix?: string; disabled?: boolean;
}) {
  const pct = ((value - min) / (max - min)) * 100;
  const [flash, setFlash] = React.useState(false);
  const [dragging, setDragging] = React.useState(false);
  const prevRef = React.useRef(value);

  // Detect programmatic changes (Aria) for the glow effect
  React.useEffect(() => {
    if (!dragging && prevRef.current !== value && prevRef.current !== 0) {
      setFlash(true);
      const t = setTimeout(() => setFlash(false), 1200);
      return () => clearTimeout(t);
    }
    prevRef.current = value;
  }, [value, dragging]);

  // Use CSS transition for smooth thumb/fill movement (programmatic + drag)
  const transition = dragging ? 'none' : 'all 0.5s cubic-bezier(0.32, 0.72, 0, 1)';

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-coda-text-secondary">{label}</span>
        <span className={`text-xs font-mono transition-colors duration-500 ${flash ? 'text-coda-text font-semibold' : 'text-coda-text'}`}>
          {value.toFixed(2)}{suffix || ''}
        </span>
      </div>
      <div className="relative h-5 flex items-center">
        <div className="absolute inset-x-0 h-1.5 rounded-full bg-coda-border" />
        <div
          className="absolute h-1.5 rounded-full bg-neutral-600 dark:bg-neutral-400"
          style={{ width: `${pct}%`, transition }}
        />
        <input
          type="range" min={min} max={max} step={step} value={value}
          onChange={(e) => onChange(Number(e.target.value))}
          onPointerDown={() => setDragging(true)}
          onPointerUp={() => setDragging(false)}
          disabled={disabled}
          className="absolute inset-x-0 w-full h-5 opacity-0 cursor-pointer disabled:cursor-not-allowed"
        />
        <div
          className={`absolute w-3.5 h-3.5 rounded-full bg-neutral-800 dark:bg-neutral-200 shadow-md border-2 border-white dark:border-coda-bg pointer-events-none ${
            flash ? 'ring-4 ring-black/10 dark:ring-white/10' : ''
          }`}
          style={{ left: `calc(${pct}% - 7px)`, transition }}
        />
      </div>
    </div>
  );
}

// ============================================================
// Weight distribution bar
// ============================================================
function WeightBar({ weights }: { weights: { label: string; value: number; color: string }[] }) {
  const total = weights.reduce((s, w) => s + w.value, 0);
  return (
    <div className="space-y-1.5">
      <div className="flex h-3 rounded-full overflow-hidden bg-coda-border">
        {weights.map((w) => (
          <div
            key={w.label}
            className={w.color}
            style={{
              width: `${(w.value / Math.max(total, 0.01)) * 100}%`,
              transition: 'width 0.5s cubic-bezier(0.32, 0.72, 0, 1)',
            }}
            title={`${w.label}: ${(w.value * 100).toFixed(0)}%`}
          />
        ))}
      </div>
      <div className="flex items-center gap-3 flex-wrap">
        {weights.map((w) => (
          <div key={w.label} className="flex items-center gap-1">
            <div className={`w-2 h-2 rounded-sm ${w.color}`} />
            <span className="text-[10px] text-coda-text-muted">{w.label}</span>
          </div>
        ))}
        <span className={`text-[10px] font-mono ml-auto ${Math.abs(total - 1) < 0.01 ? 'text-emerald-500' : 'text-destructive'}`}>
          Sum: {(total * 100).toFixed(0)}%
          {Math.abs(total - 1) >= 0.01 && ' (must be 100%)'}
        </span>
      </div>
    </div>
  );
}

// ============================================================
// Finality zones visualization
// ============================================================
function FinalityZones({ instant, deferred24, deferred72, disabled, onChange }: {
  instant: number; deferred24: number; deferred72: number;
  disabled?: boolean; onChange: (field: string, val: number) => void;
}) {
  // Flash detection for programmatic changes (Aria)
  const [flash, setFlash] = React.useState(false);
  const prevRef = React.useRef(`${instant}-${deferred24}-${deferred72}`);
  React.useEffect(() => {
    const key = `${instant}-${deferred24}-${deferred72}`;
    if (prevRef.current !== key && prevRef.current !== '0-0-0') {
      setFlash(true);
      const t = setTimeout(() => setFlash(false), 1200);
      return () => clearTimeout(t);
    }
    prevRef.current = key;
  }, [instant, deferred24, deferred72]);

  const zones = [
    { label: 'Instant', range: [0, instant], color: 'bg-neutral-800 dark:bg-neutral-200', textColor: 'text-coda-text' },
    { label: '24h Hold', range: [instant, deferred24], color: 'bg-neutral-500 dark:bg-neutral-400', textColor: 'text-coda-text-secondary' },
    { label: '72h Hold', range: [deferred24, deferred72], color: 'bg-coda-text-muted/40', textColor: 'text-coda-text-muted' },
    { label: 'Review', range: [deferred72, 100], color: 'bg-coda-text-muted/40', textColor: 'text-coda-text-muted' },
  ];

  return (
    <div className="space-y-3">
      {/* Visual bar */}
      <div className="flex h-6 rounded-lg overflow-hidden">
        {zones.map((z) => (
          <div
            key={z.label}
            className={`${z.color} flex items-center justify-center`}
            style={{
              width: `${z.range[1] - z.range[0]}%`,
              minWidth: z.range[1] > z.range[0] ? '20px' : '0',
              transition: 'width 0.5s cubic-bezier(0.32, 0.72, 0, 1)',
            }}
          >
            {(z.range[1] - z.range[0]) >= 12 && (
              <span className="text-[9px] font-semibold text-white truncate px-1">{z.label}</span>
            )}
          </div>
        ))}
      </div>
      {/* Legend */}
      <div className="flex items-center gap-3 flex-wrap">
        {zones.map((z) => (
          <div key={z.label} className="flex items-center gap-1">
            <div className={`w-2 h-2 rounded-sm ${z.color}`} />
            <span className={`text-[10px] font-medium ${z.textColor}`}>{z.label}: {z.range[0]}-{z.range[1]}</span>
          </div>
        ))}
      </div>
      {/* Threshold inputs */}
      <div className="grid grid-cols-3 gap-3">
        <div className="space-y-1">
          <label className="text-[10px] text-coda-text-muted">Instant ceiling</label>
          <input
            type="number" min={0} max={deferred24 - 1} value={instant}
            onChange={(e) => onChange('risk_instant_ceiling', Math.min(Number(e.target.value), deferred24 - 1))}
            disabled={disabled}
            className={`w-full px-2 py-1 rounded-md text-xs font-mono text-right bg-black/[0.03] dark:bg-white/[0.05] border text-coda-text disabled:opacity-50 focus:outline-none focus:ring-1 focus:ring-coda-brand/40 transition-all duration-500 ${
              flash ? 'border-coda-brand/50 shadow-[0_0_8px_rgba(37,99,235,0.15)]' : 'border-coda-border'
            }`}
          />
        </div>
        <div className="space-y-1">
          <label className="text-[10px] text-coda-text-muted">24h ceiling</label>
          <input
            type="number" min={instant + 1} max={deferred72 - 1} value={deferred24}
            onChange={(e) => onChange('risk_deferred_24h_ceiling', Math.max(instant + 1, Math.min(Number(e.target.value), deferred72 - 1)))}
            disabled={disabled}
            className={`w-full px-2 py-1 rounded-md text-xs font-mono text-right bg-black/[0.03] dark:bg-white/[0.05] border text-coda-text disabled:opacity-50 focus:outline-none focus:ring-1 focus:ring-coda-brand/40 transition-all duration-500 ${
              flash ? 'border-coda-brand/50 shadow-[0_0_8px_rgba(37,99,235,0.15)]' : 'border-coda-border'
            }`}
          />
        </div>
        <div className="space-y-1">
          <label className="text-[10px] text-coda-text-muted">72h ceiling</label>
          <input
            type="number" min={deferred24 + 1} max={99} value={deferred72}
            onChange={(e) => onChange('risk_deferred_72h_ceiling', Math.max(deferred24 + 1, Math.min(Number(e.target.value), 99)))}
            disabled={disabled}
            className={`w-full px-2 py-1 rounded-md text-xs font-mono text-right bg-black/[0.03] dark:bg-white/[0.05] border text-coda-text disabled:opacity-50 focus:outline-none focus:ring-1 focus:ring-coda-brand/40 transition-all duration-500 ${
              flash ? 'border-coda-brand/50 shadow-[0_0_8px_rgba(37,99,235,0.15)]' : 'border-coda-border'
            }`}
          />
        </div>
      </div>
    </div>
  );
}

// ============================================================
// Suggestion chip sets — context-aware
// ============================================================
const CATEGORY_SUGGESTIONS: Record<string, Suggestion[]> = {
  maestro: [
    { text: 'Adjust auto-accept ceiling' },
    { text: 'Change escalation thresholds' },
    { text: 'Update personality prompt' },
  ],
  concord: [
    { text: 'Add a jurisdiction to whitelist' },
    { text: 'Modify purpose codes' },
    { text: 'Tighten compliance rules' },
  ],
  fermata: [
    { text: 'Adjust risk weights' },
    { text: 'Change finality zones' },
    { text: 'Make risk scoring more conservative' },
  ],
  treasury: [
    { text: 'Change safety floor' },
    { text: 'Toggle heartbeat participation' },
    { text: 'Regenerate mandates' },
  ],
};
const DEFAULT_SUGGESTIONS: Suggestion[] = [
  { text: 'Show current config' },
  { text: 'Make more aggressive on risk' },
  { text: "What's the safety floor?" },
  { text: 'Reset to network defaults' },
];
const AFTER_APPLY_SUGGESTIONS: Suggestion[] = [
  { text: 'Show updated config' },
  { text: 'Make another change' },
];
const AFTER_REJECT_SUGGESTIONS: Suggestion[] = [
  { text: 'Try a smaller change' },
  { text: 'Explain the constraints' },
  { text: 'Show current config' },
];

/** Detect conversation topic from recent aria messages to pick relevant follow-up chips */
function detectConversationTopic(conversation: { role: string; content: string }[]): string | null {
  const recentAria = conversation.filter(m => m.role === 'aria').slice(-2);
  const text = recentAria.map(m => m.content.toLowerCase()).join(' ');

  if (/risk.?weight|counterparty.?weight|jurisdiction.?weight|behavioral|asset.?type.?weight|finality|risk.?scor/i.test(text)) return 'fermata';
  if (/safety.?floor|heartbeat|treasury|mandate|autonomous/i.test(text)) return 'treasury';
  if (/jurisdiction|whitelist|purpose.?code|compliance|concord/i.test(text)) return 'concord';
  if (/auto.?accept|ceiling|personality|escalat|maestro/i.test(text)) return 'maestro';
  return null;
}

// ============================================================
// Main AgentConfig Page
// ============================================================
export function AgentConfig() {
  const { banks } = useBanks();
  const activeBanks = banks.filter(b => b.status === 'active');
  const { sidebarWidth } = useLayout();
  const { persona } = usePersona();

  // Persona-based card expansion (Task 126)
  const cardOpenState = (cardId: 'maestro' | 'concord' | 'fermata' | 'treasury' | 'cadenza'): boolean | undefined => {
    if (!persona) return undefined; // default behavior
    if (persona === 'compliance') return cardId === 'concord' || cardId === 'cadenza';
    if (persona === 'treasury') return cardId === 'maestro' || cardId === 'treasury';
    if (persona === 'leadership') return false;
    return undefined;
  };

  // Selected bank: null = "Network Defaults" tab
  const [selectedBankId, setSelectedBankId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveFlash, setSaveFlash] = useState<string | null>(null);

  // Config state — local editable copies hydrated from SWR
  const [config, setConfig] = useState<BankAgentConfig | null>(null);
  const [defaults, setDefaults] = useState<NetworkDefaults | null>(null);
  const [personality, setPersonality] = useState('');
  const [mandates, setMandates] = useState<TreasuryMandate[]>([]);
  const [bankName, setBankName] = useState('');
  const [bankCode, setBankCode] = useState('');

  // Track dirty fields
  const originalConfigRef = useRef<BankAgentConfig | null>(null);
  const originalPersonalityRef = useRef('');

  const isDefaultsTab = selectedBankId === null;

  // ── Aria integration ───────────────────────────────────────
  const aria = useAria();
  const [lastAction, setLastAction] = useState<'none' | 'applied' | 'rejected'>('none');

  // ── Change highlight state (Apple-style glow + toast) ──────
  const [highlightedCategories, setHighlightedCategories] = useState<Set<string>>(new Set());
  const [changeToastData, setChangeToastData] = useState<ChangeDetail[]>([]);
  const [showChangeToast, setShowChangeToast] = useState(false);
  const cardRefs = useRef<Record<string, HTMLDivElement | null>>({
    maestro: null,
    concord: null,
    fermata: null,
    treasury: null,
    cadenza: null,
  });

  // Capture proposal changes before they're cleared by confirmProposal
  const lastConfirmedChangesRef = useRef<ChangeDetail[]>([]);

  // ── Aria display mode (dot / floating / sidebar) ───────────
  const [ariaMode, setAriaMode] = useState<AriaMode>('dot');
  const chatPanelOpen = ariaMode === 'sidebar';



  // Sync AgentConfig bank selection → Aria
  useEffect(() => {
    if (selectedBankId && selectedBankId !== aria.selectedBankId) {
      aria.setSelectedBankId(selectedBankId);
      aria.resetConversation();
      setLastAction('none');
    }
  }, [selectedBankId]);

  // Context-dependent suggestions — aware of conversation topic
  const ariaSuggestions = useMemo<Suggestion[]>(() => {
    if (lastAction === 'applied') return AFTER_APPLY_SUGGESTIONS;
    if (lastAction === 'rejected') return AFTER_REJECT_SUGGESTIONS;
    // Detect what the conversation is about and suggest relevant follow-ups
    const topic = detectConversationTopic(aria.conversation);
    if (topic && CATEGORY_SUGGESTIONS[topic]) {
      return CATEGORY_SUGGESTIONS[topic];
    }
    return DEFAULT_SUGGESTIONS;
  }, [lastAction, aria.conversation]);

  // workflowContext — maps Aria proposal state to GlobalInputBar
  const workflowContext = useMemo<WorkflowState | undefined>(() => {
    // After successful apply — show "scroll to updated config" button
    if (aria.confirmMessage && !aria.activeProposal) {
      return {
        isActive: true,
        executionComplete: true,
        onViewResults: () => {
          // Just navigate: scroll to affected card + clear workflow
          const changeDetails = lastConfirmedChangesRef.current;
          const affectedCats = new Set(changeDetails.map(c => c.category));

          aria.clearResponse();
          setLastAction('applied');

          // Scroll first affected card into view
          const scrollOrder = ['maestro', 'concord', 'fermata', 'treasury', 'cadenza'];
          const firstCat = scrollOrder.find(c => affectedCats.has(c));
          if (firstCat && cardRefs.current[firstCat]) {
            setTimeout(() => {
              cardRefs.current[firstCat]?.scrollIntoView({
                behavior: 'smooth',
                block: 'center',
              });
            }, 200);
          }
        },
      };
    }

    // Active proposal — show approve/reject
    if (aria.activeProposal && !aria.isLoading) {
      return {
        isActive: true,
        phase: 'review',
        showApproval: true,
        onApprove: async () => {
          // Capture changes before confirmProposal clears activeProposal
          if (aria.activeProposal) {
            lastConfirmedChangesRef.current = aria.activeProposal.changes.map(ch => ({
              parameter: ch.parameter,
              from: ch.current_value,
              to: ch.proposed_value,
              category: ch.category,
            }));
          }

          // Apply changes on server
          await aria.confirmProposal();

          // ── Immediately apply: cache invalidation + toast + highlights ──
          const changeDetails = lastConfirmedChangesRef.current;
          const affectedCats = new Set(changeDetails.map(c => c.category));

          if (changeDetails.length > 0) {
            setChangeToastData(changeDetails);
            setShowChangeToast(true);
            setHighlightedCategories(affectedCats);
            // Auto-clear highlights after animation
            setTimeout(() => setHighlightedCategories(new Set()), 3500);
          }

          // Force re-hydrate config cards immediately
          if (selectedBankId) {
            hydratedKeyRef.current = null;
            evictSWRCache(`agent-config:bank:${selectedBankId}`);
            invalidateBankConfig();
          }
        },
        onCancel: async () => {
          await aria.rejectProposal();
          setLastAction('rejected');
        },
      };
    }

    return undefined;
  }, [aria.activeProposal, aria.confirmMessage, aria.isLoading, selectedBankId]);

  // Handle query submission
  const handleAriaQuery = useCallback((query: string) => {
    setLastAction('none');
    aria.sendMessage(query);
  }, [aria.sendMessage]);

  // Conversation history for display in GlobalInputBar
  const conversationHistory = useMemo(() => {
    return aria.conversation.map(msg => ({
      role: msg.role,
      content: msg.content,
    }));
  }, [aria.conversation]);

  // ── SWR: Network Defaults ──────────────────────────────────
  const {
    data: defaultsData,
    isValidating: defaultsValidating,
  } = useSWRCache<DefaultsPayload>({
    key: 'agent-config:defaults',
    fetcher: () => callServer<DefaultsPayload>('/agent-config', { action: 'get_defaults' }),
    ttl: 10 * 60 * 1000, // 10 min — rarely changes
  });

  // ── SWR: Per-bank config ───────────────────────────────────
  const {
    data: bankData,
    isValidating: bankValidating,
    invalidate: invalidateBankConfig,
  } = useSWRCache<BankConfigPayload>({
    key: selectedBankId ? `agent-config:bank:${selectedBankId}` : '__noop__',
    fetcher: selectedBankId
      ? () => callServer<BankConfigPayload>('/agent-config', { action: 'get', bank_id: selectedBankId })
      : () => Promise.resolve(null as any),
    deps: [selectedBankId],
    ttl: 5 * 60 * 1000,
  });

  // ── Hydrate local state from SWR data ──────────────────────
  // Track whether we've already hydrated for the current selection
  const hydratedKeyRef = useRef<string | null>(null);

  useEffect(() => {
    if (isDefaultsTab && defaultsData) {
      const key = 'defaults';
      if (hydratedKeyRef.current !== key) {
        setDefaults(defaultsData.network_defaults);
        setConfig(null);
        setBankName('');
        setBankCode('');
        setMandates([]);
        setPersonality('');
        originalConfigRef.current = null;
        originalPersonalityRef.current = '';
        hydratedKeyRef.current = key;
      }
    }
  }, [isDefaultsTab, defaultsData]);

  useEffect(() => {
    if (!isDefaultsTab && bankData && selectedBankId) {
      const key = `bank:${selectedBankId}`;
      if (hydratedKeyRef.current !== key) {
        setConfig(bankData.config);
        setDefaults(bankData.network_defaults);
        setPersonality(bankData.agent_system_prompt);
        setMandates(bankData.mandates);
        setBankName(bankData.bank_name);
        setBankCode(bankData.bank_code);
        originalConfigRef.current = { ...bankData.config };
        originalPersonalityRef.current = bankData.agent_system_prompt;
        hydratedKeyRef.current = key;
      }
    }
  }, [isDefaultsTab, bankData, selectedBankId]);

  // Reset hydrated key when switching tabs so we re-hydrate
  useEffect(() => {
    hydratedKeyRef.current = null;
  }, [selectedBankId]);

  // Dirty tracking
  const configDirty = config && originalConfigRef.current
    ? JSON.stringify(config) !== JSON.stringify(originalConfigRef.current)
    : false;
  const personalityDirty = personality !== originalPersonalityRef.current;

  // Loading = first load (no cached data yet) while validating
  const loading = isDefaultsTab
    ? (!defaults && defaultsValidating)
    : (!config && bankValidating);

  // Save config
  const saveConfig = async (fields: Partial<BankAgentConfig>) => {
    if (!selectedBankId) return;
    setSaving(true);
    try {
      await callServer('/agent-config', { action: 'update', bank_id: selectedBankId, config: fields });
      flashSave('config');
      if (config) originalConfigRef.current = { ...config };
      // Evict SWR cache so next visit gets fresh data
      evictSWRCache(`agent-config:bank:${selectedBankId}`);
    } catch (err) {
      console.error('[AgentConfig] save error:', err);
    }
    setSaving(false);
  };

  // Save personality
  const savePersonality = async () => {
    if (!selectedBankId) return;
    setSaving(true);
    try {
      await callServer('/agent-config', { action: 'update_personality', bank_id: selectedBankId, config: { agent_system_prompt: personality } });
      flashSave('personality');
      originalPersonalityRef.current = personality;
      evictSWRCache(`agent-config:bank:${selectedBankId}`);
    } catch (err) {
      console.error('[AgentConfig] save personality error:', err);
    }
    setSaving(false);
  };

  // Toggle mandate
  const toggleMandate = async (mandateId: string, isActive: boolean) => {
    if (!selectedBankId) return;
    try {
      await callServer('/agent-config', { action: 'toggle_mandate', bank_id: selectedBankId, config: { mandate_id: mandateId, is_active: isActive } });
      setMandates(prev => prev.map(m => m.id === mandateId ? { ...m, is_active: isActive } : m));
    } catch (err) {
      console.error('[AgentConfig] toggle mandate error:', err);
    }
  };

  // Regenerate mandates
  const [regenerating, setRegenerating] = useState(false);
  const regenerateMandates = async () => {
    if (!selectedBankId) return;
    setRegenerating(true);
    try {
      const res = await callServer<{ mandates: TreasuryMandate[] }>('/agent-config', { action: 'regenerate_mandates', bank_id: selectedBankId });
      setMandates(res.mandates);
      evictSWRCache(`agent-config:bank:${selectedBankId}`);
    } catch (err) {
      console.error('[AgentConfig] regenerate error:', err);
    }
    setRegenerating(false);
  };

  const flashSave = (key: string) => {
    setSaveFlash(key);
    setTimeout(() => setSaveFlash(null), 1500);
  };

  // Config field updater
  const updateField = <K extends keyof BankAgentConfig>(field: K, value: BankAgentConfig[K]) => {
    if (!config) return;
    setConfig({ ...config, [field]: value });
  };

  const resetField = <K extends keyof BankAgentConfig>(field: K) => {
    if (!config || !defaults) return;
    setConfig({ ...config, [field]: defaults[field] });
  };

  const isFieldDefault = <K extends keyof BankAgentConfig>(field: K): boolean => {
    if (!config || !defaults) return true;
    return JSON.stringify(config[field]) === JSON.stringify(defaults[field]);
  };

  // Weight sum validation
  const weightSum = config
    ? config.risk_weight_counterparty + config.risk_weight_jurisdiction + config.risk_weight_asset_type + config.risk_weight_behavioral
    : 1;
  const weightsValid = Math.abs(weightSum - 1) < 0.01;

  // ── Motion variants ────────────────────────────────────────
  const cardVariants = {
    hidden: { opacity: 0, y: 12, filter: 'blur(4px)' },
    visible: { opacity: 1, y: 0, filter: 'blur(0px)' },
    exit: { opacity: 0, y: -8, filter: 'blur(4px)' },
  };

  // ── Render ──────────────────────────────────────────────────
  const d = isDefaultsTab ? defaults : config;

  const selectedBank = activeBanks.find(b => b.id === selectedBankId);
  const pageStats: PageStat[] = [
    { icon: Sliders, value: selectedBank ? selectedBank.short_code : 'Defaults', label: 'Active Config' },
    { icon: Landmark, value: activeBanks.length, label: 'Active Banks' },
  ];

  const bankTabs = [
    { id: 'defaults', label: 'Network Defaults' },
    ...activeBanks.map(bank => ({ id: bank.id, label: bank.short_code })),
  ];

  const activeBankTab = selectedBankId ?? 'defaults';

  const handleBankTabChange = (tabId: string) => {
    setSelectedBankId(tabId === 'defaults' ? null : tabId);
  };

  const swrIndicator = (defaultsValidating || bankValidating) && d ? (
    <div className="flex items-center gap-1.5 px-2 text-[10px] text-coda-text-muted">
      <div className="w-3 h-3 border border-coda-brand/30 border-t-coda-brand rounded-full animate-spin" />
      Syncing
    </div>
  ) : undefined;

  return (
    <div
      className="pb-24 transition-[padding] duration-500 ease-[cubic-bezier(0.32,0.72,0,1)]"
      style={{ paddingRight: chatPanelOpen ? '348px' : '0px' }}
    >
      <PageShell
        title="Agent Configuration"
        subtitle="Per-bank parameter overrides for the 5-agent pipeline"
        stats={pageStats}
        tabs={bankTabs}
        activeTab={activeBankTab}
        onTabChange={handleBankTabChange}
        tabAction={swrIndicator}
      >

      {/* Loading state — only on cold start (no cached data) */}
      {loading && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="liquid-glass-card squircle p-8 flex items-center justify-center"
        >
          <div className="w-5 h-5 border-2 border-coda-brand/30 border-t-coda-brand rounded-full animate-spin" />
          <span className="ml-2 text-sm text-coda-text-muted">Loading configuration...</span>
        </motion.div>
      )}

      {/* Config cards — with AnimatePresence for smooth tab transitions */}
      <AnimatePresence mode="wait">
        {!loading && d && (
          <motion.div
            key={selectedBankId ?? 'defaults'}
            initial="hidden"
            animate="visible"
            exit="exit"
            variants={{ visible: { transition: { staggerChildren: 0.06 } } }}
            className="space-y-3"
          >
            {/* ━━ Card 1: Maestro — Decision Parameters ━━ */}
            <motion.div
              ref={(el: HTMLDivElement | null) => { cardRefs.current.maestro = el; }}
              variants={cardVariants}
              transition={{ duration: 0.3, ease: [0.25, 0.46, 0.45, 0.94] }}
              animate={highlightedCategories.has('maestro')
                ? { boxShadow: ['0 0 0 0px rgba(37,99,235,0)', '0 0 20px 4px rgba(37,99,235,0.2)', '0 0 0 0px rgba(37,99,235,0)'] }
                : {}}
              style={{ borderRadius: '12px' }}
            >
            <WidgetShell
              title={`Maestro — Decision Parameters${bankCode ? ` (${bankCode})` : ''}`}
              icon={Zap}
              forceOpen={cardOpenState('maestro')}
              dirty={isDefaultsTab ? false : personalityDirty || !isFieldDefault('auto_accept_ceiling') && configDirty}
              collapsible
            >
              {/* Personality prompt */}
              {!isDefaultsTab && config && (
                <div className="space-y-2 pt-2">
                  <label className="text-xs font-medium text-coda-text-secondary">Personality Prompt</label>
                  <textarea
                    value={personality}
                    onChange={(e) => setPersonality(e.target.value)}
                    maxLength={2000}
                    rows={4}
                    className="w-full px-3 py-2 rounded-lg text-sm bg-black/[0.03] dark:bg-white/[0.05] border border-coda-border text-coda-text resize-y focus:outline-none focus:ring-1 focus:ring-coda-brand/40"
                  />
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] text-coda-text-muted">
                      This shapes how Maestro reasons about transactions. {personality.length} / 2000 characters
                    </span>
                    <button
                      onClick={savePersonality}
                      disabled={saving || !personalityDirty}
                      className="liquid-button flex items-center px-3 py-1 text-xs font-medium text-coda-text disabled:opacity-40"
                    >
                      {saveFlash === 'personality' ? <><Check size={12} /> <span>Saved</span></> : <><Save size={12} /> <span>Save</span></>}
                    </button>
                  </div>
                </div>
              )}

              {/* Auto-accept ceiling */}
              <DollarInput
                label="Auto-accept Ceiling"
                value={isDefaultsTab ? (defaults?.auto_accept_ceiling ?? 10_000_000) : (config?.auto_accept_ceiling ?? 10_000_000)}
                onChange={(v) => updateField('auto_accept_ceiling', v)}
                min={100_000} max={50_000_000}
                helperText="Transactions below this amount are auto-approved by Maestro"
                isDefault={isDefaultsTab || isFieldDefault('auto_accept_ceiling')}
                onReset={() => resetField('auto_accept_ceiling')}
                disabled={isDefaultsTab}
              />

              {/* Default Lockup Duration (Task 117) */}
              <div className="space-y-1">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-medium text-coda-text-secondary flex items-center gap-1.5">
                    <Timer size={12} /> Default Lockup Duration
                  </label>
                  {isDefaultsTab ? null : isFieldDefault('default_lockup_duration_minutes') ? (
                    <span className="text-[10px] text-coda-text-muted font-mono">(network default)</span>
                  ) : (
                    <button onClick={() => resetField('default_lockup_duration_minutes')} className="liquid-button text-[10px] text-coda-text-muted"><span>Reset</span></button>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    value={isDefaultsTab ? (defaults?.default_lockup_duration_minutes ?? 30) : (config?.default_lockup_duration_minutes ?? 30)}
                    onChange={(e) => {
                      const v = Number(e.target.value);
                      // Validate: 0 or ≥5
                      if (v === 0 || v >= 5 || e.target.value === '') {
                        updateField('default_lockup_duration_minutes', v);
                      }
                    }}
                    min={0} step={5}
                    disabled={isDefaultsTab}
                    className="w-full px-3 py-1.5 rounded-lg text-sm font-mono text-right bg-black/[0.03] dark:bg-white/[0.05] border border-coda-border text-coda-text disabled:opacity-50 focus:outline-none focus:ring-1 focus:ring-coda-brand/40"
                  />
                  <span className="text-xs text-coda-text-muted whitespace-nowrap">min</span>
                </div>
                <p className="text-[10px] text-coda-text-muted">
                  {(isDefaultsTab ? (defaults?.default_lockup_duration_minutes ?? 30) : (config?.default_lockup_duration_minutes ?? 30)) === 0
                    ? 'Instant PvP settlement — no reversibility window for low-risk transactions'
                    : 'Minimum reversibility window for all outgoing transactions. Risk engine can extend, never shorten. Must be 0 or ≥ 5 min.'
                  }
                </p>
              </div>

              {/* Save Maestro */}
              {!isDefaultsTab && config && (
                <div className="flex justify-end pt-1">
                  <button
                    onClick={() => saveConfig({
                      auto_accept_ceiling: config.auto_accept_ceiling,
                      default_lockup_duration_minutes: config.default_lockup_duration_minutes,
                    })}
                    disabled={saving}
                    className="liquid-button flex items-center px-3 py-1 text-xs font-medium text-coda-text disabled:opacity-40"
                  >
                    {saveFlash === 'config' ? <><Check size={12} /> <span>Saved</span></> : <><Save size={12} /> <span>Save Maestro</span></>}
                  </button>
                </div>
              )}
            </WidgetShell>
            </motion.div>

            {/* ━━ Card 2: Concord — Compliance ━━ */}
            <motion.div
              ref={(el: HTMLDivElement | null) => { cardRefs.current.concord = el; }}
              variants={cardVariants}
              transition={{ duration: 0.3, ease: [0.25, 0.46, 0.45, 0.94] }}
              animate={highlightedCategories.has('concord')
                ? { boxShadow: ['0 0 0 0px rgba(37,99,235,0)', '0 0 20px 4px rgba(37,99,235,0.2)', '0 0 0 0px rgba(37,99,235,0)'] }
                : {}}
              style={{ borderRadius: '12px' }}
            >
            <WidgetShell title="Concord — Compliance" icon={Shield} dirty={isDefaultsTab ? false : configDirty} forceOpen={cardOpenState('concord')} collapsible>
              {/* Escalation thresholds */}
              <div className="space-y-3 pt-2">
                <DollarInput
                  label="First-Time Counterparty Threshold"
                  value={isDefaultsTab ? (defaults?.escalation_first_time_threshold ?? 1_000_000) : (config?.escalation_first_time_threshold ?? 1_000_000)}
                  onChange={(v) => updateField('escalation_first_time_threshold', v)}
                  min={0} max={50_000_000}
                  helperText="Escalate if the counterparty has never transacted before and amount exceeds this"
                  isDefault={isDefaultsTab || isFieldDefault('escalation_first_time_threshold')}
                  onReset={() => resetField('escalation_first_time_threshold')}
                  disabled={isDefaultsTab}
                />
                <DollarInput
                  label="Cross-Jurisdiction Threshold"
                  value={isDefaultsTab ? (defaults?.escalation_cross_jurisdiction ?? 5_000_000) : (config?.escalation_cross_jurisdiction ?? 5_000_000)}
                  onChange={(v) => updateField('escalation_cross_jurisdiction', v)}
                  min={0} max={50_000_000}
                  helperText="Escalate cross-border transactions exceeding this amount"
                  isDefault={isDefaultsTab || isFieldDefault('escalation_cross_jurisdiction')}
                  onReset={() => resetField('escalation_cross_jurisdiction')}
                  disabled={isDefaultsTab}
                />
              </div>

              {/* Velocity guard */}
              <div className="space-y-1">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-medium text-coda-text-secondary">Velocity Guard (txns in 10 min)</label>
                  {isFieldDefault('escalation_velocity_count') ? (
                    <span className="text-[10px] text-coda-text-muted font-mono">(network default)</span>
                  ) : (
                    <button onClick={() => resetField('escalation_velocity_count')} className="liquid-button text-[10px] text-coda-text-muted"><span>Reset</span></button>
                  )}
                </div>
                <input
                  type="number"
                  value={isDefaultsTab ? (defaults?.escalation_velocity_count ?? 3) : (config?.escalation_velocity_count ?? 3)}
                  onChange={(e) => updateField('escalation_velocity_count', Number(e.target.value))}
                  min={1} max={20}
                  disabled={isDefaultsTab}
                  className="w-full px-3 py-1.5 rounded-lg text-sm font-mono text-right bg-black/[0.03] dark:bg-white/[0.05] border border-coda-border text-coda-text disabled:opacity-50 focus:outline-none focus:ring-1 focus:ring-coda-brand/40"
                />
                <p className="text-[10px] text-coda-text-muted">Escalate if a counterparty sends more than this many transactions in a 10-minute window</p>
              </div>

              {/* Jurisdiction whitelist */}
              <div className="space-y-1">
                <label className="text-xs font-medium text-coda-text-secondary flex items-center gap-1.5">
                  <Globe size={12} /> Jurisdiction Whitelist
                </label>
                <div className="flex flex-wrap gap-1">
                  {(isDefaultsTab ? defaults?.jurisdiction_whitelist : config?.jurisdiction_whitelist)?.map((j) => (
                    <span key={j} className="px-2 py-0.5 rounded-full text-[10px] font-mono bg-black/[0.06] dark:bg-white/[0.08] text-coda-text-secondary border border-black/[0.08] dark:border-white/[0.10]">
                      {j}
                    </span>
                  ))}
                </div>
                <p className="text-[10px] text-coda-text-muted">Cross-jurisdiction escalation only applies to transactions outside these jurisdictions</p>
              </div>

              {/* Purpose codes */}
              <div className="space-y-1">
                <label className="text-xs font-medium text-coda-text-secondary flex items-center gap-1.5">
                  <FileText size={12} /> Approved Purpose Codes
                </label>
                <div className="flex flex-wrap gap-1">
                  {(isDefaultsTab ? defaults?.approved_purpose_codes : config?.approved_purpose_codes)?.map((c) => (
                    <span key={c} className="px-2 py-0.5 rounded-full text-[10px] font-mono bg-black/5 dark:bg-white/5 text-coda-text-secondary">
                      {PURPOSE_CODE_LABELS[c] || c}
                    </span>
                  ))}
                </div>
              </div>

              {/* Save */}
              {!isDefaultsTab && config && (
                <div className="flex justify-end pt-1">
                  <button
                    onClick={() => saveConfig({
                      escalation_first_time_threshold: config.escalation_first_time_threshold,
                      escalation_cross_jurisdiction: config.escalation_cross_jurisdiction,
                      escalation_velocity_count: config.escalation_velocity_count,
                    })}
                    disabled={saving}
                    className="liquid-button flex items-center px-3 py-1 text-xs font-medium text-coda-text disabled:opacity-40"
                  >
                    {saveFlash === 'config' ? <><Check size={12} /> <span>Saved</span></> : <><Save size={12} /> <span>Save Concord</span></>}
                  </button>
                </div>
              )}
            </WidgetShell>
            </motion.div>

            {/* ━━ Card 3: Fermata — Risk Engine ━━ */}
            <motion.div
              ref={(el: HTMLDivElement | null) => { cardRefs.current.fermata = el; }}
              variants={cardVariants}
              transition={{ duration: 0.3, ease: [0.25, 0.46, 0.45, 0.94] }}
              animate={highlightedCategories.has('fermata')
                ? { boxShadow: ['0 0 0 0px rgba(37,99,235,0)', '0 0 20px 4px rgba(37,99,235,0.2)', '0 0 0 0px rgba(37,99,235,0)'] }
                : {}}
              style={{ borderRadius: '12px' }}
            >
            <WidgetShell title="Fermata — Risk Engine" icon={Gauge} dirty={isDefaultsTab ? false : configDirty} forceOpen={cardOpenState('fermata')} collapsible>
              {/* Weight distribution */}
              <div className="space-y-3 pt-2">
                <label className="text-xs font-medium text-coda-text-secondary flex items-center gap-1.5">
                  <BarChart3 size={12} /> Risk Weight Distribution
                </label>
                <WeightBar weights={[
                  { label: 'Counterparty', value: isDefaultsTab ? (defaults?.risk_weight_counterparty ?? 0.30) : (config?.risk_weight_counterparty ?? 0.30), color: 'bg-neutral-800 dark:bg-neutral-200' },
                  { label: 'Jurisdiction', value: isDefaultsTab ? (defaults?.risk_weight_jurisdiction ?? 0.25) : (config?.risk_weight_jurisdiction ?? 0.25), color: 'bg-neutral-500 dark:bg-neutral-400' },
                  { label: 'Asset Type', value: isDefaultsTab ? (defaults?.risk_weight_asset_type ?? 0.20) : (config?.risk_weight_asset_type ?? 0.20), color: 'bg-coda-text-muted' },
                  { label: 'Behavioral', value: isDefaultsTab ? (defaults?.risk_weight_behavioral ?? 0.25) : (config?.risk_weight_behavioral ?? 0.25), color: 'bg-coda-text-faint' },
                ]} />

                {!isDefaultsTab && config && (
                  <div className="grid grid-cols-2 gap-3">
                    <SliderInput label="Counterparty" value={config.risk_weight_counterparty} onChange={(v) => updateField('risk_weight_counterparty', v)} min={0} max={1} step={0.05} />
                    <SliderInput label="Jurisdiction" value={config.risk_weight_jurisdiction} onChange={(v) => updateField('risk_weight_jurisdiction', v)} min={0} max={1} step={0.05} />
                    <SliderInput label="Asset Type" value={config.risk_weight_asset_type} onChange={(v) => updateField('risk_weight_asset_type', v)} min={0} max={1} step={0.05} />
                    <SliderInput label="Behavioral" value={config.risk_weight_behavioral} onChange={(v) => updateField('risk_weight_behavioral', v)} min={0} max={1} step={0.05} />
                  </div>
                )}
                {!weightsValid && (
                  <div className="flex items-center gap-1.5 text-destructive text-xs">
                    <AlertTriangle size={12} />
                    Weights must sum to 100% — currently {(weightSum * 100).toFixed(0)}%
                  </div>
                )}
              </div>

              {/* Finality zones */}
              <div className="space-y-2">
                <label className="text-xs font-medium text-coda-text-secondary">Finality Zones</label>
                <FinalityZones
                  instant={isDefaultsTab ? (defaults?.risk_instant_ceiling ?? 30) : (config?.risk_instant_ceiling ?? 30)}
                  deferred24={isDefaultsTab ? (defaults?.risk_deferred_24h_ceiling ?? 60) : (config?.risk_deferred_24h_ceiling ?? 60)}
                  deferred72={isDefaultsTab ? (defaults?.risk_deferred_72h_ceiling ?? 80) : (config?.risk_deferred_72h_ceiling ?? 80)}
                  disabled={isDefaultsTab}
                  onChange={(field, val) => updateField(field as keyof BankAgentConfig, val as any)}
                />
              </div>

              {/* Save */}
              {!isDefaultsTab && config && (
                <div className="flex items-center justify-between pt-1">
                  <button
                    onClick={() => {
                      if (!defaults) return;
                      updateField('risk_weight_counterparty', defaults.risk_weight_counterparty);
                      updateField('risk_weight_jurisdiction', defaults.risk_weight_jurisdiction);
                      updateField('risk_weight_asset_type', defaults.risk_weight_asset_type);
                      updateField('risk_weight_behavioral', defaults.risk_weight_behavioral);
                      updateField('risk_instant_ceiling', defaults.risk_instant_ceiling);
                      updateField('risk_deferred_24h_ceiling', defaults.risk_deferred_24h_ceiling);
                      updateField('risk_deferred_72h_ceiling', defaults.risk_deferred_72h_ceiling);
                    }}
                    className="liquid-button text-[10px] text-coda-text-muted"
                  >
                    <span>Reset to Network Defaults</span>
                  </button>
                  <button
                    onClick={() => {
                      if (!weightsValid) return;
                      saveConfig({
                        risk_weight_counterparty: config.risk_weight_counterparty,
                        risk_weight_jurisdiction: config.risk_weight_jurisdiction,
                        risk_weight_asset_type: config.risk_weight_asset_type,
                        risk_weight_behavioral: config.risk_weight_behavioral,
                        risk_instant_ceiling: config.risk_instant_ceiling,
                        risk_deferred_24h_ceiling: config.risk_deferred_24h_ceiling,
                        risk_deferred_72h_ceiling: config.risk_deferred_72h_ceiling,
                      });
                    }}
                    disabled={saving || !weightsValid}
                    className="liquid-button flex items-center px-3 py-1 text-xs font-medium text-coda-text disabled:opacity-40"
                  >
                    {saveFlash === 'config' ? <><Check size={12} /> <span>Saved</span></> : <><Save size={12} /> <span>Save Fermata</span></>}
                  </button>
                </div>
              )}
            </WidgetShell>
            </motion.div>

            {/* ━━ Card 4: Treasury — Autonomous Operations ━━ */}
            <motion.div
              ref={(el: HTMLDivElement | null) => { cardRefs.current.treasury = el; }}
              variants={cardVariants}
              transition={{ duration: 0.3, ease: [0.25, 0.46, 0.45, 0.94] }}
              animate={highlightedCategories.has('treasury')
                ? { boxShadow: ['0 0 0 0px rgba(37,99,235,0)', '0 0 20px 4px rgba(37,99,235,0.2)', '0 0 0 0px rgba(37,99,235,0)'] }
                : {}}
              style={{ borderRadius: '12px' }}
            >
            <WidgetShell title="Treasury — Autonomous Operations" icon={Landmark} dirty={false} forceOpen={cardOpenState('treasury')} collapsible>
              {/* Safety floor slider */}
              <div className="space-y-2 pt-2">
                <label className="text-xs font-medium text-coda-text-secondary">Minimum Balance Floor</label>
                <SliderInput
                  label=""
                  value={isDefaultsTab ? (defaults?.balance_safety_floor_pct ?? 0.2) : (config?.balance_safety_floor_pct ?? 0.2)}
                  onChange={(v) => updateField('balance_safety_floor_pct', v)}
                  min={0.10} max={0.50} step={0.01}
                  disabled={isDefaultsTab}
                />
                <p className="text-[10px] text-coda-text-muted">
                  This bank will never deploy more than {(100 - (isDefaultsTab ? (defaults?.balance_safety_floor_pct ?? 0.2) : (config?.balance_safety_floor_pct ?? 0.2)) * 100).toFixed(0)}% of its token supply.
                </p>
              </div>

              {/* Heartbeat participation toggle */}
              <div className="flex items-center justify-between py-2">
                <div>
                  <label className="text-xs font-medium text-coda-text-secondary">Participate in Autonomous Treasury Cycles</label>
                  <p className="text-[10px] text-coda-text-muted mt-0.5">
                    When off, this bank will be skipped during heartbeat cycles. It can still send and receive manual payments.
                  </p>
                </div>
                <button
                  onClick={() => { if (!isDefaultsTab && config) updateField('heartbeat_participation', !config.heartbeat_participation); }}
                  disabled={isDefaultsTab}
                  className={`relative rounded-full w-11 h-6 transition-colors ${
                    (isDefaultsTab ? (defaults?.heartbeat_participation ?? true) : (config?.heartbeat_participation ?? true))
                      ? 'bg-neutral-800 dark:bg-neutral-300' : 'bg-coda-text-faint/40'
                  } ${isDefaultsTab ? 'opacity-50' : 'cursor-pointer'}`}
                >
                  <motion.div
                    animate={{
                      x: (isDefaultsTab ? (defaults?.heartbeat_participation ?? true) : (config?.heartbeat_participation ?? true))
                        ? 22 : 2,
                    }}
                    transition={{ type: 'spring', stiffness: 500, damping: 30, mass: 0.8 }}
                    className="absolute top-0.5 w-5 h-5 rounded-full bg-white shadow-md"
                  />
                </button>
              </div>

              {/* Active mandates */}
              {!isDefaultsTab && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-medium text-coda-text-secondary flex items-center gap-1.5">
                      <Activity size={12} /> Active Mandates
                    </label>
                    <button
                      onClick={regenerateMandates}
                      disabled={regenerating}
                      className="liquid-button flex items-center px-2 py-1 text-[10px] font-medium text-coda-text-muted disabled:opacity-40"
                    >
                      <RefreshCw size={10} className={regenerating ? 'animate-spin' : ''} />
                      <span>{regenerating ? 'Regenerating...' : 'Regenerate via Gemini'}</span>
                    </button>
                  </div>
                  <p className="text-[10px] text-coda-text-muted">Mandates are generated by Gemini based on bank personality and network context.</p>

                  {mandates.length === 0 ? (
                    <div className="text-center py-4 text-xs text-coda-text-muted">No mandates found. Click "Regenerate" to create new ones.</div>
                  ) : (
                    <div className="space-y-1.5">
                      {mandates.map((m) => {
                        const p = (m.parameters || {}) as Record<string, unknown>;
                        const colorClass = MANDATE_TYPE_COLORS[m.mandate_type] || 'bg-coda-text-faint/10 text-coda-text-muted';
                        return (
                          <div key={m.id} className={`flex items-start gap-2 p-2 rounded-lg border transition-colors ${
                            m.is_active ? 'border-coda-border bg-black/[0.01] dark:bg-white/[0.01]' : 'border-coda-border/50 opacity-50'
                          }`}>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2">
                                <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${colorClass}`}>
                                  {m.mandate_type.replace(/_/g, ' ').toUpperCase()}
                                </span>
                                <span className="text-[10px] font-mono text-coda-text-muted">P{m.priority}</span>
                              </div>
                              <p className="text-xs text-coda-text mt-0.5 leading-snug">{m.description}</p>
                              {(p.min_transfer_amount || p.max_transfer_amount) && (
                                <p className="text-[10px] text-coda-text-muted mt-0.5 font-mono">
                                  Range: {fmtDollar(Number(p.min_transfer_amount || p.min_amount || 0))} – {fmtDollar(Number(p.max_transfer_amount || p.max_amount || 0))}
                                </p>
                              )}
                            </div>
                            <button
                              onClick={() => toggleMandate(m.id, !m.is_active)}
                              className={`relative rounded-full w-9 h-5 flex-shrink-0 mt-1 transition-colors ${
                                m.is_active ? 'bg-neutral-800 dark:bg-neutral-300' : 'bg-coda-text-faint/40'
                              } cursor-pointer`}
                            >
                              <div className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${
                                m.is_active ? 'translate-x-[18px]' : 'translate-x-0.5'
                              }`} />
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}

              {/* Save */}
              {!isDefaultsTab && config && (
                <div className="flex justify-end pt-1">
                  <button
                    onClick={() => saveConfig({
                      balance_safety_floor_pct: config.balance_safety_floor_pct,
                      heartbeat_participation: config.heartbeat_participation,
                    })}
                    disabled={saving}
                    className="liquid-button flex items-center px-3 py-1 text-xs font-medium text-coda-text disabled:opacity-40"
                  >
                    {saveFlash === 'config' ? <><Check size={12} /> <span>Saved</span></> : <><Save size={12} /> <span>Save Treasury</span></>}
                  </button>
                </div>
              )}
            </WidgetShell>
            </motion.div>

            {/* ━━ Card 5: Cadenza — Dispute Resolution ━━ */}
            <motion.div
              ref={(el: HTMLDivElement | null) => { cardRefs.current.cadenza = el; }}
              variants={cardVariants}
              transition={{ duration: 0.3, ease: [0.25, 0.46, 0.45, 0.94] }}
              animate={highlightedCategories.has('cadenza')
                ? { boxShadow: ['0 0 0 0px rgba(37,99,235,0)', '0 0 20px 4px rgba(37,99,235,0.2)', '0 0 0 0px rgba(37,99,235,0)'] }
                : {}}
              style={{ borderRadius: '12px' }}
            >
            <WidgetShell title="Cadenza — Dispute Resolution" icon={Eye} dirty={isDefaultsTab ? false : configDirty} forceOpen={cardOpenState('cadenza')} collapsible>
              {/* Monitoring sensitivity selector */}
              <div className="space-y-2 pt-2">
                <label className="text-xs font-medium text-coda-text-secondary">Monitoring Sensitivity</label>
                <div className="grid grid-cols-3 gap-1.5">
                  {(['conservative', 'balanced', 'aggressive'] as const).map((mode) => {
                    const currentVal = isDefaultsTab
                      ? (defaults?.cadenza_monitoring_sensitivity ?? 'balanced')
                      : (config?.cadenza_monitoring_sensitivity ?? 'balanced');
                    const isActive = currentVal === mode;
                    return (
                      <button
                        key={mode}
                        onClick={() => { if (!isDefaultsTab) updateField('cadenza_monitoring_sensitivity', mode); }}
                        disabled={isDefaultsTab}
                        className={`px-2 py-1.5 text-[11px] font-medium rounded-md transition-colors ${
                          isActive
                            ? 'text-coda-text'
                            : 'text-coda-text-muted hover:text-coda-text'
                        } disabled:opacity-50`}
                      >
                        <span>{mode.charAt(0).toUpperCase() + mode.slice(1)}</span>
                      </button>
                    );
                  })}
                </div>
                <p className="text-[10px] text-coda-text-muted">
                  {(isDefaultsTab ? defaults?.cadenza_monitoring_sensitivity : config?.cadenza_monitoring_sensitivity) === 'conservative'
                    ? 'More permissive — higher confidence required to flag anomalies.'
                    : (isDefaultsTab ? defaults?.cadenza_monitoring_sensitivity : config?.cadenza_monitoring_sensitivity) === 'aggressive'
                      ? 'Stricter monitoring — lower confidence threshold for flagging.'
                      : 'Balanced approach between false positives and missed anomalies.'}
                </p>
              </div>

              {/* Auto-reverse toggle */}
              <div className="flex items-center justify-between py-2">
                <div>
                  <label className="text-xs font-medium text-coda-text-secondary">Auto-Reverse Enabled</label>
                  <p className="text-[10px] text-coda-text-muted mt-0.5">
                    When off, Cadenza can only escalate or clear — never auto-reverse.
                  </p>
                </div>
                <button
                  onClick={() => { if (!isDefaultsTab && config) updateField('cadenza_auto_reverse_enabled', !config.cadenza_auto_reverse_enabled); }}
                  disabled={isDefaultsTab}
                  className={`relative rounded-full w-11 h-6 transition-colors ${
                    (isDefaultsTab ? (defaults?.cadenza_auto_reverse_enabled ?? true) : (config?.cadenza_auto_reverse_enabled ?? true))
                      ? 'bg-neutral-800 dark:bg-neutral-300' : 'bg-coda-text-faint/40'
                  } ${isDefaultsTab ? 'opacity-50' : 'cursor-pointer'}`}
                >
                  <motion.div
                    animate={{
                      x: (isDefaultsTab ? (defaults?.cadenza_auto_reverse_enabled ?? true) : (config?.cadenza_auto_reverse_enabled ?? true))
                        ? 22 : 2,
                    }}
                    transition={{ type: 'spring', stiffness: 500, damping: 30, mass: 0.8 }}
                    className="absolute top-0.5 w-5 h-5 rounded-full bg-white shadow-md"
                  />
                </button>
              </div>

              {/* Escalation threshold slider */}
              <div className="space-y-1">
                <SliderInput
                  label="Escalation Threshold"
                  value={isDefaultsTab ? (defaults?.cadenza_escalation_threshold ?? 0.6) : (config?.cadenza_escalation_threshold ?? 0.6)}
                  onChange={(v) => updateField('cadenza_escalation_threshold', v)}
                  min={0.1} max={1.0} step={0.05}
                  disabled={isDefaultsTab}
                />
                <p className="text-[10px] text-coda-text-muted">
                  Confidence below {((isDefaultsTab ? defaults?.cadenza_escalation_threshold : config?.cadenza_escalation_threshold) ?? 0.6).toFixed(2)} triggers escalation instead of auto-action.
                </p>
              </div>

              {/* Velocity spike multiplier */}
              <div className="space-y-1">
                <SliderInput
                  label="Velocity Spike Multiplier"
                  value={isDefaultsTab ? (defaults?.cadenza_velocity_spike_multiplier ?? 3.0) : (config?.cadenza_velocity_spike_multiplier ?? 3.0)}
                  onChange={(v) => updateField('cadenza_velocity_spike_multiplier', v)}
                  min={1.0} max={10.0} step={0.5}
                  suffix="x"
                  disabled={isDefaultsTab}
                />
                <p className="text-[10px] text-coda-text-muted">
                  Flag if velocity exceeds {((isDefaultsTab ? defaults?.cadenza_velocity_spike_multiplier : config?.cadenza_velocity_spike_multiplier) ?? 3.0).toFixed(1)}x the corridor average.
                </p>
              </div>

              {/* Duplicate window + max lockup hours — compact grid */}
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-xs font-medium text-coda-text-secondary">Duplicate Window</label>
                  <input
                    type="number"
                    value={isDefaultsTab ? (defaults?.cadenza_duplicate_window_seconds ?? 300) : (config?.cadenza_duplicate_window_seconds ?? 300)}
                    onChange={(e) => updateField('cadenza_duplicate_window_seconds', Number(e.target.value))}
                    min={10} max={3600}
                    disabled={isDefaultsTab}
                    className="w-full px-3 py-1.5 rounded-lg text-sm font-mono text-right bg-black/[0.03] dark:bg-white/[0.05] border border-coda-border text-coda-text disabled:opacity-50 focus:outline-none focus:ring-1 focus:ring-coda-brand/40"
                  />
                  <p className="text-[10px] text-coda-text-muted">{(isDefaultsTab ? defaults?.cadenza_duplicate_window_seconds : config?.cadenza_duplicate_window_seconds) ?? 300}s window</p>
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-medium text-coda-text-secondary">Max Lockup Hours</label>
                  <input
                    type="number"
                    value={isDefaultsTab ? (defaults?.cadenza_max_lockup_hours ?? 72) : (config?.cadenza_max_lockup_hours ?? 72)}
                    onChange={(e) => updateField('cadenza_max_lockup_hours', Number(e.target.value))}
                    min={1} max={720}
                    disabled={isDefaultsTab}
                    className="w-full px-3 py-1.5 rounded-lg text-sm font-mono text-right bg-black/[0.03] dark:bg-white/[0.05] border border-coda-border text-coda-text disabled:opacity-50 focus:outline-none focus:ring-1 focus:ring-coda-brand/40"
                  />
                  <p className="text-[10px] text-coda-text-muted">{(isDefaultsTab ? defaults?.cadenza_max_lockup_hours : config?.cadenza_max_lockup_hours) ?? 72}h max</p>
                </div>
              </div>

              {/* Save */}
              {!isDefaultsTab && config && (
                <div className="flex justify-end pt-1">
                  <button
                    onClick={() => saveConfig({
                      cadenza_monitoring_sensitivity: config.cadenza_monitoring_sensitivity,
                      cadenza_auto_reverse_enabled: config.cadenza_auto_reverse_enabled,
                      cadenza_escalation_threshold: config.cadenza_escalation_threshold,
                      cadenza_velocity_spike_multiplier: config.cadenza_velocity_spike_multiplier,
                      cadenza_duplicate_window_seconds: config.cadenza_duplicate_window_seconds,
                      cadenza_max_lockup_hours: config.cadenza_max_lockup_hours,
                    })}
                    disabled={saving}
                    className="liquid-button flex items-center px-3 py-1 text-xs font-medium text-coda-text disabled:opacity-40"
                  >
                    {saveFlash === 'config' ? <><Check size={12} /> <span>Saved</span></> : <><Save size={12} /> <span>Save Cadenza</span></>}
                  </button>
                </div>
              )}
            </WidgetShell>
            </motion.div>



          </motion.div>
        )}
      </AnimatePresence>

      {/* ═══════════════════════════════════════════════════════
          ARIA — GlobalInputBar (fixed bottom, only for bank tabs)
          ═══════════════════════════════════════════════════════ */}
      {!isDefaultsTab && selectedBankId && (
        <GlobalInputBar
          sidebarWidth={sidebarWidth}
          placeholder={`Ask Aria about ${bankCode || 'this bank'}...`}
          ctaQuestion="Try asking:"
          suggestions={ariaSuggestions}
          onQuerySubmit={handleAriaQuery}
          isLoading={aria.isLoading}
          aiResponse={aria.aiResponse}
          isTypingResponse={aria.isTypingResponse}
          onClearResponse={() => {
            aria.clearResponse();
            if (!aria.activeProposal && !aria.confirmMessage) {
              setLastAction('none');
            }
          }}
          workflowContext={workflowContext}
          disableInitialAnimation={true}
          conversationHistory={conversationHistory}
          ariaMode={ariaMode}
          onSetAriaMode={setAriaMode}
          bankLabel={bankCode}
        />
      )}

      {/* ═══════════════════════════════════════════════════════
          ARIA — Apple-style change toast (fixed top)
          ═══════════════════════════════════════════════════════ */}
      <ConfigChangeToast
        changes={changeToastData}
        visible={showChangeToast}
        onDismiss={() => setShowChangeToast(false)}
        sidebarWidth={sidebarWidth}
        duration={5000}
        chatPanelOpen={chatPanelOpen}
      />
      </PageShell>
    </div>
  );
}