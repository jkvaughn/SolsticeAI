import { useAuth } from '../contexts/AuthContext';
import { useUserRole } from './useUserRole';

export function useIsAdmin(): boolean {
  const { userEmail } = useAuth();
  const { isAdmin } = useUserRole();

  // Fail-safe: admin email always passes even if role isn't loaded yet
  const adminEmail = import.meta.env.VITE_ADMIN_EMAIL;
  const emailMatch = !!userEmail && !!adminEmail && userEmail.toLowerCase() === adminEmail.toLowerCase();

  return isAdmin || emailMatch;
}
