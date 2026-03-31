import { useState, useEffect, useCallback, useMemo } from 'react';
import { useTheme, type ThemePreference } from './ThemeProvider';
import { useAuth } from '../contexts/AuthContext';
import { useBanks } from '../contexts/BanksContext';
import { usePersona } from '../contexts/PersonaContext';
import { useCurrentUser } from '../hooks/useCurrentUser';
import { useIsAdmin } from '../hooks/useIsAdmin';
import { useUserProfile } from '../hooks/useUserProfile';
import { useSWRCache } from '../hooks/useSWRCache';
import { PageShell } from './PageShell';
import type { PageStat, PageTab } from './PageShell';
import { PersonaSwitcher } from './PersonaSwitcher';
import { ProfileEditor } from './profile/ProfileEditor';
import { ActivityTimeline } from './profile/ActivityTimeline';
import { SecuritySection } from './settings/SecuritySection';
import { motion } from './motion-shim';
import { supabase } from '../supabaseClient';
import { userCallServer } from '../lib/userClient';
import {
  Shield, Layers, Wifi, Bell, BellOff,
  Sun, Moon, Monitor, Globe,
  Timer, Maximize2, Minimize2,
  LogOut, ShieldCheck, BarChart3, Clock, Activity,
  Check, Copy,
} from 'lucide-react';

// ============================================================
// Unified Settings Page — Profile, Security, Appearance,
//   Network, Notifications (Claude.ai-style left sidebar nav)
// ============================================================

type SettingsSection = 'profile' | 'security' | 'appearance' | 'network' | 'notifications';
type Density = 'default' | 'compact';
type RefreshInterval = '5' | '10' | '30' | 'off';

interface NotificationPrefs {
  settlementConfirmations: boolean;
  cadenzaEscalations: boolean;
  orphanedTransactionAlerts: boolean;
  treasuryCycleCompletions: boolean;
}

const DEFAULT_NOTIFICATION_PREFS: NotificationPrefs = {
  settlementConfirmations: true,
  cadenzaEscalations: true,
  orphanedTransactionAlerts: true,
  treasuryCycleCompletions: false,
};

// ── Tab definitions (reuses PageShell pill tabs) ──

const SETTINGS_TABS: PageTab[] = [
  { id: 'profile',       label: 'Profile' },
  { id: 'security',      label: 'Security' },
  { id: 'appearance',    label: 'Appearance' },
  { id: 'network',       label: 'Network' },
  { id: 'notifications', label: 'Notifications' },
];

// ── localStorage helpers ──

function loadNotificationPrefs(): NotificationPrefs {
  try {
    const raw = localStorage.getItem('coda-notification-prefs');
    if (raw) return { ...DEFAULT_NOTIFICATION_PREFS, ...JSON.parse(raw) };
  } catch {}
  return { ...DEFAULT_NOTIFICATION_PREFS };
}

function loadDensity(): Density {
  try {
    const v = localStorage.getItem('coda-density-preference');
    if (v === 'compact') return 'compact';
  } catch {}
  return 'default';
}

function loadRefreshInterval(): RefreshInterval {
  try {
    const v = localStorage.getItem('coda-refresh-interval');
    if (v === '5' || v === '10' || v === '30' || v === 'off') return v;
  } catch {}
  return '10';
}

// ============================================================
// Main Component
// ============================================================

