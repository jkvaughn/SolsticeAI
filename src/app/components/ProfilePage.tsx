import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router';
import { useTheme } from './ThemeProvider';
import { useAuth } from '../contexts/AuthContext';
import { useBanks } from '../contexts/BanksContext';
import { usePersona } from '../contexts/PersonaContext';
import { PageHeader } from './PageHeader';
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
  const { activeBanks } = useBanks();
  const navigate = useNavigate();
  const [signOutConfirm, setSignOutConfirm] = useState(false);

  // ── Editable name ──
  const [name, setName] = useState(() =>
    localStorage.getItem(NAME_STORAGE_KEY) || 'Demo Operator',
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

  // ── Preference dropdowns ──
  const [defaultPersona, setDefaultPersona] = useState(
    () => localStorage.getItem(DEFAULT_PERSONA_KEY) || '',
  );
  const [defaultBank, setDefaultBank] = useState(
    () => localStorage.getItem(DEFAULT_BANK_KEY) || '',
  );

  const handlePersonaChange = (val: string) => {
    setDefaultPersona(val);
    localStorage.setItem(DEFAULT_PERSONA_KEY, val);
  };

  const handleBankChange = (val: string) => {
    setDefaultBank(val);
    localStorage.setItem(DEFAULT_BANK_KEY, val);
  };

  // ── Sign out ──
  const handleSignOut = useCallback(async () => {
    await signOut();
    navigate('/login');
  }, [signOut, navigate]);

  // ── Initials ──
  const initials = name.charAt(0).toUpperCase();

  return (
    <div className="max-w-5xl mx-auto space-y-6 pb-12">
      <PageHeader
        icon={UserCircle}
        title="Profile"
        subtitle="Operator identity, activity & preferences"
      />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* ════════════════════════════════════════════════════════
            LEFT COLUMN — Identity Card
        ════════════════════════════════════════════════════════ */}
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35 }}
          className="dashboard-card-subtle p-6 space-y-6"
        >
          {/* Avatar + Name */}
          <div className="flex flex-col items-center text-center space-y-4">
            <div className="w-24 h-24 rounded-full bg-coda-brand flex items-center justify-center shadow-lg">
              <span className="text-3xl font-sans font-bold text-white select-none">
                {initials}
              </span>
            </div>

            {/* Editable name */}
            <div className="space-y-1">
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
                    className="p-1 rounded-lg hover:bg-coda-brand/10 transition-colors cursor-pointer"
                  >
                    <Check size={16} className="text-coda-brand" />
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => { setEditBuffer(name); setIsEditingName(true); }}
                  className="group flex items-center gap-2 cursor-pointer bg-transparent border-none"
                >
                  <h3 className="text-xl font-semibold font-sans text-coda-text">
                    {name}
                  </h3>
                  <Pencil
                    size={14}
                    className="text-coda-text-muted opacity-0 group-hover:opacity-100 transition-opacity"
                  />
                </button>
              )}

              {/* Role badge */}
              <span className="inline-block px-3 py-1 rounded-full text-xs font-medium bg-coda-brand/10 text-coda-brand">
                Network Administrator
              </span>
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

            {/* Status */}
            <div className="flex items-center gap-3">
              <span className="relative flex h-4 w-4 items-center justify-center shrink-0">
                <span className="animate-ping absolute inline-flex h-2.5 w-2.5 rounded-full bg-green-400 opacity-75" />
                <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500" />
              </span>
              <span className="text-sm font-sans text-coda-text-secondary">
                Online
              </span>
            </div>
          </div>

          {/* Sign out */}
          <div className="pt-2 border-t border-coda-border/20">
            {!signOutConfirm ? (
              <button
                onClick={() => setSignOutConfirm(true)}
                className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium text-coda-text-secondary hover:text-red-500 hover:bg-red-500/8 transition-all duration-300 cursor-pointer"
              >
                <LogOut size={15} />
                Sign Out
              </button>
            ) : (
              <div className="flex items-center gap-3 justify-center">
                <span className="text-xs text-red-500">End session?</span>
                <button
                  onClick={() => setSignOutConfirm(false)}
                  className="px-3 py-1.5 rounded-lg text-xs font-medium text-coda-text-secondary hover:bg-coda-surface/60 cursor-pointer transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleSignOut}
                  className="px-3 py-1.5 rounded-lg text-xs font-medium bg-red-500 text-white hover:bg-red-600 cursor-pointer transition-colors"
                >
                  Sign Out
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
          {/* ── Stat cards grid ── */}
          <div className="grid grid-cols-2 gap-4">
            <StatCard
              icon={ShieldCheck}
              label="Escalations Resolved"
              value={escalations !== null ? String(escalations) : '...'}
            />
            <StatCard
              icon={BarChart3}
              label="Total Settlements"
              value={settlements !== null ? String(settlements) : '...'}
            />
            <StatCard
              icon={Activity}
              label="Network Uptime"
              value="99.97%"
            />
            <StatCard
              icon={Clock}
              label="Session Start"
              value={sessionStart}
              small
            />
          </div>

          {/* ── Preferences ── */}
          <div className="dashboard-card-subtle p-5 space-y-5">
            <h4 className="text-sm font-semibold font-sans text-coda-text">
              Defaults & Preferences
            </h4>

            {/* Default persona */}
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-coda-text-secondary">
                Default Persona
              </label>
              <div className="relative">
                <select
                  value={defaultPersona}
                  onChange={e => handlePersonaChange(e.target.value)}
                  className={`w-full appearance-none rounded-xl px-4 py-2.5 pr-10 text-sm font-sans text-coda-text outline-none transition-colors cursor-pointer ${
                    isDark
                      ? 'bg-white/[0.05] border border-white/[0.08] hover:bg-white/[0.08]'
                      : 'bg-black/[0.03] border border-black/[0.06] hover:bg-black/[0.05]'
                  }`}
                >
                  {PERSONA_OPTIONS.map(opt => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
                <ChevronDown
                  size={14}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-coda-text-muted pointer-events-none"
                />
              </div>
            </div>

            {/* Default bank scope */}
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-coda-text-secondary">
                Default Bank Scope
              </label>
              <div className="relative">
                <select
                  value={defaultBank}
                  onChange={e => handleBankChange(e.target.value)}
                  className={`w-full appearance-none rounded-xl px-4 py-2.5 pr-10 text-sm font-sans text-coda-text outline-none transition-colors cursor-pointer ${
                    isDark
                      ? 'bg-white/[0.05] border border-white/[0.08] hover:bg-white/[0.08]'
                      : 'bg-black/[0.03] border border-black/[0.06] hover:bg-black/[0.05]'
                  }`}
                >
                  <option value="">All Banks</option>
                  {activeBanks.map(bank => (
                    <option key={bank.id} value={bank.id}>
                      {bank.name}
                    </option>
                  ))}
                </select>
                <ChevronDown
                  size={14}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-coda-text-muted pointer-events-none"
                />
              </div>
            </div>
          </div>
        </motion.div>
      </div>
    </div>
  );
}

// ── Stat Card ────────────────────────────────────────────────

function StatCard({
  icon: Icon,
  label,
  value,
  small,
}: {
  icon: React.ElementType;
  label: string;
  value: string;
  small?: boolean;
}) {
  return (
    <div className="dashboard-card-subtle p-4 space-y-2">
      <div className="flex items-center gap-2">
        <Icon size={14} className="text-coda-text-muted shrink-0" />
        <span className="text-[11px] font-sans text-coda-text-muted uppercase tracking-wide">
          {label}
        </span>
      </div>
      <p
        className={`font-mono font-semibold text-coda-text ${
          small ? 'text-xs' : 'text-lg'
        }`}
      >
        {value}
      </p>
    </div>
  );
}
