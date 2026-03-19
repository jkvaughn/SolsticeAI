import { useState, useEffect, useCallback } from 'react';
import { useTheme, type ThemePreference } from './ThemeProvider';
import { useIsAdmin } from '../hooks/useIsAdmin';
import { callServer } from '../supabaseClient';
import { PageHeader } from './PageHeader';
import { PageTransition } from './PageTransition';
import { motion } from './motion-shim';
import {
  Settings, Sun, Moon, Monitor, Wifi, Globe,
  ChevronDown, ChevronRight, Bell, BellOff,
  AlertTriangle, Trash2, RotateCcw, Timer,
  Layers, Maximize2, Minimize2,
} from 'lucide-react';

// ============================================================
// Settings Page — Appearance, Network, Notifications, Danger Zone
// ============================================================

// ── Types ──

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
  const isAdmin = useIsAdmin();

  // ── Appearance state ──
  const [density, setDensityState] = useState<Density>(loadDensity);

  const setDensity = useCallback((d: Density) => {
    setDensityState(d);
    try { localStorage.setItem('coda-density-preference', d); } catch {}
    if (d === 'compact') {
      document.documentElement.setAttribute('data-density', 'compact');
    } else {
      document.documentElement.removeAttribute('data-density');
    }
  }, []);

  // Apply density on mount
  useEffect(() => {
    const d = loadDensity();
    if (d === 'compact') {
      document.documentElement.setAttribute('data-density', 'compact');
    }
  }, []);

  // ── Network state ──
  const [refreshInterval, setRefreshIntervalState] = useState<RefreshInterval>(loadRefreshInterval);

  // Derive network mode from build-time env var (no toggle needed)
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

  // ── Danger zone ──
  const [resettingTokens, setResettingTokens] = useState(false);
  const [resettingNetwork, setResettingNetwork] = useState(false);

  const handleResetTokens = useCallback(async () => {
    if (!window.confirm('Reset all tokens? This will clear cached token metadata and balances. This action cannot be undone.')) return;
    setResettingTokens(true);
    try {
      await callServer('/reset-tokens');
    } catch (err) {
      console.error('[Settings] Failed to reset tokens:', err);
    } finally {
      setResettingTokens(false);
    }
  }, []);

  const handleResetNetwork = useCallback(async () => {
    if (!window.confirm('Reset network configuration? This will restore default Devnet settings and clear all cached RPC state. This action cannot be undone.')) return;
    setResettingNetwork(true);
    try {
      await callServer('/reset-network');
    } catch (err) {
      console.error('[Settings] Failed to reset network:', err);
    } finally {
      setResettingNetwork(false);
    }
  }, []);

  // ── Theme options ──
  const themeOptions: { pref: ThemePreference; icon: React.ElementType; label: string; desc: string; dotColor: string }[] = [
    { pref: 'light', icon: Sun,     label: 'Light',  desc: 'Bright LiquidGlass appearance', dotColor: 'bg-amber-400' },
    { pref: 'dark',  icon: Moon,    label: 'Dark',   desc: 'Reduced-light glass appearance', dotColor: 'bg-indigo-400' },
    { pref: 'auto',  icon: Monitor, label: 'Auto',   desc: 'Match your OS preference',      dotColor: 'bg-emerald-400' },
  ];

  // ── Refresh interval options ──
  const refreshOptions: { value: RefreshInterval; label: string }[] = [
    { value: '5',   label: '5s' },
    { value: '10',  label: '10s' },
    { value: '30',  label: '30s' },
    { value: 'off', label: 'Off' },
  ];

  // ── Notification items ──
  const notifItems: { key: keyof NotificationPrefs; label: string; desc: string }[] = [
    { key: 'settlementConfirmations',    label: 'Settlement confirmations',    desc: 'Notify when a Solana settlement finalizes on-chain' },
    { key: 'cadenzaEscalations',         label: 'Cadenza escalations',         desc: 'Alert when Cadenza flags a transaction for human review' },
    { key: 'orphanedTransactionAlerts',   label: 'Orphaned transaction alerts', desc: 'Warn about transactions missing counterpart records' },
    { key: 'treasuryCycleCompletions',    label: 'Treasury cycle completions',  desc: 'Notify when a full treasury sweep cycle completes' },
  ];

  return (
    <div className="max-w-2xl mx-auto space-y-8 pb-12">
      <PageHeader
        icon={Settings}
        title="Settings"
        subtitle="Appearance, network, notifications, and maintenance"
      />

      <PageTransition className="space-y-5">

        {/* ─────────────────────────────────────────────────────── */}
        {/* 1. Appearance                                          */}
        {/* ─────────────────────────────────────────────────────── */}
        <CollapsibleCard title="Appearance" icon={Layers} defaultOpen>
          {/* Theme selector */}
          <div className="mb-4">
            <p className="text-[11px] font-medium text-coda-text-muted uppercase tracking-wider mb-3">Theme</p>
            <div className="grid grid-cols-3 gap-3">
              {themeOptions.map(opt => {
                const Icon = opt.icon;
                const active = preference === opt.pref;
                return (
                  <button
                    key={opt.pref}
                    onClick={() => setTheme(opt.pref)}
                    className={`relative flex flex-col items-center gap-2.5 p-4 rounded-xl border transition-all duration-300 cursor-pointer ${
                      active
                        ? isDark
                          ? 'bg-white/10 border-white/25 shadow-lg shadow-coda-brand/5'
                          : 'bg-black/[0.04] border-black/15 shadow-lg shadow-coda-brand/5'
                        : isDark
                          ? 'bg-white/[0.03] border-white/[0.06] hover:bg-white/[0.06]'
                          : 'bg-black/[0.02] border-black/[0.04] hover:bg-black/[0.04]'
                    }`}
                  >
                    {active && (
                      <div className={`absolute top-2 right-2 w-2 h-2 rounded-full ${opt.dotColor}`} />
                    )}
                    <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${
                      active
                        ? 'bg-black/[0.08] dark:bg-white/[0.10] text-coda-text'
                        : isDark ? 'bg-white/5 text-coda-text-muted' : 'bg-black/[0.04] text-coda-text-muted'
                    }`}>
                      <Icon size={20} />
                    </div>
                    <div className="text-center">
                      <p className={`text-[13px] font-medium ${active ? 'text-coda-text' : 'text-coda-text-secondary'}`}>
                        {opt.label}
                      </p>
                      <p className="text-[10px] text-coda-text-muted mt-0.5">{opt.desc}</p>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Density toggle */}
          <div>
            <p className="text-[11px] font-medium text-coda-text-muted uppercase tracking-wider mb-3">Density</p>
            <div className="grid grid-cols-2 gap-3">
              {([
                { value: 'default' as Density, icon: Maximize2, label: 'Default',  desc: 'Standard spacing and padding' },
                { value: 'compact' as Density, icon: Minimize2, label: 'Compact',  desc: 'Tighter layout for power users' },
              ]).map(opt => {
                const Icon = opt.icon;
                const active = density === opt.value;
                return (
                  <button
                    key={opt.value}
                    onClick={() => setDensity(opt.value)}
                    className={`relative flex items-center gap-3 p-4 rounded-xl border text-left transition-all duration-300 cursor-pointer ${
                      active
                        ? isDark
                          ? 'bg-white/10 border-white/25 shadow-lg'
                          : 'bg-black/[0.04] border-black/15 shadow-lg'
                        : isDark
                          ? 'bg-white/[0.03] border-white/[0.06] hover:bg-white/[0.06]'
                          : 'bg-black/[0.02] border-black/[0.04] hover:bg-black/[0.04]'
                    }`}
                  >
                    {active && (
                      <div className="absolute top-2.5 right-2.5 w-2 h-2 rounded-full bg-emerald-400" />
                    )}
                    <div className={`w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 ${
                      active
                        ? 'bg-black/[0.08] dark:bg-white/[0.10] text-coda-text'
                        : isDark ? 'bg-white/5 text-coda-text-muted' : 'bg-black/[0.04] text-coda-text-muted'
                    }`}>
                      <Icon size={18} />
                    </div>
                    <div>
                      <p className={`text-[13px] font-medium ${active ? 'text-coda-text' : 'text-coda-text-secondary'}`}>
                        {opt.label}
                      </p>
                      <p className="text-[10px] text-coda-text-muted mt-0.5">{opt.desc}</p>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        </CollapsibleCard>

        {/* ─────────────────────────────────────────────────────── */}
        {/* 2. Network                                             */}
        {/* ─────────────────────────────────────────────────────── */}
        <CollapsibleCard title="Network" icon={Wifi} defaultOpen>
          {/* Network environment (read-only, determined by build config) */}
          <div className="mb-4">
            <p className="text-[11px] font-medium text-coda-text-muted uppercase tracking-wider mb-3">Environment</p>

            {/* Live status indicator */}
            <div className={`flex items-center gap-3 px-4 py-3 rounded-xl border ${
              isDark ? 'bg-white/[0.03] border-white/[0.06]' : 'bg-black/[0.02] border-black/[0.04]'
            }`}>
              <div className="relative flex-shrink-0">
                <div className={`w-2.5 h-2.5 rounded-full ${isProductionCluster ? 'bg-coda-brand' : 'bg-emerald-500'}`} />
                <div className={`absolute inset-0 w-2.5 h-2.5 rounded-full animate-pulse ${isProductionCluster ? 'bg-coda-brand' : 'bg-emerald-500'}`} />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-[12px] font-medium text-coda-text">
                  {isProductionCluster ? 'Solstice Network' : 'Solana Devnet'}
                </p>
                <p className="text-[10px] text-coda-text-muted">
                  {isProductionCluster
                    ? 'Connected — production SPE settlement active'
                    : 'Connected — synthetic token settlement active'}
                </p>
              </div>
              <div className={`w-9 h-9 rounded-lg flex items-center justify-center ${
                isProductionCluster ? 'bg-coda-brand/10 text-coda-brand' : 'bg-black/[0.08] dark:bg-white/[0.10] text-coda-text'
              }`}>
                {isProductionCluster ? <Globe size={18} /> : <Wifi size={18} />}
              </div>
            </div>

            {/* Network details */}
            <div className={`mt-3 rounded-xl border overflow-hidden ${
              isDark ? 'bg-white/[0.02] border-white/[0.06]' : 'bg-black/[0.015] border-black/[0.04]'
            }`}>
              <div className="px-3 py-2 border-b border-black/[0.04] dark:border-white/[0.06]">
                <p className="text-[10px] font-bold text-coda-text-muted uppercase tracking-wider">Active Connection</p>
              </div>
              <div className="px-3 py-2 space-y-1.5">
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

          {/* Auto-refresh interval */}
          <div>
            <p className="text-[11px] font-medium text-coda-text-muted uppercase tracking-wider mb-3">
              Transaction Monitor Refresh
            </p>
            <div className="grid grid-cols-4 gap-2">
              {refreshOptions.map(opt => {
                const active = refreshInterval === opt.value;
                return (
                  <button
                    key={opt.value}
                    onClick={() => handleRefreshInterval(opt.value)}
                    className={`flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-xl border text-[13px] font-medium transition-all duration-300 cursor-pointer ${
                      active
                        ? isDark
                          ? 'bg-white/10 border-white/25 text-coda-text shadow-lg'
                          : 'bg-black/[0.04] border-black/15 text-coda-text shadow-lg'
                        : isDark
                          ? 'bg-white/[0.03] border-white/[0.06] text-coda-text-secondary hover:bg-white/[0.06]'
                          : 'bg-black/[0.02] border-black/[0.04] text-coda-text-secondary hover:bg-black/[0.04]'
                    }`}
                  >
                    {opt.value !== 'off' && <Timer size={13} className="opacity-60" />}
                    {opt.label}
                  </button>
                );
              })}
            </div>
            <p className="text-[10px] text-coda-text-muted mt-3 leading-relaxed">
              Controls how often the Transaction Monitor auto-polls for new settlements.
              Set to Off for manual refresh only.
            </p>
          </div>
        </CollapsibleCard>

        {/* ─────────────────────────────────────────────────────── */}
        {/* 3. Notifications                                       */}
        {/* ─────────────────────────────────────────────────────── */}
        <CollapsibleCard title="Notifications" icon={Bell}>
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
          <p className="text-[10px] text-coda-text-muted mt-3 leading-relaxed">
            Notifications appear as in-app toasts. No external push or email delivery is configured.
          </p>
        </CollapsibleCard>

        {/* ─────────────────────────────────────────────────────── */}
        {/* 4. Danger Zone                                         */}
        {/* ─────────────────────────────────────────────────────── */}
        {isAdmin && <CollapsibleCard title="Danger Zone" icon={AlertTriangle} variant="danger">
          <div className="space-y-3">
            <DangerAction
              icon={RotateCcw}
              label="Reset Tokens"
              desc="Clear all cached token metadata, balances, and mint associations."
              buttonLabel={resettingTokens ? 'Resetting...' : 'Reset Tokens'}
              disabled={resettingTokens}
              onClick={handleResetTokens}
              isDark={isDark}
            />
            <DangerAction
              icon={Trash2}
              label="Reset Network"
              desc="Restore default Devnet settings and clear cached RPC state."
              buttonLabel={resettingNetwork ? 'Resetting...' : 'Reset Network'}
              disabled={resettingNetwork}
              onClick={handleResetNetwork}
              isDark={isDark}
            />
          </div>
          <p className="text-[10px] text-coda-text-muted mt-3 leading-relaxed">
            These actions are irreversible. Cached data will be rebuilt on next agent cycle.
          </p>
        </CollapsibleCard>}

      </PageTransition>
    </div>
  );
}

// ============================================================
// CollapsibleCard — reusable accordion section
// ============================================================

function CollapsibleCard({
  title,
  icon: Icon,
  children,
  defaultOpen = false,
  variant = 'default',
}: {
  title: string;
  icon: React.ElementType;
  children: React.ReactNode;
  defaultOpen?: boolean;
  variant?: 'default' | 'danger';
}) {
  const [open, setOpen] = useState(defaultOpen);

  const iconBg = variant === 'danger'
    ? 'bg-red-500/10 text-red-500 dark:text-red-400'
    : 'bg-black/[0.06] dark:bg-white/[0.08] text-coda-text-secondary';

  return (
    <div className="dashboard-card-subtle overflow-hidden">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center gap-3 p-4 hover:bg-black/[0.02] dark:hover:bg-white/[0.02] transition-colors"
      >
        <div className={`w-7 h-7 rounded-lg flex items-center justify-center ${iconBg}`}>
          <Icon size={15} />
        </div>
        <span className="font-semibold text-sm text-coda-text flex-1 text-left font-sans">{title}</span>
        {open
          ? <ChevronDown size={16} className="text-coda-text-muted" />
          : <ChevronRight size={16} className="text-coda-text-muted" />
        }
      </button>
      <div
        className="transition-all duration-200 ease-in-out overflow-hidden"
        style={{ maxHeight: open ? '2000px' : '0', opacity: open ? 1 : 0 }}
      >
        <div className="px-4 pb-4 space-y-4 border-t border-coda-border">
          {children}
        </div>
      </div>
    </div>
  );
}

// ============================================================
// NotificationToggle — single notification preference row
// ============================================================

function NotificationToggle({
  label,
  desc,
  enabled,
  onToggle,
  isDark,
}: {
  label: string;
  desc: string;
  enabled: boolean;
  onToggle: () => void;
  isDark: boolean;
}) {
  return (
    <button
      onClick={onToggle}
      className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl border text-left transition-all duration-300 cursor-pointer ${
        isDark
          ? 'bg-white/[0.03] border-white/[0.06] hover:bg-white/[0.05]'
          : 'bg-black/[0.02] border-black/[0.04] hover:bg-black/[0.04]'
      }`}
    >
      <div className={`flex-shrink-0 w-8 h-8 rounded-lg flex items-center justify-center ${
        enabled
          ? 'bg-emerald-500/10 text-emerald-500 dark:text-emerald-400'
          : isDark ? 'bg-white/5 text-coda-text-muted' : 'bg-black/[0.04] text-coda-text-muted'
      }`}>
        {enabled ? <Bell size={15} /> : <BellOff size={15} />}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-[13px] font-medium text-coda-text">{label}</p>
        <p className="text-[10px] text-coda-text-muted mt-0.5 leading-relaxed">{desc}</p>
      </div>
      {/* Toggle switch */}
      <div className={`relative flex-shrink-0 w-9 h-5 rounded-full transition-colors duration-300 ${
        enabled ? 'bg-emerald-500' : isDark ? 'bg-white/10' : 'bg-black/10'
      }`}>
        <div className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow-sm transition-transform duration-300 ${
          enabled ? 'translate-x-[18px]' : 'translate-x-0.5'
        }`} />
      </div>
    </button>
  );
}

// ============================================================
// DangerAction — single danger-zone action row
// ============================================================

function DangerAction({
  icon: Icon,
  label,
  desc,
  buttonLabel,
  disabled,
  onClick,
  isDark,
}: {
  icon: React.ElementType;
  label: string;
  desc: string;
  buttonLabel: string;
  disabled: boolean;
  onClick: () => void;
  isDark: boolean;
}) {
  return (
    <div className={`flex items-center gap-3 px-4 py-3 rounded-xl border ${
      isDark
        ? 'bg-red-500/[0.03] border-red-500/10'
        : 'bg-red-50/50 border-red-200/30'
    }`}>
      <div className="flex-shrink-0 w-8 h-8 rounded-lg flex items-center justify-center bg-red-500/10 text-red-500 dark:text-red-400">
        <Icon size={15} />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-[13px] font-medium text-coda-text">{label}</p>
        <p className="text-[10px] text-coda-text-muted mt-0.5 leading-relaxed">{desc}</p>
      </div>
      <button
        onClick={onClick}
        disabled={disabled}
        className={`flex-shrink-0 px-3.5 py-1.5 rounded-xl text-[12px] font-medium transition-all duration-300 cursor-pointer ${
          disabled
            ? 'opacity-50 cursor-not-allowed'
            : ''
        } ${
          isDark
            ? 'bg-red-500/15 text-red-400 hover:bg-red-500/25 border border-red-500/20'
            : 'bg-red-500/10 text-red-600 hover:bg-red-500/20 border border-red-500/15'
        }`}
      >
        {buttonLabel}
      </button>
    </div>
  );
}
