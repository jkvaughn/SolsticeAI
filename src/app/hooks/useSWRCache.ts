/**
 * useSWRCache — Stale-While-Revalidate cache hook
 *
 * Memory-first, sessionStorage-persisted. Returns cached data instantly on
 * re-mount (route change or hard refresh) then revalidates in background.
 *
 * Revalidation triggers:
 *  1. deps array changes  (e.g. BanksContext cacheVersion bumps)
 *  2. invalidate() called (e.g. Realtime subscription fires)
 *  3. TTL expires         (default 5 min)
 */

import { useCallback, useEffect, useRef, useState } from 'react';

// ── Module-level memory cache (survives route changes) ───────
const memoryCache = new Map<string, { data: unknown; ts: number }>();

// ── Helpers ──────────────────────────────────────────────────

function readSession<T>(key: string): { data: T; ts: number } | null {
  try {
    const raw = sessionStorage.getItem(`swr:${key}`);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function writeSession<T>(key: string, data: T, ts: number) {
  try {
    sessionStorage.setItem(`swr:${key}`, JSON.stringify({ data, ts }));
  } catch {
    // Quota exceeded — silently ignore
  }
}

function clearSession(key: string) {
  try {
    sessionStorage.removeItem(`swr:${key}`);
  } catch {
    // ignore
  }
}

// ── Hook ─────────────────────────────────────────────────────

export interface SWRCacheOptions<T> {
  /** Unique cache key */
  key: string;
  /** Async function that returns fresh data */
  fetcher: () => Promise<T>;
  /** When any dep changes, revalidate (e.g. [cacheVersion]) */
  deps?: unknown[];
  /** Max cache age in ms before auto-revalidate on access (default 5 min) */
  ttl?: number;
  /**
   * If true, persist to sessionStorage so data survives hard refresh.
   * Default: true
   */
  persist?: boolean;
}

export interface SWRCacheResult<T> {
  data: T | null;
  isValidating: boolean;
  error: Error | null;
  /** Force a background revalidation now */
  invalidate: () => void;
}

export function useSWRCache<T>({
  key,
  fetcher,
  deps = [],
  ttl = 5 * 60 * 1000,
  persist = true,
}: SWRCacheOptions<T>): SWRCacheResult<T> {
  // Resolve initial data: memory cache > sessionStorage > null
  const initial = (): T | null => {
    const mem = memoryCache.get(key);
    if (mem) return mem.data as T;
    if (persist) {
      const session = readSession<T>(key);
      if (session) {
        // Hydrate memory cache from sessionStorage
        memoryCache.set(key, { data: session.data, ts: session.ts });
        return session.data;
      }
    }
    return null;
  };

  const [data, setData] = useState<T | null>(initial);
  const [isValidating, setIsValidating] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  // Track latest fetcher to avoid stale closures
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  // Inflight dedup — don't fire concurrent fetches for the same key
  const inflightRef = useRef<Promise<T> | null>(null);

  // Mounted guard — skip setState / error logging after unmount
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  const revalidate = useCallback(async () => {
    // Dedup: if a fetch is already in-flight, await it instead
    if (inflightRef.current) {
      try {
        const result = await inflightRef.current;
        if (mountedRef.current) setData(result);
      } catch { /* handled by original caller */ }
      return;
    }

    if (mountedRef.current) {
      setIsValidating(true);
      setError(null);
    }

    const fetchPromise = fetcherRef.current();
    inflightRef.current = fetchPromise;

    try {
      const fresh = await fetchPromise;
      const now = Date.now();

      // Update memory cache
      memoryCache.set(key, { data: fresh, ts: now });

      // Persist to sessionStorage
      if (persist) {
        writeSession(key, fresh, now);
      }

      if (mountedRef.current) setData(fresh);
    } catch (err) {
      // Only log if still mounted — unmount-triggered "Failed to fetch" is expected
      if (mountedRef.current) {
        console.error(`[useSWRCache] revalidate error for key="${key}":`, err);
        setError(err instanceof Error ? err : new Error(String(err)));
      }
    } finally {
      inflightRef.current = null;
      if (mountedRef.current) setIsValidating(false);
    }
  }, [key, persist]);

  // ── On mount / deps change: revalidate ─────────────────────
  // If we have cached data, render it immediately (stale) and revalidate
  // in background. If no cached data, revalidate eagerly.
  const depsKey = JSON.stringify(deps);
  const prevDepsKeyRef = useRef(depsKey);

  useEffect(() => {
    const mem = memoryCache.get(key);
    const isFresh = mem && (Date.now() - mem.ts < ttl);
    const depsChanged = prevDepsKeyRef.current !== depsKey;
    prevDepsKeyRef.current = depsKey;

    if (depsChanged || !isFresh) {
      // If we have stale data, keep it visible while revalidating
      if (mem) {
        setData(mem.data as T);
      }
      revalidate();
    } else if (mem) {
      // Fresh cache — just use it, no fetch needed
      setData(mem.data as T);
    }
  }, [key, depsKey, ttl, revalidate]);

  // ── Expose invalidate (for Realtime subscriptions) ─────────
  const invalidate = useCallback(() => {
    revalidate();
  }, [revalidate]);

  return { data, isValidating, error, invalidate };
}

// ── Static helpers for external cache management ─────────────

/** Evict a specific key from both memory and session caches */
export function evictSWRCache(key: string) {
  memoryCache.delete(key);
  clearSession(key);
}

/** Write data directly into both memory and session caches (for mutation-generated data) */
export function writeSWRCache<T>(key: string, data: T) {
  const now = Date.now();
  memoryCache.set(key, { data, ts: now });
  writeSession(key, data, now);
}

/** Read data from memory cache first, then sessionStorage (without triggering a fetch) */
export function readSWRCache<T>(key: string): T | null {
  const mem = memoryCache.get(key);
  if (mem) return mem.data as T;
  const session = readSession<T>(key);
  if (session) {
    memoryCache.set(key, { data: session.data, ts: session.ts });
    return session.data;
  }
  return null;
}

/** Evict all SWR caches */
export function evictAllSWRCaches() {
  memoryCache.clear();
  try {
    const toRemove: string[] = [];
    for (let i = 0; i < sessionStorage.length; i++) {
      const k = sessionStorage.key(i);
      if (k?.startsWith('swr:')) toRemove.push(k);
    }
    toRemove.forEach(k => sessionStorage.removeItem(k));
  } catch {
    // ignore
  }
}