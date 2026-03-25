import { useEffect, useRef, useState, useMemo } from 'react';
import { ArrowRight } from 'lucide-react';
import { supabase } from '../supabaseClient';
import { useRealtimeSubscription } from '../hooks/useRealtimeSubscription';
import { useBanks } from '../contexts/BanksContext';
import { useSWRCache } from '../hooks/useSWRCache';

// ============================================================
// Agent Personas — the four CODA AI agents + Solana chain
// ============================================================

type AgentId = 'maestro' | 'concord' | 'fermata' | 'canto' | 'solana';

const AGENTS: Record<AgentId, { glyph: string; name: string; role: string; color: string; bg: string; dot: string }> = {
  maestro:  { glyph: 'Ma', name: 'Maestro',  role: 'Orchestrator',   color: 'text-coda-text-secondary', bg: 'bg-white/8',  dot: 'bg-coda-text-muted' },
  concord:  { glyph: 'Co', name: 'Concord',  role: 'Compliance',     color: 'text-coda-text-secondary', bg: 'bg-white/8',  dot: 'bg-coda-text-muted' },
  fermata:  { glyph: 'Fe', name: 'Fermata',  role: 'Risk Engine',    color: 'text-coda-text-secondary', bg: 'bg-white/8',  dot: 'bg-coda-text-muted' },
  canto:    { glyph: 'Ca', name: 'Canto',    role: 'Settlement',     color: 'text-coda-text-secondary', bg: 'bg-white/8',  dot: 'bg-coda-text-muted' },
  solana:   { glyph: 'So', name: 'Solana',   role: 'Devnet L1',      color: 'text-coda-text-secondary', bg: 'bg-white/8',  dot: 'bg-coda-text-muted' },
};

const BANK_COLORS: Record<string, string> = {
  JPM: 'text-blue-400', BOA: 'text-red-400', WFC: 'text-amber-400',
  GS: 'text-coda-brand', MS: 'text-emerald-400', CITI: 'text-cyan-400',
  FNBT: 'text-orange-400',
};

// ============================================================
// Verb → status color mapping for quick visual scanning
// ============================================================

const VERB_COLORS: Record<string, { text: string; bg: string }> = {
  dispatching: { text: 'text-blue-400',    bg: 'bg-blue-500/15' },
  accepted:    { text: 'text-emerald-400', bg: 'bg-emerald-500/15' },
  rejected:    { text: 'text-red-400',     bg: 'bg-red-500/15' },
  settled:     { text: 'text-emerald-400', bg: 'bg-emerald-500/15' },
  confirmed:   { text: 'text-emerald-400', bg: 'bg-emerald-500/15' },
  checking:    { text: 'text-amber-400',   bg: 'bg-amber-500/15' },
  verified:    { text: 'text-coda-brand',  bg: 'bg-coda-brand/15' },
  evaluated:   { text: 'text-blue-300',    bg: 'bg-blue-500/10' },
  initiating:  { text: 'text-cyan-400',    bg: 'bg-cyan-500/15' },
  assessing:   { text: 'text-amber-400',   bg: 'bg-amber-500/15' },
  reversed:    { text: 'text-red-400',     bg: 'bg-red-500/15' },
};

function getVerbStyle(verb: string, status: string) {
  if (status === 'error') return { text: 'text-red-400', bg: 'bg-red-500/15' };
  return VERB_COLORS[verb] || { text: 'text-coda-text-muted', bg: 'bg-white/8' };
}

// ============================================================
// Feed event — agentic style
// ============================================================

interface AgenticEvent {
  id: string;
  ts: number;
  agent: AgentId;
  toAgent?: AgentId;
  bankCode?: string;
  bankCode2?: string;
  verb: string;          // short action label: "reasoning", "dispatching", "verified", etc.
  narrative: string;     // first-person agent voice
  detail?: string;       // additional reasoning / data
  amount?: string;
  status: 'thinking' | 'complete' | 'error';
}

// ============================================================
// Transform raw DB messages → agentic voice
// ============================================================

