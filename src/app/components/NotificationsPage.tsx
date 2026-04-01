import { useNavigate } from 'react-router';
import { Bell, ArrowRightLeft, AlertTriangle, Shield, RefreshCw, Info, Check } from 'lucide-react';
import { PageShell } from './PageShell';
import type { PageStat } from './PageShell';
import { useNotifications, type Notification } from '../contexts/NotificationContext';

// ============================================================
// Notifications Page — full notification center
// ============================================================

const TYPE_ICONS: Record<string, React.ElementType> = {
  settlement: ArrowRightLeft,
  escalation: AlertTriangle,
  flag: Shield,
  cycle: RefreshCw,
  system: Info,
};

const SEVERITY_COLORS: Record<string, string> = {
  info: 'text-black/30 dark:text-white/30',
  warning: 'text-amber-500',
  critical: 'text-red-500',
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

export function NotificationsPage() {
  const { notifications, unreadCount, markRead, markAllRead } = useNotifications();
  const navigate = useNavigate();

  const pageStats: PageStat[] = [
    { icon: Bell, value: notifications.length, label: 'Total' },
    { icon: AlertTriangle, value: unreadCount, label: 'Unread' },
    { icon: Shield, value: notifications.filter(n => n.type === 'flag').length, label: 'Flags' },
    { icon: ArrowRightLeft, value: notifications.filter(n => n.type === 'settlement').length, label: 'Settlements' },
  ];

  const handleClick = (n: Notification) => {
    markRead(n.id);
    if (n.linkTo) navigate(n.linkTo);
  };

  return (
    <div className="pb-4">
      <PageShell
        title="Notifications"
        subtitle="Events, alerts, and activity across the network"
        stats={pageStats}
        headerActions={
          unreadCount > 0 ? (
            <button
              onClick={markAllRead}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-coda-text-muted liquid-button cursor-pointer"
            >
              <Check size={12} />
              <span>Mark all read</span>
            </button>
          ) : undefined
        }
      >
        <div className="liquid-glass-card squircle px-8 py-2">
          {notifications.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-black/25 dark:text-white/25">
              <Bell size={32} className="mb-3" />
              <p className="text-sm">No notifications</p>
              <p className="text-xs mt-1">Events will appear here as they happen</p>
            </div>
          ) : (
            <div className="space-y-0">
              {notifications.map((n, idx) => {
                const Icon = TYPE_ICONS[n.type] || Info;
                const severityColor = SEVERITY_COLORS[n.severity] || SEVERITY_COLORS.info;
                return (
                  <button
                    key={n.id}
                    onClick={() => handleClick(n)}
                    className={`w-full flex items-center gap-4 py-4 text-left cursor-pointer transition-colors hover:bg-black/[0.01] dark:hover:bg-white/[0.02] ${
                      idx > 0 ? 'border-t border-black/[0.04] dark:border-white/[0.04]' : ''
                    }`}
                  >
                    {/* Unread dot */}
                    <div className="w-2 flex-shrink-0">
                      {!n.read && <div className="w-2 h-2 rounded-full bg-coda-brand" />}
                    </div>

                    {/* Type icon */}
                    <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${
                      !n.read ? 'bg-coda-brand/10 text-coda-brand' : 'bg-black/[0.03] dark:bg-white/[0.04]'
                    } ${n.read ? severityColor : ''}`}>
                      <Icon size={15} />
                    </div>

                    {/* Content */}
                    <div className="flex-1 min-w-0">
                      <p className={`text-[13px] ${!n.read ? 'font-medium text-black/80 dark:text-white/80' : 'text-black/50 dark:text-white/50'}`}>
                        {n.title}
                      </p>
                      <p className="text-[11px] text-black/35 dark:text-white/35 truncate mt-0.5">
                        {n.description}
                      </p>
                    </div>

                    {/* Time */}
                    <span className="text-[11px] text-black/25 dark:text-white/25 whitespace-nowrap flex-shrink-0">
                      {timeAgo(n.createdAt)}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </PageShell>
    </div>
  );
}
