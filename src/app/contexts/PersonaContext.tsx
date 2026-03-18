import { createContext, useContext, useState, useCallback, type ReactNode } from 'react';
import type { PersonaType } from '../types';

// ============================================================
// Persona Context (Task 126 + Task 130)
// Provides role-based UX filtering + bank scoping across the app.
// Default: null persona + null bank = show everything.
// ============================================================

const STORAGE_KEY = 'coda-persona-preference';
const DEFAULT_PERSONA_KEY = 'coda-default-persona';
const DEFAULT_BANK_KEY = 'coda-default-bank';

interface PersonaState {
  persona: PersonaType;
  bankId: string | null;
}

interface PersonaContextValue {
  persona: PersonaType;
  setPersona: (p: PersonaType) => void;
  selectedBankId: string | null;
  setSelectedBankId: (id: string | null) => void;
}

const PersonaContext = createContext<PersonaContextValue>({
  persona: null,
  setPersona: () => {},
  selectedBankId: null,
  setSelectedBankId: () => {},
});

function getInitialState(): PersonaState {
  if (typeof window === 'undefined') return { persona: null, bankId: null };

  // Try stored session state first
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored);
      if (typeof parsed === 'object' && parsed !== null && 'persona' in parsed) {
        return {
          persona: parsed.persona || null,
          bankId: parsed.bankId || null,
        };
      }
      // Legacy: plain string from Task 126
      if (parsed === 'compliance' || parsed === 'treasury' || parsed === 'leadership') {
        return { persona: parsed, bankId: null };
      }
    }
  } catch { /* ignore parse errors */ }

  // Fall back to Profile page defaults
  const defaultPersona = localStorage.getItem(DEFAULT_PERSONA_KEY);
  const defaultBank = localStorage.getItem(DEFAULT_BANK_KEY);
  return {
    persona: (defaultPersona === 'compliance' || defaultPersona === 'treasury' || defaultPersona === 'leadership')
      ? defaultPersona : null,
    bankId: defaultBank || null,
  };
}

export function PersonaProvider({ children }: { children: ReactNode }) {
  const initial = getInitialState();
  const [persona, setPersonaState] = useState<PersonaType>(initial.persona);
  const [selectedBankId, setSelectedBankIdState] = useState<string | null>(initial.bankId);

  const persist = useCallback((p: PersonaType, bankId: string | null) => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ persona: p, bankId }));
  }, []);

  const setPersona = useCallback((p: PersonaType) => {
    setPersonaState(p);
    // Reset bank scope when clearing persona
    const newBankId = p ? selectedBankId : null;
    if (!p) setSelectedBankIdState(null);
    persist(p, newBankId);
  }, [selectedBankId, persist]);

  const setSelectedBankId = useCallback((id: string | null) => {
    setSelectedBankIdState(id);
    persist(persona, id);
  }, [persona, persist]);

  return (
    <PersonaContext.Provider value={{ persona, setPersona, selectedBankId, setSelectedBankId }}>
      {children}
    </PersonaContext.Provider>
  );
}

export function usePersona() {
  return useContext(PersonaContext);
}
