import { createContext, useContext, useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { callServer } from '../supabaseClient';

// ============================================================
// Types
// ============================================================

interface HeartbeatContextValue {
  isRunning: boolean;
  cycleInFlight: boolean;
  latestCycleNumber: number;
  currentSpeed: number;
  setCurrentSpeed: (speed: number) => void;
  startHeartbeat: () => void;
  stopHeartbeat: () => void;
  runSingleCycle: () => Promise<void>;
  /** Expose setter so HeartbeatControl can sync realtime data */
  setLatestCycleNumber: (n: number) => void;
}

const HeartbeatContext = createContext<HeartbeatContextValue>({
  isRunning: false,
  cycleInFlight: false,
  latestCycleNumber: 0,
  currentSpeed: 15_000,
  setCurrentSpeed: () => {},
  startHeartbeat: () => {},
  stopHeartbeat: () => {},
  runSingleCycle: async () => {},
  setLatestCycleNumber: () => {},
});

export const useHeartbeat = () => useContext(HeartbeatContext);

// ============================================================
// Provider — lives above the router so state persists across pages
// ============================================================

export function HeartbeatProvider({ children }: { children: ReactNode }) {
  const [isRunning, setIsRunning] = useState(false);
  const [cycleInFlight, setCycleInFlight] = useState(false);
  const [latestCycleNumber, setLatestCycleNumber] = useState(0);
  const [currentSpeed, setCurrentSpeed] = useState(15_000);

  const isRunningRef = useRef(false);
  const speedRef = useRef(currentSpeed);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => { speedRef.current = currentSpeed; }, [currentSpeed]);

  // ── Timer loop ──
  const runNextCycle = useCallback(async () => {
    if (!isRunningRef.current) return;
    setCycleInFlight(true);
    try {
      await callServer('/network-heartbeat', { action: 'next_cycle' }, 5);
    } catch (err) {
      console.error('[HeartbeatContext] Cycle error:', err);
    } finally {
      setCycleInFlight(false);
      if (isRunningRef.current) {
        timeoutRef.current = setTimeout(runNextCycle, speedRef.current);
      }
    }
  }, []);

  const startHeartbeat = useCallback(() => {
    setIsRunning(true);
    isRunningRef.current = true;
    runNextCycle();
  }, [runNextCycle]);

  const stopHeartbeat = useCallback(() => {
    setIsRunning(false);
    isRunningRef.current = false;
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
  }, []);

  const runSingleCycle = useCallback(async () => {
    setCycleInFlight(true);
    try {
      await callServer('/network-heartbeat', { action: 'next_cycle' }, 5);
    } catch (err) {
      console.error('[HeartbeatContext] Single cycle error:', err);
    } finally {
      setCycleInFlight(false);
    }
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      isRunningRef.current = false;
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, []);

  return (
    <HeartbeatContext.Provider
      value={{
        isRunning,
        cycleInFlight,
        latestCycleNumber,
        currentSpeed,
        setCurrentSpeed,
        startHeartbeat,
        stopHeartbeat,
        runSingleCycle,
        setLatestCycleNumber,
      }}
    >
      {children}
    </HeartbeatContext.Provider>
  );
}
