import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router';
import { useTheme } from './ThemeProvider';
import { useAuth } from '../contexts/AuthContext';
import { useBanks } from '../contexts/BanksContext';
import { usePersona } from '../contexts/PersonaContext';
import { useCurrentUser } from '../hooks/useCurrentUser';
import { useIsAdmin } from '../hooks/useIsAdmin';
import { useUserProfile } from '../hooks/useUserProfile';
import { PageShell } from './PageShell';
import type { PageStat } from './PageShell';
import { PersonaSwitcher } from './PersonaSwitcher';
import { ProfileEditor } from './profile/ProfileEditor';
import { ActivityTimeline } from './profile/ActivityTimeline';
import { WidgetShell } from './dashboard/WidgetShell';
import { motion } from './motion-shim';
import { supabase } from '../supabaseClient';
import {
  LogOut,
  ShieldCheck,
  BarChart3,
  Clock,
  Activity,
  Check,
  Copy,
} from 'lucide-react';

// ============================================================
// Profile Page — Operator identity, activity stats & preferences
// ============================================================

const DEFAULT_PERSONA_KEY = 'coda-default-persona';
const DEFAULT_BANK_KEY = 'coda-default-bank';

const PERSONA_OPTIONS = [
  { value: '', label: 'Admin (All Views)' },
  { value: 'compliance', label: 'Compliance' },
  { value: 'treasury', label: 'Treasury' },
  { value: 'bsa_officer', label: 'BSA Officer' },
  { value: 'executive', label: 'Executive' },
] as const;

