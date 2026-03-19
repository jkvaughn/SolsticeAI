import { createContext, useContext, useEffect, useState, useCallback, type ReactNode } from 'react';
import { supabase, serverBaseUrl, publicAnonKey } from '../supabaseClient';
import type { Session, User } from '@supabase/supabase-js';

// ============================================================
// Auth Context — supports Supabase auth (dev/staging) and
// Azure Entra ID auth (production via Static Web Apps).
// Controlled by VITE_AUTH_PROVIDER env var.
// ============================================================

const AUTH_PROVIDER = import.meta.env.VITE_AUTH_PROVIDER || 'supabase';

// Unified user type that works for both providers
interface AppUser {
  id: string;
  email: string;
  name?: string;
}

interface AuthState {
  user: AppUser | null;
  supabaseUser: User | null;
  session: Session | null;
  loading: boolean;
  error: string | null;
}

interface AuthContextValue extends AuthState {
  signIn: (email: string, password: string) => Promise<{ error?: string }>;
  signUp: (email: string, password: string, name: string) => Promise<{ error?: string }>;
  signOut: () => Promise<void>;
  accessToken: string | null;
  authProvider: string;
  userEmail: string | null;
}

const AuthContext = createContext<AuthContextValue | null>(null);

/** Map raw Supabase error messages to user-friendly text */
function friendlyAuthError(raw: string): string {
  const lower = raw.toLowerCase();
  if (lower.includes('invalid login credentials'))
    return 'Incorrect email or password. Please try again.';
  if (lower.includes('email not confirmed'))
    return 'Your email has not been confirmed. Check your inbox.';
  if (lower.includes('user already registered') || lower.includes('already been registered'))
    return 'An account with this email already exists. Try signing in instead.';
  if (lower.includes('rate limit') || lower.includes('too many requests'))
    return 'Too many attempts. Please wait a moment before trying again.';
  if (lower.includes('network') || lower.includes('fetch'))
    return 'Unable to reach the server. Check your internet connection.';
  if (lower.includes('password') && lower.includes('least'))
    return raw;
  return raw;
}

// ============================================================
// Azure Entra ID Provider (production)
// Uses Azure Static Web Apps built-in /.auth/* endpoints
// ============================================================

function AzureAuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({
    user: null,
    supabaseUser: null,
    session: null,
    loading: true,
    error: null,
  });

  // Check if user is already authenticated via Azure
  useEffect(() => {
    fetch('/.auth/me')
      .then(res => res.json())
      .then(data => {
        const clientPrincipal = data?.clientPrincipal;
        if (clientPrincipal) {
          const user: AppUser = {
            id: clientPrincipal.userId,
            email: clientPrincipal.userDetails,
            name: clientPrincipal.claims?.find((c: { typ: string }) => c.typ === 'name')?.val,
          };
          setState({ user, supabaseUser: null, session: null, loading: false, error: null });
        } else {
          setState({ user: null, supabaseUser: null, session: null, loading: false, error: null });
        }
      })
      .catch(() => {
        setState({ user: null, supabaseUser: null, session: null, loading: false, error: null });
      });
  }, []);

  // Azure auth is handled by redirects — these are no-ops for the form
  const signIn = useCallback(async () => {
    window.location.href = '/.auth/login/aad?post_login_redirect_uri=/';
    return {};
  }, []);

  const signUp = useCallback(async () => {
    window.location.href = '/.auth/login/aad?post_login_redirect_uri=/';
    return {};
  }, []);

  const signOut = useCallback(async () => {
    window.location.href = '/.auth/logout?post_logout_redirect_uri=/login';
  }, []);

  return (
    <AuthContext.Provider value={{
      ...state,
      signIn,
      signUp,
      signOut,
      accessToken: null, // Azure auth uses cookies, not bearer tokens
      authProvider: 'azure',
      userEmail: state.user?.email ?? null,
    }}>
      {children}
    </AuthContext.Provider>
  );
}

// ============================================================
// Supabase Provider (dev/staging) — existing implementation
// ============================================================

function SupabaseAuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({
    user: null,
    supabaseUser: null,
    session: null,
    loading: true,
    error: null,
  });

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session }, error }) => {
      if (error) {
        console.error('[AuthContext] getSession error:', error.message);
      }
      const supabaseUser = session?.user ?? null;
      setState({
        user: supabaseUser ? { id: supabaseUser.id, email: supabaseUser.email ?? '', name: supabaseUser.user_metadata?.name } : null,
        supabaseUser,
        session: session ?? null,
        loading: false,
        error: error?.message ?? null,
      });
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (_event, session) => {
        const supabaseUser = session?.user ?? null;
        setState(prev => ({
          ...prev,
          user: supabaseUser ? { id: supabaseUser.id, email: supabaseUser.email ?? '', name: supabaseUser.user_metadata?.name } : null,
          supabaseUser,
          session: session ?? null,
          loading: false,
        }));
      }
    );

    return () => subscription.unsubscribe();
  }, []);

  const signIn = useCallback(async (email: string, password: string) => {
    setState(prev => ({ ...prev, loading: true, error: null }));
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      console.error('[AuthContext] signIn error:', error.message);
      const msg = friendlyAuthError(error.message);
      setState(prev => ({ ...prev, loading: false, error: msg }));
      return { error: msg };
    }
    setState(prev => ({ ...prev, loading: false }));
    return {};
  }, []);

  const signUp = useCallback(async (email: string, password: string, name: string) => {
    setState(prev => ({ ...prev, loading: true, error: null }));
    try {
      const res = await fetch(
        `${serverBaseUrl}/auth/signup`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${publicAnonKey}`,
          },
          body: JSON.stringify({ email, password, name }),
        }
      );
      const data = await res.json();
      if (!res.ok || data.error) {
        const msg = friendlyAuthError(data.error || `Signup failed: ${res.status}`);
        setState(prev => ({ ...prev, loading: false, error: msg }));
        return { error: msg };
      }
      const result = await signIn(email, password);
      return result;
    } catch (err) {
      const msg = friendlyAuthError(err instanceof Error ? err.message : 'Signup failed');
      setState(prev => ({ ...prev, loading: false, error: msg }));
      return { error: msg };
    }
  }, [signIn]);

  const signOut = useCallback(async () => {
    await supabase.auth.signOut();
    setState({ user: null, supabaseUser: null, session: null, loading: false, error: null });
  }, []);

  const accessToken = state.session?.access_token ?? null;

  return (
    <AuthContext.Provider value={{
      ...state,
      signIn,
      signUp,
      signOut,
      accessToken,
      authProvider: 'supabase',
      userEmail: state.user?.email ?? null,
    }}>
      {children}
    </AuthContext.Provider>
  );
}

// ============================================================
// Exported Provider — picks based on env var
// ============================================================

export function AuthProvider({ children }: { children: ReactNode }) {
  if (AUTH_PROVIDER === 'azure') {
    return <AzureAuthProvider>{children}</AzureAuthProvider>;
  }
  return <SupabaseAuthProvider>{children}</SupabaseAuthProvider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
