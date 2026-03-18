import { createContext, useContext, useEffect, useState, useCallback, type ReactNode } from 'react';

// ============================================================
// Theme types
// ============================================================

export type ThemePreference = 'light' | 'dark' | 'auto';
export type ResolvedTheme = 'light' | 'dark';

interface ThemeContextValue {
  /** User's stored preference: light | dark | auto */
  preference: ThemePreference;
  /** The actual applied theme after resolving "auto" against device settings */
  resolved: ResolvedTheme;
  /** Set a specific preference */
  setTheme: (pref: ThemePreference) => void;
  /** Cycle: auto -> light -> dark -> auto */
  cycleTheme: () => void;
}

const ThemeContext = createContext<ThemeContextValue>({
  preference: 'auto',
  resolved: 'dark',
  setTheme: () => {},
  cycleTheme: () => {},
});

export const useTheme = () => useContext(ThemeContext);

// ============================================================
// Storage key
// ============================================================

const STORAGE_KEY = 'coda-theme-preference';

function getStoredPreference(): ThemePreference {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === 'light' || stored === 'dark' || stored === 'auto') return stored;
  } catch {}
  return 'auto';
}

function getSystemTheme(): ResolvedTheme {
  if (typeof window === 'undefined') return 'dark';
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function resolveTheme(pref: ThemePreference): ResolvedTheme {
  if (pref === 'auto') return getSystemTheme();
  return pref;
}

// ============================================================
// Sync initial theme BEFORE React renders to prevent FOUC
// ============================================================

const initialPref = getStoredPreference();
const initialResolved = resolveTheme(initialPref);
if (typeof document !== 'undefined') {
  if (initialResolved === 'dark') {
    document.documentElement.classList.add('dark');
  } else {
    document.documentElement.classList.remove('dark');
  }
}

// ============================================================
// Provider
// ============================================================

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [preference, setPreference] = useState<ThemePreference>(initialPref);
  const [resolved, setResolved] = useState<ResolvedTheme>(initialResolved);

  // Apply the .dark class to <html>
  useEffect(() => {
    const theme = resolveTheme(preference);
    setResolved(theme);

    const root = document.documentElement;
    if (theme === 'dark') {
      root.classList.add('dark');
    } else {
      root.classList.remove('dark');
    }
  }, [preference]);

  // Listen for system theme changes when in auto mode
  useEffect(() => {
    if (preference !== 'auto') return;

    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = (e: MediaQueryListEvent) => {
      const newTheme = e.matches ? 'dark' : 'light';
      setResolved(newTheme);
      if (newTheme === 'dark') {
        document.documentElement.classList.add('dark');
      } else {
        document.documentElement.classList.remove('dark');
      }
    };

    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, [preference]);

  const setTheme = useCallback((pref: ThemePreference) => {
    setPreference(pref);
    try { localStorage.setItem(STORAGE_KEY, pref); } catch {}
  }, []);

  const cycleTheme = useCallback(() => {
    setPreference(prev => {
      const next: ThemePreference = prev === 'auto' ? 'light' : prev === 'light' ? 'dark' : 'auto';
      try { localStorage.setItem(STORAGE_KEY, next); } catch {}
      return next;
    });
  }, []);

  // Keyboard shortcut: Cmd+Shift+L (Mac) or Ctrl+Shift+L (Win/Linux)
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === 'l') {
        e.preventDefault();
        cycleTheme();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [cycleTheme]);

  return (
    <ThemeContext.Provider value={{ preference, resolved, setTheme, cycleTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}