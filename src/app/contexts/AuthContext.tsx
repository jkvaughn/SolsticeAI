import { createContext, useContext, useEffect, useState, useCallback, type ReactNode } from 'react';
import { supabase } from '../supabaseClient';
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
      setState(prev => ({ ...prev, loading: false, error: error.message }));
      return { error: error.message };
    }
    setState(prev => ({ ...prev, loading: false }));
    return {};
  }, []);

  const signUp = useCallback(async (email: string, password: string, name: string) => {
    setState(prev => ({ ...prev, loading: true, error: null }));
    try {
      // Use server-side signup with admin.createUser (auto-confirms email)
      const { projectId, publicAnonKey } = await import('/utils/supabase/info');
      const res = await fetch(
        `https://${projectId}.supabase.co/functions/v1/make-server-49d15288/auth/signup`,
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
        const msg = data.error || `Signup failed: ${res.status}`;
        setState(prev => ({ ...prev, loading: false, error: msg }));
        return { error: msg };
      }
      // Auto sign-in after successful signup
      const result = await signIn(email, password);
      return result;
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Signup failed';
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
