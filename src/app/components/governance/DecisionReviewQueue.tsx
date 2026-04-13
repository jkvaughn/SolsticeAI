import { useState, useCallback } from 'react';
import { Link } from 'react-router';
import { ListChecks, Flag, CheckCircle2, XCircle, MessageSquare } from 'lucide-react';
import { fetchAgentMessages } from '../../dataClient';
import { useSWRCache } from '../../hooks/useSWRCache';
import { useBanks } from '../../contexts/BanksContext';
import { WidgetShell } from '../dashboard/WidgetShell';
import type { MessageType } from '../../types';
import { MESSAGE_TYPE_CONFIG } from '../../types';

// ============================================================
// DecisionReviewQueue (Task 162)
//
// Compliance review queue for individual agent decisions.
// Review state is stored in localStorage (lightweight, no
// new DB table needed). Compliance officers can flag decisions
// for review, mark them reviewed with notes, or dismiss them.
// ============================================================

type ReviewStatus = 'pending_review' | 'reviewed' | 'dismissed';

interface ReviewState {
  status: ReviewStatus;
  note: string;
  reviewedAt: string | null;
}

const STORAGE_KEY = 'coda-decision-reviews';

function loadReviews(): Record<string, ReviewState> {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
  } catch { return {}; }
}

function saveReviews(reviews: Record<string, ReviewState>) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(reviews));
}

function resolveAgentName(msg: any): string {
  const nl = ((msg.natural_language || '') as string).toLowerCase();
  if (nl.startsWith('concord')) return 'Concord';
  if (nl.startsWith('fermata')) return 'Fermata';
  if (nl.startsWith('canto')) return 'Canto';
  if (nl.startsWith('cadenza')) return 'Cadenza';
  if (msg.message_type === 'compliance_query' || msg.message_type === 'compliance_response') return 'Concord';
  if (msg.message_type === 'risk_alert') return 'Fermata';
  if (msg.message_type === 'settlement_confirm') return 'Canto';
  if (msg.message_type === 'cadenza_decision' || msg.message_type === 'lockup_action') return 'Cadenza';
  return 'Maestro';
}

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '\u2014';
  const d = new Date(iso);
  return d.toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

const STATUS_STYLES: Record<ReviewStatus, { label: string; color: string; bg: string }> = {
  pending_review: { label: 'Pending', color: 'text-amber-600 dark:text-amber-400', bg: 'bg-amber-500/15' },
  reviewed: { label: 'Reviewed', color: 'text-emerald-600 dark:text-emerald-400', bg: 'bg-emerald-500/15' },
  dismissed: { label: 'Dismissed', color: 'text-coda-text-muted', bg: 'bg-black/[0.04] dark:bg-white/[0.06]' },
};

