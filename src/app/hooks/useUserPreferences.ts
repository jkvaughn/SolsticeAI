import { useState, useEffect, useCallback, useRef } from 'react';
import { userCallServer } from '../lib/userClient';
import { useAuth } from '../contexts/AuthContext';

interface UserPreferences {
  theme: string;
  density: string;
  refresh_interval: string;
  default_persona: string;
  default_bank: string;
  notification_prefs: Record<string, boolean>;
}

const LS_KEYS: Record<keyof UserPreferences, string> = {
  theme: 'coda-theme-preference',
  density: 'coda-density-preference',
  refresh_interval: 'coda-refresh-interval',
  notification_prefs: 'coda-notification-prefs',
  default_persona: 'coda-default-persona',
  default_bank: 'coda-default-bank',
};

export function useUserPreferences() {
  const { userEmail } = useAuth();
  const [preferences, setPreferences] = useState<UserPreferences | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSyncing, setIsSyncing] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();

  const fetchPreferences = useCallback(async () => {
    if (!userEmail) return;
    try {
      const data = await userCallServer<UserPreferences>('/user/preferences', userEmail);

      // Check if server returned defaults (new user) — migrate localStorage
      const isDefaults = data.theme === 'auto' && data.density === 'default' && data.refresh_interval === '10';
      if (isDefaults) {
        const localPrefs: Partial<UserPreferences> = {};
        const lsTheme = localStorage.getItem(LS_KEYS.theme);
        const lsDensity = localStorage.getItem(LS_KEYS.density);
        const lsRefresh = localStorage.getItem(LS_KEYS.refresh_interval);
        const lsNotifs = localStorage.getItem(LS_KEYS.notification_prefs);
        const lsPersona = localStorage.getItem(LS_KEYS.default_persona);
        const lsBank = localStorage.getItem(LS_KEYS.default_bank);

        if (lsTheme) localPrefs.theme = lsTheme;
        if (lsDensity) localPrefs.density = lsDensity;
        if (lsRefresh) localPrefs.refresh_interval = lsRefresh;
        if (lsNotifs) try { localPrefs.notification_prefs = JSON.parse(lsNotifs); } catch { /* ignore */ }
        if (lsPersona) localPrefs.default_persona = lsPersona;
        if (lsBank) localPrefs.default_bank = lsBank;

        if (Object.keys(localPrefs).length > 0) {
          const merged = await userCallServer<UserPreferences>(
            '/user/preferences', userEmail, 'PUT', localPrefs as Record<string, unknown>,
          );
          setPreferences(merged);
          return;
        }
      }

      // Server has non-default values — sync TO localStorage
      if (data.theme) localStorage.setItem(LS_KEYS.theme, data.theme);
      if (data.density) localStorage.setItem(LS_KEYS.density, data.density);
      if (data.refresh_interval) localStorage.setItem(LS_KEYS.refresh_interval, data.refresh_interval);
      if (data.notification_prefs) localStorage.setItem(LS_KEYS.notification_prefs, JSON.stringify(data.notification_prefs));

      setPreferences(data);
    } catch {
      // Fallback to localStorage if server unavailable
      setPreferences({
        theme: localStorage.getItem(LS_KEYS.theme) || 'auto',
        density: localStorage.getItem(LS_KEYS.density) || 'default',
        refresh_interval: localStorage.getItem(LS_KEYS.refresh_interval) || '10',
        default_persona: localStorage.getItem(LS_KEYS.default_persona) || '',
        default_bank: localStorage.getItem(LS_KEYS.default_bank) || '',
        notification_prefs: JSON.parse(localStorage.getItem(LS_KEYS.notification_prefs) || '{}'),
      });
    } finally {
      setIsLoading(false);
    }
  }, [userEmail]);

  useEffect(() => { fetchPreferences(); }, [fetchPreferences]);

  const updatePreference = useCallback((key: keyof UserPreferences, value: unknown) => {
    if (!userEmail || !preferences) return;

    // Instant localStorage update
    const lsKey = LS_KEYS[key];
    if (lsKey) {
      localStorage.setItem(lsKey, typeof value === 'object' ? JSON.stringify(value) : String(value));
    }

    // Update local state
    setPreferences(prev => prev ? { ...prev, [key]: value } : prev);

    // Debounced server sync
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      setIsSyncing(true);
      try {
        await userCallServer('/user/preferences', userEmail, 'PUT', { [key]: value } as Record<string, unknown>);
      } catch {
        // Silent fail — localStorage is the fallback
      } finally {
        setIsSyncing(false);
      }
    }, 300);
  }, [userEmail, preferences]);

  return { preferences, isLoading, isSyncing, updatePreference, refetch: fetchPreferences };
}
