import { useEffect, useState, useRef, useCallback, useMemo } from 'react';
import { useParams } from 'react-router';
import { RUNTIME_IS_PRODUCTION } from '../runtime-env';
import {
  Send, Loader2, AlertCircle, Wallet,
  Copy, CheckCircle2,
} from 'lucide-react';
import { supabase, callServer, supabaseUrl, publicAnonKey } from '../supabaseClient';
import {
  fetchBankWithWallets, fetchAgentConversations,
  fetchAgentMessagesForBank, fetchPendingAgentMessages,
  fetchTransactionStatus, fetchAgentMessageProcessed,
} from '../dataClient';
import type {
  Bank, Wallet as WalletType, AgentMessage,
  AgentThinkResponse, Transaction
} from '../types';
import {
  truncateAddress, formatTokenAmount,
} from '../types';
import { type ChatMessage } from './agent/RichMessage';
import {
  createPipelineSteps, updatePipelineFromTxStatus,
  type TransactionPipeline,
  type LockupData,
} from './agent/PipelineTracker';
import { ActionGuide } from './agent/ActionGuide';
import {
  buildVisualSteps,
  type TransactionGroup,
} from './agent/TransactionLifecycle';
import { TransactionSidebar } from './agent/TransactionSidebar';
import { CommsFeed } from './agent/CommsFeed';
import { useBanks } from '../contexts/BanksContext';
import { PageTransition } from './PageTransition';

// ============================================================
// Conversational query detection
// ============================================================

const QUESTION_PATTERNS = [
  /^(what|where|when|who|how|why|which|can|could|would|should|is|are|do|does|did|has|have|will|tell|show|list|explain|describe)\b/i,
  /\?$/,
  /^(check|status|balance|info|help|about|show me|tell me|list|describe|explain)\b/i,
  /\b(my balance|my wallet|network status|last transaction|recent|history|how many|how much)\b/i,
];

function isConversationalQuery(text: string): boolean {
  const trimmed = text.trim();
  // If it contains payment-like patterns, it's NOT conversational
  if (/\b(send|transfer|pay|wire|remit)\b.*\$[\d]/i.test(trimmed)) return false;
  if (/\$[\d,]+.*\b(to|for)\b/i.test(trimmed)) return false;
  // Check for question patterns
  return QUESTION_PATTERNS.some(p => p.test(trimmed));
}

// ============================================================
// Conversation response type
// ============================================================

interface ConversationResponse {
  id: string;
  userMessage: string;
  agentResponse: string;
  timestamp: string;
  context?: {
    balance?: number | null;
    tx_count?: number;
    settled_count?: number;
    success_rate?: number;
  };
}

// ============================================================
// Thinking steps shown during processing
// ============================================================

interface ThinkingState {
  active: boolean;
  step: string;
  startedAt: number;
}

const THINKING_STEPS = [
  'Analyzing instruction...',
  'Querying Gemini 2.5 Flash...',
  'Evaluating network state...',
  'Formulating response...',
];

// ============================================================
// Main Component
// ============================================================

