import { useState, useMemo } from 'react';
import { Grid3X3 } from 'lucide-react';
import { fetchTransactions } from '../../dataClient';
import { useBanks } from '../../contexts/BanksContext';
import { useSWRCache } from '../../hooks/useSWRCache';
import type { Transaction } from '../../types';
import { WidgetShell } from '../dashboard/WidgetShell';

// ============================================================
// AML Risk Heatmap (Task 167)
//
// Institution x counterparty grid colored by average risk score.
// Rows: sender banks, Columns: receiver banks.
// Green (low) -> Yellow (medium) -> Red (high risk avg).
// ============================================================

interface CellData {
  avgScore: number;
  count: number;
}

function riskColor(score: number): string {
  if (score <= 30) return 'bg-emerald-500/40';
  if (score <= 50) return 'bg-emerald-500/20';
  if (score <= 60) return 'bg-yellow-500/20';
  if (score <= 70) return 'bg-amber-500/30';
  if (score <= 80) return 'bg-orange-500/30';
  return 'bg-red-500/40';
}

function riskTextColor(score: number): string {
  if (score <= 50) return 'text-emerald-600 dark:text-emerald-400';
  if (score <= 70) return 'text-amber-600 dark:text-amber-400';
  return 'text-red-600 dark:text-red-400';
}

export function AMLRiskHeatmap() {
  const { activeBanks: banks, cacheVersion } = useBanks();

  const { data: txs } = useSWRCache<Transaction[]>({
    key: 'aml-heatmap-txs',
    fetcher: () => fetchTransactions({ limit: 500 }),
    deps: [cacheVersion],
    ttl: 5 * 60 * 1000,
  });

  const { grid, bankCodes } = useMemo(() => {
    const txList = txs ?? [];
    const codes = banks.map((b) => b.short_code);
    const idToCode: Record<string, string> = {};
    banks.forEach((b) => { idToCode[b.id] = b.short_code; });

    // Build grid: sender -> receiver -> { totalScore, count }
    const g: Record<string, Record<string, { totalScore: number; count: number }>> = {};
    codes.forEach((s) => {
      g[s] = {};
      codes.forEach((r) => { g[s][r] = { totalScore: 0, count: 0 }; });
    });

    txList.forEach((t) => {
      const sender = idToCode[t.sender_bank_id];
      const receiver = idToCode[t.receiver_bank_id];
      if (!sender || !receiver) return;
      const score = t.risk_score ?? (t.risk_level === 'high' ? 75 : t.risk_level === 'medium' ? 50 : 25);
      g[sender][receiver].totalScore += score;
      g[sender][receiver].count++;
    });

    // Convert to CellData
    const result: Record<string, Record<string, CellData>> = {};
    codes.forEach((s) => {
      result[s] = {};
      codes.forEach((r) => {
        const cell = g[s][r];
        result[s][r] = {
          avgScore: cell.count > 0 ? Math.round(cell.totalScore / cell.count) : 0,
          count: cell.count,
        };
      });
    });

    return { grid: result, bankCodes: codes };
  }, [banks, txs]);

  const [hoveredCell, setHoveredCell] = useState<{ sender: string; receiver: string } | null>(null);

  return (
    <WidgetShell
      title="AML Risk Heatmap"
      icon={Grid3X3}
      headerRight={
        <span className="text-[11px] font-mono text-coda-text-muted">
          Sender {'\u2192'} Receiver
        </span>
      }
    >
      {bankCodes.length === 0 ? (
        <div className="py-6 text-center text-[13px] text-coda-text-muted">No bank data available</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr>
                <th className="text-[10px] font-mono text-coda-text-muted uppercase tracking-wider text-left p-1 w-14" />
                {bankCodes.map((code) => (
                  <th key={code} className="text-[10px] font-mono text-coda-text-muted uppercase tracking-wider text-center p-1 min-w-[48px]">
                    {code}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {bankCodes.map((sender) => (
                <tr key={sender}>
                  <td className="text-[11px] font-mono text-coda-text-secondary p-1">{sender}</td>
                  {bankCodes.map((receiver) => {
                    const cell = grid[sender]?.[receiver];
                    if (!cell || cell.count === 0) {
                      return (
                        <td key={receiver} className="p-1">
                          <div className="w-full h-8 rounded bg-black/[0.02] dark:bg-white/[0.02] flex items-center justify-center">
                            <span className="text-[10px] text-coda-text-muted">{'\u2014'}</span>
                          </div>
                        </td>
                      );
                    }
                    const isHovered = hoveredCell?.sender === sender && hoveredCell?.receiver === receiver;
                    return (
                      <td key={receiver} className="p-1 relative">
                        <div
                          className={`w-full h-8 rounded ${riskColor(cell.avgScore)} flex items-center justify-center cursor-default transition-all ${
                            isHovered ? 'ring-2 ring-coda-text/30' : ''
                          }`}
                          onMouseEnter={() => setHoveredCell({ sender, receiver })}
                          onMouseLeave={() => setHoveredCell(null)}
                        >
                          <span className={`text-[11px] font-mono font-medium tabular-nums ${riskTextColor(cell.avgScore)}`}>
                            {cell.avgScore}
                          </span>
                        </div>
                        {/* Tooltip */}
                        {isHovered && (
                          <div className="absolute z-10 bottom-full left-1/2 -translate-x-1/2 mb-1 px-2 py-1 rounded bg-black/80 dark:bg-white/90 text-white dark:text-black text-[10px] font-mono whitespace-nowrap pointer-events-none">
                            {sender} {'\u2192'} {receiver}: avg {cell.avgScore}, {cell.count} txn{cell.count !== 1 ? 's' : ''}
                          </div>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </WidgetShell>
  );
}
