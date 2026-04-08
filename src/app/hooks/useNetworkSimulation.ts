/**
 * useNetworkSimulation — TPS simulation engine for Network Command
 *
 * Behaviour:
 *  - Fetches real metrics from /network-metrics on mount (always).
 *  - Simulation is PAUSED by default — user must click Start.
 *  - Exposes start / stop / reset controls.
 *  - rAF loop drives TPS ramp, arc generation, counter increments.
 *  - setState throttled to ~20 fps to avoid React render thrashing.
 *  - Counters are capped to prevent overflow / negative numbers.
 */

import { useEffect, useRef, useState, useCallback } from 'react';
import { supabase, callServer } from '../supabaseClient';
import { fetchBanks, fetchLockupTokens, fetchNetworkWallets, fetchCadenzaFlags, fetchTransactions } from '../dataClient';

// ============================================================
// Types
// ============================================================

export interface NetworkMetricsData {
  tps: number;
  total_volume_24h: number;
  transaction_count_24h: number;
  settled_count_24h: number;
  success_rate: number;
  held_count: number;
  avg_risk_score: number;
  corridors: Record<string, { volume: number; count: number; avg_risk: number; held: number }>;
  agent_fleet: { bank_code: string; name: string; status: string; balance: number }[];
  recent_cycles: any[];
  anomalies: any[];
  timestamp: string;
}

export interface SimulationArc {
  id: string;
  from: string;
  to: string;
  color: 'emerald' | 'amber' | 'purple' | 'red';
  startTime: number;
  duration: number;
}

export interface CadenzaFlag {
  id: string;
  transaction_id: string;
  lockup_token_id?: string;
  flag_type: string;
  severity: string;
  reasoning: string;
  detected_at: string;
  action_taken?: string;
}

export interface SettlementEvent {
  id: string;
  sender_code: string;
  receiver_code: string;
  amount: number;
  settlement_method: string;
  settled_at: string;
}

export interface NetworkSimulationState {
  tps: number;
  peakTps: number;
  tpsPhase: 'idle' | 'ramp' | 'hold';
  confirmedTxs: number;
  volumeSettled: number;
  activeLockups: number;
  yieldAccruing: number;
  feesCollected: number;
  arcs: SimulationArc[];
  cadenzaFlags: CadenzaFlag[];
  settlementEvents: SettlementEvent[];
  networkMode: string;
  metricsLoaded: boolean;
  heartbeatBanner: boolean;
  banks: { code: string; name: string; status: string; balance: number }[];
  corridorWeights: { from: string; to: string; weight: number }[];
  /** Whether the simulation loop is actively running */
  running: boolean;
}

export interface NetworkSimulationControls {
  state: NetworkSimulationState;
  start: () => void;
  stop: () => void;
  reset: () => void;
}

// ============================================================
// Counter caps — prevent overflow / absurd numbers
// ============================================================
const MAX_CONFIRMED_TXS = 999_999_999; // ~1B
const MAX_VOLUME_SETTLED = 999_999_999_999; // ~$1T
const MAX_YIELD = 999_999_999; // ~$1B
const MAX_TPS = 50_000;

// ============================================================
// LCG pseudo-random (seeded)
// ============================================================
function lcg(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) & 0xffffffff;
    return (s >>> 0) / 0xffffffff;
  };
}

function seedFromString(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = (hash * 31 + str.charCodeAt(i)) & 0xffffffff;
  }
  return hash;
}

