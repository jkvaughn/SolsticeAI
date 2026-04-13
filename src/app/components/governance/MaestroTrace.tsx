import { Brain, ArrowRight, FileText, Cpu } from 'lucide-react';
import type { MessageType } from '../../types';
import { MESSAGE_TYPE_CONFIG } from '../../types';

// ============================================================
// MaestroTrace (Task 162)
//
// Per-action decision trace for the Maestro orchestrator.
// Shows which Operating Rule triggered, input context, and
// output instruction — formatted for non-technical compliance
// review. Reads from agent_messages where the resolved agent
// is Maestro (payment_request, payment_accept, payment_reject,
// status_update, or natural_language starting with 'maestro').
// ============================================================

interface MaestroTraceProps {
  messages: any[];
}

function isMaestroMessage(msg: any): boolean {
  const nl = ((msg.natural_language || '') as string).toLowerCase();
  if (nl.startsWith('maestro')) return true;
  const maestroTypes: MessageType[] = ['payment_request', 'payment_accept', 'payment_reject', 'status_update'];
  return maestroTypes.includes(msg.message_type);
}

function fmtTime(iso: string | null | undefined): string {
  if (!iso) return '\u2014';
  const d = new Date(iso);
  return d.toLocaleString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function extractRule(msg: any): string {
  const content = typeof msg.content === 'object' ? msg.content : {};
  if (content?.operating_rule) return content.operating_rule;
  if (content?.rule) return content.rule;
  // Infer from message type
  switch (msg.message_type) {
    case 'payment_request': return 'OR-1: Payment Initiation';
    case 'payment_accept': return 'OR-3: Payment Acceptance';
    case 'payment_reject': return 'OR-4: Payment Rejection';
    case 'status_update': return 'OR-5: Status Propagation';
    default: return 'General Decision';
  }
}

function extractInput(msg: any): string {
  const content = typeof msg.content === 'object' ? msg.content : {};
  const parts: string[] = [];
  if (content?.amount) parts.push(`Amount: $${(Number(content.amount) / 1_000_000).toFixed(2)}`);
  if (content?.sender) parts.push(`From: ${content.sender}`);
  if (content?.receiver) parts.push(`To: ${content.receiver}`);
  if (content?.action) parts.push(`Action: ${content.action}`);
  if (content?.risk_level) parts.push(`Risk: ${content.risk_level}`);
  if (content?.compliance_passed != null) parts.push(`Compliance: ${content.compliance_passed ? 'passed' : 'failed'}`);
  if (parts.length === 0 && msg.transaction_id) parts.push(`Tx: ${msg.transaction_id.slice(0, 8)}`);
  return parts.join(' | ') || 'No structured input';
}

function extractOutput(msg: any): string {
  const nl = msg.natural_language;
  if (nl) return nl.length > 200 ? nl.slice(0, 200) + '...' : nl;
  const content = typeof msg.content === 'object' ? msg.content : {};
  if (content?.instruction) return content.instruction;
  if (content?.decision) return content.decision;
  return msg.message_type === 'payment_accept' ? 'Approved transaction for execution'
    : msg.message_type === 'payment_reject' ? 'Rejected transaction'
    : 'Processed decision';
}

export function MaestroTrace({ messages }: MaestroTraceProps) {
  const maestroMsgs = messages.filter(isMaestroMessage).slice(0, 15);

  if (maestroMsgs.length === 0) {
    return (
      <div className="py-4 text-center">
        <Brain className="w-5 h-5 text-coda-text-muted mx-auto mb-2" />
        <p className="text-[12px] text-coda-text-muted">No Maestro decisions for this transaction</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 mb-1">
        <Brain size={14} className="text-coda-text-muted" />
        <span className="text-[12px] font-mono font-semibold text-coda-text">Maestro Decision Trace</span>
        <span className="ml-auto text-[10px] font-mono text-coda-text-muted">{maestroMsgs.length} action{maestroMsgs.length !== 1 ? 's' : ''}</span>
      </div>

      {maestroMsgs.map((msg: any, i: number) => {
        const typeCfg = MESSAGE_TYPE_CONFIG[msg.message_type as MessageType];
        const rule = extractRule(msg);
        const input = extractInput(msg);
        const output = extractOutput(msg);

        return (
          <div
            key={msg.id || i}
            className={`p-3 rounded-lg border border-black/[0.06] dark:border-white/[0.06] bg-black/[0.01] dark:bg-white/[0.02] ${
              i > 0 ? '' : ''
            }`}
          >
            {/* Step header */}
            <div className="flex items-center gap-2 mb-2">
              <span className="w-5 h-5 rounded-full bg-black/[0.06] dark:bg-white/[0.08] flex items-center justify-center text-[10px] font-mono font-bold text-coda-text">
                {i + 1}
              </span>
              <span className={`text-[11px] font-mono ${typeCfg?.color || 'text-coda-text-muted'}`}>
                {typeCfg?.label || msg.message_type}
              </span>
              <ArrowRight size={10} className="text-coda-text-muted" />
              <span className="text-[11px] font-mono text-coda-text-secondary">{rule}</span>
              <span className="ml-auto text-[10px] font-mono text-coda-text-muted tabular-nums">{fmtTime(msg.created_at)}</span>
            </div>

            {/* Input context */}
            <div className="ml-7 mb-1.5">
              <div className="flex items-center gap-1.5 mb-0.5">
                <Cpu size={10} className="text-coda-text-muted" />
                <span className="text-[10px] font-mono text-coda-text-muted uppercase">Input Context</span>
              </div>
              <p className="text-[11px] text-coda-text-secondary font-mono">{input}</p>
            </div>

            {/* Output instruction */}
            <div className="ml-7">
              <div className="flex items-center gap-1.5 mb-0.5">
                <FileText size={10} className="text-coda-text-muted" />
                <span className="text-[10px] font-mono text-coda-text-muted uppercase">Output</span>
              </div>
              <p className="text-[11px] text-coda-text-secondary leading-relaxed">{output}</p>
            </div>
          </div>
        );
      })}
    </div>
  );
}
