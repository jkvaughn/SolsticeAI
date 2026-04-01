import { Shield, Landmark, BarChart3, Eye, ShieldCheck } from 'lucide-react';
import { usePersona } from '../contexts/PersonaContext';
import { useBanks } from '../contexts/BanksContext';
import { useTheme } from './ThemeProvider';
import type { UserRole } from '../types';

// ============================================================
// Role Switcher (Task 151 — replaces Persona Switcher)
// ============================================================

const ROLE_OPTIONS: {
  value: UserRole;
  label: string;
  desc: string;
  icon: React.ElementType;
}[] = [
  {
    value: 'admin',
    label: 'Admin',
    desc: 'Full access \u2014 all pages and actions',
    icon: Shield,
  },
  {
    value: 'treasury',
    label: 'Treasury',
    desc: 'Mandates, settlements, liquidity',
    icon: Landmark,
  },
  {
    value: 'compliance',
    label: 'Compliance',
    desc: 'Flags, audits, investigations',
    icon: Eye,
  },
  {
    value: 'bsa_officer',
    label: 'BSA Officer',
    desc: 'Compliance authority, approvals',
    icon: ShieldCheck,
  },
  {
    value: 'executive',
    label: 'Executive',
    desc: 'Network overview, KPIs',
    icon: BarChart3,
  },
];

export function PersonaSwitcher() {
  const { persona, setPersona, selectedBankId, setSelectedBankId } = usePersona();
  const { activeBanks } = useBanks();
  const { resolved } = useTheme();
  const isDark = resolved === 'dark';

  const handleSelect = (opt: typeof ROLE_OPTIONS[number]) => {
    setPersona(opt.value); // Uses optimistic update via PersonaContext
  };

  const activeBank = activeBanks.find(b => b.id === selectedBankId);

  return (
    <div className="space-y-5">
      {/* Card grid */}
      <div className="grid gap-4 grid-cols-5">
        {ROLE_OPTIONS.map(opt => {
          const Icon = opt.icon;
          const active = opt.value === persona;
          return (
            <button
              key={opt.value}
              onClick={() => handleSelect(opt)}
              className={`relative flex flex-col items-start p-5 text-left rounded-xl cursor-pointer transition-all duration-200 ${
                active
                  ? 'bg-black/[0.04] dark:bg-white/[0.06] ring-1 ring-black/[0.08] dark:ring-white/[0.1]'
                  : 'bg-transparent hover:bg-black/[0.02] dark:hover:bg-white/[0.03] ring-1 ring-black/[0.04] dark:ring-white/[0.04] hover:ring-black/[0.08] dark:hover:ring-white/[0.08]'
              }`}
            >
              <Icon size={20} className={`mb-3 ${active ? 'text-black/70 dark:text-white/70' : 'text-black/40 dark:text-white/40'}`} />
              <p className={`text-[15px] mb-1 ${active ? 'font-medium text-black/80 dark:text-white/80' : 'text-black/60 dark:text-white/60'}`}>
                {opt.label}
              </p>
              <p className={`text-[11px] leading-relaxed ${active ? 'text-black/40 dark:text-white/40' : 'text-black/35 dark:text-white/35'}`}>
                {opt.desc}
              </p>
            </button>
          );
        })}
      </div>

      {/* Bank scope selector — visible when a non-admin role is active */}
      {role !== 'admin' && (
        <div>
          <label className="block text-[12px] font-normal text-black/40 dark:text-white/40 mb-1">
            Bank Scope
          </label>
          <select
            value={selectedBankId ?? ''}
            onChange={e => setSelectedBankId(e.target.value || null)}
            className="w-full max-w-xs text-[14px] rounded-lg px-4 py-3 cursor-pointer transition-all bg-black/[0.03] dark:bg-white/[0.04] border-none text-black/70 dark:text-white/70 focus:outline-none focus:ring-1 focus:ring-black/10 dark:focus:ring-white/10"
          >
            <option value="">All Banks</option>
            {activeBanks.map(bank => (
              <option key={bank.id} value={bank.id}>
                {bank.short_code} \u2014 {bank.name}
              </option>
            ))}
          </select>
          {activeBank && (
            <p className="text-[11px] text-black/30 dark:text-white/30 mt-1.5">
              Filtering to {activeBank.short_code} transactions
            </p>
          )}
        </div>
      )}
    </div>
  );
}
