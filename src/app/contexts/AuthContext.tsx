import { createContext, useContext, useEffect, useState, useCallback, type ReactNode } from 'react';
import { supabase, serverBaseUrl, publicAnonKey } from '../supabaseClient';
import type { Session, User } from '@supabase/supabase-js';

// ============================================================
// Auth Context — manages Supabase auth state globally
// ============================================================

interface AuthState {
  user: User | null;
  session: Session | null;
  loading: boolean;
  error: string | null;
}

interface AuthContextValue extends AuthState {
  signIn: (email: string, password: string) => Promise<{ error?: string }>;
  signUp: (email: string, password: string, name: string) => Promise<{ error?: string }>;
  signOut: () => Promise<void>;
  accessToken: string | null;
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
    return raw; // already descriptive (e.g. "Password should be at least 6 characters")
  return raw;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({
    user: null,
    session: null,
    loading: true,
    error: null,
  });

  // Initialize — check for existing session
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session }, error }) => {
      if (error) {
        console.error('[AuthContext] getSession error:', error.message);
      }
      setState({
        user: session?.user ?? null,
        session: session ?? null,
        loading: false,
        error: error?.message ?? null,
      });
    });

    // Listen for auth state changes (sign in, sign out, token refresh)
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (_event, session) => {
        setState(prev => ({
          ...prev,
          user: session?.user ?? null,
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
      // Use server-side signup with admin.createUser (auto-confirms email)
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
      // Auto sign-in after successful signup
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
    setState({ user: null, session: null, loading: false, error: null });
  }, []);

  const accessToken = state.session?.access_token ?? null;

  return (
    <AuthContext.Provider value={{ ...state, signIn, signUp, signOut, accessToken }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
