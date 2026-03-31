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

export function useUserProfile() {
  const { userEmail } = useAuth();

  const cacheKey = `user-profile-${userEmail ?? 'none'}`;

  const { data: profile, isValidating, error, invalidate } = useSWRCache<UserProfile>({
    key: cacheKey,
    fetcher: async () => {
      if (!userEmail) throw new Error('No user email');
      return userCallServer<UserProfile>('/user/profile', userEmail);
    },
    ttl: 5 * 60 * 1000,
  });

  const updateProfile = useCallback(async (fields: Partial<UserProfile>) => {
    if (!userEmail) return;
    const data = await userCallServerPost<UserProfile>('/user/profile-update', userEmail, fields as Record<string, unknown>);
    // Write the updated profile directly into the SWR cache
    writeSWRCache(cacheKey, data);
    invalidate();
    return data;
  }, [userEmail, cacheKey, invalidate]);

  // isLoading: true only when validating AND no cached data yet
  const isLoading = isValidating && !profile;

  return { profile, isLoading, error: error?.message ?? null, updateProfile, refetch: invalidate };
}
