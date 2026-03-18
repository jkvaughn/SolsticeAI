/**
 * GlobalInputBar — Notion-style 3-state Aria chat interface:
 *
 * 1. **Dot** (default): Small circular FAB in bottom-right corner.
 *    Shows notification badge when there's an unread response.
 *
 * 2. **Floating**: Compact popup window anchored bottom-right.
 *    Contains full chat, suggestions, workflow actions, and input.
 *
 * 3. **Sidebar**: Full-height right panel that pushes main content.
 *    Same capabilities as floating but with more vertical space.
 *
 * Mode switcher dropdown in floating/sidebar header lets operator
 * toggle between layouts. Closing either returns to dot.
 *
 * Accent color: uses coda-brand tokens (blue) to match app identity.
 */

import React, { useState, useRef, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from '../motion-shim';
import {
  ArrowUp, X, Sparkles, ArrowRight, MessageSquare,
  PanelRight, MessageCircle, ChevronDown, Minus,
  Copy, Check, ThumbsUp, ThumbsDown, ChevronRight,
  Plus, SlidersHorizontal, Mic, FileText,
} from 'lucide-react';

// ─── Constants ───────────────────────────────────────────────
const EASE_OUT = [0.32, 0.72, 0, 1] as const;
const PANEL_WIDTH = 340;
const FLOATING_WIDTH = 380;
const FLOATING_HEIGHT = 520;

// ─── Types ───────────────────────────────────────────────────

export type AriaMode = 'dot' | 'floating' | 'sidebar';

export interface Suggestion {
  text: string;
  action?: () => void;
}

export interface WorkflowState {
  isActive: boolean;
  phase?: string;
  showApproval?: boolean;
  onApprove?: () => void;
  onCancel?: () => void;
  executionComplete?: boolean;
  onViewResults?: () => void;
}

export interface GlobalInputBarProps {
  suggestions?: Suggestion[];
  placeholder?: string;
  onQuerySubmit: (query: string) => void;
  ctaQuestion?: string;
  isLoading?: boolean;
  disableInitialAnimation?: boolean;
  aiResponse?: string;
  isTypingResponse?: boolean;
  onClearResponse?: () => void;
  workflowContext?: WorkflowState;
  sidebarWidth?: number;
  conversationHistory?: { role: 'user' | 'aria'; content: string }[];
  /** Current display mode */
  ariaMode?: AriaMode;
  /** Set the display mode */
  onSetAriaMode?: (mode: AriaMode) => void;
  /** Label shown in sidebar header (e.g. bank code) */
  bankLabel?: string;
  // Legacy props (mapped internally)
  onToggleChatPanel?: () => void;
  isChatPanelOpen?: boolean;
}

// ─── Minimal markdown renderer ───────────────────────────────

function tryParseArray(val: string): string[] | null {
  const trimmed = val.trim().replace(/,\s*$/, '');
  if (!trimmed.startsWith('[')) return null;
  try {
    const arr = JSON.parse(trimmed);
    if (Array.isArray(arr) && arr.every(v => typeof v === 'string' || typeof v === 'number')) {
      return arr.map(String);
    }
  } catch { /* not JSON */ }
  return null;
}

function renderKvValue(raw: string, keyIndex: number): React.ReactNode {
  const cleaned = raw.replace(/,\s*$/, '').trim();
  const arr = tryParseArray(cleaned);
  if (arr) {
    return (
      <div className="flex flex-wrap gap-1 mt-0.5">
        {arr.map((item, idx) => (
          <span
            key={`${keyIndex}-tag-${idx}`}
            className="inline-block text-[9px] font-mono font-medium px-1.5 py-0.5 rounded-md
                       bg-coda-brand/10 text-coda-brand border border-coda-brand/15"
          >
            {item}
          </span>
        ))}
      </div>
    );
  }
  if (cleaned.toLowerCase() === 'true' || cleaned.toLowerCase() === 'false') {
    return (
      <span className={`text-[11px] font-semibold ${cleaned.toLowerCase() === 'true' ? 'text-emerald-500' : 'text-coda-text-muted'}`}>
        {cleaned.toLowerCase() === 'true' ? '\u2713 On' : '\u2717 Off'}
      </span>
    );
  }
  const num = Number(cleaned.replace(/[$,]/g, ''));
  if (!isNaN(num) && cleaned.match(/^[$]?[\d,.]+$/)) {
    const formatted = num >= 1_000_000
      ? `$${(num / 1_000_000).toFixed(1)}M`
      : num >= 1_000
        ? `$${(num / 1_000).toLocaleString('en-US')}K`
        : num < 1 && num > 0
          ? `${(num * 100).toFixed(0)}%`
          : num.toLocaleString('en-US');
    return (
      <span className="text-[11px] font-mono font-semibold text-coda-text tabular-nums">
        {formatted}
      </span>
    );
  }
  if (cleaned.match(/^[\d.]+%$/)) {
    return (
      <span className="text-[11px] font-mono font-semibold text-coda-text tabular-nums">
        {cleaned}
      </span>
    );
  }
  return <span className="text-[11px] font-mono text-coda-text-secondary">{cleaned}</span>;
}

function renderMarkdown(text: string): React.ReactNode {
  const lines = text.split('\n');
  const elements: React.ReactNode[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    if (line.trim() === '{' || line.trim() === '}' || line.trim() === '{,' || line.trim() === '},') { i++; continue; }
    if (line.trim() === '') { elements.push(<div key={`sp-${i}`} className="h-2.5" />); i++; continue; }
    if (line.trim().startsWith('```')) {
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith('```')) { codeLines.push(lines[i]); i++; }
      i++;
      elements.push(
        <pre key={`code-${i}`} className="text-[12px] font-mono bg-black/[0.04] dark:bg-white/[0.06] rounded-lg px-3 py-2.5 my-2 overflow-x-auto whitespace-pre text-coda-text-secondary leading-relaxed">
          {codeLines.join('\n')}
        </pre>
      );
      continue;
    }
    const headerMatch = line.match(/^(#{1,4})\s+(.+)/);
    if (headerMatch) {
      const level = headerMatch[1].length;
      const sz = level <= 2 ? 'text-[15px] font-semibold' : 'text-sm font-semibold';
      elements.push(<p key={`h-${i}`} className={`${sz} text-coda-text mt-3 mb-1`}>{inlineFormat(headerMatch[2])}</p>);
      i++; continue;
    }
    if (/^\s*[-*]\s+/.test(line)) {
      const items: { indent: number; content: string }[] = [];
      while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) {
        const m = lines[i].match(/^(\s*)[-*]\s+(.+)/);
        if (m) items.push({ indent: m[1].length, content: m[2] });
        i++;
      }
      elements.push(
        <ul key={`ul-${i}`} className="space-y-1 my-2">
          {items.map((item, idx) => (
            <li key={idx} className="flex items-start gap-2" style={{ paddingLeft: `${Math.min(item.indent, 8)}px` }}>
              <span className="text-coda-text-muted mt-[7px] flex-shrink-0 text-[5px]">{'\u25CF'}</span>
              <span className="text-coda-text-secondary text-sm leading-relaxed">{inlineFormat(item.content)}</span>
            </li>
          ))}
        </ul>
      );
      continue;
    }
    if (/^\s*\d+[.)]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*\d+[.)]\s+/.test(lines[i])) {
        const m = lines[i].match(/^\s*\d+[.)]\s+(.+)/);
        if (m) items.push(m[1]);
        i++;
      }
      elements.push(
        <ol key={`ol-${i}`} className="space-y-1 my-2">
          {items.map((item, idx) => (
            <li key={idx} className="flex items-start gap-2">
              <span className="text-coda-text-muted flex-shrink-0 text-xs font-mono min-w-[16px] text-right mt-0.5">{idx + 1}.</span>
              <span className="text-coda-text-secondary text-sm leading-relaxed">{inlineFormat(item)}</span>
            </li>
          ))}
        </ol>
      );
      continue;
    }
    const kvMatch = line.match(/^["\s]*([a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*)*)["\s]*[:=]\s*(.+)/i);
    if (kvMatch && !line.startsWith('http')) {
      let fullValue = kvMatch[2];
      if (fullValue.trim().startsWith('[') && !fullValue.includes(']')) {
        i++;
        while (i < lines.length && !fullValue.includes(']')) { fullValue += lines[i].trim(); i++; }
      } else { i++; }
      const valueNode = renderKvValue(fullValue, i);
      const isBlockValue = tryParseArray(fullValue.replace(/,\s*$/, '').trim()) !== null;
      elements.push(
        <div key={`kv-${i}`} className={`py-1 ${isBlockValue ? '' : 'flex items-baseline gap-2'}`}>
          <div className="flex items-baseline gap-2">
            <code className="text-xs font-mono text-coda-brand flex-shrink-0">{kvMatch[1]}</code>
            {!isBlockValue && (<><span className="text-xs text-coda-text-muted">{'\u2192'}</span>{valueNode}</>)}
          </div>
          {isBlockValue && (<div className="ml-3 mt-0.5">{valueNode}</div>)}
        </div>
      );
      continue;
    }
    elements.push(<p key={`p-${i}`} className="text-coda-text-secondary text-sm leading-relaxed">{inlineFormat(line)}</p>);
    i++;
  }
  return <>{elements}</>;
}

