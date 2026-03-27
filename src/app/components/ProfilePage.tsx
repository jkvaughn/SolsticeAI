import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router';
import { useTheme } from './ThemeProvider';
import { useAuth } from '../contexts/AuthContext';
import { useBanks } from '../contexts/BanksContext';
import { usePersona } from '../contexts/PersonaContext';
import { useCurrentUser } from '../hooks/useCurrentUser';
import { useIsAdmin } from '../hooks/useIsAdmin';
import { PageShell } from './PageShell';
import type { PageStat } from './PageShell';
import { PersonaSwitcher } from './PersonaSwitcher';
import { WidgetShell } from './dashboard/WidgetShell';
import { motion } from './motion-shim';
import { supabase } from '../supabaseClient';
import {
  LogOut,
  UserCircle,
  ShieldCheck,
  BarChart3,
  Clock,
  Activity,
  Building2,
  ChevronDown,
  Pencil,
  Check,
  Copy,
} from 'lucide-react';

// ============================================================
// Profile Page — Operator identity, activity stats & preferences
// ============================================================

const NAME_STORAGE_KEY = 'coda-operator-name';
const DEFAULT_PERSONA_KEY = 'coda-default-persona';
const DEFAULT_BANK_KEY = 'coda-default-bank';

const PERSONA_OPTIONS = [
  { value: '', label: 'All Views' },
  { value: 'compliance', label: 'Compliance' },
  { value: 'treasury', label: 'Treasury' },
  { value: 'leadership', label: 'Leadership' },
] as const;

export function ProfilePage() {
  const { resolved } = useTheme();
  const isDark = resolved === 'dark';
  const { user, signOut } = useAuth();
  const { activeBanks, banks } = useBanks();
  const currentUser = useCurrentUser();
  const isAdmin = useIsAdmin();
  const navigate = useNavigate();
  const [signOutConfirm, setSignOutConfirm] = useState(false);

  // ── Editable name ──
  const [name, setName] = useState(() =>
    localStorage.getItem(NAME_STORAGE_KEY) || currentUser.name,
  );
  const [isEditingName, setIsEditingName] = useState(false);
  const [editBuffer, setEditBuffer] = useState(name);
  const nameInputRef = useRef<HTMLInputElement>(null);

  const commitName = useCallback(() => {
    const trimmed = editBuffer.trim();
    if (trimmed) {
      setName(trimmed);
      localStorage.setItem(NAME_STORAGE_KEY, trimmed);
    }
    setIsEditingName(false);
  }, [editBuffer]);

  useEffect(() => {
    if (isEditingName) nameInputRef.current?.focus();
  }, [isEditingName]);

  // ── Stats from Supabase ──
  const [escalations, setEscalations] = useState<number | null>(null);
  const [settlements, setSettlements] = useState<number | null>(null);
  const [sessionStart] = useState(() => new Date().toLocaleString());

  useEffect(() => {
    let cancelled = false;

    async function fetchStats() {
      const [escRes, settRes] = await Promise.all([
        supabase
          .from('lockup_tokens')
          .select('id', { count: 'exact', head: true })
          .like('resolved_by', 'operator:%'),
        supabase
          .from('transactions')
          .select('id', { count: 'exact', head: true })
          .eq('status', 'settled'),
      ]);

      if (cancelled) return;
      setEscalations(escRes.count ?? 0);
      setSettlements(settRes.count ?? 0);
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
    const personaVal = (defaultPersona === 'compliance' || defaultPersona === 'treasury' || defaultPersona === 'leadership')
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
  const initials = currentUser.avatarInitials;

  const pageStats: PageStat[] = [
    { icon: ShieldCheck, value: escalations !== null ? String(escalations) : '...', label: 'Escalations Resolved' },
    { icon: BarChart3, value: settlements !== null ? String(settlements) : '...', label: 'Total Settlements' },
    { icon: Activity, value: '99.97%', label: 'Network Uptime' },
    { icon: Clock, value: sessionStart, label: 'Session Start' },
  ];

  return (
    <div className="max-w-5xl mx-auto pb-12">
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

            {/* Editable name */}
            <div className="space-y-2 flex flex-col items-center">
              {isEditingName ? (
                <div className="flex items-center gap-2">
                  <input
                    ref={nameInputRef}
                    value={editBuffer}
                    onChange={e => setEditBuffer(e.target.value)}
                    onKeyDown={e => {
                      if (e.key === 'Enter') commitName();
                      if (e.key === 'Escape') setIsEditingName(false);
                    }}
                    className="text-xl font-semibold font-sans text-coda-text bg-transparent border-b-2 border-coda-brand outline-none text-center px-1"
                  />
                  <button
                    onClick={commitName}
                    className="p-1 cursor-pointer"
                  >
                    <Check size={16} className="text-coda-brand" />
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => { setEditBuffer(name); setIsEditingName(true); }}
                  className="group relative cursor-pointer bg-transparent border-none"
                >
                  <h3 className="text-xl font-semibold font-sans text-coda-text text-center">
                    {name}
                  </h3>
                  <Pencil
                    size={14}
                    className="absolute -right-5 top-1/2 -translate-y-1/2 text-coda-text-muted opacity-0 group-hover:opacity-100 transition-opacity"
                  />
                </button>
              )}

              {/* Email */}
              <p className="text-coda-text-muted font-mono text-[11px]">
                {currentUser.email}
              </p>

              {/* Badges */}
              <div className="flex items-center justify-center gap-2 flex-wrap">
                <span className="px-3 py-1 rounded-full text-xs font-medium bg-coda-brand/10 text-coda-brand">
                  Network Administrator
                </span>
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

          {/* Institution */}
          <div className="space-y-3">
            <div className="flex items-center gap-3">
              <Building2 size={16} className="text-coda-text-muted shrink-0" />
              <div>
                <p className="text-sm font-sans text-coda-text">
                  Rimark Technology / Solstice Network
                </p>
                <p className="text-xs text-coda-text-muted">Institution</p>
              </div>
            </div>

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
