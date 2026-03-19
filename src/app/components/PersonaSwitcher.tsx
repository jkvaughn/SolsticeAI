import { Shield, Landmark, BarChart3, Eye, Building2 } from 'lucide-react';
import { useNavigate } from 'react-router';
import { usePersona } from '../contexts/PersonaContext';
import { useBanks } from '../contexts/BanksContext';
import { useTheme } from './ThemeProvider';
import { useIsAdmin } from '../hooks/useIsAdmin';
import type { PersonaType } from '../types';

// ============================================================
// Persona Switcher (Task 126 + Task 130)
// Compact dropdown selectors for role + bank scope.
// ============================================================

const PERSONA_OPTIONS: {
  value: PersonaType;
  label: string;
  defaultRoute: string;
}[] = [
  { value: null, label: 'All Views', defaultRoute: '/' },
  { value: 'compliance', label: 'Compliance Officer', defaultRoute: '/escalations' },
  { value: 'treasury', label: 'Treasury Manager', defaultRoute: '/treasury-ops' },
  { value: 'leadership', label: 'Executive', defaultRoute: '/' },
];

export function PersonaSwitcher() {
  const { persona, setPersona, selectedBankId, setSelectedBankId } = usePersona();
  const { activeBanks } = useBanks();
  const { resolved } = useTheme();
  const isDark = resolved === 'dark';
  const navigate = useNavigate();
  const isAdmin = useIsAdmin();

  const selectClasses = `w-full text-[12px] font-medium rounded-lg px-3 py-2 cursor-pointer transition-all ${
    isDark
      ? 'bg-white/[0.06] border-white/[0.1] text-coda-text'
      : 'bg-white/50 border-black/[0.08] text-coda-text'
  } border focus:outline-none focus:ring-2 focus:ring-coda-brand/30`;

  return (
    <div className="space-y-2.5">
      {/* Role selector */}
      <div>
        <div className="flex items-center gap-1.5 mb-1.5">
          <Shield size={11} className="text-coda-text-muted" />
          <span className="text-[9px] uppercase tracking-wider text-coda-text-muted font-medium">
            Role
          </span>
        </div>
        <select
          value={persona ?? ''}
          onChange={e => {
            const val = e.target.value || null;
            const opt = PERSONA_OPTIONS.find(o => (o.value ?? '') === (val ?? ''));
            setPersona(val as PersonaType);
            if (opt) navigate(opt.defaultRoute);
          }}
          className={selectClasses}
        >
          {PERSONA_OPTIONS
            .filter(opt => opt.value !== null || isAdmin)
            .map(opt => (
              <option key={opt.value ?? 'all'} value={opt.value ?? ''}>
                {opt.label}
              </option>
            ))}
        </select>
      </div>

      {/* Bank scope — only when a persona is active */}
      {persona && (
        <div>
          <div className="flex items-center gap-1.5 mb-1.5">
            <Building2 size={11} className="text-coda-text-muted" />
            <span className="text-[9px] uppercase tracking-wider text-coda-text-muted font-medium">
              Bank Scope
            </span>
          </div>
          <select
            value={selectedBankId ?? ''}
            onChange={e => setSelectedBankId(e.target.value || null)}
            className={selectClasses}
          >
            <option value="">All Banks</option>
            {activeBanks.map(bank => (
              <option key={bank.id} value={bank.id}>
                {bank.short_code} — {bank.name}
              </option>
            ))}
          </select>
        </div>
      )}
    </div>
  );
}