export function DecisionReviewQueue() {
  const { cacheVersion } = useBanks();
  const [reviews, setReviews] = useState<Record<string, ReviewState>>(loadReviews);
  const [noteInputId, setNoteInputId] = useState<string | null>(null);
  const [noteText, setNoteText] = useState('');

  const { data: messages } = useSWRCache<any[]>({
    key: 'decision-review-messages',
    fetcher: () => fetchAgentMessages({ limit: 100 }),
    deps: [cacheVersion],
    ttl: 2 * 60 * 1000,
  });

  const updateReview = useCallback((id: string, status: ReviewStatus, note?: string) => {
    setReviews(prev => {
      const next = { ...prev, [id]: { status, note: note ?? prev[id]?.note ?? '', reviewedAt: new Date().toISOString() } };
      saveReviews(next);
      return next;
    });
    setNoteInputId(null);
    setNoteText('');
  }, []);

  const flagForReview = useCallback((id: string) => {
    updateReview(id, 'pending_review');
  }, [updateReview]);

  const decisions = messages ?? [];
  const content = typeof decisions[0]?.content === 'object' ? decisions[0]?.content : {};

  return (
    <WidgetShell
      title="Decision Review Queue"
      icon={ListChecks}
      headerRight={
        <span className="text-[11px] font-mono text-coda-text-muted">
          {Object.values(reviews).filter(r => r.status === 'pending_review').length} pending
        </span>
      }
    >
      {decisions.length === 0 ? (
        <div className="py-6 text-center text-[13px] text-coda-text-muted">No agent decisions to review</div>
      ) : (
        <div className="space-y-0 overflow-x-auto">
          {/* Header */}
          <div className="grid grid-cols-12 gap-2 py-2 text-[10px] font-mono text-coda-text-muted uppercase tracking-wider min-w-[600px]">
            <div className="col-span-2">Agent</div>
            <div className="col-span-2">Decision</div>
            <div className="col-span-2">Transaction</div>
            <div className="col-span-1">Conf.</div>
            <div className="col-span-2">Time</div>
            <div className="col-span-1">Status</div>
            <div className="col-span-2">Actions</div>
          </div>
          {decisions.slice(0, 25).map((msg: any, i: number) => {
            const review = reviews[msg.id];
            const agentName = resolveAgentName(msg);
            const typeCfg = MESSAGE_TYPE_CONFIG[msg.message_type as MessageType];
            const msgContent = typeof msg.content === 'object' ? msg.content : {};
            const confidence = msgContent?.confidence != null ? Number(msgContent.confidence).toFixed(2) : '\u2014';
            const status = review?.status;
            const statusCfg = status ? STATUS_STYLES[status] : null;

            return (
              <div key={msg.id}>
                <div className={`grid grid-cols-12 gap-2 items-center py-2.5 min-w-[600px] ${
                  i > 0 ? 'border-t border-black/[0.06] dark:border-white/[0.06]' : ''
                }`}>
                  <div className="col-span-2 text-[12px] font-mono font-medium text-coda-text">{agentName}</div>
                  <div className="col-span-2">
                    <span className={`text-[11px] font-mono ${typeCfg?.color || 'text-coda-text-muted'}`}>
                      {typeCfg?.label || msg.message_type}
                    </span>
                  </div>
                  <div className="col-span-2">
                    {msg.transaction_id ? (
                      <Link to={`/transactions/${msg.transaction_id}`} className="text-[11px] font-mono text-coda-brand hover:underline">
                        {msg.transaction_id.slice(0, 8)}
                      </Link>
                    ) : <span className="text-[11px] text-coda-text-muted">\u2014</span>}
                  </div>
                  <div className="col-span-1 text-[11px] font-mono tabular-nums text-coda-text">{confidence}</div>
                  <div className="col-span-2 text-[11px] font-mono text-coda-text-muted tabular-nums">{fmtDate(msg.created_at)}</div>
                  <div className="col-span-1">
                    {statusCfg ? (
                      <span className={`inline-flex items-center px-1.5 py-0.5 text-[9px] font-mono rounded ${statusCfg.bg} ${statusCfg.color}`}>
                        {statusCfg.label}
                      </span>
                    ) : <span className="text-[10px] text-coda-text-muted">\u2014</span>}
                  </div>
                  <div className="col-span-2 flex items-center gap-1.5">
                    {(!status || status === 'dismissed') && (
                      <button
                        onClick={() => flagForReview(msg.id)}
                        className="flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-mono text-amber-600 dark:text-amber-400 bg-amber-500/10 hover:bg-amber-500/20 transition-colors cursor-pointer"
                        title="Flag for review"
                      >
                        <Flag size={10} /> Flag
                      </button>
                    )}
                    {status === 'pending_review' && (
                      <>
                        <button
                          onClick={() => { setNoteInputId(noteInputId === msg.id ? null : msg.id); setNoteText(review?.note || ''); }}
                          className="flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-mono text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 hover:bg-emerald-500/20 transition-colors cursor-pointer"
                          title="Mark reviewed"
                        >
                          <CheckCircle2 size={10} /> Review
                        </button>
                        <button
                          onClick={() => updateReview(msg.id, 'dismissed')}
                          className="flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-mono text-coda-text-muted bg-black/[0.04] dark:bg-white/[0.06] hover:bg-black/[0.08] dark:hover:bg-white/[0.1] transition-colors cursor-pointer"
                          title="Dismiss"
                        >
                          <XCircle size={10} />
                        </button>
                      </>
                    )}
                    {status === 'reviewed' && review?.note && (
                      <span className="flex items-center gap-1 text-[10px] text-coda-text-muted" title={review.note}>
                        <MessageSquare size={10} /> Note
                      </span>
                    )}
                  </div>
                </div>

                {/* Note input */}
                {noteInputId === msg.id && (
                  <div className="flex items-center gap-2 py-2 pl-4 min-w-[600px]">
                    <input
                      type="text"
                      value={noteText}
                      onChange={e => setNoteText(e.target.value)}
                      placeholder="Review note..."
                      className="flex-1 text-[12px] px-2 py-1 rounded bg-black/[0.04] dark:bg-white/[0.06] border border-black/[0.06] dark:border-white/[0.06] text-coda-text placeholder:text-coda-text-muted/60 outline-none focus:border-coda-brand/50"
                      onKeyDown={e => { if (e.key === 'Enter') updateReview(msg.id, 'reviewed', noteText); }}
                    />
                    <button
                      onClick={() => updateReview(msg.id, 'reviewed', noteText)}
                      className="px-3 py-1 rounded text-[11px] font-mono bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-500/25 transition-colors cursor-pointer"
                    >
                      Save
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </WidgetShell>
  );
}
