import { Shield, Landmark, BarChart3 } from 'lucide-react';
import { usePersona } from '../contexts/PersonaContext';
import { useBanks } from '../contexts/BanksContext';
import type { PersonaType } from '../types';

// ============================================================
// Persona Banner (Task 126)
// Slim banner below page headers when a persona view is active.
// ============================================================

const PERSONA_CONFIG: Record<Exclude<PersonaType, null>, {
  label: string;
  icon: React.ElementType;
  bg: string;
  border: string;
  text: string;
}> = {
  compliance: {
    label: 'COMPLIANCE VIEW',
    icon: Shield,
    bg: 'bg-violet-500/10',
    border: 'border-violet-500/25',
    text: 'text-violet-600 dark:text-violet-400',
  },
  treasury: {
    label: 'TREASURY VIEW',
    icon: Landmark,
    bg: 'bg-emerald-500/10',
    border: 'border-emerald-500/25',
    text: 'text-emerald-600 dark:text-emerald-400',
  },
  leadership: {
    label: 'EXECUTIVE VIEW',
    icon: BarChart3,
    bg: 'bg-blue-500/10',
    border: 'border-blue-500/25',
    text: 'text-blue-600 dark:text-blue-400',
  },
};

export function PersonaBanner() {
  const { persona, setPersona } = usePersona();
  const { activeBanks } = useBanks();

  if (!persona) return null;

  const config = PERSONA_CONFIG[persona];
  const Icon = config.icon;

  // For compliance/treasury show first active bank name, leadership shows 'Network'
  const contextLabel = persona === 'leadership'
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
      <button
        onClick={() => setPersona(null)}
        className={`text-[10px] font-medium ${config.text} hover:underline cursor-pointer`}
      >
        Exit View
      </button>
    </div>
  );
}