/**
 * AgentReasoningPanel — "Agent Dialogue Theater"
 *
 * Two-part component that makes AI agent intelligence VISIBLE during pipeline
 * execution. Part 1: compact PipelineStrip at top. Part 2: expanding reasoning
 * card showing inputs (what the agent is reading) and outputs (what it decided).
 *
 * v2: Multi-transaction tracking — supports parallel treasury cycle pipelines.
 *     Multiple transactions can be in-flight simultaneously. A transaction tab
 *     strip appears when 2+ are active, and the Maestro phase shows parallel
 *     evaluation results arriving one-by-one.
 *
 * Data sources:
 *  - Realtime on `transactions` (INSERT + UPDATE) → pipeline position + tx data
 *  - Realtime on `agent_messages` (INSERT) → agent outputs (compliance, risk, etc.)
 *  - Props: currentCycle (market event, bank evaluations)
 *  - BanksContext: bank names, codes, balances
 */

import { useEffect, useState, useRef, useCallback, useMemo } from 'react';
import { motion, AnimatePresence } from './motion-shim';
import { CheckCircle2, XCircle, ExternalLink } from 'lucide-react';
import { useRealtimeSubscription } from '../hooks/useRealtimeSubscription';
import { useBanks } from '../contexts/BanksContext';
import { truncateAddress, explorerUrl } from '../types';
import { PipelineStrip, PIPELINE_AGENTS } from './PipelineStrip';
import { BRAND_HEX } from './PipelineStrip';
import type { DataPill, StripTransaction } from './PipelineStrip';

// ============================================================
// Types
// ============================================================

type AgentPhase = 'maestro' | 'concord' | 'fermata' | 'canto' | 'solana';

interface InputRow {
  label: string;
  value: string;
}

interface ComplianceCheck {
  type: string;
  passed: boolean;
  detail: string;
}

interface RiskScores {
  counterparty_score: number;
  jurisdiction_score: number;
  asset_type_score: number;
  behavioral_score: number;
  composite_score: number;
  risk_level: string;
  finality: string;
  reasoning: string;
  corridor_depth?: number;
  sender_velocity_60min?: number;
  sender_volume_60min?: number;
}

interface MaestroDecision {
  bankCode: string;
  decision: string;
  reasoning: string;
  amount?: string;
  counterparty?: string;
}

interface CantoOutput {
  status: string;
  signature?: string;
  slot?: number;
  amount?: string;
}

interface AgentOutput {
  type: AgentPhase;
  maestro?: MaestroDecision;
  compliance?: { checks: ComplianceCheck[]; passed: boolean; total: number; concordNarrative?: string };
  risk?: RiskScores;
  canto?: CantoOutput;
}

/** Per-transaction tracking state */
interface TrackedTransaction {
  id: string;
  status: string;
  step: number;                // 0=Maestro, 1=Concord, 2=Fermata, 3=Canto, 4=Solana
  phase: AgentPhase;
  amount_display: number;
  sender_bank_id: string;
  receiver_bank_id: string;
  senderCode: string;
  receiverCode: string;
  purpose_code?: string;
  solana_tx_signature?: string;
  // Per-transaction agent outputs (accumulate as pipeline progresses)
  agentOutputs: Partial<Record<AgentPhase, AgentOutput>>;
  // Per-transaction intermediate data carried forward
  lastCompliance: { passed: number; total: number } | null;
  lastRisk: RiskScores | null;
  // Whether this tx is done (settled/rejected)
  isComplete: boolean;
}

interface HeartbeatCycle {
  id: string;
  cycle_number: number;
  status: string;
  market_event: {
    event_type: string;
    cycle_narrative: string;
    per_bank_events: Record<string, unknown>;
  } | null;
  started_at: string | null;
  completed_at: string | null;
}

interface AgentReasoningPanelProps {
  isRunning: boolean;
  currentCycle: HeartbeatCycle | null;
}

// ============================================================
// Constants
// ============================================================

const PHASE_TO_STEP: Record<AgentPhase, number> = {
  maestro: 0, concord: 1, fermata: 2, canto: 3, solana: 4,
};

const TX_STATUS_TO_PHASE: Record<string, AgentPhase> = {
  initiated: 'concord',
  compliance_check: 'fermata',
  risk_scored: 'canto',
  executing: 'canto',
  settled: 'solana',
  locked: 'solana',
};

const PIN_DURATION_MS = 5000; // Manual focus pin duration

// ============================================================
// Typewriter hook
// ============================================================

function useTypewriter(text: string, speed = 25, enabled = true): string {
  const [displayed, setDisplayed] = useState('');
  const frameRef = useRef<number>(0);
  const indexRef = useRef(0);

  useEffect(() => {
    if (!enabled || !text) {
      setDisplayed(text || '');
      return;
    }
    indexRef.current = 0;
    setDisplayed('');

    let lastTime = 0;
    const step = (time: number) => {
      if (time - lastTime >= speed) {
        indexRef.current++;
        setDisplayed(text.slice(0, indexRef.current));
        lastTime = time;
      }
      if (indexRef.current < text.length) {
        frameRef.current = requestAnimationFrame(step);
      }
    };
    frameRef.current = requestAnimationFrame(step);

    return () => cancelAnimationFrame(frameRef.current);
  }, [text, speed, enabled]);

  return displayed;
}