export function SettingsPage() {
  const { resolved, preference, setTheme } = useTheme();
  const isDark = resolved === 'dark';
  const { user, userEmail, signOut } = useAuth();
  const { banks } = useBanks();
  const currentUser = useCurrentUser();
  const isAdmin = useIsAdmin();
  const { profile, isLoading: profileLoading, updateProfile } = useUserProfile();

  const [section, setSection] = useState<SettingsSection>('profile');

  // ── Profile stats (SWR-cached) ──
  interface ProfileStats { escalations: number; settlements: number; pendingActions: number; totalVolume: number; }
  const { data: statsData, isValidating: statsLoading } = useSWRCache<ProfileStats>({
    key: 'settings-profile-stats',
    fetcher: async () => {
      const [escRes, settRes, pendingRes, volumeRes] = await Promise.all([
        supabase.from('lockup_tokens').select('id', { count: 'exact', head: true }).like('resolved_by', 'operator:%'),
        supabase.from('transactions').select('id', { count: 'exact', head: true }).eq('status', 'settled'),
        supabase.from('transactions').select('id', { count: 'exact', head: true }).in('status', ['pending', 'processing', 'lockup']),
        supabase.from('transactions').select('amount').eq('status', 'settled'),
      ]);
      const vol = (volumeRes.data ?? []).reduce((sum: number, t: any) => sum + (Number(t.amount) || 0), 0);
      return { escalations: escRes.count ?? 0, settlements: settRes.count ?? 0, pendingActions: pendingRes.count ?? 0, totalVolume: vol };
    },
  });
  const escalations = statsData?.escalations ?? null;
  const settlements = statsData?.settlements ?? null;
  const totalVolume = statsData?.totalVolume ?? null;

  // ── Security stat (SWR-cached) ──
  const { data: passkeyData } = useSWRCache<{ count: number }>({
    key: `settings-passkey-${userEmail ?? 'none'}`,
    fetcher: async () => {
      if (!userEmail) throw new Error('No user email');
      const data = await userCallServer<{ has_passkeys: boolean; passkeys: unknown[] }>('/user/passkey-status', userEmail);
      return { count: data.passkeys?.length ?? 0 };
    },
  });
  const passkeyCount = passkeyData?.count ?? null;

  // ── Recent escalations (SWR-cached) ──
  interface EscalationRow { id: string; sender_bank_id: string; receiver_bank_id: string; resolution: string; resolved_at: string; }
  const { data: recentEscalations, isValidating: escalationsLoading } = useSWRCache<EscalationRow[]>({
    key: 'settings-recent-escalations',
    fetcher: async () => {
      const { data } = await supabase
        .from('lockup_tokens')
        .select('id, transaction_id, sender_bank_id, receiver_bank_id, resolution, resolved_at')
        .like('resolved_by', 'operator:%')
        .order('resolved_at', { ascending: false })
        .limit(5);
      return (data as EscalationRow[]) ?? [];
    },
  });

  const bankCode = useCallback((id: string) => banks.find(b => b.id === id)?.short_code ?? id.slice(0, 6), [banks]);

  // ── Clipboard ──
  const [copied, setCopied] = useState(false);
  const copyUserId = useCallback(() => {
    navigator.clipboard.writeText(currentUser.userId).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }, [currentUser.userId]);

  // ── Sign out ──
  const [signOutConfirm, setSignOutConfirm] = useState(false);
  const handleSignOut = useCallback(async () => {
    await signOut();
    window.location.href = '/login';
  }, [signOut]);

  // ── Appearance state ──
  const [density, setDensityState] = useState<Density>(loadDensity);
  const setDensity = useCallback((d: Density) => {
    setDensityState(d);
    try { localStorage.setItem('coda-density-preference', d); } catch {}
    if (d === 'compact') document.documentElement.setAttribute('data-density', 'compact');
    else document.documentElement.removeAttribute('data-density');
  }, []);
  useEffect(() => { if (loadDensity() === 'compact') document.documentElement.setAttribute('data-density', 'compact'); }, []);

  // ── Network state ──
  const [refreshInterval, setRefreshIntervalState] = useState<RefreshInterval>(loadRefreshInterval);
  const isProductionCluster = (import.meta.env.VITE_SOLANA_CLUSTER || 'devnet') === 'mainnet-beta';
  const handleRefreshInterval = useCallback((val: RefreshInterval) => {
    setRefreshIntervalState(val);
    try { localStorage.setItem('coda-refresh-interval', val); } catch {}
  }, []);

  // ── Notification state ──
  const [notifPrefs, setNotifPrefs] = useState<NotificationPrefs>(loadNotificationPrefs);
  const toggleNotif = useCallback((key: keyof NotificationPrefs) => {
    setNotifPrefs(prev => {
      const next = { ...prev, [key]: !prev[key] };
      try { localStorage.setItem('coda-notification-prefs', JSON.stringify(next)); } catch {}
      return next;
    });
  }, []);

  // ── Profile helpers ──
  const profileName = profile?.full_name || currentUser.name;
  const initials = profileName.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2) || currentUser.avatarInitials;

  const formatVolume = (raw: number) => {
    const v = raw / 1_000_000;
    if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)}M`;
    if (v >= 1_000) return `$${(v / 1_000).toFixed(0)}K`;
    return `$${v.toFixed(0)}`;
  };

  // ── Page stats ──
  const securityValue = passkeyCount === null || passkeyCount === 0 ? 'Not set up' : `${passkeyCount} passkey${passkeyCount > 1 ? 's' : ''}`;
  const pageStats: PageStat[] = [
    { icon: Activity, value: totalVolume !== null ? formatVolume(totalVolume) : '...', label: 'Total Volume' },
    { icon: ShieldCheck, value: escalations !== null ? String(escalations) : '...', label: 'Escalations Resolved' },
    { icon: BarChart3, value: settlements !== null ? String(settlements) : '...', label: 'Total Settlements' },
    { icon: Shield, value: securityValue, label: 'Security' },
  ];

  // ── Theme options ──
  const themeOptions: { pref: ThemePreference; icon: React.ElementType; label: string; desc: string }[] = [
    { pref: 'light', icon: Sun, label: 'Light', desc: 'Bright LiquidGlass appearance' },
    { pref: 'dark', icon: Moon, label: 'Dark', desc: 'Reduced-light glass appearance' },
    { pref: 'auto', icon: Monitor, label: 'Auto', desc: 'Match your OS preference' },
  ];

  const refreshOptions: { value: RefreshInterval; label: string }[] = [
    { value: '5', label: '5s' }, { value: '10', label: '10s' }, { value: '30', label: '30s' }, { value: 'off', label: 'Off' },
  ];

  const notifItems: { key: keyof NotificationPrefs; label: string; desc: string }[] = [
    { key: 'settlementConfirmations', label: 'Settlement confirmations', desc: 'Notify when a Solana settlement finalizes on-chain' },
    { key: 'cadenzaEscalations', label: 'Cadenza escalations', desc: 'Alert when Cadenza flags a transaction for human review' },
    { key: 'orphanedTransactionAlerts', label: 'Orphaned transaction alerts', desc: 'Warn about transactions missing counterpart records' },
    { key: 'treasuryCycleCompletions', label: 'Treasury cycle completions', desc: 'Notify when a full treasury sweep cycle completes' },
  ];

  return (
    <div className="pb-4">
      <PageShell
        title="Settings"
        subtitle="Profile, security, and preferences"
        stats={pageStats}
        tabs={SETTINGS_TABS}
        activeTab={section}
        onTabChange={id => setSection(id as SettingsSection)}
      >
        <div className="liquid-glass-card squircle px-8 py-2">
            <motion.div
              key={section}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.2 }}
            >
              {/* ── Profile (XD-style horizontal form layout) ── */}
              {section === 'profile' && (
                <div className="space-y-0">
                  {/* ── Personal Information ── */}
                  <div className="flex gap-8 py-8 border-b border-black/[0.06] dark:border-white/[0.06]">
                    <div className="w-48 shrink-0 pt-0">
                      <h4 className="text-[15px] font-normal text-black/70 dark:text-white/70">Personal Information</h4>
                    </div>
                    <div className="flex-1">
                      {profileLoading ? (
                        <ProfileSkeleton />
                      ) : profile ? (
                        <div className="animate-fadeIn">
                          <ProfileEditor profile={profile} onUpdate={updateProfile} email={currentUser.email} />
                        </div>
                      ) : (
                        <ProfileEditorFallback name={profileName} email={currentUser.email} />
                      )}
                    </div>
                  </div>

                  {/* ── Account ── */}
                  <div className="flex gap-8 py-8 border-b border-black/[0.06] dark:border-white/[0.06]">
                    <div className="w-48 shrink-0 pt-0">
                      <h4 className="text-[15px] font-normal text-black/70 dark:text-white/70">Account</h4>
                    </div>
                    <div className="flex-1 space-y-4 animate-fadeIn">
                      <div className="flex gap-4">
                        {currentUser.userId && (
                          <div className="flex-1">
                            <label className="block text-[12px] font-normal text-black/40 dark:text-white/40 mb-1">Account ID</label>
                            <div className="flex items-center gap-2 px-4 py-3 bg-black/[0.03] dark:bg-white/[0.04] rounded-lg">
                              <span className="font-mono text-sm text-coda-text-secondary">
                                {currentUser.userId.slice(0, 8)}...{currentUser.userId.slice(-4)}
                              </span>
                              <button onClick={copyUserId} className="p-0.5 cursor-pointer ml-auto" title="Copy account ID">
                                {copied ? <Check size={12} className="text-emerald-500" /> : <Copy size={12} className="text-coda-text-muted" />}
                              </button>
                            </div>
                          </div>
                        )}
                        <div className="flex-1">
                          <label className="block text-[12px] font-normal text-black/40 dark:text-white/40 mb-1">Auth Provider</label>
                          <div className="flex items-center gap-2 px-4 py-3 bg-black/[0.03] dark:bg-white/[0.04] rounded-lg">
                            <span className="text-sm text-coda-text">{currentUser.provider}</span>
                            {isAdmin && (
                              <span className="text-[8px] font-bold text-coda-brand bg-coda-brand/10 px-1.5 py-0.5 rounded ml-auto">ADMIN</span>
                            )}
                          </div>
                        </div>
                      </div>
                      <div className="flex gap-4 items-end">
                        <div className="flex-1">
                          <label className="block text-[12px] font-normal text-black/40 dark:text-white/40 mb-1">Status</label>
                          <div className="flex items-center gap-2 px-4 py-3 bg-black/[0.03] dark:bg-white/[0.04] rounded-lg">
                            <span className="relative flex h-3 w-3 items-center justify-center">
                              <span className="animate-ping absolute inline-flex h-2 w-2 rounded-full bg-green-400 opacity-75" />
                              <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-green-500" />
                            </span>
                            <span className="text-sm text-coda-text">Online</span>
                          </div>
                        </div>
                        <div className="flex-1 flex justify-end">
                          {!signOutConfirm ? (
                            <button
                              onClick={() => setSignOutConfirm(true)}
                              className="flex items-center gap-1.5 px-4 py-2.5 text-[13px] text-black/30 dark:text-white/30 hover:text-red-500 dark:hover:text-red-400 transition-colors cursor-pointer"
                            >
                              <LogOut size={14} />
                              <span>Sign Out</span>
                            </button>
                          ) : (
                            <div className="flex items-center gap-2">
                              <span className="text-xs text-red-500">End session?</span>
                              <button onClick={() => setSignOutConfirm(false)} className="px-2.5 py-1.5 text-xs text-black/40 dark:text-white/40 cursor-pointer"><span>Cancel</span></button>
                              <button onClick={handleSignOut} className="px-2.5 py-1.5 text-xs font-medium text-red-500 cursor-pointer"><span>Sign Out</span></button>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* ── Activity ── */}
                  <div className="flex gap-8 py-8 border-b border-black/[0.06] dark:border-white/[0.06]">
                    <div className="w-48 shrink-0 pt-0">
                      <h4 className="text-[15px] font-normal text-black/70 dark:text-white/70">Activity</h4>
                    </div>
                    <div className="flex-1">
                      <ActivityTimeline />
                    </div>
                  </div>

                  {/* ── Recent Escalations ── */}
                  {(escalationsLoading && !recentEscalations) ? (
                    <div className="flex gap-8 py-8 border-b border-black/[0.06] dark:border-white/[0.06]">
                      <div className="w-48 shrink-0 pt-0">
                        <h4 className="text-[15px] font-normal text-black/70 dark:text-white/70">Recent Escalations</h4>
                      </div>
                      <div className="flex-1">
                        <EscalationsSkeleton />
                      </div>
                    </div>
                  ) : (recentEscalations && recentEscalations.length > 0) && (
                    <div className="flex gap-8 py-8 border-b border-black/[0.06] dark:border-white/[0.06]">
                      <div className="w-48 shrink-0 pt-0">
                        <h4 className="text-[15px] font-normal text-black/70 dark:text-white/70">Recent Escalations</h4>
                      </div>
                      <div className="flex-1 animate-fadeIn space-y-0">
                        {recentEscalations.map((row, idx) => (
                          <div key={row.id} className={`flex items-center gap-3 py-3 ${idx > 0 ? 'border-t border-black/[0.04] dark:border-white/[0.04]' : ''}`}>
                            <div className="flex-1 min-w-0">
                              <span className="text-[13px] text-black/60 dark:text-white/60">
                                {bankCode(row.sender_bank_id)} → {bankCode(row.receiver_bank_id)}
                              </span>
                            </div>
                            <span className="text-[11px] text-black/30 dark:text-white/30 font-mono">
                              {row.resolution === 'operator_settled' ? 'Settled' : row.resolution.replace(/_/g, ' ')}
                            </span>
                            <span className="text-[11px] text-black/25 dark:text-white/25 whitespace-nowrap">
                              {row.resolved_at ? new Date(row.resolved_at).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—'}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* ── Defaults & Preferences ── */}
                  <div className="flex gap-8 py-8">
                    <div className="w-48 shrink-0 pt-0">
                      <h4 className="text-[15px] font-normal text-black/70 dark:text-white/70">Defaults & Preferences</h4>
                    </div>
                    <div className="flex-1">
                      <PersonaSwitcher />
                    </div>
                  </div>
                </div>
              )}

              {/* ── Security ── */}
              {section === 'security' && <SecuritySection />}

              {/* ── Appearance ── */}
              {section === 'appearance' && (
                <div className="space-y-0">
                  <div className="flex gap-8 py-8 border-b border-black/[0.06] dark:border-white/[0.06]">
                    <div className="w-48 shrink-0 pt-0">
                      <h4 className="text-[15px] font-normal text-black/70 dark:text-white/70">Theme</h4>
                    </div>
                    <div className="flex-1">
                      <div className="grid grid-cols-3 gap-3">
                        {themeOptions.map(opt => {
                          const Icon = opt.icon;
                          const active = preference === opt.pref;
                          return (
                            <button
                              key={opt.pref}
                              onClick={() => setTheme(opt.pref)}
                              className={`relative flex flex-col items-start p-5 text-left rounded-xl cursor-pointer transition-all duration-200 ${
                                active
                                  ? 'bg-black/[0.04] dark:bg-white/[0.06] ring-1 ring-black/[0.08] dark:ring-white/[0.1]'
                                  : 'bg-transparent ring-1 ring-black/[0.04] dark:ring-white/[0.04] hover:bg-black/[0.02] dark:hover:bg-white/[0.03] hover:ring-black/[0.08] dark:hover:ring-white/[0.08]'
                              }`}
                            >
                              <Icon size={20} className={`mb-3 ${active ? 'text-black/70 dark:text-white/70' : 'text-black/25 dark:text-white/25'}`} />
                              <p className={`text-[15px] mb-1 ${active ? 'font-medium text-black/80 dark:text-white/80' : 'text-black/50 dark:text-white/50'}`}>{opt.label}</p>
                              <p className={`text-[11px] leading-relaxed ${active ? 'text-black/40 dark:text-white/40' : 'text-black/25 dark:text-white/25'}`}>{opt.desc}</p>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  </div>

                  <div className="flex gap-8 py-8">
                    <div className="w-48 shrink-0 pt-0">
                      <h4 className="text-[15px] font-normal text-black/70 dark:text-white/70">Density</h4>
                    </div>
                    <div className="flex-1">
                      <div className="grid grid-cols-2 gap-3">
                        {([
                          { value: 'default' as Density, icon: Maximize2, label: 'Default', desc: 'Standard spacing and padding' },
                          { value: 'compact' as Density, icon: Minimize2, label: 'Compact', desc: 'Tighter layout for power users' },
                        ]).map(opt => {
                          const Icon = opt.icon;
                          const active = density === opt.value;
                          return (
                            <button
                              key={opt.value}
                              onClick={() => setDensity(opt.value)}
                              className={`relative flex flex-col items-start p-5 text-left rounded-xl cursor-pointer transition-all duration-200 ${
                                active
                                  ? 'bg-black/[0.04] dark:bg-white/[0.06] ring-1 ring-black/[0.08] dark:ring-white/[0.1]'
                                  : 'bg-transparent ring-1 ring-black/[0.04] dark:ring-white/[0.04] hover:bg-black/[0.02] dark:hover:bg-white/[0.03] hover:ring-black/[0.08] dark:hover:ring-white/[0.08]'
                              }`}
                            >
                              <Icon size={20} className={`mb-3 ${active ? 'text-black/70 dark:text-white/70' : 'text-black/25 dark:text-white/25'}`} />
                              <p className={`text-[15px] mb-1 ${active ? 'font-medium text-black/80 dark:text-white/80' : 'text-black/50 dark:text-white/50'}`}>{opt.label}</p>
                              <p className={`text-[11px] leading-relaxed ${active ? 'text-black/40 dark:text-white/40' : 'text-black/25 dark:text-white/25'}`}>{opt.desc}</p>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* ── Network ── */}
              {section === 'network' && (
                <div className="space-y-0">
                  <div className="flex gap-8 py-8 border-b border-black/[0.06] dark:border-white/[0.06]">
                    <div className="w-48 shrink-0 pt-0">
                      <h4 className="text-[15px] font-normal text-black/70 dark:text-white/70">Environment</h4>
                    </div>
                    <div className="flex-1">
                    <div className="flex items-center gap-3 py-2">
                      <div className="relative flex-shrink-0">
                        <div className={`w-2.5 h-2.5 rounded-full ${isProductionCluster ? 'bg-coda-brand' : 'bg-emerald-500'}`} />
                        <div className={`absolute inset-0 w-2.5 h-2.5 rounded-full animate-pulse ${isProductionCluster ? 'bg-coda-brand' : 'bg-emerald-500'}`} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-[12px] font-medium text-coda-text">{isProductionCluster ? 'Solstice Network' : 'Solana Devnet'}</p>
                        <p className="text-[10px] text-coda-text-muted">{isProductionCluster ? 'Connected — production SPE settlement active' : 'Connected — synthetic token settlement active'}</p>
                      </div>
                      <div className={`w-9 h-9 rounded-lg flex items-center justify-center ${
                        isProductionCluster ? 'bg-coda-brand/10 text-coda-brand' : 'bg-black/[0.08] dark:bg-white/[0.10] text-coda-text'
                      }`}>{isProductionCluster ? <Globe size={18} /> : <Wifi size={18} />}</div>
                    </div>
                    <div className="mt-2 pt-3 border-t border-black/[0.06] dark:border-white/[0.06] space-y-2">
                      {[
                        { label: 'Cluster', value: import.meta.env.VITE_SOLANA_CLUSTER || 'devnet' },
                        { label: 'Network', value: isProductionCluster ? 'Solstice Network' : 'Solana Devnet' },
                        { label: 'Auth Provider', value: (import.meta.env.VITE_AUTH_PROVIDER || 'supabase').toUpperCase() },
                        { label: 'Explorer', value: import.meta.env.VITE_SOLANA_EXPLORER_URL || 'https://explorer.solana.com' },
                        { label: 'Realtime', value: import.meta.env.VITE_USE_SUPABASE_REALTIME === 'false' ? 'Polling' : 'Supabase Realtime' },
                        { label: 'Live Data', value: import.meta.env.VITE_USE_LIVE_NETWORK_DATA === 'true' ? 'Enabled' : 'Simulation' },
                        { label: 'Environment', value: import.meta.env.VITE_ENVIRONMENT || import.meta.env.MODE || 'development' },
                      ].map(row => (
                        <div key={row.label} className="flex items-center justify-between gap-4">
                          <span className="text-[10px] font-mono text-coda-text-muted whitespace-nowrap">{row.label}</span>
                          <span className="text-[10px] font-mono text-coda-text-secondary truncate text-right">{row.value}</span>
                        </div>
                      ))}
                    </div>
                    </div>
                  </div>
                  <div className="flex gap-8 py-8">
                    <div className="w-48 shrink-0 pt-0">
                      <h4 className="text-[15px] font-normal text-black/70 dark:text-white/70">Auto Refresh</h4>
                    </div>
                    <div className="flex-1">
                    <div className="grid grid-cols-4 gap-2">
                      {refreshOptions.map(opt => {
                        const active = refreshInterval === opt.value;
                        return (
                          <button
                            key={opt.value}
                            onClick={() => handleRefreshInterval(opt.value)}
                            className={`flex items-center justify-center gap-1.5 px-3 py-2.5 text-[13px] font-medium rounded-xl transition-colors cursor-pointer ${
                              active ? (isDark ? 'bg-white/10 text-coda-text' : 'bg-black/[0.04] text-coda-text') : 'bg-transparent text-coda-text-secondary hover:text-coda-text'
                            }`}
                          >{opt.value !== 'off' && <Timer size={13} className="opacity-60" />}<span>{opt.label}</span></button>
                        );
                      })}
                    </div>
                    <p className="text-[10px] text-black/30 dark:text-white/30 mt-3 leading-relaxed">Controls how often the Transaction Monitor auto-polls for new settlements.</p>
                    </div>
                  </div>
                </div>
              )}

              {/* ── Notifications ── */}
              {section === 'notifications' && (
                <div className="space-y-0">
                  <div className="flex gap-8 py-8">
                    <div className="w-48 shrink-0 pt-0">
                      <h4 className="text-[15px] font-normal text-black/70 dark:text-white/70">Alerts</h4>
                    </div>
                    <div className="flex-1">
                      <div className="space-y-1">
                    {notifItems.map(item => (
                      <NotificationToggle
                        key={item.key}
                        label={item.label}
                        desc={item.desc}
                        enabled={notifPrefs[item.key]}
                        onToggle={() => toggleNotif(item.key)}
                        isDark={isDark}
                      />
                    ))}
                      </div>
                      <p className="text-[10px] text-black/30 dark:text-white/30 mt-3 leading-relaxed">
                        Notifications appear as in-app toasts. No external push or email delivery is configured.
                      </p>
                    </div>
                  </div>
                </div>
              )}
            </motion.div>
        </div>
      </PageShell>
    </div>
  );
}

// ============================================================
// ProfileSkeleton — shimmer placeholders while loading
// ============================================================

function SkeletonField({ half }: { half?: boolean }) {
  return (
    <div className={half ? 'flex-1' : 'w-full'}>
      <div className="h-3 w-16 rounded bg-black/[0.04] dark:bg-white/[0.04] mb-2 animate-pulse" />
      <div className="h-12 rounded-lg bg-black/[0.03] dark:bg-white/[0.03] animate-pulse" />
    </div>
  );
}

function ProfileSkeleton() {
  return (
    <div className="space-y-5">
      <div className="flex gap-4">
        <SkeletonField half />
        <SkeletonField half />
      </div>
      <SkeletonField />
      <div className="flex gap-4">
        <SkeletonField half />
        <SkeletonField half />
      </div>
      <SkeletonField />
      <div className="flex gap-4">
        <SkeletonField half />
        <SkeletonField half />
      </div>
    </div>
  );
}

// ============================================================
// EscalationsSkeleton — shimmer table while escalations load
// ============================================================

function EscalationsSkeleton() {
  return (
    <div className="space-y-3 animate-pulse">
      {/* Header row */}
      <div className="flex gap-4 pb-2">
        <div className="h-3 w-16 rounded bg-black/[0.04] dark:bg-white/[0.04]" />
        <div className="h-3 w-24 rounded bg-black/[0.04] dark:bg-white/[0.04]" />
        <div className="ml-auto h-3 w-12 rounded bg-black/[0.04] dark:bg-white/[0.04]" />
      </div>
      {[0, 1, 2].map(i => (
        <div key={i} className="flex gap-4 py-2 border-t border-black/[0.04] dark:border-white/[0.04]">
          <div className="h-3 w-24 rounded bg-black/[0.04] dark:bg-white/[0.04]" />
          <div className="h-3 w-20 rounded bg-black/[0.04] dark:bg-white/[0.04]" />
          <div className="ml-auto h-3 w-16 rounded bg-black/[0.04] dark:bg-white/[0.04]" />
        </div>
      ))}
    </div>
  );
}

// ============================================================
// ProfileEditorFallback — shown when profile hasn't loaded yet
// ============================================================

function ProfileEditorFallback({ name, email }: { name: string; email: string }) {
  const parts = name.split(' ');
  const firstName = parts[0] || '';
  const lastName = parts.slice(1).join(' ') || '';
  return (
    <div className="space-y-5">
      <div className="flex gap-4">
        <div className="flex-1">
          <label className="block text-[12px] font-normal text-black/40 dark:text-white/40 mb-1">First Name</label>
          <div className="px-4 py-3 text-[14px] text-black/70 dark:text-white/70 bg-black/[0.03] dark:bg-white/[0.04] rounded-lg">{firstName || '—'}</div>
        </div>
        <div className="flex-1">
          <label className="block text-[12px] font-normal text-black/40 dark:text-white/40 mb-1">Last Name</label>
          <div className="px-4 py-3 text-[14px] text-black/70 dark:text-white/70 bg-black/[0.03] dark:bg-white/[0.04] rounded-lg">{lastName || '—'}</div>
        </div>
      </div>
      <div>
        <label className="block text-[12px] font-normal text-black/40 dark:text-white/40 mb-1">Email</label>
        <div className="flex items-center gap-3">
          <div className="flex-1 px-4 py-3 text-[14px] text-black/70 dark:text-white/70 bg-black/[0.03] dark:bg-white/[0.04] rounded-lg">{email}</div>
          <span className="inline-flex items-center gap-1.5 px-3 py-2 rounded-full text-[12px] font-medium border border-emerald-500/30 text-emerald-600 dark:text-emerald-400">
            <span className="w-4 h-4 rounded-full bg-emerald-500/15 flex items-center justify-center"><Check size={10} className="text-emerald-500" /></span>
            Email verified
          </span>
        </div>
      </div>
    </div>
  );
}

// ============================================================
// ProfileReadOnlyField — XD-style read-only field with optional badge
// ============================================================

function ProfileReadOnlyField({ label, value, verified }: { label: string; value: string; verified?: boolean }) {
  return (
    <div>
      <label className="block text-[11px] font-medium text-coda-text-muted mb-1.5">{label}</label>
      <div className="flex items-center gap-3">
        <span className="text-sm text-coda-text">{value}</span>
        {verified && (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-emerald-500/10 text-emerald-500">
            <Check size={10} /> Verified
          </span>
        )}
      </div>
    </div>
  );
}

// ============================================================
// NotificationToggle
// ============================================================

function NotificationToggle({ label, desc, enabled, onToggle, isDark }: {
  label: string; desc: string; enabled: boolean; onToggle: () => void; isDark: boolean;
}) {
  return (
    <button
      onClick={onToggle}
      className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-black/[0.02] dark:hover:bg-white/[0.02] transition-colors cursor-pointer bg-transparent"
    >
      <div className={`flex-shrink-0 w-8 h-8 rounded-lg flex items-center justify-center ${
        enabled ? 'bg-emerald-500/10 text-emerald-500 dark:text-emerald-400' : (isDark ? 'bg-white/5 text-coda-text-muted' : 'bg-black/[0.04] text-coda-text-muted')
      }`}>{enabled ? <Bell size={15} /> : <BellOff size={15} />}</div>
      <div className="flex-1 min-w-0">
        <p className="text-[13px] font-medium text-coda-text">{label}</p>
        <p className="text-[10px] text-coda-text-muted mt-0.5 leading-relaxed">{desc}</p>
      </div>
      <div className={`relative flex-shrink-0 w-9 h-5 rounded-full transition-colors duration-300 ${enabled ? 'bg-emerald-500' : (isDark ? 'bg-white/10' : 'bg-black/10')}`}>
        <div className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow-sm transition-transform duration-300 ${enabled ? 'translate-x-[18px]' : 'translate-x-0.5'}`} />
      </div>
    </button>
  );
}
