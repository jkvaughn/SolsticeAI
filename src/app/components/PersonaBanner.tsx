import { Shield, Landmark, BarChart3, ShieldCheck } from 'lucide-react';
import { usePersona } from '../contexts/PersonaContext';
import { useBanks } from '../contexts/BanksContext';
import { useIsAdmin } from '../hooks/useIsAdmin';
import type { PersonaType } from '../types';

// ============================================================
// Persona Banner (Task 126 + Task 151)
// Slim banner below page headers when a non-admin role is active.
// ============================================================

const PERSONA_CONFIG: Record<string, {
  label: string;
  icon: React.ElementType;
  bg: string;
  border: string;
  text: string;
}> = {
  compliance: {
    label: 'COMPLIANCE VIEW',
    icon: Shield,
    bg: 'bg-coda-brand/10',
    border: 'border-coda-brand/25',
    text: 'text-coda-brand',
  },
  treasury: {
    label: 'TREASURY VIEW',
    icon: Landmark,
    bg: 'bg-emerald-500/10',
    border: 'border-emerald-500/25',
    text: 'text-emerald-600 dark:text-emerald-400',
  },
  executive: {
    label: 'EXECUTIVE VIEW',
    icon: BarChart3,
    bg: 'bg-blue-500/10',
    border: 'border-blue-500/25',
    text: 'text-blue-600 dark:text-blue-400',
  },
  bsa_officer: {
    label: 'BSA OFFICER VIEW',
    icon: ShieldCheck,
    bg: 'bg-amber-500/10',
    border: 'border-amber-500/25',
    text: 'text-amber-600 dark:text-amber-400',
  },
};

export function PersonaBanner() {
  const { persona, setPersona, selectedBankId } = usePersona();
  const { activeBanks } = useBanks();
  const isAdmin = useIsAdmin();

  // No banner for admin role or null persona
  if (!persona || persona === 'admin') return null;

  const config = PERSONA_CONFIG[persona];
  if (!config) return null;
  const Icon = config.icon;

  // Show scoped bank if selected, otherwise generic context
  const scopedBank = activeBanks.find(b => b.id === selectedBankId);
  const contextLabel = scopedBank
    ? `${scopedBank.name} \u00b7 ${scopedBank.swift_bic || scopedBank.short_code}`
    : persona === 'executive'
      ? 'Network'
      : activeBanks.length > 0
        ? activeBanks[0].name
        : 'Network';

  return (
    <div className={`flex items-center gap-2 px-3 py-1 rounded-lg border ${config.bg} ${config.border} mb-3`}>
      <Icon size={13} className={config.text} />
      <span className={`text-[11px] font-bold tracking-wide font-mono ${config.text}`}>
        {config.label}
      </span>
      <span className="text-[11px] text-coda-text-muted">
        &mdash; {contextLabel}
      </span>
      <div className="flex-1" />
      {isAdmin && <button
        onClick={() => setPersona(null)}
        className={`liquid-button text-[10px] font-medium ${config.text} cursor-pointer`}
      >
        <span>Exit View</span>
      </button>}
    </div>
  );
}
