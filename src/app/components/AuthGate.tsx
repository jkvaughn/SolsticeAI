import { Outlet, Navigate } from 'react-router';
import { useAuth } from '../contexts/AuthContext';
import { Loader2 } from 'lucide-react';
import { AnimatedBackground } from './AnimatedBackground';

// ============================================================
// AuthGate — redirects unauthenticated users to /login
// Shows a minimal loading state while session is being resolved
// ============================================================

export function AuthGate() {
  const { user, loading } = useAuth();

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

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  return <Outlet />;
}
