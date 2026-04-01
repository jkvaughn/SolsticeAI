import { useCallback } from 'react';
import { userCallServer, userCallServerPost } from '../lib/userClient';
import { useAuth } from '../contexts/AuthContext';
import { useSWRCache, writeSWRCache } from './useSWRCache';

interface UserProfile {
  id: string;
  email: string;
  full_name: string | null;
  title: string | null;
  department: string | null;
  phone: string | null;
  institution: string | null;
  timezone: string;
  created_at: string;
  updated_at: string;
}

// Demo profile for local dev when backend is unavailable
const LOCAL_DEMO_PROFILE: UserProfile = {
  id: 'demo-local-001',
  email: 'demo@solsticenetwork.xyz',
  full_name: 'Demo User',
  title: 'Network Administrator',
  department: 'Operations',
  phone: '+14155550100',
  institution: 'Solstice Network',
  timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
};

const isLocalDev = typeof window !== 'undefined' &&
  (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1');

export function useUserProfile() {
  const { userEmail } = useAuth();

  const cacheKey = `user-profile-${userEmail ?? 'none'}`;

  const { data: profile, isValidating, error, invalidate } = useSWRCache<UserProfile>({
    key: cacheKey,
    fetcher: async () => {
      if (!userEmail) throw new Error('No user email');
      try {
        return await userCallServer<UserProfile>('/user/profile', userEmail);
      } catch (err) {
        // On local dev, return demo data instead of hanging
        if (isLocalDev) {
          return { ...LOCAL_DEMO_PROFILE, email: userEmail };
        }
        throw err;
      }
    },
    ttl: 5 * 60 * 1000,
  });

  const updateProfile = useCallback(async (fields: Partial<UserProfile>) => {
    if (!userEmail) return;

    // On local dev, update demo data in cache directly
    if (isLocalDev && profile) {
      const updated = { ...profile, ...fields, updated_at: new Date().toISOString() };
      writeSWRCache(cacheKey, updated);
      invalidate();
      return updated;
    }

    const data = await userCallServerPost<UserProfile>('/user/profile-update', userEmail, fields as Record<string, unknown>);
    writeSWRCache(cacheKey, data);
    invalidate();
    return data;
  }, [userEmail, cacheKey, invalidate, profile]);

  const isLoading = isValidating && !profile;

  return { profile, isLoading, error: error?.message ?? null, updateProfile, refetch: invalidate };
}
