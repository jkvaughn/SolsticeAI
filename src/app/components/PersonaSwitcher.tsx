import { Shield, Landmark, BarChart3, Eye, Building2 } from 'lucide-react';
import { useNavigate } from 'react-router';
import { usePersona } from '../contexts/PersonaContext';
import { useBanks } from '../contexts/BanksContext';
import { useTheme } from './ThemeProvider';
import { useIsAdmin } from '../hooks/useIsAdmin';
import type { PersonaType } from '../types';

// ============================================================
// Persona Switcher (Task 126 + Task 130)
// Role selector + bank scope dropdown.
// ============================================================

const PERSONA_OPTIONS: {
  value: PersonaType;
  label: string;
  desc: string;
  icon: React.ElementType;
  color: string;
  dot: string;
  defaultRoute: string;
}[] = [
  {
    value: null,
    label: 'All Views',
    desc: 'Full navigation — all pages visible',
    icon: Eye,
    color: '',
    dot: 'bg-coda-text-muted',
    defaultRoute: '/',
  },
  {
    value: 'compliance',
    label: 'Compliance Officer',
    desc: 'Escalations, transactions, proving ground',
    icon: Shield,
    color: 'text-coda-brand',
    dot: 'bg-coda-brand',
    defaultRoute: '/escalations',
  },
  {
    value: 'treasury',
    label: 'Treasury Manager',
    desc: 'Treasury ops, agent config, transactions',
    icon: Landmark,
    color: 'text-emerald-600 dark:text-emerald-400',
    dot: 'bg-emerald-500',
    defaultRoute: '/treasury-ops',
  },
  {
    value: 'leadership',
    label: 'Executive',
    desc: 'Dashboard, visualizer, network command',
    icon: BarChart3,
    color: 'text-blue-600 dark:text-blue-400',
    dot: 'bg-blue-500',
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

  // Build display label for sidebar pill
  const activeOpt = PERSONA_OPTIONS.find(o => o.value === persona);
  const activeBank = activeBanks.find(b => b.id === selectedBankId);

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        {PERSONA_OPTIONS.filter(opt => opt.value !== null || isAdmin).map(opt => {
          const Icon = opt.icon;
          const active = opt.value === persona;
          return (
            <button
              key={opt.value ?? 'all'}
              onClick={() => handleSelect(opt)}
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
                  ? opt.value
                    ? `${opt.color.includes('coda-brand') ? 'bg-coda-brand/10' : opt.color.includes('emerald') ? 'bg-emerald-500/10' : opt.color.includes('blue') ? 'bg-blue-500/10' : 'bg-coda-brand/10'} ${opt.color}`
                    : 'bg-coda-brand/10 text-coda-brand'
                  : isDark ? 'bg-white/5 text-coda-text-muted' : 'bg-black/[0.04] text-coda-text-muted'
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

      {/* Bank scope selector — only visible when a persona is active */}
      {persona && (
        <div className={`rounded-xl border p-3 ${
          isDark ? 'bg-white/[0.03] border-white/[0.06]' : 'bg-black/[0.02] border-black/[0.04]'
        }`}>
          <div className="flex items-center gap-2 mb-2">
            <Building2 size={13} className="text-coda-text-muted" />
            <span className="text-[10px] uppercase tracking-wider text-coda-text-muted font-medium">
              Bank Scope
            </span>
          </div>
          <select
            value={selectedBankId ?? ''}
            onChange={e => setSelectedBankId(e.target.value || null)}
            className={`w-full text-[12px] font-medium rounded-lg px-3 py-2 cursor-pointer transition-all ${
              isDark
                ? 'bg-white/[0.06] border-white/[0.1] text-coda-text'
                : 'bg-white/50 border-black/[0.08] text-coda-text'
            } border focus:outline-none focus:ring-2 focus:ring-coda-brand/30`}
          >
            <option value="">All Banks</option>
            {activeBanks.map(bank => (
              <option key={bank.id} value={bank.id}>
                {bank.short_code} — {bank.name}
              </option>
            ))}
          </select>
          {activeBank && (
            <p className="text-[10px] text-coda-text-muted mt-1.5">
              Filtering to {activeBank.short_code} transactions
            </p>
          )}
        </div>
      )}
    </div>
  );
}
