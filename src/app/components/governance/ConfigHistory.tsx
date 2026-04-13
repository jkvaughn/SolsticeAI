import React, { useState, useEffect, useCallback } from 'react';
import { ArrowRight, History, Cpu, GitBranch, User } from 'lucide-react';
import { supabase } from '../../supabaseClient';

// ============================================================
// ConfigHistory — Version history timeline for agent config
//
// Shows each change to a bank's agent configuration: what field
// changed, old/new values, who made the change, and the method
// (direct edit, workflow approval, or Aria AI).
// ============================================================

interface HistoryEntry {
  id: string;
  bank_id: string;
  field_name: string;
  old_value: string | null;
  new_value: string | null;
  changed_by: string;
  change_type: 'direct' | 'workflow' | 'aria';
  change_request_id: string | null;
  created_at: string;
}

interface ConfigHistoryProps {
  bankId: string | null;
}

const CHANGE_TYPE_META: Record<string, { icon: React.ElementType; label: string; className: string }> = {
  direct: { icon: User, label: 'Direct', className: 'text-coda-text-secondary bg-black/[0.04] dark:bg-white/[0.06]' },
  workflow: { icon: GitBranch, label: 'Workflow', className: 'text-blue-600 dark:text-blue-400 bg-blue-500/10' },
  aria: { icon: Cpu, label: 'Aria', className: 'text-purple-600 dark:text-purple-400 bg-purple-500/10' },
};

function formatTime(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffMin = Math.floor(diffMs / 60_000);
  if (diffMin < 1) return 'just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function truncateEmail(email: string): string {
  const at = email.indexOf('@');
  return at > 0 ? email.slice(0, at) : email;
}

export function ConfigHistory({ bankId }: ConfigHistoryProps) {
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [loading, setLoading] = useState(false);

  const fetchHistory = useCallback(async () => {
    setLoading(true);
    try {
      let q = supabase
        .from('agent_config_history')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(30);
      if (bankId) q = q.eq('bank_id', bankId);
      const { data } = await q;
      setHistory(data ?? []);
    } catch (err) {
      console.error('[ConfigHistory] fetch error:', err);
    } finally {
      setLoading(false);
    }
  }, [bankId]);

  useEffect(() => { fetchHistory(); }, [fetchHistory]);

  if (loading && history.length === 0) {
    return (
      <div className="text-xs text-coda-text-muted text-center py-4">
        Loading history...
      </div>
    );
  }

  if (history.length === 0) {
    return (
      <div className="flex flex-col items-center gap-1 py-4 text-coda-text-muted">
        <History size={16} />
        <span className="text-xs">No config changes recorded yet.</span>
      </div>
    );
  }

  return (
    <div className="space-y-1 max-h-64 overflow-y-auto">
      {history.map((entry) => {
        const meta = CHANGE_TYPE_META[entry.change_type] ?? CHANGE_TYPE_META.direct;
        const TypeIcon = meta.icon;
        return (
          <div
            key={entry.id}
            className="flex items-start gap-2 px-2 py-1.5 rounded-md hover:bg-black/[0.02] dark:hover:bg-white/[0.02] transition-colors"
          >
            {/* Timeline dot */}
            <div className="mt-1 w-1.5 h-1.5 rounded-full bg-coda-text-muted/40 shrink-0" />

            {/* Content */}
            <div className="flex-1 min-w-0 space-y-0.5">
              {/* Field name + change type badge */}
              <div className="flex items-center gap-1.5">
                <span className="text-xs font-medium text-coda-text truncate">
                  {entry.field_name}
                </span>
                <span className={`inline-flex items-center gap-0.5 text-[9px] font-medium px-1 py-0.5 rounded ${meta.className}`}>
                  <TypeIcon size={8} />
                  {meta.label}
                </span>
              </div>

              {/* Value diff */}
              <div className="flex items-center gap-1 text-[10px] font-mono text-coda-text-secondary">
                <span className="text-red-500/60 truncate max-w-[100px]">
                  {entry.old_value ?? '(none)'}
                </span>
                <ArrowRight size={8} className="shrink-0 text-coda-text-muted" />
                <span className="text-emerald-600/80 dark:text-emerald-400/80 truncate max-w-[100px]">
                  {entry.new_value ?? '(none)'}
                </span>
              </div>

              {/* Meta row: who + when */}
              <div className="flex items-center gap-2 text-[9px] text-coda-text-muted">
                <span>{truncateEmail(entry.changed_by)}</span>
                <span>{formatTime(entry.created_at)}</span>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
