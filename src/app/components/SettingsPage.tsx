import { useState, useEffect, useCallback } from 'react';
import { useTheme, type ThemePreference } from './ThemeProvider';
import { PageShell } from './PageShell';
import type { PageStat } from './PageShell';
import { WidgetShell } from './dashboard/WidgetShell';
import { SecuritySection } from './settings/SecuritySection';
import {
  Sun, Moon, Monitor, Wifi, Globe,
  Bell, BellOff,
  Timer, Shield,
  Layers, Maximize2, Minimize2,
} from 'lucide-react';
import { userCallServer } from '../lib/userClient';
import { useAuth } from '../contexts/AuthContext';

// ============================================================
// Settings Page — Security, Appearance, Network, Notifications
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
  const { userEmail } = useAuth();

  // ── Security stat ──
  const [passkeyCount, setPasskeyCount] = useState<number | null>(null);
  useEffect(() => {
    if (!userEmail) return;
    userCallServer<{ has_passkeys: boolean; passkeys: unknown[] }>('/user/passkey-status', userEmail)
      .then(data => setPasskeyCount(data.passkeys?.length ?? 0))
      .catch(() => setPasskeyCount(null));
  }, [userEmail]);

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
  // TODO: Wire notification prefs through useUserPreferences for server sync.
  // Currently uses localStorage only; server sync will be added in a future pass.
  const [notifPrefs, setNotifPrefs] = useState<NotificationPrefs>(loadNotificationPrefs);

  const toggleNotif = useCallback((key: keyof NotificationPrefs) => {
    setNotifPrefs(prev => {
      const next = { ...prev, [key]: !prev[key] };
      try { localStorage.setItem('coda-notification-prefs', JSON.stringify(next)); } catch {}
      return next;
    });
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

  const themeLabel = preference === 'dark' ? 'Dark' : preference === 'light' ? 'Light' : 'Auto';
  const securityValue = passkeyCount === null ? 'Not set up' : passkeyCount === 0 ? 'Not set up' : `${passkeyCount} passkey${passkeyCount > 1 ? 's' : ''}`;
  const pageStats: PageStat[] = [
    { icon: Sun, value: themeLabel, label: 'Theme' },
    { icon: Globe, value: isProductionCluster ? 'Solstice' : 'Devnet', label: 'Network' },
    { icon: Shield, value: securityValue, label: 'Security' },
  ];

  return (
    <div className="pb-12">
      <PageShell
        title="Settings"
        subtitle="Security, appearance, network, and notifications"
        stats={pageStats}
      >
        <div className="space-y-5">

        {/* ─────────────────────────────────────────────────────── */}
        {/* 1. Security                                            */}
        {/* ─────────────────────────────────────────────────────── */}
        <SecuritySection />

        {/* ─────────────────────────────────────────────────────── */}
        {/* 2. Appearance                                          */}
        {/* ─────────────────────────────────────────────────────── */}
        <WidgetShell title="Appearance" icon={Layers} collapsible defaultOpen>
          {/* Theme selector */}
          <div className="mb-4">
            <p className="text-[11px] font-medium text-coda-text-muted mb-3">Theme</p>
            <div className="grid grid-cols-3 gap-3">
              {themeOptions.map(opt => {
                const Icon = opt.icon;
                const active = preference === opt.pref;
                return (
                  <button
                    key={opt.pref}
                    onClick={() => setTheme(opt.pref)}
                    className={`relative flex flex-col items-center gap-3 p-5 rounded-xl transition-colors cursor-pointer ${
                      active
                        ? isDark
                          ? 'bg-white/10'
                          : 'bg-black/[0.04]'
                        : isDark
                          ? 'bg-transparent hover:text-coda-text'
                          : 'bg-transparent hover:text-coda-text'
                    }`}
                  >
                    {active && (
                      <div className={`absolute top-2.5 right-2.5 w-2 h-2 rounded-full ${opt.dotColor}`} />
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
                      <p className="text-[10px] text-coda-text-muted mt-1">{opt.desc}</p>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Density toggle */}
          <div>
            <p className="text-[11px] font-medium text-coda-text-muted mb-3">Density</p>
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
                    className={`relative flex items-center gap-3 p-5 text-left rounded-xl transition-colors cursor-pointer ${
                      active
                        ? isDark
                          ? 'bg-white/10'
                          : 'bg-black/[0.04]'
                        : isDark
                          ? 'bg-transparent hover:text-coda-text'
                          : 'bg-transparent hover:text-coda-text'
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
                      <p className="text-[10px] text-coda-text-muted mt-1">{opt.desc}</p>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        </WidgetShell>

        {/* ─────────────────────────────────────────────────────── */}
        {/* 3. Network                                             */}
        {/* ─────────────────────────────────────────────────────── */}
        <WidgetShell title="Network" icon={Wifi} collapsible defaultOpen>
          {/* Network environment (read-only, determined by build config) */}
          <div className="mb-4">
            <p className="text-[11px] font-medium text-coda-text-muted mb-3">Environment</p>

            {/* Live status indicator */}
            <div className="flex items-center gap-3 py-2">
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

          {/* Auto-refresh interval */}
          <div>
            <p className="text-[11px] font-medium text-coda-text-muted mb-3">
              Transaction Monitor Refresh
            </p>
            <div className="grid grid-cols-4 gap-2">
              {refreshOptions.map(opt => {
                const active = refreshInterval === opt.value;
                return (
                  <button
                    key={opt.value}
                    onClick={() => handleRefreshInterval(opt.value)}
                    className={`flex items-center justify-center gap-1.5 px-3 py-2.5 text-[13px] font-medium rounded-xl transition-colors cursor-pointer ${
                      active
                        ? isDark
                          ? 'bg-white/10 text-coda-text'
                          : 'bg-black/[0.04] text-coda-text'
                        : isDark
                          ? 'bg-transparent text-coda-text-secondary hover:text-coda-text'
                          : 'bg-transparent text-coda-text-secondary hover:text-coda-text'
                    }`}
                  >
                    {opt.value !== 'off' && <Timer size={13} className="opacity-60" />}
                    <span>{opt.label}</span>
                  </button>
                );
              })}
            </div>
            <p className="text-[10px] text-coda-text-muted mt-3 leading-relaxed">
              Controls how often the Transaction Monitor auto-polls for new settlements.
              Set to Off for manual refresh only.
            </p>
          </div>
        </WidgetShell>

        {/* ─────────────────────────────────────────────────────── */}
        {/* 4. Notifications                                       */}
        {/* ─────────────────────────────────────────────────────── */}
        <WidgetShell title="Notifications" icon={Bell} collapsible defaultOpen={false}>
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
        </WidgetShell>

        </div>
      </PageShell>
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
      className={`w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-black/[0.02] dark:hover:bg-white/[0.02] transition-colors cursor-pointer bg-transparent`}
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

