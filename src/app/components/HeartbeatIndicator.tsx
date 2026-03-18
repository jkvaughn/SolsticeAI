import { useHeartbeat } from './HeartbeatContext';
import { HeartPulse } from 'lucide-react';
import { useNavigate, useLocation } from 'react-router';

/**
 * Floating heartbeat status pill — renders in the bottom-right corner
 * of the viewport whenever the autonomous heartbeat is running.
 * Clicking it navigates to /treasury-ops.
 */
export function HeartbeatIndicator() {
  const { isRunning, cycleInFlight, latestCycleNumber } = useHeartbeat();
  const navigate = useNavigate();
  const location = useLocation();

  // Don't show on the Treasury Ops page itself — redundant
  const onTreasuryPage = location.pathname === '/treasury-ops';

  if (!isRunning || onTreasuryPage) return null;

  return (
    <button
      onClick={() => navigate('/treasury-ops')}
      className="fixed bottom-5 right-5 z-[9999] flex items-center gap-2.5 px-4 py-2.5
        rounded-full cursor-pointer
        backdrop-blur-2xl bg-white/60 dark:bg-white/10
        border border-white/30 dark:border-white/15
        shadow-lg hover:shadow-xl
        transition-all duration-300 hover:scale-[1.03] active:scale-[0.97]
        group"
      aria-label="Heartbeat active — click to view Treasury Operations"
    >
      {/* Pulsing heart icon */}
      <div className="relative flex items-center justify-center">
        <HeartPulse
          size={16}
          className="text-emerald-500 animate-heartbeat"
        />
        {/* Radiating ring */}
        <div className="absolute inset-[-4px] rounded-full border border-emerald-500/30 animate-ping-slow" />
      </div>

      {/* Label */}
      <span className="text-xs font-semibold text-coda-text-secondary group-hover:text-coda-text transition-colors">
        Cycle {latestCycleNumber}
      </span>

      {/* In-flight dot */}
      {cycleInFlight && (
        <div className="flex gap-[3px]">
          {[0, 1, 2].map(i => (
            <div
              key={i}
              className="w-[3px] h-[3px] rounded-full bg-coda-text-muted animate-pulse"
              style={{ animationDelay: `${i * 200}ms` }}
            />
          ))}
        </div>
      )}

      {/* Live dot */}
      <div className="relative flex-shrink-0">
        <div className="w-2 h-2 rounded-full bg-emerald-500" />
        <div className="absolute inset-0 w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
      </div>
    </button>
  );
}