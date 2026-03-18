import { usePersona } from '../contexts/PersonaContext';

// ============================================================
// useBankFilter — Consistent bank scoping across all components
// ============================================================
// When selectedBankId is set (via PersonaSwitcher), all transaction-
// related views should filter to that bank's data only.
// ============================================================

export function useBankFilter() {
  const { selectedBankId } = usePersona();

  /** Returns true if the transaction involves the selected bank (or no filter is set) */
  const isScopedTransaction = (tx: { sender_bank_id?: string; receiver_bank_id?: string }): boolean => {
    if (!selectedBankId) return true;
    return tx.sender_bank_id === selectedBankId || tx.receiver_bank_id === selectedBankId;
  };

  /** Returns a Supabase `.or()` filter clause, or null if no bank is selected */
  const bankFilterClause = (): string | null => {
    if (!selectedBankId) return null;
    return `sender_bank_id.eq.${selectedBankId},receiver_bank_id.eq.${selectedBankId}`;
  };

  return { selectedBankId, isScopedTransaction, bankFilterClause };
}
