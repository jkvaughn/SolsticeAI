import { useState, useMemo } from 'react';
import {
  Bot, User, ChevronDown, ChevronRight, Brain,
  Send, CheckCircle2, XCircle,
  Copy, AlertTriangle, Info, Zap,
  ArrowDownLeft, Shield, Gauge, Link2,
  Hash, MessageSquareQuote, HelpCircle
} from 'lucide-react';

// ============================================================
// Types
// ============================================================

export interface ChatMessage {
  id: string;
  role: 'user' | 'agent' | 'system' | 'counterparty';
  content: string;
  timestamp: string;
  agentData?: {
    reasoning: string;
    action: string;
    params: Record<string, unknown>;
    messageToCounterparty: string | null;
  };
  transactionId?: string | null;
  error?: string;
  /** For counterparty messages */
  counterpartyCode?: string;
  counterpartyName?: string;
  counterpartyMessageType?: string;
}

// ============================================================
// Rich Message Component
// ============================================================

export function RichMessage({ message, onQuickAction }: { message: ChatMessage; onQuickAction?: (text: string) => void }) {
  if (message.role === 'user') return <UserMessage message={message} />;
  if (message.role === 'system') return <SystemMessage message={message} />;
  if (message.role === 'counterparty') return <CounterpartyMessage message={message} />;
  return <AgentMessage message={message} onQuickAction={onQuickAction} />;
}

// ============================================================
// User Message
// ============================================================

function UserMessage({ message }: { message: ChatMessage }) {
  return (
    <div className="flex gap-2 justify-end">
      <div className="max-w-[85%]">
        <div className="flex items-center gap-1.5 justify-end mb-1">
          <span className="text-[11px] text-coda-text-muted">
            {new Date(message.timestamp).toLocaleTimeString()}
          </span>
          <span className="text-[11px] font-medium text-blue-600 dark:text-blue-400">You</span>
        </div>
        <div className="px-3 py-2.5 rounded-xl rounded-tr-sm bg-blue-600/15 border border-blue-700/30 text-[13px] text-blue-900 dark:text-blue-100 leading-relaxed">
          {message.content}
        </div>
      </div>
      <div className="w-7 h-7 rounded-lg bg-blue-600/20 flex items-center justify-center shrink-0 mt-5">
        <User className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />
      </div>
    </div>
  );
}

// ============================================================
// System Message
// ============================================================

function SystemMessage({ message }: { message: ChatMessage }) {
  return (
    <div className="flex justify-center">
      <div className="px-3 py-1.5 rounded-full bg-coda-surface-hover/50 border border-coda-border/30 text-[11px] text-coda-text-muted flex items-center gap-1.5">
        <Info className="w-3 h-3" />
        {message.content}
      </div>
    </div>
  );
}

// ============================================================
// Structured Data Extraction
// ============================================================

interface ExtractedData {
  amounts: { value: string; raw: number }[];
  bankCodes: string[];
  bankNames: string[];
  compliance: { status: 'passed' | 'failed' | null; checks?: string };
  risk: { level: string | null; score: string | null; recommendation: string | null };
  purposeCode: string | null;
  solanaRef: string | null;
  direction: { from: string | null; to: string | null };
  txType: string | null;
}

const KNOWN_BANK_CODES = ['JPM', 'CITI', 'HSBC', 'BOA', 'GS', 'MS', 'WF', 'DB', 'BARC', 'BNP', 'UBS', 'CS', 'RBC', 'TD', 'SMBC'];
const KNOWN_BANK_NAMES = ['JPMorgan Chase', 'Citibank', 'HSBC', 'Bank of America', 'Goldman Sachs', 'Morgan Stanley', 'Wells Fargo', 'Deutsche Bank', 'Barclays', 'BNP Paribas', 'UBS', 'Credit Suisse', 'RBC', 'TD Bank', 'SMBC'];

function extractStructuredData(content: string, agentData?: ChatMessage['agentData']): ExtractedData {
  const data: ExtractedData = {
    amounts: [],
    bankCodes: [],
    bankNames: [],
    compliance: { status: null },
    risk: { level: null, score: null, recommendation: null },
    purposeCode: null,
    solanaRef: null,
    direction: { from: null, to: null },
    txType: null,
  };

  const amountMatches = content.match(/\$[\d,]+(?:\.\d{1,2})?/g);
  if (amountMatches) {
    const seen = new Set<string>();
    for (const m of amountMatches) {
      if (!seen.has(m)) {
        seen.add(m);
        data.amounts.push({ value: m, raw: parseFloat(m.replace(/[$,]/g, '')) });
      }
    }
  }

  for (const code of KNOWN_BANK_CODES) {
    const regex = new RegExp(`\\b${code}\\b`, 'g');
    if (regex.test(content)) data.bankCodes.push(code);
  }
  for (const name of KNOWN_BANK_NAMES) {
    if (content.includes(name)) data.bankNames.push(name);
  }

  if (/compliance.*(?:PASSED|passed|all passed)/i.test(content) || /\(PASSED\)/i.test(content)) {
    data.compliance.status = 'passed';
    const checkMatch = content.match(/(\d+)\/(\d+)\s*(?:checks?\s*)?passed/i) || content.match(/(\d+)\s*(?:compliance\s*)?checks?\s*(?:have\s*)?(?:all\s*)?passed/i);
    if (checkMatch) data.compliance.checks = checkMatch[0];
  } else if (/compliance.*(?:FAILED|failed)/i.test(content)) {
    data.compliance.status = 'failed';
  }

  const riskLevelMatch = content.match(/(?:risk\s*)?level[:\s]*(\w+)/i) || content.match(/scoring.*?level[:\s]*(\w+)/i);
  if (riskLevelMatch) data.risk.level = riskLevelMatch[1].toLowerCase();
  const riskScoreMatch = content.match(/score[:\s]*(\d+)\/(\d+)/i) || content.match(/score[:\s]*(\d+)/i);
  if (riskScoreMatch) data.risk.score = riskScoreMatch[0].replace(/^score[:\s]*/i, '');
  const recoMatch = content.match(/recommendation[:\s]*(immediate|delayed|deferred|hold|review)/i);
  if (recoMatch) data.risk.recommendation = recoMatch[1].toLowerCase();

  const purposeMatch = content.match(/purpose[:\s]*(?:code[:\s]*)?([\w_]+)/i);
  if (purposeMatch && purposeMatch[1] !== 'code') data.purposeCode = purposeMatch[1];

  if (/Token[- ]2022/i.test(content)) data.solanaRef = 'Token-2022';

  if (agentData?.params) {
    if (agentData.params.receiver_bank_code) data.direction.to = String(agentData.params.receiver_bank_code);
  }

  if (/settlement/i.test(content)) data.txType = 'Settlement';
  else if (/payment/i.test(content)) data.txType = 'Payment';
  else if (/transfer/i.test(content)) data.txType = 'Transfer';

  return data;
}