export function AgentTerminal() {
  const { bankId } = useParams<{ bankId: string }>();
  const { activeBanks: contextBanks, banks: allContextBanks } = useBanks();
  const [bank, setBank] = useState<Bank | null>(null);
  const [wallet, setWallet] = useState<WalletType | null>(null);
  const [otherBankCodes, setOtherBankCodes] = useState<string[]>([]);
  const [otherBanksMap, setOtherBanksMap] = useState<Map<string, { short_code: string; name: string }>>(new Map());
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [agentMessages, setAgentMessages] = useState<AgentMessage[]>([]);
  const [pipelines, setPipelines] = useState<Map<string, TransactionPipeline>>(new Map());
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [thinking, setThinking] = useState<ThinkingState>({ active: false, step: '', startedAt: 0 });
  const [pendingPipeline, setPendingPipeline] = useState<TransactionPipeline | null>(null);
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [thinkingElapsed, setThinkingElapsed] = useState(0);
  const [conversationResponses, setConversationResponses] = useState<ConversationResponse[]>([]);
  const [contentLoaded, setContentLoaded] = useState(false);

  const chatEndRef = useRef<HTMLDivElement>(null);
  const feedEndRef = useRef<HTMLDivElement>(null);
  const processingRef = useRef(false);
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const bankRef = useRef<Bank | null>(null);
  const thinkingIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const counterpartyChatIdsRef = useRef<Set<string>>(new Set());
  const otherBanksMapRef = useRef<Map<string, { short_code: string; name: string }>>(new Map());
  const pipelinesRef = useRef<Map<string, TransactionPipeline>>(new Map());

  // Keep pipelinesRef in sync with state
  useEffect(() => {
    pipelinesRef.current = pipelines;
  }, [pipelines]);

  // ── Direct wallet balance refresh (bypasses queuedFetch) ────
  const refreshWalletDirect = useCallback(async () => {
    if (!bankId) return;
    try {
      const response = await fetch(
        `${supabaseUrl}/rest/v1/wallets?bank_id=eq.${bankId}&is_default=eq.true&select=*`,
        {
          headers: {
            'apikey': publicAnonKey,
            'Authorization': `Bearer ${publicAnonKey}`,
            'Accept': 'application/json',
          },
        }
      );
      if (!response.ok) {
        console.warn(`[refreshWallet] HTTP ${response.status}`);
        return;
      }
      const rows = await response.json();
      const w = rows[0];
      if (w) {
        console.log(`[refreshWallet] balance_tokens=${w.balance_tokens} ($${(w.balance_tokens / 1e6).toLocaleString()})`);
        setWallet(w);
      }
    } catch (err) {
      console.error('[refreshWallet] Error:', err);
    }
  }, [bankId]);

  // Helper: refresh a pipeline from the DB transaction status
  const refreshPipelineFromDB = useCallback(async (transactionId: string) => {
    try {
      const existing = pipelinesRef.current.get(transactionId);
      if (!existing || existing.isComplete) return;

      const response = await fetch(
        `${supabaseUrl}/rest/v1/transactions?id=eq.${transactionId}&select=*`,
        {
          headers: {
            'apikey': publicAnonKey,
            'Authorization': `Bearer ${publicAnonKey}`,
            'Accept': 'application/json',
          },
        }
      );

      if (!response.ok) {
        console.warn(`[refreshPipeline] HTTP ${response.status} for tx ${transactionId.slice(0, 8)}`);
        return;
      }

      const rows = await response.json();
      const tx = rows[0];
      if (!tx) {
        console.warn(`[refreshPipeline] No transaction found for ${transactionId.slice(0, 8)}`);
        return;
      }

      console.log(`[refreshPipeline] tx ${transactionId.slice(0, 8)} status=${tx.status}, pipeline step=${existing.steps.findIndex(s => s.status === 'active')}`);

      const existingNow = pipelinesRef.current.get(transactionId);
      if (!existingNow || existingNow.isComplete) return;

      // Build lockup data from transaction update
      let lockupData: LockupData | undefined;
      if (tx.lockup_status) {
        lockupData = {
          lockupStatus: tx.lockup_status,
          lockupEnd: existing.lockupData?.lockupEnd ?? null,
          senderCode: existing.senderCode,
          receiverCode: existing.receiverCode,
          ybSymbol: existing.lockupData?.ybSymbol,
          tbSymbol: existing.lockupData?.tbSymbol,
          resolution: existing.lockupData?.resolution,
          reversalReason: tx.reversal_reason || undefined,
        };
      }

      const updated = updatePipelineFromTxStatus(existingNow, tx.status, {
        complianceChecks: tx.compliance_checks?.map(c => ({
          type: c.type,
          passed: c.passed,
          detail: c.detail,
          label: c.type,
        })) || undefined,
        riskLevel: tx.risk_level || undefined,
        riskScore: tx.risk_score || undefined,
        finalityRecommendation: tx.risk_reasoning?.includes('deferred') ? 'deferred' : 'immediate',
        solanaTxSignature: tx.solana_tx_signature || undefined,
        solanaSlot: tx.solana_slot || undefined,
        lockupData,
      });

      console.log(`[refreshPipeline] tx ${transactionId.slice(0, 8)} updated isComplete=${updated.isComplete}, steps complete=${updated.steps.filter(s => s.status === 'complete').length}/${updated.steps.length}${tx.lockup_status ? ` lockup_status=${tx.lockup_status}` : ''}`);

      setPipelines(prev => {
        const next = new Map(prev);
        next.set(transactionId, updated);
        return next;
      });

      if (updated.isComplete && !existingNow.isComplete) {
        console.log(`[refreshPipeline] Pipeline COMPLETED for tx ${transactionId.slice(0, 8)}`);
        const isError = updated.steps.some(s => s.status === 'error');
        const sysMsg: ChatMessage = {
          id: `sys-${tx.id}-${Date.now()}`,
          role: 'system',
          content: isError
            ? `Transaction ${tx.id.slice(0, 8)}... was rejected.`
            : `Settlement confirmed for TX ${tx.id.slice(0, 8)}... ${tx.solana_tx_signature ? `\u2014 Solana Tx: ${tx.solana_tx_signature.slice(0, 16)}...` : ''}`,
          timestamp: new Date().toISOString(),
          transactionId: tx.id,
        };
        setChatMessages(prev => [...prev, sysMsg]);
        loadBank();
        refreshWalletDirect();
      }
    } catch (err) {
      console.error(`[refreshPipeline] Error for tx ${transactionId.slice(0, 8)}:`, err);
    }
  }, []);

  // Helper: convert an agent_message from a counterparty into a ChatMessage
  const injectCounterpartyChat = useCallback((msg: AgentMessage) => {
    if (counterpartyChatIdsRef.current.has(msg.id)) return;
    counterpartyChatIdsRef.current.add(msg.id);

    const joinedBank = (msg as any).from_bank;
    const mappedBank = msg.from_bank_id ? otherBanksMapRef.current.get(msg.from_bank_id) : null;
    const fromCode = joinedBank?.short_code || mappedBank?.short_code || '???';
    const fromName = joinedBank?.name || mappedBank?.name || '';

    const chatMsg: ChatMessage = {
      id: `cp-${msg.id}`,
      role: 'counterparty',
      content: msg.natural_language || JSON.stringify(msg.content).slice(0, 200),
      timestamp: msg.created_at,
      transactionId: msg.transaction_id,
      counterpartyCode: fromCode,
      counterpartyName: fromName,
      counterpartyMessageType: msg.message_type,
    };
    setChatMessages(prev => [...prev, chatMsg]);
  }, []);

  // Scroll to bottom
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatMessages, pipelines, conversationResponses]);

  useEffect(() => {
    feedEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [agentMessages]);

  // ── Load bank data ──────────────────────────────────────────
  useEffect(() => {
    if (!bankId) return;

    // Reset content loaded flag when switching banks
    setContentLoaded(false);

    async function initTerminal() {
      await loadBank();
      await loadConversations();
      await loadMessages();
      setContentLoaded(true);
      processPendingMessages();
    }
    initTerminal();
  }, [bankId]);

  // ── Realtime: agent_messages ────────────────────────────────
  useEffect(() => {
    if (!bankId) return;

    const channel = supabase
      .channel(`agent-messages-${bankId}`)
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'agent_messages',
      }, (payload) => {
        const msg = payload.new as AgentMessage;
        if (msg.to_bank_id === bankId || msg.from_bank_id === bankId || msg.to_bank_id === null) {
          setAgentMessages((prev) => [...prev, msg]);

          if (msg.from_bank_id && msg.from_bank_id !== bankId) {
            injectCounterpartyChat(msg);
          }

          if (msg.to_bank_id === bankId && !msg.processed) {
            handleIncomingMessage(msg);
          }

          if (msg.message_type === 'settlement_confirm' && msg.transaction_id) {
            const scTxId = msg.transaction_id;
            console.log(`[AgentTerminal] settlement_confirm received for tx ${scTxId.slice(0, 8)} — scheduling refresh + force-complete fallback`);
            setTimeout(() => refreshPipelineFromDB(scTxId), 500);
            setTimeout(() => refreshPipelineFromDB(scTxId), 2000);
            setTimeout(() => {
              const pipeline = pipelinesRef.current.get(scTxId);
              if (pipeline && !pipeline.isComplete) {
                console.log(`[AgentTerminal] Force-completing pipeline for tx ${scTxId.slice(0, 8)} — settlement_confirm received but status still not settled`);
                const content = msg.content as Record<string, unknown>;
                const forced = updatePipelineFromTxStatus(pipeline, 'settled', {
                  solanaTxSignature: (content.tx_signature as string) || undefined,
                });
                setPipelines(prev => {
                  const next = new Map(prev);
                  next.set(scTxId, forced);
                  return next;
                });
              }
            }, 4000);
            setTimeout(() => refreshWalletDirect(), 1000);
            setTimeout(() => refreshWalletDirect(), 3000);
          }

          if (msg.message_type === 'payment_accept' && msg.transaction_id) {
            setTimeout(() => refreshPipelineFromDB(msg.transaction_id!), 500);
            setTimeout(() => refreshPipelineFromDB(msg.transaction_id!), 2000);
            setTimeout(() => refreshPipelineFromDB(msg.transaction_id!), 5000);
            setTimeout(() => refreshPipelineFromDB(msg.transaction_id!), 8000);
            setTimeout(() => refreshPipelineFromDB(msg.transaction_id!), 12000);
          }
        }
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [bankId]);

  // ── Realtime: lockup_tokens (for live lockup status updates) ──
  useEffect(() => {
    if (!bankId) return;

    const channel = supabase
      .channel(`lockup-tokens-${bankId}`)
      .on('postgres_changes', {
        event: 'UPDATE',
        schema: 'public',
        table: 'lockup_tokens',
      }, (payload) => {
        const lockup = payload.new as { id: string; transaction_id: string; status: string; lockup_end: string | null; yb_token_symbol?: string; tb_token_symbol?: string; resolution?: string };
        // Check if any active pipeline matches this lockup's transaction
        const pipeline = pipelinesRef.current.get(lockup.transaction_id);
        if (!pipeline || pipeline.isComplete) return;

        console.log(`[Realtime Lockup] lockup ${lockup.id.slice(0, 8)} status=${lockup.status} for tx ${lockup.transaction_id.slice(0, 8)}`);
        // Trigger a full refresh to pick up lockup_status from transaction
        refreshPipelineFromDB(lockup.transaction_id);
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [bankId, refreshPipelineFromDB]);

  // ── Thinking step animation ─────────────────────────────────
  useEffect(() => {
    if (thinking.active) {
      let stepIdx = 0;
      const stepTimer = setInterval(() => {
        stepIdx = (stepIdx + 1) % THINKING_STEPS.length;
        setThinking(prev => ({ ...prev, step: THINKING_STEPS[stepIdx] }));
      }, 2000);
      const elapsedTimer = setInterval(() => {
        setThinkingElapsed(Date.now() - thinking.startedAt);
      }, 100);
      thinkingIntervalRef.current = stepTimer;
      return () => {
        clearInterval(stepTimer);
        clearInterval(elapsedTimer);
      };
    } else {
      setThinkingElapsed(0);
    }
  }, [thinking.active, thinking.startedAt]);

  // ── Sync otherBanks from context ───────────────────────────
  useEffect(() => {
    if (!bankId || contextBanks.length === 0) return;
    const others = contextBanks.filter(b => b.id !== bankId);
    setOtherBankCodes(others.map(b => b.short_code));
    const bankMap = new Map<string, { short_code: string; name: string }>();
    for (const b of others) {
      bankMap.set(b.id, { short_code: b.short_code, name: b.name });
    }
    setOtherBanksMap(bankMap);
    otherBanksMapRef.current = bankMap;
  }, [bankId, contextBanks]);

  // ── Instant bank data from BanksContext (avoids blank screen) ──
  useEffect(() => {
    if (!bankId || bank) return;
    const cached = allContextBanks.find(b => b.id === bankId);
    if (cached) {
      const { wallets, ...bankData } = cached as Bank & { wallets?: WalletType[] };
      setBank(bankData as Bank);
      bankRef.current = bankData as Bank;
      const defaultWallet = wallets?.find((w: WalletType) => w.is_default) || wallets?.[0];
      if (defaultWallet) setWallet(defaultWallet);
    }
  }, [bankId, allContextBanks]);

  // ── Data loading ────────────────────────────────────────────

  async function loadBank() {
    const data = await fetchBankWithWallets(bankId!);

    if (data) {
      const { wallets, ...bankData } = data;
      setBank(bankData as Bank);
      bankRef.current = bankData as Bank;
      const defaultWallet = wallets?.find((w: WalletType) => w.is_default) || wallets?.[0];
      if (defaultWallet) setWallet(defaultWallet);
    }
  }

  async function loadConversations() {
    const data = await fetchAgentConversations({ bank_id: bankId!, limit: 100 });

    if (data && data.length > 0) {
      const msgs: ChatMessage[] = data.map(conv => ({
        id: conv.id,
        role: conv.role === 'user' ? 'user' as const : conv.role === 'system' ? 'system' as const : 'agent' as const,
        content: conv.content,
        timestamp: conv.created_at,
        transactionId: conv.transaction_id,
      }));
      setChatMessages(msgs);
    }
  }

  async function loadMessages() {
    const data = await fetchAgentMessagesForBank(bankId!, 100);

    if (data) {
      setAgentMessages(data);

      const counterpartyMsgs: ChatMessage[] = [];
      for (const msg of data) {
        if (msg.from_bank_id && msg.from_bank_id !== bankId && !counterpartyChatIdsRef.current.has(msg.id)) {
          counterpartyChatIdsRef.current.add(msg.id);
          counterpartyMsgs.push({
            id: `cp-${msg.id}`,
            role: 'counterparty',
            content: msg.natural_language || JSON.stringify(msg.content).slice(0, 200),
            timestamp: msg.created_at,
            transactionId: msg.transaction_id,
            counterpartyCode: (msg as any).from_bank?.short_code || '???',
            counterpartyName: (msg as any).from_bank?.name || '',
            counterpartyMessageType: msg.message_type,
          });
        }
      }
      if (counterpartyMsgs.length > 0) {
        setChatMessages(prev => {
          const merged = [...prev, ...counterpartyMsgs];
          merged.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
          return merged;
        });
      }
    }
  }

  // ── Process pending messages ────────────────────────────────

  async function processPendingMessages() {
    if (!bankId) return;
    if (!bankRef.current || bankRef.current.status !== 'active') return;

    const data = await fetchPendingAgentMessages(bankId!, 10);

    if (!data || data.length === 0) return;

    console.log(`[AgentTerminal] Found ${data.length} pending unprocessed message(s) — processing sequentially`);

    for (const msg of data) {
      if (msg.transaction_id) {
        const txStatus = await fetchTransactionStatus(msg.transaction_id);

        if (txStatus && ['settled', 'executing', 'rejected', 'reversed'].includes(txStatus)) {
          console.log(`[AgentTerminal] Skipping pending msg ${msg.id.slice(0, 8)} — tx already ${tx.status}`);
          continue;
        }
      }

      if (msg.message_type === 'payment_request' && msg.transaction_id) {
        const content = msg.content as Record<string, unknown>;
        const fromCode = (msg as any).from_bank?.short_code || '???';
        const toCode = bankRef.current?.short_code || '???';

        const pipeline: TransactionPipeline = {
          transactionId: msg.transaction_id,
          senderCode: fromCode,
          receiverCode: toCode,
          amount: Number(content.amount_display || content.amount || 0),
          startedAt: new Date().toISOString(),
          steps: createPipelineSteps(),
          isComplete: false,
        };
        pipeline.steps[0].status = 'complete';
        pipeline.steps[1].status = 'complete';
        pipeline.steps[2].status = 'complete';
        pipeline.steps[3].status = 'complete';
        pipeline.steps[3].detail = 'Receiver picked up';
        pipeline.steps[3].timestamp = new Date().toISOString();
        pipeline.steps[4].status = 'active';

        setPipelines(prev => {
          const next = new Map(prev);
          next.set(msg.transaction_id!, pipeline);
          return next;
        });
      }

      processingRef.current = true;
      setProcessing(true);

      const incomingChatMsg: ChatMessage = {
        id: `sys-pending-${msg.id}`,
        role: 'system',
        content: `Processing pending ${msg.message_type.replace(/_/g, ' ')} from ${(msg as any).from_bank?.short_code || 'unknown'}...`,
        timestamp: new Date().toISOString(),
        transactionId: msg.transaction_id,
      };
      setChatMessages(prev => [...prev, incomingChatMsg]);

      try {
        const result = await callServer<AgentThinkResponse>('/agent-orchestrator', {
          bank_id: bankId,
          message_id: msg.id,
        });

        // Render structured evaluation card (compliance + risk) if pipeline returned it
        if ((result as any).evaluation_summary) {
          const evalCard: ChatMessage = {
            id: crypto.randomUUID(),
            role: 'agent',
            content: (result as any).evaluation_summary,
            timestamp: new Date().toISOString(),
            transactionId: result.transaction_id || msg.transaction_id,
          };
          setChatMessages(prev => [...prev, evalCard]);
        }

        if (result.message_to_user) {
          const agentConv: ChatMessage = {
            id: crypto.randomUUID(),
            role: 'agent',
            content: result.message_to_user,
            timestamp: new Date(Date.now() + 100).toISOString(),
            agentData: {
              reasoning: result.reasoning,
              action: result.action,
              params: result.params,
              messageToCounterparty: result.message_to_counterparty,
            },
            transactionId: result.transaction_id || msg.transaction_id,
          };
          setChatMessages(prev => [...prev, agentConv]);
        }

        // Add settlement confirmation as a separate ChatMessage
        if ((result as any).settlement_message) {
          const settlementConv: ChatMessage = {
            id: crypto.randomUUID(),
            role: 'agent',
            content: (result as any).settlement_message,
            timestamp: new Date(Date.now() + 200).toISOString(),
            transactionId: result.transaction_id || msg.transaction_id,
          };
          setChatMessages(prev => [...prev, settlementConv]);
        }
      } catch (err) {
        console.error(`[AgentTerminal] Error processing pending msg ${msg.id.slice(0, 8)}:`, err);
        const errChatMsg: ChatMessage = {
          id: `err-pending-${msg.id}`,
          role: 'agent',
          content: 'An error occurred while processing a pending message.',
          timestamp: new Date().toISOString(),
          error: err instanceof Error ? err.message : 'Unknown error',
          transactionId: msg.transaction_id,
        };
        setChatMessages(prev => [...prev, errChatMsg]);
      } finally {
        processingRef.current = false;
        setProcessing(false);
      }
    }

    loadBank();
  }

  // ── Incoming message handler (receiver side) ────────────────

  const handleIncomingMessage = useCallback((msg: AgentMessage) => {
    if (bankRef.current?.status !== 'active') return;

    if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);

    debounceTimerRef.current = setTimeout(async () => {
      if (processingRef.current) return;

      if (msg.transaction_id) {
        const txStatus = await fetchTransactionStatus(msg.transaction_id);

        if (txStatus && ['settled', 'executing', 'rejected', 'reversed'].includes(txStatus)) {
          return;
        }

        if (msg.message_type === 'payment_request') {
          const content = msg.content as Record<string, unknown>;
          const fromCode = (msg as any).from_bank?.short_code || otherBanksMapRef.current.get(msg.from_bank_id || '')?.short_code || '???';
          const toCode = bankRef.current?.short_code || '???';

          const pipeline: TransactionPipeline = {
            transactionId: msg.transaction_id,
            senderCode: fromCode,
            receiverCode: toCode,
            amount: Number(content.amount_display || content.amount || 0),
            startedAt: new Date().toISOString(),
            steps: createPipelineSteps(),
            isComplete: false,
          };
          pipeline.steps[0].status = 'complete';
          pipeline.steps[1].status = 'complete';
          pipeline.steps[2].status = 'complete';
          pipeline.steps[3].status = 'complete';
          pipeline.steps[3].detail = 'Receiver picked up';
          pipeline.steps[3].timestamp = new Date().toISOString();
          pipeline.steps[4].status = 'active';

          setPipelines(prev => {
            const next = new Map(prev);
            next.set(msg.transaction_id!, pipeline);
            return next;
          });
        }
      }

      const alreadyProcessed = await fetchAgentMessageProcessed(msg.id);

      if (alreadyProcessed) {
        console.log(`[AgentTerminal] Skipping msg ${msg.id.slice(0, 8)} — already processed by A2A server`);
        return;
      }

      processingRef.current = true;
      setProcessing(true);

      const incomingMsg: ChatMessage = {
        id: `sys-incoming-${msg.id}`,
        role: 'system',
        content: `Processing incoming ${msg.message_type.replace(/_/g, ' ')} from ${(msg as any).from_bank?.short_code || otherBanksMapRef.current.get(msg.from_bank_id || '')?.short_code || 'unknown'}...`,
        timestamp: new Date().toISOString(),
        transactionId: msg.transaction_id,
      };
      setChatMessages(prev => [...prev, incomingMsg]);

      try {
        const result = await callServer<AgentThinkResponse>('/agent-orchestrator', {
          bank_id: bankId,
          message_id: msg.id,
        });

        // Render structured evaluation card (compliance + risk) if pipeline returned it
        if ((result as any).evaluation_summary) {
          const evalCard: ChatMessage = {
            id: crypto.randomUUID(),
            role: 'agent',
            content: (result as any).evaluation_summary,
            timestamp: new Date().toISOString(),
            transactionId: result.transaction_id || msg.transaction_id,
          };
          setChatMessages(prev => [...prev, evalCard]);
        }

        if (result.message_to_user) {
          const agentConv: ChatMessage = {
            id: crypto.randomUUID(),
            role: 'agent',
            content: result.message_to_user,
            timestamp: new Date(Date.now() + 100).toISOString(),
            agentData: {
              reasoning: result.reasoning,
              action: result.action,
              params: result.params,
              messageToCounterparty: result.message_to_counterparty,
            },
            transactionId: result.transaction_id || msg.transaction_id,
          };
          setChatMessages(prev => [...prev, agentConv]);
        }

        // Add settlement confirmation as a separate ChatMessage
        if ((result as any).settlement_message) {
          const settlementConv: ChatMessage = {
            id: crypto.randomUUID(),
            role: 'agent',
            content: (result as any).settlement_message,
            timestamp: new Date(Date.now() + 200).toISOString(),
            transactionId: result.transaction_id || msg.transaction_id,
          };
          setChatMessages(prev => [...prev, settlementConv]);
        }
      } catch (err) {
        console.error('Orchestrator error:', err);
        const errMsg: ChatMessage = {
          id: `err-${msg.id}`,
          role: 'agent',
          content: 'An error occurred while processing the incoming message.',
          timestamp: new Date().toISOString(),
          error: err instanceof Error ? err.message : 'Unknown error',
          transactionId: msg.transaction_id,
        };
        setChatMessages(prev => [...prev, errMsg]);
      } finally {
        processingRef.current = false;
        setProcessing(false);
      }
    }, 2000);
  }, [bankId]);

  // ── Send handler ────────────────────────────────────────────

  async function handleSend(commandOverride?: string) {
    const messageText = commandOverride || input.trim();
    if (!messageText || !bankId || sending) return;

    setInput('');
    setSending(true);
    setError(null);

    const isChat = isConversationalQuery(messageText);

    // Add user message
    const userMsg: ChatMessage = {
      id: crypto.randomUUID(),
      role: 'user',
      content: messageText,
      timestamp: new Date().toISOString(),
    };
    setChatMessages(prev => [...prev, userMsg]);

    if (isChat) {
      // ── Conversational path — no pipeline, call /agent-chat ──
      setThinking({ active: true, step: 'Querying Gemini 2.5 Flash...', startedAt: Date.now() });

      try {
        const result = await callServer<{ response: string; context?: ConversationResponse['context'] }>('/agent-chat', {
          bank_id: bankId,
          message: messageText,
        });

        const convResponse: ConversationResponse = {
          id: crypto.randomUUID(),
          userMessage: messageText,
          agentResponse: result.response,
          timestamp: new Date().toISOString(),
          context: result.context,
        };
        setConversationResponses(prev => [...prev, convResponse]);

        // Also add to chatMessages for conversation history
        const agentMsg: ChatMessage = {
          id: convResponse.id,
          role: 'agent',
          content: result.response,
          timestamp: new Date().toISOString(),
        };
        setChatMessages(prev => [...prev, agentMsg]);

      } catch (err: unknown) {
        const errMsg = err instanceof Error ? err.message : 'Failed to process question';
        setError(errMsg);
        const errChatMsg: ChatMessage = {
          id: crypto.randomUUID(),
          role: 'agent',
          content: 'I encountered an error processing your question.',
          timestamp: new Date().toISOString(),
          error: errMsg,
        };
        setChatMessages(prev => [...prev, errChatMsg]);
      } finally {
        setSending(false);
        setThinking({ active: false, step: '', startedAt: 0 });
        if (thinkingIntervalRef.current) clearInterval(thinkingIntervalRef.current);
      }
    } else {
      // ── Payment/action path — existing flow ─────────────────
      setThinking({ active: true, step: THINKING_STEPS[0], startedAt: Date.now() });

      // Show pending pipeline
      const pendingSteps = createPipelineSteps();
      pendingSteps[0].status = 'active';
      const pending: TransactionPipeline = {
        transactionId: 'pending',
        senderCode: bank?.short_code || '???',
        receiverCode: '...',
        amount: 0,
        startedAt: new Date().toISOString(),
        steps: pendingSteps,
        isComplete: false,
      };
      setPendingPipeline(pending);

      try {
        const result = await callServer<AgentThinkResponse>('/agent-think', {
          bank_id: bankId,
          input: messageText,
          context_type: 'user_instruction',
        });

        setPendingPipeline(null);

        const agentMsg: ChatMessage = {
          id: crypto.randomUUID(),
          role: 'agent',
          content: result.message_to_user || result.reasoning,
          timestamp: new Date().toISOString(),
          agentData: {
            reasoning: result.reasoning,
            action: result.action,
            params: result.params,
            messageToCounterparty: result.message_to_counterparty,
          },
          transactionId: result.transaction_id,
          error: result.error,
        };
        setChatMessages(prev => [...prev, agentMsg]);

        // If agent returned a non-payment action (provide_info, check_status, no_action),
        // add it as a conversation response too so it renders inline
        if (result.action && !['initiate_payment'].includes(result.action)) {
          const convResponse: ConversationResponse = {
            id: agentMsg.id,
            userMessage: messageText,
            agentResponse: result.message_to_user || result.reasoning,
            timestamp: new Date().toISOString(),
          };
          setConversationResponses(prev => [...prev, convResponse]);
        }

        if (result.action === 'initiate_payment' && result.transaction_id) {
          const receiverCode = String(result.params.receiver_bank_code || '???');
          const amount = Number(result.params.amount || 0);

          const pipeline: TransactionPipeline = {
            transactionId: result.transaction_id,
            senderCode: bank?.short_code || '???',
            receiverCode,
            amount,
            startedAt: new Date().toISOString(),
            steps: createPipelineSteps(),
            isComplete: false,
          };
          pipeline.steps[0].status = 'complete';
          pipeline.steps[0].timestamp = new Date().toISOString();
          pipeline.steps[0].detail = `Action: ${result.action}`;
          pipeline.steps[1].status = 'complete';
          pipeline.steps[1].timestamp = new Date().toISOString();
          pipeline.steps[1].detail = `TX: ${result.transaction_id.slice(0, 8)}...`;
          pipeline.steps[2].status = 'complete';
          pipeline.steps[2].timestamp = new Date().toISOString();
          pipeline.steps[2].detail = `\u2192 ${receiverCode} Maestro`;
          pipeline.steps[3].status = 'active';

          setPipelines(prev => {
            const next = new Map(prev);
            next.set(result.transaction_id!, pipeline);
            return next;
          });

          const txId = result.transaction_id!;
          setTimeout(() => refreshPipelineFromDB(txId), 500);
          setTimeout(() => refreshPipelineFromDB(txId), 1500);
          setTimeout(() => refreshPipelineFromDB(txId), 3000);
          setTimeout(() => refreshPipelineFromDB(txId), 5000);
          setTimeout(() => refreshPipelineFromDB(txId), 8000);
          setTimeout(() => refreshPipelineFromDB(txId), 12000);
          setTimeout(() => refreshPipelineFromDB(txId), 17000);
          setTimeout(() => refreshPipelineFromDB(txId), 25000);
        }

        loadBank();
      } catch (err: unknown) {
        const errMsg = err instanceof Error ? err.message : 'Failed to send instruction';
        setError(errMsg);
        setPendingPipeline(null);

        const errChatMsg: ChatMessage = {
          id: crypto.randomUUID(),
          role: 'agent',
          content: 'I encountered an error processing your instruction.',
          timestamp: new Date().toISOString(),
          error: errMsg,
        };
        setChatMessages(prev => [...prev, errChatMsg]);
      } finally {
        setSending(false);
        setThinking({ active: false, step: '', startedAt: 0 });
        if (thinkingIntervalRef.current) clearInterval(thinkingIntervalRef.current);
      }
    }
  }

  // ── Quick action handler ────────────────────────────────────
  const handleSelectCommand = (command: string) => {
    handleSend(command);
  };

  // ── Copy address helper ─────────────────────────────────────
  const [copiedAddress, setCopiedAddress] = useState(false);
  const copyAddress = () => {
    const addr = bank?.solana_wallet_pubkey || '';
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(addr).then(() => setCopiedAddress(true));
    } else {
      const textarea = document.createElement('textarea');
      textarea.value = addr;
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
      setCopiedAddress(true);
    }
    setTimeout(() => setCopiedAddress(false), 1500);
  };

  // ── Build TransactionGroups from pipelines + messages ───────
  const bankCode = bank?.short_code || '';

  const transactionGroups: TransactionGroup[] = useMemo(() => {
    return Array.from(pipelines.entries())
      .map(([txId, pipeline]) => {
        const relatedMessages = agentMessages.filter(m => m.transaction_id === txId);
        const steps = buildVisualSteps(pipeline, relatedMessages, bankCode);
        const userPrompt = chatMessages.find(m => m.role === 'user' && m.transactionId === txId)?.content;
        return { id: txId, pipeline, steps, relatedMessages, userPrompt };
      })
      .sort((a, b) => new Date(a.pipeline.startedAt).getTime() - new Date(b.pipeline.startedAt).getTime());
  }, [pipelines, agentMessages, chatMessages, bankCode]);

  const completedGroups = transactionGroups.filter(g => g.pipeline.isComplete);
  const activeGroups = transactionGroups.filter(g => !g.pipeline.isComplete);

  // Timeline no longer needed — CommsFeed handles merging all sources

  // Elapsed time for live transactions
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (activeGroups.length > 0 || pendingPipeline) {
      const timer = setInterval(() => setNow(Date.now()), 100);
      return () => clearInterval(timer);
    }
  }, [activeGroups.length, pendingPipeline]);

  // ── Loading state ───────────────────────────────────────────

  if (!bank) {
    // Show loading skeleton while bank data resolves
    return (
      <div className="flex h-full -mt-4 -mr-4 -mb-4 items-center justify-center" style={{ height: 'calc(100vh - 1rem)' }}>
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="w-6 h-6 text-coda-text-muted animate-spin" />
          <span className="text-[11px] font-mono text-coda-text-muted">Loading agent terminal…</span>
        </div>
      </div>
    );
  }

  // ── Computed values (safe after early return — no hooks below) ──
  const totalTxCount = transactionGroups.length + (pendingPipeline ? 1 : 0);
  const settledVolume = transactionGroups
    .filter(g => g.pipeline.isComplete && !g.pipeline.steps.some(s => s.status === 'error'))
    .reduce((sum, g) => sum + g.pipeline.amount, 0);
  const successRate = completedGroups.length > 0
    ? Math.round((completedGroups.filter(g => !g.pipeline.steps.some(s => s.status === 'error')).length / completedGroups.length) * 100)
    : 100;

  const fmtAmount = (n: number) => n >= 1000 ? `$${n.toLocaleString()}` : `$${n}`;

  const targetBank = otherBankCodes[0] || 'CITI';

  const hasContent = !contentLoaded || transactionGroups.length > 0 || pendingPipeline || thinking.active || conversationResponses.length > 0 || chatMessages.length > 0;

  // ============================================================
  // RENDER
  // ============================================================

  const RIGHT_SIDEBAR_W = 320;

  return (
    <div className="flex h-full -mt-4 -mr-4 -mb-4" style={{ height: 'calc(100vh - 3.5rem)' }}>
      {/* ═══════════════════════════════════════════════════════
          CENTER: Agent Communication Feed
          ═══════════════════════════════════════════════════════ */}
      <div className="flex-1 flex flex-col min-w-0" style={{ marginRight: RIGHT_SIDEBAR_W + 24 }}>
        {/* ── Header Bar ────────────────────────────────────── */}
        <div className="liquid-glass-elevated squircle-sm px-5 py-3 mx-4 mt-4 mb-2 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            {/* Bank avatar */}
            <div className="w-8 h-8 squircle-sm flex items-center justify-center text-[11px] font-bold font-mono border bg-blue-500/10 border-blue-500/20 text-blue-600 dark:text-blue-400">
              {bank.short_code.slice(0, 2)}
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium text-coda-text">{bank.name}</span>
                <span className="text-[9px] font-medium tracking-wider bg-blue-500/10 text-blue-600 dark:text-blue-400 px-1.5 py-0.5 rounded font-mono">
                  {bank.short_code}
                </span>
              </div>
              <div className="text-[10px] text-coda-text-muted font-mono flex items-center gap-1">
                <span className="text-coda-text-secondary">↗</span>Maestro
                <span className="text-coda-text-muted">·</span>
                <span className="text-coda-text-secondary">◈</span>Concord
                <span className="text-coda-text-muted">·</span>
                <span className="text-coda-text-secondary">△</span>Fermata
                <span className="text-coda-text-muted">·</span>
                <span className="text-coda-text-secondary">⟿</span>Canto
              </div>
            </div>
          </div>

          {/* Right side: wallet + stats */}
          <div className="flex items-center gap-5">
            {/* Wallet */}
            <button
              onClick={copyAddress}
              className="flex items-center text-[10px] font-mono text-coda-text-muted"
              title="Copy wallet address"
            >
              <Wallet className="w-3 h-3" />
              <span>{truncateAddress(bank.solana_wallet_pubkey)}</span>
              {copiedAddress ? <CheckCircle2 className="w-3 h-3 text-emerald-500" /> : <Copy className="w-3 h-3" />}
            </button>

            {/* Stats */}
            {[
              { l: 'Balance', v: wallet ? formatTokenAmount(wallet.balance_tokens) : '\u2014', accent: true },
              { l: 'Transactions', v: String(totalTxCount) },
              { l: 'Settled', v: fmtAmount(settledVolume) },
              { l: 'Success', v: `${successRate}%` },
            ].map(s => (
              <div key={s.l} className="text-right">
                <div className="text-[8px] uppercase tracking-wider text-coda-text-muted font-mono mb-0.5">{s.l}</div>
                <div className={`text-[13px] font-medium font-mono ${s.accent ? 'text-coda-text' : 'text-coda-text-secondary'}`}>
                  {s.v}
                </div>
              </div>
            ))}

            {/* Processing indicator */}
            {(processing || sending) && (
              <div className="flex items-center gap-1 text-coda-text-muted">
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                <span className="text-[10px] font-mono">{sending ? 'Thinking...' : 'Processing...'}</span>
              </div>
            )}
          </div>
        </div>

        <PageTransition className="flex-1 flex flex-col min-h-0">
        {/* ── Comms Feed ──────────────────────────────────────── */}
        {!hasContent ? (
          <div className="flex-1 overflow-y-auto px-4 pb-2 scrollbar-thin">
            <ActionGuide
              bankName={bank.name}
              bankCode={bank.short_code}
              otherBanks={otherBankCodes}
              onSelectCommand={handleSelectCommand}
            />
          </div>
        ) : (
          <div className="flex-1 overflow-hidden mx-4 mb-1 liquid-glass-subtle squircle-sm flex flex-col">
            {/* Feed label */}
            <div className="px-3 py-1.5 border-b border-coda-border/10 flex items-center gap-2 shrink-0">
              <span className="text-[10px] tracking-wider uppercase text-coda-text-muted font-mono">
                Agent Communications
              </span>
              {activeGroups.length > 0 && (
                <span className="text-[9px] text-amber-500 font-mono flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse" />
                  {activeGroups.length} ACTIVE
                </span>
              )}
            </div>
            <CommsFeed
              chatMessages={chatMessages}
              pipelines={pipelines}
              agentMessages={agentMessages}
              thinkingActive={thinking.active}
              thinkingStep={thinking.step}
              thinkingElapsed={thinkingElapsed}
            />
            <div ref={chatEndRef} />
            <div ref={feedEndRef} />
          </div>
        )}
        </PageTransition>

        {/* ── Error Display ───────────────────────────────────── */}
        {error && (
          <div className="mx-4 mb-1 px-3 py-2 squircle-sm border border-red-500/30 bg-red-500/[0.04] text-[11px] font-mono text-red-600 dark:text-red-400 flex items-center gap-2">
            <AlertCircle className="w-3.5 h-3.5 shrink-0" />
            <span className="flex-1">{error}</span>
            <button onClick={() => setError(null)} className="text-red-500 text-[10px] font-medium">
              <span>dismiss</span>
            </button>
          </div>
        )}

        {/* ── Command Bar ─────────────────────────────────────── */}
        <div className="liquid-glass-elevated squircle-sm mx-4 mb-4 mt-1 px-4 py-2.5 shrink-0">
          {/* Quick suggestions */}
          <div className="flex gap-1.5 mb-2 overflow-x-auto pb-0.5">
            {[
              `Send $1 test to ${targetBank}`,
              `Send $10,000 to ${targetBank} with a 10 min lockup`,
              "What's my balance?",
              'Status of last transaction',
              'Network status',
            ].map(label => (
              <button
                key={label}
                onClick={() => handleSend(label)}
                disabled={sending}
                className="shrink-0 px-2.5 py-1 text-[11px] font-mono text-coda-text-muted disabled:opacity-30"
              >
                <span>{label}</span>
              </button>
            ))}
          </div>

          {/* Input */}
          <div className="flex items-center gap-1 dashboard-input px-3 py-0" style={{ borderRadius: 10 }}>
            <span className="text-[11px] text-blue-500 dark:text-blue-400 font-mono font-medium mr-1">❯</span>
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && handleSend()}
              placeholder={!hasContent
                ? `send $10,000 to ${targetBank} with a 10 min lockup`
                : 'Payment instruction or question...'}
              disabled={sending}
              className="flex-1 bg-transparent border-none outline-none text-coda-text text-[12px] font-mono placeholder:text-coda-text-muted disabled:opacity-30 py-2.5"
            />
            <button
              onClick={() => handleSend()}
              disabled={sending || !input.trim()}
              className={`px-3 py-1.5 text-[11px] font-medium ${
                !sending && input.trim()
                  ? 'bg-transparent text-coda-brand'
                  : 'text-coda-text-muted cursor-default'
              }`}
            >
              {sending ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Send className="w-3.5 h-3.5" />
              )}
            </button>
          </div>
        </div>
      </div>

      {/* ═══════════════════════════════════════════════════════
          RIGHT SIDEBAR: Floating Transaction Panel
          ═══════════════════════════════════════════════════════ */}
      <div
        className={`fixed right-4 bottom-4 z-50 ${RUNTIME_IS_PRODUCTION ? 'top-4' : 'top-[52px]'}`}
        style={{ width: RIGHT_SIDEBAR_W }}
      >
        <div className="h-full flex flex-col liquid-glass-elevated squircle-sm overflow-hidden">
          <TransactionSidebar
            activeGroups={activeGroups}
            completedGroups={completedGroups}
            pendingPipeline={pendingPipeline}
            thinkingActive={thinking.active}
            thinkingStep={thinking.step}
            thinkingElapsed={thinkingElapsed}
            bankCode={bank.short_code}
            now={now}
          />
        </div>
      </div>
    </div>
  );
}