import { useState, useRef, useEffect, type FormEvent, type ElementType } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { Navigate, useNavigate } from 'react-router';
import { AnimatedBackground } from './AnimatedBackground';
import { useTheme } from './ThemeProvider';
import { LogIn, UserPlus, Mail, Lock, User, Loader2, Eye, EyeOff, AlertCircle, Sun, Moon, Monitor, ShieldCheck } from 'lucide-react';
import { motion, AnimatePresence } from './motion-shim';
import codaIcon from './icons/coda-icon.svg';
import type { ThemePreference } from './ThemeProvider';

// ============================================================
// Login / Signup Page — LiquidGlass Design
// ============================================================

const THEME_CYCLE: { pref: ThemePreference; icon: ElementType; label: string }[] = [
  { pref: 'auto',  icon: Monitor, label: 'System' },
  { pref: 'light', icon: Sun,     label: 'Light' },
  { pref: 'dark',  icon: Moon,    label: 'Dark' },
];

export function LoginPage() {
  const { signIn, signUp, signInWithGoogle, loading, error: authError, user, authProvider } = useAuth();
  const { resolved, preference, cycleTheme } = useTheme();
  const isDark = resolved === 'dark';
  const navigate = useNavigate();

  const [mode, setMode] = useState<'login' | 'signup'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [accessCode, setAccessCode] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [localError, setLocalError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);

  // If already authenticated, redirect to dashboard
  if (user && !loading) {
    return <Navigate to="/" replace />;
  }

  const error = localError || authError;
  const currentTheme = THEME_CYCLE.find(t => t.pref === preference) || THEME_CYCLE[0];
  const ThemeIcon = currentTheme.icon;

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setLocalError('');

    if (!email.trim() || !password.trim()) {
      setLocalError('Please fill in all required fields.');
      return;
    }
    if (mode === 'signup' && !name.trim()) {
      setLocalError('Please enter your name.');
      return;
    }
    if (mode === 'signup' && accessCode.trim() !== 'CODA2026') {
      setLocalError('Invalid access code. Please contact an administrator.');
      return;
    }
    if (password.length < 6) {
      setLocalError('Password must be at least 6 characters.');
      return;
    }

    setSubmitting(true);
    const result = mode === 'login'
      ? await signIn(email.trim(), password)
      : await signUp(email.trim(), password, name.trim());

    if (result.error) {
      setLocalError(result.error);
      // Shake the form and clear/re-focus password on wrong credentials
      formRef.current?.classList.remove('animate-shake');
      void formRef.current?.offsetWidth; // force reflow to restart animation
      formRef.current?.classList.add('animate-shake');
      if (mode === 'login') {
        setPassword('');
        passwordRef.current?.focus();
      }
    } else {
      navigate('/');
    }
    setSubmitting(false);
  }

  return (
    <div className="min-h-screen bg-coda-bg transition-colors duration-500 relative overflow-hidden flex items-center justify-center p-4">
      <AnimatedBackground />

      {/* Theme toggle — top right */}
      <button
        onClick={cycleTheme}
        className="fixed top-5 right-5 z-50 w-10 h-10 rounded-xl backdrop-blur-xl bg-white/20 dark:bg-white/10 border border-white/30 dark:border-white/15 flex items-center justify-center text-coda-text-muted hover:text-coda-text transition-colors cursor-pointer"
        title={currentTheme.label}
      >
        <ThemeIcon size={18} />
      </button>

      {/* Main card */}
      <motion.div
        initial={{ opacity: 0, y: 20, scale: 0.96 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.5, ease: [0.25, 0.46, 0.45, 0.94] }}
        className="relative z-10 w-full max-w-[420px]"
      >
        <div className="squircle-xl backdrop-blur-2xl bg-white/30 dark:bg-white/[0.06] border border-white/40 dark:border-white/[0.12] shadow-2xl overflow-hidden">

          {/* Header */}
          <div className="px-8 pt-10 pb-6 text-center">
            <div className="flex justify-center mb-5">
              <div className="w-16 h-16 rounded-2xl backdrop-blur-xl bg-white/40 dark:bg-white/10 border border-white/50 dark:border-white/15 flex items-center justify-center shadow-lg">
                <img src={codaIcon} alt="CODA" className="w-10 h-10 object-contain dark:invert" />
              </div>
            </div>
            <h1 className="text-2xl font-medium tracking-tight text-coda-text mb-1">
              CODA Agentic Payments
            </h1>
            <p className="text-sm text-coda-text-muted font-light">
              Solstice Network — Multi-Agent Settlement
            </p>
          </div>

          {/* Azure + Google login — production */}
          {authProvider === 'azure' && (
            <div className="px-8 pb-8 space-y-3">
              <button
                onClick={() => { window.location.href = '/.auth/login/aad?post_login_redirect_uri=/'; }}
                className={`w-full py-3.5 rounded-xl text-sm font-medium transition-all duration-300 cursor-pointer flex items-center justify-center gap-2 ${
                  isDark
                    ? 'bg-white text-black hover:bg-black/[0.04]'
                    : 'bg-black text-white hover:bg-white/10'
                } shadow-lg`}
              >
                <ShieldCheck size={18} />
                Sign in with Microsoft
              </button>
              <button
                onClick={() => { window.location.href = '/.auth/login/google?post_login_redirect_uri=/'; }}
                className={`w-full py-3 rounded-xl text-sm font-medium transition-all duration-300 cursor-pointer flex items-center justify-center gap-2 border ${
                  isDark
                    ? 'bg-white/[0.06] border-white/[0.12] text-coda-text hover:bg-white/[0.1]'
                    : 'bg-white border-black/[0.08] text-coda-text hover:bg-black/[0.03]'
                }`}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                  <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4"/>
                  <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                  <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18A10.96 10.96 0 001 12c0 1.77.42 3.45 1.18 4.93l3.66-2.84z" fill="#FBBC05"/>
                  <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
                </svg>
                Sign in with Google
              </button>
              <p className="text-[10px] text-coda-text-muted text-center mt-2">
                Use the same email with either provider for consistent access
              </p>
            </div>
          )}

          {/* Supabase email/password login — dev/staging */}
          {authProvider !== 'azure' && <>
          {/* Google OAuth button */}
          <div className="px-8 mb-4">
            <button
              onClick={() => signInWithGoogle()}
              className={`w-full py-3 rounded-xl text-sm font-medium transition-all duration-300 cursor-pointer flex items-center justify-center gap-2 border ${
                isDark
                  ? 'bg-white/[0.06] border-white/[0.12] text-coda-text hover:bg-white/[0.1]'
                  : 'bg-white border-black/[0.08] text-coda-text hover:bg-black/[0.03]'
              }`}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4"/>
                <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18A10.96 10.96 0 001 12c0 1.77.42 3.45 1.18 4.93l3.66-2.84z" fill="#FBBC05"/>
                <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
              </svg>
              Sign in with Google
            </button>

            {/* Divider */}
            <div className="flex items-center gap-3 mt-4">
              <div className="flex-1 h-px bg-black/[0.08] dark:bg-white/[0.1]" />
              <span className="text-[11px] text-coda-text-muted uppercase tracking-wider">or</span>
              <div className="flex-1 h-px bg-black/[0.08] dark:bg-white/[0.1]" />
            </div>
          </div>

          {/* Tab switcher */}
          <div className="px-8 mb-6">
            <div className="flex p-1 rounded-xl bg-black/[0.04] dark:bg-white/[0.06] border border-black/[0.04] dark:border-white/[0.06]">
              <button
                onClick={() => { setMode('login'); setLocalError(''); }}
                className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg text-[13px] font-medium transition-all duration-300 cursor-pointer ${
                  mode === 'login'
                    ? isDark
                      ? 'bg-white text-black shadow-md'
                      : 'bg-black text-white shadow-md'
                    : 'text-coda-text-muted hover:text-coda-text'
                }`}
              >
                <LogIn size={15} />
                Sign In
              </button>
              <button
                onClick={() => { setMode('signup'); setLocalError(''); }}
                className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg text-[13px] font-medium transition-all duration-300 cursor-pointer ${
                  mode === 'signup'
                    ? isDark
                      ? 'bg-white text-black shadow-md'
                      : 'bg-black text-white shadow-md'
                    : 'text-coda-text-muted hover:text-coda-text'
                }`}
              >
                <UserPlus size={15} />
                Create Account
              </button>
            </div>
          </div>

          {/* Form */}
          <form ref={formRef} onSubmit={handleSubmit} className="px-8 pb-8 space-y-4">
            <AnimatePresence mode="wait">
              {mode === 'signup' && (
                <motion.div
                  key="name-field"
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                  transition={{ duration: 0.25 }}
                >
                  <label className="block text-[11px] uppercase tracking-wider text-coda-text-muted font-medium mb-1.5">
                    Name
                  </label>
                  <div className="relative">
                    <User size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-coda-text-muted" />
                    <input
                      type="text"
                      value={name}
                      onChange={e => setName(e.target.value)}
                      placeholder="Your full name"
                      className="w-full pl-10 pr-4 py-3 rounded-xl bg-white/50 dark:bg-white/[0.06] border border-black/[0.08] dark:border-white/[0.1] text-coda-text text-sm placeholder:text-coda-text-muted focus:outline-none focus:ring-2 focus:ring-coda-brand/30 focus:border-coda-brand/40 transition-all backdrop-blur-sm"
                    />
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            <div>
              <label className="block text-[11px] uppercase tracking-wider text-coda-text-muted font-medium mb-1.5">
                Email
              </label>
              <div className="relative">
                <Mail size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-coda-text-muted" />
                <input
                  type="email"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  placeholder="you@institution.com"
                  autoComplete="email"
                  className="w-full pl-10 pr-4 py-3 rounded-xl bg-white/50 dark:bg-white/[0.06] border border-black/[0.08] dark:border-white/[0.1] text-coda-text text-sm placeholder:text-coda-text-muted focus:outline-none focus:ring-2 focus:ring-coda-brand/30 focus:border-coda-brand/40 transition-all backdrop-blur-sm"
                />
              </div>
            </div>

            <div>
              <label className="block text-[11px] uppercase tracking-wider text-coda-text-muted font-medium mb-1.5">
                Password
              </label>
              <div className="relative">
                <Lock size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-coda-text-muted" />
                <input
                  ref={passwordRef}
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  placeholder="Min. 6 characters"
                  autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                  className="w-full pl-10 pr-11 py-3 rounded-xl bg-white/50 dark:bg-white/[0.06] border border-black/[0.08] dark:border-white/[0.1] text-coda-text text-sm placeholder:text-coda-text-muted focus:outline-none focus:ring-2 focus:ring-coda-brand/30 focus:border-coda-brand/40 transition-all backdrop-blur-sm"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3.5 top-1/2 -translate-y-1/2 text-coda-text-muted hover:text-coda-text-secondary transition-colors cursor-pointer"
                >
                  {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </div>

            {/* Access Code */}
            <AnimatePresence mode="wait">
              {mode === 'signup' && (
                <motion.div
                  key="access-code-field"
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                  transition={{ duration: 0.25 }}
                >
                  <label className="block text-[11px] uppercase tracking-wider text-coda-text-muted font-medium mb-1.5">
                    Access Code
                  </label>
                  <div className="relative">
                    <ShieldCheck size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-coda-text-muted" />
                    <input
                      type="text"
                      value={accessCode}
                      onChange={e => setAccessCode(e.target.value)}
                      placeholder="Enter access code"
                      className="w-full pl-10 pr-4 py-3 rounded-xl bg-white/50 dark:bg-white/[0.06] border border-black/[0.08] dark:border-white/[0.1] text-coda-text text-sm placeholder:text-coda-text-muted focus:outline-none focus:ring-2 focus:ring-coda-brand/30 focus:border-coda-brand/40 transition-all backdrop-blur-sm"
                    />
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Error message */}
            <AnimatePresence>
              {error && (
                <motion.div
                  initial={{ opacity: 0, y: -4 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -4 }}
                  className="flex items-start gap-2 p-3 rounded-xl bg-red-500/8 border border-red-500/15"
                >
                  <AlertCircle size={14} className="text-red-500 dark:text-red-400 shrink-0 mt-0.5" />
                  <span className="text-[12px] text-red-600 dark:text-red-400 leading-snug">{error}</span>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Submit button */}
            <button
              type="submit"
              disabled={submitting || loading}
              className={`w-full py-3.5 rounded-xl text-sm font-medium transition-all duration-300 cursor-pointer flex items-center justify-center gap-2 ${
                isDark
                  ? 'bg-white text-black hover:bg-black/[0.04] disabled:bg-white/30 disabled:text-white/40'
                  : 'bg-black text-white hover:bg-white/10 disabled:bg-black/20 disabled:text-black/40'
              } shadow-lg disabled:shadow-none`}
            >
              {submitting ? (
                <Loader2 size={18} className="animate-spin" />
              ) : mode === 'login' ? (
                <LogIn size={18} />
              ) : (
                <UserPlus size={18} />
              )}
              {submitting
                ? (mode === 'login' ? 'Signing in...' : 'Creating account...')
                : (mode === 'login' ? 'Sign In' : 'Create Account')
              }
            </button>
          </form>
          </>}

          {/* Footer */}
          <div className="px-8 pb-6 text-center">
            <div className="flex items-center justify-center gap-2 text-[10px] text-coda-text-muted">
              <div className="relative">
                <div className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                <div className="absolute inset-0 w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
              </div>
              <span className="font-mono">{(import.meta.env.VITE_SOLANA_CLUSTER || 'devnet') === 'mainnet-beta' ? 'Solstice Network' : 'Solana Devnet'}</span>
              <span className="mx-1">|</span>
              <span className="font-mono">Token-2022</span>
            </div>
          </div>
        </div>

        {/* Ambient glow below card */}
        <div className="absolute -bottom-8 left-1/2 -translate-x-1/2 w-3/4 h-16 bg-black/[0.04] dark:bg-white/[0.03] blur-3xl rounded-full pointer-events-none" />
      </motion.div>
    </div>
  );
}