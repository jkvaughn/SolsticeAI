import { createContext, useContext, useState, useCallback, type ReactNode } from 'react';
import type { PersonaType } from '../types';

// ============================================================
// Persona Context (Task 126)
// Provides role-based UX filtering across the app.
// Default: null = no persona, show everything (current behavior).
// ============================================================

const STORAGE_KEY = 'coda-persona-preference';

interface PersonaContextValue {
  persona: PersonaType;
  setPersona: (p: PersonaType) => void;
}

const PersonaContext = createContext<PersonaContextValue>({
  persona: null,
  setPersona: () => {},
});

function getInitialPersona(): PersonaType {
  if (typeof window === 'undefined') return null;
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored === 'compliance' || stored === 'treasury' || stored === 'leadership') return stored;
  return null;
}

export function PersonaProvider({ children }: { children: ReactNode }) {
  const [persona, setPersonaState] = useState<PersonaType>(getInitialPersona);

  const setPersona = useCallback((p: PersonaType) => {
    setPersonaState(p);
    if (p) {
      localStorage.setItem(STORAGE_KEY, p);
    } else {
      localStorage.removeItem(STORAGE_KEY);
    }
  }, []);

  return (
    <PersonaContext.Provider value={{ persona, setPersona }}>
      {children}
    </PersonaContext.Provider>
  );
}

export function usePersona() {
  return useContext(PersonaContext);
}