// ============================================================
// Component
// ============================================================

export function AgentReasoningPanel({ isRunning, currentCycle }: AgentReasoningPanelProps) {
  const { banks } = useBanks();

  // ── State ��─────────────────────────────────────────────────
  const [trackedTxs, setTrackedTxs] = useState<Map<string, TrackedTransaction>>(new Map());
  const [focusedTxId, setFocusedTxId] = useState<string | null>(null);
  const [maestroDecisions, setMaestroDecisions] = useState<MaestroDecision[]>([]);
  const [isMaestroPhase, setIsMaestroPhase] = useState(false);
  const [isVisible, setIsVisible] = useState(false);
  const [pills, setPills] = useState<DataPill[]>([]);

  // Pin tracking for manual focus
  const pinnedUntilRef = useRef<number>(0);
  // Pill stagger ref — avoids dependency on pills state in callbacks
  const pillStaggerRef = useRef(0);
  // Timer refs
  const pillCleanupRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const fadeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Helper: look up bank data ──────────────────────────────
  const bankCode = useCallback((id: string) => {
    return banks.find(b => b.id === id)?.short_code || '??';
  }, [banks]);

  const bankName = useCallback((id: string) => {
    return banks.find(b => b.id === id)?.name || 'Unknown Bank';
  }, [banks]);

  const bankBalance = useCallback((id: string) => {
    const bank = banks.find(b => b.id === id);
    const wallet = bank?.wallets?.[0];
    if (!wallet) return '\u2014';
    const balance = (wallet.balance_tokens ?? 0) / 1e6;
    return `$${balance.toLocaleString()}`;
  }, [banks]);

  const bankWalletPubkey = useCallback((id: string) => {
    const bank = banks.find(b => b.id === id);
    return bank?.wallets?.[0]?.solana_pubkey || bank?.solana_wallet_pubkey || null;
  }, [banks]);

  // ── Fire data pill ─────────────────────────────────────────
  const firePill = useCallback((fromIdx: number, toIdx: number, label: string, staggerMs = 0) => {
    const id = `pill-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const addPill = () => {
      setPills(prev => {
        const next = [...prev, { id, fromIndex: fromIdx, toIndex: toIdx, label }];
        pillStaggerRef.current = next.length > 0 ? 100 : 0;
        return next;
      });
      const timer = setTimeout(() => {
        setPills(prev => {
          const next = prev.filter(p => p.id !== id);
          pillStaggerRef.current = next.length > 0 ? 100 : 0;
          return next;
        });
        pillCleanupRef.current.delete(id);
      }, 1000);
      pillCleanupRef.current.set(id, timer);
    };
    if (staggerMs > 0) {
      setTimeout(addPill, staggerMs);
    } else {
      addPill();
    }
  }, []);

  // ── Reset state ────────────────────────────────────────────
  const resetState = useCallback(() => {
    setTrackedTxs(new Map());
    setFocusedTxId(null);
    setMaestroDecisions([]);
    setIsMaestroPhase(false);
    setPills([]);
    pinnedUntilRef.current = 0;
  }, []);

  // ── Detect Maestro phase from cycle ────────────────────────
  const prevCycleIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (currentCycle?.status === 'running') {
      if (prevCycleIdRef.current !== currentCycle.id) {
        resetState();
        prevCycleIdRef.current = currentCycle.id;
      }
      setIsVisible(true);
      // Only set Maestro if we don't have tracked transactions yet
      setTrackedTxs(prev => {
        if (prev.size === 0) {
          setIsMaestroPhase(true);
          setMaestroDecisions([]);
        }
        return prev;
      });
    }
  }, [currentCycle?.status, currentCycle?.id, resetState]);

  // ── Auto-focus logic ───────────────────────────────────────
  const autoFocus = useCallback((txMap: Map<string, TrackedTransaction>, currentFocusId: string | null) => {
    // Don't auto-switch if manually pinned
    if (Date.now() < pinnedUntilRef.current) return currentFocusId;

    // If current focus is still active, keep it
    const current = currentFocusId ? txMap.get(currentFocusId) : null;
    if (current && !current.isComplete) return currentFocusId;

    // Find the first in-flight transaction
    for (const [id, tx] of txMap) {
      if (!tx.isComplete) return id;
    }

    // All complete — show the last one
    if (txMap.size > 0) {
      const ids = Array.from(txMap.keys());
      return ids[ids.length - 1];
    }
    return null;
  }, []);

  // ── Handle transaction status changes ──────────────────────
  const handleTxUpdate = useCallback((txData: any) => {
    const phase = TX_STATUS_TO_PHASE[txData.status];
    if (!phase) return;

    setIsVisible(true);
    setIsMaestroPhase(false);

    const sCode = bankCode(txData.sender_bank_id);
    const rCode = bankCode(txData.receiver_bank_id);
    const isComplete = ['settled', 'rejected', 'reversed'].includes(txData.status);

    setTrackedTxs(prev => {
      const next = new Map(prev);
      const existing = next.get(txData.id);
      const newTx: TrackedTransaction = {
        id: txData.id,
        status: txData.status,
        step: PHASE_TO_STEP[phase],
        phase,
        amount_display: txData.amount_display || (txData.amount ? txData.amount / 1e6 : 0),
        sender_bank_id: txData.sender_bank_id,
        receiver_bank_id: txData.receiver_bank_id,
        senderCode: sCode,
        receiverCode: rCode,
        purpose_code: txData.purpose_code,
        solana_tx_signature: txData.solana_tx_signature,
        agentOutputs: existing?.agentOutputs || {},
        lastCompliance: existing?.lastCompliance || null,
        lastRisk: existing?.lastRisk || null,
        isComplete,
      };
      next.set(txData.id, newTx);

      // Auto-focus
      setFocusedTxId(prevFocus => autoFocus(next, prevFocus));

      return next;
    });
  }, [bankCode, autoFocus]);

  // ── Handle agent_messages ──────────────────────────────────
  const handleAgentMessage = useCallback((msg: any) => {
    const content = msg.content || {};
    const nl = msg.natural_language || '';

    switch (msg.message_type) {
      case 'compliance_response': {
        const txId = msg.transaction_id;
        if (!txId) break;

        const checks: ComplianceCheck[] = (content.checks || []).map((c: any) => ({
          type: c.type || '',
          passed: !!c.passed,
          detail: c.detail || '',
        }));
        const passed = content.result === 'PASSED';
        const total = content.checks_total || checks.length;
        const passedCount = content.checks_passed || checks.filter((c: ComplianceCheck) => c.passed).length;

        setTrackedTxs(prev => {
          const next = new Map(prev);
          const tx = next.get(txId);
          if (tx) {
            tx.lastCompliance = { passed: passedCount, total };
            tx.agentOutputs.concord = {
              type: 'concord',
              compliance: { checks, passed, total, concordNarrative: content.concord_narrative || '' },
            };
            next.set(txId, { ...tx });
          }
          return next;
        });

        // Determine stagger based on concurrent pills
        const stagger = pillStaggerRef.current;
        firePill(1, 2, `${passed ? 'PASSED' : 'FAILED'} ${passedCount}/${total}`, stagger);
        break;
      }

      case 'risk_alert': {
        const txId = msg.transaction_id;
        if (!txId) break;

        const scores: RiskScores = {
          counterparty_score: content.counterparty_score ?? 0,
          jurisdiction_score: content.jurisdiction_score ?? 0,
          asset_type_score: content.asset_type_score ?? 0,
          behavioral_score: content.behavioral_score ?? 0,
          composite_score: content.composite_score ?? 0,
          risk_level: content.risk_level || 'medium',
          finality: content.finality || 'immediate',
          reasoning: content.reasoning || '',
          corridor_depth: content.corridor_depth,
          sender_velocity_60min: content.sender_velocity_60min,
          sender_volume_60min: content.sender_volume_60min,
        };

        setTrackedTxs(prev => {
          const next = new Map(prev);
          const tx = next.get(txId);
          if (tx) {
            tx.lastRisk = scores;
            tx.agentOutputs.fermata = {
              type: 'fermata',
              risk: scores,
            };
            next.set(txId, { ...tx });
          }
          return next;
        });

        const stagger = pillStaggerRef.current;
        firePill(2, 3, `${scores.risk_level.toUpperCase()} ${scores.composite_score}`, stagger);
        break;
      }

      case 'status_update': {
        const action = content.action || '';
        const context = content.context || '';

        // Pipeline decision or settlement started — no panel changes needed
        if (action === 'agent_decision' && context === 'pipeline_decision') break;
        if (action === 'settlement_started' && context === 'settlement') break;

        // Treasury cycle evaluation results (Maestro phase)
        if (context === 'treasury_cycle' || action === 'NO_ACTION') {
          const bankId = msg.from_bank_id;
          const code = banks.find(b => b.id === bankId)?.short_code || '??';
          const reasoning = content.reasoning || nl || '';
          setMaestroDecisions(prev => [...prev, {
            bankCode: code,
            decision: 'NO_ACTION',
            reasoning: reasoning.slice(0, 200),
          }]);
          break;
        }

        // Initiate payment decision
        if (action === 'initiate_payment' || action === 'INITIATE_PAYMENT') {
          const bankId = msg.from_bank_id;
          const code = banks.find(b => b.id === bankId)?.short_code || '??';
          const reasoning = content.reasoning || nl || '';
          const amount = content.amount_display
            ? `$${Number(content.amount_display).toLocaleString()}`
            : '';
          setMaestroDecisions(prev => [...prev, {
            bankCode: code,
            decision: 'INITIATE_PAYMENT',
            reasoning: reasoning.slice(0, 200),
            amount,
            counterparty: content.receiver_bank_code || '',
          }]);
          break;
        }
        break;
      }

      case 'settlement_confirm': {
        const txId = msg.transaction_id;
        if (!txId) break;

        const output: AgentOutput = {
          type: 'solana',
          canto: {
            status: content.action === 'locked' ? 'Locked' : 'Settled',
            signature: content.tx_signature,
            slot: undefined,
            amount: content.amount_display
              ? `$${Number(content.amount_display).toLocaleString()}`
              : undefined,
          },
        };

        setTrackedTxs(prev => {
          const next = new Map(prev);
          const tx = next.get(txId);
          if (tx) {
            tx.agentOutputs.solana = output;
            tx.agentOutputs.canto = output;
            next.set(txId, { ...tx });
          }
          return next;
        });

        const sig = content.tx_signature || '';
        const stagger = pillStaggerRef.current;
        firePill(3, 4, `sig: ${sig.slice(0, 8)}...`, stagger);
        break;
      }

      case 'payment_request': {
        // Maestro dispatched → fire pill to Concord
        const amt = content.amount
          ? `$${Math.round(content.amount / 1000)}K`
          : '';
        const sCode = banks.find(b => b.id === msg.from_bank_id)?.short_code || '';
        const rCode = banks.find(b => b.id === msg.to_bank_id)?.short_code || '';
        if (sCode && rCode) {
          const stagger = pillStaggerRef.current;
          firePill(0, 1, `${amt} ${sCode}\u2192${rCode}`, stagger);
        }
        break;
      }
    }
  }, [banks, firePill]);

  // ── Realtime subscriptions ─────────────────────────────────
  useRealtimeSubscription({
    channelName: 'reasoning-panel-rt',
    subscriptions: [
      {
        table: 'transactions',
        event: 'INSERT',
        callback: (payload) => handleTxUpdate(payload.new),
      },
      {
        table: 'transactions',
        event: 'UPDATE',
        callback: (payload) => handleTxUpdate(payload.new),
      },
      {
        table: 'agent_messages',
        event: 'INSERT',
        callback: (payload) => handleAgentMessage(payload.new),
      },
    ],
  });

  // Cleanup pill timers and fade timer on unmount
  useEffect(() => {
    return () => {
      for (const timer of pillCleanupRef.current.values()) clearTimeout(timer);
      if (fadeTimerRef.current) clearTimeout(fadeTimerRef.current);
    };
  }, []);

  // ── Completion: collapse after all txs done ────────────────
  useEffect(() => {
    if (trackedTxs.size === 0) return;

    const allComplete = Array.from(trackedTxs.values()).every(tx => tx.isComplete);
    if (allComplete && currentCycle?.status === 'completed') {
      if (fadeTimerRef.current) clearTimeout(fadeTimerRef.current);
      fadeTimerRef.current = setTimeout(() => {
        // Don't hide — keep final state visible. Will reset on next cycle.
      }, 3000);
    }
  }, [trackedTxs, currentCycle?.status]);

  // ── Focused transaction ────────────────────────────────────
  const focusedTx = focusedTxId ? trackedTxs.get(focusedTxId) : null;
  const activePhase: AgentPhase | null = isMaestroPhase ? 'maestro' : (focusedTx?.phase || null);

  // ── Build active transactions for PipelineStrip ────────────
  const activeStripTxs: StripTransaction[] = useMemo(() => {
    return Array.from(trackedTxs.values()).map(tx => ({
      id: tx.id,
      step: tx.step,
      senderCode: tx.senderCode,
      receiverCode: tx.receiverCode,
      amount: `$${tx.amount_display.toLocaleString()}`,
    }));
  }, [trackedTxs]);

  // ── Build input rows based on active phase + focused tx ────
  const inputRows: InputRow[] = useMemo(() => {
    if (!activePhase) return [];

    if (activePhase === 'maestro') {
      const rows: InputRow[] = [];
      if (currentCycle?.market_event) {
        const me = currentCycle.market_event;
        rows.push({
          label: 'Market Event',
          value: me.event_type.replace(/_/g, ' ').toUpperCase(),
        });
        rows.push({
          label: 'Narrative',
          value: (me.cycle_narrative || '').slice(0, 120),
        });

        const bankEvents = me.per_bank_events || {};
        const codes = Object.keys(bankEvents);
        if (codes.length > 0) {
          rows.push({
            label: 'Banks Evaluating',
            value: codes.join(' \u00B7 '),
          });
        }
      }
      if (rows.length === 0) {
        rows.push({ label: 'Status', value: 'Evaluating bank treasury positions...' });
      }
      return rows;
    }

    if (!focusedTx) return [];

    switch (activePhase) {
      case 'concord': {
        return [
          { label: 'Transaction', value: `$${focusedTx.amount_display.toLocaleString()} \u00B7 ${focusedTx.senderCode} \u2192 ${focusedTx.receiverCode}` },
          { label: 'Purpose', value: focusedTx.purpose_code || 'unspecified' },
          { label: 'Sender', value: `${bankName(focusedTx.sender_bank_id)} \u00B7 active` },
          { label: 'Receiver', value: `${bankName(focusedTx.receiver_bank_id)} \u00B7 active` },
          { label: 'Balance Check', value: `${bankBalance(focusedTx.sender_bank_id)} available` },
        ];
      }

      case 'fermata': {
        const rows: InputRow[] = [
          { label: 'Transaction', value: `$${focusedTx.amount_display.toLocaleString()} \u00B7 ${focusedTx.senderCode} \u2192 ${focusedTx.receiverCode}` },
        ];
        if (focusedTx.lastCompliance) {
          rows.push({ label: 'Compliance', value: `PASSED ${focusedTx.lastCompliance.passed}/${focusedTx.lastCompliance.total}` });
        }
        rows.push({ label: 'Counterparty', value: `${bankName(focusedTx.receiver_bank_id)}` });
        rows.push({ label: 'Amount Context', value: `$${focusedTx.amount_display.toLocaleString()} wholesale settlement` });
        return rows;
      }

      case 'canto': {
        const rows: InputRow[] = [
          { label: 'Transaction', value: `$${focusedTx.amount_display.toLocaleString()} \u00B7 ${focusedTx.senderCode} \u2192 ${focusedTx.receiverCode}` },
        ];
        if (focusedTx.lastRisk) {
          rows.push({ label: 'Risk Level', value: `${focusedTx.lastRisk.risk_level.toUpperCase()} (${focusedTx.lastRisk.composite_score}/100)` });
          rows.push({ label: 'Finality', value: focusedTx.lastRisk.finality === 'immediate' ? 'Immediate' : `Deferred: ${focusedTx.lastRisk.finality}` });
        }
        const sPubkey = bankWalletPubkey(focusedTx.sender_bank_id);
        const rPubkey = bankWalletPubkey(focusedTx.receiver_bank_id);
        if (sPubkey) rows.push({ label: 'Sender Wallet', value: truncateAddress(sPubkey, 6) });
        if (rPubkey) rows.push({ label: 'Receiver Wallet', value: truncateAddress(rPubkey, 6) });
        return rows;
      }

      case 'solana': {
        return [
          { label: 'Status', value: 'On-chain confirmation received' },
          { label: 'Network', value: 'Solana Devnet' },
        ];
      }

      default:
        return [];
    }
  }, [activePhase, currentCycle, focusedTx, bankName, bankBalance, bankWalletPubkey]);

  // ── Determine current agent output for focused tx ──────────
  const currentOutput: AgentOutput | null = useMemo(() => {
    if (activePhase === 'maestro') {
      // For Maestro, show the latest maestro decision
      if (maestroDecisions.length > 0) {
        const last = maestroDecisions[maestroDecisions.length - 1];
        return { type: 'maestro', maestro: last };
      }
      return null;
    }
    if (!focusedTx || !activePhase) return null;
    return focusedTx.agentOutputs[activePhase] || null;
  }, [activePhase, focusedTx, maestroDecisions]);

  // ── Active agent config ────────────────────────────────────
  const activeIdx = activePhase ? PHASE_TO_STEP[activePhase] : -1;
  const activeAgent = activeIdx >= 0 ? PIPELINE_AGENTS[activeIdx] : null;
  const hasOutput = currentOutput !== null;

  // ── Agent role labels ──────────────────────────────────────
  const AGENT_ROLES: Record<AgentPhase, string> = {
    maestro: 'Settlement Orchestration',
    concord: 'Compliance Engine',
    fermata: 'Risk Scoring',
    canto: 'On-Chain Execution',
    solana: 'Devnet L1 Confirmation',
  };

  // ── Tab handling ───────────────────────────────────────────
  const handleTabClick = useCallback((txId: string) => {
    setFocusedTxId(txId);
    pinnedUntilRef.current = Date.now() + PIN_DURATION_MS;
  }, []);

  const txList = useMemo(() => Array.from(trackedTxs.values()), [trackedTxs]);
  const showTabs = txList.length > 1;

  return (
    <div className="space-y-0">
      {/* PART 1: Pipeline Strip (always shows when visible) */}
      <AnimatePresence>
        {isVisible && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.3, ease: 'easeOut' }}
          >
            <div className="dashboard-card-subtle px-4 pt-3 pb-1 rounded-b-none border-b-0">
              <PipelineStrip
                activeTransactions={activeStripTxs}
                pills={pills}
                maestroActive={isMaestroPhase}
              />
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* PART 1.5: Transaction Tab Strip (only when 2+ transactions) */}
      <AnimatePresence>
        {isVisible && showTabs && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.2 }}
          >
            <div className="dashboard-card-subtle rounded-none border-y-0 px-4 py-2 flex gap-2 overflow-x-auto">
              {txList.map(tx => {
                const isFocused = focusedTxId === tx.id;
                const phaseColor = tx.isComplete
                  ? 'bg-coda-text-muted'
                  : 'bg-coda-text-secondary';

                return (
                  <button
                    key={tx.id}
                    onClick={() => handleTabClick(tx.id)}
                    className={`flex items-center px-3 py-1.5 text-xs font-medium rounded-md transition-colors cursor-pointer whitespace-nowrap ${
                      isFocused
                        ? 'text-coda-text'
                        : 'bg-transparent text-coda-text-muted hover:text-coda-text'
                    }`}
                  >
                    <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${phaseColor}`} />
                    <span>{tx.senderCode}\u2192{tx.receiverCode}</span>
                    <span className="font-mono text-[10px] opacity-70">
                      ${tx.amount_display >= 1000
                        ? `${(tx.amount_display / 1000000).toFixed(1)}M`
                        : tx.amount_display.toLocaleString()}
                    </span>
                    {tx.isComplete && (
                      <CheckCircle2 size={10} className="text-coda-text-muted flex-shrink-0" />
                    )}
                  </button>
                );
              })}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* PART 2: Reasoning Panel (expands when an agent is active) */}
      <AnimatePresence>
        {isVisible && activePhase && activeAgent && (
          <motion.div
            key={`panel-${activePhase}-${focusedTxId || 'maestro'}`}
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.35, ease: 'easeOut' }}
            className="overflow-hidden"
          >
            <div
              className={`dashboard-card-subtle overflow-hidden ${showTabs ? 'rounded-t-none' : 'rounded-t-none'}`}
            >
              {/* Header bar — single brand accent */}
              <motion.div
                className="flex items-center justify-between px-4 py-2.5 bg-black/[0.03] dark:bg-white/[0.03] border-b border-black/[0.06] dark:border-white/[0.06]"
                layout
              >
                <div className="flex items-center gap-2.5">
                  {/* Monogram badge */}
                  <div
                    className="w-7 h-7 rounded-lg flex items-center justify-center bg-black/[0.06] dark:bg-white/[0.08] border border-black/[0.06] dark:border-white/[0.08]"
                  >
                    <span className="text-[11px] font-semibold font-mono text-coda-text">
                      {activeAgent.monogram}
                    </span>
                  </div>
                  {/* Icon + name + role */}
                  <div className="flex items-center gap-2">
                    <activeAgent.icon size={14} className="text-coda-text-secondary opacity-70" />
                    <div>
                      <span className="text-sm font-semibold text-coda-text">
                        {activeAgent.name}
                      </span>
                      <span className="text-xs text-coda-text-muted ml-2">
                        {AGENT_ROLES[activePhase]}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Status badge */}
                {hasOutput ? (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-black/[0.04] dark:bg-white/[0.08] text-coda-text-muted">
                    <CheckCircle2 size={10} className="text-coda-text-muted" /> complete
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-black/[0.04] dark:bg-white/[0.08] text-coda-text-muted">
                    <ThinkingDot color={BRAND_HEX} />
                    evaluating
                  </span>
                )}
              </motion.div>

              {/* Body: two columns */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-0 md:divide-x md:divide-coda-border-subtle">
                {/* LEFT: Inputs */}
                <div className="px-4 py-3">
                  <div className="text-[10px] uppercase tracking-widest text-coda-text-muted font-semibold mb-2.5">
                    Inputs
                  </div>
                  <div className="space-y-1.5">
                    {inputRows.map((row, i) => (
                      <motion.div
                        key={`${activePhase}-${focusedTxId}-input-${i}-${row.label}`}
                        initial={{ opacity: 0, y: 6 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: i * 0.15, duration: 0.25 }}
                        className="flex items-start gap-2"
                      >
                        <span className="text-[11px] text-coda-text-muted w-24 flex-shrink-0 pt-0.5 text-right font-medium">
                          {row.label}
                        </span>
                        <span className="text-[11px] text-coda-text-secondary leading-relaxed">
                          {row.value}
                        </span>
                      </motion.div>
                    ))}
                  </div>
                </div>

                {/* RIGHT: Outputs */}
                <div className="px-4 py-3">
                  <div className="text-[10px] uppercase tracking-widest text-coda-text-muted font-semibold mb-2.5">
                    Output
                  </div>
                  {activePhase === 'maestro' ? (
                    <MaestroPhaseOutput decisions={maestroDecisions} />
                  ) : !hasOutput ? (
                    <ThinkingIndicator color={BRAND_HEX} />
                  ) : (
                    <OutputPanel output={currentOutput} activePhase={activePhase} />
                  )}
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ============================================================
// Maestro Phase Output — shows parallel evaluation results
// ============================================================

function MaestroPhaseOutput({ decisions }: { decisions: MaestroDecision[] }) {
  if (decisions.length === 0) {
    return <ThinkingIndicator color={BRAND_HEX} />;
  }

  return (
    <div className="space-y-2">
      {decisions.map((d, i) => {
        const isAction = d.decision === 'INITIATE_PAYMENT' || d.decision === 'initiate_payment';
        return (
          <motion.div
            key={`maestro-decision-${d.bankCode}-${i}`}
            initial={{ opacity: 0, x: -8 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: i * 0.15, duration: 0.25 }}
            className="flex items-center gap-2"
          >
            <span className="text-[11px] font-mono font-semibold text-coda-text w-10 flex-shrink-0">
              {d.bankCode}
            </span>
            <span className="text-coda-text-muted text-[10px]">\u2192</span>
            <span
              className={`inline-flex px-1.5 py-0.5 rounded text-[10px] font-bold ${
                isAction
                  ? 'bg-emerald-500/15 text-emerald-400'
                  : 'bg-black/[0.04] dark:bg-white/[0.08] text-coda-text-muted'
              }`}
            >
              {isAction ? 'INITIATE' : 'NO ACTION'}
            </span>
            {isAction && d.amount && (
              <span className="text-[10px] font-mono text-coda-text-secondary">
                {d.amount} \u2192 {d.counterparty}
              </span>
            )}
          </motion.div>
        );
      })}
      {/* Thinking indicator for remaining banks */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        className="flex items-center gap-2 mt-1"
      >
        <div className="flex gap-0.5">
          {[0, 1, 2].map(j => (
            <motion.div
              key={j}
              className="w-1 h-1 rounded-full"
              style={{ backgroundColor: BRAND_HEX }}
              animate={{ scale: [0.7, 1.2, 0.7], opacity: [0.3, 0.8, 0.3] }}
              transition={{ duration: 1, repeat: Infinity, delay: j * 0.2, ease: 'easeInOut' }}
            />
          ))}
        </div>
        <span className="text-[10px] text-coda-text-muted italic">
          evaluating remaining banks...
        </span>
      </motion.div>
    </div>
  );
}

// ============================================================
// Output Panel — renders the appropriate output for each agent
// ============================================================

function OutputPanel({ output, activePhase }: { output: AgentOutput; activePhase: AgentPhase }) {
  switch (activePhase) {
    case 'maestro':
      return output.maestro ? <MaestroOutputView data={output.maestro} /> : null;
    case 'concord':
      return output.compliance ? <ComplianceOutputView data={output.compliance} /> : null;
    case 'fermata':
      return output.risk ? <RiskOutputView data={output.risk} /> : null;
    case 'canto':
    case 'solana':
      return output.canto ? <CantoOutputView data={output.canto} /> : null;
    default:
      return null;
  }
}

// ── Maestro Output ──────────────────────────────────────────

function MaestroOutputView({ data }: { data: MaestroDecision }) {
  const isAction = data.decision === 'INITIATE_PAYMENT' || data.decision === 'initiate_payment';
  const displayedReasoning = useTypewriter(data.reasoning.slice(0, 180), 20, true);

  return (
    <div className="space-y-2">
      <motion.div
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.3 }}
      >
        <span
          className={`inline-flex px-2 py-0.5 rounded-full text-[11px] font-bold ${
            isAction
              ? 'bg-emerald-500/15 text-emerald-400'
              : 'bg-black/[0.04] dark:bg-white/[0.08] text-coda-text-muted'
          }`}
        >
          {isAction ? 'INITIATE PAYMENT' : 'NO ACTION'}
        </span>
      </motion.div>

      {data.amount && (
        <motion.div
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
          className="flex items-center gap-2"
        >
          <span className="text-[11px] text-coda-text-muted w-20 text-right">Amount</span>
          <span className="text-[11px] text-coda-text font-mono font-semibold">{data.amount}</span>
        </motion.div>
      )}

      {data.counterparty && (
        <motion.div
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3 }}
          className="flex items-center gap-2"
        >
          <span className="text-[11px] text-coda-text-muted w-20 text-right">Target</span>
          <span className="text-[11px] text-coda-text font-mono">{data.counterparty}</span>
        </motion.div>
      )}

      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.4 }}
      >
        <p className="text-[11px] text-coda-text-muted leading-relaxed mt-1 italic">
          &ldquo;{displayedReasoning}&rdquo;
        </p>
      </motion.div>
    </div>
  );
}

