import { useState, useEffect } from 'react';
import { startRegistration } from '@simplewebauthn/browser';
import { adminCallServer } from '../../lib/adminClient';
import { useAuth } from '../../contexts/AuthContext';
import { Fingerprint, Plus, Trash2, Loader2, Clock } from 'lucide-react';

interface PasskeyRegistrationProps {
  onRegistered?: () => void;
}

export function PasskeyRegistration({ onRegistered }: PasskeyRegistrationProps = {}) {
  const { userEmail } = useAuth();
  const [passkeys, setPasskeys] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [registering, setRegistering] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Only show in production (Azure) — passkeys are production-only
  const isProduction = import.meta.env.VITE_AUTH_PROVIDER === 'azure';

  const fetchPasskeys = async () => {
    try {
      const result = await adminCallServer<{ has_passkeys: boolean; passkeys: any[] }>(
        '/passkey-status', undefined, 1, userEmail
      );
      setPasskeys(result.passkeys || []);
    } catch {
      // Silently fail — might not have the table yet
      setPasskeys([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isProduction) fetchPasskeys();
    else setLoading(false);
  }, [isProduction]);

  const handleRegister = async () => {
    setRegistering(true);
    setError(null);
    setSuccess(null);
    try {
      // 1. Get registration options from server
      const options = await adminCallServer<any>(
        '/passkey-register-options', {}, 1, userEmail
      );

      // 2. Create credential via browser WebAuthn API
      const credential = await startRegistration({ optionsJSON: options });

      // 3. Send credential back for verification
      const result = await adminCallServer<{ success: boolean }>(
        '/passkey-register-verify',
        { response: credential, device_name: navigator.userAgent.includes('Mac') ? 'macOS' : navigator.platform },
        1,
        userEmail,
      );

      if (result.success) {
        setSuccess('Passkey registered successfully!');
        fetchPasskeys(); // Refresh list
        onRegistered?.(); // Notify parent to refresh stats
      }
    } catch (err: any) {
      if (err.name === 'NotAllowedError') {
        setError('Passkey registration was cancelled.');
      } else {
        setError(err.message || 'Failed to register passkey.');
      }
    } finally {
      setRegistering(false);
    }
  };

  if (!isProduction) {
    return (
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <Fingerprint size={16} className="text-coda-text-muted" />
          <span className="text-sm font-medium text-coda-text">Passkey Authentication</span>
        </div>
        <p className="text-xs text-coda-text-muted">
          WebAuthn passkeys are available in production only. Switch to Azure auth to manage passkeys.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3 pt-4 border-t border-black/[0.06] dark:border-white/[0.06]">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Fingerprint size={16} className="text-coda-text-muted" />
          <span className="text-sm font-medium text-coda-text">Passkey Authentication</span>
        </div>
        <button
          onClick={handleRegister}
          disabled={registering}
          className="liquid-button flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-coda-text"
        >
          {registering ? <Loader2 size={12} className="animate-spin" /> : <Plus size={12} />}
          {registering ? 'Registering...' : 'Register Passkey'}
        </button>
      </div>

      {error && (
        <div className="text-xs text-red-500 bg-red-50 dark:bg-red-500/10 rounded-lg px-3 py-2">
          {error}
        </div>
      )}
      {success && (
        <div className="text-xs text-emerald-600 bg-emerald-50 dark:bg-emerald-500/10 rounded-lg px-3 py-2">
          {success}
        </div>
      )}

      {loading ? (
        <div className="flex items-center gap-2 text-xs text-coda-text-muted py-2">
          <Loader2 size={12} className="animate-spin" /> Loading passkeys...
        </div>
      ) : passkeys.length === 0 ? (
        <p className="text-xs text-coda-text-muted py-1">
          No passkeys registered. Register one for enhanced security on sensitive admin actions.
        </p>
      ) : (
        <div className="space-y-1.5">
          {passkeys.map((pk: any) => (
            <div key={pk.id} className="flex items-center justify-between px-3 py-2 rounded-lg bg-black/[0.02] dark:bg-white/[0.04]">
              <div className="flex items-center gap-2">
                <Fingerprint size={14} className="text-coda-text-muted" />
                <span className="text-xs text-coda-text">{pk.device_name || 'Unknown device'}</span>
              </div>
              <div className="flex items-center gap-3 text-[10px] text-coda-text-muted">
                <span className="flex items-center gap-1">
                  <Clock size={10} />
                  {pk.last_used_at ? new Date(pk.last_used_at).toLocaleDateString() : 'Never used'}
                </span>
                <span>Added {new Date(pk.created_at).toLocaleDateString()}</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default PasskeyRegistration;
