import { useState, useEffect, useCallback } from 'react';
import { Outlet, Navigate } from 'react-router';
import { startAuthentication } from '@simplewebauthn/browser';
import { useAuth } from '../contexts/AuthContext';
import { adminCallServer } from '../lib/adminClient';
import { Loader2, Fingerprint, Shield } from 'lucide-react';
import { AnimatedBackground } from './AnimatedBackground';
import codaIcon from './icons/coda-icon.svg';

// ============================================================
// AuthGate — authentication + MFA verification
//
// Flow:
//   1. Wait for auth provider to resolve user
//   2. If no user → redirect to /login
//   3. If user has passkeys registered → require passkey MFA
//   4. If user has no passkeys → pass through (MFA not enrolled)
//
// MFA state persisted in sessionStorage so user only verifies
// once per browser session, not on every navigation.
// ============================================================

const MFA_VERIFIED_KEY = 'coda-mfa-verified';
const isProduction = import.meta.env.VITE_AUTH_PROVIDER === 'azure';

export function AuthGate() {
  const { user, loading, userEmail } = useAuth();
  const [mfaState, setMfaState] = useState<'checking' | 'required' | 'verified' | 'not-enrolled'>('checking');
  const [mfaError, setMfaError] = useState<string | null>(null);
  const [mfaLoading, setMfaLoading] = useState(false);

  // Check if MFA was already verified this session
  useEffect(() => {
    if (!user || !isProduction) {
      setMfaState('verified'); // No MFA for staging/local
      return;
    }

    // Already verified this session?
    if (sessionStorage.getItem(MFA_VERIFIED_KEY) === userEmail) {
      setMfaState('verified');
      return;
    }

    // Check if user has passkeys
    if (userEmail) {
      adminCallServer<{ has_passkeys: boolean }>('/passkey-status', undefined, 1, userEmail)
        .then(result => {
          if (result.has_passkeys) {
            setMfaState('required');
          } else {
            // No passkeys enrolled — skip MFA
            setMfaState('verified');
            sessionStorage.setItem(MFA_VERIFIED_KEY, userEmail);
          }
        })
        .catch(() => {
          // If check fails, let them through (fail open for now)
          setMfaState('verified');
          sessionStorage.setItem(MFA_VERIFIED_KEY, userEmail ?? '');
        });
    }
  }, [user, userEmail]);

  const handlePasskeyAuth = useCallback(async () => {
    if (!userEmail) return;
    setMfaLoading(true);
    setMfaError(null);
    try {
      // 1. Get auth challenge
      const options = await adminCallServer<any>(
        '/passkey-auth-options', {}, 1, userEmail
      );

      // 2. Authenticate via browser WebAuthn
      const credential = await startAuthentication({ optionsJSON: options });

      // 3. Verify on server
      await adminCallServer<{ proof_token: string }>(
        '/passkey-auth-verify',
        { response: credential },
        1,
        userEmail,
      );

      // MFA passed
      sessionStorage.setItem(MFA_VERIFIED_KEY, userEmail);
      setMfaState('verified');
    } catch (err: any) {
      if (err.name === 'NotAllowedError') {
        setMfaError('Authentication was cancelled. Please try again.');
      } else {
        setMfaError(err.message || 'Passkey verification failed.');
      }
    } finally {
      setMfaLoading(false);
    }
  }, [userEmail]);

  // ── Loading state ──
  if (loading) {
    return (
      <div className="min-h-screen bg-coda-bg flex items-center justify-center relative overflow-hidden">
        <AnimatedBackground />
        <div className="relative z-10 flex flex-col items-center gap-4">
          <Loader2 size={32} className="text-emerald-500 animate-spin" />
          <span className="text-sm text-coda-text-muted font-mono">Authenticating...</span>
        </div>
      </div>
    );
  }

  // ── Not authenticated ──
  if (!user) {
    return <Navigate to="/login" replace />;
  }

  // ── Checking MFA status ──
  if (mfaState === 'checking') {
    return (
      <div className="min-h-screen bg-coda-bg flex items-center justify-center relative overflow-hidden">
        <AnimatedBackground />
        <div className="relative z-10 flex flex-col items-center gap-4">
          <Shield size={32} className="text-coda-brand animate-pulse" />
          <span className="text-sm text-coda-text-muted font-mono">Verifying security...</span>
        </div>
      </div>
    );
  }

  // ── MFA Required — passkey challenge ──
  if (mfaState === 'required') {
    return (
      <div className="min-h-screen bg-coda-bg flex items-center justify-center relative overflow-hidden p-4">
        <AnimatedBackground />
        <div className="relative z-10 w-full max-w-[400px]">
          <div className="squircle-xl backdrop-blur-2xl bg-white/30 dark:bg-white/[0.06] border border-white/40 dark:border-white/[0.12] shadow-2xl overflow-hidden">
            <div className="px-8 pt-10 pb-8 text-center">
              <div className="flex justify-center mb-5">
                <div className="w-16 h-16 rounded-2xl backdrop-blur-xl bg-white/40 dark:bg-white/10 border border-white/50 dark:border-white/15 flex items-center justify-center shadow-lg">
                  <img src={codaIcon} alt="CODA" className="w-10 h-10 object-contain dark:invert" />
                </div>
              </div>
              <h1 className="text-xl font-medium tracking-tight text-coda-text mb-2">
                Identity Verification
              </h1>
              <p className="text-sm text-coda-text-muted mb-1">
                {userEmail}
              </p>
              <p className="text-xs text-coda-text-muted">
                Use your passkey to verify your identity
              </p>
            </div>

            <div className="px-8 pb-8 space-y-4">
              <button
                onClick={handlePasskeyAuth}
                disabled={mfaLoading}
                className="w-full flex items-center justify-center gap-3 py-3.5 rounded-xl bg-black text-white dark:bg-white dark:text-black text-sm font-medium cursor-pointer disabled:opacity-50 transition-colors"
              >
                {mfaLoading ? (
                  <Loader2 size={18} className="animate-spin" />
                ) : (
                  <Fingerprint size={18} />
                )}
                <span>{mfaLoading ? 'Verifying...' : 'Verify with Passkey'}</span>
              </button>

              {mfaError && (
                <p className="text-xs text-red-500 text-center">{mfaError}</p>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ── MFA verified or not enrolled — render app ──
  return <Outlet />;
}
