import { Activity, CheckCircle, AlertCircle } from 'lucide-react';
import { WidgetShell } from '../dashboard/WidgetShell';

// ============================================================
// Network Status Panel (Task 168)
//
// Public-facing view of Solstice Network health: validator
// consensus, RPC health, agent fleet, uptime, last incident.
// ============================================================

interface StatusItem {
  label: string;
  status: 'healthy' | 'degraded' | 'down';
  detail: string;
}

const NETWORK_STATUS: StatusItem[] = [
  { label: 'Validator Consensus', status: 'healthy', detail: '5/5 voting' },
  { label: 'RPC Gateway', status: 'healthy', detail: 'p99 latency 42ms' },
  { label: 'Agent Fleet', status: 'healthy', detail: 'All agents operational' },
  { label: 'Token-2022 Program', status: 'healthy', detail: 'Active, no errors' },
  { label: 'Settlement Pipeline', status: 'healthy', detail: 'Processing normally' },
];

const UPTIME: { period: string; value: string }[] = [
  { period: '24h', value: '100.00%' },
  { period: '7d', value: '99.99%' },
  { period: '30d', value: '99.97%' },
  { period: '90d', value: '99.99%' },
];

const STATUS_ICON: Record<string, { icon: typeof CheckCircle; color: string }> = {
  healthy: { icon: CheckCircle, color: 'text-emerald-500 dark:text-emerald-400' },
  degraded: { icon: AlertCircle, color: 'text-amber-500 dark:text-amber-400' },
  down: { icon: AlertCircle, color: 'text-red-500 dark:text-red-400' },
};

export function NetworkStatusPanel() {
  return (
    <WidgetShell title="Network Status" icon={Activity}>
      <div className="space-y-4">
        {/* Component status */}
        <div className="space-y-0">
          {NETWORK_STATUS.map((item, i) => {
            const cfg = STATUS_ICON[item.status];
            const Icon = cfg.icon;
            return (
              <div
                key={item.label}
                className={`flex items-center justify-between py-2.5 ${
                  i > 0 ? 'border-t border-black/[0.06] dark:border-white/[0.06]' : ''
                }`}
              >
                <div className="flex items-center gap-2">
                  <Icon size={14} className={cfg.color} />
                  <span className="text-[13px] text-coda-text">{item.label}</span>
                </div>
                <span className="text-[12px] font-mono text-coda-text-muted">{item.detail}</span>
              </div>
            );
          })}
        </div>

        {/* Uptime */}
        <div>
          <div className="text-[11px] font-mono text-coda-text-muted uppercase tracking-wider mb-2">
            Uptime
          </div>
          <div className="grid grid-cols-4 gap-3">
            {UPTIME.map((u) => (
              <div key={u.period} className="text-center">
                <div className="text-[18px] font-mono font-light text-emerald-500 dark:text-emerald-400 tabular-nums">
                  {u.value}
                </div>
                <div className="text-[10px] text-coda-text-muted font-mono uppercase mt-0.5">
                  {u.period}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Last incident */}
        <div>
          <div className="text-[11px] font-mono text-coda-text-muted uppercase tracking-wider mb-1">
            Last Incident
          </div>
          <div className="text-[13px] text-coda-text-muted italic">
            No recent incidents
          </div>
        </div>
      </div>
    </WidgetShell>
  );
}
