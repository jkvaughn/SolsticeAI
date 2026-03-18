import { useRef, useEffect, useMemo, useState, type ReactNode } from 'react';
import { motion, AnimatePresence } from '../motion-shim';
import { Bot, User, AlertCircle, ArrowRightLeft, ChevronDown, ShieldCheck, ShieldX, Loader2, CheckCircle2, ExternalLink } from 'lucide-react';
import type { AgentMessage } from '../../types';
import type { TransactionPipeline } from './PipelineTracker';
import { buildFeedItems } from './AgentActivityFeed';
import type { ChatMessage } from './RichMessage';

// ============================================================
// Types
// ============================================================

interface CommsFeedItem {
  id: string;
  ts: number;
  type: 'user' | 'agent' | 'system' | 'counterparty' | 'agent-comms' | 'settlement-card';
  content: string;
  detail?: string;
  from?: string;
  to?: string;
  status?: 'active' | 'complete' | 'error';
  transactionId?: string;
  error?: string;
  agentData?: ChatMessage['agentData'];
  settlementData?: {
    senderCode: string;
    receiverCode: string;
    amount: string;
    txSignature: string;
    riskScore?: number;
    riskLevel?: string;
    complianceStatus?: 'PASSED' | 'FAILED';
    finalStatus: string;
  };
}

// ============================================================
// Consistent color palette — Option B: neutral glass
// Agents distinguished by monogram, not color.
// ============================================================

const AGENT_MONOGRAMS: Record<string, { mono: string; name: string }> = {
  maestro: { mono: 'Ma', name: 'Maestro' },
  concord: { mono: 'Co', name: 'Concord' },
  fermata: { mono: 'Fe', name: 'Fermata' },
  canto:   { mono: 'Ca', name: 'Canto' },
  solana:  { mono: 'So', name: 'Solana' },
};

// ============================================================
// Payment Evaluation Parser
// Detects structured agent evaluation responses and extracts
// key metrics for compact widget rendering
// ============================================================

interface ParsedEvaluation {
  complianceStatus: 'PASSED' | 'FAILED';
  riskLevel: string;
  riskScore: number;
  recommendation: string;
  amount: string;
  senderCode: string;
  receiverCode: string;
  purpose: string;
  memo: string;
  riskReasoning: string;
  question: string;
  involvedParties: string[];
}

