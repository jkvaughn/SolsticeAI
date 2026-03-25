/**
 * NetworkInfrastructureWidget — Dashboard widget showing Solana network health,
 * deployed banks, token mints, and wallet status with SWR caching.
 */

import { useRef } from 'react';
import { Link } from 'react-router';
import {
  Globe, Server, Coins, Wifi, WifiOff, ArrowRight,
  CheckCircle2, AlertTriangle, Loader2,
} from 'lucide-react';
import { callServer } from '../../supabaseClient';
import { fetchBanks, fetchWallets } from '../../dataClient';
import { useSWRCache } from '../../hooks/useSWRCache';
import { useRealtimeSubscription } from '../../hooks/useRealtimeSubscription';
import { useBanks } from '../../contexts/BanksContext';
import { WidgetShell } from './WidgetShell';

// ── Types ────────────────────────────────────────────────────

interface NetworkInfraData {
  banks: {
    total: number;
    active: number;
    onboarding: number;
    mints: number;
  };
  wallets: {
    total: number;
    funded: number;
    totalTokenBalance: number;
  };
  networkMode: string;
  healthOk: boolean;
  jurisdictions: string[];
}

// ── Fetcher ──────────────────────────────────────────────────

async function fetchNetworkInfra(): Promise<NetworkInfraData> {
  const [banks, wallets, healthRes] = await Promise.all([
    fetchBanks(),
    fetchWallets(),
    callServer<{ status: string }>('/health').catch(() => ({ status: 'error' })),
  ]);

  const jurisdictions = [...new Set(banks.map((b: any) => b.jurisdiction).filter(Boolean))];

  return {
    banks: {
      total: banks.length,
      active: banks.filter((b: any) => b.status === 'active').length,
      onboarding: banks.filter((b: any) => b.status === 'onboarding').length,
      mints: banks.filter((b: any) => !!b.token_mint_address).length,
    },
    wallets: {
      total: wallets.length,
      funded: wallets.filter((w: any) => w.balance_lamports > 0).length,
      totalTokenBalance: wallets.reduce((sum: number, w: any) => sum + (w.balance_tokens || 0), 0),
    },
    networkMode: (import.meta.env.VITE_SOLANA_CLUSTER || 'devnet') === 'mainnet-beta' ? 'production' : 'devnet',
    healthOk: (healthRes as any).status === 'ok',
    jurisdictions,
  };
}

// ── Component ────────────────────────────────────────────────

