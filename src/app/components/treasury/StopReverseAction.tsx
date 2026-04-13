import { useState, useCallback } from 'react';
import { RotateCcw, AlertTriangle, Loader2 } from 'lucide-react';
import { callServer } from '../../supabaseClient';
import type { Transaction } from '../../types';

// ============================================================
// StopReverseAction (Task 161)
//
// Action button for locked transactions. Shows "Reverse
// Transaction" with confirmation dialog, reason code dropdown,
// calls /lockup-action with action='user_reversal'.
// ============================================================

interface StopReverseActionProps {
  transaction: Transaction;
  onSuccess?: () => void;
}

const REASON_CODES = [
  { value: 'duplicate_payment', label: 'Duplicate Payment' },
  { value: 'incorrect_amount', label: 'Incorrect Amount' },
  { value: 'incorrect_beneficiary', label: 'Incorrect Beneficiary' },
  { value: 'fraud_suspected', label: 'Fraud Suspected' },
  { value: 'compliance_issue', label: 'Compliance Issue' },
  { value: 'sender_request', label: 'Sender Request' },
  { value: 'other', label: 'Other' },
];

export function StopReverseAction({ transaction: tx, onSuccess }: StopReverseActionProps) {
  const [showConfirm, setShowConfirm] = useState(false);
  const [reason, setReason] = useState(REASON_CODES[0].value);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const handleReverse = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await callServer<{ status?: string; error?: string }>('/lockup-action', {
        action: 'user_reversal',
        transaction_id: tx.id,
        operator_name: 'Treasury User',
        reason_code: reason,
      });
      if (result.error) {
        setError(result.error);
      } else {
        setSuccess('Transaction reversed successfully');
        setShowConfirm(false);
        onSuccess?.();
      }
    } catch (err) {
      setError(`Reversal failed: ${(err as Error).message}`);
    } finally {
      setLoading(false);
    }
  }, [tx.id, reason, onSuccess]);

  // Only show for locked transactions
  if (tx.status !== 'locked') return null;

  return (
    <div>
      {/* Success toast */}
      {success && (
        <div className="mb-3 px-3 py-2 rounded-lg bg-emerald-500/15 text-emerald-400 text-[12px] font-mono">
          {success}
        </div>
      )}

      {/* Error toast */}
      {error && (
        <div className="mb-3 px-3 py-2 rounded-lg bg-red-500/15 text-red-400 text-[12px] font-mono">
          {error}
        </div>
      )}

      {!showConfirm ? (
        <button
          onClick={() => setShowConfirm(true)}
          className="flex items-center gap-2 px-4 py-2 rounded-lg border border-red-500/30 bg-red-500/10 text-red-400 text-[13px] font-medium hover:bg-red-500/20 transition-colors"
        >
          <RotateCcw size={14} />
          Reverse Transaction
        </button>
      ) : (
        <div className="p-4 rounded-xl border border-red-500/20 bg-red-500/5 space-y-3">
          <div className="flex items-center gap-2 text-red-400">
            <AlertTriangle size={16} />
            <span className="text-[13px] font-medium">Confirm Reversal</span>
          </div>

          <p className="text-[12px] text-coda-text-secondary">
            This will reverse the locked transaction and return funds to the sender. This action cannot be undone.
          </p>

          <div>
            <label className="block text-[11px] font-mono text-coda-text-muted mb-1">Reason Code</label>
            <select
              value={reason}
              onChange={e => setReason(e.target.value)}
              className="w-full px-3 py-2 rounded-lg bg-coda-surface border border-black/[0.08] dark:border-white/[0.08] text-[13px] text-coda-text focus:outline-none focus:ring-1 focus:ring-coda-brand/50"
            >
              {REASON_CODES.map(rc => (
                <option key={rc.value} value={rc.value}>{rc.label}</option>
              ))}
            </select>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={handleReverse}
              disabled={loading}
              className="flex items-center gap-2 px-4 py-2 rounded-lg bg-red-500/20 text-red-400 text-[13px] font-medium hover:bg-red-500/30 transition-colors disabled:opacity-50"
            >
              {loading ? <Loader2 size={14} className="animate-spin" /> : <RotateCcw size={14} />}
              {loading ? 'Reversing...' : 'Confirm Reversal'}
            </button>
            <button
              onClick={() => { setShowConfirm(false); setError(null); }}
              disabled={loading}
              className="px-4 py-2 rounded-lg text-[13px] text-coda-text-muted hover:text-coda-text transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
