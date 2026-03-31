import { Shield, Settings, AlertTriangle, ArrowRightLeft, Fingerprint, Monitor } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { userCallServer } from '../../lib/userClient';
import { useAuth } from '../../contexts/AuthContext';
import { useSWRCache } from '../../hooks/useSWRCache';

// ============================================================
// ActivityTimeline — Recent audit log, grouped and formatted
// ============================================================

interface AuditEntry {
  id: string;
  action: string;
  resource_type: string | null;
  details: Record<string, unknown> | null;
  ip_address: string | null;
  created_at: string;
}

interface GroupedEntry {
  action: string;
  label: string;
  icon: LucideIcon;
  count: number;
  latest: string;
  detail: string | null;
}

const ACTION_ICONS: Record<string, LucideIcon> = {
  'auth': Shield, 'settings': Settings, 'admin': AlertTriangle,
  'transaction': ArrowRightLeft, 'security': Fingerprint,
  'profile': Settings, 'session': Monitor,
};

const ACTION_LABELS: Record<string, string> = {
  'auth.login': 'Signed in',
  'auth.logout': 'Signed out',
  'auth.reauth': 'Re-authenticated',
  'profile.update': 'Updated profile',
  'settings.update': 'Changed settings',
  'security.passkey_registered': 'Registered passkey',
  'security.passkey_authenticated': 'Passkey auth',
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
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function getIcon(action: string): LucideIcon {
  return ACTION_ICONS[action.split('.')[0]] || Settings;
}

function getLabel(action: string): string {
  return ACTION_LABELS[action] || action.replace(/[._]/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

function getDetail(entry: AuditEntry): string | null {
  const d = entry.details;
  if (!d) return null;
  if (d.device_name) return String(d.device_name);
  if (d.amount) return `${d.amount} ${d.gasToken || 'SOL'}`;
  if (d.stage) return String(d.stage);
  if (d.new_custodian) return `→ ${d.new_custodian}`;
  return null;
}

/** Group consecutive identical actions */
function groupEntries(entries: AuditEntry[]): GroupedEntry[] {
  const groups: GroupedEntry[] = [];
  for (const entry of entries) {
    const last = groups[groups.length - 1];
    if (last && last.action === entry.action) {
      last.count++;
    } else {
      groups.push({
        action: entry.action,
        label: getLabel(entry.action),
        icon: getIcon(entry.action),
        count: 1,
        latest: entry.created_at,
        detail: getDetail(entry),
      });
    }
  }
  return groups.slice(0, 8);
}

// ── Skeleton ──

function ActivitySkeleton() {
  return (
    <div className="animate-pulse space-y-0">
      {[0, 1, 2, 3].map(i => (
        <div key={i} className={`flex items-center gap-3 py-3 ${i > 0 ? 'border-t border-black/[0.04] dark:border-white/[0.04]' : ''}`}>
          <div className="w-8 h-8 rounded-lg bg-black/[0.04] dark:bg-white/[0.04]" />
          <div className="flex-1 space-y-1">
            <div className="h-3 w-24 rounded bg-black/[0.04] dark:bg-white/[0.04]" />
          </div>
          <div className="h-2.5 w-12 rounded bg-black/[0.04] dark:bg-white/[0.04]" />
        </div>
      ))}
    </div>
  );
}

export function ActivityTimeline() {
  const { userEmail } = useAuth();

  const { data: entries, isValidating } = useSWRCache<AuditEntry[]>({
    key: `activity-timeline-${userEmail ?? 'none'}`,
    fetcher: async () => {
      if (!userEmail) throw new Error('No user email');
      const data = await userCallServer<{ entries: AuditEntry[] }>('/user/audit-log?limit=20', userEmail);
      return data.entries;
    },
  });

  const loading = isValidating && !entries;

  if (loading) return <ActivitySkeleton />;

  if (!entries || entries.length === 0) {
    return (
      <div className="flex items-center gap-3 py-4 text-black/30 dark:text-white/30">
        <Shield size={16} />
        <p className="text-[12px]">No activity recorded yet</p>
      </div>
    );
  }

  const grouped = groupEntries(entries);

  return (
    <div className="animate-fadeIn space-y-0">
      {grouped.map((group, idx) => {
        const Icon = group.icon;
        return (
          <div
            key={`${group.action}-${idx}`}
            className={`flex items-center gap-3 py-3 ${idx > 0 ? 'border-t border-black/[0.04] dark:border-white/[0.04]' : ''}`}
          >
            <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${
              idx === 0 ? 'bg-coda-brand/10 text-coda-brand' : 'bg-black/[0.03] dark:bg-white/[0.04] text-black/30 dark:text-white/30'
            }`}>
              <Icon size={14} />
            </div>
            <div className="flex-1 min-w-0">
              <span className={`text-[13px] ${idx === 0 ? 'text-black/70 dark:text-white/70' : 'text-black/50 dark:text-white/50'}`}>
                {group.label}
              </span>
              {group.count > 1 && (
                <span className="ml-1.5 text-[10px] text-black/25 dark:text-white/25">
                  ×{group.count}
                </span>
              )}
              {group.detail && (
                <span className="ml-2 text-[11px] text-black/25 dark:text-white/25 font-mono">
                  {group.detail}
                </span>
              )}
            </div>
            <span className="text-[11px] text-black/30 dark:text-white/30 whitespace-nowrap">
              {timeAgo(group.latest)}
            </span>
          </div>
        );
      })}
    </div>
  );
}
