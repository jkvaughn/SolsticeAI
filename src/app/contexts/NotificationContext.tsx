import React, { createContext, useContext, useState, useEffect, useCallback, useRef, type ReactNode } from 'react';
import { fetchAgentMessages, fetchCadenzaFlags, fetchLockupTokens } from '../dataClient';
import { toast } from 'sonner';
import { usePersona } from './PersonaContext';

// ============================================================
// Notification Context
// ============================================================

export interface Notification {
  id: string;
  type: 'settlement' | 'escalation' | 'flag' | 'cycle' | 'system';
  title: string;
  description: string;
  severity: 'info' | 'warning' | 'critical';
  linkTo?: string;
  read: boolean;
  createdAt: string;
}

interface NotificationContextValue {
  notifications: Notification[];
  unreadCount: number;
  markRead: (id: string) => void;
  markAllRead: () => void;
  isOpen: boolean;
  setIsOpen: (open: boolean) => void;
}

const NotificationContext = createContext<NotificationContextValue>({
  notifications: [],
  unreadCount: 0,
  markRead: () => {},
  markAllRead: () => {},
  isOpen: false,
  setIsOpen: () => {},
});

const ROLE_RELEVANCE: Record<string, string[]> = {
  admin: ['settlement', 'escalation', 'flag', 'cycle', 'system'],
  treasury: ['settlement', 'cycle'],
  compliance: ['escalation', 'flag', 'system'],
  bsa_officer: ['escalation', 'flag', 'system'],
  executive: ['escalation', 'system'],
};

const TOAST_PREF_MAP: Record<string, string> = {
  settlement: 'settlementConfirmations',
  escalation: 'cadenzaEscalations',
  flag: 'cadenzaEscalations',
  cycle: 'treasuryCycleCompletions',
};

function getToastPrefs(): Record<string, boolean> {
  try {
    const raw = localStorage.getItem('coda-notification-prefs');
    return raw ? JSON.parse(raw) : {};
  } catch { return {}; }
}

const isProduction = !!import.meta.env.VITE_SERVER_BASE_URL;
const POLL_INTERVAL = isProduction ? 15_000 : 30_000;

export function NotificationProvider({ children }: { children: ReactNode }) {
  const { persona } = usePersona();
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const seenIds = useRef<Set<string>>(new Set());

  const fetchNotifications = useCallback(async () => {
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const items: Notification[] = [];

    // Fetch from dataClient (routes through REST in production, Supabase in staging)
    let msgs: any[] = [];
    let flags: any[] = [];
    let lockups: any[] = [];
    try {
      msgs = await fetchAgentMessages({ limit: 20 });
    } catch { /* silent */ }
    try {
      flags = await fetchCadenzaFlags({ limit: 20 });
    } catch { /* silent */ }
    try {
      lockups = await fetchLockupTokens({ limit: 10, status: 'escalated' });
    } catch { /* silent */ }

    // agent_messages — settlements & system
    for (const m of msgs || []) {
      const content = m.content || m.natural_language || '';
      const isSettlement = /settl|confirm|complete/i.test(content);
      items.push({
        id: `msg-${m.id}`,
        type: isSettlement ? 'settlement' : 'system',
        title: m.agent_name || m.message_type || 'System',
        description: content.slice(0, 120),
        severity: 'info',
        linkTo: '/transactions',
        read: false,
        createdAt: m.created_at,
      });
    }

    // cadenza_flags — escalations & flags
    for (const f of flags || []) {
      items.push({
        id: `flag-${f.id}`,
        type: f.flag_type === 'escalation' ? 'escalation' : 'flag',
        title: f.flag_type || 'Flag',
        description: (f.reasoning || f.reason || '').slice(0, 120),
        severity: (f.severity as Notification['severity']) || 'warning',
        linkTo: '/escalations',
        read: false,
        createdAt: f.created_at || f.detected_at,
      });
    }

    // lockup_tokens — already filtered by status='escalated' above

    for (const l of lockups || []) {
      items.push({
        id: `lockup-${l.id}`,
        type: 'escalation',
        title: 'Token Escalation',
        description: (l.reason || 'Escalated token lockup').slice(0, 120),
        severity: 'critical',
        linkTo: '/escalations',
        read: false,
        createdAt: l.created_at,
      });
    }

    // Sort by date descending
    items.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    // Filter by role relevance
    const role = persona || 'admin';
    const allowedTypes = ROLE_RELEVANCE[role] || ROLE_RELEVANCE.admin;
    const filtered = items.filter(n => allowedTypes.includes(n.type));

    // Fire toasts for genuinely new items
    const prefs = getToastPrefs();
    for (const n of filtered) {
      if (!seenIds.current.has(n.id)) {
        seenIds.current.add(n.id);
        const prefKey = TOAST_PREF_MAP[n.type];
        if (!prefKey || prefs[prefKey] !== false) {
          toast(n.title, { description: n.description });
        }
      }
    }

    setNotifications(prev => {
      const readIds = new Set(prev.filter(p => p.read).map(p => p.id));
      return filtered.map(n => ({ ...n, read: readIds.has(n.id) }));
    });
  }, [persona]);

  useEffect(() => {
    fetchNotifications();
    const interval = setInterval(fetchNotifications, POLL_INTERVAL);
    return () => clearInterval(interval);
  }, [fetchNotifications]);

  const markRead = useCallback((id: string) => {
    setNotifications(prev => prev.map(n => n.id === id ? { ...n, read: true } : n));
  }, []);

  const markAllRead = useCallback(() => {
    setNotifications(prev => prev.map(n => ({ ...n, read: true })));
  }, []);

  const unreadCount = notifications.filter(n => !n.read).length;

  return (
    <NotificationContext.Provider value={{ notifications, unreadCount, markRead, markAllRead, isOpen, setIsOpen }}>
      {children}
    </NotificationContext.Provider>
  );
}

export function useNotifications() {
  return useContext(NotificationContext);
}
