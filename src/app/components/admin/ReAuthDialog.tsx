import { useState, useEffect } from 'react';
import { startAuthentication } from '@simplewebauthn/browser';
import { RUNTIME_AUTH_PROVIDER } from '../../runtime-env';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '../ui/dialog';
import { adminCallServer } from '../../lib/adminClient';
import { useAuth } from '../../contexts/AuthContext';
import { Shield, Loader2, Fingerprint } from 'lucide-react';

interface ReAuthDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAuthenticated: (proofToken: string) => void;
  actionDescription: string;
}

export function ReAuthDialog({ open, onOpenChange, onAuthenticated, actionDescription }: ReAuthDialogProps) {
  const { userEmail } = useAuth();
  const [loading, setLoading] = useState(false);
  const [passkeyLoading, setPasskeyLoading] = useState(false);
  const [hasPasskeys, setHasPasskeys] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isProduction = RUNTIME_AUTH_PROVIDER === 'azure';

  // Check passkey status when dialog opens
  useEffect(() => {
    if (open && isProduction) {
      adminCallServer<{ has_passkeys: boolean }>('/passkey-status', undefined, 1, userEmail)
        .then((result) => setHasPasskeys(result.has_passkeys))
        .catch(() => setHasPasskeys(false));
    }
    if (open) setError(null);
  }, [open, isProduction, userEmail]);

  const handleVerify = async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await adminCallServer<{ proof_token: string; expires_in: number }>(
        '/admin-reauth',
        { method: 'session' },
        1,
        userEmail,
      );
      onAuthenticated(result.proof_token);
    } catch (err: any) {
      setError(err.message || 'Session verification failed. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handlePasskey = async () => {
    setPasskeyLoading(true);
    setError(null);
    try {
      // 1. Get authentication options from server
      const options = await adminCallServer<any>(
        '/passkey-auth-options', undefined, 1, userEmail
      );

      // 2. Authenticate via browser WebAuthn API
      const credential = await startAuthentication({ optionsJSON: options });

      // 3. Send response back for verification
      const result = await adminCallServer<{ proof_token: string }>(
        '/passkey-auth-verify',
        { response: credential },
        1,
        userEmail,
      );

      onAuthenticated(result.proof_token);
    } catch (err: any) {
      if (err.name === 'NotAllowedError') {
        setError('Passkey authentication was cancelled.');
      } else {
        setError(err.message || 'Passkey authentication failed. Please try again.');
      }
    } finally {
      setPasskeyLoading(false);
    }
  };

  const anyLoading = loading || passkeyLoading;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Shield size={18} className="text-coda-brand" />
            Re-authentication Required
          </DialogTitle>
          <DialogDescription>
            Confirm your identity to <strong>{actionDescription}</strong>. This adds an extra layer of security for sensitive operations.
          </DialogDescription>
        </DialogHeader>

        <div className="py-4 space-y-3">
          <div className="text-sm text-coda-text-muted">
            Signed in as <span className="font-mono text-coda-text">{userEmail}</span>
          </div>

          {error && (
            <div className="text-sm text-red-500 bg-red-50 dark:bg-red-500/10 rounded-lg px-3 py-2">
              {error}
            </div>
          )}
        </div>

        <DialogFooter className="flex flex-col gap-2 sm:flex-col">
          {hasPasskeys && isProduction ? (
            <>
              <button
                onClick={handlePasskey}
                disabled={anyLoading}
                className="liquid-button flex items-center justify-center gap-2 w-full px-4 py-2.5 text-sm font-medium"
              >
                {passkeyLoading ? (
                  <Loader2 size={14} className="animate-spin" />
                ) : (
                  <Fingerprint size={14} />
                )}
                {passkeyLoading ? 'Authenticating...' : 'Use Passkey'}
              </button>
              <div className="flex items-center justify-center gap-3 w-full">
                <button
                  onClick={() => onOpenChange(false)}
                  className="px-4 py-2 text-sm text-coda-text-muted hover:text-coda-text transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleVerify}
                  disabled={anyLoading}
                  className="px-4 py-2 text-sm text-coda-text-muted hover:text-coda-text transition-colors underline underline-offset-2"
                >
                  {loading ? 'Verifying...' : 'or verify session'}
                </button>
              </div>
            </>
          ) : (
            <div className="flex items-center justify-end gap-2 w-full">
              <button
                onClick={() => onOpenChange(false)}
                className="px-4 py-2 text-sm text-coda-text-muted hover:text-coda-text transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleVerify}
                disabled={loading}
                className="liquid-button flex items-center gap-2 px-4 py-2 text-sm font-medium"
              >
                {loading ? (
                  <Loader2 size={14} className="animate-spin" />
                ) : (
                  <Shield size={14} />
                )}
                {loading ? 'Verifying...' : 'Verify Session'}
              </button>
            </div>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default ReAuthDialog;
