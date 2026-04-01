import { useEffect } from 'react';

// ============================================================
// AuthCallback — popup OAuth completion handler
//
// This page loads in the OAuth popup after SWA completes auth.
// It signals the parent window that auth succeeded, then closes.
// If opened directly (not in a popup), falls back to redirect.
// ============================================================

export function AuthCallback() {
  useEffect(() => {
    if (window.opener) {
      // We're in a popup — notify parent and close
      window.opener.postMessage({ type: 'coda-auth-complete' }, window.location.origin);
      window.close();
    } else {
      // Opened directly (not popup) — redirect to home
      window.location.href = '/';
    }
  }, []);

  // Minimal content in case close is delayed
  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      minHeight: '100vh', background: '#f0f2f5', fontFamily: 'system-ui',
    }}>
      <p style={{ fontSize: 14, color: '#666' }}>Completing sign in...</p>
    </div>
  );
}
