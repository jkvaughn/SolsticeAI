import { DollarSign } from 'lucide-react';
import { fetchNetworkWallets, fetchTransactions, fetchSettledVolume } from '../../dataClient';
import { useBanks } from '../../contexts/BanksContext';
import { useSWRCache } from '../../hooks/useSWRCache';
import { WidgetShell } from '../dashboard/WidgetShell';

// ============================================================
// Network Economics (Task 166)
//
// Financial metrics panel: fees balance, revenue, yield,
// cost per settlement, projected annual revenue.
// ============================================================

interface EconData {
  feesBalance: number;
  revenueToday: number;
  revenue30d: number;
  yieldRate: number;
  costPerSettlement: number;
  projectedAnnual: number;
  totalSettlements: number;
}

async function fetchEconData(): Promise<EconData> {
  const [wallets, txs, settledVol] = await Promise.all([
    fetchNetworkWallets().catch(() => []),
    fetchTransactions({ limit: 200 }).catch(() => []),
    fetchSettledVolume().catch(() => 0),
  ]);

  // Find fees wallet
  const feesWallet = wallets.find((w: any) => w.label === 'fees' || w.wallet_type === 'fees');
  const feesBalance = feesWallet ? (feesWallet.balance_tokens || 0) / 1e6 : 0;

  // Calculate fee revenue from transactions (network_fee_sol field)
  const now = Date.now();
  const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
  const thirtyDaysAgo = now - 30 * 24 * 60 * 60 * 1000;

  const settledTxs = txs.filter((t: any) => t.status === 'settled');
  const todayTxs = settledTxs.filter((t: any) => new Date(t.settled_at || t.created_at).getTime() >= todayStart.getTime());
  const recentTxs = settledTxs.filter((t: any) => new Date(t.settled_at || t.created_at).getTime() >= thirtyDaysAgo);

  const sumFees = (list: any[]) => list.reduce((s, t) => s + (t.network_fee_sol || 0), 0);

  const revenueToday = sumFees(todayTxs);
  const revenue30d = sumFees(recentTxs);
  const totalSettlements = settledTxs.length;

  // Yield: fee revenue as % of settled volume
  const settledUsd = (settledVol || 0) / 1e6;
  const yieldRate = settledUsd > 0 ? (revenue30d / settledUsd) * 100 : 0;

  // Cost per settlement
  const costPerSettlement = totalSettlements > 0 ? revenue30d / totalSettlements : 0;

  // Projected annual (30d * 12)
  const projectedAnnual = revenue30d * 12;

  return { feesBalance, revenueToday, revenue30d, yieldRate, costPerSettlement, projectedAnnual, totalSettlements };
}

function fmtUsd(n: number): string {
  if (Math.abs(n) >= 1_000_000) return '$' + (n / 1_000_000).toFixed(2) + 'M';
  if (Math.abs(n) >= 1_000) return '$' + (n / 1_000).toFixed(1) + 'K';
  return '$' + n.toFixed(2);
}

export function NetworkEconomics() {
  const { cacheVersion } = useBanks();

  const { data } = useSWRCache<EconData>({
    key: 'network-economics',
    fetcher: fetchEconData,
    deps: [cacheVersion],
    ttl: 5 * 60 * 1000,
  });

  const {
    feesBalance = 0, revenueToday = 0, revenue30d = 0,
    yieldRate = 0, costPerSettlement = 0, projectedAnnual = 0,
    totalSettlements = 0,
  } = data ?? {};

  const metrics = [
    { label: 'Fees Wallet Balance', value: fmtUsd(feesBalance) },
    { label: 'Revenue Today', value: fmtUsd(revenueToday) },
    { label: 'Revenue (30d)', value: fmtUsd(revenue30d) },
    { label: 'Yield Rate (30d)', value: `${yieldRate.toFixed(3)}%` },
    { label: 'Cost per Settlement', value: fmtUsd(costPerSettlement) },
    { label: 'Projected Annual', value: fmtUsd(projectedAnnual) },
  ];

  return (
    <WidgetShell
      title="Network Economics"
      icon={DollarSign}
      headerRight={
        <span className="text-[11px] font-mono text-coda-text-muted">
          {totalSettlements} settlements
        </span>
      }
    >
      <div className="grid grid-cols-3 gap-4">
        {metrics.map((m) => (
          <div key={m.label} className="text-center py-2">
            <div className="text-[20px] font-mono font-light text-coda-text tabular-nums">
              {m.value}
            </div>
            <div className="text-[10px] text-coda-text-muted font-mono uppercase tracking-wider mt-1">
              {m.label}
            </div>
          </div>
        ))}
      </div>
    </WidgetShell>
  );
}
