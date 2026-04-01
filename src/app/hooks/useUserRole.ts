import { useCallback } from 'react';
import { useUserProfile } from './useUserProfile';
import type { UserRole } from '../types';

const VALID_ROLES: UserRole[] = ['treasury', 'compliance', 'bsa_officer', 'executive', 'admin'];

export function useUserRole() {
  const { profile, updateProfile } = useUserProfile();

  const role: UserRole = (profile?.role && VALID_ROLES.includes(profile.role as UserRole))
    ? (profile.role as UserRole)
    : 'admin';

  const setRole = useCallback(async (newRole: UserRole) => {
    await updateProfile({ role: newRole });
  }, [updateProfile]);

  return {
    role,
    setRole,
    isAdmin: role === 'admin',
    isTreasury: role === 'treasury',
    isCompliance: role === 'compliance',
    isBSA: role === 'bsa_officer',
    isExecutive: role === 'executive',
  };
}