export function ProfilePage() {
  const { resolved } = useTheme();
  const isDark = resolved === 'dark';
  const { user, signOut } = useAuth();
  const { activeBanks, banks } = useBanks();
  const currentUser = useCurrentUser();
  const isAdmin = useIsAdmin();
  const { profile, updateProfile } = useUserProfile();
  const navigate = useNavigate();
  const [signOutConfirm, setSignOutConfirm] = useState(false);

  // ── Stats from Supabase ──
  const [escalations, setEscalations] = useState<number | null>(null);
  const [settlements, setSettlements] = useState<number | null>(null);
  const [pendingActions, setPendingActions] = useState<number | null>(null);
  const [totalVolume, setTotalVolume] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function fetchStats() {
      const [escRes, settRes, pendingRes, volumeRes] = await Promise.all([
        supabase
          .from('lockup_tokens')
          .select('id', { count: 'exact', head: true })
          .like('resolved_by', 'operator:%'),
        supabase
          .from('transactions')
          .select('id', { count: 'exact', head: true })
          .eq('status', 'settled'),
        supabase
          .from('transactions')
          .select('id', { count: 'exact', head: true })
          .in('status', ['pending', 'processing', 'lockup']),
        supabase
          .from('transactions')
          .select('amount')
          .eq('status', 'settled'),
      ]);

      if (cancelled) return;
      setEscalations(escRes.count ?? 0);
      setSettlements(settRes.count ?? 0);
      setPendingActions(pendingRes.count ?? 0);
      const vol = (volumeRes.data ?? []).reduce((sum: number, t: any) => sum + (Number(t.amount) || 0), 0);
      setTotalVolume(vol);
    }

    fetchStats();
    return () => { cancelled = true; };
  }, []);

  // ── Recent escalations for mini-table ──
  interface EscalationRow {
    id: string;
    transaction_id: string;
    sender_bank_id: string;
    receiver_bank_id: string;
    resolution: string;
    resolved_at: string;
  }
  const [recentEscalations, setRecentEscalations] = useState<EscalationRow[]>([]);

  useEffect(() => {
    let cancelled = false;
    async function fetchEscalations() {
      const { data } = await supabase
        .from('lockup_tokens')
        .select('id, transaction_id, sender_bank_id, receiver_bank_id, resolution, resolved_at')
        .like('resolved_by', 'operator:%')
        .order('resolved_at', { ascending: false })
        .limit(5);
      if (!cancelled && data) setRecentEscalations(data as EscalationRow[]);
    }
    fetchEscalations();
    return () => { cancelled = true; };
  }, []);

  // ── Helper: resolve bank id → short_code ──
  const bankCode = useCallback((id: string) => {
    return banks.find(b => b.id === id)?.short_code ?? id.slice(0, 6);
  }, [banks]);

  // ── Helper: copy to clipboard ──
  const [copied, setCopied] = useState(false);
  const copyUserId = useCallback(() => {
    navigator.clipboard.writeText(currentUser.userId).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }, [currentUser.userId]);

  // ── Preference dropdowns ──
  const [defaultPersona, setDefaultPersona] = useState(
    () => localStorage.getItem(DEFAULT_PERSONA_KEY) || '',
  );
  const [defaultBank, setDefaultBank] = useState(
    () => localStorage.getItem(DEFAULT_BANK_KEY) || '',
  );

  const { setPersona, setSelectedBankId: setContextBankId } = usePersona();
  const [prefsApplied, setPrefsApplied] = useState(false);

  const handlePersonaChange = (val: string) => {
    setDefaultPersona(val);
    localStorage.setItem(DEFAULT_PERSONA_KEY, val);
    setPrefsApplied(false);
  };

  const handleBankChange = (val: string) => {
    setDefaultBank(val);
    localStorage.setItem(DEFAULT_BANK_KEY, val);
    setPrefsApplied(false);
  };

  const applyPreferences = () => {
    const personaVal = (defaultPersona === 'compliance' || defaultPersona === 'treasury' || defaultPersona === 'bsa_officer' || defaultPersona === 'executive')
      ? defaultPersona : null;
    setPersona(personaVal);
    setContextBankId(defaultBank || null);
    setPrefsApplied(true);
    setTimeout(() => setPrefsApplied(false), 2000);
  };

  // ── Sign out ──
  const handleSignOut = useCallback(async () => {
    await signOut();
    navigate('/login');
  }, [signOut, navigate]);

  // ── Initials ──
  const profileName = profile?.full_name || currentUser.name;
  const initials = profileName
    .split(' ')
    .map(w => w[0])
    .join('')
    .toUpperCase()
    .slice(0, 2) || currentUser.avatarInitials;

  const formatVolume = (raw: number) => {
    const v = raw / 1_000_000; // raw amounts are in token micro-units
    if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)}M`;
    if (v >= 1_000) return `$${(v / 1_000).toFixed(0)}K`;
    return `$${v.toFixed(0)}`;
  };

  const pageStats: PageStat[] = [
    { icon: Activity, value: totalVolume !== null ? formatVolume(totalVolume) : '...', label: 'Total Volume' },
    { icon: ShieldCheck, value: escalations !== null ? String(escalations) : '...', label: 'Escalations Resolved' },
    { icon: BarChart3, value: settlements !== null ? String(settlements) : '...', label: 'Total Settlements' },
    { icon: Clock, value: pendingActions !== null ? String(pendingActions) : '...', label: 'Pending Actions' },
  ];

  return (
    <div className="pb-12">
      <PageShell
        title="Profile"
        subtitle="Operator identity, activity & preferences"
        stats={pageStats}
      >
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* ════════════════════════════════════════════════════════
            LEFT COLUMN — Identity Card
        ════════════════════════════════════════════════════════ */}
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35 }}
          className="liquid-glass-card squircle p-6 flex flex-col"
        >
          <div className="space-y-6 flex-1">
          {/* Avatar + Name */}
          <div className="flex flex-col items-center text-center space-y-4">
            <div className="w-24 h-24 rounded-full bg-coda-brand flex items-center justify-center shadow-lg">
              <span className="text-3xl font-sans font-bold text-white select-none">
                {initials}
              </span>
            </div>

            <div className="space-y-2 flex flex-col items-center">
              {/* Name from profile */}
              <h3 className="text-xl font-semibold font-sans text-coda-text text-center">
                {profileName}
              </h3>

              {/* Email */}
              <p className="text-coda-text-muted font-mono text-[11px]">
                {currentUser.email}
              </p>

              {/* Auth provider badge */}
              <div className="flex items-center justify-center gap-2 flex-wrap">
                {profile?.title && (
                  <span className="px-3 py-1 rounded-full text-xs font-medium bg-coda-brand/10 text-coda-brand">
                    {profile.title}
                  </span>
                )}
                <span
                  className={`inline-block px-3 py-1 rounded-full text-[10px] font-medium ${
                    currentUser.provider === 'Azure Entra ID'
                      ? 'bg-coda-brand/10 text-coda-brand'
                      : 'bg-emerald-500/10 text-emerald-500'
                  }`}
                >
                  {currentUser.provider}
                </span>
              </div>
            </div>
          </div>

          {/* Profile Editor — editable fields */}
          {profile && (
            <ProfileEditor profile={profile} onUpdate={updateProfile} />
          )}

          {/* Account info */}
          <div className="space-y-3">
            {/* Account ID */}
            {currentUser.userId && (
              <div className="flex items-center gap-3">
                <div className="w-4 shrink-0" />
                <div className="flex items-center gap-1.5">
                  <span className="font-mono text-[10px] text-coda-text-muted">
                    {currentUser.userId.slice(0, 8)}...{currentUser.userId.slice(-4)}
                  </span>
                  <button
                    onClick={copyUserId}
                    className="p-0.5 cursor-pointer"
                    title="Copy account ID"
                  >
                    {copied ? (
                      <Check size={10} className="text-coda-brand" />
                    ) : (
                      <Copy size={10} className="text-coda-text-muted" />
                    )}
                  </button>
                </div>
              </div>
            )}

            {/* Status */}
            <div className="flex items-center gap-3">
              <span className="relative flex h-4 w-4 items-center justify-center shrink-0">
                <span className="animate-ping absolute inline-flex h-2.5 w-2.5 rounded-full bg-green-400 opacity-75" />
                <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500" />
              </span>
              <span className="text-sm font-sans text-coda-text-secondary">
                Online
              </span>
              {isAdmin && (
                <span className="text-[8px] font-bold text-coda-brand bg-coda-brand/10 px-1.5 py-0.5 rounded">
                  ADMIN
                </span>
              )}
            </div>
          </div>
          </div>
          {/* end space-y-6 wrapper */}

          {/* Sign Out — pinned to bottom of card */}
          <div className="mt-auto pt-4 -mx-6 -mb-6 px-6 py-3 border-t border-black/[0.06] dark:border-white/[0.06]">
            {!signOutConfirm ? (
              <button
                onClick={() => setSignOutConfirm(true)}
                className="liquid-button w-full flex items-center justify-center px-6 py-2.5 text-sm font-medium text-coda-text-muted cursor-pointer"
              >
                <LogOut size={15} />
                <span>Sign Out</span>
              </button>
            ) : (
              <div className="flex items-center justify-center gap-3">
                <span className="text-xs text-red-500">End session?</span>
                <button
                  onClick={() => setSignOutConfirm(false)}
                  className="px-3 py-1.5 text-xs font-medium text-coda-text-secondary cursor-pointer"
                >
                  <span>Cancel</span>
                </button>
                <button
                  onClick={handleSignOut}
                  className="px-3 py-1.5 text-xs font-medium bg-red-500/15 text-red-400 cursor-pointer rounded-lg"
                >
                  <span>Sign Out</span>
                </button>
              </div>
            )}
          </div>

        </motion.div>

        {/* ════════════════════════════════════════════════════════
            RIGHT COLUMN — Activity + Preferences
        ════════════════════════════════════════════════════════ */}
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35, delay: 0.08 }}
          className="space-y-6"
        >
          {/* ── Activity Timeline ── */}
          <WidgetShell title="Activity" icon={Clock}>
            <ActivityTimeline />
          </WidgetShell>

          {/* ── Recent Escalations ── */}
          {recentEscalations.length > 0 && (
            <WidgetShell title="Recent Escalations">
              <table className="w-full text-[10px] font-mono">
                <thead>
                  <tr className="text-coda-text-muted">
                    <th className="text-left pb-1.5 font-medium">Route</th>
                    <th className="text-left pb-1.5 font-medium">Resolution</th>
                    <th className="text-right pb-1.5 font-medium">Time</th>
                  </tr>
                </thead>
                <tbody className="text-coda-text-secondary">
                  {recentEscalations.map(row => (
                    <tr key={row.id} className="border-t border-coda-border/10">
                      <td className="py-1.5">
                        {bankCode(row.sender_bank_id)} &rarr; {bankCode(row.receiver_bank_id)}
                      </td>
                      <td className="py-1.5">{row.resolution}</td>
                      <td className="py-1.5 text-right text-coda-text-muted">
                        {row.resolved_at
                          ? new Date(row.resolved_at).toLocaleString(undefined, {
                              month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
                            })
                          : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </WidgetShell>
          )}

          {/* ── Preferences ── */}
          <WidgetShell title="Defaults & Preferences">
            <PersonaSwitcher />
          </WidgetShell>
        </motion.div>
      </div>

      </PageShell>
    </div>
  );
}
