import { Shield, Landmark, BarChart3, Eye, Building2 } from 'lucide-react';
import { useNavigate } from 'react-router';
import { usePersona } from '../contexts/PersonaContext';
import { useBanks } from '../contexts/BanksContext';
import { useTheme } from './ThemeProvider';
import { useIsAdmin } from '../hooks/useIsAdmin';
import type { PersonaType } from '../types';

// ============================================================
// Persona Switcher (XD "Transfers – Send" card grid style)
// ============================================================

const PERSONA_OPTIONS: {
  value: PersonaType;
  label: string;
  desc: string;
  icon: React.ElementType;
  defaultRoute: string;
}[] = [
  {
    value: null,
    label: 'All Views',
    desc: 'Full navigation — all pages visible',
    icon: Eye,
    defaultRoute: '/',
  },
  {
    value: 'compliance',
    label: 'Compliance',
    desc: 'Escalations, transactions, proving ground',
    icon: Shield,
    defaultRoute: '/escalations',
  },
  {
    value: 'treasury',
    label: 'Treasury',
    desc: 'Treasury ops, agent config, transactions',
    icon: Landmark,
    defaultRoute: '/treasury-ops',
  },
  {
    value: 'leadership',
    label: 'Executive',
    desc: 'Dashboard, visualizer, network command',
    icon: BarChart3,
    defaultRoute: '/',
  },
];

export function PersonaSwitcher() {
  const { persona, setPersona, selectedBankId, setSelectedBankId } = usePersona();
  const { activeBanks } = useBanks();
  const { resolved } = useTheme();
  const isDark = resolved === 'dark';
  const navigate = useNavigate();
  const isAdmin = useIsAdmin();

  const handleSelect = (opt: typeof PERSONA_OPTIONS[number]) => {
    setPersona(opt.value);
    navigate(opt.defaultRoute);
  };

  const activeBank = activeBanks.find(b => b.id === selectedBankId);
  const visibleOptions = PERSONA_OPTIONS.filter(opt => opt.value !== null || isAdmin);

  return (
    <div className="space-y-5">
      {/* Card grid — XD Transfers Send style */}
      <div className={`grid gap-4 ${visibleOptions.length <= 3 ? 'grid-cols-3' : 'grid-cols-4'}`}>
        {visibleOptions.map(opt => {
          const Icon = opt.icon;
          const active = opt.value === persona;
          return (
            <button
              key={opt.value ?? 'all'}
              onClick={() => handleSelect(opt)}
              className={`relative flex flex-col items-start p-5 text-left rounded-xl cursor-pointer transition-all duration-200 ${
                active
                  ? 'bg-black/[0.04] dark:bg-white/[0.06] ring-1 ring-black/[0.08] dark:ring-white/[0.1]'
                  : 'bg-transparent hover:bg-black/[0.02] dark:hover:bg-white/[0.03] ring-1 ring-black/[0.04] dark:ring-white/[0.04] hover:ring-black/[0.08] dark:hover:ring-white/[0.08]'
              }`}
            >
              <Icon size={20} className={`mb-3 ${active ? 'text-black/70 dark:text-white/70' : 'text-black/25 dark:text-white/25'}`} />
              <p className={`text-[15px] mb-1 ${active ? 'font-medium text-black/80 dark:text-white/80' : 'text-black/50 dark:text-white/50'}`}>
                {opt.label}
              </p>
              <p className={`text-[11px] leading-relaxed ${active ? 'text-black/40 dark:text-white/40' : 'text-black/25 dark:text-white/25'}`}>
                {opt.desc}
              </p>
            </button>
          );
        })}
      </div>

      {/* Bank scope selector — only visible when a persona is active */}
      {persona && (
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
                {bank.short_code} — {bank.name}
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