// ── Compliance Output ───────────────────────────────────────

function ComplianceOutputView({ data }: { data: { checks: ComplianceCheck[]; passed: boolean; total: number; concordNarrative?: string } }) {
  const passedCount = data.checks.filter(c => c.passed).length;
  const displayedNarrative = useTypewriter(data.concordNarrative || '', 15, !!data.concordNarrative);

  return (
    <div className="space-y-1.5">
      {data.checks.map((check, i) => (
        <motion.div
          key={check.type}
          initial={{ opacity: 0, x: -8 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ delay: i * 0.2, duration: 0.25 }}
          className="flex items-center gap-2"
        >
          {check.passed ? (
            <CheckCircle2 size={12} className="text-emerald-400 flex-shrink-0" />
          ) : (
            <XCircle size={12} className="text-red-400 flex-shrink-0" />
          )}
          <span className="text-[11px] text-coda-text-secondary flex-1">
            {check.type.replace(/_/g, ' ')}
          </span>
          <span className={`text-[10px] font-mono ${check.passed ? 'text-emerald-400/70' : 'text-red-400/70'}`}>
            {check.passed ? 'PASS' : 'FAIL'}
          </span>
        </motion.div>
      ))}

      <motion.div
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ delay: data.checks.length * 0.2 + 0.15 }}
        className="pt-1"
      >
        <span
          className={`inline-flex px-2 py-0.5 rounded-full text-[11px] font-bold ${
            data.passed
              ? 'bg-emerald-500/15 text-emerald-400'
              : 'bg-red-500/15 text-red-400'
          }`}
        >
          {data.passed ? 'PASSED' : 'FAILED'} {passedCount}/{data.total}
        </span>
      </motion.div>

      {data.concordNarrative && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: data.checks.length * 0.2 + 0.3 }}
          className="mt-3 pt-3 border-t border-coda-border-subtle"
        >
          <p className="text-[11px] font-medium text-coda-text-muted uppercase tracking-wider mb-1.5">
            Concord Analysis
          </p>
          <p className="text-[11px] text-coda-text-secondary leading-relaxed italic">
            &ldquo;{displayedNarrative}&rdquo;
          </p>
        </motion.div>
      )}
    </div>
  );
}