function inlineFormat(text: string): React.ReactNode {
  const parts: React.ReactNode[] = [];
  // Match: **bold**, `code`, *italic*, and SCREAMING_SNAKE_CASE / ALL_CAPS tokens (3+ chars)
  const regex = /(\*\*(.+?)\*\*|`([^`]+)`|\*([^*]+)\*|\b([A-Z][A-Z0-9_]{2,})\b)/g;
  let lastIndex = 0;
  let match;
  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) parts.push(text.substring(lastIndex, match.index));
    if (match[2]) parts.push(<strong key={match.index} className="font-semibold text-coda-text">{match[2]}</strong>);
    else if (match[3]) parts.push(<code key={match.index} className="text-[12px] font-mono px-1.5 py-0.5 rounded-md bg-black/[0.06] dark:bg-white/[0.08] text-coda-brand">{match[3]}</code>);
    else if (match[4]) parts.push(<em key={match.index} className="italic text-coda-text-secondary">{match[4]}</em>);
    else if (match[5]) parts.push(<code key={match.index} className="text-[11px] font-mono px-1 py-0.5 rounded bg-black/[0.05] dark:bg-white/[0.07] text-coda-text-secondary">{match[5]}</code>);
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < text.length) parts.push(text.substring(lastIndex));
  return parts.length > 0 ? parts : text;
}

// ─── Copy Button ─────────────────────────────────────────────

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = () => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };
  return (
    <button
      onClick={handleCopy}
      className="p-1 rounded-md hover:bg-black/5 dark:hover:bg-white/5 transition-colors cursor-pointer text-coda-text-muted hover:text-coda-text-secondary"
      title="Copy"
    >
      {copied ? <Check size={12} className="text-emerald-500" /> : <Copy size={12} />}
    </button>
  );
}

// ─── Feedback Button ─────────────────────────────────────────

function FeedbackButton({ type }: { type: 'up' | 'down' }) {
  const [active, setActive] = useState(false);
  const Icon = type === 'up' ? ThumbsUp : ThumbsDown;
  return (
    <button
      onClick={() => setActive(!active)}
      className={`p-1 rounded-md transition-colors cursor-pointer ${
        active
          ? 'text-coda-brand bg-coda-brand/10'
          : 'text-coda-text-muted hover:text-coda-text-secondary hover:bg-black/5 dark:hover:bg-white/5'
      }`}
      title={type === 'up' ? 'Helpful' : 'Not helpful'}
    >
      <Icon size={12} />
    </button>
  );
}

// ─── Collapsible Thought Section ─────────────────────────────

function ThoughtSection({ reasoning }: { reasoning: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mb-1.5">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1 text-[11px] text-coda-text-muted hover:text-coda-text-secondary
                   transition-colors cursor-pointer py-0.5"
      >
        <ChevronRight
          size={12}
          className={`transition-transform duration-200 ${open ? 'rotate-90' : ''}`}
        />
        <span className="font-medium">Thought</span>
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <p className="text-[11px] text-coda-text-muted leading-relaxed pl-4 py-1">
              {reasoning}
            </p>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ─── Extract reasoning line from proposal messages ───────────

function splitReasoningAndContent(text: string): { reasoning: string | null; body: string } {
  // If the message starts with a reasoning sentence followed by "Proposed changes:", split it
  const proposalIdx = text.indexOf('\n\nProposed changes:');
  if (proposalIdx > 0) {
    return {
      reasoning: text.slice(0, proposalIdx).trim(),
      body: text.slice(proposalIdx + 2).trim(),
    };
  }
  return { reasoning: null, body: text };
}

// ─── Mode Switcher Dropdown ─────────────────────────────────

function ModeSwitcher({
  currentMode,
  onSetMode,
}: {
  currentMode: 'floating' | 'sidebar';
  onSetMode: (mode: AriaMode) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="p-1.5 rounded-lg hover:bg-black/10 dark:hover:bg-white/10
                   transition-colors cursor-pointer text-coda-text-muted hover:text-coda-text"
        title="Switch layout"
      >
        {currentMode === 'sidebar' ? <PanelRight size={15} /> : <MessageCircle size={15} />}
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: -4 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: -4 }}
            transition={{ duration: 0.15 }}
            className="absolute right-0 top-full mt-1 z-[60] min-w-[140px]
                       backdrop-blur-2xl bg-white/80 dark:bg-neutral-900/90
                       border border-black/10 dark:border-white/10
                       rounded-xl shadow-xl overflow-hidden"
          >
            <button
              onClick={() => { onSetMode('sidebar'); setOpen(false); }}
              className="w-full flex items-center gap-2.5 px-3 py-2 text-xs text-coda-text
                         hover:bg-black/5 dark:hover:bg-white/5 transition-colors cursor-pointer"
            >
              <PanelRight size={14} className="text-coda-text-muted" />
              <span className="flex-1 text-left">Sidebar</span>
              {currentMode === 'sidebar' && (
                <span className="text-coda-brand text-[10px]">{'\u2713'}</span>
              )}
            </button>
            <button
              onClick={() => { onSetMode('floating'); setOpen(false); }}
              className="w-full flex items-center gap-2.5 px-3 py-2 text-xs text-coda-text
                         hover:bg-black/5 dark:hover:bg-white/5 transition-colors cursor-pointer"
            >
              <MessageCircle size={14} className="text-coda-text-muted" />
              <span className="flex-1 text-left">Floating</span>
              {currentMode === 'floating' && (
                <span className="text-coda-brand text-[10px]">{'\u2713'}</span>
              )}
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ─── Main Component ──────────────────────────────────────────

export function GlobalInputBar({
  suggestions = [],
  placeholder = 'Ask Aria anything...',
  onQuerySubmit,
  ctaQuestion,
  isLoading = false,
  aiResponse = '',
  isTypingResponse = false,
  onClearResponse,
  workflowContext,
  sidebarWidth = 0,
  conversationHistory = [],
  ariaMode: ariaModeExternal,
  onSetAriaMode: onSetAriaModeExternal,
  bankLabel,
  // Legacy props
  onToggleChatPanel,
  isChatPanelOpen,
}: GlobalInputBarProps) {
  // Bridge legacy props to new 3-state system
  const ariaMode: AriaMode = ariaModeExternal
    ?? (isChatPanelOpen ? 'sidebar' : 'dot');
  const setAriaMode = useCallback((mode: AriaMode) => {
    if (onSetAriaModeExternal) {
      onSetAriaModeExternal(mode);
    } else if (onToggleChatPanel) {
      onToggleChatPanel();
    }
  }, [onSetAriaModeExternal, onToggleChatPanel]);

  const [query, setQuery] = useState('');
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [isMultiLine, setIsMultiLine] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Track if there's an unread response (for dot badge)
  const [hasUnread, setHasUnread] = useState(false);
  useEffect(() => {
    if (ariaMode === 'dot' && aiResponse && !isLoading) {
      setHasUnread(true);
    }
    if (ariaMode !== 'dot') {
      setHasUnread(false);
    }
  }, [aiResponse, isLoading, ariaMode]);

  // Auto-scroll chat to bottom on new messages
  useEffect(() => {
    if (ariaMode !== 'dot' && scrollRef.current) {
      requestAnimationFrame(() => {
        scrollRef.current?.scrollTo({
          top: scrollRef.current.scrollHeight,
          behavior: 'smooth',
        });
      });
    }
  }, [ariaMode, conversationHistory.length, aiResponse]);

  // Auto-focus textarea when opening
  useEffect(() => {
    if (ariaMode !== 'dot') {
      requestAnimationFrame(() => textareaRef.current?.focus());
    }
  }, [ariaMode]);

  // ── Submit handler ─────────────────────────────────────────
  const handleSubmit = (text?: string) => {
    const queryText = text || query;
    if (!queryText?.trim()) return;
    setShowSuggestions(false);
    onQuerySubmit(queryText);
    setQuery('');
    setIsMultiLine(false);
    requestAnimationFrame(() => {
      if (textareaRef.current) textareaRef.current.style.height = '24px';
    });
  };

  const handleFocus = () => {
    if (!workflowContext?.isActive && !isLoading && !aiResponse) {
      setShowSuggestions(true);
    }
  };

  useEffect(() => {
    if (workflowContext?.isActive) setShowSuggestions(false);
  }, [workflowContext?.isActive]);

  // ── Shared Input Row ───────────────────────────────────────
  const InputRow = (
    <div className="flex flex-col rounded-2xl border border-black/[0.08] dark:border-white/[0.08]
                    bg-white/60 dark:bg-white/[0.04] transition-colors duration-200 overflow-hidden">
      {/* Context chip row */}
      {bankLabel && (
        <div className="px-3 pt-3 pb-0">
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg
                           bg-black/[0.04] dark:bg-white/[0.06] text-xs text-coda-text-secondary
                           border border-black/[0.06] dark:border-white/[0.06]">
            <FileText size={12} className="text-coda-text-muted flex-shrink-0" />
            <span className="truncate max-w-[180px]">{bankLabel}</span>
          </span>
        </div>
      )}

      {/* Textarea area */}
      <div className="px-3 py-2.5">
        <textarea
          ref={textareaRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === 'a') return;
            if (e.key === 'Enter' && !e.shiftKey && query.trim()) {
              e.preventDefault();
              handleSubmit(query);
            }
          }}
          onFocus={handleFocus}
          onBlur={() => setTimeout(() => setShowSuggestions(false), 200)}
          placeholder={isLoading ? 'Aria is thinking...' : 'Do anything with AI...'}
          rows={1}
          disabled={isLoading}
          className="w-full border-0 text-sm bg-transparent text-coda-text
                     placeholder:text-coda-text-muted/60
                     focus-visible:ring-0 focus-visible:ring-offset-0
                     px-0 focus:outline-none resize-none overflow-hidden
                     aria-global-textarea disabled:opacity-50"
          style={{ minHeight: '24px', maxHeight: '120px' }}
          onInput={(e) => {
            const target = e.target as HTMLTextAreaElement;
            target.style.height = '24px';
            target.style.height = Math.min(target.scrollHeight, 120) + 'px';
            setIsMultiLine(target.scrollHeight > 30);
          }}
        />
      </div>

      {/* Bottom toolbar */}
      <div className="flex items-center justify-between px-2.5 pb-2.5 pt-0">
        {/* Left actions */}
        <div className="flex items-center gap-0.5">
          <button
            className="p-1.5 rounded-lg text-coda-text-muted hover:text-coda-text-secondary
                       hover:bg-black/[0.05] dark:hover:bg-white/[0.06] transition-colors cursor-pointer"
            title="Add context"
          >
            <Plus size={16} />
          </button>
          <button
            className="p-1.5 rounded-lg text-coda-text-muted hover:text-coda-text-secondary
                       hover:bg-black/[0.05] dark:hover:bg-white/[0.06] transition-colors cursor-pointer"
            title="Settings"
          >
            <SlidersHorizontal size={16} />
          </button>
        </div>

        {/* Right actions */}
        <div className="flex items-center gap-1">
          {isLoading && (
            <motion.div
              animate={{ rotate: 360 }}
              transition={{ duration: 1.5, repeat: Infinity, ease: 'linear' }}
              className="w-4 h-4 border-2 border-coda-brand border-t-transparent rounded-full flex-shrink-0 mr-1"
            />
          )}
          <span className="text-xs text-coda-text-muted/60 font-medium mr-1 select-none">Auto</span>
          <button
            className="p-1.5 rounded-lg text-coda-text-muted hover:text-coda-text-secondary
                       hover:bg-black/[0.05] dark:hover:bg-white/[0.06] transition-colors cursor-pointer"
            title="Voice input"
          >
            <Mic size={16} />
          </button>
          <button
            onClick={() => { if (query.trim()) handleSubmit(query); }}
            disabled={!query.trim() || isLoading}
            className={`p-1.5 rounded-full transition-all flex-shrink-0 cursor-pointer ${
              query.trim() && !isLoading
                ? 'bg-coda-text text-white dark:bg-white dark:text-neutral-900 hover:opacity-80'
                : 'bg-black/[0.08] dark:bg-white/[0.08] text-coda-text-muted cursor-not-allowed'
            }`}
          >
            <ArrowUp size={14} />
          </button>
        </div>
      </div>
    </div>
  );

  // ── Shared Chat Messages ───────────────────────────────────
  const ChatMessages = (
    <>
      {conversationHistory.length === 0 && !isLoading ? (
        <div className="flex flex-col items-center justify-center h-full gap-3 text-center px-4 py-8">
          <div className="w-12 h-12 rounded-full bg-black/[0.06] dark:bg-white/[0.06]
                          flex items-center justify-center">
            <Sparkles size={20} className="text-coda-text-muted" />
          </div>
          <div>
            <p className="text-sm font-medium text-coda-text mb-1">How can I help you today?</p>
            <p className="text-xs text-coda-text-muted">
              Ask about architecture, features, or configure agent settings.
            </p>
          </div>
        </div>
      ) : (
        conversationHistory.map((msg, i) => {
          const { reasoning, body } = splitReasoningAndContent(msg.content);
          return (
            <motion.div
              key={`${i}-${msg.role}`}
              initial={i === conversationHistory.length - 1 ? { opacity: 0, y: 8 } : false}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.25 }}
              className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
            >
              {msg.role === 'user' ? (
                /* ── User message: right-aligned gray bubble, no avatar ── */
                <div className="max-w-[85%]">
                  <div className="px-3 py-2 rounded-2xl rounded-tr-sm
                                  bg-black/[0.06] dark:bg-white/[0.08] text-coda-text text-sm leading-relaxed">
                    {msg.content}
                  </div>
                </div>
              ) : (
                /* ── AI message: Notion-style clean text, no avatar, no bubble ── */
                <div className="max-w-[95%] group/msg">
                  {/* Collapsible thought/reasoning section */}
                  {reasoning && (
                    <ThoughtSection reasoning={reasoning} />
                  )}

                  {/* Main content — clean text, no bubble */}
                  <div className="text-sm leading-[1.7] text-coda-text">
                    {renderMarkdown(body)}
                  </div>

                  {/* Action buttons row */}
                  <div className="flex items-center gap-0.5 mt-2 opacity-0 group-hover/msg:opacity-100
                                  transition-opacity duration-150"
                       style={{ opacity: i === conversationHistory.length - 1 ? 1 : undefined }}
                  >
                    <CopyButton text={msg.content} />
                    <FeedbackButton type="up" />
                    <FeedbackButton type="down" />
                  </div>
                </div>
              )}
            </motion.div>
          );
        })
      )}

      {/* Typing indicator */}
      {isTypingResponse && (
        <div className="flex justify-start">
          <div className="inline-flex items-center gap-1.5 px-3 py-2 rounded-2xl bg-black/[0.04] dark:bg-white/[0.06]">
            <span className="inline-block w-1.5 h-1.5 rounded-full bg-coda-text-muted animate-pulse" />
            <span className="inline-block w-1.5 h-1.5 rounded-full bg-coda-text-muted animate-pulse [animation-delay:150ms]" />
            <span className="inline-block w-1.5 h-1.5 rounded-full bg-coda-text-muted animate-pulse [animation-delay:300ms]" />
          </div>
        </div>
      )}

      {/* Loading indicator */}
      {isLoading && !isTypingResponse && (
        <div className="flex justify-center py-2">
          <div className="inline-flex items-center gap-2 px-3 py-2 rounded-full
                          bg-white/10 dark:bg-white/[0.06]">
            <motion.div
              animate={{ rotate: 360 }}
              transition={{ duration: 1.5, repeat: Infinity, ease: 'linear' }}
              className="w-3.5 h-3.5 border-2 border-coda-brand border-t-transparent rounded-full"
            />
            <span className="text-[11px] text-coda-text-muted">Thinking...</span>
          </div>
        </div>
      )}
    </>
  );

  // ── Shared Workflow Actions ─────────────────────────────────
  const WorkflowActions = workflowContext?.isActive ? (
    <div className="px-3 py-2.5 border-t border-black/[0.06] dark:border-white/[0.06] flex-shrink-0">
      {workflowContext.executionComplete && workflowContext.onViewResults ? (
        <div className="flex items-center justify-between gap-2">
          <p className="text-[11px] text-coda-text-muted">Changes applied.</p>
          <button
            onClick={workflowContext.onViewResults}
            className="flex items-center gap-1 px-3 py-1.5 rounded-full text-xs font-medium
                       bg-coda-brand/10 border border-coda-brand/20 text-coda-brand
                       hover:bg-coda-brand/20 cursor-pointer transition-colors"
          >
            Show config <ArrowRight className="w-3 h-3" />
          </button>
        </div>
      ) : (
        <div className="flex flex-wrap gap-1.5">
          {workflowContext.showApproval && workflowContext.onApprove && (
            <button
              onClick={workflowContext.onApprove}
              className="px-3 py-1.5 rounded-full text-xs font-medium cursor-pointer transition-all
                         bg-coda-brand/10 border border-coda-brand/20 text-coda-brand hover:bg-coda-brand/20"
            >
              Apply Changes
            </button>
          )}
          {workflowContext.onCancel && (
            <button
              onClick={workflowContext.onCancel}
              className="px-3 py-1.5 rounded-full text-xs cursor-pointer transition-all
                         bg-black/5 dark:bg-white/5 text-coda-text-muted
                         hover:bg-black/10 dark:hover:bg-white/10 hover:text-coda-text"
            >
              Reject
            </button>
          )}
        </div>
      )}
    </div>
  ) : null;

  // ── Shared Suggestion Chips ────────────────────────────────
  const SuggestionChips = (showSuggestions || ariaMode !== 'dot') && !workflowContext?.isActive && suggestions.length > 0 && !isLoading && conversationHistory.length === 0 ? (
    <div className="px-3 py-2 border-t border-black/[0.04] dark:border-white/[0.04] flex-shrink-0">
      <div className="flex flex-wrap gap-1">
        {suggestions.map((s) => (
          <button
            key={s.text}
            onClick={() => {
              if (s.action) s.action();
              else handleSubmit(s.text);
            }}
            className="px-2 py-1 rounded-full text-[10px] transition-all cursor-pointer
                       bg-black/5 dark:bg-white/5 text-coda-text-muted
                       hover:bg-black/10 dark:hover:bg-white/10 hover:text-coda-text"
          >
            {s.text}
          </button>
        ))}
      </div>
    </div>
  ) : null;

  // ── Panel Header (shared between floating & sidebar) ───────
  const PanelHeader = (
    <div className="px-4 py-3 border-b border-black/[0.06] dark:border-white/[0.06]
                    flex items-center gap-3 flex-shrink-0">
      <div className="w-7 h-7 rounded-full bg-black/[0.06] dark:bg-white/[0.06]
                      flex items-center justify-center">
        <Sparkles size={12} className="text-coda-text-secondary" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-coda-text leading-tight">Aria</p>
        <p className="text-[10px] text-coda-text-muted font-mono">
          {bankLabel ? `${bankLabel} session` : 'AI assistant'}
        </p>
      </div>
      <ModeSwitcher
        currentMode={ariaMode === 'sidebar' ? 'sidebar' : 'floating'}
        onSetMode={setAriaMode}
      />
      {/* Minimize to dot */}
      <button
        onClick={() => setAriaMode('dot')}
        className="p-1.5 rounded-lg hover:bg-black/10 dark:hover:bg-white/10
                   transition-colors cursor-pointer"
        title="Minimize"
      >
        <Minus size={15} className="text-coda-text-muted" />
      </button>
      {/* Close */}
      <button
        onClick={() => setAriaMode('dot')}
        className="p-1.5 rounded-lg hover:bg-black/10 dark:hover:bg-white/10
                   transition-colors cursor-pointer"
        title="Close"
      >
        <X size={15} className="text-coda-text-muted" />
      </button>
    </div>
  );

  // ══════════════════════════════════════════════════════════════
  // RENDER
  // ══════════════════════════════════════════════════════════════
  return (
    <>
      <AnimatePresence mode="wait">
        {/* ── STATE 1: DOT FAB ─────────────────────────────────── */}
        {ariaMode === 'dot' && (
          <motion.button
            key="aria-dot"
            initial={{ opacity: 0, scale: 0.5 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.5 }}
            transition={{ duration: 0.2, ease: EASE_OUT }}
            onClick={() => setAriaMode('floating')}
            className="fixed bottom-5 right-5 z-50 w-12 h-12 rounded-full
                       bg-neutral-800 dark:bg-neutral-200
                       shadow-lg shadow-black/15 hover:shadow-xl hover:shadow-black/20
                       hover:scale-105 active:scale-95
                       flex items-center justify-center cursor-pointer
                       transition-shadow duration-200"
            title="Open Aria"
          >
            <Sparkles size={20} className="text-white dark:text-neutral-900" />
            {/* Unread badge */}
            {hasUnread && (
              <motion.div
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                className="absolute -top-0.5 -right-0.5 w-3.5 h-3.5 rounded-full
                           bg-red-500 border-2 border-white dark:border-neutral-900"
              />
            )}
          </motion.button>
        )}

        {/* ── STATE 2: FLOATING WINDOW ─────────────────────────── */}
        {ariaMode === 'floating' && (
          <motion.div
            key="aria-floating"
            initial={{ opacity: 0, y: 20, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 20, scale: 0.95 }}
            transition={{ duration: 0.25, ease: EASE_OUT }}
            className="fixed bottom-5 right-5 z-50 flex flex-col
                       liquid-glass-elevated
                       shadow-2xl overflow-hidden rounded-2xl"
            style={{ width: FLOATING_WIDTH, height: FLOATING_HEIGHT, maxHeight: 'calc(100vh - 100px)' }}
          >
            {PanelHeader}

            {/* Chat messages */}
            <div
              ref={scrollRef}
              className="flex-1 overflow-y-auto px-4 py-4 space-y-4 scrollbar-thin min-h-0"
            >
              {ChatMessages}
            </div>

            {/* Workflow actions */}
            {WorkflowActions}

            {/* Suggestion chips */}
            {SuggestionChips}

            {/* Input */}
            <div className="px-3 pb-3 pt-2 border-t border-black/[0.06] dark:border-white/[0.06] flex-shrink-0">
              {InputRow}
            </div>

            {/* Footer */}
            <div className="px-4 pb-2 flex-shrink-0">
              <p className="text-[9px] text-coda-text-muted text-center font-mono">
                {conversationHistory.length} message{conversationHistory.length !== 1 ? 's' : ''}
              </p>
            </div>
          </motion.div>
        )}

        {/* ── STATE 3: SIDEBAR PANEL ───────────────────────────── */}
        {ariaMode === 'sidebar' && (
          <motion.div
            key="aria-sidebar"
            initial={{ opacity: 0, x: 40 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 40 }}
            transition={{ duration: 0.3, ease: EASE_OUT }}
            className="fixed right-3 top-3 bottom-3 z-50 flex flex-col
                       liquid-glass-elevated
                       shadow-2xl overflow-hidden rounded-2xl"
            style={{ width: PANEL_WIDTH }}
          >
            {PanelHeader}

            {/* Chat messages */}
            <div
              ref={scrollRef}
              className="flex-1 overflow-y-auto px-4 py-4 space-y-4 scrollbar-thin min-h-0"
            >
              {ChatMessages}
            </div>

            {/* Workflow actions */}
            {WorkflowActions}

            {/* Suggestion chips */}
            {SuggestionChips}

            {/* Input */}
            <div className="px-3 pb-3 pt-2 border-t border-black/[0.06] dark:border-white/[0.06] flex-shrink-0">
              {InputRow}
            </div>

            {/* Footer */}
            <div className="px-4 pb-2 flex-shrink-0">
              <p className="text-[9px] text-coda-text-muted text-center font-mono">
                {conversationHistory.length} message{conversationHistory.length !== 1 ? 's' : ''}
              </p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}