import { Bell } from 'lucide-react';
import { useNotifications } from '../../contexts/NotificationContext';
import { NotificationItem } from './NotificationItem';
import { useNavigate } from 'react-router';

export function NotificationPanel() {
  const { notifications, markAllRead, setIsOpen, isOpen } = useNotifications();
  const navigate = useNavigate();

  if (!isOpen) return null;

  const handleNavigate = (linkTo?: string) => {
    setIsOpen(false);
    if (linkTo) navigate(linkTo);
  };

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 z-40" onClick={() => setIsOpen(false)} />

      {/* Panel */}
      <div className="absolute top-full left-0 mt-2 w-[340px] z-50 liquid-glass-card squircle overflow-hidden shadow-2xl border border-white/20 dark:border-white/10 backdrop-blur-xl bg-white/20 dark:bg-white/5">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-black/[0.06] dark:border-white/[0.06]">
          <span className="text-[13px] font-semibold text-coda-text">Notifications</span>
          <button
            onClick={markAllRead}
            className="text-[11px] text-coda-text-secondary hover:text-coda-text cursor-pointer transition-colors"
          >
            Mark all read
          </button>
        </div>

        {/* List */}
        <div className="max-h-[400px] overflow-y-auto">
          {notifications.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-10 gap-2 text-coda-text-secondary">
              <Bell size={24} className="opacity-30" />
              <span className="text-[12px]">No notifications</span>
            </div>
          ) : (
            notifications.map(n => (
              <NotificationItem key={n.id} notification={n} onNavigate={handleNavigate} />
            ))
          )}
        </div>
      </div>
    </>
  );
}
