import { useState, useEffect, useCallback } from 'react';
import { useTheme, type ThemePreference } from './ThemeProvider';
import { callServer } from '../supabaseClient';
import { PageHeader } from './PageHeader';
import { PageTransition } from './PageTransition';
import { PersonaSwitcher } from './PersonaSwitcher';
import {
  Sun, Moon, Monitor, Wifi, WifiOff, Settings
} from 'lucide-react';

// ============================================================
// Settings Page — Theme, Network Mode, Persona View
// ============================================================

export function SettingsPage() {
  const { resolved, preference, setTheme } = useTheme();
  const isDark = resolved === 'dark';

  const [networkMode, setNetworkMode] = useState<'devnet' | 'production'>('devnet');
  const [networkLoading, setNetworkLoading] = useState(true);

  // Fetch current network mode
  useEffect(() => {
    callServer<{ mode: string }>('/network-mode', { action: 'get' })
      .then(res => {
        setNetworkMode((res.mode as 'devnet' | 'production') || 'devnet');
      })
      .catch(err => console.error('[Settings] Failed to fetch network mode:', err))
      .finally(() => setNetworkLoading(false));
  }, []);

  const handleNetworkModeChange = useCallback(async (mode: 'devnet' | 'production') => {
    setNetworkMode(mode);
    try {
      await callServer('/network-mode', { action: 'set', mode });
    } catch (err) {
      console.error('[Settings] Failed to set network mode:', err);
    }
  }, []);

  const themeOptions: { pref: ThemePreference; icon: React.ElementType; label: string; desc: string }[] = [
    { pref: 'auto',  icon: Monitor, label: 'System',  desc: 'Match your OS preference' },
    { pref: 'light', icon: Sun,     label: 'Light',   desc: 'Bright LiquidGlass appearance' },
    { pref: 'dark',  icon: Moon,    label: 'Dark',    desc: 'Reduced-light glass appearance' },
  ];

  return (
    <div className="max-w-2xl mx-auto space-y-8 pb-12">
      <PageHeader
        icon={Settings}
        title="Settings"
        subtitle="Appearance, network configuration, and persona view"
      />

      <PageTransition className="space-y-8">
      {/* ─── Appearance ─── */}
      <SettingsSection title="Appearance" desc="Choose how CODA looks on your device">
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
                  <div className="absolute top-2 right-2 w-2 h-2 rounded-full bg-coda-text-secondary" />
                )}
                <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${
                  active
                    ? 'bg-black/[0.08] dark:bg-white/[0.10] text-coda-text'
                    : isDark ? 'bg-white/5 text-gray-400' : 'bg-black/[0.04] text-gray-500'
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
      </SettingsSection>

      {/* ─── Network ─── */}
      <SettingsSection title="Network" desc="Solana settlement environment for AI agent context">
        {networkLoading ? (
          <div className="h-20 flex items-center justify-center">
            <span className="text-xs text-coda-text-muted font-mono">Loading...</span>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3">
            {([
              {
                mode: 'devnet' as const,
                icon: Wifi,
                label: 'Devnet',
                desc: 'Demo settlement on Solana Devnet with synthetic tokens',
                dot: 'bg-coda-text-secondary',
              },
              {
                mode: 'production' as const,
                icon: WifiOff,
                label: 'Production',
                desc: 'Agents evaluate without Devnet safety context',
                dot: 'bg-amber-500',
              },
            ]).map(opt => {
              const Icon = opt.icon;
              const active = networkMode === opt.mode;
              return (
                <button
                  key={opt.mode}
                  onClick={() => handleNetworkModeChange(opt.mode)}
                  className={`relative flex flex-col items-start gap-3 p-4 rounded-xl border text-left transition-all duration-300 cursor-pointer ${
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
                    <div className={`absolute top-3 right-3 w-2 h-2 rounded-full ${opt.dot}`} />
                  )}
                  <div className={`w-9 h-9 rounded-lg flex items-center justify-center ${
                    active
                      ? opt.mode === 'devnet'
                        ? 'bg-black/[0.08] dark:bg-white/[0.10] text-coda-text'
                        : 'bg-amber-500/10 text-amber-600 dark:text-amber-400'
                      : isDark ? 'bg-white/5 text-gray-400' : 'bg-black/[0.04] text-gray-500'
                  }`}>
                    <Icon size={18} />
                  </div>
                  <div>
                    <p className={`text-[13px] font-medium ${active ? 'text-coda-text' : 'text-coda-text-secondary'}`}>
                      {opt.label}
                    </p>
                    <p className="text-[10px] text-coda-text-muted mt-0.5 leading-relaxed">{opt.desc}</p>
                  </div>
                </button>
              );
            })}
          </div>
        )}

        {/* Live status indicator */}
        {!networkLoading && (
          <div className={`flex items-center gap-3 px-4 py-3 mt-3 rounded-xl border ${
            isDark ? 'bg-white/[0.03] border-white/[0.06]' : 'bg-black/[0.02] border-black/[0.04]'
          }`}>
            <div className="relative flex-shrink-0">
              <div className={`w-2.5 h-2.5 rounded-full ${networkMode === 'devnet' ? 'bg-emerald-500' : 'bg-amber-500'}`} />
              <div className={`absolute inset-0 w-2.5 h-2.5 rounded-full animate-pulse ${networkMode === 'devnet' ? 'bg-emerald-500' : 'bg-amber-500'}`} />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-[12px] font-medium text-coda-text">
                {networkMode === 'devnet' ? 'Solana Devnet' : 'Production Mode'}
              </p>
              <p className="text-[10px] text-coda-text-muted">
                {networkMode === 'devnet'
                  ? 'Connected — synthetic token settlement active'
                  : 'Live evaluation — no Devnet safety context injected'}
              </p>
            </div>
          </div>
        )}

        <p className="text-[10px] text-coda-text-muted mt-3 leading-relaxed">
          This setting injects a context preamble into all Gemini AI prompts. In Devnet mode, agents are instructed
          not to flag Solana Devnet or Token-2022 as operational risks.
        </p>
      </SettingsSection>

      {/* ─── Persona View ─── */}
      <SettingsSection title="Persona View" desc="Filter navigation and dashboard for your role">
        <PersonaSwitcher />
        <p className="text-[10px] text-coda-text-muted mt-3 leading-relaxed">
          Selecting a persona hides non-relevant pages from the sidebar and shows role-specific
          dashboard widgets. The "All Views" option restores full navigation.
        </p>
      </SettingsSection>
      </PageTransition>
    </div>
  );
}

// ── Reusable sub-components ──

function SettingsSection({ title, desc, children }: { title: string; desc: string; children: React.ReactNode }) {
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