import React, { useState, useEffect, useCallback } from 'react';
import { CheckCircle2, XCircle, Clock, ArrowRight, RefreshCw, Play } from 'lucide-react';
import { supabase, callServer } from '../../supabaseClient';
import { useAuth } from '../../contexts/AuthContext';

// ============================================================
// ChangeRequestPanel — Pending change requests with approve/reject
//
// Shows maker/checker workflow items for a bank's config changes.
// Authorized reviewers can approve or reject pending requests.
// ============================================================

interface ChangeRequest {
  id: string;
  bank_id: string | null;
  resource: string;
  field_name: string;
  old_value: string | null;
  new_value: string;
  reason: string | null;
  status: 'pending' | 'approved' | 'rejected' | 'applied';
  submitted_by: string;
  submitted_at: string;
  reviewed_by: string | null;
  reviewed_at: string | null;
  applied_at: string | null;
}

interface ChangeRequestPanelProps {
  bankId: string | null;
}

const STATUS_STYLES: Record<string, { icon: React.ElementType; label: string; className: string }> = {
  pending: { icon: Clock, label: 'Pending', className: 'text-amber-600 dark:text-amber-400 bg-amber-500/10' },
  approved: { icon: CheckCircle2, label: 'Approved', className: 'text-emerald-600 dark:text-emerald-400 bg-emerald-500/10' },
  rejected: { icon: XCircle, label: 'Rejected', className: 'text-red-600 dark:text-red-400 bg-red-500/10' },
  applied: { icon: Play, label: 'Applied', className: 'text-blue-600 dark:text-blue-400 bg-blue-500/10' },
};

function formatTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) +
    ' ' + d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
}

function truncateEmail(email: string): string {
  const at = email.indexOf('@');
  return at > 0 ? email.slice(0, at) : email;
}

export function ChangeRequestPanel({ bankId }: ChangeRequestPanelProps) {
  const { user } = useAuth();
  const email = user?.email ?? '';
  const [requests, setRequests] = useState<ChangeRequest[]>([]);
  const [loading, setLoading] = useState(false);
  const [actionInFlight, setActionInFlight] = useState<string | null>(null);

  const fetchRequests = useCallback(async () => {
    setLoading(true);
    try {
      let q = supabase
        .from('config_change_requests')
        .select('*')
        .order('submitted_at', { ascending: false });
      if (bankId) q = q.eq('bank_id', bankId);
      const { data } = await q;
      setRequests(data ?? []);
    } catch (err) {
      console.error('[ChangeRequestPanel] fetch error:', err);
    } finally {
      setLoading(false);
    }
  }, [bankId]);

  useEffect(() => { fetchRequests(); }, [fetchRequests]);

  const handleReview = async (id: string, action: 'approve' | 'reject') => {
    if (!email) return;
    setActionInFlight(id);
    try {
      await callServer(
        `/governance/change-requests/${id}/review`,
        { action },
        1,
        { headers: { 'X-User-Email': email } }
      );
      await fetchRequests();
    } catch (err) {
      console.error(`[ChangeRequestPanel] ${action} error:`, err);
    } finally {
      setActionInFlight(null);
    }
  };

  const handleApply = async (id: string) => {
    if (!email) return;
    setActionInFlight(id);
    try {
      await callServer(
        `/governance/change-requests/${id}/apply`,
        {},
        1,
        { headers: { 'X-User-Email': email } }
      );
      await fetchRequests();
    } catch (err) {
      console.error('[ChangeRequestPanel] apply error:', err);
    } finally {
      setActionInFlight(null);
    }
  };

  if (requests.length === 0 && !loading) {
    return (
      <div className="text-xs text-coda-text-muted text-center py-4">
        No change requests{bankId ? ' for this bank' : ''}.
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {/* Header row */}
      <div className="flex items-center justify-between">
        <span className="text-[10px] uppercase tracking-wider text-coda-text-muted font-medium">
          {requests.length} request{requests.length !== 1 ? 's' : ''}
        </span>
        <button
          onClick={fetchRequests}
          disabled={loading}
          className="p-1 rounded hover:bg-black/5 dark:hover:bg-white/5 text-coda-text-muted transition-colors"
        >
          <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>

      {/* Request list */}
      <div className="space-y-1.5 max-h-64 overflow-y-auto">
        {requests.map((req) => {
          const s = STATUS_STYLES[req.status] ?? STATUS_STYLES.pending;
          const StatusIcon = s.icon;
          const isBusy = actionInFlight === req.id;
          return (
            <div
              key={req.id}
              className="rounded-lg border border-coda-border bg-black/[0.02] dark:bg-white/[0.02] px-3 py-2 space-y-1"
            >
              {/* Top row: field + status badge */}
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-medium text-coda-text truncate">
                  {req.field_name}
                </span>
                <span className={`inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded-full ${s.className}`}>
                  <StatusIcon size={10} />
                  {s.label}
                </span>
              </div>

              {/* Value change */}
              <div className="flex items-center gap-1.5 text-[11px] font-mono text-coda-text-secondary">
                <span className="text-red-500/70 line-through truncate max-w-[120px]">
                  {req.old_value ?? '(none)'}
                </span>
                <ArrowRight size={10} className="shrink-0 text-coda-text-muted" />
                <span className="text-emerald-600 dark:text-emerald-400 truncate max-w-[120px]">
                  {req.new_value}
                </span>
              </div>

              {/* Reason */}
              {req.reason && (
                <p className="text-[10px] text-coda-text-muted italic truncate">
                  {req.reason}
                </p>
              )}

              {/* Meta: submitter + time */}
              <div className="flex items-center justify-between text-[10px] text-coda-text-muted">
                <span>{truncateEmail(req.submitted_by)}</span>
                <span>{formatTime(req.submitted_at)}</span>
              </div>

              {/* Actions */}
              {req.status === 'pending' && (
                <div className="flex gap-1.5 pt-0.5">
                  <button
                    onClick={() => handleReview(req.id, 'approve')}
                    disabled={isBusy}
                    className="flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-medium text-emerald-700 dark:text-emerald-400 bg-emerald-500/10 hover:bg-emerald-500/20 transition-colors disabled:opacity-40"
                  >
                    <CheckCircle2 size={10} /> Approve
                  </button>
                  <button
                    onClick={() => handleReview(req.id, 'reject')}
                    disabled={isBusy}
                    className="flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-medium text-red-700 dark:text-red-400 bg-red-500/10 hover:bg-red-500/20 transition-colors disabled:opacity-40"
                  >
                    <XCircle size={10} /> Reject
                  </button>
                </div>
              )}
              {req.status === 'approved' && (
                <div className="flex gap-1.5 pt-0.5">
                  <button
                    onClick={() => handleApply(req.id)}
                    disabled={isBusy}
                    className="flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-medium text-blue-700 dark:text-blue-400 bg-blue-500/10 hover:bg-blue-500/20 transition-colors disabled:opacity-40"
                  >
                    <Play size={10} /> Apply
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
