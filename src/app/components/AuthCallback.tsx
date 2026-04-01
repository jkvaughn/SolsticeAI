import { useEffect } from 'react';
import { useNavigate } from 'react-router';
import { Loader2 } from 'lucide-react';
import { AnimatedBackground } from './AnimatedBackground';
import codaIcon from './icons/coda-icon.svg';

// ============================================================
// AuthCallback — clean landing page after OAuth redirect
//
// Azure SWA redirects here after /.auth/login/aad or /google.
// Shows a branded loading screen then navigates to / where
// AuthGate picks up the session and handles MFA.
// ============================================================

export function AuthCallback() {
  const navigate = useNavigate();

  useEffect(() => {
    // Small delay for the branded screen to show, then redirect
    const timer = setTimeout(() => {
      navigate('/', { replace: true });
    }, 600);
    return () => clearTimeout(timer);
  }, [navigate]);

  return (
    <div className="min-h-screen bg-coda-bg flex items-center justify-center relative overflow-hidden">
      <AnimatedBackground />
      <div className="relative z-10 flex flex-col items-center gap-5">
        <div className="w-16 h-16 rounded-2xl backdrop-blur-xl bg-white/40 dark:bg-white/10 border border-white/50 dark:border-white/15 flex items-center justify-center shadow-lg">
          <img src={codaIcon} alt="CODA" className="w-10 h-10 object-contain dark:invert" />
        </div>
        <div className="flex items-center gap-3">
          <Loader2 size={18} className="text-coda-brand animate-spin" />
          <span className="text-sm text-coda-text-muted font-mono">Signing you in...</span>
        </div>
      </div>
    </div>
  );
}
