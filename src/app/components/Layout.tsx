import { Outlet } from 'react-router';
import { DashboardLayout } from './dashboard/dashboard-layout';
import { HeartbeatIndicator } from './HeartbeatIndicator';
import { BanksProvider, useBanks } from '../contexts/BanksContext';
import { AriaProvider } from '../contexts/AriaContext';
import { PersonaBanner } from './PersonaBanner';
import { usePersona } from '../contexts/PersonaContext';
import { useIsAdmin } from '../hooks/useIsAdmin';
import { useState } from 'react';
import { Shield, Landmark, BarChart3, Building2 } from 'lucide-react';
import type { PersonaType } from '../types';

// ============================================================
// Non-admin onboarding modal — forces persona + bank selection
// ============================================================

function OnboardingModal() {
  const { setPersona, setSelectedBankId } = usePersona();
  const { activeBanks } = useBanks();
  const [selectedPersona, setSelectedPersona] = useState<PersonaType>(null);
  const [selectedBank, setSelectedBank] = useState('');

  const canProceed = selectedPersona && selectedBank;

  const handleProceed = () => {
    if (!selectedPersona || !selectedBank) return;
    setPersona(selectedPersona);
    setSelectedBankId(selectedBank);
  };

  const personas: { value: Exclude<PersonaType, null>; label: string; icon: React.ElementType }[] = [
    { value: 'compliance', label: 'Compliance Officer', icon: Shield },
    { value: 'treasury', label: 'Treasury Manager', icon: Landmark },
    { value: 'leadership', label: 'Executive', icon: BarChart3 },
  ];

  return (
    <div className="fixed inset-0 z-[9999] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="w-full max-w-md rounded-2xl bg-coda-bg border border-coda-border shadow-2xl overflow-hidden">
        <div className="px-6 pt-8 pb-4 text-center">
          <h2 className="text-lg font-medium text-coda-text">Welcome to CODA</h2>
          <p className="text-sm text-coda-text-muted mt-1">Select your role and institution to get started.</p>
        </div>

        <div className="px-6 pb-4 space-y-4">
          {/* Persona selector */}
          <div>
            <label className="block text-[11px] uppercase tracking-wider text-coda-text-muted font-medium mb-2">
              Your Role
            </label>
            <div className="grid grid-cols-3 gap-2">
              {personas.map(p => {
                const Icon = p.icon;
                const active = selectedPersona === p.value;
                return (
                  <button
                    key={p.value}
                    onClick={() => setSelectedPersona(p.value)}
                    className={`flex flex-col items-center gap-2 p-3 rounded-xl border text-center transition-all cursor-pointer ${
                      active
                        ? 'bg-coda-brand/10 border-coda-brand/30 text-coda-brand'
                        : 'bg-coda-surface border-coda-border/50 text-coda-text-muted hover:border-coda-border'
                    }`}
                  >
                    <Icon size={20} />
                    <span className="text-[10px] font-medium">{p.label}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Bank selector */}
          <div>
            <label className="block text-[11px] uppercase tracking-wider text-coda-text-muted font-medium mb-2">
              <Building2 size={11} className="inline mr-1" />
              Your Institution
            </label>
            <select
              value={selectedBank}
              onChange={e => setSelectedBank(e.target.value)}
              className="w-full text-sm rounded-xl px-4 py-3 bg-coda-surface border border-coda-border/50 text-coda-text focus:outline-none focus:ring-2 focus:ring-coda-brand/30 cursor-pointer"
            >
              <option value="">Select a bank...</option>
              {activeBanks.map(bank => (
                <option key={bank.id} value={bank.id}>
                  {bank.short_code} — {bank.name}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="px-6 pb-8">
          <button
            onClick={handleProceed}
            disabled={!canProceed}
            className={`w-full py-3 rounded-xl text-sm font-medium transition-all ${
              canProceed
                ? 'bg-coda-brand text-white hover:bg-coda-brand-dim cursor-pointer shadow-lg'
                : 'bg-coda-surface text-coda-text-muted cursor-not-allowed'
            }`}
          >
            Continue
          </button>
        </div>
      </div>
    </div>
  );
}

// ============================================================
// Layout — with admin gate for onboarding modal
// ============================================================

function LayoutInner() {
  const isAdmin = useIsAdmin();
  const { persona, selectedBankId } = usePersona();

  // Non-admin with no persona or bank set → show onboarding modal
  const needsOnboarding = !isAdmin && (!persona || !selectedBankId);

  return (
    <DashboardLayout>
      {needsOnboarding && <OnboardingModal />}
      <PersonaBanner />
      <Outlet />
      <HeartbeatIndicator />
    </DashboardLayout>
  );
}

export function Layout() {
  return (
    <BanksProvider>
      <AriaProvider>
        <LayoutInner />
      </AriaProvider>
    </BanksProvider>
  );
}