// ============================================================
// Inline Text Highlighter
// ============================================================

function HighlightedText({ text }: { text: string }) {
  const segments: { text: string; className?: string }[] = [];

  const combinedPattern = /(\$[\d,]+(?:\.\d{1,2})?|\b(?:JPM|CITI|HSBC|BOA|GS|MS|WF|DB|BARC|BNP|UBS|CS|RBC|TD|SMBC)\b|\b(?:PASSED|APPROVED|ACCEPTED|SETTLED|CONFIRMED|FINALIZED|FAILED|REJECTED|DENIED|REVERSED)\b|(?:JPMorgan Chase|Citibank|Goldman Sachs|Morgan Stanley|Wells Fargo|Deutsche Bank|Bank of America)|Tier\s*[12]|Token[- ]2022|Solana\s*Devnet)/gi;

  let lastIdx = 0;
  const matches = [...text.matchAll(combinedPattern)];

  for (const match of matches) {
    const matchStart = match.index!;
    const matchText = match[0];

    if (matchStart > lastIdx) {
      segments.push({ text: text.slice(lastIdx, matchStart) });
    }

    let cls = 'font-medium';
    if (/^\$/.test(matchText)) cls = 'text-emerald-400 font-medium';
    else if (/^(JPM|CITI|HSBC|BOA|GS|MS|WF|DB|BARC|BNP|UBS|CS|RBC|TD|SMBC)$/i.test(matchText)) cls = 'px-1 rounded bg-coda-brand/15 text-coda-brand text-[10px] font-medium';
    else if (/^(PASSED|APPROVED|ACCEPTED|SETTLED|CONFIRMED|FINALIZED)$/i.test(matchText)) cls = 'text-emerald-400 font-medium';
    else if (/^(FAILED|REJECTED|DENIED|REVERSED)$/i.test(matchText)) cls = 'text-red-400 font-medium';
    else if (/^(JPMorgan|Citibank|Goldman|Morgan Stanley|Wells Fargo|Deutsche|Bank of America)/i.test(matchText)) cls = 'text-coda-text font-medium';
    else if (/Tier/i.test(matchText)) cls = 'text-blue-500 dark:text-blue-400';
    else if (/Token/i.test(matchText)) cls = 'text-blue-500 dark:text-blue-400 font-medium';
    else if (/Solana/i.test(matchText)) cls = 'text-coda-brand';

    segments.push({ text: matchText, className: cls });
    lastIdx = matchStart + matchText.length;
  }

  if (lastIdx < text.length) {
    segments.push({ text: text.slice(lastIdx) });
  }

  if (segments.length === 0) return <>{text}</>;

  return (
    <>
      {segments.map((seg, i) =>
        seg.className ? (
          <span key={i} className={seg.className}>{seg.text}</span>
        ) : (
          <span key={i}>{seg.text}</span>
        )
      )}
    </>
  );
}

// ============================================================
// Data Summary Card — extracted metrics
// ============================================================

