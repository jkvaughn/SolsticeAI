import { useState, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';

// ============================================================
// useCurrentUser — Auth-agnostic identity hook
// ============================================================
// Returns user identity regardless of auth provider (Azure or Supabase).
// Checks localStorage override for display name (from Profile page).
// ============================================================

const NAME_OVERRIDE_KEY = 'coda-operator-name';

interface CurrentUser {
  name: string;
  email: string;
  avatarInitials: string;
  provider: string;
  userId: string;
  isLoading: boolean;
}

function getInitials(name: string): string {
  const words = name.trim().split(/\s+/);
  if (words.length >= 2) {
    return (words[0][0] + words[words.length - 1][0]).toUpperCase();
  }
  return (words[0]?.[0] ?? '?').toUpperCase();
}

export function useCurrentUser(): CurrentUser {
  const { user, authProvider, loading } = useAuth();
  const [azureUser, setAzureUser] = useState<{ name: string; email: string; userId: string } | null>(null);

  // Fetch Azure user info on mount (production only)
  useEffect(() => {
    if (authProvider !== 'azure') return;
    fetch('/.auth/me')
      .then(res => res.json())
      .then(data => {
        const cp = data?.clientPrincipal;
        if (cp) {
          const email = cp.claims?.find((c: { typ: string }) =>
            c.typ === 'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress' ||
            c.typ === 'preferred_username' ||
            c.typ === 'email'
          )?.val ?? cp.userDetails ?? '';
          const name = cp.claims?.find((c: { typ: string }) =>
            c.typ === 'name' || c.typ === 'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/name'
          )?.val ?? cp.userDetails ?? '';
          setAzureUser({ name, email, userId: cp.userId ?? '' });
        }
      })
      .catch(() => {});
  }, [authProvider]);

  // Check localStorage name override
  const nameOverride = typeof window !== 'undefined'
    ? localStorage.getItem(NAME_OVERRIDE_KEY)
    : null;

  if (authProvider === 'azure') {
    const name = nameOverride || azureUser?.name || 'User';
    const email = azureUser?.email || '';
    return {
      name,
      email,
      avatarInitials: getInitials(name),
      provider: 'Azure Entra ID',
      userId: azureUser?.userId || '',
      isLoading: loading || (!azureUser && !nameOverride),
    };
  }

  // Supabase
  const supabaseName = user?.name || user?.email?.split('@')[0] || 'User';
  const name = nameOverride || supabaseName;
  const email = user?.email || '';
  return {
    name,
    email,
    avatarInitials: getInitials(name),
    provider: 'Supabase',
    userId: user?.id || '',
    isLoading: loading,
  };
}