function msgToAgenticEvent(msg: any): AgenticEvent | null {
  const bankCode = msg.from_bank?.short_code || '';
  const toCode = msg.to_bank?.short_code || '';
  const nl = (msg.natural_language || '').slice(0, 300);
  const content = msg.content || {};
  const ts = new Date(msg.created_at).getTime();
  const amount = content.amount_display ? `$${Number(content.amount_display).toLocaleString()}` : undefined;

  switch (msg.message_type) {
    case 'payment_request':
      return {
        id: msg.id, ts,
        agent: 'maestro', toAgent: 'maestro',
        bankCode, bankCode2: toCode,
        verb: 'dispatching',
        narrative: `Routing payment request from ${bankCode} to ${toCode} agent for evaluation`,
        detail: nl || undefined,
        amount,
        status: 'complete',
      };

    case 'payment_accept':
      return {
        id: msg.id, ts,
        agent: 'maestro',
        bankCode, bankCode2: toCode || undefined,
        verb: 'accepted',
        narrative: nl || `${bankCode} agent accepted the inbound payment — all checks passed`,
        detail: content.reasoning ? String(content.reasoning).slice(0, 200) : undefined,
        amount: content.amount_display ? `$${Number(content.amount_display).toLocaleString()}` : amount,
        status: 'complete',
      };

    case 'payment_reject':
      return {
        id: msg.id, ts,
        agent: 'maestro',
        bankCode, bankCode2: toCode || undefined,
        verb: 'rejected',
        narrative: nl || `${bankCode} agent rejected the payment request`,
        detail: content.reasoning ? String(content.reasoning).slice(0, 200) : undefined,
        amount: content.amount_display ? `$${Number(content.amount_display).toLocaleString()}` : amount,
        status: 'error',
      };

    case 'compliance_query':
      return {
        id: msg.id, ts,
        agent: 'concord',
        bankCode,
        verb: 'checking',
        narrative: `Running AML/KYC/sanctions screening for ${bankCode} transaction`,
        detail: nl || undefined,
        status: 'thinking',
      };

    case 'compliance_response': {
      const checksP = content.checks_passed ?? '?';
      const checksT = content.checks_total ?? '?';
      const result = content.result || (checksP === checksT ? 'PASSED' : 'FAILED');
      return {
        id: msg.id, ts,
        agent: 'concord', toAgent: 'maestro',
        bankCode, bankCode2: toCode || undefined,
        verb: result === 'PASSED' ? 'verified' : 'rejected',
        narrative: nl || `Compliance ${result} (${checksP}/${checksT}) — returning result to Maestro`,
        amount,
        status: result === 'PASSED' ? 'complete' : 'error',
      };
    }

    case 'risk_alert': {
      const riskLevel = content.risk_level || '';
      const composite = content.composite_score ?? '';
      return {
        id: msg.id, ts,
        agent: 'fermata', toAgent: 'maestro',
        bankCode, bankCode2: toCode || undefined,
        verb: 'assessing',
        narrative: nl || `Risk ${riskLevel.toUpperCase()} (${composite}/100) — returning assessment to Maestro`,
        detail: content.reasoning ? String(content.reasoning).slice(0, 150) : undefined,
        amount,
        status: 'complete',
      };
    }

    case 'settlement_confirm':
      return {
        id: msg.id, ts,
        agent: 'canto', toAgent: 'solana',
        bankCode, bankCode2: toCode || undefined,
        verb: 'settled',
        narrative: nl || `Atomic burn-and-mint executed on Solana Devnet — wallets updated`,
        detail: content.solana_tx_signature
          ? `tx: ${String(content.solana_tx_signature).slice(0, 24)}…`
          : undefined,
        status: 'complete',
      };

    case 'status_update': {
      const action = content.action || 'STATUS';
      const context = content.context || '';
      const reasoning = (content.reasoning || nl || '').slice(0, 250);

      if (action === 'settlement_started' && context === 'settlement') {
        return {
          id: msg.id, ts,
          agent: 'canto', toAgent: 'solana',
          bankCode: content.sender || bankCode,
          bankCode2: content.receiver || toCode || undefined,
          verb: 'initiating',
          narrative: nl || `Initiating on-chain atomic burn-and-mint settlement`,
          amount: content.amount_display ? `$${Number(content.amount_display).toLocaleString()}` : undefined,
          status: 'thinking',
        };
      }
      if (action === 'agent_decision' && context === 'pipeline_decision') {
        const decision = content.decision || '';
        const isAccept = decision === 'accept_payment';
        return {
          id: msg.id, ts,
          agent: 'maestro',
          bankCode, bankCode2: toCode || undefined,
          verb: isAccept ? 'accepted' : 'rejected',
          narrative: nl || `Agent decision: ${decision.replace(/_/g, ' ').toUpperCase()}`,
          detail: content.reasoning ? String(content.reasoning).slice(0, 200) : undefined,
          amount: content.amount_display ? `$${Number(content.amount_display).toLocaleString()}` : undefined,
          status: isAccept ? 'complete' : 'error',
        };
      }
      if (action === 'NO_ACTION' && context === 'treasury_cycle') {
        return {
          id: msg.id, ts,
          agent: 'maestro',
          bankCode,
          verb: 'evaluated',
          narrative: `Analyzed ${bankCode} treasury position — no action warranted this cycle`,
          detail: reasoning || undefined,
          status: 'complete',
        };
      }
      if (action === 'initiate_payment' || action === 'INITIATE_PAYMENT') {
        return {
          id: msg.id, ts,
          agent: 'maestro',
          bankCode,
          verb: 'initiating',
          narrative: `${bankCode} agent decided to initiate a payment based on current conditions`,
          detail: reasoning || undefined,
          amount: content.amount_display ? `$${Number(content.amount_display).toLocaleString()}` : undefined,
          status: 'complete',
        };
      }
      return null;
    }

    default:
      if (!nl) return null;
      return {
        id: msg.id, ts,
        agent: 'maestro',
        bankCode,
        verb: msg.message_type.replace(/_/g, ' '),
        narrative: nl,
        status: 'complete',
      };
  }
}