function parsePaymentEvaluation(text: string): ParsedEvaluation | null {
  // Must have compliance and risk scoring pattern
  const complianceMatch = text.match(/compliance\s*\((PASSED|FAILED)\)/i);
  const riskMatch = text.match(/risk\s+scor(?:ing|e)\s*\(?(?:level:\s*)?(\w+)[,;]\s*score:\s*(\d+)\/100[,;]\s*recommendation:\s*(\w+)/i);

  if (!complianceMatch || !riskMatch) return null;

  // Amount
  const amountMatch = text.match(/\$([0-9,]+(?:\.\d+)?)/);
  const amount = amountMatch ? `$${amountMatch[1]}` : '';

  // Route: "Maestro — JPM requests settlement of ... to UBS"
  const routeMatch = text.match(/Maestro\s*[—–\-]+\s*(\w+)\s+requests?\s+settlement\s+of\s+\$[\d,]+(?:\.\d+)?\s+to\s+(\w+)/i);
  // Fallback route: "from SENDER ($X) to RECEIVER" or "SENDER→RECEIVER" patterns
  const fallbackRouteMatch = !routeMatch
    ? text.match(/from\s+(\w{2,6})\s+\(\$[\d,]+/i) || text.match(/(\w{2,6})\s*[→>]\s*(\w{2,6})/i)
    : null;
  const senderCode = routeMatch?.[1] || fallbackRouteMatch?.[1] || '';
  const receiverCode = routeMatch?.[2] || fallbackRouteMatch?.[2] || '';

  // Purpose: "for LIQUIDITY_MGMT" or "for TREAS"
  const purposeMatch = text.match(/to\s+\w+\s+for\s+([A-Z_]+)/);
  const purpose = purposeMatch?.[1]?.replace(/_/g, ' ') || '';

  // Memo
  const memoMatch = text.match(/Memo[:\s]+([^.]+?)(?:\.\s*(?:Risk|The\s+transaction|Settlement))/i);
  const memo = memoMatch?.[1]?.trim() || '';

  // Risk reasoning - extract a concise portion
  const reasoningMatch = text.match(/Risk\s+reasoning[:\s]+(.+?)(?:\.?\s*(?:Compliance|Based\s+on|All\s+factors|The\s+compliance|However))/is);
  const riskReasoning = reasoningMatch?.[1]?.trim()?.slice(0, 200) || '';

  // Question at end
  const questionMatch = text.match(/(should you (?:ACCEPT|REJECT)[^?]*\?)/i);
  const question = questionMatch?.[1] || '';

  // Involved parties
  const partiesMatch = text.match(/involves?\s+(?:two\s+)?(?:Tier\s+\d+\s+)?(?:global\s+)?financial\s+institutions[:\s]+([^.]+)/i);
  const involvedParties = partiesMatch
    ? partiesMatch[1].split(/,\s*|\s+and\s+/).map(p => p.trim()).filter(Boolean)
    : [];

  return {
    complianceStatus: complianceMatch[1].toUpperCase() as 'PASSED' | 'FAILED',
    riskLevel: riskMatch[1].toLowerCase(),
    riskScore: parseInt(riskMatch[2], 10),
    recommendation: riskMatch[3].replace(/_/g, ' '),
    amount,
    senderCode,
    receiverCode,
    purpose,
    memo,
    riskReasoning,
    question,
    involvedParties,
  };
}

// ============================================================
// Payment Evaluation Card — compact scannable widget
// ============================================================

function PaymentEvaluationCard({ eval: ev, ts, txId, fullText }: {
  eval: ParsedEvaluation;
  ts: number;
  txId?: string;
  fullText: string;
}) {
  const [expanded, setExpanded] = useState(false);

  const scoreColor = ev.riskScore >= 70
    ? 'text-emerald-500 dark:text-emerald-400'
    : ev.riskScore >= 40
      ? 'text-amber-500 dark:text-amber-400'
      : 'text-red-500 dark:text-red-400';

  const scoreBg = ev.riskScore >= 70
    ? 'bg-emerald-500/8'
    : ev.riskScore >= 40
      ? 'bg-amber-500/8'
      : 'bg-red-500/8';

  const riskLevelColor = ev.riskLevel === 'low'
    ? 'text-emerald-500 dark:text-emerald-400 bg-emerald-500/10'
    : ev.riskLevel === 'medium'
      ? 'text-amber-500 dark:text-amber-400 bg-amber-500/10'
      : 'text-red-500 dark:text-red-400 bg-red-500/10';

  return (
    <div className="flex items-start gap-2.5 py-2 px-4">
      {/* Maestro monogram badge */}
      <div className="w-6 h-6 rounded-lg bg-black/[0.03] dark:bg-white/[0.06] border border-coda-border-subtle flex items-center justify-center shrink-0 mt-0.5">
        <span className="text-[8px] font-bold font-mono text-coda-text-muted">Ma</span>
      </div>

      <div className="flex-1 min-w-0">
        {/* Header line */}
        <div className="flex items-center gap-2 mb-1.5">
          <span className="text-[10px] font-semibold text-coda-text-secondary">Maestro</span>
          <span className="text-[8px] text-coda-text-muted font-mono">Evaluation</span>
          <TxBadge txId={txId} />
          <FeedTimestamp ts={ts} />
        </div>

        {/* Main card */}
        <div className="rounded-xl border border-coda-border-subtle bg-black/[0.02] dark:bg-white/[0.02] overflow-hidden">
          {/* Top: Route + Amount */}
          <div className="px-3 py-2.5 flex items-center gap-2 border-b border-coda-border-subtle/50">
            {ev.senderCode && (
              <div className="flex items-center gap-1.5">
                <span className="text-[9px] font-bold font-mono px-1.5 py-0.5 rounded bg-black/[0.04] dark:bg-white/[0.06] text-coda-text-secondary">
                  {ev.senderCode}
                </span>
                <span className="text-[10px] text-coda-text-muted">→</span>
                <span className="text-[9px] font-bold font-mono px-1.5 py-0.5 rounded bg-black/[0.04] dark:bg-white/[0.06] text-coda-text-secondary">
                  {ev.receiverCode}
                </span>
              </div>
            )}
            <span className="text-[15px] font-semibold font-mono text-coda-text ml-auto tracking-tight">
              {ev.amount}
            </span>
          </div>

          {/* Metrics row */}
          <div className="px-3 py-2.5 flex items-center gap-3">
            {/* Risk Score — big number */}
            <div className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg ${scoreBg}`}>
              <span className={`text-[20px] font-bold font-mono leading-none ${scoreColor}`}>
                {ev.riskScore}
              </span>
              <div className="flex flex-col">
                <span className="text-[7px] uppercase tracking-wider text-coda-text-muted leading-tight">Risk</span>
                <span className="text-[7px] uppercase tracking-wider text-coda-text-muted leading-tight">Score</span>
              </div>
            </div>

            {/* Status pills */}
            <div className="flex flex-col gap-1 flex-1">
              <div className="flex items-center gap-1.5">
                {ev.complianceStatus === 'PASSED' ? (
                  <ShieldCheck className="w-3 h-3 text-emerald-500 dark:text-emerald-400 shrink-0" />
                ) : (
                  <ShieldX className="w-3 h-3 text-red-500 dark:text-red-400 shrink-0" />
                )}
                <span className={`text-[9px] font-medium font-mono ${
                  ev.complianceStatus === 'PASSED'
                    ? 'text-emerald-500 dark:text-emerald-400'
                    : 'text-red-500 dark:text-red-400'
                }`}>
                  Compliance {ev.complianceStatus}
                </span>
              </div>
              <div className="flex items-center gap-1.5 flex-wrap">
                <span className={`text-[8px] font-medium font-mono px-1.5 py-0.5 rounded ${riskLevelColor}`}>
                  {ev.riskLevel.toUpperCase()}
                </span>
                <span className="text-[8px] font-mono px-1.5 py-0.5 rounded bg-black/[0.03] dark:bg-white/[0.05] text-coda-text-muted">
                  {ev.recommendation}
                </span>
              </div>
            </div>
          </div>

          {/* Purpose + Memo */}
          {(ev.purpose || ev.memo) && (
            <div className="px-3 pb-2 flex flex-col gap-0.5">
              {ev.purpose && (
                <span className="text-[9px] font-mono text-coda-text-muted">
                  <span className="text-coda-text-muted">Purpose:</span> {ev.purpose}
                </span>
              )}
              {ev.memo && (
                <span className="text-[9px] font-mono text-coda-text-muted truncate">
                  <span className="text-coda-text-muted">Memo:</span> {ev.memo}
                </span>
              )}
            </div>
          )}

          {/* Question / Action prompt */}
          {ev.question && (
            <div className="px-3 py-2 border-t border-coda-border-subtle/50 bg-black/[0.01] dark:bg-white/[0.01]">
              <span className="text-[10px] font-medium text-coda-text-secondary">
                {ev.question}
              </span>
            </div>
          )}

          {/* Expand full text */}
          <button
            onClick={() => setExpanded(!expanded)}
            className="w-full px-3 py-1.5 flex items-center justify-center gap-1 text-[9px] text-coda-text-muted hover:text-coda-text-secondary transition-colors border-t border-coda-border-subtle/50"
          >
            <span className="font-mono">{expanded ? 'Hide' : 'Show'} full reasoning</span>
            <ChevronDown className={`w-2.5 h-2.5 transition-transform ${expanded ? 'rotate-180' : ''}`} />
          </button>

          {expanded && (
            <div className="px-3 pb-3 border-t border-coda-border-subtle/50">
              <p className="text-[10px] text-coda-text-muted leading-relaxed font-mono mt-2 whitespace-pre-wrap">
                {fullText}
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ============================================================
// Treasury Cycle Card — compact summary for pipeline context
// ============================================================

// ============================================================
// Treasury Cycle Context Parser
// Extracts structured data from autonomous treasury cycle prompts
// ============================================================

interface ParsedTreasuryCycle {
  cycleNumber: string;
  bankName: string;
  balance: string;
  marketConditions: string;
  counterparties: string[];
}

function parseTreasuryCycleContext(text: string): ParsedTreasuryCycle | null {
  const cycleMatch = text.match(/={2,}\s*TREASURY CYCLE\s*(\d+|[A-Z]+)\s*[-–—]+\s*AUTONOMOUS EVALUATION\s*={2,}/i);
  if (!cycleMatch) return null;

  const cycleNumber = cycleMatch[1] || '?';

  // Bank name: "YOUR CURRENT POSITION (JPM -- JPMorgan Chase):" pattern
  const bankMatch = text.match(/POSITION\s*\((\w+)\s*[-–—]+\s*([^)]+)\)/i);
  const bankName = bankMatch ? `${bankMatch[2]?.trim()?.slice(0, 35)}` : '';

  // Balance — already in human-readable units in the prompt (NOT raw 6-decimal)
  // e.g. "Balance: 8,906,263 tokens" means $8,906,263
  const balanceMatch = text.match(/Balance[:\s]*([0-9,]+(?:\.\d+)?)\s*tokens/i);
  const balanceHuman = balanceMatch ? parseFloat(balanceMatch[1].replace(/,/g, '')) : null;
  const balance = balanceHuman != null
    ? `$${balanceHuman.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`
    : '';

  // Market conditions
  const marketMatch = text.match(/MARKET CONDITIONS[:\s]*([^.]+)/i);
  const marketConditions = marketMatch?.[1]?.trim()?.slice(0, 120) || '';

  // Active counterparties — extract short codes from parentheses or names
  const counterSection = text.match(/ACTIVE COUNTERPARTIES\s*[-–—:]?\s*([\s\S]*?)(?:INSTRUCTIONS|Evaluate\s+mandates|RECENT\s+ACTIVITY|History|$)/i);
  const counterparties: string[] = [];
  if (counterSection) {
    // Match patterns like "Bank Name (CODE)" or standalone short codes
    const codeMatches = counterSection[1].matchAll(/\((\w{2,6})\)/g);
    for (const m of codeMatches) {
      if (!counterparties.includes(m[1])) counterparties.push(m[1]);
    }
    // Fallback: split by separators and grab short-ish tokens
    if (counterparties.length === 0) {
      const parts = counterSection[1].split(/[|,\n]/).map(s => s.trim()).filter(Boolean);
      for (const p of parts) {
        const word = p.split(/\s+/)[0];
        if (word && word.length >= 2 && word.length <= 10 && /^[A-Z]/.test(word)) {
          counterparties.push(word);
        }
      }
    }
  }

  return { cycleNumber, bankName, balance, marketConditions, counterparties: counterparties.slice(0, 6) };
}

/** Strip LLM-only instructions from the raw prompt for human-readable display */
function sanitizePromptForHuman(text: string): string {
  const linesToStrip = [
    /^={2,}\s*TREASURY CYCLE.*={2,}\s*$/im,
    /^You are operating in AUTONOMOUS mode\..*$/im,
    /^Evaluate your standing treasury mandates and decide whether to initiate a settlement\.?\s*$/im,
    /^No human operator is present\.?\s*$/im,
    /^INSTRUCTIONS:\s*$/im,
    /^\d+\.\s+Evaluate mandates in priority order.*$/im,
    /^\d+\.\s+If a mandate's conditions are met, initiate ONE transfer.*$/im,
    /^\d+\.\s+Choose an amount within the mandate's min\/max range.*$/im,
    /^\d+\.\s+Select your counterparty from the ACTIVE COUNTERPARTIES list.*$/im,
    /^\d+\.\s+If NO conditions are met, respond with action.*$/im,
    /^\d+\.\s+ONE action per cycle maximum.*$/im,
    /^\d+\.\s+Consider recent activity to avoid redundant.*$/im,
    /^\d+\.\s+If liquidity_stress is true.*$/im,
    /^\d+\.\s+Safety floor:.*$/im,
    /^NO_ACTION should be the exception.*$/im,
    /^If a mandate's conditions are even loosely met.*$/im,
    /^A cycle where every bank returns NO_ACTION.*$/im,
    /^If no suitable counterparty exists.*$/im,
    /^In a healthy interbank settlement network.*$/im,
    /^There are currently \d+ banks on the Solstice Network\.?\s*$/im,
    /^NETWORK ACTIVITY EXPECTATIONS:\s*$/im,
    /^Choose your counterparty dynamically from the active banks below\..*$/im,
    /^COUNTERPARTY SELECTION:\s*$/im,
    /^-\s+The market event:.*$/im,
    /^-\s+Your mandate parameters and your current balance.*$/im,
    /^-\s+Network diversity.*$/im,
    /^-\s+Counterparty balance and deployment levels.*$/im,
    /^\s*\(e\.g\., if they're over-deployed.*$/im,
  ];

  let cleaned = text;
  for (const re of linesToStrip) {
    cleaned = cleaned.replace(re, '');
  }
  // Collapse runs of 3+ blank lines into 2
  cleaned = cleaned.replace(/\n{3,}/g, '\n\n').trim();
  return cleaned;
}

function TreasuryCycleCard({ parsed, ts, fullText }: {
  parsed: ParsedTreasuryCycle;
  ts: number;
  fullText: string;
}) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="flex items-start gap-2.5 py-2 px-4">
      <div className="w-6 h-6 rounded-lg bg-violet-500/8 border border-violet-500/20 flex items-center justify-center shrink-0 mt-0.5">
        <span className="text-[8px] font-bold font-mono text-violet-500 dark:text-violet-400">TC</span>
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-1.5">
          <span className="text-[10px] font-semibold text-coda-text-secondary">Mandate Evaluation</span>
          <span className="text-[7px] font-bold font-mono px-1.5 py-0.5 rounded bg-violet-500/10 text-violet-500 dark:text-violet-400 uppercase tracking-wider">
            Cycle #{parsed.cycleNumber}
          </span>
          <span className="text-[7px] font-bold font-mono px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-600 dark:text-amber-400 uppercase tracking-wider">
            AUTO
          </span>
          <FeedTimestamp ts={ts} />
        </div>

        <div className="rounded-xl border border-coda-border-subtle bg-black/[0.02] dark:bg-white/[0.02] overflow-hidden">
          {/* Bank + Balance check */}
          <div className="px-3 py-2.5 flex items-center gap-2 border-b border-coda-border-subtle/50">
            {parsed.bankName && (
              <span className="text-[11px] font-medium text-coda-text truncate">{parsed.bankName}</span>
            )}
            {parsed.balance && (
              <div className="ml-auto flex items-center gap-1.5 shrink-0">
                <span className="text-[8px] text-coda-text-muted font-mono uppercase">bal</span>
                <span className="text-[13px] font-semibold font-mono text-coda-text tracking-tight">
                  {parsed.balance}
                </span>
              </div>
            )}
          </div>

          {/* What this is — a short explainer */}
          <div className="px-3 py-1.5 border-b border-coda-border-subtle/30 bg-violet-500/[0.02]">
            <span className="text-[9px] text-coda-text-muted italic">
              Autonomous check — evaluating standing mandates against current market conditions
            </span>
          </div>

          {/* Details */}
          <div className="px-3 py-2 space-y-1.5">
            {parsed.marketConditions && (
              <div className="flex items-start gap-1.5">
                <span className="text-[8px] text-coda-text-muted font-mono shrink-0 mt-[1px]">MKT</span>
                <span className="text-[10px] text-coda-text-muted leading-snug line-clamp-2">{parsed.marketConditions}</span>
              </div>
            )}
            {parsed.counterparties.length > 0 && (
              <div className="flex items-center gap-1.5 flex-wrap">
                <span className="text-[8px] text-coda-text-muted font-mono shrink-0">CPT</span>
                {parsed.counterparties.map((cp) => (
                  <span
                    key={cp}
                    className="text-[8px] font-bold font-mono px-1.5 py-0.5 rounded bg-black/[0.04] dark:bg-white/[0.06] text-coda-text-secondary"
                  >
                    {cp}
                  </span>
                ))}
              </div>
            )}
          </div>

          {/* Expand */}
          <button
            onClick={() => setExpanded(!expanded)}
            className="w-full px-3 py-1.5 flex items-center justify-center gap-1 text-[9px] text-coda-text-muted hover:text-coda-text-secondary transition-colors border-t border-coda-border-subtle/50"
          >
            <span className="font-mono">{expanded ? 'Hide' : 'Show'} full context</span>
            <ChevronDown className={`w-2.5 h-2.5 transition-transform ${expanded ? 'rotate-180' : ''}`} />
          </button>

          {expanded && (
            <div className="px-3 pb-3 border-t border-coda-border-subtle/50">
              <p className="text-[10px] text-coda-text-muted leading-relaxed font-mono mt-2 whitespace-pre-wrap break-words">
                {sanitizePromptForHuman(fullText)}
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ============================================================
// Simple Markdown Renderer (inline)
// ============================================================

function MarkdownText({ text, className = '' }: { text: string; className?: string }) {
  const lines = text.split('\n');

  function renderInline(line: string, key: string): ReactNode {
    const parts: ReactNode[] = [];
    let remaining = line;
    let idx = 0;

    while (remaining.length > 0) {
      const boldMatch = remaining.match(/\*\*(.+?)\*\*/);
      const codeMatch = remaining.match(/`([^`]+)`/);
      const boldIdx = boldMatch?.index ?? Infinity;
      const codeIdx = codeMatch?.index ?? Infinity;

      if (boldIdx === Infinity && codeIdx === Infinity) {
        parts.push(<span key={`${key}-${idx++}`}>{remaining}</span>);
        break;
      }

      if (boldIdx <= codeIdx && boldMatch) {
        if (boldIdx > 0) parts.push(<span key={`${key}-${idx++}`}>{remaining.slice(0, boldIdx)}</span>);
        parts.push(<strong key={`${key}-${idx++}`} className="font-semibold text-coda-text">{boldMatch[1]}</strong>);
        remaining = remaining.slice(boldIdx + boldMatch[0].length);
      } else if (codeMatch) {
        if (codeIdx > 0) parts.push(<span key={`${key}-${idx++}`}>{remaining.slice(0, codeIdx)}</span>);
        parts.push(
          <code key={`${key}-${idx++}`} className="px-1 py-0.5 rounded bg-coda-surface-hover/40 text-[10px] font-mono text-coda-text-secondary">
            {codeMatch[1]}
          </code>
        );
        remaining = remaining.slice(codeIdx + codeMatch[0].length);
      }
    }
    return <>{parts}</>;
  }

  const blocks: ReactNode[] = [];
  let currentBullets: { text: string; i: number }[] = [];
  let blockIdx = 0;

  function flushBullets() {
    if (currentBullets.length === 0) return;
    blocks.push(
      <ul key={`block-${blockIdx++}`} className="list-none space-y-0.5 my-1">
        {currentBullets.map(({ text: t, i }) => (
          <li key={`li-${i}`} className="flex items-start gap-1.5">
            <span className="text-coda-text-muted mt-[2px] shrink-0 text-[10px]">•</span>
            <span>{renderInline(t, `li-${i}`)}</span>
          </li>
        ))}
      </ul>
    );
    currentBullets = [];
  }

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (!trimmed) { flushBullets(); continue; }
    const bullet = trimmed.match(/^[*\-]\s+(.+)/) || trimmed.match(/^\d+\.\s+(.+)/);
    if (bullet) { currentBullets.push({ text: bullet[1], i }); continue; }
    flushBullets();
    blocks.push(<p key={`block-${blockIdx++}`} className="my-0.5">{renderInline(trimmed, `p-${i}`)}</p>);
  }
  flushBullets();

  return <div className={className}>{blocks}</div>;
}

// ============================================================
// Auto-generated message detection
// Pipeline-generated inputs saved as role "user" in the DB
// should be displayed as system messages, not "You"
// ============================================================

const AUTO_GENERATED_PATTERNS = [
  /^An incoming payment request has been processed/i,
  /^INCOMING MESSAGE regarding transaction/i,
  /^Processing pending/i,
  /^Maestro\s*[—–-]+\s*\w+\s+requests?\s+settlement/i,
  /^Treasury cycle evaluation/i,
  /^CYCLE \d+.*ACTIVE COUNTERPARTIES/i,
  /^AUTONOMOUS TREASURY/i,
  /compliance.*\(PASSED\).*risk\s+scor/i,
  /^={2,}\s*TREASURY CYCLE/i,
];

function isAutoGeneratedInput(content: string): boolean {
  return AUTO_GENERATED_PATTERNS.some(p => p.test(content));
}

// ============================================================
// Build unified feed from all sources
// ============================================================

export function buildCommsFeed(
  chatMessages: ChatMessage[],
  pipelines: Map<string, TransactionPipeline>,
  agentMessages: AgentMessage[],
): CommsFeedItem[] {
  const items: CommsFeedItem[] = [];
  const seenIds = new Set<string>();

  // 1. Chat messages (user, agent, system, counterparty)
  for (const msg of chatMessages) {
    if (seenIds.has(msg.id)) continue;
    seenIds.add(msg.id);

    let type: CommsFeedItem['type'];
    if (msg.role === 'user') {
      type = isAutoGeneratedInput(msg.content) ? 'system' : 'user';
    } else if (msg.role === 'counterparty') {
      type = 'counterparty';
    } else if (msg.role === 'system') {
      type = 'system';
    } else {
      type = 'agent';
    }

    items.push({
      id: msg.id,
      ts: new Date(msg.timestamp).getTime(),
      type,
      content: msg.content,
      error: msg.error,
      agentData: msg.agentData,
      transactionId: msg.transactionId,
      from: msg.role === 'counterparty' ? msg.counterpartyCode : undefined,
    });
  }

  // 2. Inter-agent communications from all active pipelines
  for (const [txId, pipeline] of pipelines) {
    const relatedMsgs = agentMessages.filter(m => m.transaction_id === txId);
    const feedItems = buildFeedItems(pipeline, relatedMsgs);

    for (const fi of feedItems) {
      const id = `comms-${txId.slice(0, 6)}-${fi.id}`;
      if (seenIds.has(id)) continue;
      seenIds.add(id);

      items.push({
        id,
        ts: fi.ts,
        type: 'agent-comms',
        content: fi.text,
        detail: fi.detail,
        from: fi.from,
        to: fi.to,
        status: fi.status,
        transactionId: txId,
      });
    }
  }

  // 3. Settlement confirmation cards
  for (const msg of agentMessages) {
    if (msg.message_type !== 'settlement_confirm' || !msg.transaction_id) continue;
    const cardId = `settle-card-${msg.id}`;
    if (seenIds.has(cardId)) continue;
    seenIds.add(cardId);

    const content = (msg.content || {}) as Record<string, unknown>;
    const txId = msg.transaction_id;

    const siblings = agentMessages.filter(m => m.transaction_id === txId);
    const riskMsg = siblings.find(m => m.message_type === 'risk_alert');
    const riskContent = (riskMsg?.content || {}) as Record<string, unknown>;

    const paymentReq = siblings.find(m => m.message_type === 'payment_request');
    const reqNl = paymentReq?.natural_language || '';
    const routeFromNl = reqNl.match(/(\w{2,6})\s+requests?\s+settlement\s+of\s+\$[\d,]+(?:\.\d+)?\s+to\s+(\w{2,6})/i);

    const riskNl = riskMsg?.natural_language || '';
    const routeFromRisk = riskNl.match(/for\s+(\w{2,6})[→>]\s*(\w{2,6})/i)
      || riskNl.match(/for\s+(\w{2,6})\s*-\s*(\w{2,6})/i);

    const senderCode = routeFromNl?.[1] || routeFromRisk?.[1] || '???';
    const receiverCode = routeFromNl?.[2] || routeFromRisk?.[2] || '???';

    const amountDisplay = content.amount_display as number | undefined;
    const amountStr = amountDisplay != null
      ? `$${Number(amountDisplay).toLocaleString()}`
      : '';
    const txSig = (content.tx_signature as string) || '';
    const finalStatus = (content.action as string) || 'settled';
    const complianceStatus: 'PASSED' | 'FAILED' = 'PASSED';
    const riskScore = (riskContent.composite_score as number) || undefined;
    const riskLevel = (riskContent.risk_level as string) || undefined;

    items.push({
      id: cardId,
      ts: new Date(msg.created_at).getTime() + 500,
      type: 'settlement-card',
      content: msg.natural_language || 'Settlement confirmed',
      transactionId: txId,
      settlementData: {
        senderCode,
        receiverCode,
        amount: amountStr,
        txSignature: txSig,
        riskScore,
        riskLevel,
        complianceStatus,
        finalStatus,
      },
    });
  }

  items.sort((a, b) => a.ts - b.ts);
  return items;
}

// ============================================================
// Feed Item Components — clean, uniform color usage
// ============================================================

function FeedTimestamp({ ts }: { ts: number }) {
  return (
    <span className="text-[8px] text-black/40 dark:text-white/40 font-mono tabular-nums shrink-0">
      {new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
    </span>
  );
}

function TxBadge({ txId }: { txId?: string | null }) {
  if (!txId) return null;
  return (
    <span className="text-[7px] px-1 py-0 rounded bg-coda-surface-hover/30 text-black/35 dark:text-white/40 font-mono">
      {txId.slice(0, 6)}
    </span>
  );
}

function UserMessage({ item }: { item: CommsFeedItem }) {
  return (
    <div className="flex items-start gap-2.5 py-2.5 px-4">
      <div className="w-6 h-6 rounded-lg bg-blue-500/10 flex items-center justify-center shrink-0 mt-0.5">
        <User className="w-3.5 h-3.5 text-blue-500" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-0.5">
          <span className="text-[10px] font-semibold text-blue-500">You</span>
          <FeedTimestamp ts={item.ts} />
        </div>
        <p className="text-[12px] text-coda-text leading-snug">{item.content}</p>
      </div>
    </div>
  );
}

function AgentResponse({ item }: { item: CommsFeedItem }) {
  const parsed = useMemo(() => parsePaymentEvaluation(item.content), [item.content]);

  if (parsed) {
    return (
      <PaymentEvaluationCard
        eval={parsed}
        ts={item.ts}
        txId={item.transactionId}
        fullText={item.content}
      />
    );
  }

  return (
    <div className="flex items-start gap-2.5 py-2.5 px-4">
      <div className="w-6 h-6 rounded-lg bg-black/[0.03] dark:bg-white/[0.06] border border-coda-border-subtle flex items-center justify-center shrink-0 mt-0.5">
        <span className="text-[8px] font-bold font-mono text-coda-text-muted">Ma</span>
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-0.5">
          <span className="text-[10px] font-semibold text-coda-text-secondary">Maestro</span>
          <TxBadge txId={item.transactionId} />
          <FeedTimestamp ts={item.ts} />
        </div>
        <MarkdownText
          text={item.content}
          className="text-[12px] text-coda-text-secondary leading-relaxed"
        />
        {item.error && (
          <div className="mt-1.5 flex items-center gap-1.5 text-[10px] text-red-500 dark:text-red-400">
            <AlertCircle className="w-3 h-3 shrink-0" />
            <span className="font-mono truncate">{item.error}</span>
          </div>
        )}
      </div>
    </div>
  );
}

function SystemMessage({ item }: { item: CommsFeedItem }) {
  const isLong = item.content.length > 120;

  // Try to parse as evaluation card
  const parsed = useMemo(() => isLong ? parsePaymentEvaluation(item.content) : null, [item.content, isLong]);
  if (parsed) {
    return (
      <PaymentEvaluationCard
        eval={parsed}
        ts={item.ts}
        txId={item.transactionId}
        fullText={item.content}
      />
    );
  }

  // Try to parse as treasury cycle context card
  const treasuryCycle = useMemo(() => isLong ? parseTreasuryCycleContext(item.content) : null, [item.content, isLong]);
  if (treasuryCycle) {
    return (
      <TreasuryCycleCard
        parsed={treasuryCycle}
        ts={item.ts}
        fullText={item.content}
      />
    );
  }

  // Long system messages: truncated divider
  if (isLong) {
    return (
      <div className="flex items-center gap-2 py-1.5 px-4">
        <div className="h-px flex-1 bg-coda-border/10" />
        <span className="text-[9px] text-black/40 dark:text-white/45 font-mono shrink-0 flex items-center gap-1.5 max-w-[80%] truncate">
          <TxBadge txId={item.transactionId} />
          {item.content.slice(0, 80)}…
        </span>
        <div className="h-px flex-1 bg-coda-border/10" />
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2 py-1.5 px-4">
      <div className="h-px flex-1 bg-coda-border/10" />
      <span className="text-[9px] text-black/40 dark:text-white/45 font-mono shrink-0 flex items-center gap-1.5">
        <TxBadge txId={item.transactionId} />
        {item.content}
      </span>
      <div className="h-px flex-1 bg-coda-border/10" />
    </div>
  );
}

function CounterpartyMessage({ item }: { item: CommsFeedItem }) {
  return (
    <div className="flex items-start gap-2.5 py-2.5 px-4">
      <div className="w-6 h-6 rounded-lg bg-black/[0.03] dark:bg-white/[0.06] border border-coda-border-subtle flex items-center justify-center shrink-0 mt-0.5">
        <ArrowRightLeft className="w-3 h-3 text-coda-text-muted" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-0.5">
          <span className="text-[10px] font-semibold text-coda-text-secondary">
            {item.from || 'Counterparty'}
          </span>
          <span className="text-[7px] px-1 py-0 rounded bg-black/[0.04] dark:bg-white/[0.06] text-coda-text-muted font-mono tracking-wider border border-coda-border-subtle">
            INCOMING
          </span>
          <FeedTimestamp ts={item.ts} />
        </div>
        <p className="text-[12px] text-coda-text-secondary leading-snug">{item.content}</p>
      </div>
    </div>
  );
}

function AgentCommsRow({ item }: { item: CommsFeedItem }) {
  const fromMono = item.from ? AGENT_MONOGRAMS[item.from] : null;
  const toMono = item.to ? AGENT_MONOGRAMS[item.to] : null;
  const isActive = item.status === 'active';
  const isError = item.status === 'error';

  return (
    <div className={`flex items-start gap-2 py-[5px] px-4 group transition-colors duration-150 ${
      isActive ? 'bg-coda-brand/[0.03]' : ''
    }`}>
      <span className="text-[8px] text-black/30 dark:text-white/35 font-mono shrink-0 tabular-nums w-[52px] mt-[3px] group-hover:text-black/50 dark:group-hover:text-white/50 transition-colors">
        {new Date(item.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
      </span>

      <div className={`w-4 h-3.5 rounded flex items-center justify-center text-[6px] font-bold font-mono shrink-0 mt-[2px] border transition-all ${
        isActive
          ? 'bg-coda-brand/10 border-coda-brand/30 text-coda-brand'
          : 'bg-black/[0.02] dark:bg-white/[0.04] border-coda-border-subtle/50 text-coda-text-muted'
      }`}>
        {fromMono?.mono || '??'}
      </div>

      <div className="flex-1 min-w-0">
        <span className={`text-[10px] font-medium ${isActive ? 'text-coda-text' : 'text-coda-text-secondary'}`}>
          {fromMono?.name || 'Agent'}
        </span>
        {toMono && (
          <>
            <span className="text-[8px] text-coda-text-muted/50 mx-1">→</span>
            <span className="text-[10px] font-medium text-coda-text-secondary">
              {toMono.name}
            </span>
          </>
        )}
        {' '}<TxBadge txId={item.transactionId} />
        <p className={`text-[11px] leading-snug ${
          isError ? 'text-red-500 dark:text-red-400' : 'text-coda-text-muted'
        }`}>
          {item.content}
        </p>
        {item.detail && (
          <p className="text-[9px] text-black/35 dark:text-white/40 leading-snug truncate">{item.detail}</p>
        )}
      </div>

      {isActive && (
        <Loader2 className="w-3 h-3 text-coda-brand animate-spin shrink-0 mt-[3px]" />
      )}
      {isError && (
        <span className="text-[9px] text-red-500 dark:text-red-400 shrink-0 mt-[3px]">✗</span>
      )}
    </div>
  );
}

// ============================================================
// Settlement Confirmation Card
// ============================================================

function SettlementCard({ item }: { item: CommsFeedItem }) {
  const sd = item.settlementData;
  if (!sd) return null;

  const scoreColor = (sd.riskScore ?? 0) >= 70
    ? 'text-emerald-500 dark:text-emerald-400'
    : (sd.riskScore ?? 0) >= 40
      ? 'text-amber-500 dark:text-amber-400'
      : 'text-red-500 dark:text-red-400';

  const scoreBg = (sd.riskScore ?? 0) >= 70
    ? 'bg-emerald-500/8'
    : (sd.riskScore ?? 0) >= 40
      ? 'bg-amber-500/8'
      : 'bg-red-500/8';

  const riskLevelColor = sd.riskLevel === 'low'
    ? 'text-emerald-500 dark:text-emerald-400 bg-emerald-500/10'
    : sd.riskLevel === 'medium'
      ? 'text-amber-500 dark:text-amber-400 bg-amber-500/10'
      : 'text-red-500 dark:text-red-400 bg-red-500/10';

  const isSettled = sd.finalStatus === 'settled' || sd.finalStatus === 'locked';

  const explorerUrl = sd.txSignature
    ? `https://explorer.solana.com/tx/${sd.txSignature}?cluster=${import.meta.env.VITE_SOLANA_CLUSTER || 'devnet'}`
    : null;

  return (
    <div className="flex items-start gap-2.5 py-2.5 px-4">
      <div className="w-6 h-6 rounded-lg bg-coda-brand/10 border border-coda-brand/30 flex items-center justify-center shrink-0 mt-0.5">
        <CheckCircle2 className="w-3.5 h-3.5 text-coda-brand" />
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-1.5">
          <span className="text-[10px] font-semibold text-coda-brand">Settlement Confirmed</span>
          <TxBadge txId={item.transactionId} />
          <FeedTimestamp ts={item.ts} />
        </div>

        <div className="rounded-xl border border-coda-brand/20 bg-coda-brand/[0.03] dark:bg-coda-brand/[0.04] overflow-hidden">
          <div className="px-3 py-2.5 flex items-center gap-2 border-b border-coda-brand/10">
            <div className="flex items-center gap-1.5">
              <span className="text-[9px] font-bold font-mono px-1.5 py-0.5 rounded bg-black/[0.04] dark:bg-white/[0.06] text-coda-text-secondary">
                {sd.senderCode}
              </span>
              <span className="text-[10px] text-coda-text-muted">→</span>
              <span className="text-[9px] font-bold font-mono px-1.5 py-0.5 rounded bg-black/[0.04] dark:bg-white/[0.06] text-coda-text-secondary">
                {sd.receiverCode}
              </span>
            </div>
            <span className="text-[15px] font-semibold font-mono text-coda-text ml-auto tracking-tight">
              {sd.amount}
            </span>
            <span className={`text-[7px] font-bold font-mono px-1.5 py-0.5 rounded uppercase tracking-wider ${
              isSettled
                ? 'bg-emerald-500/15 text-emerald-500 dark:text-emerald-400'
                : 'bg-amber-500/15 text-amber-500 dark:text-amber-400'
            }`}>
              {sd.finalStatus}
            </span>
          </div>

          <div className="px-3 py-2 flex items-center gap-3">
            {sd.riskScore != null && (
              <div className={`flex items-center gap-1.5 px-2 py-1 rounded-lg ${scoreBg}`}>
                <span className={`text-[18px] font-bold font-mono leading-none ${scoreColor}`}>
                  {sd.riskScore}
                </span>
                <div className="flex flex-col">
                  <span className="text-[7px] uppercase tracking-wider text-coda-text-muted leading-tight">Risk</span>
                  <span className="text-[7px] uppercase tracking-wider text-coda-text-muted leading-tight">Score</span>
                </div>
              </div>
            )}
            <div className="flex flex-col gap-1 flex-1">
              <div className="flex items-center gap-1.5">
                <ShieldCheck className="w-3 h-3 text-emerald-500 dark:text-emerald-400 shrink-0" />
                <span className="text-[9px] font-medium font-mono text-emerald-500 dark:text-emerald-400">
                  Compliance {sd.complianceStatus || 'PASSED'}
                </span>
              </div>
              {sd.riskLevel && (
                <div className="flex items-center gap-1.5">
                  <span className={`text-[8px] font-medium font-mono px-1.5 py-0.5 rounded ${riskLevelColor}`}>
                    {sd.riskLevel.toUpperCase()}
                  </span>
                </div>
              )}
            </div>
          </div>

          {sd.txSignature && (
            <div className="px-3 py-2 border-t border-coda-brand/10 flex items-center gap-2">
              <span className="text-[8px] text-coda-text-muted font-mono shrink-0">Solana TX:</span>
              <span className="text-[9px] font-mono text-coda-text-muted truncate flex-1">
                {sd.txSignature.slice(0, 32)}...
              </span>
              {explorerUrl && (
                <a
                  href={explorerUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-coda-text-muted hover:text-coda-text-secondary transition-colors shrink-0"
                >
                  <ExternalLink className="w-3 h-3" />
                </a>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ============================================================
// Main CommsFeed Component
// ============================================================

export function CommsFeed({
  chatMessages,
  pipelines,
  agentMessages,
  thinkingActive,
  thinkingStep,
  thinkingElapsed,
}: {
  chatMessages: ChatMessage[];
  pipelines: Map<string, TransactionPipeline>;
  agentMessages: AgentMessage[];
  thinkingActive: boolean;
  thinkingStep: string;
  thinkingElapsed: number;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);

  const feedItems = useMemo(
    () => buildCommsFeed(chatMessages, pipelines, agentMessages),
    [chatMessages, pipelines, agentMessages],
  );

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [feedItems.length, thinkingActive]);

  return (
    <div ref={scrollRef} className="flex-1 overflow-y-auto scrollbar-thin">
      <AnimatePresence initial={false}>
        {feedItems.map(item => {
          const isCompact = item.type === 'agent-comms' || item.type === 'system';
          const isCard = item.type === 'settlement-card' || item.type === 'agent';

          const content = (() => {
            switch (item.type) {
              case 'user':
                return <UserMessage item={item} />;
              case 'agent':
                return <AgentResponse item={item} />;
              case 'system':
                return <SystemMessage item={item} />;
              case 'counterparty':
                return <CounterpartyMessage item={item} />;
              case 'agent-comms':
                return <AgentCommsRow item={item} />;
              case 'settlement-card':
                return <SettlementCard item={item} />;
              default:
                return null;
            }
          })();

          return (
            <motion.div
              key={item.id}
              initial={{ opacity: 0, y: isCard ? 12 : 6, scale: isCard ? 0.98 : 1 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              transition={{
                duration: isCompact ? 0.2 : 0.35,
                ease: [0.25, 0.46, 0.45, 0.94],
              }}
            >
              {content}
            </motion.div>
          );
        })}
      </AnimatePresence>

      {thinkingActive && (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -4 }}
          transition={{ duration: 0.3, ease: [0.25, 0.46, 0.45, 0.94] }}
        >
          <div className="flex items-start gap-2.5 py-2.5 px-4">
            <div className="w-6 h-6 rounded-lg bg-black/[0.03] dark:bg-white/[0.06] border border-coda-border-subtle flex items-center justify-center shrink-0 mt-0.5">
              <span className="text-[8px] font-bold font-mono text-coda-text-muted">Ma</span>
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1">
                <span className="text-[10px] font-semibold text-coda-text-secondary">Maestro</span>
                <span className="text-[8px] text-coda-text-muted font-mono tabular-nums">
                  {(thinkingElapsed / 1000).toFixed(1)}s
                </span>
              </div>
              <div className="flex items-center gap-1.5">
                <Loader2 className="w-3 h-3 text-coda-brand animate-spin" />
                <span className="text-[11px] font-mono text-coda-text-muted">{thinkingStep}</span>
              </div>
            </div>
          </div>
        </motion.div>
      )}

      {feedItems.length === 0 && !thinkingActive && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.5, delay: 0.2 }}
        >
          <div className="flex flex-col items-center justify-center h-full py-12 text-center opacity-30">
            <Bot className="w-8 h-8 text-coda-text-muted mb-3" />
            <span className="text-[11px] text-coda-text-muted font-mono">
              Agent communication feed
            </span>
            <span className="text-[10px] text-coda-text-muted/60 font-mono mt-0.5">
              Send a command to see agent activity
            </span>
          </div>
        </motion.div>
      )}
    </div>
  );
}