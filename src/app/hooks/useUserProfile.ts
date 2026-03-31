import { useState, useEffect, useCallback } from 'react';
import { userCallServer, userCallServerPost } from '../lib/userClient';
import { useAuth } from '../contexts/AuthContext';

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
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchProfile = useCallback(async () => {
    if (!userEmail) return;
    try {
      const data = await userCallServer<UserProfile>('/user/profile', userEmail);
      setProfile(data);
      setError(null);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setIsLoading(false);
    }
  }, [userEmail]);

  useEffect(() => { fetchProfile(); }, [fetchProfile]);

  const updateProfile = useCallback(async (fields: Partial<UserProfile>) => {
    if (!userEmail) return;
    try {
      const data = await userCallServerPost<UserProfile>('/user/profile-update', userEmail, fields as Record<string, unknown>);
      setProfile(data);
      return data;
    } catch (err: any) {
      setError(err.message);
      throw err;
    }
  }, [userEmail]);

  return { profile, isLoading, error, updateProfile, refetch: fetchProfile };
}
