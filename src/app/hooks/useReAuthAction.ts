import { useState, useCallback, useRef } from 'react';
import { useAuth } from '../contexts/AuthContext';

export function useReAuthAction() {
  const { userEmail } = useAuth();
  const [proofToken, setProofToken] = useState<string | null>(null);
  const [proofExpiry, setProofExpiry] = useState<number | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [actionDescription, setActionDescription] = useState('');
  const pendingActionRef = useRef<((token: string) => void) | null>(null);

  const isTokenValid = useCallback(() => {
    return proofToken && proofExpiry && Date.now() < proofExpiry;
  }, [proofToken, proofExpiry]);

  const executeWithReAuth = useCallback((
    description: string,
    action: (token: string) => void | Promise<void>,
  ) => {
    // Staging bypass: no re-auth gate
    if (import.meta.env.VITE_AUTH_PROVIDER !== 'azure') {
      action(''); // empty token — staging backend doesn't check it
      return;
    }

    if (isTokenValid()) {
      action(proofToken!);
    } else {
      pendingActionRef.current = action;
      setActionDescription(description);
      setDialogOpen(true);
    }
  }, [isTokenValid, proofToken]);

  const onAuthenticated = useCallback((token: string) => {
    setProofToken(token);
    setProofExpiry(Date.now() + 4.5 * 60 * 1000); // ~4.5 min client-side
    setDialogOpen(false);
    if (pendingActionRef.current) {
      pendingActionRef.current(token);
      pendingActionRef.current = null;
    }
  }, []);

  return {
    executeWithReAuth,
    dialogOpen,
    setDialogOpen,
    onAuthenticated,
    actionDescription,
    proofToken,
  };
}
