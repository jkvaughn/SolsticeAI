import { useState, useEffect } from 'react';
import { Shield, Settings, AlertTriangle, ArrowRightLeft, Fingerprint, Monitor, Loader2 } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { userCallServer } from '../../lib/userClient';
import { useAuth } from '../../contexts/AuthContext';

// ============================================================
// ActivityTimeline — Recent audit log entries for the user
// ============================================================

interface AuditEntry {
  id: string;
  action: string;
  resource_type: string | null;
  details: Record<string, unknown> | null;
  created_at: string;
}

const ACTION_ICONS: Record<string, LucideIcon> = {
  'auth': Shield,
  'settings': Settings,
  'admin': AlertTriangle,
  'transaction': ArrowRightLeft,
  'security': Fingerprint,
  'profile': Settings,
  'session': Monitor,
};

const ACTION_LABELS: Record<string, string> = {
  'auth.login': 'Signed in',
  'auth.logout': 'Signed out',
  'auth.reauth': 'Re-authenticated',
  'profile.update': 'Updated profile',
  'settings.update': 'Changed settings',
  'security.passkey_registered': 'Registered passkey',
  'security.passkey_authenticated': 'Authenticated with passkey',
  'admin.reset_tokens': 'Reset tokens',
  'admin.reset_network': 'Reset network',
  'admin.reassign_custodian': 'Reassigned custodian',
  'admin.faucet': 'Funded wallet',
  'admin.setup_bank': 'Set up bank',
  'session.revoked': 'Revoked session',
};

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

function getIcon(action: string): LucideIcon {
  const prefix = action.split('.')[0];
  return ACTION_ICONS[prefix] || Settings;
}

function getLabel(action: string): string {
  return ACTION_LABELS[action] || action.replace(/[._]/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

export function ActivityTimeline() {
  const { userEmail } = useAuth();
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!userEmail) return;
    userCallServer<{ entries: AuditEntry[] }>('/user/audit-log?limit=10', userEmail)
      .then(data => setEntries(data.entries))
      .catch(() => setEntries([]))
      .finally(() => setLoading(false));
  }, [userEmail]);

  if (loading) {
    return (
      <div className="flex items-center justify-center gap-2 text-xs text-coda-text-muted py-8">
        <Loader2 size={14} className="animate-spin" />
        Loading activity...
      </div>
    );
  }

  if (entries.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-8 text-coda-text-muted">
        <Shield size={24} className="mb-2 opacity-40" />
        <p className="text-xs">No activity recorded yet</p>
      </div>
    );
  }

  return (
    <div className="relative">
      {/* Vertical timeline line */}
      <div className="absolute left-[15px] top-2 bottom-2 w-px bg-black/[0.06] dark:bg-white/[0.06]" />

      <div className="space-y-0.5">
        {entries.map((entry, idx) => {
          const Icon = getIcon(entry.action);
          const label = getLabel(entry.action);
          const isFirst = idx === 0;

          return (
            <div key={entry.id} className="relative flex items-start gap-3 py-2">
              {/* Timeline dot */}
              <div className={`relative z-10 w-[30px] h-[30px] rounded-lg flex items-center justify-center flex-shrink-0 ${
                isFirst
                  ? 'bg-coda-brand/10 text-coda-brand'
                  : 'bg-black/[0.04] dark:bg-white/[0.06] text-coda-text-muted'
              }`}>
                <Icon size={14} />
              </div>

              {/* Content */}
              <div className="flex-1 min-w-0 pt-1">
                <p className={`text-xs font-medium ${isFirst ? 'text-coda-text' : 'text-coda-text-secondary'}`}>
                  {label}
                </p>
                <p className="text-[10px] text-coda-text-muted mt-0.5">
                  {timeAgo(entry.created_at)}
                </p>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
