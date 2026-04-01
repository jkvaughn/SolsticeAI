import { Bell } from 'lucide-react';
import { useNotifications } from '../../contexts/NotificationContext';

export function NotificationBell() {
  const { unreadCount, isOpen, setIsOpen } = useNotifications();

  return (
    <button
      onClick={() => setIsOpen(!isOpen)}
      className="w-8 h-8 rounded-lg flex items-center justify-center cursor-pointer relative transition-colors hover:bg-black/10 dark:hover:bg-white/10"
      aria-label="Notifications"
    >
      <Bell size={18} className="text-coda-text-secondary" />
      {unreadCount > 0 && (
        <span className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-red-500 text-[9px] font-bold text-white flex items-center justify-center shadow-md">
          {unreadCount > 9 ? '9+' : unreadCount}
        </span>
      )}
    </button>
  );
}