export function NetworkInfrastructureWidget() {
  const { cacheVersion } = useBanks();

  const {
    data,
    isValidating,
    error,
    invalidate,
  } = useSWRCache<NetworkInfraData>({
    key: 'dashboard-network-infra',
    fetcher: fetchNetworkInfra,
    deps: [cacheVersion],
    ttl: 3 * 60 * 1000,
  });

  const invalidateRef = useRef(invalidate);
  invalidateRef.current = invalidate;

  useRealtimeSubscription({
    channelName: 'dashboard-network-infra-rt',
    subscriptions: [
      { table: 'banks', event: '*', callback: () => setTimeout(() => invalidateRef.current(), 1000) },
      { table: 'wallets', event: '*', callback: () => setTimeout(() => invalidateRef.current(), 1000) },
    ],
    onPoll: () => invalidateRef.current(),
  });

  const infra = data;
  const totalTokenDisplay = infra
    ? `$${(infra.wallets.totalTokenBalance / 1_000_000).toLocaleString(undefined, { maximumFractionDigits: 0 })}`
    : '—';

  const statusBadge = infra ? (
    <>
      {isValidating && <Loader2 className="w-3 h-3 text-coda-text-muted animate-spin" />}
      <span className="inline-flex items-center gap-1.5 text-xs text-coda-text-muted">
        {infra.healthOk ? <Wifi className="w-3 h-3" /> : <WifiOff className="w-3 h-3" />}
        {infra.networkMode === 'devnet' ? 'Devnet' : 'Solstice Network'}
      </span>
    </>
  ) : isValidating ? <Loader2 className="w-3 h-3 text-coda-text-muted animate-spin" /> : null;

  return (
    <WidgetShell title="Network Infrastructure" headerRight={statusBadge}>
      {error && !infra && (
        <div className="flex items-center gap-2 p-3 rounded-lg bg-red-500/5 border border-red-500/15">
          <AlertTriangle className="w-3.5 h-3.5 text-red-400 flex-shrink-0" />
          <p className="text-xs text-red-400">Failed to load network data</p>
        </div>
      )}

      {infra && (
        <div className="space-y-0">
          <MetricRow
            label="Banks Active"
            value={`${infra.banks.active} / ${infra.banks.total}`}
            icon={Server}
            status={infra.banks.active === infra.banks.total ? 'ok' : infra.banks.active > 0 ? 'warn' : 'error'}
          />
          <MetricRow
            label="Token Mints"
            value={String(infra.banks.mints)}
            icon={Coins}
            status={infra.banks.mints > 0 ? 'ok' : 'neutral'}
            border
          />
          <MetricRow
            label="Wallets Funded"
            value={`${infra.wallets.funded} / ${infra.wallets.total}`}
            icon={CheckCircle2}
            status={infra.wallets.funded === infra.wallets.total && infra.wallets.total > 0 ? 'ok' : infra.wallets.funded > 0 ? 'warn' : 'neutral'}
            border
          />
          <MetricRow
            label="Total Liquidity"
            value={totalTokenDisplay}
            icon={Coins}
            status="ok"
            border
          />

          {/* Jurisdictions */}
          {infra.jurisdictions.length > 0 && (
            <div className="flex items-center gap-2 flex-wrap pt-3 mt-3 border-t border-black/[0.06] dark:border-white/[0.06]">
              <span className="text-[10px] text-coda-text-muted uppercase tracking-wider">Jurisdictions:</span>
              {infra.jurisdictions.map((j) => (
                <span
                  key={j}
                  className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-black/[0.03] dark:bg-white/[0.04] text-coda-text-muted"
                >
                  {j}
                </span>
              ))}
            </div>
          )}

          {/* Onboarding callout */}
          {infra.banks.onboarding > 0 && (
            <Link
              to="/setup"
              className="mt-3 flex items-center gap-2 p-2.5 rounded-lg bg-amber-500/5 border border-amber-500/15 hover:border-amber-500/30 transition-colors group"
            >
              <AlertTriangle className="w-3 h-3 text-amber-500 flex-shrink-0" />
              <span className="text-xs text-amber-600 dark:text-amber-400 flex-1">
                {infra.banks.onboarding} bank{infra.banks.onboarding !== 1 ? 's' : ''} awaiting activation
              </span>
              <ArrowRight className="w-3 h-3 text-amber-500 group-hover:text-amber-400 transition-colors" />
            </Link>
          )}
        </div>
      )}

      {/* Skeleton */}
      {!infra && !error && (
        <div className="space-y-3">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-10 rounded-lg bg-black/[0.02] dark:bg-white/[0.02] animate-pulse" />
          ))}
        </div>
      )}
    </WidgetShell>
  );
}

// ── Metric Row (flat, with thin divider) ─────────────────────

function MetricRow({ label, value, icon: Icon, border }: {
  label: string;
  value: string;
  icon: React.ElementType;
  status: 'ok' | 'warn' | 'error' | 'neutral';
  border?: boolean;
}) {
  return (
    <div className={`flex items-center justify-between py-2.5 ${
      border ? 'border-t border-black/[0.06] dark:border-white/[0.06]' : ''
    }`}>
      <div className="flex items-center gap-2.5">
        <Icon className="w-3.5 h-3.5 text-coda-text-muted" />
        <span className="text-xs text-coda-text-secondary">{label}</span>
      </div>
      <span className="text-sm font-medium text-coda-text tabular-nums">
        {value}
      </span>
    </div>
  );
}
