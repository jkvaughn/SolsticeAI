import { Coins } from 'lucide-react';
import { fetchCustodyBalances } from '../../dataClient';
import { useBanks } from '../../contexts/BanksContext';
import { useSWRCache } from '../../hooks/useSWRCache';
import { WidgetShell } from '../dashboard/WidgetShell';
import { SandboxBadge } from '../sandbox/SandboxBadge';

// ============================================================
// Digital Asset Holdings (Task 165)
//
// Shows per-bank digital asset balances from the custody provider.
// Displays BTC, ETH, USDC holdings with USD equivalents.
// SandboxBadge when in sandbox mode.
// ============================================================

interface CustodyData {
  bank_id: string;
  balances: { asset_type: string; balance: number; usd_equivalent: number }[];
  provider: string;
}

function fmtBalance(n: number, asset: string): string {
  // Stablecoins show as integer, crypto shows decimals
  if (asset === 'USDC' || asset === 'USDT') {
    return Number(n).toLocaleString(undefined, { maximumFractionDigits: 0 });
  }
  return Number(n).toLocaleString(undefined, { maximumFractionDigits: 4 });
}

function fmtUsd(n: number): string {
  return '$' + Number(n).toLocaleString(undefined, { maximumFractionDigits: 0 });
}

const ASSET_ICONS: Record<string, string> = {
  BTC: 'text-orange-500',
  ETH: 'text-purple-500',
  USDC: 'text-blue-500',
  SOL: 'text-teal-500',
};

export function DigitalAssetHoldings() {
  const { cacheVersion } = useBanks();

  const { data } = useSWRCache<CustodyData>({
    key: 'custody-balances',
    fetcher: () => fetchCustodyBalances(),
    deps: [cacheVersion],
    ttl: 5 * 60 * 1000,
  });

  const balances = data?.balances ?? [];
  const provider = data?.provider ?? 'unknown';
  const isSandbox = provider === 'mock';
  const totalUsd = balances.reduce((sum, b) => sum + (b.usd_equivalent || 0), 0);

  return (
    <WidgetShell
      title="Digital Asset Holdings"
      icon={Coins}
      headerRight={
        <div className="flex items-center gap-2">
          {isSandbox && <SandboxBadge integration="custody" mode="sandbox" />}
          <span className="text-[11px] font-mono text-coda-text-muted">
            Total: {fmtUsd(totalUsd)}
          </span>
        </div>
      }
    >
      {balances.length === 0 ? (
        <div className="py-6 text-center text-[13px] text-coda-text-muted">
          No digital asset holdings
        </div>
      ) : (
        <div className="space-y-0">
          {/* Header */}
          <div className="grid grid-cols-12 gap-2 py-2 text-[11px] font-mono text-coda-text-muted uppercase tracking-wider">
            <div className="col-span-3">Asset Type</div>
            <div className="col-span-3">Balance</div>
            <div className="col-span-3">USD Equivalent</div>
            <div className="col-span-3">Provider</div>
          </div>
          {balances.map((b, i) => {
            const assetColor = ASSET_ICONS[b.asset_type] ?? 'text-coda-text';
            return (
              <div
                key={b.asset_type}
                className={`grid grid-cols-12 gap-2 items-center py-3 ${
                  i > 0 ? 'border-t border-black/[0.06] dark:border-white/[0.06]' : ''
                }`}
              >
                <div className="col-span-3 flex items-center gap-2">
                  <span className={`text-[14px] font-mono font-semibold ${assetColor}`}>
                    {b.asset_type}
                  </span>
                </div>
                <div className="col-span-3 text-[14px] font-mono text-coda-text tabular-nums">
                  {fmtBalance(b.balance, b.asset_type)}
                </div>
                <div className="col-span-3 text-[14px] font-mono text-coda-text tabular-nums">
                  {fmtUsd(b.usd_equivalent)}
                </div>
                <div className="col-span-3 text-[12px] text-coda-text-muted font-mono">
                  {provider}
                </div>
              </div>
            );
          })}
          {/* Total row */}
          <div className="grid grid-cols-12 gap-2 items-center py-3 border-t border-black/[0.12] dark:border-white/[0.12]">
            <div className="col-span-3 text-[13px] font-mono font-medium text-coda-text">
              Total
            </div>
            <div className="col-span-3" />
            <div className="col-span-3 text-[14px] font-mono font-medium text-coda-text tabular-nums">
              {fmtUsd(totalUsd)}
            </div>
            <div className="col-span-3" />
          </div>
        </div>
      )}
    </WidgetShell>
  );
}