function txToAgenticEvent(tx: any): AgenticEvent | null {
  const sCode = tx.sender_bank?.short_code || '';
  const rCode = tx.receiver_bank?.short_code || '';
  const amount = tx.amount_display || (tx.amount ? tx.amount / 1e6 : 0);
  const ts = new Date(tx.updated_at || tx.created_at).getTime();

  if (tx.status === 'settled') {
    return {
      id: `tx-${tx.id}`, ts,
      agent: 'canto', toAgent: 'solana',
      bankCode: sCode, bankCode2: rCode,
      verb: 'confirmed',
      narrative: `Settlement finalized — ${sCode} → ${rCode} on-chain transfer complete`,
      amount: `$${Number(amount).toLocaleString()}`,
      detail: tx.solana_tx_signature ? `sig: ${String(tx.solana_tx_signature).slice(0, 20)}…` : undefined,
      status: 'complete',
    };
  }
  if (tx.status === 'rejected' || tx.status === 'reversed') {
    return {
      id: `tx-${tx.id}`, ts,
      agent: 'maestro',
      bankCode: sCode, bankCode2: rCode,
      verb: tx.status,
      narrative: `Transaction ${tx.status} — ${sCode} → ${rCode}`,
      amount: `$${Number(amount).toLocaleString()}`,
      status: 'error',
    };
  }
  return null;
}

// ============================================================
// Time formatting
// ============================================================

function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString([], {
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false,
  });
}

// ============================================================
// SWR Fetcher (module-level, stable reference)
// ============================================================

async function fetchRecentFeedEvents(): Promise<AgenticEvent[]> {
  const { data: msgs } = await supabase
    .from('agent_messages')
    .select('id, from_bank_id, to_bank_id, message_type, content, natural_language, created_at, from_bank:banks!agent_messages_from_bank_id_fkey(short_code), to_bank:banks!agent_messages_to_bank_id_fkey(short_code)')
    .order('created_at', { ascending: false })
    .limit(40);

  if (!msgs) return [];

  const events: AgenticEvent[] = [];
  for (const msg of msgs.reverse()) {
    const evt = msgToAgenticEvent(msg);
    if (evt) events.push(evt);
  }
  return events;
}

// ============================================================
// Component
// ============================================================

