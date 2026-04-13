import { useMemo } from 'react';
import { Scale } from 'lucide-react';
import { fetchTransactions } from '../../dataClient';
import { useBanks } from '../../contexts/BanksContext';
import { useSWRCache } from '../../hooks/useSWRCache';
import { WidgetShell } from '../dashboard/WidgetShell';
import { formatTokenAmount } from '../../types';
import type { Transaction } from '../../types';

// ============================================================
// NostroFreePosition (Task 161)
//
// Net settlement position view — shows net position across all
// counterparties, with a "capital saved vs correspondent banking"
// metric. All data derived from existing transaction data.
// ============================================================

interface NostroEntry {
  bankId: string;
  bankName: string;
  shortCode: string;
  netPosition: number; // positive = net receiver, negative = net sender
  lastSettlement: string | null;
}

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '\u2014';
  return new Date(iso).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export function NostroFreePosition() {
  const { banks, cacheVersion } = useBanks();

  const { data: allTxs } = useSWRCache<Transaction[]>({
    key: 'nostro-free-position',
    fetcher: () => fetchTransactions({ status: 'settled', limit: 500 }),
    deps: [cacheVersion],
    ttl: 2 * 60 * 1000,
  });

  const { entries, totalNet, capitalSaved } = useMemo(() => {
    if (!allTxs || allTxs.length === 0) return { entries: [], totalNet: 0, capitalSaved: 0 };

    const map = new Map<string, NostroEntry>();
    let grossVolume = 0;

    for (const tx of allTxs) {
      const amt = tx.amount || 0;
      grossVolume += amt;

      // Receiver side — positive position
      const rId = tx.receiver_bank_id;
      if (!map.has(rId)) {
        const bank = banks.find(b => b.id === rId);
        map.set(rId, {
          bankId: rId,
          bankName: bank?.name || (tx as any).receiver_bank?.name || rId.slice(0, 8),
          shortCode: bank?.short_code || (tx as any).receiver_bank?.short_code || '??',
          netPosition: 0,
          lastSettlement: null,
        });
      }
      const rEntry = map.get(rId)!;
      rEntry.netPosition += amt;
      if (!rEntry.lastSettlement || (tx.settled_at && tx.settled_at > rEntry.lastSettlement)) {
        rEntry.lastSettlement = tx.settled_at || null;
      }

      // Sender side — negative position
      const sId = tx.sender_bank_id;
      if (!map.has(sId)) {
        const bank = banks.find(b => b.id === sId);
        map.set(sId, {
          bankId: sId,
          bankName: bank?.name || (tx as any).sender_bank?.name || sId.slice(0, 8),
          shortCode: bank?.short_code || (tx as any).sender_bank?.short_code || '??',
          netPosition: 0,
          lastSettlement: null,
        });
      }
      const sEntry = map.get(sId)!;
      sEntry.netPosition -= amt;
      if (!sEntry.lastSettlement || (tx.settled_at && tx.settled_at > sEntry.lastSettlement)) {
        sEntry.lastSettlement = tx.settled_at || null;
      }
    }

    const entries = Array.from(map.values())
      .filter(e => e.netPosition !== 0)
      .sort((a, b) => Math.abs(b.netPosition) - Math.abs(a.netPosition));

    const totalNet = entries.reduce((sum, e) => sum + Math.abs(e.netPosition), 0);

    // Capital saved: gross volume minus net obligations (netting efficiency)
    const netObligations = entries.reduce((sum, e) => sum + Math.max(0, e.netPosition), 0);
    const capitalSaved = grossVolume > 0 ? grossVolume - netObligations : 0;

    return { entries, totalNet, capitalSaved };
  }, [allTxs, banks]);

  return (
    <WidgetShell
      title="Net Settlement Position"
      icon={Scale}
      headerRight={
        capitalSaved > 0 ? (
          <span className="text-[11px] font-mono text-emerald-400">
            {formatTokenAmount(capitalSaved)} capital saved via netting
          </span>
        ) : undefined
      }
    >
      {entries.length === 0 ? (
        <div className="py-6 text-center text-[13px] text-coda-text-muted">
          No settled positions to display
        </div>
      ) : (
        <div>
          {/* Header */}
          <div className="grid grid-cols-12 gap-2 py-2 text-[11px] font-mono text-coda-text-muted uppercase tracking-wider">
            <div className="col-span-4">Counterparty</div>
            <div className="col-span-4 text-right">Net Position</div>
            <div className="col-span-4 text-right">Last Settlement</div>
          </div>

          {/* Rows */}
          {entries.map((entry, i) => (
            <div
              key={entry.bankId}
              className={`grid grid-cols-12 gap-2 items-center py-2.5 ${
                i > 0 ? 'border-t border-black/[0.06] dark:border-white/[0.06]' : ''
              }`}
            >
              <div className="col-span-4">
                <div className="text-[13px] text-coda-text">{entry.bankName}</div>
                <div className="text-[11px] font-mono text-coda-text-muted">{entry.shortCode}</div>
              </div>
              <div className={`col-span-4 text-right text-[14px] font-mono font-medium tabular-nums ${
                entry.netPosition > 0 ? 'text-emerald-400' : entry.netPosition < 0 ? 'text-red-400' : 'text-coda-text-muted'
              }`}>
                {entry.netPosition > 0 ? '+' : ''}{formatTokenAmount(entry.netPosition)}
              </div>
              <div className="col-span-4 text-right text-[12px] font-mono text-coda-text-muted tabular-nums">
                {fmtDate(entry.lastSettlement)}
              </div>
            </div>
          ))}

          {/* Total */}
          <div className="grid grid-cols-12 gap-2 items-center py-3 border-t-2 border-black/[0.1] dark:border-white/[0.1]">
            <div className="col-span-4 text-[13px] font-medium text-coda-text">Total Exposure</div>
            <div className="col-span-4 text-right text-[14px] font-mono font-bold text-coda-text tabular-nums">
              {formatTokenAmount(totalNet)}
            </div>
            <div className="col-span-4" />
          </div>
        </div>
      )}
    </WidgetShell>
  );
}