function DataSummaryCard({ data, agentData }: { data: ExtractedData; agentData?: ChatMessage['agentData'] }) {
  const hasAmount = data.amounts.length > 0;
  const hasCompliance = data.compliance.status !== null;
  const hasRisk = data.risk.level !== null || data.risk.score !== null;
  const hasBanks = data.bankNames.length > 0 || data.direction.to;
  const hasAny = hasAmount || hasCompliance || hasRisk || hasBanks;

  if (!hasAny) return null;

  // For initiate_payment, show a compact payment card
  if (agentData?.action === 'initiate_payment' && agentData.params) {
    return (
      <div className="mb-2 rounded-lg bg-coda-brand/[0.06] border border-coda-brand/30 overflow-hidden">
        <div className="px-3 py-1.5 border-b border-coda-brand/20 flex items-center gap-1.5">
          <Send className="w-3 h-3 text-coda-brand" />
          <span className="text-[10px] font-medium text-coda-brand uppercase tracking-wider">
            Payment Initiated
          </span>
        </div>
        <div className="px-3 py-2 grid grid-cols-3 gap-3">
          <div>
            <div className="text-[9px] text-coda-text-muted uppercase tracking-wider mb-0.5">Amount</div>
            <div className="text-[14px] font-medium text-coda-brand">
              {formatAmount(Number(agentData.params.amount || 0))}
            </div>
          </div>
          <div>
            <div className="text-[9px] text-coda-text-muted uppercase tracking-wider mb-0.5">Receiver</div>
            <div className="text-[13px] text-coda-text flex items-center gap-1">
              <span className="px-1.5 py-0.5 rounded bg-coda-brand/15 text-coda-brand text-[10px] font-medium">
                {String(agentData.params.receiver_bank_code || '—')}
              </span>
            </div>
          </div>
          <div>
            <div className="text-[9px] text-coda-text-muted uppercase tracking-wider mb-0.5">Purpose</div>
            <div className="text-[11px] text-coda-text-secondary">
              {String(agentData.params.purpose_code || 'OTHER').replace(/_/g, ' ')}
            </div>
          </div>
        </div>
        {agentData.params.memo && (
          <div className="px-3 pb-2">
            <div className="text-[9px] text-coda-text-muted uppercase tracking-wider mb-0.5">Memo</div>
            <div className="text-[11px] text-coda-text-secondary">{String(agentData.params.memo)}</div>
          </div>
        )}
      </div>
    );
  }

  // Generic data summary for other messages
  return (
    <div className="mb-2 grid grid-cols-2 sm:grid-cols-3 gap-1.5">
      {hasAmount && data.amounts.slice(0, 1).map((amt, i) => (
        <div key={i} className="px-2.5 py-1.5 rounded-lg bg-coda-brand/[0.06] border border-coda-brand/25">
          <div className="text-[9px] text-coda-text-muted uppercase tracking-wider">Amount</div>
          <div className="text-[14px] font-medium text-coda-brand">{amt.value}</div>
        </div>
      ))}
      {hasCompliance && (
        <div className={`px-2.5 py-1.5 rounded-lg border ${
          data.compliance.status === 'passed'
            ? 'bg-emerald-500/[0.06] border-emerald-800/25'
            : 'bg-red-500/[0.06] border-red-800/25'
        }`}>
          <div className="text-[9px] text-coda-text-muted uppercase tracking-wider">Compliance</div>
          <div className={`text-[12px] font-medium flex items-center gap-1 ${
            data.compliance.status === 'passed' ? 'text-emerald-400' : 'text-red-400'
          }`}>
            {data.compliance.status === 'passed' ? (
              <CheckCircle2 className="w-3 h-3" />
            ) : (
              <XCircle className="w-3 h-3" />
            )}
            {data.compliance.status === 'passed' ? 'Passed' : 'Failed'}
          </div>
          {data.compliance.checks && (
            <div className="text-[9px] text-coda-text-muted mt-0.5">{data.compliance.checks}</div>
          )}
        </div>
      )}
      {hasRisk && (
        <div className={`px-2.5 py-1.5 rounded-lg border ${
          data.risk.level === 'low' ? 'bg-emerald-500/[0.06] border-emerald-800/25' :
          data.risk.level === 'high' ? 'bg-red-500/[0.06] border-red-800/25' :
          'bg-amber-500/[0.06] border-amber-800/25'
        }`}>
          <div className="text-[9px] text-coda-text-muted uppercase tracking-wider">Risk</div>
          <div className={`text-[12px] font-medium ${
            data.risk.level === 'low' ? 'text-emerald-400' :
            data.risk.level === 'high' ? 'text-red-400' :
            'text-amber-400'
          }`}>
            {data.risk.level?.toUpperCase() || '—'}
            {data.risk.score && <span className="text-[10px] text-coda-text-muted ml-1">({data.risk.score})</span>}
          </div>
          {data.risk.recommendation && (
            <div className="text-[9px] text-coda-text-muted mt-0.5">{data.risk.recommendation}</div>
          )}
        </div>
      )}
    </div>
  );
}

// ============================================================
// Agent Message — Rich formatted with sections
// ============================================================

