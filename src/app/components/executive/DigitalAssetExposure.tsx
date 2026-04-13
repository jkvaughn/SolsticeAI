import { PieChart } from 'lucide-react';
import { fetchCustodyBalances, fetchSettledVolume } from '../../dataClient';
import { useBanks } from '../../contexts/BanksContext';
import { useSWRCache } from '../../hooks/useSWRCache';
import { WidgetShell } from '../dashboard/WidgetShell';

// ============================================================
// Digital Asset Exposure (Task 165)
//
// Executive-level view: aggregate across all banks showing
// total assets by type, total USD value, and % of network
// settlement with collateral backing.
// ============================================================

interface ExposureData {
  balances: { asset_type: string; balance: number; usd_equivalent: number }[];
  totalUsd: number;
  settledVolume: number;
  collateralPct: number;
}

async function fetchExposure(): Promise<ExposureData> {
  const [custodyData, settledVolume] = await Promise.all([
    fetchCustodyBalances().catch(() => ({ balances: [] })),
    fetchSettledVolume().catch(() => 0),
  ]);

  const balances = custodyData?.balances ?? [];
  const totalUsd = balances.reduce((sum: number, b: any) => sum + (b.usd_equivalent || 0), 0);

  // Collateral backing: what % of settled volume is covered by reserves
  const settledUsd = (settledVolume || 0) / 1e6; // Convert from micro-tokens
  const collateralPct = settledUsd > 0
    ? Math.min(Math.round((totalUsd / settledUsd) * 100), 999)
    : 0;

  return { balances, totalUsd, settledVolume: settledUsd, collateralPct };
}

function fmtUsd(n: number): string {
  if (n >= 1_000_000) return '$' + (n / 1_000_000).toFixed(1) + 'M';
  if (n >= 1_000) return '$' + (n / 1_000).toFixed(0) + 'K';
  return '$' + n.toLocaleString(undefined, { maximumFractionDigits: 0 });
}

const ASSET_COLORS: Record<string, string> = {
  BTC: 'bg-orange-500',
  ETH: 'bg-purple-500',
  USDC: 'bg-blue-500',
  SOL: 'bg-teal-500',
};

export function DigitalAssetExposure() {
  const { cacheVersion } = useBanks();

  const { data } = useSWRCache<ExposureData>({
    key: 'digital-asset-exposure',
    fetcher: fetchExposure,
    deps: [cacheVersion],
    ttl: 5 * 60 * 1000,
  });

  const { balances = [], totalUsd = 0, settledVolume = 0, collateralPct = 0 } = data ?? {};

  return (
    <WidgetShell
      title="Digital Asset Exposure"
      icon={PieChart}
      headerRight={
        <span className="text-[11px] font-mono text-coda-text-muted">
          Network Aggregate
        </span>
      }
    >
      <div className="space-y-4">
        {/* Summary stats */}
        <div className="grid grid-cols-3 gap-4">
          <div className="text-center">
            <div className="text-[22px] font-mono font-light text-coda-text tabular-nums">
              {fmtUsd(totalUsd)}
            </div>
            <div className="text-[11px] text-coda-text-muted font-mono uppercase tracking-wider mt-0.5">
              Total Reserves
            </div>
          </div>
          <div className="text-center">
            <div className="text-[22px] font-mono font-light text-coda-text tabular-nums">
              {fmtUsd(settledVolume)}
            </div>
            <div className="text-[11px] text-coda-text-muted font-mono uppercase tracking-wider mt-0.5">
              Settled Volume
            </div>
          </div>
          <div className="text-center">
            <div className={`text-[22px] font-mono font-light tabular-nums ${
              collateralPct >= 100 ? 'text-emerald-500' : collateralPct >= 50 ? 'text-amber-500' : 'text-red-500'
            }`}>
              {collateralPct}%
            </div>
            <div className="text-[11px] text-coda-text-muted font-mono uppercase tracking-wider mt-0.5">
              Collateral Backing
            </div>
          </div>
        </div>

        {/* Asset breakdown */}
        {balances.length > 0 && (
          <div className="space-y-2">
            <div className="text-[11px] font-mono text-coda-text-muted uppercase tracking-wider">
              Asset Breakdown
            </div>
            {balances.map((b) => {
              const pct = totalUsd > 0 ? (b.usd_equivalent / totalUsd) * 100 : 0;
              const barColor = ASSET_COLORS[b.asset_type] ?? 'bg-gray-500';
              return (
                <div key={b.asset_type} className="flex items-center gap-3">
                  <span className="text-[13px] font-mono font-medium text-coda-text w-12">
                    {b.asset_type}
                  </span>
                  <div className="flex-1 h-2 bg-black/[0.06] dark:bg-white/[0.06] rounded-full overflow-hidden">
                    <div
                      className={`h-full ${barColor} rounded-full transition-all duration-500`}
                      style={{ width: `${Math.max(pct, 1)}%` }}
                    />
                  </div>
                  <span className="text-[12px] font-mono text-coda-text-muted tabular-nums w-16 text-right">
                    {fmtUsd(b.usd_equivalent)}
                  </span>
                  <span className="text-[11px] font-mono text-coda-text-muted tabular-nums w-10 text-right">
                    {pct.toFixed(0)}%
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </WidgetShell>
  );
}
