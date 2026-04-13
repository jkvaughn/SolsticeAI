import { Droplets } from 'lucide-react';
import { fetchTransactions, fetchWallets } from '../../dataClient';
import type { Transaction } from '../../types';
import { useBanks } from '../../contexts/BanksContext';
import { useSWRCache } from '../../hooks/useSWRCache';
import { WidgetShell } from '../dashboard/WidgetShell';

// ============================================================
// Intraday Liquidity (Task 167)
//
// BCBS 248 Tools 1-2: Token balance at start of day, peak
// intraday deployed %, cumulative inflows/outflows, net
// intraday position. Text-based time-series display.
// ============================================================

interface LiquidityData {
  startOfDayBalance: number;
  currentBalance: number;
  peakDeployedPct: number;
  cumulativeInflows: number;
  cumulativeOutflows: number;
  netPosition: number;
  hourlyPositions: { hour: string; balance: number; inflow: number; outflow: number }[];
}

async function fetchLiquidityData(): Promise<LiquidityData> {
  const [wallets, txs] = await Promise.all([
    fetchWallets().catch(() => []),
    fetchTransactions({ limit: 200 }).catch(() => []),
  ]);

  // Aggregate all wallet balances
  const currentBalance = (wallets ?? []).reduce((s: number, w: any) => s + ((w.balance_tokens || 0) / 1e6), 0);

  // Today's transactions
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const todayTxs = (txs ?? []).filter((t: Transaction) =>
    new Date(t.created_at).getTime() >= todayStart.getTime()
  );

  // Calculate inflows/outflows (settled transactions)
  const settled = todayTxs.filter((t) => t.status === 'settled');
  const cumulativeInflows = settled.reduce((s, t) => s + ((t.amount || 0) / 1e6), 0);
  const cumulativeOutflows = settled.reduce((s, t) => s + ((t.amount || 0) / 1e6), 0);

  // Start of day balance: current - net flows
  const netPosition = cumulativeInflows - cumulativeOutflows;
  const startOfDayBalance = currentBalance - netPosition;

  // Peak deployed: max outflow relative to start balance
  const peakDeployedPct = startOfDayBalance > 0
    ? Math.min(Math.round((cumulativeOutflows / startOfDayBalance) * 100), 100)
    : 0;

  // Build hourly positions
  const hourlyPositions: LiquidityData['hourlyPositions'] = [];
  const nowHour = new Date().getHours();
  for (let h = 8; h <= Math.min(nowHour, 18); h++) {
    const hourStart = new Date(todayStart);
    hourStart.setHours(h);
    const hourEnd = new Date(todayStart);
    hourEnd.setHours(h + 1);

    const hourTxs = settled.filter((t) => {
      const ts = new Date(t.settled_at || t.created_at).getTime();
      return ts >= hourStart.getTime() && ts < hourEnd.getTime();
    });

    const inflow = hourTxs.reduce((s, t) => s + ((t.amount || 0) / 1e6), 0);
    const outflow = hourTxs.reduce((s, t) => s + ((t.amount || 0) / 1e6), 0);

    hourlyPositions.push({
      hour: `${h.toString().padStart(2, '0')}:00`,
      balance: startOfDayBalance + inflow - outflow,
      inflow,
      outflow,
    });
  }

  return {
    startOfDayBalance,
    currentBalance,
    peakDeployedPct,
    cumulativeInflows,
    cumulativeOutflows,
    netPosition,
    hourlyPositions,
  };
}

function fmtUsd(n: number): string {
  if (Math.abs(n) >= 1_000_000) return '$' + (n / 1_000_000).toFixed(2) + 'M';
  if (Math.abs(n) >= 1_000) return '$' + (n / 1_000).toFixed(1) + 'K';
  return '$' + n.toFixed(2);
}

export function IntradayLiquidity() {
  const { cacheVersion } = useBanks();

  const { data } = useSWRCache<LiquidityData>({
    key: 'intraday-liquidity',
    fetcher: fetchLiquidityData,
    deps: [cacheVersion],
    ttl: 2 * 60 * 1000,
  });

  const {
    startOfDayBalance = 0, currentBalance = 0, peakDeployedPct = 0,
    cumulativeInflows = 0, cumulativeOutflows = 0, netPosition = 0,
    hourlyPositions = [],
  } = data ?? {};

  return (
    <WidgetShell
      title="Intraday Liquidity (BCBS 248)"
      icon={Droplets}
      headerRight={
        <span className="text-[11px] font-mono text-coda-text-muted">Tools 1-2</span>
      }
    >
      <div className="space-y-4">
        {/* Key metrics */}
        <div className="grid grid-cols-3 gap-3">
          {[
            { label: 'Start of Day Balance', value: fmtUsd(startOfDayBalance) },
            { label: 'Current Balance', value: fmtUsd(currentBalance) },
            { label: 'Peak Deployed %', value: `${peakDeployedPct}%` },
          ].map((m) => (
            <div key={m.label} className="text-center py-2">
              <div className="text-[18px] font-mono font-light text-coda-text tabular-nums">{m.value}</div>
              <div className="text-[10px] text-coda-text-muted font-mono uppercase tracking-wider mt-0.5">{m.label}</div>
            </div>
          ))}
        </div>

        {/* Cumulative flows */}
        <div className="grid grid-cols-3 gap-3">
          <div className="text-center py-2">
            <div className="text-[16px] font-mono text-emerald-500 tabular-nums">{fmtUsd(cumulativeInflows)}</div>
            <div className="text-[10px] text-coda-text-muted font-mono uppercase mt-0.5">Cumulative Inflows</div>
          </div>
          <div className="text-center py-2">
            <div className="text-[16px] font-mono text-red-500 tabular-nums">{fmtUsd(cumulativeOutflows)}</div>
            <div className="text-[10px] text-coda-text-muted font-mono uppercase mt-0.5">Cumulative Outflows</div>
          </div>
          <div className="text-center py-2">
            <div className={`text-[16px] font-mono tabular-nums ${netPosition >= 0 ? 'text-emerald-500' : 'text-red-500'}`}>
              {fmtUsd(netPosition)}
            </div>
            <div className="text-[10px] text-coda-text-muted font-mono uppercase mt-0.5">Net Position</div>
          </div>
        </div>

        {/* Hourly position (text-based time series) */}
        {hourlyPositions.length > 0 && (
          <div>
            <div className="text-[11px] font-mono text-coda-text-muted uppercase tracking-wider mb-2">
              Hourly Position
            </div>
            <div className="space-y-0">
              <div className="grid grid-cols-4 gap-2 py-1 text-[10px] font-mono text-coda-text-muted uppercase tracking-wider">
                <div>Hour</div>
                <div>Balance</div>
                <div>Inflow</div>
                <div>Outflow</div>
              </div>
              {hourlyPositions.map((h, i) => (
                <div
                  key={h.hour}
                  className={`grid grid-cols-4 gap-2 py-1.5 ${
                    i > 0 ? 'border-t border-black/[0.04] dark:border-white/[0.04]' : ''
                  }`}
                >
                  <div className="text-[12px] font-mono text-coda-text tabular-nums">{h.hour}</div>
                  <div className="text-[12px] font-mono text-coda-text tabular-nums">{fmtUsd(h.balance)}</div>
                  <div className="text-[12px] font-mono text-emerald-500 tabular-nums">{h.inflow > 0 ? `+${fmtUsd(h.inflow)}` : '\u2014'}</div>
                  <div className="text-[12px] font-mono text-red-500 tabular-nums">{h.outflow > 0 ? `-${fmtUsd(h.outflow)}` : '\u2014'}</div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </WidgetShell>
  );
}
