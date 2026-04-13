import { CheckCircle2, Clock, Shield } from 'lucide-react';
import type { Transaction } from '../../types';

// ============================================================
// SettlementFinality (Task 161)
//
// Per-transaction finality indicator. Shows confirmed slot,
// hard vs soft finality status, and lockup claim details.
// ============================================================

interface SettlementFinalityProps {
  transaction: Transaction;
}

export function SettlementFinality({ transaction: tx }: SettlementFinalityProps) {
  const hasHardFinality = tx.finality_solana_slot != null || tx.status === 'settled';
  const isLocked = tx.status === 'locked';
  const isSoft = isLocked && !tx.finality_solana_slot;

  // Determine display slot — prefer finality slot, fall back to initial slot
  const displaySlot = tx.finality_solana_slot ?? tx.solana_slot;

  // Lockup end time for soft finality
  const lockupEnd = tx.lockup_until ? new Date(tx.lockup_until) : null;
  const lockupEndStr = lockupEnd
    ? lockupEnd.toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' })
    : null;

  // Don't render if no on-chain data at all
  if (!displaySlot && !tx.solana_tx_signature && tx.status !== 'locked') return null;

  return (
    <div className="flex items-start gap-3 p-3 rounded-xl border border-black/[0.06] dark:border-white/[0.06] bg-coda-surface/40">
      {/* Icon */}
      <div className={`mt-0.5 p-1.5 rounded-lg ${hasHardFinality ? 'bg-emerald-500/15' : 'bg-amber-500/15'}`}>
        {hasHardFinality ? (
          <CheckCircle2 className="w-4 h-4 text-emerald-400" />
        ) : (
          <Clock className="w-4 h-4 text-amber-400" />
        )}
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-1">
          <span className={`inline-flex items-center px-2 py-0.5 text-[11px] font-mono rounded-md ${
            hasHardFinality
              ? 'bg-emerald-500/20 text-emerald-400'
              : 'bg-amber-500/20 text-amber-400'
          }`}>
            {hasHardFinality ? 'Hard Finality' : 'Soft Finality'}
          </span>
          {displaySlot && (
            <span className="text-[11px] font-mono text-coda-text-muted">
              Slot {displaySlot.toLocaleString()}
            </span>
          )}
        </div>

        {/* Description */}
        {hasHardFinality && displaySlot && (
          <p className="text-[12px] text-coda-text-secondary">
            Confirmed at slot {displaySlot.toLocaleString()}. Settlement is final and irreversible.
          </p>
        )}

        {isSoft && (
          <div className="space-y-1">
            <p className="text-[12px] text-coda-text-secondary">
              Soft settlement — claim in receiver wallet.
              {lockupEndStr && (
                <> Hard finality at <span className="font-mono text-coda-text">{lockupEndStr}</span>.</>
              )}
            </p>
            {tx.lockup_status && (
              <div className="flex items-center gap-1.5">
                <Shield size={11} className="text-coda-text-muted" />
                <span className="text-[11px] font-mono text-coda-text-muted">
                  Lockup: {tx.lockup_status}
                </span>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