export function NetworkActivityFeed() {
  const [events, setEvents] = useState<AgenticEvent[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const seenIds = useRef(new Set<string>());
  const { banks } = useBanks();

  // Reversed display order — newest events first so latest activity
  // is visible immediately without scrolling.
  const displayEvents = useMemo(() => [...events].reverse(), [events]);

  // Auto-scroll to top when new Realtime events arrive (newest-first order)
  useEffect(() => {
    if (scrollRef.current) {
      const el = scrollRef.current;
      // Only auto-scroll if user is near the top (hasn't scrolled down to read history)
      if (el.scrollTop < 60) {
        requestAnimationFrame(() => { el.scrollTop = 0; });
      }
    }
  }, [events.length]);

  // ── SWR-cached feed events (instant on return visits) ──
  const {
    data: cachedEvents,
    invalidate: invalidateFeed,
  } = useSWRCache<AgenticEvent[]>({
    key: 'network-activity-feed',
    fetcher: fetchRecentFeedEvents,
  });

  // Sync SWR cache → local state, rebuild seenIds set
  useEffect(() => {
    if (cachedEvents && cachedEvents.length > 0) {
      const newSeen = new Set<string>();
      for (const evt of cachedEvents) newSeen.add(evt.id);
      seenIds.current = newSeen;
      setEvents(cachedEvents);
    }
  }, [cachedEvents]);

  // Build a bank-id→short_code lookup map from context (avoids per-event DB queries)
  const bankMapRef = useRef<Map<string, string>>(new Map());
  useEffect(() => {
    const map = new Map<string, string>();
    for (const b of banks) {
      map.set(b.id, b.short_code);
    }
    bankMapRef.current = map;
  }, [banks]);

  const lookupShortCode = (id: string | null | undefined): string | null => {
    if (!id) return null;
    return bankMapRef.current.get(id) ?? null;
  };

  // ── Realtime subscriptions ──
  // Direct-mutate local state for instant UI, then invalidate SWR
  // so the cache stays fresh for return visits.
  useRealtimeSubscription({
    channelName: 'network-feed-rt',
    subscriptions: [
      {
        table: 'agent_messages',
        event: 'INSERT',
        callback: (payload) => {
          const row = payload.new as any;
          // Resolve bank short_codes from context cache instead of per-event DB queries
          const fromBank = lookupShortCode(row.from_bank_id);
          const toBank = lookupShortCode(row.to_bank_id);
          const enriched = {
            ...row,
            from_bank: fromBank ? { short_code: fromBank } : null,
            to_bank: toBank ? { short_code: toBank } : null,
          };
          const evt = msgToAgenticEvent(enriched);
          if (evt && !seenIds.current.has(evt.id)) {
            seenIds.current.add(evt.id);
            setEvents(prev => [...prev, evt].slice(-60));
            invalidateFeed();
          }
        },
      },
      {
        table: 'transactions',
        event: 'UPDATE',
        callback: (payload) => {
          const row = payload.new as any;
          if (row.status === 'settled' || row.status === 'rejected' || row.status === 'reversed') {
            const sCode = lookupShortCode(row.sender_bank_id);
            const rCode = lookupShortCode(row.receiver_bank_id);
            const enriched = {
              ...row,
              sender_bank: sCode ? { short_code: sCode } : null,
              receiver_bank: rCode ? { short_code: rCode } : null,
            };
            const evt = txToAgenticEvent(enriched);
            if (evt && !seenIds.current.has(evt.id)) {
              seenIds.current.add(evt.id);
              setEvents(prev => [...prev, evt].slice(-60));
              invalidateFeed();
            }
          }
        },
      },
    ],
    onPoll: invalidateFeed,
  });

  return (
    <div className="flex flex-col h-full">
      {/* ── Header ── */}
      <div className="px-5 pt-4 pb-3 flex items-center justify-between">
        <h2 className="text-base font-light text-coda-text">Agent Feed</h2>
        {events.length > 0 && (
          <span className="text-[11px] text-coda-text-muted tabular-nums">
            {events.length} events
          </span>
        )}
      </div>

      {/* ── Column headers ── */}
      <div className="px-5 pb-2 flex items-center gap-2 text-[10px] text-coda-text-muted">
        <span className="w-[52px] flex-shrink-0">Agent</span>
        <span className="flex-1 min-w-0">Description</span>
        <span className="w-[64px] flex-shrink-0 text-center">Status</span>
        <span className="w-[56px] flex-shrink-0 text-right">Time</span>
      </div>

      {/* ── Feed body (newest-first) ── */}
      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto scrollbar-thin"
      >
        {events.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 px-6 text-center">
            <p className="text-xs text-coda-text-muted">
              Agents idle
            </p>
            <p className="text-[10px] text-coda-text-muted mt-1 max-w-[200px]">
              Start the treasury engine to watch agents reason, negotiate, and settle in real-time.
            </p>
          </div>
        ) : (
          <div className="px-5">
            {/* Live indicator */}
            <div className="flex items-center gap-2 py-2 border-t border-black/[0.06] dark:border-white/[0.06]">
              <div className="flex gap-[3px]">
                {[0, 1, 2].map(i => (
                  <div
                    key={i}
                    className="w-[3px] h-[3px] rounded-full bg-coda-text-muted/50 animate-pulse"
                    style={{ animationDelay: `${i * 250}ms` }}
                  />
                ))}
              </div>
              <span className="text-[9px] text-coda-text-muted font-mono">
                listening for agent activity…
              </span>
            </div>

            {displayEvents.map((evt, idx) => (
              <div
                key={evt.id}
                className={idx === 0 ? 'animate-fade-slide-in' : ''}
              >
                <EventRow
                  event={evt}
                  isNewest={idx === 0}
                />
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ============================================================
// EventRow — Clean table row matching XD "Recent Events" pattern
// ============================================================

function EventRow({
  event,
  isNewest,
}: {
  event: AgenticEvent;
  isNewest: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const agent = AGENTS[event.agent];
  const toAgent = event.toAgent ? AGENTS[event.toAgent] : null;
  const isThinking = event.status === 'thinking';
  const isError = event.status === 'error';
  const verbStyle = getVerbStyle(event.verb, event.status);
  const hasExpandable = !!(event.detail || event.narrative.length > 80);

  return (
    <div
      onClick={() => hasExpandable && setExpanded(e => !e)}
      className={`flex items-start gap-2 py-2.5 border-t border-black/[0.06] dark:border-white/[0.06]
        ${hasExpandable ? 'cursor-pointer' : ''}
        ${isNewest ? 'bg-black/[0.01] dark:bg-white/[0.01]' : ''}
      `}
    >
      {/* Agent name */}
      <div className="w-[52px] flex-shrink-0 pt-0.5">
        <span className="text-xs font-medium text-coda-text">{agent.name}</span>
        {toAgent && event.agent !== event.toAgent && (
          <div className="flex items-center gap-0.5 mt-0.5">
            <span className="text-[9px] text-coda-text-muted">→ {toAgent.name}</span>
          </div>
        )}
      </div>

      {/* Description column */}
      <div className="flex-1 min-w-0">
        <p className={`text-xs text-coda-text-secondary leading-snug ${!expanded ? 'line-clamp-1' : ''}`}>
          {event.narrative}
        </p>

        {/* Bank routing + amount */}
        {(event.bankCode || event.amount) && (
          <div className="flex items-center gap-2 mt-0.5">
            {event.bankCode && (
              <span className="text-[10px] font-mono text-coda-text-muted">
                {event.bankCode}
                {event.bankCode2 && ` → ${event.bankCode2}`}
              </span>
            )}
            {event.amount && (
              <span className={`text-[10px] font-mono font-medium ${isError ? 'text-red-400' : 'text-coda-text'}`}>
                {event.amount}
              </span>
            )}
          </div>
        )}

        {/* Expanded detail */}
        {expanded && event.detail && (
          <p className="text-[10px] text-coda-text-muted leading-snug mt-1">
            {event.detail}
          </p>
        )}

        {/* Thinking indicator */}
        {isThinking && (
          <div className="flex items-center gap-1.5 mt-1">
            <div className="flex gap-[3px]">
              {[0, 1, 2].map(i => (
                <div
                  key={i}
                  className="w-[3px] h-[3px] rounded-full bg-coda-text-muted animate-pulse"
                  style={{ animationDelay: `${i * 200}ms` }}
                />
              ))}
            </div>
            <span className="text-[9px] font-mono text-coda-text-muted">processing…</span>
          </div>
        )}
      </div>

      {/* Status badge */}
      <div className="w-[64px] flex-shrink-0 flex justify-center pt-0.5">
        <span className={`inline-flex px-1.5 py-0.5 rounded text-[9px] font-medium uppercase tracking-wide ${verbStyle.bg} ${verbStyle.text}`}>
          {event.verb}
        </span>
      </div>

      {/* Timestamp */}
      <span className="w-[56px] flex-shrink-0 text-right text-[10px] text-coda-text-muted tabular-nums pt-0.5">
        {formatTime(event.ts)}
      </span>
    </div>
  );
}