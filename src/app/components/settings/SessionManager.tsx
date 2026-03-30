import { useState, useEffect } from 'react';
import { Monitor, Loader2, LogOut, Smartphone, Globe } from 'lucide-react';
import { userCallServer } from '../../lib/userClient';
import { useAuth } from '../../contexts/AuthContext';

interface Session {
  id: string;
  device_name: string;
  ip_address: string;
  last_activity: string;
  created_at: string;
  session_token: string;
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

function deviceIcon(name: string) {
  const lower = name.toLowerCase();
  if (lower.includes('mobile') || lower.includes('iphone') || lower.includes('android')) {
    return Smartphone;
  }
  if (lower.includes('api') || lower.includes('cli')) {
    return Globe;
  }
  return Monitor;
}

export function SessionManager() {
  const { userEmail } = useAuth();
  const [sessions, setSessions] = useState<Session[]>([]);
  const [loading, setLoading] = useState(true);
  const [revokingId, setRevokingId] = useState<string | null>(null);

  const currentToken = sessionStorage.getItem('coda-session-token');

  const fetchSessions = async () => {
    if (!userEmail) return;
    try {
      const data = await userCallServer<{ sessions: Session[] }>('/user/sessions', userEmail);
      setSessions(data.sessions);
    } catch {
      setSessions([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchSessions(); }, [userEmail]);

  const revokeSession = async (id: string) => {
    if (!userEmail) return;
    setRevokingId(id);
    try {
      await userCallServer('/user/sessions/' + id, userEmail, 'DELETE');
      setSessions(prev => prev.filter(s => s.id !== id));
    } catch {
      // Silent fail
    } finally {
      setRevokingId(null);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-xs text-coda-text-muted py-4">
        <Loader2 size={12} className="animate-spin" />
        Loading sessions...
      </div>
    );
  }

  if (sessions.length === 0) {
    return (
      <p className="text-xs text-coda-text-muted py-2">
        No active sessions found.
      </p>
    );
  }

  return (
    <div className="space-y-1.5">
      {sessions.map(session => {
        const isCurrent = currentToken && session.session_token === currentToken;
        const Icon = deviceIcon(session.device_name);

        return (
          <div
            key={session.id}
            className="flex items-center justify-between px-3 py-2.5 rounded-lg bg-black/[0.02] dark:bg-white/[0.04]"
          >
            <div className="flex items-center gap-3 min-w-0 flex-1">
              <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 bg-black/[0.04] dark:bg-white/[0.06]">
                <Icon size={14} className="text-coda-text-muted" />
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-medium text-coda-text truncate">
                    {session.device_name || 'Unknown device'}
                  </span>
                  {isCurrent && (
                    <span className="flex-shrink-0 px-1.5 py-0.5 rounded text-[8px] font-bold bg-emerald-500/10 text-emerald-500">
                      CURRENT
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2 text-[10px] text-coda-text-muted mt-0.5">
                  <span>{session.ip_address}</span>
                  <span className="opacity-40">|</span>
                  <span>Active {timeAgo(session.last_activity)}</span>
                </div>
              </div>
            </div>

            {!isCurrent && (
              <button
                onClick={() => revokeSession(session.id)}
                disabled={revokingId === session.id}
                className="flex-shrink-0 flex items-center gap-1 px-2 py-1 text-[10px] font-medium text-red-400 hover:text-red-500 hover:bg-red-500/10 rounded transition-colors cursor-pointer"
              >
                {revokingId === session.id ? (
                  <Loader2 size={10} className="animate-spin" />
                ) : (
                  <LogOut size={10} />
                )}
                Revoke
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}
