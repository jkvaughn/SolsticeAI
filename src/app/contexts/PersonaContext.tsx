import React, { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from 'react';
import { useUserRole } from '../hooks/useUserRole';
import type { PersonaType, UserRole } from '../types';

// ============================================================
// Persona Context (Task 126 + Task 130 + Task 151)
// Role now comes from server-side user profile via useUserRole.
// Bank scoping remains localStorage-based (orthogonal to role).
// ============================================================

const STORAGE_KEY = 'coda-persona-preference';
const DEFAULT_BANK_KEY = 'coda-default-bank';

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

function getInitialBankId(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored);
      if (typeof parsed === 'object' && parsed !== null && 'bankId' in parsed) {
        return parsed.bankId || null;
      }
    }
  } catch { /* ignore */ }
  return localStorage.getItem(DEFAULT_BANK_KEY) || null;
}

export function PersonaProvider({ children }: { children: ReactNode }) {
  const { role, setRole } = useUserRole();
  const [selectedBankId, setSelectedBankIdState] = useState<string | null>(getInitialBankId);

  // Derive persona from role
  const persona: PersonaType = role;

  // Migrate legacy localStorage on mount
  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);
        // Legacy plain string from Task 126
        if (typeof parsed === 'string') {
          if (parsed === 'leadership') {
            setRole('executive');
          }
          // Clear legacy value — role now comes from server
          localStorage.removeItem(STORAGE_KEY);
        } else if (typeof parsed === 'object' && parsed !== null && 'persona' in parsed) {
          // Legacy object format — migrate persona if 'leadership'
          if (parsed.persona === 'leadership') {
            setRole('executive');
          }
          // Keep bankId, clear persona from storage
          const bankId = parsed.bankId || null;
          localStorage.setItem(STORAGE_KEY, JSON.stringify({ bankId }));
        }
      }
    } catch { /* ignore */ }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const persistBankId = useCallback((bankId: string | null) => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ bankId }));
  }, []);

  const setPersona = useCallback((p: PersonaType) => {
    if (p === null) {
      // null = admin = all views
      setRole('admin');
    } else {
      setRole(p as UserRole);
    }
  }, [setRole]);

  const setSelectedBankId = useCallback((id: string | null) => {
    setSelectedBankIdState(id);
    persistBankId(id);
  }, [persistBankId]);

  return (
    <PersonaContext.Provider value={{ persona, setPersona, selectedBankId, setSelectedBankId }}>
      {children}
    </PersonaContext.Provider>
  );
}

export function usePersona() {
  return useContext(PersonaContext);
}
