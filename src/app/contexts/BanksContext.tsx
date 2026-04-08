/**
 * BanksContext — Single source of truth for bank data across the app.
 *
 * Fetches banks (with wallets) once, subscribes to Realtime, and exposes
 * a `cacheVersion` counter that increments on every Realtime mutation.
 *
 * Downstream SWR caches should include `cacheVersion` in their `deps`
 * array so that a bank change automatically triggers revalidation of
 * dependent data (transactions, stats, etc.).
 *
 * Data flow:
 *   Realtime event → refetch banks → update context → bump cacheVersion
 *   → downstream deps change → dependent SWR caches revalidate
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react';
import type { ReactNode } from 'react';
import { fetchBanks as fetchBanksFromClient } from '../dataClient';
import { useRealtimeSubscription } from '../hooks/useRealtimeSubscription';
import type { Bank } from '../types';

// ── Session storage helpers ──────────────────────────────────

const SESSION_KEY = 'swr:banks-context';

function readSessionBanks(): Bank[] | null {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed?.data ?? null;
  } catch {
    return null;
  }
}

function writeSessionBanks(banks: Bank[]) {
  try {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify({ data: banks, ts: Date.now() }));
  } catch {
    // Quota exceeded — silently ignore
  }
}

// ── Context shape ────────────────────────────────────────────

interface BanksContextValue {
  /** All banks (any status) with wallets relation */
  banks: Bank[];
  /** Convenience: only status === 'active' */
  activeBanks: Bank[];
  /** True during the initial load (no cached data yet) */
  isLoading: boolean;
  /** True when revalidating in background */
  isValidating: boolean;
  /**
   * Monotonically increasing counter. Increments on every Realtime
   * mutation or manual revalidation. Pass this into downstream
   * useSWRCache `deps` arrays to trigger cascading revalidation.
   */
  cacheVersion: number;
  /** Force a refetch from Supabase. Call after mutations (seed, deploy, etc.) */
  revalidate: () => Promise<void>;
}

const BanksContext = createContext<BanksContextValue>({
  banks: [],
  activeBanks: [],
  isLoading: true,
  isValidating: false,
  cacheVersion: 0,
  revalidate: async () => {},
});

// ── Provider ─────────────────────────────────────────────────

export function BanksProvider({ children }: { children: ReactNode }) {
  // Seed from sessionStorage for instant render on hard refresh
  const [banks, setBanks] = useState<Bank[]>(() => readSessionBanks() ?? []);
  const [isLoading, setIsLoading] = useState(() => readSessionBanks() === null);
  const [isValidating, setIsValidating] = useState(false);
  const [cacheVersion, setCacheVersion] = useState(0);

  // Debounce timer for Realtime-triggered revalidations
  const reloadTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inflightRef = useRef<Promise<void> | null>(null);

  // Mounted guard — skip setState / error logging after unmount
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  const fetchBanks = useCallback(async () => {
    // Dedup inflight
    if (inflightRef.current) {
      await inflightRef.current;
      return;
    }

    if (mountedRef.current) setIsValidating(true);

    const doFetch = async () => {
      try {
        const result = await fetchBanksFromClient();

        if (!mountedRef.current) return;

        setBanks(result as Bank[]);
        writeSessionBanks(result as Bank[]);
      } catch (err) {
        // Only log if still mounted — unmount-triggered "Failed to fetch" is expected
        if (mountedRef.current) {
          console.error('[BanksContext] fetch error:', err);
        }
      } finally {
        if (mountedRef.current) {
          setIsLoading(false);
          setIsValidating(false);
        }
        inflightRef.current = null;
      }
    };

    const promise = doFetch();
    inflightRef.current = promise;
    await promise;
  }, []);

  // Public revalidate — bumps cacheVersion to cascade downstream
  const revalidate = useCallback(async () => {
    await fetchBanks();
    setCacheVersion(v => v + 1);
  }, [fetchBanks]);

  // ── Initial fetch ──────────────────────────────────────────
  useEffect(() => {
    fetchBanks().then(() => {
      // Bump version after initial fetch so downstream caches that
      // started with sessionStorage data get refreshed too
      setCacheVersion(v => v + 1);
    });
  }, [fetchBanks]);

  // ── Realtime subscriptions (env-aware: Supabase or polling) ──
  const debouncedRefresh = () => {
    if (reloadTimerRef.current) clearTimeout(reloadTimerRef.current);
    reloadTimerRef.current = setTimeout(() => {
      fetchBanks().then(() => setCacheVersion(v => v + 1));
    }, 2500);
  };

  useRealtimeSubscription({
    channelName: 'banks-context',
    subscriptions: [
      { table: 'banks', event: '*', callback: debouncedRefresh },
      { table: 'wallets', event: '*', callback: debouncedRefresh },
    ],
    pollIntervalMs: 5000,
    onPoll: () => fetchBanks().then(() => setCacheVersion(v => v + 1)),
  });

  // ── Derived ────────────────────────────────────────────────
  const activeBanks = banks.filter(b => b.status === 'active');

  return (
    <BanksContext.Provider
      value={{ banks, activeBanks, isLoading, isValidating, cacheVersion, revalidate }}
    >
      {children}
    </BanksContext.Provider>
  );
}

// ── Hook ─────────────────────────────────────────────────────

export function useBanks() {
  return useContext(BanksContext);
}