// ============================================================
// Hook
// ============================================================
export function useNetworkSimulation(): NetworkSimulationControls {
  const [state, setState] = useState<NetworkSimulationState>({
    tps: 0,
    peakTps: 12000,
    tpsPhase: 'idle',
    confirmedTxs: 0,
    volumeSettled: 0,
    activeLockups: 0,
    yieldAccruing: 0,
    feesCollected: 0,
    arcs: [],
    cadenzaFlags: [],
    settlementEvents: [],
    networkMode: 'devnet',
    metricsLoaded: false,
    heartbeatBanner: false,
    banks: [],
    corridorWeights: [],
    running: false,
  });

  const stateRef = useRef(state);
  stateRef.current = state;

  // Snapshot of counters at simulation start (for capping deltas)
  const baseCountersRef = useRef({ confirmedTxs: 0, volumeSettled: 0, yieldAccruing: 0 });

  // Store fetched baseline data — only applied to state when simulation starts
  const fetchedBaselineRef = useRef<Partial<NetworkSimulationState> | null>(null);

  const rampStartRef = useRef(0);
  const arcIdCounterRef = useRef(0);
  const metricsRef = useRef<NetworkMetricsData | null>(null);
  const rngRef = useRef(lcg(Date.now()));
  const rafIdRef = useRef(0);

  // ── Fetch initial data (always, regardless of running) ─────
  useEffect(() => {
    let cancelled = false;

    async function init() {
      try {
        const metrics = await callServer<NetworkMetricsData>('/network-metrics', {});
        if (cancelled) return;
        metricsRef.current = metrics;

        const activeBanks = (metrics.agent_fleet || []).filter(b => b.status === 'active');
        const bankCount = Math.max(activeBanks.length, 1);
        const basePeak = bankCount * 3000 + seedFromString(metrics.timestamp || 'seed') % 4000;
        const peakTps = Math.max(8000, Math.min(22000, basePeak));

        const corridorWeights: { from: string; to: string; weight: number }[] = [];
        if (metrics.corridors) {
          for (const [key, val] of Object.entries(metrics.corridors)) {
            const parts = key.split('\u2192');
            if (parts.length === 2) {
              corridorWeights.push({ from: parts[0], to: parts[1], weight: val.count || 1 });
            }
          }
        }
        if (corridorWeights.length === 0 && activeBanks.length >= 2) {
          for (let i = 0; i < activeBanks.length; i++) {
            for (let j = 0; j < activeBanks.length; j++) {
              if (i !== j) {
                corridorWeights.push({
                  from: activeBanks[i].bank_code,
                  to: activeBanks[j].bank_code,
                  weight: 1,
                });
              }
            }
          }
        }

        const [activeLockupData, escalatedLockupData] = await Promise.all([
          fetchLockupTokens({ status: 'active' }),
          fetchLockupTokens({ status: 'escalated' }),
        ]);
        const lockups = [...activeLockupData, ...escalatedLockupData];
        const activeLockups = lockups.length;
        const yieldAccruing = lockups.reduce((sum, l) => sum + (Number(l.yield_accrued) || 0), 0) / 1e6;

        const netWallets = await fetchNetworkWallets();
        const feesWallet = netWallets.find((w: any) => w.code === 'SOLSTICE_FEES');
        const feesCollected = feesWallet?.balance || 0;

        const networkMode = (import.meta.env.VITE_SOLANA_CLUSTER || 'devnet') === 'mainnet-beta' ? 'production' : 'devnet';

        const flags = await fetchCadenzaFlags();

        const recentTxns = await fetchTransactions({ status: 'settled', limit: 50 });

        const bankMap: Record<string, string> = {};
        const allBanks = await fetchBanks();
        for (const b of allBanks) bankMap[b.id] = b.short_code;

        const settlementEvents: SettlementEvent[] = (recentTxns || []).map(tx => ({
          id: tx.id,
          sender_code: bankMap[tx.sender_bank_id] || '???',
          receiver_code: bankMap[tx.receiver_bank_id] || '???',
          amount: tx.amount_display || (tx.amount / 1e6),
          settlement_method: tx.settlement_method || 'pvp_burn_mint',
          settled_at: tx.settled_at || tx.created_at,
        }));

        if (cancelled) return;

        // Store fetched data in ref — will be applied when user presses Start
        fetchedBaselineRef.current = {
          peakTps,
          confirmedTxs: metrics.transaction_count_24h || 0,
          volumeSettled: metrics.total_volume_24h || 0,
          activeLockups,
          yieldAccruing,
          feesCollected: Number(feesCollected) || 0,
          cadenzaFlags: flags as CadenzaFlag[],
          settlementEvents,
          networkMode,
          banks: (metrics.agent_fleet || []).map(b => ({
            code: b.bank_code,
            name: b.name,
            status: b.status,
            balance: b.balance,
          })),
          corridorWeights,
        };

        setState(prev => ({
          ...prev,
          // Only set structural data needed for globe rendering + mode badge
          peakTps,
          networkMode,
          metricsLoaded: true,
          banks: (metrics.agent_fleet || []).map(b => ({
            code: b.bank_code,
            name: b.name,
            status: b.status,
            balance: b.balance,
          })),
          corridorWeights,
        }));
      } catch (err) {
        console.error('[useNetworkSimulation] Init error:', err);
        if (!cancelled) setState(prev => ({ ...prev, metricsLoaded: true }));
      }
    }

    init();
    return () => { cancelled = true; };
  }, []);

  // ── Simulation loop — only runs when state.running is true ──
  useEffect(() => {
    if (!state.running || !state.metricsLoaded) return;

    // Snapshot base counters at simulation start
    baseCountersRef.current = {
      confirmedTxs: stateRef.current.confirmedTxs,
      volumeSettled: stateRef.current.volumeSettled,
      yieldAccruing: stateRef.current.yieldAccruing,
    };
    rampStartRef.current = performance.now();
    rngRef.current = lcg(Date.now());

    let lastTick = performance.now();
    let lastRender = performance.now();
    let tpsAccumulator = 0;
    let arcAccumulator = 0;

    // Mutable working copies (updated every rAF, flushed to React at ~20fps)
    let wTps = 0;
    let wPhase: 'ramp' | 'hold' = 'ramp';
    let wConfirmedTxs = stateRef.current.confirmedTxs;
    let wVolumeSettled = stateRef.current.volumeSettled;
    let wYieldAccruing = stateRef.current.yieldAccruing;
    let wActiveLockups = stateRef.current.activeLockups;
    let wFeesCollected = stateRef.current.feesCollected;
    let wArcs: SimulationArc[] = [...stateRef.current.arcs];

    const RENDER_INTERVAL = 50; // flush to React every 50ms (~20fps)

    function tick(now: number) {
      const s = stateRef.current;
      if (!s.running) return; // stop loop

      const dt = Math.min(now - lastTick, 100);
      lastTick = now;

      const elapsed = (now - rampStartRef.current) / 1000;
      const rng = rngRef.current;

      // ── TPS calculation ─────────────────────────────────────
      const RAMP_DURATION = 3;
      let currentTps: number;

      if (elapsed < RAMP_DURATION) {
        const t = elapsed / RAMP_DURATION;
        const eased = 1 - Math.pow(1 - t, 3);
        currentTps = s.peakTps * eased;
        wPhase = 'ramp';
      } else {
        const variance = 0.05 + rng() * 0.03;
        const direction =
          Math.sin(now / 1000 * 0.7) * 0.5 +
          Math.sin(now / 1000 * 1.3) * 0.3 +
          Math.sin(now / 1000 * 2.1) * 0.2;
        currentTps = s.peakTps * (1 + direction * variance);
        wPhase = 'hold';
      }

      if (s.heartbeatBanner) currentTps *= 1.15;
      currentTps = Math.max(0, Math.min(MAX_TPS, Math.round(currentTps)));
      wTps = currentTps;

      // ── Counter increments (capped) ─────────────────────────
      tpsAccumulator += currentTps * (dt / 1000);
      const txIncrement = Math.floor(tpsAccumulator);
      tpsAccumulator -= txIncrement;

      wConfirmedTxs = Math.min(wConfirmedTxs + txIncrement, MAX_CONFIRMED_TXS);
      wVolumeSettled = Math.min(wVolumeSettled + txIncrement * 50_000, MAX_VOLUME_SETTLED);

      // Yield accrues proportionally to TPS (simulates interest on lockups)
      // Each lockup earns ~$0.12/sec at peak TPS, scaling with network activity
      const tpsRatio = currentTps / Math.max(s.peakTps, 1);
      wYieldAccruing += (dt / 1000) * 0.12 * tpsRatio * Math.max(wActiveLockups, 1);
      wYieldAccruing = Math.min(wYieldAccruing, MAX_YIELD);

      // Lockups increment occasionally (new lockups created during settlement)
      if (txIncrement > 0 && rng() < 0.002) {
        wActiveLockups += 1;
      }

      // Fees: $0.045 per confirmed transaction
      wFeesCollected += txIncrement * 0.045;

      // ── Arc generation ──────────────────────────────────────
      arcAccumulator += dt;
      const arcInterval = currentTps > 0 ? Math.max(80, 2_000_000 / currentTps) : 500;
      const newArcs: SimulationArc[] = [];

      while (arcAccumulator >= arcInterval && s.corridorWeights.length > 0) {
        arcAccumulator -= arcInterval;
        const totalWeight = s.corridorWeights.reduce((sum, c) => sum + c.weight, 0);
        let pick = rng() * totalWeight;
        let corridor = s.corridorWeights[0];
        for (const c of s.corridorWeights) {
          pick -= c.weight;
          if (pick <= 0) { corridor = c; break; }
        }

        const colorRoll = rng();
        const color: SimulationArc['color'] =
          colorRoll < 0.70 ? 'emerald' :
          colorRoll < 0.85 ? 'amber' :
          colorRoll < 0.95 ? 'purple' : 'red';

        newArcs.push({
          id: `arc-${arcIdCounterRef.current++}`,
          from: corridor.from,
          to: corridor.to,
          color,
          startTime: now,
          duration: 1500,
        });
      }

      // Prune expired arcs
      wArcs = [...wArcs, ...newArcs].filter(a => now - a.startTime < a.duration);

      // ── Throttled React setState ────────────────────────────
      if (now - lastRender >= RENDER_INTERVAL) {
        lastRender = now;
        const snapshot = {
          tps: wTps,
          tpsPhase: wPhase as 'ramp' | 'hold',
          confirmedTxs: wConfirmedTxs,
          volumeSettled: wVolumeSettled,
          yieldAccruing: wYieldAccruing,
          activeLockups: wActiveLockups,
          feesCollected: wFeesCollected,
          arcs: wArcs,
        };
        setState(prev => ({
          ...prev,
          ...snapshot,
        }));
      }

      rafIdRef.current = requestAnimationFrame(tick);
    }

    rafIdRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafIdRef.current);
  }, [state.running, state.metricsLoaded]);

  // ── Realtime: cadenza_flags ─────────────────────────────────
  useEffect(() => {
    const channel = supabase
      .channel('nc-cadenza-flags')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'cadenza_flags' },
        (payload) => {
          const flag = payload.new as CadenzaFlag;
          setState(prev => ({
            ...prev,
            cadenzaFlags: [flag, ...prev.cadenzaFlags].slice(0, 50),
          }));
        },
      )
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, []);

  // ── Realtime: transactions ──────────────────────────────────
  useEffect(() => {
    const channel = supabase
      .channel('nc-transactions')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'transactions' },
        () => {},
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'transactions' },
        async (payload) => {
          const tx = payload.new as any;
          if (tx.status === 'settled' && tx.settled_at) {
            const allBanks = await fetchBanks();
            const bankMap: Record<string, string> = {};
            for (const b of allBanks) bankMap[b.id] = b.short_code;

            const event: SettlementEvent = {
              id: tx.id,
              sender_code: bankMap[tx.sender_bank_id] || '???',
              receiver_code: bankMap[tx.receiver_bank_id] || '???',
              amount: tx.amount_display || (tx.amount / 1e6),
              settlement_method: tx.settlement_method || 'pvp_burn_mint',
              settled_at: tx.settled_at,
            };
            setState(prev => ({
              ...prev,
              settlementEvents: [event, ...prev.settlementEvents].slice(0, 50),
            }));
          }
        },
      )
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, []);

  // ── Realtime: heartbeat_cycles ──────────────────────────────
  useEffect(() => {
    const channel = supabase
      .channel('nc-heartbeat')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'heartbeat_cycles' },
        () => {
          setState(prev => ({ ...prev, heartbeatBanner: true }));
          setTimeout(() => {
            setState(prev => ({ ...prev, heartbeatBanner: false }));
          }, 3000);
        },
      )
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, []);

  // ── Auto-start on production (live data mode) ──────────────
  const isLiveData = import.meta.env.VITE_USE_LIVE_NETWORK_DATA === 'true';
  useEffect(() => {
    if (isLiveData && state.metricsLoaded && !state.running) {
      setState(prev => {
        const { cadenzaFlags: _dbFlags, ...baseline } = (fetchedBaselineRef.current || {}) as Partial<NetworkSimulationState>;
        return { ...prev, ...baseline, cadenzaFlags: [], running: true, tpsPhase: 'ramp' };
      });
    }
  }, [isLiveData, state.metricsLoaded]);

  // ── Controls ────────────────────────────────────────────────
  const start = useCallback(() => {
    setState(prev => {
      if (prev.running) return prev;
      // Apply fetched baseline data when simulation starts
      // Exclude cadenzaFlags — only real-time flags during simulation should show
      const { cadenzaFlags: _dbFlags, ...baseline } = (fetchedBaselineRef.current || {}) as Partial<NetworkSimulationState>;
      return { ...prev, ...baseline, cadenzaFlags: [], running: true, tpsPhase: 'ramp' };
    });
  }, []);

  const stop = useCallback(() => {
    cancelAnimationFrame(rafIdRef.current);
    setState(prev => {
      if (!prev.running) return prev;
      return { ...prev, running: false, tps: 0, tpsPhase: 'idle', arcs: [] };
    });
  }, []);

  const reset = useCallback(() => {
    cancelAnimationFrame(rafIdRef.current);
    const base = baseCountersRef.current;
    setState(prev => ({
      ...prev,
      running: false,
      tps: 0,
      tpsPhase: 'idle',
      arcs: [],
      confirmedTxs: base.confirmedTxs,
      volumeSettled: base.volumeSettled,
      yieldAccruing: base.yieldAccruing,
    }));
  }, []);

  return { state, start, stop, reset };
}