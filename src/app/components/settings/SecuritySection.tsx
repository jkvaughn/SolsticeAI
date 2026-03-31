import { useState, useEffect } from 'react';
import { Shield, Clock, Loader2 } from 'lucide-react';
import { userCallServer } from '../../lib/userClient';
import { useAuth } from '../../contexts/AuthContext';
import { WidgetShell } from '../dashboard/WidgetShell';
import { PasskeyRegistration } from '../admin/PasskeyRegistration';
import { SessionManager } from './SessionManager';

// ============================================================
// Security Section — Passkeys, Sessions, Login History
// ============================================================

interface LoginEntry {
  id: string;
  action: string;
  details: Record<string, string> | null;
  created_at: string;
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}

function LoginHistory() {
  const { userEmail } = useAuth();
  const [entries, setEntries] = useState<LoginEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!userEmail) return;
    userCallServer<{ entries: LoginEntry[] }>('/user/login-history', userEmail)
      .then(data => setEntries(data.entries))
      .catch(() => setEntries([]))
      .finally(() => setLoading(false));
  }, [userEmail]);

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-xs text-coda-text-muted py-4">
        <Loader2 size={12} className="animate-spin" />
        Loading history...
      </div>
    );
  }

  if (entries.length === 0) {
    return (
      <p className="text-xs text-coda-text-muted py-2">
        No login history recorded yet.
      </p>
    );
  }

  return (
    <div className="space-y-1.5">
      {entries.map(entry => (
        <div
          key={entry.id}
          className="flex items-center justify-between px-3 py-2 rounded-lg bg-black/[0.02] dark:bg-white/[0.04]"
        >
          <div className="flex items-center gap-2 min-w-0">
            <Clock size={12} className="text-coda-text-muted flex-shrink-0" />
            <span className="text-xs text-coda-text truncate">
              {entry.action}
            </span>
          </div>
          <div className="flex items-center gap-2 text-[10px] text-coda-text-muted flex-shrink-0">
            {entry.details?.device && (
              <span className="hidden sm:inline">{entry.details.device}</span>
            )}
            <span>{timeAgo(entry.created_at)}</span>
          </div>
        </div>
      ))}
    </div>
  );
}

export function SecuritySection() {
  return (
    <WidgetShell title="Security" icon={Shield}>
      <div className="space-y-6">
        {/* Passkey Management */}
        <div>
          <PasskeyRegistration />
        </div>

        {/* Active Sessions */}
        <div className="pt-4 border-t border-black/[0.06] dark:border-white/[0.06]">
          <p className="text-[11px] font-medium text-coda-text-muted mb-3">Active Sessions</p>
          <SessionManager />
        </div>

        {/* Login History */}
        <div className="pt-4 border-t border-black/[0.06] dark:border-white/[0.06]">
          <p className="text-[11px] font-medium text-coda-text-muted mb-3">Recent Login History</p>
          <LoginHistory />
        </div>
      </div>
    </WidgetShell>
  );
}
