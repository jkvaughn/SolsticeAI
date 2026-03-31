import { Shield, Landmark, BarChart3, Eye, Building2, Check } from 'lucide-react';
import { useNavigate } from 'react-router';
import { usePersona } from '../contexts/PersonaContext';
import { useBanks } from '../contexts/BanksContext';
import { useTheme } from './ThemeProvider';
import { useIsAdmin } from '../hooks/useIsAdmin';
import type { PersonaType } from '../types';

// ============================================================
// Persona Switcher (XD "Users" table style)
// Clean row-based role selector + bank scope dropdown.
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
    label: 'Compliance Officer',
    desc: 'Escalations, transactions, proving ground',
    icon: Shield,
    defaultRoute: '/escalations',
  },
  {
    value: 'treasury',
    label: 'Treasury Manager',
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
      {/* Table header */}
      <div className="flex items-center gap-4 px-1 text-[11px] font-normal text-black/30 dark:text-white/30 uppercase tracking-wider">
        <span className="flex-1">Role</span>
        <span className="w-64 text-left">Scope</span>
        <span className="w-16 text-right">Status</span>
      </div>

      {/* Persona rows */}
      <div>
        {visibleOptions.map((opt, i) => {
          const active = opt.value === persona;
          return (
            <button
              key={opt.value ?? 'all'}
              onClick={() => handleSelect(opt)}
              className={`w-full flex items-center gap-4 px-1 py-4 text-left cursor-pointer transition-colors ${
                i > 0 ? 'border-t border-black/[0.04] dark:border-white/[0.04]' : ''
              } ${active ? '' : 'hover:bg-black/[0.01] dark:hover:bg-white/[0.02]'}`}
            >
              <div className="flex-1 min-w-0">
                <p className={`text-[14px] ${active ? 'text-black/80 dark:text-white/80' : 'text-black/50 dark:text-white/50'}`}>
                  {opt.label}
                </p>
              </div>
              <div className="w-64">
                <p className="text-[12px] text-black/35 dark:text-white/35">{opt.desc}</p>
              </div>
              <div className="w-16 flex justify-end">
                {active && (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium border border-emerald-500/30 text-emerald-600 dark:text-emerald-400">
                    <Check size={9} /> Active
                  </span>
                )}
              </div>
            </button>
          );
        })}
      </div>

      {/* Bank scope selector — only visible when a persona is active */}
      {persona && (
        <div className="pt-2">
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
