import { useState, useCallback } from 'react';
import { useNavigate } from 'react-router';
import { useTheme } from './ThemeProvider';
import { useAuth } from '../contexts/AuthContext';
import { PageHeader } from './PageHeader';
import { PageTransition } from './PageTransition';
import {
  LogOut, User, Mail, Calendar, Shield, ChevronRight, UserCircle
} from 'lucide-react';

// ============================================================
// Profile Page — Account info & sign out
// ============================================================

export function ProfilePage() {
  const { resolved } = useTheme();
  const isDark = resolved === 'dark';
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  const [signOutConfirm, setSignOutConfirm] = useState(false);

  const handleSignOut = useCallback(async () => {
    await signOut();
    navigate('/login');
  }, [signOut, navigate]);

  const joinedDate = user?.created_at
    ? new Date(user.created_at).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
    : null;

  return (
    <div className="max-w-2xl mx-auto space-y-8 pb-12">
      <PageHeader
        icon={UserCircle}
        title="Profile"
        subtitle="Your account information and session"
      />

      <PageTransition className="space-y-8">
        {/* ─── Account Info ─── */}
        <ProfileSection title="Account" desc="Your profile and session">
          <div className={`rounded-xl border p-5 space-y-4 ${
            isDark ? 'bg-white/[0.03] border-white/[0.06]' : 'bg-black/[0.02] border-black/[0.04]'
          }`}>
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 rounded-xl bg-coda-brand/12 border border-coda-brand/20 flex items-center justify-center flex-shrink-0">
                <span className="text-lg font-bold text-coda-brand uppercase">
                  {(user?.user_metadata?.name || user?.email || '?')[0]}
                </span>
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-[15px] font-medium text-coda-text truncate">
                  {user?.user_metadata?.name || 'User'}
                </p>
                <p className="text-[12px] text-coda-text-muted font-mono truncate">{user?.email}</p>
              </div>
            </div>

            <div className={`h-px ${isDark ? 'bg-white/[0.06]' : 'bg-black/[0.05]'}`} />

            <div className="space-y-3">
              <AccountRow icon={Mail} label="Email" value={user?.email || '—'} />
              <AccountRow icon={Shield} label="Role" value="Administrator" />
              {joinedDate && <AccountRow icon={Calendar} label="Joined" value={joinedDate} />}
              <AccountRow icon={User} label="User ID" value={user?.id?.slice(0, 12) + '...' || '—'} mono />
            </div>
          </div>

          {/* Sign out */}
          <div className="pt-2">
            {!signOutConfirm ? (
              <button
                onClick={() => setSignOutConfirm(true)}
                className={`w-full flex items-center justify-between px-4 py-3 rounded-xl border transition-all duration-300 cursor-pointer group ${
                  isDark
                    ? 'bg-white/[0.03] border-white/[0.06] hover:bg-red-500/8 hover:border-red-500/20'
                    : 'bg-black/[0.02] border-black/[0.04] hover:bg-red-500/5 hover:border-red-500/15'
                }`}
              >
                <span className="flex items-center gap-3">
                  <LogOut size={16} className="text-coda-text-muted group-hover:text-red-500 dark:group-hover:text-red-400 transition-colors" />
                  <span className="text-[13px] text-coda-text-secondary group-hover:text-red-600 dark:group-hover:text-red-400 transition-colors">
                    Sign Out
                  </span>
                </span>
                <ChevronRight size={14} className="text-coda-text-muted" />
              </button>
            ) : (
              <div className={`flex items-center gap-3 px-4 py-3 rounded-xl border ${
                isDark ? 'bg-red-500/8 border-red-500/20' : 'bg-red-50 border-red-500/15'
              }`}>
                <span className="text-[12px] text-red-600 dark:text-red-400 flex-1">End your session?</span>
                <button
                  onClick={() => setSignOutConfirm(false)}
                  className={`px-3 py-1.5 rounded-lg text-[11px] font-medium cursor-pointer transition-colors ${
                    isDark ? 'text-gray-300 hover:bg-white/10' : 'text-gray-600 hover:bg-black/5'
                  }`}
                >
                  Cancel
                </button>
                <button
                  onClick={handleSignOut}
                  className="px-3 py-1.5 rounded-lg text-[11px] font-medium bg-red-500 text-white hover:bg-red-600 cursor-pointer transition-colors"
                >
                  Sign Out
                </button>
              </div>
            )}
          </div>
        </ProfileSection>
      </PageTransition>
    </div>
  );
}

function ProfileSection({ title, desc, children }: { title: string; desc: string; children: React.ReactNode }) {
  return (
    <section>
      <div className="mb-4">
        <h2 className="text-[15px] font-medium text-coda-text">{title}</h2>
        <p className="text-[11px] text-coda-text-muted mt-0.5">{desc}</p>
      </div>
      {children}
    </section>
  );
}

function AccountRow({ icon: Icon, label, value, mono }: { icon: React.ElementType; label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-center gap-3">
      <Icon size={14} className="text-coda-text-muted shrink-0" />
      <span className="text-[11px] text-coda-text-muted w-16 shrink-0">{label}</span>
      <span className={`text-[12px] text-coda-text-secondary truncate ${mono ? 'font-mono' : ''}`}>{value}</span>
    </div>
  );
}
