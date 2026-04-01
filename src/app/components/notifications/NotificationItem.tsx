import { ArrowRightLeft, AlertTriangle, Shield, RefreshCw, Info } from 'lucide-react';
import { useNotifications } from '../../contexts/NotificationContext';
import type { Notification } from '../../contexts/NotificationContext';

const TYPE_ICONS = {
  settlement: ArrowRightLeft,
  escalation: AlertTriangle,
  flag: Shield,
  cycle: RefreshCw,
  system: Info,
} as const;

const SEVERITY_COLORS = {
  info: 'bg-gray-400',
  warning: 'bg-amber-400',
  critical: 'bg-red-500',
} as const;

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'now';
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  return `${Math.floor(hrs / 24)}d`;
}

interface Props {
  notification: Notification;
  onNavigate: (linkTo?: string) => void;
}

export function NotificationItem({ notification, onNavigate }: Props) {
  const { markRead } = useNotifications();
  const Icon = TYPE_ICONS[notification.type] || Info;

  const handleClick = () => {
    markRead(notification.id);
    onNavigate(notification.linkTo);
  };

  return (
    <button
      onClick={handleClick}
      className="w-full flex items-start gap-3 px-4 py-3 cursor-pointer transition-colors hover:bg-black/[0.04] dark:hover:bg-white/[0.04] text-left"
    >
      {/* Unread dot */}
      <div className="flex-shrink-0 mt-1.5">
        {!notification.read ? (
          <span className={`block w-2 h-2 rounded-full ${SEVERITY_COLORS[notification.severity]}`} />
        ) : (
          <span className="block w-2 h-2" />
        )}
      </div>

      {/* Icon */}
      <div className="flex-shrink-0 mt-0.5">
        <Icon size={14} className="text-coda-text-secondary" />
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <p className={`text-[13px] truncate text-coda-text ${!notification.read ? 'font-semibold' : ''}`}>
          {notification.title}
        </p>
        <p className="text-[11px] text-black/40 dark:text-white/40 truncate">
          {notification.description}
        </p>
      </div>

      {/* Time */}
      <span className="flex-shrink-0 text-[11px] text-black/30 dark:text-white/30 mt-0.5">
        {timeAgo(notification.createdAt)}
      </span>
    </button>
  );
}
