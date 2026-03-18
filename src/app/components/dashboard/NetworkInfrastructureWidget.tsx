/**
 * NetworkInfrastructureWidget — Dashboard widget showing Solana network health,
 * deployed banks, token mints, and wallet status with SWR caching.
 */

import { useCallback, useEffect, useRef } from 'react';
import { Link } from 'react-router';
import {
  Globe, Server, Coins, Wifi, WifiOff, ArrowRight,
  CheckCircle2, AlertTriangle, Loader2,
} from 'lucide-react';
import { supabase, callServer } from '../../supabaseClient';
import { useSWRCache } from '../../hooks/useSWRCache';
import { useBanks } from '../../contexts/BanksContext';
import type { Bank } from '../../types';

// ── Types ────────────────────────────────────────────────────

interface NetworkInfraData {
  banks: {
    total: number;
    active: number;
    onboarding: number;
    mints: number; // banks with a token mint deployed
  };
  wallets: {
    total: number;
    funded: number; // wallets with balance_lamports > 0
    totalTokenBalance: number; // sum of all token balances (base units)
  };
  networkMode: string; // 'devnet' | 'production'
  healthOk: boolean;
  jurisdictions: string[];
}

// ── Fetcher ──────────────────────────────────────────────────

async function fetchNetworkInfra(): Promise<NetworkInfraData> {
  // Parallel queries
  const [banksRes, walletsRes, healthRes, modeRes] = await Promise.all([
    supabase.from('banks').select('id, status, token_mint_address, jurisdiction'),
    supabase.from('wallets').select('id, balance_lamports, balance_tokens'),
    callServer<{ status: string }>('/health').catch(() => ({ status: 'error' })),
    callServer<{ mode: string }>('/network-mode', { action: 'get' }).catch(() => ({ mode: 'devnet' })),
  ]);

  const banks = banksRes.data ?? [];
  const wallets = walletsRes.data ?? [];

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
    networkMode: (modeRes as any).mode || 'devnet',
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
    ttl: 3 * 60 * 1000, // 3 min
  });

  // Realtime: invalidate on bank changes
  const invalidateRef = useRef(invalidate);
  invalidateRef.current = invalidate;

  useEffect(() => {
    const channel = supabase
      .channel('dashboard-network-infra-rt')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'banks' }, () => {
        setTimeout(() => invalidateRef.current(), 1000);
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'wallets' }, () => {
        setTimeout(() => invalidateRef.current(), 1000);
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, []);

  const infra = data;
  const totalTokenDisplay = infra
    ? `$${(infra.wallets.totalTokenBalance / 1_000_000).toLocaleString(undefined, { maximumFractionDigits: 0 })}`
    : '—';

  return (
    <div className="dashboard-card p-5">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Globe className="w-4 h-4 text-coda-brand" />
          <h2 className="text-sm font-bold dashboard-text">Network Infrastructure</h2>
        </div>
        <div className="flex items-center gap-2">
          {isValidating && (
            <Loader2 className="w-3 h-3 text-coda-text-muted animate-spin" />
          )}
          {infra && (
            <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-bold uppercase tracking-wide ${
              infra.healthOk
                ? 'bg-emerald-500/10 text-emerald-500 dark:text-emerald-400'
                : 'bg-red-500/10 text-red-500 dark:text-red-400'
            }`}>
              {infra.healthOk ? <Wifi className="w-2.5 h-2.5" /> : <WifiOff className="w-2.5 h-2.5" />}
              {infra.networkMode === 'devnet' ? 'Devnet' : 'Production'}
            </span>
          )}
        </div>
      </div>

      {error && !infra && (
        <div className="flex items-center gap-2 p-3 rounded-lg bg-red-500/5 border border-red-500/15">
          <AlertTriangle className="w-3.5 h-3.5 text-red-400 flex-shrink-0" />
          <p className="text-xs text-red-400">Failed to load network data</p>
        </div>
      )}

      {infra && (
        <>
          {/* Metrics grid */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
            <MetricCell
              label="Banks Active"
              value={`${infra.banks.active}/${infra.banks.total}`}
              icon={Server}
              status={infra.banks.active === infra.banks.total ? 'ok' : infra.banks.active > 0 ? 'warn' : 'error'}
            />
            <MetricCell
              label="Token Mints"
              value={String(infra.banks.mints)}
              icon={Coins}
              status={infra.banks.mints > 0 ? 'ok' : 'neutral'}
            />
            <MetricCell
              label="Wallets Funded"
              value={`${infra.wallets.funded}/${infra.wallets.total}`}
              icon={CheckCircle2}
              status={infra.wallets.funded === infra.wallets.total && infra.wallets.total > 0 ? 'ok' : infra.wallets.funded > 0 ? 'warn' : 'neutral'}
            />
            <MetricCell
              label="Total Liquidity"
              value={totalTokenDisplay}
              icon={Coins}
              status="ok"
            />
          </div>

          {/* Jurisdictions */}
          {infra.jurisdictions.length > 0 && (
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-[10px] text-coda-text-muted uppercase tracking-wider">Jurisdictions:</span>
              {infra.jurisdictions.map((j) => (
                <span
                  key={j}
                  className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-coda-surface-alt text-coda-text-muted"
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
        </>
      )}

      {/* Skeleton */}
      {!infra && !error && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-16 rounded-lg bg-coda-surface-alt animate-pulse" />
          ))}
        </div>
      )}
    </div>
  );
}

// ── Metric Cell ──────────────────────────────────────────────

function MetricCell({ label, value, icon: Icon, status }: {
  label: string;
  value: string;
  icon: React.ElementType;
  status: 'ok' | 'warn' | 'error' | 'neutral';
}) {
  const colors = {
    ok: 'text-emerald-500 dark:text-emerald-400',
    warn: 'text-amber-500 dark:text-amber-400',
    error: 'text-red-500 dark:text-red-400',
    neutral: 'text-coda-text-muted',
  };

  return (
    <div className="dashboard-card-nested p-3">
      <div className="flex items-center gap-1.5 mb-1.5">
        <Icon className={`w-3 h-3 ${colors[status]}`} />
        <span className="text-[10px] text-coda-text-muted uppercase tracking-wider">{label}</span>
      </div>
      <p className={`text-sm font-bold tabular-nums ${status === 'neutral' ? 'dashboard-text' : colors[status]}`}>
        {value}
      </p>
    </div>
  );
}