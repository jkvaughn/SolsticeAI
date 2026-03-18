/**
 * AriaContext — State management for the Aria natural-language
 * agent configuration assistant.
 *
 * Manages conversation history, sends interpret / confirm / reject
 * actions to POST /aria, and exposes proposal workflow state to the
 * AriaInputBar component.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from 'react';
import type { ReactNode } from 'react';
import { callServer } from '../supabaseClient';
import { useBanks } from './BanksContext';

// ── Types ────────────────────────────────────────────────────

export interface AriaChange {
  parameter: string;
  current_value: unknown;
  proposed_value: unknown;
  source: 'network_default' | 'bank_override';
  category: 'maestro' | 'concord' | 'fermata' | 'treasury';
}

export interface AriaProposal {
  proposal_id: string;
  reasoning: string;
  changes: AriaChange[];
  warnings: string[];
  affected_banks: string[];
}

export interface ConversationMessage {
  role: 'user' | 'aria';
  content: string;
}

interface AriaContextValue {
  /** Current conversation messages */
  conversation: ConversationMessage[];
  /** Whether Aria is processing a query */
  isLoading: boolean;
  /** Last AI response text (for display in input bar) */
  aiResponse: string;
  /** Whether AI is actively streaming (simulated for typewriter effect) */
  isTypingResponse: boolean;
  /** Active proposal awaiting approval/rejection */
  activeProposal: AriaProposal | null;
  /** Selected bank ID for Aria queries */
  selectedBankId: string;
  /** Set the bank Aria operates on */
  setSelectedBankId: (id: string) => void;
  /** Send a natural-language query to Aria */
  sendMessage: (message: string) => Promise<void>;
  /** Approve the active proposal */
  confirmProposal: () => Promise<void>;
  /** Reject the active proposal */
  rejectProposal: () => Promise<void>;
  /** Clear the AI response display */
  clearResponse: () => void;
  /** Clear entire conversation and reset state */
  resetConversation: () => void;
  /** Last error message, if any */
  error: string | null;
  /** Success message after confirm */
  confirmMessage: string | null;
}

const AriaContext = createContext<AriaContextValue | null>(null);

// ── Provider ─────────────────────────────────────────────────