// ── Risk Output ─────────────────────────────────────────────

function RiskOutputView({ data }: { data: RiskScores }) {
  const scores = [
    { label: 'Counterparty', value: data.counterparty_score },
    { label: 'Jurisdiction', value: data.jurisdiction_score },
    { label: 'Asset Type', value: data.asset_type_score },
    { label: 'Behavioral', value: data.behavioral_score },
  ];

  const riskColor = data.composite_score >= 70
    ? { text: 'text-emerald-400', bg: 'bg-emerald-500/15', bar: '#10b981' }
    : data.composite_score >= 40
      ? { text: 'text-amber-400', bg: 'bg-amber-500/15', bar: '#f59e0b' }
      : { text: 'text-red-400', bg: 'bg-red-500/15', bar: '#ef4444' };

  return (
    <div className="space-y-2">
      {scores.map((score, i) => (
        <motion.div
          key={score.label}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: i * 0.2, duration: 0.3 }}
          className="space-y-0.5"
        >
          <div className="flex items-center justify-between">
            <span className="text-[10px] text-coda-text-muted">{score.label}</span>
            <span className="text-[10px] font-mono text-coda-text-muted">{score.value}/100</span>
          </div>
          <div className="h-1.5 bg-black/[0.04] dark:bg-white/[0.06] rounded-full overflow-hidden">
            <motion.div
              className="h-full rounded-full"
              style={{ backgroundColor: riskColor.bar }}
              initial={{ width: 0 }}
              animate={{ width: `${score.value}%` }}
              transition={{ delay: i * 0.2 + 0.1, duration: 0.5, ease: 'easeOut' }}
            />
          </div>
        </motion.div>
      ))}

      {/* Composite */}
      <motion.div
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ delay: 0.9 }}
        className="flex items-center gap-3 pt-1"
      >
        <span className={`text-lg font-bold font-mono ${riskColor.text}`}>
          {data.composite_score}/100
        </span>
        <span className={`inline-flex px-2 py-0.5 rounded-full text-[10px] font-bold ${riskColor.bg} ${riskColor.text}`}>
          {data.risk_level.toUpperCase()}
        </span>
        <span className="text-[10px] text-coda-text-muted">
          {data.finality === 'immediate' ? 'Immediate' : data.finality}
        </span>
      </motion.div>

      {/* Corridor context */}
      {(data.corridor_depth !== undefined || data.sender_velocity_60min !== undefined) && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 1.1 }}
          className="mt-2 flex items-center gap-3 text-[11px] text-coda-text-muted"
        >
          {data.corridor_depth !== undefined && (
            <span>Corridor depth: {data.corridor_depth} prior txns</span>
          )}
          {data.corridor_depth !== undefined && data.sender_velocity_60min !== undefined && (
            <span className="text-coda-text-muted">&middot;</span>
          )}
          {data.sender_velocity_60min !== undefined && (
            <span>Sender velocity: {data.sender_velocity_60min} txns/60min</span>
          )}
        </motion.div>
      )}
    </div>
  );
}