function AgentMessage({ message, onQuickAction }: { message: ChatMessage; onQuickAction?: (text: string) => void }) {
  const [showReasoning, setShowReasoning] = useState(false);
  const [showFullText, setShowFullText] = useState(false);
  const [copied, setCopied] = useState(false);
  const { agentData } = message;

  const copyContent = () => {
    const text = message.content;
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(() => setCopied(true));
    } else {
      const textarea = document.createElement('textarea');
      textarea.value = text;
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
      setCopied(true);
    }
    setTimeout(() => setCopied(false), 1500);
  };

  const actionConfig: Record<string, { label: string; color: string; bgColor: string; icon: React.ComponentType<{ className?: string }> }> = {
    initiate_payment: { label: 'Payment Initiated', color: 'text-coda-brand', bgColor: 'bg-coda-brand/15', icon: Send },
    accept_payment: { label: 'Payment Accepted', color: 'text-coda-brand', bgColor: 'bg-coda-brand/15', icon: CheckCircle2 },
    reject_payment: { label: 'Payment Rejected', color: 'text-red-400', bgColor: 'bg-red-500/15', icon: XCircle },
    check_status: { label: 'Status Check', color: 'text-blue-500 dark:text-blue-400', bgColor: 'bg-blue-500/15', icon: Info },
    provide_info: { label: 'Information', color: 'text-coda-brand', bgColor: 'bg-coda-brand/15', icon: Info },
    no_action: { label: 'Acknowledged', color: 'text-coda-text-secondary', bgColor: 'bg-coda-surface-hover', icon: CheckCircle2 },
  };

  const action = agentData?.action ? actionConfig[agentData.action] || { label: agentData.action, color: 'text-coda-text-secondary', bgColor: 'bg-coda-surface-hover', icon: Zap } : null;

  const extractedData = useMemo(
    () => extractStructuredData(message.content, agentData),
    [message.content, agentData]
  );

  const contentSections = useMemo(
    () => parseAgentContent(message.content),
    [message.content]
  );

  // Check if there is a decision callout — used to determine if we need action buttons at bottom
  const hasDecision = contentSections.some(s => s.type === 'callout' && s.variant === 'decision');

  // Don't collapse decision messages — they need the buttons visible
  const isLongContent = !hasDecision && (contentSections.length > 5 || message.content.length > 800);
  const visibleSections = isLongContent && !showFullText
    ? contentSections.slice(0, 4)
    : contentSections;
  const hiddenCount = isLongContent ? contentSections.length - 4 : 0;

  return (
    <div className="flex gap-2 justify-start">
      <div className="w-7 h-7 rounded-lg bg-coda-brand/20 flex items-center justify-center shrink-0 mt-5">
        <Bot className="w-3.5 h-3.5 text-coda-brand" />
      </div>
      <div className="max-w-[90%] min-w-[300px]">
        {/* Header */}
        <div className="flex items-center gap-2 mb-1">
          <span className="text-[11px] font-medium text-coda-brand">Maestro</span>
          {action && (
            <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium ${action.color} ${action.bgColor}`}>
              <action.icon className="w-2.5 h-2.5" />
              {action.label}
            </span>
          )}
          <span className="text-[10px] text-coda-text-muted">
            {new Date(message.timestamp).toLocaleTimeString()}
          </span>
        </div>

        {/* Main content card */}
        <div className="rounded-xl rounded-tl-sm bg-coda-surface-alt/40 border border-coda-border/30 overflow-hidden">
          {/* Error state */}
          {message.error && (
            <div className="px-3 py-2 bg-red-950/30 border-b border-red-800/30 flex items-start gap-2">
              <AlertTriangle className="w-3.5 h-3.5 text-red-400 shrink-0 mt-0.5" />
              <span className="text-[12px] text-red-500 dark:text-red-300">{message.error}</span>
            </div>
          )}

          {/* Data Summary Card — extracted metrics */}
          <div className="px-3 pt-2.5">
            <DataSummaryCard data={extractedData} agentData={agentData} />
          </div>

          {/* Content — rendered with structure + highlighting */}
          <div className="px-3 pb-2">
            {visibleSections.map((section, idx) => (
              <ContentSection key={idx} section={section} onQuickAction={onQuickAction} />
            ))}
            {isLongContent && !showFullText && hiddenCount > 0 && (
              <button
                onClick={() => setShowFullText(true)}
                className="mt-1 flex items-center text-[10px] text-blue-500 dark:text-blue-400"
              >
                <ChevronDown className="w-3 h-3" />
                <span>Show {hiddenCount} more section{hiddenCount > 1 ? 's' : ''}</span>
              </button>
            )}
            {isLongContent && showFullText && (
              <button
                onClick={() => setShowFullText(false)}
                className="mt-1 flex items-center text-[10px] text-coda-text-muted"
              >
                <ChevronDown className="w-3 h-3 rotate-180" />
                <span>Show less</span>
              </button>
            )}
          </div>

          {/* Reasoning (collapsible) */}
          {agentData?.reasoning && agentData.reasoning !== message.content && (
            <div className="border-t border-coda-border/30">
              <button
                onClick={() => setShowReasoning(!showReasoning)}
                className="w-full px-3 py-1.5 flex items-center gap-2 text-[10px] text-coda-text-muted hover:bg-black/[0.02] dark:hover:bg-white/[0.02] transition-colors cursor-pointer"
              >
                <Brain className="w-3 h-3" />
                <span>Internal Reasoning</span>
                {showReasoning ? <ChevronDown className="w-3 h-3 ml-auto" /> : <ChevronRight className="w-3 h-3 ml-auto" />}
              </button>
              {showReasoning && (
                <div className="px-3 pb-2 border-l-2 border-coda-border ml-3 pl-2">
                  <ReasoningContent text={agentData.reasoning} />
                </div>
              )}
            </div>
          )}

          {/* Transaction ID + Actions bar */}
          <div className="px-3 py-1.5 border-t border-coda-border/30 flex items-center gap-2">
            {message.transactionId && (
              <span className="text-[9px] text-coda-text-muted flex items-center gap-1">
                <Hash className="w-2.5 h-2.5" />
                {message.transactionId.slice(0, 8)}...
              </span>
            )}
            {extractedData.solanaRef && (
              <span className="text-[9px] px-1.5 py-0.5 rounded bg-coda-brand/10 text-coda-brand">
                {extractedData.solanaRef}
              </span>
            )}
            {extractedData.txType && !action && (
              <span className="text-[9px] px-1.5 py-0.5 rounded bg-coda-surface-hover text-coda-text-muted">
                {extractedData.txType}
              </span>
            )}
            <div className="ml-auto flex items-center gap-1">
              <button
                onClick={copyContent}
                className="p-1"
                title="Copy response"
              >
                {copied ? (
                  <CheckCircle2 className="w-3 h-3 text-coda-brand" />
                ) : (
                  <Copy className="w-3 h-3 text-coda-text-muted hover:text-coda-text-secondary" />
                )}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ============================================================
// Counterparty Message
// ============================================================

const COUNTERPARTY_MSG_CONFIG: Record<string, { label: string; icon: React.ComponentType<{ className?: string }>; color: string; bgColor: string }> = {
  payment_accept: { label: 'Accepted', icon: CheckCircle2, color: 'text-emerald-400', bgColor: 'bg-emerald-500/15' },
  payment_reject: { label: 'Rejected', icon: XCircle, color: 'text-red-400', bgColor: 'bg-red-500/15' },
  settlement_confirm: { label: 'Settled', icon: Link2, color: 'text-emerald-400', bgColor: 'bg-emerald-500/15' },
  compliance_result: { label: 'Compliance', icon: Shield, color: 'text-blue-500 dark:text-blue-400', bgColor: 'bg-blue-500/15' },
  risk_assessment: { label: 'Risk Scored', icon: Gauge, color: 'text-amber-400', bgColor: 'bg-amber-500/15' },
  payment_request: { label: 'Request Sent', icon: Send, color: 'text-coda-brand', bgColor: 'bg-coda-brand/15' },
};

function CounterpartyMessage({ message }: { message: ChatMessage }) {
  const [expanded, setExpanded] = useState(false);
  const code = message.counterpartyCode || '???';
  const msgType = message.counterpartyMessageType || '';
  const config = COUNTERPARTY_MSG_CONFIG[msgType] || { label: msgType.replace(/_/g, ' '), icon: ArrowDownLeft, color: 'text-coda-brand', bgColor: 'bg-coda-brand/15' };
  const IconComp = config.icon;

  const displayContent = message.content.replace(/^Maestro\s*[—\-]\s*/i, '').trim();
  const summary = extractSummary(displayContent);
  const hasMore = displayContent.length > summary.length;

  const extractedData = useMemo(
    () => extractStructuredData(displayContent),
    [displayContent]
  );

  return (
    <div className="flex gap-2 justify-start">
      <div className="w-7 h-7 rounded-lg bg-coda-brand/20 flex items-center justify-center shrink-0 mt-5">
        <Bot className="w-3.5 h-3.5 text-coda-brand" />
      </div>

      <div className="max-w-[85%] min-w-[240px]">
        <div className="flex items-center gap-1.5 mb-1">
          <span className="px-1.5 py-0.5 bg-coda-brand/20 text-coda-brand rounded text-[10px] font-medium">{code}</span>
          <span className="text-[11px] font-medium text-coda-brand">Maestro</span>
          <span className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] font-medium ${config.color} ${config.bgColor}`}>
            <IconComp className="w-2.5 h-2.5" />
            {config.label}
          </span>
          <span className="text-[10px] text-coda-text-muted">
            {new Date(message.timestamp).toLocaleTimeString()}
          </span>
        </div>

        <div className="rounded-xl rounded-tl-sm border border-coda-brand/20 bg-coda-brand/[0.04] overflow-hidden">
          {(extractedData.amounts.length > 0 || extractedData.compliance.status) && (
            <div className="px-3 py-1.5 border-b border-coda-brand/10 flex items-center gap-1.5 flex-wrap">
              {extractedData.amounts.slice(0, 1).map((amt, i) => (
                <span key={i} className="px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-400 text-[10px] font-medium">{amt.value}</span>
              ))}
              {extractedData.compliance.status && (
                <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${
                  extractedData.compliance.status === 'passed' ? 'bg-emerald-500/10 text-emerald-400' : 'bg-red-500/10 text-red-400'
                }`}>Compliance {extractedData.compliance.status === 'passed' ? 'Passed' : 'Failed'}</span>
              )}
              {extractedData.risk.level && (
                <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${
                  extractedData.risk.level === 'low' ? 'bg-emerald-500/10 text-emerald-400' :
                  extractedData.risk.level === 'high' ? 'bg-red-500/10 text-red-400' :
                  'bg-amber-500/10 text-amber-400'
                }`}>Risk: {extractedData.risk.level}</span>
              )}
              {extractedData.solanaRef && (
                <span className="px-1.5 py-0.5 rounded bg-coda-brand/10 text-coda-brand text-[10px]">{extractedData.solanaRef}</span>
              )}
            </div>
          )}

          <div className="flex">
            <div className="w-0.5 bg-coda-brand/40 shrink-0" />
            <div className="flex-1 px-3 py-2">
              <p className="text-[12px] text-coda-text-secondary leading-relaxed">
                <HighlightedText text={expanded || !hasMore ? displayContent : summary} />
              </p>
              {hasMore && (
                <button
                  onClick={() => setExpanded(!expanded)}
                  className="mt-1 text-[10px] text-coda-brand flex items-center"
                >
                  {expanded ? (
                    <><ChevronDown className="w-3 h-3 rotate-180" /> <span>Show less</span></>
                  ) : (
                    <><ChevronDown className="w-3 h-3" /> <span>Show full message</span></>
                  )}
                </button>
              )}
            </div>
          </div>

          {message.transactionId && (
            <div className="px-3 py-1 border-t border-coda-brand/10 flex items-center gap-2">
              <Hash className="w-2.5 h-2.5 text-coda-brand/50" />
              <span className="text-[9px] text-coda-text-muted">{message.transactionId.slice(0, 8)}...</span>
              <span className="text-[9px] text-coda-brand/40 ml-auto">counterparty</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ============================================================
// Content Parsing
// ============================================================

interface ContentPart {
  type: 'paragraph' | 'bullet' | 'numbered' | 'header' | 'divider' | 'quote' | 'callout';
  text: string;
  items?: string[];
  label?: string;
  variant?: 'info' | 'warning' | 'decision' | 'quote';
}

// Semantic markers — ordered by specificity (most specific first)
// NOTE: "should you ACCEPT or REJECT" is removed as a standalone marker because
// it always appears inside the "Based on your bank's policies" section.
const SECTION_MARKERS: { pattern: RegExp; label: string; type: ContentPart['type']; variant?: ContentPart['variant'] }[] = [
  { pattern: /Original\s+request\s*:\s*/i, label: 'Original Request', type: 'quote', variant: 'quote' },
  { pattern: /Original\s+message\s*:\s*/i, label: 'Original Message', type: 'quote', variant: 'quote' },
  { pattern: /Risk\s+reasoning\s*:\s*/i, label: 'Risk Analysis', type: 'callout', variant: 'info' },
  { pattern: /Risk\s+assessment\s*:\s*/i, label: 'Risk Assessment', type: 'callout', variant: 'info' },
  { pattern: /(?:His|Her|Their|The agent'?s?)\s+reasoning\s*:\s*/i, label: 'Agent Reasoning', type: 'callout', variant: 'info' },
  { pattern: /Reasoning\s*:\s*/i, label: 'Reasoning', type: 'callout', variant: 'info' },
  { pattern: /Based\s+on\s+your\s+bank'?s?\s+policies?\s*,?\s*/i, label: 'Decision Required', type: 'callout', variant: 'decision' },
  { pattern: /Settlement\s+details?\s*:\s*/i, label: 'Settlement Details', type: 'callout', variant: 'info' },
  { pattern: /Transaction\s+summary\s*:\s*/i, label: 'Transaction Summary', type: 'callout', variant: 'info' },
  { pattern: /Compliance\s+(?:result|check|status)\s*:\s*/i, label: 'Compliance', type: 'callout', variant: 'info' },
  { pattern: /Note\s*:\s*/i, label: 'Note', type: 'callout', variant: 'warning' },
  { pattern: /Important\s*:\s*/i, label: 'Important', type: 'callout', variant: 'warning' },
];

/**
 * Normalize smart/curly quotes to ASCII before matching.
 */
function normalizeQuotes(text: string): string {
  return text
    .replace(/[\u2018\u2019\u201A\u201B]/g, "'")  // smart single quotes → '
    .replace(/[\u201C\u201D\u201E\u201F]/g, '"');  // smart double quotes → "
}

/**
 * Simple search-based section finder.
 * Scans for the FIRST occurrence of each marker in the text,
 * returns sorted split points.
 */
interface SplitPoint {
  index: number;
  matchLength: number;
  marker: typeof SECTION_MARKERS[number];
}

function findSplitPoints(text: string): SplitPoint[] {
  const normalized = normalizeQuotes(text.toLowerCase());
  const points: SplitPoint[] = [];

  for (const marker of SECTION_MARKERS) {
    // Use the regex on normalized text to find position
    const match = normalized.match(new RegExp(marker.pattern.source, 'i'));
    if (match && match.index !== undefined) {
      // Make sure this isn't overlapping with an already-found point
      const idx = match.index;
      const len = match[0].length;
      const overlaps = points.some(p =>
        (idx >= p.index && idx < p.index + p.matchLength) ||
        (p.index >= idx && p.index < idx + len)
      );
      if (!overlaps) {
        points.push({ index: idx, matchLength: len, marker });
      }
    }
  }

  points.sort((a, b) => a.index - b.index);
  return points;
}

/**
 * Pre-processes flat text by splitting at semantic section markers.
 * Uses indexOf-based approach for reliability.
 */
function semanticSplit(text: string): string[] {
  const points = findSplitPoints(text);
  if (points.length === 0) return [text];

  const result: string[] = [];
  let pos = 0;

  for (let i = 0; i < points.length; i++) {
    const p = points[i];

    // Text before this marker
    if (p.index > pos) {
      const before = text.slice(pos, p.index).trim();
      if (before) result.push(before);
    }

    // This marker's content extends to the next marker (or end of text)
    const endPos = i + 1 < points.length ? points[i + 1].index : text.length;
    const segment = text.slice(p.index, endPos).trim();
    if (segment) result.push(segment);
    pos = endPos;
  }

  // Tail after last marker
  if (pos < text.length) {
    const tail = text.slice(pos).trim();
    if (tail) result.push(tail);
  }

  return result.length > 0 ? result : [text];
}

/**
 * Classify a text segment as a semantic section or plain text.
 */
function classifySegment(text: string): { marker: typeof SECTION_MARKERS[number] | null; content: string } {
  const normalized = normalizeQuotes(text);
  for (const marker of SECTION_MARKERS) {
    const match = normalized.match(marker.pattern);
    if (match && match.index !== undefined && match.index < 5) {
      // Use the match length on the ORIGINAL text (same positions)
      const content = text.slice(match.index + match[0].length).trim();
      return { marker, content };
    }
  }
  return { marker: null, content: text };
}

function parseAgentContent(content: string): ContentPart[] {
  if (!content) return [{ type: 'paragraph', text: '(No response)' }];

  const parts: ContentPart[] = [];
  const lines = content.split('\n');
  let currentBullets: string[] = [];
  let currentNumbered: string[] = [];

  const flushBullets = () => {
    if (currentBullets.length > 0) {
      parts.push({ type: 'bullet', text: '', items: [...currentBullets] });
      currentBullets = [];
    }
  };

  const flushNumbered = () => {
    if (currentNumbered.length > 0) {
      parts.push({ type: 'numbered', text: '', items: [...currentNumbered] });
      currentNumbered = [];
    }
  };

  for (const line of lines) {
    const trimmed = line.trim();

    if (!trimmed) { flushBullets(); flushNumbered(); continue; }

    if (/^#{1,3}\s+/.test(trimmed)) {
      flushBullets(); flushNumbered();
      parts.push({ type: 'header', text: trimmed.replace(/^#{1,3}\s+/, '') });
      continue;
    }
    if (/^\*\*[^*]+\*\*:?\s*$/.test(trimmed)) {
      flushBullets(); flushNumbered();
      parts.push({ type: 'header', text: trimmed.replace(/\*\*/g, '').replace(/:$/, '') });
      continue;
    }
    if (/^[-*]\s+/.test(trimmed)) {
      flushNumbered();
      currentBullets.push(trimmed.replace(/^[-*]\s+/, ''));
      continue;
    }
    if (/^\d+[.)]\s+/.test(trimmed)) {
      flushBullets();
      currentNumbered.push(trimmed.replace(/^\d+[.)]\s+/, ''));
      continue;
    }
    if (/^[-=]{3,}$/.test(trimmed)) {
      flushBullets(); flushNumbered();
      parts.push({ type: 'divider', text: '' });
      continue;
    }

    // Regular paragraph — run semantic splitting
    flushBullets();
    flushNumbered();

    const cleaned = trimmed
      .replace(/\*\*([^*]+)\*\*/g, '$1')
      .replace(/\*([^*]+)\*/g, '$1')
      .replace(/`([^`]+)`/g, '$1');

    // Apply semantic splitting to detect inline section markers
    const segments = semanticSplit(cleaned);
    console.log('[RichMessage] semanticSplit produced', segments.length, 'segments from', cleaned.length, 'chars');

    for (const segment of segments) {
      const { marker, content: segContent } = classifySegment(segment);

      if (marker) {
        console.log('[RichMessage] Classified as', marker.type, ':', marker.label);
        parts.push({
          type: marker.type as ContentPart['type'],
          text: segContent,
          label: marker.label,
          variant: marker.variant,
        });
      } else {
        // Plain paragraph — break long ones at sentence boundaries
        if (segment.length > 200) {
          const sentences = splitIntoSentences(segment);
          let group: string[] = [];
          for (const sentence of sentences) {
            group.push(sentence);
            if (group.join(' ').length > 160 || group.length >= 2) {
              parts.push({ type: 'paragraph', text: group.join(' ') });
              group = [];
            }
          }
          if (group.length > 0) {
            parts.push({ type: 'paragraph', text: group.join(' ') });
          }
        } else {
          parts.push({ type: 'paragraph', text: segment });
        }
      }
    }
  }

  flushBullets();
  flushNumbered();

  console.log('[RichMessage] parseAgentContent produced', parts.length, 'parts:', parts.map(p => p.type));
  return parts.length > 0 ? parts : [{ type: 'paragraph', text: content }];
}

/**
 * Smart sentence splitter that avoids breaking on:
 * - Dollar amounts ($640.03)
 * - Abbreviations (U.S., e.g., etc.)
 * - Decimal numbers (1.5, 100.00)
 */
function splitIntoSentences(text: string): string[] {
  // Replace known abbreviations with placeholders to avoid false splits
  let safe = text
    .replace(/\b(U\.S\.|e\.g\.|i\.e\.|etc\.|vs\.|Dr\.|Mr\.|Mrs\.|Ms\.)/gi, (m) => m.replace(/\./g, '\u2024'))
    .replace(/\$[\d,]+\.\d{1,2}/g, (m) => m.replace('.', '\u2024'))
    .replace(/(\d)\./g, '$1\u2024');

  const parts = safe.match(/[^.!?]+[.!?]+(?:\s|$)|[^.!?]+$/g);
  if (!parts) return [text];

  // Restore dots
  return parts.map(s => s.replace(/\u2024/g, '.').trim()).filter(Boolean);
}

function extractSummary(text: string): string {
  const sentenceEnd = text.search(/[.!?]\s/);
  if (sentenceEnd > 0 && sentenceEnd < 200) {
    return text.slice(0, sentenceEnd + 1);
  }
  if (text.length <= 150) return text;
  const truncated = text.slice(0, 150);
  const lastSpace = truncated.lastIndexOf(' ');
  return (lastSpace > 100 ? truncated.slice(0, lastSpace) : truncated) + '...';
}

// ============================================================
// Reasoning Content
// ============================================================

function ReasoningContent({ text }: { text: string }) {
  const sentences = splitIntoSentences(text);
  const groups: string[][] = [];
  let current: string[] = [];
  for (const s of sentences) {
    current.push(s);
    if (current.join(' ').length > 200 || current.length >= 3) {
      groups.push([...current]);
      current = [];
    }
  }
  if (current.length > 0) groups.push(current);

  return (
    <div className="space-y-1.5">
      {groups.map((group, i) => (
        <p key={i} className="text-[11px] text-coda-text-muted leading-relaxed">
          <HighlightedText text={group.join(' ')} />
        </p>
      ))}
    </div>
  );
}

// ============================================================
// Content Section Renderer
// ============================================================

function ContentSection({ section, onQuickAction }: { section: ContentPart; onQuickAction?: (text: string) => void }) {
  switch (section.type) {
    case 'header':
      return (
        <div className="flex items-center gap-1.5 mt-2.5 mb-1 first:mt-0">
          <div className="w-1 h-3 rounded-full bg-coda-brand/50" />
          <h4 className="text-[11px] font-medium text-coda-text uppercase tracking-wide">
            {section.text}
          </h4>
        </div>
      );

    case 'bullet':
      return (
        <ul className="space-y-1 my-1.5 ml-1">
          {section.items?.map((item, idx) => (
            <li key={idx} className="flex items-start gap-2 text-[12px] text-coda-text-secondary leading-relaxed">
              <span className="text-coda-brand mt-1 shrink-0 text-[8px]">{'\u25CF'}</span>
              <span><HighlightedText text={item} /></span>
            </li>
          ))}
        </ul>
      );

    case 'numbered':
      return (
        <ol className="space-y-1 my-1.5 ml-1">
          {section.items?.map((item, idx) => (
            <li key={idx} className="flex items-start gap-2 text-[12px] text-coda-text-secondary leading-relaxed">
              <span className="text-blue-500 shrink-0 w-4 text-right text-[10px] font-medium mt-0.5">{idx + 1}.</span>
              <span><HighlightedText text={item} /></span>
            </li>
          ))}
        </ol>
      );

    case 'divider':
      return <div className="my-2.5 border-t border-coda-border/30" />;

    case 'quote':
      return (
        <div className="my-3 rounded-lg bg-coda-brand/10 border-l-[3px] border-coda-brand overflow-hidden">
          <div className="px-3 py-1.5 flex items-center gap-1.5 bg-coda-brand/10 border-b border-coda-brand/20">
            <MessageSquareQuote className="w-3 h-3 text-coda-brand" />
            <span className="text-[10px] font-medium text-coda-brand uppercase tracking-wider">
              {section.label || 'Original Request'}
            </span>
          </div>
          <div className="px-3 py-2.5">
            <p className="text-[12px] text-coda-text-secondary leading-relaxed italic">
              <HighlightedText text={section.text} />
            </p>
          </div>
        </div>
      );

    case 'callout': {
      const isDecision = section.variant === 'decision';
      const variantStyles = {
        info: {
          bg: 'bg-blue-500/10 border border-blue-500/30',
          headerBg: 'bg-blue-500/10',
          iconColor: 'text-blue-500 dark:text-blue-400',
          labelColor: 'text-blue-500 dark:text-blue-400',
          Icon: Brain,
        },
        warning: {
          bg: 'bg-amber-500/10 border border-amber-500/30',
          headerBg: 'bg-amber-500/10',
          iconColor: 'text-amber-400',
          labelColor: 'text-amber-400',
          Icon: AlertTriangle,
        },
        decision: {
          bg: 'bg-coda-brand/10 border-2 border-coda-brand/40',
          headerBg: 'bg-coda-brand/10',
          iconColor: 'text-coda-brand',
          labelColor: 'text-coda-brand',
          Icon: HelpCircle,
        },
        quote: {
          bg: 'bg-coda-surface-hover/30 border border-coda-border/40',
          headerBg: 'bg-coda-surface-hover/20',
          iconColor: 'text-coda-text-muted',
          labelColor: 'text-coda-text-muted',
          Icon: Info,
        },
      };
      const v = variantStyles[section.variant || 'info'];

      return (
        <div className={`my-2 rounded-lg overflow-hidden ${v.bg}`}>
          <div className="px-3 py-1.5 flex items-center gap-1.5">
            <v.Icon className={`w-3 h-3 ${v.iconColor}`} />
            <span className={`text-[10px] font-medium uppercase tracking-wider ${v.labelColor}`}>
              {section.label}
            </span>
          </div>
          <div className="px-3 pb-2.5">
            <p className="text-[12px] text-coda-text-secondary leading-[1.7]">
              <HighlightedText text={section.text} />
            </p>
          </div>

          {/* Decision action buttons */}
          {isDecision && onQuickAction && (
            <div className="px-3 pb-3 pt-1 flex items-center gap-2">
              <button
                onClick={() => onQuickAction('Accept this payment')}
                className="flex items-center px-4 py-2 text-white text-[12px] font-medium"
              >
                <CheckCircle2 className="w-3.5 h-3.5" />
                <span>Accept</span>
              </button>
              <button
                onClick={() => onQuickAction('Reject this payment')}
                className="flex items-center px-4 py-2 bg-red-500/15 text-red-400 text-[12px] font-medium"
              >
                <XCircle className="w-3.5 h-3.5" />
                <span>Reject</span>
              </button>
            </div>
          )}
        </div>
      );
    }

    case 'paragraph':
    default:
      return (
        <p className="text-[12px] text-coda-text-secondary leading-[1.7] my-1">
          <HighlightedText text={section.text} />
        </p>
      );
  }
}

// ============================================================
// Helpers
// ============================================================

function formatAmount(amount: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(amount);
}