export function AriaProvider({ children }: { children: ReactNode }) {
  const { banks } = useBanks();
  const activeBanks = (banks || []).filter((b) => b.status === 'active');

  const [conversation, setConversation] = useState<ConversationMessage[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [aiResponse, setAiResponse] = useState('');
  const [isTypingResponse, setIsTypingResponse] = useState(false);
  const [activeProposal, setActiveProposal] = useState<AriaProposal | null>(null);
  const [selectedBankId, setSelectedBankId] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [confirmMessage, setConfirmMessage] = useState<string | null>(null);

  // Auto-select first bank if none selected
  useEffect(() => {
    if (!selectedBankId && activeBanks.length > 0) {
      setSelectedBankId(activeBanks[0].id);
    }
  }, [selectedBankId, activeBanks]);

  // ── Typewriter effect ──────────────────────────────────────
  const typewriterDisplay = useCallback((text: string | unknown) => {
    // Defensive: Gemini may return an object for "message" (e.g. a config dump)
    const safeText = typeof text === 'string'
      ? text
      : JSON.stringify(text, null, 2);
    setIsTypingResponse(true);
    setAiResponse('');

    const words = safeText.split(' ');
    let displayed = '';
    let i = 0;

    const interval = setInterval(() => {
      if (i < words.length) {
        displayed += (i === 0 ? '' : ' ') + words[i];
        setAiResponse(displayed);
        i++;
      } else {
        clearInterval(interval);
        setIsTypingResponse(false);
      }
    }, 30);

    return () => clearInterval(interval);
  }, []);

  // ── Send message ───────────────────────────────────────────
  const sendMessage = useCallback(async (message: string) => {
    if (!selectedBankId || !message.trim()) return;

    setError(null);
    setConfirmMessage(null);
    setActiveProposal(null);
    setAiResponse('');
    setIsLoading(true);

    // Add user message to conversation
    const userMsg: ConversationMessage = { role: 'user', content: message };
    const updatedConversation = [...conversation, userMsg];
    setConversation(updatedConversation);

    try {
      const resp = await callServer<any>('/aria', {
        action: 'interpret',
        bank_id: selectedBankId,
        message,
        conversation_history: updatedConversation,
      });

      if (resp.error) {
        const safeError = typeof resp.error === 'string' ? resp.error : JSON.stringify(resp.error);
        setError(safeError);
        const errMsg: ConversationMessage = {
          role: 'aria',
          content: `Error: ${safeError}`,
        };
        setConversation((prev) => [...prev, errMsg]);
        return;
      }

      if (resp.type === 'info') {
        const safeMessage = typeof resp.message === 'string'
          ? resp.message
          : JSON.stringify(resp.message, null, 2);
        const ariaMsg: ConversationMessage = {
          role: 'aria',
          content: safeMessage,
        };
        setConversation((prev) => [...prev, ariaMsg]);
        typewriterDisplay(safeMessage);
      } else if (resp.type === 'proposal') {
        const proposal: AriaProposal = {
          proposal_id: resp.proposal_id,
          reasoning: resp.reasoning,
          changes: resp.changes,
          warnings: resp.warnings || [],
          affected_banks: resp.affected_banks || [],
        };
        setActiveProposal(proposal);

        // Build a readable summary for conversation
        const changesSummary = proposal.changes
          .map(
            (c) =>
              `• **${c.parameter}**: ${formatValue(c.current_value)} → ${formatValue(c.proposed_value)}`,
          )
          .join('\n');
        const responseText = `${proposal.reasoning}\n\nProposed changes:\n${changesSummary}${
          proposal.warnings.length > 0
            ? `\n\nWarnings: ${proposal.warnings.join('; ')}`
            : ''
        }`;

        const ariaMsg: ConversationMessage = {
          role: 'aria',
          content: responseText,
        };
        setConversation((prev) => [...prev, ariaMsg]);
        typewriterDisplay(responseText);
      } else if (resp.type === 'rejected') {
        const safeRejMessage = typeof resp.message === 'string'
          ? resp.message
          : JSON.stringify(resp.message, null, 2);
        const rejMsg = `Cannot proceed: ${safeRejMessage}`;
        const ariaMsg: ConversationMessage = { role: 'aria', content: rejMsg };
        setConversation((prev) => [...prev, ariaMsg]);
        typewriterDisplay(rejMsg);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      setError(msg);
      console.error('[AriaContext] sendMessage failed:', err);
    } finally {
      setIsLoading(false);
    }
  }, [selectedBankId, conversation, typewriterDisplay]);

  // ── Confirm proposal ───────────────────────────────────────
  const confirmProposal = useCallback(async () => {
    if (!activeProposal || !selectedBankId) return;

    setIsLoading(true);
    setError(null);
    setConfirmMessage(null);

    try {
      const resp = await callServer<any>('/aria', {
        action: 'confirm',
        bank_id: selectedBankId,
        changes: activeProposal.changes,
        proposal_id: activeProposal.proposal_id,
      });

      if (resp.success) {
        const rawMsg = resp.message || 'Changes applied successfully.';
        const msg = typeof rawMsg === 'string' ? rawMsg : JSON.stringify(rawMsg);
        setConfirmMessage(msg);
        const ariaMsg: ConversationMessage = { role: 'aria', content: `✓ ${msg}` };
        setConversation((prev) => [...prev, ariaMsg]);
        typewriterDisplay(`✓ ${msg}`);
        setActiveProposal(null);
      } else {
        const rawErr = resp.message || 'Failed to apply changes.';
        const errMsg = typeof rawErr === 'string' ? rawErr : JSON.stringify(rawErr);
        setError(errMsg);
        const ariaMsg: ConversationMessage = { role: 'aria', content: `Error: ${errMsg}` };
        setConversation((prev) => [...prev, ariaMsg]);
        typewriterDisplay(`Error: ${errMsg}`);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Confirm failed';
      setError(msg);
      console.error('[AriaContext] confirmProposal failed:', err);
    } finally {
      setIsLoading(false);
    }
  }, [activeProposal, selectedBankId, typewriterDisplay]);

  // ── Reject proposal ────────────────────────────────────────
  const rejectProposal = useCallback(async () => {
    if (!activeProposal) return;

    try {
      await callServer('/aria', {
        action: 'reject',
        proposal_id: activeProposal.proposal_id,
      });
    } catch {
      // Non-critical — reject is a no-op on server
    }

    const ariaMsg: ConversationMessage = {
      role: 'aria',
      content: 'Understood — no changes made.',
    };
    setConversation((prev) => [...prev, ariaMsg]);
    typewriterDisplay('Understood — no changes made.');
    setActiveProposal(null);
  }, [activeProposal, typewriterDisplay]);

  // ── Clear / Reset ──────────────────────────────────────────
  const clearResponse = useCallback(() => {
    setAiResponse('');
    setIsTypingResponse(false);
    setConfirmMessage(null);
    setError(null);
  }, []);

  const resetConversation = useCallback(() => {
    setConversation([]);
    setAiResponse('');
    setIsTypingResponse(false);
    setActiveProposal(null);
    setError(null);
    setConfirmMessage(null);
  }, []);

  return (
    <AriaContext.Provider
      value={{
        conversation,
        isLoading,
        aiResponse,
        isTypingResponse,
        activeProposal,
        selectedBankId,
        setSelectedBankId,
        sendMessage,
        confirmProposal,
        rejectProposal,
        clearResponse,
        resetConversation,
        error,
        confirmMessage,
      }}
    >
      {children}
    </AriaContext.Provider>
  );
}

// ── Hook ─────────────────────────────────────────────────────

export function useAria(): AriaContextValue {
  const ctx = useContext(AriaContext);
  if (!ctx) {
    throw new Error('useAria must be used within an AriaProvider');
  }
  return ctx;
}

// ── Helpers ──────────────────────────────────────────────────

function formatValue(val: unknown): string {
  if (val === null || val === undefined) return 'null';
  if (Array.isArray(val)) return val.join(', ');
  if (typeof val === 'number') {
    if (val >= 1_000_000) return `$${(val / 1_000_000).toFixed(1)}M`;
    if (val >= 1_000) return `$${(val / 1_000).toFixed(0)}K`;
    if (val < 1 && val > 0) return `${(val * 100).toFixed(0)}%`;
    return String(val);
  }
  return String(val);
}