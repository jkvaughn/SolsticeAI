import { useEffect, useRef } from 'react';
import { supabase } from '../supabaseClient';
import type { RealtimeChannel } from '@supabase/supabase-js';

// ============================================================
// useRealtimeSubscription — Environment-aware realtime hook
// ============================================================
// When VITE_USE_SUPABASE_REALTIME is true (default for dev/staging):
//   Uses native Supabase Realtime channels (postgres_changes)
// When false (production on Azure):
//   Falls back to periodic polling at the specified interval
// ============================================================

const USE_SUPABASE_REALTIME = import.meta.env.VITE_USE_SUPABASE_REALTIME !== 'false';

type PostgresEvent = 'INSERT' | 'UPDATE' | 'DELETE' | '*';

interface SubscriptionConfig {
  /** Unique channel name */
  channelName: string;
  /** Table subscriptions */
  subscriptions: Array<{
    table: string;
    event: PostgresEvent;
    callback: (payload: any) => void;
  }>;
  /** Polling interval in ms when Supabase Realtime is disabled (default: 3000) */
  pollIntervalMs?: number;
  /** Polling function — called periodically when Supabase Realtime is disabled */
  onPoll?: () => void;
}

/**
 * Subscribe to database changes via Supabase Realtime or polling fallback.
 * Drop-in replacement for manual supabase.channel() setups.
 */
export function useRealtimeSubscription(config: SubscriptionConfig) {
  const { channelName, subscriptions, pollIntervalMs = 3000, onPoll } = config;
  const channelRef = useRef<RealtimeChannel | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (USE_SUPABASE_REALTIME) {
      // --- Supabase Realtime mode ---
      let channel = supabase.channel(channelName);
      for (const sub of subscriptions) {
        channel = channel.on(
          'postgres_changes',
          { event: sub.event, schema: 'public', table: sub.table },
          sub.callback
        );
      }
      channel.subscribe();
      channelRef.current = channel;

      return () => {
        channel.unsubscribe();
        channelRef.current = null;
      };
    } else {
      // --- Polling fallback mode (production without Supabase) ---
      if (onPoll) {
        // Initial poll
        onPoll();
        // Periodic polling
        pollRef.current = setInterval(onPoll, pollIntervalMs);

        return () => {
          if (pollRef.current) {
            clearInterval(pollRef.current);
            pollRef.current = null;
          }
        };
      }
      return undefined;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channelName]);
}