// ── Canto / Solana Output ───────────────────────────────────

function CantoOutputView({ data }: { data: CantoOutput }) {
  const isSettled = data.status === 'Settled';

  return (
    <div className="space-y-2">
      <motion.div
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.3 }}
      >
        <span
          className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-bold ${
            isSettled ? 'bg-emerald-500/15 text-emerald-400' : 'bg-black/[0.04] dark:bg-white/[0.08] text-coda-text-muted'
          }`}
        >
          {isSettled ? <CheckCircle2 size={10} /> : null}
          {data.status}
        </span>
      </motion.div>

      {data.amount && (
        <motion.div
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.15 }}
          className="flex items-center gap-2"
        >
          <span className="text-[11px] text-coda-text-muted w-16 text-right">Amount</span>
          <span className="text-[11px] text-coda-text font-mono font-semibold">{data.amount}</span>
        </motion.div>
      )}

      {data.signature && (
        <motion.div
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3 }}
          className="flex items-center gap-2"
        >
          <span className="text-[11px] text-coda-text-muted w-16 text-right">Solana Tx</span>
          <a
            href={explorerUrl(data.signature)}
            target="_blank"
            rel="noopener noreferrer"
            className="text-[11px] font-mono text-coda-text-secondary hover:text-coda-text transition-colors flex items-center gap-1"
          >
            {data.signature.slice(0, 16)}...
            <ExternalLink size={9} />
          </a>
        </motion.div>
      )}
    </div>
  );
}

// ============================================================
// Thinking indicators
// ============================================================

function ThinkingDot({ color }: { color: string }) {
  return (
    <motion.span
      className="inline-block w-1.5 h-1.5 rounded-full"
      style={{ backgroundColor: color }}
      animate={{ scale: [0.8, 1.3, 0.8], opacity: [0.4, 1, 0.4] }}
      transition={{ duration: 1.2, repeat: Infinity, ease: 'easeInOut' }}
    />
  );
}

function ThinkingIndicator({ color }: { color: string }) {
  return (
    <div className="flex items-center gap-3 py-4">
      <div className="flex gap-1">
        {[0, 1, 2].map(i => (
          <motion.div
            key={i}
            className="w-1.5 h-1.5 rounded-full"
            style={{ backgroundColor: color }}
            animate={{ scale: [0.7, 1.2, 0.7], opacity: [0.3, 0.8, 0.3] }}
            transition={{
              duration: 1,
              repeat: Infinity,
              delay: i * 0.2,
              ease: 'easeInOut',
            }}
          />
        ))}
      </div>
      <span className="text-[11px] text-coda-text-muted italic">
        Agent reasoning in progress...
      </span>
    </div>
  );
}