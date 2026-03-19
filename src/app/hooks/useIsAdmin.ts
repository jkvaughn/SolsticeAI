import { useAuth } from '../contexts/AuthContext';

/**
 * Returns true if the current user's email matches VITE_ADMIN_EMAIL.
 * Admin gets: god mode (All Views), Setup, Proving Ground, Danger Zone.
 * Non-admin: forced into persona + bank scope, restricted nav.
 */
export function useIsAdmin(): boolean {
  const { userEmail } = useAuth();
  const adminEmail = import.meta.env.VITE_ADMIN_EMAIL;
  return !!userEmail && !!adminEmail && userEmail.toLowerCase() === adminEmail.toLowerCase();
}
